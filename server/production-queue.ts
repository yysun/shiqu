// Schedule durable, versioned jobs in independent bounded pools. Dependencies consume saved
// outputs; lease tokens prevent late completions from overwriting a replacement attempt.
// Wall-clock expiry only reclaims attempts from dead services, so a live one survives sleep.
// Stop-time and persistence errors recover as interruptions, never as job failures.
// Finished jobs re-run only through an explicit rerun, which the caller must have consent for.
import {createHash,randomUUID} from 'node:crypto';
import {persistenceError} from '../lib/reader-repository.ts';
import type {Database} from '../lib/reader-repository.ts';

export type JobSpec={id:string;sessionId:string;ownerId:string;kind:string;pool:string;version:string;dependencies:string[];payload:unknown;priority:number};
export type ProductionJob={id:string;session_id:string;owner_id:string;kind:string;pool:string;version:string;dependencies:string;payload:string;result:string|null;state:'queued'|'running'|'succeeded'|'failed';priority:number;attempts:number;lease_token:string|null;lease_until:number;error:string|null;interrupted:number;created_at:number;updated_at:number};
export type JobContext={outputs:Record<string,unknown>;isCurrent:()=>Promise<boolean>};
export type JobHandler={pool:string;drain?:boolean;run:(job:ProductionJob,context:JobContext)=>Promise<unknown>};
type Options={limits:Record<string,number>;handlers:Record<string,JobHandler>;candidateFilter?:string;skipCandidate?:(job:ProductionJob)=>boolean;canRun?:(job:ProductionJob)=>Promise<boolean>;onSettled?:()=>void;resumeInterrupted?:(job:ProductionJob)=>Promise<boolean>;safeError?:(error:unknown,job:ProductionJob)=>string;terminal?:(error:unknown,job:ProductionJob)=>boolean;now?:()=>number;leaseMs?:number};
const interruptedMessage='上次生成已中断，已保留保存的结果。请重试继续。';
// A handler that stopped without spending an attempt: the job waits in the queue for its next turn.
export class JobYield extends Error{}
export function inputVersion(input:unknown){return createHash('sha256').update(JSON.stringify(input)).digest('hex');}
export function productionJobId(scope:string,kind:string,version:string,key=''){return inputVersion([scope,kind,version,key]);}
const dependencyCache=new WeakMap<ProductionJob,string[]>();
export function jobDependencies(job:ProductionJob){let value=dependencyCache.get(job);if(!value){value=JSON.parse(job.dependencies) as string[];dependencyCache.set(job,value);}return value;}
const ready=`NOT EXISTS (SELECT 1 FROM json_each(j.dependencies) d LEFT JOIN production_jobs parent ON parent.id=d.value WHERE parent.id IS NULL OR parent.state!='succeeded')`;

