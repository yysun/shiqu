// 0028 转换后，把同稿件可继续采用的已付费文字回执接到现行任务身份，避免升级后重复付费。
import type {DatabaseSync,SQLInputValue} from 'node:sqlite';
import {decodeDocument,emptyDag} from '../../lib/production-dag/document.ts';
import {fingerprint} from '../../lib/production-dag/fingerprint.ts';
import {settle,work} from '../../lib/production-dag/runner.ts';
import {selectionSchema,type SessionRow} from '../../lib/reader-model.ts';
import {preparationOriginal,preparationPending} from '../../lib/reader-preparation.ts';
import type {SyncStatements} from '../../lib/reader-repository.ts';
import {dagJobSpec,dagTextKind} from '../dag-production.ts';
import {productionAttemptCount} from '../production-attempts.ts';
import type {ProductionJob} from '../production-queue.ts';
import {currentFamilyVersion} from '../reader-revisions.ts';

function rebindPaidText(db:SyncStatements){
 const rows=db.all<SessionRow>(`WITH candidates AS (
  SELECT session_id,owner_id FROM production_jobs WHERE kind=? AND state!='succeeded'
   AND CASE WHEN json_valid(payload) THEN json_type(payload,'$.paid.value') IS NOT NULL END
  UNION SELECT session_id,owner_id FROM production_attempt_events WHERE event='historical'
   AND json_extract(detail,'$.state') IN ('queued','running') AND json_type(detail,'$.paid.value') IS NOT NULL
 )
 SELECT s.* FROM candidates c JOIN story_rows s ON s.id=c.session_id AND s.user_id=c.owner_id
 WHERE ${currentFamilyVersion('s')} AND json_valid(s.document) AND NOT EXISTS(
  SELECT 1 FROM production_migration_diagnostics d WHERE d.session_id=s.id AND d.owner_id=s.user_id)`,dagTextKind);
 for(const row of rows){
  const specs:ReturnType<typeof dagJobSpec>[]=[];
  try{
   const doc=decodeDocument(row),selection=selectionSchema.parse(JSON.parse(row.selection));
   const confirmed=!doc.intake||doc.intake.phase==='confirmed';
   const preparing=preparationPending(doc)||doc.intake?.phase==='confirming';
   if(!doc.dag&&(!preparing||doc.reselection))continue;
   if(preparationPending(doc)&&doc.original&&!doc.original.storyBrief)doc.original=preparationOriginal(doc,selection,doc.original);
   const basis={id:row.id,doc,selection,dag:doc.dag??emptyDag(),confirmed,faults:[]};
   const story={...basis,dag:settle(basis)};
   // 合并后的审片没有等价的旧回执。其他文字结果只有在完整请求相同的情况下才接续。
   for(const [index,item] of work(story).entries())
    if(item.call!=='draw'&&item.call!=='review')specs.push(dagJobSpec(row.user_id,story,item,-10+index));
  }catch{continue;}
  for(const {spec,identity} of specs){
   const legacyId=fingerprint([...identity.slice(0,4),0,...identity.slice(4)]);
   const previous=db.get<ProductionJob>(`SELECT * FROM production_jobs WHERE id=? AND owner_id=? AND session_id=? AND kind=?
    AND state!='succeeded' AND CASE WHEN json_valid(payload) THEN json_type(payload,'$.paid.value') IS NOT NULL END`,legacyId,row.user_id,row.id,dagTextKind);
   const saved=previous?{paid:JSON.parse(previous.payload).paid,recorded_at:previous.updated_at}:db.get<{paid:string;recorded_at:number}>(`
    SELECT json_extract(detail,'$.paid') AS paid,recorded_at FROM production_attempt_events
    WHERE job_id=? AND owner_id=? AND session_id=? AND event='historical' AND json_extract(detail,'$.state') IN ('queued','running')
     AND json_extract(detail,'$.recoveryId') IS NULL AND json_type(detail,'$.paid.value') IS NOT NULL
    ORDER BY sequence DESC LIMIT 1`,legacyId,row.user_id,row.id);
   if(!saved)continue;
   const paid=previous?saved.paid:JSON.parse(saved.paid);
   // 现行身份已有任务时不覆盖。
   if(db.get('SELECT 1 FROM production_jobs WHERE id=?',spec.id))continue;
   const payload=JSON.stringify({...spec.payload as object,paid});
   if(!previous){
    db.run(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,payload,state,priority,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,'queued',?,?,?)`,spec.id,row.id,row.user_id,spec.kind,spec.pool,spec.version,payload,spec.priority,saved.recorded_at,saved.recorded_at);
    continue;
   }
   const attempts=productionAttemptCount(db,legacyId);
   db.run(`UPDATE production_jobs SET id=?,payload=?,state=CASE WHEN state='running' THEN 'queued' ELSE state END,
    lease_token=NULL,lease_until=0 WHERE id=?`,spec.id,payload,legacyId);
   if(attempts)db.run(`INSERT INTO production_attempt_events(owner_id,session_id,job_id,attempt_id,event,recorded_at,detail)
    VALUES(?,?,?,?,'historical',?,json_object('attempts',?))`,row.user_id,row.id,spec.id,'rebased:'+legacyId,saved.recorded_at,attempts);
   db.run(`UPDATE production_faults SET job_id=? WHERE job_id=? AND owner_id=? AND session_id=? AND state IN ('pending','recovering')`,
    spec.id,legacyId,row.user_id,row.id);
   if(previous.recovery_id){
    const command=db.get<{payload:string}>(`SELECT payload FROM reader_commands WHERE request_id=? AND owner_id=? AND session_id=?
     AND action='recover' AND status IN ('queued','running') AND json_valid(payload)`,previous.recovery_id,row.user_id,row.id);
    if(command){
     const value=JSON.parse(command.payload) as {jobs?:string[];resolutionJob?:string}|null;
     if(!value||typeof value!=='object')continue;
     if(Array.isArray(value.jobs))value.jobs=value.jobs.map(id=>id===legacyId?spec.id:id);
     if(value.resolutionJob===legacyId)value.resolutionJob=spec.id;
     db.run("UPDATE reader_commands SET payload=?,status='queued' WHERE request_id=? AND owner_id=?",
      JSON.stringify(value),previous.recovery_id,row.user_id);
    }
   }
  }
 }
}

export function rebindProductionReceipts(sqlite:DatabaseSync){
 const db:SyncStatements={
  run:(query,...values)=>({changes:Number(sqlite.prepare(query).run(...values as SQLInputValue[]).changes)}),
  get:<T>(query:string,...values:unknown[])=>sqlite.prepare(query).get(...values as SQLInputValue[]) as T|undefined,
  all:<T>(query:string,...values:unknown[])=>sqlite.prepare(query).all(...values as SQLInputValue[]) as T[],
 };
 rebindPaidText(db);
}
