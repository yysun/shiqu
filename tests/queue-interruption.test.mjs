// Verify that stops, scheduling errors, unreadable stories and clock jumps stay contained,
// and that automatic recovery of paid work is bounded. Controlled providers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {productionFixture,until} from './fixtures/production.mjs';
const owner='docker-local-owner';
const production=f=>f.app.services.production;
const database=f=>f.app.services.database;
const jobs=(f,id)=>production(f).queue.jobs(id,owner);
const imageJob=async(f,id,page=0)=>(await jobs(f,id)).find(job=>job.kind==='image'&&JSON.parse(job.payload).page===page);
const control=(f,id,action)=>f.json(`sessions/${id}/production-control`,'POST',{action});
const completed=(f,id)=>until(async()=>(await f.read(id)).state==='completed',15000);
const sqliteError=()=>Object.assign(Error('database is locked'),{code:'ERR_SQLITE_ERROR'});
const issue=page=>({page,category:'action',problem:'本幅与前幅只有旁白变化，人物和道具状态完全重复。',instruction:'保留当前事件，以接触物件的手势和明确的动作结果表现这一步变化。'});
const row=(f,id)=>database(f).prepare('SELECT state,error,document,selection FROM reader_sessions WHERE id=?').bind(id).first();
// Fail matching statements on one owner's database handle until the returned function restores it.
function failWrites(owner,match,times=Infinity){
 const real=owner.database;let left=times;
 owner.database={prepare(sql){if(left>0&&sql.includes(match)){left--;throw sqliteError();}return real.prepare(sql);}};
 return ()=>{owner.database=real;};
}
// A service stop kills Codex after dispatch has stopped, so the in-flight call rejects.
async function quit(f,call){
 f.app.stopGeneration();call.reject(Error('killed'));await until(()=>call.done);
 await f.restart();
}
const expireClaims=async(f,id)=>{
 await database(f).prepare("UPDATE production_jobs SET lease_until=1 WHERE session_id=? AND state='running'").bind(id).run();
 await database(f).prepare("UPDATE reader_sessions SET lock_until=1 WHERE id=? AND state='running'").bind(id).run();
};
// Abandon a claim the way a dead service does: nothing here can renew its foreign token.
const abandon=(f,job)=>database(f).prepare("UPDATE production_jobs SET lease_token='dead-service',lease_until=1 WHERE id=?").bind(job.id).run();

