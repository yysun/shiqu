// Controlled real provider adapters, SQLite and files; never send source or paid requests.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../../server/app.ts';
import {createReaderProvider} from '../../server/generation.ts';
import {FileMedia} from '../../server/media.ts';
import {geminiEvidenceAnswer} from './gemini-evidence.mjs';
import {encoded,selection,makePlan,makeRequirements,makeReflectionCandidates} from './production-data.mjs';
export {encoded,selection,makePlan,makeRequirements,makeReflectionCandidates,turn,until} from './production-data.mjs';
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
export async function productionFixture(t,provider='codex',variables={},storage={}){
 // Browser runs may retain their own fresh checkout-local database; ordinary tests remain disposable.
 const parent=storage.parentDirectory||os.tmpdir();await mkdir(parent,{recursive:true});
 const root=await mkdtemp(path.join(parent,'shiqu production ')),dataDirectory=path.join(root,'data');
 await cp('drizzle',path.join(root,'drizzle'),{recursive:true});await mkdir(path.join(root,'docker'));await cp('docker/seed.sql',path.join(root,'docker/seed.sql'));
 const control={textVia:new Set(),calls:[],plans:[],outlines:[],batches:[],reflections:[],reflectionRepairs:[],frameReviews:[],reviews:[],structures:[],repairs:[],recommendations:[],hold:true,autoLength:8,active:0,maxActive:0,beforeText:null};
 async function image(prompt,reference,via){
  const page=Number(prompt.match(/Scene (\d+):/)[1])-1,gate=deferred(),call={page,reference,prompt,via,...gate,done:false,bytes:encoded};
  control.calls.push(call);control.active++;control.maxActive=Math.max(control.maxActive,control.active);
  try{if(control.hold)await gate.promise;return call.bytes;}finally{call.done=true;control.active--;}
 }
 async function planned(prompt,schema){
  const payload=JSON.parse(prompt);if(schema.properties.artStyle)return {artStyle:'ink-pencil',reason:'与本篇人物动作及叙事相符。'};
  if(schema.properties.count){control.recommendations.push(payload);return {count:7,reason:'保留完整因果和关键转折。',...(schema.properties.storyTitle?{storyTitle:payload.chosenStory||'所选故事',artRecommendation:{artStyle:'ink-pencil',reason:'与本篇人物动作及叙事相符。'}}:{}),...(schema.properties.requirements?{requirements:makeRequirements(payload.chosenStory||'所选故事')}:{ }),...(schema.properties.storySummary?{storySummary:payload.storyBrief.summary==='尚未准备完整摘要，请依据已核原文生成。'?makePlan(1).summary:payload.storyBrief.summary,storyMatchReason:payload.storyBrief.matchReason,...await control.beforeText?.('recommend',payload,schema)}:{})};}
  if(schema.properties.requirements){control.frameReviews.push(payload);return await control.beforeText?.('frames',payload,schema)??{frameCountReview:{decision:'keep',proposedCount:payload.plan.pages.length,reason:'受控任务已有空间。'},requirements:[]};}
  if(schema.properties.issues){control.reviews.push(payload);return {coverage:[{quote:payload.verifiedOriginal.text.slice(0,30),task:'受控原文与分镜核对',pages:[1],assessment:'adequate',reason:'受控回执，不代表真实语义审核。',issuePage:0}],titleReview:{title:payload.plan.title,reason:'标题准确对应当前故事。'},...(payload.reflectionCandidates?{reflectionChoice:{index:1,reason:'保留原文支持的认识，表达简洁。'}}:{}),...await control.beforeText?.('review',payload,schema)??{issues:[],...(payload.acceptanceCriteria?.length?{acceptanceResults:payload.acceptanceCriteria.map((_,index)=>({criterion:index+1,status:'passed',pages:[1],evidence:'受控分镜已包含要求中的关键行动与结果。'}))}:{})}};}
  if(payload.draft){
   (payload.revision?control.reflectionRepairs:control.reflections).push(payload);
   const override=await control.beforeText?.(payload.revision?'reflection-repair':'reflection',payload,schema);
   return schema.properties.candidates?{title:payload.draft.title,...override??{candidates:makeReflectionCandidates(makePlan(1).reflection)}}:override??{reflection:'梦醒之后，仍可以记住梦中的自在。'};
  }
  if(schema.properties.edits){control.structures.push(payload);return await control.beforeText?.('structure',payload,schema)??{edits:[{from:2,to:1,pages:[makePlan(1).pages[0]]}]};}
  if(payload.requestedPages){control.repairs.push(payload);return await control.beforeText?.('repair',payload,schema)??{pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1],prompt:payload.plan.pages[page-1].prompt+' Revised staging with one clear visible action.'}))};}
  const length=payload.exactPageCount==='auto'?control.autoLength:payload.exactPageCount,plan=makePlan(length);
  if(schema.properties.beats){control.outlines.push(payload);const override=await control.beforeText?.('outline',payload,schema);const {pages,...metadata}=plan;return override??{...metadata,beats:pages.map((_,i)=>`第 ${i+1} 幅的关键事件与动作。`)};}
  control.plans.push(payload);if(payload.batch)control.batches.push(payload);
  const override=await control.beforeText?.(payload.batch?'batch':'plan',payload,schema);
  return override??(payload.batch?{pages:plan.pages.slice(payload.batch.first-1,payload.batch.last)}:plan);
 }
 const transport=async(url,options)=>{
  if(provider==='deepseek'){
   assert.equal(String(url),'https://api.deepseek.com/responses','No external source/inference request');
   assert.equal(options.headers.Authorization,'Bearer controlled');
   const body=JSON.parse(options.body),payload=JSON.parse(body.input[0].content),value=geminiEvidenceAnswer(await planned(body.input[0].content,body.text.format.schema),payload,body.text.format.schema);
   return Response.json({status:'completed',id:'controlled',model:'deepseek-flash',usage:{input_tokens:1,output_tokens:1},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
  }
  assert.match(String(url),/^https:\/\/generativelanguage.googleapis.com\//,'No external source/inference request');
  const body=JSON.parse(options.body),parts=body.contents[0].parts;
  const schema=body.generationConfig.responseFormat?.text.schema;
  if(!body.generationConfig.responseModalities)control.textVia.add('gemini');
  const output=body.generationConfig.responseModalities?{inlineData:{mimeType:'image/png',data:await image(parts.find(p=>p.text).text,parts.find(p=>p.inlineData)?.inlineData.data,'gemini')}}:{text:JSON.stringify(geminiEvidenceAnswer(await planned(parts[0].text,schema),JSON.parse(parts[0].text),schema))};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[output]}}],responseId:'controlled',usageMetadata:{calls:1}});
 };
 const runner={async status(){return {configured:true};},async run(job){if(!job.generateImage)control.textVia.add('codex');return {text:job.generateImage?'':JSON.stringify(await planned(job.prompt,job.schema)),image:job.generateImage?await image(job.prompt,job.image&&Buffer.from(job.image.bytes).toString('base64'),'codex'):null,model:'controlled',requestId:'controlled',usage:{calls:1}};}};
 const media=new FileMedia(path.join(dataDirectory,'media'));
 // storage.imageProvider exercises the production composition with a separate drawing provider.
 const keys={gemini:{GEMINI_API_KEY:'controlled'},deepseek:{DEEPSEEK_API_KEY:'controlled'}};
 const generation=createReaderProvider({SHIQU_AI_PROVIDER:provider,...(storage.imageProvider?{SHIQU_IMAGE_PROVIDER:storage.imageProvider}:{}),...keys[provider],...keys[storage.imageProvider]},media,transport,runner);
 const options={root,dataDirectory,generation,transport,variables};let app=createApplication(options);
 async function stop(){control.hold=false;for(const call of control.calls)call.resolve();await app.close();}
 const coordinators=[];
 t?.after(async()=>{app.stopGeneration();for(const coordinator of coordinators)coordinator.stop();control.hold=false;for(const call of control.calls)call.resolve();for(const coordinator of coordinators)await coordinator.close();await stop();if(!storage.retain)await rm(root,{recursive:true,force:true});});
 const overrides=new Map();
 async function request(suffix,method='GET',body,headers={}){
  // Helpers model explicit user commands; raw transport-contract tests can call app.handle directly.
  if(method==='POST'&&suffix.endsWith('/production-control')&&body?.action&&!body.requestId)body={...body,requestId:crypto.randomUUID()};
  if(method==='POST'&&suffix.endsWith('/review-override')&&!body?.requestId){
   const id=suffix.split('/')[1];
   if(!overrides.has(id)){const snapshot=await read(id),fault=snapshot.faults?.find(f=>f.stage==='review'&&f.state==='pending');overrides.set(id,{requestId:crypto.randomUUID(),faultId:fault?.id||'no-current-review'});}
   body={...body,...overrides.get(id)};
  }
  return app.handle(new Request('http://localhost/api/reader/'+suffix,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}));
 }
 async function json(suffix,method='GET',body){const response=await request(suffix,method,body);assert.ok(response.ok,`${response.status}: ${suffix}`);return response.json();}
 async function create(length=8,overrides={}){const id=crypto.randomUUID();await json('sessions','POST',{requestId:id,selection:{...selection,length,...overrides}});return id;}
 // Deliberately model persisted clients from before whole-story generation became the default.
 async function createLegacyReader(length=8,overrides={}){const id=await create(length,overrides);await app.services.database.prepare("UPDATE stories SET generation_mode='reader' WHERE id=?").bind(id).run();return id;}
 const demand=async(id,viewerId=crypto.randomUUID(),page=0,retry=false)=>{
  const session=await json(`sessions/${id}/production`,'POST',{viewerId,page,retry:false});
  if(!retry||session.generationControl!=='active'||session.superseded)return session;
  const fault=session.faults?.find(f=>f.retryAllowed);if(!fault)return session;
  return json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 };
 const read=id=>json(`sessions/${id}`);
 // Model an explicit extraction-button click; requesting viewing demand never starts an idle intake.
 const startDiscovery=async(id,title)=>{const saved=await read(id);return json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'search',title:title??(saved.selection.discovery?.mode==='title'?saved.selection.discovery.title:'')});};
 const leave=(id,viewerId)=>json(`sessions/${id}/production`,'DELETE',{viewerId});
 return {root,dataDirectory,options,control,media,generation,request,json,create,createLegacyReader,demand,startDiscovery,read,leave,stop,coordinators,get app(){return app;},async restart(){await stop();app=createApplication(options);}};
}
