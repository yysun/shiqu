// Persist owner-scoped defaults/checkpoints and serialize immediate retries without duplicating paid steps.
// 写入文档前把提示词全文存入 prompt_records，文档只保留引用。
import {writeStoryProducts} from '../server/production-products.ts';
import {decodeDocument,encodeDocument} from './production-dag/document.ts';
import {createHash} from 'node:crypto';
import {storePromptRecords} from './reader-prompt-store.ts';
import {authorizeLibraryControl} from './production-lifecycle.ts';
import {emptyDocument,ReaderError,selectionSchema,storyComplete} from './reader-model.ts';
import type {Selection,SessionRow,Document,ProductionAction} from './reader-model.ts';
import type {OriginalSource} from './reader-source-types.ts';
import type {StoryPublication} from './story-publication';
// 登记制作 DAG 的进度视图（view() 读取）；放在其余导入之后，避免与 reader-model 形成加载循环。
import './production-dag/progress.ts';
// The interface keeps the same SQL testable against SQLite without a Worker runtime.
/** 同步执行的语句，只在 transaction() 的事务体中使用。 */
export interface SyncStatements{run(query:string,...values:unknown[]):{changes:number};get<T>(query:string,...values:unknown[]):T|undefined;all<T>(query:string,...values:unknown[]):T[]}
export type ReadStatements=Pick<SyncStatements,'get'|'all'>;
/**
 * 数据库：逐条执行的异步语句，以及本地书库的同步事务。
 * 多表状态变化（任务、故障、命令回执、故事状态）在一个事务中原子完成；事务体同步执行、不含 await，
 * 因此同一连接上的其他异步写入不会插入其中。
 */
export interface Database{prepare(query:string):Statement;transaction?<T>(body:(db:SyncStatements)=>T):T;readTransaction?<T>(body:(db:ReadStatements)=>T):T}
interface Statement{bind(...values:unknown[]):Statement;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<{meta:{changes:number}}>}
export const visibleStory="NOT EXISTS (SELECT 1 FROM library_deletions d WHERE d.story_id=stories.id AND d.user_id=stories.user_id)";
const visible=visibleStory;
export const familyRoot=(alias:string)=>`COALESCE(json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.revision.rootId'),${alias}.id)`;
export const familyNumber=(alias:string)=>`COALESCE(json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.revision.number'),1)`;
export const supersededSql=(alias='stories')=>`EXISTS(SELECT 1 FROM stories newer WHERE newer.user_id=${alias}.user_id AND ${familyRoot('newer')}=${familyRoot(alias)} AND ${familyNumber('newer')}>${familyNumber(alias)})`;
// 横图属于来源版本；删除该版本或书架当前版本都会阻止新的派发。
export const landscapePrintHiddenSql=(alias='stories')=>`EXISTS(SELECT 1 FROM library_deletions d JOIN stories removed ON removed.id=d.story_id AND removed.user_id=d.user_id
 WHERE d.user_id=${alias}.user_id AND (removed.id=${alias}.id OR (${familyRoot('removed')}=${familyRoot(alias)} AND NOT ${supersededSql('removed')})))`;
