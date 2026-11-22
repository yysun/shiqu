// Exercise publication persistence through REST, real SQLite, concurrent workers and revision forks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {confirmedStory} from './fixtures/production-dag-story.mjs';
import {emptyPublication,publicationSchema,storyExportKey,publicationCredit} from '../lib/story-publication.ts';
import {makeStory} from './fixtures/story.mjs';

const publication={author:'公开制作人',workUrl:'https://example.org/work',contact:'contact@example.org',sourceNote:'原文转录 CC BY-SA 4.0，保留来源。',reuse:'本次受保护贡献的商用请联系制作人。'};
const save=(f,id,value=publication,expected=null)=>f.json(`sessions/${id}/publication`,'POST',{publication:value,expected});
const row=(f,id)=>f.app.services.database.prepare('SELECT * FROM stories WHERE id=?').bind(id).first();

test('metadata survives running work, restart and revision inheritance without extra generation or leaking into prompts',async t=>{
 const f=await productionFixture(t,'codex');
 const payloads=[];f.control.beforeText=async(_name,payload)=>{payloads.push(JSON.stringify(payload));};
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 // 文字制作完成、绘图进行中保存署名：不改选择，不新增任务与调用。
 await until(()=>f.control.calls.length>0,20000);
 const before=await row(f,id),jobs=await f.app.services.database.prepare('SELECT * FROM production_jobs').all();
 const calls=[f.control.calls.length,f.control.dagCalls.length,f.control.reviews.length];
 assert.equal((await f.read(id)).story.publication,undefined);
 assert.deepEqual((await save(f,id)).story.publication,publication);
 assert.deepEqual(JSON.parse((await row(f,id)).selection),JSON.parse(before.selection));
 assert.deepEqual(await f.app.services.database.prepare('SELECT * FROM production_jobs').all(),jobs);
 assert.deepEqual([f.control.calls.length,f.control.dagCalls.length,f.control.reviews.length],calls);
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.deepEqual((await f.read(id)).story.publication,publication);
 f.generation.status=async()=>({configured:false});
 const updated={...publication,author:'修改署名'};
 await save(f,id,updated,publication);await f.restart();
 assert.deepEqual((await f.read(id)).story.publication,updated);
 assert.deepEqual((await f.json('sessions')).find(s=>s.id===id).story.publication,updated);
 f.generation.status=async()=>({configured:true});
 const drawn=f.control.calls.length,dagCalls=f.control.dagCalls.length;
 const base=await f.json(`sessions/${id}/revisions`);
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{artStyle:'paper-cut'},paused:true});
 assert.deepEqual(JSON.parse((await row(f,child.id)).document).publication,updated);
 assert.equal(f.control.calls.length,drawn);assert.equal(f.control.dagCalls.length,dagCalls);
 assert.equal((await f.request(`sessions/${id}/publication`,'POST',{publication,expected:updated})).status,409);
 f.control.hold=false;const fresh=await f.create(2);await until(async()=>(await f.read(fresh)).state==='completed',20000);
 assert.equal((await f.read(fresh)).story.publication,undefined);
 for(const payload of payloads)assert.ok(!payload.includes(publication.contact));
});

test('stale, invalid, cross-origin, other-owner and deleted writes leave saved metadata intact',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 const id=await f.create(2);await until(async()=>(await f.read(id)).state==='completed');
 await save(f,id);const before=await row(f,id);
 assert.equal((await f.request(`sessions/${id}/publication`,'POST',{publication:{...publication,author:'过期覆盖'},expected:null})).status,409);
 for(const value of [{...publication,author:'a\nb'},{...publication,author:'字'.repeat(81)},{...publication,workUrl:'javascript:alert(1)'},{...publication,workUrl:'https://user:pass@example.org'},{...publication,reuse:'字'.repeat(1201)},{...publication,unknown:true}]){
  assert.equal((await f.request(`sessions/${id}/publication`,'POST',{publication:value,expected:publication})).status,400);
 }
 assert.equal((await f.request(`sessions/${id}/publication`,'POST',{publication,expected:publication},{origin:'https://other.example'})).status,403);
 assert.deepEqual(await row(f,id),before);
 await f.app.services.database.prepare('UPDATE stories SET user_id=? WHERE id=?').bind('other-owner',id).run();
 assert.equal((await f.request(`sessions/${id}/publication`,'POST',{publication,expected:publication})).status,404);
 await f.app.services.database.prepare('UPDATE stories SET user_id=? WHERE id=?').bind('docker-local-owner',id).run();
 await f.json(`library/${id}`,'DELETE');
 assert.equal((await f.request(`sessions/${id}/publication`,'POST',{publication,expected:publication})).status,404);
});

test('export identity changes with content/metadata and missing credits never impersonate the platform',()=>{
 const story=makeStory(1),key=storyExportKey(story);
 assert.notEqual(storyExportKey({...story,publication}),key);
 assert.notEqual(storyExportKey({...story,pages:[{...story.pages[0],caption:'改过旁白'}]}),key);
 assert.match(publicationCredit(story),/制作：未署名/);
 assert.equal(publicationSchema.parse(emptyPublication).author,'');
});
