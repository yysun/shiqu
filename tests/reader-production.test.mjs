// Verify continuous production through REST, real SQLite/files, and both controlled providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn} from './fixtures/production.mjs';
import {configuredImageWorkers} from '../server/reader-production.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import path from 'node:path';




test('image concurrency is configurable and global across stories; text/source are not repeated',async t=>{
 const f=await productionFixture(t,'codex',{SHIQU_IMAGE_WORKERS:'4'}),a=await f.create(),b=await f.create();
 await f.demand(a);await f.demand(b);await until(()=>f.control.calls.length===2);assert.ok(f.control.calls.every(c=>c.page===0));
 for(const call of f.control.calls)call.resolve();await until(()=>f.control.active===4);await turn();assert.equal(f.control.maxActive,4);
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(a)).ready===7&&(await f.read(b)).ready===7);
 assert.equal(f.control.maxActive,4);assert.equal(f.control.dagCalls.filter(n=>n==='storyboard').length,2);
 assert.equal(configuredImageWorkers(),3);for(const invalid of ['0','9','2.5','many'])assert.throws(()=>configuredImageWorkers(invalid));
});

test('expired viewer demand stops dispatch even if the browser never sends leave',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.demand(id);await until(()=>f.control.calls.length===1);
 await f.app.services.database.prepare('UPDATE production_demand SET expires_at=0').run();f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).ready===1);await f.app.services.production.tick();assert.equal(f.control.calls.length,1);
 // A claim shows in the job row at once; its provider call only appears after asynchronous file reads.
 assert.equal((await f.app.services.production.queue.jobs(id,'docker-local-owner')).filter(job=>job.kind==='image'&&job.state==='running').length,0);
});




test('shutdown stops dispatch before draining in-flight outputs and closes SQLite after publication',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 const close=f.app.close();assert.equal(f.control.calls.length,4);for(const call of f.control.calls)call.resolve();await close;
 assert.equal(f.control.calls.length,4);await f.restart();assert.equal((await f.read(id)).ready,4);assert.equal(f.control.calls.length,4);
});

test('queue routes validate input/origin and use server owner identity',async t=>{
 const f=await productionFixture(t),id=await f.create(),viewerId=crypto.randomUUID();
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

test('deletion hides a story immediately and stops further drawing',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 await f.json(`library/${id}`,'DELETE');f.control.hold=false;for(const call of f.control.calls)call.resolve();await f.app.services.production.queue.settle();
 assert.equal((await f.request(`sessions/${id}`)).status,404);assert.equal((await f.request(`media/${id}/1.png`)).status,404);assert.equal(f.control.calls.length,4);
 assert.equal((await f.request(`sessions/${id}/production`,'POST',{viewerId:crypto.randomUUID(),page:0})).status,404);
});
