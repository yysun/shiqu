// Recover saved publication conflicts without paid replay, and fence obsolete image versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,encoded} from './fixtures/production.mjs';
import {ReaderError} from '../lib/reader-model.ts';
import {readerImageAsset} from '../lib/reader-image-assets.ts';

const owner='docker-local-owner';
const jobs=(f,id)=>f.app.services.production.queue.jobs(id,owner);
const row=(f,id)=>f.app.services.database.prepare('SELECT * FROM reader_sessions WHERE id=?').bind(id).first();
const document=async(f,id)=>JSON.parse((await row(f,id)).document);
const settled=async f=>{for(let i=0;i<4;i++){await f.app.services.production.tick();await f.app.services.production.queue.settle();}};

test('explicit retry publishes the current paid result over a stale slot once, without redrawing',async t=>{
 const f=await productionFixture(t),id=await f.create(2),queue=f.app.services.production.queue;
 await until(()=>f.control.calls.length===1);
 const stale=readerImageAsset(id,0,'png','f'.repeat(64));
 await f.media.put(stale.key,Buffer.from(encoded,'base64'),{contentType:'image/png'});
 const handler=queue.options.handlers['image-publish'],publish=handler.run;let inject=true;
 handler.run=async(job,context)=>{
  if(inject&&JSON.parse(job.payload).page===0){
   inject=false;
   await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.images[0]',?) WHERE id=?").bind(stale.url,id).run();
   throw new ReaderError(409,'这幅图片已经更新，请重新打开故事。');
  }
  return publish(job,context);
 };
 f.control.hold=false;f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).state==='failed');
 assert.equal((await f.read(id)).retryStage,'publication');
 await f.demand(id,crypto.randomUUID(),0,true);await settled(f);
 assert.equal((await f.read(id)).state,'completed');
 const receipts=await jobs(f,id),image=receipts.find(job=>job.kind==='image'&&JSON.parse(job.payload).page===0),publication=receipts.find(job=>job.kind==='image-publish'&&JSON.parse(job.payload).page===0);
 const saved=await document(f,id);
 assert.equal(saved.images[0],JSON.parse(image.result).value);assert.notEqual(saved.images[0],stale.url);
 assert.equal(f.control.calls.filter(call=>call.page===0).length,1);
 assert.equal(saved.usage.filter(item=>item.step==='image:0').length,1);
 await queue.rerun(publication.id);await settled(f);
 assert.deepEqual((await document(f,id)).images,saved.images);
 assert.deepEqual((await document(f,id)).usage,saved.usage);
 assert.equal(f.control.calls.length,2);
});

test('an old in-flight image cannot publish late or start its queued siblings after inputs change',async t=>{
 const f=await productionFixture(t),id=await f.create(3);
 await until(()=>f.control.calls.length===1);
 const oldJobs=await jobs(f,id),old=oldJobs.find(job=>job.kind==='image'&&job.state==='running');
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.plan.title','新的标题') WHERE id=?").bind(id).run();
 await f.demand(id);await until(()=>f.control.calls.length===2);
 const current=(await jobs(f,id)).find(job=>job.kind==='image'&&job.state==='running'&&job.version!==old.version);
 f.control.calls[1].resolve();await until(async()=>!!(await document(f,id)).images[0]);
 const currentImage=(await document(f,id)).images[0];
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await settled(f);
 const saved=await f.read(id);
 assert.equal(saved.state,'completed');assert.equal(saved.error,null);
 assert.equal((await document(f,id)).images[0],currentImage);
 assert.equal(currentImage,JSON.parse((await f.app.services.production.queue.job(current.id)).result).value);
 assert.equal(f.control.calls.length,4,'Only the already-started old draw and three current draws run');
 const remaining=await jobs(f,id);
 assert.ok(remaining.some(job=>job.id===old.id&&job.state==='succeeded'),'Keep the paid historical receipt');
 assert.ok(!remaining.some(job=>job.version===old.version&&['queued','failed'].includes(job.state)));
});

test('publication rechecks its version after an awaited file read',async t=>{
 const f=await productionFixture(t),id=await f.create(2),store=f.app.services.media,get=store.get.bind(store);
 await until(()=>f.control.calls.length===1);
 let release,entered=false;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
 store.get=async key=>{if(!entered&&key.includes('/artifacts/0-')){entered=true;await gate;}return get(key);};
 f.control.calls[0].resolve();await until(()=>entered);
 const old=(await jobs(f,id)).find(job=>job.kind==='image-publish'&&job.state==='running');
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.plan.title','文件读取期间更新') WHERE id=?").bind(id).run();
 await f.demand(id);await until(()=>f.control.calls.length===2);
 release();await until(async()=>(await f.app.services.production.queue.job(old.id)).state==='succeeded');
 assert.deepEqual(JSON.parse((await f.app.services.production.queue.job(old.id)).result),{obsolete:true});
 assert.equal((await document(f,id)).images[0],'');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await settled(f);
 await until(async()=>(await f.read(id)).state==='completed');
 assert.equal((await f.read(id)).state,'completed');assert.equal(f.control.calls.length,3);
});

