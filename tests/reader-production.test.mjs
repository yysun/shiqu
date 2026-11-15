// Verify continuous production through REST, real SQLite/files, and both controlled providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn,encoded,makePlan} from './fixtures/production.mjs';
import {imageBytes} from './fixtures/images.mjs';
import {withLocalBooks} from '../server/local-generation.ts';
import {LocalBooks} from '../server/local-books.ts';
import {generationProgress} from '../lib/generation-progress.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {configuredImageWorkers,ReaderProductionCoordinator} from '../server/reader-production.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {flowProviders} from './fixtures/test-tier.mjs';

test('可选横图按原幅生成，重启后只重试失败或丢失的横图',async t=>{
 const f=await productionFixture(t,'codex'),id=await f.create(),route=`sessions/${id}/landscape`,db=f.app.services.database;
 const checkpoint=()=>f.app.services.database.prepare('SELECT state,document,selection FROM stories WHERE id=?').bind(id).first();
 assert.equal((await f.json(route)).available,false);
 const placeholder={startToken:'0'.repeat(64)};
 assert.equal((await f.request(route,'POST',placeholder)).status,409);
 f.control.hold=false;
 await until(async()=>(await f.read(id)).state==='completed');
 const original=await checkpoint(),story=(await f.read(id)).story;
 const idle=await f.json(route);assert.equal(idle.state,'idle');
 assert.equal(f.control.calls.filter(call=>call.landscape).length,0);
 f.control.hold=true;
 await f.json(route,'POST',placeholder);assert.equal((await f.json(route)).state,'idle');
 const start={startToken:idle.startToken};
 await Promise.all([f.json(route,'POST',start),f.json(route,'POST',start)]);
 await until(()=>f.control.calls.some(call=>call.landscape));
 const bad=f.control.calls.find(call=>call.landscape);bad.bytes=encoded;
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>(await f.json(route)).state==='partial');
 const partial=await f.json(route),calls=f.control.calls.filter(call=>call.landscape);
 assert.equal(partial.ready,story.pages.length-1);assert.deepEqual(partial.failed,[bad.page+1]);
 assert.equal(calls.length,story.pages.length);
 assert.ok(calls.every(call=>call.reference===encoded&&call.prompt.includes(story.pages[call.page].caption)));
 assert.deepEqual(await checkpoint(),original);
 assert.equal((await f.read(id)).state,'completed');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM reader_faults WHERE session_id=?').bind(id).first()).n,0);
 await f.restart();
 assert.deepEqual(await f.json(route),partial);
 await Promise.all([f.json(route,'POST',{retryToken:partial.retryToken}),f.json(route,'POST',{retryToken:partial.retryToken})]);
 await until(async()=>(await f.json(route)).state==='completed');
 const complete=await f.json(route);
 assert.equal(complete.ready,story.pages.length);
 assert.equal(f.control.calls.filter(call=>call.landscape).length,calls.length+1);
 assert.equal(f.control.calls.at(-1).page,bad.page);
 partial.images.forEach((url,index)=>{if(url)assert.equal(complete.images[index],url);});
 assert.ok(complete.images.every((url,index)=>url!==story.pages[index].image));
 assert.equal((await f.request(complete.images[0].replace('/api/reader/',''))).status,200);
 const key=referenceImageKey(id,complete.images[0]);
 await f.media.put(key,Buffer.from(encoded,'base64'),{contentType:'image/png'});
 const damaged=await f.json(route);assert.deepEqual(damaged.failed,[1]);assert.equal(damaged.state,'partial');
 await f.json(route,'POST',{retryToken:partial.retryToken});
 assert.equal((await f.json(route)).retryToken,damaged.retryToken);
 await f.json(route,'POST',{retryToken:damaged.retryToken});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.equal(f.control.calls.filter(call=>call.landscape).length,calls.length+2);
 assert.deepEqual(await checkpoint(),original);
 await f.json(`library/${id}`,'DELETE');
 assert.equal((await f.request(route)).status,404);
 assert.equal((await f.request(route,'POST',start)).status,404);
 await f.json(`library/${id}/restore`,'POST',{});
 assert.equal((await f.json(route)).state,'completed');
 const token=(await f.json(`sessions/${id}/revisions`)).token;
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token,changes:{artStyle:'watercolor'},paused:true});
 assert.equal((await f.json(route)).available,false);
 assert.equal((await f.request(route,'POST',start)).status,409);
});

