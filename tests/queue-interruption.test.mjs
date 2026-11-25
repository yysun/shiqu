// Verify that stops, scheduling errors, unreadable stories and clock jumps stay contained,
// and that automatic recovery of paid work is bounded. Controlled providers only.
// 全部走正式协调器与制作 DAG：任务为 dag（文字）与 dag-draw（绘图），故障记在 production_faults；
// 事务内的写入失败经 failTransaction 注入。旧流水线的整篇检查点、审片修订回合与发布步骤已随旧流程删除。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {productionFixture,until,selection} from './fixtures/production.mjs';
import {ReaderError} from '../lib/reader-model.ts';
import {decodeDocument} from '../lib/production-dag/document.ts';
const owner='docker-local-owner';
const production=f=>f.app.services.production;
const database=f=>f.app.services.database;
const jobs=(f,id)=>production(f).queue.jobs(id,owner);
const imageJob=async(f,id,page=0)=>(await jobs(f,id)).find(job=>job.kind==='dag-draw'&&JSON.parse(job.payload).page===page);
const textJob=async(f,id,call)=>(await jobs(f,id)).find(job=>job.kind==='dag'&&JSON.parse(job.payload).work.call===call);
const control=(f,id,action)=>f.json(`sessions/${id}/production-control`,'POST',{action});
const count=(f,name)=>f.control.dagCalls.filter(n=>n===name).length;
const completed=(f,id)=>until(async()=>(await f.read(id)).state==='completed',15000);
const sqliteError=()=>Object.assign(Error('database is locked'),{code:'ERR_SQLITE_ERROR'});
const row=(f,id)=>database(f).prepare('SELECT state,error,document,selection FROM story_rows WHERE id=?').bind(id).first();
// 事务内的语句失败：任务状态与故障记录在同一事务中写入，按语句片段让其中一条失败并回滚整个事务。
function failTransaction(owner,match,times=Infinity){
 const real=owner.database;let left=times;
 owner.database=Object.assign(Object.create(real),{transaction(body){return real.transaction(db=>body({...db,run(sql,...values){if(left>0&&sql.includes(match)){left--;throw sqliteError();}return db.run(sql,...values);}}));}});
 return ()=>{owner.database=real;};
}
// Hold one generator step open until the test ends it the way a killed process would.
function gateGenerator(f,name){
 let reject,calls=0,open=true;const gate=new Promise((_,no)=>reject=no),real=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>{const generator=real();return {...generator,async [name](...args){calls++;if(open)await gate;return generator[name](...args);}};};
 return {kill(error){open=false;reject(error);},started:()=>calls};
}
// A service stop kills Codex after dispatch has stopped, so the in-flight call rejects.
async function quit(f,call){
 f.app.stopGeneration();call.reject(Error('killed'));await until(()=>call.done);
 await f.restart();
}
const expireClaims=async(f,id)=>{
 await database(f).prepare("UPDATE production_jobs SET lease_until=1 WHERE session_id=? AND state='running'").bind(id).run();
};
// Abandon a claim the way a dead service does: nothing here can renew its foreign token.
const abandon=(f,job)=>database(f).prepare("UPDATE production_jobs SET lease_token='dead-service',lease_until=1 WHERE id=?").bind(job.id).run();

test('quitting during an image resumes after restart without a retry or provider error',async t=>{
 const f=await productionFixture(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 await quit(f,f.control.calls[0]);
 await until(async()=>{const s=await f.read(id);assert.doesNotMatch(s.error||'',/订阅|登录/);return s.state==='completed';},15000);
 assert.equal(f.control.calls.length,4,'Only the interrupted page is drawn twice');
});

test('quitting during text work resumes it without a retry',async t=>{
 const f=await productionFixture(t);let fail;const gate=new Promise((_,reject)=>fail=reject);
 f.control.beforeText=async name=>{if(name==='outline')await gate;};
 const id=await f.create(3);await until(()=>count(f,'outline')===1);
 f.app.stopGeneration();f.control.beforeText=null;fail(Error('killed'));
 await until(async()=>(await textJob(f,id,'outline'))?.interrupted===1);
 assert.match((await row(f,id)).error,/中断/);
 await f.restart();await completed(f,id);
 assert.equal(count(f,'outline'),2);assert.equal(f.control.calls.length,3);
});

for(const action of ['pause','stop'])test(`quitting after ${action} keeps the control, and Resume continues without a retry`,async t=>{
 const f=await productionFixture(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 await control(f,id,action);
 await quit(f,f.control.calls[0]);await production(f).tick();
 const saved=await f.read(id);
 assert.equal(saved.generationControl,action==='pause'?'paused':'stopped');assert.equal(f.control.calls.length,1);
 assert.match((await row(f,id)).error,/中断/);
 await control(f,id,'resume');await completed(f,id);assert.equal(f.control.calls.length,4);
});

test('quitting during story preparation resumes it without a retry',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 const {kill,started}=gateGenerator(f,'recommend');
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}}],note:''});
 const created=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}}),id=created.id;
 if(created.intake.search.state==='idle'&&!created.intake.batches.length)await f.startDiscovery(id);
 await f.demand(id);
 await until(async()=>(await f.read(id)).intake.phase==='choosing',20000);
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,action:'choose',batch:0,index:0});
 await until(()=>started()===1);
 f.app.stopGeneration();kill(Error('killed'));
 await until(async()=>(await jobs(f,id)).some(job=>job.kind==='dag'&&JSON.parse(job.payload).work.call==='prepareSuggestions'&&job.interrupted===1));
 assert.match((await row(f,id)).error,/中断/);
 await f.restart();await until(async()=>(await f.read(id)).intake.phase==='confirming',8000);
 assert.equal(f.control.recommendations.length,1);
});

