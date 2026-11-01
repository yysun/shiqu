// Check ending checkpoints and repair scope with both real adapters and controlled inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,makeReflectionCandidates} from './fixtures/production.mjs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import {reviewReportSchema} from '../lib/reader-review.ts';
import {readLibrarySummary} from '../desktop/library-preview.ts';
import {generationProgress} from '../lib/generation-progress.ts';

const owner='docker-local-owner';
const document=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first()).document);
const endingIssue={page:0,category:'reflection',problem:'结语把已还阳奉母的处境误写成荣誉与责任不能兼顾。',instruction:'结合已死三日、还阳九年及母丧后赴任的完整因果，只重写结语。'};
const ending='生死本无宽限，未尽的亲情却让它通融了九年。';

for(const provider of ['codex','gemini'])for(const length of [8,25])test(`${provider}: ${length} saved frames precede the separate ending and whole-story audit`,async t=>{
 const f=await productionFixture(t,provider),id=await f.createLegacyReader(length),events=[];
 f.control.beforeText=async(kind,payload,schema)=>{
  events.push(kind);
  if(['outline','plan','batch'].includes(kind))assert.equal(schema.properties.reflection,undefined);
  if(kind==='reflection'){
   const doc=await document(f,id),session=await f.read(id);
   assert.equal(doc.plan,null);assert.equal(doc.draft.pages.length,length);
   assert.equal(doc.draft.reflection,undefined);assert.equal(doc.storyboard?.outline.reflection,undefined);
   assert.deepEqual(payload.draft,doc.draft);assert.equal(payload.verifiedOriginal.text,doc.original.text);
   assert.deepEqual(Object.keys(schema.properties),['title','candidates']);
   assert.equal(session.generationProgress.phase,'reflection');assert.equal(session.story,null);
   assert.match(generationProgress(session,0).steps[2].detail,/分镜已保存.*结语/);
   assert.equal(readLibrarySummary(f.dataDirectory).stories.find(s=>s.id===id).production.phase,'reflection');
   assert.equal(f.control.calls.length,0);return {candidates:makeReflectionCandidates(ending)};
  }
  if(kind==='review'){
   assert.equal(payload.plan.reflection,ending);assert.equal(payload.plan.pages.length,length);
   assert.equal(f.control.reflections.length,1);assert.equal(f.control.calls.length,0);
  }
 };
 await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.ok(events.indexOf('reflection')>events.lastIndexOf(length>20?'batch':'plan'));
 assert.ok(events.indexOf('review')>events.indexOf('reflection'));
 const doc=await document(f,id);assert.equal(doc.draft,undefined);
 assert.equal(doc.usage.filter(u=>u.step==='reflection').length,1);
});

for(const provider of ['codex','gemini'])test(`${provider}: failed ending resumes after restart without re-planning saved scenes`,async t=>{
 const f=await productionFixture(t,provider),id=await f.createLegacyReader(25);let fail=true;
 f.control.beforeText=async kind=>{if(kind==='reflection'&&fail)throw Error('ending unavailable');};
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 const saved=await document(f,id),plans=f.control.plans.length,outlines=f.control.outlines.length;
 assert.equal(saved.draft.pages.length,25);assert.equal(saved.plan,null);assert.equal(f.control.calls.length,0);
 fail=false;await f.restart();await f.demand(id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===1);
 const doc=await document(f,id);
 assert.deepEqual(doc.plan.pages,saved.draft.pages);assert.equal(f.control.plans.length,plans);assert.equal(f.control.outlines.length,outlines);
 assert.equal(doc.usage.filter(u=>u.step==='reflection').length,1);
});

for(const provider of ['codex','gemini'])test(`${provider}: ending-only repair is audited again and preserves every scene`,async t=>{
 const f=await productionFixture(t,provider),id=await f.createLegacyReader();let before;
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='review'){
   assert.equal(f.control.calls.length,0);
   if(f.control.reviews.length===1){before=structuredClone(payload.plan);return {issues:[endingIssue]};}
   assert.equal(payload.plan.reflection,ending);
  }
  if(kind==='reflection-repair'){
   assert.equal(payload.revision.reflection,before.reflection);
   assert.deepEqual(payload.revision.issues,[endingIssue]);return {reflection:ending};
  }
 };
 await f.demand(id);await until(()=>f.control.calls.length===1);
 const doc=await document(f,id);
 assert.deepEqual(doc.plan,{...before,reflection:ending});assert.equal(f.control.repairs.length,0);
 assert.equal(f.control.reflectionRepairs.length,1);assert.equal(f.control.reviews.length,2);
 assert.deepEqual(doc.visualReview.history[0],{round:1,requested:[0],changes:[],reflection:ending});
 assert.equal(doc.visualReview.status,'passed');
});