test('重新生图先重绘竖图，再自动重绘同幅横图并继承其余可用横图',async t=>{
 const f=await productionFixture(t),id=await f.create(),route=`sessions/${id}/landscape`,page=1,missing=3;
 f.control.hold=false;
 await until(async()=>(await f.read(id)).state==='completed');
 const {startToken}=await f.json(route);
 await f.json(route,'POST',{startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const original=await f.json(route),before=f.control.calls.length;
 const missingKey=referenceImageKey(id,original.images[missing]);
 await f.media.put(missingKey,Buffer.from(encoded,'base64'),{contentType:'image/png'});
 const {token}=await f.json(`sessions/${id}/revisions`),note='调暗背景光线';
 const request={requestId:crypto.randomUUID(),token,changes:{redrawPages:[page+1],redrawNotes:{[page+1]:note}},paused:true};
 const child=await f.json(`sessions/${id}/revisions`,'POST',request),childRoute=`sessions/${child.id}/landscape`;
 await f.restart();
 assert.equal((await f.read(child.id)).generationControl,'paused');
 assert.equal(f.control.calls.length,before);
 f.control.hold=true;
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'resume'});
 await until(()=>f.control.calls.length===before+1);
 const portrait=f.control.calls[before],replacement=Buffer.from(imageBytes('portrait.jpg')).toString('base64');
 assert.equal(portrait.page,page);assert.equal(portrait.landscape,false);
 assert.equal((await f.json(childRoute)).available,false);
 portrait.bytes=replacement;portrait.resolve();
 await until(()=>f.control.calls.length===before+2);
 const landscape=f.control.calls[before+1];
 assert.equal(landscape.page,page);assert.equal(landscape.landscape,true);
 assert.equal(landscape.reference,replacement);assert.ok(landscape.prompt.includes(note));
 const running=await f.json(childRoute);
 assert.equal(running.ready,original.total-2);
 f.control.hold=false;landscape.resolve();
 await until(async()=>(await f.json(childRoute)).state==='partial');
 const partial=await f.json(childRoute);
 assert.equal(partial.ready,original.total-1);assert.equal(partial.images[missing],'');
 assert.equal(f.control.calls.length,before+2);
 for(const [index,url] of partial.images.entries())if(index!==page&&url){
  const a=await f.media.get(referenceImageKey(id,original.images[index])),b=await f.media.get(referenceImageKey(child.id,url));
  assert.deepEqual(a.body,b.body);
 }
 assert.equal((await f.json(`sessions/${id}/revisions`,'POST',request)).id,child.id);
 await f.json(childRoute,'POST',{startToken:partial.startToken});
 await until(async()=>(await f.json(childRoute)).state==='completed');
 assert.equal(f.control.calls.length,before+3);assert.equal(f.control.calls.at(-1).page,missing);
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: early demand, single anchor, rolling refill, individual visibility and moving lookahead`,async t=>{
 const f=await productionFixture(t,provider),id=await f.createLegacyReader(),viewer=crypto.randomUUID();
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
 const stored=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first();
 const doc=JSON.parse(stored.document);assert.equal(doc.usage.filter(u=>u.step.startsWith('image:')).length,8);assert.ok(doc.original);
 assert.ok(f.control.calls.every(c=>c.prompt.includes('quiet narration')));
});

test('image concurrency is configurable and global across stories; text/source are not repeated',async t=>{
 const f=await productionFixture(t,'codex',{SHIQU_IMAGE_WORKERS:'4'}),a=await f.createLegacyReader(),b=await f.createLegacyReader();
 await f.demand(a);await f.demand(b);await until(()=>f.control.calls.length===2);assert.ok(f.control.calls.every(c=>c.page===0));
 for(const call of f.control.calls)call.resolve();await until(()=>f.control.active===4);await turn();assert.equal(f.control.maxActive,4);
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(a)).ready===7&&(await f.read(b)).ready===7);
 assert.equal(f.control.maxActive,4);assert.equal(f.control.plans.length,2);
 assert.equal(configuredImageWorkers(),3);for(const invalid of ['0','9','2.5','many'])assert.throws(()=>configuredImageWorkers(invalid));
});

test('one viewer leaving preserves another; all leaving drains paid results and pauses new generation',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(),a=crypto.randomUUID(),b=crypto.randomUUID();
 await f.demand(id,a);await f.demand(id,b);await until(()=>f.control.calls.length===1);await f.leave(id,a);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);await f.leave(id,b);
 for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===4);await f.app.services.production.tick();
 assert.equal(f.control.calls.length,4);assert.equal((await f.read(id)).state,'idle');
 f.control.hold=false;await f.demand(id,a);await until(async()=>(await f.read(id)).ready===7);assert.equal(f.control.calls.length,7);
});

test('expired viewer demand stops dispatch even if the browser never sends leave',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();await f.demand(id);await until(()=>f.control.calls.length===1);
 await f.app.services.database.prepare('UPDATE production_demand SET expires_at=0').run();f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).ready===1);await f.app.services.production.tick();assert.equal(f.control.calls.length,1);
 // A claim shows in the job row at once; its provider call only appears after asynchronous file reads.
 assert.equal((await f.app.services.production.queue.jobs(id,'docker-local-owner')).filter(job=>job.kind==='image'&&job.state==='running').length,0);
});

test('deletion hides a story immediately while retaining every in-flight image and receipt',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 await f.json(`library/${id}`,'DELETE');for(const call of f.control.calls)call.resolve();
 await until(async()=>{const stored=await f.app.services.database.prepare('SELECT document,state FROM stories WHERE id=?').bind(id).first();return JSON.parse(stored.document).images.filter(Boolean).length===4&&stored.state!=='running';});
 assert.equal((await f.request(`sessions/${id}`)).status,404);assert.equal((await f.request(`media/${id}/1.png`)).status,404);assert.equal(f.control.calls.length,4);
 assert.equal((await f.request(`sessions/${id}/production`,'POST',{viewerId:crypto.randomUUID(),page:0})).status,404);
 assert.equal((await f.app.services.production.queue.jobs(id,'docker-local-owner')).filter(j=>j.kind==='image'&&j.state==='succeeded').length,4);
});

test('local publication failure and legacy retry reuse the paid receipt and record usage once',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();let blocked=true;
 const readMedia=f.app.services.media.get.bind(f.app.services.media);
 f.app.services.media.get=async key=>{if(blocked&&key.startsWith(`reader/${id}/artifacts/1-`))throw Error('controlled disk read failure');return readMedia(key);};
 await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 f.control.calls.find(c=>c.page===1).resolve();await until(async()=>(await f.app.services.production.queue.jobs(id,'docker-local-owner')).some(j=>j.kind==='image-publish'&&j.state==='failed'));
 for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).state==='failed');assert.equal(f.control.calls.length,4);
 const failed=await f.read(id);assert.equal(failed.retryStage,'publication');assert.equal(failed.story.pages[1].image,'');
 blocked=false;f.control.hold=false;await f.demand(id,crypto.randomUUID(),0,true);
 await until(async()=>(await f.read(id)).ready===7);assert.equal(f.control.calls.filter(c=>c.page===1).length,1);
 const stored=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first();assert.equal(JSON.parse(stored.document).usage.filter(u=>u.step==='image:1').length,1);
});

test('paid failure stops refill, keeps sibling successes and retry only draws missing scenes',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(),viewer=crypto.randomUUID();await f.demand(id,viewer);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 f.control.calls.find(c=>c.page===2).reject(Error('controlled provider failure'));
 await until(async()=>(await f.app.services.production.queue.jobs(id,'docker-local-owner')).some(j=>j.kind==='image'&&j.state==='failed'));
 for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).state==='failed');assert.equal(f.control.calls.length,4);assert.equal((await f.read(id)).ready,3);
 f.control.hold=false;await f.demand(id,viewer,0,true);await until(async()=>(await f.read(id)).ready===7);
 assert.equal(f.control.calls.filter(c=>c.page===2).length,2);assert.equal(f.control.calls.filter(c=>c.page===1).length,1);assert.equal(f.control.plans.length,1);
});

test('restart before viewer expiry never resumes paid work until a fresh viewer request',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();f.control.hold=false;await f.demand(id);await until(async()=>(await f.read(id)).ready===7);
 await f.demand(id,crypto.randomUUID(),1);f.app.stopGeneration();await f.restart();await f.app.services.production.tick();
 assert.equal(f.control.calls.length,7);assert.equal((await f.read(id)).ready,7);
 await f.demand(id,crypto.randomUUID(),1);await until(async()=>(await f.read(id)).ready===8);assert.equal(f.control.calls.length,8);assert.equal(f.control.plans.length,1);
});

test('session and job heartbeats fence legacy advances while slow images are still running',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();await f.demand(id);await until(()=>f.control.calls.length===1);
 await f.app.services.database.prepare('UPDATE stories SET lock_until=? WHERE id=?').bind(Date.now()+1000,id).run();
 await f.app.services.database.prepare("UPDATE production_jobs SET lease_until=? WHERE state='running'").bind(Date.now()+1000).run();
 await f.app.services.production.tick();const row=await new ReaderRepository(f.app.services.database).get(id,'docker-local-owner');assert.ok(row.lock_until>Date.now()+100000);
 const duplicate=await advanceStory(new ReaderRepository(f.app.services.database),f.generation.generator(),'docker-local-owner',id,6,true);assert.equal(duplicate.state,'running');assert.equal(f.control.calls.length,1);
 assert.ok((await f.app.services.production.queue.jobs(id,'docker-local-owner')).filter(j=>j.state==='running').every(j=>j.lease_until>Date.now()+100000));
});

for(const [provider,timeout] of [['codex',900000],['gemini',900000]])test(`${provider}: step timing uses the persisted production claim across reads and renewals`,async t=>{
 const f=await productionFixture(t,provider),id=await f.createLegacyReader();await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.equal(f.generation.generationTimeoutMs('plan'),900000);
 const local=withLocalBooks(f.generation,new LocalBooks(process.cwd()),f.media);
 assert.equal(local.generationTimeoutMs('plan'),900000);
 assert.equal(local.generationTimeoutMs('image'),timeout);
 assert.equal(f.generation.generationTimeoutMs('source'),null);
 const jobs=await f.app.services.production.queue.jobs(id,'docker-local-owner'),image=jobs.find(job=>job.kind==='image'&&job.state==='running');
 const startedAt=Date.now()-65000;
 await f.app.services.database.prepare('UPDATE production_jobs SET updated_at=? WHERE id=?').bind(startedAt,image.id).run();
 // Model a concurrent background search older than the image currently being made.
 const search={id:crypto.randomUUID(),sessionId:id,ownerId:'docker-local-owner',kind:'discover',pool:'search',version:'background',dependencies:[],payload:{},priority:-10};
 await f.app.services.production.queue.enqueue(search);
 await f.app.services.database.prepare("UPDATE production_jobs SET state='running',lease_until=?,updated_at=? WHERE id=?").bind(Date.now()+180000,startedAt-60000,search.id).run();
 const first=await f.read(id);assert.equal(first.generationProgress.startedAt,startedAt);assert.equal(first.generationProgress.timeoutAt,startedAt+timeout);
 const wrappedCoordinator=new ReaderProductionCoordinator(f.app.services.database,local,f.media,{autoStart:false});f.coordinators.push(wrappedCoordinator);
 const wrapped=await wrappedCoordinator.snapshot('docker-local-owner',id);
 assert.equal(wrapped.generationProgress.startedAt,startedAt);assert.equal(wrapped.generationProgress.timeoutAt,startedAt+timeout);
 assert.equal(generationProgress(wrapped,startedAt+65000).remaining,timeout/1000-65);
 assert.equal(generationProgress(first,startedAt+65000).remaining,timeout/1000-65);
 assert.equal(generationProgress(first,startedAt+timeout).remaining,0);
 await f.app.services.production.queue.renew();
 const reopened=await f.read(id);assert.equal(reopened.generationProgress.startedAt,startedAt);assert.equal(reopened.generationProgress.timeoutAt,first.generationProgress.timeoutAt);
 await f.app.services.database.prepare('DELETE FROM production_jobs WHERE id=?').bind(search.id).run();
});

test('shutdown stops dispatch before draining in-flight outputs and closes SQLite after publication',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 const close=f.app.close();assert.equal(f.control.calls.length,4);for(const call of f.control.calls)call.resolve();await close;
 assert.equal(f.control.calls.length,4);await f.restart();assert.equal((await f.read(id)).ready,4);assert.equal(f.control.calls.length,4);
});

test('queue routes validate input/origin and use server owner identity',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(),viewerId=crypto.randomUUID();
 for(const body of [{viewerId:'bad',page:0},{viewerId,page:80},{viewerId,page:-1},{viewerId,page:1.5}])assert.equal((await f.request(`sessions/${id}/production`,'POST',body)).status,400);
 assert.equal((await f.request(`sessions/${id}/production`,'POST',{viewerId,page:0},{Origin:'https://evil.example'})).status,403);
 await assert.rejects(f.app.services.production.request('another-owner',id,viewerId,0),e=>e.status===404);
 assert.equal(await f.app.services.production.managed('another-owner',id),false);
});

test('reference validation accepts reordered same-story assets and rejects malformed or out-of-range paths',()=>{
 for(const page of [0,1,6,59,79])for(const extension of ['png','jpg','webp'])for(const artifactId of [undefined,'a'.repeat(64)]){
  const asset=readerImageAsset('story',page,extension,artifactId);
  assert.equal(referenceImageKey('story',asset.url),asset.key);
 }
 for(const file of ['80.png','-1.png','1.5.png','01.png','1.svg','artifacts/80-'+'a'.repeat(64)+'.png','artifacts/1-short.png','artifacts/1-'+'a'.repeat(64)+'.png/extra','../other/1.png','%2e%2e/1.png','1.png?other=1','1.png\n']){
  assert.equal(referenceImageKey('story','/api/reader/media/story/'+file),null,file);
 }
 assert.equal(referenceImageKey('story','/api/reader/media/other/1.png'),null);
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: reordered story resumes at page 11 after restart without regenerating ten saved images`,async t=>{
 const f=await productionFixture(t,provider,{SHIQU_IMAGE_WORKERS:'1'}),id=await f.createLegacyReader(30);
 const images=Array(30).fill(''),bytes=Buffer.from(encoded,'base64');
 // The original first image moved to page 7; the new first image retains its original filename.
 for(const [page,originalPage] of [1,2,3,4,5,6,0,7,8,9].entries()){
  const asset=readerImageAsset(id,originalPage,'png','a'.repeat(64));
  await f.media.put(asset.key,bytes,{contentType:'image/png'});images[page]=asset.url;
 }
 const doc={plan:makePlan(30),original:{title:'庄周梦蝶',text:'庄周梦为胡蝶。',url:'https://example.com/original',kind:'passage',provider:'fixture',retrievedAt:new Date().toISOString()},images,audio:[],usage:[]};
 await f.app.services.database.prepare("UPDATE stories SET document=?,state='failed',error='previous failure',page=10 WHERE id=?").bind(JSON.stringify(doc),id).run();
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
 const stored=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first();
 assert.deepEqual(JSON.parse(stored.document).usage.map(u=>u.step),['image:10']);
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: immutable attempts and exact same-story anchor validation protect replacement bytes`,async t=>{
 const f=await productionFixture(t,provider),id=await f.createLegacyReader(),original=f.app.services.production;
 await f.demand(id);await until(()=>f.control.calls.length===1);original.stop();
 // Simulate a crashed owner's expired claims while its remote result arrives late.
 await f.app.services.database.prepare("UPDATE production_jobs SET lease_until=1 WHERE state='running'").run();
 await f.app.services.database.prepare("UPDATE stories SET state='failed',lock_token=NULL,lock_until=0 WHERE id=?").bind(id).run();
 const replacement=new ReaderProductionCoordinator(f.app.services.database,f.generation,f.app.services.media);
 f.coordinators.push(replacement);
 await replacement.request('docker-local-owner',id,crypto.randomUUID(),0,false);await replacement.queue.recoverExpired();const fault=(await replacement.snapshot('docker-local-owner',id)).faults[0];await replacement.recover('docker-local-owner',id,{requestId:crypto.randomUUID(),faultId:fault.id});await until(()=>f.control.calls.length===2);
 // Distinct valid portrait bytes keep the race about fencing, not malformed-media rejection.
 f.control.calls[1].bytes=Buffer.from(imageBytes('large.png')).toString('base64');f.control.calls[1].resolve();
 await until(async()=>(await replacement.snapshot('docker-local-owner',id)).ready===1);replacement.stop();
 const saved=(await replacement.snapshot('docker-local-owner',id)).story.pages[0].image,key=referenceImageKey(id,saved),before=(await f.media.get(key)).body;
 assert.deepEqual(Buffer.from(before),Buffer.from(f.control.calls[1].bytes,'base64'));assert.notDeepEqual(Buffer.from(before),Buffer.from(encoded,'base64'));
 f.control.calls[0].bytes=encoded;f.control.calls[0].resolve();await original.queue.settle();
 assert.equal((await replacement.snapshot('docker-local-owner',id)).story.pages[0].image,saved);assert.deepEqual((await f.media.get(key)).body,before);
 const row=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first();assert.equal(JSON.parse(row.document).usage.filter(u=>u.step==='image:0').length,1);
 for(const reference of [saved.replace(id,crypto.randomUUID()),saved.replace('/artifacts/','/artifacts/../'),saved.replace('/0-','/80-'),saved.replace('.png','.svg')]){
  assert.equal(referenceImageKey(id,reference),null);const count=f.control.calls.length;
  await assert.rejects(f.generation.generator().image(JSON.parse(row.document).plan,1,id,reference));assert.equal(f.control.calls.length,count);
 }
 const count=f.control.calls.length;
 await assert.rejects(f.generation.generator().image(JSON.parse(row.document).plan,1,id,saved.replace('/0-','/1-')));
 assert.equal(f.control.calls.length,count,'A valid-looking but missing reference must fail before inference');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await replacement.close();
});

test('publication must own its job token as well as the session token',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();let release,entered=false;
 const gate=new Promise(resolve=>release=resolve),get=f.app.services.media.get.bind(f.app.services.media);
 f.app.services.media.get=async key=>{if(key.startsWith(`reader/${id}/artifacts/0-`)){entered=true;await gate;}return get(key);};
 await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>entered);
 const job=(await f.app.services.production.queue.jobs(id,'docker-local-owner')).find(j=>j.kind==='image-publish'&&j.state==='running');
 await f.app.services.database.prepare("UPDATE production_jobs SET lease_token='replacement' WHERE id=?").bind(job.id).run();release();await f.app.services.production.queue.settle();
 const row=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first();assert.equal(JSON.parse(row.document).images[0],'');assert.equal(JSON.parse(row.document).usage.filter(u=>u.step==='image:0').length,0);
 await f.app.services.database.prepare('UPDATE production_jobs SET lease_until=1 WHERE id=?').bind(job.id).run();
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: legacy numeric confirmation gates paid script/images before planning`,async t=>{
 const f=await productionFixture(t,provider);f.control.hold=false;
 for(const initial of [7,9]){
  const id=await f.createLegacyReader(initial,{narrativeDetail:'balanced'}),viewer=crypto.randomUUID(),plans=f.control.plans.length,images=f.control.calls.length,recommendations=f.control.recommendations.length;
  await f.demand(id,viewer);await until(async()=>(await f.read(id)).awaitingFrameCount);
  assert.equal(f.control.plans.length,plans);assert.equal(f.control.calls.length,images);assert.equal(f.control.recommendations.length,recommendations+1);
  await f.leave(id,viewer);await f.restart();await f.demand(id,viewer);await f.app.services.production.tick();
  assert.equal(f.control.recommendations.length,recommendations+1);assert.equal(f.control.plans.length,plans);assert.equal(f.control.calls.length,images);
  await f.json(`sessions/${id}/frame-count`,'POST',{count:7});await f.demand(id,viewer);
  await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.plans.length,plans+1);assert.equal(f.control.calls.length,images+7);
  const jobs=await f.app.services.production.queue.jobs(id,'docker-local-owner');assert.equal(jobs.filter(j=>j.kind==='prepare').length,1);assert.equal(jobs.filter(j=>j.kind==='script'&&j.state==='succeeded'&&JSON.parse(j.payload).stepKey==='').length,1);
  assert.ok(jobs.some(j=>j.kind==='script'&&JSON.parse(j.payload).stepKey==='review:0'&&j.state==='succeeded'));assert.ok(jobs.some(j=>JSON.parse(j.payload).stepKey==='approved'&&j.state==='succeeded'));
 }
});

test('slow script preparation renews its session lease and excludes a legacy planner',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();let release,started=false;
 const gate=new Promise(resolve=>release=resolve),generator=f.generation.generator.bind(f.generation);
 t.after(()=>release());
 f.generation.generator=()=>{const value=generator();return {...value,async plan(...args){started=true;await gate;return value.plan(...args);}};};
 await f.demand(id);await until(()=>started);
 await f.app.services.database.prepare('UPDATE stories SET lock_until=? WHERE id=?').bind(Date.now()+1000,id).run();await f.app.services.production.tick();
 const row=await new ReaderRepository(f.app.services.database).get(id,'docker-local-owner');assert.ok(row.lock_until>Date.now()+100000);
 const duplicate=await advanceStory(new ReaderRepository(f.app.services.database),generator(),'docker-local-owner',id,0,true);assert.equal(duplicate.state,'running');assert.equal(f.control.plans.length,0);
 release();await until(()=>f.control.calls.length===1);assert.equal(f.control.plans.length,1);
});

