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
import {selectionSchema} from '../lib/reader-model.ts';

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
 const control={calls:[],plans:[],pending:new Map(),hold:false,autoLength:30,overridePlanLength:null,recommendations:[],recommendation:{count:7,reason:'保留完整因果与关键转折，节奏适合这篇短寓言。'}};
 function planned(payload,schema,instructions,budget){if(schema.properties.count){control.recommendations.push({payload,schema,instructions,budget});return control.recommendation;}control.plans.push({payload,schema,instructions,budget});return makePlan(control.overridePlanLength??(payload.exactPageCount==='auto'?control.autoLength:payload.exactPageCount));}
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
   {text:JSON.stringify(planned(JSON.parse(parts[0].text),body.generationConfig.responseFormat.text.schema,body.systemInstruction.parts[0].text,body.generationConfig.maxOutputTokens))};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[output]}}],responseId:'test',usageMetadata:{calls:1}});
 };
 const runner={async status(){return {configured:true};},async run(job){return {text:job.generateImage?'':JSON.stringify(planned(JSON.parse(job.prompt),job.schema,job.instructions)),image:job.generateImage?await image(job.prompt,job.image&&Buffer.from(job.image.bytes).toString('base64')):null,model:'controlled-codex',requestId:'test',usage:{calls:1}};}};
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

test('new count defaults to auto and reader REST rejects invalid manual counts',async t=>{
 const f=await fixture(t);
 assert.equal(selectionSchema.parse({bookId:'zhuangzi',theme:'放下执念'}).length,'auto');
 for(const length of [0,61,1.5,null,'30'])assert.equal((await f.request('sessions','POST',{requestId:crypto.randomUUID(),selection:{...selection,length}})).status,400);
 for(const length of [8,10,12])assert.equal((await f.read(await f.create(length))).selection.length,length);
});

