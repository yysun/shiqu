// 正式队列上的幅数核对与单轮审片、结构修订、图片复用与明确放行。
import test from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {productionFixture,until,makePlan,makeReflectionCandidates,selection,encoded} from './fixtures/production.mjs';
import {decodeDocument,encodeDocument} from '../lib/production-dag/document.ts';
import {normalizeStoryDocument} from '../server/migrations/production-v4.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {newReview} from '../lib/reader-review.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';

const owner='docker-local-owner';
const original={title:'原文',text:'甲赠物，乙未接，后来二人和解。',url:'https://example.test',kind:'passage',provider:'fixture',retrievedAt:'2026-01-01'};
const requirement={page:2,quote:'乙未接',task:'重复反应',captionEvidence:'拒绝已经明确',visualEvidence:'相同拒绝又分一幅',loss:'重复拖慢推进',instruction:'合并重复拒绝，保留决定性反应。'};
const reduction={frameCountReview:{decision:'reduce',proposedCount:3,reason:'移除重复反应。'},requirements:[requirement,{...requirement,task:'重复解释',instruction:'保留此第二项完整要求。'}]};
const keep=count=>({frameCountReview:{decision:'keep',proposedCount:count,reason:'本篇已有足够画幅。'},requirements:[]});
const structureIssue={page:2,category:'progression',problem:'缺少原文中的回应。',instruction:'补写对方的实际回应。',requiresReplan:true};
const captionIssue={page:2,category:'caption',problem:'指代不清。',instruction:'用人名交代是谁拒绝。',requiresReplan:false};

async function seed(f,{count=4,saved=0,candidates=false,review=newReview()}={}){
 const id=crypto.randomUUID();
 const images=Array(count).fill('');
 for(let page=0;page<saved;page++){
  const asset=readerImageAsset(id,page,'png');
  await f.media.put(asset.key,Buffer.from(encoded,'base64'),{contentType:'image/png'});
  images[page]=asset.url;
 }
 const plan=makePlan(count);
 const doc={plan,original,images,audio:[],usage:[],...(review?{visualReview:review}:{}),...(candidates?{reflectionCandidates:makeReflectionCandidates('原结语')}:{})};
 const selected=selectionSchema.parse({...selection,length:'auto'});
 doc.dag=normalizeStoryDocument(id,doc,selected);
 delete doc.visualReview;delete doc.reflectionCandidates;
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_control,production_complete,page,created_at,updated_at) VALUES(?,?,?,?,?,0,?,'c','u')")
  .bind(id,owner,JSON.stringify(selected),encodeDocument(doc),!review&&saved===count?'active':'paused',Math.min(2,count-1)).run();
 return {id,plan,images,read:async()=>decodeDocument(await new ReaderRepository(f.app.services.database).get(id,owner)),
  resume:()=>f.json(`sessions/${id}/production-control`,'POST',{action:'resume'}),
  pause:()=>f.json(`sessions/${id}/production-control`,'POST',{action:'pause'})};
}

test('count reduction passes full requirements to repair and reuses surviving images before drawing',async t=>{
 let context,releaseFull,fullStarted=false;
 const hold=new Promise(resolve=>releaseFull=resolve);
 t.after(()=>releaseFull());
 const f=await productionFixture(t),s=await seed(f,{saved:3,candidates:true});
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='frames')return payload.plan.pages.length===4?reduction:keep(3);
  if(kind==='structure'){context=payload.frameCountContext;return {edits:[{from:2,to:2,pages:[]}]};}
  if(kind==='review'){fullStarted=true;await hold;}
 };
 await s.resume();await until(()=>fullStarted,15000);
 const pending=await s.read();
 assert.equal(pending.dag.frameCheck.frameCountReview.decision,'keep');
 assert.equal(pending.dag.order.length,3);
 assert.equal(pending.dag.ending.candidates.length,3);
 assert.deepEqual(context,reduction);
 assert.equal(f.control.calls.length,0);
 assert.deepEqual(pending.images,[s.images[0],s.images[2],'']);
 assert.equal((await f.read(s.id)).page,1);
 for(const image of pending.images.filter(Boolean))assert.deepEqual(Buffer.from((await f.media.get(referenceImageKey(s.id,image))).body),Buffer.from(encoded,'base64'));
 releaseFull();await until(()=>f.control.calls.length===1,15000);
 assert.equal(f.control.calls[0].page,2);
 f.control.calls[0].resolve();await until(async()=>(await f.read(s.id)).state==='completed',15000);
 const done=await s.read();
 assert.ok(done.dag.ending.chosen);
 assert.deepEqual(done.usage.filter(row=>['dag:frameCheck','dag:review'].includes(row.step)).map(row=>row.step),['dag:frameCheck','dag:frameCheck','dag:review']);
});

