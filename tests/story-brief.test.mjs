// Verify rich matching receipts and source-bound production guidance across all provider request boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderProvider} from '../server/generation.ts';
import {themeMatchesSchema,themeMatchPayload} from '../lib/reader-theme-match.ts';
import {libraryFixture} from './fixtures/story-library.mjs';
import {themeStoryId} from '../server/story-theme-matching.ts';
import {makePlan,makeReflectionCandidates} from './fixtures/production.mjs';

const summary='勇士为保护村民迎战猛虎，最终击退猛虎，平安返回村庄。';
const matchReason='人物面对危险保护村民，其实际行动体现勇气。';
const brief={summary,matchReason};
const original={title:'勇士护民',text:'勇士面对山中的猛虎仍向前行。他保护了村民，最终击退猛虎，平安返回村庄。',url:'https://example.org/original',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01',localSource:{edition:'a'.repeat(64),sectionId:'s1',firstUnit:'u1',lastUnit:'u1'}};

test('yes requires both a reason and complete synopsis, and nonmatches cannot supply production facts',()=>{
 const valid={id:'a'.repeat(64),verdict:'yes',reason:matchReason,summary};
 assert.ok(themeMatchesSchema.safeParse({matches:[valid]}).success);
 for(const changed of [{...valid,reason:''},{...valid,summary:' '},{id:valid.id,verdict:'yes'},{...valid,verdict:'no'},{...valid,verdict:'review'}])assert.equal(themeMatchesSchema.safeParse({matches:[changed]}).success,false);
 assert.ok(themeMatchesSchema.safeParse({matches:[{...valid,verdict:'no',summary:''}]}).success);
 assert.throws(()=>themeMatchPayload('主题',Array.from({length:5},()=>({id:valid.id,title:'故事',summary}))),/at most 4/);
});

test('rich matching information survives cache reuse and an old boolean receipt is rejudged without rescanning',async()=>{
 const f=libraryFixture(),first=await f.run('勇气');assert.ok(first.stories[0].storyBrief.matchReason);assert.equal(first.stories[0].storyBrief.summary,f.stories[1].summary);
 const before=f.calls.matches.length;assert.deepEqual((await f.run('勇气')).stories,first.stories);assert.equal(f.calls.matches.length,before);
 const docs=[...f.store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes))),key=docs.find(doc=>doc.key.includes('/themes/')).key;
 await f.cache.write(key,{decisions:{[themeStoryId(f.stories[1])]:'yes'}});const scans=f.calls.catalog.length;
 const result=await f.run('勇气');assert.ok(result.stories[0].storyBrief.summary);assert.equal(f.calls.catalog.length,scans);assert.ok(f.calls.matches.length>before);
});

