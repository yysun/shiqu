// 协调器的制作 DAG 路径：document.dag 存在的故事由执行层决定工作，旧流程只服务其余故事，直到切换完成。
// 调度：settle() 的免调用步骤先保存；work() 的每项工作成为一个任务，身份由调用、阶段与各实例派发时的硬输入决定，
// 不再需要的排队任务删除。执行：调用前后各核对一次输入，结果用 apply() 写回，并以文档内容做比较并交换保存，
// 冲突时按最新文档重算，输入已变的结果丢弃。完成判定用 finished()。「已保存，等待继续」期间不派发任何工作。
import {ReaderError,selectionSchema,type Document,type SessionRow} from '../lib/reader-model.ts';
import type {Database} from '../lib/reader-repository.ts';
import {supersededSql} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {storePromptRecord} from '../lib/reader-prompt-store.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {projectDocument,emptyDag,type DagDocument} from '../lib/production-dag/document.ts';
import {convertDocument} from '../lib/production-dag/convert.ts';
import {bookLabel} from '../lib/production-dag/requests.ts';
import {settle,work,apply,stale,finished,requestFor,drawInput,attention,stateOf,type DagStory,type Work} from '../lib/production-dag/runner.ts';
import {evaluate} from '../lib/production-dag/engine.ts';
import type {Fault} from '../lib/production-dag/engine.ts';
import {executeWork} from './dag-executor.ts';
import {BookImageReferences} from './book-image-reference.ts';
import type {ProductionJob,ProductionQueue,JobSpec} from './production-queue.ts';
import type {ModelSnapshot} from '../lib/production-dag/document.ts';
import type {LandscapeStatus} from '../lib/reader-production.ts';
import {persistenceError} from '../lib/reader-repository.ts';
import {inputVersion} from './production-queue.ts';
import {randomUUID} from 'node:crypto';
import {lostImageMessage} from './dag-revisions.ts';
import {commandFingerprint} from './reader-commands.ts';
import {transact,deleteJobs} from './production-records.ts';

export const dagTextKind='dag',dagDrawKind='dag-draw';
type Deps={database:Database;media:MediaStore;queue:ProductionQueue;clock:()=>number;wake:()=>void;snapshot?:()=>ModelSnapshot|undefined;fileLost:(key:string,strict?:boolean)=>Promise<boolean>};
/** 正在阅读的读者：当前页到预读范围内的画幅优先于其他故事的绘图（决策：恢复旧版的阅读优先）。 */
type Paid={value:unknown;model:string;requestId:string|null;usage:unknown;entry:Document['usage'][number]};
export type Viewing={page:number;through:number};
export const viewedPriority=(page:number,viewers:Viewing[])=>{
 // 首幅是其余各幅的参考，只要有人在读这篇故事就一并提前；范围内的画幅按页序先于所有未被阅读的绘图。
 const viewed=viewers.some(v=>page>=v.page&&page<=v.through)||page===0&&viewers.length>0;
 return viewed?page-100:page;
};
const drawing=(call:string)=>call==='draw'||call==='drawLandscape';
const visible="NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id)";

export const hasDag=(row:SessionRow)=>{try{return !!(JSON.parse(row.document) as Document).dag;}catch{return false;}};

export class DagProduction{
 private readonly deps:Deps;
 constructor(deps:Deps){this.deps=deps;}

 private async row(id:string,ownerId:string){return this.deps.database.prepare('SELECT * FROM stories WHERE id=? AND user_id=?').bind(id,ownerId).first<SessionRow>();}

 async story(row:SessionRow):Promise<DagStory|null>{
  const doc=JSON.parse(row.document) as Document;
  if(!doc.dag)return null;
  const selection=selectionSchema.parse(JSON.parse(row.selection));
  const refSource=await new BookImageReferences(this.deps.database,this.deps.media,row.user_id).resolve(row.id,'').catch(()=>'');
  return {id:row.id,doc,selection,dag:doc.dag,confirmed:!doc.intake||doc.intake.phase==='confirmed',faults:await this.faults(row),...(refSource?{refSource}:{})};
 }

