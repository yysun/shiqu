// Verify durable whole-story intent, manual overrides and restart recovery with controlled providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import {migrate} from '../server/database.ts';
import {productionFixture,until,turn} from './fixtures/production.mjs';
import {ReaderProductionCoordinator} from '../server/reader-production.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {setLibraryStoryDeleted} from '../desktop/library-preview.ts';
const owner='docker-local-owner';
const control=(f,id,action)=>f.json(`sessions/${id}/production-control`,'POST',{action});

for(const provider of ['codex','gemini'])test(`${provider}: persisted background intent starts without viewers and completes every page`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(10);
 const initial=await f.read(id);assert.equal(initial.generationMode,'reader');assert.equal(initial.generationControl,'active');
 // A persisted user choice loaded at startup is the only demand; no production POST or reader exists.
 await f.app.services.database.prepare("UPDATE reader_sessions SET generation_mode='background' WHERE id=?").bind(id).run();
 await f.restart();await until(async()=>(await f.read(id)).state==='completed');
 assert.equal(f.control.calls.length,10);assert.equal(f.control.plans.length,1);assert.ok(f.control.maxActive<=3);
 assert.equal((await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM production_demand').first()).n,0);
 assert.equal((await f.read(id)).generationMode,'background');
});

for(const action of ['pause','stop'])test(`${action} overrides viewers and legacy calls, survives restart and resumes in the saved mode`,async t=>{
 const f=await productionFixture(t),id=await f.create(10),viewer=crypto.randomUUID();await control(f,id,'background');await f.demand(id,viewer);
 await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 await control(f,id,action);for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===4&&(await f.read(id)).state!=='running');
 const expected=action==='pause'?'paused':'stopped';
 await f.demand(id,viewer,2,true);await f.json(`sessions/${id}/advance`,'POST',{throughPage:9,retry:true});
 await f.app.services.production.tick();assert.equal(f.control.calls.length,4);
 assert.equal((await f.read(id)).generationControl,expected);
 await f.restart();await f.app.services.production.tick();assert.equal(f.control.calls.length,4);
 await control(f,id,'reader');assert.equal((await f.read(id)).generationControl,expected,'Changing mode never resumes manual control');
 await control(f,id,'background');assert.equal((await f.read(id)).generationControl,expected);
 await control(f,id,'resume');await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,10);
 assert.equal((await f.read(id)).generationMode,'background');
});

test('manual pause also fences an unmanaged legacy session and direct engine acquisition',async t=>{
 const f=await productionFixture(t),id=await f.create();await control(f,id,'pause');
 await f.json(`sessions/${id}/advance`,'POST',{throughPage:7,retry:true});
 const repo=new ReaderRepository(f.app.services.database);
 await advanceStory(repo,f.generation.generator(),owner,id,7,true);
 await f.app.services.production.tick();assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 await control(f,id,'resume');await f.demand(id);await until(()=>f.control.calls.length===1);
});

for(const provider of ['codex','gemini'])test(`${provider}: shutdown drains saved images; startup resumes only the missing background pages`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(10);await control(f,id,'background');
 await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 f.app.stopGeneration();for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===4&&(await f.app.services.database.prepare('SELECT state FROM reader_sessions WHERE id=?').bind(id).first()).state!=='running');
 const before=await f.read(id);assert.equal(before.ready,4);
 await f.restart();await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,10);
 assert.deepEqual((await f.read(id)).story.pages.slice(0,4).map(p=>p.image),before.story.pages.slice(0,4).map(p=>p.image));
 assert.equal(f.control.plans.length,1);
});

for(const paused of [false,true])test(`expired background attempts recover with saved control (${paused?'paused':'active'}) and never steal live claims`,async t=>{
 const f=await productionFixture(t),id=await f.create(10);f.control.hold=false;await f.demand(id);await until(async()=>(await f.read(id)).ready===7);await f.stop();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 db.prepare("UPDATE reader_sessions SET generation_mode='background',generation_control=?,state='running',lock_token='dead-session',lock_until=? WHERE id=?").run(paused?'paused':'active',Date.now()+60000,id);
 const image=db.prepare("SELECT id FROM production_jobs WHERE session_id=? AND kind='image' AND json_extract(payload,'$.page')=6").get(id);
 db.prepare("UPDATE production_jobs SET state='running',result=NULL,lease_token='dead-job',lease_until=? WHERE id=?").run(Date.now()+60000,image.id);db.close();
 await f.restart();await f.app.services.production.tick();assert.equal(f.control.calls.length,7);
 assert.equal((await f.app.services.production.queue.job(image.id)).state,'running','Unexpired claims remain owned');
 await f.app.services.database.prepare('UPDATE production_jobs SET lease_until=1 WHERE id=?').bind(image.id).run();
 await f.app.services.database.prepare('UPDATE reader_sessions SET lock_until=1 WHERE id=?').bind(id).run();
 await f.app.services.production.tick();
 if(paused){assert.equal((await f.app.services.production.queue.job(image.id)).interrupted,1);assert.equal(f.control.calls.length,7);await control(f,id,'resume');}
 await until(async()=>(await f.read(id)).state==='completed');
 assert.equal(f.control.calls.length,10,'Saved image 6 is reused even if its job receipt was interrupted');assert.equal(f.control.plans.length,1);
});

