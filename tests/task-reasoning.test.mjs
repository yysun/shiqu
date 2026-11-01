// Verify task routing at provider request boundaries, including overrides and unsupported Gemini levels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderProvider} from '../server/generation.ts';
import {configuredTaskReasoning,taskReasoningDefaults,reasoningTasks} from '../lib/reader-reasoning.ts';
import {desktopSettings,desktopVariables} from '../server/desktop.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {makePlan,makeReflectionCandidates,selection as baseSelection,productionFixture,until} from './fixtures/production.mjs';

const selection={...baseSelection,length:8},plan=makePlan(8),{pages,...metadata}=plan;
const outline={...metadata,beats:pages.map((_,i)=>`第${i+1}幅的动作。`)};
const original={title:'已核原文',text:'庄周梦为胡蝶。',url:'https://example.org',localSource:{edition:'a'.repeat(64),sectionId:'s',firstUnit:'u',lastUnit:'u'}};
const issue={page:2,category:'caption',problem:'机械重复转述。',instruction:'只修配文。'};
const override={suggest:'high',art:'medium',frames:'low',outline:'medium',plan:'low',review:'medium',repair:'low'};
function output(payload,schema){
 if(schema.properties.candidates)return {title:payload.draft.title,candidates:makeReflectionCandidates(plan.reflection)};
 if(schema.properties.stories)return {stories:[],note:''};
 if(schema.properties.artStyle)return {artStyle:'ink-pencil',reason:'适合本篇动作。'};
 if(schema.properties.count)return {count:8,reason:'保留完整因果。'};
 if(schema.properties.issues)return {issues:[],titleReview:{title:payload.plan.title,reason:'标题准确对应当前故事。'}};
 if(payload.requestedPages)return {pages:payload.requestedPages.map(page=>({page,...plan.pages[page-1]}))};
 if(schema.properties.beats)return outline;
 if(payload.batch)return {pages:plan.pages.slice(payload.batch.first-1,payload.batch.last)};
 return plan;
}
for(const name of ['codex','gemini'])for(const custom of [false,true])test(`${name}: all text tasks use ${custom?'explicit overrides':'recommended defaults'}, not the old global effort`,async()=>{
 const calls=[],efforts=custom?override:taskReasoningDefaults;
 const variables={SHIQU_AI_PROVIDER:name,CODEX_REASONING_EFFORT:'max',...(custom?Object.fromEntries(reasoningTasks.map(task=>['SHIQU_REASONING_'+task.toUpperCase(),efforts[task]])):{})};
 const runner={status:async()=>({configured:true}),async run(job){calls.push(job.reasoningEffort);return {text:JSON.stringify(output(JSON.parse(job.prompt),job.schema)),model:'controlled',requestId:'controlled',usage:{calls:1},reasoningEffort:job.reasoningEffort};}};
 const transport=async(_url,init)=>{
  const body=JSON.parse(init.body);calls.push(body.generationConfig.thinkingConfig.thinkingLevel.toLowerCase());
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output(JSON.parse(body.contents[0].parts[0].text),body.generationConfig.responseFormat.text.schema))}]}}]});
 };
 const provider=createReaderProvider(variables,{},transport,runner),g=provider.generator();
 await provider.suggestions(selection,[]);await provider.recommendArt(selection,original);
 assert.equal((await g.recommend(selection,'test',original)).reasoningEffort,efforts.frames);
 await g.outline(selection,'test',original);await g.planBatch(selection,'test',{outline,pages:[]},original);
 assert.equal((await g.plan(selection,'test',original)).reasoningEffort,efforts.plan);
 assert.equal((await g.reflectionCandidates(selection,plan,original)).reasoningEffort,efforts.plan);
 assert.equal((await g.reflection(selection,plan,original,{reflection:plan.reflection,issues:[]})).reasoningEffort,efforts.repair);
 assert.equal((await g.review(selection,plan,original)).reasoningEffort,efforts.review);
 assert.equal((await g.repair(selection,plan,original,[issue])).reasoningEffort,efforts.repair);
 assert.deepEqual(calls,['suggest','art','frames','outline','plan','plan','plan','repair','review','repair'].map(task=>efforts[task]));
 assert.deepEqual((await provider.status()).taskReasoningEfforts,efforts);
});

test('invalid task config fails before inference, and Gemini never downgrades xhigh',async()=>{
 assert.throws(()=>configuredTaskReasoning({SHIQU_REASONING_REVIEW:'hgh'}));
 let calls=0;const transport=async()=>{calls++;throw Error('must not request');};
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'gemini',SHIQU_REASONING_REVIEW:'xhigh'}, {},transport);
 await assert.rejects(provider.generator().review(selection,plan,original),/UNSUPPORTED_REASONING_EFFORT/);assert.equal(calls,0);
});

test('old desktop settings acquire defaults, partial overrides persist, and Gemini rejects incompatible settings',()=>{
 const old={nodePath:'',dataDirectory:'/tmp/library',port:3000,provider:'codex',textModel:'test',imageModel:'test',codexPath:'',codexModel:'',codexHome:''};
 assert.deepEqual(desktopSettings.parse(old).taskReasoningEfforts,taskReasoningDefaults);
 const saved=desktopSettings.parse({...old,taskReasoningEfforts:{review:'xhigh'}});
 assert.equal(saved.taskReasoningEfforts.review,'xhigh');assert.equal(saved.taskReasoningEfforts.art,'low');
 const vars=desktopVariables(saved,'');assert.equal(vars.SHIQU_REASONING_REVIEW,'xhigh');assert.equal(vars.SHIQU_REASONING_PLAN,'high');
 assert.throws(()=>desktopSettings.parse({...saved,provider:'gemini'}));
 assert.throws(()=>desktopSettings.parse({...old,taskReasoningEfforts:{unknown:'high'}}));
});

test('Gemini task effort survives real queued review checkpoints alongside existing usage',async t=>{
 const f=await productionFixture(t,'gemini'),id=await f.createLegacyReader();
 await f.demand(id);await until(()=>f.control.calls.length===1);
 const row=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();
 const doc=JSON.parse(row.document),review=doc.usage.find(entry=>entry.step==='review:0');
 assert.equal(review.reasoningEffort,'high');assert.deepEqual(review.usage,{calls:1});
});

test('art effort isolates recommendations while review effort changes reuse the same recommendation',async()=>{
 let art='low',review='high',calls=0;
 const values=new Map(),media={get:async key=>{const bytes=values.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},put:async(key,bytes)=>values.set(key,new Uint8Array(bytes))};
 const provider={status:async()=>({provider:'codex',models:{text:'controlled'},taskReasoningEfforts:{art,review}}),safeError:()=>'',generator:()=>({}),async recommendArt(){calls++;return {artStyle:'ink-pencil',reason:'适合本篇。'};}};
 const local=withLocalBooks(provider,{selected:async()=>original},media);
 await local.recommendArt(selection);assert.equal(calls,1);
 review='xhigh';await local.recommendArt(selection);assert.equal(calls,1);
 art='medium';await local.recommendArt(selection);assert.equal(calls,2);
 art='low';await local.recommendArt(selection);assert.equal(calls,2);
});
