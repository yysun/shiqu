// Exercise Argon's combined thinking/output budget through the production adapter and validators.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderProvider} from '../server/generation.ts';
import {makePlan,selection as legacy} from './fixtures/production.mjs';

const selection={...legacy,length:'auto'};
const original={title:'原文',text:'庄周梦为蝴蝶，醒来又是庄周。',url:'',kind:'passage',provider:'fixture',retrievedAt:'2026-11-05'};
const plan=makePlan(3),{pages,reflection:_,...metadata}=plan;
const outline={...metadata,beats:pages.map(()=> '庄周醒来，核对梦与醒的处境。')};
const schema={type:'object',properties:{title:{type:'string'}},additionalProperties:false};
const text=(gen,task,max)=>gen.textCall(task,'指令',{},schema,max,original);
function provider(model,transport,effort='high'){
 return createReaderProvider({SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'controlled',GEMINI_TEXT_MODEL:model,SHIQU_REASONING_OUTLINE:effort},{},transport).generator();
}

test('Argon high thinking has answer room while Flash, lower effort and larger task budgets stay unchanged',async()=>{
 const seen=[],failure=new Error('controlled request probe');
 const transport=async(_url,options)=>{seen.push(JSON.parse(options.body).generationConfig);throw failure;};
 const argon=provider('gemini-4-argon',transport),flash=provider('gemini-3.8-flash',transport);
 for(const call of [
  ()=>text(argon,'outline',8192),
  ()=>text(flash,'outline',8192),
  ()=>text(provider('gemini-4-argon',transport,'medium'),'outline',8192),
  ()=>text(argon,'plan',64000),
  ()=>text(argon,'review',24000),
 ])await assert.rejects(call,error=>error===failure);
 assert.deepEqual(seen.map(config=>config.maxOutputTokens),[32768,8192,8192,64000,32768]);
 assert.deepEqual(seen[0].responseFormat,seen[1].responseFormat,'Only the token allocation changes');
 assert.equal(seen[0].thinkingConfig.thinkingLevel,'HIGH');assert.equal(seen[2].thinkingConfig.thinkingLevel,'MEDIUM');
});

test('Argon still rejects incomplete answers after increasing its token budget',async()=>{
 let response={finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(outline)}]}};
 const gen=provider('gemini-4-argon',async()=>Response.json({candidates:[response]}));
 const call=()=>gen.textCall('outline','指令',{},{type:'object',properties:{title:{type:'string'}},additionalProperties:false},8192,original);
 await assert.rejects(call(),error=>error.message==='INCOMPLETE_RESPONSE');
 response={finishReason:'STOP',content:{parts:[{text:JSON.stringify(outline)}]}};
 assert.equal((await call()).value.title,outline.title);
});
