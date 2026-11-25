// Verify binary matching receipts and source-only production and synopsis-assisted review across all provider request boundaries.
import test from 'node:test';
import {storyOpeningDirection,storyReviewDirection,storyboardDirection,narrativeMeaningDirection} from '../lib/reader-prompts.ts';
import assert from 'node:assert/strict';
import {createReaderProvider} from '../server/generation.ts';
import {themeMatchesSchema,themeMatchPayload} from '../lib/reader-theme-match.ts';
import {libraryFixture} from './fixtures/story-library.mjs';
import {themeStoryId} from '../server/story-theme-matching.ts';
import {dagGenerator} from '../lib/production-dag/calls.ts';
import {makePlan,makeReflectionCandidates} from './fixtures/production.mjs';
import {geminiEvidenceAnswer} from './fixtures/gemini-evidence.mjs';

const plain=text=>text.replace(/^\s*- /gm,'').replace(/\s/g,'');
const summary='勇士为保护村民迎战猛虎，最终击退猛虎，平安返回村庄。【核对摘要专用标记】';
const matchReason='人物面对危险保护村民，其实际行动体现勇气。【匹配理由专用标记】';
const brief={summary,matchReason};
const original={title:'勇士护民',text:'勇士面对山中的猛虎仍向前行。他保护了村民，最终击退猛虎，平安返回村庄。',url:'https://example.org/original',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01',localSource:{edition:'a'.repeat(64),sectionId:'s1',firstUnit:'u1',lastUnit:'u1'}};

test('binary matching requires a reason and rejects review or summary fields',()=>{
 const valid={id:'a'.repeat(64),verdict:'yes',reason:matchReason};assert.ok(themeMatchesSchema.safeParse({matches:[valid]}).success);
 for(const changed of [{...valid,reason:''},{...valid,summary},{id:valid.id,verdict:'yes'},{...valid,verdict:'review'}])assert.equal(themeMatchesSchema.safeParse({matches:[changed]}).success,false);
 assert.ok(themeMatchesSchema.safeParse({matches:[{...valid,verdict:'no'}]}).success);
 assert.throws(()=>themeMatchPayload('主题',Array.from({length:5},()=>({id:valid.id,title:'故事',text:original.text}))),/at most 4/);
});

test('binary matching survives cache reuse and an old receipt is rejudged without rescanning',async()=>{
 const f=libraryFixture(),first=await f.run('勇气');assert.ok(first.stories[0].matchReason);assert.equal(first.stories[0].storyBrief,undefined);
 const before=f.calls.matches.length;assert.deepEqual((await f.run('勇气')).stories,first.stories);assert.equal(f.calls.matches.length,before);
 const docs=[...f.store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes))),key=docs.find(doc=>doc.value.decisions?.[themeStoryId(f.stories[1])]?.verdict==='yes').key;
 await f.cache.write(key,{decisions:{[themeStoryId(f.stories[1])]:'yes'}});const scans=f.calls.catalog.length;
 const result=await f.run('勇气');assert.ok(result.stories[0].matchReason);assert.equal(f.calls.catalog.length,scans);assert.ok(f.calls.matches.length>before);
});

