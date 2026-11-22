// Persist owner-scoped defaults/checkpoints and serialize immediate retries without duplicating paid steps.
// 写入文档前把提示词全文存入 prompt_records，文档只保留引用。
import {createHash} from 'node:crypto';
import {storePromptRecords} from './reader-prompt-store.ts';
import {emptyDocument,ReaderError,selectionSchema,awaitingFrameCount} from './reader-model.ts';
import type {Selection,SessionRow,Document,ProductionAction} from './reader-model.ts';
import type {OriginalSource} from './reader-source-types.ts';
import type {StoryPublication} from './story-publication';
// 登记制作 DAG 的进度视图（view() 读取）；放在其余导入之后，避免与 reader-model 形成加载循环。
import './production-dag/progress.ts';
// The interface keeps the same SQL testable against SQLite without a Worker runtime.
/** 同步执行的语句，只在 transaction() 的事务体中使用。 */
export interface SyncStatements{run(query:string,...values:unknown[]):{changes:number};get<T>(query:string,...values:unknown[]):T|undefined;all<T>(query:string,...values:unknown[]):T[]}
/**
 * 数据库：逐条执行的异步语句，以及本地书库的同步事务。
 * 多表状态变化（任务、故障、命令回执、故事状态）在一个事务中原子完成；事务体同步执行、不含 await，
 * 因此同一连接上的其他异步写入不会插入其中。
 */
