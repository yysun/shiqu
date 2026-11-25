// Keep one owner-scoped reference per book. Only server-resolved local pictures become
// immutable snapshots; selection changes affect future calls, never paid job identities.
import {decodeDocument} from '../lib/production-dag/document.ts';
import {createHash,randomUUID} from 'node:crypto';
import type {Database,SyncStatements} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {StoryGenerator} from '../lib/reader-engine.ts';
import {ReaderError} from '../lib/reader-model.ts';
import type {Document,Selection} from '../lib/reader-model.ts';
import {usesStoryImageReference} from '../lib/reader-revision.ts';
import {readerBooks} from '../lib/reader-books.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType,imageTypes} from '../lib/reader-generation-contract.ts';
import {imageDimensions} from '../lib/reader-image-dimensions.ts';
import {PaidDispatchDenied,readDrawingReference} from './paid-dispatch.ts';

export const bookReferenceMigration='0010_book_image_references.sql';
export type BookReference={storyId:string;page:number;token:string};
type SavedReference={owner_id:string;book_key:string;story_id:string;page:number;token:string;asset_key:string};
type Source={bookKey:string;image:string;validPage:boolean;storyImageReference:boolean;guard:string;values:unknown[]};
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function bookKey(id:string,custom?:string){const name=(id==='other'?custom||'':id).trim(),known=readerBooks.find(book=>book.id===name||book.title===name);if(!name)throw new ReaderError(400,'请先确定所属书籍。');return known?'book:'+known.id:(id==='other'?'custom:':'book:')+name;}
function picture(bytes:Uint8Array){const type=mediaType(bytes);if(!type||bytes.length>12*1024*1024||!imageDimensions(bytes))throw new ReaderError(400,'请选择有效的PNG、JPEG或WebP图片（不超过12MB）。');return type;}
const visible="NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=? AND d.user_id=?)";
/** 读取绘图参考的持久身份。发送前在同一事务核对星标、来源归属与本篇首幅。 */
export function drawingReferenceBinding(db:SyncStatements,ownerId:string,id:string,starOnly=false){
 const row=db.get<{selection:string;document:string}>('SELECT selection,document,production_products FROM story_rows WHERE id=? AND user_id=?',id,ownerId);
 if(!row)return null;
 const selection=JSON.parse(row.selection) as Selection,doc=decodeDocument(row);
 const fallback=doc.dag?.frames[doc.dag.order[0]]?.image??null;
 if(usesStoryImageReference(doc.revision,selection.artStyle))return starOnly?null:fallback;
 const key=bookKey(selection.bookId,selection.customBook);
 const selected=db.get<{token:string;selection:string}>(`SELECT r.token,s.selection FROM book_image_references r JOIN stories s
  ON s.id=r.story_id AND s.user_id=r.owner_id WHERE r.owner_id=? AND r.book_key=?
  AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id)`,ownerId,key);
 if(selected){
  const source=JSON.parse(selected.selection) as Selection;
  if(bookKey(source.bookId,source.customBook)===key)return selected.token;
 }
 return starOnly?null:fallback;
}

