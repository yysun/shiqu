import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile,rm} from 'node:fs/promises';

const fromRoot=name=>import(pathToFileURL(resolve(name)).href);
const {exportLocalStory}=await fromRoot('server/story-export.ts');
const {referenceImageKey}=await fromRoot('lib/reader-image-assets.ts');
const {readableLandscapeImage}=await fromRoot('server/reader-image-health.ts');
const fixture=name=>import(pathToFileURL(resolve('tests/fixtures',name)).href);
const {productionFixture,until}=await fixture('production.mjs');
const {completedStory}=await fixture('production-dag-story.mjs');

async function revise(f,id,changes){
 const route='sessions/'+id+'/revisions';
 const {token}=await f.json(route),child=crypto.randomUUID();
 await f.json(route,'POST',{requestId:child,token,changes});
 return child;
}
const control=(f,id,action)=>f.json('sessions/'+id+'/production-control','POST',{action});
async function settle(f){
 for(let i=0;i<10;i++){await f.app.services.production.tick();await f.app.services.production.queue.settle();}
}
const {surfaces,enabledActions}=await fixture('reader-surfaces.mjs');
const render=await surfaces();
const labels=(session,shelf)=>enabledActions(shelf?render.shelf([session]):render.settings(session,true)).filter(label=>/重试|恢复|暂停/.test(label));
const summary=session=>({state:session.state,ready:session.ready,service:session.lifecycle.service,
 activity:session.lifecycle.activity.state,faults:session.lifecycle.faults.map(({kind,scope,targets,state})=>({kind,scope,targets,state})),
 actions:session.lifecycle.actions.map(a=>a.event).filter(a=>/retry|continue|pause|resume/.test(a))});
