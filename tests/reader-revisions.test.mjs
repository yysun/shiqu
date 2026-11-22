// Exercise minimal redo and version isolation through real REST, SQLite, copied files and controlled inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,makePlan,selection} from './fixtures/production.mjs';
import {revisionImpact,reusableRevisionImages,checkedRevision} from '../lib/reader-revision.ts';
import {completedStory,revise,snapshotOf} from './fixtures/production-dag-story.mjs';
const owner='docker-local-owner';
const snapshot=snapshotOf;

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
 assert.equal(revisionImpact(base,{artStyle:'paper-cut'}).review,false);
 assert.equal(revisionImpact(base,{artStyle:'paper-cut',plan:structuredClone(plan),productionPrompt:selection.productionPrompt,length:4}).review,false);
 for(const changes of [{plan:caption},{acceptancePrompt:'核对关键行动。'},{productionPrompt:'新的制作要求'},{length:3},{narrativeDetail:'brief'}])assert.equal(revisionImpact(base,{artStyle:'paper-cut',...changes}).review,true);
 assert.equal(revisionImpact({...base,plan:null},{artStyle:'paper-cut'}).review,true,'An unfinished script still needs its first review');
 assert.equal(revisionImpact(base,{length:3}).reusePending,true);
 assert.equal(revisionImpact(base,{productionPrompt:'new',plan:caption}).conflict,true);
});

test('image-only redraw validates page selection and cannot conceal content edits',()=>{
 const plan=makePlan(4),base={selection,plan,images:['a','b','c','d']};
 assert.deepEqual(revisionImpact(base,{redrawPages:[1,3]}),{changed:true,replan:false,preserveScript:false,review:false,reused:2,redraw:2,total:4,reusePending:false,conflict:false});
 assert.deepEqual(checkedRevision(base,{redrawPages:[1,3]}).plan,plan);
 for(const redrawPages of [[],[0],[5],[1,1],[1.5]])assert.throws(()=>checkedRevision(base,{redrawPages}));
 assert.throws(()=>checkedRevision(base,{redrawPages:[1],plan}),/不能同时/);
 assert.throws(()=>checkedRevision({...base,plan:null},{redrawPages:[1]}),/完整分镜/);
});

test('manual frame removal requires its original positions and keeps at least one frame',()=>{
 const plan=makePlan(4),base={selection:{...selection,length:'auto'},plan,images:['a','b','c','d']};
 const revised={...plan,pages:[plan.pages[0],plan.pages[2]]};
 const checked=checkedRevision(base,{plan:revised,removedFrames:[2,4]});
 assert.deepEqual(checked.sourcePages,[0,2]);assert.equal(checked.selection.length,2);
 assert.equal(checked.impact.review,true);assert.equal(checked.impact.reused,2);assert.equal(checked.impact.total,2);
 for(const changes of [{plan:revised},{removedFrames:[2,4]},{plan:revised,removedFrames:[2]},{plan:revised,removedFrames:[2,2]},{plan:revised,removedFrames:[2,5]},{plan:{...plan,pages:[]},removedFrames:[1,2,3,4]},{plan:revised,removedFrames:[2,4],length:2}])assert.throws(()=>checkedRevision(base,changes));
 const firstRemoved={...plan,pages:[plan.pages[1],plan.pages[2]]};
 assert.equal(revisionImpact(base,{plan:firstRemoved,removedFrames:[1,4]}).reused,0);
 assert.equal(revisionImpact(base,{storySummary:'按当前分镜查看到梦醒的瞬间。'}).review,false);
});