export class BookImageReferences{
 private database:Database;private media:MediaStore;private owner:string;
 constructor(database:Database,media:MediaStore,owner:string){this.database=database;this.media=media;this.owner=owner;}
 private async source(id:string,page=0):Promise<Source>{
  const row=await this.database.prepare(`SELECT selection,document,production_products FROM story_rows WHERE id=? AND user_id=? AND ${visible}`).bind(id,this.owner,id,this.owner).first<{selection:string;document:string}>();
  if(row){
   const selection=JSON.parse(row.selection) as Selection,doc=decodeDocument(row),image=doc.plan?.pages[page]?doc.images[page]||'':'';
   return {bookKey:bookKey(selection.bookId,selection.customBook),image,validPage:!!doc.plan?.pages[page],storyImageReference:usesStoryImageReference(doc.revision,selection.artStyle),guard:`EXISTS(SELECT 1 FROM stories WHERE id=? AND user_id=? AND selection=? AND document=? AND ${visible})`,values:[id,this.owner,row.selection,row.document,id,this.owner]};
  }
  throw new ReaderError(404,'这篇故事不在你的书架里');
 }
 private async selected(key:string){
  const row=await this.database.prepare('SELECT * FROM book_image_references WHERE owner_id=? AND book_key=?').bind(this.owner,key).first<SavedReference>();
  if(!row)return null;
  try{if((await this.source(row.story_id,row.page)).bookKey!==key)return null;}catch(error){if(error instanceof ReaderError&&error.status===404)return null;throw error;}
  return row;
 }
 async get(id:string):Promise<{reference:BookReference|null}>{
  const source=await this.source(id),row=await this.selected(source.bookKey);
  return {reference:row?{storyId:row.story_id,page:row.page,token:row.token}:null};
 }
 async set(id:string,page:number,starred:boolean,token?:string){
  const source=await this.source(id,page);
  if(!source.validPage)throw new ReaderError(400,'请选择有效画幅。');
  if(!starred){
   if(!token)throw new ReaderError(400,'请重新读取当前星标后再取消。');
   await this.database.prepare('DELETE FROM book_image_references WHERE owner_id=? AND book_key=? AND story_id=? AND page=? AND token=?').bind(this.owner,source.bookKey,id,page,token).run();
   return this.get(id);
  }
  if(!source.image)throw new ReaderError(400,'这幅画面还没有图片，暂时不能设为参考图。');
  let key=referenceImageKey(id,source.image);
  if(!key&&/^\/api\/media\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(source.image))key=source.image.slice('/api/media/'.length);
  if(!key)throw new ReaderError(400,'只能选择本地已保存的故事图片。');
  const object=await this.media.get(key).catch(()=>{throw new ReaderError(503,'图片暂时无法读取，请稍后重试。');});
  if(!object)throw new ReaderError(400,'这幅图片文件已丢失，请选择其他画面。');
  const bytes=new Uint8Array(await object.arrayBuffer()),type=picture(bytes),asset=`book-reference/${digest(this.owner)}/${digest(source.bookKey)}/${digest(bytes)}.${imageTypes[type]}`;
  await this.media.put(asset,bytes,{contentType:type});
  const result=await this.database.prepare(`INSERT INTO book_image_references(owner_id,book_key,story_id,page,token,asset_key,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${source.guard} ON CONFLICT(owner_id,book_key) DO UPDATE SET story_id=excluded.story_id,page=excluded.page,token=excluded.token,asset_key=excluded.asset_key,updated_at=excluded.updated_at`).bind(this.owner,source.bookKey,id,page,randomUUID(),asset,new Date().toISOString(),...source.values).run();
  if(!result.meta.changes)throw new ReaderError(409,'这幅画面已更新，请重新打开后再选。');
  return this.get(id);
 }
 async resolve(id:string,fallback:string){
  const source=await this.source(id);
  if(source.storyImageReference)return fallback;
  const row=await this.selected(source.bookKey);if(!row)return fallback;
  const match=/^book-reference\/[a-f0-9]{64}\/[a-f0-9]{64}\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(row.asset_key);
  if(!match)throw new ReaderError(503,'本书参考图不可用，请重新选择或取消星标。');
  const object=await readDrawingReference(()=>this.media.get(row.asset_key)).catch(error=>{if(error instanceof PaidDispatchDenied)throw error;return null;});
  if(!object)throw new ReaderError(503,'本书参考图不可用，请重新选择或取消星标。');
  const bytes=new Uint8Array(await readDrawingReference(()=>object.arrayBuffer()));let type;
  try{type=picture(bytes);}catch{throw new ReaderError(503,'本书参考图不可用，请重新选择或取消星标。');}
  if(digest(bytes)!==match[1])throw new ReaderError(503,'本书参考图不可用，请重新选择或取消星标。');
  const asset=readerImageAsset(id,0,imageTypes[type],match[1]);
  await this.media.put(asset.key,bytes,{contentType:type});return asset.url;
 }
}
// Legacy advances and the queue share resolution; provider namespace validation stays intact.
export function withBookReference(generator:StoryGenerator,references:BookImageReferences):StoryGenerator{
 return {...generator,async image(plan,page,id,reference,...options){return generator.image(plan,page,id,await references.resolve(id,reference),...options);}};
}
