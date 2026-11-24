// Fork edits into new sessions. Copy immutable media before one CAS publishes the child;
// family epochs serialize competing drafts without altering originals. Only content a draft was
// written against can conflict with it: saved images and progress never do. A file that is gone
// cannot be reused and is redrawn; one that cannot be read right now stops the submission.
// Image-only redraws require a completed story and preserve review and all unselected artwork.
// Style-only revisions inherit review checkpoints, including unresolved or overridden reviews.
import {createHash} from 'node:crypto';
import {ReaderError,selectionSchema} from '../lib/reader-model.ts';
import type {Document,SessionRow} from '../lib/reader-model.ts';
import type {ReaderRepository} from '../lib/reader-repository.ts';
import {familyRoot,familyNumber,supersededSql} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {RevisionChanges,RevisionSnapshot} from '../lib/reader-revision.ts';
import {commandReceipt} from './reader-commands.ts';
import {forkDagRevision,previewDagRevision} from './dag-revisions.ts';
import {dagProgress,reviewAttention} from '../lib/production-dag/progress.ts';
import {authorizeProductionCommand} from '../lib/production-lifecycle.ts';
export {previewDagRevision};
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const revisionCoverMaxBytes=12*1024*1024;
export const familyEpoch=`SELECT COALESCE(MAX(${familyNumber('stories')}),1) AS epoch FROM stories WHERE user_id=? AND (id=? OR ${familyRoot('stories')}=?)`;
export const currentFamilyVersion=(alias='p')=>`NOT ${supersededSql(alias)} AND NOT EXISTS(SELECT 1 FROM library_deletions WHERE story_id=${alias}.id AND user_id=${alias}.user_id)`;
export function editableSelection(selection:string){const {displayTitle:_,...value}=JSON.parse(selection);void _;return value;}
export const revisionToken=(row:SessionRow,doc:Document,epoch:number)=>hash(JSON.stringify([editableSelection(row.selection),doc.plan,epoch]));
// 准备阶段会写入模型建议，只有主动选择或确认才更换制作世代。
export const replacementToken=(selection:string,epoch:number,intakeGeneration?:number)=>hash(JSON.stringify(
 intakeGeneration===undefined?[editableSelection(selection),epoch]:[epoch,'intake',intakeGeneration],
));
const savedFrameCount=(doc:Document)=>doc.draft?.pages.length??doc.storyboard?.outline.beats.length;
const canEditReviewNotes=(row:SessionRow,doc:Document)=>!!doc.plan&&!!doc.visualReview&&row.state!=='completed'&&(row.generation_control==='paused'||row.generation_control==='stopped');
export async function revisionBasis(repo:ReaderRepository,row:SessionRow,forReselection=false){
 const doc=JSON.parse(row.document) as Document;
 const current=!doc.reselection&&!await repo.superseded(row.id,row.user_id);
 const unconfirmed=doc.intake?.phase!=='confirmed'?doc.intake:undefined;
 if(forReselection){
  const authorization=authorizeProductionCommand('open-reselection',{
   version:current?'current':'superseded',control:row.generation_control??'active',continuation:!!doc.dag?.continuation,
   targetCurrent:true,targetReady:!unconfirmed||!!unconfirmed.selected,stopping:false,
  });
  if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
 }else{
  if(!current)throw new ReaderError(409,'这是草稿或旧版本，请打开书架当前版本。');
  if(unconfirmed)throw new ReaderError(409,'请在制作确认前保存设置草稿。');
 }
 if(!forReselection&&!doc.plan&&row.generation_control!=='paused'&&row.generation_control!=='stopped')throw new ReaderError(409,'请先暂停生成，再修改制作内容。');
 const rootId=doc.revision?.rootId||row.id;
 const epoch=(await repo.db.prepare(familyEpoch).bind(row.user_id,rootId,rootId).first<{epoch:number}>())!.epoch;
 const token=revisionToken(row,doc,epoch);
 return {doc,rootId,epoch,token,intakeGeneration:unconfirmed?.generation};
}
export async function revisionSnapshot(repo:ReaderRepository,id:string,ownerId:string):Promise<RevisionSnapshot>{
 const row=await repo.get(id,ownerId),{doc,epoch,token}=await revisionBasis(repo,row);
 const selection=selectionSchema.parse(JSON.parse(row.selection));
 const progress=dagProgress(doc,selection);
 const issues=doc.dag?reviewAttention({id,doc,selection,dag:doc.dag,confirmed:!doc.intake||doc.intake.phase==='confirmed',faults:[]}).issues:
  canEditReviewNotes(row,doc)?doc.visualReview!.issues:[];
 const editable=!!doc.plan&&(doc.dag?issues.length>0:canEditReviewNotes(row,doc));
 return {selection,plan:doc.plan,images:doc.images,savedFrameCount:savedFrameCount(doc),...(doc.frameRecommendation?{frameRecommendation:doc.frameRecommendation}:{}),token,epoch,
  reviewStatus:doc.dag?progress?.review.reviewStatus:doc.visualReview?.status,reviewNotes:doc.reviewNotes,...(editable?{canEditReviewNotes:true,priorReviewIssues:issues}:{}),
  ...(doc.revision?{revision:{parentId:doc.revision.parentId,rootId:doc.revision.rootId,number:doc.revision.number}}:{})};
}
export async function forkRevision(repo:ReaderRepository,media:MediaStore,ownerId:string,parentId:string,requestId:string,token:string,changes:RevisionChanges,paused=false,cover?:Uint8Array,startRedraw=false){
 // Preserve fingerprints of requests saved before explicit paused submissions were added.
 const coverHash=cover?hash(cover):undefined;
 const requestHash=hash(JSON.stringify([parentId,token,changes,...(paused?[true]:[]),...(coverHash?[{cover:coverHash}]:[]),...(startRedraw?[{startRedraw}]:[])]));
 const replay=async()=>{
  const existing=await repo.db.prepare('SELECT * FROM stories WHERE id=?').bind(requestId).first<SessionRow>();
  if(!existing)return null;
  const revision=(JSON.parse(existing.document) as Document).revision;
  if(existing.user_id!==ownerId||revision?.parentId!==parentId||revision.requestHash!==requestHash)throw new ReaderError(409,'这个提交编号已用于其他修改，请重新打开编辑。');
  return repo.get(requestId,ownerId);
 };
 const existing=await replay();if(existing)return existing;
 const receipt=await commandReceipt(repo.db,ownerId,requestId);
 if(receipt){
  if(receipt.action==='revision-noop'&&receipt.session_id===parentId&&receipt.fingerprint===requestHash)return repo.get(parentId,ownerId);
  throw new ReaderError(409,'这个操作编号已用于其他内容。');
 }
 const row=await repo.get(parentId,ownerId);
 // 全部故事都由制作 DAG 推导失效范围；尚未进入 DAG 的故事（准备中）没有可修订的内容。
 if(!(JSON.parse(row.document) as Document).dag)throw new ReaderError(409,'这篇故事还没有进入制作，请稍后再修改。');
 return forkDagRevision(repo,media,ownerId,row,requestId,token,changes,paused,requestHash,cover,startRedraw);
}
