// Preserve theme/source context through scene work, then independently audit title and ending before drawing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {storyEditorialContext} from '../lib/reader-prompts.ts';

const candidates=['梦与醒各有真实，不必急着抹去其中一种。','自在的一刻，可以照见平日未察的拘束。','熟悉的身份，也未必穷尽一个人的感受。'];
const document=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first()).document);
for(const provider of ['codex','gemini'])for(const theme of ['放下执念','原典故事'])test(`${provider}: ${theme} edits title and ending after saved scenes, then independently audits both`,async t=>{
 const f=await productionFixture(t,provider),id=await f.createLegacyReader(8,{theme}),context=theme==='原典故事'?{mode:'source'}:{mode:'theme',theme};
 const proposed=theme==='原典故事'?'梦中的片段':'放下所有执念才有自由',finalTitle=theme==='原典故事'?'庄周梦蝶':'梦醒，还认得自己吗';let savedDraft;
 f.control.beforeText=async(kind,payload,schema)=>{
  assert.equal(payload.theme,undefined);
  if(['plan','outline','batch','repair'].includes(kind)){assert.deepEqual(payload.editorialContext,context);return;}
  if(kind==='reflection'){
   const doc=await document(f,id);savedDraft=structuredClone(doc.draft);
   assert.equal(doc.plan,null);assert.equal(doc.draft.pages.length,8);assert.equal(f.control.calls.length,0);
   assert.deepEqual(payload.editorialContext,context);const {summary:_,...sourceMetadata}=savedDraft;void _;assert.deepEqual(payload.draft,sourceMetadata);
   assert.ok(schema.required.includes('title'));assert.ok(schema.required.includes('candidates'));
   return {title:proposed,candidates};
  }
  if(kind==='review'){
   assert.deepEqual(payload.editorialContext,context);assert.equal(payload.plan.title,proposed);assert.equal(f.control.calls.length,0);
   assert.ok(schema.required.includes('titleReview'));assert.ok(schema.required.includes('reflectionChoice'));
   return {issues:[],titleReview:{title:finalTitle,reason:'原题的范围或立意不符合原文，修正后准确且可识别。'},reflectionChoice:{index:2,reason:'这一层认识有原文依据，判断明确，不靠概括全部情节显得完整。'}};
  }
 };
 await f.demand(id);await until(()=>f.control.calls.length===1);
 const doc=await document(f,id),session=await f.read(id);
 assert.deepEqual(doc.plan,{...savedDraft,title:finalTitle,reflection:candidates[1]});
 assert.equal(session.story.title,finalTitle);assert.equal(session.story.theme,theme);
 assert.deepEqual(doc.visualReview.reports[0].titleReview,{previousTitle:proposed,title:finalTitle,reason:'原题的范围或立意不符合原文，修正后准确且可识别。'});
 assert.equal(doc.visualReview.reports[0].reflectionChoice.index,2);assert.equal(doc.visualReview.status,'passed');
 assert.equal(f.control.reflections.length,1);assert.equal(f.control.reviews.length,1);assert.equal(f.control.plans.length,1);
});

for(const invalid of [{title:'',reason:'标题不准确。'},{title:'   ',reason:'标题不准确。'},{title:'字'.repeat(41),reason:'标题太长。'},{title:'庄周梦蝶',reason:''}])test(`invalid title audit ${JSON.stringify(invalid)} cannot change the plan or authorize drawing`,async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader();let bad=true;
 f.control.beforeText=async(kind,payload)=>kind==='reflection'?{title:'庄周梦蝶',candidates}:kind==='review'?{issues:[],titleReview:bad?invalid:{title:'庄周梦蝶',reason:'标题对应完整故事。'},reflectionChoice:{index:1,reason:'保留原文支持的认识。'}}:undefined;
 await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 const before=await document(f,id);assert.equal(before.plan.title,'庄周梦蝶');assert.equal(before.visualReview.reports.length,0);assert.equal(f.control.calls.length,0);assert.deepEqual(before.reflectionCandidates,candidates);
 bad=false;await f.demand(id,crypto.randomUUID(),0,true);await until(()=>f.control.calls.length===1);
 const after=await document(f,id);assert.deepEqual(after.plan.pages,before.plan.pages);assert.equal(after.visualReview.reports.length,1);assert.equal(f.control.reflections.length,1);
});

test('source editorial context never treats its display label as a theme to satisfy',()=>{
 for(const theme of ['原典故事','忠于原文','其他',''])assert.deepEqual(storyEditorialContext(theme),{mode:'source'});
 assert.deepEqual(storyEditorialContext(' 人情冷暖 '),{mode:'theme',theme:'人情冷暖'});
});