 /**
  * 待处理的故障按节点实例阻断：DAG 任务的故障按任务记录的工作逐个归属（批量工作覆盖多个实例），
  * 没有任务的故障（图片丢失、转换的旧故障）按记录的节点与键。可选产物的故障不阻断完成。
  * 恢复中的故障不阻断：读者授权的恢复任务与同输入的新工作身份相同，不会重复派发。
  */
 private async faults(row:SessionRow):Promise<Fault[]>{
  const rows=(await this.deps.database.prepare(`SELECT f.id,f.node,f.node_key,f.optional,j.kind,j.payload FROM reader_faults f LEFT JOIN production_jobs j ON j.id=f.job_id AND j.session_id=f.session_id AND j.owner_id=f.owner_id
   WHERE f.session_id=? AND f.owner_id=? AND f.state='pending'`).bind(row.id,row.user_id).all<{id:string;node:string|null;node_key:string;optional:number;kind:string|null;payload:string|null}>()).results;
  return rows.flatMap(f=>{
   if(f.payload&&(f.kind===dagTextKind||f.kind===dagDrawKind))return (JSON.parse(f.payload) as {work:Work}).work.instances.map(i=>({id:f.id,node:i.node,key:i.key,state:'pending' as const}));
   return f.node?[{id:f.id,node:f.node,key:f.node_key,state:'pending' as const,...(f.optional?{optional:true}:{})}]:[];
  });
 }

 /** 保存新的 dag 与投影：以读取时的文档为条件，冲突返回 false。 */
 private async save(row:SessionRow,story:DagStory,dag:DagDocument,usage?:Document['usage'][number],retainDeleted=false){
  const {plan,images}=projectDocument(dag,story.doc.plan);
  const doc:Document={...story.doc,dag,plan,images,...(usage?{usage:[...(story.doc.usage||[]),usage]}:{})};
  const done=finished({...story,dag});
  const saved=await this.deps.database.prepare(`UPDATE stories SET document=?,state=CASE WHEN ?=1 AND state='idle' THEN 'completed' ELSE state END,updated_at=?
   WHERE id=? AND user_id=? AND document=?${retainDeleted?'':` AND ${visible}`}`)
   .bind(JSON.stringify(doc),done?1:0,new Date(this.deps.clock()).toISOString(),row.id,row.user_id,row.document).run();
  return saved.meta.changes>0;
 }

 private spec(row:SessionRow,story:DagStory,item:Work,priority:number,viewers:Viewing[]=[]):JobSpec{
  // 任务身份覆盖本次请求实际读取的全部输入（含来源与核对输入，如修订读取的当前配文与问题），
  // 因此同一产物在来源变化后再次修订会得到新任务；产物有效性仍只按硬输入判断。
  const request=drawing(item.call)?drawInput(story,item):item.call==='verifySource'?{selection:story.selection}:requestFor(story,item);
  const id=fingerprint(['dag-job',row.id,story.doc.intake?.generation??null,item.call,item.stage??0,item.instances.map(i=>[i.id,i.hard??null]),request]);
  const page=drawing(item.call)?story.dag.order.indexOf(item.instances[0].key):undefined;
  return {id,sessionId:row.id,ownerId:row.user_id,kind:drawing(item.call)?dagDrawKind:dagTextKind,pool:drawing(item.call)?'image':'text',version:'dag',dependencies:[],
   // 准备流程的世代与旧任务相同：选题或确认改变世代后，上一世代的任务不再算作当前任务。
   payload:{work:item,...(page!==undefined?{page}:{}),...(story.doc.intake?{setupGeneration:story.doc.intake.generation}:{}),timingStage:drawing(item.call)?'image':item.call},priority:page===undefined?priority:viewedPriority(page,viewers)};
 }

