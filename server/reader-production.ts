// Coordinate reader demand with durable script, image and local publication jobs.
// Only paid work needs a live viewer. Successful artifacts still publish after leaving/deletion.
import {randomUUID} from 'node:crypto';
import {ReaderRepository} from '../lib/reader-repository.ts';
import type {Database} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import type {Generated} from '../lib/reader-engine.ts';
import {ReaderError,selectionSchema,view,nextStep} from '../lib/reader-model.ts';
import type {Document,SessionRow,SessionView} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import {mediaType} from '../lib/reader-generation-contract.ts';
import {productionReadAhead,productionViewerLeaseMs} from '../lib/reader-production.ts';
import type {ReaderProduction} from '../lib/reader-production.ts';
import {ProductionQueue,inputVersion,productionJobId} from './production-queue.ts';
import type {ProductionJob,JobSpec} from './production-queue.ts';

type Demand={session_id:string;owner_id:string;viewer_id:string;page:number;through_page:number;expires_at:number;runtime_id:string};
type Lease={ownerId:string;token:string};
type Options={imageWorkers?:number;now?:()=>number;leaseMs?:number;tickMs?:number};
const sessionLeaseMs=180000;
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
 private fault=false;
 private database:Database;
 private provider:ReaderProvider;
 private media:MediaStore;
 private options:Options;
 constructor(database:Database,provider:ReaderProvider,media:MediaStore,options:Options={}){
  this.database=database;this.provider=provider;this.media=media;this.options=options;
  this.clock=options.now||Date.now;this.repository=new ReaderRepository(database);
  this.queue=new ProductionQueue(database,{
   limits:{text:1,image:options.imageWorkers??3,local:2},now:this.clock,leaseMs:options.leaseMs,
   canRun:job=>this.canRun(job),onSettled:()=>this.wake(),
   safeError:(error,job)=>error instanceof ReaderError?error.message:job.kind==='image-publish'?'图片已生成，暂时无法展开。请重试继续。':this.provider.safeError(error),
   handlers:{
    prepare:{pool:'text',run:job=>this.script(job)},
    script:{pool:'text',run:job=>this.script(job)},
    image:{pool:'image',run:job=>this.image(job)},
    'image-publish':{pool:'local',drain:true,run:(job,context)=>this.publish(job,context.outputs)},
   },
  });
  this.timer=setInterval(()=>this.wake(),options.tickMs||1000);this.timer.unref();
 }
 private async raw(id:string,ownerId:string){
  const row=await this.database.prepare('SELECT * FROM reader_sessions WHERE id=? AND user_id=?').bind(id,ownerId).first<SessionRow>();
  if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');return row;
 }
 private async demands(id?:string){
  return (await this.database.prepare(`SELECT * FROM production_demand WHERE runtime_id=? AND expires_at>?${id?' AND session_id=?':''}`)
   .bind(this.runtimeId,this.clock(),...(id?[id]:[])).all<Demand>()).results;
 }
 async managed(ownerId:string,id:string){return !!await this.database.prepare('SELECT id FROM production_jobs WHERE owner_id=? AND session_id=? LIMIT 1').bind(ownerId,id).first();}
 async request(ownerId:string,id:string,viewerId:string,page:number,retry=false){return this.demand(ownerId,id,viewerId,page,page+productionReadAhead,retry);}
 async advance(ownerId:string,id:string,throughPage:number,retry:boolean){return this.demand(ownerId,id,'legacy-advance',0,throughPage,retry);}
 private async demand(ownerId:string,id:string,viewerId:string,page:number,throughPage:number,retry:boolean){
  if(this.stopping||this.fault)throw new ReaderError(503,'制作服务正在停止，请稍后重新打开故事。');
  const row=await this.repository.get(id,ownerId),doc=JSON.parse(row.document) as Document;
  if(doc.plan&&page>=doc.plan.pages.length)throw new ReaderError(400,'请选择有效画幅');
  await this.database.prepare(`INSERT INTO production_demand(session_id,owner_id,viewer_id,page,through_page,expires_at,runtime_id) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(session_id,owner_id,viewer_id) DO UPDATE SET page=excluded.page,through_page=excluded.through_page,expires_at=excluded.expires_at,runtime_id=excluded.runtime_id`)
   .bind(id,ownerId,viewerId,page,Math.min(59,throughPage),this.clock()+productionViewerLeaseMs,this.runtimeId).run();
  if(retry){
   await this.queue.recoverExpired();await this.queue.retry(id,ownerId);
   await this.database.prepare("UPDATE reader_sessions SET state='idle',error=NULL WHERE id=? AND user_id=? AND state='failed'").bind(id,ownerId).run();
  }
  await this.graph(await this.raw(id,ownerId));
  this.wake();return this.snapshot(ownerId,id);
 }
 async leave(ownerId:string,id:string,viewerId:string){
  await this.database.prepare('DELETE FROM production_demand WHERE session_id=? AND owner_id=? AND viewer_id=? AND runtime_id=?').bind(id,ownerId,viewerId,this.runtimeId).run();this.wake();
 }
 async snapshot(ownerId:string,id:string):Promise<SessionView>{
  const row=await this.repository.get(id,ownerId),session=view(row);
  const jobs=await this.queue.jobs(id,ownerId),failed=jobs.find(job=>job.state==='failed');
  const working=jobs.some(job=>job.state==='running'||job.kind==='image-publish'&&job.state==='queued'&&jobs.some(parent=>parent.id===(JSON.parse(job.dependencies) as string[])[0]&&parent.state==='succeeded'));
  if(failed&&!working)return {...session,state:'failed',error:failed.error,retryAllowed:true,retryMayCharge:failed.kind!=='image-publish',...(failed.kind==='image-publish'?{retryStage:'publication' as const}:{})};
  const demands=await this.demands(id),eligible=jobs.some(job=>job.state==='queued'&&demands.some(d=>job.pool==='text'||(JSON.parse(job.payload) as {page:number}).page<=d.through_page));
  if(session.state!=='failed'&&session.state!=='completed'&&(working||eligible))return {...session,state:'running'};
  return session;
 }
 private spec(row:SessionRow,kind:string,pool:string,version:string,key:string,dependencies:string[],payload:unknown,priority:number):JobSpec{
  return {id:productionJobId(row.id,kind,version,key),sessionId:row.id,ownerId:row.user_id,kind,pool,version,dependencies,payload,priority};
 }
 private async graph(row:SessionRow){
  const doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
  const preparing=selection.narrativeDetail&&!doc.frameCountConfirmed&&!doc.plan;
  const scriptVersion=inputVersion({selection}),script=this.spec(row,preparing?'prepare':'script','text',scriptVersion,'',[],{},-10);
  await this.queue.enqueue(script,doc.plan&&doc.original?{pages:doc.plan.pages.length}:undefined);
  if(!doc.plan||!doc.original)return;
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
   const priority=Math.min(...demands.map(d=>Math.max(0,page-d.page))),payload={page};
   const image=this.spec(row,'image','image',version,String(page),page===0?[script.id]:[script.id,anchor],payload,priority);
   const publication=this.spec(row,'image-publish','local',version,String(page),[image.id],payload,-5);
   const saved=doc.images[page],receipt=saved?{value:saved,model:'saved',requestId:null,usage:null}:undefined;
   await this.queue.enqueue(image,receipt);await this.queue.enqueue(publication,saved?{value:saved}:undefined);
  }
 }
 private async canRun(job:ProductionJob){
  const row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document;
  const local=job.kind==='image-publish';
  if(!local){
   if(this.stopping||this.fault||!(await this.demands(row.id)).some(d=>job.pool==='text'||(JSON.parse(job.payload) as {page:number}).page<=d.through_page))return false;
   if(await this.database.prepare('SELECT story_id FROM library_deletions WHERE story_id=? AND user_id=?').bind(row.id,row.user_id).first())return false;
   const jobs=await this.queue.jobs(row.id,row.user_id);
   if(jobs.some(job=>job.state==='failed')||row.state==='failed')return false;
   // Apply backpressure until a completed image is published; a local failure must stop refill.
   if(job.kind==='image'&&jobs.some(job=>job.kind==='image-publish'&&job.state==='running'))return false;
  }
  if(job.pool==='text')return row.state!=='running'||row.lock_until<=this.clock();
  if(!doc.plan||!doc.original)return false;
  return this.ownSession(row,local);
 }
 private async ownSession(row:SessionRow,allowDeleted:boolean){
  const lease=this.leases.get(row.id);
  if(lease){
   if(row.state==='running'&&row.lock_token===lease.token&&row.lock_until>this.clock())return true;
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
 private async script(job:ProductionJob){
  let row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document;
  if(doc.plan&&doc.original)return {pages:doc.plan.pages.length};
  const result=await advanceStory(this.repository,this.provider.generator(),row.user_id,row.id,0,true,token=>this.leases.set(row.id,{ownerId:row.user_id,token}));
  if(result.state==='failed')throw new ReaderError(503,result.error||'故事编排暂未完成');
  if(result.awaitingFrameCount)return {awaitingFrameCount:true};
  row=await this.raw(row.id,row.user_id);doc=JSON.parse(row.document) as Document;
  if(!doc.plan||!doc.original)throw new ReaderError(503,'故事仍在更新，请重试继续。');
  return {pages:doc.plan.pages.length};
 }
 private async image(job:ProductionJob){
  const row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
  const {page}=JSON.parse(job.payload) as {page:number};
  if(doc.images[page])return {value:doc.images[page],model:'saved',requestId:null,usage:null};
  if(page>0&&!doc.images[0])throw new ReaderError(409,'角色参考尚未保存');
  return this.provider.generator().image(doc.plan!,page,row.id,doc.images[0]||'',selection.artStyle,selection.productionPrompt,inputVersion([job.id,job.lease_token]));
 }
 private async publish(job:ProductionJob,outputs:Record<string,unknown>){
  const {page}=JSON.parse(job.payload) as {page:number},parent=(JSON.parse(job.dependencies) as string[])[0];
  const result=outputs[parent] as Generated<string>,prefix=`/api/reader/media/${job.session_id}/`,expected=new RegExp(`^(?:${page}\\.(png|jpg|webp)|artifacts/${page}-[a-f0-9]{64}\\.(png|jpg|webp))$`);
  if(!result||!result.value.startsWith(prefix)||!expected.test(result.value.slice(prefix.length)))throw new ReaderError(502,'保存的图片结果无效，已保留制作记录。');
  const file=result.value.slice(prefix.length),asset=await this.media.get(`reader/${job.session_id}/${file}`);
  if(!asset||mediaType(new Uint8Array(await asset.arrayBuffer()))!==asset.contentType)throw new ReaderError(503,'图片已生成，但保存的图片暂时无法读取。请重试发布。');
  const row=await this.raw(job.session_id,job.owner_id),doc=JSON.parse(row.document) as Document;
  if(doc.images[page]){
   if(doc.images[page]!==result.value)throw new ReaderError(409,'这幅图片已经更新，请重新打开故事。');
   return {value:result.value};
  }
  const lease=this.leases.get(row.id);if(!lease)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');
  const usage={step:`image:${page}`,model:result.model,requestId:result.requestId,usage:result.usage};
  const saved=await this.database.prepare(`UPDATE reader_sessions SET document=json_set(document,?, ?, '$.usage',json_insert(json_extract(document,'$.usage'),'$[#]',json(?))),updated_at=?
   WHERE id=? AND user_id=? AND state='running' AND lock_token=? AND lock_until>? AND COALESCE(json_extract(document,?),'')=''
   AND EXISTS(SELECT id FROM production_jobs WHERE id=? AND state='running' AND lease_token=? AND lease_until>?)`)
   .bind(`$.images[${page}]`,result.value,JSON.stringify(usage),new Date(this.clock()).toISOString(),row.id,row.user_id,lease.token,this.clock(),`$.images[${page}]`,job.id,job.lease_token,this.clock()).run();
  if(saved.meta.changes!==1)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');
  return {value:result.value};
 }
 wake(){
  if(this.closed||this.scheduled)return;
  this.scheduled=setImmediate(()=>{this.scheduled=undefined;void this.tick().catch(()=>{this.fault=true;this.queue.stop();});});
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
   await this.database.prepare("UPDATE reader_sessions SET lock_until=? WHERE id=? AND user_id=? AND state='running' AND lock_token=? AND lock_until>?")
    .bind(now+(this.options.leaseMs||sessionLeaseMs),id,lease.ownerId,lease.token,now).run();
  }
  await this.queue.recoverExpired();
  const demands=await this.demands(),seen=new Set<string>();
  for(const demand of demands)if(!seen.has(demand.session_id)){
   seen.add(demand.session_id);
   try{await this.graph(await this.repository.get(demand.session_id,demand.owner_id));}catch(error){if(!(error instanceof ReaderError&&error.status===404))throw error;}
  }
  await this.queue.pump();
  for(const [id,lease] of this.leases){
   const jobs=await this.queue.jobs(id,lease.ownerId);
   const pendingLocal=jobs.some(job=>job.kind==='image-publish'&&job.state==='queued'&&jobs.some(parent=>parent.id===(JSON.parse(job.dependencies) as string[])[0]&&parent.state==='succeeded'));
   if(jobs.some(job=>job.state==='running')||pendingLocal)continue;
   const row=await this.raw(id,lease.ownerId),doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
   const failed=jobs.find(job=>job.state==='failed');
   await this.repository.save(row,lease.token,doc,!nextStep(doc,selection,59),failed?.error||null).catch(error=>{if(!(error instanceof ReaderError&&[404,409].includes(error.status)))throw error;});
   this.leases.delete(id);
  }
 }
 stop(){this.stopping=true;this.queue.stop();clearInterval(this.timer);}
 get busy(){return !!this.ticking||this.queue.busy||this.leases.size>0;}
 async close(){
  this.stop();
  if(this.scheduled){clearImmediate(this.scheduled);this.scheduled=undefined;}
  if(!this.busy){this.closed=true;return;}
  if(this.ticking)await this.ticking;
  do{await this.tick();await this.queue.settle();await this.tick();}while(this.queue.busy);
  this.closed=true;
 }
}
