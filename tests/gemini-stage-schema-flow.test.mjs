// 使用隔离夹具验证真实生产流程，保持适配器契约可独立快速运行。
import test from 'node:test';

import assert from 'node:assert/strict';

import {createReaderProvider} from '../server/generation.ts';

import {productionFixture} from './fixtures/production.mjs';

import {executeHeadless} from '../server/headless-cli.ts';

import {withLocalBooks} from '../server/local-generation.ts';

import {libraryFixture} from './fixtures/story-library.mjs';

test('Gemini production completes discovery after the 1-to-32 transition, preparation, reviews and images', {timeout:30000},async t=>{
 const f=await productionFixture(t,'gemini');await f.stop();
 const library=libraryFixture(),counts=[];f.control.autoLength=3;f.control.hold=false;
 const discovery=createReaderProvider({SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'controlled'},f.media,async(_url,options)=>{
  const body=JSON.parse(options.body),schema=body.generationConfig.responseFormat.text.schema,payload=JSON.parse(body.contents[0].parts[0].text);
  // 重现第二轮提取曾触发的 API 语法复杂度拒绝。
  if(schema.properties.stories?.maxItems===32)return Response.json({error:{status:'INVALID_ARGUMENT',message:'The input schema has too many states for serving.'}},{status:400});
  let value;
  if(payload.localBook){
   const scan=payload.localBook.scan;counts.push(scan.maxStories);
   const remaining=library.stories.filter(story=>!scan.excludedSources.some(source=>source.firstUnit===story.source.firstUnit));
   value={stories:remaining.slice(0,scan.maxStories).map(({summary,source,...story})=>{void summary;const {edition,...range}=source;void edition;return {...story,source:{...range,continuations:[]}};}),note:'',scan:{blockComplete:remaining.length<scan.maxStories,pendingEvents:[],resolvedEventIds:[]}};
  }else value={matches:payload.stories.map(story=>({id:story.id,verdict:story.title==='勇士护民'?'yes':'no',reason:story.title==='勇士护民'?'勇士主动保护村民。':'本篇主题是报恩。'}))};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
 });
 f.control.beforeText=async kind=>kind==='recommend'?{storySummary:library.stories[1].summary,storyMatchReason:'勇士面对猛虎保护村民，最终平安。'}:undefined;
 const generation=withLocalBooks({...f.generation,suggestions:discovery.suggestions,matchStories:discovery.matchStories},library.books,f.media);
 const call=(args,input={})=>executeHeadless(process.cwd(),[...args,'--data-dir',f.dataDirectory],{generation,localBooks:library.books,variables:{},input});
 const {session}=await call(['stories','create'],{bookId:'zhuangzi',theme:'勇气',narrativeDetail:'balanced'}),id=session.id;
 await call(['stories','search',id],{generation:session.intake.generation});
 const candidates=await call(['run',id,'--until','candidates','--timeout','10']);
 assert.equal(candidates.reason,'candidates');assert.equal(candidates.session.intake.batches[0].stories[0].title,'勇士护民');assert.deepEqual(counts,[1,32]);
 await call(['stories','choose',id],{generation:candidates.session.intake.generation,batch:0,index:0});
 const prepared=await call(['run',id,'--until','prepared','--timeout','10']);assert.equal(prepared.reason,'prepared');
 await call(['stories','confirm',id],{generation:prepared.session.intake.generation});
 const reviewed=await call(['run',id,'--until','reviewed','--timeout','10']);assert.equal(reviewed.reason,'reviewed');assert.equal(f.control.calls.length,0);
 const completed=await call(['run',id,'--until','completed','--timeout','10']);assert.equal(completed.reason,'completed');
 assert.equal(completed.session.story.pages.length,3);assert.ok(completed.session.story.pages.every(page=>page.image));
 for(const name of ['outline','sceneBatch','visual'])assert.ok(f.control.dagCalls.includes(name),name);
 assert.ok(f.control.frameReviews.length);assert.ok(f.control.reviews.length);assert.equal(f.control.calls.length,3);
});
