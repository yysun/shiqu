// Persist owner-scoped checkpoints and serialize immediate retries without duplicating paid steps.
import {emptyDocument,ReaderError,selectionSchema,awaitingFrameCount} from './reader-model.ts';
import type {Selection,SessionRow,Document,Step,ProductionAction} from './reader-model.ts';
import type {OriginalSource} from './reader-source-types.ts';
// The interface keeps the same SQL testable against SQLite without a Worker runtime.
export interface Database{prepare(query:string):Statement}
interface Statement{bind(...values:unknown[]):Statement;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<{meta:{changes:number}}>}
const visible="NOT EXISTS (SELECT 1 FROM library_deletions d WHERE d.story_id=reader_sessions.id AND d.user_id=reader_sessions.user_id)";
// A failed write says nothing about the work, so callers must not report it as a provider failure.
export const persistenceError=(error:unknown)=>(error as {code?:string}|null)?.code==='ERR_SQLITE_ERROR';
// Workers own only the intake phase. Candidates, search and drafts change beside a running step,
// and the generation fence on every write below rejects a worker whose selection was replaced.
const workerDocument="CASE WHEN json_type(document,'$.intake')='object' THEN json_set(?,'$.intake',json(json_set(json_extract(document,'$.intake'),'$.phase',json_extract(?,'$.intake.phase')))) ELSE ? END";
export class ReaderRepository{
 db:Database;
 constructor(db:Database){this.db=db;}
 async get(id:string,uid:string){const row=await this.db.prepare(`SELECT * FROM reader_sessions WHERE id = ? AND user_id = ? AND ${visible}`).bind(id,uid).first<SessionRow>();if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');return row;}
 async list(uid:string){return (await this.db.prepare(`SELECT * FROM reader_sessions WHERE user_id = ? AND ${visible} ORDER BY COALESCE(last_read_at,created_at) DESC`).bind(uid).all<SessionRow>()).results;}
 async deletions(uid:string){
  return (await this.db.prepare(`SELECT d.story_id AS storyId,d.deleted_at AS deletedAt,d.kind,
   CASE WHEN d.kind='generated' THEN COALESCE(json_extract(s.document,'$.plan.title'),json_extract(s.selection,'$.storyTitle'),'未命名故事') ELSE COALESCE(p.title,'未命名故事') END AS title
   FROM library_deletions d
   LEFT JOIN reader_sessions s ON d.kind='generated' AND s.id=d.story_id AND s.user_id=d.user_id
   LEFT JOIN stories p ON d.kind='published' AND p.id=d.story_id AND p.status='published'
   WHERE d.user_id=? ORDER BY d.deleted_at DESC,d.story_id`).bind(uid).all<{storyId:string;deletedAt:string;kind:'generated'|'published';title:string}>()).results;
 }
 async remove(id:string,uid:string){
  const existing=await this.db.prepare('SELECT story_id AS storyId,deleted_at AS deletedAt FROM library_deletions WHERE user_id=? AND story_id=?').bind(uid,id).first<{storyId:string;deletedAt:string}>();if(existing)return existing;
  const owned=await this.db.prepare('SELECT id FROM reader_sessions WHERE id=? AND user_id=?').bind(id,uid).first();
  if(!owned){const published=await this.db.prepare("SELECT id FROM stories WHERE id=? AND status='published'").bind(id).first();if(!published)throw new ReaderError(404,'这篇故事不在你的书架里');}
  const deletedAt=new Date().toISOString();await this.db.prepare('INSERT INTO library_deletions(user_id,story_id,kind,deleted_at) VALUES(?,?,?,?) ON CONFLICT(user_id,story_id) DO NOTHING').bind(uid,id,owned?'generated':'published',deletedAt).run();
  return {storyId:id,deletedAt};
 }
 async restore(id:string,uid:string){
  const owned=await this.db.prepare('SELECT id FROM reader_sessions WHERE id=? AND user_id=?').bind(id,uid).first();
  if(!owned){const published=await this.db.prepare("SELECT id FROM stories WHERE id=? AND status='published'").bind(id).first();if(!published)throw new ReaderError(404,'这篇故事不在你的书架里');}
  const result=await this.db.prepare('DELETE FROM library_deletions WHERE user_id=? AND story_id=?').bind(uid,id).run();
  return {storyId:id,restored:result.meta.changes>0};
 }
 async favorite(id:string,uid:string,saved:boolean){
  // Favorites work before the first image and never move a reading checkpoint or enqueue production.
  type FavoriteProgress={page:number;saved:number;updatedAt:string};
  const generated=await this.db.prepare(`UPDATE reader_sessions SET saved=? WHERE id=? AND user_id=? AND ${visible} RETURNING page,saved,COALESCE(last_read_at,created_at) AS updatedAt`)
   .bind(saved?1:0,id,uid).first<FavoriteProgress>();
  if(generated)return {storyId:id,...generated};
  const published=await this.db.prepare(`INSERT INTO progress(id,user_id,story_id,page,saved,updated_at)
   SELECT ?,?,?,0,?,? FROM stories WHERE id=? AND status='published'
   AND NOT EXISTS (SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=?)
   ON CONFLICT(user_id,story_id) DO UPDATE SET saved=excluded.saved
   RETURNING page,saved,updated_at AS updatedAt`)
   .bind(uid+':'+id,uid,id,saved?1:0,new Date().toISOString(),id,uid).first<FavoriteProgress>();
  if(!published)throw new ReaderError(404,'这篇故事不在你的书架里');
  return {storyId:id,...published};
 }
 async control(id:string,uid:string,action:ProductionAction){
  const row=await this.get(id,uid);
  if(row.state==='completed')throw new ReaderError(409,'故事已完整生成，无需更改生成方式。');
  // A revision is born paused. Persist the parent pause before making its child eligible;
  // a crash between writes leaves a paused child that explicit resume can recover.
  const revision=(JSON.parse(row.document) as Document).revision;
  if(revision&&(action==='resume'||action==='background')){
   await this.db.prepare("UPDATE reader_sessions SET generation_control='paused' WHERE id=? AND user_id=? AND state!='completed'").bind(revision.parentId,uid).run();
  }
  // Resume always continues the whole story; other legacy actions change only their own field.
  const field=action==='background'||action==='reader'?'generation_mode':'generation_control';
  const value=action==='pause'?'paused':action==='stop'?'stopped':action==='resume'?'active':action;
  const assignment=action==='resume'?"generation_mode='background',generation_control=?":`${field}=?`;
  await this.db.prepare(`UPDATE reader_sessions SET ${assignment}${revision&&action==='resume'?",document=json_remove(document,'$.revision.handoff')":''} WHERE id=? AND user_id=? AND state!='completed' AND ${visible}`)
   .bind(value,id,uid).run();
  return this.get(id,uid);
 }
 async saveOriginal(row:SessionRow,original:OriginalSource){
  const recovered=row.state==='failed'&&(row.step_key==='source'||row.step_key==='plan');
  const result=await this.db.prepare("UPDATE reader_sessions SET document=json_set(document,'$.original',json(?)),state=CASE WHEN ? THEN 'idle' ELSE state END,error=CASE WHEN ? THEN NULL ELSE error END,updated_at=? WHERE id=? AND user_id=? AND document=? AND state!='running'").bind(JSON.stringify(original),recovered?1:0,recovered?1:0,new Date().toISOString(),row.id,row.user_id,row.document).run();
  if(!result.meta.changes)throw new ReaderError(409,'故事正在更新，请稍后再保存原文。');
  return this.get(row.id,row.user_id);
 }
 async create(id:string,uid:string,selection:Selection){const now=new Date().toISOString();
 await this.db.prepare(`INSERT INTO reader_sessions(id,user_id,selection,document,generation_mode,state,step_attempts,lock_until,page,saved,created_at,updated_at) VALUES(?,?,?,?,'background','idle',0,0,0,0,?,?) ON CONFLICT(id) DO NOTHING`).bind(id,uid,JSON.stringify(selection),JSON.stringify(emptyDocument()),now,now).run();
 return this.get(id,uid);}
 async confirmFrameCount(id:string,uid:string,count:number){
  const row=await this.get(id,uid),selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document;
  if(doc.intake)throw new ReaderError(409,'请在制作确认中统一确认故事、画风、幅数和制作要求。');
  if(doc.frameCountConfirmed&&selection.length===count)return row;
  if(row.state==='running'||!awaitingFrameCount(doc,selection))throw new ReaderError(409,'画幅数已确定或故事正在更新，请重新打开后继续。');
  const updated=await this.db.prepare(`UPDATE reader_sessions SET selection=?,document=?,state='idle',error=NULL,updated_at=? WHERE id=? AND user_id=? AND state=? AND document=? AND selection=? AND ${visible}`)
   .bind(JSON.stringify({...selection,length:count}),JSON.stringify({...doc,frameCountConfirmed:true}),new Date().toISOString(),id,uid,row.state,row.document,row.selection).run();
  if(!updated.meta.changes){
   const current=await this.get(id,uid),saved=JSON.parse(current.document) as Document;
   if(saved.frameCountConfirmed&&selectionSchema.parse(JSON.parse(current.selection)).length===count)return current;
   throw new ReaderError(409,'画幅数已由另一次操作确定，请重新打开后继续。');
  }
  return this.get(id,uid);
 }
 async stale(row:SessionRow){await this.db.prepare("UPDATE reader_sessions SET state='failed',error=?,lock_token=NULL,updated_at=? WHERE id=? AND user_id=? AND state='running' AND lock_until<=?").bind('生成等待超时，已保留前面的内容。可手动重试。',new Date().toISOString(),row.id,row.user_id,Date.now()).run();return this.get(row.id,row.user_id);}
 async acquire(row:SessionRow,step:Step){const token=crypto.randomUUID(),now=Date.now();const r=await this.db.prepare(`UPDATE reader_sessions SET state='running',error=NULL,lock_token=?,lock_until=?,step_attempts=CASE WHEN step_key=? THEN step_attempts+1 ELSE 1 END,step_key=?,updated_at=? WHERE id=? AND user_id=? AND state=? AND document=? AND state!='running' AND generation_control='active' AND ${visible}`).bind(token,now+180000,step.key,step.key,new Date(now).toISOString(),row.id,row.user_id,row.state,row.document).run();return r.meta.changes?token:null;}
 async saveImageProgress(row:SessionRow,token:string,snapshot:Document){
  // Deletion hides the session but must still retain results of calls already in flight.
  const saved=JSON.stringify(snapshot),result=await this.db.prepare(`UPDATE reader_sessions SET document=${workerDocument},updated_at=? WHERE id=? AND user_id=? AND state='running' AND lock_token=? AND COALESCE(json_extract(document,'$.intake.generation'),-1)=?`)
   .bind(saved,saved,saved,new Date().toISOString(),row.id,row.user_id,token,snapshot.intake?.generation??-1).run();
  if(result.meta.changes!==1)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');
 }
 async save(row:SessionRow,token:string,doc:Document,complete:boolean,error:string|null=null){const saved=JSON.stringify(doc),r=await this.db.prepare(`UPDATE reader_sessions SET document=${workerDocument},state=?,error=?,lock_token=NULL,lock_until=0,updated_at=? WHERE id=? AND user_id=? AND lock_token=? AND COALESCE(json_extract(document,'$.intake.generation'),-1)=?`).bind(saved,saved,saved,error?'failed':complete?'completed':'idle',error,new Date().toISOString(),row.id,row.user_id,token,doc.intake?.generation??-1).run();if(!r.meta.changes)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');return this.get(row.id,row.user_id);}
 async progress(id:string,uid:string,page:number,saved:boolean){const row=await this.get(id,uid),doc=JSON.parse(row.document) as Document;if(!doc.plan||!doc.images[page])throw new ReaderError(400,'这幅画面还没有展开');await this.db.prepare(`UPDATE reader_sessions SET page=?,saved=?,last_read_at=? WHERE id=? AND user_id=? AND ${visible}`).bind(page,saved?1:0,new Date().toISOString(),id,uid).run();return this.get(id,uid);}
}
