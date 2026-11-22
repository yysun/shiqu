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
import {projectDocument,type DagDocument} from '../lib/production-dag/document.ts';
import {settle,work,apply,stale,finished,requestFor,drawInput,attention,stateOf,type DagStory,type Work} from '../lib/production-dag/runner.ts';
import {evaluate} from '../lib/production-dag/engine.ts';
import type {Fault} from '../lib/production-dag/engine.ts';
import {executeWork} from './dag-executor.ts';
import {BookImageReferences} from './book-image-reference.ts';
import type {ProductionJob,ProductionQueue,JobSpec} from './production-queue.ts';
import type {LandscapeStatus} from '../lib/reader-production.ts';
import {persistenceError} from '../lib/reader-repository.ts';
import {inputVersion} from './production-queue.ts';
import {randomUUID} from 'node:crypto';
import {lostImageMessage} from './dag-revisions.ts';
import {commandFingerprint} from './reader-commands.ts';

export const dagTextKind='dag',dagDrawKind='dag-draw';
type Deps={database:Database;media:MediaStore;queue:ProductionQueue;clock:()=>number;wake:()=>void;fileLost:(key:string,strict?:boolean)=>Promise<boolean>};
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
  * 待处理的故障按失败任务记录的工作归属到节点实例，只阻断这些实例及依赖它们的工作。
  * 恢复中的故障不阻断：读者授权的恢复任务与同输入的新工作身份相同，不会重复派发。
  */
 private async faults(row:SessionRow):Promise<Fault[]>{
  const rows=(await this.deps.database.prepare(`SELECT f.id,j.payload FROM reader_faults f JOIN production_jobs j ON j.id=f.job_id AND j.session_id=f.session_id AND j.owner_id=f.owner_id
   WHERE f.session_id=? AND f.owner_id=? AND f.state='pending' AND j.kind IN ('${dagTextKind}','${dagDrawKind}')`).bind(row.id,row.user_id).all<{id:string;payload:string}>()).results;
  // 没有任务的图片丢失故障按幅号归属到该幅成图。
  const lost=(await this.deps.database.prepare("SELECT id,page FROM reader_faults WHERE session_id=? AND owner_id=? AND state='pending' AND kind='image-loss' AND job_id IS NULL AND page IS NOT NULL").bind(row.id,row.user_id).all<{id:string;page:number}>()).results;
  const order=(JSON.parse(row.document) as Document).dag?.order??[];
  return [
   ...rows.flatMap(f=>(JSON.parse(f.payload) as {work:Work}).work.instances.map(i=>({id:f.id,node:i.node,key:i.key,state:'pending' as const}))),
   ...lost.flatMap(f=>order[f.page]?[{id:f.id,node:'frameImage',key:order[f.page],state:'pending' as const}]:[]),
  ];
 }

 /** 保存新的 dag 与投影：以读取时的文档为条件，冲突返回 false。 */
 private async save(row:SessionRow,story:DagStory,dag:DagDocument,usage?:Document['usage'][number]){
  const {plan,images}=projectDocument(dag,story.doc.plan);
  const doc:Document={...story.doc,dag,plan,images,...(usage?{usage:[...(story.doc.usage||[]),usage]}:{})};
  const done=finished({...story,dag});
  const saved=await this.deps.database.prepare(`UPDATE stories SET document=?,state=CASE WHEN ?=1 AND state='idle' THEN 'completed' ELSE state END,updated_at=?
   WHERE id=? AND user_id=? AND document=? AND ${visible}`)
   .bind(JSON.stringify(doc),done?1:0,new Date(this.deps.clock()).toISOString(),row.id,row.user_id,row.document).run();
  return saved.meta.changes>0;
 }

 private spec(row:SessionRow,story:DagStory,item:Work,priority:number):JobSpec{
  // 任务身份覆盖本次请求实际读取的全部输入（含来源与核对输入，如修订读取的当前配文与问题），
  // 因此同一产物在来源变化后再次修订会得到新任务；产物有效性仍只按硬输入判断。
  const request=drawing(item.call)?drawInput(story,item):requestFor(story,item);
  const id=fingerprint(['dag-job',row.id,story.doc.intake?.generation??null,item.call,item.stage??0,item.instances.map(i=>[i.id,i.hard??null]),request]);
  const page=drawing(item.call)?story.dag.order.indexOf(item.instances[0].key):undefined;
  return {id,sessionId:row.id,ownerId:row.user_id,kind:drawing(item.call)?dagDrawKind:dagTextKind,pool:drawing(item.call)?'image':'text',version:'dag',dependencies:[],
   // 准备流程的世代与旧任务相同：选题或确认改变世代后，上一世代的任务不再算作当前任务。
   payload:{work:item,...(page!==undefined?{page}:{}),...(story.doc.intake?{setupGeneration:story.doc.intake.generation}:{}),timingStage:drawing(item.call)?'image':item.call},priority:page??priority};
 }

 /** 为一篇故事安排工作；返回 true 表示已由 DAG 路径处理。 */
 async schedule(row:SessionRow):Promise<boolean>{
  const story=await this.story(row);if(!story)return false;
  const queued=(await this.deps.database.prepare(`SELECT id FROM production_jobs WHERE session_id=? AND owner_id=? AND kind IN ('${dagTextKind}','${dagDrawKind}') AND state='queued'`).bind(row.id,row.user_id).all<{id:string}>()).results;
  if(story.dag.continuation){await this.drop(queued.map(j=>j.id));return true;}
  const settled=settle(story);
  if(settled!==story.dag){await this.save(row,story,settled);this.deps.wake();return true;}
  const items=work(story);
  if(!items.length&&finished(story)&&row.state==='idle'){
   await this.deps.database.prepare("UPDATE stories SET state='completed',error=NULL WHERE id=? AND user_id=? AND state='idle' AND document=?").bind(row.id,row.user_id,row.document).run();
  }
  // 正在执行的任务覆盖的实例不再派发新任务：其结果保存后若仍需重做，下一轮再安排。
  const running=new Set((await this.deps.database.prepare(`SELECT payload FROM production_jobs WHERE session_id=? AND owner_id=? AND kind IN ('${dagTextKind}','${dagDrawKind}') AND state='running'`).bind(row.id,row.user_id).all<{payload:string}>()).results
   .flatMap(j=>(JSON.parse(j.payload) as {work:Work}).work.instances.map(i=>i.id)));
  const specs=this.specs(row,story,items.filter(item=>!item.instances.some(i=>running.has(i.id))));
  for(const spec of specs)await this.deps.queue.enqueue(spec);
  // 当前需要的工作与已完成的任务同身份（例如内容改回之前的输入）：重新排队；执行前的当前性核对避免重复付费。
  for(const spec of specs){
   const done=await this.deps.database.prepare("SELECT id FROM production_jobs WHERE id=? AND state='succeeded'").bind(spec.id).first();
   if(done)await this.deps.queue.rerun(spec.id);
  }
  await this.drop(queued.map(j=>j.id).filter(id=>!specs.some(s=>s.id===id)));
  return true;
 }
 private specs(row:SessionRow,story:DagStory,items=work(story)){return items.map((item,i)=>this.spec(row,story,item,-10+i));}
 private async drop(ids:string[]){for(const id of ids)await this.deps.database.prepare("DELETE FROM production_jobs WHERE id=? AND state='queued'").bind(id).run();}

 async run(job:ProductionJob,provider:ReaderProvider){
  const item=(JSON.parse(job.payload) as {work:Work}).work;
  const initial=await this.row(job.session_id,job.owner_id);
  const story=initial&&await this.story(initial);
  if(!initial||!story||story.dag.continuation||stale(story,item))return {obsolete:true};
  // 只执行仍属于当前工作的任务：同一产物已由另一任务完成、或请求读取的内容已变时不再付费重做。读者授权的恢复任务除外。
  if(!job.recovery_id&&!this.specs(initial,story).some(spec=>spec.id===job.id))return {obsolete:true};
  let generated:Awaited<ReturnType<typeof executeWork>>;
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
  const usage={step:`dag:${item.call}`,model:generated.model,requestId:generated.requestId,usage:generated.usage,...(promptRecordId?{promptRecordId}:{}),...(generated.reasoningEffort?{reasoningEffort:generated.reasoningEffort}:{})};
  for(let attempt=0;attempt<5;attempt++){
   const row=await this.row(job.session_id,job.owner_id),current=row&&await this.story(row);
   if(!row||!current||current.dag.continuation)return {obsolete:true};
   const next=apply(current,item,generated.value,{newId:()=>`f-${randomUUID().slice(0,12)}`});
   if(!next)return {obsolete:true};
   if(await this.save(row,current,next,usage)){this.deps.wake();return {applied:item.call};}
  }
  throw new ReaderError(503,'故事正在更新，结果暂未保存，请重试继续。');
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
  if(retry)await this.deps.database.prepare(`DELETE FROM production_jobs WHERE session_id=? AND owner_id=? AND kind='${dagDrawKind}' AND state IN ('succeeded','failed') AND json_extract(payload,'$.work.call')='drawLandscape'`).bind(row.id,row.user_id).run();
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
   const fault=db.get<{id:string}>("SELECT id FROM reader_faults WHERE session_id=? AND owner_id=? AND kind='image-loss' AND job_id IS NULL AND page=? AND state='pending'",row.id,row.user_id,page);
   if(lost){
    if(record)dag.products[product]={...record,readable:false};
    db.run('UPDATE stories SET document=? WHERE id=? AND user_id=?',JSON.stringify({...doc,dag}),row.id,row.user_id);
    if(!fault)db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,page,version,image,message,created_at,updated_at) VALUES(?,?,?,'image-loss',?,'dag',?,?,?,?)",randomUUID(),row.id,row.user_id,page,image,lostImageMessage(page),now,now);
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
  * 整篇状态以引擎判定为准：旧触发器解除图片丢失故障时会按旧规则把故事标为完成（M4.5 删除），这里随即更正。
  */
 async settleState(id:string,ownerId:string){
  const row=await this.row(id,ownerId),story=row&&await this.story(row);
  if(!row||!story)return;
  const done=finished(story);
  if(done&&row.state==='idle')await this.deps.database.prepare("UPDATE stories SET state='completed',error=NULL WHERE id=? AND user_id=? AND state='idle' AND document=?").bind(id,ownerId,row.document).run();
  if(!done&&row.state==='completed')await this.deps.database.prepare("UPDATE stories SET state='idle' WHERE id=? AND user_id=? AND state='completed' AND document=?").bind(id,ownerId,row.document).run();
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
