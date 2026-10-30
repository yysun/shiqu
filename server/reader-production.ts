// Coordinate reader demand with durable script, image and local publication jobs.
// Paid work needs fresh viewer demand or durable background intent; manual control overrides both.
// Scheduling errors never latch: a failed tick dispatches nothing and the next one retries, while
// an unreadable story is skipped alone. Interrupted work resumes within a bounded replay allowance.
// A lost image file is redrawn only on explicit retry. An open story's first image, current page
// and read-ahead go first, and other stories yield while its publication frees the next slot.
import {randomUUID} from 'node:crypto';
import {ReaderRepository,persistenceError} from '../lib/reader-repository.ts';
import type {Database} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import type {Generated} from '../lib/reader-engine.ts';
import {ReaderError,readableStory,selectionSchema,view,nextStep,reviewPassed,productionComplete} from '../lib/reader-model.ts';
import type {Document,SessionRow,SessionView,ProductionAction} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import {mediaType} from '../lib/reader-generation-contract.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {suggestionBatchSchema,freshSuggestions} from '../lib/reader-suggestions.ts';
import {readerMaxFrames,readerStoryboardBatchSize} from '../lib/reader-limits.ts';
import {productionReadAhead,productionViewerLeaseMs} from '../lib/reader-production.ts';
import type {ReaderProduction} from '../lib/reader-production.ts';
import {ProductionQueue,inputVersion,productionJobId} from './production-queue.ts';
import type {ProductionJob,JobSpec} from './production-queue.ts';

