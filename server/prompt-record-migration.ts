// 迁移 0024：把故事文档中内嵌的提示词全文移入 prompt_records，调用记录原位改为 promptRecordId 引用。
// 在迁移事务内逐篇处理并核对：写回的文档还原后必须与原文档完全相同，且全书库不再有内嵌记录、每个引用都能读到。
// 任何不一致都抛错，整次迁移回滚；不修改 updated_at。SQL 无法计算 SHA-256，因此用代码钩子。
import type {DatabaseSync} from 'node:sqlite';
import {promptRecordId,swapKey} from '../lib/reader-prompt-store.ts';
import type {Document} from '../lib/reader-model.ts';
import type {PromptRecord} from '../lib/reader-prompt-records.ts';

export const promptRecordMigration='0024_prompt_records.sql';
type UsageEntry=Document['usage'][number];
const isRecord=(value:unknown):value is PromptRecord=>typeof value==='object'&&value!==null&&!Array.isArray(value);

export function migratePromptRecords(sqlite:DatabaseSync,sql:string){
 sqlite.exec(sql);
 const inline="json_valid(document) AND json_type(document,'$.usage')='array' AND EXISTS(SELECT 1 FROM json_each(document,'$.usage') u WHERE json_type(u.value,'$.promptRecord')='object')";
 // 先取 id 再逐篇读写，避免边遍历边改同一张表；一次只解析一篇文档。
 const ids=(sqlite.prepare(`SELECT id FROM stories WHERE ${inline}`).all() as {id:string}[]).map(row=>row.id);
 const read=sqlite.prepare('SELECT document FROM stories WHERE id=?'),update=sqlite.prepare('UPDATE stories SET document=? WHERE id=?');
 const insert=sqlite.prepare('INSERT INTO prompt_records(id,record) VALUES(?,?) ON CONFLICT(id) DO NOTHING'),load=sqlite.prepare('SELECT record FROM prompt_records WHERE id=?');
 for(const id of ids){
  const original=JSON.parse((read.get(id) as {document:string}).document) as Document;
  const usage=original.usage.map(entry=>{
   if(!isRecord(entry?.promptRecord))return entry;
   const key=promptRecordId(entry.promptRecord);insert.run(key,JSON.stringify(entry.promptRecord));
   return swapKey(entry,'promptRecord','promptRecordId',key);
  });
  update.run(JSON.stringify({...original,usage}),id);
  const saved=JSON.parse((read.get(id) as {document:string}).document) as Document;
  const restored=saved.usage.map((entry:UsageEntry)=>{
   if(!entry?.promptRecordId||entry.promptRecord)return entry;
   const row=load.get(entry.promptRecordId) as {record:string}|undefined;
   if(!row)throw Error('PROMPT_RECORD_MIGRATION_MISSING');
   return swapKey(entry,'promptRecordId','promptRecord',JSON.parse(row.record));
  });
  if(JSON.stringify({...saved,usage:restored})!==JSON.stringify(original))throw Error('PROMPT_RECORD_MIGRATION_MISMATCH');
 }
 const remaining=sqlite.prepare(`SELECT COUNT(*) AS n FROM stories WHERE ${inline}`).get() as {n:number};
 const dangling=sqlite.prepare(`SELECT COUNT(*) AS n FROM stories s,json_each(s.document,'$.usage') u WHERE json_valid(s.document) AND json_type(s.document,'$.usage')='array'
  AND json_type(u.value,'$.promptRecordId')='text' AND NOT EXISTS(SELECT 1 FROM prompt_records p WHERE p.id=u.value->>'$.promptRecordId')`).get() as {n:number};
 if(remaining.n||dangling.n)throw Error('PROMPT_RECORD_MIGRATION_INCOMPLETE');
}
