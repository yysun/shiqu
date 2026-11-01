// Keep structural omissions out of local repairs and drawing; ordinary opening edits remain repairable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {reviewReportSchema} from '../lib/reader-review.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';

const owner='docker-local-owner';
const omission={page:18,category:'progression',requiresReplan:true,problem:'分镜停在董卓携貂蝉回郿坞，遗漏王允说服吕布、诱董入朝及吕布诛董的结果。',instruction:'按原文从定计到诛董重新编排，压缩前半段宴饮与示情，为关键行动及结果分配画幅。'};
const document=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first()).document);

for(const provider of ['codex','gemini'])test(`${provider}: structural omissions block before any repair or image and survive retries and restart`,async t=>{
 const f=await productionFixture(t,provider);let incomplete=true;
 f.control.beforeText=async(kind,payload,schema)=>{
  if(kind==='review'){
   assert.ok(schema.properties.issues.items.required.includes('requiresReplan'));
   return {issues:incomplete?[omission]:[]};
  }
 };
 const id=await f.createLegacyReader(18);await f.demand(id);
 await until(async()=>(await f.read(id)).state==='failed');
 const stopped=await f.read(id),before=await document(f,id);
 assert.equal(stopped.generationProgress.reviewStopReason,'replan');assert.equal(stopped.retryAllowed,false);
 assert.equal(stopped.reviewIssues[0].requiresReplan,true);assert.match(stopped.error,/重新编排/);
 assert.equal(before.visualReview.reports.length,1);assert.equal(before.visualReview.repairs,0);
 assert.equal(f.control.repairs.length,0);assert.equal(f.control.calls.length,0);
 assert.equal((await f.request(`sessions/${id}/production`,'POST',{viewerId:crypto.randomUUID(),page:0,retry:true})).status,409);
 assert.deepEqual(await document(f,id),before);
 await f.restart();await f.app.services.production.tick();
 assert.equal((await f.read(id)).generationProgress.reviewStopReason,'replan');
 assert.equal(f.control.reviews.length,1);assert.equal(f.control.repairs.length,0);assert.equal(f.control.calls.length,0);
 const repo=new ReaderRepository(f.app.services.database);
 await advanceStory(repo,f.generation.generator(),owner,id,0,true);
 assert.equal((await document(f,id)).visualReview.status,'blocked');assert.equal(f.control.repairs.length,0);
 // The existing revision path resets the audit only after requirements are actually changed.
 incomplete=false;f.control.hold=false;
 const base=await f.json(`sessions/${id}/revisions`);
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{productionPrompt:'按完整主事件重新编排，首幅介绍人物处境，保留关键行动和原文结局。'}});
 await until(async()=>(await f.read(child.id)).state==='completed');
 assert.equal((await document(f,child.id)).visualReview.status,'passed');
 assert.equal((await document(f,id)).visualReview.status,'blocked');
 assert.equal(f.control.reviews.length,2);assert.equal(f.control.plans.length,2);
});

test('a missing opening introduction is repaired in frame one without replanning or adding frames',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 const opening='庄周在梦中化作一只蝴蝶，正自在地飞舞，忘了自己原来的身份。';
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='review')return {issues:f.control.reviews.length===1?[{page:1,category:'caption',requiresReplan:false,problem:'首幅没有介绍庄周或梦中处境，直接使用“他”，读者无法定位人物。',instruction:'首幅简短介绍庄周梦为蝴蝶的处境，保持后续编排与原有画面。'}]:[]};
  if(kind==='repair')return {pages:[{page:1,caption:opening,prompt:payload.plan.pages[0].prompt}]};
 };
 const id=await f.create(3);await until(async()=>(await f.read(id)).state==='completed');
 const saved=await document(f,id);
 assert.equal(saved.plan.pages.length,3);assert.equal(saved.plan.pages[0].caption,opening);
 assert.equal(f.control.plans.length,1);assert.deepEqual(f.control.repairs[0].requestedPages,[1]);
 assert.equal(f.control.reviews.length,2);assert.equal(saved.visualReview.status,'passed');
});

test('historical issues stay compatible; a replan marker cannot masquerade as an ending or local caption issue',()=>{
 const report={titleReview:{title:'貂蝉与连环计',reason:'标题对应原文主事件。'},issues:[omission]};
 assert.equal(reviewReportSchema(18).parse(report).issues[0].requiresReplan,true);
 const {requiresReplan,...old}=omission;assert.equal(reviewReportSchema(18).parse({...report,issues:[old]}).issues[0].requiresReplan,undefined);
 for(const issue of [{...omission,page:0,category:'reflection'},{...omission,category:'caption'}])assert.throws(()=>reviewReportSchema(18).parse({...report,issues:[issue]}));
});
