// Verify reader-visible batch behavior through both local providers, file media and real SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../server/app.ts';
import {createReaderProvider} from '../server/generation.ts';
import {FileMedia} from '../server/media.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import {requestedImageEnd,runStoryGeneration} from '../lib/reader-generation.ts';

const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const encoded=Buffer.from(png).toString('base64');
const selection={bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'放下执念',length:8,voice:false,artStyle:'ink-pencil',productionPrompt:'quiet narration'};
const makePlan=length=>({title:'庄周梦蝶',hook:'梦醒之后',sourceReference:'《庄子·齐物论》庄周梦蝶',adaptationNote:'现代改编',reflection:'谁在梦中？',characters:'An adult Chinese philosopher in a plain linen robe in ancient China.',pages:Array.from({length},(_,i)=>({caption:'庄周梦见自己成为一只蝴蝶，自由自在地飞来飞去。',prompt:`An adult philosopher dreams in an ancient garden, scene ${i}.`}))});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){
 const deadline=Date.now()+3000;
 while(!await predicate()){assert.ok(Date.now()<deadline,'Timed out waiting for controlled provider work');await turn();}
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function fixture(t,provider='codex'){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu batches ')),dataDirectory=path.join(root,'data');
 await cp('drizzle',path.join(root,'drizzle'),{recursive:true});await mkdir(path.join(root,'docker'));await cp('docker/seed.sql',path.join(root,'docker/seed.sql'));
 const control={calls:[],pending:new Map(),hold:false};
 async function image(prompt,reference){
  const page=Number(prompt.match(/Scene (\d+):/)[1])-1;
  control.calls.push({page,reference,prompt});
  if(control.hold){const gate=deferred();control.pending.set(page,gate);await gate.promise;}
  return encoded;
 }
 const transport=async(url,options)=>{
  assert.match(String(url),/^https:\/\/generativelanguage.googleapis.com\//,'No live source or inference requests');
  const body=JSON.parse(options.body),parts=body.contents[0].parts;
  const output=body.generationConfig.responseModalities?
   {inlineData:{mimeType:'image/png',data:await image(parts.find(p=>p.text).text,parts.find(p=>p.inlineData)?.inlineData.data)}}:
   {text:JSON.stringify(makePlan(JSON.parse(parts[0].text).exactPageCount))};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[output]}}],responseId:'test',usageMetadata:{calls:1}});
 };
 const runner={async status(){return {configured:true};},async run(job){return {text:job.generateImage?'':JSON.stringify(makePlan(JSON.parse(job.prompt).exactPageCount)),image:job.generateImage?await image(job.prompt,job.image&&Buffer.from(job.image.bytes).toString('base64')):null,model:'controlled-codex',requestId:'test',usage:{calls:1}};}};
 const media=new FileMedia(path.join(dataDirectory,'media'));
 const generation=createReaderProvider({SHIQU_AI_PROVIDER:provider,...(provider==='gemini'?{GEMINI_API_KEY:'test-only'}:{})},media,transport,runner);
 const options={root,dataDirectory,generation,transport};let app=createApplication(options);
 t.after(async()=>{app.close();await rm(root,{recursive:true,force:true});});
 function request(suffix,method='GET',body){return app.handle(new Request('http://localhost/api/reader/'+suffix,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));}
 async function json(suffix,method='GET',body){const response=await request(suffix,method,body);assert.ok(response.ok,`${response.status}: ${suffix}`);return response.json();}
 async function create(length=8){const id=crypto.randomUUID();await json('sessions','POST',{requestId:id,selection:{...selection,length}});return id;}
 const read=id=>json('sessions/'+id);
 const advance=(id,end,retry=false)=>json(`sessions/${id}/advance`,'POST',{throughPage:end,retry});
 function generate(id,page,length=8,overrides={}){return runStoryGeneration({sessionId:id,throughPage:requestedImageEnd(page,length),retries:new Map(),isActive:()=>true,onSession:()=>{},request:(pathname,method,body)=>json(pathname.replace(/^reader\//,''),method,body),...overrides});}
 return {control,request,json,create,read,advance,generate,generation,get app(){return app;},restart(){app.close();app=createApplication(options);}};
}

for(const provider of ['gemini','codex']){
 test(`${provider}: reading batches cover 8/10/12 pages, reuse saved pages and survive restart`,async t=>{
  const f=await fixture(t,provider);
  for(const length of [8,10,12]){
   const id=await f.create(length),start=f.control.calls.length;
   assert.equal(await f.generate(id,0,length),'');assert.equal((await f.read(id)).ready,3);
   assert.deepEqual(f.control.calls.slice(start).map(c=>c.page).sort((a,b)=>a-b),[0,1,2]);
   assert.equal(f.control.calls[start].reference,undefined);
   for(const call of f.control.calls.slice(start+1)){assert.equal(call.reference,encoded);assert.match(call.prompt,/quiet narration/);assert.match(call.prompt,/Art direction/);}
   for(const page of [0,1,2])assert.equal(await f.generate(id,page,length),'');
   assert.equal(f.control.calls.length-start,3);
   f.restart();assert.equal((await f.read(id)).ready,3);
   for(let page=3;page<length;page+=3){assert.equal(await f.generate(id,page,length),'');assert.equal((await f.read(id)).ready,Math.min(page+3,length));}
   assert.equal((await f.read(id)).state,'completed');
   assert.deepEqual(f.control.calls.slice(start).map(c=>c.page).sort((a,b)=>a-b),Array.from({length},(_,i)=>i));
   assert.equal((await f.json('status')).provider,provider);
  }
 });
 test(`${provider}: anchor runs alone; later scenes overlap and publish under one lock`,async t=>{
  const f=await fixture(t,provider),id=await f.create();f.control.hold=true;
  await f.advance(id,2); // Plan and original, without images.
  const anchor=f.advance(id,2);await until(()=>f.control.calls.length===1);
  assert.equal(f.control.calls[0].page,0);await turn();assert.equal(f.control.calls.length,1);
  f.control.pending.get(0).resolve();assert.equal((await anchor).ready,1);
  const batch=f.advance(id,3);await until(()=>f.control.calls.length===4);
  assert.deepEqual(f.control.calls.slice(1).map(c=>c.page).sort(),[1,2,3]);
  assert.ok(f.control.calls.slice(1).every(c=>c.reference===encoded));
  assert.equal((await f.request(`sessions/${id}/advance`,'POST',{throughPage:7})).status,202);
  assert.equal(f.control.calls.length,4);
  for(const page of [3,2]){
   f.control.pending.get(page).resolve();await until(async()=>(await f.read(id)).story.pages[page].image);
   const current=await f.read(id);assert.equal(current.state,'running');assert.equal(current.story.pages[1].image,'');
   const stored=await f.app.services.database.prepare('SELECT * FROM reader_sessions WHERE id=?').bind(id).first();
   assert.ok(stored.lock_token);assert.equal(JSON.parse(stored.document).usage.filter(u=>u.step===`image:${page}`).length,1);
  }
  f.control.pending.get(1).resolve();assert.equal((await batch).ready,4);assert.equal((await f.read(id)).state,'idle');
 });
 test(`${provider}: a failed scene keeps other results, settles every call and retries only missing work`,async t=>{
  const f=await fixture(t,provider),id=await f.create();await f.generate(id,0);
  f.control.hold=true;const batch=f.advance(id,5);await until(()=>f.control.calls.length===6);
  f.control.pending.get(4).reject(Error('controlled failure'));f.control.pending.get(5).resolve();
  await until(async()=>(await f.read(id)).ready===4);assert.equal((await f.read(id)).state,'running');
  f.control.pending.get(3).resolve();const result=await batch;assert.equal(result.state,'failed');assert.equal(result.ready,5);
  f.restart();assert.equal((await f.read(id)).ready,5);f.control.hold=false;
  assert.equal((await f.advance(id,5,true)).ready,6);assert.equal(f.control.calls.at(-1).page,4);assert.equal(f.control.calls.length,7);
 });
}

test('deletion keeps paid results on disk without exposing or resuming the deleted story',async t=>{
 const f=await fixture(t),id=await f.create();await f.generate(id,0);f.control.hold=true;
 const batch=f.request(`sessions/${id}/advance`,'POST',{throughPage:5});await until(()=>f.control.calls.length===6);
 assert.equal((await f.request('library/'+id,'DELETE')).status,200);
 for(const gate of f.control.pending.values())gate.resolve();assert.equal((await batch).status,404);
 const stored=await f.app.services.database.prepare('SELECT * FROM reader_sessions WHERE id=?').bind(id).first();
 assert.equal(JSON.parse(stored.document).images.filter(Boolean).length,6);assert.equal(stored.lock_token,null);
 f.restart();assert.equal((await f.request('sessions/'+id)).status,404);
 assert.equal((await f.request(`sessions/${id}/advance`,'POST',{throughPage:7})).status,404);assert.equal(f.control.calls.length,6);
});

test('leaving during a batch finishes its paid results without starting another batch',async t=>{
 const f=await fixture(t),id=await f.create();await f.generate(id,0);f.control.hold=true;let active=true;
 const generating=f.generate(id,6,8,{isActive:()=>active});await until(()=>f.control.calls.length===6);
 active=false;for(const gate of f.control.pending.values())gate.resolve();assert.equal(await generating,'');
 assert.equal((await f.read(id)).ready,6);assert.equal(f.control.calls.length,6);
});

test('failed checkpoint writes stop the queue and final recovery retains every settled result',async t=>{
 const f=await fixture(t),id=await f.create();await f.generate(id,0);
 const repo=new ReaderRepository(f.app.services.database);let attempts=0;
 repo.saveImageProgress=async()=>{attempts++;throw Error('controlled disk failure');};
 const result=await advanceStory(repo,f.generation.generator(),'docker-local-owner',id,5);
 assert.equal(result.state,'failed');assert.equal(result.ready,6);assert.equal(attempts,1);
 f.restart();assert.equal((await f.read(id)).ready,6);
 const stored=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();
 assert.equal(JSON.parse(stored.document).usage.filter(u=>u.step.startsWith('image:')).length,6);
});

test('a lost lock rejects stale progress without overwriting the current session',async t=>{
 const f=await fixture(t),id=await f.create();await f.generate(id,0);
 const repo=new ReaderRepository(f.app.services.database),row=await repo.get(id,'docker-local-owner');
 const token=await repo.acquire(row,{kind:'image',key:'image:3',page:3});
 await f.app.services.database.prepare("UPDATE reader_sessions SET lock_token='new-owner' WHERE id=?").bind(id).run();
 const doc=JSON.parse(row.document);doc.images[3]='/must-not-save.png';
 await assert.rejects(repo.saveImageProgress(row,token,doc),error=>error.status===409);
 assert.equal((await f.read(id)).story.pages[3].image,'');
});

test('out-of-order progress renews inactivity while an unchanged stage still times out',async()=>{
 let elapsed=0,updates=0;
 const session={id:'progress',state:'running',selection:{length:8,voice:false},stage:'drawing page 2',ready:1,story:{pages:Array.from({length:8},(_,i)=>({image:i===0?'saved':'',audio:''}))}};
 const options={sessionId:session.id,throughPage:5,retries:new Map(),isActive:()=>true,onSession:()=>{},now:()=>elapsed,sleep:async()=>{elapsed+=200000;},request:async(_path,method)=>{
  if(method){updates++;if(updates<=3){session.ready++;session.story.pages[updates+1].image='saved';}else{session.state='idle';for(let i=0;i<6;i++)session.story.pages[i].image='saved';}}
  return structuredClone(session);
 }};
 assert.equal(await runStoryGeneration(options),'');assert.ok(elapsed>360000);assert.equal(updates,4);
 session.state='running';session.ready=1;session.story.pages[1].image='';updates=0;
 assert.match(await runStoryGeneration({...options,request:async()=>structuredClone(session)}),/等待较久/);
});
