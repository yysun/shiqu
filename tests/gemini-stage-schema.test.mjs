// 适配器与配置契约使用受控输入；真实启动和制作流程由独立文件覆盖。
import test from 'node:test';

import assert from 'node:assert/strict';

import {createReaderProvider} from '../server/generation.ts';

import {dagGenerator} from '../lib/production-dag/calls.ts';
import {makePlan,selection as legacy} from './fixtures/production.mjs';

const original={title:'原文',text:'甲赠物，乙未接，后来二人相知相爱。',url:'',kind:'passage',provider:'fixture',retrievedAt:'2026-11-05',localSource:{edition:'a'.repeat(64),sectionId:'s',firstUnit:'u',lastUnit:'u'}};

const issue={page:2,category:'progression',problem:'回应缺失',instruction:'保留回应',requiresReplan:true};
const local=(purpose,maxStories=32)=>({title:'聊斋志异',edition:'a'.repeat(64),text:'[u]甲赠物，乙未接，后来二人相知相爱。',purpose,scan:{maxStories,excludedSources:[],pendingEvents:[],contextText:''}});
const source={original,book:'聊斋志异',chosenStory:'赠物',variationSeed:'story-1'},style={artStyle:'ink-pencil',artStylePrompt:null};
const outline={title:'赠物',summary:'梗概',sourceReference:'聊斋志异',adaptationNote:'按原文',beats:['甲赠物','乙未接']};
const people=[{id:'c1',name:'甲',aliases:[],text:'赠物者。'}],visualFrames=[{index:0,caption:'甲向乙赠物，乙未接。'}];
const frameIssue={...issue,requiresReplan:false};

// 提供方的发现、画风、幅数建议与生图入口，以及制作 DAG 经 textCall 发出的各调用，逐一检查线上请求契约。
function stages(provider,length='auto'){
 const selection={...legacy,length,acceptancePrompt:'保留原文结局。'},plan=makePlan(3),gen=provider.generator(),dag=dagGenerator(gen.textCall);
 const settings={narrativeDetail:'balanced',length:length==='auto'?'auto':80},captions=['甲向乙赠物，乙未接。','乙沉默，转身离开。'];
 return [
  ['suggest',()=>provider.suggestions(selection,[])],['local-choices',()=>provider.suggestions(selection,[],local())],
  ['catalog-1',()=>provider.suggestions(selection,[],local('catalog',1))],['catalog-32',()=>provider.suggestions(selection,[],local('catalog'))],['scan',()=>provider.suggestions(selection,[],local('scan'))],
  ['match',()=>provider.matchStories('爱情',[{id:'a'.repeat(64),title:'赠物',text:original.text}])],['art',()=>provider.recommendArt(selection,original)],
  ['recommend',()=>gen.recommend(selection,'fixture',original,true)],
  ['brief',()=>dag.prepareBrief({source})],['characters',()=>dag.characters({source,productionPrompt:''})],['outline',()=>dag.outline({source,productionPrompt:'',settings})],
  ['scenes',()=>dag.sceneBatch({source,outline,productionPrompt:'',first:1,previous:[]})],['visual',()=>dag.visual({outline,productionPrompt:'',style,characters:people,frames:visualFrames})],
  ['restyle',()=>dag.restyle({outline,productionPrompt:'',style,characters:people,previousStyle:style,frames:visualFrames.map(f=>({...f,previousPrompt:'旧画面描述，人物站在庭院中央。'}))})],
  ['scene-repair',()=>dag.sceneRepair({source,outline,productionPrompt:'',frames:[{index:0,caption:captions[0],neighbors:{},issues:[frameIssue]}]})],
  ['visual-repair',()=>dag.visualRepair({outline,productionPrompt:'',style,characters:people,frames:visualFrames.map(f=>({...f,prompt:'旧画面描述，人物站在庭院中央。',drawn:people,issues:[frameIssue]}))})],
  ['structure-repair',()=>dag.structureRepair({source,outline,productionPrompt:'',settings,captions,issues:[issue]})],
  ['ending',()=>dag.ending({source,outline,captions})],['ending-repair',()=>dag.endingRepair({source,outline,captions,reflection:plan.reflection,issues:[]})],
  ['frame-check',()=>dag.frameCheck({source,outline,productionPrompt:'',settings,captions})],
  ['review',()=>dag.review({source,brief:'梗概',outline,title:'赠物',productionPrompt:'',acceptancePrompt:'保留原文结局。',style,characters:people,frames:captions.map(caption=>({id:caption,caption,prompt:'画面描述，人物站在庭院中央。'})),confirmedEnding:{title:plan.title,ending:plan.reflection},allowed:{pages:[1],narrative:true}})],
  ['image',()=>gen.image(plan,0,'fixture','')],
 ];
}

