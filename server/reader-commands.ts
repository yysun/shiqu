// Persist one authorization per immutable failure; replay observes receipts instead of resetting work.
// 回执与其效果（故障、任务、故事状态）在同一事务中写入，取代迁移 0025 删除的触发器。
import {createHash} from 'node:crypto';
import {ReaderError,selectionSchema,type Document} from '../lib/reader-model.ts';
import type {Database,SyncStatements} from '../lib/reader-repository.ts';
import {supersededSql} from '../lib/reader-repository.ts';
import {authorizeProductionCommand} from '../lib/production-lifecycle.ts';
import type {ProductionControlEvent} from '../lib/production-lifecycle.ts';
import type {GenerationControl} from '../lib/reader-model.ts';
import {transact} from './production-records.ts';
import {evaluate} from '../lib/production-dag/engine.ts';
import {stateOf} from '../lib/production-dag/runner.ts';
import {carriedJobFaultState,reconcileCarriedJobFaults} from './dag-revision-faults.ts';

export type ReaderFault={id:string;session_id:string;owner_id:string;job_id:string|null;kind:'job'|'image-loss'|'interrupted';node:string|null;node_key:string;input_hash:string|null;origin_fault_id:string|null;optional:number;version:string;image:string|null;message:string;state:'pending'|'recovering'|'awaiting-match'|'resolved'|'replaced';command_id:string|null;created_at:number;updated_at:number};
// 修订中延续的批量故障共享原故障编号；丢图仍逐幅恢复。
export const carriedJobFaultGroup=(fault:ReaderFault)=>fault.kind==='job'&&!fault.job_id?fault.origin_fault_id:null;
export type CommandReceipt={request_id:string;owner_id:string;session_id:string;action:string;fingerprint:string;payload:string;fault_id:string|null;result_id:string|null;status:'queued'|'running'|'succeeded'|'failed';result:string|null;error:string|null;created_at:number;updated_at:number};
export const commandFingerprint=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
/** 旧书库共用制作控制。竖图控制首次改变时，保留未完成横图原有的运行或暂停状态。 */
export function preserveLegacyLandscapeControl(db:SyncStatements,id:string,ownerId:string){
 db.run(`UPDATE stories SET document=json_set(document,'$.legacyLandscapeControl',generation_control)
  WHERE id=? AND user_id=? AND json_type(document,'$.legacyLandscapeControl') IS NULL
  AND EXISTS(SELECT 1 FROM json_each(document,'$.dag.frames') WHERE json_extract(value,'$.landscape')='')`,id,ownerId);
}