const landscape=({state,ready,total,failed,controlAction,retryToken})=>({state,ready,total,failed,controlAction,canRetry:!!retryToken});
async function optionalFault(f){
 const {id}=await completedStory(f,{length:4});
 f.control.hold=false;
 const make=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>{const generator=make();return {...generator,async image(...args){
  if(args[1]===2)throw Error('CONTENT_BLOCKED');
  return generator.image(...args);
 }};};
 const parentRoute='sessions/'+id+'/landscape';
 const {startToken}=await f.json(parentRoute);
 await f.json(parentRoute,'POST',{startToken});
 await until(async()=>(await f.json(parentRoute)).ready===3);
 await settle(f);
 const parent=landscape(await f.json(parentRoute)),parentView=summary(await f.read(id));
 const child=await revise(f,id,{acceptancePrompt:'核对画面动作。'});
 f.generation.generator=make;
 if((await f.read(child)).lifecycle.continuation)await control(f,child,'continue');
 await settle(f);await f.restart();await settle(f);
 const childRoute='sessions/'+child+'/landscape';
 const status=await f.json(childRoute),current=await f.read(child);
 const exported=await exportLocalStory(process.cwd(),f.app,current,{format:'zip',output:resolve(f.root,'portrait.zip'),includePrompts:true,allowUnsigned:true});
 const {createRequire}=await import('node:module');
 const {unzipSync}=createRequire(resolve('package.json'))('fflate');
 const files=unzipSync(await readFile(exported.path));
 const exportedFrames=Object.keys(files).filter(name=>name.startsWith('图片/')&&name.endsWith('.webp')).length;
 const jobs=await f.app.services.production.queue.jobs(child,'docker-local-owner');
 await control(f,child,'pause');
 await control(f,child,'resume');
 await settle(f);
 const afterResume=landscape(await f.json(childRoute));
 const fault=current.lifecycle.faults.find(x=>x.scope==='optional');
 const recovered=await f.request('sessions/'+child+'/recover','POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await settle(f);
 return {parent,parentView,exportedFrames,child:landscape(status),childView:summary(current),activeLandscapeJobs:jobs.filter(j=>['running','queued'].includes(j.state)&&JSON.parse(j.payload).work?.call==='drawLandscape').length,detailButtons:labels(current,false),afterResume,directRecoveryStatus:recovered.status,afterDirectRecovery:landscape(await f.json(childRoute))};
}
async function offlineReceipt(f){
 const id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 const media=f.app.services.media,get=media.get.bind(media);
 let hide=true;
 media.get=async key=>hide&&key.startsWith('reader/'+id+'/artifacts/1-')?null:get(key);
 f.control.hold=false;f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).state==='failed');
 hide=false;await control(f,id,'pause');
 const child=await revise(f,id,{acceptancePrompt:'核对画面动作。'});
 await control(f,child,'continue');await settle(f);
 f.options.production={autoStart:false,snapshots:{current:()=>undefined,provider:()=>null}};
 await f.restart();
 f.generation.status=async()=>({configured:false,message:'受控未配置'});
 const before=await f.read(child),shelf=(await f.json('library/shelf')).find(s=>s.id===child);
 const fault=before.lifecycle.faults[0];
 const calls=f.control.calls.length;
 const response=await f.request('sessions/'+child+'/recover','POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 const result=await response.json();
 return {detail:summary(before),shelf:summary(shelf),detailButtons:labels(before,false),shelfButtons:labels(shelf,true),status:response.status,receipt:result.recoveryReceipt?.status,after:summary(await f.read(child)),extraDraws:f.control.calls.length-calls};
}
async function paidLandscape(f){
 const {id}=await completedStory(f,{length:4}),route='sessions/'+id+'/landscape';
 f.control.hold=false;
 const media=f.app.services.media,read=media.get.bind(media);
 let missing=true,key;
 media.get=async path=>{
  if(missing&&path.startsWith('reader/'+id+'/artifacts/2-')){key=path;return null;}
  return read(path);
 };
 const {startToken}=await f.json(route);await f.json(route,'POST',{startToken});
 await until(async()=>{const status=await f.json(route);return status.ready===3&&status.failed.includes(3);});
 await settle(f);missing=false;
 const status=await f.json(route);
 const jobs=await f.app.services.production.queue.jobs(id,'docker-local-owner');
 const paid=jobs.map(j=>JSON.parse(j.payload)).find(p=>p.work?.call==='drawLandscape'&&p.page===2&&p.paid);
 const before=f.control.calls.filter(c=>c.landscape&&c.page===2).length;
 const original=key&&await read(key);
 const bytes=original&&new Uint8Array(await original.arrayBuffer());
 await f.json(route,'POST',{retryToken:status.retryToken});
 await until(async()=>(await f.json(route)).ready===4);
 return {status:landscape(status),receiptMatchesFile:!!paid&&referenceImageKey(id,paid.paid.value)===key,readable:!!bytes&&await readableLandscapeImage(bytes),originalBytes:bytes?.length,extraDraws:f.control.calls.filter(c=>c.landscape&&c.page===2).length-before,after:landscape(await f.json(route))};
}
const checks=[
 [optionalFault,result=>result.exportedFrames===4&&result.child.canRetry&&result.child.failed.includes(3)],
 [offlineReceipt,result=>result.detail.actions.includes('retry')&&result.shelf.actions.includes('retry')&&result.after.state==='completed'&&result.extraDraws===0],
 [paidLandscape,result=>result.receiptMatchesFile&&result.readable&&result.extraDraws===0&&result.after.ready===4],
];
for(const [fn,check] of checks){
 const f=await productionFixture();
 try{
  const result=await fn(f),passed=check(result);
  console.log(JSON.stringify({name:fn.name,passed,result}));
  if(!passed)process.exitCode=1;
 }
 catch(error){console.log(JSON.stringify({name:fn.name,error:String(error),stack:error.stack}));process.exitCode=1;}
 finally{await f.stop();await rm(f.root,{recursive:true,force:true});}
}
