// Exercise minimal redo and version isolation through real REST, SQLite, copied files and controlled inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,makePlan,selection} from './fixtures/production.mjs';
import {revisionImpact,reusableRevisionImages} from '../lib/reader-revision.ts';
import {forkRevision} from '../server/reader-revisions.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
const owner='docker-local-owner';
async function completed(t,provider='codex'){
 const f=await productionFixture(t,provider);f.control.hold=false;const id=await f.create();await until(async()=>(await f.read(id)).state==='completed');return {f,id};
}
const snapshot=(f,id)=>f.json(`sessions/${id}/revisions`);
async function revise(f,id,changes,base,requestId=crypto.randomUUID()){
 base??=await snapshot(f,id);return f.json(`sessions/${id}/revisions`,'POST',{requestId,token:base.token,changes});
}

test('image dependencies exclude narration, include scene/anchor/global inputs, and reject ambiguous edit scopes',()=>{
 const plan=makePlan(4),base={selection,plan,images:['a','b','c','d']};
 assert.equal(revisionImpact(base,{}).changed,false);
 const caption=structuredClone(plan);caption.pages[2].caption='庄周醒来，发现自己仍然躺在床上。';
 assert.deepEqual(reusableRevisionImages(base,selection,caption),base.images);
 assert.equal(revisionImpact(base,{plan:caption,productionPrompt:undefined,length:undefined}).replan,false);
 const middle=structuredClone(plan);middle.pages[2].prompt+=' Visible changed action.';
 assert.deepEqual(reusableRevisionImages(base,selection,middle),['a','b','','d']);
 const first=structuredClone(plan);first.pages[0].prompt+=' A changed anchor.';
 assert.deepEqual(reusableRevisionImages(base,selection,first),['','','','']);
 assert.equal(revisionImpact(base,{artStyle:'paper-cut'}).redraw,4);
 assert.equal(revisionImpact(base,{length:3}).reusePending,true);
 assert.equal(revisionImpact(base,{productionPrompt:'new',plan:caption}).conflict,true);
});

for(const provider of ['codex','gemini'])test(`${provider}: caption-only revision reuses every copied image, original and deleted-parent independence`,async t=>{
 const {f,id}=await completed(t,provider),old=await f.read(id),base=await snapshot(f,id),plan=structuredClone(base.plan);
 plan.pages[3].caption='庄周醒来，看着窗外，仍记得梦中自在飞翔的感觉。';
 const before=f.control.calls.length,plans=f.control.plans.length,reviews=f.control.reviews.length;
 const child=await revise(f,id,{plan},base);assert.equal(child.revision.rootId,id);assert.equal(child.revision.number,2);
 await until(async()=>(await f.read(child.id)).state==='completed');const saved=await f.read(child.id);
 assert.equal(f.control.calls.length,before);assert.equal(f.control.plans.length,plans);assert.equal(f.control.reviews.length,reviews+1);
 assert.equal((await f.read(id)).story.pages[3].caption,old.story.pages[3].caption);
 for(let page=0;page<8;page++){
  const a=new Uint8Array(await(await f.request(old.story.pages[page].image.replace('/api/reader/',''))).arrayBuffer());
  const b=new Uint8Array(await(await f.request(saved.story.pages[page].image.replace('/api/reader/',''))).arrayBuffer());assert.deepEqual(a,b);
  assert.match(saved.story.pages[page].image,new RegExp(child.id));
 }
 await f.json(`library/${id}`,'DELETE');assert.equal((await f.request(saved.story.pages[0].image.replace('/api/reader/',''))).status,200);
 await f.restart();assert.equal((await f.read(child.id)).state,'completed');
});

test('one scene change redraws only that image, with copied anchor; first scene change redraws all',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),plan=structuredClone(base.plan);plan.pages[4].prompt+=' A hand reaches toward a clearly visible butterfly.';
 const before=f.control.calls.length;const child=await revise(f,id,{plan},base);await until(async()=>(await f.read(child.id)).state==='completed');
 assert.deepEqual(f.control.calls.slice(before).map(c=>c.page),[4]);assert.ok(f.control.calls.at(-1).reference);
 const first=structuredClone((await snapshot(f,child.id)).plan);first.pages[0].prompt+=' A new first scene.';
 const start=f.control.calls.length,next=await revise(f,child.id,{plan:first});await until(async()=>(await f.read(next.id)).state==='completed');
 assert.equal(f.control.calls.length-start,8);assert.equal(next.revision.number,3);
});

