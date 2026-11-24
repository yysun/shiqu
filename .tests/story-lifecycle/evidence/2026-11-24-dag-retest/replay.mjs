import {cp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleAt=(root,file)=>import(pathToFileURL(resolve(root,file)).href);
const current=process.cwd(),previous=resolve(process.argv[2]);
const {productionFixture,until}=await moduleAt(current,'tests/fixtures/production.mjs');
const {confirmedStory}=await moduleAt(current,'tests/fixtures/production-dag-story.mjs');
const scope=(f,id,action)=>f.json('sessions/'+id+'/production-control','POST',{action});
async function fork(f,id,changes){
 const route='sessions/'+id+'/revisions';
 const {token}=await f.json(route),child=crypto.randomUUID();
 const preview=await f.json(route+'/preview','POST',{token,changes});
 await f.json(route,'POST',{requestId:child,token,changes});
 return {child,carried:preview.carriedFaults};
}
async function settle(f){
 for(let i=0;i<10;i++){await f.app.services.production.tick();await f.app.services.production.queue.settle();}
}
const view=s=>({state:s.state,ready:s.ready,control:s.generationControl,skip:!!s.reviewSkip,
 faults:(s.lifecycle?.faults??s.faults??[]).map(f=>({stage:f.stage,kind:f.kind,retryReview:!!f.retryReview,targets:(f.targets??[]).map(t=>[t.node,t.key])})),actions:(s.lifecycle?.actions??[]).map(a=>a.event)});
async function dispose(f){await f.stop();await rm(f.root,{force:true,recursive:true});}
async function oldChild(call,changes){
 const old=await moduleAt(previous,'tests/fixtures/production.mjs'),story=await moduleAt(previous,'tests/fixtures/production-dag-story.mjs');
 process.chdir(previous);
 const f=await old.productionFixture();
 let reopened;
 try{
  f.control.hold=false;f.control.beforeText=n=>{if(n===call)throw Error('受控失败');};
  const id=await story.confirmedStory(f,4,{}, {acceptancePrompt:'第一条要求。\n第二条要求。'});
  f.app.services.production.wake();
  await until(async()=>(await f.read(id)).state==='failed',20000);
  await scope(f,id,'pause');
  const parent=view(await f.read(id)),{child,carried}=await fork(f,id,changes);
  await f.stop();
  process.chdir(current);
  reopened=await productionFixture(undefined,'codex',{}, {initialize:dir=>cp(f.dataDirectory,dir,{recursive:true})});
  reopened.control.hold=false;
  const before=view(await reopened.read(child));
  await scope(reopened,child,'continue');await settle(reopened);
  return {call,parent,carried,before,after:view(await reopened.read(child)),extraCalls:reopened.control.dagCalls.filter(n=>n===call).length};
 }finally{process.chdir(current);if(reopened)await dispose(reopened);await rm(f.root,{force:true,recursive:true});}
}
async function carriedReview(){
 const f=await productionFixture();
 try{
  f.control.hold=false;f.control.beforeText=n=>{if(n==='review')throw Error('受控审核失败');};
  const id=await confirmedStory(f);f.app.services.production.wake();
  await until(async()=>(await f.read(id)).faults?.some(x=>x.retryReview),20000);
  await scope(f,id,'pause');const parent=view(await f.read(id));
  const {child,carried}=await fork(f,id,{storySummary:'庄周醒后细想梦蝶的经历。'});
  await scope(f,child,'continue');
  f.control.beforeText=null;
  await settle(f);await scope(f,child,'pause');
  const snapshot=await f.read(child),fault=snapshot.lifecycle.faults[0];
  const response=await f.request('sessions/'+child+'/review-override','POST',{requestId:crypto.randomUUID(),faultId:fault.id,ending:'default'});
  return {parent,carried,after:view(snapshot),skipStatus:response.status,message:(await response.json()).error,storyboardFrames:snapshot.generationProgress.storyboardFrames};
 }finally{await dispose(f);}
}
async function transient(changes){
 const f=await productionFixture();
 try{
  f.control.hold=false;f.control.beforeImage=c=>{if(c.page===0)throw Error('受控首图失败');};
  const id=await confirmedStory(f);f.app.services.production.wake();
  await until(async()=>(await f.read(id)).state==='failed',20000);
  await scope(f,id,'pause');
  async function bound(storyId){
   const jobs=await f.app.services.database.prepare("SELECT payload FROM production_jobs WHERE session_id=?").bind(storyId).all();
   return jobs.results.flatMap(row=>JSON.parse(row.payload).work?.instances??[]).filter(x=>x.node==='frameImage').map(x=>({key:x.key,hard:x.hard}));
  }
  const first=await bound(id);
  const callsBefore=f.control.calls.filter(call=>call.page===0).length;
  const {child,carried}=await fork(f,id,changes);
  const before=view(await f.read(child));
  f.control.beforeImage=null;await scope(f,child,'continue');await settle(f);
  const next=await bound(child);
  return {carried,before,after:view(await f.read(child)),first,redraw:next.find(x=>x.key===first[0].key)??next[0],totalNewDrawings:next.length,extraFirstFrameDraws:f.control.calls.filter(call=>call.page===0).length-callsBefore,identical:next.some(x=>x.key===first[0].key&&JSON.stringify(x.hard)===JSON.stringify(first[0].hard))};
 }finally{await dispose(f);}
}
async function paidOutput(revise){
 const f=await productionFixture();
 try{
  const id=await f.create(2),store=f.app.services.media,original=store.get.bind(store);
  await until(()=>f.control.calls.length===1);
  let missing=true,key;
  store.get=async path=>{
   if(missing&&path.includes('/artifacts/0-')){key=path;return null;}
   return original(path);
  };
  f.control.hold=false;f.control.calls[0].resolve();
  await until(async()=>(await f.read(id)).faults?.length>0);
  const row=await f.app.services.database.prepare("SELECT payload FROM production_jobs WHERE session_id=? AND state='failed' AND kind='dag-draw'").bind(id).first();
  const paid=JSON.parse(row.payload).paid;
  missing=false;
  const readable=!!(await original(key)),before=f.control.calls.filter(c=>c.page===0).length;
  let currentId=id;
  if(revise){
   await scope(f,id,'pause');
   const {child}=await fork(f,id,{acceptancePrompt:'请核对动作。'});currentId=child;
   await scope(f,child,'continue');await settle(f);
  }
  const blocked=await f.read(currentId),fault=blocked.lifecycle.faults[0];
  await f.json('sessions/'+currentId+'/recover','POST',{requestId:crypto.randomUUID(),faultId:fault.id});
  await until(async()=>(await f.read(currentId)).state==='completed',20000);
  return {revise,receiptRecorded:!!paid?.value,readable,parentFrameDraws:before,extraFirstFrameDraws:f.control.calls.filter(c=>c.page===0).length-before,blocked:view(blocked),after:view(await f.read(currentId))};
 }finally{await dispose(f);}
}
const cases=[
 {name:'sameRevisionReceipt',run:()=>paidOutput(false),check:r=>r.receiptRecorded&&r.readable&&r.extraFirstFrameDraws===0},
 {name:'carriedReceipt',run:()=>paidOutput(true),check:r=>r.receiptRecorded&&r.readable&&r.extraFirstFrameDraws===0},
 {name:'oldVisual',run:()=>oldChild('visual',{acceptancePrompt:'另一条。'}),check:r=>r.extraCalls===0&&r.before.faults.flatMap(f=>f.targets).length===4},
 {name:'oldItems',run:()=>oldChild('registerItems',{artStyle:'watercolor'}),check:r=>r.extraCalls===0&&r.before.faults.flatMap(f=>f.targets).length===2},
 {name:'carriedReview',run:carriedReview,check:r=>r.parent.skip&&r.after.skip&&r.skipStatus===200},
 {name:'transient',run:()=>transient({narrativeDetail:'detailed'}),check:r=>!r.identical&&r.after.faults.some(f=>f.targets.some(([node])=>node==='frameImage'))},
 {name:'changedInputs',run:()=>transient({narrativeDetail:'detailed',artStyle:'watercolor'}),check:r=>!r.identical&&r.after.state==='completed'&&r.after.ready===4},
];
for(const entry of cases){
 try{
  const result=await entry.run(),passes=entry.check(result);
  console.log(JSON.stringify({name:entry.name,passes,result}));
  if(!passes)process.exitCode=1;
 }catch(error){
  console.log(JSON.stringify({name:entry.name,error:error.message}));
  process.exitCode=1;
 }
}