for(const provider of ['gemini','codex']){
 test(`${provider}: auto resolves to durable plan count, including a single frame`,async t=>{
  const f=await fixture(t,provider);
  for(const length of [1,30]){
   f.control.autoLength=length;
   const id=await f.create('auto'),plans=f.control.plans.length;
   assert.equal(await f.generate(id,0,'auto'),'');
   const current=await f.read(id),job=f.control.plans.at(-1);
   assert.equal(current.selection.length,'auto');assert.equal(current.story.pages.length,length);
   assert.equal(job.payload.exactPageCount,'auto');assert.equal(job.schema.properties.pages.minItems,1);assert.equal(job.schema.properties.pages.maxItems,60);
   assert.match(job.instructions,/auto时/);assert.doesNotMatch(job.instructions,/30至60幅/);
   if(provider==='gemini')assert.ok(job.budget>=48000);
   f.restart();
   assert.equal(await f.generate(id,length-1,'auto'),'');
   assert.equal(f.control.plans.length,plans+1);assert.equal((await f.read(id)).ready,length);
   assert.equal((await f.read(id)).state,'completed');
  }
 });
 test(`${provider}: exact lengths reject mismatched model output before images`,async t=>{
  const f=await fixture(t,provider);
  f.control.overridePlanLength=8;
  await assert.rejects(f.generation.generator().plan(selectionSchema.parse({...selection,length:30}),'mismatch'));
  const id=await f.create(60),failed=await f.advance(id,2);
  assert.equal(failed.state,'failed');assert.equal(failed.story,null);assert.equal(f.control.calls.length,0);
  assert.equal(f.control.plans.at(-1).schema.properties.pages.minItems,60);assert.equal(f.control.plans.at(-1).schema.properties.pages.maxItems,60);
  f.control.overridePlanLength=null;
  assert.equal((await f.advance(id,2,true)).story.pages.length,60);
 });
 test(`${provider}: frame 60 supports media, events, saved progress and restart`,async t=>{
  const f=await fixture(t,provider),id=await f.create(60);
  await f.generate(id,0,60);await f.generate(id,59,60);
  assert.equal((await f.request(`media/${id}/59.png`)).status,200);
  assert.equal((await f.json(`sessions/${id}/progress`,'POST',{page:59,saved:true})).page,59);
  const event={id:crypto.randomUUID(),visitor:crypto.randomUUID(),session:crypto.randomUUID(),storyId:id,kind:'page',page:59,mode:'manual',cohort:'internal'};
  assert.equal((await f.request(`sessions/${id}/events`,'POST',event)).status,200);
  for(const suffix of ['progress','advance','events']){
   const body=suffix==='progress'?{page:60,saved:true}:suffix==='advance'?{throughPage:60}:{...event,id:crypto.randomUUID(),page:60};
   assert.equal((await f.request(`sessions/${id}/${suffix}`,'POST',body)).status,400);
  }
  for(const file of ['60.png','059.png','59.svg','-1.png','1.png/extra'])assert.equal((await f.request(`media/${id}/${file}`)).status,404);
  const short=await f.create(1);await f.generate(short,0,1);
  assert.equal((await f.request(`media/${short}/59.png`)).status,404);
  assert.equal((await f.request(`sessions/${short}/progress`,'POST',{page:59,saved:true})).status,400);
  assert.equal((await f.request(`sessions/${short}/events`,'POST',{...event,id:crypto.randomUUID(),storyId:short})).status,400);
  const plans=f.control.plans.length,calls=f.control.calls.length;
  f.restart();const restored=await f.read(id);
  assert.equal(restored.page,59);assert.equal(restored.saved,true);assert.equal(restored.story.pages.length,60);
  await f.generate(id,59,60);assert.equal(f.control.calls.length,calls);assert.equal(f.control.plans.length,plans);
 });
 test(`${provider}: reading batches cover 1/8/10/12/30/60 pages, reuse saved pages and survive restart`,async t=>{
  const f=await fixture(t,provider);
  for(const length of [1,8,10,12,30,60]){
   const id=await f.create(length),start=f.control.calls.length;
   assert.equal(await f.generate(id,0,length),'');assert.equal((await f.read(id)).ready,Math.min(3,length));
   assert.deepEqual(f.control.calls.slice(start).map(c=>c.page).sort((a,b)=>a-b),Array.from({length:Math.min(3,length)},(_,i)=>i));
   assert.equal(f.control.calls[start].reference,undefined);
   for(const call of f.control.calls.slice(start+1)){assert.equal(call.reference,encoded);assert.match(call.prompt,/quiet narration/);assert.match(call.prompt,/Art direction/);}
   for(const page of [0,1,2])assert.equal(await f.generate(id,page,length),'');
   assert.equal(f.control.calls.length-start,Math.min(3,length));
   f.restart();assert.equal((await f.read(id)).ready,Math.min(3,length));
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


for(const provider of ['gemini','codex']){
 test(`${provider}: detail recommends from a saved original and waits for durable exact-count confirmation`,async t=>{
  const f=await fixture(t,provider);
  for(const [index,narrativeDetail] of ['brief','balanced','detailed'].entries()){
   const id=crypto.randomUUID(),recs=f.control.recommendations.length,plans=f.control.plans.length,images=f.control.calls.length;
   await f.json('sessions','POST',{requestId:id,selection:{...selection,length:'auto',narrativeDetail}});
   assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count:1})).status,409);
   await f.generate(id,0,'auto');
   let current=await f.read(id);assert.equal(current.state,'idle');assert.equal(current.awaitingFrameCount,true);assert.equal(current.retryAllowed,false);assert.equal(current.story,null);assert.equal(current.ready,0);
   assert.deepEqual(current.frameRecommendation,f.control.recommendation);assert.equal(f.control.plans.length,plans);assert.equal(f.control.calls.length,images);
   const rec=f.control.recommendations.at(-1);assert.equal(rec.payload.narrativeDetail,narrativeDetail);assert.match(rec.payload.verifiedOriginal.text,/昔者庄周/);assert.equal(rec.schema.properties.count.minimum,1);assert.equal(rec.schema.properties.count.maximum,60);assert.doesNotMatch(rec.instructions,/30至60|30–60/);
   await f.advance(id,59);f.restart();await f.generate(id,0,'auto');assert.equal(f.control.recommendations.length,recs+1);
   const count=index===1?60:1;
   const confirmations=await Promise.all([f.request(`sessions/${id}/frame-count`,'POST',{count}),f.request(`sessions/${id}/frame-count`,'POST',{count})]);assert.ok(confirmations.every(r=>r.status===200));
   assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count:count===1?60:1})).status,409);
   current=await f.read(id);assert.equal(current.awaitingFrameCount,false);assert.equal(current.selection.length,count);
   f.restart();await f.generate(id,0,count);
   const job=f.control.plans.at(-1);assert.equal(job.payload.narrativeDetail,narrativeDetail);assert.equal(job.payload.exactPageCount,count);assert.deepEqual(job.payload.verifiedOriginal,rec.payload.verifiedOriginal);assert.equal(job.schema.properties.pages.minItems,count);assert.equal((await f.read(id)).story.pages.length,count);
   assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count})).status,200);assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count:2})).status,409);
   assert.equal(f.control.recommendations.length,recs+1);assert.equal(f.control.plans.length,plans+1);
  }
 });
 test(`${provider}: invalid recommendations retain original for retry and never plan or draw`,async t=>{
  const f=await fixture(t,provider);
  for(const bad of [{count:0,reason:'无效数量'},{count:61,reason:'无效数量'},{count:1.5,reason:'无效数量'},{count:'7',reason:'无效数量'},{count:7,reason:'   '}]){
   f.control.recommendation=bad;const id=crypto.randomUUID();await f.json('sessions','POST',{requestId:id,selection:{...selection,narrativeDetail:'balanced'}});
   const failed=await f.advance(id,2);assert.equal(failed.state,'failed');assert.equal(failed.awaitingFrameCount,false);assert.equal(failed.frameRecommendation,null);
   const row=await new ReaderRepository(f.app.services.database).get(id,f.app.services.ownerId);assert.ok(JSON.parse(row.document).original.text);
   assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
  }
  f.control.recommendation={count:1,reason:'短寓言保留一个关键瞬间。'};
  const id=(await f.json('sessions'))[0].id;assert.equal((await f.advance(id,2,true)).awaitingFrameCount,true);
 });
}

