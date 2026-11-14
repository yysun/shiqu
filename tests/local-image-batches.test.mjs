// Exercise legacy counts and reader demand through the same durable queue as production.
// Batch-era assertions follow saved checkpoints rather than synchronous HTTP completion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn,makePlan} from './fixtures/production.mjs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {flowProviders,fullTier,heavy} from './fixtures/test-tier.mjs';
const owner='docker-local-owner';
const control=(f,id,action)=>f.json(`sessions/${id}/production-control`,'POST',{action});
async function finish(f,id,page=0){await f.demand(id,crypto.randomUUID(),page);await until(async()=>(await f.read(id)).state==='completed',60000);return f.read(id);}
async function waiting(f,id){await until(async()=>{const s=await f.read(id);return s.awaitingFrameCount||s.state==='failed';});return f.read(id);}

test('auto is the count default; invalid counts never create a production story',async t=>{
 const f=await productionFixture(t);assert.equal(selectionSchema.parse({bookId:'zhuangzi',theme:'测试'}).length,'auto');
 for(const length of [0,81,1.5,null,'30'])assert.equal((await f.request('sessions','POST',{requestId:crypto.randomUUID(),selection:{bookId:'zhuangzi',theme:'测试',length}})).status,400);
 assert.equal((await f.json('sessions')).length,0);
});
for(const provider of flowProviders(['gemini','codex'])){
 test(`${provider}: invalid exact outline fails before images; only explicit fault recovery proceeds`,async t=>{
  const f=await productionFixture(t,provider);f.control.hold=false;
  f.control.beforeText=async kind=>kind==='outline'?{...makePlan(1),beats:['只有一幅。']}:undefined;
  // Outlines exist only for batched stories (over 20 frames); 21 is the smallest, the full tier uses a long story.
  const length=fullTier?60:21,id=await f.create(length);await until(async()=>(await f.read(id)).state==='failed');assert.equal(f.control.calls.length,0);
  f.control.beforeText=null;await f.demand(id,crypto.randomUUID(),0,true);await until(async()=>(await f.read(id)).state==='completed',60000);assert.equal((await f.read(id)).ready,length);
 });
 test(`${provider}: anchor runs alone, later scenes publish out of order under one session lease`,async t=>{
  const f=await productionFixture(t,provider),id=await f.create(8);await until(()=>f.control.calls.length===1);assert.equal(f.control.calls[0].page,0);
  await turn();assert.equal(f.control.calls.length,1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
  const first=f.control.calls.find(c=>c.page===1);for(const page of [3,2]){f.control.calls.find(c=>c.page===page).resolve();await until(async()=>(await f.read(id)).story.pages[page].image);assert.equal((await f.read(id)).story.pages[1].image,'');}
  first.resolve();f.control.hold=false;for(const c of f.control.calls)c.resolve();await until(async()=>(await f.read(id)).state==='completed');
  const doc=JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);
  for(let page=0;page<8;page++)assert.equal(doc.usage.filter(u=>u.step===`image:${page}`).length,1);
 });
 test(`${provider}: numeric detail prepares once and waits for durable explicit count confirmation`,async t=>{
  const f=await productionFixture(t,provider);f.control.hold=false;
  for(const [i,narrativeDetail] of ['brief','balanced','detailed'].entries()){
   const recs=f.control.recommendations.length,images=f.control.calls.length,id=await f.create(8,{narrativeDetail});const prepared=await waiting(f,id);
   assert.equal(prepared.awaitingFrameCount,true);assert.equal(prepared.story,null);assert.equal(f.control.calls.length,images);assert.equal(prepared.retryAllowed,false);
   await f.restart();await f.app.services.production.tick();assert.equal(f.control.recommendations.length,recs+1);
   const large=fullTier?60:8,count=i===1?large:1,responses=await Promise.all([f.request(`sessions/${id}/frame-count`,'POST',{count}),f.request(`sessions/${id}/frame-count`,'POST',{count})]);assert.ok(responses.every(r=>r.status===200));
   assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count:count===1?large:1})).status,409);
   await finish(f,id);assert.equal((await f.read(id)).ready,count);assert.equal(f.control.recommendations.length,recs+1);
  }
 });
 test(`${provider}: invalid recommendations preserve the original and require an authorized retry`,async t=>{
  const f=await productionFixture(t,provider);let last;
  for(const bad of [{count:0},{count:81},{count:1.5},{count:'7'},{reason:'   '}]){
   f.control.beforeText=async kind=>kind==='recommend'?bad:undefined;last=await f.create(8,{narrativeDetail:'balanced'});
   const failed=await waiting(f,last);assert.equal(failed.state,'failed');assert.equal(failed.frameRecommendation,null);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
   const doc=JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(last).first()).document);assert.ok(doc.original.text);
  }
  f.control.beforeText=null;await f.demand(last,crypto.randomUUID(),0,true);assert.equal((await waiting(f,last)).awaitingFrameCount,true);
 });
}
test('frame 80 media, events and saved progress remain owner scoped and survive restart',heavy,async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(80),saved=await finish(f,id);
 assert.equal((await f.request(saved.story.pages[79].image.replace('/api/reader/',''))).status,200);
 assert.equal((await f.json(`sessions/${id}/progress`,'POST',{page:79,saved:true})).page,79);
 const event={id:crypto.randomUUID(),visitor:crypto.randomUUID(),session:crypto.randomUUID(),storyId:id,kind:'page',page:79,mode:'manual',cohort:'internal'};
 assert.equal((await f.request(`sessions/${id}/events`,'POST',event)).status,200);
 for(const suffix of ['progress','advance','events'])assert.equal((await f.request(`sessions/${id}/${suffix}`,'POST',suffix==='progress'?{page:80,saved:true}:suffix==='advance'?{throughPage:80}:{...event,page:80})).status,400);
 for(const file of ['80.png','079.png','79.svg','-1.png','1.png/extra'])assert.equal((await f.request(`media/${id}/${file}`)).status,404);
 await f.restart();const restored=await f.read(id);assert.equal(restored.page,79);assert.equal(restored.saved,true);assert.equal(restored.ready,80);
 const short=await f.create(1);await finish(f,short);assert.equal((await f.request(`sessions/${short}/progress`,'POST',{page:79,saved:true})).status,400);
});
test('reader lease exit drains started calls and dispatches no additional images',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(10),viewer=crypto.randomUUID();await f.demand(id,viewer);await until(()=>f.control.calls.length===1);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);await f.leave(id,viewer);for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===4);await f.app.services.production.tick();assert.equal(f.control.calls.length,4);
});
test('frame count validation, owner, running lock and concurrent conflicting confirmation are fenced',async t=>{
 const f=await productionFixture(t),id=await f.create(8,{narrativeDetail:'balanced'});await waiting(f,id);
 for(const count of [0,81,1.5,'7',null])assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count})).status,400);
 const repo=new ReaderRepository(f.app.services.database);await assert.rejects(repo.confirmFrameCount(id,'foreign',7),e=>e.status===404);
 const row=await repo.get(id,owner),token=await repo.acquire(row,{kind:'plan',page:0,key:'plan'});assert.ok(token);
 assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count:7})).status,409);await repo.save(row,token,JSON.parse(row.document),false);
 const results=await Promise.all([f.request(`sessions/${id}/frame-count`,'POST',{count:1}),f.request(`sessions/${id}/frame-count`,'POST',{count:60})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.ok([1,60].includes((await f.read(id)).selection.length));
});
test('unverifiable originals stop before recommendation, plan or images',async t=>{
 const f=await productionFixture(t,'gemini'),id=await f.create(8,{bookId:'other',customBook:'https://example.com/story',storyTitle:'未知故事',narrativeDetail:'balanced'});
 const failed=await waiting(f,id);assert.match(failed.error,/原文未能核对/);assert.equal(f.control.recommendations.length,0);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});
