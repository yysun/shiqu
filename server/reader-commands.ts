// Persist one authorization per immutable failure; replay observes receipts instead of resetting work.
// 回执与其效果（故障、任务、故事状态）在同一事务中写入，取代迁移 0025 删除的触发器。
import {createHash} from 'node:crypto';
import {ReaderError} from '../lib/reader-model.ts';
import type {Database} from '../lib/reader-repository.ts';
import {supersededSql} from '../lib/reader-repository.ts';
import type {ProductionAction} from '../lib/reader-model.ts';
import {transact} from './production-records.ts';

export type ReaderFault={id:string;session_id:string;owner_id:string;job_id:string|null;kind:'job'|'image-loss'|'interrupted';node:string|null;node_key:string;input_hash:string|null;origin_fault_id:string|null;optional:number;version:string;image:string|null;message:string;state:'pending'|'recovering'|'resolved'|'replaced';command_id:string|null;created_at:number;updated_at:number};
export type CommandReceipt={request_id:string;owner_id:string;session_id:string;action:string;fingerprint:string;payload:string;fault_id:string|null;result_id:string|null;status:'queued'|'running'|'succeeded'|'failed';result:string|null;error:string|null;created_at:number;updated_at:number};
export const commandFingerprint=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
export async function commandReceipt(db:Database,ownerId:string,requestId:string,fingerprint?:string){
 const row=await db.prepare('SELECT * FROM reader_commands WHERE owner_id=? AND request_id=?').bind(ownerId,requestId).first<CommandReceipt>();
 if(!row&&await db.prepare('SELECT id FROM stories WHERE id=? AND user_id=?').bind(requestId,ownerId).first())throw new ReaderError(409,'这个操作编号已用于创建或提交故事。');
 if(row&&fingerprint!==undefined&&row.fingerprint!==fingerprint)throw new ReaderError(409,'这个操作编号已用于其他内容，请重新操作。');
 return row;
}
export async function sessionFaults(db:Database,sessionId:string,ownerId:string){
 return (await db.prepare("SELECT * FROM reader_faults WHERE session_id=? AND owner_id=? AND state IN ('pending','recovering') ORDER BY created_at,id").bind(sessionId,ownerId).all<ReaderFault>()).results;
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
export async function authorizeRecovery(db:Database,input:{ownerId:string;sessionId:string;requestId:string;faultId:string;jobs:string[];resolutionJob:string;redraw?:boolean;resolved?:boolean;resumeUnreviewed?:boolean;basis?:{selection:string;document:string}},now=Date.now()){
 const {ownerId,sessionId,requestId,faultId,jobs,resolutionJob,redraw=false}=input;
 const resolved=input.resolved||false,payload=JSON.stringify({jobs,resolutionJob,redraw}),fingerprint=commandFingerprint(['recover',sessionId,faultId,jobs,resolutionJob,redraw,resolved]);
 const replay=await commandReceipt(db,ownerId,requestId,fingerprint);if(replay)return replay;
 if(!resolved&&(!jobs.length||!jobs.includes(resolutionJob)||new Set(jobs).size!==jobs.length))throw new ReaderError(400,'恢复任务不完整。');
 const eligible=input.basis?`AND EXISTS(SELECT 1 FROM stories s WHERE s.id=f.session_id AND s.user_id=f.owner_id
  AND s.generation_control='active' AND NOT ${supersededSql('s')}
  AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id)
  AND json_remove(s.selection,'$.displayTitle')=json_remove(?,'$.displayTitle')
  AND json_extract(s.document,'$.plan') IS json_extract(?,'$.plan')
  AND COALESCE(json_extract(s.document,'$.intake.generation'),-1)=COALESCE(json_extract(?,'$.intake.generation'),-1)
  AND (f.image IS NULL OR json_extract(s.document,'$.dag.frames.'||json_quote(f.node_key)||'.image')=f.image))`:'';
 const selected=JSON.stringify(jobs);
 transact(db,tx=>{
  const inserted=tx.run(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,status,created_at,updated_at)
   SELECT ?,?,?,'recover',?,?,?,?,?,? FROM reader_faults f
   WHERE f.id=? AND f.session_id=? AND f.owner_id=? AND f.state='pending'
    AND NOT EXISTS(SELECT 1 FROM json_each(?) selected LEFT JOIN production_jobs j ON j.id=selected.value
     WHERE j.id IS NULL OR j.session_id!=? OR j.owner_id!=? OR j.state='running')
    AND NOT EXISTS(SELECT 1 FROM json_each(?) selected JOIN production_jobs j ON j.id=selected.value
     JOIN reader_commands c ON c.request_id=j.recovery_id AND c.owner_id=j.owner_id
     WHERE c.status IN ('queued','running'))
    ${eligible}
   ON CONFLICT(owner_id,request_id) DO NOTHING`,requestId,ownerId,sessionId,fingerprint,payload,faultId,resolved?'succeeded':'queued',now,now,faultId,sessionId,ownerId,selected,sessionId,ownerId,selected,...(input.basis?[input.basis.selection,input.basis.document,input.basis.document]:[])).changes;
  if(!inserted)return;
  tx.run("UPDATE reader_faults SET state=?,command_id=?,updated_at=? WHERE id=? AND owner_id=? AND session_id=? AND state='pending'",resolved?'resolved':'recovering',requestId,now,faultId,ownerId,sessionId);
  tx.run(`UPDATE production_jobs SET state='queued',error=NULL,interrupted=0,lease_token=NULL,lease_until=0,attempts=0,recovery_id=?${redraw?',result=NULL':''},updated_at=?
   WHERE session_id=? AND owner_id=? AND id IN (SELECT value FROM json_each(?)) AND state!='running'`,requestId,now,sessionId,ownerId,selected);
  if(input.resumeUnreviewed)tx.run("UPDATE stories SET document=json_set(document,'$.dag.resumeUnreviewed',json('true')) WHERE id=? AND user_id=?",sessionId,ownerId);
  tx.run("UPDATE stories SET state='idle',error=NULL WHERE id=? AND user_id=? AND state='failed'",sessionId,ownerId);
 });
 const receipt=await commandReceipt(db,ownerId,requestId,fingerprint);
 if(receipt)return receipt;
 const fault=await db.prepare('SELECT * FROM reader_faults WHERE id=? AND owner_id=? AND session_id=?').bind(faultId,ownerId,sessionId).first<ReaderFault>();
 if(fault?.state==='recovering')throw new ReaderError(409,'这项问题正在处理，请等待已提交的恢复任务。');
 throw new ReaderError(409,'这项问题或输入已更新，请刷新后再操作。');
}

/** 生成方式与暂停控制：回执与故事的控制字段在一个事务中写入；恢复与暂停同时清除旧的修订交接标记。 */
export async function authorizeControl(db:Database,ownerId:string,sessionId:string,requestId:string,action:ProductionAction,now=Date.now()){
 const fingerprint=commandFingerprint(['control',sessionId,action]),replay=await commandReceipt(db,ownerId,requestId,fingerprint);if(replay)return replay;
 transact(db,tx=>{
  const inserted=tx.run(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,created_at,updated_at)
   SELECT ?,?,?,'control',?,?,?,? FROM stories s WHERE s.id=? AND s.user_id=? AND s.state!='completed'
    AND NOT ${supersededSql('s')} AND NOT EXISTS(SELECT 1 FROM library_deletions d WHERE d.story_id=s.id AND d.user_id=s.user_id)
   ON CONFLICT(owner_id,request_id) DO NOTHING`,requestId,ownerId,sessionId,fingerprint,JSON.stringify({action}),now,now,sessionId,ownerId).changes;
  if(!inserted)return;
  const control=action==='resume'?'active':action==='pause'?'paused':action==='stop'?'stopped':null;
  const mode=action==='resume'||action==='background'?'background':action==='reader'?'reader':null;
  tx.run(`UPDATE stories SET generation_control=COALESCE(?,generation_control),generation_mode=COALESCE(?,generation_mode)${action==='resume'||action==='pause'?",document=json_remove(document,'$.revision.handoff')":''} WHERE id=? AND user_id=?`,control,mode,sessionId,ownerId);
 });
 const receipt=await commandReceipt(db,ownerId,requestId,fingerprint);if(!receipt)throw new ReaderError(409,'故事已完成或版本已更新，请刷新后再操作。');return receipt;
}
