// 验证提示词全文移出故事文档：新写入只存引用，迁移把旧书库的内嵌记录按内容去重移出并核对，
// 提示词与审校历史接口输出在迁移前后一致；引用的记录缺失时列为缺失。使用隔离 SQLite 与受控提供方。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {productionFixture,until,selection} from './fixtures/production.mjs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {promptRecordId} from '../lib/reader-prompt-store.ts';
import {migratePromptRecords} from '../server/prompt-record-migration.ts';

const open=f=>new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
const original={title:'庄周梦蝶',text:'庄周梦为胡蝶。',url:'https://example.com',kind:'passage',provider:'fixture',retrievedAt:'2026-01-01T00:00:00.000Z'};
const plan={characters:[],pages:[{caption:'梦',prompt:'Scene 1: dream'}]};
const records={
 plan:{instructions:'系统制作规则',input:JSON.stringify({plan:{pages:[{caption:'梦'}]}}),schema:{type:'object'}},
 review:{instructions:'系统验收规则',input:JSON.stringify({plan:{pages:[{caption:'梦'}]},verifiedOriginal:{text:'庄周'}})},
 image:{instructions:'',input:'Scene 1: dream',reference:'/api/reader/media/x/0.png'},
};
const entry=(step,record,extra={})=>({step,model:'fixture',requestId:'request',usage:{tokens:1},...(record?{promptRecord:record}:{}),...extra});

test('制作流程保存的文档只含提示词引用，全文按内容只存一份并可通过接口读取',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 const id=await f.create();await until(async()=>(await f.read(id)).state==='completed');
 const db=open(f);t.after(()=>db.close());
 const doc=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(id).document);
 assert.ok(doc.usage.length>0);
 assert.ok(doc.usage.every(item=>!('promptRecord' in item)),'文档不再内嵌提示词全文');
 const ids=doc.usage.flatMap(item=>item.promptRecordId?[item.promptRecordId]:[]);
 assert.ok(ids.length>0);
 const stored=new Map(db.prepare('SELECT id,record FROM prompt_records').all().map(row=>[row.id,JSON.parse(row.record)]));
 for(const key of ids){assert.ok(stored.has(key));assert.equal(promptRecordId(stored.get(key)),key,'记录 id 为内容哈希');}
 const history=await f.json(`sessions/${id}/prompts`);
 assert.equal(history.records.length,ids.length);assert.equal(history.missingRecords.length,doc.usage.length-ids.length);
 for(const item of history.records)assert.deepEqual(item.record,stored.get(doc.usage[item.index].promptRecordId));
});

async function legacyLibrary(t){
 const f=await productionFixture(t);f.app.stopGeneration();await f.app.services.production.close();
 const repo=new ReaderRepository(f.app.services.database),owner=f.app.services.ownerId,ids={parent:crypto.randomUUID(),child:crypto.randomUUID(),plain:crypto.randomUUID(),broken:crypto.randomUUID()};
 for(const id of Object.values(ids))await repo.create(id,owner,selection);
 const legacy={
  parent:{plan,original,images:[''],audio:[],usage:[entry('plan',records.plan),entry('summary',null),entry('review:0',records.review,{reasoningEffort:'high'}),entry('image:0',records.image)]},
  child:{plan,original,images:[''],audio:[],usage:[entry('plan',records.plan,{originId:ids.parent}),entry('review:0',records.review,{originId:ids.parent}),entry('review:1',records.review)]},
  // 非对象项（例如字符串）不得阻止迁移，原样保留。
  plain:{plan,original,images:[''],audio:[],usage:[entry('plan',null),'legacy-text']},
 };
 const db=open(f);t.after(()=>db.close());
 // 直接写库，模拟旧版应用写入的内嵌记录；不经过写入点。
 for(const [key,doc] of Object.entries(legacy))db.prepare("UPDATE stories SET document=?,updated_at='2026-01-02T00:00:00.000Z' WHERE id=?").run(JSON.stringify(doc),ids[key]);
 db.prepare("UPDATE stories SET document='invalid',updated_at='2026-01-02T00:00:00.000Z' WHERE id=?").run(ids.broken);
 db.exec('DELETE FROM prompt_records');
 return {f,db,ids,legacy};
}
const snapshot=async(f,ids)=>Object.fromEntries(await Promise.all(['parent','child','plain'].map(async key=>[key,{prompts:await f.json(`sessions/${ids[key]}/prompts`),review:await f.json(`sessions/${ids[key]}/review-history`)}])));
const counts=db=>({commands:db.prepare('SELECT COUNT(*) AS n FROM reader_commands').get().n,faults:db.prepare(`SELECT COUNT(*) AS n FROM ${db.prepare("SELECT 1 FROM sqlite_schema WHERE name='production_faults'").get()?'production_faults':'reader_faults'}`).get().n});