 /** 为一篇故事安排工作；返回 true 表示已由 DAG 路径处理。 */
 async schedule(row:SessionRow,viewers:Viewing[]=[]):Promise<boolean>{
  const story=await this.story(row);if(!story)return false;
  const queued=(await this.deps.database.prepare(`SELECT id FROM production_jobs WHERE session_id=? AND owner_id=? AND kind IN ('${dagTextKind}','${dagDrawKind}') AND state='queued'`).bind(row.id,row.user_id).all<{id:string}>()).results;
  if(story.dag.continuation){await this.drop(queued.map(j=>j.id));return true;}
  // 升级转换的故事没有快照：首次安排时以当前设置补记（决策 7：转换的旧故事以转换时的设置作为快照）。
  if(!story.dag.modelSnapshot&&await this.recordSnapshot(row))return true;
  const settled=settle(story);
  if(settled!==story.dag){await this.save(row,story,settled);this.deps.wake();return true;}
  const items=work(story);
  if(!items.length&&finished(story)&&row.state==='idle'){
   await this.deps.database.prepare("UPDATE stories SET state='completed',error=NULL WHERE id=? AND user_id=? AND state='idle' AND document=?").bind(row.id,row.user_id,row.document).run();
  }
  // 正在执行的任务覆盖的实例不再派发新任务：其结果保存后若仍需重做，下一轮再安排。
  const running=new Set((await this.deps.database.prepare(`SELECT payload FROM production_jobs WHERE session_id=? AND owner_id=? AND kind IN ('${dagTextKind}','${dagDrawKind}') AND state='running'`).bind(row.id,row.user_id).all<{payload:string}>()).results
   .flatMap(j=>(JSON.parse(j.payload) as {work:Work}).work.instances.map(i=>i.id)));
  const specs=this.specs(row,story,items.filter(item=>!item.instances.some(i=>running.has(i.id))),viewers);
  for(const spec of specs)await this.deps.queue.enqueue(spec);
  // 当前需要的工作与已完成的任务同身份（例如内容改回之前的输入）：重新排队；执行前的当前性核对避免重复付费。
  for(const spec of specs){
   const done=await this.deps.database.prepare("SELECT id FROM production_jobs WHERE id=? AND state='succeeded'").bind(spec.id).first();
   if(done)await this.deps.queue.rerun(spec.id);
  }
  await this.drop(queued.map(j=>j.id).filter(id=>!specs.some(s=>s.id===id)));
  return true;
 }
 private specs(row:SessionRow,story:DagStory,items=work(story),viewers:Viewing[]=[]){return items.map((item,i)=>this.spec(row,story,item,-10+i,viewers));}
 private async drop(ids:string[]){const now=this.deps.clock();transact(this.deps.database,db=>{for(const id of ids)deleteJobs(db,"id=? AND state='queued'",[id],now);});}

 async run(job:ProductionJob,provider:ReaderProvider){
  const item=(JSON.parse(job.payload) as {work:Work}).work;
  const initial=await this.row(job.session_id,job.owner_id);
  const story=initial&&await this.story(initial);
  if(!initial||!story||story.dag.continuation||stale(story,item))return {obsolete:true};
  // 只执行仍属于当前工作的任务：同一产物已由另一任务完成、或请求读取的内容已变时不再付费重做。读者授权的恢复任务除外。
  if(!job.recovery_id&&!this.specs(initial,story).some(spec=>spec.id===job.id))return {obsolete:true};
  if(item.call==='verifySource')return this.verifySource(job,provider,story);
  // 已付费的结果先落在任务记录里再写回故事：保存前崩溃或保存失败后重放，直接采用这份结果，不再付费。
  const paid=(JSON.parse(job.payload) as {paid?:Paid}).paid;
  let generated:Awaited<ReturnType<typeof executeWork>>|undefined,usage:Document['usage'][number]|undefined;
  if(paid&&!(drawing(item.call)&&await this.paidFileLost(job,paid.value))){
   generated={value:paid.value,model:paid.model,requestId:paid.requestId,usage:paid.usage};usage=paid.entry;
  }
  if(!generated){
   try{generated=await executeWork(provider.generator(),story,item,inputVersion([job.id,job.lease_token]));}
   catch(error){
    // 横图是可选产物：失败记在画幅上，不形成阻断完成的故障；读者可重试失败的幅。
    if(item.call!=='drawLandscape'||persistenceError(error))throw error;
    await this.markLandscape(job,item.instances[0].key,error instanceof ReaderError?error.message:provider.safeError(error));
    return {failed:true};
   }
   if(drawing(item.call)){
    const key=typeof generated.value==='string'?referenceImageKey(job.session_id,generated.value):null;
    if(!key||await this.deps.fileLost(key,true)){
     if(item.call==='drawLandscape'){await this.markLandscape(job,item.instances[0].key,'图片服务未返回可读取的横图，请重试本幅。');return {failed:true};}
     throw new ReaderError(409,'图片服务未返回可读取的图片，请重试本幅。');
    }
   }
   const promptRecordId=generated.promptRecord?await storePromptRecord(this.deps.database,generated.promptRecord):undefined;
   usage={step:`dag:${item.call}`,model:generated.model,requestId:generated.requestId,usage:generated.usage,...(promptRecordId?{promptRecordId}:{}),...(generated.reasoningEffort?{reasoningEffort:generated.reasoningEffort}:{})};
   const entry:Paid={value:generated.value,model:generated.model,requestId:generated.requestId,usage:generated.usage,entry:usage};
   await this.deps.database.prepare("UPDATE production_jobs SET payload=json_set(payload,'$.paid',json(?)) WHERE id=? AND lease_token IS ?").bind(JSON.stringify(entry),job.id,job.lease_token??null).run();
  }
  for(let attempt=0;attempt<5;attempt++){
   const row=await this.row(job.session_id,job.owner_id),current=row&&await this.story(row);
   if(!row||!current||current.dag.continuation)return {obsolete:true};
   const next=apply(current,item,generated!.value,{newId:()=>`f-${randomUUID().slice(0,12)}`});
   if(!next)return {obsolete:true};
   // 已付费的结果即使故事已被删除也保存，恢复后不再重复付费。
   if(await this.save(row,current,next,usage!,true)){this.deps.wake();return {applied:item.call};}
  }
  throw new ReaderError(503,'故事正在更新，结果暂未保存，请重试继续。');
 }

