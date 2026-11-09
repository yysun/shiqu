// Coordinate reader demand with durable script, image and local publication jobs.
// Paid work needs fresh viewer demand or durable background intent; manual control overrides both.
// Scheduling errors never latch: a failed tick dispatches nothing and the next one retries, while
// an unreadable story is skipped alone. Interrupted work resumes within a bounded replay allowance.
// A lost image file is redrawn only on explicit retry. An open story's first image, current page
// and read-ahead go first, and other stories yield while its publication frees the next slot.
// Search has its own one-worker pool beside text, image and local publication; without the
// story lock it stops when no longer wanted, and
// its failures stay with the search unless a stop interrupted the call.
// Only current image inputs may publish; their paid receipt can replace a stale version's slot.
import {generationProgress} from '../lib/generation-progress.ts';
import {productionTimingScope,productionStageDurations} from '../lib/production-timing.ts';
import {BookImageReferences} from './book-image-reference.ts';
import {storyReplanMessage} from '../lib/reader-review.ts';
import {randomUUID} from 'node:crypto';
import {ReaderRepository,persistenceError,supersededSql,latestVersionMessage} from '../lib/reader-repository.ts';
import type {Database} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import type {Generated} from '../lib/reader-engine.ts';
import {ReaderError,readableStory,selectionSchema,view,nextStep,reviewPassed,productionComplete} from '../lib/reader-model.ts';
import type {Document,SessionRow,SessionView,ProductionAction,Selection} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import {mediaType} from '../lib/reader-generation-contract.ts';
import {readableImage} from './reader-image-health.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {effectiveIntakePhase,intakeSearch} from '../lib/reader-intake.ts';
import type {IntakeSearch} from '../lib/reader-intake.ts';
import {suggestionBatchSchema,freshSuggestions,maxSuggestionBatches} from '../lib/reader-suggestions.ts';
import type {IndexedStoryCandidate,IndexedStoryUpdate,SuggestionBatch,SuggestionProgress} from '../lib/reader-suggestions.ts';
import {localSourceKey} from '../lib/reader-source-key.ts';
import {readerMaxFrames,readerStoryboardBatchSize} from '../lib/reader-limits.ts';
import {productionReadAhead,productionViewerLeaseMs} from '../lib/reader-production.ts';
import type {ReaderProduction} from '../lib/reader-production.ts';
import {JobYield,ProductionQueue,inputVersion,productionJobId,jobDependencies} from './production-queue.ts';
import type {ProductionJob,JobSpec} from './production-queue.ts';
import {authorizeRecovery,authorizeControl,authorizeOverride,commandReceipt,sessionFaults} from './reader-commands.ts';
import type {ReaderFault} from './reader-commands.ts';
import type {FaultView,RecoveryRequest} from '../lib/reader-recovery.ts';

