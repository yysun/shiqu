// Shelf observations must explain live work without starting or renewing generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {shelfDrawingCount,shelfGenerationStatus,shelfNeedsUserGroups,shelfProductionPriority,sortShelfProductions} from '../lib/shelf-generation.ts';
import {observeStoryGeneration,runQueuedStoryGeneration} from '../lib/reader-production-client.ts';
import {productionFixture,until,turn,selection} from './fixtures/production.mjs';

const base={state:'idle',error:null,awaitingFrameCount:false,stage:'正在编排故事'};
test('shelf actions distinguish execution, queueing, user decisions, failure and pause',()=>{
 const cases=[
  [{productionState:'running'},'正在编排故事','查看进度'],
  [{productionState:'queued',state:'running'},'等待生成','查看进度'],
  [{generationMode:'background',generationControl:'active'},'等待生成','查看进度'],
  [{generationMode:'background',awaitingFrameCount:true},'等待选择画幅数','选择画幅数'],
  [{productionState:'paused',state:'running'},'已暂停 · 编排故事','查看详情'],
  [{awaitingFrameCount:true,productionState:'paused'},'等待选择画幅数','选择画幅数'],
  [{state:'failed',error:'服务暂时不可用'},'生成失败','查看详情'],
  [{state:'running'},'正在编排故事','查看进度'],
  [{state:'failed',productionState:'running',error:'编排超时'},'生成失败','查看详情'],
  [{state:'completed'},'故事已完整展开','开始阅读'],
  [{},'已暂停 · 编排故事','查看详情'],
  [{generationControl:'paused',productionState:'running'},'已暂停 · 编排故事','查看详情'],
  [{generationControl:'stopped',state:'failed'},'已暂停 · 编排故事','查看详情'],
 ];
 for(const [fields,message,action] of cases){
  const status=shelfGenerationStatus({...base,...fields});
  assert.equal(status.message,message);assert.equal(status.action,action);
 }
 assert.equal(shelfGenerationStatus({...base,state:'failed',error:'服务暂时不可用'}).detail,'服务暂时不可用');
 assert.equal(shelfGenerationStatus({...base,state:'completed'}).group,'已完成');
 assert.equal(shelfGenerationStatus({...base,state:'idle',ready:4,story:{pages:Array(8).fill({})}}).group,'生成已暂停');
 const paused={...base,generationControl:'paused',ready:0,story:{frameCount:67}};
 assert.equal(shelfDrawingCount({...paused,stage:'正在复核全篇分镜'},'生成已暂停'),'');
 assert.equal(shelfDrawingCount({...paused,stage:'正在绘制第 1 幅'},'生成已暂停'),' · 0 / 67 幅');
});

test('shelf refresh reports running and queued work without dispatch or viewer renewal',async t=>{
 const f=await productionFixture(t),a=await f.createLegacyReader(),b=await f.createLegacyReader();
 let release,started=false;const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 // 制作 DAG 的第一项文字工作（梗概）停在模型调用里；文字池一次只运行一项，另一篇故事排队。
 f.control.beforeText=async name=>{if(name==='brief'){started=true;await gate;}};
 const initial=await f.json('sessions');assert.ok(initial.every(s=>s.productionState==='paused'));
 assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
 const viewerA=crypto.randomUUID(),viewerB=crypto.randomUUID();
 await f.demand(a,viewerA);await until(()=>started);await f.demand(b,viewerB);
 for(let i=0;i<10;i++){f.app.services.production.wake();await turn();}
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
 assert.deepEqual(f.control.dagCalls,['brief'],'only the held call has been dispatched');assert.equal(f.control.calls.length,0);
 await f.leave(a,viewerA);await f.leave(b,viewerB);release();
 await until(async()=>(await f.read(a)).productionState==='paused');
 const paused=await f.json('sessions');assert.ok(paused.every(s=>s.productionState==='paused'));
 assert.ok(paused.every(s=>s.generationProgress.startedAt===null));
 assert.equal(f.control.calls.length,0);
});

