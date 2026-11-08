// Verify the real adapter boundaries with fake HTTP/CLI and privacy-limited usage events.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderProvider} from '../server/generation.ts';
import {discoveryCode,DiscoveryFailure,discoveryUsage} from '../lib/reader-discovery-call.ts';
const stories=Array.from({length:4},(_,i)=>({id:String(i+1).repeat(64),title:'事件'+i,text:'PRIVATE_ORIGINAL_'+i+'，人物行动并解决问题。'}));
for(const provider of ['codex','gemini','openai'])test(`${provider}: wire IDs, partial parsing, capacity, prefix order and safe metrics`,async()=>{
 const events=[],requests=[];let result={matches:[{id:1,reason:'冲突依据甲',verdict:'yes'},{id:1,reason:'冲突依据乙',verdict:'no'},{id:2,reason:'合法依据',verdict:'yes',matchScore:88},{id:3,reason:'非法判定',verdict:'review'}]};
 const runner={status:async()=>({configured:true,model:'controlled'}),run:async job=>{requests.push({payload:JSON.parse(job.prompt),schema:job.schema});return {text:JSON.stringify(result),model:job.model||'controlled',usage:{inputTokens:11,outputTokens:7}};}};
 const transport=async(_url,init)=>{const body=JSON.parse(init.body),api=provider==='openai';requests.push({payload:JSON.parse(api?body.input[0].content:body.contents[0].parts[0].text),schema:api?body.text.format.schema:body.generationConfig.responseFormat.text.schema});return Response.json(api?{status:'completed',model:body.model,usage:{input_tokens:11,output_tokens:7},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}],usageMetadata:{promptTokenCount:11,candidatesTokenCount:7}});};
 const p=createReaderProvider({SHIQU_AI_PROVIDER:provider,OPENAI_API_KEY:'SECRET',GEMINI_API_KEY:'SECRET'}, {},transport,runner);
 const parsed=await p.matchStories('PRIVATE_THEME',stories,{onCall:e=>events.push(e)});assert.deepEqual(parsed.matches.map(m=>m.id),[stories[1].id]);assert.equal(parsed.matches[0].matchScore,88);
 assert.deepEqual(Object.keys(requests[0].payload),['stories','theme']);assert.deepEqual(requests[0].payload.stories.map(s=>s.id),[1,2,3,4]);assert.deepEqual(Object.keys(requests[0].schema.properties.matches.items.properties),['id','reason','verdict','matchScore']);
 result={stories:Array.from({length:32},(_,i)=>({title:'完整事件'+i,description:'原文中的完整事件。',source:{sectionId:'s1',firstUnit:'u1',lastUnit:'u1',continuations:[]}})),note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}};
 await p.suggestions({bookId:'zhuangzi',theme:'PRIVATE_THEME'},['CHANGING_EXCLUSION'],{title:'原典',edition:'a'.repeat(64),text:'STABLE_TEXT',purpose:'catalog',scan:{maxStories:32,excludedSources:[],pendingEvents:[],contextText:'CHANGING_CONTEXT'}},{onCall:e=>events.push(e)});
 const serialized=JSON.stringify(requests[1].payload);assert.ok(serialized.indexOf('STABLE_TEXT')<serialized.indexOf('CHANGING_CONTEXT'));assert.ok(serialized.indexOf('STABLE_TEXT')<serialized.indexOf('CHANGING_EXCLUSION'));assert.equal(requests[1].schema.properties.stories.maxItems,provider==='gemini'?undefined:32);
 if(provider==='gemini')assert.match(requests[1].schema.properties.stories.description,/At most 32 items/);
 assert.equal(events[1].acceptedCount,32);assert.equal(events.length,2);assert.equal(events[0].acceptedCount,1);assert.equal(events[0].inputTokens,11);assert.equal(events[0].outputTokens,7);assert.ok(events.every(e=>e.durationMs>=0));assert.doesNotMatch(JSON.stringify(events),/PRIVATE_|SECRET|CHANGING_/);
});
test('unknown usage stays unknown; only recognized content failures are isolatable',()=>{
 assert.deepEqual(discoveryUsage(null),{inputTokens:null,outputTokens:null});assert.equal(discoveryCode(new TypeError('network secret')),'service');assert.equal(discoveryCode(new DiscoveryFailure('refused')),'refused');assert.equal(discoveryCode(new SyntaxError('body')),'invalid-output');assert.equal(discoveryCode({message:'TIMEOUT',inferenceStarted:false}),'service');assert.equal(discoveryCode({message:'TIMEOUT',inferenceStarted:true}),'timeout');
});
for(const provider of ['openai','gemini'])for(const fault of ['timeout','envelope'])test(`${provider}: ${fault} transport failure stays a service error`,async()=>{
 const transport=async()=>{if(fault==='timeout')throw new DOMException('private transport details','TimeoutError');return new Response('{broken',{headers:{'Content-Type':'application/json'}});};
 const p=createReaderProvider({SHIQU_AI_PROVIDER:provider,OPENAI_API_KEY:'SECRET',GEMINI_API_KEY:'SECRET'},{},transport);const events=[];
 await assert.rejects(p.matchStories('主题',stories,{onCall:e=>events.push(e)}),error=>discoveryCode(error)==='service');assert.equal(events.length,1);assert.equal(events[0].status,'service');
});
for(const provider of ['codex','openai','gemini'])test(`${provider}: valid catalog siblings survive malformed pending metadata`,async()=>{
 const source={sectionId:'s1',firstUnit:'u1',lastUnit:'u1',continuations:[]},result={stories:[{title:'完整事件',description:'原文中的独立事件。',source}],note:'',scan:{blockComplete:true,pendingEvents:[{id:'old',title:'',source}],resolvedEventIds:[]}};
 const runner={status:async()=>({configured:true,model:'controlled'}),run:async()=>({text:JSON.stringify(result)})};
 const transport=async()=>Response.json(provider==='openai'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]});
 const p=createReaderProvider({SHIQU_AI_PROVIDER:provider,OPENAI_API_KEY:'SECRET',GEMINI_API_KEY:'SECRET'},{},transport,runner);
 const batch=await p.suggestions({bookId:'zhuangzi',theme:'主题'},[],{title:'原典',edition:'a'.repeat(64),text:'原文',purpose:'catalog',scan:{maxStories:1,excludedSources:[],pendingEvents:[],contextText:''}});assert.equal(batch.stories.length,1);assert.equal(batch.scan.invalid,true);assert.equal(batch.scan.blockComplete,false);
});