for(const provider of ['codex','gemini','openai'])test(`${provider}: brief verification, bounded output, theme/source guidance and original facts remain separate`,async()=>{
 const calls=[],plan=makePlan(2);
 const respond=(instructions,payload,schema,limit)=>{
  calls.push({instructions,payload,schema,limit});
  if(schema.properties.matches)return {matches:payload.stories.map(story=>({id:story.id,verdict:'yes',reason:matchReason,summary:story.summary}))};
  if(schema.properties.count)return {count:2,reason:'完整讲述起因、行动和结果。',...(schema.properties.storySummary?{storySummary:summary,storyMatchReason:matchReason}:{})};
  if(schema.properties.issues)return {issues:[],titleReview:{title:plan.title,reason:'标题对应实际故事。'}};
  if(payload.requestedPages)return {pages:payload.requestedPages.map(page=>({page,...plan.pages[page-1]}))};
  if(schema.properties.candidates)return {title:plan.title,candidates:makeReflectionCandidates(plan.reflection)};
  if(schema.properties.reflection&&!schema.properties.pages)return {reflection:plan.reflection};
  if(schema.properties.beats){const {pages,reflection,...metadata}=makePlan(21);void reflection;return {...metadata,beats:pages.map((_,i)=>'第'+i+'幅的行动和回应。')};}
  if(payload.batch)return {pages:makePlan(21).pages.slice(payload.batch.first-1,payload.batch.last)};
  return plan;
 };
 const runner={status:async()=>({configured:true}),run:async job=>({text:JSON.stringify(respond(job.instructions,JSON.parse(job.prompt),job.schema)),model:'mock',requestId:'mock',usage:null})};
 const transport=async(_url,init)=>{
  const body=JSON.parse(init.body),openai=provider==='openai';
  const value=respond(openai?body.instructions:body.systemInstruction.parts[0].text,JSON.parse(openai?body.input[0].content:body.contents[0].parts[0].text),openai?body.text.format.schema:body.generationConfig.responseFormat.text.schema,openai?body.max_output_tokens:body.generationConfig.maxOutputTokens);
  return Response.json(openai?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
 };
 const p=createReaderProvider({SHIQU_AI_PROVIDER:provider,GEMINI_API_KEY:'controlled',OPENAI_API_KEY:'controlled'}, {},transport,runner),g=p.generator();
 const entries=Array.from({length:4},(_,i)=>({id:String(i).repeat(64),title:'完整故事',summary}));
 await p.matchStories('勇气',entries);assert.equal(calls.at(-1).schema.properties.matches.maxItems,4);if(provider!=='codex')assert.equal(calls.at(-1).limit,16000);
 const paid=calls.length;await assert.rejects(p.matchStories('勇气',[...entries,entries[0]]));assert.equal(calls.length,paid);
 for(const theme of ['勇气与成长','原典故事','忠于原文']){
  const selection={bookId:'zhuangzi',storyTitle:'勇士护民',theme,length:2,artStyle:'ink-pencil',productionPrompt:'保留明确行动。',narrativeDetail:'balanced',voice:false},context=theme==='勇气与成长'?{mode:'theme',theme}:{mode:'source'};
  const pending={...original,storyBrief:{summary:'勇士准备迎战猛虎。',matchReason:'勇士因复仇杀死了老虎。',verified:false}};
  const checked=(await g.recommend(selection,'id',pending)).value,advice=calls.at(-1);
  assert.ok(advice.schema.required.includes('storySummary'));assert.ok(advice.schema.required.includes('storyMatchReason'));assert.equal(advice.payload.storyBrief.summary,pending.storyBrief.summary);assert.equal(advice.payload.verifiedOriginal.text,original.text);assert.equal(advice.payload.verifiedOriginal.storyBrief,undefined);if(provider!=='codex')assert.equal(advice.limit,4096);
  const ready={...original,storyBrief:{summary:checked.storySummary,matchReason:checked.storyMatchReason,verified:true}};
  const before=calls.length;await assert.rejects(g.plan(selection,'id',pending),/STORY_BRIEF_UNVERIFIED/);assert.equal(calls.length,before);
  const start=calls.length;const draft=(await g.plan(selection,'id',ready)).value;
  const long={...selection,length:21},outline=(await g.outline(long,'id',ready)).value;await g.planBatch(long,'id',{outline,pages:[]},ready);
  await g.review(selection,plan,ready);await g.repair(selection,plan,ready,[{page:1,category:'caption',problem:'指代不清。',instruction:'保留事实，说清对象。'}]);await g.reflectionCandidates(selection,draft,ready);
  for(const call of calls.slice(start)){
   assert.deepEqual(call.payload.editorialContext,context);assert.deepEqual(call.payload.storyBrief,brief);assert.equal(call.payload.verifiedOriginal.text,original.text);assert.equal(call.payload.verifiedOriginal.storyBrief,undefined);
   assert.doesNotMatch(call.instructions,/editorialContext 仅用于标题|选定后主题不进入分镜/);
   if(!call.schema.properties.candidates){assert.match(call.instructions,/第一页开场/);assert.match(call.instructions,/静态/);assert.match(call.instructions,/连续性/);assert.match(call.instructions,/结合摘要从原文中提取理解开局所需的必要背景、人物关系和眼前处境/);assert.match(call.instructions,/不照搬全篇摘要/);assert.match(call.instructions,/不先剧透结局/);}
  }
  await g.recommend(selection,'legacy',original);assert.deepEqual(calls.at(-1).schema.required,['count','reason']);if(provider!=='codex')assert.equal(calls.at(-1).limit,provider==='gemini'?2000:2048);
 }
});