for(const provider of ['codex','gemini','openai'])test(`${provider}: brief verification, bounded output, theme/source guidance and original facts remain separate`,async()=>{
 const calls=[],plan=makePlan(2);
 const respond=(instructions,payload,schema,limit)=>{
  calls.push({instructions,payload,schema,limit});
  if(schema.properties.matches)return {matches:payload.stories.map(story=>({id:story.id,verdict:'yes',reason:matchReason}))};
  if(schema.properties.count)return {count:2,reason:'完整讲述起因、行动和结果。',...(schema.properties.storySummary?{storySummary:summary,storyMatchReason:matchReason}:{})};
  if(schema.properties.issues)return {issues:[],titleReview:{title:plan.title,reason:'标题对应实际故事。'},coverage:[{quote:'勇士面对山中的猛虎仍向前行。',task:'勇士保护村民',pages:[1],assessment:'adequate',reason:'原文的行动得到保留。',issuePage:0}]};
  if(schema.properties.beats)return {title:plan.title,summary:'归档提纲摘要专用标记',sourceReference:'勇士护民',adaptationNote:'按原文',beats:['勇士迎战猛虎','勇士击退猛虎并返回']};
  if(schema.properties.candidates)return {title:plan.title,candidates:makeReflectionCandidates(plan.reflection)};
  if(schema.properties.reflection)return {reflection:plan.reflection};
  if(schema.properties.characters)return {characters:[{name:'勇士',aliases:[],text:'面对猛虎仍向前行的勇士。'}]};
  if(schema.properties.summary)return {summary};
  if(schema.properties.pages)return {pages:Array.from({length:payload.batch.last-payload.batch.first+1},(_,i)=>({caption:plan.pages[i].caption}))};
  if(schema.properties.frames)return {frames:payload.frames.map(f=>({number:f.number,caption:plan.pages[0].caption}))};
  throw Error('unexpected call');
 };
 const runner={status:async()=>({configured:true}),run:async job=>({text:JSON.stringify(respond(job.instructions,JSON.parse(job.prompt),job.schema)),model:'mock',requestId:'mock',usage:null})};
 const transport=async(_url,init)=>{
  const body=JSON.parse(init.body),openai=provider==='openai',payload=JSON.parse(openai?body.input[0].content:body.contents[0].parts[0].text),schema=openai?body.text.format.schema:body.generationConfig.responseFormat.text.schema;
  let value=respond(openai?body.instructions:body.systemInstruction.parts[0].text,payload,schema,openai?body.max_output_tokens:body.generationConfig.maxOutputTokens);
  if(provider==='gemini')value=geminiEvidenceAnswer(value,payload,schema);
  return Response.json(openai?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
 };
 const p=createReaderProvider({SHIQU_AI_PROVIDER:provider,GEMINI_API_KEY:'controlled',OPENAI_API_KEY:'controlled'}, {},transport,runner),g=p.generator(),dag=dagGenerator(g.textCall);
 const entries=Array.from({length:4},(_,i)=>({id:String(i).repeat(64),title:'完整故事',text:original.text}));
 await p.matchStories('勇气',entries);assert.equal(calls.at(-1).schema.properties.matches.maxItems,provider==='gemini'?undefined:4);
 if(provider==='gemini')assert.match(calls.at(-1).schema.properties.matches.description,/At most 4 items/);
 if(provider!=='codex')assert.equal(calls.at(-1).limit,2048);
 const paid=calls.length;await assert.rejects(p.matchStories('勇气',[...entries,entries[0]]));assert.equal(calls.length,paid);
 for(const theme of ['勇气与成长','原典故事','忠于原文']){
  const selection={bookId:'zhuangzi',storyTitle:'勇士护民',theme,length:2,artStyle:'ink-pencil',productionPrompt:'保留明确行动。',narrativeDetail:'balanced',voice:false},context=theme==='勇气与成长'?{mode:'theme',theme}:{mode:'source'};
  const pending={...original,storyBrief:{summary:'勇士准备迎战猛虎。',matchReason:'勇士因复仇杀死了老虎。',verified:false}};
  const checked=(await g.recommend(selection,'id',pending)).value,advice=calls.at(-1);
  assert.match(advice.instructions,/2–3句/);assert.match(advice.instructions,/80–150字/);assert.ok(advice.schema.required.includes('storySummary'));assert.ok(advice.schema.required.includes('storyMatchReason'));assert.equal(advice.payload.storyBrief.summary,pending.storyBrief.summary);assert.equal(advice.payload.verifiedOriginal.text,original.text);assert.equal(advice.payload.verifiedOriginal.storyBrief,undefined);
  const ready={...original,storyBrief:{summary:checked.storySummary,matchReason:checked.storyMatchReason,verified:true}};
  // 制作 DAG 的各调用：核对摘要只进审片，其余只读已核原文。
  const source={original:ready,book:'庄子',chosenStory:'勇士护民',theme,variationSeed:'story-1'},settings={narrativeDetail:'balanced',length:2};
  const start=calls.length,captions=plan.pages.map(page=>page.caption),outline=(await dag.outline({source,productionPrompt:selection.productionPrompt,settings})).value;
  await dag.prepareBrief({source});await dag.characters({source,productionPrompt:selection.productionPrompt});
  await dag.sceneBatch({source,outline,productionPrompt:selection.productionPrompt,first:1,previous:[]});
  await dag.sceneRepair({source,outline,productionPrompt:selection.productionPrompt,frames:[{index:0,caption:captions[0],neighbors:{},issues:[{page:1,category:'caption',problem:'指代不清。',instruction:'保留事实，说清对象。',requiresReplan:false}]}]});
  await dag.ending({source,outline,captions});await dag.endingRepair({source,outline,captions,reflection:plan.reflection,issues:[]});
  await dag.review({source,brief:summary,outline,title:plan.title,productionPrompt:selection.productionPrompt,acceptancePrompt:'',style:{artStyle:'ink-pencil',artStylePrompt:null},characters:[{id:'c1',name:'勇士',aliases:[],text:'面对猛虎仍向前行的勇士。'}],frames:captions.map((caption,i)=>({id:'f'+i,caption,prompt:'勇士在山路上迎面遇到猛虎，中景，日光。'})),chosenEnding:plan.reflection,allowed:{pages:[1],criteria:[],narrative:false},itemIds:{}});
  for(const call of calls.slice(start)){
   const reviewing=!!call.schema.properties.issues;
   assert.deepEqual(call.payload.editorialContext,context);assert.equal(call.payload.verifiedOriginal.text,original.text);assert.equal(call.payload.verifiedOriginal.storyBrief,undefined);
   if(reviewing){
    assert.equal(call.payload.plan.summary,summary);
    assert.ok(plain(call.instructions).includes(plain(storyReviewDirection)));
   }else{
    assert.equal(call.payload.storyBrief,undefined);
    for(const marker of ['核对摘要专用标记','匹配理由专用标记'])assert.ok(!JSON.stringify(call.payload).includes(marker),marker);
    for(const key of ['outline','draft','plan'])if(call.payload[key])assert.equal(call.payload[key].summary,undefined,key);
    assert.doesNotMatch(call.instructions,/先参照摘要|摘要负责叙事主线/);
   }
   if(call.schema.properties.summary&&!call.schema.properties.beats)assert.match(call.instructions,/2–3句/);
  }
  const outlineCall=calls.slice(start).find(call=>call.schema.properties.beats),batchCall=calls.slice(start).find(call=>call.payload.batch);
  for(const call of [outlineCall,batchCall]){
   assert.ok(plain(call.instructions).includes(plain(storyOpeningDirection)));
   assert.ok(plain(call.instructions).includes(plain(narrativeMeaningDirection)));
  }
  // 提纲只分配节点；静态画面的细则属于逐幅执行与审片。
  assert.equal(plain(outlineCall.instructions).includes(plain(storyboardDirection)),false);
  await g.recommend(selection,'legacy',original);assert.deepEqual(calls.at(-1).schema.required,['count','reason']);if(provider!=='codex')assert.equal(calls.at(-1).limit,provider==='gemini'?2000:2048);
 }
});
