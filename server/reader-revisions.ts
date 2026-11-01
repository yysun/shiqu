// Fork edits into paused sessions. Copy immutable media before one CAS publishes the child;
// family epochs serialize competing drafts without altering originals. Only content a draft was
// written against can conflict with it: saved images and progress never do. A file that is gone
// cannot be reused and is redrawn; one that cannot be read right now stops the submission.
import {createHash} from 'node:crypto';
import {ReaderError,selectionSchema} from '../lib/reader-model.ts';
import type {Document,SessionRow} from '../lib/reader-model.ts';
import type {ReaderRepository} from '../lib/reader-repository.ts';
import {familyRoot,familyNumber,supersededSql} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import {checkedRevision,reusableRevisionImages} from '../lib/reader-revision.ts';
import type {RevisionChanges,RevisionSnapshot} from '../lib/reader-revision.ts';
import {newReview} from '../lib/reader-review.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType,imageTypes} from '../lib/reader-generation-contract.ts';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const familyEpoch=`SELECT COALESCE(MAX(${familyNumber('reader_sessions')}),1) AS epoch FROM reader_sessions WHERE user_id=? AND (id=? OR ${familyRoot('reader_sessions')}=?)`;
async function basis(repo:ReaderRepository,row:SessionRow){
 const doc=JSON.parse(row.document) as Document;
 if(doc.intake&&doc.intake.phase!=='confirmed')throw new ReaderError(409,'请在制作确认前保存设置草稿。');
 if(!doc.plan&&row.generation_control!=='paused'&&row.generation_control!=='stopped'&&!await repo.superseded(row.id,row.user_id))throw new ReaderError(409,'请先暂停生成，再修改制作内容。');
 const rootId=doc.revision?.rootId||row.id;
 const epoch=(await repo.db.prepare(familyEpoch).bind(row.user_id,rootId,rootId).first<{epoch:number}>())!.epoch;
 const token=hash(JSON.stringify([row.selection,doc.plan,epoch]));
 return {doc,rootId,epoch,token};
}
export async function revisionSnapshot(repo:ReaderRepository,id:string,ownerId:string):Promise<RevisionSnapshot>{
 const row=await repo.get(id,ownerId),{doc,epoch,token}=await basis(repo,row);
 return {selection:selectionSchema.parse(JSON.parse(row.selection)),plan:doc.plan,images:doc.images,...(doc.frameRecommendation?{frameRecommendation:doc.frameRecommendation}:{}),token,epoch,...(doc.revision?{revision:{parentId:doc.revision.parentId,rootId:doc.revision.rootId,number:doc.revision.number}}:{})};
}
export async function forkRevision(repo:ReaderRepository,media:MediaStore,ownerId:string,parentId:string,requestId:string,token:string,changes:RevisionChanges,paused=false){
 // Preserve fingerprints of requests saved before explicit paused submissions were added.
 const requestHash=hash(JSON.stringify([parentId,token,changes,...(paused?[true]:[])]));
 const replay=async()=>{
  const existing=await repo.db.prepare('SELECT * FROM reader_sessions WHERE id=?').bind(requestId).first<SessionRow>();
  if(!existing)return null;
  const revision=(JSON.parse(existing.document) as Document).revision;
  if(existing.user_id!==ownerId||revision?.parentId!==parentId||revision.requestHash!==requestHash)throw new ReaderError(409,'这个提交编号已用于其他修改，请重新打开编辑。');
  return repo.get(requestId,ownerId);
 };
 const existing=await replay();if(existing)return existing;
 const row=await repo.get(parentId,ownerId),{doc,rootId,epoch,token:current}=await basis(repo,row);
 if(current!==token)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
 const original={selection:selectionSchema.parse(JSON.parse(row.selection)),plan:doc.plan,images:doc.images,...(doc.frameRecommendation?{frameRecommendation:doc.frameRecommendation}:{})};
 const {selection,plan,impact}=checkedRevision(original,changes);
 const images:string[]=original.plan?.pages.map(()=> '')||[],lostPages:number[]=[];
 // Global image preferences cannot reuse old artwork. Other edits may reuse after planning.
 if(selection.artStyle===original.selection.artStyle&&selection.productionPrompt===original.selection.productionPrompt){
  for(let page=0;page<original.images.length;page++){
   const value=original.images[page]||'';
   if(!value)continue;
   const key=referenceImageKey(parentId,value);if(!key){lostPages.push(page);continue;}
   const asset=await media.get(key).catch(()=>{throw new ReaderError(503,`第 ${page+1} 幅原图暂时无法读取，未创建新版，请稍后重试。`);});if(!asset){lostPages.push(page);continue;}
   const bytes=new Uint8Array(await asset.arrayBuffer()),type=mediaType(bytes);
   if(!type){lostPages.push(page);continue;}
   const target=readerImageAsset(requestId,page,imageTypes[type],hash(bytes));
   await media.put(target.key,bytes,{contentType:type});images[page]=target.url;
  }
 }
 const base={...original,images};
 const document:Document={plan,original:doc.original,frameRecommendation:doc.frameRecommendation,frameCountConfirmed:true,visualReview:newReview(),images:[],audio:[],usage:[],revision:{parentId,rootId,number:epoch+1,baseToken:token,requestHash,handoff:true,base,...(impact.replan?{}:{previewedRedraw:impact.redraw}),...(lostPages.length?{lostPages}:{})}};
 if(plan)document.images=reusableRevisionImages(base,selection,plan);
 const now=new Date().toISOString();
 const inserted=await repo.db.prepare(`INSERT INTO reader_sessions(id,user_id,selection,document,generation_mode,generation_control,state,step_attempts,lock_until,page,saved,last_read_at,created_at,updated_at)
  SELECT ?,?,?,?,'background','paused','idle',0,0,MIN(p.page,?),p.saved,p.last_read_at,?,? FROM reader_sessions p
  WHERE p.id=? AND p.user_id=? AND json_extract(p.document,'$.plan') IS json_extract(?,'$.plan') AND p.selection=?
  AND (json_extract(p.document,'$.plan') IS NOT NULL OR p.generation_control IN ('paused','stopped') OR ${supersededSql('p')})
  AND NOT EXISTS(SELECT 1 FROM library_deletions WHERE story_id=p.id AND user_id=p.user_id)
  AND (${familyEpoch.replace(' AS epoch','')})=?
  ON CONFLICT(id) DO NOTHING`)
  .bind(requestId,ownerId,JSON.stringify(selection),JSON.stringify(document),impact.total-1,now,now,parentId,ownerId,row.document,row.selection,ownerId,rootId,rootId,epoch).run();
 if(!inserted.meta.changes){const raced=await replay();if(raced)return raced;throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');}
 return repo.get(requestId,ownerId);
}
