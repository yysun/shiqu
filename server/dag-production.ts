// 协调器的制作 DAG 路径：document.dag 存在的故事由执行层决定工作，旧流程只服务其余故事，直到切换完成。
// 调度：settle() 的免调用步骤先保存；work() 的每项工作成为一个任务，身份由调用、阶段与各实例派发时的硬输入决定，
// 不再需要的排队任务删除。执行：调用前后各核对一次输入，结果用 apply() 写回，并以文档内容做比较并交换保存，
// 冲突时按最新文档重算，输入已变的结果丢弃。完成判定用 finished()。「已保存，等待继续」期间不派发任何工作。
import {randomUUID} from 'node:crypto';
import {ReaderError,selectionSchema,type Document,type SessionRow} from '../lib/reader-model.ts';
import type {Database} from '../lib/reader-repository.ts';
import {supersededSql} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {storePromptRecord} from '../lib/reader-prompt-store.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {projectDocument,type DagDocument} from '../lib/production-dag/document.ts';
import {settle,work,apply,stale,finished,type DagStory,type Work} from '../lib/production-dag/runner.ts';
import type {Fault} from '../lib/production-dag/engine.ts';
import {executeWork} from './dag-executor.ts';
import {BookImageReferences} from './book-image-reference.ts';
import type {ProductionJob,ProductionQueue,JobSpec} from './production-queue.ts';
import type {LandscapeStatus} from '../lib/reader-production.ts';
import {persistenceError} from '../lib/reader-repository.ts';
import {inputVersion} from './production-queue.ts';

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
  return rows.flatMap(f=>(JSON.parse(f.payload) as {work:Work}).work.instances.map(i=>({id:f.id,node:i.node,key:i.key,state:'pending' as const})));
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
  const id=fingerprint(['dag-job',row.id,item.call,item.stage??0,item.instances.map(i=>[i.id,i.hard??null]),item.issues??null]);
  const page=drawing(item.call)?story.dag.order.indexOf(item.instances[0].key):undefined;
  return {id,sessionId:row.id,ownerId:row.user_id,kind:drawing(item.call)?dagDrawKind:dagTextKind,pool:drawing(item.call)?'image':'text',version:'dag',dependencies:[],
   payload:{work:item,...(page!==undefined?{page}:{}),timingStage:drawing(item.call)?'image':item.call},priority:page??priority};
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
  const specs=items.map((item,i)=>this.spec(row,story,item,-10+i));
  for(const spec of specs)await this.deps.queue.enqueue(spec);
  await this.drop(queued.map(j=>j.id).filter(id=>!specs.some(s=>s.id===id)));
  return true;
 }
 private async drop(ids:string[]){for(const id of ids)await this.deps.database.prepare("DELETE FROM production_jobs WHERE id=? AND state='queued'").bind(id).run();}

 async run(job:ProductionJob,provider:ReaderProvider){
  const item=(JSON.parse(job.payload) as {work:Work}).work;
  const initial=await this.row(job.session_id,job.owner_id);
  const story=initial&&await this.story(initial);
  if(!initial||!story||story.dag.continuation||stale(story,item))return {obsolete:true};
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

 /** 「继续制作」：清除「已保存，等待继续」并恢复后台制作；只有这个动作清除它。 */
 async continue(ownerId:string,id:string){
  const saved=await this.deps.database.prepare(`UPDATE stories SET document=json_remove(document,'$.dag.continuation'),generation_control='active',generation_mode='background',updated_at=?
   WHERE id=? AND user_id=? AND json_type(document,'$.dag.continuation')='object' AND NOT ${supersededSql()} AND ${visible}`)
   .bind(new Date(this.deps.clock()).toISOString(),id,ownerId).run();
  if(!saved.meta.changes)throw new ReaderError(409,'这篇故事没有等待继续的修改，或版本已更新。');
  this.deps.wake();
 }
}