export async function commandReceipt(db:Database,ownerId:string,requestId:string,fingerprint?:string){
 const row=await db.prepare('SELECT * FROM reader_commands WHERE owner_id=? AND request_id=?').bind(ownerId,requestId).first<CommandReceipt>();
 if(!row&&await db.prepare('SELECT id FROM stories WHERE id=? AND user_id=?').bind(requestId,ownerId).first())throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
 if(row&&fingerprint!==undefined&&row.fingerprint!==fingerprint)throw new ReaderError(409,'这个操作编号已用于其他内容，请重新操作。');
 return row;
}
export async function sessionFaults(db:Database,sessionId:string,ownerId:string){
 return (await db.prepare("SELECT * FROM reader_faults WHERE session_id=? AND owner_id=? AND state IN ('pending','recovering','awaiting-match') ORDER BY created_at,id").bind(sessionId,ownerId).all<ReaderFault>()).results;
}
export async function recordNoop(db:Database,ownerId:string,sessionId:string,requestId:string,action:string,fingerprint:string,resultId=sessionId,now=Date.now()){
 const existing=await commandReceipt(db,ownerId,requestId,fingerprint);if(existing)return existing;
 await db.prepare(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at)
  VALUES(?,?,?,?,?,'{}',?,?,?) ON CONFLICT(owner_id,request_id) DO NOTHING`)
  .bind(requestId,ownerId,sessionId,action,fingerprint,resultId,now,now).run();
 return (await commandReceipt(db,ownerId,requestId,fingerprint))!;
}
/**
 * 恢复授权：回执与其效果在一个事务中写入——故障进入恢复中（已确认无需重做时直接解除）、所选任务以本授权重新排队
 * （重绘时清除旧结果）、整篇失败状态回到待处理。basis 为发起时读到的故事，内容已变时不授权。
 */
export async function authorizeRecovery(db:Database,input:{ownerId:string;sessionId:string;requestId:string;faultId:string;jobs:string[];resolutionJob:string;redraw?:boolean;resolved?:boolean;resumeUnreviewed?:boolean;basis?:{selection:string;document:string};applyResolved?:(tx:SyncStatements)=>void},now=Date.now()){
 const {ownerId,sessionId,requestId,faultId,jobs,resolutionJob,redraw=false}=input;
 const resolved=input.resolved||false,payload=JSON.stringify({jobs,resolutionJob,redraw}),fingerprint=commandFingerprint(['recover',sessionId,faultId,jobs,resolutionJob,redraw,resolved]);
 const replay=await commandReceipt(db,ownerId,requestId,fingerprint);if(replay)return replay;
 if(!resolved&&(!jobs.length||!jobs.includes(resolutionJob)||new Set(jobs).size!==jobs.length))throw new ReaderError(400,'恢复任务不完整。');
 const selected=JSON.stringify(jobs);
 transact(db,tx=>{
  const existing=tx.get<CommandReceipt>('SELECT * FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
  if(existing)return;
  const fault=tx.get<ReaderFault>('SELECT * FROM reader_faults WHERE id=? AND owner_id=? AND session_id=?',faultId,ownerId,sessionId);
  const unavailable=tx.get(`SELECT 1 FROM json_each(?) selected LEFT JOIN production_jobs j ON j.id=selected.value
   LEFT JOIN reader_commands c ON c.request_id=j.recovery_id AND c.owner_id=j.owner_id
   WHERE j.id IS NULL OR j.session_id!=? OR j.owner_id!=? OR j.state='running' OR c.status IN ('queued','running') LIMIT 1`,selected,sessionId,ownerId);
  const story=input.basis?tx.get<{selection:string;document:string;generation_control:GenerationControl;continuation:number;superseded:number;deleted:number;basisCurrent:number}>(`SELECT
   s.selection,s.document,s.generation_control,json_type(s.document,'$.dag.continuation') IS NOT NULL AS continuation,
   ${supersededSql('s')} AS superseded,
   EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id) AS deleted,
   json_remove(s.selection,'$.displayTitle')=json_remove(?,'$.displayTitle')
   AND json_extract(s.document,'$.plan') IS json_extract(?,'$.plan')
   AND COALESCE(json_extract(s.document,'$.intake.generation'),-1)=COALESCE(json_extract(?,'$.intake.generation'),-1)
   AND json_extract(s.document,'$.dag.preparationGeneration') IS json_extract(?,'$.dag.preparationGeneration')
   AND (? IS NULL OR json_extract(s.document,'$.dag.frames.'||json_quote(?)||'.image')=?) AS basisCurrent
   FROM stories s WHERE s.id=? AND s.user_id=?`,input.basis.selection,input.basis.document,input.basis.document,input.basis.document,
   fault?.image??null,fault?.node_key??'',fault?.image??null,sessionId,ownerId):undefined;
  const group=resolved&&fault?carriedJobFaultGroup(fault):null;
  const groupReady=()=>{
   if(!group||!story)return true;
   const doc=JSON.parse(story.document) as Document;
   if(!doc.dag)return false;
   const current={id:sessionId,doc,dag:doc.dag,selection:selectionSchema.parse(JSON.parse(story.selection)),confirmed:true,faults:[]};
   reconcileCarriedJobFaults(tx,ownerId,current,now);
   const evaluation=evaluate(stateOf(current));
   if(carriedJobFaultState(evaluation,fault!)!=='pending')return false;
   return tx.all<ReaderFault>(`SELECT * FROM reader_faults WHERE owner_id=? AND session_id=? AND origin_fault_id=?
    AND kind='job' AND job_id IS NULL AND state='pending'`,ownerId,sessionId,group).every(member=>carriedJobFaultState(evaluation,member)==='pending');
  };
  const decision=authorizeProductionCommand('retry',{
   version:story?.deleted?'deleted':story?.superseded||input.basis&&!story?'superseded':'current',control:story?.generation_control??'active',
   continuation:!!story?.continuation,targetCurrent:fault?.state==='pending',targetReady:!unavailable&&(!input.basis||!!story?.basisCurrent)&&groupReady(),
   stopping:false,
  });
  if(!decision.allowed){
   if(fault?.state==='recovering')throw new ReaderError(409,'这项问题正在处理，请等待已提交的恢复任务。');
   throw new ReaderError(decision.status,decision.message);
  }
  if(tx.get('SELECT id FROM stories WHERE id=? AND user_id=?',requestId,ownerId))throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
  tx.run(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,status,created_at,updated_at)
   VALUES(?,?,?,'recover',?,?,?,?,?,?)`,requestId,ownerId,sessionId,fingerprint,payload,faultId,resolved?'succeeded':'queued',now,now);
  input.applyResolved?.(tx);
  tx.run(`UPDATE reader_faults SET state=?,command_id=?,updated_at=? WHERE owner_id=? AND session_id=? AND state='pending'
   AND (id=? OR kind='job' AND job_id IS NULL AND origin_fault_id=?)`,resolved?'resolved':'recovering',requestId,now,ownerId,sessionId,faultId,group);
  tx.run(`UPDATE production_jobs SET state='queued',error=NULL,interrupted=0,lease_token=NULL,lease_until=0,attempts=0,recovery_id=?${redraw?',result=NULL':''},updated_at=?
   WHERE session_id=? AND owner_id=? AND id IN (SELECT value FROM json_each(?)) AND state!='running'`,requestId,now,sessionId,ownerId,selected);
  if(input.resumeUnreviewed)tx.run("UPDATE stories SET document=json_set(document,'$.dag.resumeUnreviewed',json('true')) WHERE id=? AND user_id=?",sessionId,ownerId);
  tx.run("UPDATE stories SET state='idle',error=NULL WHERE id=? AND user_id=? AND state='failed'",sessionId,ownerId);
 });
 return (await commandReceipt(db,ownerId,requestId,fingerprint))!;
}

