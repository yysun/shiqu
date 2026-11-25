// 协调器的制作 DAG 路径：由执行层决定选题后的准备与制作工作，旧文档由 adopt() 接管。
// 调度：settle() 的免调用步骤先保存；work() 的每项工作成为一个任务，身份由调用、阶段与各实例派发时的硬输入决定，
// 不再需要的排队任务删除。执行：调用前后各核对一次输入，结果用 apply() 写回，并以文档内容做比较并交换保存，
// 冲突时按最新文档重算，输入已变的结果丢弃。完成判定用 finished()。「已保存，等待继续」期间不派发任何工作。
import {authorizeProductionCommand,resolveImageRead} from '../lib/production-lifecycle.ts';
import {ReaderError,selectionSchema,type Document,type Selection,type SessionRow} from '../lib/reader-model.ts';
import type {Database,ReadStatements,SyncStatements} from '../lib/reader-repository.ts';
import {supersededSql} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {storePromptRecord} from '../lib/reader-prompt-store.ts';
import {lostImageMessage,readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {imageTypes,mediaType} from '../lib/reader-generation-contract.ts';
import {readableImage,readableLandscapeImage,readableSavedPortrait} from './reader-image-health.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {landscapeSourceReady,projectDocument,emptyDag,type DagDocument} from '../lib/production-dag/document.ts';
import {convertDocument} from '../lib/production-dag/convert.ts';
import {errorCode} from '../lib/production-dag/errors.ts';
import {productionTimingScope} from '../lib/production-timing.ts';
import {preparationCandidate,preparationOriginal,preparationPending,preparationResult} from '../lib/reader-preparation.ts';
import type {FrameRecommendation} from '../lib/reader-frame-recommendation.ts';
import type {ArtRecommendation} from '../lib/reader-art-recommendation.ts';
import type {OriginalSource} from '../lib/reader-source-types.ts';
import {settle,work,apply,stale,finished,requestFor,drawInput,deriveProduction,stateOf,overrideReview,type Attention,type DagStory,type Work} from '../lib/production-dag/runner.ts';
import {evaluate,instanceId,type Evaluation} from '../lib/production-dag/engine.ts';
import type {Fault} from '../lib/production-dag/engine.ts';
import {nodeSpec} from '../lib/production-dag/registry.ts';
import {executeWork} from './dag-executor.ts';
import {BookImageReferences,drawingReferenceBinding} from './book-image-reference.ts';
import type {ProductionJob,ProductionQueue,JobSpec} from './production-queue.ts';
import type {ModelSnapshot} from '../lib/production-dag/document.ts';
import type {LandscapeStatus} from '../lib/reader-production.ts';
import {persistenceError} from '../lib/reader-repository.ts';
import {JobYield,inputVersion} from './production-queue.ts';
import {createHash,randomUUID} from 'node:crypto';
import {preserveLegacyLandscapeControl,authorizeRecovery,carriedJobFaultGroup,commandFingerprint,type CommandReceipt,type ReaderFault} from './reader-commands.ts';
import {transact,deleteJobs} from './production-records.ts';
import {reviewAttention} from '../lib/production-dag/progress.ts';
import {grantRepairs,newRepairBudget} from '../lib/production-dag/review.ts';
import {createReviewSkip} from '../lib/production-dag/review-skip.ts';
import type {RecoveryRequest,ReviewOverride} from '../lib/reader-recovery.ts';
import {reconcileImageFaults} from './dag-image-faults.ts';
import {carriedJobFaultState,isCarriedReviewFault,reconcileCarriedJobFaults,unexecutedLandscapeRecovery} from './dag-revision-faults.ts';
import {bindLegacyLandscapeRequests} from './dag-revisions.ts';
import {PaidDispatchDenied} from './paid-dispatch.ts';

export const dagTextKind='dag',dagDrawKind='dag-draw';
type Deps={portraitOnly?:boolean;database:Database;media:MediaStore;queue:ProductionQueue;clock:()=>number;wake:()=>void;snapshot?:()=>ModelSnapshot|undefined;fileLost:(key:string,strict?:boolean,landscape?:boolean)=>Promise<boolean>};
type Paid={value:unknown;model:string;requestId:string|null;usage:unknown;entry?:Document['usage'][number];usageRecorded?:boolean};
/** 阅读中的故事优先。每篇仍按幅序绘图。 */
export const viewedPriority=(page:number,opened:boolean)=>opened?page-100:page;
type FaultTarget={id:string;node:string|null;node_key:string;optional:number;kind:string|null;faultKind:string;state:string;payload:string|null};
const pendingFaultTargets=`SELECT f.id,f.node,f.node_key,f.optional,f.kind AS faultKind,f.state,j.kind,j.payload FROM reader_faults f
 LEFT JOIN production_jobs j ON j.id=f.job_id AND j.session_id=f.session_id AND j.owner_id=f.owner_id
 WHERE f.session_id=? AND f.owner_id=? AND (f.state IN ('pending','awaiting-match') OR ${unexecutedLandscapeRecovery})`;
function dagFaultTargets(rows:FaultTarget[],dag:DagDocument):Fault[]{
 return rows.flatMap<Fault>(f=>{
  if(f.payload&&(f.kind===dagTextKind||f.kind===dagDrawKind)){
   const {work:item,landscapeAttempt}=JSON.parse(f.payload) as {work:Work;landscapeAttempt?:number};
   if(item.call==='drawLandscape'&&dag.frames[item.instances[0].key]?.landscapeAttempt!==landscapeAttempt)return [];
   return item.instances.map(i=>({id:f.id,node:i.node,key:i.key,state:'pending' as const}));
  }
  return f.node?[{id:f.id,node:f.node,key:f.node_key,state:f.state==='awaiting-match'?'awaiting-match':'pending',...(f.optional?{optional:true}:{}),...(f.faultKind==='image-loss'?{imageLoss:true}:{})}]:[];
 });
}
const preparingCall=(call:string)=>call==='prepareArt'||call==='prepareSuggestions';
const drawing=(call:string)=>call==='draw'||call==='drawLandscape';
const visible="NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id)";

export const hasDag=(row:SessionRow)=>{try{return !!(JSON.parse(row.document) as Document).dag;}catch{return false;}};
export const canReprepare=(doc:Document)=>!!doc.dag&&!!doc.original&&!doc.reselection&&
 (!doc.intake||doc.intake.phase==='confirmed')&&!doc.dag.repreparing;

type LandscapeFault=Pick<ReaderFault,'node'|'node_key'|'state'|'message'|'origin_fault_id'|'job_id'>;
export function landscapeFrames(dag:DagDocument,evaluation:Evaluation,jobs:readonly Pick<ProductionJob,'kind'|'state'|'payload'|'error'>[],lost:ReadonlySet<string>=new Set(),faults:readonly LandscapeFault[]=[]){
 const requested=new Set(evaluation.state.landscapes);
 const busy=new Set<string>(),failed=new Map<string,string>();
 for(const job of jobs){
  if(job.kind!==dagDrawKind||!['queued','running','failed'].includes(job.state))continue;
  const {work,landscapeAttempt}=JSON.parse(job.payload) as {work:Work;landscapeAttempt?:number};
  if(work.call!=='drawLandscape')continue;
  for(const {key} of work.instances){
   if(!requested.has(key)||dag.frames[key]?.landscapeAttempt!==landscapeAttempt)continue;
   if(job.state==='failed')failed.set(key,job.error||'横图绘制失败，请重试本幅。');
   else busy.add(key);
  }
 }
 for(const fault of faults)if(fault.node==='landscape'&&fault.state==='pending'&&!fault.job_id&&fault.origin_fault_id){
  busy.delete(fault.node_key);
  failed.set(fault.node_key,fault.message);
 }
 return dag.order.map(key=>{
  const frame=dag.frames[key];
  if(frame.landscape?evaluation.instance('landscape',key).status!=='valid':!requested.has(key))
   return {...frame,landscape:undefined,landscapeError:undefined};
  if(lost.has(key))return {...frame,landscape:'',landscapeError:'横图文件已丢失或损坏，请重试本幅。'};
  if(frame.landscape===''&&!frame.landscapeError&&!busy.has(key)&&failed.has(key))return {...frame,landscapeError:failed.get(key)};
  return frame;
 });
}

export function retryableLandscapePages(dag:DagDocument,evaluation:Evaluation,frames:ReturnType<typeof landscapeFrames>){
 return frames.flatMap((frame,index)=>frame.landscapeError&&evaluation.instance('landscape',dag.order[index]).hard?[index+1]:[]);
}

const drawingAncestors=`WITH RECURSIVE ancestors(id) AS (
 SELECT CASE WHEN json_valid(document) THEN json_extract(document,'$.revision.parentId') END FROM stories WHERE id=? AND user_id=?
 UNION SELECT CASE WHEN json_valid(s.document) THEN json_extract(s.document,'$.revision.parentId') END
 FROM ancestors a JOIN stories s ON s.id=a.id AND s.user_id=?
)`;
type DrawingRow=Pick<ProductionJob,'session_id'|'payload'>;

/** 原故障绑定的回执必须匹配当前绘图硬输入；提交时再检查实际文件。 */
function boundDrawingReceipt(original:DrawingRow|undefined,call:'draw'|'drawLandscape',frame:string,inputHash?:string){
 if(!original)return null;
 let payload:{work?:Work;paid?:Paid}|null;
 try{payload=JSON.parse(original.payload);}catch{return null;}
 const {work:item,paid}=payload??{};
 const target=item?.instances?.[0];
 if(item?.call!==call||target?.node!==(call==='draw'?'frameImage':'landscape')||!target.hard||
  (inputHash===undefined?target.key!==frame:fingerprint(target.hard)!==inputHash)||typeof paid?.value!=='string')return null;
 const key=referenceImageKey(original.session_id,paid.value);
 return key?{sessionId:original.session_id,key,item:{...item,instances:[{...target,key:frame,id:instanceId(target.node,frame)}]},paid}:null;
}

function ancestorPortraitReceipt(db:ReadStatements,row:SessionRow,origin:string,frame:string,hash:string){
 const original=db.get<DrawingRow>(`${drawingAncestors}
  SELECT j.session_id,j.payload FROM reader_faults f
  JOIN production_jobs j ON j.id=f.job_id AND j.session_id=f.session_id AND j.owner_id=f.owner_id
  WHERE f.id=? AND f.owner_id=? AND f.session_id IN (SELECT id FROM ancestors) AND j.kind=?`,
  row.id,row.user_id,row.user_id,origin,row.user_id,dagDrawKind);
 return boundDrawingReceipt(original,'draw',frame,hash);
}

export function portraitRecoveryReceipt(db:ReadStatements,row:SessionRow,fault:ReaderFault){
 if(fault.state!=='pending'||fault.node!=='frameImage')return null;
 if(fault.job_id){
  const job=db.get<DrawingRow>(`SELECT session_id,payload FROM production_jobs WHERE id=? AND session_id=? AND owner_id=? AND kind=?
   AND state='failed' AND failure_id=? AND json_extract(payload,'$.setupGeneration') IS json_extract(?,'$.intake.generation')`,
   fault.job_id,row.id,row.user_id,dagDrawKind,fault.id,row.document);
  return boundDrawingReceipt(job,'draw',fault.node_key);
 }
 const origin=carriedJobFaultGroup(fault);
 return origin&&fault.input_hash?ancestorPortraitReceipt(db,row,origin,fault.node_key,fault.input_hash):null;
}

export class DagProduction{
 private readonly deps:Deps;
 constructor(deps:Deps){this.deps=deps;}

 private async row(id:string,ownerId:string){return this.deps.database.prepare('SELECT * FROM stories WHERE id=? AND user_id=?').bind(id,ownerId).first<SessionRow>();}

 async story(row:SessionRow,referenceMode:'resolve'|'for-drawing'|'skip'='resolve'):Promise<DagStory|null>{
  const doc=JSON.parse(row.document) as Document;
  if(!doc.dag)return null;
  const selection=selectionSchema.parse(JSON.parse(row.selection));
  const refSource=referenceMode==='skip'?'':await new BookImageReferences(this.deps.database,this.deps.media,row.user_id).resolve(row.id,'').catch(error=>{
   if(referenceMode==='for-drawing'&&error instanceof PaidDispatchDenied)throw error;
   return '';
  });
  const story={id:row.id,doc,selection,dag:doc.dag,confirmed:!doc.intake||doc.intake.phase==='confirmed',
   faults:await this.faults(row,doc.dag),...(refSource?{refSource}:{})};
  if(!doc.revision)return story;
  const bind=(db:ReadStatements)=>bindLegacyLandscapeRequests(db,row.user_id,story);
  return this.deps.database.readTransaction?.(bind)??transact(this.deps.database,bind);
 }

 /**
  * 待处理的故障按节点实例阻断：DAG 任务的故障按任务记录的工作逐个归属（批量工作覆盖多个实例），
  * 没有任务的故障（图片丢失、转换的旧故障）按记录的节点与键。可选产物的故障不阻断完成。
  * 恢复中的故障不阻断：读者授权的恢复任务与同输入的新工作身份相同，不会重复派发。
  */
 private async faults(row:SessionRow,dag:DagDocument):Promise<Fault[]>{
  const rows=(await this.deps.database.prepare(pendingFaultTargets).bind(row.id,row.user_id).all<FaultTarget>()).results;
  return dagFaultTargets(rows,dag);
 }

 /** 从快照推导完成和审片阻断，避免分别读取故障或访问图片文件。 */
 lifecycleFrom(row:SessionRow,faults:ReaderFault[],jobs:ProductionJob[]){
  const doc=JSON.parse(row.document) as Document,dag=doc.dag;
  if(!dag)return {complete:undefined,blocking:null,review:null};
  const byId=new Map(jobs.map(job=>[job.id,job]));
  const targets=faults.filter(fault=>fault.state==='pending'||fault.state==='recovering'||fault.state==='awaiting-match').map(fault=>{
   const job=fault.job_id?byId.get(fault.job_id):undefined;
   return {...fault,faultKind:fault.kind,kind:job?.kind??null,payload:job?.payload??null};
  });
  const confirmed=!doc.intake||doc.intake.phase==='confirmed';
  const story:DagStory={id:row.id,doc,dag,selection:selectionSchema.parse(JSON.parse(row.selection)),confirmed,faults:dagFaultTargets(targets,dag)};
  const recovering=targets.some(target=>target.state==='recovering');
  const reviewing=recovering?{...story,faults:dagFaultTargets(targets.filter(target=>target.state!=='recovering'),dag)}:story;
  const derived=deriveProduction(reviewing),complete=confirmed&&(recovering?finished(story):derived.complete);
  const blocking=complete||derived.work.some(item=>!drawing(item.call))?null:this.reviewBlock(reviewing,derived.attention);
  const review=derived.evaluation.approved()?'approved':blocking?.reasons.length?'attention':'pending';
  return {complete,blocking:blocking?{...blocking,canOverride:!!blocking.id&&!!overrideReview(reviewing,blocking.targets)}:null,review} as const;
 }

 /** 在领取事务中按当前硬输入和故障复核；参考图的文件可用性在发送前核对。 */
 dispatchInputs(db:SyncStatements,row:SessionRow,job:ProductionJob){
  const doc=JSON.parse(row.document) as Document,dag=doc.dag;
  if(!dag)return {inputCurrent:false,fault:false};
  const {work:item,landscapeAttempt}=JSON.parse(job.payload) as {work:Work;landscapeAttempt?:number};
  if(dag.repreparing&&item.call!=='drawLandscape'&&item.call!=='prepareSuggestions')return {inputCurrent:true,fault:true};
  const story=bindLegacyLandscapeRequests(db,row.user_id,{id:row.id,doc,dag,selection:selectionSchema.parse(JSON.parse(row.selection)),
   confirmed:!doc.intake||doc.intake.phase==='confirmed',faults:[]});
  if(item.call==='draw'){
   const reference=drawingReferenceBinding(db,row.user_id,row.id,true);
   if(reference)story.refSource=reference;
   reconcileImageFaults(db,row.user_id,story,this.deps.clock());
  }
  if(doc.revision)reconcileCarriedJobFaults(db,row.user_id,story,this.deps.clock());
  story.faults=dagFaultTargets(db.all<FaultTarget>(pendingFaultTargets,row.id,row.user_id),dag);
  const evaluation=evaluate(stateOf(story));
  const key=item.instances[0]?.key;
  if(item.call==='drawLandscape'&&(!evaluation.state.landscapes?.includes(key)||dag.frames[key]?.landscapeAttempt!==landscapeAttempt))
   return {inputCurrent:false,fault:false};
  if(drawing(item.call)){
   const reusable=evaluate(stateOf({...story,dag:settle(story)}));
   if(item.instances.every(instance=>reusable.instance(instance.node,instance.key).status==='valid'))return {inputCurrent:false,fault:false};
  }
  const fault=item.instances.some(instance=>evaluation.instance(instance.node,instance.key).blocked||
   !evaluation.gateOpen(nodeSpec(instance.node).gate));
  return {inputCurrent:!stale(story,item),fault};
 }

 /** 保存新的 dag 与投影：以读取时的文档为条件，冲突返回 false。 */
 private async save(row:SessionRow,story:DagStory,dag:DagDocument,options:{
  usage?:Document['usage'][number];retainDeleted?:boolean;selection?:Selection;job?:ProductionJob;landscape?:{resetFrames:string[]};
 }={}){
  const {usage,retainDeleted,selection,job,landscape}=options;
  const optional=!!landscape||job&&JSON.parse(job.payload).work?.call==='drawLandscape';
  const doc:Document={...story.doc,dag,...(optional?{}:projectDocument(dag,story.doc.plan)),...(usage?{usage:[...(story.doc.usage||[]),usage]}:{})};
  const revision=doc.revision,redrawFrame=revision?.redrawFrame&&dag.frames[revision.redrawFrame];
  if(revision?.landscapeRedraw&&revision.redrawFrame&&(!redrawFrame||redrawFrame.landscape!==''||redrawFrame.landscapeError)){
   doc.revision={...revision};delete doc.revision.landscapeRedraw;
  }
  const done=!optional&&finished({...story,dag});
  const reordered=story.dag.order.length!==dag.order.length||story.dag.order.some((frame,index)=>frame!==dag.order[index]);
  // 用正在阅读的画幅身份计算位置；读取进度更新与制作写入可以并发。
  const positions=reordered?JSON.stringify(story.dag.order.map(frame=>{const index=dag.order.indexOf(frame);return index<0?null:index;})):null;
  const sql=`UPDATE stories SET document=?,state=CASE WHEN ?=1 AND state='idle' THEN 'completed' ELSE state END,updated_at=?${selection?',selection=?':''}${reordered?",page=COALESCE(json_extract(?,'$['||max(0,page)||']'),max(0,min(page,?)))":''}
   WHERE id=? AND user_id=? AND document=?${selection?' AND selection=?':''}${retainDeleted?'':` AND ${visible}`}
   ${job?" AND EXISTS(SELECT 1 FROM production_jobs WHERE id=? AND state='running' AND lease_token IS ?)":''}`;
  const params=[JSON.stringify(doc),done?1:0,new Date(this.deps.clock()).toISOString(),...(selection?[JSON.stringify(selection)]:[]),
   ...(reordered?[positions,Math.max(0,dag.order.length-1)]:[]),row.id,row.user_id,row.document,...(selection?[row.selection]:[]),...(job?[job.id,job.lease_token??null]:[])];
  if(landscape)return transact(this.deps.database,db=>{
   if(!db.run(`${sql} AND NOT ${supersededSql()}`,...params).changes)return false;
   const keys=JSON.stringify(landscape.resetFrames);
   const published=landscape.resetFrames.flatMap(key=>story.dag.frames[key].landscape?[{key,url:story.dag.frames[key].landscape}]:[]);
   // 旧任务可能丢失完成回执。清除画幅原图前，把已发布原图的记账状态保存到同一回执。
   if(published.length)db.run(`UPDATE production_jobs SET payload=json_set(payload,'$.paid.usageRecorded',json('true'))
    WHERE session_id=? AND owner_id=? AND kind=? AND state IN ('failed','succeeded') AND json_extract(payload,'$.work.call')='drawLandscape'
    AND EXISTS(SELECT 1 FROM json_each(?) frame WHERE json_extract(frame.value,'$.key')=json_extract(payload,'$.work.instances[0].key')
     AND json_extract(frame.value,'$.url')=json_extract(payload,'$.paid.value'))`,row.id,row.user_id,dagDrawKind,JSON.stringify(published));
   const now=this.deps.clock();
   db.run(`UPDATE reader_faults AS f SET state='replaced',updated_at=? WHERE session_id=? AND owner_id=?
    AND node='landscape' AND node_key IN (SELECT value FROM json_each(?)) AND (state IN ('pending','recovering') OR ${unexecutedLandscapeRecovery})`,
    now,row.id,row.user_id,keys);
   // 旧排队任务的回执可以复用，但不能用旧授权领取或阻塞新任务。
   db.run(`UPDATE production_jobs SET state='succeeded',result=json_object('obsolete',1),error=NULL,updated_at=?
    WHERE session_id=? AND owner_id=? AND kind=? AND state='queued' AND json_extract(payload,'$.work.call')='drawLandscape'
    AND json_extract(payload,'$.work.instances[0].key') IN (SELECT value FROM json_each(?))`,now,row.id,row.user_id,dagDrawKind,keys);
   return true;
  });
  const saved=await this.deps.database.prepare(sql).bind(...params).run();
  return saved.meta.changes>0;
 }

 private spec(row:SessionRow,story:DagStory,item:Work,priority:number,opened=false):JobSpec{
  // 任务身份覆盖本次请求实际读取的全部输入（含来源与核对输入，如修订读取的当前配文与问题），
  // 因此同一产物在来源变化后再次修订会得到新任务；产物有效性仍只按硬输入判断。
  const preparation=(!story.confirmed||story.dag.repreparing)&&(item.call==='verifySource'||preparingCall(item.call));
  const {displayTitle:_,...selection}=story.selection;void _;
  const request=drawing(item.call)?drawInput(story,item):item.call==='verifySource'||preparingCall(item.call)?{selection,requirements:item.call==='prepareSuggestions'&&!!story.doc.intake&&!story.doc.setupRequirements?.suggestions}:requestFor(story,item);
  const landscapeAttempt=item.call==='drawLandscape'?story.dag.frames[item.instances[0].key]?.landscapeAttempt:undefined;
  const attempt=landscapeAttempt===undefined?{}:{landscapeAttempt};
  const preparationGeneration=story.dag.repreparing&&item.call==='prepareSuggestions'?story.dag.preparationGeneration:undefined;
  const id=fingerprint(['dag-job',row.id,story.doc.intake?.generation??null,item.call,item.stage??0,item.instances.map(i=>[i.id,i.hard??null]),request,
   ...(landscapeAttempt===undefined?[]:[landscapeAttempt]),...(preparationGeneration===undefined?[]:[{preparationGeneration}])]);
  const page=drawing(item.call)?story.dag.order.indexOf(item.instances[0].key):undefined;
  return {id,sessionId:row.id,ownerId:row.user_id,kind:drawing(item.call)?dagDrawKind:dagTextKind,pool:drawing(item.call)?'image':'text',version:'dag',dependencies:[],
   // 准备流程的世代与旧任务相同：选题或确认改变世代后，上一世代的任务不再算作当前任务。
   payload:{work:item,...attempt,...(preparationGeneration===undefined?{}:{preparationGeneration}),...(page!==undefined?{page}:{}),...(story.doc.intake?{setupGeneration:story.doc.intake.generation}:{}),timingStage:preparation?'count':drawing(item.call)?'image':item.call,...(preparation?{timingScope:productionTimingScope(story.selection,false)}:{})},priority:page===undefined?priority:viewedPriority(page,opened)};
 }

 /** 为一篇故事安排工作；返回 true 表示已由 DAG 路径处理。 */
 async schedule(row:SessionRow,opened=false):Promise<boolean>{
  const story=await this.story(row);if(!story)return false;
  const queued=(await this.deps.database.prepare(`SELECT id,payload FROM production_jobs WHERE session_id=? AND owner_id=? AND kind IN ('${dagTextKind}','${dagDrawKind}') AND state='queued'${this.deps.portraitOnly?" AND json_extract(payload,'$.work.call') IS NOT 'drawLandscape'":''}`).bind(row.id,row.user_id).all<{id:string;payload:string}>()).results;
  if(story.dag.continuation){await this.drop(queued.filter(job=>JSON.parse(job.payload).work?.call!=='drawLandscape').map(job=>job.id));return true;}
  // 升级转换的故事没有快照：首次安排时以当前设置补记（决策 7：转换的旧故事以转换时的设置作为快照）。
  if(story.confirmed&&!story.dag.modelSnapshot&&await this.recordSnapshot(row))return true;
  if(preparationPending(story.doc)&&story.doc.original&&!story.doc.original.storyBrief){
   story.doc.original=preparationOriginal(story.doc,story.selection,story.doc.original);
   await this.save(row,story,story.dag);this.deps.wake();return true;
  }
  const settled=settle(story);
  if(settled!==story.dag){await this.save(row,story,settled);this.deps.wake();return true;}
  const refreshed=transact(this.deps.database,db=>{
   const current=db.get<{document:string}>('SELECT document FROM stories WHERE id=? AND user_id=?',row.id,row.user_id);
   if(current?.document!==row.document)return null;
   reconcileImageFaults(db,row.user_id,story,this.deps.clock());
   if(story.doc.revision)reconcileCarriedJobFaults(db,row.user_id,story,this.deps.clock());
   return dagFaultTargets(db.all<FaultTarget>(pendingFaultTargets,row.id,row.user_id),story.dag);
  });
  if(!refreshed)return true;
  story.faults=refreshed;
  const derived=deriveProduction(story),items=derived.work.filter(item=>!this.deps.portraitOnly||item.call!=='drawLandscape');
  if(row.state==='idle'&&items.every(item=>item.call==='drawLandscape')&&derived.complete){
   await this.deps.database.prepare("UPDATE stories SET state='completed',error=NULL WHERE id=? AND user_id=? AND state='idle' AND document=?").bind(row.id,row.user_id,row.document).run();
  }
  // 正在执行的任务覆盖的实例不再派发新任务：其结果保存后若仍需重做，下一轮再安排。
  const running=new Set((await this.deps.database.prepare(`SELECT payload FROM production_jobs WHERE session_id=? AND owner_id=? AND kind IN ('${dagTextKind}','${dagDrawKind}') AND state='running'`).bind(row.id,row.user_id).all<{payload:string}>()).results
   .flatMap(j=>{
    const {work:item,landscapeAttempt}=JSON.parse(j.payload) as {work:Work;landscapeAttempt?:number};
    return item.instances.filter(i=>item.call!=='drawLandscape'||story.dag.frames[i.key]?.landscapeAttempt===landscapeAttempt).map(i=>i.id);
   }));
  const retained=new Set<string>();
  for(const job of queued){
   const {work:item,paid}=JSON.parse(job.payload) as {work:Work;paid?:Paid};
   if(!paid||!this.currentDrawingReceipt(story,item)||item.instances.some(instance=>running.has(instance.id)))continue;
   retained.add(job.id);
   for(const instance of item.instances)running.add(instance.id);
  }
  const specs=this.specs(row,story,items.filter(item=>!item.instances.some(i=>running.has(i.id))),opened);
  for(const spec of specs)await this.deps.queue.enqueue(spec);
  // 当前需要的工作与已完成的任务同身份（例如内容改回之前的输入）：重新排队；执行前的当前性核对避免重复付费。
  for(const spec of specs){
   const done=await this.deps.database.prepare("SELECT id FROM production_jobs WHERE id=? AND state='succeeded'").bind(spec.id).first();
   if(done)await this.deps.queue.rerun(spec.id);
  }
  const supersededQueue=queued.filter(job=>!story.dag.repreparing||(JSON.parse(job.payload) as {work:Work}).work.call==='prepareSuggestions');
  await this.drop(supersededQueue.map(j=>j.id).filter(id=>!retained.has(id)&&!specs.some(s=>s.id===id)));
  return true;
 }
 private specs(row:SessionRow,story:DagStory,items=work(story),opened=false){return items.map((item,i)=>this.spec(row,story,item,-10+i,opened));}
 private async drop(ids:string[]){const now=this.deps.clock();transact(this.deps.database,db=>{for(const id of ids)deleteJobs(db,"id=? AND state='queued'",[id],now);});}

 /** 已付费成图绑定硬输入。星标等核对输入变化时，仍须保存原已付费成果。 */
 private currentDrawingReceipt(story:DagStory,item:Work){
  if(!drawing(item.call)||stale(story,item))return false;
  const instance=item.instances[0],current=evaluate(stateOf(story)).instance(instance.node,instance.key);
  return current.status!=='valid'&&!current.blocked;
 }

 /** 核对回执的文件，跨版本采用时把原始字节复制到当前版本。 */
 private async readableDrawingReceipt(row:SessionRow,story:DagStory,source:NonNullable<ReturnType<typeof boundDrawingReceipt>>){
  const {sessionId,key,item,paid}=source;
  const landscape=item.call==='drawLandscape',target=item.instances[0];
  if(!this.currentDrawingReceipt(story,item))return null;
  const verify=async()=>{
   if(sessionId===row.id){
    if(await this.deps.fileLost(key,true,landscape))return null;
    return paid.value;
   }
   const page=story.dag.order.indexOf(target.key),asset=await this.deps.media.get(key);
   if(page<0||!asset)return null;
   const bytes=new Uint8Array(await asset.arrayBuffer()),type=mediaType(bytes);
   if(!type||type!==asset.contentType||!await (landscape?readableLandscapeImage(bytes):readableImage(bytes)))return null;
   const saved=readerImageAsset(row.id,page,imageTypes[type],createHash('sha256').update(bytes).digest('hex'));
   await this.deps.media.put(saved.key,bytes,{contentType:type});
   return saved.url;
  };
  const value=await verify().catch(()=>{throw new JobYield('image-availability');});
  if(!value)return null;
  const entry=paid.entry&&sessionId!==row.id?{...paid.entry,originId:paid.entry.originId??sessionId}:paid.entry;
  return {receipt:{...paid,value,entry},item};
 }

 private async copyCarriedDrawing(row:SessionRow,story:DagStory,origin:string,frame:string,inputHash:string){
  const read=(db:ReadStatements)=>ancestorPortraitReceipt(db,row,origin,frame,inputHash);
  const source=this.deps.database.readTransaction?this.deps.database.readTransaction(read):transact(this.deps.database,read);
  return source?this.readableDrawingReceipt(row,story,source):null;
 }

 /** 重试时优先本地采用图片；若当时确实丢失，已授权的任务执行前仍会重查同一回执。 */
 async restorePortraitDrawing(row:SessionRow,fault:ReaderFault,command:RecoveryRequest){
  const read=(db:ReadStatements)=>portraitRecoveryReceipt(db,row,fault);
  const source=this.deps.database.readTransaction?this.deps.database.readTransaction(read):transact(this.deps.database,read);
  if(!source)return null;
  const story=await this.story(row,'skip');
  if(!story)return null;
  const targets=fault.job_id?[fault]:(await this.deps.database.prepare(`SELECT id,node_key FROM reader_faults WHERE session_id=? AND owner_id=? AND origin_fault_id=?
   AND node='frameImage' AND input_hash=? AND kind='job' AND job_id IS NULL AND state='pending'`)
   .bind(row.id,row.user_id,carriedJobFaultGroup(fault),fault.input_hash).all<Pick<ReaderFault,'id'|'node_key'>>()).results;
  if(!targets.some(target=>target.id===fault.id))return null;
  const working={...story,faults:story.faults.filter(member=>!targets.some(target=>target.id===member.id))};
  const restored=await this.readableDrawingReceipt(row,working,source)
   .catch(error=>{
    if(error instanceof JobYield)throw new ReaderError(503,'已付费图片暂时无法读取，请重试核对。');
    throw error;
   });
  if(!restored)return null;
  const {receipt,item}=restored;
  let dag=story.dag;
  for(const {node_key:key} of targets){
   const target=item.instances[0],appliedWork={...item,instances:[{...target,key,id:instanceId(target.node,key)}]};
   const next=apply({...working,dag},appliedWork,receipt.value,{newId:randomUUID});
   if(!next)return null;
   dag=next;
  }
  const document={...story.doc,dag,...projectDocument(dag,story.doc.plan),
   usage:receipt.entry?[...story.doc.usage,receipt.entry]:story.doc.usage};
  const complete=finished({...working,doc:document,dag});
  const now=this.deps.clock();
  return authorizeRecovery(this.deps.database,{ownerId:row.user_id,sessionId:row.id,...command,jobs:[],resolutionJob:'',resolved:true,basis:row,
   applyResolved:db=>{
    if(fault.job_id&&!db.run(`UPDATE production_jobs SET state='succeeded',result=json_object('applied','draw'),error=NULL,error_code=NULL,interrupted=0,updated_at=?
     WHERE id=? AND owner_id=? AND session_id=? AND state='failed' AND failure_id=?`,now,fault.job_id,row.user_id,row.id,fault.id).changes)
     throw new ReaderError(409,'图片任务已更新，请刷新后重试。');
    if(!db.run("UPDATE stories SET document=?,updated_at=?,state=CASE WHEN ? THEN 'completed' ELSE state END,error=CASE WHEN ? THEN NULL ELSE error END WHERE id=? AND user_id=? AND document=?",
     JSON.stringify(document),new Date(now).toISOString(),Number(complete),Number(complete),row.id,row.user_id,row.document).changes)
     throw new ReaderError(409,'故事已更新，请刷新后重试恢复。');
   },
  },now);
 }

 private async authorizedCarriedDrawing(row:SessionRow,story:DagStory,item:Work){
  if(item.call!=='draw'||!story.doc.revision||!this.currentDrawingReceipt(story,item))return null;
  const target=item.instances[0],inputHash=fingerprint(target.hard);
  const origin=await this.deps.database.prepare(`SELECT f.origin_fault_id AS id FROM reader_faults f
   JOIN reader_commands c ON c.request_id=f.command_id AND c.session_id=f.session_id AND c.owner_id=f.owner_id
   WHERE f.session_id=? AND f.owner_id=? AND f.kind='job' AND f.job_id IS NULL AND f.state='resolved'
   AND f.node='frameImage' AND f.node_key=? AND f.input_hash=? AND f.origin_fault_id IS NOT NULL
   AND c.action='recover' AND c.status='succeeded' ORDER BY f.updated_at DESC,f.id LIMIT 1`)
   .bind(row.id,row.user_id,target.key,inputHash).first<{id:string}>();
  return origin?this.copyCarriedDrawing(row,story,origin.id,target.key,inputHash):null;
 }

 /** 横图重试保留旧任务，在新尝试派发前重新核对相同画幅的已付费回执。 */
 private async landscapeReceipts(row:SessionRow,key:string,hash:string){
  const rows=(await this.deps.database.prepare(`${drawingAncestors}
   SELECT j.session_id,payload,CASE WHEN json_valid(result) THEN json_extract(result,'$.applied') END AS applied,
    CASE WHEN json_valid(s.document) THEN json_extract(s.document,'$.dag.frames.'||json_quote(?)||'.landscape') END AS published
   FROM production_jobs j JOIN stories s ON s.id=j.session_id AND s.user_id=j.owner_id
   WHERE j.owner_id=? AND (j.session_id=? OR j.session_id IN (SELECT id FROM ancestors))
   AND kind=? AND j.state IN ('failed','succeeded') AND json_valid(payload)
   AND json_extract(payload,'$.work.call')='drawLandscape'
   AND json_extract(payload,'$.work.instances[0].key')=?
   AND json_type(payload,'$.paid.value')='text' ORDER BY j.created_at DESC,j.id DESC`)
   .bind(row.id,row.user_id,row.user_id,key,row.user_id,row.id,dagDrawKind,key).all<DrawingRow&{applied:string|null;published:string|null}>()).results;
  return rows.flatMap(rowReceipt=>{
   const source=boundDrawingReceipt(rowReceipt,'drawLandscape',key,hash);
   if(!source)return [];
   if(source.paid.usageRecorded||rowReceipt.applied==='drawLandscape'||rowReceipt.published===source.paid.value)source.paid.entry=undefined;
   return [source];
  });
 }

 async offersLocalLandscapeRetry(row:SessionRow,failed:number[]){
  const story=await this.story(row,'skip');
  if(!story||!failed.length)return false;
  const graph=evaluate(stateOf(story));
  for(const page of failed){
   const key=story.dag.order[page-1],hard=graph.instance('landscape',key).hard;
   if(!hard||!(await this.landscapeReceipts(row,key,fingerprint(hard))).length)return false;
  }
  return true;
 }

 private async landscapeRetryReceipt(row:SessionRow,story:DagStory,item:Work,attempt?:number){
  if(item.call!=='drawLandscape'||!attempt||!this.currentDrawingReceipt(story,item))return null;
  const target=item.instances[0];
  for(const source of await this.landscapeReceipts(row,target.key,fingerprint(target.hard))){
   const readable=await this.readableDrawingReceipt(row,story,source);
   if(readable)return readable;
  }
  return null;
 }

 private async storePaid(job:ProductionJob,receipt:Paid){
  await this.deps.database.prepare("UPDATE production_jobs SET payload=json_set(payload,'$.paid',json(?)) WHERE id=? AND lease_token IS ?")
   .bind(JSON.stringify(receipt),job.id,job.lease_token??null).run();
 }

 async run(job:ProductionJob,provider:ReaderProvider){
  const {work:item,paid,setupGeneration,preparationGeneration,landscapeAttempt}=JSON.parse(job.payload) as {work:Work;paid?:Paid;setupGeneration?:number;preparationGeneration?:number;landscapeAttempt?:number};
  const initial=await this.row(job.session_id,job.owner_id);
  const story=initial&&await this.story(initial,item.call==='draw'&&!paid?'for-drawing':'resolve');
  if(!initial||!story||story.doc.intake?.generation!==setupGeneration||
   preparationGeneration!==undefined&&story.dag.preparationGeneration!==preparationGeneration||story.dag.continuation&&item.call!=='drawLandscape'||stale(story,item))return {obsolete:true};
  if(item.call==='drawLandscape'&&!stateOf(story).landscapes?.includes(item.instances[0].key))return {obsolete:true};
  if(story.dag.repreparing&&item.call!=='drawLandscape'&&item.call!=='prepareSuggestions')throw new JobYield();
  const readablePaid=paid&&drawing(item.call)&&this.currentDrawingReceipt(story,item)&&!await this.paidFileLost(job,paid.value,item.call==='drawLandscape');
  // 尚未付费的任务必须仍属于当前请求。可读的已付费成图沿用派发时的参考图。
  if(!job.recovery_id&&!readablePaid&&!this.specs(initial,story).some(spec=>spec.id===job.id))return {obsolete:true};
  let generated:Awaited<ReturnType<typeof executeWork>>|undefined,usage:Document['usage'][number]|undefined;
  const reused=!readablePaid?(item.call==='drawLandscape'?await this.landscapeRetryReceipt(initial,story,item,landscapeAttempt):
   await this.authorizedCarriedDrawing(initial,story,item)):null;
  const receipt=reused?.receipt??(paid&&(!drawing(item.call)||readablePaid)?paid:undefined);
  if(reused)await this.storePaid(job,reused.receipt);
  if(receipt){
   generated={value:receipt.value,model:receipt.model,requestId:receipt.requestId,usage:receipt.usage};usage=receipt.entry;
  }
  if(!generated){
   if(item.call==='draw'&&!story.refSource){
    // 调度可先建立任务；付费绘制前若星标参考图不可读，将错误记录到该任务。
    const reference=await new BookImageReferences(this.deps.database,this.deps.media,initial.user_id).resolve(initial.id,'');
    if(reference)return {obsolete:true};
   }
   try{
    if(drawing(item.call)&&await this.checkLegacyDrawingReference(initial,story,item))return {obsolete:true};
    generated=await executeWork(provider.generator(),story,item,inputVersion([job.id,job.lease_token]));}
   catch(error){
    // 横图是可选产物：失败记在画幅上，不形成阻断完成的故障；读者可重试失败的幅。
    if(item.call!=='drawLandscape'||persistenceError(error)||error instanceof PaidDispatchDenied||error instanceof JobYield)throw error;
    const code=errorCode(error);
    if(code==='TIMEOUT'||code==='CONTENT_BLOCKED')throw error;
    await this.markLandscape(job,item.instances[0].key,error instanceof ReaderError?error.message:provider.safeError(error),landscapeAttempt);
    return {failed:true};
   }
   const promptRecordId=generated.promptRecord?await storePromptRecord(this.deps.database,generated.promptRecord):undefined;
   if(item.call!=='verifySource'&&item.call!=='prepareArt')usage={step:item.call==='prepareSuggestions'?'recommend':`dag:${item.call}`,model:generated.model,requestId:generated.requestId,usage:generated.usage,...(promptRecordId?{promptRecordId}:{}),...(generated.reasoningEffort?{reasoningEffort:generated.reasoningEffort}:{})};
   const entry:Paid={value:generated.value,model:generated.model,requestId:generated.requestId,usage:generated.usage,entry:usage};
   await this.storePaid(job,entry);
   if(drawing(item.call)){
    if(await this.paidFileLost(job,generated.value,item.call==='drawLandscape')){
     if(item.call==='drawLandscape'){await this.markLandscape(job,item.instances[0].key,'图片服务未返回可读取的 3∶2 横图，请重试本幅。',landscapeAttempt);return {failed:true};}
     throw new ReaderError(409,'图片服务未返回可读取的图片，请重试本幅。');
    }
   }
  }
  for(let attempt=0;attempt<5;attempt++){
   const row=await this.row(job.session_id,job.owner_id),current=row&&await this.story(row);
   if(!row||!current||current.doc.intake?.generation!==setupGeneration||
    preparationGeneration!==undefined&&current.dag.preparationGeneration!==preparationGeneration||current.dag.continuation&&item.call!=='drawLandscape')return {obsolete:true};
   if(item.call==='drawLandscape'&&current.dag.frames[item.instances[0].key]?.landscapeAttempt!==landscapeAttempt)return {obsolete:true};
   const next=apply(current,item,generated!.value,{newId:()=>`f-${randomUUID().slice(0,12)}`});
   if(!next)return {obsolete:true};
   // 已付费的结果即使故事已被删除也保存，恢复后不再重复付费。
   let selection:Selection|undefined;
   if(item.call==='verifySource')current.doc.original=generated!.value as OriginalSource;
   if(current.dag.repreparing&&item.call==='prepareSuggestions'){
    current.doc.frameRecommendation=generated!.value as FrameRecommendation;
    delete next.repreparing;
   }else if(preparingCall(item.call)){
    if(!preparationPending(current.doc))return {obsolete:true};
    selection=current.selection;
    if(item.call==='prepareSuggestions')preparationResult(current.doc,selection,generated!.value as FrameRecommendation);
    else{
     const candidate=preparationCandidate(current.doc),art=generated!.value as ArtRecommendation|null;
     if(candidate&&art&&!candidate.artRecommendation){
      candidate.artRecommendation=art;
      if(!current.doc.intake?.manualArt)selection.artStyle=art.artStyle;
     }
    }
   }
   const dag=selection?settle({...current,dag:next}):next;
   if(await this.save(row,current,dag,{usage,retainDeleted:true,selection,job})){this.deps.wake();return {applied:item.call};}
  }
  throw new ReaderError(503,'故事正在更新，结果暂未保存，请重试继续。');
 }

 /** 迁移只能同步核对文件结构。旧画幅作为参考前用正式解码器核对像素，损坏时登记在参考画幅上。 */
 private async checkLegacyDrawingReference(row:SessionRow,story:DagStory,item:Work){
  const input=drawInput(story,item);
  if(item.call==='drawLandscape'){
   const readable=await readableSavedPortrait(this.deps.media,row.id,input.reference).catch(()=>{throw new JobYield('image-availability');});
   if(!readable)throw new ReaderError(409,'本幅横图所需的竖图已丢失或损坏。');
   return false;
  }
  if(input.index===0||story.refSource)return false;
  const page=0,frame=story.dag.order[page];
  if(!story.dag.products[instanceId('frameImage',frame)]?.legacy)return false;
  const key=referenceImageKey(row.id,input.reference);if(!key)return false;
  let lost:boolean;
  try{lost=await this.deps.fileLost(key,true);}catch{throw new JobYield('image-availability');}
  if(!lost)return false;
  try{await this.checkImage(row,page,input.reference);}
  catch(error){if(!(error instanceof ReaderError&&error.status===409))throw error;}
  return true;
 }

 /** 已付费的绘图结果文件现在读不出：不再采用，须重新绘制。 */
 private async paidFileLost(job:ProductionJob,value:unknown,landscape=false){
  const key=typeof value==='string'?referenceImageKey(job.session_id,value):null;
  if(!key)return true;
  // 暂时读不出不等于文件丢失：不能因此再次付费绘制，改为稍后重试核对，已付费的结果保留在任务里。
  try{return await this.deps.fileLost(key,true,landscape);}
  catch{throw new JobYield('image-availability');}
 }

 /**
  * 横图失败记在原版画幅上。与成功结果一样，在任务租约内保存到已删除的故事，恢复删除后仍可重试本幅。
  * 无法保存时抛出，交由队列记录失败，避免任务显示成功而画幅停在未完成状态。
  */
 private async markLandscape(job:ProductionJob,key:string,message:string,landscapeAttempt?:number){
  for(let attempt=0;attempt<5;attempt++){
   const row=await this.row(job.session_id,job.owner_id),story=row&&await this.story(row);
   const frame=story?.dag.frames[key];
   if(!row||!story||frame?.landscape!==''||frame.landscapeAttempt!==landscapeAttempt)return;
   const dag=structuredClone(story.dag);dag.frames[key].landscapeError=message;
   if(await this.save(row,story,dag,{retainDeleted:true,job}))return;
   if(!await this.deps.database.prepare("SELECT 1 FROM production_jobs WHERE id=? AND state='running' AND lease_token IS ?").bind(job.id,job.lease_token??null).first())return;
  }
  throw new ReaderError(409,'横图失败未能保存，请重试本幅。');
 }

 /** 横图状态：由各画幅的横图、请求标记与失败说明得出；只对已完成的故事开放。 */
 /** 已保存的横图文件现在读不出（丢失或损坏）的画幅身份；读取暂时失败时不判为丢失。 */
 private async checkLandscapes(story:DagStory,evaluation:Evaluation,knownLosses?:ReadonlySet<string>){
  const lost=new Set<string>(),unavailable=new Set<string>();
  for(const id of story.dag.order){
   const url=story.dag.frames[id]?.landscape,key=url?referenceImageKey(story.id,url):null;
   if(!url||evaluation.instance('landscape',id).status!=='valid')continue;
   try{if(!key||await this.deps.fileLost(key,true,true))lost.add(id);}
   catch{(knownLosses?.has(id)?lost:unavailable).add(id);}
  }
  return {lost,unavailable};
 }

 async landscapeProjection(row:SessionRow,knownLosses?:ReadonlySet<string>){
  const story=(await this.story(row,'skip'))!,evaluation=evaluate(stateOf(story)),{lost,unavailable}=await this.checkLandscapes(story,evaluation,knownLosses);
  const jobs=(await this.deps.database.prepare("SELECT kind,state,payload,error FROM production_jobs WHERE session_id=? AND owner_id=? AND kind=? AND state IN ('queued','running','failed') AND json_extract(payload,'$.work.call')='drawLandscape' ORDER BY created_at,id").bind(row.id,row.user_id,dagDrawKind).all()).results as Pick<ProductionJob,'kind'|'state'|'payload'|'error'>[];
  const inherited=story.doc.revision?(await this.deps.database.prepare(`SELECT * FROM reader_faults f
   WHERE session_id=? AND owner_id=? AND node='landscape' AND (state='pending' OR ${unexecutedLandscapeRecovery}) AND job_id IS NULL AND origin_fault_id IS NOT NULL`)
   .bind(row.id,row.user_id).all<ReaderFault>()).results:[];
  const matched=inherited.filter(fault=>carriedJobFaultState(evaluation,fault)==='pending').map(fault=>({...fault,state:'pending' as const}));
  const frames=landscapeFrames(story.dag,evaluation,jobs,lost,matched);
  const images=frames.map((frame,page)=>unavailable.has(story.dag.order[page])?'':frame.landscape||''),failed=frames.flatMap((f,i)=>f.landscapeError?[i+1]:[]);
  const pending=frames.some(f=>f.landscape===''&&!f.landscapeError),ready=images.filter(Boolean).length,canStart=landscapeSourceReady(story.doc),available=canStart||frames.some(frame=>frame.landscape!==undefined);
  const missing=story.dag.order.filter((_,page)=>frames[page].landscape===undefined);
  const retryable:number[]=[];
  for(const page of retryableLandscapePages(story.dag,evaluation,frames)){
   const key=story.dag.order[page-1];
   let temporary=false;
   const reference=await readableSavedPortrait(this.deps.media,row.id,story.dag.frames[key].image||'').catch(()=>{temporary=true;return false;});
   if(reference){retryable.push(page);continue;}
   const receipts=await this.landscapeReceipts(row,key,fingerprint(evaluation.instance('landscape',key).hard!));
   let restored=false;
   for(const receipt of receipts){
    try{if(!await this.deps.fileLost(receipt.key,true,true)){restored=true;break;}}
    catch{temporary=true;}
   }
   if(restored)retryable.push(page);
   else if(temporary)unavailable.add(key);
  }
  const targets=retryable.map(page=>{
   const key=story.dag.order[page-1],frame=story.dag.frames[key];
   return [key,evaluation.instance('landscape',key).hard,frame.landscapeAttempt,frame.landscape];
  });
  const status:LandscapeStatus={state:pending?'running':ready===frames.length&&frames.length?'completed':ready||failed.length||unavailable.size?'partial':'idle',available,total:frames.length,ready,images,failed,
   ...(unavailable.size?{readUnavailable:true,error:'部分横图暂时无法读取。'}:{}),
   ...(canStart&&!unavailable.size&&!pending&&missing.length?{startToken:inputVersion(['dag-landscape',row.document,missing])}:{}),
   ...(failed.length?{error:targets.length?frames[retryable[0]-1].landscapeError:'待重试画幅的竖图暂不可用。'}:{}),
   ...(!pending&&targets.length?{retryToken:inputVersion(['dag-landscape-retry',row.id,targets])}:{})};
  return {status,lost,missing,retryable};
 }

 /** 请求横图：开始时为尚未请求的画幅加请求标记；重试时清除失败说明并作废失败的任务，然后立即安排。 */
 async startLandscape(row:SessionRow,command:{startToken?:string;retryToken?:string},stopping=false,localOnly=false){
  const projection=hasDag(row)?await this.landscapeProjection(row):undefined,status=projection?.status;
  const retry=command.retryToken!==undefined,event=retry?'retry-landscape':'start-landscape';
  const superseded=await this.deps.database.prepare(`SELECT id FROM stories WHERE id=? AND user_id=? AND ${supersededSql()}`).bind(row.id,row.user_id).first();
  const authorization=authorizeProductionCommand(event,{
   version:superseded?'superseded':'current',control:row.generation_control??'active',continuation:false,stopping,
   targetCurrent:retry?!!status?.retryToken&&command.retryToken===status.retryToken:!!status?.startToken&&command.startToken===status.startToken,
   targetReady:!!status?.available,
  });
  if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
  const story=(await this.story(row,'skip'))!,evaluation=evaluate(stateOf(story));
  let dag=structuredClone(story.dag);
  const resetFrames=retry?projection!.retryable.map(page=>dag.order[page-1]):projection!.missing;
  for(const id of resetFrames){
   const frame=dag.frames[id];
   // 只绘制令牌绑定的画幅；重试保留旧任务及回执，并赋予新任务独立代次。
   if(retry||frame.landscape!==undefined)frame.landscapeAttempt=(frame.landscapeAttempt??0)+1;
   const inputs=evaluation.instance('landscape',id).hard;
   if(!inputs)throw new ReaderError(409,'横图的绘图输入尚未就绪，请刷新后重试。');
   delete dag.products[instanceId('landscape',id)];frame.landscape='';delete frame.landscapeError;
   frame.landscapeInputHash=fingerprint(inputs);
  }
  if(localOnly){
   // 整次重试的回执全部可读后才一起保存；离线核对不留下待付费的任务。
   const keys=new Set(resetFrames),faults=story.faults.filter(fault=>fault.node!=='landscape'||!keys.has(fault.key));
   for(const key of resetFrames){
    const working={...story,dag,faults},item={call:'drawLandscape',instances:[evaluate(stateOf(working)).instance('landscape',key)]};
    const restored=await this.landscapeRetryReceipt(row,working,item,dag.frames[key].landscapeAttempt)
     .catch(error=>{if(error instanceof JobYield)throw new ReaderError(503,'已付费横图暂时无法读取，请稍后重试。');throw error;});
    if(!restored)throw new ReaderError(503,'未找到可用的本地横图，重新绘制需要绘图服务。');
    const next=apply(working,restored.item,restored.receipt.value,{newId:randomUUID});
    if(!next)throw new ReaderError(409,'横图输入已更新，请刷新后重试。');
    dag=next;
    if(restored.receipt.entry)story.doc.usage=[...story.doc.usage,restored.receipt.entry];
   }
  }
  // 本次重试只授权横图；旧书库中竖图的暂停状态继续保留。
  if(retry&&!localOnly)story.doc.legacyLandscapeControl='active';
  if(!await this.save(row,story,dag,{landscape:{resetFrames}}))throw new ReaderError(409,'故事已更新，请刷新后再试。');
  const saved=await this.row(row.id,row.user_id);
  if(saved&&!localOnly){
   const source=(await this.story(saved,'skip'))!;
   const requested=new Set(resetFrames);
   for(const spec of this.specs(saved,source,work(source).filter(item=>item.call==='drawLandscape'&&requested.has(item.instances[0].key))))
    await this.deps.queue.enqueue(spec);
  }
  this.deps.wake();
  return (await this.landscapeProjection(saved??row)).status;
 }

 /**
  * 读者端发现图片读不出时的核对：确认丢失则在一个事务中把该幅成图标为不可读并记录图片丢失故障，须读者明确恢复才重绘；
  * 文件恢复可读时同样在一个事务中解除没有任务的丢失故障并恢复成图记录。不改变整篇完成状态，完成只由引擎判定。
  */
 async checkImage(row:SessionRow,page:number,image:string,options:{superseded?:boolean;recovery?:RecoveryRequest}={}){
  const doc=JSON.parse(row.document) as Document,id=doc.dag?.order[page];
  const key=referenceImageKey(row.id,image);
  const authorization=authorizeProductionCommand('image-health',{
   version:options.superseded?'superseded':'current',control:row.generation_control??'active',continuation:!!doc.dag?.continuation,stopping:false,
   targetCurrent:!!id&&doc.dag?.frames[id]?.image===image,targetReady:!!key,
  });
  if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
  const result=await this.deps.fileLost(key!,true).then(lost=>lost?'missing' as const:'readable' as const,()=> 'unavailable' as const);
  if(resolveImageRead({result,fault:false})==='defer')throw new ReaderError(503,'图片暂时无法读取，请重试检查；尚未重新绘图。');
  const transaction=this.deps.database.transaction;if(!transaction)throw Error('TRANSACTION_UNAVAILABLE');
  const frameId=id!,product=`frameImage:${frameId}`,now=this.deps.clock();
  const restored=transaction.call(this.deps.database,db=>{
   const recovery=options.recovery;
   const receiptFingerprint=recovery?commandFingerprint(['recover',row.id,recovery.faultId,[],'',false,true]):null;
   if(recovery){
    const replay=db.get<CommandReceipt>('SELECT * FROM reader_commands WHERE owner_id=? AND request_id=?',row.user_id,recovery.requestId);
    if(replay){
     if(replay.action!=='recover'||replay.session_id!==row.id||replay.fault_id!==recovery.faultId)
      throw new ReaderError(409,'这个操作编号已用于其他内容。');
     return true;
    }
   }
   const current=db.get<{document:string;generation_control:SessionRow['generation_control']}>(`SELECT document,generation_control FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,row.id,row.user_id);
   if(!current||current.document!==row.document)throw new ReaderError(409,'故事已更新，请刷新后再检查。');
   const dag=structuredClone(doc.dag!),record=dag.products[product];
   const fault=db.get<{id:string}>("SELECT id FROM reader_faults WHERE session_id=? AND owner_id=? AND kind='image-loss' AND job_id IS NULL AND node='frameImage' AND node_key=? AND state='pending'",row.id,row.user_id,frameId);
   const effect=resolveImageRead({result,fault:!!fault});
   if(recovery){
    const retry=authorizeProductionCommand('retry',{
     version:'current',control:current.generation_control??'active',continuation:!!dag.continuation,stopping:false,
     targetCurrent:fault?.id===recovery.faultId,targetReady:true,
    });
    if(!retry.allowed)throw new ReaderError(retry.status,retry.message);
    if(effect==='mark-lost')return false;
    if(db.get('SELECT id FROM stories WHERE id=? AND user_id=?',recovery.requestId,row.user_id))throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
    db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,status,created_at,updated_at) VALUES(?,?,?,'recover',?,?,?,'succeeded',?,?)",
     recovery.requestId,row.user_id,row.id,receiptFingerprint,JSON.stringify({jobs:[],resolutionJob:'',redraw:false}),recovery.faultId,now,now);
   }
   if(effect==='mark-lost'){
    if(record)dag.products[product]={...record,readable:false};
    db.run('UPDATE stories SET document=? WHERE id=? AND user_id=?',JSON.stringify({...doc,dag}),row.id,row.user_id);
    if(!fault)db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,input_hash,version,image,message,created_at,updated_at) VALUES(?,?,?,'image-loss','frameImage',?,?,'dag',?,?,?,?)",randomUUID(),row.id,row.user_id,frameId,record?fingerprint(record.inputs):null,image,lostImageMessage(page),now,now);
   }else if(effect==='restore-readable'&&fault){
    if(record){const {readable:_,...restored}=record;void _;dag.products[product]=restored;}
    db.run('UPDATE stories SET document=? WHERE id=? AND user_id=?',JSON.stringify({...doc,dag}),row.id,row.user_id);
    db.run("UPDATE reader_faults SET state='resolved',updated_at=?,command_id=COALESCE(?,command_id) WHERE id=?",now,recovery?.requestId??null,fault.id);
    return true;
   }
   return false;
  });
  await this.settleState(row.id,row.user_id);
  this.deps.wake();
  return restored===true;
 }

 /**
  * 整篇状态以引擎判定为准：故障或图片记录变化后（例如已完成的故事发现图片丢失），按引擎判定改回待继续或标为完成。
  */
 async settleState(id:string,ownerId:string){
  const row=await this.row(id,ownerId),story=row&&await this.story(row);
  if(!row||!story)return;
  const done=finished(story);
  if(done&&row.state==='idle')await this.deps.database.prepare("UPDATE stories SET state='completed',error=NULL WHERE id=? AND user_id=? AND state='idle' AND document=?").bind(id,ownerId,row.document).run();
  if(!done&&row.state==='completed')await this.deps.database.prepare("UPDATE stories SET state='idle' WHERE id=? AND user_id=? AND state='completed' AND document=?").bind(id,ownerId,row.document).run();
 }

 /** 接管旧版准备任务与未完成的故事。已保存的原文和建议由 settle() 采用。 */
 async adopt(row:SessionRow):Promise<boolean>{
  const doc=JSON.parse(row.document) as Document;
  const confirmed=!doc.intake||doc.intake.phase==='confirmed';
  const preparation=preparationPending(doc)||doc.intake?.phase==='confirming';
  const emptyLegacy=preparation&&doc.dag?.legacy&&!doc.dag.order.length&&!doc.plan;
  if(doc.reselection||doc.dag&&!emptyLegacy||!confirmed&&!preparation||row.state==='running'&&row.lock_until>this.deps.clock())return false;
  const selection=selectionSchema.parse(JSON.parse(row.selection));
  const modelSnapshot=confirmed?this.deps.snapshot?.():undefined;
  const base=confirmed&&(doc.plan||doc.storyboard||doc.draft)?convertDocument(doc,selection,{confirmed,notes:doc.reviewNotes,...(modelSnapshot?{modelSnapshot}:{})}):{...emptyDag(),...(modelSnapshot?{modelSnapshot}:{})};
  if(preparationPending(doc)&&doc.original)doc.original=preparationOriginal(doc,selection,doc.original);
  const story={id:row.id,doc,selection,dag:base,confirmed,faults:[]};
  const dag=preparation?settle(story):base;
  const first=preparationPending(doc)?work({...story,dag})[0]:undefined;
  const replacement=first?this.spec(row,{...story,dag},first,-10):undefined;
  const saved=transact(this.deps.database,db=>{
   const now=this.deps.clock();
   const {changes}=db.run(`UPDATE stories SET document=?,updated_at=?,
    state=CASE WHEN ? AND state IN ('running','failed') THEN 'idle' ELSE state END,
    error=CASE WHEN ? THEN NULL ELSE error END,
    lock_token=CASE WHEN ? THEN NULL ELSE lock_token END,lock_until=CASE WHEN ? THEN 0 ELSE lock_until END
    WHERE id=? AND user_id=? AND document=? AND selection=? AND state=? AND lock_token IS ? AND lock_until=?`,
    JSON.stringify({...doc,dag}),new Date(now).toISOString(),preparation?1:0,preparation?1:0,preparation?1:0,preparation?1:0,row.id,row.user_id,row.document,row.selection,row.state,row.lock_token,row.lock_until);
   if(!changes)return false;
   const jobs=db.all<ProductionJob>("SELECT * FROM production_jobs WHERE session_id=? AND owner_id=? AND kind='prepare' AND state!='succeeded' ORDER BY updated_at DESC",row.id,row.user_id);
   const current=jobs.find(job=>(JSON.parse(job.payload) as {setupGeneration?:number}).setupGeneration===doc.intake?.generation);
   if(first&&replacement&&current){
    const old=JSON.parse(current.payload) as {timings?:unknown};
    const state=current.state==='running'?'queued':current.state;
    // 旧任务的中断次数与恢复授权转给第一个缺失节点，重启不能重置自动重放次数。
    db.run(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,priority,attempts,lease_until,error,interrupted,failure_id,recovery_id,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,replacement.id,row.id,row.user_id,replacement.kind,replacement.pool,replacement.version,'[]',JSON.stringify({...replacement.payload as object,...(old.timings?{timings:old.timings}:{})}),state,replacement.priority,current.attempts,current.error,current.interrupted,current.failure_id??null,current.recovery_id??null,current.created_at,now);
    db.run("UPDATE reader_faults SET job_id=?,node=?,node_key='',version=?,updated_at=? WHERE job_id=? AND owner_id=? AND state IN ('pending','recovering')",
     replacement.id,first.instances[0].node,replacement.version,now,current.id,row.user_id);
    if(current.recovery_id)db.run(`UPDATE reader_commands SET payload=json_set(payload,'$.jobs',json_array(?),'$.resolutionJob',?),status='queued',updated_at=?
     WHERE request_id=? AND owner_id=? AND action='recover' AND status IN ('queued','running')`,replacement.id,replacement.id,now,current.recovery_id,row.user_id);
   }
   for(const job of jobs)deleteJobs(db,"id=?",[job.id],now);
   return true;
  });
  if(saved)this.deps.wake();
  return saved;
 }

 private async recordSnapshot(row:SessionRow){
  const current=this.deps.snapshot?.();if(!current)return false;
  const saved=await this.deps.database.prepare("UPDATE stories SET document=json_set(document,'$.dag.modelSnapshot',json(?)),updated_at=? WHERE id=? AND user_id=? AND document=? AND json_type(document,'$.dag.modelSnapshot') IS NULL").bind(JSON.stringify(current),new Date(this.deps.clock()).toISOString(),row.id,row.user_id,row.document).run();
  if(saved.meta.changes)this.deps.wake();
  return saved.meta.changes>0;
 }

 /** 故事记录的模型快照；没有记录时沿用当前设置。 */
 async snapshotOf(job:ProductionJob):Promise<ModelSnapshot|undefined>{
  const row=await this.row(job.session_id,job.owner_id);
  const doc=row&&JSON.parse(row.document) as Document;
  return (JSON.parse(job.payload).work?.call==='drawLandscape'?doc?.legacyLandscapeModelSnapshot:undefined)??doc?.dag?.modelSnapshot;
 }

 /**
  * 「应用当前模型设置」：在一个事务中核对操作编号、把故事的快照换成当前设置的快照并写入回执；快照不参与任何节点的输入，已有产物不失效。
  * 已受理的编号重放只读回执，不再按重放时的设置改写快照；用于其他故事或其他动作的编号被拒绝。
  */
 async applyCurrentModel(ownerId:string,id:string,requestId:string,stopping=false){
  const now=this.deps.clock();
  transact(this.deps.database,db=>{
   const receipt=db.get<{action:string;session_id:string;fingerprint:string}>('SELECT action,session_id,fingerprint FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
   if(receipt){
    if(receipt.action!=='control'||receipt.session_id!==id||!receipt.fingerprint.startsWith('apply-model:'))throw new ReaderError(409,'这个操作编号已用于其他内容，请重新操作。');
    return;
   }
   const current=this.deps.snapshot?.();
   if(db.get('SELECT id FROM stories WHERE id=? AND user_id=?',requestId,ownerId))throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
   const row=db.get<{generation_control:SessionRow['generation_control'];confirmed:number}>(`SELECT generation_control,
    json_type(document,'$.dag') IS NOT NULL AND COALESCE(json_extract(document,'$.intake.phase'),'confirmed')='confirmed' AND json_extract(document,'$.legacyFramePreparation') IS NULL AS confirmed
    FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,id,ownerId);
   const authorization=authorizeProductionCommand('apply-model',{
    version:row?'current':'superseded',control:row?.generation_control??'active',continuation:false,stopping,
    targetCurrent:!!row?.confirmed,targetReady:!!current,
   });
   if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
   // 升级前发起的横图继续沿用原快照，直到读者在横图步骤单独确认更换。
   db.run(`UPDATE stories SET document=json_set(document,'$.legacyLandscapeModelSnapshot',json_extract(document,'$.dag.modelSnapshot'))
    WHERE id=? AND user_id=? AND json_type(document,'$.legacyLandscapeModelSnapshot') IS NULL AND json_type(document,'$.dag.modelSnapshot')='object'
    AND EXISTS(SELECT 1 FROM json_each(document,'$.dag.frames') WHERE json_type(value,'$.landscape') IS NOT NULL)`,id,ownerId);
   db.run("UPDATE stories SET document=json_set(document,'$.dag.modelSnapshot',json(?)),updated_at=? WHERE id=? AND user_id=?",
    JSON.stringify(current),new Date(now).toISOString(),id,ownerId);
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at) VALUES(?,?,?,'control',?,?,?,?,?)",requestId,ownerId,id,'apply-model:'+commandFingerprint(['apply-model',id,current]),JSON.stringify({action:'apply-model',snapshot:current}),id,now,now);
  });
  this.deps.wake();
 }

 reprepare(ownerId:string,id:string,requestId:string,stopping=false){
  const now=this.deps.clock(),fingerprint=commandFingerprint(['reprepare',id]);
  transact(this.deps.database,db=>{
   const receipt=db.get<CommandReceipt>('SELECT * FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
   if(receipt){
    if(receipt.action!=='control'||receipt.session_id!==id||receipt.fingerprint!==fingerprint)throw new ReaderError(409,'这个操作编号已用于其他内容。');
    return;
   }
   if(db.get('SELECT id FROM stories WHERE id=? AND user_id=?',requestId,ownerId))throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
   const row=db.get<SessionRow>(`SELECT * FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,id,ownerId);
   const doc=row?JSON.parse(row.document) as Document:undefined;
   const decision=authorizeProductionCommand('reprepare',{version:row?'current':'superseded',control:row?.generation_control??'active',
    continuation:!!doc?.dag?.continuation,stopping,targetCurrent:true,targetReady:!!doc&&canReprepare(doc)});
   if(!decision.allowed)throw new ReaderError(decision.status,decision.message);
   const dag=doc!.dag!;
   dag.repreparing=true;dag.preparationGeneration=(dag.preparationGeneration??0)+1;
   delete dag.products['suggestions:'];
   db.run("UPDATE stories SET document=?,error=NULL,updated_at=? WHERE id=? AND user_id=?",JSON.stringify(doc),new Date(now).toISOString(),id,ownerId);
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at) VALUES(?,?,?,'control',?,?,?,?,?)",
    requestId,ownerId,id,fingerprint,JSON.stringify({action:'reprepare',generation:dag.preparationGeneration}),id,now,now);
  });
  this.deps.wake();
 }

 /** 审片阻断随结论与额度绑定，任何变化后旧操作令牌均失效。 */
 private reviewBlock(story:DagStory,attention?:Attention[]){
  const {reasons,issues}=reviewAttention(story,attention);
  const targets=[...new Set(reasons.map(item=>item.target))];
  const id=targets.length?'review:'+commandFingerprint(['review-fault',story.id,reasons,story.dag.repairs,
   targets.map(target=>[target,story.dag.products[target]?.hash??null])]).slice(0,32):null;
  return {id,reasons,issues,targets};
 }

 /** 一次明确命令给当前额度已用尽的结论授予一轮修订，回执与额度同时提交。 */
 grantRepairBudget(row:SessionRow,requestId:string,faultId:string){
  const now=this.deps.clock(),fingerprint=commandFingerprint(['continue-repair',row.id,faultId]);
  transact(this.deps.database,db=>{
   const receipt=db.get<{action:string;session_id:string;fingerprint:string}>('SELECT action,session_id,fingerprint FROM reader_commands WHERE owner_id=? AND request_id=?',row.user_id,requestId);
   if(receipt){
    if(receipt.action!=='continue-repair'||receipt.session_id!==row.id||receipt.fingerprint!==fingerprint)
     throw new ReaderError(409,'这个操作编号已用于其他内容。');
    return;
   }
   const current=db.get<SessionRow>(`SELECT * FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,row.id,row.user_id);
   const doc=current&&JSON.parse(current.document) as Document|undefined;
   if(!current||!doc?.dag)throw new ReaderError(409,'制作版本已更新，请刷新后重试。');
   const story:DagStory={id:row.id,doc,selection:selectionSchema.parse(JSON.parse(current.selection)),dag:doc.dag,confirmed:!doc.intake||doc.intake.phase==='confirmed',
    faults:dagFaultTargets(db.all<FaultTarget>(pendingFaultTargets,row.id,row.user_id),doc.dag)};
   const block=this.reviewBlock(story),targets=[...new Set(block.reasons.filter(item=>item.reason==='limit').map(item=>item.target))];
   const authorization=authorizeProductionCommand('continue-repair',{version:'current',control:current.generation_control??'active',
    continuation:!!doc.dag.continuation,targetCurrent:block.id===faultId,targetReady:story.confirmed&&targets.length>0,stopping:false});
   if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
   const repairs=grantRepairs(doc.dag.repairs??newRepairBudget());
   db.run("UPDATE stories SET document=json_set(document,'$.dag.repairs',json(?)),state='idle',error=NULL,updated_at=? WHERE id=? AND user_id=?",
    JSON.stringify(repairs),new Date(now).toISOString(),row.id,row.user_id);
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,created_at,updated_at) VALUES(?,?,?,'continue-repair',?,?,?,?,?)",
    requestId,row.user_id,row.id,fingerprint,JSON.stringify({targets}),faultId,now,now);
  });
 }

 private skipDraft(story:DagStory,faultId:string,choice:ReviewOverride['ending'],now:number){
  const source=story.dag.ending;
  if(!source)return null;
  const confirmed=typeof choice==='object'?{title:choice.title,ending:choice.reflection}:
   choice!==undefined?{title:source.confirmed?.title??source.title,ending:choice==='default'?(source.confirmed?.ending??source.chosen??source.candidates[0]):source.candidates[choice-1]}:source.confirmed;
  if(!confirmed?.title||!confirmed.ending)return null;
  const dag={...story.dag,ending:{...source,confirmed}};
  const record=createReviewSkip(stateOf({...story,dag},{includeReviewSkip:false}),dag,faultId,new Date(now).toISOString());
  return record?{...dag,reviewSkip:record}:null;
 }

 skipReviewOffer(row:SessionRow,fault:ReaderFault,job:ProductionJob|undefined,faults:ReaderFault[]){
  if(fault.state!=='pending')return null;
  const doc=JSON.parse(row.document) as Document;
  if(!doc.dag)return null;
  const story:DagStory={id:row.id,doc,dag:doc.dag,selection:selectionSchema.parse(JSON.parse(row.selection)),
   confirmed:!doc.intake||doc.intake.phase==='confirmed',faults:[]};
  const item=job?.state==='failed'?(JSON.parse(job.payload) as {work?:Work}).work:undefined;
  const group=isCarriedReviewFault(fault)?carriedJobFaultGroup(fault):null;
  const evaluation=group?evaluate(stateOf(story)):null;
  const targetCurrent=group&&evaluation?faults.every(member=>
   carriedJobFaultGroup(member)!==group||isCarriedReviewFault(member)&&carriedJobFaultState(evaluation,member)==='pending'):
   item?.call==='review'&&!stale(story,item);
  const draft=story.confirmed?this.skipDraft(story,fault.id,'default',this.deps.clock()):null;
  const authorization=authorizeProductionCommand('skip-review',{version:'current',control:row.generation_control??'active',
   continuation:!!doc.dag.continuation,targetCurrent:!!targetCurrent,targetReady:!!draft,stopping:false});
  if(!authorization.allowed)return null;
  return draft?.ending?.confirmed?{faultId:fault.id,title:draft.ending.confirmed.title,reflection:draft.ending.confirmed.ending}:null;
 }

 private skipFailedReview(db:SyncStatements,row:SessionRow,command:ReviewOverride,now:number){
  const doc=JSON.parse(row.document) as Document;
  const fault=db.get<ReaderFault>("SELECT * FROM reader_faults WHERE id=? AND session_id=? AND owner_id=?",command.faultId,row.id,row.user_id);
  const job=fault?.job_id?db.get<ProductionJob>("SELECT * FROM production_jobs WHERE id=? AND session_id=? AND owner_id=?",fault.job_id,row.id,row.user_id):undefined;
  if(!fault||!doc.dag)throw new ReaderError(409,'请先暂停制作并保存完整稿件，或刷新后重试当前审核。');
  const story:DagStory={id:row.id,doc,dag:doc.dag,selection:selectionSchema.parse(JSON.parse(row.selection)),confirmed:true,faults:[]};
  const group=carriedJobFaultGroup(fault);
  if(group)reconcileCarriedJobFaults(db,row.user_id,story,now);
  const members=group?db.all<ReaderFault>(`SELECT * FROM reader_faults WHERE session_id=? AND owner_id=? AND origin_fault_id=?
   AND kind='job' AND job_id IS NULL AND state='pending'`,row.id,row.user_id,group):[];
  if(group&&!members.some(member=>member.id===fault.id)||!this.skipReviewOffer(row,fault,job,members))
   throw new ReaderError(409,'请先暂停制作并保存完整稿件，或刷新后重试当前审核。');
  const dag=this.skipDraft(story,fault.id,command.ending,now);
  if(!dag)throw new ReaderError(409,'请确认标题与结语，再跳过本次审核。');
  db.run("UPDATE stories SET document=?,state='idle',error=NULL,updated_at=? WHERE id=? AND user_id=?",
   JSON.stringify({...doc,dag,...projectDocument(dag,doc.plan)}),new Date(now).toISOString(),row.id,row.user_id);
  for(const target of members.length?members:[fault])db.run("UPDATE reader_faults SET state='resolved',updated_at=? WHERE id=?",now,target.id);
  if(job)db.run("UPDATE production_jobs SET state='succeeded',result=json_object('skippedReview',1),error=NULL,updated_at=? WHERE id=?",now,job.id);
 }

 /**
  * 放行：在一个事务中核对操作编号与当前需读者处理的结论，只把这些结论标为放行，并写入回执。
  * 可绘图仍由全部结论推导；被放行结论的输入之后改变时，放行随产物失效。
  */
 async override(ownerId:string,id:string,command:ReviewOverride){
  const {requestId,faultId}=command;
  const fingerprint=commandFingerprint(['override',id,faultId,command.ending??null]);
  transact(this.deps.database,db=>{
   const receipt=db.get<{session_id:string;fingerprint:string;action:string;fault_id:string|null;payload:string}>(
    'SELECT session_id,fingerprint,action,fault_id,payload FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
   if(receipt){
    const previous=JSON.parse(receipt.payload) as {version?:number};
    if(receipt.action!=='override'||receipt.session_id!==id||receipt.fault_id!==null&&receipt.fault_id!==faultId||
     previous.version===2&&receipt.fingerprint!==fingerprint)throw new ReaderError(409,'这个操作编号已用于其他内容。');
    return;
   }
   const current=db.get<SessionRow>(`SELECT * FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,id,ownerId);
   const now=this.deps.clock(),skip=command.ending!==undefined||!faultId.startsWith('review:');
   let targets:string[]=[];
   if(skip){
    if(!current)throw new ReaderError(409,'审核结果已更新，请刷新后再操作。');
    this.skipFailedReview(db,current,command,now);
   }
   else{
    // 结论指纹包含故障带来的可执行性，在回执事务内读取，不采用此前的轮询快照。
    const doc=current&&JSON.parse(current.document) as Document|undefined;
    const story:DagStory|null=current&&doc?.dag?{id,doc,dag:doc.dag,selection:selectionSchema.parse(JSON.parse(current.selection)),
     confirmed:!doc.intake||doc.intake.phase==='confirmed',faults:dagFaultTargets(db.all<FaultTarget>(pendingFaultTargets,id,ownerId),doc.dag)}:null;
    const derived=story&&deriveProduction(story);
    const block=story&&derived&&!derived.work.some(item=>!drawing(item.call))?this.reviewBlock(story,derived.attention):null;
    targets=block?.targets??[];
    const dag=story&&block?.id===faultId?overrideReview(story,targets):null;
    const authorization=authorizeProductionCommand('override-review',{
     version:current?'current':'superseded',control:current?.generation_control??'active',continuation:!!doc?.dag?.continuation,
     targetCurrent:block?.id===faultId,targetReady:!!dag,stopping:false,
    });
    if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
    db.run("UPDATE stories SET document=?,state=CASE WHEN state='failed' THEN 'idle' ELSE state END,error=NULL,updated_at=? WHERE id=? AND user_id=?",JSON.stringify({...doc!,dag}),new Date(now).toISOString(),id,ownerId);
   }
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,created_at,updated_at) VALUES(?,?,?,'override',?,?,?,?,?)",
    requestId,ownerId,id,fingerprint,JSON.stringify({version:2,targets,skip,ending:command.ending}),faultId,now,now);
  });
  this.deps.wake();
 }

 /** 审片状态：全部结论有效且通过或被放行为 approved；审片停在需读者处理且没有可派发的文字工作为 attention。 */
 async reviewState(row:SessionRow):Promise<'approved'|'attention'|'pending'|null>{
  const story=await this.story(row);if(!story)return null;
  const derived=deriveProduction(story);
  if(derived.evaluation.approved())return 'approved';
  const textWork=derived.work.some(item=>!drawing(item.call));
  return derived.attention.length&&!textWork?'attention':'pending';
 }

 /**
  * 「继续制作」：在一个事务中核对操作编号与本版等待继续的修订，清除等待、恢复后台制作并写入回执。
  * 已接受的编号先于其他核对重放：故事之后被替换或服务暂不可用时仍直接返回。用于其他操作或其他版本的编号被拒绝。
  * 只有这个动作清除等待。stopping 为真时不接受新的继续。
  */
 continue(ownerId:string,id:string,requestId:string,stopping=false){
  const transaction=this.deps.database.transaction;
  if(!transaction)throw Error('TRANSACTION_UNAVAILABLE');
  const now=this.deps.clock();
  const replayed=transaction.call(this.deps.database,db=>{
   const receipt=db.get<{action:string;session_id:string;fingerprint:string}>('SELECT action,session_id,fingerprint FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
   if(receipt){
    if(receipt.action!=='control'||receipt.session_id!==id||!receipt.fingerprint.startsWith('continue:'))throw new ReaderError(409,'这个操作编号已用于其他内容，请重新操作。');
    return true;
   }
   const story=db.get<{document:string}>(`SELECT document FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,id,ownerId);
   const waiting=story?(JSON.parse(story.document) as Document).dag?.continuation:undefined;
   if(db.get('SELECT id FROM stories WHERE id=? AND user_id=?',requestId,ownerId))throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
   const authorization=authorizeProductionCommand('continue',{version:story?'current':'superseded',control:'active',continuation:!!waiting,
    targetCurrent:true,targetReady:true,stopping});
   if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
   const fingerprint=`continue:${commandFingerprint(['continue',id,waiting!.revision])}`;
   preserveLegacyLandscapeControl(db,id,ownerId);
   db.run(`UPDATE stories SET document=json_remove(document,'$.dag.continuation'),generation_control='active',generation_mode='background',updated_at=? WHERE id=? AND user_id=?`,new Date(now).toISOString(),id,ownerId);
   db.run(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at) VALUES(?,?,?,'control',?,?,?,?,?)`,requestId,ownerId,id,fingerprint,JSON.stringify({action:'continue',revision:waiting!.revision}),id,now,now);
   return false;
  });
  if(!replayed)this.deps.wake();
 }
 /** 这个编号已作为本篇的「继续制作」被接受。 */
 async continueAccepted(ownerId:string,id:string,requestId:string){
  const receipt=await this.deps.database.prepare('SELECT session_id,fingerprint FROM reader_commands WHERE owner_id=? AND request_id=? AND action=\'control\'').bind(ownerId,requestId).first<{session_id:string;fingerprint:string}>();
  return receipt?.session_id===id&&receipt.fingerprint.startsWith('continue:');
 }
}