 /** 已付费的绘图结果文件现在读不出：不再采用，须重新绘制。 */
 private async paidFileLost(job:ProductionJob,value:unknown){
  const key=typeof value==='string'?referenceImageKey(job.session_id,value):null;
  return !key||await this.deps.fileLost(key,true).catch(()=>true);
 }

 private async markLandscape(job:ProductionJob,key:string,message:string){
  for(let attempt=0;attempt<5;attempt++){
   const row=await this.row(job.session_id,job.owner_id),story=row&&await this.story(row);
   if(!row||!story?.dag.frames[key])return;
   const dag=structuredClone(story.dag);dag.frames[key].landscapeError=message;
   if(await this.save(row,story,dag))return;
  }
 }

 /** 横图状态：由各画幅的横图、请求标记与失败说明得出；只对已完成的故事开放。 */
 async landscapeStatus(row:SessionRow):Promise<LandscapeStatus>{
  const story=(await this.story(row))!,frames=story.dag.order.map(id=>story.dag.frames[id]);
  const images=frames.map(f=>f.landscape||''),failed=frames.flatMap((f,i)=>f.landscapeError?[i+1]:[]);
  const pending=frames.some(f=>f.landscape===''&&!f.landscapeError),ready=images.filter(Boolean).length,available=row.state==='completed';
  const state=pending?'running':ready===frames.length&&frames.length?'completed':ready||failed.length?'partial':'idle';
  const missing=frames.some(f=>f.landscape===undefined);
  return {state,available,total:frames.length,ready,images,failed,
   ...(available&&!pending&&missing?{startToken:inputVersion(['dag-landscape',row.document])}:{}),
   ...(available&&!pending&&failed.length?{retryToken:inputVersion(['dag-landscape-retry',row.document]),error:frames.find(f=>f.landscapeError)!.landscapeError}:{})};
 }

 /** 请求横图：开始时为尚未请求的画幅加请求标记；重试时清除失败说明并作废失败的任务，然后立即安排。 */
 async startLandscape(row:SessionRow,command:{startToken?:string;retryToken?:string}){
  const status=await this.landscapeStatus(row);
  if(!status.available)throw new ReaderError(409,'请先完成当前版本的竖版插图。');
  const story=(await this.story(row))!,dag=structuredClone(story.dag);
  const start=!!status.startToken&&command.startToken===status.startToken,retry=!!status.retryToken&&command.retryToken===status.retryToken;
  if(!start&&!retry)return status;
  for(const id of dag.order){
   const frame=dag.frames[id];
   if(start&&frame.landscape===undefined)frame.landscape='';
   if(retry&&frame.landscapeError){delete frame.landscapeError;frame.landscape='';}
  }
  if(retry)transact(this.deps.database,db=>deleteJobs(db,`session_id=? AND owner_id=? AND kind='${dagDrawKind}' AND state IN ('succeeded','failed') AND json_extract(payload,'$.work.call')='drawLandscape'`,[row.id,row.user_id],this.deps.clock()));
  if(!await this.save(row,story,dag))throw new ReaderError(409,'故事已更新，请刷新后再试。');
  const saved=await this.row(row.id,row.user_id);
  if(saved)await this.schedule(saved);
  this.deps.wake();
  return this.landscapeStatus(saved??row);
 }

