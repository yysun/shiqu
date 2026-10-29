// Shelf observations must explain live work without starting or renewing generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {shelfGenerationStatus} from '../lib/shelf-generation.ts';
import {productionFixture,until} from './fixtures/production.mjs';

const base={state:'idle',error:null,awaitingFrameCount:false,stage:'正在编排故事'};
test('shelf actions distinguish execution, queueing, user decisions, failure and pause',()=>{
 const cases=[
  [{productionState:'running'},'正在编排故事','查看进度'],
  [{productionState:'queued',state:'running'},'等待生成','查看进度'],
  [{productionState:'paused',state:'running'},'生成已暂停','继续生成'],
  [{awaitingFrameCount:true,productionState:'paused'},'等待选择画幅数','选择画幅数'],
  [{state:'failed',error:'服务暂时不可用'},'生成失败','重试生成'],
  [{state:'running'},'正在编排故事','查看进度'],
  [{state:'completed'},'故事已完整展开','开始阅读'],
  [{},'生成已暂停','继续生成'],
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
 const f=await productionFixture(t),a=await f.create(),b=await f.create();
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
 }
 assert.deepEqual(await f.app.services.database.prepare('SELECT * FROM production_demand ORDER BY session_id').all(),before);
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 await f.leave(a,viewerA);await f.leave(b,viewerB);release();
 await until(async()=>(await f.read(a)).productionState==='paused');
 const paused=await f.json('sessions');assert.ok(paused.every(s=>s.productionState==='paused'));
 assert.equal(f.control.calls.length,0);
});

test('shelf refresh exposes choice and failure states without retrying',async t=>{
 const f=await productionFixture(t),choice=await f.create('auto',{narrativeDetail:'balanced'});
 await f.demand(choice);await until(async()=>(await f.read(choice)).awaitingFrameCount);
 const failed=await f.create(),generator=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>({...generator(),async plan(){throw Error('controlled plan failure');}});
 await f.demand(failed);await until(async()=>(await f.read(failed)).state==='failed');
 const jobs=await f.app.services.production.queue.jobs(failed,'docker-local-owner');
 const rows=await f.json('sessions');
 assert.equal(shelfGenerationStatus(rows.find(s=>s.id===choice)).action,'选择画幅数');
 assert.equal(shelfGenerationStatus(rows.find(s=>s.id===failed)).action,'重试生成');
 assert.deepEqual(await f.app.services.production.queue.jobs(failed,'docker-local-owner'),jobs);
 assert.equal(f.control.calls.length,0);
});
