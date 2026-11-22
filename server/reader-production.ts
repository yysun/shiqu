// 协调阅读需求与持久化的制作任务：选题查找、准备阶段与制作 DAG。
// 后台查找只追加普通候选批次；旧版本写入的索引候选在本轮查找完成时清除。
// Paid work needs fresh viewer demand or durable background intent; manual control overrides both.
// Scheduling errors never latch: a failed tick dispatches nothing and the next one retries, while
// an unreadable story is skipped alone. Interrupted work resumes within a bounded replay allowance.
// Search has its own one-worker pool; without the story lock it stops when no longer wanted, and
// its failures stay with the search unless a stop interrupted the call.
// 准备和制作都由制作 DAG 安排与执行，故障只阻断依赖它的工作。
// 任务、故障与命令回执的联动在 production-records.ts 的事务中完成，取代迁移 0025 删除的触发器。
// 节拍中的过期任务清理和任务图重建先查覆盖索引与内容修订号，只读取上次检查后有变化的故事全文。
import {productionTimingScope,productionStageDurations} from '../lib/production-timing.ts';
import {randomUUID} from 'node:crypto';
import {ReaderRepository,persistenceError,supersededSql,latestVersionMessage} from '../lib/reader-repository.ts';
import type {Database} from '../lib/reader-repository.ts';
import {ReaderError,readableStory,selectionSchema,view,reviewPassed} from '../lib/reader-model.ts';
import type {Document,SessionRow,SessionView,ProductionAction,Selection} from '../lib/reader-model.ts';
import type {ModelSnapshot} from '../lib/production-dag/document.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import {mediaType} from '../lib/reader-generation-contract.ts';
import {readableImage,readableLandscapeImage} from './reader-image-health.ts';
import {intakeSearch} from '../lib/reader-intake.ts';
import type {IntakeSearch} from '../lib/reader-intake.ts';
import {suggestionBatchSchema,freshSuggestions,maxSuggestionBatches} from '../lib/reader-suggestions.ts';
import type {SuggestionBatch,SuggestionProgress} from '../lib/reader-suggestions.ts';
import {readerMaxFrames} from '../lib/reader-limits.ts';
import {productionReadAhead,productionViewerLeaseMs} from '../lib/reader-production.ts';
import type {LandscapeStatus,ReaderProduction} from '../lib/reader-production.ts';
import {JobYield,ProductionQueue,productionJobId} from './production-queue.ts';
import type {ProductionJob,JobSpec} from './production-queue.ts';
import {authorizeRecovery,authorizeControl,commandReceipt,sessionFaults} from './reader-commands.ts';
import type {ReaderFault} from './reader-commands.ts';
import type {FaultView,RecoveryRequest} from '../lib/reader-recovery.ts';
import {DagProduction,dagTextKind,dagDrawKind} from './dag-production.ts';
import {transact,deleteJobs} from './production-records.ts';
import {errorCode} from '../lib/production-dag/errors.ts';