 /**
  * 读者端发现图片读不出时的核对：确认丢失则在一个事务中把该幅成图标为不可读并记录图片丢失故障，须读者明确恢复才重绘；
  * 文件恢复可读时同样在一个事务中解除没有任务的丢失故障并恢复成图记录。不改变整篇完成状态，完成只由引擎判定。
  */
 async checkImage(row:SessionRow,page:number,image:string){
  const doc=JSON.parse(row.document) as Document,id=doc.dag?.order[page];
  if(!doc.dag||!id||doc.dag.frames[id]?.image!==image)throw new ReaderError(409,'这幅图片已更新，请刷新后再检查。');
  const key=referenceImageKey(row.id,image);if(!key)throw new ReaderError(409,'图片地址无法核对。');
  let lost:boolean;try{lost=await this.deps.fileLost(key,true);}catch{throw new ReaderError(503,'图片暂时无法读取，请重试检查；尚未重新绘图。');}
  const transaction=this.deps.database.transaction;if(!transaction)throw Error('TRANSACTION_UNAVAILABLE');
  const product=`frameImage:${id}`,now=this.deps.clock();
  transaction.call(this.deps.database,db=>{
   const current=db.get<{document:string}>('SELECT document FROM stories WHERE id=? AND user_id=?',row.id,row.user_id);
   if(!current||current.document!==row.document)throw new ReaderError(409,'故事已更新，请刷新后再检查。');
   const dag=structuredClone(doc.dag!),record=dag.products[product];
   const fault=db.get<{id:string}>("SELECT id FROM reader_faults WHERE session_id=? AND owner_id=? AND kind='image-loss' AND job_id IS NULL AND node='frameImage' AND node_key=? AND state='pending'",row.id,row.user_id,id);
   if(lost){
    if(record)dag.products[product]={...record,readable:false};
    db.run('UPDATE stories SET document=? WHERE id=? AND user_id=?',JSON.stringify({...doc,dag}),row.id,row.user_id);
    if(!fault)db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,image,message,created_at,updated_at) VALUES(?,?,?,'image-loss','frameImage',?,'dag',?,?,?,?)",randomUUID(),row.id,row.user_id,id,image,lostImageMessage(page),now,now);
   }else if(fault){
    if(record){const {readable:_,...restored}=record;void _;dag.products[product]=restored;}
    db.run('UPDATE stories SET document=? WHERE id=? AND user_id=?',JSON.stringify({...doc,dag}),row.id,row.user_id);
    db.run("UPDATE reader_faults SET state='resolved',updated_at=? WHERE id=?",now,fault.id);
   }
  });
  await this.settleState(row.id,row.user_id);
  this.deps.wake();
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

 /**
  * 原文核对：没有准备流程的故事在制作开始时取得已核原文；结果写入文档的 original，产物由 settle() 采用。
  * 取得的原文属于派发时的选择：选择已变时丢弃。
  */
 private async verifySource(job:ProductionJob,provider:ReaderProvider,story:DagStory){
  const generator=provider.generator(),selection=story.selection;
  let original=await generator.prepareOriginal?.(selection,story.id);
  if(!original){
   const result=await generator.original(selection,{sourceReference:`《${bookLabel(selection)}》${selection.storyTitle||''}`},story.id);
   if(!result.source)throw new ReaderError(503,'原文未能核对，暂时无法开始制作。'+result.message);
   original=result.source;
  }
  const saved=await this.deps.database.prepare("UPDATE stories SET document=json_set(document,'$.original',json(?)),updated_at=? WHERE id=? AND user_id=? AND selection=? AND json_type(document,'$.original') IS NULL")
   .bind(JSON.stringify(original),new Date(this.deps.clock()).toISOString(),job.session_id,job.owner_id,JSON.stringify(selection)).run();
  this.deps.wake();
  return saved.meta.changes?{applied:'verifySource'}:{obsolete:true};
 }

