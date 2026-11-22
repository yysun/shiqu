// 制作任务、故障、命令回执与故事文档写入的联动，在一个同步事务中完成，取代迁移 0025 删除的触发器。
// 任务失败记录故障（DAG 任务按其工作归属到节点）、恢复授权与任务状态互相对应；故事文档写入引出的
// 准备与查找回执、替换回执，以及准备世代改变后作废旧故障，都与写入同属一个事务。事务体不含 await。
import {randomUUID} from 'node:crypto';
import type {Database,SyncStatements} from '../lib/reader-repository.ts';

type Job={id:string;session_id:string;owner_id:string;kind:string;version:string;payload:string;recovery_id?:string|null;attempts:number;lease_token?:string|null};
const open="state IN ('pending','recovering')";

export function transact<T>(database:Database,body:(db:SyncStatements)=>T):T{
 if(!database.transaction)throw Error('TRANSACTION_UNAVAILABLE');
 return database.transaction(body);
}

/** 故障归属的节点：DAG 任务取其工作的第一个实例；批量工作的画幅键留空，引擎按任务记录的工作逐个阻断。 */
function faultNode(job:Job):{node:string|null;key:string}{
 try{
  const work=(JSON.parse(job.payload) as {work?:{instances:{node:string;key:string}[]}}).work;
  if(!work?.instances.length)return {node:null,key:''};
  return {node:work.instances[0].node,key:work.instances.length===1?work.instances[0].key:''};
 }catch{return {node:null,key:''};}
}

/** 任务失败：写入失败状态与错误码，作废同一任务或同一恢复授权的旧故障，记录新故障，并更新恢复回执。返回是否写入。 */
export function recordJobFailed(db:SyncStatements,job:Job,input:{message:string;interrupted:boolean;errorCode?:string;failureId?:string;now:number;payload?:string;fromState?:'running'|'failed'}):boolean{
 // 读者换选后，上一世代正在退出的任务不能给新故事登记故障。
 if((job.kind==='dag'||job.kind==='dag-draw')&&db.get(`SELECT id FROM stories WHERE id=? AND user_id=? AND json_valid(document)
  AND json_extract(document,'$.intake.generation') IS NOT json_extract(?,'$.setupGeneration')`,job.session_id,job.owner_id,job.payload)){
  db.run("UPDATE production_jobs SET state='succeeded',result=json_object('obsolete',1),lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND state='running' AND lease_token IS ?",input.now,job.id,job.lease_token??null);
  return false;
 }
 const failureId=input.failureId??randomUUID();
 const updated=input.fromState==='failed'
  ?db.run("UPDATE production_jobs SET error=?,interrupted=?,failure_id=?,error_code=?,updated_at=? WHERE id=? AND state='failed'",input.message,input.interrupted?1:0,failureId,input.errorCode??null,input.now,job.id)
  :db.run(`UPDATE production_jobs SET ${input.payload!==undefined?'payload=?,':''}state='failed',error=?,interrupted=?,failure_id=?,error_code=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND state='running' AND lease_token IS ?`,
   ...(input.payload!==undefined?[input.payload]:[]),input.message,input.interrupted?1:0,failureId,input.errorCode??null,input.now,job.id,job.lease_token??null);
 if(!updated.changes)return false;
 db.run(`UPDATE reader_faults SET state='replaced',updated_at=? WHERE session_id=? AND owner_id=? AND ${open} AND (job_id=? OR (? IS NOT NULL AND command_id=?)) AND id!=?`,input.now,job.session_id,job.owner_id,job.id,job.recovery_id??null,job.recovery_id??null,failureId);
 const {node,key}=faultNode(job);
 db.run(`INSERT INTO reader_faults(id,session_id,owner_id,job_id,kind,node,node_key,version,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET state='pending',message=excluded.message,updated_at=excluded.updated_at`,failureId,job.session_id,job.owner_id,job.id,input.interrupted?'interrupted':'job',node,key,job.version,input.message,input.now,input.now);
 db.run(`UPDATE reader_commands SET status=?,error=?,result=json_object('jobId',?,'faultId',?),updated_at=? WHERE request_id=? AND owner_id=? AND action='recover' AND status IN ('queued','running')`,
  input.interrupted&&job.attempts<3?'queued':'failed',input.message,job.id,failureId,input.now,job.recovery_id??null,job.owner_id);
 return true;
}

/** 中断的任务重新排队：其故障进入恢复中，恢复回执回到排队。 */
export function recordJobRequeued(db:SyncStatements,job:Job&{failure_id?:string|null},now:number){
 db.run("UPDATE reader_faults SET state='recovering',updated_at=? WHERE id=? AND session_id=? AND owner_id=? AND state='pending'",now,job.failure_id??null,job.session_id,job.owner_id);
 db.run("UPDATE reader_commands SET status='queued',updated_at=? WHERE request_id=? AND owner_id=? AND action='recover' AND status!='succeeded'",now,job.recovery_id??null,job.owner_id);
}