test('quitting during an image resumes after restart without a retry or provider error',async t=>{
 const f=await productionFixture(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 await quit(f,f.control.calls[0]);
 await until(async()=>{const s=await f.read(id);assert.doesNotMatch(s.error||'',/订阅|登录/);return s.state==='completed';},15000);
 assert.equal(f.control.calls.length,4,'Only the interrupted page is drawn twice');
});

test('quitting during script work resumes planning without a retry',async t=>{
 const f=await productionFixture(t);let fail;const gate=new Promise((_,reject)=>fail=reject);
 f.control.beforeText=async kind=>{if(kind==='plan')await gate;};
 const id=await f.create(3);await until(()=>f.control.plans.length===1);
 f.app.stopGeneration();f.control.beforeText=null;fail(Error('killed'));
 await until(async()=>(await jobs(f,id)).some(job=>job.interrupted===1));
 assert.equal((await row(f,id)).state,'idle','The session row must not keep the provider failure');
 await f.restart();await completed(f,id);
 assert.equal(f.control.plans.length,2);assert.equal(f.control.calls.length,3);
});

for(const action of ['pause','stop'])test(`quitting after ${action} keeps the control, and Resume continues without a retry`,async t=>{
 const f=await productionFixture(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 await control(f,id,action);
 await quit(f,f.control.calls[0]);await production(f).tick();
 const saved=await f.read(id);
 assert.equal(saved.generationControl,action==='pause'?'paused':'stopped');assert.equal(f.control.calls.length,1);
 assert.equal((await row(f,id)).state,'idle');
 await control(f,id,'resume');await completed(f,id);assert.equal(f.control.calls.length,4);
});

test('a blocked review during a stop stays failed and never repairs automatically',async t=>{
 const f=await productionFixture(t);let release;const gate=new Promise(resolve=>release=resolve);
 f.control.beforeText=async kind=>{if(kind==='review'){if(f.control.reviews.length===2)await gate;return {issues:[issue(2)]};}};
 const id=await f.create(3);await until(()=>f.control.reviews.length===2);
 f.app.stopGeneration();release();
 await until(async()=>(await jobs(f,id)).some(job=>job.state==='failed'));
 await f.restart();await production(f).tick();await production(f).tick();
 const saved=await f.read(id);
 assert.equal(saved.state,'failed');assert.equal(saved.retryStage,'review');
 assert.equal(f.control.repairs.length,1);assert.equal(f.control.reviews.length,2);assert.equal(f.control.calls.length,0);
 assert.ok((await jobs(f,id)).some(job=>job.state==='failed'&&job.interrupted===0));
});

test('a real provider failure while running is not treated as an interruption',async t=>{
 const f=await productionFixture(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 f.control.calls[0].reject(Error('provider failure'));await until(async()=>(await f.read(id)).state==='failed');
 assert.equal((await imageJob(f,id)).interrupted,0);
 await f.restart();await production(f).tick();
 assert.equal((await f.read(id)).state,'failed');assert.equal(f.control.calls.length,1);
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
 const f=await productionFixture(t),restore=failWrites(production(f).queue,"SET state='running',lease_token");
 const id=await f.create(3);f.control.hold=false;
 await new Promise(resolve=>setTimeout(resolve,1500));
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
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
 await database(f).prepare('UPDATE reader_sessions SET lock_until=1 WHERE id=?').bind(id).run();
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
 const {document,state}=saved.prepare('SELECT document,state FROM reader_sessions WHERE id=?').get(id);saved.close();
 assert.ok(JSON.parse(document).images[0],'The paid image is published before close resolves');assert.equal(state,'idle');
});

for(const [name,corrupt] of [
 ['an unknown art style',"selection=json_set(selection,'$.artStyle','retired-style')"],
 ['a wrong-shape document',"document='{}'"],
 ['a null document',"document='null'"],
 ['truncated JSON','document=substr(document,1,10)'],
])test(`a story with ${name} parks alone: other stories finish and the shelf loads`,async t=>{
 const logs=t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),bad=await f.create(3);await until(()=>f.control.calls.length===1);
 await database(f).prepare(`UPDATE reader_sessions SET ${corrupt} WHERE id=?`).bind(bad).run();
 const saved=await row(f,bad);
 f.control.hold=false;f.control.calls[0].resolve();
 const good=await f.create(3);await completed(f,good);
 const shelf=await f.json('sessions');
 assert.deepEqual(shelf.map(s=>s.id),[good],'The readable story stays on the shelf');
 assert.equal((await row(f,bad)).selection,saved.selection);assert.equal((await row(f,bad)).document,saved.document,'Saved data is retained');
 assert.equal(f.control.calls.filter(call=>call.done).length,4,'The unreadable story made no further paid call');
 assert.equal(logs.mock.calls.filter(call=>call.arguments[0]==='production_story_unreadable').length,1);
 assert.doesNotMatch(JSON.stringify(logs.mock.calls),/庄周|philosopher/);
 await production(f).tick();assert.equal(production(f).leases.has(bad),false,'A parked story does not keep renewing its lock');
});

test('a queued text job for an unreadable document makes no paid plan call',async t=>{
 t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t);let release;const gate=new Promise(resolve=>release=resolve);
 f.control.beforeText=async kind=>{if(kind==='plan')await gate;};
 const first=await f.create(3);await until(()=>f.control.plans.length===1);
 const bad=await f.create(3);await until(async()=>(await jobs(f,bad)).some(job=>job.state==='queued'&&job.pool==='text'));
 await database(f).prepare("UPDATE reader_sessions SET document='{}' WHERE id=?").bind(bad).run();
 f.control.beforeText=null;f.control.hold=false;release();
 await completed(f,first);await production(f).tick();
 assert.equal(f.control.plans.length,1);
 assert.equal((await jobs(f,bad)).find(job=>job.pool==='text').state,'queued');
});

test('a failed success write is not a provider failure and recovers as an interruption',async t=>{
 const logs=t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),q=production(f).queue,id=await f.create(2);await until(()=>f.control.calls.length===1);
 const job=await imageJob(f,id);failWrites(q,"SET state='succeeded'",1);
 f.control.calls[0].resolve();await until(()=>logs.mock.calls.some(call=>call.arguments[0]==='production_job_unsaved'));
 const unsaved=await q.job(job.id);assert.equal(unsaved.state,'running');assert.equal(unsaved.error,null);
 const other=await f.create(2);f.control.hold=false;
 assert.notEqual((await f.read(id)).state,'failed');
 await database(f).prepare('UPDATE production_jobs SET lease_until=1 WHERE id=?').bind(job.id).run();
 await completed(f,id);await completed(f,other);
 assert.equal(f.control.calls.filter(call=>call.page===0).length,3,'Only the unsaved image is replayed, once');
});

