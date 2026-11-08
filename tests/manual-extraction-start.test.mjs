// 验证显式提取条件随创建启动，旧调用和替换草稿仍可等待手动提取。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,selection,turn} from './fixtures/production.mjs';
import {observeStoryGeneration} from '../lib/reader-production-client.ts';

test('creation without extraction conditions stays idle through demand and restart until a search command',async t=>{
 const f=await productionFixture(t);let calls=0;
 f.generation.suggestions=async()=>{calls++;return {stories:[{title:'庄周梦蝶',description:'一次梦与醒的经历。'}],note:''};};
 const body={requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined}};
 const created=await f.json('sessions','POST',body);
 assert.equal(created.intake.phase,'choosing');assert.equal(created.intake.search.state,'idle');assert.deepEqual(created.intake.batches,[]);
 for(let i=0;i<3;i++){await f.demand(created.id);await f.app.services.production.tick();}
 assert.equal(calls,0);assert.equal((await f.app.services.production.queue.jobs(created.id,'docker-local-owner')).filter(job=>job.kind==='discover').length,0);
 assert.equal((await f.json('sessions','POST',body)).id,created.id);
 await f.restart();await f.demand(created.id);await f.app.services.production.tick();
 let saved=await f.read(created.id);assert.equal(saved.intake.search.state,'idle');assert.equal(calls,0);
 let active=true;const requests=[];let snapshots=0;
 await observeStoryGeneration({sessionId:created.id,focus:{viewerId:crypto.randomUUID(),page:()=>0},watchChoices:true,isActive:()=>active,sleep:turn,onSession:()=>{if(++snapshots===3)active=false;},request:(path,method='GET',body)=>{requests.push({path,method});return f.json(path.replace(/^reader\//,''),method,body);}});
 assert.ok(requests.every(request=>request.method==='GET'));assert.equal(calls,0);
 const command={requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'search',title:''};
 await f.json(`sessions/${created.id}/setup`,'POST',command);await f.demand(created.id);await until(async()=>(await f.read(created.id)).intake.search.state==='idle');
 saved=await f.read(created.id);assert.equal(calls,1);assert.equal(saved.intake.batches[0].stories[0].title,'庄周梦蝶');
 await f.json(`sessions/${created.id}/setup`,'POST',command);assert.equal(calls,1);
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('creating with extraction conditions starts one discovery round across replay and restart',async t=>{
 const f=await productionFixture(t);let calls=0;
 f.generation.suggestions=async()=>{calls++;return {stories:[{title:'庄周梦蝶',description:'一次梦与醒的经历。'}],note:''};};
 const body={requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,discovery:{mode:'auto'}}};
 const created=await f.json('sessions','POST',body);
 assert.equal(created.intake.phase,'discovering');assert.equal(created.intake.search.state,'searching');
 assert.equal((await f.json('sessions','POST',body)).id,created.id);
 await f.demand(created.id);await until(async()=>(await f.read(created.id)).intake.search.state==='idle');
 await f.restart();await f.demand(created.id);await f.app.services.production.tick();
 const saved=await f.read(created.id);
 assert.deepEqual(saved.selection.discovery,body.selection.discovery);
 assert.deepEqual(saved.intake.batches.flatMap(batch=>batch.stories.map(story=>story.title)),['庄周梦蝶']);
 assert.equal(calls,1);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('opening and cancelling a replacement draft does not extract or change the original',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const parentId=await f.create(2);await until(async()=>(await f.read(parentId)).state==='completed');
 const before=await f.read(parentId);let calls=0;
 f.generation.suggestions=async current=>{calls++;return {stories:[{title:current.discovery?.mode==='title'?current.discovery.title:'自动候选',description:'完整原典事件。'}],note:''};};
 const draft=await f.json(`sessions/${parentId}/reselection`,'POST',{requestId:crypto.randomUUID()});
 for(let i=0;i<3;i++){await f.demand(draft.id);await f.app.services.production.tick();}
 assert.equal(calls,0);assert.equal((await f.read(draft.id)).intake.search.state,'idle');
 await f.json(`sessions/${draft.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:draft.intake.generation,action:'search',title:'庄子的大葫芦'});
 await f.demand(draft.id);await until(async()=>(await f.read(draft.id)).intake.search.state==='idle');
 assert.equal(calls,1);assert.equal((await f.read(draft.id)).intake.batches[0].stories[0].title,'庄子的大葫芦');
 await f.json(`sessions/${parentId}/reselection/${draft.id}`,'DELETE');assert.deepEqual((await f.read(parentId)).story,before.story);
});
