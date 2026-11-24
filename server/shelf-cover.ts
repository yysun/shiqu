// 书架封面归故事家族所有。只复制可读图片，保存和读取均核对当前版本及读者归属。
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ReaderError,view} from '../lib/reader-model.ts';
import {familyRoot,ReaderRepository,supersededSql} from '../lib/reader-repository.ts';
import {referenceImageKey,shelfCoverAsset,shelfCoverFilePattern,shelfCoverMaxBytes} from '../lib/reader-image-assets.ts';
import {imageTypes,mediaType} from '../lib/reader-generation-contract.ts';
import {imageDimensions} from '../lib/reader-image-dimensions.ts';
import {readerMaxFrames} from '../lib/reader-limits.ts';
import type {MediaStore} from '../lib/services.ts';
import {readableImage} from './reader-image-health.ts';
import {localMediaKey} from './library-upgrade.ts';

const expectedCover=z.string().max(180).nullable();
export const shelfCoverCommand=z.object({
 expected:expectedCover,
 frame:z.object({page:z.number().int().min(0).max(readerMaxFrames-1),image:z.string().min(1).max(180)}).strict().optional(),
}).strict();
type Command=z.infer<typeof shelfCoverCommand>&{upload?:File};
const currentEdition=`NOT ${supersededSql('s')}
 AND json_type(s.document,'$.reselection') IS NULL
 AND NOT EXISTS (SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id)`;

export async function saveShelfCover(repo:ReaderRepository,media:MediaStore,ownerId:string,id:string,command:Command){
 const row=await repo.get(id,ownerId),session=view(row),root=session.revision?.rootId||id;
 if(session.shelfCover!==(command.expected??undefined)||await repo.superseded(id,ownerId)||session.reselection)
  throw new ReaderError(409,'故事版本或书架封面已更新，请重新打开后再保存。');
 let file:string|null=null;
 if(command.frame||command.upload){
  let bytes:Uint8Array;
  if(command.upload){
   if(!command.upload.size||command.upload.size>shelfCoverMaxBytes)throw new ReaderError(400,'请选择不超过 12 MiB 的图片。');
   bytes=new Uint8Array(await command.upload.arrayBuffer());
  }else{
   const {page,image}=command.frame!;
   const legacy=image.startsWith('/art/')||/^\/api\/media\/[a-zA-Z0-9._-]+$/.test(image);
   const key=referenceImageKey(id,image)??(legacy?localMediaKey(image):null);
   if(!key||key.startsWith('legacy-art/')&&key.split('/').some(part=>part.startsWith('.'))||session.story?.pages[page]?.image!==image)
    throw new ReaderError(409,'这幅图片已更新，请重新选择。');
   const asset=await media.get(key);
   if(!asset)throw new ReaderError(409,'读取不到这幅图片，请重新选择。');
   bytes=new Uint8Array(await asset.arrayBuffer());
  }
  const type=mediaType(bytes),size=imageDimensions(bytes);
  if(bytes.length>shelfCoverMaxBytes||!type||!size||size.width>4096||size.height>4096||!await readableImage(bytes))
   throw new ReaderError(400,'请选择可读取的 PNG、JPEG 或 WebP 图片，不超过 12 MiB，宽高各不超过 4096 像素。');
  file=createHash('sha256').update(bytes).digest('hex')+'.'+imageTypes[type];
  await media.put(shelfCoverAsset(root,file).key,bytes,{contentType:type});
 }
 const frame=command.frame;
 const saved=await repo.db.prepare(`UPDATE stories AS root SET shelf_cover=? WHERE root.id=? AND root.user_id=? AND root.shelf_cover IS ?
  AND EXISTS (SELECT 1 FROM stories s WHERE s.id=? AND s.user_id=root.user_id AND ${familyRoot('s')}=root.id AND ${currentEdition}
  ${frame?"AND json_extract(s.document,?)=?":''})`)
  .bind(file,root,ownerId,row.family_shelf_cover??null,id,...(frame?[`$.images[${frame.page}]`,frame.image]:[])).run();
 if(!saved.meta.changes)throw new ReaderError(409,'故事版本、画幅或书架封面已更新，请重新打开后再保存。');
 return {cover:file?shelfCoverAsset(root,file).url:null};
}

export async function loadShelfCover(repo:ReaderRepository,media:MediaStore,ownerId:string,root:string,file:string){
 if(!shelfCoverFilePattern.test(file)||!await repo.db.prepare(`SELECT 1 FROM stories root WHERE root.id=? AND root.user_id=? AND root.shelf_cover=?
  AND EXISTS (SELECT 1 FROM stories s WHERE s.user_id=root.user_id AND ${familyRoot('s')}=root.id AND ${currentEdition})`)
  .bind(root,ownerId,file).first())return null;
 return media.get(shelfCoverAsset(root,file).key);
}
