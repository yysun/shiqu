// 格式 4 的发布前数据修复。只重绑同稿件的已付费请求，以及同所有者、同家族的现有媒体。
import type {DatabaseSync,SQLInputValue} from 'node:sqlite';
import {decodeDocument,emptyDag} from '../../lib/production-dag/document.ts';
import {fingerprint} from '../../lib/production-dag/fingerprint.ts';
import {settle,work} from '../../lib/production-dag/runner.ts';
import {readerImageAsset,referenceImageKey} from '../../lib/reader-image-assets.ts';
import {selectionSchema,type SessionRow} from '../../lib/reader-model.ts';
import {preparationOriginal,preparationPending} from '../../lib/reader-preparation.ts';
import type {SyncStatements} from '../../lib/reader-repository.ts';
import {dagJobSpec,dagTextKind} from '../dag-production.ts';
import {landscapePrintKind} from '../landscape-print.ts';
import {recordFamilyImage} from '../media.ts';
import {productionAttemptCount} from '../production-attempts.ts';
import type {ProductionJob} from '../production-queue.ts';
import {currentFamilyVersion} from '../reader-revisions.ts';

export const rebindProductionReceiptsMigration='0030_rebind_production_receipts.sql';

/** 旧预览版可能已采用退役画幅的地址。原文件与产物不动，只让当前版本通过自己的地址读取。 */
function rebindPictures(db:SyncStatements){
 const refs=db.all<{session_id:string;owner_id:string;root_id:string;picture:string}>(`SELECT DISTINCT r.session_id,r.owner_id,s.root_id,
  json_extract(r.record,'$.picture') AS picture FROM production_product_refs r
  JOIN story_revisions s ON s.story_id=r.session_id AND s.owner_id=r.owner_id
  JOIN stories story ON story.id=r.session_id AND story.user_id=r.owner_id
  WHERE json_valid(story.document) AND r.target LIKE 'frameImage:%' AND json_type(r.record,'$.picture')='text'
  AND instr(json_extract(r.record,'$.picture'),'/api/reader/media/'||r.session_id||'/')!=1`);
 for(const {session_id:id,owner_id:ownerId,root_id:rootId,picture} of refs){
  const sourceId=picture.split('/')[4],target=sourceId&&referenceImageKey(sourceId,picture);
  if(!target||!db.get('SELECT 1 FROM story_revisions WHERE story_id=? AND owner_id=? AND root_id=?',sourceId,ownerId,rootId))continue;
  const alias=readerImageAsset(id,0,target.slice(target.lastIndexOf('.')+1),fingerprint(['family-image',target]));
  recordFamilyImage(db,{alias:alias.key,sessionId:id,sourceId,ownerId,rootId,target});
  db.run(`UPDATE production_product_refs SET record=json_set(record,'$.picture',?)
   WHERE session_id=? AND owner_id=? AND target LIKE 'frameImage:%' AND json_extract(record,'$.picture')=?`,alias.url,id,ownerId,picture);
  const row=db.get<{document:string}>('SELECT document FROM stories WHERE id=? AND user_id=?',id,ownerId)!;
  const document=JSON.parse(row.document) as Pick<ReturnType<typeof decodeDocument>,'landscapePrints'>;
  // 横图套图仍按原来那幅竖图匹配，继续绘制时也可通过当前版本的地址读取参考图。
  if(Array.isArray(document?.landscapePrints))for(const print of document.landscapePrints){
   if(!Array.isArray(print?.story?.pages))continue;
   for(const page of print.story.pages)if(page?.image===picture)page.image=alias.url;
  }
  db.run(`UPDATE stories SET document=json_remove(
   CASE WHEN json_type(document,'$.landscapePrints')='array' THEN json_set(document,'$.landscapePrints',json(?)) ELSE document END,
   '$.dag.productSignature') WHERE id=? AND user_id=?`,JSON.stringify(document?.landscapePrints??[]),id,ownerId);
  db.run(`UPDATE production_jobs SET payload=json_set(payload,'$.input.reference',?)
   WHERE session_id=? AND owner_id=? AND kind=?
    AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.input.reference') END=?`,alias.url,id,ownerId,landscapePrintKind,picture);
 }
}

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
   let paid=previous?saved.paid:JSON.parse(saved.paid);
   // 正式身份已有结果时优先保留；仅为从未领取的替代任务补上匹配的回执。
   const existing=db.get<ProductionJob&{payload_type:string|null;paid_json:string|null}>(`SELECT *,
    CASE WHEN json_valid(payload) THEN json_type(payload) END AS payload_type,
    CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload,'$.paid.value') IS NOT NULL THEN json_extract(payload,'$.paid') END END AS paid_json
    FROM production_jobs WHERE id=?`,spec.id);
   if(existing){
    if(existing.owner_id!==row.user_id||existing.session_id!==row.id||existing.kind!==dagTextKind||
     existing.state!=='queued')continue;
    if(!previous){
     if(!existing.paid_json){
      if(existing.payload_type==='object')db.run("UPDATE production_jobs SET payload=json_set(payload,'$.paid',json(?)) WHERE id=?",JSON.stringify(paid),spec.id);
      else db.run('UPDATE production_jobs SET payload=? WHERE id=?',JSON.stringify({...spec.payload as object,paid}),spec.id);
     }
     continue;
    }
    if(existing.attempts||existing.recovery_id)continue;
    // 预览版可能已排入正式身份，却在清除旧身份前退出。保留其现成结果，同时转移旧工作的恢复授权。
    if(existing.paid_json)paid=JSON.parse(existing.paid_json);
    db.run('DELETE FROM production_jobs WHERE id=?',spec.id);
   }
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
 rebindPictures(db);
 rebindPaidText(db);
}
