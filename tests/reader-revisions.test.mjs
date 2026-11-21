// Exercise minimal redo and version isolation through real REST, SQLite, copied files and controlled inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,makePlan,selection} from './fixtures/production.mjs';
import {revisionImpact,reusableRevisionImages,checkedRevision} from '../lib/reader-revision.ts';
import {forkRevision} from '../server/reader-revisions.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {flowProviders} from './fixtures/test-tier.mjs';
import {jpeg} from './fixtures/images.mjs';
const owner='docker-local-owner';
async function completed(t,provider='codex',settings={}){
 const f=await productionFixture(t,provider);f.control.hold=false;const id=await f.create(8,settings);await until(async()=>(await f.read(id)).state==='completed');return {f,id};
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

test('changing only the style prompt redraws the story and restoring the preset redraws with its default',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),artStylePrompt='Use cool-gray ink on visible white silk.';
 const start=f.control.calls.length,reviews=f.control.reviews.length,transitions=[];
 f.control.beforeText=(kind,payload)=>{if(kind==='restyle')transitions.push(payload);};
 const child=await revise(f,id,{artStylePrompt},base);
 await until(async()=>(await f.read(child.id)).state==='completed');
 const custom=await snapshot(f,child.id);
 assert.equal(custom.selection.artStyle,base.selection.artStyle);
 assert.equal(custom.selection.artStylePrompt,artStylePrompt);
 assert.equal(custom.reviewStatus,base.reviewStatus);
 assert.equal(f.control.reviews.length,reviews);
 assert.deepEqual(custom.plan,base.plan);
 assert.equal(f.control.calls.length-start,base.plan.pages.length);
 assert.ok(f.control.calls.slice(start).every(call=>call.prompt.includes(artStylePrompt)));
 assert.ok(transitions.length>0&&transitions.every(payload=>payload.artDirection.prompt===artStylePrompt));
 assert.deepEqual((await f.read(id)).story.pages.map(page=>page.image),base.images);


 const route=`sessions/${child.id}/landscape`,{startToken}=await f.json(route);
 await f.json(route,'POST',{startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const landscape=f.control.calls.filter(call=>call.landscape);
 assert.equal(landscape.length,base.plan.pages.length);
 assert.ok(landscape.every(call=>call.prompt.includes(artStylePrompt)));

 const restored=await revise(f,child.id,{artStylePrompt:null},custom),afterCustom=f.control.calls.length;
 await until(async()=>(await f.read(restored.id)).state==='completed');
 assert.equal((await snapshot(f,restored.id)).selection.artStylePrompt,null);
 assert.equal(f.control.calls.length-afterCustom,base.plan.pages.length);
 assert.ok(f.control.calls.slice(afterCustom).every(call=>!call.prompt.includes(artStylePrompt)));
 assert.equal(transitions.at(-1).previousArtDirection.prompt,artStylePrompt);
});

test('a style revision saves the supplied first frame and draws only the remaining pages',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),old=await f.read(id);
 await f.json(`library/${id}/reference`,'POST',{page:0,starred:true});
 const image=new Blob([Uint8Array.from(jpeg)],{type:'image/jpeg'}),before=f.control.calls.length,reviews=f.control.reviews.length;
 const revision={requestId:crypto.randomUUID(),token:base.token,changes:{artStyle:'watercolor'},paused:true};
 const send=cover=>{
  const form=new FormData();form.set('revision',JSON.stringify(revision));form.set('cover',cover,'first.jpg');
  return f.app.handle(new Request(`http://shiqu.local/api/reader/sessions/${id}/revisions`,{method:'POST',body:form}));
 };
 assert.equal((await send(new Blob(['broken']))).status,400);
 const response=await send(image);assert.equal(response.status,201);
 const child=await response.json();assert.equal(child.generationControl,'paused');assert.equal(child.ready,1);
 assert.deepEqual(await(await f.request(child.story.pages[0].image.replace('/api/reader/',''))).arrayBuffer(),await image.arrayBuffer());
 assert.deepEqual((await snapshot(f,child.id)).plan,base.plan);
 assert.equal((await send(image)).status,201);assert.equal((await send(new Blob(['different']))).status,409);
 await f.json(`sessions/${child.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'resume'});
 await until(async()=>(await f.read(child.id)).state==='completed');
 const calls=f.control.calls.slice(before);
 assert.deepEqual(calls.map(call=>call.page).sort((a,b)=>a-b),[1,2,3,4,5,6,7]);
 const reference=Buffer.from(await image.arrayBuffer()).toString('base64');
 assert.ok(calls.every(call=>call.reference===reference));
 assert.equal(f.control.reviews.length,reviews);
 assert.deepEqual((await f.read(id)).story,old.story);
});

for(const {from,to,oldCue,newCue} of [
 {from:'watercolor',to:'cinematic',oldCue:'以透明水彩湿画法表现。',newCue:'以自然的电影实拍质感表现。'},
 {from:'woodblock',to:'classical-oil',oldCue:'用木刻粗线与刻痕表现。',newCue:'以古典油画的层叠笔触表现。'},
])test(`Gemini converts ${from} scene prompts to ${to} before drawing`,async t=>{
 const {f,id}=await completed(t,'gemini',{artStyle:from});
 const db=f.app.services.database;
 const plan=(await snapshot(f,id)).plan;
 for(const frame of plan.pages)frame.prompt+=oldCue;
 const rewritten={...plan,pages:plan.pages.map(frame=>({...frame,prompt:frame.prompt.replace(oldCue,newCue)}))};
 await db.prepare("UPDATE stories SET document=json_set(document,'$.plan',json(?)) WHERE id=?").bind(JSON.stringify(plan),id).run();
 const {reference:star}=await f.json(`library/${id}/reference`,'POST',{page:0,starred:true});
 const before=f.control.calls.length,reviews=f.control.reviews.length;
 const batches=[];
 f.control.beforeText=(kind,payload)=>{
  if(kind!=='restyle')return;
  assert.equal(f.control.calls.length,before);
  assert.equal(payload.previousArtDirection.id,from);
  assert.equal(payload.artDirection.id,to);
  batches.push(payload.scenePrompts);
  if(from==='woodblock'&&batches.length===2)return {scenePrompts:[]};
  return {scenePrompts:payload.scenePrompts.map(prompt=>prompt.replace(oldCue,newCue))};
 };
 const child=await revise(f,id,{artStyle:to});
 if(from==='woodblock'){
  await until(async()=>(await f.read(child.id)).state==='failed');
  assert.equal(f.control.calls.length,before);
  const failed=await snapshot(f,child.id);
  assert.deepEqual(failed.plan.pages.map(frame=>frame.prompt),[...rewritten.pages.slice(0,6),...plan.pages.slice(6)].map(frame=>frame.prompt));
  await f.restart();
  await f.demand(child.id,crypto.randomUUID(),0,true);
 }
 await until(async()=>(await f.read(child.id)).state==='completed');
 assert.deepEqual(batches.slice(0,2).flat(),plan.pages.map(frame=>frame.prompt));
 if(from==='woodblock')assert.deepEqual(batches.slice(2),[batches[1]]);
 const calls=f.control.calls.slice(before);
 assert.equal(calls.length,plan.pages.length);
 assert.equal(calls[0].page,0);
 assert.equal(calls[0].reference,undefined);
 for(const call of calls){
  assert.equal(call.via,'gemini');
  assert.ok(call.prompt.includes(rewritten.pages[call.page].prompt));
  assert.ok(!call.prompt.includes(oldCue));
 }
 const saved=await snapshot(f,child.id),history=await f.json(`sessions/${child.id}/prompts`);
 const records=history.records.filter(entry=>entry.originId===child.id&&entry.step.startsWith('image:'));
 assert.equal(records.length,plan.pages.length);
 assert.equal(records.find(entry=>entry.step==='image:0').record.reference,undefined);
 assert.ok(records.filter(entry=>entry.step!=='image:0').every(entry=>entry.record.reference===saved.images[0]));
 assert.deepEqual(history.records.filter(entry=>entry.originId===child.id&&entry.step.startsWith('restyle:')).map(entry=>entry.step),['restyle:0','restyle:6']);
 assert.deepEqual(saved.plan,rewritten);
 assert.deepEqual((await f.read(id)).story.pages.map(frame=>frame.prompt),plan.pages.map(frame=>frame.prompt));
 assert.deepEqual((await f.json(`library/${child.id}/reference`)).reference,star);

 // 模拟升级前写入的换画风记录，后续仅换图仍沿用本篇首幅。
 await f.app.services.database.prepare("UPDATE stories SET document=json_remove(document,'$.revision.storyImageReference') WHERE id=?").bind(child.id).run();
 const next=await revise(f,child.id,{redrawPages:[2]},saved);
 await until(async()=>(await f.read(next.id)).state==='completed');
 const nextSaved=await snapshot(f,next.id),nextHistory=await f.json(`sessions/${next.id}/prompts`);
 const redraw=nextHistory.records.find(entry=>entry.originId===next.id&&entry.step==='image:1');
 assert.equal(redraw.record.reference,nextSaved.images[0]);
 assert.equal(f.control.calls.length,before+plan.pages.length+1);
 assert.equal(f.control.reviews.length,reviews);
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: image-only redraw replaces selected pages including anchor without review or touching other images`,async t=>{
 const {f,id}=await completed(t,provider),base=await snapshot(f,id),old=await f.read(id);
 const readDoc=async storyId=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(storyId).first()).document);
 const original=await readDoc(id),before=f.control.calls.length,reviews=f.control.reviews.length,frameReviews=f.control.frameReviews.length,plans=f.control.plans.length;
 const requestId=crypto.randomUUID(),payload={requestId,token:base.token,changes:{redrawPages:[1,2,4]},paused:true};
 const child=await f.json(`sessions/${id}/revisions`,'POST',payload);
 assert.equal(child.generationControl,'paused');assert.equal(child.ready,5);assert.equal(f.control.calls.length,before);
 await f.restart();
 assert.equal((await f.read(child.id)).generationControl,'paused');
 await f.json(`sessions/${child.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'resume'});
 await until(async()=>(await f.read(child.id)).state==='completed');
 const saved=await f.read(child.id),doc=await readDoc(child.id);
 assert.deepEqual(f.control.calls.slice(before).map(call=>call.page).sort((a,b)=>a-b),[0,1,3]);
 assert.ok(!f.control.calls[before].reference);assert.ok(f.control.calls.slice(before+1).every(call=>call.reference));
 assert.equal(f.control.reviews.length,reviews);assert.equal(f.control.frameReviews.length,frameReviews);assert.equal(f.control.plans.length,plans);
 assert.deepEqual(doc.plan,original.plan);assert.deepEqual(doc.visualReview,original.visualReview);assert.deepEqual(doc.original,original.original);
 for(const page of [2,4,5,6,7]){
  const a=new Uint8Array(await(await f.request(old.story.pages[page].image.replace('/api/reader/',''))).arrayBuffer());
  const b=new Uint8Array(await(await f.request(saved.story.pages[page].image.replace('/api/reader/',''))).arrayBuffer());assert.deepEqual(a,b);
 }
 assert.deepEqual((await f.read(id)).story,old.story);
 const calls=f.control.calls.length,replay=await f.json(`sessions/${id}/revisions`,'POST',payload);
 assert.equal(replay.id,child.id);assert.equal(f.control.calls.length,calls);
 assert.equal((await f.request(`sessions/${id}/revisions`,'POST',{...payload,changes:{redrawPages:[2]}})).status,409);
});

test('image-only redraw refuses an unreviewed story and missing unselected media without starting work',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),before=f.control.calls.length;
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.visualReview.status','pending') WHERE id=?").bind(id).run();
 const send=()=>f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{redrawPages:[1]}});
 assert.equal((await send()).status,409);assert.equal(f.control.calls.length,before);
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.visualReview.status','passed') WHERE id=?").bind(id).run();
 const get=f.app.services.media.get.bind(f.app.services.media),lost=base.images[3].replace('/api/reader/media/','reader/');
 f.app.services.media.get=async key=>key===lost?null:get(key);
 assert.equal((await send()).status,409);assert.equal(f.control.calls.length,before);
 const children=await f.app.services.database.prepare("SELECT id FROM stories WHERE json_extract(document,'$.revision.parentId')=?").bind(id).all();assert.equal(children.results.length,0);
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: caption-only revision reuses every copied image, original and deleted-parent independence`,async t=>{
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

test('late parent image writes remain isolated and derived eligibility blocks additional old dispatch',async t=>{
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
 const rows=await f.app.services.database.prepare("SELECT id FROM stories WHERE json_extract(document,'$.revision.rootId')=?").bind(id).all();assert.equal(rows.results.length,1);
 // Whichever ID won is replayable, even after its review has completed.
 await until(async()=>(await f.read(winner.id)).state==='completed');
 const replay=await revise(f,id,{plan},base,winner.id);assert.equal(replay.id,winner.id);
 const changed=await f.request(`sessions/${id}/revisions`,'POST',{requestId:winner.id,token:base.token,changes:{artStyle:'paper-cut'}});assert.equal(changed.status,409);
 assert.equal((await f.request(`sessions/${id}/revisions`)).status,409);const fresh=await snapshot(f,winner.id);assert.notEqual(fresh.token,base.token);const third=await revise(f,winner.id,{artStyle:'paper-cut'},fresh);assert.equal(third.revision.number,3);
});

test('invalid inputs, unchanged drafts, stale parent, and cross-owner IDs never create a child or write copied media',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),before=f.control.calls.length;
 const send=changes=>f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes});
 assert.equal((await send({})).status,400);assert.equal((await send({length:81})).status,400);
 const plan=structuredClone(base.plan);plan.pages[0].caption='短';assert.equal((await send({plan})).status,400);
 plan.pages[0].caption='庄周梦见自己变成蝴蝶，在花间自在飞翔。';assert.equal((await send({length:4,plan})).status,400);assert.equal((await send({productionPrompt:'new requirements',plan})).status,400);
 const meta=structuredClone(base.plan);meta.sourceReference='an invented source';assert.equal((await send({plan:meta})).status,400);
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.plan.reflection',?) WHERE id=?").bind('新的余味。',id).run();
 assert.equal((await send({artStyle:'paper-cut'})).status,409);
 const foreign=await f.createLegacyReader();await f.app.services.database.prepare('UPDATE stories SET user_id=? WHERE id=?').bind('another-owner',foreign).run();
 assert.equal((await f.request(`sessions/${foreign}/revisions`)).status,404);
 let writes=0;const put=f.app.services.media.put.bind(f.app.services.media);f.app.services.media.put=async(...args)=>{writes++;return put(...args);};
 const fresh=await snapshot(f,id);const occupied=await f.request(`sessions/${id}/revisions`,'POST',{requestId:foreign,token:fresh.token,changes:{plan:base.plan}});assert.equal(occupied.status,409);assert.equal(writes,0);assert.equal(f.control.calls.length,before);
});