type Demand={session_id:string;owner_id:string;viewer_id:string;page:number;through_page:number;expires_at:number;runtime_id:string};
type ActiveSearch={round:number;controller:AbortController;startedAt:number;progress?:SuggestionProgress};
type RebuildKey={rev:number;state:string;demands:string;references:number};
type PruneKey={rev:number;queued:number;failed:number};
type StoryRevision={id:string;user_id:string;rev:number};
const revisionJoin='stories s INDEXED BY stories_production_scan LEFT JOIN story_revisions r ON r.story_id=s.id';
// 节拍的轻量查询只读覆盖索引和修订表；INDEXED BY 防止规划器改用主键索引后回表读取大行，索引缺失时直接报错。
export const productionRevisionSql={
 prune:`SELECT s.id,s.user_id,COALESCE(r.rev,0) AS rev,j.queued_count,j.failed_count FROM (
  SELECT session_id,owner_id,COUNT(CASE WHEN state='queued' THEN 1 END) AS queued_count,COUNT(CASE WHEN state='failed' THEN 1 END) AS failed_count
  FROM production_jobs WHERE state IN('queued','failed') GROUP BY session_id,owner_id
 ) j JOIN stories s INDEXED BY stories_production_scan ON s.id=j.session_id AND s.user_id=j.owner_id LEFT JOIN story_revisions r ON r.story_id=s.id`,
 rebuild:`SELECT s.id,s.user_id,s.state,COALESCE(r.rev,0) AS rev FROM ${revisionJoin}
  WHERE s.id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id)`,
};
/** 模型快照服务：记录当前设置的快照；按快照构造提供方，快照服务不可用时返回 null。 */
export type SnapshotService={current():ModelSnapshot|undefined;provider(snapshot:ModelSnapshot):ReaderProvider|null};
export type ProductionOptions={snapshots?:SnapshotService;imageWorkers?:number;now?:()=>number;leaseMs?:number;tickMs?:number;autoStart?:boolean;targetSessionId?:string;stopBeforeImages?:boolean};
type Options=ProductionOptions;
const maxAutomaticAttempts=3;
// 「审片后停止」不得启动任何付费绘图。
const imageKinds=[dagDrawKind];
const searchRound=(job:ProductionJob)=>(JSON.parse(job.payload) as {searchRound?:number}).searchRound;
const attentionMessages:Record<string,string>={
 'hand-edited':'审片问题只能通过修改手改内容解决，请修改、允许自动修订覆盖或放行。',
 limit:'自动修订额度已用完，请手改、继续自动修复或放行。',
 unchanged:'自动修订没有改变内容，请手改或放行。',
 requirements:'验收要求存在冲突或无法从文字分镜判断，请修改验收要求或放行。',
 unrepairable:'审片发现的问题需要读者处理，请手改或放行。',
};
export function configuredImageWorkers(value?:string){
 if(!value?.trim())return 3;
 if(!/^[1-8]$/.test(value.trim()))throw Error('SHIQU_IMAGE_WORKERS must be an integer from 1 to 8');
 return Number(value.trim());
}
export class ReaderProductionCoordinator implements ReaderProduction{
 readonly queue:ProductionQueue;
 readonly repository:ReaderRepository;
 private readonly runtimeId=randomUUID();
 private readonly searches=new Map<string,ActiveSearch>();
 private readonly clock:()=>number;
 private timer:ReturnType<typeof setInterval>|undefined;
 private enabled=false;
 private scheduled:ReturnType<typeof setImmediate>|undefined;
 private ticking:Promise<void>|undefined;
 private stopping=false;
 private closed=false;
 private tickFailing=false;
 private readonly unreadable=new Set<string>();
 private readonly parsedRows=new Map<string,{document:string;selection:string;parsed:{doc:Document;selection:Selection}|null}>();
 private readonly rebuildKeys=new Map<string,RebuildKey>();
 private referenceGeneration=0;
 private readonly pruneKeys=new Map<string,PruneKey>();
 private supersededJobs=new Set<string>();
 private database:Database;
 private provider:ReaderProvider;
 private readonly jobProviders=new Map<string,ReaderProvider>();
 private media:MediaStore;
 private options:Options;
 private readonly dag:DagProduction;
 constructor(database:Database,provider:ReaderProvider,media:MediaStore,options:Options={}){
  if(options.targetSessionId&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options.targetSessionId))throw Error('INVALID_TARGET_SESSION');
  this.database=database;this.provider=provider;this.media=media;this.options=options;
  this.clock=options.now||Date.now;this.repository=new ReaderRepository(database);
  this.queue=new ProductionQueue(database,{
   targetSessionId:options.targetSessionId,
   limits:{search:1,text:1,image:options.imageWorkers??3},now:this.clock,leaseMs:options.leaseMs,
   canRun:job=>this.canRun(job),resumeInterrupted:job=>this.resumeInterrupted(job),onSettled:()=>{for(const id of this.jobProviders.keys())if(!this.queue.tasks.has(id))this.jobProviders.delete(id);this.wake();},
   // 暂停、删除的故事不派发。DAG 任务按节点故障独立阻断。
   candidateFilter:`NOT EXISTS(SELECT 1 FROM stories s WHERE s.id=j.session_id AND s.user_id=j.owner_id AND (s.generation_control!='active' OR (s.state='failed' AND j.kind NOT IN ('${dagTextKind}','${dagDrawKind}') AND NOT EXISTS(SELECT 1 FROM reader_faults f WHERE f.session_id=s.id AND f.owner_id=s.user_id AND f.state='recovering' AND (f.command_id=j.recovery_id OR f.kind='interrupted' AND f.job_id=j.id))) OR EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id)))`,
   skipCandidate:job=>!!options.targetSessionId&&job.session_id!==options.targetSessionId||!!options.stopBeforeImages&&imageKinds.includes(job.kind)||this.supersededJobs.has(job.session_id),
   safeError:(error,job)=>error instanceof ReaderError?error.message:(this.jobProviders.get(job.id)||this.provider).safeError(error),
   errorCode:error=>errorCode(error),
   terminal:error=>error instanceof ReaderError&&error.status<500,
   handlers:{
    discover:{pool:'search',run:job=>this.discover(job)},
    [dagTextKind]:{pool:'text',run:job=>this.runDag(job)},
    [dagDrawKind]:{pool:'image',run:job=>this.runDag(job)},
   },
  });
  this.dag=new DagProduction({database,media,queue:this.queue,clock:this.clock,wake:()=>this.wake(),snapshot:()=>this.snapshotNow(),fileLost:(key,strict,landscape)=>this.fileLost(key,strict,landscape)});
  if(options.autoStart!==false)this.start();
 }
 start(){if(this.enabled||this.stopping||this.closed)return;this.enabled=true;this.timer=setInterval(()=>this.wake(),this.options.tickMs||1000);this.timer.unref();this.wake();}
 private async find(id:string,ownerId:string){return this.database.prepare('SELECT * FROM stories WHERE id=? AND user_id=?').bind(id,ownerId).first<SessionRow>();}
 private async raw(id:string,ownerId:string){
  const row=await this.find(id,ownerId);
  if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');return row;
 }
 private async landscapeEligible(row:SessionRow){
  return row.state==='completed'&&!await this.repository.superseded(row.id,row.user_id)
   &&!await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first();
 }
 async continueAccepted(ownerId:string,id:string,requestId:string){return this.dag.continueAccepted(ownerId,id,requestId);}
 async reviewState(ownerId:string,id:string){return this.dag.reviewState(await this.repository.get(id,ownerId));}
 async landscapeStatus(ownerId:string,id:string):Promise<LandscapeStatus>{
  const row=await this.repository.get(id,ownerId);
  if(this.parsed(row)?.doc.dag)return this.dag.landscapeStatus(row);
  return {state:'idle',available:false,total:0,ready:0,images:[],failed:[]};
 }
 async startLandscape(ownerId:string,id:string,command:{startToken?:string;retryToken?:string}){
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重试。');
  const row=await this.repository.get(id,ownerId);
  if(!this.parsed(row)?.doc.dag)throw new ReaderError(409,'请先完成当前版本的竖版插图。');
  return this.dag.startLandscape(row,command);
 }
 private searchCurrent(row:SessionRow,round:number|undefined){
  const doc=JSON.parse(row.document) as Document;
  if(!doc.intake||doc.plan||doc.intake.phase==='confirmed')return false;
  const search=intakeSearch(doc.intake);return search.state==='searching'&&search.round===round;
 }
 private async searchRunnable(row:SessionRow,round:number|undefined){
  if(this.stopping||!this.readable(row)||row.generation_control!=='active'||!this.searchCurrent(row,round))return false;
  // Background production does not authorize discovery after the picker has closed.
  if(!await this.database.prepare('SELECT viewer_id FROM production_demand WHERE session_id=? AND owner_id=? AND runtime_id=? AND expires_at>? LIMIT 1').bind(row.id,row.user_id,this.runtimeId,this.clock()).first())return false;
  return !await this.repository.superseded(row.id,row.user_id)&&!await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first();
 }
 // 准备流程的世代改变后，上一世代的任务不再是当前任务；查找任务由查找轮次单独核对。
 private generationCurrent(row:SessionRow,job:ProductionJob){
  const generation=this.parsed(row)?.doc.intake?.generation;
  return job.kind==='discover'||generation===undefined||(JSON.parse(job.payload) as {setupGeneration?:number}).setupGeneration===generation;
 }
 private async demands(id?:string){
  id=this.options.targetSessionId||id;
  const viewers=(await this.database.prepare(`SELECT * FROM production_demand WHERE runtime_id=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM stories s WHERE s.id=production_demand.session_id AND s.user_id=production_demand.owner_id AND ${supersededSql('s')})${id?' AND session_id=?':''}`)
   .bind(this.runtimeId,this.clock(),...(id?[id]:[])).all<Demand>()).results;
  const background=(await this.database.prepare(`SELECT id,user_id FROM stories WHERE generation_mode='background' AND generation_control='active' AND state!='completed'
   AND NOT ${supersededSql()} AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id)${id?' AND id=?':''}`)
   .bind(...(id?[id]:[])).all<{id:string;user_id:string}>()).results;
  return [...viewers,...background.map(row=>({session_id:row.id,owner_id:row.user_id,viewer_id:'background',page:0,through_page:readerMaxFrames-1,expires_at:Infinity,runtime_id:this.runtimeId}))];
 }
 private parsed(row:SessionRow){
  const previous=this.parsedRows.get(row.id);
  if(previous&&previous.document===row.document&&previous.selection===row.selection)return previous.parsed;
  const parsed=readableStory(row)?{doc:JSON.parse(row.document) as Document,selection:selectionSchema.parse(JSON.parse(row.selection))}:null;
  this.parsedRows.set(row.id,{document:row.document,selection:row.selection,parsed});return parsed;
 }
 private readable(row:SessionRow){
  if(this.parsed(row))return true;
  if(!this.unreadable.has(row.id)){this.unreadable.add(row.id);console.error('production_story_unreadable',JSON.stringify({id:row.id}));}
  return false;
 }
 private tickFailed(error:unknown){
  if(!this.tickFailing)console.error('production_tick_failed',JSON.stringify({code:(error as {code?:string}|null)?.code||(error instanceof Error?error.name:'UNKNOWN')}));
  this.tickFailing=true;
 }
 private async resumeInterrupted(job:ProductionJob){
  // Attempts count every paid start, so a crash loop stops here and waits for an explicit retry.
  if(this.stopping||job.attempts>=maxAutomaticAttempts)return false;
  const row=await this.raw(job.session_id,job.owner_id);
  if(job.kind==='discover')return this.searchRunnable(row,searchRound(job));
  if(!this.readable(row)||!this.generationCurrent(row,job))return false;
  if(await this.repository.superseded(row.id,row.user_id))return false;
  return row.generation_mode==='background'&&row.generation_control==='active'&&!await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first();
 }
 async control(ownerId:string,id:string,action:ProductionAction,handoffOnly=false,requestId?:string){
  // 「继续制作」的已接受编号先于其他核对重放。
  if(action==='apply-model'){
   if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
   if(!requestId)throw new ReaderError(400,'应用模型设置需要提交操作编号。');
   await this.repository.get(id,ownerId);await this.dag.applyCurrentModel(ownerId,id,requestId);return this.snapshot(ownerId,id);
  }
  if(action==='continue'){
   if(!requestId)throw new ReaderError(400,'继续制作需要提交操作编号。');
   await this.repository.get(id,ownerId);
   this.dag.continue(ownerId,id,requestId,this.stopping);
   return this.snapshot(ownerId,id);
  }
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  await this.repository.get(id,ownerId);
  if(requestId)await authorizeControl(this.database,ownerId,id,requestId,action,this.clock());
  else await this.repository.control(id,ownerId,action,handoffOnly);
  this.wake();return this.snapshot(ownerId,id);
 }
 async managed(ownerId:string,id:string){const saved=await this.database.prepare('SELECT document FROM stories WHERE id=? AND user_id=?').bind(id,ownerId).first<{document:string}>();if(saved&&(JSON.parse(saved.document) as Document).intake)return true;return !!await this.database.prepare("SELECT id FROM production_jobs WHERE owner_id=? AND session_id=? AND kind!='landscape-image' LIMIT 1").bind(ownerId,id).first();}
 async request(ownerId:string,id:string,viewerId:string,page:number,retry=false){return this.demand(ownerId,id,viewerId,page,page+productionReadAhead,retry);}
 async advance(ownerId:string,id:string,throughPage:number,retry:boolean){return this.demand(ownerId,id,'legacy-advance',0,throughPage,retry);}
 private async demand(ownerId:string,id:string,viewerId:string,page:number,throughPage:number,retry:boolean){
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  const row=await this.repository.get(id,ownerId),doc=JSON.parse(row.document) as Document;
  if(row.generation_control!=='active'||await this.repository.superseded(id,ownerId))return this.snapshot(ownerId,id);
  if(doc.plan&&page>=doc.plan.pages.length)throw new ReaderError(400,'请选择有效画幅');
  await this.database.prepare(`INSERT INTO production_demand(session_id,owner_id,viewer_id,page,through_page,expires_at,runtime_id) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(session_id,owner_id,viewer_id) DO UPDATE SET page=excluded.page,through_page=excluded.through_page,expires_at=excluded.expires_at,runtime_id=excluded.runtime_id`)
   .bind(id,ownerId,viewerId,page,Math.min(readerMaxFrames-1,throughPage),this.clock()+productionViewerLeaseMs,this.runtimeId).run();
  if(retry)throw new ReaderError(400,'重试必须提交当前故障实例与操作编号。');
  await this.pruneSuperseded(id);await this.graph(await this.raw(id,ownerId));
  this.wake();return this.snapshot(ownerId,id);
 }
 /** 放行：只更新当前需读者处理的审片结论，可绘图仍由全部结论推导。 */
 async overrideReview(ownerId:string,id:string,command?:RecoveryRequest){
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  if(!command)throw new ReaderError(400,'放行需要提交操作编号。');
  const row=await this.repository.get(id,ownerId);
  if(await this.repository.superseded(id,ownerId))throw new ReaderError(409,latestVersionMessage);
  if(!this.parsed(row)?.doc.dag)throw new ReaderError(409,'这篇故事没有待处理的审片问题。');
  await this.dag.override(ownerId,id,command.requestId,command.faultId);
  this.wake();return this.snapshot(ownerId,id);
 }
 async leave(ownerId:string,id:string,viewerId:string){
  await this.database.prepare('DELETE FROM production_demand WHERE session_id=? AND owner_id=? AND viewer_id=? AND runtime_id=?').bind(id,ownerId,viewerId,this.runtimeId).run();this.wake();
 }
 private faultView(row:SessionRow,fault:ReaderFault,jobs:ProductionJob[]):FaultView{
  const doc=JSON.parse(row.document) as Document,job=jobs.find(job=>job.id===fault.job_id);
  const page=fault.node==='frameImage'||fault.node==='landscape'?doc.dag?.order.indexOf(fault.node_key)??-1:-1;
  const stage=fault.kind==='image-loss'?'redraw':job?.kind==='discover'?'source':job?.kind==='prepare'||doc.legacyFramePreparation||doc.intake&&doc.intake.phase!=='confirmed'?'prepare':'generation';
  return {id:fault.id,message:fault.message,page:page>=0?page:null,stage,state:fault.state as FaultView['state'],retryAllowed:fault.state==='pending'};
 }
 async checkImage(ownerId:string,id:string,page:number,image:string){
  const row=await this.repository.get(id,ownerId),doc=JSON.parse(row.document) as Document;
  if(await this.repository.superseded(id,ownerId))throw new ReaderError(409,latestVersionMessage);
  if(!doc.dag||!doc.images[page]||doc.images[page]!==image)throw new ReaderError(409,'这幅图片已更新，请刷新后再检查。');
  await this.dag.checkImage(row,page,image);
  return this.snapshot(ownerId,id);
 }
 /**
  * 恢复：有任务的故障以本授权重新执行该任务（任务的工作已过时则不付费，由调度重新安排）；
  * 没有任务的故障（图片丢失、转换的旧故障）直接解除，引擎随后重做对应节点。
  */
 async recover(ownerId:string,id:string,command:RecoveryRequest){
  const row=await this.repository.get(id,ownerId);
  const replay=await commandReceipt(this.database,ownerId,command.requestId);
  if(replay){
   if(replay.action!=='recover'||replay.session_id!==id||replay.fault_id!==command.faultId)throw new ReaderError(409,'这个操作编号已用于其他内容。');
   return {...await this.snapshot(ownerId,id),recoveryReceipt:{requestId:command.requestId,status:replay.status,error:replay.error}};
  }
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重试。');
  if(await this.repository.superseded(id,ownerId))throw new ReaderError(409,latestVersionMessage);
  if(row.generation_control!=='active')throw new ReaderError(409,'请先恢复生成许可，再重试或重绘。');
  let fault=(await sessionFaults(this.database,id,ownerId)).find(fault=>fault.id===command.faultId);
  // 图片丢失的恢复：文件在点击前已被恢复时，核对后免费解除，不重新绘制、不付费。
  if(fault?.state==='pending'&&fault.kind==='image-loss'&&!fault.job_id&&fault.node==='frameImage'){
   const doc=JSON.parse(row.document) as Document,page=doc.dag?doc.dag.order.indexOf(fault.node_key):-1,image=page>=0?doc.dag!.frames[fault.node_key]?.image:undefined;
   if(image){
    await this.dag.checkImage(row,page,image).catch(()=>undefined);
    fault=(await sessionFaults(this.database,id,ownerId)).find(f=>f.id===command.faultId);
    if(!fault||fault.state==='resolved')return this.snapshot(ownerId,id);
   }
  }
  if(!fault||fault.state!=='pending')throw new ReaderError(409,'这项问题正在处理或已更新，请刷新后再操作。');
  const job=fault.job_id?await this.queue.job(fault.job_id):null;
  const dag=(JSON.parse(row.document) as Document).dag;
  const resumeUnreviewed=fault.kind==='image-loss'&&fault.node==='frameImage'&&dag?.legacy===true&&Object.values(dag.products).some(product=>product.unreviewed);
  const receipt=job
   ?await authorizeRecovery(this.database,{ownerId,sessionId:id,...command,jobs:[job.id],resolutionJob:job.id,basis:row},this.clock())
   :await authorizeRecovery(this.database,{ownerId,sessionId:id,...command,jobs:[],resolutionJob:'',resolved:true,resumeUnreviewed,basis:row},this.clock());
  if(!job)await this.dag.settleState(id,ownerId);
  // 故障表的变化不改变故事的内容修订号：清除本篇的重建记录，下一轮重新安排工作。
  this.rebuildKeys.delete(id);
  this.wake();return {...await this.snapshot(ownerId,id),recoveryReceipt:{requestId:receipt.request_id,status:receipt.status,error:receipt.error}};
 }
 async snapshot(ownerId:string,id:string):Promise<SessionView>{
  const row=await this.repository.get(id,ownerId),saved=view(row);
  if(row.state!=='completed'&&await this.repository.superseded(id,ownerId))return {...saved,superseded:true,generationControl:'paused',productionState:'paused'};
  return this.snapshotView(row,saved,true);
 }
 async shelfSnapshot(row:SessionRow,saved:SessionView){
  return this.snapshotView(row,saved,false);
 }
 private async snapshotView(row:SessionRow,saved:SessionView,includeTimings:boolean):Promise<SessionView>{
  const id=row.id,allJobs=await this.queue.jobs(row.id,row.user_id),jobs=allJobs.filter(job=>this.generationCurrent(row,job)&&(job.kind!=='discover'||this.parsed(row)?.doc.intake?.phase==='discovering')),faults=await sessionFaults(this.database,row.id,row.user_id);
  const active=jobs.filter(job=>job.state==='running'&&job.lease_until>this.clock()).sort((a,b)=>a.updated_at-b.updated_at);
  // A background search must not supply the selected story step's clock. Renewals only
  // extend leases, leaving the persisted claim timestamp stable across screen visits.
  const phase=saved.generationProgress!.phase,parsed=this.parsed(row)!;
  const current=active.find(job=>phase==='discover'?job.kind==='discover':job.kind!=='discover');
  const timingProvider=current&&(this.jobProviders.get(current.id)||(!this.provider.capture?this.provider:undefined));
  const startedAt=current?.updated_at??null,timeoutMs=timingProvider?.generationTimeoutMs?.(phase);
  const timeoutAt=startedAt!==null&&timeoutMs?startedAt+timeoutMs:null;
  const search=this.searches.get(id);
  const liveProgress=parsed.doc.intake&&search?.round===intakeSearch(parsed.doc.intake).round&&saved.intake?.search.state==='searching'?search.progress:undefined;
  // 任务因快照服务不可用而失败：界面据此提供「应用当前模型设置」。
  const snapshotUnavailable=allJobs.some(job=>job.state==='failed'&&(job as {error_code?:string|null}).error_code==='SNAPSHOT_UNAVAILABLE');
  const session={...saved,...(snapshotUnavailable?{snapshotUnavailable:true as const}:{}),...(saved.intake&&liveProgress?{intake:{...saved.intake,progress:liveProgress}}:{}),generationProgress:{...saved.generationProgress!,startedAt,timeoutAt,...(includeTimings?{stageDurations:productionStageDurations(allJobs,parsed.selection)}:{}),attempt:current?.attempts??saved.generationProgress!.attempt}};
  const working=active.length>0;
  const manual=row.generation_control!=='active';
  const views=faults.map(fault=>this.faultView(row,fault,allJobs));
  // 审片停在需读者处理：以一条审片问题呈现，放行或修改后解除。
  const blocking=parsed.doc.dag&&!working&&row.state!=='completed'?await this.dag.blocking(row):[];
  if(blocking.length)views.push({id:await this.dag.reviewFaultId(row)??'review',message:[...new Set(blocking.map(b=>attentionMessages[b.reason]))].join(''),page:null,stage:'review',state:'pending',retryAllowed:false});
  if(views.length){
   const pending=views.find(f=>f.retryAllowed&&f.stage==='redraw')||views.find(f=>f.retryAllowed)||views[0];
   const recovering=working||faults.some(fault=>fault.state==='recovering');
   return {...session,faults:views,state:recovering?'running':row.state==='completed'?'completed':'failed',error:recovering?null:pending.message,retryAllowed:views.some(f=>f.retryAllowed),retryStage:pending.stage,
    productionState:manual?'paused':recovering?'running':'paused'};
  }
  const failed=jobs.find(job=>job.state==='failed');
  if(failed&&!working)return {...session,state:'failed',error:failed.error,retryAllowed:true};
  const demands=await this.demands(id),eligible=jobs.some(job=>job.state==='queued'&&demands.some(d=>job.pool==='text'||((JSON.parse(job.payload) as {page?:number}).page??0)<=d.through_page));
  // No story is chosen yet, so finding one is what this story is doing.
  if(!manual&&saved.intake?.phase==='discovering'&&saved.intake.search.state==='searching')return {...session,productionState:search?'running':'queued'};
  const productionState=manual?'paused':working?'running':eligible?'queued':'paused';
  const preparingInFlight=working&&(saved.intake?.phase==='preparing'||parsed.doc.legacyFramePreparation);
  if(session.state!=='failed'&&session.state!=='completed'&&(preparingInFlight||!manual&&(working||eligible)))return {...session,state:'running',productionState};
  // A saved session state alone cannot prove that the queue is still executing.
  return {...session,productionState};
 }
 private spec(row:SessionRow,kind:string,pool:string,version:string,key:string,dependencies:string[],payload:unknown,priority:number):JobSpec{
  const {selection}=this.parsed(row)!;
  const timingStage=kind==='discover'?'source':'count';
  return {id:productionJobId(row.id,kind,version,key),sessionId:row.id,ownerId:row.user_id,kind,pool,version,dependencies,payload:{...(payload as Record<string,unknown>),timingStage,timingScope:productionTimingScope(selection,kind==='discover')},priority};
 }
 private async graph(row:SessionRow){
  const {doc}=this.parsed(row)!;
  if(await this.dag.adopt(row))return;
  if(doc.dag&&(!doc.intake||doc.intake.phase==='confirmed')){
   // 正在阅读这篇故事的读者（不含后台与旧入口的推进请求）决定绘图的阅读优先。
   const viewers=(await this.demands(row.id)).filter(d=>d.viewer_id!=='background'&&d.viewer_id!=='legacy-advance').map(d=>({page:d.page,through:d.through_page}));
   await this.dag.schedule(row,viewers);return;
  }
  if(!doc.intake)return;
  const search=intakeSearch(doc.intake),searching=search.state==='searching'&&!doc.plan&&doc.intake.phase!=='confirmed';
  // A record written by an older release has no stored search to fence its result against.
  if(doc.intake.phase==='discovering'&&doc.intake.search?.state!=='searching'){
   await this.database.prepare("UPDATE stories SET document=json_set(document,'$.intake.search',json(?)) WHERE id=? AND user_id=? AND json_extract(document,'$.intake.phase')='discovering' AND COALESCE(json_extract(document,'$.intake.search.round'),0)=?")
    .bind(JSON.stringify({round:search.round+1,state:'searching'}),row.id,row.user_id,search.round).run();
   return;
  }
  if(searching)await this.queue.enqueue(this.spec(row,'discover','search',String(search.round),'',[],{searchRound:search.round},-10));
  if(doc.dag&&['preparing','confirming'].includes(doc.intake.phase))await this.dag.schedule(row);
 }
 private async canRun(job:ProductionJob){
  if(this.options.targetSessionId&&job.session_id!==this.options.targetSessionId||this.options.stopBeforeImages&&imageKinds.includes(job.kind))return false;
  // 有模型快照的 DAG 故事按快照运行，当前全局服务不可用不阻塞；缺少快照服务时仍由 runDag 报告「快照服务不可用」。
  // 先看只读模式：当前设置为只读时 current() 无快照，任何任务都不得派发。
  const snapshotted=(job.kind===dagTextKind||job.kind===dagDrawKind)&&!!this.options.snapshots&&!!this.snapshotNow()&&!!await this.dag.snapshotOf(job);
  if(!snapshotted&&this.provider.capture&&!this.provider.capture())return false;
  const row=await this.raw(job.session_id,job.owner_id);
  if(job.kind==='discover')return this.searchRunnable(row,searchRound(job));
  // 横图是读者对已完成故事的明确请求，不需要阅读需求。
  if(job.kind===dagDrawKind&&(JSON.parse(job.payload) as {work:{call:string}}).work.call==='drawLandscape')return !this.stopping&&await this.landscapeEligible(row);
  if(!this.readable(row)||!this.generationCurrent(row,job))return false;
  if(await this.repository.superseded(row.id,row.user_id))return false;
  if(row.generation_control!=='active')return false;
  if(this.stopping||!(await this.demands(row.id)).some(d=>job.pool==='text'||((JSON.parse(job.payload) as {page?:number}).page??0)<=d.through_page))return false;
  if(await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first())return false;
  // DAG 任务不持有会话锁，结果以文档内容比较并交换保存；故障只阻断依赖它的工作，由调度时的引擎状态决定。
  return job.kind===dagTextKind||job.kind===dagDrawKind;
 }
 private async fileLost(key:string,strict=false,landscape=false){
  const asset=await this.media.get(key);if(!asset)return true;
  const bytes=new Uint8Array(await asset.arrayBuffer()),type=mediaType(bytes);
  // 横图必须是 3∶2；方图等其他比例不能算作完整的印刷套图。
  return (strict?type!==asset.contentType:!type)||!await (landscape?readableLandscapeImage(bytes):readableImage(bytes));
 }
 private async finishSearch(id:string,ownerId:string,round:number,search:IntakeSearch,batch?:SuggestionBatch,clearIndexed=false){
  // The fence refuses a result that arrives after confirmation or after a crash already saved it.
  const phase="'$.intake.phase',CASE WHEN json_extract(document,'$.intake.phase')='discovering' THEN 'choosing' ELSE json_extract(document,'$.intake.phase') END";
  const updated=`json_set(document,'$.intake.search',json(?),${phase})`;
  const indexed=clearIndexed?`json_remove(${updated},'$.intake.indexedCandidates')`:updated;
  const saved=await this.database.prepare(`UPDATE stories SET document=${batch?`json_insert(${indexed},'$.intake.batches[#]',json(?))`:indexed},updated_at=?
   WHERE id=? AND user_id=? AND json_extract(document,'$.intake.search.round')=? AND json_extract(document,'$.intake.search.state')='searching'`)
   .bind(JSON.stringify(search),...(batch?[JSON.stringify(batch)]:[]),new Date(this.clock()).toISOString(),id,ownerId,round).run();
  return saved.meta.changes>0;
 }
 private jobProvider(job:ProductionJob){
  const provider=this.provider.capture?this.provider.capture():this.provider;
  if(!provider)throw new JobYield();this.jobProviders.set(job.id,provider);return provider;
 }
 private snapshotNow(){try{return this.options.snapshots?.current();}catch{return undefined;}}
 /** DAG 任务按故事的模型快照构造提供方；没有快照服务或故事没有快照时沿用当前提供方。 */
 private async runDag(job:ProductionJob){
  const snapshots=this.options.snapshots,snapshot=snapshots&&await this.dag.snapshotOf(job);
  let provider:ReaderProvider;
  if(snapshot&&snapshots){
   // 当前设置为只读时不得发起任何调用，即使故事有可用的快照。
   if(!this.snapshotNow())throw new JobYield();
   // 故事有快照时只看快照服务；当前全局服务不可用不应阻塞这篇故事。
   const savedProvider=snapshots.provider(snapshot);
   if(!savedProvider)throw Object.assign(new ReaderError(409,'快照服务不可用：这篇故事制作时选用的模型服务目前缺少凭据或已不可用。请在设置中恢复该服务，或选择「应用当前模型设置」后再重试。'),{code:'SNAPSHOT_UNAVAILABLE'});
   provider=savedProvider;
   this.jobProviders.set(job.id,provider);
  }else provider=this.jobProvider(job);
  const result=await this.dag.run(job,provider);
  // 星标参考图等输入可能在故事文档未变化时失效。下一轮重新安排当前输入的任务。
  if(result.obsolete)this.rebuildKeys.delete(job.session_id);
  return result;
 }
 private async discover(job:ProductionJob){
  const provider=this.jobProvider(job);
  const round=searchRound(job),row=await this.raw(job.session_id,job.owner_id);
  if(round===undefined||!this.searchCurrent(row,round))return {obsolete:true};
  if(!await this.searchRunnable(row,round))throw new JobYield();
  const doc=JSON.parse(row.document) as Document,intake=doc.intake!,search=intakeSearch(intake),selection=selectionSchema.parse(JSON.parse(row.selection));
  if(!search.cycleId){
   search.cycleId=row.id+'-'+round;
   await this.database.prepare("UPDATE stories SET document=json_set(document,'$.intake.search.cycleId',?) WHERE id=? AND json_extract(document,'$.intake.search.round')=?").bind(search.cycleId,row.id,round).run();
  }
  const excluded=intake.batches.flatMap(batch=>batch.stories),titles=excluded.map(story=>story.title),sources=excluded.flatMap(story=>story.source?[story.source]:[]);
  const active:ActiveSearch={round,controller:new AbortController(),startedAt:this.clock()};this.searches.set(row.id,active);
  try{
   const combining=selection.discovery?.mode==='auto'&&selection.discovery.combine;
   // 旧任务可能仍排在查找队列，补存所选原文后直接交给准备阶段。
   if(combining){
    const original=await provider.generator().prepareOriginal?.(selection,row.id);
    if(!original?.localSource)throw new ReaderError(400,'所选原文不可用，请返回选材。');
    const story={title:'待拟标题',description:'故事梗概准备中',source:original.localSource,sourceLabel:original.title.slice(0,150)};
    const batch={stories:[story],note:''};
    const next={...selection,storyTitle:story.title,source:story.source};
    const updated=await this.database.prepare(`UPDATE stories SET selection=?,document=json_set(document,
     '$.original',json(?),'$.intake.batches',json(?),'$.intake.selected',json(?),'$.intake.phase','preparing','$.intake.search',json(?)),updated_at=?
     WHERE id=? AND user_id=? AND json_extract(document,'$.intake.search.round')=? AND json_extract(document,'$.intake.search.state')='searching'
     AND NOT EXISTS (SELECT 1 FROM library_deletions WHERE story_id=stories.id AND user_id=stories.user_id)`)
     .bind(JSON.stringify(next),JSON.stringify(original),JSON.stringify([batch]),JSON.stringify({batch:0,index:0}),JSON.stringify({...search,state:'idle',error:null}),new Date(this.clock()).toISOString(),row.id,row.user_id,round).run();
    return updated.meta.changes?{batches:1}:{obsolete:true};
   }
   const result=await provider.suggestions(selection,titles,undefined,{signal:active.controller.signal,drain:true,maxStories:1,cycleId:search.cycleId,onProgress:progress=>{active.progress=progress;}},sources);
   const batch=freshSuggestions(suggestionBatchSchema.parse(result),titles,sources);
   const append=intake.batches.length<maxSuggestionBatches;
   // 旧版本写入的索引候选不再使用，本轮完成时一并清除。
   const saved=await this.finishSearch(row.id,row.user_id,round,{...search,state:'idle',error:null},append?batch:undefined,!!intake.indexedCandidates);
   return saved?{batches:intake.batches.length+Number(append)}:{obsolete:true};
  }catch(error){
   if(persistenceError(error))throw error;
   if(!this.searchCurrent(await this.raw(row.id,row.user_id),round))return {obsolete:true};
   const {signal}=active.controller,terminal=error instanceof ReaderError&&error.status<500;
   // Stopping cleanly between calls spends no attempt. A call a stop killed did spend one.
   if(signal.aborted&&error===signal.reason)throw new JobYield();
   if(this.stopping&&!terminal)throw error;
   if(signal.aborted&&!terminal)throw new JobYield();
   await this.finishSearch(row.id,row.user_id,round,{...search,state:'failed',error:error instanceof ReaderError?error.message:provider.safeError(error)});
   return {failed:true};
  }finally{this.searches.delete(row.id);}
 }
 // 准备流程世代或查找轮次已过时的排队与失败任务不再可能执行，删除以免每轮调度都要跳过；其未结故障一并作废。
 private async pruneSuperseded(forceId?:string){
  const candidates=(await this.database.prepare(productionRevisionSql.prune).all<StoryRevision&{queued_count:number;failed_count:number}>()).results;
  const seen=new Set<string>();
  for(const candidate of candidates){
   if(this.options.targetSessionId&&candidate.id!==this.options.targetSessionId)continue;
   seen.add(candidate.id);
   // 修订号与计数都未变时结论不变；只有变化或被指定时才读取全文。
   const key={rev:candidate.rev,queued:candidate.queued_count,failed:candidate.failed_count},previous=this.pruneKeys.get(candidate.id);
   if(forceId!==candidate.id&&previous?.rev===key.rev&&previous.queued===key.queued&&previous.failed===key.failed)continue;
   const row=await this.find(candidate.id,candidate.user_id);
   if(!row)continue;
   if(!this.readable(row)){this.pruneKeys.set(row.id,key);continue;}
   transact(this.database,db=>deleteJobs(db,`session_id=? AND owner_id=? AND state IN('queued','failed') AND EXISTS(SELECT 1 FROM stories s WHERE s.id=production_jobs.session_id AND s.user_id=production_jobs.owner_id
   AND CASE WHEN json_valid(s.document) AND json_type(s.document,'$.intake')='object' THEN
    CASE WHEN production_jobs.kind='discover'
     THEN COALESCE(json_extract(production_jobs.payload,'$.searchRound'),-1)!=CASE WHEN json_extract(s.document,'$.intake.search.state')='searching' THEN json_extract(s.document,'$.intake.search.round') ELSE -2 END
     ELSE COALESCE(json_extract(production_jobs.payload,'$.setupGeneration'),-1)!=json_extract(s.document,'$.intake.generation') END
    ELSE 0 END)`,[row.id,row.user_id],this.clock()));
   this.pruneKeys.set(row.id,key);
  }
  for(const id of this.pruneKeys.keys())if(!seen.has(id))this.pruneKeys.delete(id);
 }
 private async stopUnwantedSearches(){
  for(const [id,search] of this.searches){
   const row=await this.database.prepare('SELECT * FROM stories WHERE id=?').bind(id).first<SessionRow>();
   if(!row||!await this.searchRunnable(row,search.round))search.controller.abort();
  }
 }
 private async settleFailedSearches(){
  const failed=(await this.database.prepare("SELECT * FROM production_jobs WHERE kind='discover' AND state='failed'").all<ProductionJob>()).results;
  for(const job of failed){
   if(this.options.targetSessionId&&job.session_id!==this.options.targetSessionId)continue;
   const row=await this.database.prepare('SELECT * FROM stories WHERE id=? AND user_id=?').bind(job.session_id,job.owner_id).first<SessionRow>(),round=searchRound(job);
   if(row&&!this.readable(row))continue;
   if(row&&round!==undefined&&this.searchCurrent(row,round)){
    if(job.interrupted&&(job.attempts<maxAutomaticAttempts||!await this.searchRunnable(row,round)))continue;
    const search=intakeSearch((JSON.parse(row.document) as Document).intake!);
    await this.finishSearch(row.id,row.user_id,round,{...search,state:'failed',error:job.error});
   }
   transact(this.database,db=>deleteJobs(db,"id=? AND state='failed'",[job.id],this.clock()));
  }
 }
 referencesChanged(){
  // 书籍星标是外部核对输入，没有改写目标故事的文档版本。
  this.referenceGeneration++;
  this.wake();
 }
 wake(){
  if(!this.enabled||this.closed||this.scheduled)return;
  this.scheduled=setImmediate(()=>{this.scheduled=undefined;void this.tick().then(()=>{this.tickFailing=false;},error=>this.tickFailed(error));});
 }
 async tick(){
  if(this.closed)return;if(this.ticking)return this.ticking;
  const work=this.cycle();this.ticking=work;
  try{await work;}finally{if(this.ticking===work)this.ticking=undefined;}
 }
 private async cycle(){
  await this.database.prepare('DELETE FROM production_demand WHERE expires_at<=?'+(this.options.targetSessionId?' AND session_id=?':'')).bind(this.clock(),...(this.options.targetSessionId?[this.options.targetSessionId]:[])).run();
  await this.queue.renew();
  await this.queue.recoverExpired();
  if(!this.stopping){await this.settleFailedSearches();await this.pruneSuperseded();}
  await this.stopUnwantedSearches();
  // A dead runtime cannot renew these locks. Preserve every live session/job lease across processes.
  if(!this.stopping){
   const expired=(await this.database.prepare(`SELECT * FROM stories WHERE state='running' AND lock_until<=? AND generation_mode='background'
    AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id)`).bind(this.clock()).all<SessionRow>()).results;
   for(const row of expired){
    if(this.options.targetSessionId&&row.id!==this.options.targetSessionId)continue;
    if(!this.readable(row))continue;
    const jobs=(await this.queue.jobs(row.id,row.user_id)).filter(job=>this.generationCurrent(row,job));
    if(jobs.some(job=>job.state==='failed'&&!job.interrupted||job.state==='running'&&job.lease_until>this.clock()))continue;
    await this.database.prepare("UPDATE stories SET state='idle',lock_token=NULL,lock_until=0,error=NULL WHERE id=? AND user_id=? AND state='running' AND lock_until<=? AND lock_token IS ? AND document=? AND selection=?")
     .bind(row.id,row.user_id,this.clock(),row.lock_token,row.document,row.selection).run();
   }
  }
  const demands=await this.demands(),seen=new Set<string>();
  const demanded=[...new Set(demands.map(demand=>demand.session_id))];
  const revisions=new Map(demanded.length?(await this.database.prepare(productionRevisionSql.rebuild).bind(JSON.stringify(demanded)).all<StoryRevision&{state:string}>()).results.map(story=>[story.id,story]):[]);
  for(const demand of demands)if(!seen.has(demand.session_id)){
   seen.add(demand.session_id);
   // 已删除或不属于该用户的故事不在轻量结果中，与按 id 读取得到 404 时一样跳过。
   const story=revisions.get(demand.session_id);
   if(!story||story.user_id!==demand.owner_id)continue;
   const key={rev:story.rev,state:story.state,references:this.referenceGeneration,demands:JSON.stringify(demands.filter(d=>d.session_id===story.id&&d.owner_id===story.user_id).map(d=>[d.viewer_id,d.page,d.through_page]).sort())},previous=this.rebuildKeys.get(story.id);
   if(previous?.rev===key.rev&&previous.state===key.state&&previous.demands===key.demands&&previous.references===key.references)continue;
   try{
    const row=await this.repository.get(story.id,story.user_id);
    if(this.readable(row))await this.graph(row);
    this.rebuildKeys.set(row.id,{...key,state:row.state});
   }catch(error){if(!(error instanceof ReaderError&&error.status===404))throw error;}
  }
  for(const id of this.rebuildKeys.keys())if(!seen.has(id))this.rebuildKeys.delete(id);
  const superseded=(await this.database.prepare(`SELECT id FROM stories WHERE generation_control='active' AND EXISTS(SELECT 1 FROM production_jobs j WHERE j.session_id=stories.id AND j.owner_id=stories.user_id AND j.state='queued' AND j.kind!='image-publish' AND (j.kind='discover' OR stories.state!='failed')) AND ${supersededSql()}`).all<{id:string}>()).results;
  this.supersededJobs=new Set(superseded.map(row=>row.id));
  for(const id of this.parsedRows.keys())if(!seen.has(id)&&!this.pruneKeys.has(id))this.parsedRows.delete(id);
  await this.queue.pump();
 }
 stop(){this.stopping=true;this.queue.stop();clearInterval(this.timer);for(const search of this.searches.values())search.controller.abort();}
 get busy(){return !!this.ticking||this.queue.busy||!!this.provider.discoveryBusy?.();}
 async close(){
  this.stop();
  if(this.scheduled){clearImmediate(this.scheduled);this.scheduled=undefined;}
  if(!this.busy){this.closed=true;return;}
  // A scheduling error must not skip closing SQLite; undrained publications resume at next start.
  const attempt=(work:Promise<void>)=>work.catch(error=>this.tickFailed(error));
  if(this.ticking)await attempt(this.ticking);
  do{await attempt(this.tick());await this.queue.settle();await attempt(this.tick());}while(this.queue.busy);
  await this.provider.settleDiscovery?.();
  this.closed=true;
 }
}