test('frame-count confirmation is owner-scoped, validates input, blocks running work and concurrent conflicts',async t=>{
 const f=await fixture(t),id=crypto.randomUUID();
 await f.json('sessions','POST',{requestId:id,selection:{...selection,narrativeDetail:'balanced'}});await f.advance(id,0);
 for(const count of [0,61,1.5,'7',null])assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count})).status,400);
 const repo=new ReaderRepository(f.app.services.database);await assert.rejects(repo.confirmFrameCount(id,'another-owner',7),e=>e.status===404);
 const row=await repo.get(id,f.app.services.ownerId),token=await repo.acquire(row,{kind:'plan',page:0,key:'plan'});
 assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count:7})).status,409);await repo.save(row,token,JSON.parse(row.document),false);
 const results=await Promise.all([f.request(`sessions/${id}/frame-count`,'POST',{count:1}),f.request(`sessions/${id}/frame-count`,'POST',{count:60})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const current=await f.read(id);assert.ok([1,60].includes(current.selection.length));assert.equal(f.control.plans.length,0);
});

test('unverifiable URL originals fail before any recommendation or plan request',async t=>{
 const f=await fixture(t,'gemini'),id=crypto.randomUUID();
 await f.json('sessions','POST',{requestId:id,selection:{...selection,bookId:'other',customBook:'https://example.com/story',storyTitle:'未知故事',narrativeDetail:'balanced'}});
 const failed=await f.advance(id,0);assert.equal(failed.state,'failed');assert.match(failed.error,/原文未能核对/);assert.equal(f.control.recommendations.length,0);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('lost recommendation responses and concurrent advances reuse the saved suggestion without planning',async t=>{
 const f=await fixture(t),id=crypto.randomUUID();await f.json('sessions','POST',{requestId:id,selection:{...selection,length:'auto',narrativeDetail:'balanced'}});
 let lost=false;assert.equal(await f.generate(id,0,'auto',{request:async(pathname,method,body)=>{
  const result=await f.json(pathname.replace(/^reader\//,''),method,body);
  if(!lost&&method==='POST'&&result.awaitingFrameCount){lost=true;throw Error('lost recommendation response');}return result;
 }}),'');assert.equal(lost,true);assert.equal(f.control.recommendations.length,1);
 await Promise.all([f.advance(id,59),f.advance(id,59)]);assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});