test('mixed issues repair all scene batches before rewriting the ending from the corrected whole',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(25),events=[];
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='review'&&f.control.reviews.length===1)return {issues:[endingIssue,...Array.from({length:21},(_,i)=>({page:i+1,category:'caption',problem:'事实关系含混。',instruction:'修正对应配文。'}))]};
  if(kind==='repair')events.push(payload.requestedPages.length);
  if(kind==='reflection-repair'){
   events.push('ending');
   assert.deepEqual(payload.draft.pages,(await document(f,id)).plan.pages);
   for(let page=0;page<21;page++)assert.match(payload.draft.pages[page].prompt,/Revised staging/);
   return {reflection:ending};
  }
 };
 await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.deepEqual(events,[20,1,'ending']);assert.equal(f.control.reviews.length,2);
 const doc=await document(f,id);assert.equal(doc.visualReview.repairs,1);assert.equal(doc.visualReview.status,'passed');
});

test('unchanged ending blocks drawing and manual continuation uses the saved ending issue',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();let unchanged=true;
 f.control.beforeText=async(kind,payload)=>kind==='review'&&f.control.reviews.length===1?{issues:[endingIssue]}:kind==='reflection-repair'?{reflection:unchanged?payload.revision.reflection:ending}:undefined;
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 const blocked=await f.read(id);assert.match(blocked.error,/结语：/);assert.doesNotMatch(blocked.error,/第 0 幅/);
 assert.deepEqual(blocked.reviewIssues,[endingIssue]);assert.equal(f.control.calls.length,0);
 assert.equal((await document(f,id)).visualReview.stopReason,'unchanged');
 unchanged=false;await f.demand(id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===1);
 assert.equal(f.control.reviews.length,2);assert.equal(f.control.reflections.length,1);assert.equal(f.control.reflectionRepairs.length,2);
});

test('saved ending receipts and concurrent advances cannot repeat a paid ending',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(),repo=new ReaderRepository(f.app.services.database),g=f.generation.generator();
 await advanceStory(repo,g,owner,id,0);
 let started,release;const ready=new Promise(r=>started=r),hold=new Promise(r=>release=r);
 f.control.beforeText=async kind=>{if(kind==='reflection'){started();await hold;}};
 const first=advanceStory(repo,g,owner,id,0);await ready;
 assert.equal((await advanceStory(repo,g,owner,id,0)).state,'running');release();await first;
 const stale={id:crypto.randomUUID(),sessionId:id,ownerId:owner,kind:'script',pool:'text',version:'lost-ending-receipt',dependencies:[],payload:{stepKey:'reflection'},priority:-20};
 await f.app.services.production.queue.enqueue(stale);await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.equal((await f.app.services.production.queue.job(stale.id)).state,'succeeded');assert.equal(f.control.reflections.length,1);
 assert.equal((await document(f,id)).usage.filter(u=>u.step==='reflection').length,1);
});

test('review validation keeps ending issues separate from real frame numbers',()=>{
 const schema=reviewReportSchema(1);
 assert.deepEqual(schema.parse({titleReview:{title:'原典故事名',reason:'保留原题。'},issues:[endingIssue,{...endingIssue,page:1,category:'source'}]}).issues.length,2);
 for(const issues of [[{...endingIssue,page:1}],[{...endingIssue,category:'source'}],[endingIssue,endingIssue]])assert.throws(()=>schema.parse({titleReview:{title:'原典故事名',reason:'保留原题。'},issues}));
});

test('repairing an ending in a revision retains all existing images',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();f.control.hold=false;
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(id)).state==='completed');
 const base=await f.json(`sessions/${id}/revisions`),plan={...base.plan,reflection:'一个人看重什么，往往在荣誉与责任不能兼顾时显露出来。'};
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan}});
 const imageCalls=f.control.calls.length,reviewCalls=f.control.reviews.length;
 f.control.beforeText=async kind=>kind==='review'&&f.control.reviews.length===reviewCalls+1?{issues:[endingIssue]}:kind==='reflection-repair'?{reflection:ending}:undefined;
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(child.id)).state==='completed');
 const doc=await document(f,child.id);
 assert.equal(doc.plan.reflection,ending);assert.equal(f.control.calls.length,imageCalls);
 assert.equal(doc.images.filter(Boolean).length,base.plan.pages.length);
 assert.equal((await document(f,id)).plan.reflection,base.plan.reflection);
});
