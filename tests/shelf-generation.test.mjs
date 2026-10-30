// Shelf observations must explain live work without starting or renewing generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {shelfGenerationStatus} from '../lib/shelf-generation.ts';
import {observeStoryGeneration,runQueuedStoryGeneration} from '../lib/reader-production-client.ts';
import {productionFixture,until,turn} from './fixtures/production.mjs';

const base={state:'idle',error:null,awaitingFrameCount:false,stage:'正在编排故事'};
test('shelf actions distinguish execution, queueing, user decisions, failure and pause',()=>{
 const cases=[
  [{productionState:'running'},'正在编排故事','查看进度'],
  [{productionState:'queued',state:'running'},'等待生成','查看进度'],
  [{productionState:'paused',state:'running'},'生成已暂停','查看详情'],
  [{awaitingFrameCount:true,productionState:'paused'},'等待选择画幅数','选择画幅数'],
  [{state:'failed',error:'服务暂时不可用'},'生成失败','查看详情'],
  [{state:'running'},'正在编排故事','查看进度'],
  [{state:'failed',productionState:'running',error:'编排超时'},'生成失败','查看详情'],
  [{state:'completed'},'故事已完整展开','开始阅读'],
  [{},'生成已暂停','查看详情'],
  [{generationControl:'paused',productionState:'running'},'生成已暂停','查看详情'],
  [{generationControl:'stopped',state:'failed'},'生成已暂停','查看详情'],
 ];
 for(const [fields,message,action] of cases){
  const status=shelfGenerationStatus({...base,...fields});
  assert.equal(status.message,message);assert.equal(status.action,action);
 }
 assert.equal(shelfGenerationStatus({...base,state:'failed',error:'服务暂时不可用'}).detail,'服务暂时不可用');
 assert.equal(shelfGenerationStatus({...base,state:'completed'}).group,'已完成');
 assert.equal(shelfGenerationStatus({...base,state:'idle',ready:4,story:{pages:Array(8).fill({})}}).group,'生成已暂停');
});

test('shelf refresh reports running and queued work without dispatch or viewer renewal',async t=>{
 const f=await productionFixture(t),a=await f.createLegacyReader(),b=await f.createLegacyReader();
 let release,started=false;const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 const generator=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>{const g=generator();return {...g,async plan(...args){if(args[1]===a){started=true;await gate;}return g.plan(...args);}};};
 const initial=await f.json('sessions');assert.ok(initial.every(s=>s.productionState==='paused'));
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 const viewerA=crypto.randomUUID(),viewerB=crypto.randomUUID();
 await f.demand(a,viewerA);await until(()=>started);await f.demand(b,viewerB);
 const before=await f.app.services.database.prepare('SELECT * FROM production_demand ORDER BY session_id').all();
 const first=await f.json('sessions'),second=await f.json('sessions');
 for(const rows of [first,second]){
  assert.equal(rows.find(s=>s.id===a).productionState,'running');
  assert.equal(rows.find(s=>s.id===b).productionState,'queued');
  const running=rows.find(s=>s.id===a).generationProgress,queued=rows.find(s=>s.id===b).generationProgress;
  const job=(await f.app.services.production.queue.jobs(a,'docker-local-owner')).find(job=>job.state==='running');
  assert.equal(running.startedAt,job.updated_at);assert.equal(running.attempt,job.attempts);
  assert.equal(running.phase,'plan');assert.equal(running.frameCount,8);assert.equal(queued.startedAt,null);
 }
 assert.deepEqual(await f.app.services.database.prepare('SELECT * FROM production_demand ORDER BY session_id').all(),before);
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 await f.leave(a,viewerA);await f.leave(b,viewerB);release();
 await until(async()=>(await f.read(a)).productionState==='paused');
 const paused=await f.json('sessions');assert.ok(paused.every(s=>s.productionState==='paused'));
 assert.ok(paused.every(s=>s.generationProgress.startedAt===null));
 assert.equal(f.control.calls.length,0);
});

test('shelf refresh exposes choice and failure states without retrying',async t=>{
 const f=await productionFixture(t),choice=await f.createLegacyReader('auto',{narrativeDetail:'balanced'});
 await f.demand(choice);await until(async()=>(await f.read(choice)).awaitingFrameCount);
 const failed=await f.createLegacyReader(),generator=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>({...generator(),async plan(){throw Error('controlled plan failure');}});
 await f.demand(failed);await until(async()=>(await f.read(failed)).state==='failed');
 const jobs=await f.app.services.production.queue.jobs(failed,'docker-local-owner');
 const rows=await f.json('sessions');
 assert.equal(shelfGenerationStatus(rows.find(s=>s.id===choice)).action,'选择画幅数');
 assert.equal(shelfGenerationStatus(rows.find(s=>s.id===failed)).action,'查看详情');
 assert.deepEqual(await f.app.services.production.queue.jobs(failed,'docker-local-owner'),jobs);
 assert.equal(f.control.calls.length,0);
});

test('viewing a saved failure preserves its attempt count until an explicit retry resumes generation',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(),generator=f.generation.generator.bind(f.generation);
 let fail=true;
 f.generation.generator=()=>{const g=generator();return {...g,async plan(...args){if(fail)throw Error('controlled timeout');return g.plan(...args);}};};
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 const attempts=async()=>(await f.app.services.production.queue.jobs(id,'docker-local-owner')).find(job=>job.kind==='script').attempts;
 const before=await attempts();let active=true,reads=0;
 await observeStoryGeneration({sessionId:id,isActive:()=>active,onSession:s=>{assert.equal(s.state,'failed');if(++reads===3)active=false;},sleep:async()=>{},request:path=>f.json(path.replace(/^reader\//,''))});
 assert.equal(await attempts(),before);assert.equal(f.control.plans.length,0);
 fail=false;f.control.hold=false;active=true;
 await runQueuedStoryGeneration({sessionId:id,viewerId:crypto.randomUUID(),initialRetry:true,page:()=>0,retries:new Map(),isActive:()=>active,sleep:turn,
  onSession:s=>{if(s.ready>0)active=false;},
  request:(path,method,body)=>f.json(path.replace(/^reader\//,''),method||'GET',body),
 });
 assert.equal(await attempts(),before+1);assert.equal(f.control.plans.length,1);
 assert.ok((await f.read(id)).ready>0);
});
