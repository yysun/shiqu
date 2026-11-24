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
import {ReaderRepository,persistenceError,supersededSql,latestVersionMessage,openReplacementParentsSql,shelfRowsSql,visibleStory} from '../lib/reader-repository.ts';
import type {Database,ReadStatements,SyncStatements} from '../lib/reader-repository.ts';
import {ReaderError,readableStory,selectionSchema,view} from '../lib/reader-model.ts';
import type {Document,SessionRow,SessionView,ProductionAction,Selection} from '../lib/reader-model.ts';
import type {ModelSnapshot} from '../lib/production-dag/document.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import {mediaType} from '../lib/reader-generation-contract.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
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
import {authorizeRecovery,authorizeControl,carriedJobFaultGroup,commandReceipt,sessionFaults} from './reader-commands.ts';
import type {ReaderFault} from './reader-commands.ts';
import type {FaultView,RecoveryRequest,ReviewOverride} from '../lib/reader-recovery.ts';
import {canReprepare,DagProduction,dagTextKind,dagDrawKind,landscapeFrames,offersCarriedPortraitRecovery} from './dag-production.ts';
import {bindLegacyLandscapeRequests} from './dag-revisions.ts';
import {transact,deleteJobs,recordJobSucceeded} from './production-records.ts';
import {errorCode} from '../lib/production-dag/errors.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {productionLifecycle,describeProductionCall,authorizeDispatch,authorizeJobLease,authorizeProductionCommand,resolveProductionService,type ProductionFault,type ProductionImageCheck,type ProductionService} from '../lib/production-lifecycle.ts';
import {stateOf,type Work} from '../lib/production-dag/runner.ts';
import {evaluate,type Evaluation} from '../lib/production-dag/engine.ts';
import {carriedJobFaultState,isCarriedReviewFault,unexecutedLandscapeRecovery} from './dag-revision-faults.ts';
import {PaidDispatchDenied,withPaidDispatch} from './paid-dispatch.ts';
import {drawingReferenceBinding} from './book-image-reference.ts';
import {setupState} from './reader-intake.ts';
import {copyAvailability,familyEpoch,revisionAvailability} from './reader-revisions.ts';
import {replacementCommitState} from './reader-reselection.ts';

