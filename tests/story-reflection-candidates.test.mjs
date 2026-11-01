// Protect saved candidate choices, restart safety and the all-rejected repair path through real adapters.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,makePlan} from './fixtures/production.mjs';
import {reflectionCandidatesSchema} from '../lib/reader-model.ts';
import {reviewReportSchema} from '../lib/reader-review.ts';

const candidates=['梦中的自在，也能照见醒时的拘束。','醒来之后，梦中的自在仍值得回味。','梦与醒的分界，也未必是心境的分界。'];
const choice=index=>({index,reason:'保留梦醒后的对照，避免重复情节，语气有分寸。'});
const document=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first()).document);

for(const provider of ['codex','gemini'])for(const index of [2,3])test(`${provider}: audit selects candidate ${index} exactly and persists its evidence before drawing`,async t=>{
 const f=await productionFixture(t,provider),id=await f.createLegacyReader();let frames;
 f.control.beforeText=async(kind,payload,schema)=>{
  if(kind==='reflection')return {candidates};
  if(kind==='review'){
   const doc=await document(f,id);frames=structuredClone(doc.plan.pages);
   assert.deepEqual(doc.reflectionCandidates,candidates);assert.deepEqual(payload.reflectionCandidates,candidates);
   assert.equal(payload.theme,undefined);
   assert.equal(payload.verifiedOriginal.text,doc.original.text);assert.equal(payload.plan.reflection,candidates[0]);
   assert.ok(schema.required.includes('reflectionChoice'));assert.equal(f.control.calls.length,0);
   return {issues:[],reflectionChoice:choice(index)};
  }
 };
 await f.demand(id);await until(()=>f.control.calls.length===1);
 const doc=await document(f,id);
 assert.equal(doc.plan.reflection,candidates[index-1]);assert.equal(doc.reflectionCandidates,undefined);
 assert.deepEqual(doc.plan.pages,frames);assert.deepEqual(doc.visualReview.reports[0].reflectionChoice,{...choice(index),candidates});
 assert.equal(f.control.reflections.length,1);assert.equal(f.control.reviews.length,1);assert.equal(f.control.reflectionRepairs.length,0);
 assert.equal(doc.usage.filter(u=>u.step==='reflection').length,1);
});

test('failed choice audit resumes after restart without regenerating candidates or frames',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();let fail=true;
 f.control.beforeText=async kind=>kind==='reflection'?{candidates}:kind==='review'?fail?Promise.reject(Error('audit unavailable')):{issues:[],reflectionChoice:choice(3)}:undefined;
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 const before=await document(f,id);assert.deepEqual(before.reflectionCandidates,candidates);assert.equal(f.control.calls.length,0);
 fail=false;await f.restart();await f.demand(id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===1);
 const doc=await document(f,id);assert.equal(doc.plan.reflection,candidates[2]);assert.deepEqual(doc.plan.pages,before.plan.pages);
 assert.equal(f.control.reflections.length,1);assert.equal(f.control.plans.length,1);
});

for(const invalid of ['missing','range','reason'])test(`invalid ${invalid} choice cannot mutate the saved plan or discard candidates`,async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();let bad=true;
 f.control.beforeText=async kind=>kind==='reflection'?{candidates}:kind==='review'?{issues:[],reflectionChoice:bad?(invalid==='missing'?undefined:invalid==='range'?choice(4):{index:2,reason:''}):choice(2)}:undefined;
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 const before=await document(f,id);assert.deepEqual(before.reflectionCandidates,candidates);assert.equal(before.plan.reflection,candidates[0]);assert.equal(before.visualReview.reports.length,0);assert.equal(f.control.calls.length,0);
 bad=false;await f.demand(id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===1);
 assert.equal((await document(f,id)).plan.reflection,candidates[1]);assert.equal(f.control.reflections.length,1);
});