export class ProductionQueue{
 readonly database:Database;
 readonly options:Options;
 readonly tasks=new Map<string,Promise<void>>();
 private tokens=new Map<string,string>();
 private pumping=false;
 private stopping=false;
 private clock:()=>number;
 private leaseMs:number;
 private readonly unreadableJobs=new Set<string>();
 private contain(job:ProductionJob,error:unknown){
  if(persistenceError(error))throw error;
  if(!this.unreadableJobs.has(job.id)){this.unreadableJobs.add(job.id);console.error('production_job_unreadable',JSON.stringify({id:job.id,code:(error as {code?:string})?.code||'UNKNOWN'}));}
 }
 constructor(database:Database,options:Options){
  this.database=database;this.options=options;this.clock=options.now||Date.now;this.leaseMs=options.leaseMs||180000;
  for(const limit of Object.values(options.limits))if(!Number.isInteger(limit)||limit<1)throw Error('INVALID_POOL_LIMIT');
 }
 async enqueue(spec:JobSpec,completed?:unknown){
  const now=this.clock();
  await this.database.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,priority,attempts,lease_until,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,0,0,?,?) ON CONFLICT(id) DO UPDATE SET priority=excluded.priority`)
   .bind(spec.id,spec.sessionId,spec.ownerId,spec.kind,spec.pool,spec.version,JSON.stringify(spec.dependencies),JSON.stringify(spec.payload),completed===undefined?null:JSON.stringify(completed),completed===undefined?'queued':'succeeded',spec.priority,now,now).run();
 }
 async job(id:string){return this.database.prepare('SELECT * FROM production_jobs WHERE id=?').bind(id).first<ProductionJob>();}
 async jobs(sessionId:string,ownerId:string){return (await this.database.prepare('SELECT * FROM production_jobs WHERE session_id=? AND owner_id=? ORDER BY created_at,id').bind(sessionId,ownerId).all<ProductionJob>()).results;}
 async retry(sessionId:string,ownerId:string,generation?:number){
  // An explicit retry restores the automatic recovery allowance for the story's current selection.
  // Search is retried on its own, so a retried story never starts another round of it.
  await this.database.prepare("UPDATE production_jobs SET state='queued',error=NULL,interrupted=0,lease_token=NULL,lease_until=0,attempts=0,updated_at=? WHERE session_id=? AND owner_id=? AND state IN('failed','queued') AND kind!='discover' AND (? IS NULL OR json_extract(payload,'$.setupGeneration')=?)").bind(this.clock(),sessionId,ownerId,generation??null,generation??null).run();
 }
 // Run a finished job again from scratch. Only an explicit retry may decide to pay for this.
 async rerun(id:string){
  await this.database.prepare("UPDATE production_jobs SET state='queued',result=NULL,error=NULL,interrupted=0,lease_token=NULL,lease_until=0,attempts=0,updated_at=? WHERE id=? AND state IN('succeeded','failed')").bind(this.clock(),id).run();
 }
 async recoverExpired(){
  // Only explicitly opted-in background work can replay an uncertain remote attempt.
  const expired=(await this.database.prepare("SELECT * FROM production_jobs WHERE (state='running' AND lease_until<=?) OR (state='failed' AND interrupted=1)").bind(this.clock()).all<ProductionJob>()).results;
  for(const job of expired){
   try{
   // This process is still running the attempt, so its clock jumped; the attempt is not abandoned.
   if(job.state==='running'&&this.tokens.get(job.id)===job.lease_token)continue;
   const resume=!!await this.options.resumeInterrupted?.(job);
   if(job.state==='failed'&&!resume)continue;
   await this.database.prepare(`UPDATE production_jobs SET state=?,error=?,interrupted=?,lease_token=NULL,lease_until=0,updated_at=?
    WHERE id=? AND state=? AND lease_token IS ? AND lease_until=? AND (state!='running' OR lease_until<=?)`)
    .bind(resume?'queued':'failed',resume?null:interruptedMessage,resume?0:1,this.clock(),job.id,job.state,job.lease_token,job.lease_until,this.clock()).run();
   }catch(error){this.contain(job,error);}
  }
 }
 async renew(){
  for(const [id,token] of this.tokens){
   await this.database.prepare("UPDATE production_jobs SET lease_until=? WHERE id=? AND lease_token=? AND state='running'")
    .bind(this.clock()+this.leaseMs,id,token).run();
  }
 }
 async pump(){
  if(this.pumping)return;this.pumping=true;
  try{
   const candidates=(await this.database.prepare(`SELECT j.* FROM production_jobs j WHERE j.state='queued' AND ${ready}${this.options.candidateFilter?` AND (${this.options.candidateFilter})`:''} ORDER BY j.priority,j.created_at,j.id`).all<ProductionJob>()).results;
   for(const job of candidates){
    try{
    if(this.options.skipCandidate?.(job))continue;
    const handler=this.options.handlers[job.kind],limit=this.options.limits[job.pool];
    if(!handler||handler.pool!==job.pool||!limit||(this.stopping&&!handler.drain))continue;
    const running=await this.database.prepare("SELECT COUNT(*) AS n FROM production_jobs WHERE pool=? AND state='running' AND lease_until>?").bind(job.pool,this.clock()).first<{n:number}>();
    if(running!.n>=limit||this.tasks.has(job.id)||this.options.canRun&&!await this.options.canRun(job))continue;
    const token=randomUUID(),now=this.clock();
    const claimed=await this.database.prepare(`UPDATE production_jobs AS j SET state='running',lease_token=?,lease_until=?,attempts=attempts+1,error=NULL,interrupted=0,updated_at=?
     WHERE id=? AND state='queued' AND ${ready} AND (SELECT COUNT(*) FROM production_jobs WHERE pool=? AND state='running' AND lease_until>?)<?`)
     .bind(token,now+this.leaseMs,now,job.id,job.pool,now,limit).run();
    if(!claimed.meta.changes)continue;
    const task=this.execute({...job,state:'running',lease_token:token,lease_until:now+this.leaseMs,attempts:job.attempts+1},handler)
     .finally(()=>{this.tasks.delete(job.id);this.tokens.delete(job.id);this.options.onSettled?.();});
    this.tasks.set(job.id,task);this.tokens.set(job.id,token);
    }catch(error){this.contain(job,error);}
   }
  }finally{this.pumping=false;}
 }
 private async execute(job:ProductionJob,handler:JobHandler){
  const isCurrent=async()=>!!await this.database.prepare("SELECT id FROM production_jobs WHERE id=? AND state='running' AND lease_token=?").bind(job.id,job.lease_token).first();
  // A write that fails says nothing about the work. Leave the job running: its lease expires
  // once this task settles, and it recovers as an interruption against the replay cap.
  const unsaved=(error:unknown)=>console.error('production_job_unsaved',JSON.stringify({id:job.id,code:(error as {code?:string}|null)?.code||(error instanceof Error?error.name:'UNKNOWN')}));
  const outputs:Record<string,unknown>={};
  try{
   for(const id of jobDependencies(job)){const parent=await this.job(id);if(parent?.state!=='succeeded')throw Error('DEPENDENCY_UNAVAILABLE');outputs[id]=JSON.parse(parent.result!);}
   if(!await isCurrent())return;
   // Demand or a sibling failure may change while a claim is being prepared.
   if(this.stopping&&!handler.drain||this.options.canRun&&!await this.options.canRun(job)){
    // The handler never started, so this claim does not count against the replay cap.
    await this.database.prepare("UPDATE production_jobs SET state='queued',attempts=attempts-1,lease_token=NULL,lease_until=0 WHERE id=? AND state='running' AND lease_token=?").bind(job.id,job.lease_token).run();return;
   }
  }catch(error){unsaved(error);return;}
  let result:unknown;
  try{result=await handler.run(job,{outputs,isCurrent});}
  catch(error){
   if(persistenceError(error)){unsaved(error);return;}
   if(error instanceof JobYield){
    try{await this.database.prepare("UPDATE production_jobs SET state='queued',attempts=attempts-1,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND state='running' AND lease_token=?").bind(this.clock(),job.id,job.lease_token).run();}
    catch(writeError){unsaved(writeError);}
    return;
   }
   // A stop kills provider processes, so a failure now is not evidence about the work itself.
   const interrupted=this.stopping&&!handler.drain&&!this.options.terminal?.(error,job);
   // Only safe application messages are persisted; provider responses may contain private data.
   const message=interrupted?interruptedMessage:this.options.safeError?.(error,job)||'制作暂时未完成，已保存的结果会保留。';
   try{await this.database.prepare("UPDATE production_jobs SET state='failed',error=?,interrupted=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND state='running' AND lease_token=?")
    .bind(message,interrupted?1:0,this.clock(),job.id,job.lease_token).run();}
   catch(writeError){unsaved(writeError);}
   return;
  }
  try{await this.database.prepare("UPDATE production_jobs SET state='succeeded',result=?,error=NULL,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND state='running' AND lease_token=?")
   .bind(JSON.stringify(result??null),this.clock(),job.id,job.lease_token).run();}
  catch(error){unsaved(error);}
 }
 stop(){this.stopping=true;}
 get busy(){return this.tasks.size>0||this.pumping;}
 async settle(){await Promise.allSettled([...this.tasks.values()]);}
}
