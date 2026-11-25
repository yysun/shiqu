// 协调器的制作 DAG 路径：由执行层决定选题后的准备与制作工作。
// 调度：settle() 的免调用步骤先保存；work() 的每项工作成为一个任务，身份绑定实际请求与各实例派发时的硬输入，
// 不再需要的排队任务删除。执行：调用前后各核对一次输入，结果用 apply() 写回，并以文档内容做比较并交换保存，
// 冲突时按最新文档重算。已付费结果保留在故事家族内。完成判定用 finished()。「已保存，等待继续」期间不派发任何工作。
import {recordFamilyImage,type FamilyImage} from './media.ts';
import {insertFamilyProduct,productionStorageHash,setFamilyImageReadability,writeStoryProducts} from './production-products.ts';
import {reusableTextProducts} from './production-product-reuse.ts';
import {appendProductionAttempt,productionAttemptCount} from './production-attempts.ts';
import {decodeDocument} from '../lib/production-dag/document.ts';
import {authorizeProductionCommand,deriveProductionExecution,resolveImageRead} from '../lib/production-lifecycle.ts';
import {ReaderError,selectionSchema,type Document,type Selection,type SessionRow} from '../lib/reader-model.ts';
import type {Database,ReadStatements,SyncStatements} from '../lib/reader-repository.ts';
import {supersededSql} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {storePromptRecord} from '../lib/reader-prompt-store.ts';
import {lostImageMessage,readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {imageTypes,mediaType} from '../lib/reader-generation-contract.ts';
import {readableImage} from './reader-image-health.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {landscapeSourceReady,projectDocument,emptyDag,type DagDocument} from '../lib/production-dag/document.ts';
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
import {persistenceError} from '../lib/reader-repository.ts';
import {JobYield,inputVersion} from './production-queue.ts';
import {randomUUID} from 'node:crypto';
import {authorizeRecovery,commandFingerprint,type CommandReceipt,type ReaderFault} from './reader-commands.ts';
import {transact,deleteJobs} from './production-records.ts';
import {reviewAttention} from '../lib/production-dag/progress.ts';
import {grantRepairs,newRepairBudget} from '../lib/production-dag/review.ts';
import type {RecoveryRequest,ReviewOverride} from '../lib/reader-recovery.ts';
import {reconcileImageFaults} from './dag-image-faults.ts';
import {PaidDispatchDenied} from './paid-dispatch.ts';

export const dagTextKind='dag',dagDrawKind='dag-draw';
type Deps={portraitOnly?:boolean;database:Database;media:MediaStore;queue:ProductionQueue;clock:()=>number;wake:()=>void;snapshot?:()=>ModelSnapshot|undefined;imageSnapshotAvailable?:(snapshot:ModelSnapshot)=>boolean;fileLost:(key:string,strict?:boolean,landscape?:boolean)=>Promise<boolean>};
type Paid={value:unknown;model:string;requestId:string|null;usage:unknown;entry?:Document['usage'][number];usageRecorded?:boolean};
/** 阅读中的故事优先。每篇仍按幅序绘图。 */
export const viewedPriority=(page:number,opened:boolean)=>opened?page-100:page;
type FaultTarget={id:string;node:string|null;node_key:string;optional:number;kind:string|null;faultKind:string;state:string;payload:string|null};
const pendingFaultTargets=`SELECT f.id,f.node,f.node_key,f.optional,f.kind AS faultKind,f.state,j.kind,j.payload FROM production_faults f
 LEFT JOIN production_jobs j ON j.id=f.job_id AND j.session_id=f.session_id AND j.owner_id=f.owner_id
 WHERE f.session_id=? AND f.owner_id=? AND f.state='pending'`;
function dagFaultTargets(rows:FaultTarget[]):Fault[]{
 return rows.flatMap<Fault>(f=>{
  if(f.payload&&(f.kind===dagTextKind||f.kind===dagDrawKind)){
   const {work:item}=JSON.parse(f.payload) as {work:Work};
   return item.instances.map(i=>({id:f.id,node:i.node,key:i.key,state:'pending' as const}));
  }
  return f.node?[{id:f.id,node:f.node,key:f.node_key,state:'pending',...(f.optional?{optional:true}:{}),...(f.faultKind==='image-loss'?{imageLoss:true}:{})}]:[];
 });
}
const preparingCall=(call:string)=>call==='prepareArt'||call==='prepareSuggestions';
const drawing=(call:string)=>call==='draw';
const textWorkHash=(item:Work)=>fingerprint([item.call,item.instances.map(target=>[target.id,target.hard]),item.issues??null]);

/** 请求身份覆盖来源与核对输入，产物有效性仍只由硬输入决定。 */
export function dagJobSpec(ownerId:string,story:DagStory,item:Work,priority:number,opened=false){
 const preparation=(!story.confirmed||story.dag.repreparing)&&(item.call==='verifySource'||preparingCall(item.call));
 const {displayTitle:_,...selection}=story.selection;void _;
 const request=drawing(item.call)?drawInput(story,item):item.call==='verifySource'||preparingCall(item.call)?{selection,requirements:item.call==='prepareSuggestions'&&preparationPending(story.doc)}:requestFor(story,item);
 const preparationGeneration=story.dag.repreparing&&item.call==='prepareSuggestions'?story.dag.preparationGeneration:undefined;
 const identity=['dag-job',story.id,story.doc.intake?.generation??null,item.call,item.instances.map(i=>[i.id,i.hard??null]),request,
  ...(preparationGeneration===undefined?[]:[{preparationGeneration}])];
 const page=drawing(item.call)?story.dag.order.indexOf(item.instances[0].key):undefined;
 const spec:JobSpec={id:fingerprint(identity),sessionId:story.id,ownerId,kind:drawing(item.call)?dagDrawKind:dagTextKind,pool:drawing(item.call)?'image':'text',version:'dag',
  payload:{work:item,...(preparationGeneration===undefined?{}:{preparationGeneration}),...(page!==undefined?{page}:{}),...(story.doc.intake?{setupGeneration:story.doc.intake.generation}:{}),timingStage:preparation?'count':drawing(item.call)?'image':item.call,...(preparation?{timingScope:productionTimingScope(story.selection,false)}:{})},priority:page===undefined?priority:viewedPriority(page,opened)};
 return {spec,identity};
}

export const reviewCall=(call:string|undefined)=>call==='review'||call==='frameCheck';
const visible="NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id)";

export const hasDag=(row:SessionRow)=>{try{return !!(decodeDocument(row)).dag;}catch{return false;}};
export const canReprepare=(doc:Document)=>!!doc.dag&&!!doc.original&&!doc.reselection&&
 (!doc.intake||doc.intake.phase==='confirmed')&&!doc.dag.repreparing;

type DrawingRow=Pick<ProductionJob,'session_id'|'payload'>;

/** 原故障绑定的回执必须匹配当前绘图硬输入；提交时再检查实际文件。 */
function boundDrawingReceipt(original:DrawingRow|undefined,frame:string,inputHash?:string){
 if(!original)return null;
 let payload:{work?:Work;paid?:Paid}|null;
 try{payload=JSON.parse(original.payload);}catch{return null;}
 const {work:item,paid}=payload??{};
 const target=item?.instances?.[0];
 if(item?.call!=='draw'||target?.node!=='frameImage'||!target.hard||
  (inputHash===undefined?target.key!==frame:fingerprint(target.hard)!==inputHash)||typeof paid?.value!=='string')return null;
 const key=referenceImageKey(original.session_id,paid.value);
 return key?{sessionId:original.session_id,key,item:{...item,instances:[{...target,key:frame,id:instanceId(target.node,frame)}]},paid}:null;
}

export function portraitRecoveryReceipt(db:ReadStatements,row:SessionRow,fault:ReaderFault){
 if(fault.state!=='pending'||fault.node!=='frameImage')return null;
 if(fault.job_id){
  const job=db.get<DrawingRow>(`SELECT session_id,payload FROM production_jobs WHERE id=? AND session_id=? AND owner_id=? AND kind=?
   AND state='failed' AND failure_id=? AND json_extract(payload,'$.setupGeneration') IS json_extract(?,'$.intake.generation')`,
   fault.job_id,row.id,row.user_id,dagDrawKind,fault.id,row.document);
  return boundDrawingReceipt(job,fault.node_key);
 }
 return null;
}

export class DagProduction{
 private readonly deps:Deps;
 constructor(deps:Deps){this.deps=deps;}

 private async row(id:string,ownerId:string){return this.deps.database.prepare('SELECT * FROM story_rows stories WHERE id=? AND user_id=?').bind(id,ownerId).first<SessionRow>();}

 async story(row:SessionRow,referenceMode:'resolve'|'for-drawing'|'skip'='resolve'):Promise<DagStory|null>{
  const doc=decodeDocument(row);
  if(!doc.dag)return null;
  const selection=selectionSchema.parse(JSON.parse(row.selection));
  const refSource=referenceMode==='skip'?'':await new BookImageReferences(this.deps.database,this.deps.media,row.user_id).resolve(row.id,'').catch(error=>{
   if(referenceMode==='for-drawing'&&error instanceof PaidDispatchDenied)throw error;
   return '';
  });
  const story={id:row.id,doc,selection,dag:doc.dag,confirmed:!doc.intake||doc.intake.phase==='confirmed',
   faults:await this.faults(row),...(refSource?{refSource}:{})};
  return story;
 }

 /**
  * 待处理的故障按节点实例阻断：DAG 任务的故障按任务记录的工作逐个归属（批量工作覆盖多个实例），
  * 没有任务的故障（图片丢失、转换的旧故障）按记录的节点与键。可选产物的故障不阻断完成。
  * 恢复中的故障不阻断：读者授权的恢复任务与同输入的新工作身份相同，不会重复派发。
  */
 private async faults(row:SessionRow):Promise<Fault[]>{
  const rows=(await this.deps.database.prepare(pendingFaultTargets).bind(row.id,row.user_id).all<FaultTarget>()).results;
  return dagFaultTargets(rows);
 }

 /** 从快照推导完成和审片阻断，避免分别读取故障或访问图片文件。 */
 lifecycleFrom(row:SessionRow,faults:ReaderFault[],jobs:ProductionJob[]){
  const doc=decodeDocument(row),dag=doc.dag;
  if(!dag)return {complete:undefined,blocking:null,release:null,review:null};
  const byId=new Map(jobs.map(job=>[job.id,job]));
  const targets=faults.filter(fault=>fault.state==='pending'||fault.state==='recovering').map(fault=>{
   const job=fault.job_id?byId.get(fault.job_id):undefined;
   return {...fault,faultKind:fault.kind,kind:job?.kind??null,payload:job?.payload??null};
  });
  const confirmed=!doc.intake||doc.intake.phase==='confirmed';
  const story:DagStory={id:row.id,doc,dag,selection:selectionSchema.parse(JSON.parse(row.selection)),confirmed,faults:dagFaultTargets(targets)};
  const recovering=targets.some(target=>target.state==='recovering');
  const reviewing=recovering?{...story,faults:dagFaultTargets(targets.filter(target=>target.state!=='recovering'))}:story;
  const derived=deriveProduction(reviewing),complete=confirmed&&(recovering?finished(story):derived.complete);
  const blocking=complete||derived.work.some(item=>!drawing(item.call))?null:this.reviewBlock(reviewing,derived.attention);
  const review=derived.evaluation.approved()?'approved':blocking?.reasons.length?'attention':'pending';
  const release=complete?null:this.reviewRelease(reviewing,blocking?.id,faults,jobs);
  return {complete,blocking,release,review} as const;
 }

 /** 在领取事务中按当前硬输入和故障复核；参考图的文件可用性在发送前核对。 */
 dispatchInputs(db:SyncStatements,row:SessionRow,job:ProductionJob){
  const doc=decodeDocument(row),dag=doc.dag;
  if(!dag)return {inputCurrent:false,fault:false};
  const {work:item}=JSON.parse(job.payload) as {work:Work};
  if(dag.repreparing&&item.call!=='prepareSuggestions')return {inputCurrent:true,fault:true};
  const story:DagStory={id:row.id,doc,dag,selection:selectionSchema.parse(JSON.parse(row.selection)),
   confirmed:!doc.intake||doc.intake.phase==='confirmed',faults:[]};
  if(item.call==='draw'){
   const reference=drawingReferenceBinding(db,row.user_id,row.id,true);
   if(reference)story.refSource=reference;
   reconcileImageFaults(db,row.user_id,story,this.deps.clock());
  }
  story.faults=dagFaultTargets(db.all<FaultTarget>(pendingFaultTargets,row.id,row.user_id));
  const {evaluation}=deriveProduction(story);
  if(drawing(item.call)){
   const reusable=evaluate(stateOf({...story,dag:settle(story)}));
   if(item.instances.every(instance=>reusable.instance(instance.node,instance.key).status==='valid'))return {inputCurrent:false,fault:false};
  }
  const fault=item.instances.some(instance=>evaluation.instance(instance.node,instance.key).blocked||
   !evaluation.gateOpen(nodeSpec(instance.node).gate));
  return {inputCurrent:!stale(story,item),fault};
 }

 /** 按读取时的文档保存制作稿。其他写入抢先完成时返回 false。 */
 private async save(row:SessionRow,story:DagStory,dag:DagDocument,options:{
  usage?:Document['usage'][number];retainDeleted?:boolean;selection?:Selection;job?:ProductionJob;
 }={}){
  const {usage,retainDeleted,selection,job}=options;
  const doc:Document={...story.doc,dag,...(usage?{usage:[...(story.doc.usage||[]),usage]}:{})};
  const done=finished({...story,dag});
  const reordered=story.dag.order.length!==dag.order.length||story.dag.order.some((frame,index)=>frame!==dag.order[index]);
  // 用正在阅读的画幅身份计算位置；读取进度更新与制作写入可以并发。
  const positions=reordered?JSON.stringify(story.dag.order.map(frame=>{const index=dag.order.indexOf(frame);return index<0?null:index;})):null;
  const sql=`UPDATE stories SET document=?,production_complete=?,updated_at=?${selection?',selection=?':''}${reordered?",page=COALESCE(json_extract(?,'$['||max(0,page)||']'),max(0,min(page,?)))":''}
   WHERE id=? AND user_id=? AND document=?${selection?' AND selection=?':''}${retainDeleted?'':` AND ${visible}`}
   ${job?" AND EXISTS(SELECT 1 FROM production_jobs WHERE id=? AND state='running' AND lease_token IS ?)":''}`;
  const params=[done?1:0,new Date(this.deps.clock()).toISOString(),...(selection?[JSON.stringify(selection)]:[]),
   ...(reordered?[positions,Math.max(0,dag.order.length-1)]:[]),row.id,row.user_id,row.document,...(selection?[row.selection]:[]),...(job?[job.id,job.lease_token??null]:[])];
  return transact(this.deps.database,db=>writeStoryProducts(db,row.id,row.user_id,doc,stored=>db.run(sql,stored,...params).changes,job?{now:this.deps.clock(),attempt:job}:undefined)>0);
 }

 /** 为一篇故事安排工作；返回 true 表示已由 DAG 路径处理。 */
 async schedule(row:SessionRow,opened=false):Promise<boolean>{
  const story=await this.story(row);if(!story)return false;
  const queued=(await this.deps.database.prepare(`SELECT id,payload FROM production_jobs WHERE session_id=? AND owner_id=? AND kind IN ('${dagTextKind}','${dagDrawKind}') AND state='queued'`).bind(row.id,row.user_id).all<{id:string;payload:string}>()).results;
  if(story.dag.continuation){await this.drop(queued.map(job=>job.id));return true;}
  // 升级转换的故事没有快照：首次安排时以当前设置补记（决策 7：转换的旧故事以转换时的设置作为快照）。
  if(story.confirmed&&!story.dag.modelSnapshot&&!finished(story)&&await this.recordSnapshot(row))return true;
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
   return dagFaultTargets(db.all<FaultTarget>(pendingFaultTargets,row.id,row.user_id));
  });
  if(!refreshed)return true;
  story.faults=refreshed;
  const derived=deriveProduction(story);
  const execution=deriveProductionExecution({version:'current',control:row.generation_control??'active',continuation:!!story.dag.continuation,
   now:this.deps.clock(),stopping:false});
  const items=execution.available?derived.work:[];
  if(row.production_complete!==1&&!items.length&&derived.complete){
   await this.deps.database.prepare("UPDATE stories SET production_complete=1 WHERE id=? AND user_id=? AND production_complete=0 AND document=?").bind(row.id,row.user_id,row.document).run();
  }
  // 正在执行的任务覆盖的实例不再派发新任务：其结果保存后若仍需重做，下一轮再安排。
  const pendingImages=new Set<string>();
  const drawingInput=(item:Work)=>item.call==='draw'&&!story.dag.frames[item.instances[0].key]?.redrawRequested?
   fingerprint(item.instances[0].hard):null;
  const running=new Set((await this.deps.database.prepare(`SELECT payload FROM production_jobs WHERE session_id=? AND owner_id=? AND kind IN ('${dagTextKind}','${dagDrawKind}') AND state='running'`).bind(row.id,row.user_id).all<{payload:string}>()).results
   .flatMap(j=>{
    const {work:item}=JSON.parse(j.payload) as {work:Work};
    const input=drawingInput(item);
    if(input)pendingImages.add(input);
    return item.instances.map(i=>i.id);
   }));
  const retained=new Set<string>();
  for(const job of queued){
   const {work:item,paid}=JSON.parse(job.payload) as {work:Work;paid?:Paid};
   if(!paid||!this.currentDrawingReceipt(story,item)||item.instances.some(instance=>running.has(instance.id)))continue;
   retained.add(job.id);
   const input=drawingInput(item);
   if(input)pendingImages.add(input);
   for(const instance of item.instances)running.add(instance.id);
  }
  const candidates=items.filter(item=>{
   if(item.instances.some(instance=>running.has(instance.id)))return false;
   const input=drawingInput(item);
   if(!input)return true;
   if(pendingImages.has(input))return false;
   pendingImages.add(input);
   return true;
  });
  const specs=this.specs(row,story,candidates,opened);
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
 private specs(row:SessionRow,story:DagStory,items=work(story),opened=false){return items.map((item,i)=>dagJobSpec(row.user_id,story,item,-10+i,opened).spec);}
 private async drop(ids:string[]){const now=this.deps.clock();transact(this.deps.database,db=>{for(const id of ids)deleteJobs(db,"id=? AND state='queued'",[id],now);});}

 /** 已付费成图绑定硬输入。星标等核对输入变化时，仍须保存原已付费成果。 */
 private currentDrawingReceipt(story:DagStory,item:Work){
  if(!drawing(item.call)||stale(story,item))return false;
  const instance=item.instances[0],current=evaluate(stateOf(story)).instance(instance.node,instance.key);
  return current.status!=='valid'&&!current.blocked;
 }

 /** 核对回执的文件；跨版本采用时保留原文件，只记录家族内的媒体引用。 */
 private async readableDrawingReceipt(row:SessionRow,story:DagStory,source:NonNullable<ReturnType<typeof boundDrawingReceipt>>){
  const {sessionId,key,item,paid}=source;
  const target=item.instances[0];
  if(!this.currentDrawingReceipt(story,item))return null;
  let alias:FamilyImage|undefined;
  const verify=async()=>{
   if(sessionId===row.id){
    if(await this.deps.fileLost(key,true))return null;
    return paid.value;
   }
   const page=story.dag.order.indexOf(target.key),asset=await this.deps.media.get(key);
   if(page<0||!asset)return null;
   const bytes=new Uint8Array(await asset.arrayBuffer()),type=mediaType(bytes);
   if(!type||type!==asset.contentType||!await readableImage(bytes))return null;
   const saved=readerImageAsset(row.id,page,imageTypes[type],fingerprint(['family-image',key]));
   alias={alias:saved.key,sessionId:row.id,sourceId:sessionId,ownerId:row.user_id,rootId:story.doc.revision?.rootId??row.id,target:key};
   return saved.url;
  };
  const value=await verify().catch(()=>{throw new JobYield('image-availability');});
  if(!value)return null;
  const entry=paid.entry&&sessionId!==row.id?{...paid.entry,originId:paid.entry.originId??sessionId}:paid.entry;
  return {receipt:{...paid,value,entry},item,alias};
 }

 /** 重试时优先本地采用图片；若当时确实丢失，已授权的任务执行前仍会重查同一回执。 */
 async restorePortraitDrawing(row:SessionRow,fault:ReaderFault,command:RecoveryRequest){
  const read=(db:ReadStatements)=>portraitRecoveryReceipt(db,row,fault);
  const source=this.deps.database.readTransaction?this.deps.database.readTransaction(read):transact(this.deps.database,read);
  if(!source)return null;
  const story=await this.story(row,'skip');
  if(!story)return null;
  const targets=[fault];
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
    if(!writeStoryProducts(db,row.id,row.user_id,document,stored=>db.run(
     "UPDATE stories SET document=?,updated_at=?,production_complete=? WHERE id=? AND user_id=? AND document=?",
     stored,new Date(now).toISOString(),Number(complete),row.id,row.user_id,row.document).changes))
     throw new ReaderError(409,'故事已更新，请刷新后重试恢复。');
   },
  },now);
 }

 /** 普通补绘优先使用同一家族已付费的结果。输入相同的在途任务结束后再判定。 */
 private async revisionDrawingReceipt(row:SessionRow,story:DagStory,item:Work){
  if(item.call!=='draw'||!story.doc.revision||!this.currentDrawingReceipt(story,item))return null;
  const target=item.instances[0];
  if(story.dag.frames[target.key]?.redrawRequested)return null;
  const hash=fingerprint(target.hard),now=this.deps.clock();
  const saved=(await this.deps.database.prepare(`SELECT session_id,
   json_object('work',json_extract(detail,'$.work'),'paid',json_extract(detail,'$.receipt')) AS payload
   FROM production_attempt_events WHERE event='paid-result' AND owner_id=? AND session_id!=?
   AND json_extract(detail,'$.rootId')=? AND json_extract(detail,'$.inputHash')=? ORDER BY sequence DESC`)
   .bind(row.user_id,row.id,story.doc.revision.rootId,hash).all<DrawingRow>()).results;
  for(const candidate of saved){
   const source=boundDrawingReceipt(candidate,target.key,hash);
   const readable=source&&await this.readableDrawingReceipt(row,story,source);
   if(readable)return readable;
  }
  const existing=(await this.deps.database.prepare(`SELECT json_extract(p.content,'$') AS value FROM production_products p
   LEFT JOIN production_media_health m ON m.owner_id=p.owner_id AND m.root_id=p.root_id AND m.url=json_extract(p.content,'$')
   WHERE p.owner_id=? AND p.root_id=? AND p.input_hash=? AND p.target LIKE 'frameImage:%' AND COALESCE(m.readable,1)=1
   ORDER BY p.id DESC`).bind(row.user_id,story.doc.revision.rootId,hash).all<{value:string|null}>()).results;
  for(const {value} of existing){
   const sessionId=value?.split('/')[4],key=sessionId&&value?referenceImageKey(sessionId,value):null;
   if(!sessionId||!key)continue;
   const readable=await this.readableDrawingReceipt(row,story,{sessionId,key,item,paid:{value,model:'',requestId:null,usage:null}});
   if(readable)return readable;
  }
  const previous=(await this.deps.database.prepare(`SELECT j.session_id,j.payload,j.state,j.lease_until
   FROM story_revisions r JOIN production_jobs j ON j.session_id=r.story_id AND j.owner_id=r.owner_id
   WHERE r.owner_id=? AND r.root_id=? AND r.story_id!=? AND j.kind=?
   AND CASE WHEN json_valid(j.payload) THEN json_extract(j.payload,'$.work.call')='draw'
    AND (json_type(j.payload,'$.paid.value')='text' OR (j.state='running' AND j.lease_until>? AND EXISTS(SELECT 1 FROM production_attempt_events sent
     WHERE sent.attempt_id=j.lease_token AND sent.event='sent'))) ELSE 0 END
   ORDER BY j.updated_at DESC,j.id`).bind(row.user_id,story.doc.revision.rootId,row.id,dagDrawKind,now)
   .all<DrawingRow&Pick<ProductionJob,'state'|'lease_until'>>()).results;
  let waiting=false;
  for(const job of previous){
   const {work:prior}=JSON.parse(job.payload) as {work:Work};
   if(fingerprint(prior.instances?.[0]?.hard??null)!==hash)continue;
   const source=boundDrawingReceipt(job,target.key,hash);
   const readable=source&&await this.readableDrawingReceipt(row,story,source);
   if(readable)return readable;
   waiting||=job.state==='running'&&job.lease_until>this.deps.clock();
  }
  if(waiting)throw new JobYield('image-availability');
  return null;
 }

 /** 只有同家族、同一组文字产物及其硬输入完全相同，才能采用已返回的批次。 */
 private async familyTextReceipt(row:SessionRow,story:DagStory,item:Work){
  if(drawing(item.call)||!story.doc.revision)return undefined;
  const previous=await this.deps.database.prepare(`SELECT session_id,json_extract(detail,'$.receipt') AS receipt
   FROM production_attempt_events WHERE event='paid-result' AND owner_id=? AND session_id!=?
   AND json_extract(detail,'$.rootId')=? AND json_extract(detail,'$.inputHash')=? ORDER BY sequence DESC LIMIT 1`)
   .bind(row.user_id,row.id,story.doc.revision.rootId,textWorkHash(item)).first<{session_id:string;receipt:string}>();
  if(!previous)return undefined;
  const receipt=JSON.parse(previous.receipt) as Paid;
  if(receipt.entry)receipt.entry={...receipt.entry,originId:receipt.entry.originId??previous.session_id};
  return receipt;
 }

 private storePaid(job:ProductionJob,receipt:Paid,item:Work,rootId:string,alias?:FamilyImage){
  transact(this.deps.database,db=>{
   const current=db.run("UPDATE production_jobs SET payload=json_set(payload,'$.paid',json(?)) WHERE id=? AND lease_token IS ?",
    JSON.stringify(receipt),job.id,job.lease_token??null);
   if(!current.changes)return;
   if(alias){
    recordFamilyImage(db,alias);
    if(typeof receipt.value==='string')setFamilyImageReadability(db,job.session_id,job.owner_id,receipt.value,true);
   }
   const target=item.call==='draw'?item.instances[0]:undefined;
   const inputHash=target?.hard?fingerprint(target.hard):textWorkHash(item);
   if(target&&inputHash&&!alias&&typeof receipt.value==='string')
    insertFamilyProduct(db,job.owner_id,rootId,target.id,inputHash,productionStorageHash(receipt.value),receipt.value);
   appendProductionAttempt(db,job,'paid-result',this.deps.clock(),{receipt,work:item,rootId,inputHash});
  });
 }

 async run(job:ProductionJob,provider:ReaderProvider){
  const {work:item,paid,setupGeneration,preparationGeneration}=JSON.parse(job.payload) as {work:Work;paid?:Paid;setupGeneration?:number;preparationGeneration?:number};
  const initial=await this.row(job.session_id,job.owner_id);
  const story=initial&&await this.story(initial,item.call==='draw'&&!paid?'for-drawing':'resolve');
  if(!initial||!story||story.doc.intake?.generation!==setupGeneration||
   preparationGeneration!==undefined&&story.dag.preparationGeneration!==preparationGeneration||story.dag.continuation||stale(story,item))return {obsolete:true};
  if(story.dag.repreparing&&item.call!=='prepareSuggestions')throw new JobYield();
  const readablePaid=paid&&drawing(item.call)&&this.currentDrawingReceipt(story,item)&&!await this.paidFileLost(job,paid.value);
  // 尚未付费的任务必须仍属于当前请求。可读的已付费成图沿用派发时的参考图。
  if(!job.recovery_id&&!readablePaid&&!this.specs(initial,story).some(spec=>spec.id===job.id))return {obsolete:true};
  let generated:Awaited<ReturnType<typeof executeWork>>|undefined,usage:Document['usage'][number]|undefined;
  const reused=!readablePaid?await this.revisionDrawingReceipt(initial,story,item):null;
  const existing=reused?.receipt??(paid&&(!drawing(item.call)||readablePaid)?paid:undefined);
  const sharedText=existing?undefined:await this.familyTextReceipt(initial,story,item);
  const reusedText=existing||sharedText?undefined:await reusableTextProducts(this.deps.database,initial.user_id,story,item);
  const receipt=existing??sharedText;
  const rootId=story.doc.revision?.rootId??initial.id;
  if(reused)this.storePaid(job,reused.receipt,item,rootId,reused.alias);
  if(receipt){
   generated={value:receipt.value,model:receipt.model,requestId:receipt.requestId,usage:receipt.usage};usage=receipt.entry;
  }
  if(reusedText)generated={value:reusedText.value,model:'',requestId:null,usage:null};
  if(!generated){
   if(item.call==='draw'&&!story.refSource){
    // 调度可先建立任务；付费绘制前若星标参考图不可读，将错误记录到该任务。
    const reference=await new BookImageReferences(this.deps.database,this.deps.media,initial.user_id).resolve(initial.id,'');
    if(reference)return {obsolete:true};
   }
   if(drawing(item.call)&&await this.checkDrawingReference(initial,story,item))return {obsolete:true};
   generated=await executeWork(provider.generator(),story,item,inputVersion([job.id,job.lease_token]));
   const promptRecordId=generated.promptRecord?await storePromptRecord(this.deps.database,generated.promptRecord):undefined;
   if(item.call!=='verifySource'&&item.call!=='prepareArt')usage={step:item.call==='prepareSuggestions'?'recommend':`dag:${item.call}`,model:generated.model,requestId:generated.requestId,usage:generated.usage,...(promptRecordId?{promptRecordId}:{}),...(generated.reasoningEffort?{reasoningEffort:generated.reasoningEffort}:{})};
   const entry:Paid={value:generated.value,model:generated.model,requestId:generated.requestId,usage:generated.usage,entry:usage};
   this.storePaid(job,entry,item,rootId);
   if(drawing(item.call)){
    if(await this.paidFileLost(job,generated.value)){
     throw new ReaderError(409,'图片服务未返回可读取的图片，请重试本幅。');
    }
   }
  }
  for(let attempt=0;attempt<5;attempt++){
   const row=await this.row(job.session_id,job.owner_id),current=row&&await this.story(row);
   if(!row||!current||current.doc.intake?.generation!==setupGeneration||
    preparationGeneration!==undefined&&current.dag.preparationGeneration!==preparationGeneration||current.dag.continuation)return {obsolete:true};
   if(drawing(item.call)&&!this.currentDrawingReceipt(current,item)||
    (sharedText||reusedText)&&!work(current).some(candidate=>textWorkHash(candidate)===textWorkHash(item)))return {obsolete:true};
   const next=apply(current,reusedText?.work??item,generated!.value,{newId:()=>`f-${randomUUID().slice(0,12)}`});
   if(!next)return {obsolete:true};
   if(reusedText)Object.assign(next.products,reusedText.products);
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

 /** 用作参考图前核对解码，损坏时登记在参考画幅上。 */
 private async checkDrawingReference(row:SessionRow,story:DagStory,item:Work){
  const input=drawInput(story,item);
  if(input.index===0||story.refSource)return false;
  const page=0;
  const key=referenceImageKey(row.id,input.reference);if(!key)return false;
  let lost:boolean;
  try{lost=await this.deps.fileLost(key);}catch{throw new JobYield('image-availability');}
  if(!lost)return false;
  try{await this.checkImage(row,page,input.reference);}
  catch(error){if(!(error instanceof ReaderError&&error.status===409))throw error;}
  return true;
 }

 /** 已付费的绘图结果文件现在读不出：不再采用，须重新绘制。 */
 private async paidFileLost(job:ProductionJob,value:unknown){
  const key=typeof value==='string'?referenceImageKey(job.session_id,value):null;
  if(!key)return true;
  // 暂时读不出不等于文件丢失：不能因此再次付费绘制，改为稍后重试核对，已付费的结果保留在任务里。
  try{return await this.deps.fileLost(key,true);}
  catch{throw new JobYield('image-availability');}
 }


 async checkImage(row:SessionRow,page:number,image:string,options:{superseded?:boolean;recovery?:RecoveryRequest}={}){
  const doc=decodeDocument(row),id=doc.dag?.order[page];
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
   const current=db.get<SessionRow>(`SELECT * FROM story_rows stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,row.id,row.user_id);
   const document=current&&decodeDocument(current),dag=document?.dag;
   const record=dag?.products[product],original=doc.dag?.products[product];
   if(!current||!dag||dag.order[page]!==frameId||dag.frames[frameId]?.image!==image||record?.hash!==original?.hash)
    throw new ReaderError(409,'故事已更新，请刷新后再检查。');
   const fault=db.get<{id:string}>("SELECT id FROM production_faults WHERE session_id=? AND owner_id=? AND kind='image-loss' AND job_id IS NULL AND node='frameImage' AND node_key=? AND state='pending'",row.id,row.user_id,frameId);
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
   setFamilyImageReadability(db,row.id,row.user_id,image,result==='readable');
   if(effect==='mark-lost'){
    if(record)dag.products[product]={...record,readable:false};
    writeStoryProducts(db,row.id,row.user_id,{...document,dag},stored=>db.run('UPDATE stories SET document=?,production_complete=0 WHERE id=? AND user_id=?',stored,row.id,row.user_id).changes);
    if(!fault)db.run("INSERT INTO production_faults(id,session_id,owner_id,kind,node,node_key,input_hash,version,image,message,created_at,updated_at) VALUES(?,?,?,'image-loss','frameImage',?,?,'dag',?,?,?,?)",randomUUID(),row.id,row.user_id,frameId,record?fingerprint(record.inputs):null,image,lostImageMessage(page),now,now);
   }else if(effect==='restore-readable'&&fault){
    if(record){const {readable:_,...restored}=record;void _;dag.products[product]=restored;}
    writeStoryProducts(db,row.id,row.user_id,{...document,dag},stored=>db.run('UPDATE stories SET document=? WHERE id=? AND user_id=?',stored,row.id,row.user_id).changes);
    db.run("UPDATE production_faults SET state='resolved',updated_at=?,command_id=COALESCE(?,command_id) WHERE id=?",now,recovery?.requestId??null,fault.id);
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
  if(done&&row.production_complete!==1)await this.deps.database.prepare("UPDATE stories SET production_complete=1 WHERE id=? AND user_id=? AND production_complete=0 AND document=?").bind(id,ownerId,row.document).run();
  if(!done&&row.production_complete===1)await this.deps.database.prepare("UPDATE stories SET production_complete=0 WHERE id=? AND user_id=? AND production_complete=1 AND document=?").bind(id,ownerId,row.document).run();
 }

 /** 初始化准备或制作稿。已保存的原文和建议由 settle() 采用。 */
 async initialize(row:SessionRow):Promise<boolean>{
  const doc=decodeDocument(row);
  const confirmed=!doc.intake||doc.intake.phase==='confirmed';
  const preparation=preparationPending(doc)||doc.intake?.phase==='confirming';
  if(doc.reselection||doc.dag||!confirmed&&!preparation)return false;
  const selection=selectionSchema.parse(JSON.parse(row.selection));
  const modelSnapshot=confirmed?this.deps.snapshot?.():undefined;
  if(doc.plan||doc.storyboard||doc.draft)return false;
  const base={...emptyDag(),...(modelSnapshot?{modelSnapshot}:{})};
  if(preparationPending(doc)&&doc.original)doc.original=preparationOriginal(doc,selection,doc.original);
  const story={id:row.id,doc,selection,dag:base,confirmed,faults:[]};
  const dag=preparation?settle(story):base;
  const first=preparationPending(doc)?work({...story,dag})[0]:undefined;
  const replacement=first?dagJobSpec(row.user_id,{...story,dag},first,-10).spec:undefined;
  const saved=transact(this.deps.database,db=>{
   const now=this.deps.clock();
   const changes=writeStoryProducts(db,row.id,row.user_id,{...doc,dag},stored=>db.run(
    "UPDATE stories SET document=?,updated_at=? WHERE id=? AND user_id=? AND document=? AND selection=?",
    stored,new Date(now).toISOString(),row.id,row.user_id,row.document,row.selection).changes);
   if(!changes)return false;
   const jobs=db.all<ProductionJob>("SELECT * FROM production_jobs WHERE session_id=? AND owner_id=? AND kind='prepare' AND state!='succeeded' ORDER BY updated_at DESC",row.id,row.user_id);
   const current=jobs.find(job=>(JSON.parse(job.payload) as {setupGeneration?:number}).setupGeneration===doc.intake?.generation);
   if(first&&replacement&&current){
    const old=JSON.parse(current.payload) as {timings?:unknown};
    const state=current.state==='running'?'queued':current.state;
    // 旧任务的中断次数与恢复授权转给第一个缺失节点，重启不能重置自动重放次数。
    const attempts=productionAttemptCount(db,current.id);
    db.run(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,payload,state,priority,attempts,lease_until,error,interrupted,failure_id,recovery_id,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,replacement.id,row.id,row.user_id,replacement.kind,replacement.pool,replacement.version,JSON.stringify({...replacement.payload as object,...(old.timings?{timings:old.timings}:{})}),state,replacement.priority,attempts,current.error,current.interrupted,current.failure_id??null,current.recovery_id??null,current.created_at,now);
    if(attempts)db.run(`INSERT INTO production_attempt_events(owner_id,session_id,job_id,attempt_id,event,recorded_at,detail)
     VALUES(?,?,?,?,'historical',?,json_object('attempts',?))`,row.user_id,row.id,replacement.id,'legacy:'+replacement.id,now,attempts);
    db.run("UPDATE production_faults SET job_id=?,node=?,node_key='',version=?,updated_at=? WHERE job_id=? AND owner_id=? AND state IN ('pending','recovering')",
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
  const doc=row&&decodeDocument(row);
  return doc?.dag?.modelSnapshot;
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
    json_type(document,'$.dag') IS NOT NULL AND COALESCE(json_extract(document,'$.intake.phase'),'confirmed')='confirmed' AS confirmed
    FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,id,ownerId);
   const authorization=authorizeProductionCommand('apply-model',{
    version:row?'current':'superseded',control:row?.generation_control??'active',continuation:false,stopping,
    targetCurrent:!!row?.confirmed,targetReady:!!current&&this.deps.imageSnapshotAvailable?.(current)!==false,
   });
   if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
   // 升级前发起的横图继续沿用原快照，直到读者在横图步骤单独确认更换。
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
   const row=db.get<SessionRow>(`SELECT * FROM story_rows stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,id,ownerId);
   const doc=row?decodeDocument(row):undefined;
   const decision=authorizeProductionCommand('reprepare',{version:row?'current':'superseded',control:row?.generation_control??'active',
    continuation:!!doc?.dag?.continuation,stopping,targetCurrent:true,targetReady:!!doc&&canReprepare(doc)});
   if(!decision.allowed)throw new ReaderError(decision.status,decision.message);
   const dag=doc!.dag!;
   dag.repreparing=true;dag.preparationGeneration=(dag.preparationGeneration??0)+1;
   delete dag.products['suggestions:'];
   writeStoryProducts(db,id,ownerId,doc!,stored=>db.run('UPDATE stories SET document=?,updated_at=? WHERE id=? AND user_id=?',stored,new Date(now).toISOString(),id,ownerId).changes);
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
   const current=db.get<SessionRow>(`SELECT * FROM story_rows stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,row.id,row.user_id);
   const doc=current&&decodeDocument(current);
   if(!current||!doc?.dag)throw new ReaderError(409,'制作版本已更新，请刷新后重试。');
   const story:DagStory={id:row.id,doc,selection:selectionSchema.parse(JSON.parse(current.selection)),dag:doc.dag,confirmed:!doc.intake||doc.intake.phase==='confirmed',
    faults:dagFaultTargets(db.all<FaultTarget>(pendingFaultTargets,row.id,row.user_id))};
   const block=this.reviewBlock(story),targets=[...new Set(block.reasons.filter(item=>item.reason==='limit').map(item=>item.target))];
   const authorization=authorizeProductionCommand('continue-repair',{version:'current',control:current.generation_control??'active',
    continuation:!!doc.dag.continuation,targetCurrent:block.id===faultId,targetReady:story.confirmed&&targets.length>0,stopping:false});
   if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
   doc.dag.repairs=grantRepairs(doc.dag.repairs??newRepairBudget());
   writeStoryProducts(db,row.id,row.user_id,doc,stored=>db.run(
    "UPDATE stories SET document=?,production_complete=0,updated_at=? WHERE id=? AND user_id=?",
    stored,new Date(now).toISOString(),row.id,row.user_id).changes,{now,grant:requestId});
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,created_at,updated_at) VALUES(?,?,?,'continue-repair',?,?,?,?,?)",
    requestId,row.user_id,row.id,fingerprint,JSON.stringify({targets}),faultId,now,now);
  });
 }

 /** 审核调用的运行和失败均按本版当前输入核对。 */
 private reviewRelease(story:DagStory,blockId:string|null|undefined,faults:ReaderFault[],jobs:ProductionJob[]){
  const reviews=new Map(jobs.filter(job=>job.kind===dagTextKind).flatMap(job=>{
   const item=(JSON.parse(job.payload) as {work?:Work}).work;
   return reviewCall(item?.call)&&!stale(story,item!)?[[job.id,job] as const]:[];
  }));
  if([...reviews.values()].some(job=>job.state==='running'))return null;
  const failed=faults.filter(fault=>fault.state==='pending'&&!!fault.job_id&&reviews.get(fault.job_id)?.state==='failed');
  const faultId=blockId??failed[0]?.id;
  const draft=faultId?overrideReview(story,'default'):null;
  return draft&&faultId?{faultId,title:draft.title,reflection:draft.reflection,needsEnding:draft.needsEnding,failed}:null;
 }

 /** 当前失败或待定结论在一个事务中放行，并保存可重放的操作回执。 */
 async override(ownerId:string,id:string,command:ReviewOverride){
  const {requestId,faultId}=command;
  const fingerprint=commandFingerprint(['override',id,faultId,command.ending??null]);
  transact(this.deps.database,db=>{
   const receipt=db.get<{session_id:string;fingerprint:string;action:string;fault_id:string|null;payload:string}>(
    'SELECT session_id,fingerprint,action,fault_id,payload FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
   if(receipt){
    const previous=JSON.parse(receipt.payload) as {version?:number};
    if(receipt.action!=='override'||receipt.session_id!==id||receipt.fault_id!==null&&receipt.fault_id!==faultId||
     (previous.version??0)>=2&&receipt.fingerprint!==fingerprint)throw new ReaderError(409,'这个操作编号已用于其他内容。');
    return;
   }
   const current=db.get<SessionRow>(`SELECT * FROM story_rows stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,id,ownerId);
   const doc=current&&decodeDocument(current);
   const faults=db.all<ReaderFault>("SELECT * FROM production_faults WHERE session_id=? AND owner_id=? AND state='pending' ORDER BY created_at,id",id,ownerId);
   const jobs=db.all<ProductionJob>("SELECT * FROM production_jobs WHERE session_id=? AND owner_id=? AND kind=? AND state IN ('running','failed')",id,ownerId,dagTextKind);
   const story:DagStory|null=current&&doc?.dag?{id,doc,dag:doc.dag,selection:selectionSchema.parse(JSON.parse(current.selection)),
    confirmed:!doc.intake||doc.intake.phase==='confirmed',faults:dagFaultTargets(db.all<FaultTarget>(pendingFaultTargets,id,ownerId))}:null;
   const derived=story&&deriveProduction(story);
   const block=story&&derived&&!derived.work.some(item=>!drawing(item.call))?this.reviewBlock(story,derived.attention):null;
   const release=story&&this.reviewRelease(story,block?.id,faults,jobs);
   const decision=release?.faultId===faultId&&story?overrideReview(story,command.ending):null;
   const authorization=authorizeProductionCommand('override-review',{
    version:current?'current':'superseded',control:current?.generation_control??'active',continuation:!!doc?.dag?.continuation,
    targetCurrent:release?.faultId===faultId,targetReady:!!decision,stopping:false,
   });
   if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
   const {dag,targets}=decision!,now=this.deps.clock();
   writeStoryProducts(db,id,ownerId,{...doc!,dag},stored=>db.run('UPDATE stories SET document=?,production_complete=0,updated_at=? WHERE id=? AND user_id=?',
    stored,new Date(now).toISOString(),id,ownerId).changes);
   for(const fault of release!.failed){
    db.run("UPDATE production_faults SET state='resolved',updated_at=? WHERE id=?",now,fault.id);
    if(fault.job_id)db.run("UPDATE production_jobs SET state='succeeded',result=json_object('reviewOverridden',1),updated_at=? WHERE id=?",now,fault.job_id);
   }
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,created_at,updated_at) VALUES(?,?,?,'override',?,?,?,?,?)",
    requestId,ownerId,id,fingerprint,JSON.stringify({version:3,targets,ending:command.ending}),faultId,now,now);
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
   const waiting=story?(decodeDocument(story)).dag?.continuation:undefined;
   if(db.get('SELECT id FROM stories WHERE id=? AND user_id=?',requestId,ownerId))throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
   const authorization=authorizeProductionCommand('continue',{version:story?'current':'superseded',control:'active',continuation:!!waiting,
    targetCurrent:true,targetReady:true,stopping});
   if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
   const fingerprint=`continue:${commandFingerprint(['continue',id,waiting!.revision])}`;
   db.run(`UPDATE stories SET document=json_remove(document,'$.dag.continuation'),generation_control='active',updated_at=? WHERE id=? AND user_id=?`,new Date(now).toISOString(),id,ownerId);
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