test('late parent image writes remain isolated and handoff pauses additional old dispatch',async t=>{
 const f=await productionFixture(t),id=await f.create();await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 const base=await snapshot(f,id),plan=structuredClone(base.plan);plan.pages[5].caption='庄周想起梦中的蝴蝶，又望向窗外的花园。';
 const child=await revise(f,id,{plan},base);assert.equal((await f.read(id)).generationControl,'paused');
 for(const call of f.control.calls)call.resolve();f.control.hold=false;
 await until(async()=>(await f.read(child.id)).state==='completed');assert.equal((await f.read(id)).ready,4);
 const old=await f.read(id),saved=await f.read(child.id);assert.notEqual(old.story.pages[1].image,saved.story.pages[1].image);
});

test('family epoch serializes concurrent drafts; identical request replay is stable, changed replay is rejected',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),plan=structuredClone(base.plan);plan.reflection='梦醒时，仍能记得自在的感觉。';
 const payload={requestId:crypto.randomUUID(),token:base.token,changes:{plan}};
 const [a,b]=await Promise.all([f.request(`sessions/${id}/revisions`,'POST',payload),f.request(`sessions/${id}/revisions`,'POST',{...payload,requestId:crypto.randomUUID()})]);
 assert.deepEqual([a.status,b.status].sort(),[201,409]);const winner=a.ok?await a.json():await b.json();
 const rows=await f.app.services.database.prepare("SELECT id FROM reader_sessions WHERE json_extract(document,'$.revision.rootId')=?").bind(id).all();assert.equal(rows.results.length,1);
 // Whichever ID won is replayable, even after its review has completed.
 await until(async()=>(await f.read(winner.id)).state==='completed');
 const replay=await revise(f,id,{plan},base,winner.id);assert.equal(replay.id,winner.id);
 const changed=await f.request(`sessions/${id}/revisions`,'POST',{requestId:winner.id,token:base.token,changes:{artStyle:'paper-cut'}});assert.equal(changed.status,409);
 const fresh=await snapshot(f,id);assert.notEqual(fresh.token,base.token);const third=await revise(f,id,{artStyle:'paper-cut'},fresh);assert.equal(third.revision.number,3);
});

test('invalid inputs, unchanged drafts, stale parent, and cross-owner IDs never create a child or write copied media',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),before=f.control.calls.length;
 const send=changes=>f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes});
 assert.equal((await send({})).status,400);assert.equal((await send({length:81})).status,400);
 const plan=structuredClone(base.plan);plan.pages[0].caption='短';assert.equal((await send({plan})).status,400);
 plan.pages[0].caption='庄周梦见自己变成蝴蝶，在花间自在飞翔。';assert.equal((await send({length:4,plan})).status,400);assert.equal((await send({productionPrompt:'new requirements',plan})).status,400);
 const meta=structuredClone(base.plan);meta.sourceReference='an invented source';assert.equal((await send({plan:meta})).status,400);
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.plan.reflection',?) WHERE id=?").bind('新的余味。',id).run();
 assert.equal((await send({artStyle:'paper-cut'})).status,409);
 const foreign=await f.createLegacyReader();await f.app.services.database.prepare('UPDATE reader_sessions SET user_id=? WHERE id=?').bind('another-owner',foreign).run();
 assert.equal((await f.request(`sessions/${foreign}/revisions`)).status,404);
 let writes=0;const put=f.app.services.media.put.bind(f.app.services.media);f.app.services.media.put=async(...args)=>{writes++;return put(...args);};
 const fresh=await snapshot(f,id);const occupied=await f.request(`sessions/${id}/revisions`,'POST',{requestId:foreign,token:fresh.token,changes:{plan:base.plan}});assert.equal(occupied.status,409);assert.equal(writes,0);assert.equal(f.control.calls.length,before);
});

