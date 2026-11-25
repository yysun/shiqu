// Exercise durable checkpoints, immediate automatic recovery, and paid-call safeguards against SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {suggestStories} from '../lib/reader-gemini.ts';
const selection={bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'放下执念',length:8,voice:false};
import {migrate,transaction} from '../server/database.ts';
function setup(){const db=new DatabaseSync(':memory:');migrate(db,process.cwd());const adapter={transaction:body=>transaction(db,body),prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(query).get(...args)||null;},async all(){return {results:db.prepare(query).all(...args)};},async run(){const r=db.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}};}};return {repo:new ReaderRepository(adapter),db};}
function geminiResponse(parts,extra={}){return new Response(JSON.stringify({candidates:[{content:{parts},finishReason:'STOP',...extra}],responseId:'test-response',usageMetadata:{totalTokenCount:10}}),{headers:{'Content-Type':'application/json'}});}
test('new stories have no rolling daily cap, including concurrent starts',async()=>{
 const {repo}=setup();const rows=await Promise.all(Array.from({length:25},()=>repo.create(crypto.randomUUID(),'alice',selection)));
 assert.equal((await repo.list('alice')).length,25);
 await assert.rejects(repo.create(rows[0].id,'alice',{...selection,theme:'人情冷暖'}),e=>e.status===409);
 const retries=await Promise.all(Array.from({length:5},()=>repo.create(rows[0].id,'alice',selection)));
 assert.ok(retries.every(row=>row.id===rows[0].id&&row.selection===rows[0].selection&&row.created_at===rows[0].created_at));
 assert.equal((await repo.list('alice')).length,25);
 await assert.rejects(repo.create(rows[0].id,'bob',selection),e=>e.status===404);
 assert.equal((await repo.list('bob')).length,0);
 await repo.create(crypto.randomUUID(),'bob',selection);
 await repo.create(crypto.randomUUID(),'alice',selection);
 assert.equal((await repo.list('alice')).length,26);
});
test('book suggestions preserve selected book and custom theme; stale URL fields are ignored',async()=>{
 let body;const result=await suggestStories('unit-test-only',{...selection,customBook:'https://example.org/old',theme:'一个小人物的选择'},{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify({stories:[{title:'庄周梦蝶',description:'一个醒来后的疑问。'}],note:''})}]);});
 assert.equal(result.stories[0].title,'庄周梦蝶');assert.equal(body.tools,undefined);
 assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),{book:'庄子',theme:'一个小人物的选择',excludeTitles:[]});
});
test('five story choices are requested and accepted without inventing a missing source',async()=>{
 let body;const choices=Array.from({length:5},(_,i)=>({title:'已知篇目'+i,description:'一个不剧透的故事简介。'}));
 const result=await suggestStories('unit-test-only',selection,{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify({stories:choices,note:''})}]);});
 assert.equal(result.stories.length,5);
 assert.equal(body.generationConfig.responseFormat.text.schema.properties.stories.maxItems,undefined);
 assert.match(body.generationConfig.responseFormat.text.schema.properties.stories.description,/At most 5 items/);
 assert.match(body.systemInstruction.parts[0].text,/未提供时至多5篇/);
 assert.match(body.systemInstruction.parts[0].text,/为1时只寻找一篇，找到即返回/);
 const unknown=await suggestStories('unit-test-only',selection,{},async()=>geminiResponse([{text:JSON.stringify({stories:[],note:'请补充原文。'})}]));
 assert.equal(unknown.stories.length,0);
});

test('new batches pass exclusions to Gemini and remove repeated or renamed titles',async()=>{
 let body;const result=await suggestStories('unit-test-only',selection,{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify({stories:[{title:'《庄周梦蝶》',description:'已看过。'},{title:'庖丁解牛',description:'新篇目。'},{title:'庖丁解牛',description:'重复。'}],note:''})}]);},['庄周梦蝶']);
 assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).excludeTitles,['庄周梦蝶']);
 assert.deepEqual(result.stories.map(s=>s.title),['庖丁解牛']);
 assert.ok(result.note);
});

test('unknown retired identities cannot enter current reader library actions',async()=>{
 const {repo}=setup();
 for(const owner of ['alice','bob']){
  await assert.rejects(repo.remove('shared',owner),e=>e.status===404);
  await assert.rejects(repo.restore('shared',owner),e=>e.status===404);
  await assert.rejects(repo.favorite('shared',owner,true),e=>e.status===404);
  assert.deepEqual(await repo.list(owner),[]);assert.deepEqual(await repo.deletions(owner),[]);
 }
});
test('restoring a current story leaves the other owner’s deletion markers untouched',async()=>{
 const {repo}=setup(),alice=crypto.randomUUID(),bob=crypto.randomUUID();
 await repo.create(alice,'alice',selection);await repo.create(bob,'bob',selection);
 await repo.remove(alice,'alice');await repo.remove(bob,'bob');await repo.restore(alice,'alice');
 assert.equal((await repo.deletions('alice')).length,0);assert.equal((await repo.deletions('bob'))[0].storyId,bob);
 await assert.rejects(repo.restore(bob,'alice'),e=>e.status===404);
 assert.equal((await repo.deletions('bob')).length,1);
});

// Follow preparation through real SQLite, including edits made while art inference is running.