test('quitting with saved pages redraws only the interrupted pages',async t=>{
 const f=await productionFixture(t),id=await f.create(5);await until(()=>f.control.calls.length===1);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 f.app.stopGeneration();for(const call of f.control.calls.slice(1))call.reject(Error('killed'));await until(()=>f.control.calls.every(call=>call.done));
 await f.restart();
 await until(async()=>{const s=await f.read(id);assert.doesNotMatch(s.error||'',/订阅|登录/);return s.state==='completed';},15000);
 assert.deepEqual([0,1,2,3,4].map(page=>f.control.calls.filter(call=>call.page===page).length),[1,2,2,2,1]);
});

for(const action of ['pause','stop'])test(`quitting after ${action} during text work keeps the control, and Resume runs it again`,async t=>{
 const f=await productionFixture(t);f.control.hold=false;let fail;const gate=new Promise((_,reject)=>fail=reject);
 f.control.beforeText=async name=>{if(name==='outline')await gate;};
 const id=await f.create(3);await until(()=>count(f,'outline')===1);
 await control(f,id,action);f.app.stopGeneration();f.control.beforeText=null;fail(Error('killed'));
 await until(async()=>(await textJob(f,id,'outline'))?.interrupted===1);
 await f.restart();await production(f).tick();
 assert.match((await row(f,id)).error,/中断/);assert.equal((await f.read(id)).generationControl,action==='pause'?'paused':'stopped');assert.equal(count(f,'outline'),1);
 await control(f,id,'resume');await completed(f,id);assert.equal(count(f,'outline'),2);
});

test('a deterministic 4xx in text work during a stop stays failed without replaying',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 let kill;const gate=new Promise((_,no)=>kill=no);
 f.control.beforeText=async name=>{if(name==='outline')await gate;};
 const id=await f.create(3);await until(()=>count(f,'outline')===1);
 f.app.stopGeneration();kill(new ReaderError(400,'原文尚未在本地核对，请重新选择故事。'));
 await until(async()=>(await textJob(f,id,'outline'))?.state==='failed');
 f.control.beforeText=null;
 await f.restart();await production(f).tick();await production(f).queue.settle();await production(f).tick();
 const job=await textJob(f,id,'outline');
 assert.equal(job.state,'failed');assert.equal(job.interrupted,0);assert.equal(job.attempts,1);assert.equal(count(f,'outline'),1,'Only an explicit retry may run it again');
 const fault=(await f.read(id)).faults?.find(x=>x.state==='pending');
 assert.ok(fault);assert.match(fault.message,/尚未在本地核对/);
});

test('a real provider failure while running is not treated as an interruption',async t=>{
 const f=await productionFixture(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 f.control.calls[0].reject(Error('provider failure'));await until(async()=>(await f.read(id)).faults?.some(x=>x.state==='pending'));
 assert.equal((await imageJob(f,id)).interrupted,0);
 await f.restart();await production(f).tick();
 assert.ok((await f.read(id)).faults.some(x=>x.state==='pending'));assert.equal(f.control.calls.length,1);
});

test('a transient tick error stops one cycle only and logs once',async t=>{
 const logs=t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),p=production(f),id=await f.create(3);await until(()=>f.control.calls.length===1);
 const recover=p.queue.recoverExpired.bind(p.queue);let thrown=0;
 p.queue.recoverExpired=async()=>{if(thrown++<3)throw sqliteError();return recover();};
 await until(()=>thrown>=4,8000);
 const response=await f.request(`sessions/${id}/production`,'POST',{viewerId:crypto.randomUUID(),page:0});
 assert.ok(response.ok,'Requests are not refused after an earlier error');
 f.control.hold=false;f.control.calls[0].resolve();await completed(f,id);
 assert.equal(logs.mock.calls.filter(call=>call.arguments[0]==='production_tick_failed').length,1);
 assert.doesNotMatch(JSON.stringify(logs.mock.calls),/database is locked/);
});

