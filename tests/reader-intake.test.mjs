// Prove that initial intent, candidate receipts and confirmation gates survive real queued execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,selection} from './fixtures/production.mjs';
const batch={stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}},{title:'大葫芦',description:'惠子与庄子谈论大葫芦的用处。'}],note:''};
async function fixture(t){const f=await productionFixture(t);f.control.hold=false;f.discoveries=[];f.generation.suggestions=async(s,excluded,_local,reading)=>{f.discoveries.push({s,excluded});reading?.onProgress({completed:1,total:1,completedChars:100,totalChars:100,stage:'selecting'});return structuredClone(batch);};return f;}
async function create(f,requestId=crypto.randomUUID()) {const s=await f.json('sessions','POST',{requestId,intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}});return s.id;}
const setup=async(f,id,action,s)=>f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(s||await f.read(id)).intake.generation,...action});

test('intent is saved before discovery; restart and waiting for story choice never commission scripts/images',async t=>{
 const f=await fixture(t);let release;f.generation.suggestions=async()=>{f.discoveries.push(1);await new Promise(r=>release=r);return batch;};
 const id=await create(f),saved=await f.read(id);assert.equal(saved.selection.bookId,'zhuangzi');assert.equal(saved.selection.theme,selection.theme);
 await until(()=>release);assert.equal((await f.json('sessions')).some(s=>s.id===id),true);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 release();await until(async()=>(await f.read(id)).intake.phase==='choosing');await f.restart();
 const resumed=await f.read(id);assert.equal(resumed.intake.batches[0].stories.length,2);assert.equal(resumed.state,'idle');assert.equal(f.discoveries.length,1);assert.equal(f.control.calls.length,0);
});

test('choosing prepares saved source and count; only full production confirmation starts generation',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');const prepared=await f.read(id);
 assert.equal(prepared.selection.storyTitle,'庄周梦蝶');assert.equal(prepared.selection.artStyle,'paper-cut');assert.equal(prepared.frameRecommendation.count,7);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 assert.equal((await f.request(`sessions/${id}/source`)).status,200);
 assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count:4})).status,409);
 await f.json(`sessions/${id}/advance`,'POST',{throughPage:79});await f.app.services.production.tick();assert.equal(f.control.plans.length,0);
 const action={requestId:crypto.randomUUID(),generation:prepared.intake.generation,action:'confirm',settings:{artStyle:'watercolor',productionPrompt:'clear captions',narrativeDetail:'balanced',length:4}};
 await f.json(`sessions/${id}/setup`,'POST',action);await until(async()=>(await f.read(id)).state==='completed');assert.equal((await f.read(id)).story.pages.length,4);assert.equal(f.control.calls.length,4);
 await f.json(`sessions/${id}/setup`,'POST',action);assert.equal(f.control.calls.length,4);
});

test('creation/action replay are independent of progress; competing choices conflict atomically',async t=>{
 const f=await fixture(t),requestId=crypto.randomUUID(),id=await create(f,requestId);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 assert.equal(await create(f,requestId),id);assert.equal(f.discoveries.length,1);
 const wrong=await f.request('sessions','POST',{requestId,intake:true,selection:{...selection,theme:'另一个主题'}});assert.equal(wrong.status,409);
 const current=await f.read(id),action={requestId:crypto.randomUUID(),generation:current.intake.generation,action:'choose',batch:0,index:0};
 const [a,b]=await Promise.all([f.request(`sessions/${id}/setup`,'POST',action),f.request(`sessions/${id}/setup`,'POST',{...action,requestId:crypto.randomUUID(),index:1})]);assert.deepEqual([a.status,b.status].sort(),[200,409]);
 const accepted=a.ok?action:{...action,index:1};
 if(a.ok){await f.json(`sessions/${id}/setup`,'POST',action);assert.equal((await f.read(id)).intake.generation,current.intake.generation+1);}
 assert.equal((await f.request(`sessions/${id}/setup`,'POST',{...accepted,requestId:crypto.randomUUID()})).status,409);
});

test('obsolete failed and queued jobs do not block a new extraction generation',async t=>{
 const f=await fixture(t);let failed=false;f.generation.suggestions=async()=>{f.discoveries.push(1);if(!failed){failed=true;throw Error('controlled failed extraction');}return batch;};
 const id=await create(f);await until(async()=>(await f.read(id)).state==='failed');const old=await f.read(id);
 await setup(f,id,{action:'more'},old);await until(async()=>(await f.read(id)).intake.phase==='choosing');assert.equal(f.discoveries.length,2);assert.equal((await f.read(id)).state,'idle');
 await f.app.services.production.queue.enqueue({id:crypto.randomUUID(),sessionId:id,ownerId:'docker-local-owner',kind:'discover',pool:'text',version:'stale',dependencies:[],payload:{setupGeneration:old.intake.generation},priority:-100});
 await f.app.services.production.tick();assert.equal(f.discoveries.length,2);assert.equal((await f.read(id)).intake.phase,'choosing');
 const other=await f.create(2);await until(async()=>(await f.read(other)).state==='completed');assert.equal(f.control.plans.length,1);
});

test('failed preparation can be replaced, manual preferences survive reselect, and old receipts are fenced',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 const generator=f.generation.generator.bind(f.generation);let reject=true;
 f.generation.generator=()=>{const g=generator();return {...g,recommend:async(...args)=>{if(reject)throw Error('controlled preparation failure');return g.recommend(...args);}};};
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).state==='failed');reject=false;
 const source=(await f.json(`sessions/${id}/source`)).source;
 f.generation.generator=()=>({...generator(),prepareOriginal:async()=>source});
 await setup(f,id,{action:'choose',batch:0,index:1});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 await setup(f,id,{action:'recommend',settings:{artStyle:'watercolor',productionPrompt:'My saved custom preferences.',narrativeDetail:'brief'}});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');const current=await f.read(id);assert.equal(current.selection.artStyle,'watercolor');assert.equal(current.selection.productionPrompt,'My saved custom preferences.');assert.equal(current.selection.narrativeDetail,'brief');assert.equal(f.discoveries.length,1);
 const repo=f.app.services.production.repository,row=await repo.get(id,'docker-local-owner'),doc=JSON.parse(row.document);
 await f.app.services.database.prepare("UPDATE reader_sessions SET state='running',lock_token='late-token',document=json_set(document,'$.intake.generation',?) WHERE id=?").bind(doc.intake.generation+1,id).run();
 await assert.rejects(repo.save(row,'late-token',doc,false),/状态已更新/);await assert.rejects(repo.saveImageProgress(row,'late-token',doc),/状态已更新/);
});

test('empty batches stay selectable, cap at forty, and pause never dispatches discovery',async t=>{
 const f=await fixture(t);f.generation.suggestions=async()=>({stories:[],note:'暂无更多可确认的故事。'});const id=await create(f);
 for(let n=1;n<=40;n++){
  await until(async()=>{await f.app.services.production.tick();return (await f.read(id)).intake.phase==='choosing';});
  assert.equal((await f.read(id)).state,'idle');if(n<40)await setup(f,id,{action:'more'});
 }
 assert.equal((await f.request(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,action:'more'})).status,400);
 assert.equal(f.control.calls.length,0);assert.equal(f.control.plans.length,0);
 const other=await create(f);await f.json(`sessions/${other}/production-control`,'POST',{action:'pause'});await f.app.services.production.tick();assert.equal((await f.read(other)).generationControl,'paused');
});