export const latestVersionMessage='这是旧版本，请打开书架中的最新版本继续生成。';
// 最大版本先包含已删除项，避免删除后把历史版推回书架。
export const shelfRowsSql=`WITH editions AS MATERIALIZED (
 SELECT id,${familyRoot('stories')} AS root,${familyNumber('stories')} AS revision,
  json_type(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.reselection') IS NULL AS submitted
 FROM stories WHERE user_id=?
), latest AS (SELECT root,max(revision) AS revision FROM editions GROUP BY root)
SELECT stories.* FROM editions JOIN latest USING(root,revision) JOIN story_rows stories USING(id)
WHERE editions.submitted AND ${visible}
ORDER BY COALESCE(last_read_at,created_at) DESC`;
export const openReplacementParentsSql=(singleStory:boolean)=>{
 const parent="json_extract(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.reselection.parentId')";
 return `SELECT DISTINCT ${parent} AS parentId FROM stories WHERE user_id=? AND ${singleStory?`${parent}=?`:`${parent} IS NOT NULL`} AND ${visible}`;
};
function pauseDeletedLandscapePrints(db:SyncStatements,id:string,uid:string){
 // 删除历史版只影响它自己；删除书架当前版本还要暂停同一作品历史版的在途套图。
 db.run(`UPDATE stories SET document=json_set(document,'$.landscapePrints[#-1].control','paused')
  WHERE user_id=? AND CASE WHEN json_valid(document) THEN json_extract(document,'$.landscapePrints[#-1].control')='active' END
  AND (id=? OR (${familyRoot('stories')}=(SELECT ${familyRoot('card')} FROM stories card WHERE card.id=? AND card.user_id=? AND NOT ${supersededSql('card')})
   AND EXISTS(SELECT 1 FROM production_jobs j WHERE j.session_id=stories.id AND j.owner_id=stories.user_id
    AND j.kind='landscape-print' AND j.version=json_extract(stories.document,'$.landscapePrints[#-1].id') AND j.state IN ('queued','running'))))`,uid,id,id,uid);
}
/** 在调用方事务中标记已核对归属的故事，并停止后续制作。 */
export function markStoryDeleted(db:SyncStatements,id:string,uid:string,deletedAt=new Date().toISOString()){
 db.run("INSERT INTO library_deletions(user_id,story_id,kind,deleted_at) VALUES(?,?,'generated',?) ON CONFLICT(user_id,story_id) DO NOTHING",uid,id,deletedAt);
 db.run("UPDATE stories SET generation_control='stopped' WHERE id=? AND user_id=? AND generation_control!='stopped'",id,uid);
 pauseDeletedLandscapePrints(db,id,uid);
 return db.get<{storyId:string;deletedAt:string}>('SELECT story_id AS storyId,deleted_at AS deletedAt FROM library_deletions WHERE user_id=? AND story_id=?',uid,id)!;
}
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
 async get(id:string,uid:string){const row=await this.db.prepare(`SELECT * FROM story_rows stories WHERE id = ? AND user_id = ? AND ${visible}`).bind(id,uid).first<SessionRow>();if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');return row;}
 async current(id:string,uid:string){
  const origin=await this.db.prepare('SELECT * FROM story_rows stories WHERE id=? AND user_id=?').bind(id,uid).first<SessionRow>();
  if(!origin)throw new ReaderError(404,'这篇故事不在你的书架里');
  const doc=decodeDocument(origin);if(doc.reselection)throw new ReaderError(409,'这是尚未提交的选题草稿。');
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
  const row=await this.get(id,uid);
  if(!decodeDocument(row).plan)throw new ReaderError(409,'故事分镜尚未保存。');
  const result=await this.db.prepare(`UPDATE stories SET document=json_set(document,'$.publication',json(?)),updated_at=?
   WHERE id=? AND user_id=? AND (json_type(document,'$.dag.ending')='object' OR json_type(document,'$.plan')='object') AND ${visible} AND NOT ${supersededSql()}
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
 async list(uid:string){return (await this.db.prepare(`SELECT * FROM story_rows stories WHERE user_id = ? AND ${visible}
  AND json_type(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.reselection') IS NULL
  AND NOT ${supersededSql()}
  ORDER BY COALESCE(last_read_at,created_at) DESC`).bind(uid).all<SessionRow>()).results;}
 async listShelf(uid:string){return (await this.db.prepare(shelfRowsSql).bind(uid).all<SessionRow>()).results;}
 async currentStoryIds(uid:string){return (await this.db.prepare('SELECT id FROM stories WHERE user_id=? ORDER BY id').bind(uid).all<{id:string}>()).results.map(row=>row.id);}
 async deletions(uid:string){
  const rows=(await this.db.prepare(`SELECT d.story_id AS storyId,d.deleted_at AS deletedAt,d.kind,s.id IS NOT NULL AS owned,
   COALESCE(CASE WHEN json_valid(s.selection) THEN json_extract(s.selection,'$.displayTitle') END,
    CASE WHEN json_valid(s.document) THEN COALESCE(json_extract(s.document,'$.dag.ending.confirmed.title'),json_extract(s.document,'$.dag.ending.selectedTitle'),json_extract(s.document,'$.dag.ending.title'),json_extract(s.document,'$.plan.title')) END,
    CASE WHEN json_valid(s.selection) THEN json_extract(s.selection,'$.storyTitle') END,'未命名故事') AS title
   FROM library_deletions d
   LEFT JOIN stories s ON s.id=d.story_id AND s.user_id=d.user_id
   WHERE d.user_id=? AND d.kind='generated' AND (CASE WHEN json_valid(s.document) THEN json_type(s.document,'$.reselection') END) IS NULL
   ORDER BY d.deleted_at DESC,d.story_id`).bind(uid).all<{storyId:string;deletedAt:string;kind:'generated';title:string;owned:number}>()).results;
  return rows.map(({owned,...item})=>({...item,canRestore:authorizeLibraryControl({event:'restore',owned:!!owned,deleted:true})==='restore'}));
 }
 async remove(id:string,uid:string){
  if(!this.db.transaction)throw Error('TRANSACTION_UNAVAILABLE');
  return this.db.transaction(db=>{
   const owned=!!db.get('SELECT id FROM stories WHERE id=? AND user_id=?',id,uid);
   if(authorizeLibraryControl({event:'delete',owned})==='missing')throw new ReaderError(404,'这篇故事不在你的书架里');
   return markStoryDeleted(db,id,uid);
  });
 }
 async restore(id:string,uid:string){
  if(!this.db.transaction)throw Error('TRANSACTION_UNAVAILABLE');
  return this.db.transaction(db=>{
   const story=db.get<{deleted:number}>(`SELECT NOT (${visible}) AS deleted FROM stories WHERE id=? AND user_id=?`,id,uid);
   const decision=authorizeLibraryControl({event:'restore',owned:!!story,deleted:!!story?.deleted});
   if(decision==='missing')throw new ReaderError(404,'这篇故事不在你的书架里');
   const restored=decision==='restore';
   if(restored){
    // 旧版删除记录可能仍有活动套图，恢复前一并暂停。
    pauseDeletedLandscapePrints(db,id,uid);
    db.run("UPDATE stories SET generation_control='stopped' WHERE id=? AND user_id=? AND generation_control!='stopped'",id,uid);
    db.run('DELETE FROM library_deletions WHERE user_id=? AND story_id=?',uid,id);
   }
   return {storyId:id,restored};
  });
 }
 async favorite(id:string,uid:string,saved:boolean){
  // Favorites never move a reading checkpoint or enqueue production.
  const row=await this.db.prepare(`UPDATE stories SET saved=? WHERE id=? AND user_id=? AND ${visible} RETURNING page,saved,COALESCE(last_read_at,created_at) AS updatedAt`)
   .bind(saved?1:0,id,uid).first<{page:number;saved:number;updatedAt:string}>();
  if(!row)throw new ReaderError(404,'这篇故事不在你的书架里');
  return {storyId:id,...row};
 }
 async control(id:string,uid:string,action:ProductionAction){
  const startsGeneration=action==='resume';
  const value=action==='pause'?'paused':action==='stop'?'stopped':action==='resume'?'active':action;
  if(!this.db.transaction)throw Error('TRANSACTION_UNAVAILABLE');
  this.db.transaction(db=>{
   const current=db.get<SessionRow>(`SELECT * FROM story_rows stories WHERE id=? AND user_id=? AND ${visible}`,id,uid);
   if(!current)throw new ReaderError(404,'这篇故事不在你的书架里');
   if(startsGeneration&&db.get(`SELECT 1 FROM stories WHERE id=? AND user_id=? AND ${supersededSql()}`,id,uid))
    throw new ReaderError(409,latestVersionMessage);
   if(storyComplete(current))throw new ReaderError(409,'故事已完整生成。');
   db.run('UPDATE stories SET generation_control=? WHERE id=? AND user_id=?',value,id,uid);
  });
  return this.get(id,uid);
 }
 async saveOriginal(row:SessionRow,original:OriginalSource){
  const result=await this.db.prepare("UPDATE stories SET document=json_set(document,'$.original',json(?)),updated_at=? WHERE id=? AND user_id=? AND document=? AND NOT EXISTS(SELECT 1 FROM production_jobs j WHERE j.session_id=stories.id AND j.owner_id=stories.user_id AND j.kind!='landscape-print' AND j.state='running')").bind(JSON.stringify(original),new Date().toISOString(),row.id,row.user_id,row.document).run();
  if(!result.meta.changes)throw new ReaderError(409,'故事正在更新，请稍后再保存原文。');
  return this.get(row.id,row.user_id);
 }
 async create(id:string,uid:string,selection:Selection,document:Document=emptyDocument(),beforeInsert?:(db:SyncStatements)=>void){
 const normalized=selectionSchema.parse(selection),creationHash=createHash('sha256').update(JSON.stringify([normalized,!!document.intake,document.reselection||null,...(document.copiedFrom?[document.copiedFrom]:[])])).digest('hex');
 const command=await this.db.prepare('SELECT request_id FROM reader_commands WHERE owner_id=? AND request_id=?').bind(uid,id).first();if(command)throw new ReaderError(409,'此创建编号已用于其他操作。');
 const now=new Date().toISOString(),content=await storePromptRecords(this.db,{...document,creationHash});
 // Read defaults inside the insert: retries cannot change a story's original attribution snapshot.
 const insert=`INSERT INTO stories(id,user_id,selection,document,generation_control,page,saved,created_at,updated_at) VALUES(?,?,?,COALESCE((SELECT json_set(?,'$.publication',json(publication)) FROM reader_publication_defaults WHERE owner_id=?),?),?,0,0,?,?) ON CONFLICT(id) DO NOTHING`;
 const values=(saved:string)=>[id,uid,JSON.stringify(selection),saved,uid,saved,document.copiedFrom?'paused':'active',now,now];
 if(this.db.transaction){
  this.db.transaction(db=>{
   if(db.get('SELECT id FROM stories WHERE id=?',id))return;
   if(db.get('SELECT request_id FROM reader_commands WHERE owner_id=? AND request_id=?',uid,id))
    throw new ReaderError(409,'此创建编号已用于其他操作。');
   beforeInsert?.(db);
   writeStoryProducts(db,id,uid,content,stored=>db.run(insert,...values(stored)).changes);
  });
 }else{
  if(beforeInsert)throw Error('TRANSACTION_UNAVAILABLE');
  await this.db.prepare(insert).bind(...values(encodeDocument(content))).run();
 }
 const row=await this.get(id,uid),doc=decodeDocument(row);
 if(doc.creationHash?doc.creationHash!==creationHash:doc.revision||doc.intake?.creationHash!==document.intake?.creationHash||JSON.stringify(selectionSchema.parse(JSON.parse(row.selection)))!==JSON.stringify(normalized))throw new ReaderError(409,'此创建编号已用于其他内容，请重新创建。');
 return row;}
 async progress(id:string,uid:string,page:number,saved:boolean){
  const row=await this.get(id,uid),doc=decodeDocument(row);if(!doc.plan||!doc.images[page])throw new ReaderError(400,'这幅画面还没有展开');
  // 在同一事务内核对当前阅读视图；成图到达不会与阅读进度冲突。
  const now=new Date().toISOString();
  const sql=`UPDATE stories SET page=?,saved=?,last_read_at=? WHERE id=? AND user_id=? AND ${visible} AND document=?`;
  const changes=this.db.transaction?this.db.transaction(db=>{
   const current=db.get<SessionRow>('SELECT * FROM story_rows WHERE id=? AND user_id=?',id,uid);
   const projected=current&&decodeDocument(current);
   if(!current||!projected?.images[page]||JSON.stringify(projected.plan)!==JSON.stringify(doc.plan))return 0;
   return db.run(sql,page,saved?1:0,now,id,uid,current.document).changes;
  }):(await this.db.prepare(sql).bind(page,saved?1:0,now,id,uid,row.document).run()).meta.changes;
  if(!changes)throw new ReaderError(409,'故事分镜已更新，请重新打开后再保存。');return this.get(id,uid);
 }
}