test('expired background script locks restart planning without viewers',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.stop();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 db.prepare("UPDATE reader_sessions SET generation_mode='background',state='running',lock_token='dead-script',lock_until=1 WHERE id=?").run(id);db.close();
 await f.restart();await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.plans.length,1);assert.equal(f.control.calls.length,8);
});

test('background provider failures stay failed after restart until explicit retry',async t=>{
 const f=await productionFixture(t),id=await f.create(10);await control(f,id,'background');await until(()=>f.control.calls.length===1);f.control.calls[0].reject(Error('controlled failure'));
 await until(async()=>(await f.read(id)).state==='failed');await f.restart();await f.app.services.production.tick();
 assert.equal((await f.read(id)).state,'failed');assert.equal(f.control.calls.length,1);
 await f.demand(id,crypto.randomUUID(),0,true);await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,11);
});

for(const desktop of [false,true])test(`${desktop?'desktop':'reader'} deletion disarms background work; restore cannot restart it`,async t=>{
 const f=await productionFixture(t),id=await f.create(10);await control(f,id,'background');await until(()=>f.control.calls.length===1);
 if(desktop)setLibraryStoryDeleted(f.dataDirectory,id,true);else await f.json(`library/${id}`,'DELETE');
 f.control.calls[0].resolve();await until(async()=>{const row=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();return JSON.parse(row.document).images.filter(Boolean).length===1;});
 await f.json(`library/${id}/restore`,'POST');await f.restart();await f.app.services.production.tick();
 assert.equal((await f.read(id)).generationControl,'stopped');assert.equal(f.control.calls.length,1);
});

test('background preparation retains count confirmation and does not plan or draw early',async t=>{
 const f=await productionFixture(t),id=await f.create('auto',{narrativeDetail:'balanced'});f.control.hold=false;await control(f,id,'background');
 await until(async()=>(await f.read(id)).awaitingFrameCount);await f.restart();await f.app.services.production.tick();
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);assert.equal(f.control.recommendations.length,1);
 await f.json(`sessions/${id}/frame-count`,'POST',{count:9});await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,9);
});

test('background and foreground stories share the global image cap across coordinators',async t=>{
 const f=await productionFixture(t),a=await f.create(10),b=await f.create(10);
 const second=new ReaderProductionCoordinator(f.app.services.database,f.generation,f.media);f.coordinators.push(second);
 await control(f,a,'background');await f.demand(b);await until(()=>f.control.calls.length===2);for(const call of f.control.calls)call.resolve();await until(()=>f.control.active===3);
 await second.tick();await turn();assert.equal(f.control.maxActive,3);
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(a)).state==='completed'&&(await f.read(b)).ready===7);
 assert.equal(f.control.calls.length,17);assert.equal(f.control.maxActive,3);
});

test('controls validate owner, origin, body and completed sessions; pause does not require provider access',async t=>{
 const f=await productionFixture(t),id=await f.create();
 for(const body of [{action:'invalid'},{action:'resume',ownerId:'foreign'},{}])assert.equal((await f.request(`sessions/${id}/production-control`,'POST',body)).status,400);
 assert.equal((await f.request(`sessions/${id}/production-control`,'POST',{action:'background'},{Origin:'https://evil.example'})).status,403);
 await assert.rejects(f.app.services.production.control('foreign',id,'background'),error=>error.status===404);
 await f.json(`library/${id}`,'DELETE');assert.equal((await f.request(`sessions/${id}/production-control`,'POST',{action:'resume'})).status,404);
 const done=await f.create();f.control.hold=false;await control(f,done,'background');await until(async()=>(await f.read(done)).state==='completed');
 assert.equal((await f.request(`sessions/${done}/production-control`,'POST',{action:'background'})).status,409);
 const paused=await f.create();f.generation.status=async()=>({configured:false});assert.equal((await f.request(`sessions/${paused}/production-control`,'POST',{action:'pause'})).status,200);
});

