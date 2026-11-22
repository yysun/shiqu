// 适配器与配置契约使用受控输入；真实启动和制作流程由独立文件覆盖。
import test from 'node:test';

import assert from 'node:assert/strict';

import {createReaderProvider} from '../server/generation.ts';

import {configuredTaskReasoning,taskReasoningDefaults,reasoningTasks} from '../lib/reader-reasoning.ts';

import {desktopSettings,desktopVariables} from '../server/desktop.ts';

import {withLocalBooks} from '../server/local-generation.ts';

import {dagGenerator} from '../lib/production-dag/calls.ts';

import {makePlan,selection as baseSelection} from './fixtures/production.mjs';

const selection={...baseSelection,length:8},plan=makePlan(8);

const original={title:'已核原文',text:'庄周梦为胡蝶。',url:'https://example.org',localSource:{edition:'a'.repeat(64),sectionId:'s',firstUnit:'u',lastUnit:'u'}};

const source={original,book:'庄子',chosenStory:'庄周梦蝶',variationSeed:'s'},style={artStyle:'ink-pencil',artStylePrompt:null},settings={narrativeDetail:'balanced',length:8};
const outline={title:'庄周梦蝶',summary:'梗概',sourceReference:'庄子',adaptationNote:'按原文',beats:['庄周梦蝶','醒来']},people=[{id:'c1',name:'庄周',aliases:[],text:'梦者。'}];
const captions=['庄周梦为蝴蝶。','庄周醒来，仍是庄周。'],frames=[{index:0,caption:captions[0],candidates:people}],issue={page:1,category:'caption',problem:'机械重复转述。',instruction:'只修配文。',requiresReplan:false};

const override={suggest:'high',art:'medium',frames:'low',outline:'medium',plan:'low',review:'medium',repair:'low'};

// 提供方自有的调用返回受控回答；制作 DAG 的调用在记录推理强度后即中止，只检查各调用使用的任务强度。
function output(payload,schema){
 if(schema.properties.matches)return {matches:payload.stories.map(story=>({id:story.id,verdict:'yes',reason:'原文事件与结果支持本次选题。'}))};
 if(schema.properties.stories)return {stories:[],note:''};
 if(schema.properties.artStyle)return {artStyle:'ink-pencil',reason:'适合本篇动作。'};
 if(schema.properties.count)return {count:8,reason:'保留完整因果。'};
 throw Error('captured');
}

// 各 DAG 调用所属的任务强度：简介归画幅数，人物与提纲归提纲，分镜与画面归编排，修订归修订，核对与审片归审核。
const dagTasks=['frames','outline','outline','plan','plan','repair','repair','repair','repair','plan','repair','review','review','review'];
const dagCalls=dag=>[
 ()=>dag.prepareBrief({source}),()=>dag.characters({source,productionPrompt:''}),()=>dag.outline({source,productionPrompt:'',settings}),
 ()=>dag.sceneBatch({source,outline,productionPrompt:'',first:1,previous:[]}),()=>dag.visual({outline,productionPrompt:'',style,frames}),
 ()=>dag.restyle({outline,productionPrompt:'',style,previousStyle:style,frames:frames.map(f=>({...f,previousPrompt:'旧画面描述，人物站在庭院中央。'}))}),
 ()=>dag.sceneRepair({source,outline,productionPrompt:'',frames:[{index:0,caption:captions[0],neighbors:{},issues:[issue]}]}),
 ()=>dag.visualRepair({outline,productionPrompt:'',style,frames:frames.map(f=>({...f,prompt:'旧画面描述，人物站在庭院中央。',drawn:people,issues:[issue]}))}),
 ()=>dag.structureRepair({source,outline,productionPrompt:'',settings,captions,issues:[{...issue,requiresReplan:true}]}),
 ()=>dag.ending({source,outline,captions}),()=>dag.endingRepair({source,outline,captions,reflection:plan.reflection,issues:[]}),
 ()=>dag.frameCheck({source,outline,productionPrompt:'',settings,captions}),()=>dag.registerItems({items:[{id:'i1',text:'保留原文结局。'}]}),
 ()=>dag.review({source,brief:'梗概',outline,title:'庄周梦蝶',productionPrompt:'',acceptancePrompt:'',style,characters:people,frames:captions.map(caption=>({id:caption,caption,prompt:'画面描述，人物站在庭院中央。'})),chosenEnding:plan.reflection,allowed:{pages:[1],criteria:[],narrative:false},itemIds:{}}),
];

for(const name of ['codex','gemini'])for(const custom of [false,true])test(`${name}: all text tasks use ${custom?'explicit overrides':'recommended defaults'}, not the old global effort`,async()=>{
 const calls=[],efforts=custom?override:taskReasoningDefaults;
 const variables={SHIQU_AI_PROVIDER:name,CODEX_REASONING_EFFORT:'max',...(custom?Object.fromEntries(reasoningTasks.map(task=>['SHIQU_REASONING_'+task.toUpperCase(),efforts[task]])):{})};
 const runner={status:async()=>({configured:true}),async run(job){calls.push(job.reasoningEffort);return {text:JSON.stringify(output(JSON.parse(job.prompt),job.schema)),model:'controlled',requestId:'controlled',usage:{calls:1},reasoningEffort:job.reasoningEffort};}};
 const transport=async(_url,init)=>{
  const body=JSON.parse(init.body);calls.push(body.generationConfig.thinkingConfig.thinkingLevel.toLowerCase());
  const payload=JSON.parse(body.contents[0].parts[0].text),schema=body.generationConfig.responseFormat.text.schema;
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output(payload,schema))}]}}]});
 };
 const provider=createReaderProvider(variables,{},transport,runner),g=provider.generator();
 await provider.suggestions(selection,[]);await provider.matchStories(selection.theme,[{id:'a'.repeat(64),title:'故事',text:'完整因果和结局。'}]);await provider.recommendArt(selection,original);
 assert.equal((await g.recommend(selection,'test',original)).reasoningEffort,efforts.frames);
 for(const call of dagCalls(dagGenerator(g.textCall)))await assert.rejects(call(),error=>error.message==='captured'||/captured/.test(String(error.message)));
 assert.deepEqual(calls,['suggest','match','art','frames',...dagTasks].map(task=>task==='match'?'low':efforts[task]));
 assert.deepEqual((await provider.status()).taskReasoningEfforts,efforts);
});

test('invalid task config fails before inference, and Gemini never downgrades xhigh',async()=>{
 assert.throws(()=>configuredTaskReasoning({SHIQU_REASONING_REVIEW:'hgh'}));
 let calls=0;const transport=async()=>{calls++;throw Error('must not request');};
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'gemini',SHIQU_REASONING_REVIEW:'xhigh'}, {},transport);
 await assert.rejects(provider.generator().textCall('review','指令',{},{type:'object',properties:{},additionalProperties:false},4096),/UNSUPPORTED_REASONING_EFFORT/);assert.equal(calls,0);
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