for(const values of [candidates.slice(0,2),[candidates[0],candidates[0],candidates[2]],[' ',candidates[1],candidates[2]]])test(`invalid candidates ${JSON.stringify(values)} preserve the saved storyboard`,async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();let bad=true;
 f.control.beforeText=async kind=>kind==='reflection'?{candidates:bad?values:candidates}:undefined;
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 const before=await document(f,id);assert.equal(before.plan,null);assert.equal(before.draft.pages.length,8);assert.equal(f.control.calls.length,0);assert.equal(f.control.reviews.length,0);
 bad=false;await f.demand(id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===1);
 assert.deepEqual((await document(f,id)).plan.pages,before.draft.pages);assert.equal(f.control.plans.length,1);
});

test('all-rejected selection repairs only the selected sentence, then audits without stale candidates',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(),fixed='梦醒之后，仍可以记住梦中的自在。';
 const issue={page:0,category:'reflection',problem:'三句都在重复已知情节，所选第三句仍需提炼。',instruction:'只改所选结语，保留完整分镜。'};
 f.control.beforeText=async(kind,payload,schema)=>{
  if(kind==='reflection')return {candidates};
  if(kind==='review'){
   if(f.control.reviews.length===1)return {issues:[issue],reflectionChoice:choice(3)};
   assert.equal(payload.reflectionCandidates,undefined);assert.equal(schema.properties.reflectionChoice,undefined);
   assert.equal(payload.plan.reflection,fixed);
  }
  if(kind==='reflection-repair'){assert.equal(payload.revision.reflection,candidates[2]);assert.deepEqual(payload.revision.issues,[issue]);return {reflection:fixed};}
 };
 await f.demand(id);await until(()=>f.control.calls.length===1);
 const doc=await document(f,id);assert.equal(doc.plan.reflection,fixed);assert.equal(doc.visualReview.status,'passed');
 assert.equal(f.control.reflections.length,1);assert.equal(f.control.reflectionRepairs.length,1);assert.equal(f.control.repairs.length,0);assert.equal(f.control.reviews.length,2);
 assert.deepEqual(doc.visualReview.reports[0].reflectionChoice,{...choice(3),candidates});
});

test('candidate and choice schemas preserve the old single-ending report contract',()=>{
 assert.deepEqual(reflectionCandidatesSchema.parse(candidates),candidates);
 const titleReview={title:'庄周梦蝶',reason:'标题准确对应当前故事。'};
 assert.deepEqual(reviewReportSchema(8).parse({issues:[],titleReview}),{issues:[],titleReview});
 assert.throws(()=>reviewReportSchema(8,candidates).parse({issues:[],titleReview}));
 assert.throws(()=>reviewReportSchema(8).parse({issues:[],titleReview,reflectionChoice:choice(1)}));
 assert.deepEqual(reviewReportSchema(8,candidates).parse({issues:[],titleReview,reflectionChoice:choice(3)}).reflectionChoice,choice(3));
});

for(const provider of ['codex','gemini'])test(`${provider}: editorial theme guides review and scene repair, with original facts and authored requirements intact`,async t=>{
 const f=await productionFixture(t,provider),g=f.generation.generator();
 const selection={bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'放下执念',length:8,artStyle:'ink-pencil',voice:false,productionPrompt:'用简洁旁白讲述，保留原文事实。'};
 const plan=makePlan(8),original={title:'《庄子·齐物论》',text:'昔者庄周梦为胡蝶。',url:'https://example.org',kind:'passage',provider:'controlled',retrievedAt:'2026-10-31T00:00:00Z'};
 const seen=[];
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='review'||kind==='repair'){
   seen.push(kind);assert.equal(payload.theme,undefined);assert.deepEqual(payload.editorialContext,{mode:'theme',theme:selection.theme});assert.equal(payload.productionPrompt,selection.productionPrompt);
   assert.ok(!payload.productionPrompt.includes(selection.theme));assert.equal(payload.verifiedOriginal.text,original.text);
  }
 };
 await g.review(selection,plan,original,undefined,candidates);
 await g.repair(selection,plan,original,[{page:1,category:'caption',problem:'配文含混。',instruction:'保留事实，译清字面关系。'}]);
 assert.deepEqual(seen,['review','repair']);assert.equal(f.control.calls.length,0);
});