for(const provider of ['codex','gemini'])test(`${provider}: an expired missing remote result resumes automatically but saved images do not repeat`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(10);f.control.hold=false;await f.demand(id);await until(async()=>(await f.read(id)).ready===7);await f.stop();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 db.prepare("UPDATE reader_sessions SET generation_mode='background',document=json_set(document,'$.images[6]',''),state='running',lock_token='crashed',lock_until=1 WHERE id=?").run(id);
 db.prepare("UPDATE production_jobs SET state='running',result=NULL,lease_token='crashed',lease_until=1 WHERE session_id=? AND kind='image' AND json_extract(payload,'$.page')=6").run(id);
 db.prepare("UPDATE production_jobs SET state='queued',result=NULL WHERE session_id=? AND kind='image-publish' AND json_extract(payload,'$.page')=6").run(id);db.close();
 await f.restart();await until(async()=>(await f.read(id)).state==='completed');
 assert.equal(f.control.calls.length,11);assert.equal(f.control.calls.filter(c=>c.page===6).length,2);
 assert.ok(f.control.calls.filter(c=>c.page!==6).every((call,index,all)=>all.findIndex(other=>other.page===call.page)===index));
});

test('startup reconciles a fully published background story whose final session save was interrupted',async t=>{
 const f=await productionFixture(t),id=await f.create();f.control.hold=false;await control(f,id,'background');await until(async()=>(await f.read(id)).state==='completed');await f.stop();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 db.prepare("UPDATE reader_sessions SET state='running',lock_token='dead-finalizer',lock_until=1 WHERE id=?").run(id);db.close();
 await f.restart();await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,8);assert.equal(f.control.plans.length,1);
});

test('a concurrent mode change cannot overwrite another window’s manual pause',async t=>{
 const f=await productionFixture(t),id=await f.create(),repo=new ReaderRepository(f.app.services.database),get=repo.get.bind(repo);
 let release,observed;const gate=new Promise(resolve=>release=resolve),read=new Promise(resolve=>observed=resolve);let first=true;
 repo.get=async(...args)=>{const row=await get(...args);if(first){first=false;observed();await gate;}return row;};
 const toggle=repo.control(id,owner,'background');await read;await control(f,id,'pause');release();await toggle;
 const s=await f.read(id);assert.equal(s.generationMode,'background');assert.equal(s.generationControl,'paused');
 await f.app.services.production.tick();assert.equal(f.control.calls.length,0);assert.equal(f.control.plans.length,0);
});

test('upgrading an existing library preserves checkpoints and gives old stories reader-mode defaults',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE app_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
 for(const file of readdirSync('drizzle').filter(name=>name.endsWith('.sql')&&!name.startsWith('0004')).sort()){
  db.exec(readFileSync(path.join('drizzle',file),'utf8'));db.prepare('INSERT INTO app_migrations VALUES(?,?)').run(file,'before-upgrade');
 }
 db.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,state,page,saved,created_at,updated_at) VALUES('legacy','owner','{}',?, 'idle',3,1,'created','updated')").run(JSON.stringify({plan:{title:'saved'},images:['saved.png'],usage:[{step:'image:0'}]}));
 db.prepare("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,created_at,updated_at) VALUES('job','legacy','owner','image','image','v','[]','{}','saved-result','succeeded',1,2)").run();
 const before=db.prepare('SELECT * FROM reader_sessions').get(),job=db.prepare('SELECT * FROM production_jobs').get();
 migrate(db,process.cwd());
 const after=db.prepare('SELECT * FROM reader_sessions').get(),savedJob=db.prepare('SELECT * FROM production_jobs').get();
 assert.deepEqual({...after,generation_mode:undefined,generation_control:undefined},{...before,generation_mode:undefined,generation_control:undefined});
 assert.equal(after.generation_mode,'reader');assert.equal(after.generation_control,'active');
 assert.deepEqual({...savedJob,interrupted:undefined},{...job,interrupted:undefined});assert.equal(savedJob.interrupted,0);
 migrate(db,process.cwd());assert.deepEqual(db.prepare('SELECT * FROM reader_sessions').get(),after);
});