export interface Database{prepare(query:string):Statement;transaction?<T>(body:(db:SyncStatements)=>T):T}
interface Statement{bind(...values:unknown[]):Statement;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<{meta:{changes:number}}>}
const visible="NOT EXISTS (SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id)";
export const familyRoot=(alias:string)=>`COALESCE(json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.revision.rootId'),${alias}.id)`;
export const familyNumber=(alias:string)=>`COALESCE(json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.revision.number'),1)`;
export const supersededSql=(alias='stories')=>`EXISTS(SELECT 1 FROM stories newer WHERE newer.user_id=${alias}.user_id AND ${familyRoot('newer')}=${familyRoot(alias)} AND ${familyNumber('newer')}>${familyNumber(alias)})`;
export const latestVersionMessage='这是旧版本，请打开书架中的最新版本继续生成。';
// A failed write says nothing about the work, so callers must not report it as a provider failure.
export const persistenceError=(error:unknown)=>(error as {code?:string}|null)?.code==='ERR_SQLITE_ERROR';
// Full checkpoints own the intake phase and may initialize an absent setup draft.
// A draft saved beside inference, including empty fields, wins as a complete object.
// Candidates, search and drafts change beside a running step,
// and the generation fence on every write below rejects a worker whose selection was replaced.
// Keep public metadata written during inference out of stale full-worker snapshots.
const checkpoint="json_patch(?,CASE WHEN json_type(document,'$.publication')='object' THEN json_object('publication',json_extract(document,'$.publication')) ELSE '{}' END)";
const workerDocument=`CASE WHEN json_type(document,'$.intake')='object' THEN json_set(${checkpoint},'$.intake',json(json_patch(json_set(json_extract(document,'$.intake'),'$.phase',json_extract(?,'$.intake.phase')),CASE WHEN json_type(document,'$.intake.draft') IS NOT 'object' AND json_type(?,'$.intake.draft')='object' THEN json_object('draft',json_extract(?,'$.intake.draft')) ELSE '{}' END))) ELSE ${checkpoint} END`;
export class ReaderRepository{
 db:Database;
 constructor(db:Database){this.db=db;}
 async superseded(id:string,uid:string){return !!await this.db.prepare(`SELECT id FROM stories WHERE id=? AND user_id=? AND ${supersededSql()}`).bind(id,uid).first();}
 async get(id:string,uid:string){const row=await this.db.prepare(`SELECT * FROM stories WHERE id = ? AND user_id = ? AND ${visible}`).bind(id,uid).first<SessionRow>();if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');return row;}
 async current(id:string,uid:string){
  const origin=await this.db.prepare('SELECT * FROM stories WHERE id=? AND user_id=?').bind(id,uid).first<SessionRow>();
  if(!origin)throw new ReaderError(404,'这篇故事不在你的书架里');
  const doc=JSON.parse(origin.document) as Document;if(doc.reselection)throw new ReaderError(409,'这是尚未提交的选题草稿。');
  const root=doc.revision?.rootId||id;
  const latest=await this.db.prepare(`SELECT s.id FROM stories s WHERE s.user_id=? AND ${familyRoot('s')}=? ORDER BY ${familyNumber('s')} DESC,s.created_at DESC LIMIT 1`).bind(uid,root).first<{id:string}>();
  if(!latest)throw new ReaderError(404,'家族当前版本不可用。');return this.get(latest.id,uid);
 }
 // Names belong to saved sessions, including source-only drafts; naming never starts production.
 // Target selection metadata only: an in-flight generation checkpoint cannot overwrite this name.
 async rename(id:string,uid:string,title:string){
  await this.get(id,uid);
  const result=await this.db.prepare(`UPDATE stories SET selection=json_set(selection,'$.displayTitle',?),updated_at=? WHERE id=? AND user_id=? AND ${visible}`)
   .bind(title,new Date().toISOString(),id,uid).run();
  if(!result.meta.changes)throw new ReaderError(404,'这篇故事不在你的书架里');
  return this.get(id,uid);
 }
 // Compare only publication metadata; independent image/progress saves must not conflict.
 async savePublication(id:string,uid:string,publication:StoryPublication,expected:StoryPublication|null){
  await this.get(id,uid);
  const result=await this.db.prepare(`UPDATE stories SET document=json_set(document,'$.publication',json(?)),updated_at=?
   WHERE id=? AND user_id=? AND json_type(document,'$.plan')='object' AND ${visible} AND NOT ${supersededSql()}
   AND json_extract(document,'$.publication') IS json_extract(?,'$')`)
   .bind(JSON.stringify(publication),new Date().toISOString(),id,uid,JSON.stringify(expected)).run();
  if(!result.meta.changes)throw new ReaderError(409,'署名说明或故事版本已更新，请重新打开后再保存。');
  return this.get(id,uid);
 }
 async publicationDefaults(uid:string){
  const row=await this.db.prepare('SELECT publication FROM reader_publication_defaults WHERE owner_id=?').bind(uid).first<{publication:string}>();
  return row?JSON.parse(row.publication) as StoryPublication:null;
 }
 async savePublicationDefaults(uid:string,publication:StoryPublication,expected:StoryPublication|null){
  const value=JSON.stringify(publication);
  const result=expected===null
   ?await this.db.prepare('INSERT INTO reader_publication_defaults(owner_id,publication) VALUES(?,?) ON CONFLICT(owner_id) DO NOTHING').bind(uid,value).run()
   :await this.db.prepare("UPDATE reader_publication_defaults SET publication=? WHERE owner_id=? AND json_extract(publication,'$') IS json_extract(?,'$')").bind(value,uid,JSON.stringify(expected)).run();
  if(!result.meta.changes)throw new ReaderError(409,'默认说明已由另一次操作更新，请重新打开后再保存。');
  return publication;
 }
 // Count every newer submission, including deleted ones, so deletion never promotes history.
 async list(uid:string){return (await this.db.prepare(`SELECT * FROM stories WHERE user_id = ? AND ${visible}
  AND json_type(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.reselection') IS NULL
  AND NOT ${supersededSql()}
  ORDER BY COALESCE(last_read_at,created_at) DESC`).bind(uid).all<SessionRow>()).results;}
 // 先计算所有版本的家族与序号，再过滤草稿和删除项，避免删除最新版本后露出旧版本。
 async listShelf(uid:string){return (await this.db.prepare(`WITH editions AS MATERIALIZED (
   SELECT id,${familyRoot('stories')} AS root,${familyNumber('stories')} AS revision,
    json_type(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.reselection') IS NULL AS submitted
   FROM stories WHERE user_id=?
  ), latest AS (SELECT root,max(revision) AS revision FROM editions GROUP BY root)
  SELECT stories.* FROM editions JOIN latest USING(root,revision) JOIN stories USING(id)
  WHERE editions.submitted AND ${visible}
  ORDER BY COALESCE(last_read_at,created_at) DESC`).bind(uid).all<SessionRow>()).results;}
 async currentStoryIds(uid:string){return (await this.db.prepare('SELECT id FROM stories WHERE user_id=? ORDER BY id').bind(uid).all<{id:string}>()).results.map(row=>row.id);}
 async deletions(uid:string){
  return (await this.db.prepare(`SELECT d.story_id AS storyId,d.deleted_at AS deletedAt,d.kind,
   COALESCE(json_extract(s.selection,'$.displayTitle'),json_extract(s.document,'$.plan.title'),json_extract(s.selection,'$.storyTitle'),'未命名故事') AS title
   FROM library_deletions d
   LEFT JOIN stories s ON s.id=d.story_id AND s.user_id=d.user_id
   WHERE d.user_id=? AND d.kind='generated' AND (s.id IS NULL OR json_type(s.document,'$.reselection') IS NULL)
   ORDER BY d.deleted_at DESC,d.story_id`).bind(uid).all<{storyId:string;deletedAt:string;kind:'generated';title:string}>()).results;
 }
 async remove(id:string,uid:string){
  const owned=await this.db.prepare('SELECT id FROM stories WHERE id=? AND user_id=?').bind(id,uid).first();
  if(!owned)throw new ReaderError(404,'这篇故事不在你的书架里');
  const existing=await this.db.prepare('SELECT story_id AS storyId,deleted_at AS deletedAt FROM library_deletions WHERE user_id=? AND story_id=?').bind(uid,id).first<{storyId:string;deletedAt:string}>();if(existing)return existing;
  const deletedAt=new Date().toISOString();await this.db.prepare("INSERT INTO library_deletions(user_id,story_id,kind,deleted_at) VALUES(?,?,'generated',?) ON CONFLICT(user_id,story_id) DO NOTHING").bind(uid,id,deletedAt).run();
  return {storyId:id,deletedAt};
 }
 async restore(id:string,uid:string){
  const owned=await this.db.prepare('SELECT id FROM stories WHERE id=? AND user_id=?').bind(id,uid).first();
  if(!owned)throw new ReaderError(404,'这篇故事不在你的书架里');
  const result=await this.db.prepare('DELETE FROM library_deletions WHERE user_id=? AND story_id=?').bind(uid,id).run();
  return {storyId:id,restored:result.meta.changes>0};
 }
 async favorite(id:string,uid:string,saved:boolean){
  // Favorites never move a reading checkpoint or enqueue production.
  const row=await this.db.prepare(`UPDATE stories SET saved=? WHERE id=? AND user_id=? AND ${visible} RETURNING page,saved,COALESCE(last_read_at,created_at) AS updatedAt`)
   .bind(saved?1:0,id,uid).first<{page:number;saved:number;updatedAt:string}>();
  if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');
  return {storyId:id,...row};
 }
 async control(id:string,uid:string,action:ProductionAction){
  const row=await this.get(id,uid);
  const startsGeneration=action==='resume'||action==='background';
  if(startsGeneration&&await this.superseded(id,uid))throw new ReaderError(409,latestVersionMessage);
  if(row.state==='completed')throw new ReaderError(409,'故事已完整生成，无需更改生成方式。');
  // Resume always continues the whole story; other legacy actions change only their own field.
  const field=action==='background'||action==='reader'?'generation_mode':'generation_control';
  const value=action==='pause'?'paused':action==='stop'?'stopped':action==='resume'?'active':action;
  const assignment=action==='resume'?"generation_mode='background',generation_control=?":`${field}=?`;
  const result=await this.db.prepare(`UPDATE stories SET ${assignment} WHERE id=? AND user_id=? AND state!='completed' AND ${visible}${startsGeneration?` AND NOT ${supersededSql()}`:''}`)
   .bind(value,id,uid).run();
  if(startsGeneration&&!result.meta.changes&&await this.superseded(id,uid))throw new ReaderError(409,latestVersionMessage);
  return this.get(id,uid);
 }
 async saveOriginal(row:SessionRow,original:OriginalSource){
  const recovered=row.state==='failed'&&(row.step_key==='source'||row.step_key==='plan');
  const result=await this.db.prepare("UPDATE stories SET document=json_set(document,'$.original',json(?)),state=CASE WHEN ? THEN 'idle' ELSE state END,error=CASE WHEN ? THEN NULL ELSE error END,updated_at=? WHERE id=? AND user_id=? AND document=? AND state!='running'").bind(JSON.stringify(original),recovered?1:0,recovered?1:0,new Date().toISOString(),row.id,row.user_id,row.document).run();
  if(!result.meta.changes)throw new ReaderError(409,'故事正在更新，请稍后再保存原文。');
  return this.get(row.id,row.user_id);
 }
 async create(id:string,uid:string,selection:Selection,document:Document=emptyDocument()){
 const normalized=selectionSchema.parse(selection),creationHash=createHash('sha256').update(JSON.stringify([normalized,!!document.intake,document.reselection||null,...(document.copiedFrom?[document.copiedFrom]:[])])).digest('hex');
 const command=await this.db.prepare('SELECT request_id FROM reader_commands WHERE owner_id=? AND request_id=?').bind(uid,id).first();if(command)throw new ReaderError(409,'此创建编号已用于其他操作。');
 const now=new Date().toISOString(),saved=JSON.stringify(await storePromptRecords(this.db,{...document,creationHash}));
 // Read defaults inside the insert: retries cannot change a story's original attribution snapshot.
 await this.db.prepare(`INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,step_attempts,lock_until,page,saved,created_at,updated_at) VALUES(?,?,?,COALESCE((SELECT json_set(?,'$.publication',json(publication)) FROM reader_publication_defaults WHERE owner_id=?),?),?,?,'idle',0,0,0,0,?,?) ON CONFLICT(id) DO NOTHING`).bind(id,uid,JSON.stringify(selection),saved,uid,saved,document.reselection?'reader':'background',document.copiedFrom?'paused':'active',now,now).run();
 const row=await this.get(id,uid),doc=JSON.parse(row.document) as Document;
 if(doc.creationHash?doc.creationHash!==creationHash:doc.revision||doc.intake?.creationHash!==document.intake?.creationHash||JSON.stringify(selectionSchema.parse(JSON.parse(row.selection)))!==JSON.stringify(normalized))throw new ReaderError(409,'此创建编号已用于其他内容，请重新创建。');
 return row;}
 async confirmFrameCount(id:string,uid:string,count:Selection['length']){
  const row=await this.get(id,uid),selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document;
  if(doc.intake)throw new ReaderError(409,'请在制作确认中统一确认故事、画风、幅数和制作要求。');
  if(doc.frameCountConfirmed&&selection.length===count)return row;
  if(row.state==='running'||!awaitingFrameCount(doc,selection))throw new ReaderError(409,'画幅数已确定或故事正在更新，请重新打开后继续。');
  delete doc.legacyFramePreparation;
  const updated=await this.db.prepare(`UPDATE stories SET selection=?,document=?,state='idle',error=NULL,updated_at=? WHERE id=? AND user_id=? AND state=? AND document=? AND selection=? AND ${visible}`)
   .bind(JSON.stringify({...selection,length:count}),JSON.stringify({...doc,frameCountConfirmed:true}),new Date().toISOString(),id,uid,row.state,row.document,row.selection).run();
  if(!updated.meta.changes){
   const current=await this.get(id,uid),saved=JSON.parse(current.document) as Document;
   if(saved.frameCountConfirmed&&selectionSchema.parse(JSON.parse(current.selection)).length===count)return current;
   throw new ReaderError(409,'画幅数已由另一次操作确定，请重新打开后继续。');
  }
  return this.get(id,uid);
 }
 async progress(id:string,uid:string,page:number,saved:boolean){
  const row=await this.get(id,uid),doc=JSON.parse(row.document) as Document;if(!doc.plan||!doc.images[page])throw new ReaderError(400,'这幅画面还没有展开');
  // A late reader cannot overwrite a structural save's remapped position. Image publication is independent.
  const result=await this.db.prepare(`UPDATE stories SET page=?,saved=?,last_read_at=? WHERE id=? AND user_id=? AND ${visible} AND json_extract(document,'$.plan')=json(?)`).bind(page,saved?1:0,new Date().toISOString(),id,uid,JSON.stringify(doc.plan)).run();
  if(!result.meta.changes)throw new ReaderError(409,'故事分镜已更新，请重新打开后继续阅读。');return this.get(id,uid);
 }
}
