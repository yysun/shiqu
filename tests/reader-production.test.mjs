// Verify continuous production through REST, real SQLite/files, and both controlled providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn,encoded,makePlan} from './fixtures/production.mjs';
import {advanceStory} from '../lib/reader-engine.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {configuredImageWorkers,ReaderProductionCoordinator} from '../server/reader-production.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

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

test('reference validation accepts reordered same-story assets and rejects malformed or out-of-range paths',()=>{
 for(const page of [0,1,6,59])for(const extension of ['png','jpg','webp'])for(const artifactId of [undefined,'a'.repeat(64)]){
  const asset=readerImageAsset('story',page,extension,artifactId);
  assert.equal(referenceImageKey('story',asset.url),asset.key);
 }
 for(const file of ['60.png','-1.png','1.5.png','01.png','1.svg','artifacts/60-'+'a'.repeat(64)+'.png','artifacts/1-short.png','artifacts/1-'+'a'.repeat(64)+'.png/extra','../other/1.png','%2e%2e/1.png','1.png?other=1','1.png\n']){
  assert.equal(referenceImageKey('story','/api/reader/media/story/'+file),null,file);
 }
 assert.equal(referenceImageKey('story','/api/reader/media/other/1.png'),null);
});

for(const provider of ['codex','gemini'])test(`${provider}: reordered story resumes at page 11 after restart without regenerating ten saved images`,async t=>{
 const f=await productionFixture(t,provider,{SHIQU_IMAGE_WORKERS:'1'}),id=await f.create(30);
 const images=Array(30).fill(''),bytes=Buffer.from(encoded,'base64');
 // The original first image moved to page 7; the new first image retains its original filename.
 for(const [page,originalPage] of [1,2,3,4,5,6,0,7,8,9].entries()){
  const asset=readerImageAsset(id,originalPage,'png','a'.repeat(64));
  await f.media.put(asset.key,bytes,{contentType:'image/png'});images[page]=asset.url;
 }
 const doc={plan:makePlan(30),original:{title:'庄周梦蝶',text:'庄周梦为胡蝶。',url:'https://example.com/original',kind:'passage',provider:'fixture',retrievedAt:new Date().toISOString()},images,audio:[],usage:[]};
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=?,state='failed',error='previous failure',page=10 WHERE id=?").bind(JSON.stringify(doc),id).run();
 await f.restart();f.control.hold=true;
 assert.equal((await f.read(id)).ready,10);assert.equal(f.control.calls.length,0);
 const viewer=crypto.randomUUID();await f.demand(id,viewer,10,true);
 await until(()=>f.control.calls.length===1);
 assert.equal(f.control.calls[0].page,10);assert.equal(f.control.calls[0].reference,encoded);
 await f.leave(id,viewer);f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).ready===11);
 const resumed=await f.read(id);
 assert.deepEqual(resumed.story.pages.slice(0,10).map(p=>p.image),images.slice(0,10));
 for(const image of images.slice(0,10))assert.deepEqual(Buffer.from((await f.media.get(referenceImageKey(id,image))).body),bytes);
 assert.equal(f.control.calls.length,1);assert.equal(f.control.plans.length,0);
 const stored=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();
 assert.deepEqual(JSON.parse(stored.document).usage.map(u=>u.step),['image:10']);
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
 for(const reference of [saved.replace(id,crypto.randomUUID()),saved.replace('/artifacts/','/artifacts/../'),saved.replace('/0-','/60-'),saved.replace('.png','.svg')]){
  assert.equal(referenceImageKey(id,reference),null);const count=f.control.calls.length;
  await assert.rejects(f.generation.generator().image(JSON.parse(row.document).plan,1,id,reference));assert.equal(f.control.calls.length,count);
 }
 const count=f.control.calls.length;
 await assert.rejects(f.generation.generator().image(JSON.parse(row.document).plan,1,id,saved.replace('/0-','/1-')));
 assert.equal(f.control.calls.length,count,'A valid-looking but missing reference must fail before inference');
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

