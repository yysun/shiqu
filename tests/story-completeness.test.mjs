// Keep structural omissions out of local repairs and drawing; ordinary opening edits remain repairable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {confirmedStory} from './fixtures/production-dag-story.mjs';
const count=(list,name)=>list.filter(n=>n===name).length;
import {reviewReportSchema} from '../lib/reader-review.ts';

const omission={page:18,category:'progression',requiresReplan:true,problem:'分镜停在董卓携貂蝉回郿坞，遗漏王允说服吕布、诱董入朝及吕布诛董的结果。',instruction:'按原文从定计到诛董重新编排，压缩前半段宴饮与示情，为关键行动及结果分配画幅。'};
const document=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);

test('a structural omission gets one structure repair that adds the missing frame, then a fresh review, and only then drawing',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;let structures=0,localRepairs=0;
 f.control.beforeText=async(kind,payload,schema)=>{
  if(kind==='review'){
   assert.ok(schema.properties.issues.items.required.includes('requiresReplan'));
   return {issues:f.control.reviews.length===1?[{...omission,page:4}]:[]};
  }
  if(kind==='structure'){structures++;return {edits:[{from:5,to:4,pages:[{caption:'王允说服吕布，二人定下诛董之计。'}]}]};}
  if(kind==='sceneRepair'||kind==='visualRepair')localRepairs++;
 };
 const id=await confirmedStory(f,6);f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const saved=await document(f,id);
 assert.equal(structures,1);assert.equal(localRepairs,0,'a structural issue is not hidden by a local caption fix');
 assert.equal(saved.plan.pages.length,7);assert.equal(f.control.reviews.length,2,'the repaired story is reviewed again');
 assert.equal(f.control.calls.length,7,'images are drawn only after the review approved the new structure');
});

test('a missing opening introduction is repaired in frame one without replanning or adding frames',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 const opening='庄周在梦中化作一只蝴蝶，正自在地飞舞，忘了自己原来的身份。';let requested;
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='review')return {issues:f.control.reviews.length===1?[{page:1,category:'caption',requiresReplan:false,problem:'首幅没有介绍庄周或梦中处境，直接使用“他”，读者无法定位人物。',instruction:'首幅简短介绍庄周梦为蝴蝶的处境，保持后续编排与原有画面。'}]:[]};
  if(kind==='sceneRepair'){requested=payload.frames.map(frame=>frame.number);return {frames:payload.frames.map(frame=>({number:frame.number,caption:opening}))};}
 };
 const id=await confirmedStory(f,3);f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const saved=await document(f,id);
 assert.equal(saved.plan.pages.length,3);assert.equal(saved.plan.pages[0].caption,opening);
 assert.equal(count(f.control.dagCalls,'outline'),1);assert.deepEqual(requested,[1]);
 assert.equal(f.control.reviews.length,2);
});

test('historical issues stay compatible; a replan marker cannot masquerade as an ending or local caption issue',()=>{
 const report={titleReview:{title:'貂蝉与连环计',reason:'标题对应原文主事件。'},issues:[omission]};
 assert.equal(reviewReportSchema(18).parse(report).issues[0].requiresReplan,true);
 const {requiresReplan,...old}=omission;assert.equal(reviewReportSchema(18).parse({...report,issues:[old]}).issues[0].requiresReplan,undefined);
 for(const issue of [{...omission,page:0,category:'reflection'},{...omission,category:'caption'}])assert.throws(()=>reviewReportSchema(18).parse({...report,issues:[issue]}));
});
