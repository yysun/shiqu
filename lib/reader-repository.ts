// Persist owner-scoped checkpoints and serialize immediate retries without duplicating paid steps.
import {emptyDocument,ReaderError} from './reader-model.ts';
import {readerDailyLimit} from './reader-limits.ts';
import type {Selection,SessionRow,Document,Step} from './reader-model.ts';
import type {OriginalSource} from './reader-source-types.ts';
// The interface keeps the same SQL testable against SQLite without a Worker runtime.
export interface Database{prepare(query:string):Statement}
interface Statement{bind(...values:unknown[]):Statement;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<{meta:{changes:number}}>}
const visible="NOT EXISTS (SELECT 1 FROM library_deletions d WHERE d.story_id=reader_sessions.id AND d.user_id=reader_sessions.user_id)";
export class ReaderRepository{
 db:Database;
 constructor(db:Database){this.db=db;}
 async get(id:string,uid:string){const row=await this.db.prepare(`SELECT * FROM reader_sessions WHERE id = ? AND user_id = ? AND ${visible}`).bind(id,uid).first<SessionRow>();if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');return row;}
 async list(uid:string){return (await this.db.prepare(`SELECT * FROM reader_sessions WHERE user_id = ? AND ${visible} ORDER BY COALESCE(last_read_at,created_at) DESC LIMIT 80`).bind(uid).all<SessionRow>()).results;}
 async deletions(uid:string){return (await this.db.prepare('SELECT story_id AS storyId,deleted_at AS deletedAt FROM library_deletions WHERE user_id=?').bind(uid).all<{storyId:string;deletedAt:string}>()).results;}
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
 async saveOriginal(row:SessionRow,original:OriginalSource){
  const recovered=row.state==='failed'&&(row.step_key==='source'||row.step_key==='plan');
  const result=await this.db.prepare("UPDATE reader_sessions SET document=json_set(document,'$.original',json(?)),state=CASE WHEN ? THEN 'idle' ELSE state END,error=CASE WHEN ? THEN NULL ELSE error END,updated_at=? WHERE id=? AND user_id=? AND document=? AND state!='running'").bind(JSON.stringify(original),recovered?1:0,recovered?1:0,new Date().toISOString(),row.id,row.user_id,row.document).run();
  if(!result.meta.changes)throw new ReaderError(409,'故事正在更新，请稍后再保存原文。');
  return this.get(row.id,row.user_id);
 }
 async create(id:string,uid:string,selection:Selection){const now=new Date().toISOString(),cutoff=new Date(Date.now()-86400000).toISOString();const old=await this.db.prepare('SELECT * FROM reader_sessions WHERE id = ? AND user_id = ?').bind(id,uid).first<SessionRow>();if(old)return this.get(id,uid);
 await this.db.prepare(`INSERT INTO reader_sessions(id,user_id,selection,document,state,step_attempts,lock_until,page,saved,created_at,updated_at) SELECT ?,?,?,?,'idle',0,0,0,0,?,? WHERE (SELECT COUNT(*) FROM reader_sessions WHERE user_id = ? AND created_at >= ?) < ? ON CONFLICT(id) DO NOTHING`).bind(id,uid,JSON.stringify(selection),JSON.stringify(emptyDocument()),now,now,uid,cutoff,readerDailyLimit).run();
 const row=await this.db.prepare('SELECT * FROM reader_sessions WHERE id = ? AND user_id = ?').bind(id,uid).first<SessionRow>();if(!row)throw new ReaderError(429,`最近 24 小时已开启 ${readerDailyLimit} 篇新故事，请稍后再来。已开启的故事仍可继续阅读和生成。`);return row;}
 async stale(row:SessionRow){await this.db.prepare("UPDATE reader_sessions SET state='failed',error=?,lock_token=NULL,updated_at=? WHERE id=? AND user_id=? AND state='running' AND lock_until<=?").bind('生成等待超时，已保留前面的内容。可手动重试。',new Date().toISOString(),row.id,row.user_id,Date.now()).run();return this.get(row.id,row.user_id);}
 async acquire(row:SessionRow,step:Step){const token=crypto.randomUUID(),now=Date.now();const r=await this.db.prepare(`UPDATE reader_sessions SET state='running',error=NULL,lock_token=?,lock_until=?,step_attempts=CASE WHEN step_key=? THEN step_attempts+1 ELSE 1 END,step_key=?,updated_at=? WHERE id=? AND user_id=? AND state=? AND document=? AND state!='running' AND ${visible}`).bind(token,now+180000,step.key,step.key,new Date(now).toISOString(),row.id,row.user_id,row.state,row.document).run();return r.meta.changes?token:null;}
 async save(row:SessionRow,token:string,doc:Document,complete:boolean,error:string|null=null){const r=await this.db.prepare('UPDATE reader_sessions SET document=?,state=?,error=?,lock_token=NULL,lock_until=0,updated_at=? WHERE id=? AND user_id=? AND lock_token=?').bind(JSON.stringify(doc),error?'failed':complete?'completed':'idle',error,new Date().toISOString(),row.id,row.user_id,token).run();if(!r.meta.changes)throw new ReaderError(409,'故事状态已更新，请重新打开后继续。');return this.get(row.id,row.user_id);}
 async progress(id:string,uid:string,page:number,saved:boolean){const row=await this.get(id,uid),doc=JSON.parse(row.document) as Document;if(!doc.plan||!doc.images[page])throw new ReaderError(400,'这幅画面还没有展开');await this.db.prepare(`UPDATE reader_sessions SET page=?,saved=?,last_read_at=? WHERE id=? AND user_id=? AND ${visible}`).bind(page,saved?1:0,new Date().toISOString(),id,uid).run();return this.get(id,uid);}
}