test('paused count work drains and the saved result survives a restart and subsequent review failure',async t=>{
 let releaseCount,countStarted=false,failFull=true;
 const hold=new Promise(resolve=>releaseCount=resolve);
 t.after(()=>releaseCount());
 const f=await productionFixture(t),s=await seed(f);
 f.control.beforeText=async kind=>{
  if(kind==='frames'){countStarted=true;await hold;}
  if(kind==='review'&&failFull)throw Error('controlled failure');
 };
 await s.resume();await until(()=>countStarted);
 await s.pause();releaseCount();
 await until(async()=>(await s.read()).dag?.products['frameCheck:']?.outcome==='pass');
 assert.equal(f.control.reviews.length,0);assert.equal(f.control.calls.length,0);
 await f.restart();await f.app.services.production.tick();
 assert.equal((await f.read(s.id)).generationControl,'paused');
 assert.equal(f.control.frameReviews.length,1);
 await s.resume();await until(async()=>(await f.read(s.id)).state==='failed');
 await s.pause();failFull=false;await s.resume();
 const fault=(await f.read(s.id)).faults.find(item=>item.retryAllowed);
 await f.json(`sessions/${s.id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(()=>f.control.calls.length===1);
 assert.equal(f.control.frameReviews.length,1);
 assert.equal((await s.read()).usage.filter(row=>row.step==='dag:frameCheck').length,1);
});

test('same-length structure repair returns to count while caption repair stays in full review',async t=>{
 const f=await productionFixture(t),s=await seed(f,{count:3}),sequence=[];
 f.control.beforeText=async(kind,payload)=>{
  if(['frames','review','structure','sceneRepair'].includes(kind))sequence.push(kind);
  if(kind==='review'&&f.control.reviews.length===1)return {issues:[structureIssue]};
  if(kind==='review'&&f.control.reviews.length===2)return {issues:[captionIssue]};
  if(kind==='structure')return {edits:[{from:2,to:2,pages:[{caption:'乙明确拒绝了赠物，甲放下礼物。'}]}]};
  if(kind==='sceneRepair')assert.equal(payload.frames[0].number,2);
 };
 await s.resume();await until(()=>f.control.calls.length===1,15000);
 assert.deepEqual(sequence,['frames','review','structure','frames','review','sceneRepair','review']);
 assert.equal((await s.read()).dag.repairs.used,2);
});

test('explicit draw-anyway remains marked, paused and idempotent at the count gate',async t=>{
 const f=await productionFixture(t),s=await seed(f);
 f.control.beforeText=async kind=>kind==='frames'?reduction:kind==='structure'?{edits:[{from:2,to:2,pages:[{caption:s.plan.pages[1].caption}]}]}:undefined;
 await s.resume();
 await until(async()=>(await f.read(s.id)).generationProgress.reviewStopReason==='replan',15000);
 assert.ok((await s.read()).dag.issues.some(issue=>issue.target==='frameCheck:'&&issue.stalled));
 await s.pause();
 const skip=()=>f.json(`sessions/${s.id}/review-override`,'POST',{});
 await skip();await skip();await f.app.services.production.tick();
 assert.equal(f.control.calls.length,0);assert.equal(f.control.reviews.length,0);
 const paused=await f.read(s.id);
 assert.equal(paused.generationControl,'paused');
 assert.equal(paused.generationProgress.reviewOverridden,true);
 assert.equal((await f.json(`sessions/${s.id}/prompts`)).overridden,true);
 assert.equal((await f.json(`sessions/${s.id}/review-history`)).overridden,true);
 const products=(await s.read()).dag.products;
 assert.equal(products['frameCheck:'].overridden,true);
 assert.equal(products['narrativeVerdict:'].outcome,'fail');
 assert.equal(products['narrativeVerdict:'].overridden,true);
 f.control.hold=false;await s.resume();
 await until(async()=>(await f.read(s.id)).state==='completed',15000);
 await skip();assert.equal(f.control.calls.length,4);assert.equal(f.control.reviews.length,0);
});

for(const [label,review] of [['passed',{...newReview(),status:'passed'}],['absent',null]])test(`opening an old automatic plan with ${label} review does not add either audit`,async t=>{
 const f=await productionFixture(t),s=await seed(f,{review,saved:1});f.control.hold=false;
 await s.resume();await until(async()=>(await f.read(s.id)).state==='completed',15000);
 assert.equal(f.control.frameReviews.length,0);assert.equal(f.control.reviews.length,0);
 assert.deepEqual(f.control.calls.map(call=>call.page).sort(),[1,2,3]);
 assert.equal((await s.read()).images[0],s.images[0]);
});


test('explicit recovery of an unreadable image in an unchanged legacy archive draws only that frame',async t=>{
 const f=await productionFixture(t),s=await seed(f,{review:null,saved:4});f.control.hold=false;
 await until(async()=>(await f.read(s.id)).state==='completed');
 const image=s.images[2],key=referenceImageKey(s.id,image);
 await rm(path.join(f.dataDirectory,'media',key));
 const checked=await f.json(`sessions/${s.id}/image-health`,'POST',{page:2,image});
 assert.equal(f.control.calls.length,0);
 const fault=checked.faults.find(item=>item.page===2);
 assert.ok(fault);
 const recovery=await f.request(`sessions/${s.id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 assert.equal(recovery.status,202,await recovery.text());
 await until(async()=>(await f.read(s.id)).state==='completed');
 assert.equal(f.control.frameReviews.length+f.control.reviews.length,0);
 assert.deepEqual(f.control.calls.map(call=>call.page),[2]);
 const result=await s.read();assert.deepEqual(result.images.filter((_,page)=>page!==2),s.images.filter((_,page)=>page!==2));
});

test('unreviewed archive permission does not become review approval in a copy or new revision',async t=>{
 const {copySavedStory}=await import('../server/reader-copy.ts');
 const f=await productionFixture(t),s=await seed(f,{review:null,saved:4});
 f.control.hold=false;
 await until(async()=>(await f.read(s.id)).state==='completed');
 const destination=await productionFixture(t);
 await f.stop();
 const copy=options=>copySavedStory(destination.app,process.cwd(),destination.dataDirectory,f.dataDirectory,s.id,crypto.randomUUID(),undefined,options);
 await assert.rejects(copy({}),/已通过审核/);
 const copied=await copy({draft:true});
 assert.equal(copied.lifecycle.review,'pending');
 await f.restart();
 const draft=await f.json(`sessions/${s.id}/revisions`);
 const result=await f.request(`sessions/${s.id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:draft.token,changes:{reviewNotes:'请审核第二幅的拒绝动作。'}});
 const revision=await result.json();
 assert.equal(result.status,201,revision.error);
 const child=revision.id;
 await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed');
 assert.equal(f.control.reviews.length,1);
 assert.equal(f.control.calls.length,0);
});
