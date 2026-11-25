// 记录工作领取、付费发送、结果及终态。与其授权或保存结果的事务一并提交。
import type {ReadStatements,SyncStatements} from '../lib/reader-repository.ts';

type AttemptJob={id:string;session_id:string;owner_id:string;lease_token?:string|null;recovery_id?:string|null};
type AttemptEvent='claimed'|'sent'|'paid-result'|'provider-receipt'|'succeeded'|'failed'|'blocked'|'interrupted'|'yielded';
export function appendProductionAttempt(db:SyncStatements,job:AttemptJob,event:AttemptEvent,now:number,detail:unknown){
 const attempt=job.lease_token;
 if(!attempt)return;
 db.run(`INSERT INTO production_attempt_events(owner_id,session_id,job_id,attempt_id,event,recorded_at,detail)
  VALUES(?,?,?,?,?,?,?)`,job.owner_id,job.session_id,job.id,attempt,event,now,JSON.stringify(detail??null));
}

/** 额度从历史导入或授权重试开始。没有送出即退回的领取不消耗中断重试额度。 */
export function productionAttemptCount(db:ReadStatements,jobId:string){
 return db.get<{count:number}>(`WITH boundary AS (
  SELECT sequence,event,detail FROM production_attempt_events WHERE job_id=? AND event IN ('historical','reset-attempts')
  ORDER BY sequence DESC LIMIT 1
 )
 SELECT coalesce((SELECT CASE WHEN event='historical' THEN json_extract(detail,'$.attempts') END FROM boundary),0)
  + count(*) AS count
 FROM production_attempt_events claimed WHERE claimed.job_id=? AND claimed.event='claimed'
 AND claimed.sequence>coalesce((SELECT sequence FROM boundary),0)
 AND NOT EXISTS(SELECT 1 FROM production_attempt_events yielded WHERE yielded.attempt_id=claimed.attempt_id AND yielded.event='yielded')`,jobId,jobId)!.count;
}
