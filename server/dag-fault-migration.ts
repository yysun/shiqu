// 迁移 0027：用父版本留存的失败任务修复已保存修订，不触碰已采用的成果或读者授权。
import type {DatabaseSync,SQLInputValue} from 'node:sqlite';
import {selectionSchema,type SessionRow} from '../lib/reader-model.ts';
import type {SyncStatements} from '../lib/reader-repository.ts';
import {evaluate,complete,stateOf,carryFaults,recordedFaultRows,insertCarriedJobFault,type DagStory,type FaultToCarry,type HistoricalDocument} from './migrations/production-v2.ts';
import type {ReaderFault} from './reader-commands.ts';

export const revisionFaultMigration='0027_revision_fault_targets.sql';

function story(row:SessionRow|undefined):DagStory|null{
 if(!row)return null;
 try{
  const doc=JSON.parse(row.document) as HistoricalDocument,selection=selectionSchema.safeParse(JSON.parse(row.selection)),dag=doc.dag;
  if(!dag||!selection.success||doc.intake&&doc.intake.phase!=='confirmed')return null;
  const saved={id:row.id,doc,dag,selection:selection.data,confirmed:true,faults:[]};
  stateOf(saved);
  return saved;
 }catch{return null;}
}

export function migrateRevisionFaults(sqlite:DatabaseSync,sql:string){
 sqlite.exec(sql);
 const db:SyncStatements={
  run(query,...params){return {changes:Number(sqlite.prepare(query).run(...params as SQLInputValue[]).changes)};},
  get<T>(query:string,...params:unknown[]){return sqlite.prepare(query).get(...params as SQLInputValue[]) as T|undefined;},
  all<T>(query:string,...params:unknown[]){return sqlite.prepare(query).all(...params as SQLInputValue[]) as T[];},
 };
 const revisions=db.all<Pick<SessionRow,'id'|'user_id'|'created_at'>&{parent_id:string}>(`SELECT c.id,c.user_id,c.created_at,p.id AS parent_id FROM stories c
  JOIN stories p ON p.id=CASE WHEN json_valid(c.document) THEN json_extract(c.document,'$.revision.parentId') END AND p.user_id=c.user_id
  ORDER BY CAST(json_extract(c.document,'$.revision.number') AS INTEGER),c.created_at,c.id`);
 for(const {id,user_id:ownerId,created_at,parent_id} of revisions){
  const created=Date.parse(created_at);
  if(!Number.isFinite(created))continue;
  const sources=db.all<FaultToCarry>(recordedFaultRows+` AND f.kind IN ('job','interrupted') AND f.created_at<=?
   AND (f.state IN ('pending','recovering','awaiting-match') OR f.updated_at>?) ORDER BY f.rowid`,parent_id,ownerId,created,created);
  if(!sources.length)continue;
  const row=db.get<SessionRow>('SELECT * FROM stories WHERE id=? AND user_id=?',id,ownerId)!;
  const child=story(row),revision=child?.doc.revision;
  if(!child||!revision||revision.kind==='selection')continue;
  const parent=story(db.get<SessionRow>('SELECT * FROM stories WHERE id=? AND user_id=?',revision.parentId,row.user_id));
  if(!parent||parent.id===child.id||revision.rootId!==(parent.doc.revision?.rootId??parent.id)||
   revision.number<=(parent.doc.revision?.number??1)||parent.doc.intake?.generation!==child.doc.intake?.generation)continue;
  const stored=db.all<ReaderFault>('SELECT * FROM reader_faults WHERE session_id=? AND owner_id=? ORDER BY rowid',row.id,row.user_id);
  const evaluation=evaluate(stateOf(child)),now=Date.now();
  const groups=new Map<string,FaultToCarry[]>();
  for(const source of sources){
   const origin=source.origin_fault_id??source.id,group=groups.get(origin);
   if(group)group.push(source);
   else groups.set(origin,[source]);
  }
  const claimed=new Set<string>();
  let removed=false;
  for(const [origin,group] of groups){
   const source=group[0],original=source.origin_fault_id?
    db.get<Pick<ReaderFault,'node'|'node_key'>>('SELECT node,node_key FROM reader_faults WHERE id=? AND owner_id=?',origin,ownerId):source;
   const legacy=stored.find(fault=>fault.kind==='job'&&!fault.job_id&&!fault.origin_fault_id&&!fault.input_hash&&
    !claimed.has(fault.id)&&fault.node===original?.node&&fault.node_key===original.node_key&&fault.message===source.message&&fault.created_at>=created);
   if(legacy)claimed.add(legacy.id);
   // 旧版对空键故障的恢复回执已明确授权该批工作；保留这次授权。
   if(legacy&&['resolved','recovering'].includes(legacy.state))continue;
   const retained=carryFaults(group,parent,child);
   let reusedLegacy=false;
   for(const target of retained){
    if(evaluation.instance(target.node,target.node_key).status==='valid')continue;
    if(stored.some(fault=>fault.node===target.node&&fault.node_key===target.node_key&&
      (fault.origin_fault_id===origin||fault.job_id&&['pending','recovering'].includes(fault.state))))continue;
    if(legacy?.state==='pending'&&!reusedLegacy){
     db.run('UPDATE reader_faults SET node=?,node_key=?,input_hash=?,origin_fault_id=? WHERE id=?',
      target.node,target.node_key,target.input_hash,origin,legacy.id);
     reusedLegacy=true;
    }else insertCarriedJobFault(db,row.id,row.user_id,target,now,created);
   }
   if(legacy?.state==='pending'&&!reusedLegacy){
    db.run("UPDATE reader_faults SET state='replaced',updated_at=? WHERE id=?",now,legacy.id);
    removed=true;
   }
  }
  if(removed&&['idle','failed'].includes(row.state)&&!db.get("SELECT 1 FROM reader_faults WHERE session_id=? AND owner_id=? AND state IN ('pending','recovering','awaiting-match') AND optional=0",row.id,row.user_id)){
   if(complete(stateOf(child)))db.run("UPDATE stories SET state='completed',error=NULL WHERE id=? AND user_id=?",row.id,row.user_id);
   else if(row.state==='failed')db.run("UPDATE stories SET state='idle',error=NULL WHERE id=? AND user_id=?",row.id,row.user_id);
  }
 }
}