test('shelf refresh exposes choice and failure states without retrying',async t=>{
 const f=await productionFixture(t);
 // 待选故事：准备流程停在选题窗口，书架只展示，不付费。
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}}],note:''});
 const choice=(await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}})).id;
 await f.startDiscovery(choice);await f.demand(choice);await until(async()=>(await f.read(choice)).intake.phase==='choosing',20000);
 // 失败：DAG 的第一项文字工作失败，故障落在该工作上。
 f.control.beforeText=async name=>{if(name==='brief')throw Error('controlled brief failure');};
 const failed=await f.create();
 await f.demand(failed);await until(async()=>(await f.read(failed)).state==='failed',20000);
 // 与失败工作无关的文字工作先自行完成，再记录任务快照。
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}await f.app.services.production.queue.settle();
 const jobs=await f.app.services.production.queue.jobs(failed,'docker-local-owner'),dagCalls=f.control.dagCalls.length;
 const rows=await f.json('sessions');
 assert.equal(shelfGenerationStatus(rows.find(s=>s.id===choice)).group,'待选故事');
 assert.equal(shelfGenerationStatus(rows.find(s=>s.id===failed)).action,'查看详情');
 assert.equal(shelfGenerationStatus(rows.find(s=>s.id===failed)).group,'生成失败');
 for(let i=0;i<10;i++){f.app.services.production.wake();await turn();}
 assert.deepEqual(await f.app.services.production.queue.jobs(failed,'docker-local-owner'),jobs);
 assert.equal(f.control.dagCalls.length,dagCalls,'a shelf visit never retries');
 assert.equal(f.control.calls.length,0);
});

test('viewing a saved failure preserves its attempt count until an explicit retry resumes generation',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();
 let fail=true;
 f.control.beforeText=async name=>{if(name==='brief'&&fail)throw Error('controlled timeout');};
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed',20000);
 const attempts=async()=>(await f.app.services.production.queue.jobs(id,'docker-local-owner')).find(job=>job.kind==='dag'&&job.state==='failed').attempts;
 const before=await attempts();let active=true,reads=0;
 await observeStoryGeneration({sessionId:id,isActive:()=>active,onSession:s=>{assert.equal(s.state,'failed');if(++reads===3)active=false;},sleep:async()=>{},request:path=>f.json(path.replace(/^reader\//,''))});
 assert.equal(await attempts(),before);assert.equal(f.control.dagCalls.filter(n=>n==='brief').length,1,'viewing a failure pays nothing');
 fail=false;f.control.hold=false;active=true;
 await runQueuedStoryGeneration({sessionId:id,viewerId:crypto.randomUUID(),initialRetry:true,page:()=>0,retries:new Map(),isActive:()=>active,sleep:turn,
  onSession:s=>{if(s.ready>0)active=false;},
  request:(path,method,body)=>f.json(path.replace(/^reader\//,''),method||'GET',body),
 });
 // 显式重试之后同一项工作重新执行，其余文字工作各自只执行一次。
 assert.ok(before>=1);assert.equal(f.control.dagCalls.filter(n=>n==='brief').length,2);
 assert.equal(f.control.dagCalls.filter(n=>n==='outline').length,1);
 assert.ok((await f.read(id)).ready>0);
});

test('production rows list user decisions and failures before running, queued and paused work, keeping order within a status',()=>{
 const items=[['a','生成已暂停'],['b','生成中'],['c','待选故事'],['d','生成已暂停'],['e','生成失败'],['f','等待生成'],['g','待选画幅数'],['h','未知状态']];
 const sorted=sortShelfProductions(items,([,group])=>group).map(([id])=>id);
 assert.deepEqual(sorted,['c','g','e','b','f','a','d','h']);
 assert.deepEqual(items.map(([id])=>id),['a','b','c','d','e','f','g','h'],'The input order is not mutated');
 for(const group of shelfNeedsUserGroups)assert.ok(shelfProductionPriority(group)<shelfProductionPriority('生成中'));
});

test('a saved revision shows 已保存，等待继续 with a 继续制作 action until it is continued',async()=>{
 const {shelfGenerationStatus}=await import('../lib/shelf-generation.ts');
 const waiting=shelfGenerationStatus({id:'s',state:'idle',awaitingContinue:true,generationControl:'active',selection:{},stage:'',error:null,retryAllowed:false});
 assert.equal(waiting.message,'已保存，等待继续');assert.equal(waiting.action,'继续制作');
 assert.notEqual(shelfGenerationStatus({id:'s',state:'completed',awaitingContinue:true,selection:{},stage:'',error:null,retryAllowed:false}).message,'已保存，等待继续');
});
