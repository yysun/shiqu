// Schedule durable, versioned jobs in independent bounded pools. Dependencies consume saved
// outputs; lease tokens prevent late completions from overwriting a replacement attempt.
// Wall-clock expiry only reclaims attempts from dead services, so a live one survives sleep.
// Stop-time and persistence errors recover as interruptions, never as job failures.
// Finished jobs re-run only through an explicit rerun, which the caller must have consent for.
// Scoped step timing is saved atomically with receipts, under the same attempt token.
// 任务状态变化与故障、恢复回执在同一事务中写入（production-records.ts），失败同时记录结构化错误码。
// 每个任务在任务范围内执行，范围内缺少发送许可的付费发送会被拒绝（paid-dispatch.ts）。
import {createHash,randomUUID} from 'node:crypto';
import {persistenceError} from '../lib/reader-repository.ts';
import {authorizeJobLease,classifyJobFailure,resolveInterruptedJob} from '../lib/production-lifecycle.ts';
import type {Database,SyncStatements} from '../lib/reader-repository.ts';
import {transact,recordJobFailed,recordJobRequeued,recordJobRunning,recordJobSucceeded} from './production-records.ts';
import {withProductionJob} from './paid-dispatch.ts';

export type JobSpec={id:string;sessionId:string;ownerId:string;kind:string;pool:string;version:string;dependencies:string[];payload:unknown;priority:number};
export type ProductionJob={id:string;session_id:string;owner_id:string;kind:string;pool:string;version:string;dependencies:string;payload:string;result:string|null;state:'queued'|'running'|'succeeded'|'failed';priority:number;attempts:number;lease_token:string|null;lease_until:number;error:string|null;error_code?:string|null;interrupted:number;failure_id?:string|null;recovery_id?:string|null;created_at:number;updated_at:number};
export type JobContext={outputs:Record<string,unknown>;isCurrent:()=>Promise<boolean>};
export type JobHandler={pool:string;drain?:boolean;run:(job:ProductionJob,context:JobContext)=>Promise<unknown>};
type Options={targetSessionId?:string;limits:Record<string,number>;handlers:Record<string,JobHandler>;candidateFilter?:string;skipCandidate?:(job:ProductionJob)=>boolean;canRun?:(job:ProductionJob)=>Promise<boolean>;canClaim?:(db:SyncStatements,job:ProductionJob,now:number)=>boolean;onSettled?:()=>void;resumeInterrupted?:(job:ProductionJob)=>Promise<boolean>;safeError?:(error:unknown,job:ProductionJob)=>string;errorCode?:(error:unknown,job:ProductionJob)=>string|undefined;terminal?:(error:unknown,job:ProductionJob)=>boolean;now?:()=>number;leaseMs?:number};
const interruptedMessage='上次生成已中断，已保留保存的结果。请重试继续。';
// A handler that stopped without spending an attempt: the job waits in the queue for its next turn.
export class JobYield extends Error{
 readonly waitingFor?:'image-availability';
 constructor(waitingFor?:'image-availability'){super(waitingFor);this.waitingFor=waitingFor;}
}
export function inputVersion(input:unknown){return createHash('sha256').update(JSON.stringify(input)).digest('hex');}
export function productionJobId(scope:string,kind:string,version:string,key=''){return inputVersion([scope,kind,version,key]);}
const dependencyCache=new WeakMap<ProductionJob,string[]>();
export function jobDependencies(job:ProductionJob){let value=dependencyCache.get(job);if(!value){value=JSON.parse(job.dependencies) as string[];dependencyCache.set(job,value);}return value;}
const timedPayload="CASE WHEN json_type(payload,'$.timingStage')='text' THEN json_insert(json_set(payload,'$.timings',COALESCE(json_extract(payload,'$.timings'),json('[]'))),'$.timings[#]',json(?)) ELSE payload END";
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
  const now=this.clock();
  transact(this.database,db=>{
   const where="session_id=? AND owner_id=? AND state IN('failed','queued') AND kind NOT IN ('discover','landscape-image') AND (? IS NULL OR json_extract(payload,'$.setupGeneration')=?)";
   const interrupted=db.all<ProductionJob>(`SELECT * FROM production_jobs WHERE ${where} AND state='failed' AND interrupted=1`,sessionId,ownerId,generation??null,generation??null);
   db.run(`UPDATE production_jobs SET state='queued',error=NULL,interrupted=0,lease_token=NULL,lease_until=0,attempts=0,updated_at=? WHERE ${where}`,now,sessionId,ownerId,generation??null,generation??null);
   for(const job of interrupted)recordJobRequeued(db,job,now);
  });
 }
 // Run a finished job again from scratch. Only an explicit retry may decide to pay for this.
 async rerun(id:string){
  const now=this.clock();
  transact(this.database,db=>{
   const job=db.get<ProductionJob>('SELECT * FROM production_jobs WHERE id=?',id);
   db.run("UPDATE production_jobs SET payload=CASE WHEN state='succeeded' AND json_valid(payload) THEN json_remove(payload,'$.paid') ELSE payload END,state='queued',result=NULL,error=NULL,interrupted=0,lease_token=NULL,lease_until=0,attempts=0,updated_at=? WHERE id=? AND state IN('succeeded','failed')",now,id);
   if(job?.state==='failed'&&job.interrupted)recordJobRequeued(db,job,now);
  });
 }
 async recoverExpired(){
  // Only explicitly opted-in background work can replay an uncertain remote attempt.
  const expired=(await this.database.prepare(`SELECT * FROM production_jobs WHERE ((state='running' AND lease_until<=?) OR (state='failed' AND interrupted=1))${this.options.targetSessionId?" AND session_id=?":""}`).bind(this.clock(),...(this.options.targetSessionId?[this.options.targetSessionId]:[])).all<ProductionJob>()).results;
  for(const job of expired){
   try{
   // This process is still running the attempt, so its clock jumped; the attempt is not abandoned.
   const running=job.state==='running',localLease=running&&this.tokens.get(job.id)===job.lease_token;
   const resume=!localLease&&!!await this.options.resumeInterrupted?.(job);
   const effect=resolveInterruptedJob({running,localLease,resume});
   if(effect==='preserve')continue;
   const now=this.clock();
   transact(this.database,db=>{
    if(effect==='fail'){
     // 失败记录与新故障同时写入；运行中的任务以租约核对，已失败的中断任务保留原失败编号。
     const live=db.get('SELECT id FROM production_jobs WHERE id=? AND state=\'running\' AND lease_token IS ? AND lease_until=? AND lease_until<=?',job.id,job.lease_token,job.lease_until,now);
     if(live)recordJobFailed(db,job,{message:interruptedMessage,interrupted:true,errorCode:'TIMEOUT',failureId:job.failure_id??undefined,now});
     return;
    }
    const changed=db.run(`UPDATE production_jobs SET state='queued',error=NULL,interrupted=0,lease_token=NULL,lease_until=0,updated_at=?
     WHERE id=? AND state=? AND lease_token IS ? AND lease_until=? AND (state!='running' OR lease_until<=?)`,now,job.id,job.state,job.lease_token,job.lease_until,now).changes;
    if(changed&&job.state==='failed'&&job.interrupted)recordJobRequeued(db,job,now);
   });
   }catch(error){this.contain(job,error);}
  }
 }
 async renew(){
  for(const [id,token] of this.tokens){
   const now=this.clock();
   // 时钟跳过到期点后，仍持有原令牌的任务也要先核对池容量，避免挤占已被重新分配的名额。
   await this.database.prepare(`UPDATE production_jobs AS j SET lease_until=? WHERE id=? AND lease_token=? AND state='running'
    AND (lease_until>? OR (SELECT count(*) FROM production_jobs active WHERE active.pool=j.pool AND active.state='running' AND active.lease_until>?)<
     COALESCE(json_extract(?,'$.'||json_quote(j.pool)),1))`)
    .bind(now+this.leaseMs,id,token,now,now,JSON.stringify(this.options.limits)).run();
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
    const claimed=transact(this.database,db=>{
     // 异步预筛之后重新读取任务和授权条件。领取、回执和这次读取在同一写事务内。
     const live=db.get<ProductionJob>("SELECT * FROM production_jobs WHERE id=? AND state='queued'",job.id);
     if(!live||this.stopping&&!handler.drain||this.options.canClaim&&!this.options.canClaim(db,live,now))return null;
     const changes=db.run(`UPDATE production_jobs AS j SET state='running',lease_token=?,lease_until=?,attempts=attempts+1,error=NULL,interrupted=0,updated_at=?
      WHERE id=? AND state='queued' AND ${ready} AND (SELECT COUNT(*) FROM production_jobs WHERE pool=? AND state='running' AND lease_until>?)<?`,token,now+this.leaseMs,now,live.id,live.pool,now,limit).changes;
     if(!changes)return null;
     recordJobRunning(db,live,now);
     return {...live,state:'running' as const,lease_token:token,lease_until:now+this.leaseMs,attempts:live.attempts+1,updated_at:now};
    });
    if(!claimed)continue;
    const task=this.execute(claimed,handler)
     .finally(()=>{this.tasks.delete(job.id);this.tokens.delete(job.id);this.options.onSettled?.();});
    this.tasks.set(job.id,task);this.tokens.set(job.id,token);
    }catch(error){this.contain(job,error);}
   }
  }finally{this.pumping=false;}
 }
 /** 领取后未送出任务，按租约同时退回任务和恢复回执。 */
 private releaseClaim(job:ProductionJob,waitingFor?:JobYield['waitingFor']){
  const now=this.clock();
  transact(this.database,db=>{
   const changed=db.run(`UPDATE production_jobs SET state='queued',attempts=attempts-1,lease_token=NULL,lease_until=0,updated_at=?
    ${waitingFor?",payload=json_set(payload,'$.waitingFor',?)":''} WHERE id=? AND state='running' AND lease_token=?`,
    now,...(waitingFor?[waitingFor]:[]),job.id,job.lease_token).changes;
   if(changed)recordJobRequeued(db,job,now);
  });
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
    this.releaseClaim(job);return;
   }
  }catch(error){unsaved(error);return;}
  let result:unknown;
  // 任务范围使付费发送点能识别漏接发送许可的制作路径。
  try{result=await withProductionJob(()=>handler.run(job,{outputs,isCurrent}));}
  catch(error){
   try{
    const persistence=persistenceError(error),yielded=error instanceof JobYield;
    const code=persistence||yielded?undefined:this.options.errorCode?.(error,job);
    const outcome=classifyJobFailure({persistence,yielded,stopping:this.stopping,drains:!!handler.drain,
     terminal:this.stopping&&!handler.drain&&!!this.options.terminal?.(error,job),timeout:code==='TIMEOUT',contentBlocked:code==='CONTENT_BLOCKED'});
    if(outcome==='unsaved'){unsaved(error);return;}
    if(error instanceof JobYield&&outcome==='yield'){this.releaseClaim(job,error.waitingFor);return;}
    const interrupted=outcome==='interrupted';
    const message=interrupted?interruptedMessage:this.options.safeError?.(error,job)||'制作暂时未完成，已保存的结果会保留。';
    const finishedAt=this.clock(),timing=JSON.stringify({startedAt:job.updated_at,finishedAt});
    transact(this.database,db=>{
     const payload=db.get<{payload:string}>(`SELECT ${timedPayload} AS payload FROM production_jobs WHERE id=?`,timing,job.id)?.payload;
     recordJobFailed(db,job,{message,interrupted,errorCode:interrupted?'TIMEOUT':code,failureId:interrupted&&job.failure_id?job.failure_id:randomUUID(),now:finishedAt,payload});
    });
   }
   catch(writeError){unsaved(writeError);}
   return;
  }
  const finishedAt=this.clock(),timing=JSON.stringify({startedAt:job.updated_at,finishedAt});
  try{
   const saved=JSON.stringify(result??null);
   transact(this.database,db=>{
    const current=db.get<{lease_until:number}>("SELECT lease_until FROM production_jobs WHERE id=? AND state='running' AND lease_token=?",job.id,job.lease_token);
    if(authorizeJobLease({event:'settle',held:!!current,expired:!!current&&current.lease_until<=finishedAt})!=='allow')return;
    db.run(`UPDATE production_jobs SET payload=json_remove(${timedPayload},'$.waitingFor'),state='succeeded',result=?,error=NULL,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?`,timing,saved,finishedAt,job.id);
    recordJobSucceeded(db,job,saved,finishedAt);
   });
  }
  catch(error){unsaved(error);}
 }
 stop(){this.stopping=true;}
 get busy(){return this.tasks.size>0||this.pumping;}
 async settle(){await Promise.allSettled([...this.tasks.values()]);}
}
