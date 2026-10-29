// Verify continuous production through REST, real SQLite/files, and both controlled providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn,encoded} from './fixtures/production.mjs';
import {advanceStory} from '../lib/reader-engine.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {configuredImageWorkers,ReaderProductionCoordinator} from '../server/reader-production.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';

for(const provider of ['codex','gemini'])test(`${provider}: early demand, single anchor, rolling refill, individual visibility and moving lookahead`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(),viewer=crypto.randomUUID();
 const response=await f.request(`sessions/${id}/production`,'POST',{viewerId:viewer,page:0});assert.equal(response.status,202);assert.equal(f.control.calls.length,0);
 await until(()=>f.control.calls.length===1);assert.equal(f.control.calls[0].page,0);await turn();assert.equal(f.control.calls.length,1);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);assert.deepEqual(f.control.calls.slice(1).map(c=>c.page).sort(),[1,2,3]);
 assert.ok(f.control.calls.slice(1).every(c=>c.reference===encoded));
 f.control.calls.find(c=>c.page===2).resolve();await until(()=>f.control.calls.length===5);assert.equal(f.control.calls.at(-1).page,4);
 const partial=await f.read(id);assert.ok(partial.story.pages[2].image);assert.equal(partial.story.pages[1].image,'');assert.equal(partial.ready,2);
 const artifact=await f.request(partial.story.pages[2].image.replace('/api/reader/',''));assert.equal(artifact.status,200);assert.equal(artifact.headers.get('content-type'),'image/png');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===7);
 assert.equal(f.control.calls.some(c=>c.page===7),false);assert.equal(f.control.maxActive,3);assert.equal(f.control.plans.length,1);
 await f.demand(id,viewer,1);await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,8);
 const stored=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();
 const doc=JSON.parse(stored.document);assert.equal(doc.usage.filter(u=>u.step.startsWith('image:')).length,8);assert.ok(doc.original);
 assert.ok(f.control.calls.every(c=>c.prompt.includes('quiet narration')));
});

test('image concurrency is configurable and global across stories; text/source are not repeated',async t=>{
 const f=await productionFixture(t,'codex',{SHIQU_IMAGE_WORKERS:'4'}),a=await f.create(),b=await f.create();
 await f.demand(a);await f.demand(b);await until(()=>f.control.calls.length===2);assert.ok(f.control.calls.every(c=>c.page===0));
 for(const call of f.control.calls)call.resolve();await until(()=>f.control.active===4);await turn();assert.equal(f.control.maxActive,4);
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(a)).ready===7&&(await f.read(b)).ready===7);
 assert.equal(f.control.maxActive,4);assert.equal(f.control.plans.length,2);
 assert.equal(configuredImageWorkers(),3);for(const invalid of ['0','9','2.5','many'])assert.throws(()=>configuredImageWorkers(invalid));
});

test('one viewer leaving preserves another; all leaving drains paid results and pauses new generation',async t=>{
 const f=await productionFixture(t),id=await f.create(),a=crypto.randomUUID(),b=crypto.randomUUID();
 await f.demand(id,a);await f.demand(id,b);await until(()=>f.control.calls.length===1);await f.leave(id,a);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);await f.leave(id,b);
 for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===4);await f.app.services.production.tick();
 assert.equal(f.control.calls.length,4);assert.equal((await f.read(id)).state,'idle');
 f.control.hold=false;await f.demand(id,a);await until(async()=>(await f.read(id)).ready===7);assert.equal(f.control.calls.length,7);
});

test('expired viewer demand stops dispatch even if the browser never sends leave',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.demand(id);await until(()=>f.control.calls.length===1);
 await f.app.services.database.prepare('UPDATE production_demand SET expires_at=0').run();f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).ready===1);await f.app.services.production.tick();assert.equal(f.control.calls.length,1);
});

test('deletion hides a story immediately while retaining every in-flight image and receipt',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 await f.json(`library/${id}`,'DELETE');for(const call of f.control.calls)call.resolve();
 await until(async()=>{const stored=await f.app.services.database.prepare('SELECT document,state FROM reader_sessions WHERE id=?').bind(id).first();return JSON.parse(stored.document).images.filter(Boolean).length===4&&stored.state!=='running';});
 assert.equal((await f.request(`sessions/${id}`)).status,404);assert.equal((await f.request(`media/${id}/1.png`)).status,404);assert.equal(f.control.calls.length,4);
 assert.equal((await f.request(`sessions/${id}/production`,'POST',{viewerId:crypto.randomUUID(),page:0})).status,404);
 assert.equal((await f.app.services.production.queue.jobs(id,'docker-local-owner')).filter(j=>j.kind==='image'&&j.state==='succeeded').length,4);
});

