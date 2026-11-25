// Fork edits into new sessions. Copy immutable media before one CAS publishes the child;
// family epochs serialize competing drafts without altering originals. Only content a draft was
// written against can conflict with it: saved images and progress never do. A file that is gone
// cannot be reused and is redrawn; one that cannot be read right now stops the submission.
// Image-only redraws require a completed story and preserve review and all unselected artwork.
// Style-only revisions inherit review checkpoints, including unresolved or overridden reviews.
import {decodeDocument} from '../lib/production-dag/document.ts';
import {createHash} from 'node:crypto';
import {ReaderError,selectionSchema} from '../lib/reader-model.ts';
import type {Document,Selection,SessionRow} from '../lib/reader-model.ts';
import type {ReaderRepository} from '../lib/reader-repository.ts';
import {familyRoot,familyNumber,supersededSql} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {RevisionChanges,RevisionSnapshot} from '../lib/reader-revision.ts';
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
export function revisionAvailability(row:SessionRow,doc:Document){
 const unconfirmed=doc.intake?.phase!=='confirmed'?doc.intake:undefined;
 const control=row.generation_control??'active';
 return {control,unconfirmed,open:!doc.reselection&&(!unconfirmed||!!unconfirmed.selected),
  edit:!doc.reselection&&!doc.dag?.repreparing&&!unconfirmed&&(!!doc.plan||control!=='active')};
}
/** known 是调用方已按同一稿件推导出的审片状态，可省去再次推导。 */
export function copyAvailability(saved:Document,selection:Selection,busy:boolean,known?:{reviewStatus?:string|null;reviewOverridden?:unknown}){
 const review=known??(saved.dag?dagProgress(saved,selection)?.review:undefined);
 const reviewed=review?.reviewStatus==='passed'&&!review.reviewOverridden;
 const draft=!!saved.dag&&typeof saved.original?.text==='string'&&!!saved.original.text.trim();
 const current=!busy&&!!saved.plan&&!!saved.original&&(!saved.intake||saved.intake.phase==='confirmed')&&!saved.reselection&&!saved.dag?.repreparing;
 return {current,reviewed,draft};
}
export async function revisionBasis(repo:ReaderRepository,row:SessionRow,forReselection=false){
 const doc=decodeDocument(row);
 if(!forReselection&&doc.dag?.repreparing)throw new ReaderError(409,'这篇故事正在重新准备，请等新的制作建议保存后再修改。');
 const current=!doc.reselection&&!await repo.superseded(row.id,row.user_id);
 const {unconfirmed,control,open,edit}=revisionAvailability(row,doc);
 const authorization=authorizeProductionCommand(forReselection?'open-reselection':'edit-revision',{
  version:current?'current':'superseded',control,continuation:!!doc.dag?.continuation,
  targetCurrent:forReselection||!unconfirmed,
  targetReady:forReselection?open:edit,stopping:false,
 });
 if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
 const rootId=doc.revision?.rootId||row.id;
 const epoch=(await repo.db.prepare(familyEpoch).bind(row.user_id,rootId,rootId).first<{epoch:number}>())!.epoch;
 const token=revisionToken(row,doc,epoch);
 return {doc,rootId,epoch,token,intakeGeneration:unconfirmed?.generation};
}
export async function revisionSnapshot(repo:ReaderRepository,id:string,ownerId:string):Promise<RevisionSnapshot>{
 const row=await repo.get(id,ownerId),{doc,epoch,token}=await revisionBasis(repo,row);
 const selection=selectionSchema.parse(JSON.parse(row.selection));
 const progress=dagProgress(doc,selection);
 const issues=doc.dag?reviewAttention({id,doc,selection,dag:doc.dag,confirmed:!doc.intake||doc.intake.phase==='confirmed',faults:[]}).issues:[];
 const editable=!!doc.plan&&!!doc.dag;
 return {selection,plan:doc.plan,images:doc.images,savedFrameCount:savedFrameCount(doc),...(doc.frameRecommendation?{frameRecommendation:doc.frameRecommendation}:{}),token,epoch,
  reviewStatus:progress?.review.reviewStatus,reviewNotes:doc.reviewNotes,...(editable?{canEditReviewNotes:true,priorReviewIssues:issues}:{}),
  ...(doc.revision?{revision:{parentId:doc.revision.parentId,rootId:doc.revision.rootId,number:doc.revision.number}}:{})};
}
export async function forkRevision(repo:ReaderRepository,media:MediaStore,ownerId:string,parentId:string,requestId:string,token:string,changes:RevisionChanges,paused=false,cover?:Uint8Array,startRedraw=false){
 // Preserve fingerprints of requests saved before explicit paused submissions were added.
 const coverHash=cover?hash(cover):undefined;
 const requestHash=hash(JSON.stringify([parentId,token,changes,...(paused?[true]:[]),...(coverHash?[{cover:coverHash}]:[]),...(startRedraw?[{startRedraw}]:[])]));
 const replay=async()=>{
  const existing=await repo.db.prepare('SELECT * FROM story_rows stories WHERE id=?').bind(requestId).first<SessionRow>();
  if(!existing)return null;
  const revision=(decodeDocument(existing)).revision;
  if(existing.user_id!==ownerId||revision?.parentId!==parentId||revision.requestHash!==requestHash)throw new ReaderError(409,'这个提交编号已用于其他修改，请重新打开编辑。');
  return repo.get(requestId,ownerId);
 };
 const findAccepted=async()=>{
  const existing=await replay();if(existing)return existing;
  const receipt=await repo.db.prepare('SELECT action,session_id,fingerprint FROM reader_commands WHERE owner_id=? AND request_id=?')
   .bind(ownerId,requestId).first<{action:string;session_id:string;fingerprint:string}>();
  if(!receipt)return null;
  if(receipt.action==='revision-noop'&&receipt.session_id===parentId&&receipt.fingerprint===requestHash)return repo.get(parentId,ownerId);
  throw new ReaderError(409,'这个操作编号已用于其他内容。');
 };
 const accepted=await findAccepted();if(accepted)return accepted;
 const row=await repo.get(parentId,ownerId);
 try{return await forkDagRevision(repo,media,ownerId,row,requestId,token,changes,paused,requestHash,cover,startRedraw);}
 catch(error){
  if(error instanceof ReaderError&&error.status===409){
   const accepted=await findAccepted();if(accepted)return accepted;
  }
  throw error;
 }
}
