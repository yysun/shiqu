// Exercise durable storyboard checkpoints and the complete-script barrier through real HTTP and SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,makePlan} from './fixtures/production.mjs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import {generationProgress} from '../lib/generation-progress.ts';

const owner='docker-local-owner';
const document=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first()).document);
for(const provider of ['codex','gemini'])test(`${provider}: outline and 20/20/5 checkpoints precede every image`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(45),observed=[];
 f.control.beforeText=async(kind,payload,schema)=>{
  const doc=await document(f,id);assert.equal(doc.plan,null);assert.equal(f.control.calls.length,0);
  observed.push(doc.storyboard?.pages.length??0);
  if(kind==='batch'){
   assert.deepEqual(payload.previousPages,doc.storyboard.pages);assert.deepEqual(payload.outline,doc.storyboard.outline);
   assert.ok(payload.verifiedOriginal.text);assert.equal(payload.exactPageCount,45);
   assert.equal(schema.properties.pages.minItems,payload.batch.last-payload.batch.first+1);
   assert.equal(schema.properties.pages.maxItems,schema.properties.pages.minItems);
   const session=await f.read(id);assert.equal(session.story,null);assert.equal(session.generationProgress.storyboardFrames,doc.storyboard.pages.length);
  }
 };
 await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.deepEqual(observed,[0,0,20,40]);assert.equal(f.control.outlines.length,1);
 assert.deepEqual(f.control.batches.map(p=>p.batch),[{first:1,last:20},{first:21,last:40},{first:41,last:45}]);
 const doc=await document(f,id);assert.equal(doc.plan.pages.length,45);assert.equal(doc.storyboard.pages.length,45);
 assert.deepEqual(doc.usage.filter(u=>u.step.startsWith('plan')).map(u=>u.step),['plan','plan:0','plan:20','plan:40']);
 const jobs=await f.app.services.production.queue.jobs(id,owner);assert.ok(jobs.filter(j=>j.kind==='image').every(j=>JSON.parse(j.dependencies).some(parent=>jobs.some(p=>p.id===parent&&p.kind==='script'&&p.state==='succeeded'))));
});

for(const provider of ['codex','gemini'])test(`${provider}: 80 frames complete four batches and background drawing reaches frame 80`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(80);f.control.hold=false;
 await f.json(`sessions/${id}/production-control`,'POST',{action:'background'});
 await until(async()=>(await f.read(id)).state==='completed',15000);
 assert.deepEqual(f.control.batches.map(p=>p.batch),[{first:1,last:20},{first:21,last:40},{first:41,last:60},{first:61,last:80}]);
 assert.equal(f.control.calls.length,80);assert.deepEqual(f.control.calls.map(p=>p.page).sort((a,b)=>a-b),Array.from({length:80},(_,i)=>i));
 const session=await f.read(id);assert.equal(session.ready,80);assert.equal(session.story.pages.length,80);
 const last=session.story.pages[79].image;assert.equal((await f.request(last.replace('/api/reader/',''))).status,200);
 await f.json(`sessions/${id}/progress`,'POST',{page:79,saved:true});
 assert.equal((await f.request(`sessions/${id}/production`,'POST',{viewerId:crypto.randomUUID(),page:80})).status,400);
});

for(const length of [1,20,21,40,60])test(`${length} frames use a single short plan or bounded batches`,async t=>{
 const f=await productionFixture(t),id=await f.create(length);await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.equal((await f.read(id)).story.pages.length,length);
 assert.equal(f.control.outlines.length,length<=20?0:1);assert.equal(f.control.plans.length,Math.ceil(length/20));
 if(length>20)assert.equal(f.control.batches.at(-1).batch.last,length);
});