test('local publication failure and legacy retry reuse the paid receipt and record usage once',async t=>{
 const f=await productionFixture(t),id=await f.create();let blocked=true;
 const readMedia=f.app.services.media.get.bind(f.app.services.media);
 f.app.services.media.get=async key=>{if(blocked&&key.startsWith(`reader/${id}/artifacts/1-`))throw Error('controlled disk read failure');return readMedia(key);};
 await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 f.control.calls.find(c=>c.page===1).resolve();await until(async()=>(await f.app.services.production.queue.jobs(id,'docker-local-owner')).some(j=>j.kind==='image-publish'&&j.state==='failed'));
 for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).state==='failed');assert.equal(f.control.calls.length,4);
 const failed=await f.read(id);assert.equal(failed.retryMayCharge,false);assert.equal(failed.story.pages[1].image,'');
 blocked=false;f.control.hold=false;await f.json(`sessions/${id}/advance`,'POST',{throughPage:6,retry:true});
 await until(async()=>(await f.read(id)).ready===7);assert.equal(f.control.calls.filter(c=>c.page===1).length,1);
 const stored=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();assert.equal(JSON.parse(stored.document).usage.filter(u=>u.step==='image:1').length,1);
});

test('paid failure stops refill, keeps sibling successes and retry only draws missing scenes',async t=>{
 const f=await productionFixture(t),id=await f.create(),viewer=crypto.randomUUID();await f.demand(id,viewer);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 f.control.calls.find(c=>c.page===2).reject(Error('controlled provider failure'));
 await until(async()=>(await f.app.services.production.queue.jobs(id,'docker-local-owner')).some(j=>j.kind==='image'&&j.state==='failed'));
 for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).state==='failed');assert.equal(f.control.calls.length,4);assert.equal((await f.read(id)).ready,3);
 f.control.hold=false;await f.demand(id,viewer,0,true);await until(async()=>(await f.read(id)).ready===7);
 assert.equal(f.control.calls.filter(c=>c.page===2).length,2);assert.equal(f.control.calls.filter(c=>c.page===1).length,1);assert.equal(f.control.plans.length,1);
});

test('restart before viewer expiry never resumes paid work until a fresh viewer request',async t=>{
 const f=await productionFixture(t),id=await f.create();f.control.hold=false;await f.demand(id);await until(async()=>(await f.read(id)).ready===7);
 await f.demand(id,crypto.randomUUID(),1);f.app.stopGeneration();await f.restart();await f.app.services.production.tick();
 assert.equal(f.control.calls.length,7);assert.equal((await f.read(id)).ready,7);
 await f.demand(id,crypto.randomUUID(),1);await until(async()=>(await f.read(id)).ready===8);assert.equal(f.control.calls.length,8);assert.equal(f.control.plans.length,1);
});

test('session and job heartbeats fence legacy advances while slow images are still running',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.demand(id);await until(()=>f.control.calls.length===1);
 await f.app.services.database.prepare('UPDATE reader_sessions SET lock_until=? WHERE id=?').bind(Date.now()+1000,id).run();
 await f.app.services.database.prepare("UPDATE production_jobs SET lease_until=? WHERE state='running'").bind(Date.now()+1000).run();
 await f.app.services.production.tick();const row=await new ReaderRepository(f.app.services.database).get(id,'docker-local-owner');assert.ok(row.lock_until>Date.now()+100000);
 const duplicate=await advanceStory(new ReaderRepository(f.app.services.database),f.generation.generator(),'docker-local-owner',id,6,true);assert.equal(duplicate.state,'running');assert.equal(f.control.calls.length,1);
 assert.ok((await f.app.services.production.queue.jobs(id,'docker-local-owner')).filter(j=>j.state==='running').every(j=>j.lease_until>Date.now()+100000));
});

