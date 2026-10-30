// Controlled real provider adapters, SQLite and files; never send source or paid requests.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../../server/app.ts';
import {createReaderProvider} from '../../server/generation.ts';
import {FileMedia} from '../../server/media.ts';

import {encoded} from './images.mjs';
export {encoded};
export const selection={bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'放下执念',length:8,voice:false,artStyle:'ink-pencil',productionPrompt:'quiet narration'};
export const makePlan=length=>({title:'庄周梦蝶',hook:'梦醒之后',sourceReference:'《庄子·齐物论》庄周梦蝶',adaptationNote:'现代改编',reflection:'谁在梦中？',characters:'An adult Chinese philosopher in a plain linen robe in ancient China.',pages:Array.from({length},(_,i)=>({caption:'庄周梦见自己成为一只蝴蝶，自由自在地飞来飞去。',prompt:`An adult philosopher dreams in an ancient garden, scene ${i}.`}))});
export const turn=()=>new Promise(resolve=>setImmediate(resolve));
export async function until(predicate,timeoutMs=5000){const end=Date.now()+timeoutMs;while(!await predicate()){assert.ok(Date.now()<end,'Timed out waiting for controlled production work');await turn();}}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
export async function productionFixture(t,provider='codex',variables={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu production ')),dataDirectory=path.join(root,'data');
 await cp('drizzle',path.join(root,'drizzle'),{recursive:true});await mkdir(path.join(root,'docker'));await cp('docker/seed.sql',path.join(root,'docker/seed.sql'));
 const control={calls:[],plans:[],outlines:[],batches:[],reviews:[],repairs:[],recommendations:[],hold:true,autoLength:8,active:0,maxActive:0,beforeText:null};
 async function image(prompt,reference){
  const page=Number(prompt.match(/Scene (\d+):/)[1])-1,gate=deferred(),call={page,reference,prompt,...gate,done:false,bytes:encoded};
  control.calls.push(call);control.active++;control.maxActive=Math.max(control.maxActive,control.active);
  try{if(control.hold)await gate.promise;return call.bytes;}finally{call.done=true;control.active--;}
 }
 async function planned(prompt,schema){
  const payload=JSON.parse(prompt);if(schema.properties.count){control.recommendations.push(payload);return {count:7,reason:'保留完整因果和关键转折。'};}
  if(schema.properties.issues){control.reviews.push(payload);return await control.beforeText?.('review',payload,schema)??{issues:[]};}
  if(payload.requestedPages){control.repairs.push(payload);return await control.beforeText?.('repair',payload,schema)??{pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1],prompt:payload.plan.pages[page-1].prompt+' Revised staging with one clear visible action.'}))};}
  const length=payload.exactPageCount==='auto'?control.autoLength:payload.exactPageCount,plan=makePlan(length);
  if(schema.properties.beats){control.outlines.push(payload);const override=await control.beforeText?.('outline',payload,schema);const {pages,...metadata}=plan;return override??{...metadata,beats:pages.map((_,i)=>`第 ${i+1} 幅的关键事件与动作。`)};}
  control.plans.push(payload);if(payload.batch)control.batches.push(payload);
  const override=await control.beforeText?.(payload.batch?'batch':'plan',payload,schema);
  return override??(payload.batch?{pages:plan.pages.slice(payload.batch.first-1,payload.batch.last)}:plan);
 }
 const transport=async(url,options)=>{
  assert.match(String(url),/^https:\/\/generativelanguage.googleapis.com\//,'No external source/inference request');
  const body=JSON.parse(options.body),parts=body.contents[0].parts;
  const output=body.generationConfig.responseModalities?{inlineData:{mimeType:'image/png',data:await image(parts.find(p=>p.text).text,parts.find(p=>p.inlineData)?.inlineData.data)}}:{text:JSON.stringify(await planned(parts[0].text,body.generationConfig.responseFormat.text.schema))};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[output]}}],responseId:'controlled',usageMetadata:{calls:1}});
 };
 const runner={async status(){return {configured:true};},async run(job){return {text:job.generateImage?'':JSON.stringify(await planned(job.prompt,job.schema)),image:job.generateImage?await image(job.prompt,job.image&&Buffer.from(job.image.bytes).toString('base64')):null,model:'controlled',requestId:'controlled',usage:{calls:1}};}};
 const media=new FileMedia(path.join(dataDirectory,'media'));
 const generation=createReaderProvider({SHIQU_AI_PROVIDER:provider,...(provider==='gemini'?{GEMINI_API_KEY:'controlled'}:{})},media,transport,runner);
 const options={root,dataDirectory,generation,transport,variables};let app=createApplication(options);
 async function stop(){control.hold=false;for(const call of control.calls)call.resolve();await app.close();}
 const coordinators=[];
 t?.after(async()=>{app.stopGeneration();for(const coordinator of coordinators)coordinator.stop();control.hold=false;for(const call of control.calls)call.resolve();for(const coordinator of coordinators)await coordinator.close();await stop();await rm(root,{recursive:true,force:true});});
 function request(suffix,method='GET',body,headers={}){return app.handle(new Request('http://localhost/api/reader/'+suffix,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}));}
 async function json(suffix,method='GET',body){const response=await request(suffix,method,body);assert.ok(response.ok,`${response.status}: ${suffix}`);return response.json();}
 async function create(length=8,overrides={}){const id=crypto.randomUUID();await json('sessions','POST',{requestId:id,selection:{...selection,length,...overrides}});return id;}
 const demand=(id,viewerId=crypto.randomUUID(),page=0,retry=false)=>json(`sessions/${id}/production`,'POST',{viewerId,page,retry});
 const read=id=>json(`sessions/${id}`);
 const leave=(id,viewerId)=>json(`sessions/${id}/production`,'DELETE',{viewerId});
 return {root,dataDirectory,options,control,media,generation,request,json,create,demand,read,leave,stop,coordinators,get app(){return app;},async restart(){await stop();app=createApplication(options);}};
}