/** 任务开始执行：恢复回执进入执行中。 */
export function recordJobRunning(db:SyncStatements,job:Job,now:number){
 if(job.recovery_id)db.run("UPDATE reader_commands SET status='running',updated_at=? WHERE request_id=? AND owner_id=? AND action='recover' AND status='queued'",now,job.recovery_id,job.owner_id);
}

/** 任务成功：解除本任务或本恢复授权的故障，恢复回执记为成功。 */
export function recordJobSucceeded(db:SyncStatements,job:Job,result:string,now:number){
 db.run(`UPDATE reader_faults SET state='resolved',updated_at=? WHERE session_id=? AND owner_id=? AND ${open}
  AND (job_id=? OR command_id=? AND EXISTS(SELECT 1 FROM reader_commands c WHERE c.owner_id=? AND c.request_id=? AND json_extract(c.payload,'$.resolutionJob')=?))
  AND (command_id IS NULL OR command_id IS ?)`,now,job.session_id,job.owner_id,job.id,job.recovery_id??null,job.owner_id,job.recovery_id??null,job.id,job.recovery_id??null);
 if(job.recovery_id)db.run("UPDATE reader_commands SET status='succeeded',error=NULL,result=?,updated_at=? WHERE request_id=? AND owner_id=? AND action='recover' AND status IN ('queued','running') AND json_extract(payload,'$.resolutionJob')=?",result,now,job.recovery_id,job.owner_id,job.id);
}

/** 删除任务：其未结故障一并作废。where 为针对 production_jobs 的条件。 */
export function deleteJobs(db:SyncStatements,where:string,values:unknown[],now:number){
 const ids=db.all<{id:string;owner_id:string}>(`SELECT id,owner_id FROM production_jobs WHERE ${where}`,...values);
 for(const {id,owner_id} of ids){
  db.run(`UPDATE reader_faults SET state='replaced',updated_at=? WHERE job_id=? AND owner_id=? AND ${open}`,now,id,owner_id);
  db.run('DELETE FROM production_jobs WHERE id=?',id);
 }
 return ids.length;
}

type IntakeDoc={intake?:{phase?:string;generation?:number;lastAction?:{id?:string;hash?:string};search?:{requestId?:string;commandHash?:string}};reselection?:unknown;revision?:{kind?:string;selectionRequest?:string;parentId?:string;requestHash?:string}};
const parse=(text:string|undefined):IntakeDoc=>{try{return text?JSON.parse(text):{};}catch{return {};}};

/**
 * 写入一篇故事的文档，并在同一事务中处理文档变化引出的记录：
 * 准备动作与查找请求的回执、准备世代改变后作废未结故障、重选草稿提交为替换时为原故事写入替换回执。
 * 返回写入的行数。
 */
export function writeStory(database:Database,id:string,ownerId:string,sql:string,values:unknown[]):number{
 return transact(database,db=>{
  const before=db.get<{document:string}>('SELECT document FROM stories WHERE id=? AND user_id=?',id,ownerId);
  const changes=db.run(sql,...values).changes;
  if(!changes)return 0;
  const after=db.get<{document:string}>('SELECT document FROM stories WHERE id=? AND user_id=?',id,ownerId);
  storyEffects(db,id,ownerId,parse(before?.document),parse(after?.document));
  return changes;
 });
}

export function storyEffects(db:SyncStatements,id:string,ownerId:string,before:IntakeDoc,after:IntakeDoc){
 const now=Date.now();
 const receipt=(requestId:string,sessionId:string,action:string,fingerprint:string,resultId:string)=>
  db.run(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?,?)`,requestId,ownerId,sessionId,action,fingerprint,resultId,now,now);
 const action=after.intake?.lastAction;
 if(typeof action?.id==='string'&&action.id!==before.intake?.lastAction?.id)receipt(action.id,id,'setup',action.hash??'',id);
 const search=after.intake?.search;
 if(typeof search?.commandHash==='string'&&search.requestId&&search.requestId!==before.intake?.search?.requestId)receipt(search.requestId,id,'setup',search.commandHash,id);
 if(before.intake?.generation!==undefined&&before.intake.phase!=='confirmed'&&after.intake?.generation!==before.intake.generation){
  db.run(`UPDATE reader_commands SET status='failed',error='选题或制作设置已更新。',updated_at=?
   WHERE session_id=? AND owner_id=? AND action='recover' AND status IN ('queued','running')
   AND fault_id IN (SELECT id FROM reader_faults WHERE session_id=? AND owner_id=? AND ${open})`,now,id,ownerId,id,ownerId);
  db.run(`UPDATE reader_faults SET state='replaced',updated_at=? WHERE session_id=? AND owner_id=? AND ${open}`,now,id,ownerId);
 }
 if(before.reselection&&typeof before.reselection==='object'&&after.revision?.kind==='selection'&&after.revision.selectionRequest&&after.revision.parentId)
  receipt(after.revision.selectionRequest,after.revision.parentId,'replace',after.revision.requestHash??'',id);
}
