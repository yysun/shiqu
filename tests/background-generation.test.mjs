// Verify durable whole-story intent, manual overrides and restart recovery with controlled providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import {migrate} from '../server/database.ts';
import {productionFixture,until} from './fixtures/production.mjs';
import {flowProviders} from './fixtures/test-tier.mjs';
const outlines=f=>f.control.dagCalls.filter(name=>name==='outline').length;
const control=(f,id,action)=>f.json(`sessions/${id}/production-control`,'POST',{action});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: new stories generate every page without a viewer or a mode request`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(10);
 const initial=await f.read(id);assert.equal(initial.generationMode,'background');assert.equal(initial.generationControl,'active');
 // The create response already carries durable intent; no mode request or viewer is involved.
 f.control.hold=false;await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(f.control.calls.length,10);assert.equal(outlines(f),1);assert.ok(f.control.maxActive<=3);
 assert.equal((await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM production_demand').first()).n,0);
 assert.equal((await f.read(id)).generationMode,'background');
});

for(const action of ['pause','stop'])test(`${action} overrides viewers and legacy calls, survives restart and resumes in the saved mode`,async t=>{
 const f=await productionFixture(t),id=await f.create(10),viewer=crypto.randomUUID();await f.demand(id,viewer);
 await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 await control(f,id,action);for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===4&&(await f.read(id)).state!=='running');
 const expected=action==='pause'?'paused':'stopped';
 await f.demand(id,viewer,2,true);assert.equal((await f.request(`sessions/${id}/advance`,'POST',{throughPage:9,retry:true})).status,400);
 await f.app.services.production.tick();assert.equal(f.control.calls.length,4);
 assert.equal((await f.read(id)).generationControl,expected);
 await f.restart();await f.app.services.production.tick();assert.equal(f.control.calls.length,4);
 assert.equal((await f.read(id)).generationControl,expected);
 await control(f,id,'resume');await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,10);
 assert.equal((await f.read(id)).generationMode,'background');
});

test('manual pause also fences an unmanaged legacy session and a retry through the advance route',async t=>{
 const f=await productionFixture(t),id=await f.create();await control(f,id,'pause');
 assert.equal((await f.request(`sessions/${id}/advance`,'POST',{throughPage:7,retry:true})).status,400);
 await f.app.services.production.tick();assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
 await control(f,id,'resume');await f.demand(id);await until(()=>f.control.calls.length===1);
});

test('leaving a new story keeps it generating; a manual pause still survives restart',async t=>{
 const f=await productionFixture(t),id=await f.create(10),viewer=crypto.randomUUID();
 await f.demand(id,viewer);await until(()=>f.control.calls.length===1);await f.leave(id,viewer);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 await control(f,id,'pause');for(const call of f.control.calls)call.resolve();
 await until(async()=>(await f.read(id)).ready===4&&(await f.read(id)).state!=='running');
 await f.restart();await f.app.services.production.tick();assert.equal(f.control.calls.length,4);
 await control(f,id,'resume');await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,10);
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: shutdown drains saved images; startup resumes only the missing background pages`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(10);
 await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 f.app.stopGeneration();for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===4&&(await f.app.services.database.prepare('SELECT state FROM stories WHERE id=?').bind(id).first()).state!=='running');
 const before=await f.read(id);assert.equal(before.ready,4);
 await f.restart();await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,10);
 assert.deepEqual((await f.read(id)).story.pages.slice(0,4).map(p=>p.image),before.story.pages.slice(0,4).map(p=>p.image));
 assert.equal(outlines(f),1);
});

test('expired background script locks restart planning without viewers',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.stop();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 db.prepare("UPDATE stories SET generation_mode='background',state='running',lock_token='dead-script',lock_until=1 WHERE id=?").run(id);db.close();
 await f.restart();await until(async()=>(await f.read(id)).state==='completed');assert.equal(outlines(f),1);assert.equal(f.control.calls.length,8);
});

test('background provider failures stay failed after restart until explicit retry',async t=>{
 const f=await productionFixture(t),id=await f.create(10);await until(()=>f.control.calls.length===1);f.control.calls[0].reject(Error('controlled failure'));
 await until(async()=>(await f.read(id)).state==='failed');await f.restart();await f.app.services.production.tick();
 assert.equal((await f.read(id)).state,'failed');assert.equal(f.control.calls.length,1);
 await control(f,id,'pause');await control(f,id,'resume');await f.app.services.production.tick();
 assert.equal((await f.read(id)).state,'failed');assert.equal(f.control.calls.length,1,'Pause/resume never retries a real provider failure');
 await f.demand(id,crypto.randomUUID(),0,true);await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,11);
});