 /**
  * 尚无 dag 的故事进入制作 DAG：制作已确认、或没有准备流程时建立 dag；已有旧版内容的按转换规则采用。
  * 返回是否写入；写入后下一轮按新 dag 安排。
  */
 async adopt(row:SessionRow):Promise<boolean>{
  const doc=JSON.parse(row.document) as Document;
  if(doc.dag||doc.reselection||doc.intake&&doc.intake.phase!=='confirmed')return false;
  const selection=selectionSchema.parse(JSON.parse(row.selection));
  // 决策 7：建立 dag 时记录当前模型设置的快照，之后的调用按快照选择模型；没有快照服务（测试替身、只读）时不记录。
  const modelSnapshot=this.deps.snapshot?.();
  const dag=doc.plan||doc.storyboard||doc.draft?convertDocument(doc,selection,{confirmed:true,notes:doc.reviewNotes,...(modelSnapshot?{modelSnapshot}:{})}):{...emptyDag(),...(modelSnapshot?{modelSnapshot}:{})};
  const saved=await this.deps.database.prepare("UPDATE stories SET document=json_set(document,'$.dag',json(?)),updated_at=? WHERE id=? AND user_id=? AND document=?")
   .bind(JSON.stringify(dag),new Date(this.deps.clock()).toISOString(),row.id,row.user_id,row.document).run();
  if(saved.meta.changes)this.deps.wake();
  return saved.meta.changes>0;
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
  return row?(JSON.parse(row.document) as Document).dag?.modelSnapshot:undefined;
 }

 /**
  * 「应用当前模型设置」：在一个事务中核对操作编号、把故事的快照换成当前设置的快照并写入回执；快照不参与任何节点的输入，已有产物不失效。
  * 已受理的编号重放只读回执，不再按重放时的设置改写快照；用于其他故事或其他动作的编号被拒绝。
  */
 async applyCurrentModel(ownerId:string,id:string,requestId:string){
  const current=this.deps.snapshot?.();
  if(!current)throw new ReaderError(409,'当前模型设置不可用，请先在设置中配置生成服务。');
  const now=this.deps.clock();
  transact(this.deps.database,db=>{
   const receipt=db.get<{action:string;session_id:string;fingerprint:string}>('SELECT action,session_id,fingerprint FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
   if(receipt){
    if(receipt.action!=='control'||receipt.session_id!==id||!receipt.fingerprint.startsWith('apply-model:'))throw new ReaderError(409,'这个操作编号已用于其他内容，请重新操作。');
    return;
   }
   if(db.get('SELECT id FROM stories WHERE id=? AND user_id=?',requestId,ownerId))throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
   const changed=db.run(`UPDATE stories SET document=json_set(document,'$.dag.modelSnapshot',json(?)),updated_at=? WHERE id=? AND user_id=? AND json_type(document,'$.dag') IS NOT NULL AND NOT ${supersededSql()} AND ${visible}`,JSON.stringify(current),new Date(now).toISOString(),id,ownerId).changes;
   if(!changed)throw new ReaderError(409,'这篇故事还没有进入制作或已有新版，无法应用模型设置。');
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at) VALUES(?,?,?,'control',?,?,?,?,?)",requestId,ownerId,id,'apply-model:'+commandFingerprint(['apply-model',id,current]),JSON.stringify({action:'apply-model',snapshot:current}),id,now,now);
  });
  this.deps.wake();
 }

 /** 去掉升级时为没有任何内容的故事（仍在准备阶段）写入的空转换 dag；新建的空 dag 与有内容的 dag 不动。 */
 async dropEmpty(row:SessionRow):Promise<boolean>{
  const saved=await this.deps.database.prepare("UPDATE stories SET document=json_remove(document,'$.dag'),updated_at=? WHERE id=? AND user_id=? AND document=? AND json_extract(document,'$.dag.legacy')=1 AND json_array_length(document,'$.dag.order')=0 AND json_type(document,'$.plan')='null'").bind(new Date(this.deps.clock()).toISOString(),row.id,row.user_id,row.document).run();
  if(saved.meta.changes)this.deps.wake();
  return saved.meta.changes>0;
 }

