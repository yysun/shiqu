// Verify continuous production through REST, real SQLite/files, and both controlled providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn,encoded,makePlan} from './fixtures/production.mjs';
import {configuredImageWorkers} from '../server/reader-production.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import path from 'node:path';
import {flowProviders} from './fixtures/test-tier.mjs';




test('image concurrency is configurable and global across stories; text/source are not repeated',async t=>{
 const f=await productionFixture(t,'codex',{SHIQU_IMAGE_WORKERS:'4'}),a=await f.create(),b=await f.create();
 await f.demand(a);await f.demand(b);await until(()=>f.control.calls.length===2);assert.ok(f.control.calls.every(c=>c.page===0));
 for(const call of f.control.calls)call.resolve();await until(()=>f.control.active===4);await turn();assert.equal(f.control.maxActive,4);
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(a)).ready===7&&(await f.read(b)).ready===7);
 assert.equal(f.control.maxActive,4);assert.equal(f.control.dagCalls.filter(n=>n==='outline').length,2);
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
 const f=await productionFixture(t),id=await f.create();await f.demand(id);await until(()=>f.control.calls.length===1);
 await f.app.services.database.prepare('UPDATE production_demand SET expires_at=0').run();f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).ready===1);await f.app.services.production.tick();assert.equal(f.control.calls.length,1);
 // A claim shows in the job row at once; its provider call only appears after asynchronous file reads.
 assert.equal((await f.app.services.production.queue.jobs(id,'docker-local-owner')).filter(job=>job.kind==='image'&&job.state==='running').length,0);
});




test('restart before viewer expiry never resumes paid work until a fresh viewer request',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();f.control.hold=false;await f.demand(id);await until(async()=>(await f.read(id)).ready===7);
 await f.demand(id,crypto.randomUUID(),1);f.app.stopGeneration();await f.restart();await f.app.services.production.tick();
 assert.equal(f.control.calls.length,7);assert.equal((await f.read(id)).ready,7);
 await f.demand(id,crypto.randomUUID(),1);await until(async()=>(await f.read(id)).ready===8);assert.equal(f.control.calls.length,8);assert.equal(f.control.dagCalls.filter(n=>n==='outline').length,1);
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
 assert.equal(f.control.calls.length,1);assert.equal(f.control.dagCalls.filter(n=>n==='outline').length,0);
 const stored=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first();
 assert.equal(JSON.parse(stored.document).usage.filter(u=>u.step==='dag:draw').length,1,'only page 10 is paid for');
});









test('early demand draws the anchor first, then a bounded read-ahead; each page is visible as it finishes',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(),viewer=crypto.randomUUID();
 await f.request(`sessions/${id}/production`,'POST',{viewerId:viewer,page:0});
 await until(()=>f.control.calls.length===1);assert.equal(f.control.calls[0].page,0);await turn();assert.equal(f.control.calls.length,1,'later pages wait for the anchor');
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);assert.deepEqual(f.control.calls.slice(1).map(c=>c.page).sort(),[1,2,3]);
 f.control.calls.find(c=>c.page===2).resolve();await until(async()=>!!(await f.read(id)).story.pages[2].image);
 const partial=await f.read(id);assert.equal(partial.story.pages[1].image,'');assert.equal((await f.request(partial.story.pages[2].image.replace('/api/reader/',''))).status,200);
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===7);
 assert.equal(f.control.calls.some(c=>c.page===7),false,'read-ahead stops at the window');assert.equal(f.control.maxActive,3);
});

test('deletion hides a story immediately and stops further drawing',async t=>{
 const f=await productionFixture(t),id=await f.create();await f.demand(id);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 await f.json(`library/${id}`,'DELETE');f.control.hold=false;for(const call of f.control.calls)call.resolve();await f.app.services.production.queue.settle();
 assert.equal((await f.request(`sessions/${id}`)).status,404);assert.equal((await f.request(`media/${id}/1.png`)).status,404);assert.equal(f.control.calls.length,4);
 assert.equal((await f.request(`sessions/${id}/production`,'POST',{viewerId:crypto.randomUUID(),page:0})).status,404);
});
