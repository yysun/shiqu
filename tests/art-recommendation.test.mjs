// Cover recommendation propagation and user choice without any live AI requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {artRecommendationSchema,selectSuggestedStory} from '../lib/reader-art-recommendation.ts';
import {artStyleIds} from '../lib/reader-styles.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {suggestionBatchSchema,freshSuggestions} from '../lib/reader-suggestions.ts';
import {localChoices,localChoicesJson,localIndexJson,localReadingPrompt} from '../lib/reader-local-contract.ts';
import {choicesJson,suggestionSystemPrompt} from '../lib/reader-generation-contract.ts';
import {createReaderProvider} from '../server/generation.ts';
import {withLocalBooks} from '../server/local-generation.ts';

const recommendation={artStyle:'woodblock',reason:'粗犷轮廓与鲜明套色适合追日的力量和山河尺度。'};
const selection=selectionSchema.parse({bookId:'山海经',theme:'命运与选择',length:8});
const source={edition:'a'.repeat(64),sectionId:'chapter',firstUnit:'unit',lastUnit:'unit'};
const candidate={title:'夸父逐日',description:'追逐太阳的旅程。',source,artRecommendation:recommendation};

test('recommendations validate real style IDs and bounded nonempty reasons, while old history still loads',()=>{
 assert.deepEqual(artRecommendationSchema.parse(recommendation),recommendation);
 for(const bad of [{...recommendation,artStyle:'invented'},{...recommendation,reason:' '},{...recommendation,reason:'长'.repeat(121)}])assert.throws(()=>artRecommendationSchema.parse(bad));
 const batch=suggestionBatchSchema.parse({stories:[candidate],note:''});
 assert.deepEqual(JSON.parse(JSON.stringify(batch)).stories[0].artRecommendation,recommendation);
 assert.deepEqual(freshSuggestions(batch,[]).stories[0].artRecommendation,recommendation);
 assert.equal(freshSuggestions(batch,['夸父逐日']).stories.length,0);
 assert.equal(suggestionBatchSchema.parse({stories:[{title:'旧候选',description:'旧简介'}],note:''}).stories[0].artRecommendation,undefined);
});

test('new stories adopt their recommendation, reselect preserves manual choice, and another story replaces it',()=>{
 const selected=selectSuggestedStory(selection,candidate);
 assert.equal(selected.artStyle,'woodblock');assert.deepEqual(selected.source,source);
 assert.equal(selected.productionPrompt,selection.productionPrompt);assert.equal(selected.length,8);
 const manual={...selected,artStyle:'cinematic'};
 assert.equal(selectSuggestedStory(manual,{...candidate,source:{lastUnit:'unit',firstUnit:'unit',sectionId:'chapter',edition:source.edition}}).artStyle,'cinematic');
 const second={...candidate,title:'另一篇',artRecommendation:{artStyle:'ink-wash',reason:'留白适合寓言。'}};
 assert.equal(selectSuggestedStory(manual,second).artStyle,'ink-wash');
 assert.equal(selectSuggestedStory(manual,{title:'旧候选',description:'无推荐'}).artStyle,'cinematic');
 assert.equal(selectSuggestedStory(manual,{...candidate,source:{...source,firstUnit:'new'}}).artStyle,'woodblock');
});

test('all new provider response contracts require recommendations and local receipt validation retains them',()=>{
 for(const schema of [choicesJson,localChoicesJson,localIndexJson]){
  const story=schema.properties.stories.items;
  assert.ok(story.required.includes('artRecommendation'));
  assert.deepEqual(story.properties.artRecommendation.properties.artStyle.enum,[...artStyleIds]);
 }
 const localBook={title:'山海经',edition:source.edition,text:'已读原文'};
 const batch=localChoices({stories:[candidate],note:''},localBook);
 assert.deepEqual(batch.stories[0].artRecommendation,recommendation);
 assert.equal(batch.stories[0].source.edition,source.edition);
 assert.match(suggestionSystemPrompt,/artRecommendation/);
 assert.match(localReadingPrompt(localBook),/具体故事内容/);
 assert.match(localReadingPrompt({...localBook,purpose:'story-index'}),/artRecommendation/);
 assert.match(localReadingPrompt({...localBook,purpose:'candidate-summary'}),/原样复制/);
});

test('Gemini and Codex carry recommendations in the existing single suggestion call for all discovery modes',async()=>{
 for(const providerName of ['gemini','codex'])for(const mode of ['remote','local','story-index']){
  let calls=0;
  const result=job=>{
   calls++;
   assert.match(job.instructions,/artRecommendation/);
   assert.ok(job.schema.properties.stories.items.required.includes('artRecommendation'));
   return {stories:[candidate],note:''};
  };
  const runner={status:async()=>({configured:true}),run:async job=>({text:JSON.stringify(result(job)),model:'mock',requestId:'mock',usage:null})};
  const transport=async(_url,init)=>{
   const data=JSON.parse(init.body);
   const batch=result({instructions:data.systemInstruction.parts[0].text,schema:data.generationConfig.responseFormat.text.schema});
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(batch)}]}}]});
  };
  const provider=createReaderProvider({SHIQU_AI_PROVIDER:providerName,GEMINI_API_KEY:'mock-only'}, {},transport,runner);
  const book=mode==='remote'?undefined:{title:'山海经',edition:source.edition,text:'原文全文',...(mode==='story-index'?{purpose:mode}:{})};
  const batch=await provider.suggestions(selection,[],book);
  assert.equal(calls,1);assert.deepEqual(batch.stories[0].artRecommendation,recommendation);
 }
});

test('whole-book selection keeps the original content-based recommendation through filtering and summary',async()=>{
 const sections=Array.from({length:6},(_,i)=>({id:'s'+i,title:'篇章'+i,units:[{id:'u'+i,text:'原'.repeat(20000)}]}));
 const book={id:'山海经',title:'山海经',edition:source.edition,sections,input:{title:'山海经',edition:source.edition,text:'全'.repeat(120001)}};
 let summaryCalls=0;
 const books={book:async()=>book,resolve:(_book,receipt)=>({title:receipt.sectionId,text:'核对原文'})};
 const provider={status:async()=>({configured:true,provider:'codex',models:{text:'mock'}}),safeError:()=>'',generator:()=>({}),suggestions:async(_selection,_excluded,input)=>{
  if(input.purpose==='candidate-summary'){
   summaryCalls++;
   const stories=JSON.parse(input.text);
   assert.equal(stories.length,6);assert.ok(stories.every(story=>story.artRecommendation));
   return {stories:[{...stories[5],artRecommendation:{artStyle:'clay',reason:'汇总不应覆盖原推荐'}}],note:''};
  }
  return {stories:sections.filter(section=>input.text.includes('['+section.units[0].id+']')).map(section=>({
   title:'故事'+section.id,description:'真实故事简介',source:{edition:book.edition,sectionId:section.id,firstUnit:section.units[0].id,lastUnit:section.units[0].id},artRecommendation:recommendation,
  })),note:''};
 }};
 const stored=new Map(),media={get:async key=>{const bytes=stored.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},put:async(key,bytes)=>{stored.set(key,new Uint8Array(bytes));}};
 const batch=await withLocalBooks(provider,books,media).suggestions(selection,[]);
 assert.equal(summaryCalls,1);assert.equal(batch.stories.length,1);
 assert.deepEqual(batch.stories[0].artRecommendation,recommendation);
 assert.equal(batch.stories[0].sourceLabel,'s5');
});
