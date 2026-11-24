// 适配器与配置契约使用受控输入；真实启动和制作流程由独立文件覆盖。
import {PaidDispatchDenied,withPaidDispatch} from '../server/paid-dispatch.ts';
import test from 'node:test';

import assert from 'node:assert/strict';

import {createReaderProvider} from '../server/generation.ts';

import {dagGenerator} from '../lib/production-dag/calls.ts';
import {makePlan,selection as legacy} from './fixtures/production.mjs';

import {geminiEvidenceAnswer} from './fixtures/gemini-evidence.mjs';

const selection={...legacy,length:'auto'},plan=makePlan(3);
const original={title:'原文',text:'庄周梦为蝴蝶，醒来又是庄周。',url:'',kind:'passage',provider:'fixture',retrievedAt:'2026-11-05'};
const outline={title:'庄周梦蝶',summary:'梗概',sourceReference:'庄子',adaptationNote:'按原文',beats:['庄周梦为蝴蝶','醒来又是庄周','核对梦与醒的处境']};
const source={original,book:'庄子',chosenStory:'庄周梦蝶',variationSeed:'story-1'},settings={narrativeDetail:'balanced',length:'auto'};
// 制作 DAG 的调用经 textCall 发出；这里直接用 DAG 的真实调用检查提供方的请求与校验契约。
const dag=gen=>dagGenerator(gen.textCall);
const outlineCall=gen=>dag(gen).outline({source,productionPrompt:'',settings});
const reviewCall=gen=>dag(gen).review({source,brief:'梗概',outline,title:outline.title,productionPrompt:'',acceptancePrompt:'',style:{artStyle:'ink-pencil',artStylePrompt:null},characters:[],frames:[{id:'f1',caption:'庄周梦为蝴蝶。',prompt:'庄周伏在案上，梦中化为蝴蝶，中景，晨光。'}],chosenEnding:'梦与醒之间，自在难辨。',allowed:{pages:[1],criteria:[],narrative:false},itemIds:{}});

const completed=value=>Response.json({status:'completed',model:'deepseek-flash',id:'controlled',usage:{input_tokens:12,output_tokens:34},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});

test('DeepSeek cannot use OpenAI/Gemini keys or invoke image generation',async()=>{
 let calls=0;const transport=async()=>{calls++;return completed(outline);};
 const missing=createReaderProvider({SHIQU_AI_PROVIDER:'deepseek',OPENAI_API_KEY:'wrong-openai',GEMINI_API_KEY:'wrong-gemini'},{},transport);
 assert.equal((await missing.status()).configured,false);
 await assert.rejects(outlineCall(missing.generator()),/KEY_REQUIRED/);
 const ready=createReaderProvider({SHIQU_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'deepseek-only'},{},transport);
 assert.equal((await ready.status()).models.image,'');
 await assert.rejects(ready.generator().image(plan,0,'fixture',''),/DeepSeek.*仅支持文字/);assert.equal(calls,0);
});