for(const kind of ['missing','corrupt','transient'])test(`reusable ${kind} asset ${kind==='transient'?'stops the submission':'is redrawn in the new version'}`,async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),plan=structuredClone(base.plan);plan.reflection='梦醒后，自在的感觉仍然留在心里。';
 const get=f.app.services.media.get.bind(f.app.services.media),bad=base.images[3].replace('/api/reader/media/','reader/');
 f.app.services.media.get=async key=>{if(key!==bad)return get(key);if(kind==='missing')return null;if(kind==='transient')throw Error('controlled read error');return {contentType:'image/png',async arrayBuffer(){return new ArrayBuffer(4);}};};
 const before=f.control.calls.length,res=await f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan}});
 const rows=await f.app.services.database.prepare("SELECT id FROM stories WHERE json_extract(document,'$.revision.parentId')=?").bind(id).all();
 if(kind==='transient'){assert.equal(res.status,503);assert.equal(rows.results.length,0);assert.equal(f.control.calls.length,before);return;}
 assert.equal(res.status,201);const child=(await res.json()).id;f.app.services.media.get=get;
 await until(async()=>(await f.read(child)).state==='completed');assert.equal(f.control.calls.length-before,1,'Only the unusable page is drawn again');
 assert.equal((await f.read(id)).ready,8,'The original keeps what it has');
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: style changes preserve planning and review; requirements and counts re-audit`,async t=>{
 const {f,id}=await completed(t,provider);let before=f.control.calls.length,plans=f.control.plans.length,reviews=f.control.reviews.length,frameReviews=f.control.frameReviews.length;
 const readDoc=async storyId=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(storyId).first()).document);
 const old=await readDoc(id);
 const style=await revise(f,id,{artStyle:'paper-cut'});await until(async()=>(await f.read(style.id)).state==='completed');assert.equal(f.control.plans.length,plans);assert.equal(f.control.calls.length-before,8);
 assert.equal(f.control.reviews.length,reviews);assert.equal(f.control.frameReviews.length,frameReviews);
 assert.deepEqual((await readDoc(style.id)).visualReview,old.visualReview);assert.deepEqual((await readDoc(style.id)).plan,old.plan);
 assert.match(f.control.calls[before].prompt,/paper.cut|剪纸/i);
 before=f.control.calls.length;plans=f.control.plans.length;const count=await revise(f,style.id,{length:5});await until(async()=>(await f.read(count.id)).state==='completed');
 assert.equal((await f.read(count.id)).story.pages.length,5);assert.equal(f.control.plans.length,plans+1);assert.equal(f.control.calls.length,before);assert.ok(f.control.reviews.length>reviews);
 reviews=f.control.reviews.length;
 before=f.control.calls.length;plans=f.control.plans.length;f.control.autoLength=6;const requirements=await revise(f,count.id,{productionPrompt:'Keep actions clear and captions natural.'});await until(async()=>(await f.read(requirements.id)).state==='completed');assert.equal(f.control.plans.length,plans+1);assert.equal((await f.read(requirements.id)).selection.length,'auto');assert.equal((await f.read(requirements.id)).story.pages.length,6);assert.equal(f.control.calls.length-before,6);
 assert.ok(f.control.reviews.length>reviews);
});

test('review repair invalidates newly changed staging but preserves caption-only repair images',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),plan=structuredClone(base.plan);plan.pages[2].caption='庄周醒来，凝望花间飞舞的蝴蝶，想起梦中。';
 let reviews=0;f.control.beforeText=async kind=>kind==='review'&&reviews++===0?{issues:[{page:5,category:'action',problem:'动作需要更清楚。',instruction:'改成明确的动作。'}]}:undefined;
 const before=f.control.calls.length,next=await revise(f,id,{plan},base);await until(async()=>(await f.read(next.id)).state==='completed');assert.deepEqual(f.control.calls.slice(before).map(c=>c.page),[4]);
 const snap=await snapshot(f,next.id),narration=structuredClone(snap.plan);narration.reflection='醒来后，仍可以记住梦中的自在。';reviews=0;
 f.control.beforeText=async(kind,payload)=>kind==='review'&&reviews++===0?{issues:[{page:3,category:'caption',problem:'配文不顺。',instruction:'只改配文。'}]}:kind==='repair'?{pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1],caption:'庄周醒来，仍记得自己在梦中变成蝴蝶。'}))}:undefined;
 const start=f.control.calls.length,caption=await revise(f,next.id,{plan:narration},snap);await until(async()=>(await f.read(caption.id)).state==='completed');assert.equal(f.control.calls.length,start);
});

test('atomic active child survives restart and deleted parent; lost response replays without duplicate copy or generation',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),requestId=crypto.randomUUID(),changes={artStyle:'paper-cut'};
 const repo=new ReaderRepository(f.app.services.database),row=await forkRevision(repo,f.media,owner,id,requestId,base.token,changes);
 assert.equal(row.generation_control,'active');
 await f.json(`library/${id}`,'DELETE');await f.restart();assert.equal((await f.read(requestId)).generationControl,'active');
 const replay=await revise(f,id,changes,base,requestId);await until(async()=>(await f.read(replay.id)).state==='completed');assert.equal(f.control.calls.length,16);
 const again=await revise(f,id,changes,base,requestId);assert.equal(again.id,requestId);assert.equal(f.control.calls.length,16);
});

test('failed publication INSERT leaves no child and replay publishes one active version',async t=>{
 const {f,id}=await completed(t),base=await snapshot(f,id),changes={artStyle:'paper-cut'},requestId=crypto.randomUUID(),database=f.app.services.database;
 const prepare=database.prepare.bind(database);let injected=false;
 database.prepare=query=>{const statement=prepare(query);if(query.includes('INSERT INTO stories')&&!injected){statement.run=async()=>{injected=true;throw Object.assign(Error('controlled crash'),{code:'ERR_SQLITE_ERROR'});};}return statement;};
 const failed=await f.request(`sessions/${id}/revisions`,'POST',{requestId,token:base.token,changes});assert.equal(failed.status,500);assert.equal(injected,true);assert.equal((await f.request(`sessions/${requestId}`)).status,404);assert.equal(f.control.calls.length,8);
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
 const doc=JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(child.id).first()).document);
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
