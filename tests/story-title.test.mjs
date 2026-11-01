// Exercise independent naming through REST, SQLite and a generation checkpoint saved after the rename.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {readLibrarySummary} from '../desktop/library-preview.ts';

const owner='docker-local-owner';
const row=(f,id)=>f.app.services.database.prepare('SELECT * FROM reader_sessions WHERE id=?').bind(id).first();
const rename=(f,id,title)=>f.json(`sessions/${id}/title`,'POST',{title});

test('renaming persists across restart without changing source, script, media, progress, versions or jobs; no provider required',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 const id=await f.create();await until(async()=>(await f.read(id)).state==='completed');
 await f.json(`sessions/${id}/progress`,'POST',{page:3,saved:true});
 const before=await row(f,id),jobs=await f.app.services.database.prepare('SELECT * FROM production_jobs').all();
 const calls=[f.control.calls.length,f.control.plans.length,f.control.reviews.length];
 f.generation.status=async()=>({configured:false});
 const saved=await rename(f,id,'  梦蝶新名  '),after=await row(f,id);
 assert.equal(saved.id,id);assert.equal(saved.story.title,'梦蝶新名');assert.equal(saved.page,3);assert.equal(saved.saved,true);
 assert.equal(after.document,before.document);assert.equal(after.state,before.state);assert.equal(after.step_key,before.step_key);
 assert.equal(after.last_read_at,before.last_read_at);assert.equal(after.generation_control,before.generation_control);
 assert.deepEqual(JSON.parse(after.selection),{...JSON.parse(before.selection),displayTitle:'梦蝶新名'});
 assert.equal((await f.json('sessions')).find(s=>s.id===id).story.title,'梦蝶新名');
 assert.equal(readLibrarySummary(f.dataDirectory).stories.find(s=>s.id===id).title,'梦蝶新名');
 assert.deepEqual(await f.app.services.database.prepare('SELECT * FROM production_jobs').all(),jobs);
 assert.deepEqual([f.control.calls.length,f.control.plans.length,f.control.reviews.length],calls);
 await f.json(`library/${id}`,'DELETE');
 assert.equal((await f.json('deletions')).find(s=>s.storyId===id).title,'梦蝶新名');
 assert.equal((await f.request(`sessions/${id}/title`,'POST',{title:'隐藏故事'})).status,404);
 await f.json(`library/${id}/restore`,'POST',{});
 await f.restart();assert.equal((await f.read(id)).story.title,'梦蝶新名');
 assert.equal((await f.json('sessions')).length,1);
});

test('a running image checkpoint cannot revert the name; later revisions inherit it while fresh stories do not',async t=>{
 const f=await productionFixture(t),id=await f.create();await until(()=>f.control.calls.length>0);
 await rename(f,id,'独立保存的名字');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>(await f.read(id)).state==='completed');
 assert.equal((await f.read(id)).story.title,'独立保存的名字');
 const base=await f.json(`sessions/${id}/revisions`);
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{length:3}});
 await until(async()=>(await f.read(child.id)).state==='completed');
 assert.equal((await f.read(child.id)).story.title,'独立保存的名字');
 const fresh=await f.create(3,{displayTitle:'不应继承的名字'});
 await until(async()=>(await f.read(fresh)).state==='completed');
 assert.equal((await f.read(fresh)).selection.displayTitle,undefined);
 assert.notEqual((await f.read(fresh)).story.title,'不应继承的名字');
});

test('invalid, cross-origin and other-owner renames leave stored data intact',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 const id=await f.create();await until(async()=>(await f.read(id)).state==='completed');
 const before=await row(f,id);
 for(const title of ['', '   ', '名'.repeat(41), '第一行\n第二行', 123, null]){
  assert.equal((await f.request(`sessions/${id}/title`,'POST',{title})).status,400);
 }
 assert.equal((await f.request(`sessions/${id}/title`,'POST',{title:'跨站改名'},{origin:'http://other.example'})).status,403);
 assert.deepEqual(await row(f,id),before);
 await f.app.services.database.prepare('UPDATE reader_sessions SET user_id=? WHERE id=?').bind('someone-else',id).run();
 assert.equal((await f.request(`sessions/${id}/title`,'POST',{title:'不能改'})).status,404);
 await f.app.services.database.prepare('UPDATE reader_sessions SET user_id=? WHERE id=?').bind(owner,id).run();
 assert.deepEqual(await row(f,id),before);
});
