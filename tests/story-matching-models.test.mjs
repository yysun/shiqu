// Verify dedicated matching models and actual identity without touching credentials or live inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderProvider} from '../server/generation.ts';
const stories=[{id:'a'.repeat(64),title:'救龟报恩',text:'渔夫救龟，后来龟在洪水中救回渔夫。'}];
for(const provider of ['codex','openai','gemini'])test(`${provider}: matching uses its dedicated model and low effort while extraction retains its configuration`,async()=>{
 const calls=[];
 const runner={status:async()=>({configured:true,model:'main-text-model'}),run:async job=>{calls.push({model:job.model||'main-text-model',effort:job.reasoningEffort});return {text:JSON.stringify(job.schema.properties.matches?{matches:[{id:1,verdict:'yes',reason:'救命之恩得到回报。',matchScore:92}]}:{stories:[],note:''}),model:job.model||'main-text-model'};}};
 const transport=async(url,init)=>{
  const body=JSON.parse(init.body),api=provider==='openai',schema=api?body.text.format.schema:body.generationConfig.responseFormat.text.schema;
  calls.push({model:api?body.model:decodeURIComponent(String(url).split('/models/')[1].split(':')[0]),effort:api?body.reasoning.effort:body.generationConfig.thinkingConfig.thinkingLevel.toLowerCase()});
  const value=schema.properties.matches?{matches:[{id:1,verdict:'yes',reason:'救命之恩得到回报。',matchScore:92}]}:{stories:[],note:''};
  return Response.json(api?{status:'completed',model:body.model,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
 };
 const p=createReaderProvider({SHIQU_AI_PROVIDER:provider,CODEX_MODEL:'main-text-model',OPENAI_TEXT_MODEL:'main-text-model',GEMINI_TEXT_MODEL:'main-text-model',OPENAI_API_KEY:'controlled',GEMINI_API_KEY:'controlled',SHIQU_REASONING_SUGGEST:'high'}, {},transport,runner);
 const result=await p.matchStories('知恩图报',stories);assert.equal(result.matches[0].verdict,'yes');assert.equal(result.matches[0].matchScore,92);
 await p.suggestions({bookId:'zhuangzi',theme:'知恩图报',length:2,artStyle:'ink-pencil',voice:false},[]);
 assert.deepEqual(calls,[{model:provider==='gemini'?'main-text-model':'gpt-6-luna',effort:'low'},{model:'main-text-model',effort:'high'}]);
 assert.deepEqual((await p.status()).themeMatching,{model:calls[0].model,reasoningEffort:'low'});
});

test('OpenAI rejects a mismatched actual matching model and accepts an omitted model as the explicit request identity',async()=>{
 let wrong=true,calls=0;
 const p=createReaderProvider({SHIQU_AI_PROVIDER:'openai',OPENAI_API_KEY:'controlled'}, {},async()=>{calls++;return Response.json({status:'completed',...(wrong?{model:'other-model'}:{}),output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({matches:[{id:1,verdict:'yes',reason:'原文有报恩行动。'}]})}]}]});});
 await assert.rejects(p.matchStories('知恩图报',stories),/MODEL_UNAVAILABLE/);assert.equal(calls,1);wrong=false;assert.equal((await p.matchStories('知恩图报',stories)).matches[0].verdict,'yes');assert.equal(calls,2);
});

for(const provider of ['codex','openai','gemini'])test(`${provider}: catalog output limits follow the extraction request, independently of display`,async()=>{
 const caps=[],response={stories:[],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}};
 const runner={status:async()=>({configured:true}),run:async job=>{caps.push(job.schema.properties.stories.maxItems);return {text:JSON.stringify(response),model:'controlled'};}};
 const transport=async(_url,init)=>{const body=JSON.parse(init.body),api=provider==='openai',list=(api?body.text.format.schema:body.generationConfig.responseFormat.text.schema).properties.stories;caps.push(api?list.maxItems:list.description);return Response.json(api?{status:'completed',model:body.model,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(response)}]}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(response)}]}}]});};
 const p=createReaderProvider({SHIQU_AI_PROVIDER:provider,OPENAI_API_KEY:'controlled',GEMINI_API_KEY:'controlled'}, {},transport,runner);
 for(const cap of [1,4,32])await p.suggestions({bookId:'zhuangzi',theme:'主题',length:'auto',artStyle:'ink-pencil',voice:false},[],{title:'原典',edition:'a'.repeat(64),text:'原文。',purpose:'catalog',scan:{maxStories:cap,excludedSources:[],pendingEvents:[],contextText:''}});
 assert.deepEqual(caps,provider==='gemini'?['At most 1 items.','At most 4 items.','At most 32 items.']:[1,4,32]);
});