test('reader deletion disarms background work; restore cannot restart it',async t=>{
 const f=await productionFixture(t),id=await f.create(10);await until(()=>f.control.calls.length===1);
 await f.json(`library/${id}`,'DELETE');
 // 删除后正在进行的绘图结束：不再派发新的绘图。（已付费的成图是否保留见报告：DAG 保存要求故事可见。）
 f.control.calls[0].resolve();await f.app.services.production.queue.settle();
 await f.json(`library/${id}/restore`,'POST');await f.restart();await f.app.services.production.tick();
 assert.equal((await f.read(id)).generationControl,'stopped');assert.equal(f.control.calls.length,1);
});

test('controls validate owner, origin, body and completed sessions; pause does not require provider access',async t=>{
 const f=await productionFixture(t),id=await f.create();
 for(const body of [{action:'invalid'},{action:'resume',ownerId:'foreign'},{}])assert.equal((await f.request(`sessions/${id}/production-control`,'POST',body)).status,400);
 assert.equal((await f.request(`sessions/${id}/production-control`,'POST',{action:'pause'},{Origin:'https://evil.example'})).status,403);
 await assert.rejects(f.app.services.production.control('foreign',id,'pause'),error=>error.status===404);
 await f.json(`library/${id}`,'DELETE');assert.equal((await f.request(`sessions/${id}/production-control`,'POST',{action:'resume'})).status,404);
 const done=await f.create();f.control.hold=false;await until(async()=>(await f.read(done)).state==='completed');
 assert.equal((await f.request(`sessions/${done}/production-control`,'POST',{action:'background'})).status,400);
 const paused=await f.create();f.generation.status=async()=>({configured:false});assert.equal((await f.request(`sessions/${paused}/production-control`,'POST',{action:'pause'})).status,200);
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: an expired missing remote result resumes automatically but saved images do not repeat`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(10);f.control.hold=false;await f.demand(id);await until(async()=>(await f.read(id)).ready===7);await f.stop();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 // 第 7 幅的绘图在远端完成前进程中断：任务租约已过期，文档里没有这幅图的记录。
 const saved=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(id).document),key=saved.dag.order[6];
 delete saved.dag.products[`frameImage:${key}`];delete saved.dag.frames[key].image;saved.images[6]='';
 db.prepare("UPDATE stories SET generation_mode='background',document=?,state='running',lock_token='crashed',lock_until=1 WHERE id=?").run(JSON.stringify(saved),id);
 // 远端结果从未到达：任务记录里也没有已付费的结果。
 db.prepare("UPDATE production_jobs SET payload=json_remove(payload,'$.paid'),state='running',result=NULL,lease_token='crashed',lease_until=1 WHERE session_id=? AND kind='dag-draw' AND json_extract(payload,'$.page')=6").run(id);db.close();
 await f.restart();await until(async()=>(await f.read(id)).state==='completed');
 assert.equal(f.control.calls.length,11);assert.equal(f.control.calls.filter(c=>c.page===6).length,2);
 assert.ok(f.control.calls.filter(c=>c.page!==6).every((call,index,all)=>all.findIndex(other=>other.page===call.page)===index));
});

test('startup reconciles a fully published background story whose final session save was interrupted',async t=>{
 const f=await productionFixture(t),id=await f.create();f.control.hold=false;await until(async()=>(await f.read(id)).state==='completed');await f.stop();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 db.prepare("UPDATE stories SET state='running',lock_token='dead-finalizer',lock_until=1 WHERE id=?").run(id);db.close();
 await f.restart();await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,8);assert.equal(outlines(f),1);
});

test('upgrading a pre-background library preserves checkpoints and pauses old stories',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE app_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
 for(const file of readdirSync('drizzle').filter(name=>name.endsWith('.sql')&&name<'0004').sort()){
  db.exec(readFileSync(path.join('drizzle',file),'utf8'));db.prepare('INSERT INTO app_migrations VALUES(?,?)').run(file,'before-upgrade');
 }
 db.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,state,page,saved,created_at,updated_at) VALUES('legacy','owner','{}',?, 'idle',3,1,'created','updated')").run(JSON.stringify({plan:{title:'saved'},images:['saved.png'],usage:[{step:'image:0'}]}));
 db.prepare("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,created_at,updated_at) VALUES('job','legacy','owner','image','image','v','[]','{}','saved-result','succeeded',1,2)").run();
 const before=db.prepare('SELECT * FROM reader_sessions').get(),job=db.prepare('SELECT * FROM production_jobs').get();
 migrate(db,process.cwd());
 const after=db.prepare('SELECT * FROM stories').get(),savedJob=db.prepare('SELECT * FROM production_jobs').get();
 assert.deepEqual({...after,generation_mode:undefined,generation_control:undefined},{...before,generation_mode:undefined,generation_control:undefined});
 assert.equal(after.generation_mode,'background');assert.equal(after.generation_control,'paused');
 assert.deepEqual({...savedJob,interrupted:undefined,failure_id:undefined,recovery_id:undefined,error_code:undefined},{...job,interrupted:undefined,failure_id:undefined,recovery_id:undefined,error_code:undefined});assert.equal(savedJob.interrupted,0);assert.equal(savedJob.error_code,null,'the added failure-code column starts empty');
 migrate(db,process.cwd());assert.deepEqual(db.prepare('SELECT * FROM stories').get(),after);
});

test('single-control upgrade preserves background intent, manual controls, failures, leases and receipts',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE app_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
 for(const file of readdirSync('drizzle').filter(name=>name.endsWith('.sql')&&name<'0005').sort()){
  db.exec(readFileSync(path.join('drizzle',file),'utf8'));db.prepare('INSERT INTO app_migrations VALUES(?,?)').run(file,'before-upgrade');
 }
 const cases=[
  ['idle','reader','active','idle','paused'],['running','reader','active','running','paused'],
  ['failed','reader','active','failed','paused'],['paused','reader','paused','idle','paused'],
  ['stopped','reader','stopped','idle','stopped'],['completed','reader','active','completed','active'],
  ['background','background','active','idle','active'],['background-paused','background','paused','idle','paused'],
  ['deleted','reader','active','idle','paused'],
 ];
 for(const [id,mode,control,state] of cases){
  db.prepare(`INSERT INTO reader_sessions(id,user_id,selection,document,state,generation_mode,generation_control,page,saved,created_at,updated_at,lock_token,lock_until,error)
   VALUES(?,'owner','{}',?,?,?, ?,3,1,'created','updated','live-lease',123456,'saved error')`)
   .run(id,JSON.stringify({plan:{title:'saved'},images:['saved.png'],usage:[{step:'image:0'}]}),state,mode,control);
  db.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,lease_token,lease_until,created_at,updated_at)
   VALUES(?,?,'owner','image','image','v','[]','{}','saved-result','succeeded','job-lease',123456,1,2)`).run('job-'+id,id);
 }
 db.exec("INSERT INTO library_deletions(user_id,story_id,kind,deleted_at) VALUES('owner','deleted','generated','saved deletion')");
 const before=db.prepare('SELECT * FROM reader_sessions ORDER BY id').all(),jobs=db.prepare('SELECT * FROM production_jobs ORDER BY id').all();
 migrate(db,process.cwd());
 for(const [id,,,,expected] of cases){
  const after=db.prepare('SELECT * FROM stories WHERE id=?').get(id),old=before.find(row=>row.id===id);
  assert.equal(after.generation_mode,'background');assert.equal(after.generation_control,expected);
  assert.deepEqual({...after,generation_mode:undefined,generation_control:undefined},{...old,generation_mode:undefined,generation_control:undefined});
 }
 assert.deepEqual(db.prepare('SELECT * FROM production_jobs ORDER BY id').all().map(({failure_id,recovery_id,error_code,...job})=>{assert.equal(failure_id,null);assert.equal(recovery_id,null);assert.equal(error_code,null);return job;}),jobs.map(job=>({...job})));
 const after=db.prepare('SELECT * FROM stories ORDER BY id').all();migrate(db,process.cwd());
 assert.deepEqual(db.prepare('SELECT * FROM stories ORDER BY id').all(),after);
});