import {discoveryMeasurement,measurementBusy,settleMeasurements} from '../server/story-discovery-metrics.ts';
import {StoryDiscoveryCache,discoveryHash} from '../server/story-discovery-cache.ts';
import {memory} from './fixtures/story-library.mjs';
import {z} from 'zod';
test('shutdown drain includes queued measurement updates that have not entered the cache yet',async()=>{
 const cache=new StoryDiscoveryCache(memory()),measurement=await discoveryMeasurement(cache,'late-queue',true);
 const event={id:'a',stage:'matching',provider:'controlled',model:'fixture',effort:'none',durationMs:1,status:'success',cancelled:false,requestedCount:1,acceptedCount:1,inputTokens:2,outputTokens:3,isolation:false};
 for(const id of ['a','b','c'])measurement.call({...event,id});assert.equal(measurementBusy(cache),true);await settleMeasurements(cache);assert.equal(measurementBusy(cache),false);
 const saved=await cache.read('discovery-measurement/'+discoveryHash('late-queue'),z.any());assert.equal(saved.calls,3);assert.equal(saved.inputTokens,6);
});

import {discoveryCall} from '../lib/reader-discovery-call.ts';
import {until} from './fixtures/production.mjs';
test('cancelled extraction still attributes its completed paid receipt to the original cycle',async()=>{
 const cache=new StoryDiscoveryCache(memory()),measurement=await discoveryMeasurement(cache,'cancelled-cost',true),controller=new AbortController();let release,started=false;
 const pending=cache.shared('paid-extraction',{signal:controller.signal,onProgress:()=>{},onCall:measurement.call},reading=>discoveryCall({stage:'extraction',provider:'controlled',model:'fixture',effort:'none',requestedCount:1},reading,async report=>{started=true;await new Promise(resolve=>{release=resolve;});report({acceptedCount:1,usage:{input_tokens:11,output_tokens:5}});return 'saved';}));
 await until(()=>started);controller.abort();await assert.rejects(pending);await measurement.finish('cancelled');release();await cache.settle();await settleMeasurements(cache);
 const saved=await cache.read('discovery-measurement/'+discoveryHash('cancelled-cost'),z.any());assert.equal(saved.calls,1);assert.equal(saved.inputTokens,11);assert.equal(saved.outputTokens,5);assert.equal(saved.status,'cancelled');
});