test('DeepSeek sends strict JSON to its fixed endpoint with effective effort, thinking headroom and a fifteen-minute deadline',async()=>{
 const seen=[],timeouts=[],realTimeout=AbortSignal.timeout;
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'deepseek-only',OPENAI_API_KEY:'wrong-openai',OPENAI_TEXT_MODEL:'wrong-model',DEEPSEEK_BASE_URL:'https://untrusted.example'},{},async(url,options)=>{
  assert.equal(String(url),'https://api.deepseek.com/responses');assert.equal(options.headers.Authorization,'Bearer deepseek-only');assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body);seen.push(body);assert.equal(body.model,'deepseek-flash');assert.equal(body.text.format.strict,true);assert.equal(body.text.format.schema.additionalProperties,false);
  const payload=JSON.parse(body.input[0].content);
  if(body.text.format.schema.properties.issues){
   assert.ok(body.text.format.schema.properties.coverage.items.properties.quoteId);assert.equal(body.text.format.schema.properties.coverage.items.properties.quote,undefined);
   return completed(geminiEvidenceAnswer({titleReview:{title:plan.title,reason:'原文支持'},issues:[],coverage:[{quote:original.text,task:'核对梦醒结果',pages:[1],assessment:'adequate',reason:'保留原文结果',issuePage:0}]},payload,body.text.format.schema));
  }
  return completed(body.text.format.schema.properties.matches?{matches:payload.stories.map(story=>({id:story.id,verdict:'yes',reason:'原文支持本次选题。'}))}:outline);
 });
 const status=await provider.status();assert.equal(status.provider,'deepseek');assert.equal(status.taskReasoningEfforts.frames,'high');assert.equal(status.taskReasoningEfforts.art,'low');
 assert.equal(status.themeMatching.model,'deepseek-flash');assert.equal(provider.generationTimeoutMs('review'),900000);
 AbortSignal.timeout=ms=>{timeouts.push(ms);return realTimeout(ms);};
 try{const result=await outlineCall(provider.generator());assert.equal(result.reasoningEffort,'high');assert.deepEqual(result.value,outline);}
 finally{AbortSignal.timeout=realTimeout;}
 assert.deepEqual(timeouts,[900000]);assert.equal(seen[0].max_output_tokens,32768);assert.equal(seen[0].reasoning.effort,'high');
 const matches=await provider.matchStories('原典故事',[{id:'a'.repeat(64),title:'梦蝶',text:original.text}]);
 assert.equal(matches.matches[0].verdict,'yes');assert.equal(seen[1].model,'deepseek-flash');assert.equal(seen[1].reasoning.effort,'low');
 await reviewCall(provider.generator());assert.equal(seen[2].max_output_tokens,65536);assert.equal(seen[2].reasoning.effort,'high');
});

test('DeepSeek keeps incomplete outputs, oversized scenes and bad evidence behind the shared validators',async()=>{
 let value=outline,incomplete=false;
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'controlled'},{},async()=>incomplete?Response.json({status:'incomplete',usage:{output_tokens:32768},output:[]}):completed(value));
 const gen=provider.generator();value={...outline,beats:Array(81).fill(outline.beats[0])};
 await assert.rejects(outlineCall(gen),error=>error.name==='ZodError');
 incomplete=true;await assert.rejects(outlineCall(gen),/INCOMPLETE_RESPONSE/);
 incomplete=false;value={titleReview:{title:plan.title,reason:'测试'},issues:[],coverage:[{quote:'不存在的原文证据',task:'核对原文',pages:[1],assessment:'adequate',reason:'测试',issuePage:0}]};
 await assert.rejects(reviewCall(gen),error=>error.name==='ZodError'&&error.issues.some(issue=>issue.path.includes('quote')));
 delete value.coverage[0].quote;value.coverage[0].quoteId=0;
 await assert.rejects(reviewCall(gen),error=>error.name==='ZodError'&&error.issues.some(issue=>issue.path.includes('quoteId')));
});

test('DeepSeek reports safe failures without leaking keys, provider bodies or falling back',async()=>{
 const captured=[],saved=console.error;console.error=(...args)=>captured.push(args.join(' '));
 try{for(const status of[400,401,403,429,500]){
  let calls=0;const provider=createReaderProvider({SHIQU_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'private-deepseek-key'},{},async()=>{calls++;return Response.json({error:{message:'private provider text private-deepseek-key'}},{status});});
  await assert.rejects(outlineCall(provider.generator()),error=>{assert.match(provider.safeError(error),/DeepSeek/);return error.status===status;});assert.equal(calls,1);
 }}finally{console.error=saved;}
 assert.doesNotMatch(captured.join('\n'),/private provider|private-deepseek-key/);
});

test('DeepSeek rechecks each paid request and preserves the first receipt',async()=>{
 let calls=0;
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'controlled'},{},async()=>{calls++;return completed(outline);});
 const receipts=[],deny=new PaidDispatchDenied('obsolete');
 await assert.rejects(withPaidDispatch({authorize:()=>{if(calls)throw deny;},receipt:value=>receipts.push(value)},async()=>{
  await outlineCall(provider.generator());
  await outlineCall(provider.generator());
 }),error=>error===deny);
 assert.equal(calls,1);
 assert.deepEqual(receipts,[{requestId:'controlled',usage:{input_tokens:12,output_tokens:34}}]);
});