for(const provider of ['codex','gemini'])for(const failure of ['outage','short','long','invalid'])test(`${provider}: ${failure} in the second batch keeps the first batch and retries only missing work`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(45);let blocked=true;
 f.control.beforeText=async(kind,payload)=>{
  if(kind!=='batch'||payload.batch.first!==21||!blocked)return;
  if(failure==='outage')throw Error('controlled outage');
  if(failure==='invalid')return {pages:makePlan(20).pages.map(p=>({...p,caption:''}))};
  return {pages:makePlan(failure==='short'?19:21).pages};
 };
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 const before=await document(f,id);assert.equal(before.storyboard.pages.length,20);assert.equal(before.plan,null);assert.equal(f.control.calls.length,0);
 const progress=generationProgress(await f.read(id),Date.now());assert.match(progress.steps[2].detail,/20 \/ 45/);assert.match(progress.note,/21–40/);
 await f.read(id);await f.app.services.production.tick();assert.equal(f.control.batches.length,2);
 blocked=false;await f.demand(id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===1);
 const after=await document(f,id);assert.deepEqual(after.plan.pages.slice(0,20),before.storyboard.pages);
 assert.equal(f.control.outlines.length,1);assert.deepEqual(f.control.batches.map(p=>p.batch.first),[1,21,21,41]);
 assert.equal(after.usage.filter(u=>u.step==='plan:20').length,1);
});

for(const action of ['pause','stop','leave'])test(`${action} between batches retains 20 saved frames across restart`,async t=>{
 const f=await productionFixture(t),id=await f.create(45),viewer=crypto.randomUUID();let release,started;
 const hold=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 f.control.beforeText=async(kind,payload)=>{if(kind==='batch'&&payload.batch.first===1){started();await hold;}};
 await f.demand(id,viewer);await ready;
 if(action==='leave')await f.leave(id,viewer);else await f.json(`sessions/${id}/production-control`,'POST',{action});
 release();await until(async()=>{const row=await f.app.services.database.prepare('SELECT state,document FROM reader_sessions WHERE id=?').bind(id).first();return row.state!=='running'&&JSON.parse(row.document).storyboard?.pages.length===20;});
 await f.app.services.production.tick();assert.equal(f.control.batches.length,1);assert.equal(f.control.calls.length,0);
 const saved=await document(f,id);await f.restart();await f.app.services.production.tick();assert.equal(f.control.batches.length,1);
 if(action!=='leave')await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});
 await f.demand(id);await until(async()=>(await f.read(id)).ready>=1);
 assert.equal(f.control.outlines.length,1);assert.deepEqual(f.control.batches.map(p=>p.batch.first),[1,21,41]);
 assert.deepEqual((await document(f,id)).plan.pages.slice(0,20),saved.storyboard.pages);
});

test('concurrent batch advances and replayed queue receipts do not repeat saved paid work',async t=>{
 const f=await productionFixture(t),id=await f.create(45),repo=new ReaderRepository(f.app.services.database),g=f.generation.generator();
 await advanceStory(repo,g,owner,id,0); // Outline.
 let release,started;const hold=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 f.control.beforeText=async(kind,payload)=>{if(kind==='batch'&&payload.batch.first===1){started();await hold;}};
 const first=advanceStory(repo,g,owner,id,0);await ready;
 assert.equal((await advanceStory(repo,g,owner,id,0)).state,'running');assert.equal(f.control.batches.length,1);
 release();await first;
 // Simulate the lost receipt of the first paid batch while the document still contains only 20 scenes.
 const old={id:crypto.randomUUID(),sessionId:id,ownerId:owner,kind:'script',pool:'text',version:'lost-receipt',dependencies:[],payload:{stepKey:'plan:0'},priority:-20};
 await f.app.services.production.queue.enqueue(old);
 let nextRelease,nextStarted;const nextHold=new Promise(r=>nextRelease=r),nextReady=new Promise(r=>nextStarted=r);
 f.control.beforeText=async(kind,payload)=>{if(kind==='batch'&&payload.batch.first===21){nextStarted();await nextHold;}};
 await f.demand(id);await nextReady;
 assert.equal((await f.app.services.production.queue.job(old.id)).state,'succeeded');
 assert.equal((await document(f,id)).storyboard.pages.length,20);assert.deepEqual(f.control.batches.map(p=>p.batch.first),[1,21]);
 nextRelease();await until(()=>f.control.calls.length===1);assert.equal((await document(f,id)).plan.pages.length,45);
});
