// Verify the real Gemini transport and public countdown use the same fifteen-minute per-call limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderProvider} from '../server/generation.ts';
import {geminiGenerationTimeoutMs} from '../lib/reader-limits.ts';
import {codexGenerationTimeoutMs} from '../lib/codex-settings.ts';
import {makePlan,selection as legacy} from './fixtures/production.mjs';

test('all Gemini inference entry points use fifteen minutes, including discovery, DAG text calls and images',async()=>{
 const timeouts=[],originalTimeout=AbortSignal.timeout,failure=new Error('controlled deadline probe');
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'controlled'},{},async()=>{throw failure;}),gen=provider.generator();
 const selection={...legacy,length:'auto'},plan=makePlan(3),original={title:'原文',text:'甲赠物，乙未接。',url:'https://example.org/source',kind:'passage',provider:'fixture',retrievedAt:'2026-11-05'};
 const local=purpose=>({title:'西游记',edition:'a'.repeat(64),text:'[xiyou-001-001]\n石猴出世。',purpose,scan:{maxStories:1,excludedSources:[],pendingEvents:[],contextText:''}});
 const calls=[
  ()=>provider.suggestions(selection,[]),
  ()=>provider.suggestions(selection,[],local('catalog')),
  ()=>provider.suggestions(selection,[],local('scan')),
  ()=>provider.matchStories('原典故事',[{id:'a'.repeat(64),title:'赠物',text:original.text}]),
  ()=>provider.recommendArt(selection,{...original,localSource:{edition:'a'.repeat(64),sectionId:'s',firstUnit:'u',lastUnit:'u'}}),
  ()=>gen.recommend(selection,'fixture',original),
  ...['outline','plan','review','repair'].map(task=>()=>gen.textCall(task,'指令',{},{type:'object',properties:{},additionalProperties:false},4096,original)),
  ()=>gen.image(plan,0,'fixture',''),
 ];
 AbortSignal.timeout=function(ms){timeouts.push(ms);return originalTimeout.call(this,ms);};
 try{for(const call of calls)await assert.rejects(call,error=>error===failure);}
 finally{AbortSignal.timeout=originalTimeout;}
 assert.equal(geminiGenerationTimeoutMs,codexGenerationTimeoutMs);
 assert.equal(geminiGenerationTimeoutMs,900000);
 assert.deepEqual(timeouts,Array(calls.length).fill(900000));
 for(const phase of ['recommend','plan','reflection','review','repair','image'])assert.equal(provider.generationTimeoutMs(phase),900000);
 assert.equal(provider.generationTimeoutMs('source'),null);
});