test('迁移按内容去重移出内嵌记录，接口输出、更新时间和触发器写入的行都不变',async t=>{
 const {f,db,ids,legacy}=await legacyLibrary(t);
 const before=await snapshot(f,ids),beforeCounts=counts(db);
 assert.equal(before.parent.prompts.records.length,3,'迁移前内嵌记录可读');
 db.exec('BEGIN IMMEDIATE');migratePromptRecords(db,'');db.exec('COMMIT');
 const rows=db.prepare('SELECT id,document,updated_at FROM stories').all(),byId=new Map(rows.map(row=>[row.id,row]));
 for(const key of ['parent','child','plain']){
  const doc=JSON.parse(byId.get(ids[key]).document);
  assert.ok(doc.usage.every(item=>typeof item!=='object'||!('promptRecord' in item)));
  assert.deepEqual(doc.usage.map(Object.keys),legacy[key].usage.map(item=>Object.keys(item).map(name=>name==='promptRecord'?'promptRecordId':name)),'引用替换在原位');
  assert.equal(byId.get(ids[key]).updated_at,'2026-01-02T00:00:00.000Z');
 }
 assert.equal(byId.get(ids.broken).document,'invalid');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prompt_records').get().n,3,'相同记录只存一份');
 assert.deepEqual(counts(db),beforeCounts);
 assert.deepEqual(await snapshot(f,ids),before);
});

test('迁移核对失败时整次回滚',async t=>{
 const {db,ids}=await legacyLibrary(t);
 const before=db.prepare('SELECT id,document FROM stories ORDER BY id').all();
 // 人为让写入的记录丢失，核对必然失败。
 db.exec('CREATE TEMP TRIGGER sabotage AFTER INSERT ON main.prompt_records BEGIN DELETE FROM main.prompt_records WHERE id=NEW.id; END');
 db.exec('BEGIN IMMEDIATE');
 assert.throws(()=>migratePromptRecords(db,''),/PROMPT_RECORD_MIGRATION/);
 db.exec('ROLLBACK');db.exec('DROP TRIGGER sabotage');
 assert.deepEqual(db.prepare('SELECT id,document FROM stories ORDER BY id').all(),before);
 assert.ok(JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(ids.parent).document).usage[0].promptRecord);
});

test('引用的记录行缺失时列为缺失项，内嵌与引用混合的文档照常输出',async t=>{
 const {f,db,ids}=await legacyLibrary(t);
 db.exec('BEGIN IMMEDIATE');migratePromptRecords(db,'');db.exec('COMMIT');
 const doc=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(ids.child).document);
 doc.usage.push(entry('review:2',{instructions:'内嵌',input:'{}'}));
 db.prepare('UPDATE stories SET document=? WHERE id=?').run(JSON.stringify(doc),ids.child);
 db.prepare('DELETE FROM prompt_records WHERE id=?').run(promptRecordId(records.plan));
 const history=await f.json(`sessions/${ids.child}/prompts`);
 assert.deepEqual(history.missingRecords.map(item=>item.index),[0]);
 assert.deepEqual(history.records.map(item=>item.index),[1,2,3]);
 assert.equal(history.records.at(-1).record.instructions,'内嵌');
});