type Demand={session_id:string;owner_id:string;viewer_id:string;page:number;through_page:number;expires_at:number;runtime_id:string};
type Lease={ownerId:string;token:string};
type ActiveSearch={round:number;controller:AbortController;startedAt:number;progress?:SuggestionProgress};
type RebuildKey={document:string;selection:string;state:string;demands:string};
type PruneKey={document:string;selection:string;queued:number;failed:number};
export type ProductionOptions={imageWorkers?:number;now?:()=>number;leaseMs?:number;tickMs?:number;autoStart?:boolean;targetSessionId?:string;stopBeforeImages?:boolean};
type Options=ProductionOptions;
const sessionLeaseMs=180000;
const maxAutomaticAttempts=3;
const publicationYieldMs=15000;
// The stable prefix also recognizes redraw checkpoints written by older releases.
const lostImagePrefix='这幅图片的文件已丢失或损坏。';
const lostImageError=(message:string|null)=>message?.startsWith(lostImagePrefix)===true;
const lostImageMessage='这幅图片的文件已丢失或损坏。重试会重新绘制这一幅，已保存的其他画面会保留。';
const searchRound=(job:ProductionJob)=>(JSON.parse(job.payload) as {searchRound?:number}).searchRound;
// Background order is by page. A viewer's anchor, current page and read-ahead sort ahead of all of it.
function pagePriority(page:number,demand:Demand){
 const background=productionReadAhead+1+page;
 if(demand.viewer_id==='background')return background;
 return page===0?0:page>=demand.page&&page<=demand.through_page?page-demand.page:background;
}
export function configuredImageWorkers(value?:string){
 if(!value?.trim())return 3;
 if(!/^[1-8]$/.test(value.trim()))throw Error('SHIQU_IMAGE_WORKERS must be an integer from 1 to 8');
 return Number(value.trim());
}
export class ReaderProductionCoordinator implements ReaderProduction{
 readonly queue:ProductionQueue;
 readonly repository:ReaderRepository;
 private readonly runtimeId=randomUUID();
 private readonly leases=new Map<string,Lease>();
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
 private readonly pruneKeys=new Map<string,PruneKey>();
 private supersededJobs=new Set<string>();
 private database:Database;
 private provider:ReaderProvider;
 private readonly jobProviders=new Map<string,ReaderProvider>();
 private media:MediaStore;
 private options:Options;
 constructor(database:Database,provider:ReaderProvider,media:MediaStore,options:Options={}){
  if(options.targetSessionId&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options.targetSessionId))throw Error('INVALID_TARGET_SESSION');
  this.database=database;this.provider=provider;this.media=media;this.options=options;
  this.clock=options.now||Date.now;this.repository=new ReaderRepository(database);
  this.queue=new ProductionQueue(database,{
   targetSessionId:options.targetSessionId,
   limits:{search:1,text:1,image:options.imageWorkers??3,local:2},now:this.clock,leaseMs:options.leaseMs,
   canRun:job=>this.canRun(job),resumeInterrupted:job=>this.resumeInterrupted(job),onSettled:()=>{for(const id of this.jobProviders.keys())if(!this.queue.tasks.has(id))this.jobProviders.delete(id);this.wake();},
   candidateFilter:`j.kind='image-publish' OR NOT EXISTS(SELECT 1 FROM stories s WHERE s.id=j.session_id AND s.user_id=j.owner_id AND (s.generation_control!='active' OR (s.state='failed' AND NOT EXISTS(SELECT 1 FROM reader_faults f WHERE f.session_id=s.id AND f.owner_id=s.user_id AND f.state='recovering' AND (f.command_id=j.recovery_id OR f.kind='interrupted' AND f.job_id=j.id))) OR EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id)))`,
   skipCandidate:job=>!!options.targetSessionId&&job.session_id!==options.targetSessionId||!!options.stopBeforeImages&&['image','image-publish'].includes(job.kind)||job.kind!=='image-publish'&&this.supersededJobs.has(job.session_id),
   safeError:(error,job)=>error instanceof ReaderError?error.message:job.kind==='image-publish'?'图片已生成，暂时无法展开。请重试继续。':(this.jobProviders.get(job.id)||this.provider).safeError(error),
   terminal:error=>error instanceof ReaderError&&error.status<500,
   handlers:{
    discover:{pool:'search',run:job=>this.discover(job)},
    prepare:{pool:'text',run:job=>this.script(job)},
    script:{pool:'text',run:job=>this.script(job)},
    image:{pool:'image',run:job=>this.image(job)},
    'image-publish':{pool:'local',drain:true,run:(job,context)=>this.publish(job,context.outputs)},
   },
  });
  if(options.autoStart!==false)this.start();
 }
 start(){if(this.enabled||this.stopping||this.closed)return;this.enabled=true;this.timer=setInterval(()=>this.wake(),this.options.tickMs||1000);this.timer.unref();this.wake();}
 private async find(id:string,ownerId:string){return this.database.prepare('SELECT * FROM stories WHERE id=? AND user_id=?').bind(id,ownerId).first<SessionRow>();}
 private async raw(id:string,ownerId:string){
  const row=await this.find(id,ownerId);
  if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');return row;
 }
 private searchCurrent(row:SessionRow,round:number|undefined){
  const doc=JSON.parse(row.document) as Document;
  if(!doc.intake||doc.plan||doc.intake.phase==='confirmed')return false;
  const search=intakeSearch(doc.intake);return search.state==='searching'&&search.round===round;
 }
 // One rule for starting, resuming and stopping a search, so they cannot disagree and cycle.
 private async searchRunnable(row:SessionRow,round:number|undefined){
  if(this.stopping||!this.readable(row)||row.generation_control!=='active'||!this.searchCurrent(row,round))return false;
  // Background production does not authorize discovery after the picker has closed.
  if(!await this.database.prepare('SELECT viewer_id FROM production_demand WHERE session_id=? AND owner_id=? AND runtime_id=? AND expires_at>? LIMIT 1').bind(row.id,row.user_id,this.runtimeId,this.clock()).first())return false;
  return !await this.repository.superseded(row.id,row.user_id)&&!await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first();
 }
 private imageInputs(row:SessionRow){
  const {doc,selection}=this.parsed(row)!;
  const {displayTitle:_,...generationSelection}=selection;void _;
  const scriptVersion=inputVersion({selection:generationSelection,...(doc.intake?{setupGeneration:doc.intake.generation}:{})});
  return {generation:doc.intake?.generation,version:inputVersion({scriptVersion,plan:doc.plan,style:selection.artStyle,prompt:selection.productionPrompt})};
 }
 private currentJob(row:SessionRow,job:ProductionJob,inputs=this.imageInputs(row)){
  const {generation,version}=inputs;
  if(generation!==undefined&&(JSON.parse(job.payload) as {setupGeneration?:number}).setupGeneration!==generation)return false;
  return !['image','image-publish'].includes(job.kind)||job.version===version;
 }
 private async currentJobs(row:SessionRow,saved?:ProductionJob[]){
  const jobs=saved||await this.queue.jobs(row.id,row.user_id),inputs=this.imageInputs(row);
  return jobs.filter(job=>this.currentJob(row,job,inputs));
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
  if(!this.readable(row)||!this.currentJob(row,job))return false;
  if(job.kind!=='image-publish'&&await this.repository.superseded(row.id,row.user_id))return false;
  return row.generation_mode==='background'&&row.generation_control==='active'&&!await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first();
 }
 async control(ownerId:string,id:string,action:ProductionAction,handoffOnly=false,requestId?:string){
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  await this.repository.get(id,ownerId);
  if(requestId)await authorizeControl(this.database,ownerId,id,requestId,action,this.clock());
  else await this.repository.control(id,ownerId,action,handoffOnly);
  this.wake();return this.snapshot(ownerId,id);
 }
 async managed(ownerId:string,id:string){const saved=await this.database.prepare('SELECT document FROM stories WHERE id=? AND user_id=?').bind(id,ownerId).first<{document:string}>();if(saved&&(JSON.parse(saved.document) as Document).intake)return true;return !!await this.database.prepare('SELECT id FROM production_jobs WHERE owner_id=? AND session_id=? LIMIT 1').bind(ownerId,id).first();}
 async request(ownerId:string,id:string,viewerId:string,page:number,retry=false){return this.demand(ownerId,id,viewerId,page,page+productionReadAhead,retry);}
 async advance(ownerId:string,id:string,throughPage:number,retry:boolean){return this.demand(ownerId,id,'legacy-advance',0,throughPage,retry);}
 private async demand(ownerId:string,id:string,viewerId:string,page:number,throughPage:number,retry:boolean){
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  const row=await this.repository.get(id,ownerId),doc=JSON.parse(row.document) as Document;
  if(retry&&doc.visualReview?.stopReason==='requirements')throw new ReaderError(409,'请修改存在冲突或无法判断的验收要求后创建新版。');
  if(retry&&doc.visualReview?.status==='blocked'&&doc.visualReview.stopReason==='replan')throw new ReaderError(409,storyReplanMessage);
  if(row.generation_control!=='active'||await this.repository.superseded(id,ownerId))return this.snapshot(ownerId,id);
  if(doc.plan&&page>=doc.plan.pages.length)throw new ReaderError(400,'请选择有效画幅');
  await this.database.prepare(`INSERT INTO production_demand(session_id,owner_id,viewer_id,page,through_page,expires_at,runtime_id) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(session_id,owner_id,viewer_id) DO UPDATE SET page=excluded.page,through_page=excluded.through_page,expires_at=excluded.expires_at,runtime_id=excluded.runtime_id`)
   .bind(id,ownerId,viewerId,page,Math.min(readerMaxFrames-1,throughPage),this.clock()+productionViewerLeaseMs,this.runtimeId).run();
  if(retry)throw new ReaderError(400,'重试必须提交当前故障实例与操作编号。');
  await this.pruneSuperseded(id);await this.graph(await this.raw(id,ownerId));
  this.wake();return this.snapshot(ownerId,id);
 }
 // Explicitly bypass any unfinished review gates on the reader's word, retaining overridden.
 // The review reads as passed first, and its
 // finished checkpoints are removed rather than rerun: a script job would repair what was accepted.
 async overrideReview(ownerId:string,id:string,command?:RecoveryRequest){
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  if(command){await this.repository.get(id,ownerId);await authorizeOverride(this.database,ownerId,id,command,this.clock());this.wake();return this.snapshot(ownerId,id);}
  const row=await this.repository.get(id,ownerId),doc=JSON.parse(row.document) as Document,review=doc.visualReview;
  if(await this.repository.superseded(id,ownerId))throw new ReaderError(409,latestVersionMessage);
  if(review?.status!=='blocked'&&!review?.overridden)throw new ReaderError(409,'这篇故事没有待处理的审片问题。');
  if(review.status==='blocked'){
   const saved=await this.database.prepare(`UPDATE stories SET document=json_remove(json_set(document,'$.visualReview.status','passed','$.visualReview.overridden',json('true')),'$.visualReview.stopReason'),state='idle',error=NULL,lock_token=NULL,lock_until=0,updated_at=?
    WHERE id=? AND user_id=? AND state!='running' AND NOT ${supersededSql()} AND json_extract(document,'$.visualReview.status')='blocked' AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id)`)
    .bind(new Date(this.clock()).toISOString(),id,ownerId).run();
   if(!saved.meta.changes)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');
  }
  // Review checkpoints are finished, and a queued one would wait behind the drawing forever.
  // Only text jobs: a repeated request must not touch a failed image. Blocked stories have none yet.
  await this.database.prepare("DELETE FROM production_jobs WHERE session_id=? AND owner_id=? AND pool='text' AND kind!='discover' AND state IN('queued','failed')").bind(id,ownerId).run();
  this.wake();return this.snapshot(ownerId,id);
 }
 async leave(ownerId:string,id:string,viewerId:string){
  await this.database.prepare('DELETE FROM production_demand WHERE session_id=? AND owner_id=? AND viewer_id=? AND runtime_id=?').bind(id,ownerId,viewerId,this.runtimeId).run();this.wake();
 }
 private async faults(row:SessionRow,jobs?:ProductionJob[]){
  const saved=await sessionFaults(this.database,row.id,row.user_id);if(!saved.length)return [];
  const current=jobs||await this.currentJobs(row),ids=new Set(current.map(job=>job.id));
  const version=this.imageInputs(row).version;
  return saved.filter(fault=>fault.version==='legacy'||(fault.job_id?ids.has(fault.job_id):fault.version===version));
 }
 private faultView(row:SessionRow,fault:ReaderFault,jobs:ProductionJob[]):FaultView{
  const doc=JSON.parse(row.document) as Document,job=jobs.find(job=>job.id===fault.job_id),step=nextStep(doc,selectionSchema.parse(JSON.parse(row.selection)),0);
  const review=doc.visualReview?.status==='blocked';
  const stage=review?'review':lostImageError(fault.message)||fault.kind==='image-loss'&&job?.kind!=='image-publish'?'redraw':job?.kind==='image-publish'?'publication':step?.kind==='source'?'source':doc.intake&&doc.intake.phase!=='confirmed'?'prepare':'generation';
  return {id:fault.id,message:fault.message,page:fault.page,stage,state:fault.state as FaultView['state'],retryAllowed:fault.state==='pending'&&!['replan','requirements'].includes(doc.visualReview?.stopReason||'')};
 }
 private async resolveFault(row:SessionRow,fault:ReaderFault){
  await this.database.prepare("UPDATE reader_faults SET state='resolved',updated_at=? WHERE id=? AND session_id=? AND owner_id=? AND state='pending' AND EXISTS(SELECT 1 FROM stories s WHERE s.id=reader_faults.session_id AND s.user_id=reader_faults.owner_id AND json_extract(s.document,'$.images['||reader_faults.page||']')=?)")
   .bind(this.clock(),fault.id,row.id,row.user_id,(JSON.parse(row.document) as Document).images[fault.page!]).run();
  this.wake();
 }
 private async completeHealthy(ownerId:string,id:string){
  const row=await this.repository.get(id,ownerId),doc=JSON.parse(row.document) as Document;
  if(!productionComplete(doc,selectionSchema.parse(JSON.parse(row.selection))))return;
  await this.database.prepare("UPDATE stories SET state='completed',error=NULL WHERE id=? AND user_id=? AND state!='running' AND document=? AND NOT EXISTS(SELECT 1 FROM reader_faults f WHERE f.session_id=stories.id AND f.owner_id=stories.user_id AND f.state IN ('pending','recovering'))")
   .bind(id,ownerId,row.document).run();
 }
 async checkImage(ownerId:string,id:string,page:number,image:string){
  const row=await this.repository.get(id,ownerId),doc=JSON.parse(row.document) as Document;
  if(await this.repository.superseded(id,ownerId))throw new ReaderError(409,latestVersionMessage);
  if(!doc.plan||!doc.images[page]||doc.images[page]!==image)throw new ReaderError(409,'这幅图片已更新，请刷新后再检查。');
  const key=referenceImageKey(id,image);if(!key)throw new ReaderError(409,'图片地址无法核对。');
  let lost:boolean;try{lost=await this.fileLost(key,true);}catch{throw new ReaderError(503,'图片暂时无法读取，请重试检查；尚未重新绘图。');}
  const version=this.imageInputs(row).version,existing=(await this.faults(row)).find(fault=>fault.kind==='image-loss'&&fault.page===page);
  if(!lost){
   // A restored file removes a physical loss, but a later ordinary model failure still needs
   // its own explicit acknowledgement. Its retained fault remains available for a free reuse.
   if(existing?.state==='pending'&&(!existing.job_id||lostImageError(existing.message)))await this.resolveFault(row,existing);
   await this.completeHealthy(ownerId,id);
   return this.snapshot(ownerId,id);
  }
  // A late browser report must not mark a new image, plan or selection. Keep in-flight writes valid.
  await this.database.prepare(`INSERT INTO reader_faults(id,session_id,owner_id,kind,page,version,image,message,created_at,updated_at)
   SELECT ?,?,?,'image-loss',?,?,?,?,?,? FROM stories s
   WHERE s.id=? AND s.user_id=? AND json_extract(s.document,?)=?
    AND json_remove(s.selection,'$.displayTitle')=json_remove(?,'$.displayTitle')
    AND json_extract(s.document,'$.plan') IS json_extract(?,'$.plan')
    AND NOT ${supersededSql('s')} AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id)
   ON CONFLICT DO NOTHING`)
   .bind(randomUUID(),id,ownerId,page,version,image,lostImageMessage,this.clock(),this.clock(),id,ownerId,`$.images[${page}]`,image,row.selection,row.document).run();
  this.wake();return this.snapshot(ownerId,id);
 }
 private async recoveryImageJobs(row:SessionRow,page:number){
  const doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection)),setup=doc.intake?{setupGeneration:doc.intake.generation}:{};
  if(!doc.plan||!doc.original||!reviewPassed(doc))throw new ReaderError(409,'原文与审片尚未齐备，不能恢复绘图。');
  const {displayTitle:_,...generationSelection}=selection;void _;
  const scriptVersion=inputVersion({selection:generationSelection,...setup}),script=this.spec(row,'script','text',scriptVersion,doc.visualReview?'approved':'',[],{...setup},-10);
  await this.queue.enqueue(script,{pages:doc.plan.pages.length});
  const version=this.imageInputs(row).version,payload={page,...setup};
  const anchor=productionJobId(row.id,'image-publish',version,'0');
  const image=this.spec(row,'image','image',version,String(page),page===0?[script.id]:[script.id,anchor],payload,page);
  const publication=this.spec(row,'image-publish','local',version,String(page),[image.id],payload,-5);
  const value=doc.images[page];
  await this.queue.enqueue(image,value?{value,model:'saved',requestId:null,usage:null}:undefined);
  await this.queue.enqueue(publication,value?{value}:undefined);
  return {image:await this.queue.job(image.id),publication:await this.queue.job(publication.id)};
 }
 async recover(ownerId:string,id:string,command:RecoveryRequest){
  let row=await this.repository.get(id,ownerId);
  const replay=await commandReceipt(this.database,ownerId,command.requestId);
  if(replay){
   if(replay.action!=='recover'||replay.session_id!==id||replay.fault_id!==command.faultId)throw new ReaderError(409,'这个操作编号已用于其他内容。');
   return {...await this.snapshot(ownerId,id),recoveryReceipt:{requestId:command.requestId,status:replay.status,error:replay.error}};
  }
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重试。');
  if(await this.repository.superseded(id,ownerId))throw new ReaderError(409,latestVersionMessage);
  if(row.generation_control!=='active')throw new ReaderError(409,'请先恢复生成许可，再重试或重绘。');
  const doc=JSON.parse(row.document) as Document;
  if(['requirements','replan'].includes(doc.visualReview?.stopReason||''))throw new ReaderError(409,'请先修改存在问题的制作或验收要求，再提交。');
  const fault=(await this.faults(row)).find(fault=>fault.id===command.faultId);
  if(!fault||fault.state!=='pending')throw new ReaderError(409,'这项问题正在处理或已更新，请刷新后再操作。');
  let jobs:string[],resolutionJob:string,redraw=false,adopt:{jobId:string;result:string;attempts:number}|undefined;
  if(fault.kind==='image-loss'){
   const page=fault.page;if(page===null)throw new ReaderError(409,'无法确定待恢复画幅。');
   const current=doc.images[page];
   if(fault.image&&current!==fault.image)throw new ReaderError(409,'图片已更新，请重新检查。');
   const key=current?referenceImageKey(id,current):null;
   if(key&&!await this.fileLost(key,true)){
    const receipt=await authorizeRecovery(this.database,{ownerId,sessionId:id,...command,jobs:[],resolutionJob:'',resolved:true,basis:row},this.clock());
    await this.completeHealthy(ownerId,id);this.wake();return {...await this.snapshot(ownerId,id),recoveryReceipt:{requestId:receipt.request_id,status:receipt.status,error:receipt.error}};
   }
   const pair=await this.recoveryImageJobs(row,page);if(!pair.image||!pair.publication)throw new ReaderError(409,'图片任务尚未准备好。');
   const paid=pair.image.result?JSON.parse(pair.image.result) as Generated<string>:null,paidKey=paid?.value?referenceImageKey(id,paid.value):null;
   const reusable=paidKey&&!await this.fileLost(paidKey,true);
   if(!reusable&&page>0){
    const anchor=doc.images[0]?referenceImageKey(id,doc.images[0]):null;
    if(!anchor||await this.fileLost(anchor)|| (await this.faults(row)).some(f=>f.page===0&&f.id!==fault.id))throw new ReaderError(409,'请先检查并恢复第 1 幅参考图，再重绘这一幅。');
   }
   redraw=!reusable;jobs=redraw?[pair.image.id,pair.publication.id]:[pair.publication.id];resolutionJob=pair.publication.id;
   // The dependent call failed before inference when its reference disappeared. Restore that
   // checkpoint under the same grant; its anchor dependency still fences dispatch.
   const dependent=fault.job_id?await this.queue.job(fault.job_id):null;
   if(page===0&&dependent?.kind==='image'&&JSON.parse(dependent.payload).page>0&&lostImageError(dependent.error))jobs.push(dependent.id);
   await this.database.prepare("UPDATE reader_faults SET job_id=? WHERE id=? AND state='pending'").bind(pair.publication.id,fault.id).run();
  }else{
   await this.graph(row);
   const step=nextStep(doc,selectionSchema.parse(JSON.parse(row.selection)),readerMaxFrames-1);
   const legacy=fault.version==='legacy'&&fault.job_id?await this.queue.job(fault.job_id):null;
   const job=legacy?.kind==='image-publish'?legacy:fault.job_id&&fault.version!=='legacy'?await this.queue.job(fault.job_id):(await this.currentJobs(row)).find(job=>job.pool==='text'&&['queued','failed'].includes(job.state)&&(JSON.parse(job.payload).stepKey===step?.key||job.kind==='prepare'))||(step?.kind==='image'?(await this.currentJobs(row)).find(job=>job.kind==='image'&&['queued','failed'].includes(job.state)&&JSON.parse(job.payload).page===(fault.page??step.page)):undefined);
   if(!job)throw new ReaderError(409,'恢复任务已更新，请刷新后再操作。');
   if(job.kind==='image-publish'){
    const result=jobDependencies(job)[0],paid=result?await this.queue.job(result):null;
    const key=paid?.result?referenceImageKey(id,JSON.parse(paid.result).value):null;
    if(!key||await this.fileLost(key,true)){
     await this.database.prepare("UPDATE production_jobs SET state='failed',error=?,failure_id=?,updated_at=? WHERE id=? AND state='failed' AND failure_id=?").bind(lostImageMessage,randomUUID(),this.clock(),job.id,fault.id).run();
     throw new ReaderError(409,'已生成图片的文件也已丢失。请刷新后明确选择重绘这一幅。');
    }
   }
   if(!fault.job_id)await this.database.prepare("UPDATE reader_faults SET job_id=?,version=? WHERE id=? AND state='pending'").bind(job.id,job.version,fault.id).run();
   if(legacy?.kind==='image-publish'){
    const pair=await this.recoveryImageJobs(row,JSON.parse(job.payload).page),paid=await this.queue.job(jobDependencies(job)[0]);
    if(!paid?.result||!pair.image||!pair.publication)throw new ReaderError(409,'已生成回执暂不可用，请重新核对。');
    adopt={jobId:pair.image.id,result:paid.result,attempts:paid.attempts};jobs=[pair.publication.id];resolutionJob=pair.publication.id;
   }else{
    if(fault.version==='legacy')await this.database.prepare("UPDATE reader_faults SET job_id=?,version=? WHERE id=? AND state='pending'").bind(job.id,job.version,fault.id).run();
    jobs=[job.id];resolutionJob=job.id;
   }
  }
  row=await this.repository.get(id,ownerId);
  const receipt=await authorizeRecovery(this.database,{ownerId,sessionId:id,...command,jobs,resolutionJob,redraw,adopt,basis:row},this.clock());
  this.wake();return {...await this.snapshot(ownerId,id),recoveryReceipt:{requestId:receipt.request_id,status:receipt.status,error:receipt.error}};
 }
 async snapshot(ownerId:string,id:string):Promise<SessionView>{
  const row=await this.repository.get(id,ownerId),saved=view(row);
  if(row.state!=='completed'&&await this.repository.superseded(id,ownerId))return {...saved,superseded:true,generationControl:'paused',productionState:'paused'};
  return this.snapshotView(row,saved,true);
 }
 // 书架已过滤旧版本，卡片也无需计算历次制作耗时。
 async shelfSnapshot(row:SessionRow,saved:SessionView){
  return this.snapshotView(row,saved,false);
 }
 private async snapshotView(row:SessionRow,saved:SessionView,includeTimings:boolean):Promise<SessionView>{
  const id=row.id,allJobs=await this.queue.jobs(row.id,row.user_id),jobs=await this.currentJobs(row,allJobs),faults=await this.faults(row,jobs),failed=jobs.find(job=>job.state==='failed'&&lostImageError(job.error))||jobs.find(job=>job.state==='failed');
  const active=jobs.filter(job=>job.state==='running'&&job.lease_until>this.clock()).sort((a,b)=>a.updated_at-b.updated_at);
  // A background search must not supply the selected story step's clock. Renewals only
  // extend leases, leaving the persisted claim timestamp stable across screen visits.
  const phase=saved.generationProgress!.phase,parsed=this.parsed(row)!;
  const step=nextStep(parsed.doc,parsed.selection,readerMaxFrames-1);
  const current=active.find(job=>phase==='discover'?job.kind==='discover':phase==='image'?job.kind==='image':['prepare','script'].includes(job.kind)&&(!JSON.parse(job.payload).stepKey||JSON.parse(job.payload).stepKey===step?.key));
  const timingProvider=current&&(this.jobProviders.get(current.id)||(!this.provider.capture?this.provider:undefined));
  const startedAt=current?.updated_at??null,timeoutMs=timingProvider?.generationTimeoutMs?.(phase);
  const timeoutAt=startedAt!==null&&timeoutMs?startedAt+timeoutMs:null;
  const search=this.searches.get(id);
  const liveProgress=parsed.doc.intake&&search?.round===intakeSearch(parsed.doc.intake).round&&saved.intake?.search.state==='searching'?search.progress:undefined;
  const session={...saved,...(saved.intake&&liveProgress?{intake:{...saved.intake,progress:liveProgress}}:{}),generationProgress:{...saved.generationProgress!,startedAt,timeoutAt,...(includeTimings?{stageDurations:productionStageDurations(allJobs,parsed.selection)}:{}),attempt:current?.attempts??saved.generationProgress!.attempt}};
  const working=active.length>0||jobs.some(job=>job.kind==='image-publish'&&job.state==='queued'&&jobs.some(parent=>parent.id===jobDependencies(job)[0]&&parent.state==='succeeded'));
  if(faults.length){
   const views=faults.map(fault=>this.faultView(row,fault,allJobs)),pending=views.find(f=>f.retryAllowed&&f.stage==='redraw')||views.find(f=>f.retryAllowed)||views[0];
   const recovering=working||faults.some(fault=>fault.state==='recovering'&&jobs.some(job=>job.state==='queued'&&(job.recovery_id===fault.command_id||job.id===fault.job_id)));
   const manual=row.generation_control!=='active';
   return {...session,faults:views,state:recovering?'running':'failed',error:recovering?null:pending.message,retryAllowed:views.some(f=>f.retryAllowed),retryStage:pending.stage,
    ready:session.ready-faults.filter((f,i)=>f.page!==null&&!!session.story?.pages[f.page]?.image&&faults.findIndex(other=>other.page===f.page)===i).length,
    productionState:manual?'paused':recovering?'running':'paused',
    generationProgress:{...session.generationProgress!,...(views.some(f=>f.page!==null)?{phase:'image' as const}:{})}};
  }
  if(failed&&!working){
   const lost=lostImageError(failed.error);
   return {...session,state:'failed',error:lost?lostImageMessage:failed.error,retryAllowed:!['replan','requirements'].includes(saved.generationProgress?.reviewStopReason||''),...(lost?{retryStage:'redraw' as const}:failed.kind==='image-publish'?{retryStage:'publication' as const}:{})};
  }
  const demands=await this.demands(id),eligible=jobs.some(job=>job.state==='queued'&&demands.some(d=>job.pool==='text'||(JSON.parse(job.payload) as {page:number}).page<=d.through_page));
  const manual=row.generation_control!=='active';
  // No story is chosen yet, so finding one is what this story is doing.
  if(!manual&&saved.intake?.phase==='discovering'&&saved.intake.search.state==='searching')return {...session,productionState:search?'running':'queued'};
  const productionState=manual?'paused':working?'running':eligible?'queued':'paused';
  if(session.state!=='failed'&&session.state!=='completed'&&!manual&&(working||eligible))return {...session,state:'running',productionState};
  // A saved session state alone cannot prove that the queue is still executing.
  return {...session,productionState};
 }
 private spec(row:SessionRow,kind:string,pool:string,version:string,key:string,dependencies:string[],payload:unknown,priority:number):JobSpec{
  const {selection}=this.parsed(row)!;
  const timingStage=kind==='discover'?'source':kind==='prepare'?'count':['image','image-publish'].includes(kind)?'image':generationProgress({...view(row),state:'running',productionState:'running',generationControl:'active',error:null},this.clock()).steps.find(step=>step.state==='current')?.id;
  return {id:productionJobId(row.id,kind,version,key),sessionId:row.id,ownerId:row.user_id,kind,pool,version,dependencies,payload:{...(payload as Record<string,unknown>),timingStage,timingScope:productionTimingScope(selection,kind==='discover')},priority};
 }
 private async graph(row:SessionRow){
  const {doc,selection}=this.parsed(row)!;
  if(doc.intake){
   const search=intakeSearch(doc.intake),searching=search.state==='searching'&&!doc.plan&&doc.intake.phase!=='confirmed';
   // A record written by an older release has no stored search to fence its result against.
   if(doc.intake.phase==='discovering'&&doc.intake.search?.state!=='searching'){
    await this.database.prepare("UPDATE stories SET document=json_set(document,'$.intake.search',json(?)) WHERE id=? AND user_id=? AND json_extract(document,'$.intake.phase')='discovering' AND COALESCE(json_extract(document,'$.intake.search.round'),0)=?")
     .bind(JSON.stringify({round:search.round+1,state:'searching'}),row.id,row.user_id,search.round).run();
    return;
   }
   if(searching)await this.queue.enqueue(this.spec(row,'discover','search',String(search.round),'',[],{searchRound:search.round},-10));
   if(['discovering','choosing','confirming'].includes(doc.intake.phase))return;
  }
  const preparing=selection.narrativeDetail&&!doc.frameCountConfirmed&&!doc.plan&&(selection.length!=='auto'||!doc.frameRecommendation);
  // A distinct job owns each saved planning checkpoint; the empty key is the complete-script barrier.
  const scriptKey=!preparing&&(!doc.plan||!reviewPassed(doc))&&(doc.visualReview||doc.draft||doc.storyboard||selection.length==='auto'||selection.length>readerStoryboardBatchSize)?nextStep(doc,selection,0)?.key||'':doc.visualReview?'approved':'';
  const setup=doc.intake?{setupGeneration:doc.intake.generation}:{};
  const {displayTitle:_,...generationSelection}=selection;void _;
  const scriptVersion=inputVersion({selection:generationSelection,...setup}),script=this.spec(row,preparing?'prepare':'script','text',scriptVersion,scriptKey,[],{stepKey:scriptKey,...setup},-10);
  await this.queue.enqueue(script,doc.plan&&doc.original&&reviewPassed(doc)?{pages:doc.plan.pages.length}:undefined);
  if(!doc.plan||!doc.original||!reviewPassed(doc))return;
  if(doc.plan.pages.every((_,page)=>!!doc.images[page])&&!(await this.faults(row)).length){
   await this.database.prepare("UPDATE stories SET state='completed',error=NULL WHERE id=? AND user_id=? AND state='idle' AND document=? AND NOT EXISTS(SELECT 1 FROM reader_faults f WHERE f.session_id=stories.id AND f.owner_id=stories.user_id AND f.state IN ('pending','recovering'))").bind(row.id,row.user_id,row.document).run();return;
  }
  // SQLite json_set cannot fill a missing array index out of order; reserve all slots first.
  if(doc.images.length<doc.plan.pages.length){
   const normalized=doc.plan.pages.map((_,page)=>doc.images[page]||'');
   const saved=await this.database.prepare("UPDATE stories SET document=json_set(document,'$.images',json(?)) WHERE id=? AND user_id=? AND document=?")
    .bind(JSON.stringify(normalized),row.id,row.user_id,row.document).run();
   if(!saved.meta.changes)return;
  }
  const demands=await this.demands(row.id);if(!demands.length)return;
  const end=Math.min(doc.plan.pages.length-1,Math.max(...demands.map(d=>d.through_page)));
  const version=this.imageInputs(row).version;
  const anchor=productionJobId(row.id,'image-publish',version,'0');
  for(let page=0;page<=end;page++){
   const priority=Math.min(...demands.map(d=>pagePriority(page,d))),payload={page,...setup};
   const image=this.spec(row,'image','image',version,String(page),page===0?[script.id]:[script.id,anchor],payload,priority);
   const publication=this.spec(row,'image-publish','local',version,String(page),[image.id],payload,-5);
   const saved=doc.images[page],receipt=saved?{value:saved,model:'saved',requestId:null,usage:null}:undefined;
   await this.queue.enqueue(image,receipt);await this.queue.enqueue(publication,saved?{value:saved}:undefined);
  }
 }
 private async canRun(job:ProductionJob){
  if(this.options.targetSessionId&&job.session_id!==this.options.targetSessionId||this.options.stopBeforeImages&&['image','image-publish'].includes(job.kind))return false;
  if(job.kind!=='image-publish'&&this.provider.capture&&!this.provider.capture())return false;
  const row=await this.raw(job.session_id,job.owner_id);
  if(job.kind==='discover')return this.searchRunnable(row,searchRound(job));
  if(!this.readable(row)||!this.currentJob(row,job))return false;
  const local=job.kind==='image-publish';
  if(!local){
   if(await this.repository.superseded(row.id,row.user_id))return false;
   if(row.generation_control!=='active')return false;
   if(this.stopping||!(await this.demands(row.id)).some(d=>job.pool==='text'||(JSON.parse(job.payload) as {page:number}).page<=d.through_page))return false;
   if(await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first())return false;
   const jobs=await this.currentJobs(row,(await this.database.prepare("SELECT * FROM production_jobs WHERE session_id=? AND owner_id=? AND (state='failed' OR kind='image-publish' AND state='running')").bind(row.id,row.user_id).all<ProductionJob>()).results);
   const faults=await this.faults(row),authorized=faults.some(fault=>fault.state==='recovering'&&(fault.command_id!==null&&fault.command_id===job.recovery_id||fault.kind==='interrupted'&&fault.job_id===job.id));
   if((faults.length||jobs.some(job=>job.state==='failed')||row.state==='failed')&&!authorized)return false;
   if(job.kind==='image'&&(JSON.parse(job.payload) as {page:number}).page>0&&faults.some(fault=>fault.page===0&&fault.kind==='image-loss'))return false;
   // Apply backpressure until a completed image is published; a local failure must stop refill.
   if(job.kind==='image'&&jobs.some(job=>job.kind==='image-publish'&&job.state==='running'))return false;
   if(job.kind==='image'&&job.priority>productionReadAhead&&await this.viewedPublicationPending())return false;
  }
  if(job.pool==='text')return row.state!=='running'||row.lock_until<=this.clock();
  const doc=JSON.parse(row.document) as Document;
  if(!doc.plan||!doc.original||!reviewPassed(doc))return false;
  return this.ownSession(row,local);
 }
 // Backpressure briefly blocks a viewed story's next image after each page, and the pump would
 // otherwise hand that free worker to other work for a full paid draw. The age limit bounds the hold.
 private async viewedPublicationPending(){
  const now=this.clock(),recent=now-publicationYieldMs;
  // CROSS JOIN fixes the order: start from the few live viewers rather than scanning every job.
  const candidates=(await this.database.prepare(`SELECT DISTINCT s.id,s.user_id FROM production_demand d
   CROSS JOIN stories s ON s.id=d.session_id AND s.user_id=d.owner_id
   CROSS JOIN production_jobs p ON p.session_id=s.id AND p.owner_id=s.user_id
   CROSS JOIN production_jobs parent ON parent.id=json_extract(p.dependencies,'$[0]')
   WHERE d.runtime_id=? AND d.expires_at>? AND s.generation_control='active' AND NOT ${supersededSql('s')}
   AND p.kind='image-publish' AND (p.state='running' AND p.updated_at>? OR p.state='queued' AND parent.state='succeeded' AND parent.updated_at>?)
   AND EXISTS(SELECT 1 FROM production_jobs i WHERE i.session_id=s.id AND i.owner_id=s.user_id AND i.kind='image' AND i.state='queued' AND i.priority<=?)
   AND NOT EXISTS(SELECT 1 FROM library_deletions l WHERE l.story_id=s.id AND l.user_id=s.user_id)`)
   .bind(this.runtimeId,now,recent,recent,productionReadAhead).all<{id:string;user_id:string}>()).results;
  for(const candidate of candidates){
   const row=await this.raw(candidate.id,candidate.user_id);if(!this.readable(row))continue;
   const jobs=await this.currentJobs(row);
   if(jobs.some(job=>job.state==='failed')||!jobs.some(job=>job.kind==='image'&&job.state==='queued'&&job.priority<=productionReadAhead))continue;
   if(jobs.some(job=>job.kind==='image-publish'&&(job.state==='running'&&job.updated_at>recent||job.state==='queued'&&jobs.some(parent=>parent.id===jobDependencies(job)[0]&&parent.state==='succeeded'&&parent.updated_at>recent))))return true;
  }
  return false;
 }
 // Publication needs the bytes to match the saved type; a reference only needs what providers accept.
 private async fileLost(key:string,strict=false){
  const asset=await this.media.get(key);if(!asset)return true;
  const bytes=new Uint8Array(await asset.arrayBuffer()),type=mediaType(bytes);
  return (strict?type!==asset.contentType:!type)||!await readableImage(bytes);
 }
 private async ownSession(row:SessionRow,allowDeleted:boolean){
  const lease=this.leases.get(row.id);
  if(lease){
   if(row.state==='running'&&row.lock_token===lease.token)return true;
   this.leases.delete(row.id);
  }
  if(row.state==='running'){
   if(row.lock_until>this.clock())return false;
   // Publication must recover a deleted story too; visible repository reads intentionally hide it.
   await this.database.prepare("UPDATE stories SET state='failed',error=?,lock_token=NULL,lock_until=0,updated_at=? WHERE id=? AND user_id=? AND state='running' AND lock_until<=?")
    .bind('上次制作已中断，已保留保存的结果。',new Date(this.clock()).toISOString(),row.id,row.user_id,this.clock()).run();return false;
  }
  const token=randomUUID(),now=this.clock();
  const acquired=await this.database.prepare(`UPDATE stories SET state='running',lock_token=?,lock_until=?,error=NULL,updated_at=?
   WHERE id=? AND user_id=? AND state=? AND document=? AND ${allowDeleted?'1=1':"NOT EXISTS (SELECT 1 FROM library_deletions WHERE story_id=stories.id AND user_id=stories.user_id)"}`)
   .bind(token,now+(this.options.leaseMs||sessionLeaseMs),new Date(now).toISOString(),row.id,row.user_id,row.state,row.document).run();
  if(acquired.meta.changes){this.leases.set(row.id,{ownerId:row.user_id,token});return true;}return false;
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
 // 状态和可选批次一起保存。复用已发布的坐标，避免重试或后台保存使选择指向另一篇。
 private async saveIndexedCandidates(id:string,ownerId:string,round:number,updates:IndexedStoryUpdate[]){
  for(let attempt=0;attempt<4;attempt++){
   const row=await this.find(id,ownerId);
   if(!row||!this.searchCurrent(row,round))return false;
   const {intake}=JSON.parse(row.document) as Document;
   const previous=new Map(intake!.indexedCandidates?.map(candidate=>[candidate.id,candidate]));
   const batches=intake!.batches;
   const choices=new Map<string,{batch:number;index:number}>();
   for(const [batch,receipt] of batches.entries())for(const [index,story] of receipt.stories.entries()){
    if(story.source)choices.set(localSourceKey(story.source),{batch,index});
   }
   let batchesUpdated=false;
   const candidates=updates.map(({id,story,summary,status}):IndexedStoryCandidate=>{
    const saved=previous.get(id);
    const verdict=saved&&saved.status!=='pending'?saved.status:status;
    const matchScore=(status===verdict?story.matchScore:undefined)??saved?.matchScore;
    const source=localSourceKey(story.source);
    let choice=saved?.choice||choices.get(source);
    if(!choice){
     let batch=batches.length-1;
     if(batches.length>=maxSuggestionBatches)batch=batches.findLastIndex(receipt=>receipt.stories.length<5);
     // 旧草稿可能已占满普通候选批次。追加索引候选时仍保留原来的选择坐标。
     if(batch<0||batches[batch].stories.length>=5){
      batch=batches.length;batches.push({stories:[],note:''});
     }
     const stories=batches[batch].stories;
     choice={batch,index:stories.length};
     choices.set(source,choice);stories.push({...story,matchScore});batchesUpdated=true;
    }
    const stored=batches[choice.batch].stories[choice.index];
    const matchReason=status===verdict?story.matchReason:undefined;
    if((matchScore!==undefined&&stored.matchScore!==matchScore)||(matchReason&&stored.matchReason!==matchReason)){
     if(matchScore!==undefined)stored.matchScore=matchScore;
     if(matchReason)stored.matchReason=matchReason;
     batchesUpdated=true;
    }
    return {id,title:story.title,...(summary?{summary}:{}),...(matchScore!==undefined?{matchScore}:{}),status:verdict,choice};
   });
   if(!batchesUpdated&&JSON.stringify(candidates)===JSON.stringify(intake!.indexedCandidates))return true;
   const saved=await this.database.prepare(`UPDATE stories SET document=json_set(document,'$.intake.indexedCandidates',json(?),'$.intake.batches',json(?))
    WHERE id=? AND user_id=? AND document=? AND NOT EXISTS (SELECT 1 FROM library_deletions WHERE story_id=stories.id AND user_id=stories.user_id)`)
    .bind(JSON.stringify(candidates),JSON.stringify(batches),id,ownerId,row.document).run();
   if(saved.meta.changes)return true;
  }
  throw new ReaderError(503,'候选进度暂未保存，请重试查找。');
 }
 // 最终派发边界只读一次配置；与提前门控之间发生的只读切换不消费付费尝试。
 private jobProvider(job:ProductionJob){
  const provider=this.provider.capture?this.provider.capture():this.provider;
  if(!provider)throw new JobYield();this.jobProviders.set(job.id,provider);return provider;
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
   let published=false;
   const onIndexedCandidates=this.options.targetSessionId?undefined:async(candidates:IndexedStoryUpdate[])=>{
    if(!await this.saveIndexedCandidates(row.id,row.user_id,round,candidates))active.controller.abort();
    active.controller.signal.throwIfAborted();
    published=true;
   };
   const result=await provider.suggestions(selection,titles,undefined,{signal:active.controller.signal,drain:true,maxStories:1,cycleId:search.cycleId,onIndexedCandidates,onProgress:progress=>{active.progress=progress;}},sources);
   const current=published?(JSON.parse((await this.raw(row.id,row.user_id)).document) as Document).intake!:intake;
   const savedStories=published?current.batches.flatMap(batch=>batch.stories):excluded;
   const batch=freshSuggestions(suggestionBatchSchema.parse(result),savedStories.map(story=>story.title),savedStories.flatMap(story=>story.source?[story.source]:[]));
   // 索引候选已经保存。若旧缓存还提供了索引之外的候选，仍按原流程保留。
   const append=current.batches.length<maxSuggestionBatches&&(!published||batch.stories.length>0);
   const saved=await this.finishSearch(row.id,row.user_id,round,{...search,state:'idle',error:null},append?batch:undefined,!!onIndexedCandidates&&!published&&!!intake.indexedCandidates);
   return saved?{batches:current.batches.length+Number(append)}:{obsolete:true};
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
 // Superseded work can never run again, so it should stop costing every scheduling pass.
 // Covers every story, including those no viewer or background intent is scheduling right now.
 private async pruneSuperseded(forceId?:string){
  const candidates=(await this.database.prepare(`SELECT s.*,j.queued_count,j.failed_count FROM (
   SELECT session_id,owner_id,COUNT(CASE WHEN state='queued' THEN 1 END) AS queued_count,COUNT(CASE WHEN state='failed' THEN 1 END) AS failed_count
   FROM production_jobs WHERE state IN('queued','failed') GROUP BY session_id,owner_id
   ) j JOIN stories s ON s.id=j.session_id AND s.user_id=j.owner_id`).all<SessionRow&{queued_count:number;failed_count:number}>()).results;
  const seen=new Set<string>();
  for(const row of candidates){
   if(this.options.targetSessionId&&row.id!==this.options.targetSessionId)continue;
   seen.add(row.id);
   const key={document:row.document,selection:row.selection,queued:row.queued_count,failed:row.failed_count},previous=this.pruneKeys.get(row.id);
   if(forceId!==row.id&&previous?.document===key.document&&previous.selection===key.selection&&previous.queued===key.queued&&previous.failed===key.failed||!this.readable(row))continue;
   await this.database.prepare(`DELETE FROM production_jobs WHERE session_id=? AND owner_id=? AND state IN('queued','failed') AND EXISTS(SELECT 1 FROM stories s WHERE s.id=production_jobs.session_id AND s.user_id=production_jobs.owner_id
   AND CASE WHEN json_valid(s.document) AND json_type(s.document,'$.intake')='object' THEN
    CASE WHEN production_jobs.kind='discover'
     THEN COALESCE(json_extract(production_jobs.payload,'$.searchRound'),-1)!=CASE WHEN json_extract(s.document,'$.intake.search.state')='searching' THEN json_extract(s.document,'$.intake.search.round') ELSE -2 END
     ELSE COALESCE(json_extract(production_jobs.payload,'$.setupGeneration'),-1)!=json_extract(s.document,'$.intake.generation') END
    ELSE 0 END)`).bind(row.id,row.user_id).run();
   const jobs=await this.queue.jobs(row.id,row.user_id),current=await this.currentJobs(row,jobs),ids=new Set(current.map(job=>job.id));
   const legacyFaults=new Set((await sessionFaults(this.database,row.id,row.user_id)).filter(f=>f.version==='legacy').map(f=>f.job_id));
   const obsolete=jobs.filter(job=>!legacyFaults.has(job.id)&&['image','image-publish'].includes(job.kind)&&['queued','failed'].includes(job.state)&&!ids.has(job.id));
   if(!obsolete.length){this.pruneKeys.set(row.id,key);continue;}
   // A current worker may have saved its error before the queue has recorded that failure.
   if(row.state==='failed'&&obsolete.some(job=>job.state==='failed'&&job.error===row.error)&&!current.some(job=>['failed','running'].includes(job.state))){
    await this.database.prepare("UPDATE stories SET state='idle',error=NULL WHERE id=? AND user_id=? AND state='failed' AND error IS ? AND document=? AND selection=?")
     .bind(row.id,row.user_id,row.error,row.document,row.selection).run();
   }
   for(const job of obsolete)await this.database.prepare("DELETE FROM production_jobs WHERE id=? AND state IN('queued','failed')").bind(job.id).run();
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
 // A search job only stays failed when it can never resume. Report that as the search's failure.
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
   await this.database.prepare("DELETE FROM production_jobs WHERE id=? AND state='failed'").bind(job.id).run();
  }
 }
 private async script(job:ProductionJob){
  const provider=this.jobProvider(job);
  let row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document;
  if(!this.currentJob(row,job))return {obsolete:true};
  if(doc.plan&&doc.original&&reviewPassed(doc))return {pages:doc.plan.pages.length};
  const selection=selectionSchema.parse(JSON.parse(row.selection)),stepKey=(JSON.parse(job.payload) as {stepKey?:string}).stepKey;
  // A crash can save a batch before settling its queue receipt. Never replay that paid call.
  if(stepKey&&stepKey!==nextStep(doc,selection,0)?.key)return {storyboardFrames:doc.storyboard?.pages.length||0};
  let failure:unknown,acquired:string|undefined,result:SessionView;
  try{
   result=await advanceStory(this.repository,provider.generator(),row.user_id,row.id,0,true,token=>{acquired=token;this.leases.set(row.id,{ownerId:row.user_id,token});},error=>{failure=error;});
  }catch(error){
   if(!(error instanceof ReaderError&&error.status===404))throw error;
   const saved=await this.find(row.id,row.user_id);
   if(failure){
    const terminal=failure instanceof ReaderError&&failure.status<500;
    if(this.stopping&&!terminal)await this.database.prepare("UPDATE stories SET state='idle',error=NULL WHERE id=? AND user_id=? AND state='failed'").bind(row.id,row.user_id).run();
    throw terminal?failure:new ReaderError(503,saved?.error||provider.safeError(failure));
   }
   if(!acquired||saved&&saved.lock_token!==acquired)throw new JobYield();
   throw error;
  }
  if(result.state==='failed'){
   // The engine records its failure before the queue can classify it, so undo that for a stop.
   // A 4xx stays failed: replaying a blocked review would pay for repair without the reader asking.
   const terminal=failure instanceof ReaderError&&failure.status<500;
   if(this.stopping&&!terminal)await this.database.prepare("UPDATE stories SET state='idle',error=NULL WHERE id=? AND user_id=? AND state='failed'").bind(row.id,row.user_id).run();
   throw terminal?failure:new ReaderError(503,result.error||'故事编排暂未完成');
  }
  // A step was waiting but the story changed first. Nothing ran, so take it on the next turn.
  if(!acquired&&result.retryAllowed)throw new JobYield();
  if(result.awaitingFrameCount)return {awaitingFrameCount:true};
  if(result.intake?.phase==='confirming')return {awaitingProductionConfirmation:true};
  row=await this.raw(row.id,row.user_id);doc=JSON.parse(row.document) as Document;
  if(doc.visualReview&&!reviewPassed(doc))return {review:doc.visualReview.status};
  if(doc.draft)return {storyboardFrames:doc.draft.pages.length,reflectionPending:true};
  if(doc.storyboard&&!doc.plan)return {storyboardFrames:doc.storyboard.pages.length};
  if(job.kind==='prepare'&&doc.frameRecommendation&&!doc.plan)return {prepared:true};
  // A retried legacy script may finish its saved summary before it can plan; keep the same grant.
  if(job.kind==='script'&&!doc.plan&&doc.original?.storyBrief?.verified&&doc.frameRecommendation)throw new JobYield();
  if(!doc.plan||!doc.original)throw new ReaderError(503,'故事仍在更新，请重试继续。');
  return {pages:doc.plan.pages.length};
 }
 private async image(job:ProductionJob){
  const provider=this.jobProvider(job);
  const row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
  if(!this.currentJob(row,job))return {obsolete:true};
  const {page}=JSON.parse(job.payload) as {page:number};
  if(!reviewPassed(doc))throw new ReaderError(409,'分镜尚未通过审片，暂不生成图片。');
  const command=job.recovery_id?await commandReceipt(this.database,row.user_id,job.recovery_id):null;
  const redraw=command?.action==='recover'&&!!JSON.parse(command.payload).redraw;
  if(doc.images[page]&&!redraw)return {value:doc.images[page],model:'saved',requestId:null,usage:null};
  if(redraw&&doc.images[page]){
   const restored=referenceImageKey(row.id,doc.images[page]);
   if(restored&&!await this.fileLost(restored,true))return {value:doc.images[page],model:'saved',requestId:null,usage:null};
  }
  if(page>0&&!doc.images[0])throw new ReaderError(409,'角色参考尚未保存');
  // Check before paying. A key that can't resolve keeps the provider's existing error.
  const selectedReference=await new BookImageReferences(this.database,this.media,row.user_id).resolve(row.id,page>0?doc.images[0]:'');
  const reference=selectedReference?referenceImageKey(row.id,selectedReference):null;
  if(reference&&await this.fileLost(reference).catch(()=>{throw new ReaderError(503,'参考图片暂时无法核对，请稍后重试；尚未开始绘图。');}))throw new ReaderError(409,lostImageMessage);
  if(!this.currentJob(await this.raw(job.session_id,job.owner_id),job))return {obsolete:true};
  if(await this.repository.superseded(row.id,row.user_id))throw new JobYield();
  return provider.generator().image(doc.plan!,page,row.id,selectedReference,selection.artStyle,selection.productionPrompt,inputVersion([job.id,job.lease_token]));
 }
 private async publish(job:ProductionJob,outputs:Record<string,unknown>){
  if(!this.currentJob(await this.raw(job.session_id,job.owner_id),job))return {obsolete:true};
  const {page}=JSON.parse(job.payload) as {page:number},parent=jobDependencies(job)[0];
  const result=outputs[parent] as Generated<string>,prefix=`/api/reader/media/${job.session_id}/`,expected=new RegExp(`^(?:${page}\\.(png|jpg|webp)|artifacts/${page}-[a-f0-9]{64}\\.(png|jpg|webp))$`);
  if(typeof result?.value!=='string'||!result.value.startsWith(prefix)||!expected.test(result.value.slice(prefix.length)))throw new ReaderError(409,lostImageMessage);
  if(await this.fileLost(`reader/${job.session_id}/${result.value.slice(prefix.length)}`,true))throw new ReaderError(409,lostImageMessage);
  const row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document;
  if(!this.currentJob(row,job))return {obsolete:true};
  if(doc.images[page]===result.value)return {value:result.value};
  const lease=this.leases.get(row.id);if(!lease)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');
  const usage={step:`image:${page}`,model:result.model,requestId:result.requestId,usage:result.usage,...(result.promptRecord?{promptRecord:result.promptRecord}:{})};
  const saved=await this.database.prepare(`UPDATE stories SET document=json_set(document,?, ?, '$.usage',json_insert(json_extract(document,'$.usage'),'$[#]',json(?))),updated_at=?
   WHERE id=? AND user_id=? AND state='running' AND lock_token=? AND COALESCE(json_extract(document,?),'')=?
   AND json_remove(selection,'$.displayTitle')=json_remove(?,'$.displayTitle') AND json_extract(document,'$.plan')=json_extract(?,'$.plan')
   AND COALESCE(json_extract(document,'$.intake.generation'),-1)=?
   AND EXISTS(SELECT id FROM production_jobs WHERE id=? AND state='running' AND lease_token=?)`)
   .bind(`$.images[${page}]`,result.value,JSON.stringify(usage),new Date(this.clock()).toISOString(),row.id,row.user_id,lease.token,`$.images[${page}]`,doc.images[page]||'',row.selection,row.document,doc.intake?.generation??-1,job.id,job.lease_token).run();
  if(saved.meta.changes!==1)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');
  return {value:result.value};
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
 private async settleHealthyCheckpoints(){
  // Local completion is independent of generation permission or a viewer. A crash after a saved
  // checkpoint cannot leave a healthy paused story waiting for an unrelated Resume command.
  const rows=(await this.database.prepare("SELECT * FROM stories WHERE state='idle' AND json_valid(document) AND json_type(document,'$.plan')='object' AND json_type(document,'$.original')='object' AND NOT EXISTS(SELECT 1 FROM reader_faults f WHERE f.session_id=stories.id AND f.owner_id=stories.user_id AND f.state IN ('pending','recovering'))").all<SessionRow>()).results;
  for(const row of rows){
   if(this.options.targetSessionId&&row.id!==this.options.targetSessionId)continue;
   if(!this.readable(row)||!productionComplete(JSON.parse(row.document) as Document,selectionSchema.parse(JSON.parse(row.selection))))continue;
   await this.database.prepare("UPDATE stories SET state='completed',error=NULL WHERE id=? AND user_id=? AND state='idle' AND document=? AND NOT EXISTS(SELECT 1 FROM reader_faults f WHERE f.session_id=stories.id AND f.owner_id=stories.user_id AND f.state IN ('pending','recovering'))").bind(row.id,row.user_id,row.document).run();
  }
 }
 private async cycle(){
  await this.database.prepare('DELETE FROM production_demand WHERE expires_at<=?'+(this.options.targetSessionId?' AND session_id=?':'')).bind(this.clock(),...(this.options.targetSessionId?[this.options.targetSessionId]:[])).run();
  await this.queue.renew();
  for(const [id,lease] of this.leases){
   const now=this.clock();
   await this.database.prepare("UPDATE stories SET lock_until=? WHERE id=? AND user_id=? AND state='running' AND lock_token=?")
    .bind(now+(this.options.leaseMs||sessionLeaseMs),id,lease.ownerId,lease.token).run();
  }
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
    const jobs=await this.currentJobs(row);
    if(jobs.some(job=>job.state==='failed'&&!job.interrupted||job.state==='running'&&job.lease_until>this.clock()))continue;
    await this.database.prepare("UPDATE stories SET state='idle',lock_token=NULL,lock_until=0,error=NULL WHERE id=? AND user_id=? AND state='running' AND lock_until<=? AND lock_token IS ? AND document=? AND selection=?")
     .bind(row.id,row.user_id,this.clock(),row.lock_token,row.document,row.selection).run();
   }
  }
  await this.settleHealthyCheckpoints();
  const demands=await this.demands(),seen=new Set<string>();
  for(const demand of demands)if(!seen.has(demand.session_id)){
   seen.add(demand.session_id);
   try{
    const row=await this.repository.get(demand.session_id,demand.owner_id);
    const key={document:row.document,selection:row.selection,state:row.state,demands:JSON.stringify(demands.filter(d=>d.session_id===row.id&&d.owner_id===row.user_id).map(d=>[d.viewer_id,d.page,d.through_page]).sort())},previous=this.rebuildKeys.get(row.id);
    if(this.readable(row)&&!(previous?.document===key.document&&previous.selection===key.selection&&previous.state===key.state&&previous.demands===key.demands)){await this.graph(row);this.rebuildKeys.set(row.id,key);}
   }catch(error){if(!(error instanceof ReaderError&&error.status===404))throw error;}
  }
  for(const id of this.rebuildKeys.keys())if(!seen.has(id))this.rebuildKeys.delete(id);
  const superseded=(await this.database.prepare(`SELECT id FROM stories WHERE generation_control='active' AND EXISTS(SELECT 1 FROM production_jobs j WHERE j.session_id=stories.id AND j.owner_id=stories.user_id AND j.state='queued' AND j.kind!='image-publish' AND (j.kind='discover' OR stories.state!='failed')) AND ${supersededSql()}`).all<{id:string}>()).results;
  this.supersededJobs=new Set(superseded.map(row=>row.id));
  for(const id of this.parsedRows.keys())if(!seen.has(id)&&!this.pruneKeys.has(id)&&!this.leases.has(id))this.parsedRows.delete(id);
  await this.queue.pump();
  for(const [id,lease] of this.leases){
   // Read jobs before the row: no running job then proves nothing can change the document we save.
   const allJobs=await this.queue.jobs(id,lease.ownerId),row=await this.find(id,lease.ownerId);
   if(!row){this.leases.delete(id);continue;}
   // Releasing the lease lets the lock expire; the row itself is left untouched.
   if(!this.readable(row)){this.leases.delete(id);continue;}
   const jobs=await this.currentJobs(row,allJobs);
   const pendingLocal=jobs.some(job=>job.kind==='image-publish'&&job.state==='queued'&&jobs.some(parent=>parent.id===jobDependencies(job)[0]&&parent.state==='succeeded'));
   if(jobs.some(job=>job.state==='running')||pendingLocal)continue;
   const doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
   // An interruption is not a story failure: the job resumes, and the row must not block it.
   const failed=jobs.find(job=>job.state==='failed'&&!job.interrupted);
   const faults=await this.faults(row,jobs);
   await this.repository.save(row,lease.token,doc,!faults.length&&productionComplete(doc,selection),failed?.error||faults.find(fault=>fault.kind!=='interrupted'||(jobs.find(job=>job.id===fault.job_id)?.attempts||0)>=maxAutomaticAttempts)?.message||null).catch(error=>{if(!(error instanceof ReaderError&&[404,409].includes(error.status)))throw error;});
   this.leases.delete(id);
  }
 }
 stop(){this.stopping=true;this.queue.stop();clearInterval(this.timer);for(const search of this.searches.values())search.controller.abort();}
 get busy(){return !!this.ticking||this.queue.busy||this.leases.size>0||!!this.provider.discoveryBusy?.();}
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