test('shutdown stops dispatch before draining in-flight outputs and closes SQLite after publication',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 const close=f.app.close();assert.equal(f.control.calls.length,4);for(const call of f.control.calls)call.resolve();await close;
 assert.equal(f.control.calls.length,4);await f.restart();assert.equal((await f.read(id)).ready,4);assert.equal(f.control.calls.length,4);
});

test('queue routes validate input/origin and use server owner identity',async t=>{
 const f=await productionFixture(t),id=await f.create(),viewerId=crypto.randomUUID();
 for(const body of [{viewerId:'bad',page:0},{viewerId,page:60},{viewerId,page:-1},{viewerId,page:1.5}])assert.equal((await f.request(`sessions/${id}/production`,'POST',body)).status,400);
 assert.equal((await f.request(`sessions/${id}/production`,'POST',{viewerId,page:0},{Origin:'https://evil.example'})).status,403);
 await assert.rejects(f.app.services.production.request('another-owner',id,viewerId,0),e=>e.status===404);
 assert.equal(await f.app.services.production.managed('another-owner',id),false);
});

for(const provider of ['codex','gemini'])test(`${provider}: immutable attempts and exact same-story anchor validation protect replacement bytes`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(),original=f.app.services.production;
 await f.demand(id);await until(()=>f.control.calls.length===1);original.stop();
 // Simulate a crashed owner's expired claims while its remote result arrives late.
 await f.app.services.database.prepare("UPDATE production_jobs SET lease_until=1 WHERE state='running'").run();
 await f.app.services.database.prepare("UPDATE reader_sessions SET state='failed',lock_token=NULL,lock_until=0 WHERE id=?").bind(id).run();
 const replacement=new ReaderProductionCoordinator(f.app.services.database,f.generation,f.app.services.media);
 f.coordinators.push(replacement);
 await replacement.request('docker-local-owner',id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===2);
 f.control.calls[1].bytes=Buffer.concat([Buffer.from(encoded,'base64'),Buffer.from([2])]).toString('base64');f.control.calls[1].resolve();
 await until(async()=>(await replacement.snapshot('docker-local-owner',id)).ready===1);replacement.stop();
 const saved=(await replacement.snapshot('docker-local-owner',id)).story.pages[0].image,key=referenceImageKey(id,saved),before=(await f.media.get(key)).body;
 f.control.calls[0].bytes=Buffer.concat([Buffer.from(encoded,'base64'),Buffer.from([1])]).toString('base64');f.control.calls[0].resolve();await original.queue.settle();
 assert.equal((await replacement.snapshot('docker-local-owner',id)).story.pages[0].image,saved);assert.deepEqual((await f.media.get(key)).body,before);
 const row=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();assert.equal(JSON.parse(row.document).usage.filter(u=>u.step==='image:0').length,1);
 for(const reference of [saved.replace(id,crypto.randomUUID()),saved.replace('/artifacts/','/artifacts/../'),saved.replace('/0-','/1-'),saved.replace('.png','.svg')]){
  assert.equal(referenceImageKey(id,reference),null);const count=f.control.calls.length;
  await assert.rejects(f.generation.generator().image(JSON.parse(row.document).plan,1,id,reference));assert.equal(f.control.calls.length,count);
 }
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await replacement.close();
});

test('publication must own its job token as well as the session token',async t=>{
 const f=await productionFixture(t),id=await f.create();let release,entered=false;
 const gate=new Promise(resolve=>release=resolve),get=f.app.services.media.get.bind(f.app.services.media);
 f.app.services.media.get=async key=>{if(key.startsWith(`reader/${id}/artifacts/0-`)){entered=true;await gate;}return get(key);};
 await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>entered);
 const job=(await f.app.services.production.queue.jobs(id,'docker-local-owner')).find(j=>j.kind==='image-publish'&&j.state==='running');
 await f.app.services.database.prepare("UPDATE production_jobs SET lease_token='replacement' WHERE id=?").bind(job.id).run();release();await f.app.services.production.queue.settle();
 const row=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();assert.equal(JSON.parse(row.document).images[0],'');assert.equal(JSON.parse(row.document).usage.filter(u=>u.step==='image:0').length,0);
 await f.app.services.database.prepare('UPDATE production_jobs SET lease_until=1 WHERE id=?').bind(job.id).run();
});
