// Exercise real checkpoint/queue persistence with controlled text and image providers, never live inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,makePlan} from './fixtures/production.mjs';
import {newReview} from '../lib/reader-review.ts';
import {applyStructuralEdits} from '../lib/reader-structure.ts';
const owner='docker-local-owner';
const issue={page:2,category:'progression',problem:'赠物之后缺少听者没有接取的回应。',instruction:'在原第二幅前补一幅回应。',requiresReplan:true};
const inserted={caption:'听者没有伸手接取，稍稍停了一会儿。',prompt:'The listener pauses with empty hands before an offered object.'};
const document=async(f,id)=>JSON.parse((await f.app.services.production.repository.get(id,owner)).document);

for(const provider of ['codex','gemini'])test(`${provider}: automatic counts differ from the estimate; structural insertion/deletion rechecks before images`,async t=>{
 const f=await productionFixture(t,provider);f.control.autoLength=3;
 let rechecking,release;const started=new Promise(r=>rechecking=r),hold=new Promise(r=>release=r);t.after(()=>release());
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='review'){
   assert.equal(f.control.calls.length,0);
   if(f.control.reviews.length===1)return {issues:[issue]};
   assert.equal(payload.plan.pages.length,4);rechecking();await hold;return {issues:[]};
  }
  if(kind==='structure')return {edits:[{from:2,to:2,pages:[inserted,makePlan(3).pages[1]]}]};
 };
 const id=await f.createLegacyReader('auto',{narrativeDetail:'detailed'});await f.demand(id);await started;
 const before=await document(f,id);assert.equal(before.frameRecommendation.count,7);assert.equal(before.plan.pages.length,4);assert.equal(before.visualReview.history[0].structure.before,3);assert.equal(before.visualReview.history[0].structure.after,4);assert.equal(before.storyboard,undefined);
 assert.equal(f.control.structures.length,1);assert.equal(f.control.calls.length,0);assert.equal((await f.read(id)).selection.length,'auto');
 release();await until(()=>f.control.calls.length===1);assert.equal((await document(f,id)).visualReview.status,'passed');
 assert.deepEqual((await document(f,id)).usage.filter(u=>/review:|repair:/.test(u.step)).map(u=>u.step),['review:frames:0:0','review:full:0:1','repair:full:1:1:structure','review:frames:1:1','review:full:1:2']);
});

test('structural edits remap existing duplicate pictures and concurrent reading progress atomically',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(4);await until(async()=>(await f.read(id)).state==='completed');
 const row=await f.app.services.production.repository.get(id,owner),doc=JSON.parse(row.document),oldImages=[...doc.images];
 doc.plan.pages[2].prompt=doc.plan.pages[1].prompt;doc.visualReview=newReview();
 f.control.calls=[];f.control.reviews=[];f.control.hold=true;
 let editing,release,rechecking,releaseAudit;const started=new Promise(r=>editing=r),hold=new Promise(r=>release=r),audit=new Promise(r=>rechecking=r),auditHold=new Promise(r=>releaseAudit=r);t.after(()=>{release();releaseAudit();});
 f.control.beforeText=async kind=>{
  if(kind==='review'){if(f.control.reviews.length===1)return {issues:[issue]};rechecking();await auditHold;return {issues:[]};}
  if(kind==='structure'){editing();await hold;return {edits:[{from:2,to:1,pages:[inserted]}]};}
 };
 await f.app.services.database.prepare("UPDATE stories SET selection=?,document=?,state='idle',page=2 WHERE id=?").bind(JSON.stringify({...JSON.parse(row.selection),length:'auto'}),JSON.stringify(doc),id).run();
 f.app.services.production.wake();await started;
 await f.app.services.database.prepare('UPDATE stories SET page=3 WHERE id=?').bind(id).run();release();await audit;
 const saved=await f.app.services.production.repository.get(id,owner),after=JSON.parse(saved.document);
 assert.equal(saved.page,4,'Use the concurrent current page, not the stale page acquired with the work');
 assert.deepEqual(after.images,[oldImages[0],'',oldImages[1],oldImages[2],oldImages[3]]);assert.equal(f.control.calls.length,0);
 releaseAudit();await until(()=>f.control.calls.length===1);assert.equal(f.control.calls[0].page,1,'Only the inserted drawing is missing');
});

test('deleting a duplicate transition reduces count and keeps reading positions valid',async t=>{
 const f=await productionFixture(t);f.control.autoLength=4;
 f.control.beforeText=async kind=>kind==='review'?{issues:f.control.reviews.length===1?[{...issue,instruction:'删除原第二至三幅的重复过渡。'}]:[]}:kind==='structure'?{edits:[{from:2,to:3,pages:[]}]}:undefined;
 const id=await f.createLegacyReader('auto');await f.demand(id);await until(()=>f.control.calls.length===1);
 const doc=await document(f,id);assert.equal(doc.plan.pages.length,2);assert.equal(doc.visualReview.status,'passed');assert.equal(doc.visualReview.history[0].structure.removed.length,2);
});