for(const kind of ['missing','corrupt','transient'])test(`reusable ${kind} asset stops the submission before publication or paid fallback`,async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),plan=structuredClone(base.plan);plan.reflection='梦醒后，自在的感觉仍然留在心里。';
 const get=f.app.services.media.get.bind(f.app.services.media),bad=base.images[3].replace('/api/reader/media/','reader/');
 f.app.services.media.get=async key=>{if(key!==bad)return get(key);if(kind==='missing')return null;if(kind==='transient')throw Error('controlled read error');return {contentType:'image/png',async arrayBuffer(){return new ArrayBuffer(4);}};};
 const before=f.control.calls.length,res=await f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan}});assert.equal(res.ok,false);
 const rows=await f.app.services.database.prepare("SELECT id FROM reader_sessions WHERE json_extract(document,'$.revision.parentId')=?").bind(id).all();assert.equal(rows.results.length,0);assert.equal(f.control.calls.length,before);
 if(kind==='missing'){const style=await revise(f,id,{artStyle:'paper-cut'},base);await until(async()=>(await f.read(style.id)).state==='completed');assert.equal(f.control.calls.length-before,8);}
});

test('style changes preserve planning; requirements replan; count changes reuse exact scenes after planning',async t=>{
 const {f,id}=await completed(t);let before=f.control.calls.length,plans=f.control.plans.length;
 const style=await revise(f,id,{artStyle:'paper-cut'});await until(async()=>(await f.read(style.id)).state==='completed');assert.equal(f.control.plans.length,plans);assert.equal(f.control.calls.length-before,8);
 before=f.control.calls.length;plans=f.control.plans.length;const count=await revise(f,style.id,{length:5});await until(async()=>(await f.read(count.id)).state==='completed');
 assert.equal((await f.read(count.id)).story.pages.length,5);assert.equal(f.control.plans.length,plans+1);assert.equal(f.control.calls.length,before);
 before=f.control.calls.length;plans=f.control.plans.length;const requirements=await revise(f,count.id,{productionPrompt:'Keep actions clear and captions natural.'});await until(async()=>(await f.read(requirements.id)).state==='completed');assert.equal(f.control.plans.length,plans+1);assert.equal(f.control.calls.length-before,5);
});

test('review repair invalidates newly changed staging but preserves caption-only repair images',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),plan=structuredClone(base.plan);plan.pages[2].caption='庄周醒来，凝望花间飞舞的蝴蝶，想起梦中。';
 let reviews=0;f.control.beforeText=async kind=>kind==='review'&&reviews++===0?{issues:[{page:5,category:'action',problem:'动作需要更清楚。',instruction:'改成明确的动作。'}]}:undefined;
 const before=f.control.calls.length,next=await revise(f,id,{plan},base);await until(async()=>(await f.read(next.id)).state==='completed');assert.deepEqual(f.control.calls.slice(before).map(c=>c.page),[4]);
 const snap=await snapshot(f,next.id),narration=structuredClone(snap.plan);narration.reflection='醒来后，仍可以记住梦中的自在。';reviews=0;
 f.control.beforeText=async(kind,payload)=>kind==='review'&&reviews++===0?{issues:[{page:3,category:'caption',problem:'配文不顺。',instruction:'只改配文。'}]}:kind==='repair'?{pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1],caption:'庄周醒来，仍记得自己在梦中变成蝴蝶。'}))}:undefined;
 const start=f.control.calls.length,caption=await revise(f,next.id,{plan:narration},snap);await until(async()=>(await f.read(caption.id)).state==='completed');assert.equal(f.control.calls.length,start);
});

test('paused child handoff survives restart and deleted parent; lost activation response replays without duplicate copy or generation',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),requestId=crypto.randomUUID(),changes={artStyle:'paper-cut'};
 const repo=new ReaderRepository(f.app.services.database),row=await forkRevision(repo,f.media,owner,id,requestId,base.token,changes);
 assert.equal(row.generation_control,'paused');await f.app.services.production.tick();assert.equal(f.control.calls.length,8);
 await f.json(`library/${id}`,'DELETE');await f.restart();assert.equal((await f.read(requestId)).generationControl,'paused');
 const replay=await revise(f,id,changes,base,requestId);await until(async()=>(await f.read(replay.id)).state==='completed');assert.equal(f.control.calls.length,16);
 const again=await revise(f,id,changes,base,requestId);assert.equal(again.id,requestId);assert.equal(f.control.calls.length,16);
});