type Demand={session_id:string;owner_id:string;viewer_id:string;page:number;through_page:number;expires_at:number;runtime_id:string};
type SnapshotInputs={
 row:SessionRow;superseded:boolean;deleted:boolean;replacementOpen:boolean;now:number;
 allJobs:ProductionJob[];faults:ReaderFault[];viewerThrough:number|null;carriedPortraitRecoveries:Set<string>;landscapeDag?:Document['dag'];
 replacementBasis?:ReturnType<typeof replacementCommitState>;
};
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
 'hand-edited':'审片问题只能通过修改手改内容解决，请手动修改或放行。',
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
 private readonly imageReads=new Map<string,number>();
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
 private readonly lostLandscapeChecks=new Map<string,Map<string,{image:string;attempt?:number}>>();
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
   canRun:job=>this.canRun(job),canClaim:(db,job,now)=>this.checkDispatch(db,job,now)==='allow',resumeInterrupted:job=>this.resumeInterrupted(job),onSettled:()=>{for(const id of this.jobProviders.keys())if(!this.queue.tasks.has(id))this.jobProviders.delete(id);this.wake();},
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
 private checkedLandscapeLosses(id:string,dag:Document['dag']){
  const known=this.lostLandscapeChecks.get(id),current=new Set<string>();
  if(!known)return current;
  for(const [key,{image,attempt}] of known){
   const frame=dag?.frames[key];
   if(frame?.landscape===image&&frame.landscapeAttempt===attempt)current.add(key);
   else known.delete(key);
  }
  if(!known.size)this.lostLandscapeChecks.delete(id);
  return current;
 }
 async landscapeStatus(ownerId:string,id:string):Promise<LandscapeStatus>{
  const row=await this.repository.get(id,ownerId);
  const doc=this.parsed(row)?.doc;
  if(doc?.dag){
   const dag=doc.dag;
   const {status,lost:missing}=await this.dag.landscapeProjection(row,this.checkedLandscapeLosses(id,dag));
   // 复用已核对的丢图，直到对应画幅的图片变化或再次核对可读。
   const lost=new Map<string,{image:string;attempt?:number}>();
   for(const key of missing){
    const frame=dag.frames[key];
    if(frame?.landscape)lost.set(key,{image:frame.landscape,attempt:frame.landscapeAttempt});
   }
   if(lost.size)this.lostLandscapeChecks.set(id,lost);
   else this.lostLandscapeChecks.delete(id);
   return this.landscapeControls(row,status);
  }
  return {state:'idle',available:false,total:0,ready:0,images:[],failed:[]};
 }
 async startLandscape(ownerId:string,id:string,command:{startToken?:string;retryToken?:string}){
  const row=await this.repository.get(id,ownerId);
  const status=await this.dag.startLandscape(row,command,this.stopping);
  return this.landscapeControls(await this.repository.get(id,ownerId),status);
 }
 private async landscapeControls(row:SessionRow,status:LandscapeStatus):Promise<LandscapeStatus>{
  const doc=this.parsed(row)?.doc;
  const control=row.generation_control??'active',service=this.serviceAvailability(doc?.dag?.modelSnapshot);
  const superseded=await this.repository.superseded(row.id,row.user_id);
  if(service==='unconfigured'||this.stopping||superseded){
   delete status.startToken;
   delete status.retryToken;
  }
  const action=control==='active'?'pause':'resume';
  const offered=(action==='pause'||service!=='unconfigured')&&authorizeProductionCommand(action,{
   version:superseded?'superseded':'current',control,continuation:!!doc?.dag?.continuation,stopping:this.stopping,
   targetCurrent:true,targetReady:status.available&&status.state==='running',
  }).allowed;
  return {...status,control,service,...(offered?{controlAction:action}:{})};
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
 private generationCurrent(row:SessionRow,job:ProductionJob,evaluation?:Evaluation){
  if(job.kind==='discover')return true;
  const parsed=this.parsed(row),doc=parsed?.doc,generation=doc?.intake?.generation;
  const {setupGeneration,work,landscapeAttempt,preparationGeneration}=JSON.parse(job.payload) as {setupGeneration?:number;work?:Work;landscapeAttempt?:number;preparationGeneration?:number};
  if(work?.call==='drawLandscape'){
   const frame=doc?.dag?.frames[work.instances[0].key];
   if(frame?.landscape!==''||frame.landscapeAttempt!==landscapeAttempt)return false;
   const inputs=evaluation?.state??(frame.landscapeInputHash&&parsed&&doc?.dag?stateOf({id:row.id,doc,dag:doc.dag,selection:parsed.selection,
    confirmed:true,faults:[]}):undefined);
   if(inputs&&!inputs.landscapes?.includes(work.instances[0].key))return false;
  }
  if(preparationGeneration!==undefined&&doc?.dag?.preparationGeneration!==preparationGeneration)return false;
  return generation===undefined||setupGeneration===generation;
 }
 private async demands(id?:string){
  id=this.options.targetSessionId||id;
  const viewers=(await this.database.prepare(`SELECT * FROM production_demand WHERE runtime_id=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM stories s WHERE s.id=production_demand.session_id AND s.user_id=production_demand.owner_id AND ${supersededSql('s')})${id?' AND session_id=?':''}`)
   .bind(this.runtimeId,this.clock(),...(id?[id]:[])).all<Demand>()).results;
  const current=`AND NOT ${supersededSql()} AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id)${id?' AND id=?':''}`;
  // 单幅重绘的横图在竖图完成后接续，用既有横图重绘索引定位待派发的版本。
  const background=(await this.database.prepare(`SELECT id,user_id FROM stories WHERE generation_control='active' AND state!='completed' ${current}
   UNION ALL SELECT id,user_id FROM stories WHERE generation_control='active' AND state='completed'
    AND (CASE WHEN json_valid(document) THEN json_type(document,'$.dag.repreparing')='true'
     OR json_type(document,'$.revision.landscapeRedraw')='array' AND json_type(document,'$.revision.redrawFrame')='text' END)=1 ${current}`)
   .bind(...(id?[id,id]:[])).all<{id:string;user_id:string}>()).results;
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
  return row.generation_control==='active'&&!await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first();
 }
 async control(ownerId:string,id:string,action:ProductionAction,requestId?:string){
  if(action==='reprepare'){
   if(!requestId)throw new ReaderError(400,'重新准备需要提交操作编号。');
   await this.repository.get(id,ownerId);
   this.dag.reprepare(ownerId,id,requestId,this.stopping);
   return this.snapshot(ownerId,id);
  }
  // 「继续制作」的已接受编号先于其他核对重放。
  if(action==='apply-model'){
   if(!requestId)throw new ReaderError(400,'应用模型设置需要提交操作编号。');
   await this.repository.get(id,ownerId);await this.dag.applyCurrentModel(ownerId,id,requestId,this.stopping);return this.snapshot(ownerId,id);
  }
  if(action==='continue'){
   if(!requestId)throw new ReaderError(400,'继续制作需要提交操作编号。');
   await this.repository.get(id,ownerId);
   this.dag.continue(ownerId,id,requestId,this.stopping);
   return this.snapshot(ownerId,id);
  }
  await this.repository.get(id,ownerId);
  if(requestId)await authorizeControl(this.database,ownerId,id,requestId,action,this.clock(),this.stopping);
  else{
   if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
   await this.repository.control(id,ownerId,action);
  }
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
 async overrideReview(ownerId:string,id:string,command?:ReviewOverride){
  if(!command)throw new ReaderError(400,'放行需要提交操作编号。');
  const row=await this.repository.get(id,ownerId);
  const receipt=await commandReceipt(this.database,ownerId,command.requestId);
  if(!receipt&&this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  if(!receipt&&await this.repository.superseded(id,ownerId))throw new ReaderError(409,latestVersionMessage);
  if(!this.parsed(row)?.doc.dag)throw new ReaderError(409,'这篇故事没有待处理的审片问题。');
  await this.dag.override(ownerId,id,command);
  this.wake();return this.snapshot(ownerId,id);
 }
 async leave(ownerId:string,id:string,viewerId:string){
  await this.database.prepare('DELETE FROM production_demand WHERE session_id=? AND owner_id=? AND viewer_id=? AND runtime_id=?').bind(id,ownerId,viewerId,this.runtimeId).run();this.wake();
 }
 private faultView(doc:Document,fault:ReaderFault,job?:ProductionJob):ProductionFault{
  const work=job&&(JSON.parse(job.payload) as {work?:Work}).work;
  const order=doc.dag?.order??[];
  const page=fault.state!=='awaiting-match'&&(fault.node==='frameImage'||fault.node==='landscape')?order.indexOf(fault.node_key):-1;
  const retryReview=job?.kind===dagTextKind&&work?.call==='review'||isCarriedReviewFault(fault);
  const stage=retryReview?'review':fault.kind==='image-loss'&&fault.state!=='awaiting-match'?'redraw':job?.kind==='discover'?'source':work?.call==='prepareSuggestions'||job?.kind==='prepare'||doc.intake&&doc.intake.phase!=='confirmed'?'prepare':'generation';
  const instances=work?.instances??(fault.node?[{node:fault.node,key:fault.node_key}]:[]);
  const targets=instances.map(({node,key})=>{
   const index=order.indexOf(key);
   return {node,key,page:index<0?null:index};
  });
  const kind=fault.kind==='image-loss'||fault.kind==='interrupted'?fault.kind:job?.error_code==='CONTENT_BLOCKED'?'content-blocked':'step-failure';
  const scope=fault.optional||fault.node==='landscape'||work?.call==='drawLandscape'?'optional':'required';
  return {id:fault.id,message:fault.message,page:page>=0?page:null,stage,state:fault.state as FaultView['state'],retryAllowed:fault.state==='pending'&&fault.node!=='landscape',
   kind,scope,targets,...(retryReview?{retryReview:true as const}:{})};
 }
 private imageRecoveryTarget(id:string,doc:Document,fault:ReaderFault){
  if(fault.kind!=='image-loss'||fault.job_id||fault.node!=='frameImage'||!doc.dag)return;
  const page=doc.dag.order.indexOf(fault.node_key),image=doc.dag.frames[fault.node_key]?.image;
  if(page>=0&&image&&referenceImageKey(id,image))return {page,image};
 }
 async checkImage(ownerId:string,id:string,page:number,image:string){
  const row=await this.repository.get(id,ownerId);
  await this.dag.checkImage(row,page,image,{superseded:await this.repository.superseded(id,ownerId)});
  return this.snapshot(ownerId,id);
 }
 /**
  * 恢复：有任务的故障以本授权重新执行该任务（任务的工作已过时则不付费，由调度重新安排）；
  * 没有任务的故障（图片丢失、转换的旧故障）直接解除，引擎随后重做对应节点。
  */
 async recover(ownerId:string,id:string,command:RecoveryRequest,requirePaidService?:()=>Promise<unknown>):Promise<SessionView>{
  const row=await this.repository.get(id,ownerId);
  const replay=await commandReceipt(this.database,ownerId,command.requestId);
  if(replay){
   if(!['recover','continue-repair'].includes(replay.action)||replay.session_id!==id||replay.fault_id!==command.faultId)throw new ReaderError(409,'这个操作编号已用于其他内容。');
   return {...await this.snapshot(ownerId,id),recoveryReceipt:{requestId:command.requestId,status:replay.status,error:replay.error}};
  }
  const repair=command.faultId.startsWith('review:');
  const fault=repair?undefined:(await sessionFaults(this.database,id,ownerId)).find(fault=>fault.id===command.faultId);
  if(fault?.node==='landscape')throw new ReaderError(409,'请在故事设置的横版插图步骤重试横图。');
  const retry=authorizeProductionCommand(repair?'continue-repair':'retry',{
   version:await this.repository.superseded(id,ownerId)?'superseded':'current',control:row.generation_control??'active',
   continuation:!!this.parsed(row)?.doc.dag?.continuation,targetCurrent:repair||fault?.state==='pending',targetReady:true,stopping:this.stopping,
  });
  if(!retry.allowed)throw new ReaderError(retry.status,retry.message);
  if(repair){
   await requirePaidService?.();
   this.dag.grantRepairBudget(row,command.requestId,command.faultId);
   this.wake();
   return {...await this.snapshot(ownerId,id),recoveryReceipt:{requestId:command.requestId,status:'succeeded',error:null}};
  }
  const target=fault!,doc=JSON.parse(row.document) as Document;
  const probe=this.imageRecoveryTarget(id,doc,target);
  // 图片丢失的恢复：文件在点击前已被恢复时，核对后免费解除，不重新绘制、不付费。
  if(probe&&await this.dag.checkImage(row,probe.page,probe.image,{recovery:command})){
    const receipt=(await commandReceipt(this.database,ownerId,command.requestId))!;
    return {...await this.snapshot(ownerId,id),recoveryReceipt:{requestId:receipt.request_id,status:receipt.status,error:receipt.error}};
  }
  const restored=await this.dag.restoreCarriedDrawing(row,target,command);
  if(!restored)await requirePaidService?.();
  const job=!restored&&target.job_id?await this.queue.job(target.job_id):null;
  const dag=doc.dag;
  const resumeUnreviewed=target.kind==='image-loss'&&target.node==='frameImage'&&dag?.legacy===true&&Object.values(dag.products).some(product=>product.unreviewed);
  const receipt=restored??(job
   ?await authorizeRecovery(this.database,{ownerId,sessionId:id,...command,jobs:[job.id],resolutionJob:job.id,basis:row},this.clock())
   :await authorizeRecovery(this.database,{ownerId,sessionId:id,...command,jobs:[],resolutionJob:'',resolved:true,resumeUnreviewed,basis:row},this.clock()));
  if(!job)await this.dag.settleState(id,ownerId);
  // 故障表的变化不改变故事的内容修订号：清除本篇的重建记录，下一轮重新安排工作。
  this.rebuildKeys.delete(id);
  this.wake();return {...await this.snapshot(ownerId,id),recoveryReceipt:{requestId:receipt.request_id,status:receipt.status,error:receipt.error}};
 }
 async snapshot(ownerId:string,id:string):Promise<SessionView>{
  const [input]=this.snapshotInputs(ownerId,id);
  if(!input)throw new ReaderError(404,'这篇故事不在你的书架里');
  return this.snapshotView(input,view(input.row),true);
 }
 async shelfSnapshots(ownerId:string,includeTimings=false):Promise<SessionView[]>{
  return this.snapshotInputs(ownerId).flatMap(input=>{
   let saved:SessionView;
   try{saved=view(input.row);}catch{return [];}
   return [this.snapshotView(input,saved,includeTimings)];
  });
 }
 deletedLifecycles(ownerId:string){
  const lifecycles=new Map<string,NonNullable<SessionView['lifecycle']>>();
  for(const input of this.snapshotInputs(ownerId,undefined,true)){
   if(this.parsed(input.row))lifecycles.set(input.row.id,this.snapshotView(input,view(input.row),false).lifecycle!);
  }
  return lifecycles;
 }
 /** 使用一次读事务截取完成、阻断、书架与活动所依赖的数据。提交后再运行引擎和查询实时服务。 */
 private snapshotInputs(ownerId:string,id?:string,deleted=false):SnapshotInputs[]{
  const read=(db:ReadStatements)=>{
   const now=this.clock();
   const rows=deleted?db.all<SessionRow&{superseded?:number}>(`SELECT *,${supersededSql()} AS superseded FROM stories
    WHERE user_id=? AND NOT (${visibleStory}) AND json_type(document,'$.reselection') IS NULL`,ownerId):
    id===undefined?db.all<SessionRow&{superseded?:number}>(shelfRowsSql,ownerId):
    db.all<SessionRow&{superseded?:number}>(`SELECT *,${supersededSql()} AS superseded FROM stories WHERE id=? AND user_id=? AND ${visibleStory}`,id,ownerId);
   if(!rows.length)return [];
   const ids=JSON.stringify(rows.map(row=>row.id)),bySession='session_id IN (SELECT value FROM json_each(?))';
   const inputs=new Map<string,SnapshotInputs>(rows.map(row=>[row.id,{
    row,superseded:!!row.superseded,deleted,now,replacementOpen:false,allJobs:[],faults:[],viewerThrough:null,carriedPortraitRecoveries:new Set(),
   }]));
   for(const input of inputs.values()){
    const parsed=this.parsed(input.row),dag=parsed?.doc.dag;
    if(parsed?.doc.revision&&dag)input.landscapeDag=bindLegacyLandscapeRequests(db,ownerId,{id:input.row.id,doc:parsed.doc,
     dag,selection:parsed.selection,confirmed:true,faults:[]}).dag;
   }
   for(const job of db.all<ProductionJob>(`SELECT * FROM production_jobs WHERE owner_id=? AND ${bySession} ORDER BY created_at,id`,ownerId,ids))
    inputs.get(job.session_id)!.allJobs.push(job);
   for(const fault of db.all<ReaderFault>(`SELECT * FROM reader_faults f WHERE owner_id=? AND ${bySession}
    AND (state IN ('pending','recovering','awaiting-match') OR ${unexecutedLandscapeRecovery}) ORDER BY created_at,id`,ownerId,ids)){
    const input=inputs.get(fault.session_id)!;
    input.faults.push(fault.state==='resolved'?{...fault,state:'pending'}:fault);
    if(!deleted&&!input.superseded&&offersCarriedPortraitRecovery(db,input.row,fault))input.carriedPortraitRecoveries.add(fault.id);
   }
   for(const demand of db.all<{session_id:string;through:number}>(`SELECT session_id,max(through_page) AS through FROM production_demand
    WHERE owner_id=? AND runtime_id=? AND expires_at>? AND ${bySession} GROUP BY session_id`,ownerId,this.runtimeId,now,ids)){
    if(!this.options.targetSessionId||demand.session_id===this.options.targetSessionId)inputs.get(demand.session_id)!.viewerThrough=demand.through;
   }
   for(const {parentId} of db.all<{parentId:string}>(openReplacementParentsSql(id!==undefined),ownerId,...(id===undefined?[]:[id]))){
    const input=inputs.get(parentId);
    if(input&&!input.superseded)input.replacementOpen=true;
   }
   if(id!==undefined){
    const input=inputs.get(id)!,draft=this.parsed(input.row)?.doc.reselection;
    if(draft){
     const parent=db.get<SessionRow>(`SELECT * FROM stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND ${visibleStory}`,draft.parentId,ownerId);
     const parsed=parent&&this.parsed(parent);
     if(parent&&parsed){
      const {open,unconfirmed}=revisionAvailability(parent,parsed.doc);
      const root=parsed.doc.revision?.rootId||parent.id;
      const epoch=db.get<{epoch:number}>(familyEpoch,ownerId,root,root)!.epoch;
      input.replacementBasis=replacementCommitState(draft,parent,open?{doc:parsed.doc,epoch,intakeGeneration:unconfirmed?.generation}:undefined);
     }
    }
   }
   return [...inputs.values()];
  };
  return this.database.readTransaction?.(read)??transact(this.database,read);
 }
 private snapshotView(input:SnapshotInputs,saved:SessionView,includeTimings:boolean):SessionView{
  const {row,now,allJobs,superseded,replacementOpen,viewerThrough}=input;
  const id=row.id,parsed=this.parsed(row)!;
  const revision=parsed.doc.revision;
  const background=row.generation_control==='active'&&!superseded&&(!this.options.targetSessionId||id===this.options.targetSessionId)&&
   (row.state!=='completed'||!!parsed.doc.dag?.repreparing||Array.isArray(revision?.landscapeRedraw)&&typeof revision.redrawFrame==='string');
  const dag=input.landscapeDag??parsed.doc.dag,checkedLandscapeLosses=this.checkedLandscapeLosses(id,dag);
  const evaluation=dag&&evaluate(stateOf({id,doc:parsed.doc,dag,selection:parsed.selection,confirmed:true,faults:[]}));
  const jobs=allJobs.filter(job=>this.generationCurrent(row,job,evaluation||undefined)&&(job.kind!=='discover'||this.searchCurrent(row,searchRound(job))));
  const eligible=jobs.some(job=>{
   if(job.state!=='queued')return false;
   const payload=JSON.parse(job.payload) as {page?:number;work?:{call:string}};
   return payload.work?.call==='drawLandscape'||background||viewerThrough!==null&&(job.pool==='text'||(payload.page??0)<=viewerThrough);
  });
  const search=this.searches.get(id),progress=saved.generationProgress!;
  const jobsById=new Map(allJobs.map(job=>[job.id,job]));
  const faults=evaluation?input.faults.flatMap<ReaderFault>(fault=>{
   const job=fault.job_id?jobsById.get(fault.job_id):undefined;
   if(fault.node==='landscape'&&(!evaluation.state.landscapes?.includes(fault.node_key)||job&&!this.generationCurrent(row,job,evaluation)))return [];
   if(fault.state!=='pending'||!carriedJobFaultGroup(fault))return [fault];
   const state=carriedJobFaultState(evaluation,fault);
   return state==='replaced'?[]:[{...fault,state}];
  }):input.faults;
  const optionalFrames=dag&&evaluation?landscapeFrames(dag,evaluation,jobs,checkedLandscapeLosses,faults):[];
  const faultGroups=new Map<string,ProductionFault>();
  for(const fault of faults){
   const view=this.faultView(parsed.doc,fault,fault.job_id?jobsById.get(fault.job_id):undefined);
   const group=carriedJobFaultGroup(fault)??fault.id,previous=faultGroups.get(group);
   if(previous){
    previous.targets.push(...view.targets);
    if(view.state==='awaiting-match'){previous.state=view.state;previous.retryAllowed=false;}
   }
   else faultGroups.set(group,view);
  }
  const projectedFaults=[...faultGroups.values()];
  const views:FaultView[]=projectedFaults.filter(fault=>fault.scope==='required');
  const landscapeFaults=parsed.doc.dag?.order.flatMap((key,page):ProductionFault[]=>{
   const message=optionalFrames[page]?.landscapeError;
   if(!message||projectedFaults.some(fault=>fault.targets.some(target=>target.node==='landscape'&&target.key===key)))return [];
   return [{id:`landscape:${key}`,message,page,stage:'generation',state:'pending',retryAllowed:false,kind:checkedLandscapeLosses.has(key)?'image-loss':'step-failure',
    scope:'optional',targets:[{node:'landscape',key,page}]}];
  })??[];
  const failedSearch=parsed.doc.intake&&intakeSearch(parsed.doc.intake);
  const searchFault:ProductionFault|undefined=failedSearch?.state==='failed'&&failedSearch.failureCode&&failedSearch.error?{
   id:`search:${failedSearch.round}`,message:failedSearch.error,page:null,stage:'source',state:'pending',retryAllowed:false,
   kind:failedSearch.failureCode==='CONTENT_BLOCKED'?'content-blocked':'interrupted',scope:'required',targets:[],
  }:undefined;
  const reviewFault=views.find(fault=>fault.retryReview);
  const rawReviewFault=reviewFault&&faults.find(fault=>fault.id===reviewFault.id);
  const failedReviewJob=rawReviewFault&&allJobs.find(job=>job.id===rawReviewFault.job_id);
  const reviewSkip=!superseded&&rawReviewFault&&reviewFault.state==='pending'?this.dag.skipReviewOffer(row,rawReviewFault,failedReviewJob,faults):null;
  const {blocking,complete,review}=this.dag.lifecycleFrom(row,faults,allJobs);
  const reviewAttention:NonNullable<SessionView['lifecycle']>['reviewAttention']=[...(blocking?.reasons??[])];
  const blockedTargets=new Set(reviewAttention.map(reason=>reason.target));
  for(const target of new Set(dag?.issues?.filter(issue=>issue.requiresReplan&&blockedTargets.has(issue.target)).map(issue=>issue.target))){
   reviewAttention.push({target,reason:'replan'});
  }
  const service=this.serviceAvailability(parsed.doc.dag?.modelSnapshot);
  const pendingImageChecks=dag?.order.flatMap((key,page):ProductionImageCheck[]=>{
   const frame=dag.frames[key],checks:ProductionImageCheck[]=[];
   for(const [kind,url] of [['portrait',frame?.image],['landscape',frame?.landscape]] as const){
    const file=url&&referenceImageKey(id,url);
    if(file&&this.imageReads.has(file))checks.push({kind,pages:[page+1],state:'pending'});
   }
   return checks;
  })??[];
  const landscapePending=optionalFrames.some(frame=>frame.landscape===''&&!frame.landscapeError);
  const optionalWork=landscapePending;
  const {doc,selection}=parsed,{intake,reselection}=doc;
  const revisionOptions=revisionAvailability(row,doc),copy=copyAvailability(row,doc,selection);
  const unreviewed=!!dag&&Object.values(dag.products).some(product=>product.unreviewed);
  const savedComplete=row.state==='completed';
  const unrequested=optionalFrames.some(frame=>frame.landscape===undefined);
  const landscapeFailed=optionalFrames.some(frame=>frame.landscapeError);
  const configured=service!=='unconfigured';
  const setup=intake&&configured?{state:setupState(row,doc,selection,superseded,now),generation:intake.generation}:undefined;
  const replacement=reselection&&intake?{parentId:reselection.parentId,generation:intake.generation,commit:{draftCurrent:!superseded,
   generationCurrent:true,candidateExists:configured&&intake.batches.some(batch=>batch.stories.length>0),
   ...(input.replacementBasis??{basisCurrent:false,requirementsCurrent:false})}}:undefined;
  const lifecycle=productionLifecycle({...saved,complete,generationControl:row.generation_control,superseded,deleted:input.deleted,replacementOpen:!!parsed.doc.reselection||replacementOpen,
   faults:[...projectedFaults,...landscapeFaults,...(searchFault?[searchFault]:[])],reviewAttention,review,service,queued:eligible||saved.intake?.phase==='discovering'&&saved.intake.search.state==='searching',
   now,order:dag?.order??[],pendingImageChecks,optionalWork,stopping:this.stopping,canReprepare:canReprepare(doc),repreparing:!!dag?.repreparing,
   setup,replacement,owned:true,imagePages:dag?.order.flatMap((key,page)=>referenceImageKey(id,dag.frames[key]?.image??'')?[page+1]:[]),
   storyActions:[{event:'open-reselection',ready:revisionOptions.open&&configured},
    {event:'edit-revision',ready:revisionOptions.edit},
    {event:'save-revision',ready:configured&&revisionOptions.edit&&!!dag},
    {event:'edit-review-notes',ready:configured&&revisionOptions.edit&&!!dag&&!!doc.plan},
    {event:'redraw',ready:configured&&revisionOptions.edit&&!!dag&&savedComplete&&!unreviewed},
    {event:'cover',ready:configured&&revisionOptions.edit&&!!dag&&savedComplete&&review==='approved'&&!unreviewed},
    {event:'copy',ready:copy.current&&copy.reviewed},{event:'copy-draft',ready:copy.current&&copy.draft},
    {event:'start-landscape',ready:configured&&savedComplete&&!landscapePending&&unrequested},
    {event:'retry-landscape',ready:configured&&savedComplete&&!landscapePending&&landscapeFailed}],
   freeImageRecoveries:new Set(faults.filter(fault=>input.carriedPortraitRecoveries.has(fault.id)||this.imageRecoveryTarget(id,parsed.doc,fault)).map(fault=>fault.id)),
   modelApplicable:!!dag&&(!parsed.doc.intake||parsed.doc.intake.phase==='confirmed')&&!!this.snapshotNow()&&
    (parsed.doc as Document&{legacyFramePreparation?:unknown}).legacyFramePreparation==null,
   reviewBlockId:blocking?.id??undefined,canOverrideReview:!!blocking?.canOverride,reviewSkipId:reviewSkip?.faultId},jobs);
  const active=lifecycle.activity.state==='running'?lifecycle.activity.jobs:[];
  const current=active[0],description=current&&describeProductionCall(current.call,current.pages,progress.repairPasses??0);
  const phase=description?.phase??progress.phase;
  const timingProvider=current&&(this.jobProviders.get(current.id)||(!this.provider.capture?this.provider:undefined));
  const startedAt=current?.startedAt??null,timeoutMs=timingProvider?.generationTimeoutMs?.(phase);
  const timeoutAt=startedAt!==null&&timeoutMs?startedAt+timeoutMs:null;
  const liveProgress=parsed.doc.intake&&search?.round===intakeSearch(parsed.doc.intake).round&&saved.intake?.search.state==='searching'?search.progress:undefined;
  const snapshotUnavailable=service==='snapshot-unavailable';
  const session:SessionView={...saved,lifecycle,...(reviewSkip&&lifecycle.actions.some(action=>action.event==='skip-review')?{reviewSkip}:{}),...(blocking?.issues.length?{reviewIssues:blocking.issues}:{}),...(superseded?{superseded:true}:{}),...(snapshotUnavailable?{snapshotUnavailable:true as const}:{}),
   ...(description?.label?{stage:`正在${description.label}`}:{}),
   ...(saved.intake&&liveProgress?{intake:{...saved.intake,progress:liveProgress}}:{}),
   generationProgress:{...progress,phase,activity:current?description?.label:progress.activity,startedAt,timeoutAt,
    ...(includeTimings?{stageDurations:productionStageDurations(allJobs,parsed.selection)}:{}),attempt:current?.attempt??progress.attempt}};
  // 兼容旧字段。历史版本的真实控制和收尾活动保存在 lifecycle。
  if(superseded&&row.state!=='completed')return {...session,generationControl:'paused',productionState:'paused'};
  const working=active.length>0;
  const manual=lifecycle.control!=='active';
  // 审片停在需读者处理：以一条审片问题呈现，放行或修改后解除。
  if(blocking?.id)views.push({id:blocking.id,message:[...new Set(blocking.reasons.map(b=>attentionMessages[b.reason]))].join(''),page:null,stage:'review',state:'pending',retryAllowed:blocking.reasons.some(b=>b.reason==='limit')});
  if(views.length){
   const pending=views.find(f=>f.retryAllowed&&f.stage==='redraw')||views.find(f=>f.retryAllowed)||views[0];
   const recovering=working||faults.some(fault=>fault.state==='recovering');
   return {...session,faults:views,state:recovering?'running':row.state==='completed'?'completed':'failed',error:recovering?null:pending.message,retryAllowed:views.some(f=>f.retryAllowed),retryStage:pending.stage,
    productionState:manual?'paused':recovering?'running':'paused'};
  }
  const failed=jobs.find(job=>job.state==='failed'&&(JSON.parse(job.payload) as {work?:Work}).work?.call!=='drawLandscape');
  if(failed&&!working)return {...session,state:'failed',error:failed.error,retryAllowed:true};
  // No story is chosen yet, so finding one is what this story is doing.
  if(!manual&&saved.intake?.phase==='discovering'&&saved.intake.search.state==='searching')return {...session,productionState:search?'running':'queued'};
  const productionState=manual?'paused':working?'running':lifecycle.activity.state==='queued'?'queued':'paused';
  const preparingInFlight=working&&saved.intake?.phase==='preparing';
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
 private checkDispatch(db:SyncStatements,job:ProductionJob,now:number){
  const row=db.get<SessionRow&{superseded:number;deleted:number}>(`SELECT *,
   ${supersededSql()} AS superseded,EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id) AS deleted
   FROM stories WHERE id=? AND user_id=?`,job.session_id,job.owner_id);
  if(!row||!this.parsed(row))return 'obsolete';
  const {doc}=this.parsed(row)!;
  const discover=job.kind==='discover';
  const {page,work,waitingFor}=JSON.parse(job.payload) as {page?:number;work?:{call:string};waitingFor?:string};
  if(job.state==='queued'&&waitingFor==='image-availability'&&job.updated_at+Math.max(1000,this.options.tickMs??1000)>now)return 'yield';
  const landscape=work?.call==='drawLandscape';
  const demand=(!discover&&(row.state!=='completed'||!!doc.dag?.repreparing))||(landscape&&row.state==='completed')||
   !!db.get('SELECT 1 FROM production_demand WHERE session_id=? AND owner_id=? AND runtime_id=? AND expires_at>? AND (? OR through_page>=?) LIMIT 1',
    row.id,row.user_id,this.runtimeId,now,discover||job.pool==='text'?1:0,page??0);
  return authorizeDispatch({version:row.superseded?'superseded':row.deleted?'deleted':'current',
   control:row.generation_control??'active',continuation:!!doc.dag?.continuation,
   generationCurrent:discover?this.searchCurrent(row,searchRound(job)):this.generationCurrent(row,job),
   demand,...(discover?{fault:false,inputCurrent:true}:this.dag.dispatchInputs(db,row,job))});
 }

 private async canRun(job:ProductionJob){
  if(this.options.targetSessionId&&job.session_id!==this.options.targetSessionId||this.options.stopBeforeImages&&imageKinds.includes(job.kind))return false;
  const snapshot=job.kind===dagTextKind||job.kind===dagDrawKind?await this.dag.snapshotOf(job):undefined;
  if(this.serviceAvailability(snapshot)!=='available')return false;
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
  this.imageReads.set(key,(this.imageReads.get(key)??0)+1);
  try{
   const asset=await this.media.get(key);if(!asset)return true;
   const bytes=new Uint8Array(await asset.arrayBuffer()),type=mediaType(bytes);
   // 横图必须是 3∶2；方图等其他比例不能算作完整的印刷套图。
   return (strict?type!==asset.contentType:!type)||!await (landscape?readableLandscapeImage(bytes):readableImage(bytes));
  }finally{
   const remaining=(this.imageReads.get(key)??1)-1;
   if(remaining)this.imageReads.set(key,remaining);
   else this.imageReads.delete(key);
  }
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
 private serviceAvailability(snapshot?:ModelSnapshot):ProductionService{
  const snapshots=this.options.snapshots;
  const configured=!snapshots||!!this.snapshotNow(),stopping=this.stopping;
  if(!configured||stopping)return resolveProductionService({configured,stopping,snapshotAvailable:true});
  try{
   if(snapshot&&snapshots)return resolveProductionService({configured,stopping,snapshotAvailable:!!snapshots.provider(snapshot)});
   return resolveProductionService({configured:!this.provider.capture||!!this.provider.capture(),stopping,snapshotAvailable:true});
  }catch{return resolveProductionService({configured:!!snapshot&&!!snapshots,stopping,snapshotAvailable:false});}
 }
 /** DAG 任务按故事的模型快照构造提供方；没有快照服务或故事没有快照时沿用当前提供方。 */
 private async runDag(job:ProductionJob){
  const snapshots=this.options.snapshots,snapshot=snapshots&&await this.dag.snapshotOf(job);
  let provider:ReaderProvider;
  if(snapshot&&snapshots){
   // 当前设置为只读时不得发起任何调用，即使故事有可用的快照。
   if(!this.snapshotNow())throw new JobYield();
   // 故事有快照时只看快照服务；当前全局服务不可用不应阻塞这篇故事。
   const savedProvider=snapshots.provider(snapshot);
   if(!savedProvider)throw new JobYield();
   provider=savedProvider;
   this.jobProviders.set(job.id,provider);
  }else provider=this.jobProvider(job);
  const result=await this.runPaid(job,provider,snapshot,()=>this.dag.run(job,provider));
  // 星标参考图等输入可能在故事文档未变化时失效。下一轮重新安排当前输入的任务。
  if(result.obsolete)this.rebuildKeys.delete(job.session_id);
  return result;
 }
 /** 付费边界使用当前租约、流程控制和该次尝试实际捕获的服务配置。 */
 private runPaid<T extends object>(job:ProductionJob,provider:ReaderProvider,snapshot:ModelSnapshot|undefined,task:()=>Promise<T>){
  const receipts:unknown[]=[];
  const draw=job.kind===dagDrawKind&&(JSON.parse(job.payload) as {work?:{call:string}}).work?.call==='draw';
  const reference=draw?transact(this.database,db=>drawingReferenceBinding(db,job.owner_id,job.session_id)):null;
  return withPaidDispatch({
   authorize:()=>{
    const decision=transact(this.database,db=>{
     const now=this.clock();
     const live=db.get<ProductionJob>("SELECT * FROM production_jobs WHERE id=? AND state='running' AND lease_token=?",job.id,job.lease_token);
     const lease=authorizeJobLease({event:'paid-send',held:!!live,expired:!!live&&live.lease_until<=now});
     if(lease!=='allow')return lease;
     if(job.kind!=='discover'&&this.options.snapshots){
      const stored=db.get<{snapshot:string|null}>("SELECT json_extract(document,'$.dag.modelSnapshot') AS snapshot FROM stories WHERE id=? AND user_id=?",job.session_id,job.owner_id);
      if(fingerprint(stored?.snapshot?JSON.parse(stored.snapshot):null)!==fingerprint(snapshot??null))return 'yield';
     }
     const authorization=this.checkDispatch(db,live!,now);
     if(authorization!=='allow')return authorization;
     if(draw&&reference!==drawingReferenceBinding(db,job.owner_id,job.session_id))return 'yield';
     if(this.serviceAvailability(snapshot)!=='available')return 'yield';
     if(!snapshot&&this.provider.capture&&this.provider.capture()!==provider)return 'yield';
     return 'allow';
    });
    if(decision!=='allow')throw new PaidDispatchDenied(decision);
   },
   receipt:receipt=>receipts.push(receipt),
  },async()=>{
   try{return await task();}
   catch(error){
    if(!(error instanceof PaidDispatchDenied))throw error;
    if(receipts.length)await this.database.prepare(`UPDATE production_jobs SET payload=json_set(payload,'$.dispatchReceipts',json(
      (SELECT json_group_array(json(value)) FROM (SELECT value FROM json_each(payload,'$.dispatchReceipts') UNION ALL SELECT value FROM json_each(?))))) WHERE id=? AND state='running' AND lease_token=?`).bind(JSON.stringify(receipts),job.id,job.lease_token).run();
    if(error.reason==='obsolete')return {obsolete:true};
    throw new JobYield(error.waitingFor);
   }
  });
 }
 private async discover(job:ProductionJob){
  const provider=this.jobProvider(job);
  return this.runPaid(job,provider,undefined,()=>this.runDiscovery(job,provider));
 }
 private async runDiscovery(job:ProductionJob,provider:ReaderProvider){
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
   if(persistenceError(error)||error instanceof PaidDispatchDenied)throw error;
   if(!this.searchCurrent(await this.raw(row.id,row.user_id),round))return {obsolete:true};
   const {signal}=active.controller,terminal=error instanceof ReaderError&&error.status<500;
   // Stopping cleanly between calls spends no attempt. A call a stop killed did spend one.
   if(signal.aborted&&error===signal.reason)throw new JobYield();
   if(this.stopping&&!terminal)throw error;
   if(signal.aborted&&!terminal)throw new JobYield();
   const code=errorCode(error);
   if(code==='TIMEOUT'||code==='CONTENT_BLOCKED')throw error;
   await this.finishSearch(row.id,row.user_id,round,{...search,state:'failed',error:error instanceof ReaderError?error.message:provider.safeError(error)});
   return {failed:true};
  }finally{this.searches.delete(row.id);}
 }
 /** 建议已经保存但任务回执未落盘时，按原世代补记成功，无需领取任务或再调用模型。 */
 private settleSavedPreparation(db:SyncStatements,row:SessionRow,now:number){
  const {doc}=this.parsed(row)!;
  if(!doc.frameRecommendation||!doc.dag||doc.dag.repreparing)return 0;
  const confirming=doc.intake?.phase==='confirming';
  const refresh=doc.dag.preparationGeneration;
  if(!confirming&&refresh===undefined)return 0;
  const result=JSON.stringify({applied:'prepareSuggestions'});
  const jobs=db.all<ProductionJob>(`UPDATE production_jobs
   SET state='succeeded',result=?,error=NULL,error_code=NULL,interrupted=0,lease_token=NULL,lease_until=0,updated_at=?
   WHERE session_id=? AND owner_id=? AND kind=? AND (state='queued' OR state='failed' AND interrupted=1)
   AND json_extract(payload,'$.work.call')='prepareSuggestions'
   AND json_extract(payload,'$.setupGeneration') IS ?
   AND (json_extract(payload,'$.preparationGeneration') IS NULL AND ?
        OR json_extract(payload,'$.preparationGeneration')=?)
   AND EXISTS(SELECT 1 FROM stories s WHERE s.id=production_jobs.session_id AND s.user_id=production_jobs.owner_id AND s.document=?)
   RETURNING *`,result,now,row.id,row.user_id,dagTextKind,doc.intake?.generation??null,confirming?1:0,refresh??null,row.document);
  for(const job of jobs)recordJobSucceeded(db,job,result,now);
  return jobs.length;
 }

 // 已保存的准备工作补记成功；世代或查找轮次已过时的任务及其未结故障作废。
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
   const changed=transact(this.database,db=>{
    const now=this.clock(),settled=this.settleSavedPreparation(db,row,now);
    return settled+deleteJobs(db,`session_id=? AND owner_id=? AND state IN('queued','failed') AND EXISTS(SELECT 1 FROM stories s WHERE s.id=production_jobs.session_id AND s.user_id=production_jobs.owner_id
     AND CASE WHEN json_valid(s.document) AND json_type(s.document,'$.intake')='object' THEN
      CASE WHEN production_jobs.kind='discover'
       THEN COALESCE(json_extract(production_jobs.payload,'$.searchRound'),-1)!=CASE WHEN json_extract(s.document,'$.intake.search.state')='searching' THEN json_extract(s.document,'$.intake.search.round') ELSE -2 END
       ELSE COALESCE(json_extract(production_jobs.payload,'$.setupGeneration'),-1)!=json_extract(s.document,'$.intake.generation') END
      ELSE 0 END)`,[row.id,row.user_id],now);
   });
   if(changed)this.pruneKeys.delete(row.id);
   else this.pruneKeys.set(row.id,key);
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
    const failureCode=job.error_code==='TIMEOUT'||job.error_code==='CONTENT_BLOCKED'?job.error_code:undefined;
    await this.finishSearch(row.id,row.user_id,round,{...search,state:'failed',error:job.error,failureCode});
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
   const expired=(await this.database.prepare(`SELECT * FROM stories WHERE state='running' AND lock_until<=?
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