test('a failed failure write does not stop the queue or report a provider failure',async t=>{
 const logs=t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),p=production(f),q=p.queue,id=await f.create(2);await until(()=>f.control.calls.length===1);
 const job=await imageJob(f,id);failWrites(q,"SET state='failed',error=?",1);
 f.control.calls[0].reject(Error('provider failure'));await until(()=>logs.mock.calls.some(call=>call.arguments[0]==='production_job_unsaved'));
 assert.equal((await q.job(job.id)).state,'running');
 const other=await f.create(2);f.control.hold=false;
 await completed(f,other);
 await database(f).prepare('UPDATE production_jobs SET lease_until=1 WHERE id=?').bind(job.id).run();
 await completed(f,id);
});

test('a publication write error recovers without paying for the image again',async t=>{
 const logs=t.mock.method(console,'error',()=>{});
 const f=await productionFixture(t),p=production(f),id=await f.create(2);await until(()=>f.control.calls.length===1);
 failWrites(p,"json_set(document,?, ?, '$.usage'",1);
 f.control.hold=false;f.control.calls[0].resolve();
 await until(()=>logs.mock.calls.some(call=>call.arguments[0]==='production_job_unsaved'));
 const publication=(await jobs(f,id)).find(job=>job.kind==='image-publish'&&job.state==='running');
 assert.ok(publication);assert.notEqual((await f.read(id)).state,'failed');
 await database(f).prepare('UPDATE production_jobs SET lease_until=1 WHERE id=?').bind(publication.id).run();
 await completed(f,id);assert.equal(f.control.calls.length,2,'The saved receipt is reused');
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
 assert.ok((await database(f).prepare('SELECT lock_until FROM reader_sessions WHERE id=?').bind(id).first()).lock_until>Date.now());
 f.control.hold=false;f.control.calls[0].resolve();await completed(f,id);
 assert.equal(f.control.calls.filter(call=>call.page===0).length,1);
 assert.equal(readdirSync(path.join(f.dataDirectory,'media/reader',id,'artifacts')).length,2,'No discarded paid artifact is left behind');
});

test('results arriving after a clock jump, before any tick renews the claims, are still saved',async t=>{
 const f=await productionFixture(t),store=f.app.services.media,get=store.get.bind(store),id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 const image=await imageJob(f,id);
 await expireClaims(f,id);f.control.calls[0].resolve();
 await until(async()=>(await production(f).queue.job(image.id)).state==='succeeded');
 // Hold publication open across a second jump so its own write also sees expired claims.
 let release,entered=false;const gate=new Promise(resolve=>release=resolve);
 store.get=async key=>{if(key.includes('/artifacts/0-')&&!entered){entered=true;await gate;}return get(key);};
 await until(()=>entered);
 await expireClaims(f,id);release();
 f.control.hold=false;await completed(f,id);
 assert.equal(f.control.calls.filter(call=>call.page===0).length,1);
 assert.equal((await f.read(id)).error,null);
});

test('automatic recovery stops at three attempts, and a retry restores the allowance',async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 for(let attempt=1;attempt<=3;attempt++){
  await until(()=>f.control.calls.length===attempt);
  const job=await imageJob(f,id);assert.equal(job.attempts,attempt);
  await abandon(f,job);f.control.calls[attempt-1].resolve();await until(()=>f.control.calls[attempt-1].done);
  await production(f).tick();await production(f).queue.settle();
 }
 await production(f).tick();await production(f).tick();
 const capped=await imageJob(f,id);
 assert.equal(capped.state,'failed');assert.equal(capped.interrupted,1);assert.equal(f.control.calls.length,3,'No fourth automatic call');
 const saved=await f.read(id);
 assert.equal(saved.state,'failed');assert.equal(saved.retryAllowed,true);
 const sibling=await imageJob(f,id,1);assert.equal(sibling.state,'queued');
 await database(f).prepare('UPDATE production_jobs SET attempts=2 WHERE id=?').bind(sibling.id).run();
 await f.demand(id,crypto.randomUUID(),0,true);
 await until(()=>f.control.calls.length===4);
 assert.equal((await imageJob(f,id)).attempts,1);assert.equal((await production(f).queue.job(sibling.id)).attempts,0,'The whole story gets the allowance back');
 f.control.hold=false;f.control.calls[3].resolve();await completed(f,id);
});