test('deleted pending publication with an expired pre-restart lease cannot poison another story',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();f.control.hold=false;await f.demand(id);await until(async()=>(await f.read(id)).ready===7);
 const jobs=await f.app.services.production.queue.jobs(id,'docker-local-owner'),publication=jobs.find(j=>j.kind==='image-publish'&&JSON.parse(j.payload).page===1);
 await f.json(`library/${id}`,'DELETE');await f.app.close();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 db.prepare("UPDATE stories SET document=json_set(document,'$.images[1]',''),state='running',lock_token='dead-owner',lock_until=1 WHERE id=?").run(id);
 db.prepare("UPDATE production_jobs SET state='queued',result=NULL WHERE id=?").run(publication.id);db.close();
 await f.restart();const live=await f.createLegacyReader();await f.demand(live);
 await until(async()=>(await f.read(live)).ready===7);
 await until(async()=>{const row=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first();return !!JSON.parse(row.document).images[1];});
 assert.equal(f.control.calls.length,14);assert.equal((await f.request(`sessions/${id}`)).status,404);
});

test('shrinking lookahead after backtracking reports a full buffer idle despite outstanding later jobs',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(30),viewer=crypto.randomUUID();f.control.hold=false;await f.demand(id,viewer);await until(async()=>(await f.read(id)).ready===7);
 f.control.hold=true;await f.demand(id,viewer,10);await until(()=>f.control.active===3);
 await f.demand(id,viewer,0);for(const call of f.control.calls)call.resolve();await until(()=>f.control.active===0);
 await until(async()=>(await f.read(id)).state==='idle');
 const jobs=await f.app.services.production.queue.jobs(id,'docker-local-owner');assert.ok(jobs.some(j=>j.kind==='image'&&j.state==='queued'&&JSON.parse(j.payload).page>6));
 assert.equal((await f.read(id)).state,'idle');assert.equal(f.control.calls.length,10);
});

test('completed step durations survive the next stage, fresh reads and service restart',async t=>{
 const f=await productionFixture(t),id=await f.create(4);await until(()=>f.control.calls.length===1);
 const drawing=await f.read(id),durations=drawing.generationProgress.stageDurations;
 assert.equal(typeof durations.plan,'number');assert.equal(typeof durations.review,'number');assert.equal(durations.image,undefined);
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>(await f.read(id)).state==='completed');await f.app.services.production.queue.settle();
 const completed=await f.read(id);assert.equal(completed.generationProgress.stageDurations.plan,durations.plan);assert.equal(typeof completed.generationProgress.stageDurations.image,'number');
 await f.restart();const reopened=await f.read(id);assert.deepEqual(reopened.generationProgress.stageDurations,completed.generationProgress.stageDurations);
 const shelf=(await f.json('sessions')).find(session=>session.id===id);assert.deepEqual(shelf.generationProgress.stageDurations,completed.generationProgress.stageDurations);
});