test('no paid work starts while the claim cannot be written, and work resumes when it can',async t=>{
 t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),restore=failTransaction(production(f).queue,"SET state='running',lease_token");
 const id=await f.create(3);f.control.hold=false;
 await new Promise(resolve=>setTimeout(resolve,1500));
 assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
 restore();await completed(f,id);assert.equal(f.control.calls.length,3);
});

test('a tick error during shutdown still closes the database, and work resumes next start',async t=>{
 t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),p=production(f),id=await f.create(3);await until(()=>f.control.calls.length===1);
 const closing=f.app.services.database;
 p.queue.recoverExpired=async()=>{throw sqliteError();};
 f.control.calls[0].resolve();await until(()=>f.control.calls[0].done);
 await f.app.close();
 await assert.rejects(async()=>closing.prepare('SELECT 1').first(),'SQLite is closed');
 await f.restart();f.control.hold=false;
 // The failed drain could not release its lock, so this behaves like a crash until the lock expires.
 await completed(f,id);assert.equal(f.control.calls.filter(call=>call.page===0).length,1,'The saved image is reused');
});

test('one failed tick during shutdown does not stop the drain: finished work is still published',async t=>{
 t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),p=production(f),id=await f.create(3);await until(()=>f.control.calls.length===1);
 const recover=p.queue.recoverExpired.bind(p.queue);let thrown=0;
 p.queue.recoverExpired=async()=>{if(!thrown++)throw sqliteError();return recover();};
 const closing=f.app.close();await until(()=>thrown>0);
 f.control.calls[0].resolve();await closing;
 const saved=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 const published=saved.prepare('SELECT * FROM story_rows WHERE id=?').get(id);saved.close();
 assert.ok(decodeDocument(published).images[0],'The paid image is published before close resolves');assert.equal(published.state,'idle');
});

for(const [name,corrupt] of [
 ['an unknown art style',"selection=json_set(selection,'$.artStyle','retired-style')"],
 ['a wrong-shape document',"document='{}'"],
 ['a null document',"document='null'"],
 ['truncated JSON','document=substr(document,1,10)'],
])test(`a story with ${name} parks alone: other stories finish and the shelf loads`,async t=>{
 const logs=t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),bad=await f.create(3);await until(()=>f.control.calls.length===1);
 await database(f).prepare(`UPDATE stories SET ${corrupt} WHERE id=?`).bind(bad).run();
 const saved=await row(f,bad);
 f.control.hold=false;f.control.calls[0].resolve();
 const good=await f.create(3);await completed(f,good);
 const shelf=await f.json('sessions');
 assert.deepEqual(shelf.map(s=>s.id),[good],'The readable story stays on the shelf');
 assert.equal((await row(f,bad)).selection,saved.selection);assert.equal((await row(f,bad)).document,saved.document,'Saved data is retained');
 assert.equal(f.control.calls.filter(call=>call.done).length,4,'The unreadable story made no further paid call');
 assert.equal(logs.mock.calls.filter(call=>call.arguments[0]==='production_story_unreadable').length,1);
 assert.doesNotMatch(JSON.stringify(logs.mock.calls),/庄周|philosopher/);
 await production(f).tick();assert.ok((await jobs(f,bad)).every(job=>job.state!=='running'),'A parked story does not keep renewing its lock');
 await f.json(`library/${bad}`,'DELETE');
 assert.ok((await f.json('deletions')).some(item=>item.storyId===bad&&item.canRestore));
 assert.deepEqual((await f.json('library/shelf')).map(item=>item.id),[good]);
});

test('a queued text job for an unreadable document makes no paid call',async t=>{
 t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t);let release;const gate=new Promise(resolve=>release=resolve);
 f.control.beforeText=async name=>{if(name==='brief')await gate;};
 const first=await f.create(3);await until(()=>count(f,'brief')===1);
 const bad=await f.create(3);await until(async()=>(await jobs(f,bad)).some(job=>job.state==='queued'&&job.pool==='text'));
 await database(f).prepare("UPDATE stories SET document='{}' WHERE id=?").bind(bad).run();
 f.control.beforeText=null;f.control.hold=false;release();
 await completed(f,first);await production(f).tick();
 assert.equal(count(f,'brief'),1);
 assert.ok((await jobs(f,bad)).filter(job=>job.pool==='text').every(job=>job.state==='queued'),'the parked story keeps its jobs queued');
});