test('family epoch serializes concurrent drafts; identical request replay is stable, changed replay is rejected',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 const {id}=await completedStory(f),base=await snapshot(f,id),plan=structuredClone(base.plan);plan.pages[0].caption='庄周在柳树下打盹，梦里化作蝴蝶。';
 const payload={requestId:crypto.randomUUID(),token:base.token,changes:{plan}};
 const [a,b]=await Promise.all([f.request(`sessions/${id}/revisions`,'POST',payload),f.request(`sessions/${id}/revisions`,'POST',{...payload,requestId:crypto.randomUUID()})]);
 assert.deepEqual([a.status,b.status].sort(),[201,409]);const winner=a.ok?await a.json():await b.json();
 const rows=await f.app.services.database.prepare("SELECT id FROM stories WHERE json_extract(document,'$.revision.rootId')=?").bind(id).all();assert.equal(rows.results.length,1);
 await f.json(`sessions/${winner.id}/production-control`,'POST',{action:'continue'});
 await until(async()=>(await f.read(winner.id)).state==='completed',20000);
 const replay=await f.json(`sessions/${id}/revisions`,'POST',{...payload,requestId:winner.id});assert.equal(replay.id,winner.id);
 const changed=await f.request(`sessions/${id}/revisions`,'POST',{requestId:winner.id,token:base.token,changes:{artStyle:'paper-cut'}});assert.equal(changed.status,409);
 assert.equal((await f.request(`sessions/${id}/revisions`)).status,409);
 const fresh=await snapshot(f,winner.id);assert.notEqual(fresh.token,base.token);
 const third=await f.json(`sessions/${winner.id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:fresh.token,changes:{artStyle:'paper-cut'}});assert.equal(third.revision.number,3);
});

test('caption-only revision keeps every copied image, the original stays independent, and survives a deleted parent and restart',async t=>{
 const f=await productionFixture(t,'codex');
 const {id}=await completedStory(f);
 const old=await f.read(id),base=await snapshotOf(f,id),plan=structuredClone(base.plan);
 plan.pages[3].caption='庄周醒来，看着窗外，仍记得梦中自在飞翔的感觉。';
 const {child,doc}=await revise(f,id,{plan});
 const saved=await f.read(child);
 assert.equal(f.control.calls.length,0);assert.equal(doc.revision.rootId,id);assert.equal(doc.revision.number,2);
 assert.equal((await f.read(id)).story.pages[3].caption,old.story.pages[3].caption);
 for(let page=0;page<6;page++){
  const a=new Uint8Array(await(await f.request(old.story.pages[page].image.replace('/api/reader/',''))).arrayBuffer());
  const b=new Uint8Array(await(await f.request(saved.story.pages[page].image.replace('/api/reader/',''))).arrayBuffer());assert.deepEqual(a,b);
  assert.match(saved.story.pages[page].image,new RegExp(child));
 }
 await f.json(`library/${id}`,'DELETE');assert.equal((await f.request(saved.story.pages[0].image.replace('/api/reader/',''))).status,200);
 await f.restart();assert.equal((await f.read(child)).state,'completed');
});

test('one scene change redraws only that image; a first-scene change redraws only the first (the rest keep their images)',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 const {id}=await completedStory(f),base=await snapshotOf(f,id),plan=structuredClone(base.plan);
 plan.pages[4].prompt+=' A hand reaches toward a clearly visible butterfly.';
 const {child}=await revise(f,id,{plan});
 assert.deepEqual(f.control.calls.map(c=>c.page),[4]);
 const first=structuredClone((await snapshotOf(f,child)).plan);first.pages[0].prompt+=' A new first scene.';
 const start=f.control.calls.length;await revise(f,child,{plan:first});
 assert.deepEqual(f.control.calls.slice(start).map(c=>c.page),[0]);
});

for(const kind of ['transient','corrupt'])test(`a ${kind} copied asset ${kind==='transient'?'stops the submission without creating a version':'is redrawn in the new version only'}`,async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 const {id}=await completedStory(f),base=await snapshotOf(f,id),plan=structuredClone(base.plan);plan.pages[0].caption='庄周在柳树下打盹，梦里化作蝴蝶。';
 const get=f.app.services.media.get.bind(f.app.services.media),bad=base.images[3].replace('/api/reader/media/','reader/');
 f.app.services.media.get=async key=>{if(key!==bad)return get(key);if(kind==='transient')throw Error('controlled read error');return {contentType:'image/png',async arrayBuffer(){return new ArrayBuffer(4);}};};
 const child=crypto.randomUUID(),res=await f.request(`sessions/${id}/revisions`,'POST',{requestId:child,token:base.token,changes:{plan}});
 if(kind==='transient'){
  assert.equal(res.status,503);assert.equal(await f.app.services.database.prepare('SELECT id FROM stories WHERE id=?').bind(child).first(),null);return;
 }
 assert.equal(res.status,201);f.app.services.media.get=get;
 const fault=(await f.read(child)).faults.find(x=>x.stage==='redraw');assert.ok(fault,'the unusable image is a fault the reader recovers');
 await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 await f.json(`sessions/${child}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(child)).state==='completed',20000);
 assert.deepEqual(f.control.calls.map(c=>c.page),[3],'only the unusable page is drawn again');
 assert.equal((await f.read(id)).ready,6,'the original keeps what it has');
});

test('invalid inputs, unchanged drafts and stale parents never create a child or write copied media',async t=>{
 const f=await productionFixture(t,'codex');
 const {id}=await completedStory(f),base=await snapshotOf(f,id);
 const send=changes=>f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes});
 assert.equal((await send({length:81})).status,400);
 const plan=structuredClone(base.plan);plan.pages[0].caption='短';assert.equal((await send({plan})).status,400);
 let writes=0;const put=f.app.services.media.put.bind(f.app.services.media);f.app.services.media.put=async(...args)=>{writes++;return put(...args);};
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.plan.reflection',?) WHERE id=?").bind('新的余味。',id).run();
 assert.equal((await send({artStyle:'paper-cut'})).status,409);
 assert.equal(writes,0);assert.equal(f.control.calls.length,0);
 const rows=await f.app.services.database.prepare("SELECT id FROM stories WHERE json_extract(document,'$.revision.parentId')=?").bind(id).all();assert.equal(rows.results.length,0);
});
