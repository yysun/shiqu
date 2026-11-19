// 提示词记录按内容存放在 prompt_records 表，故事文档的调用记录只保留 promptRecordId 引用。
// 写入点在序列化前存记录并替换引用，读取点按引用批量还原；仍内嵌的旧记录照常可读。
// 引用与内嵌互换保持键的位置，还原后的文档与迁移前结构相同（跨书库复制的内容哈希依赖这一点）。
import {createHash} from 'node:crypto';
import type {Document} from './reader-model.ts';
import type {PromptRecord} from './reader-prompt-records.ts';
export {usageRecord} from './reader-prompt-records.ts';
import type {Database} from './reader-repository.ts';

type UsageEntry=Document['usage'][number];

// 记录 id 是记录 JSON 文本的 SHA-256；相同内容只存一份。
export function promptRecordId(record:PromptRecord){return createHash('sha256').update(JSON.stringify(record)).digest('hex');}

// 原位替换键，保持其余键的顺序。
export function swapKey(entry:UsageEntry,from:'promptRecord'|'promptRecordId',to:'promptRecord'|'promptRecordId',value:unknown):UsageEntry{
 return Object.fromEntries(Object.entries(entry).map(([key,current])=>key===from?[to,value]:[key,current])) as UsageEntry;
}

export async function storePromptRecord(db:Database,record:PromptRecord){
 const id=promptRecordId(record);
 await db.prepare('INSERT INTO prompt_records(id,record) VALUES(?,?) ON CONFLICT(id) DO NOTHING').bind(id,JSON.stringify(record)).run();
 return id;
}

// 返回把内嵌记录换成引用的副本；没有内嵌记录时原样返回。
export async function storePromptRecords(db:Database,doc:Document):Promise<Document>{
 if(!doc.usage?.some(entry=>entry?.promptRecord))return doc;
 const usage:UsageEntry[]=[];
 for(const entry of doc.usage)usage.push(entry?.promptRecord?swapKey(entry,'promptRecord','promptRecordId',await storePromptRecord(db,entry.promptRecord)):entry);
 return {...doc,usage};
}

export async function loadPromptRecords(db:Database,usage:Document['usage']|undefined){
 const ids=[...new Set((usage||[]).flatMap(entry=>!entry?.promptRecord&&entry?.promptRecordId?[entry.promptRecordId]:[]))];
 const records=new Map<string,PromptRecord>();
 if(!ids.length)return records;
 const rows=(await db.prepare('SELECT id,record FROM prompt_records WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{id:string;record:string}>()).results;
 for(const row of rows)records.set(row.id,JSON.parse(row.record) as PromptRecord);
 return records;
}

// 返回把可读到的引用原位还原为内嵌记录的副本；缺失的引用保持原样。
export async function resolvePromptRecords(db:Database,doc:Document):Promise<Document>{
 const records=await loadPromptRecords(db,doc.usage);
 if(!records.size)return doc;
 return {...doc,usage:doc.usage.map(entry=>!entry?.promptRecord&&entry?.promptRecordId&&records.has(entry.promptRecordId)?swapKey(entry,'promptRecordId','promptRecord',records.get(entry.promptRecordId)):entry)};
}
