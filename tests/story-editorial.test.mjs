// Preserve theme/source context through scene work, then independently audit title and ending before drawing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn} from './fixtures/production.mjs';
import {confirmedStory} from './fixtures/production-dag-story.mjs';
import {storyEditorialContext} from '../lib/reader-prompts.ts';

const candidates=['梦与醒各有真实，不必急着抹去其中一种。','自在的一刻，可以照见平日未察的拘束。','熟悉的身份，也未必穷尽一个人的感受。'];
const document=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);
for(const theme of ['放下执念','原典故事'])test(`${theme}: the editorial context reaches scene work, then the ending is drafted and chosen in the review before any drawing`,async t=>{
 const f=await productionFixture(t,'codex'),context=theme==='原典故事'?{mode:'source'}:{mode:'theme',theme};
 f.control.hold=false;
 const proposed=theme==='原典故事'?'梦中的片段':'放下所有执念才有自由';const contexts=[];let reviewCalls=0;
 f.control.beforeText=async(kind,payload,schema)=>{
  assert.equal(payload.theme,undefined);
  if(['outline','sceneBatch','sceneRepair'].includes(kind)){contexts.push(kind);assert.deepEqual(payload.editorialContext,context);return;}
  if(kind==='reflection'){
   assert.equal(f.control.calls.length,0);assert.deepEqual(payload.editorialContext,context);
   assert.ok(schema.required.includes('title'));assert.ok(schema.required.includes('candidates'));
   return {title:proposed,candidates};
  }
  if(kind==='review'){
   reviewCalls++;assert.deepEqual(payload.editorialContext,context);assert.equal(f.control.calls.length,0,'no drawing before the review');
   assert.ok(schema.required.includes('reflectionChoice'));
   return {issues:[],titleReview:{title:proposed,reason:'标题范围准确，立意符合原文。'},reflectionChoice:{index:2,reason:'这一层认识有原文依据，判断明确，不靠概括全部情节显得完整。'}};
  }
 };
 const id=await confirmedStory(f,4,{},{theme});f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const doc=await document(f,id),session=await f.read(id);
 assert.ok(contexts.includes('outline')&&contexts.includes('sceneBatch'));
 assert.equal(doc.plan.title,proposed);assert.equal(doc.plan.reflection,candidates[1]);
 assert.equal(session.story.title,proposed);assert.equal(session.story.theme,theme);
 assert.equal(f.control.reflections.length,1);assert.equal(reviewCalls,1);
});

for(const invalid of [{title:'',reason:'标题不准确。'},{title:'   ',reason:'标题不准确。'},{title:'字'.repeat(41),reason:'标题太长。'},{title:'庄周梦蝶',reason:''}])test(`invalid title audit ${JSON.stringify(invalid)} blocks drawing until a valid review is recovered`,async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;let bad=true;
 f.control.beforeText=async kind=>kind==='reflection'?{title:'庄周梦蝶',candidates}:kind==='review'?{issues:[],titleReview:bad?invalid:{title:'庄周梦蝶',reason:'标题对应完整故事。'},reflectionChoice:{index:1,reason:'保留原文支持的认识。'}}:undefined;
 const id=await confirmedStory(f,4);f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.length>0,20000);
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 const before=await document(f,id);assert.notEqual((await f.read(id)).state,'completed');assert.equal(f.control.calls.length,0);
 assert.equal(before.dag.products['narrativeVerdict:'],undefined,'an invalid audit records no verdict');
 bad=false;
 const fault=(await f.read(id)).faults.find(x=>x.retryAllowed);assert.ok(fault);
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const after=await document(f,id);assert.equal(after.plan.title,'庄周梦蝶');assert.equal(f.control.reflections.length,1);
});

test('source editorial context never treats its display label as a theme to satisfy',()=>{
 for(const theme of ['原典故事','忠于原文','其他',''])assert.deepEqual(storyEditorialContext(theme),{mode:'source'});
 assert.deepEqual(storyEditorialContext(' 人情冷暖 '),{mode:'theme',theme:'人情冷暖'});
});