/** 生成方式与暂停控制：回执与控制字段在一个事务中写入，修订等待仅由继续制作解除。 */
export async function authorizeControl(db:Database,ownerId:string,sessionId:string,requestId:string,action:ProductionControlEvent,now=Date.now(),stopping=false){
 const fingerprint=commandFingerprint(['control',sessionId,action]),replay=await commandReceipt(db,ownerId,requestId,fingerprint);if(replay)return replay;
 transact(db,tx=>{
  // 事务内先查回执，覆盖另一实例刚提交同编号的情况。
  const existing=tx.get<CommandReceipt>('SELECT * FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
  if(existing)return;
  const row=tx.get<{state:string;generation_control:GenerationControl;superseded:number;deleted:number;repreparing:number;continuation:number}>(`SELECT s.state,s.generation_control,
   ${supersededSql('s')} AS superseded,
   EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id) AS deleted,
   json_type(s.document,'$.dag.continuation')='object' AS continuation,
   json_type(s.document,'$.dag.repreparing')='true' AS repreparing
   FROM stories s WHERE s.id=? AND s.user_id=?`,sessionId,ownerId);
  if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');
  const decision=authorizeProductionCommand(action,{
   version:row.deleted?'deleted':row.superseded?'superseded':'current',stopping,control:row.generation_control,
   continuation:!!row.continuation,targetCurrent:true,targetReady:row.state!=='completed'||action!=='background'&&!!row.repreparing,
  });
  if(!decision.allowed)throw new ReaderError(decision.status,decision.message);
  const inserted=tx.run(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,created_at,updated_at)
   VALUES(?,?,?,'control',?,?,?,?) ON CONFLICT(owner_id,request_id) DO NOTHING`,
   requestId,ownerId,sessionId,fingerprint,JSON.stringify({action}),now,now).changes;
  if(!inserted)return;
  if(decision.effect.kind!=='control')throw Error('INVALID_PRODUCTION_CONTROL_EFFECT');
  if(decision.effect.control&&decision.effect.control!==row.generation_control)preserveLegacyLandscapeControl(tx,sessionId,ownerId);
  tx.run(`UPDATE stories SET generation_control=COALESCE(?,generation_control),generation_mode=COALESCE(?,generation_mode) WHERE id=? AND user_id=?`,
   decision.effect.control,decision.effect.mode,sessionId,ownerId);
 });
 const receipt=await commandReceipt(db,ownerId,requestId,fingerprint);if(!receipt)throw new ReaderError(409,'故事已完成或版本已更新，请刷新后再操作。');return receipt;
}