test('crash between parent pause and child activation leaves a recoverable paused child',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),changes={artStyle:'paper-cut'},requestId=crypto.randomUUID(),database=f.app.services.database;
 const prepare=database.prepare.bind(database);let injected=false;
 database.prepare=query=>{const statement=prepare(query);if(query.includes('document=json_remove(document')&&!injected){statement.run=async()=>{injected=true;throw Object.assign(Error('controlled crash'),{code:'ERR_SQLITE_ERROR'});};}return statement;};
 const failed=await f.request(`sessions/${id}/revisions`,'POST',{requestId,token:base.token,changes});assert.equal(failed.status,500);assert.equal(injected,true);assert.equal((await f.read(requestId)).generationControl,'paused');assert.equal(f.control.calls.length,8);
 database.prepare=prepare;const child=await revise(f,id,changes,base,requestId);await until(async()=>(await f.read(child.id)).state==='completed');assert.equal(f.control.calls.length,16);
});

test('new queue: copied anchor loss warns without paying, explicit retry redraws only anchor and edited scene',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),plan=structuredClone(base.plan);plan.pages[2].prompt+=' A visible new hand gesture.';
 const requestId=crypto.randomUUID(),store=f.app.services.media,put=store.put.bind(store);let removed=false;
 store.put=async(key,...args)=>{const result=await put(key,...args);if(!removed&&key.startsWith(`reader/${requestId}/artifacts/0-`)){removed=true;const {rm}=await import('node:fs/promises');await rm(`${f.dataDirectory}/media/${key}`);}return result;};
 const before=f.control.calls.length,original=(await f.read(id)).story;
 const child=await revise(f,id,{plan},base,requestId);await until(async()=>(await f.read(child.id)).state==='failed');
 assert.equal(removed,true);assert.equal((await f.read(child.id)).retryStage,'redraw');assert.equal(f.control.calls.length,before);
 await f.app.services.production.tick();assert.equal(f.control.calls.length,before);
 await f.demand(child.id,crypto.randomUUID(),0,true);await until(async()=>(await f.read(child.id)).state==='completed');
 assert.deepEqual(f.control.calls.slice(before).map(c=>c.page),[0,2]);assert.deepEqual((await f.read(id)).story,original);
 const doc=JSON.parse((await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(child.id).first()).document);
 assert.notEqual(doc.images[0],doc.revision.base.images[0]);
});

test('new queue: lost revision publication only redraws its own edited page after retry',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),plan=structuredClone(base.plan);plan.pages[4].prompt+=' A visible new pose.';
 const requestId=crypto.randomUUID(),store=f.app.services.media,get=store.get.bind(store);let lost=true;
 store.get=async key=>lost&&key.startsWith(`reader/${requestId}/artifacts/4-`)?null:get(key);
 const before=f.control.calls.length,child=await revise(f,id,{plan},base,requestId);await until(async()=>(await f.read(child.id)).state==='failed');assert.equal((await f.read(child.id)).retryStage,'redraw');assert.equal(f.control.calls.length-before,1);
 // Keep the just-generated receipt unavailable on retry, but let the replacement publication succeed.
 let blockReceipt=true;const first=f.control.calls.at(-1);assert.equal(first.page,4);
 const jobs=await f.app.services.production.queue.jobs(child.id,owner),receipt=JSON.parse(jobs.find(j=>j.kind==='image'&&JSON.parse(j.payload).page===4).result).value.replace('/api/reader/media/','reader/');
 store.get=async key=>blockReceipt&&key===receipt?null:get(key);lost=false;
 await f.demand(child.id,crypto.randomUUID(),0,true);await until(async()=>(await f.read(child.id)).state==='completed');blockReceipt=false;
 assert.deepEqual(f.control.calls.slice(before).map(c=>c.page),[4,4]);assert.equal((await f.read(id)).state,'completed');
});