function checkGrammar(schema){
 if(!schema||typeof schema!=='object')return;
 for(const [key,value] of Object.entries(schema)){
  assert.ok(!['minItems','maxItems','minimum','maximum'].includes(key),`${key} expands Gemini's grammar`);
  checkGrammar(value);
 }
}

for(const model of ['gemini-3.8-flash','gemini-4-argon'])for(const length of ['auto',80])test(`${model}: all ${length} production stages avoid counted grammar and preserve request contracts`,async()=>{
 let stage,seen=0;const captured=new Error('request captured');
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'controlled',GEMINI_TEXT_MODEL:model},{},async(url,options)=>{
  seen++;const body=JSON.parse(options.body),config=body.generationConfig;
  assert.equal(options.headers['x-goog-api-key'],'controlled');assert.equal(body.store,false);
  assert.ok(options.signal instanceof AbortSignal);
  if(stage==='image'){
   assert.match(url,/gemini-nano-banana-2.1/);assert.equal(config.responseFormat,undefined);assert.equal(config.thinkingConfig,undefined);
   assert.deepEqual(config.responseModalities,['TEXT','IMAGE']);assert.deepEqual(config.imageConfig,{aspectRatio:'9:16',imageSize:'1K'});
  }else{
   assert.ok(url.includes(model));assert.equal(config.responseFormat.text.mimeType,'APPLICATION_JSON');checkGrammar(config.responseFormat.text.schema);
   assert.equal(config.responseFormat.text.schema.additionalProperties,false);
   assert.ok(config.responseFormat.text.schema.required.length>0);
   if(stage==='catalog-32')assert.match(config.responseFormat.text.schema.properties.stories.description,/At most 32 items/);
   if(stage==='outline'&&length===80)assert.match(config.responseFormat.text.schema.properties.beats.description,/At most 80 items/);
  }
  throw captured;
 });
 const calls=stages(provider,length);
 for(const [name,call] of calls){stage=name;await assert.rejects(call,error=>error===captured,name);}
 assert.equal(seen,calls.length);
});

for(const [message,code] of [
 ['The input schema has too many states for serving.','SCHEMA_TOO_COMPLEX'],
 ['The constraint grammar is too complex.','SCHEMA_TOO_COMPLEX'],
 ['Unknown name "unsupportedField" at generation_config.','UNSUPPORTED_FIELD'],
 ['Invalid request argument.','PROVIDER_ERROR'],
])test(`all production stages report ${code} safely without automatic retries`,async()=>{
 const secret='sk-private-secret /Users/private 原文敏感',logs=[],save=console.error;let calls=0;
 console.error=(...args)=>logs.push(args);
 try{
  const provider=createReaderProvider({SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:secret},{},async()=>{
   calls++;return Response.json({error:{status:'INVALID_ARGUMENT',message:message+' '+secret}},{status:400});
  });
  const all=stages(provider);
  for(const [name,call] of all)await assert.rejects(call,error=>{
   assert.equal(error.message,code,name);assert.equal(error.status,400);assert.match(provider.safeError(error),/已保留前面的内容/);return true;
  });
  assert.equal(calls,all.length);assert.doesNotMatch(JSON.stringify(logs),/sk-private|Users|敏感|unsupportedField/);
  const rejected=logs.filter(log=>log[0]==='gemini_request_rejected').map(log=>JSON.parse(log[1]));
  assert.ok(rejected.every(log=>log.task));assert.equal(rejected.at(-1).task,'image');
 }finally{console.error=save;}
});

test('relaxed wire counts never relax production counts or saved prompt records',async()=>{
 let answer,sent;
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'controlled'},{},async(_url,options)=>{
  sent=JSON.parse(options.body).generationConfig.responseFormat.text.schema;
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(answer)}]}}]});
 });
 const gen=provider.generator(),dag=dagGenerator(gen.textCall),selection={...legacy,length:'auto'},settings={narrativeDetail:'balanced',length:'auto'};
 for(const count of [0,81]){
  answer={...outline,beats:Array(count).fill('原文行动。')};await assert.rejects(dag.outline({source,productionPrompt:'',settings}),error=>error.name==='ZodError');
  answer={count,reason:'根据原文估算。'};await assert.rejects(gen.recommend(selection,'fixture',original),error=>error.name==='ZodError');
 }
 answer={count:3,reason:'根据原文估算。'};
 const recommendation=await gen.recommend(selection,'fixture',original);assert.deepEqual(recommendation.promptRecord.schema,sent);
 answer=outline;const result=await dag.outline({source,productionPrompt:'',settings});assert.deepEqual(result.promptRecord.schema,sent);
});
