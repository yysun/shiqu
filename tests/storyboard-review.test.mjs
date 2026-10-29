// Exercise paid text checkpoints, strict repair scopes and image gating through both provider adapters.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {runStoryGeneration} from '../lib/reader-generation.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';

const owner='docker-local-owner';
const document=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first()).document);
const issue=page=>({page,category:'action',problem:'本幅与前幅只有旁白变化，人物和道具状态完全重复。',instruction:'保留当前事件，以接触物件的手势和明确的动作结果表现这一步变化。'});
for(const provider of ['codex','gemini'])test(`${provider}: review is a separate queued job and gates all drawing`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create();let release,started;
 const hold=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 f.control.beforeText=async kind=>{if(kind==='review'){started();await hold;}};
 await f.demand(id);await ready;
 assert.equal(f.control.calls.length,0);const pending=await document(f,id);assert.equal(pending.plan.pages.length,8);assert.equal(pending.visualReview.status,'pending');
 const jobs=await f.app.services.production.queue.jobs(id,owner);assert.ok(jobs.some(j=>j.kind==='script'&&JSON.parse(j.payload).stepKey==='review:0'&&j.state==='running'));assert.ok(jobs.every(j=>j.kind!=='image'));
 await assert.rejects(f.app.services.production.image({session_id:id,owner_id:owner,payload:JSON.stringify({page:0})}),/尚未通过审片/);
 release();await until(()=>f.control.calls.length===1);
 assert.equal((await document(f,id)).visualReview.status,'passed');assert.equal(f.control.reviews.length,1);
});

for(const provider of ['codex','gemini'])test(`${provider}: one automatic repair round then block; concurrent manual continue reuses saved issues`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(),viewer=crypto.randomUUID();let blocked=true;
 f.control.beforeText=async kind=>kind==='review'?{issues:blocked?[issue(3)]:[]}:undefined;
 await f.demand(id,viewer);await until(async()=>(await f.read(id)).state==='failed');
 const stopped=await f.read(id);assert.equal(stopped.retryStage,'review');assert.equal(stopped.generationProgress.reviewStatus,'blocked');assert.match(stopped.error,/第 3 幅/);
 assert.equal(f.control.reviews.length,2);assert.equal(f.control.repairs.length,1);assert.equal(f.control.calls.length,0);
 await f.app.services.production.tick();await f.read(id);assert.equal(f.control.reviews.length,2);
 blocked=false;await Promise.all([f.demand(id,viewer,0,true),f.demand(id,crypto.randomUUID(),0,true)]);await until(()=>f.control.calls.length===1);
 assert.equal(f.control.repairs.length,2);assert.equal(f.control.reviews.length,3);assert.deepEqual(f.control.repairs.map(p=>p.requestedPages),[[3],[3]]);
 const doc=await document(f,id);assert.equal(doc.visualReview.status,'passed');assert.equal(doc.visualReview.reports.length,3);
 assert.deepEqual(doc.usage.filter(u=>u.step.startsWith('repair:')).map(u=>u.step),['repair:1:3','repair:3:3']);
});

test('legacy client does not automatically retry a quality blockage',async()=>{
 let posts=0;const blocked={id:'test',state:'failed',stage:'分镜审片待修订',retryStage:'review',retryAllowed:true,error:'请继续修订',ready:0,story:null,selection:{length:8}};
 assert.equal(await runStoryGeneration({sessionId:'test',throughPage:0,retries:new Map(),isActive:()=>true,onSession:()=>{},request:async(path,method)=>{if(method)posts++;return blocked;}}),blocked.error);
 assert.equal(posts,0);
});

test('21 requested repairs are saved as 20+1 and only then reviewed again',async t=>{
 const f=await productionFixture(t),id=await f.create(25);
 f.control.beforeText=async kind=>kind==='review'&&f.control.reviews.length===1?{issues:Array.from({length:21},(_,i)=>issue(i+1))}:undefined;
 await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.deepEqual(f.control.repairs.map(p=>p.requestedPages.length),[20,1]);assert.equal(f.control.reviews.length,2);
 assert.equal((await document(f,id)).visualReview.status,'passed');
});

for(const malformed of ['duplicate','out-of-range'])test(`review ${malformed} pages fail validation without image requests`,async t=>{
 const f=await productionFixture(t),id=await f.create();let invalid=true;
 f.control.beforeText=async kind=>kind==='review'?{issues:invalid?(malformed==='duplicate'?[issue(2),issue(2)]:[issue(9)]):[]}:undefined;
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 assert.equal(f.control.calls.length,0);assert.equal((await document(f,id)).visualReview.round,0);
 invalid=false;await f.demand(id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===1);assert.equal(f.control.plans.length,1);
});