for(const provider of ['codex','gemini'])test(`${provider}: confirmation gates paid script/images for auto and identical numeric selections`,async t=>{
 const f=await productionFixture(t,provider);f.control.hold=false;
 for(const initial of ['auto',7]){
  const id=await f.create(initial,{narrativeDetail:'balanced'}),viewer=crypto.randomUUID(),plans=f.control.plans.length,images=f.control.calls.length,recommendations=f.control.recommendations.length;
  await f.demand(id,viewer);await until(async()=>(await f.read(id)).awaitingFrameCount);
  assert.equal(f.control.plans.length,plans);assert.equal(f.control.calls.length,images);assert.equal(f.control.recommendations.length,recommendations+1);
  await f.leave(id,viewer);await f.restart();await f.demand(id,viewer);await f.app.services.production.tick();
  assert.equal(f.control.recommendations.length,recommendations+1);assert.equal(f.control.plans.length,plans);assert.equal(f.control.calls.length,images);
  await f.json(`sessions/${id}/frame-count`,'POST',{count:7});await f.demand(id,viewer);
  await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.plans.length,plans+1);assert.equal(f.control.calls.length,images+7);
  const jobs=await f.app.services.production.queue.jobs(id,'docker-local-owner');assert.equal(jobs.filter(j=>j.kind==='prepare').length,1);assert.equal(jobs.filter(j=>j.kind==='script'&&j.state==='succeeded').length,1);
 }
});

test('slow script preparation renews its session lease and excludes a legacy planner',async t=>{
 const f=await productionFixture(t),id=await f.create();let release,started=false;
 const gate=new Promise(resolve=>release=resolve),generator=f.generation.generator.bind(f.generation);
 t.after(()=>release());
 f.generation.generator=()=>{const value=generator();return {...value,async plan(...args){started=true;await gate;return value.plan(...args);}};};
 await f.demand(id);await until(()=>started);
 await f.app.services.database.prepare('UPDATE reader_sessions SET lock_until=? WHERE id=?').bind(Date.now()+1000,id).run();await f.app.services.production.tick();
 const row=await new ReaderRepository(f.app.services.database).get(id,'docker-local-owner');assert.ok(row.lock_until>Date.now()+100000);
 const duplicate=await advanceStory(new ReaderRepository(f.app.services.database),generator(),'docker-local-owner',id,0,true);assert.equal(duplicate.state,'running');assert.equal(f.control.plans.length,0);
 release();await until(()=>f.control.calls.length===1);assert.equal(f.control.plans.length,1);
});

test('deleted pending publication with an expired pre-restart lease cannot poison another story',async t=>{
 const f=await productionFixture(t),id=await f.create();f.control.hold=false;await f.demand(id);await until(async()=>(await f.read(id)).ready===7);
 const jobs=await f.app.services.production.queue.jobs(id,'docker-local-owner'),publication=jobs.find(j=>j.kind==='image-publish'&&JSON.parse(j.payload).page===1);
 await f.json(`library/${id}`,'DELETE');await f.app.close();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 db.prepare("UPDATE reader_sessions SET document=json_set(document,'$.images[1]',''),state='running',lock_token='dead-owner',lock_until=1 WHERE id=?").run(id);
 db.prepare("UPDATE production_jobs SET state='queued',result=NULL WHERE id=?").run(publication.id);db.close();
 await f.restart();const live=await f.create();await f.demand(live);
 await until(async()=>(await f.read(live)).ready===7);
 await until(async()=>{const row=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();return !!JSON.parse(row.document).images[1];});
 assert.equal(f.control.calls.length,14);assert.equal((await f.request(`sessions/${id}`)).status,404);
});

test('shrinking lookahead after backtracking reports a full buffer idle despite outstanding later jobs',async t=>{
 const f=await productionFixture(t),id=await f.create(30),viewer=crypto.randomUUID();f.control.hold=false;await f.demand(id,viewer);await until(async()=>(await f.read(id)).ready===7);
 f.control.hold=true;await f.demand(id,viewer,10);await until(()=>f.control.active===3);
 await f.demand(id,viewer,0);for(const call of f.control.calls)call.resolve();await until(()=>f.control.active===0);
 await until(async()=>(await f.read(id)).state==='idle');
 const jobs=await f.app.services.production.queue.jobs(id,'docker-local-owner');assert.ok(jobs.some(j=>j.kind==='image'&&j.state==='queued'&&JSON.parse(j.payload).page>6));
 assert.equal((await f.read(id)).state,'idle');assert.equal(f.control.calls.length,10);
});