test('a failed success write is not a provider failure; the replay finds the saved image and pays nothing',async t=>{
 const logs=t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),q=production(f).queue,id=await f.create(2);await until(()=>f.control.calls.length===1);
 const job=await imageJob(f,id);failTransaction(q,"state='succeeded',result=?",1);
 f.control.calls[0].resolve();await until(()=>logs.mock.calls.some(call=>call.arguments[0]==='production_job_unsaved'));
 const unsaved=await q.job(job.id);assert.equal(unsaved.state,'running');assert.equal(unsaved.error,null);
 const other=await f.create(2);f.control.hold=false;
 assert.notEqual((await f.read(id)).state,'failed');
 await database(f).prepare('UPDATE production_jobs SET lease_until=1 WHERE id=?').bind(job.id).run();
 await completed(f,id);await completed(f,other);
 assert.equal(f.control.calls.filter(call=>call.page===0).length,2,'The image saved in the story is not paid for again; only the other story draws its own');
});

test('a failed failure write does not stop the queue or report a provider failure',async t=>{
 const logs=t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),p=production(f),q=p.queue,id=await f.create(2);await until(()=>f.control.calls.length===1);
 const job=await imageJob(f,id);failTransaction(q,"state='failed',error=?",1);
 f.control.calls[0].reject(Error('provider failure'));await until(()=>logs.mock.calls.some(call=>call.arguments[0]==='production_job_unsaved'));
 assert.equal((await q.job(job.id)).state,'running');
 const other=await f.create(2);f.control.hold=false;
 await completed(f,other);
 await database(f).prepare('UPDATE production_jobs SET lease_until=1 WHERE id=?').bind(job.id).run();
 await completed(f,id);
});

test('a failed document save of text work is not a provider failure and recovers',async t=>{
 const logs=t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),p=production(f);f.control.hold=false;
 // 只让任务执行中的保存失败一次（准备阶段的采用与结算也写故事文档，不属于任务）。
 let armed=false;
 f.control.beforeText=async name=>{if(name==='brief'&&!armed){armed=true;failTransaction(p.dag.deps,'UPDATE stories SET document=?,production_complete=?',1);}};
 const id=await f.create(3);await until(()=>logs.mock.calls.some(call=>call.arguments[0]==='production_job_unsaved'));
 const job=(await jobs(f,id)).find(job=>job.state==='running'&&job.pool==='text');
 assert.ok(job);assert.equal(job.error,null);
 const saved=await f.read(id);assert.notEqual(saved.state,'failed');assert.equal(saved.error,null);assert.ok(!saved.faults?.length);
 await database(f).prepare('UPDATE production_jobs SET lease_until=1 WHERE id=?').bind(job.id).run();
 await completed(f,id);assert.equal(count(f,'brief'),1,'The paid result is kept on its job, so the replay pays nothing');
});

test('a clock jump during a live call keeps its claims, saves its result and pays once',async t=>{
 const f=await productionFixture(t),id=await f.create(2);await until(()=>f.control.calls.length===1);
 const before=await imageJob(f,id);
 await expireClaims(f,id);
 // Recovery can also run from an API retry before the first tick after waking.
 await f.demand(id,crypto.randomUUID(),0,true);
 await production(f).tick();
 const renewed=await production(f).queue.job(before.id);
 assert.equal(renewed.state,'running');assert.equal(renewed.lease_token,before.lease_token);assert.ok(renewed.lease_until>Date.now());
 f.control.hold=false;f.control.calls[0].resolve();await completed(f,id);
 assert.equal(f.control.calls.filter(call=>call.page===0).length,1);
});

test('results arriving after a clock jump, before any tick renews the claims, are still saved',async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 await expireClaims(f,id);f.control.hold=false;f.control.calls[0].resolve();
 await completed(f,id);
 assert.equal(f.control.calls.filter(call=>call.page===0).length,1);
 assert.equal((await f.read(id)).error,null);
});

test('automatic recovery stops at three attempts, and a retry restores the allowance',async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 // 每次退出都让进行中的绘图中断；重启后自动恢复，每次付费开始都计入次数。
 for(let attempt=1;attempt<=3;attempt++){
  await until(()=>f.control.calls.length===attempt);
  assert.equal((await imageJob(f,id)).attempts,attempt);
  await quit(f,f.control.calls[attempt-1]);f.control.hold=true;
 }
 await production(f).tick();await production(f).tick();
 const capped=await imageJob(f,id);
 assert.equal(capped.state,'failed');assert.equal(capped.interrupted,1);assert.equal(f.control.calls.length,3,'No fourth automatic call');
 const fault=(await f.read(id)).faults.find(x=>x.state==='pending');
 assert.ok(fault);assert.equal(fault.retryAllowed,true);
 await f.demand(id,crypto.randomUUID(),0,true);
 await until(()=>f.control.calls.length===4);
 assert.equal((await imageJob(f,id)).attempts,1,'The explicit retry restores the allowance');
 f.control.hold=false;f.control.calls[3].resolve();await completed(f,id);
});