type Demand={session_id:string;owner_id:string;viewer_id:string;page:number;through_page:number;expires_at:number;runtime_id:string};
type Lease={ownerId:string;token:string};
type Options={imageWorkers?:number;now?:()=>number;leaseMs?:number;tickMs?:number};
const sessionLeaseMs=180000;
const maxAutomaticAttempts=3;
const publicationYieldMs=15000;
// This exact text marks a job for redraw on retry; the job table has no other place to record it.
const lostImageMessage='这幅图片的文件已丢失或损坏。重试会重新绘制这一幅，可能再次消耗额度。';
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
 private readonly clock:()=>number;
 private timer:ReturnType<typeof setInterval>;
 private scheduled:ReturnType<typeof setImmediate>|undefined;
 private ticking:Promise<void>|undefined;
 private stopping=false;
 private closed=false;
 private tickFailing=false;
 private readonly unreadable=new Set<string>();
 private database:Database;
 private provider:ReaderProvider;
 private media:MediaStore;
 private options:Options;
 constructor(database:Database,provider:ReaderProvider,media:MediaStore,options:Options={}){
  this.database=database;this.provider=provider;this.media=media;this.options=options;
  this.clock=options.now||Date.now;this.repository=new ReaderRepository(database);
  this.queue=new ProductionQueue(database,{
   limits:{text:1,image:options.imageWorkers??3,local:2},now:this.clock,leaseMs:options.leaseMs,
   canRun:job=>this.canRun(job),resumeInterrupted:job=>this.resumeInterrupted(job),onSettled:()=>this.wake(),
   safeError:(error,job)=>error instanceof ReaderError?error.message:job.kind==='image-publish'?'图片已生成，暂时无法展开。请重试继续。':this.provider.safeError(error),
   terminal:error=>error instanceof ReaderError&&error.status<500,
   handlers:{
    discover:{pool:'text',run:job=>this.discover(job)},
    prepare:{pool:'text',run:job=>this.script(job)},
    script:{pool:'text',run:job=>this.script(job)},
    image:{pool:'image',run:job=>this.image(job)},
    'image-publish':{pool:'local',drain:true,run:(job,context)=>this.publish(job,context.outputs)},
   },
  });
  this.timer=setInterval(()=>this.wake(),options.tickMs||1000);this.timer.unref();this.wake();
 }
 private async raw(id:string,ownerId:string){
  const row=await this.database.prepare('SELECT * FROM reader_sessions WHERE id=? AND user_id=?').bind(id,ownerId).first<SessionRow>();
  if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');return row;
 }
 private currentJob(row:SessionRow,job:ProductionJob){const generation=(JSON.parse(row.document) as Document).intake?.generation;return generation===undefined||(JSON.parse(job.payload) as {setupGeneration?:number}).setupGeneration===generation;}
 private async currentJobs(row:SessionRow,saved?:ProductionJob[]){
  const jobs=saved||await this.queue.jobs(row.id,row.user_id),generation=(JSON.parse(row.document) as Document).intake?.generation;
  return generation===undefined?jobs:jobs.filter(job=>(JSON.parse(job.payload) as {setupGeneration?:number}).setupGeneration===generation);
 }
 private async demands(id?:string){
  const viewers=(await this.database.prepare(`SELECT * FROM production_demand WHERE runtime_id=? AND expires_at>?${id?' AND session_id=?':''}`)
   .bind(this.runtimeId,this.clock(),...(id?[id]:[])).all<Demand>()).results;
  const background=(await this.database.prepare(`SELECT id,user_id FROM reader_sessions WHERE generation_mode='background' AND generation_control='active' AND state!='completed'
   AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=reader_sessions.id AND d.user_id=reader_sessions.user_id)${id?' AND id=?':''}`)
   .bind(...(id?[id]:[])).all<{id:string;user_id:string}>()).results;
  return [...viewers,...background.map(row=>({session_id:row.id,owner_id:row.user_id,viewer_id:'background',page:0,through_page:readerMaxFrames-1,expires_at:Infinity,runtime_id:this.runtimeId}))];
 }
 private readable(row:SessionRow){
  if(readableStory(row))return true;
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
  if(!this.readable(row)||!this.currentJob(row,job))return false;
  return row.generation_mode==='background'&&row.generation_control==='active'&&!await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first();
 }
 async control(ownerId:string,id:string,action:ProductionAction){
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  await this.repository.control(id,ownerId,action);this.wake();return this.snapshot(ownerId,id);
 }
 async managed(ownerId:string,id:string){const saved=await this.database.prepare('SELECT document FROM reader_sessions WHERE id=? AND user_id=?').bind(id,ownerId).first<{document:string}>();if(saved&&(JSON.parse(saved.document) as Document).intake)return true;return !!await this.database.prepare('SELECT id FROM production_jobs WHERE owner_id=? AND session_id=? LIMIT 1').bind(ownerId,id).first();}
 async request(ownerId:string,id:string,viewerId:string,page:number,retry=false){return this.demand(ownerId,id,viewerId,page,page+productionReadAhead,retry);}
 async advance(ownerId:string,id:string,throughPage:number,retry:boolean){return this.demand(ownerId,id,'legacy-advance',0,throughPage,retry);}
 private async demand(ownerId:string,id:string,viewerId:string,page:number,throughPage:number,retry:boolean){
  if(this.stopping)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  const row=await this.repository.get(id,ownerId),doc=JSON.parse(row.document) as Document;
  if(row.generation_control!=='active')return this.snapshot(ownerId,id);
  if(doc.plan&&page>=doc.plan.pages.length)throw new ReaderError(400,'请选择有效画幅');
  await this.database.prepare(`INSERT INTO production_demand(session_id,owner_id,viewer_id,page,through_page,expires_at,runtime_id) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(session_id,owner_id,viewer_id) DO UPDATE SET page=excluded.page,through_page=excluded.through_page,expires_at=excluded.expires_at,runtime_id=excluded.runtime_id`)
   .bind(id,ownerId,viewerId,page,Math.min(readerMaxFrames-1,throughPage),this.clock()+productionViewerLeaseMs,this.runtimeId).run();
  if(retry){
   await this.queue.recoverExpired();await this.recoverLostImages(await this.raw(id,ownerId));await this.queue.retry(id,ownerId);
   await this.database.prepare("UPDATE reader_sessions SET state='idle',error=NULL WHERE id=? AND user_id=? AND state='failed'").bind(id,ownerId).run();
  }
  await this.graph(await this.raw(id,ownerId));
  this.wake();return this.snapshot(ownerId,id);
 }
 async leave(ownerId:string,id:string,viewerId:string){
  await this.database.prepare('DELETE FROM production_demand WHERE session_id=? AND owner_id=? AND viewer_id=? AND runtime_id=?').bind(id,ownerId,viewerId,this.runtimeId).run();this.wake();
 }
 async snapshot(ownerId:string,id:string):Promise<SessionView>{
  const row=await this.repository.get(id,ownerId),saved=view(row);
  const jobs=await this.currentJobs(row),failed=jobs.find(job=>job.state==='failed'&&job.error===lostImageMessage)||jobs.find(job=>job.state==='failed');
  const active=jobs.filter(job=>job.state==='running'&&job.lease_until>this.clock()).sort((a,b)=>a.updated_at-b.updated_at);
  // Claim timestamps measure this attempt, rather than time since the story was first created.
  const session={...saved,generationProgress:{...saved.generationProgress!,startedAt:active[0]?.updated_at??null,attempt:active[0]?.attempts??saved.generationProgress!.attempt}};
  const working=active.length>0||jobs.some(job=>job.kind==='image-publish'&&job.state==='queued'&&jobs.some(parent=>parent.id===(JSON.parse(job.dependencies) as string[])[0]&&parent.state==='succeeded'));
  if(failed&&!working){
   const lost=failed.error===lostImageMessage;
   return {...session,state:'failed',error:failed.error,retryAllowed:true,retryMayCharge:lost||failed.kind!=='image-publish',...(lost?{retryStage:'redraw' as const}:failed.kind==='image-publish'?{retryStage:'publication' as const}:{})};
  }
  const demands=await this.demands(id),eligible=jobs.some(job=>job.state==='queued'&&demands.some(d=>job.pool==='text'||(JSON.parse(job.payload) as {page:number}).page<=d.through_page));
  const manual=row.generation_control!=='active';
  const productionState=manual?'paused':working?'running':eligible?'queued':'paused';
  if(session.state!=='failed'&&session.state!=='completed'&&!manual&&(working||eligible))return {...session,state:'running',productionState};
  // A saved session state alone cannot prove that the queue is still executing.
  return {...session,productionState};
 }
 private spec(row:SessionRow,kind:string,pool:string,version:string,key:string,dependencies:string[],payload:unknown,priority:number):JobSpec{
  return {id:productionJobId(row.id,kind,version,key),sessionId:row.id,ownerId:row.user_id,kind,pool,version,dependencies,payload,priority};
 }
 private async graph(row:SessionRow){
  const doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
  if(doc.intake?.phase==='discovering'){await this.queue.enqueue(this.spec(row,'discover','text',inputVersion({selection,generation:doc.intake.generation}),'',[],{setupGeneration:doc.intake.generation},-10));return;}
  if(doc.intake&&['choosing','confirming'].includes(doc.intake.phase))return;
  const preparing=selection.narrativeDetail&&!doc.frameCountConfirmed&&!doc.plan;
  // A distinct job owns each saved planning checkpoint; the empty key is the complete-script barrier.
  const scriptKey=!preparing&&(!doc.plan||!reviewPassed(doc))&&(doc.visualReview||doc.storyboard||selection.length==='auto'||selection.length>readerStoryboardBatchSize)?nextStep(doc,selection,0)?.key||'':doc.visualReview?'approved':'';
  const setup=doc.intake?{setupGeneration:doc.intake.generation}:{};
  const scriptVersion=inputVersion({selection,...setup}),script=this.spec(row,preparing?'prepare':'script','text',scriptVersion,scriptKey,[],{stepKey:scriptKey,...setup},-10);
  await this.queue.enqueue(script,doc.plan&&doc.original&&reviewPassed(doc)?{pages:doc.plan.pages.length}:undefined);
  if(!doc.plan||!doc.original||!reviewPassed(doc))return;
  if(doc.plan.pages.every((_,page)=>!!doc.images[page])){
   await this.database.prepare("UPDATE reader_sessions SET state='completed',error=NULL WHERE id=? AND user_id=? AND state='idle' AND document=?").bind(row.id,row.user_id,row.document).run();return;
  }
  // SQLite json_set cannot fill a missing array index out of order; reserve all slots first.
  if(doc.images.length<doc.plan.pages.length){
   const normalized=doc.plan.pages.map((_,page)=>doc.images[page]||'');
   const saved=await this.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.images',json(?)) WHERE id=? AND user_id=? AND document=?")
    .bind(JSON.stringify(normalized),row.id,row.user_id,row.document).run();
   if(!saved.meta.changes)return;
  }
  const demands=await this.demands(row.id);if(!demands.length)return;
  const end=Math.min(doc.plan.pages.length-1,Math.max(...demands.map(d=>d.through_page)));
  const version=inputVersion({scriptVersion,plan:doc.plan,style:selection.artStyle,prompt:selection.productionPrompt});
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
  const row=await this.raw(job.session_id,job.owner_id);
  if(!this.readable(row)||!this.currentJob(row,job))return false;
  const local=job.kind==='image-publish';
  if(!local){
   if(row.generation_control!=='active')return false;
   if(this.stopping||!(await this.demands(row.id)).some(d=>job.pool==='text'||(JSON.parse(job.payload) as {page:number}).page<=d.through_page))return false;
   if(await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first())return false;
   const jobs=await this.currentJobs(row);
   if(jobs.some(job=>job.state==='failed')||row.state==='failed')return false;
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
  return !!await this.database.prepare(`SELECT 1 FROM production_demand d
   CROSS JOIN reader_sessions s ON s.id=d.session_id AND s.user_id=d.owner_id
   CROSS JOIN production_jobs p ON p.session_id=s.id AND p.owner_id=s.user_id
   CROSS JOIN production_jobs parent ON parent.id=json_extract(p.dependencies,'$[0]')
   WHERE d.runtime_id=? AND d.expires_at>? AND s.generation_control='active'
   AND p.kind='image-publish' AND (p.state='running' AND p.updated_at>? OR p.state='queued' AND parent.state='succeeded' AND parent.updated_at>?)
   AND EXISTS(SELECT 1 FROM production_jobs i WHERE i.session_id=s.id AND i.owner_id=s.user_id AND i.kind='image' AND i.state='queued' AND i.priority<=?)
   AND NOT EXISTS(SELECT 1 FROM production_jobs f WHERE f.session_id=s.id AND f.owner_id=s.user_id AND f.state='failed' AND (json_extract(CASE WHEN json_valid(s.document) THEN s.document ELSE '{}' END,'$.intake.generation') IS NULL OR json_extract(f.payload,'$.setupGeneration')=json_extract(CASE WHEN json_valid(s.document) THEN s.document ELSE '{}' END,'$.intake.generation')))
   AND NOT EXISTS(SELECT 1 FROM library_deletions l WHERE l.story_id=s.id AND l.user_id=s.user_id) LIMIT 1`)
   .bind(this.runtimeId,now,recent,recent,productionReadAhead).first();
 }
 // Publication needs the bytes to match the saved type; a reference only needs what providers accept.
 private async fileLost(key:string,strict=false){
  const asset=await this.media.get(key);if(!asset)return true;
  const type=mediaType(new Uint8Array(await asset.arrayBuffer()));
  return strict?type!==asset.contentType:!type;
 }
 // An explicit retry is the reader's consent to pay again, and a file that came back needs no redraw.
 private async recoverLostImages(row:SessionRow){
  const jobs=await this.currentJobs(row),pageOf=(job:ProductionJob)=>(JSON.parse(job.payload) as {page:number}).page;
  for(const marked of jobs.filter(job=>job.state==='failed'&&job.error===lostImageMessage)){
   const publishing=marked.kind==='image-publish',page=publishing?pageOf(marked):0;
   const peers=jobs.filter(job=>job.version===marked.version&&job.pool!=='text'&&pageOf(job)===page);
   const image=peers.find(job=>job.kind==='image'),publication=peers.find(job=>job.kind==='image-publish');
   if(!image||!publication)continue;
   const doc=JSON.parse((await this.raw(row.id,row.user_id)).document) as Document;
   const saved=publishing?(JSON.parse(image.result||'null') as Generated<string>|null)?.value:doc.images[0];
   const key=saved?referenceImageKey(row.id,saved):null;
   // A read that throws is transient, so it must never lead to paying again.
   if(key&&!await this.fileLost(key,publishing).catch(()=>false))continue;
   await this.queue.rerun(image.id);await this.queue.rerun(publication.id);
   if(saved)await this.database.prepare('UPDATE reader_sessions SET document=json_set(document,?,\'\') WHERE id=? AND user_id=? AND json_extract(document,?)=?')
    .bind(`$.images[${page}]`,row.id,row.user_id,`$.images[${page}]`,saved).run();
  }
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
   await this.database.prepare("UPDATE reader_sessions SET state='failed',error=?,lock_token=NULL,lock_until=0,updated_at=? WHERE id=? AND user_id=? AND state='running' AND lock_until<=?")
    .bind('上次制作已中断，已保留保存的结果。',new Date(this.clock()).toISOString(),row.id,row.user_id,this.clock()).run();return false;
  }
  const token=randomUUID(),now=this.clock();
  const acquired=await this.database.prepare(`UPDATE reader_sessions SET state='running',lock_token=?,lock_until=?,error=NULL,updated_at=?
   WHERE id=? AND user_id=? AND state=? AND document=? AND ${allowDeleted?'1=1':"NOT EXISTS (SELECT 1 FROM library_deletions WHERE story_id=reader_sessions.id AND user_id=reader_sessions.user_id)"}`)
   .bind(token,now+(this.options.leaseMs||sessionLeaseMs),new Date(now).toISOString(),row.id,row.user_id,row.state,row.document).run();
  if(acquired.meta.changes){this.leases.set(row.id,{ownerId:row.user_id,token});return true;}return false;
 }
 private async discover(job:ProductionJob){
  const row=await this.repository.get(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document;
  if(!this.currentJob(row,job)||doc.intake?.phase!=='discovering')return {obsolete:true};
  const selection=selectionSchema.parse(JSON.parse(row.selection)),token=await this.repository.acquire(row,{kind:'discover',page:0,key:'discover:'+doc.intake.generation});
  if(!token)throw new ReaderError(409,'选题任务状态已更新，请稍后重试。');
  this.leases.set(row.id,{ownerId:row.user_id,token});
  let writes=Promise.resolve();
  try{
   const excluded=doc.intake.batches.flatMap(batch=>batch.stories),titles=excluded.map(story=>story.title),sources=excluded.flatMap(story=>story.source?[story.source]:[]);
   const controller=new AbortController();
   const result=await this.provider.suggestions(selection,titles,undefined,{signal:controller.signal,onProgress:progress=>{
    doc.intake!.progress=progress;const snapshot=structuredClone(doc);
    writes=writes.then(()=>this.repository.saveImageProgress(row,token,snapshot));void writes.catch(()=>{});
   }},sources);
   await writes;
   doc.intake.batches.push(freshSuggestions(suggestionBatchSchema.parse(result),titles,sources));doc.intake.phase='choosing';delete doc.intake.progress;
   await this.repository.save(row,token,doc,false);return {batches:doc.intake.batches.length};
  }catch(error){await writes.catch(()=>{});if(persistenceError(error)||error instanceof ReaderError&&error.status===404)throw error;const terminal=error instanceof ReaderError&&error.status<500;await this.repository.save(row,token,doc,false,this.stopping&&!terminal?null:error instanceof ReaderError?error.message:this.provider.safeError(error));throw error;}
 }
 private async script(job:ProductionJob){
  let row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document;
  if(!this.currentJob(row,job))return {obsolete:true};
  if(doc.plan&&doc.original&&reviewPassed(doc))return {pages:doc.plan.pages.length};
  const selection=selectionSchema.parse(JSON.parse(row.selection)),stepKey=(JSON.parse(job.payload) as {stepKey?:string}).stepKey;
  // A crash can save a batch before settling its queue receipt. Never replay that paid call.
  if(stepKey&&stepKey!==nextStep(doc,selection,0)?.key)return {storyboardFrames:doc.storyboard?.pages.length||0};
  let failure:unknown;
  const result=await advanceStory(this.repository,this.provider.generator(),row.user_id,row.id,0,true,token=>this.leases.set(row.id,{ownerId:row.user_id,token}),error=>{failure=error;});
  if(result.state==='failed'){
   // The engine records its failure before the queue can classify it, so undo that for a stop.
   // A 4xx stays failed: replaying a blocked review would pay for repair without the reader asking.
   const terminal=failure instanceof ReaderError&&failure.status<500;
   if(this.stopping&&!terminal)await this.database.prepare("UPDATE reader_sessions SET state='idle',error=NULL WHERE id=? AND user_id=? AND state='failed'").bind(row.id,row.user_id).run();
   throw terminal?failure:new ReaderError(503,result.error||'故事编排暂未完成');
  }
  if(result.awaitingFrameCount)return {awaitingFrameCount:true};
  if(result.intake?.phase==='confirming')return {awaitingProductionConfirmation:true};
  row=await this.raw(row.id,row.user_id);doc=JSON.parse(row.document) as Document;
  if(doc.visualReview&&!reviewPassed(doc))return {review:doc.visualReview.status};
  if(doc.storyboard&&!doc.plan)return {storyboardFrames:doc.storyboard.pages.length};
  if(!doc.plan||!doc.original)throw new ReaderError(503,'故事仍在更新，请重试继续。');
  return {pages:doc.plan.pages.length};
 }
 private async image(job:ProductionJob){
  const row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
  const {page}=JSON.parse(job.payload) as {page:number};
  if(!reviewPassed(doc))throw new ReaderError(409,'分镜尚未通过审片，暂不生成图片。');
  if(doc.images[page])return {value:doc.images[page],model:'saved',requestId:null,usage:null};
  if(page>0&&!doc.images[0])throw new ReaderError(409,'角色参考尚未保存');
  // Check before paying. A key that can't resolve keeps the provider's existing error.
  const reference=page>0?referenceImageKey(row.id,doc.images[0]):null;
  if(reference&&await this.fileLost(reference).catch(()=>false))throw new ReaderError(409,lostImageMessage);
  return this.provider.generator().image(doc.plan!,page,row.id,doc.images[0]||'',selection.artStyle,selection.productionPrompt,inputVersion([job.id,job.lease_token]));
 }
 private async publish(job:ProductionJob,outputs:Record<string,unknown>){
  const {page}=JSON.parse(job.payload) as {page:number},parent=(JSON.parse(job.dependencies) as string[])[0];
  const result=outputs[parent] as Generated<string>,prefix=`/api/reader/media/${job.session_id}/`,expected=new RegExp(`^(?:${page}\\.(png|jpg|webp)|artifacts/${page}-[a-f0-9]{64}\\.(png|jpg|webp))$`);
  if(typeof result?.value!=='string'||!result.value.startsWith(prefix)||!expected.test(result.value.slice(prefix.length)))throw new ReaderError(409,lostImageMessage);
  if(await this.fileLost(`reader/${job.session_id}/${result.value.slice(prefix.length)}`,true))throw new ReaderError(409,lostImageMessage);
  const row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document;
  if(doc.images[page]){
   if(doc.images[page]!==result.value)throw new ReaderError(409,'这幅图片已经更新，请重新打开故事。');
   return {value:result.value};
  }
  const lease=this.leases.get(row.id);if(!lease)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');
  const usage={step:`image:${page}`,model:result.model,requestId:result.requestId,usage:result.usage};
  const saved=await this.database.prepare(`UPDATE reader_sessions SET document=json_set(document,?, ?, '$.usage',json_insert(json_extract(document,'$.usage'),'$[#]',json(?))),updated_at=?
   WHERE id=? AND user_id=? AND state='running' AND lock_token=? AND COALESCE(json_extract(document,?),'')=''
   AND EXISTS(SELECT id FROM production_jobs WHERE id=? AND state='running' AND lease_token=?)`)
   .bind(`$.images[${page}]`,result.value,JSON.stringify(usage),new Date(this.clock()).toISOString(),row.id,row.user_id,lease.token,`$.images[${page}]`,job.id,job.lease_token).run();
  if(saved.meta.changes!==1)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');
  return {value:result.value};
 }
 wake(){
  if(this.closed||this.scheduled)return;
  this.scheduled=setImmediate(()=>{this.scheduled=undefined;void this.tick().then(()=>{this.tickFailing=false;},error=>this.tickFailed(error));});
 }
 async tick(){
  if(this.closed)return;if(this.ticking)return this.ticking;
  const work=this.cycle();this.ticking=work;
  try{await work;}finally{if(this.ticking===work)this.ticking=undefined;}
 }
 private async cycle(){
  await this.queue.renew();
  for(const [id,lease] of this.leases){
   const now=this.clock();
   await this.database.prepare("UPDATE reader_sessions SET lock_until=? WHERE id=? AND user_id=? AND state='running' AND lock_token=?")
    .bind(now+(this.options.leaseMs||sessionLeaseMs),id,lease.ownerId,lease.token).run();
  }
  await this.queue.recoverExpired();
  // A dead runtime cannot renew these locks. Preserve every live session/job lease across processes.
  if(!this.stopping)await this.database.prepare(`UPDATE reader_sessions SET state='idle',lock_token=NULL,lock_until=0,error=NULL
   WHERE state='running' AND lock_until<=? AND generation_mode='background' AND generation_control='active'
   AND NOT EXISTS(SELECT 1 FROM production_jobs j WHERE j.session_id=reader_sessions.id AND j.owner_id=reader_sessions.user_id AND (json_extract(CASE WHEN json_valid(reader_sessions.document) THEN reader_sessions.document ELSE '{}' END,'$.intake.generation') IS NULL OR json_extract(j.payload,'$.setupGeneration')=json_extract(CASE WHEN json_valid(reader_sessions.document) THEN reader_sessions.document ELSE '{}' END,'$.intake.generation')) AND (j.state='failed' AND j.interrupted=0 OR j.state='running' AND j.lease_until>?))
   AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=reader_sessions.id AND d.user_id=reader_sessions.user_id)`)
   .bind(this.clock(),this.clock()).run();
  const demands=await this.demands(),seen=new Set<string>();
  for(const demand of demands)if(!seen.has(demand.session_id)){
   seen.add(demand.session_id);
   try{const row=await this.repository.get(demand.session_id,demand.owner_id);if(this.readable(row))await this.graph(row);}catch(error){if(!(error instanceof ReaderError&&error.status===404))throw error;}
  }
  await this.queue.pump();
  for(const [id,lease] of this.leases){
   // Read jobs before the row: no running job then proves nothing can change the document we save.
   const allJobs=await this.queue.jobs(id,lease.ownerId),row=await this.raw(id,lease.ownerId);
   // Releasing the lease lets the lock expire; the row itself is left untouched.
   if(!this.readable(row)){this.leases.delete(id);continue;}
   const jobs=await this.currentJobs(row,allJobs);
   const pendingLocal=jobs.some(job=>job.kind==='image-publish'&&job.state==='queued'&&jobs.some(parent=>parent.id===(JSON.parse(job.dependencies) as string[])[0]&&parent.state==='succeeded'));
   if(jobs.some(job=>job.state==='running')||pendingLocal)continue;
   const doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
   // An interruption is not a story failure: the job resumes, and the row must not block it.
   const failed=jobs.find(job=>job.state==='failed'&&!job.interrupted);
   await this.repository.save(row,lease.token,doc,productionComplete(doc,selection),failed?.error||null).catch(error=>{if(!(error instanceof ReaderError&&[404,409].includes(error.status)))throw error;});
   this.leases.delete(id);
  }
 }
 stop(){this.stopping=true;this.queue.stop();clearInterval(this.timer);}
 get busy(){return !!this.ticking||this.queue.busy||this.leases.size>0;}
 async close(){
  this.stop();
  if(this.scheduled){clearImmediate(this.scheduled);this.scheduled=undefined;}
  if(!this.busy){this.closed=true;return;}
  // A scheduling error must not skip closing SQLite; undrained publications resume at next start.
  const attempt=(work:Promise<void>)=>work.catch(error=>this.tickFailed(error));
  if(this.ticking)await attempt(this.ticking);
  do{await attempt(this.tick());await this.queue.settle();await attempt(this.tick());}while(this.queue.busy);
  this.closed=true;
 }
}