test('sibling publications that read the same document both save without duplicate usage',async t=>{
 const f=await productionFixture(t),id=await f.create(3),database=f.app.services.database;
 await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===3);
 const prepare=database.prepare.bind(database);let release,arrivals=0;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
 database.prepare=query=>{
  const statement=prepare(query);
  if(query.includes("json_set(document,?, ?, '$.usage'")){
   const run=statement.run.bind(statement);
   statement.run=async()=>{if(++arrivals===2)release();await gate;return run();};
  }
  return statement;
 };
 f.control.hold=false;for(const call of f.control.calls.slice(1))call.resolve();
 await until(()=>arrivals===2);await settled(f);
 assert.equal((await f.read(id)).state,'completed');
 const saved=await document(f,id);
 for(const page of [0,1,2])assert.equal(saved.usage.filter(item=>item.step===`image:${page}`).length,1);
 assert.equal(f.control.calls.length,3);
});

test('publication CAS rejects a plan change after its final read',async t=>{
 const f=await productionFixture(t),id=await f.create(2),database=f.app.services.database,prepare=database.prepare.bind(database);
 await until(()=>f.control.calls.length===1);
 let injected=false,fenced=false;
 database.prepare=query=>{
  const statement=prepare(query);
  if(!injected&&query.includes("json_set(document,?, ?, '$.usage'")){
   const run=statement.run.bind(statement);
   statement.run=async()=>{
    injected=true;
    await prepare("UPDATE reader_sessions SET document=json_set(document,'$.plan.title','写入前更新') WHERE id=?").bind(id).run();
    const result=await run();fenced=result.meta.changes===0;return result;
   };
  }
  return statement;
 };
 f.control.hold=false;f.control.calls[0].resolve();await settled(f);
 assert.equal(injected,true);assert.equal(fenced,true);
 await until(async()=>(await f.read(id)).state==='completed');
 assert.equal((await f.read(id)).state,'completed');
 assert.equal((await document(f,id)).plan.title,'写入前更新');
 assert.equal((await document(f,id)).usage.filter(item=>item.step==='image:0').length,1);
});

test('obsolete cleanup preserves a real current failure and never retries it',async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 const obsolete=(await jobs(f,id)).find(job=>job.kind==='image'&&JSON.parse(job.payload).page===1);
 await f.app.services.database.prepare("UPDATE production_jobs SET state='failed',error='旧版失败' WHERE id=?").bind(obsolete.id).run();
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.plan.title','当前分镜') WHERE id=?").bind(id).run();
 await f.demand(id);await until(()=>f.control.calls.length===2);
 f.control.calls[1].reject(Error('controlled current failure'));
 await until(async()=>(await f.read(id)).state==='failed');
 f.control.calls[0].resolve();await settled(f);
 const saved=await f.read(id);
 assert.equal(saved.state,'failed');assert.notEqual(saved.error,'旧版失败');assert.ok(saved.error);
 assert.equal(f.control.calls.length,2);
 assert.ok((await jobs(f,id)).some(job=>job.kind==='image'&&job.state==='failed'&&job.version!==obsolete.version));
});

for(const generationControl of ['active','paused','stopped'])test(`obsolete failed jobs release their saved error while retaining ${generationControl} control`,async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 f.control.calls[0].resolve();await settled(f);
 const oldJobs=await jobs(f,id),obsolete=oldJobs.find(job=>job.kind==='image'&&JSON.parse(job.payload).page===1);
 await f.app.services.database.prepare("UPDATE production_jobs SET state='failed',error='旧版失败' WHERE id=?").bind(obsolete.id).run();
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.plan.title','新的标题'),state='failed',error='旧版失败',generation_control=? WHERE id=?").bind(generationControl,id).run();
 f.control.hold=false;await settled(f);
 const saved=await f.read(id);
 assert.notEqual(saved.state,'failed');assert.equal(saved.error,null);assert.equal(saved.generationControl,generationControl);
 if(generationControl==='active')assert.equal(saved.state,'completed');
 else assert.equal(f.control.calls.length,1,'Cleanup does not resume a manual pause');
});