for(const invalid of [true,false])test(`${invalid?'invalid':'unchanged'} structural output stops without images or automatic replay`,async t=>{
 const f=await productionFixture(t);f.control.autoLength=3;
 f.control.beforeText=async(kind,payload)=>kind==='review'?{issues:[issue]}:kind==='structure'?{edits:invalid?[{from:8,to:7,pages:[inserted]}]:[{from:2,to:2,pages:[payload.plan.pages[1]]}]}:undefined;
 const id=await f.createLegacyReader('auto');await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 const doc=await document(f,id);assert.equal(doc.plan.pages.length,3);assert.equal(f.control.calls.length,0);assert.equal(f.control.structures.length,1);if(!invalid)assert.equal(doc.visualReview.stopReason,'unchanged');
 await f.restart();assert.equal((await f.read(id)).state,'failed');assert.equal(f.control.structures.length,1);
});

test('saved structural edits survive restart without being charged a second time',async t=>{
 const f=await productionFixture(t);f.control.autoLength=3;let editing,release;const started=new Promise(r=>editing=r),hold=new Promise(r=>release=r);t.after(()=>release());
 f.control.beforeText=async kind=>{
  if(kind==='review')return {issues:f.control.reviews.length===1?[issue]:[]};
  if(kind==='structure'){editing();await hold;return {edits:[{from:2,to:1,pages:[inserted]}]};}
 };
 const id=await f.createLegacyReader('auto');await f.demand(id);await started;
 f.app.services.production.stop();release();await f.app.services.production.queue.settle();
 await until(async()=>(await document(f,id)).plan.pages.length===4);
 assert.equal((await document(f,id)).visualReview.status,'pending');await f.restart();
 f.control.hold=true;await f.demand(id);await until(()=>f.control.calls.length===1);
 assert.equal(f.control.structures.length,1);assert.equal(f.control.frameReviews.length,2);assert.equal((await document(f,id)).usage.filter(u=>u.step==='repair:full:1:1:structure').length,1);
});

test('automatic structural repairs share the twenty-pass stop and never draw through it',async t=>{
 const f=await productionFixture(t);f.control.autoLength=3;
 f.control.beforeText=async kind=>kind==='review'?{issues:[issue]}:kind==='structure'?{edits:[{from:2,to:1,pages:[inserted]}]}:undefined;
 const id=await f.createLegacyReader('auto');await f.demand(id);await until(async()=>(await f.read(id)).state==='failed',15_000);
 const doc=await document(f,id);assert.equal(doc.visualReview.stopReason,'limit');assert.equal(doc.visualReview.repairs,20);assert.equal(f.control.structures.length,20);assert.equal(f.control.reviews.length,21);assert.equal(f.control.calls.length,0);
});

for(const missing of [true,false])test(`${missing?'missing coverage':'invented source quote'} cannot approve an automatic script`,async t=>{
 const f=await productionFixture(t);f.control.autoLength=3;
 f.control.beforeText=async kind=>kind==='review'?{issues:[],coverage:missing?undefined:[{quote:'原文不存在的受控引用',task:'受控核对',pages:[1],assessment:'adequate',reason:'此记录应被拒绝。',issuePage:0}]}:undefined;
 const id=await f.createLegacyReader('auto');await f.demand(id);await until(async()=>(await f.read(id)).state==='failed');
 assert.equal(f.control.calls.length,0);assert.notEqual((await document(f,id)).visualReview.status,'passed');
});

for(const structural of [true,false])test(`late reading progress ${structural?'cannot cross a structural save':'survives an unrelated image checkpoint'}`,async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(4);await until(async()=>(await f.read(id)).state==='completed');
 f.app.services.production.stop();await f.app.services.production.queue.settle();
 const repo=f.app.services.production.repository;await repo.progress(id,owner,3,false);
 const row=await repo.get(id,owner),doc=JSON.parse(row.document),token=await repo.acquire(row,{kind:'repair',page:0,key:'controlled:structure'});
 const get=repo.get.bind(repo);let captured=false,entered,release;const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r);t.after(()=>release());
 t.mock.method(repo,'get',async(...args)=>{const saved=await get(...args);if(!captured){captured=true;entered();await hold;}return saved;});
 const late=repo.progress(id,owner,3,true);await started;
 if(structural){const edit=applyStructuralEdits(doc.plan,{edits:[{from:2,to:3,pages:[]}]});doc.plan=edit.plan;doc.images=[doc.images[0],doc.images[3]];await repo.save(row,token,doc,false,null,edit.progressMap);}
 else{doc.images[1]='';await repo.save(row,token,doc,false);}
 const outcome=structural?assert.rejects(late,e=>e.status===409):late;release();await outcome;
 const saved=await get(id,owner);assert.equal(saved.page,structural?1:3);assert.equal(saved.saved,structural?0:1);
});