 /** 审片问题的故障标识：由当前需读者处理的结论及其产物指纹决定，结论变化后旧标识不再适用。 */
 async reviewFaultId(row:SessionRow){
  const story=await this.story(row);if(!story)return null;
  const targets=[...new Set((await this.blocking(row)).map(a=>a.target))];
  return targets.length?'review:'+commandFingerprint(['review-fault',row.id,targets.map(t=>[t,story.dag.products[t]?.hash??null])]).slice(0,32):null;
 }

 /** 需读者处理的审片结论：放行只针对这些结论。 */
 async blocking(row:SessionRow){
  const story=await this.story(row);if(!story)return [];
  if(work(story).some(item=>!drawing(item.call)))return [];
  return attention(story);
 }

 /**
  * 放行：在一个事务中核对操作编号与当前需读者处理的结论，只把这些结论标为放行，并写入回执。
  * 可绘图仍由全部结论推导；被放行结论的输入之后改变时，放行随产物失效。
  */
 async override(ownerId:string,id:string,requestId:string,faultId?:string){
  const row=await this.row(id,ownerId);
  if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');
  const targets=[...new Set((await this.blocking(row)).map(a=>a.target))];
  const story=(await this.story(row))!;
  const fingerprint=commandFingerprint(['override',id,targets.map(t=>[t,story.dag.products[t]?.hash??null])]),currentFaultId=await this.reviewFaultId(row);
  transact(this.deps.database,db=>{
   const receipt=db.get<{session_id:string;fingerprint:string;action:string}>('SELECT session_id,fingerprint,action FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
   if(receipt){if(receipt.action!=='override'||receipt.session_id!==id)throw new ReaderError(409,'这个操作编号已用于其他内容，请重新操作。');return;}
   if(!targets.length)throw new ReaderError(409,'这篇故事没有待处理的审片问题。');
   // 放行只针对读者看到的那一条审片问题；之后结论已变化时，旧标识不能放行新的结论。
   if(faultId!==currentFaultId)throw new ReaderError(409,'审核结果已更新，请刷新后再操作。');
   const current=db.get<{document:string}>(`SELECT document FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,id,ownerId);
   if(!current||current.document!==row.document)throw new ReaderError(409,'审核结果已更新，请刷新后再操作。');
   const dag=structuredClone(story.dag);
   for(const target of targets)if(dag.products[target])dag.products[target]={...dag.products[target],overridden:true};
   const now=this.deps.clock();
   db.run('UPDATE stories SET document=?,state=CASE WHEN state=\'failed\' THEN \'idle\' ELSE state END,error=NULL,updated_at=? WHERE id=? AND user_id=?',JSON.stringify({...story.doc,dag}),new Date(now).toISOString(),id,ownerId);
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,created_at,updated_at) VALUES(?,?,?,'override',?,?,?,?)",requestId,ownerId,id,fingerprint,JSON.stringify({targets}),now,now);
  });
  this.deps.wake();
 }

 /** 审片状态：全部结论有效且通过或被放行为 approved；审片停在需读者处理且没有可派发的文字工作为 attention。 */
 async reviewState(row:SessionRow):Promise<'approved'|'attention'|'pending'|null>{
  const story=await this.story(row);if(!story)return null;
  if(evaluate(stateOf(story)).approved())return 'approved';
  const textWork=work(story).some(item=>!drawing(item.call));
  return attention(story).length&&!textWork?'attention':'pending';
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
   if(stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
   const story=db.get<{document:string}>(`SELECT document FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visible}`,id,ownerId);
   if(!story)throw new ReaderError(409,'故事已更新，请刷新后再操作。');
   const waiting=(JSON.parse(story.document) as Document).dag?.continuation;
   if(db.get('SELECT id FROM stories WHERE id=? AND user_id=?',requestId,ownerId))throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
   if(!waiting)throw new ReaderError(409,'这篇故事没有等待继续的修改，或版本已更新。');
   const fingerprint=`continue:${commandFingerprint(['continue',id,waiting.revision])}`;
   db.run(`UPDATE stories SET document=json_remove(document,'$.dag.continuation'),generation_control='active',generation_mode='background',updated_at=? WHERE id=? AND user_id=?`,new Date(now).toISOString(),id,ownerId);
   db.run(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at) VALUES(?,?,?,'control',?,?,?,?,?)`,requestId,ownerId,id,fingerprint,JSON.stringify({action:'continue',revision:waiting.revision}),id,now,now);
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