for(const malformed of ['missing','duplicate','extra','bad-caption'])test(`repair ${malformed} output cannot mutate the saved plan`,async t=>{
 const f=await productionFixture(t),id=await f.create();let invalid=true,before;
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='review'&&f.control.reviews.length===1){before=structuredClone(payload.plan);return {issues:[issue(2),issue(3)]};}
  if(kind==='repair'&&invalid){
   const p=page=>({page,...payload.plan.pages[page-1]});
   return {pages:malformed==='missing'?[p(2)]:malformed==='duplicate'?[p(2),p(2)]:malformed==='extra'?[p(2),p(4)]:[{...p(2),caption:''},p(3)]};
  }
 };
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');assert.deepEqual((await document(f,id)).plan,before);assert.equal(f.control.calls.length,0);
 invalid=false;await f.demand(id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===1);assert.equal(f.control.reviews.length,2);assert.equal(f.control.repairs.length,2);
});

for(const phase of ['review','repair'])for(const action of ['pause','stop','leave'])test(`${phase} in flight drains on ${action} and resumes from saved checkpoints after restart`,async t=>{
 const f=await productionFixture(t),id=await f.create(),viewer=crypto.randomUUID();let release,started;
 const hold=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 f.control.beforeText=async kind=>{
  if(kind===phase){started();await hold;}
  if(kind==='review'&&phase==='repair'&&f.control.reviews.length===1)return {issues:[issue(2)]};
 };
 await f.demand(id,viewer);await ready;
 if(action==='leave')await f.leave(id,viewer);else await f.json(`sessions/${id}/production-control`,'POST',{action});release();
 await until(async()=>{const row=await f.app.services.database.prepare('SELECT state FROM reader_sessions WHERE id=?').bind(id).first();return row.state!=='running';});
 const reviews=f.control.reviews.length,repairs=f.control.repairs.length;assert.equal(f.control.calls.length,0);
 await f.restart();await f.app.services.production.tick();assert.equal(f.control.calls.length,0);
 if(action!=='leave')await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});await f.demand(id);await until(async()=>(await f.read(id)).ready>=1);
 assert.equal(f.control.repairs.length,repairs);assert.equal(f.control.reviews.length,reviews+(phase==='repair'?1:0));
});

test('old complete plans remain readable without a retroactive audit',async t=>{
 const f=await productionFixture(t),id=await f.create(),repo=new ReaderRepository(f.app.services.database);
 const g=f.generation.generator();delete g.review;delete g.repair;
 await advanceStory(repo,g,owner,id,0);assert.equal((await document(f,id)).visualReview,undefined);
 await f.demand(id);await until(()=>f.control.calls.length===1);assert.equal(f.control.reviews.length,0);
});
test('a saved review whose queue receipt was lost is not paid twice',async t=>{
 const f=await productionFixture(t),id=await f.create(),repo=new ReaderRepository(f.app.services.database),g=f.generation.generator();
 f.control.beforeText=async kind=>kind==='review'&&f.control.reviews.length===1?{issues:[issue(2)]}:undefined;
 await advanceStory(repo,g,owner,id,0);await advanceStory(repo,g,owner,id,0);assert.equal((await document(f,id)).visualReview.status,'repair');
 const stale={id:crypto.randomUUID(),sessionId:id,ownerId:owner,kind:'script',pool:'text',version:'lost-review-receipt',dependencies:[],payload:{stepKey:'review:0'},priority:-20};
 await f.app.services.production.queue.enqueue(stale);await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.equal((await f.app.services.production.queue.job(stale.id)).state,'succeeded');assert.equal(f.control.reviews.length,2);assert.equal(f.control.repairs.length,1);
 assert.equal((await document(f,id)).usage.filter(u=>u.step==='review:0').length,1);
});
for(const provider of ['codex','gemini'])test(`${provider}: targeted repair checkpoints precede a fresh whole-plan review`,async t=>{
 const f=await productionFixture(t,provider),id=await f.create(25);let before;
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='review'){
   assert.equal(f.control.calls.length,0);
   if(f.control.reviews.length===1){before=structuredClone(payload.plan);return {issues:[issue(2),issue(21)]};}
  }
 };
 await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.equal(f.control.reviews.length,2);assert.equal(f.control.repairs.length,1);assert.deepEqual(f.control.repairs[0].requestedPages,[2,21]);
 const after=await document(f,id);assert.equal(after.visualReview.status,'passed');assert.deepEqual(after.storyboard.pages,after.plan.pages);
 for(let page=0;page<25;page++)if(![1,20].includes(page))assert.deepEqual(after.plan.pages[page],before.pages[page]);
 assert.notDeepEqual(after.plan.pages[1],before.pages[1]);const {pages:_,...metadata}=after.plan,{pages:__,...original}=before;assert.deepEqual(metadata,original);
 assert.deepEqual(after.usage.filter(u=>/review:|repair:/.test(u.step)).map(u=>u.step),['review:0','repair:1:2','review:1']);
});
