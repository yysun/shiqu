// Exercise paused edits against real SQLite, workers and media without contacting a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,makePlan,selection} from './fixtures/production.mjs';
import {revisionImpact,checkedRevision} from '../lib/reader-revision.ts';
import {latestStoryVersions} from '../lib/reader-versions.ts';
import {readLibrarySummary} from '../desktop/library-preview.ts';
const owner='docker-local-owner';
const submit=(f,id,base,changes,requestId=crypto.randomUUID(),paused=true)=>f.json(`sessions/${id}/revisions`,'POST',{requestId,token:base.token,changes,paused});
const ids=rows=>rows.map(row=>row.id).sort();

test('a paused unfinished storyboard can be revised; late work, replay and restart do not resume or overwrite it',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 let release,entered=false;
 const held=new Promise(resolve=>release=resolve);
 f.control.beforeText=async kind=>{if(kind==='plan'&&!entered){entered=true;await held;}};
 const id=await f.create(4);t.after(()=>release());await until(()=>entered);
 assert.equal((await f.request(`sessions/${id}/revisions`)).status,409,'Unfinished work must be paused first');
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 const base=await f.json(`sessions/${id}/revisions`);assert.equal(base.plan,null);
 assert.equal(revisionImpact(base,{}).changed,false);
 const changes={artStyle:'paper-cut',productionPrompt:'新要求，清楚交代动作。',length:3},requestId=crypto.randomUUID();
 const child=await submit(f,id,base,changes,requestId);
 assert.equal(child.revision.rootId,id);assert.equal(child.revision.number,2);assert.equal(child.generationControl,'paused');assert.equal(child.story,null);
 assert.equal((await f.read(id)).generationControl,'paused');
 release();await until(async()=>(await f.read(id)).state!=='running');await f.app.services.production.tick();
 assert.equal((await f.read(child.id)).selection.productionPrompt,changes.productionPrompt);
 assert.equal((await f.read(child.id)).generationControl,'paused');assert.equal(f.control.plans.length,1);assert.equal(f.control.calls.length,0);
 assert.deepEqual(ids(await f.json('sessions')),[child.id]);
 assert.deepEqual(ids(readLibrarySummary(f.dataDirectory).stories),[child.id]);
 await f.restart();assert.equal((await f.read(child.id)).generationControl,'paused');
 assert.equal((await submit(f,id,base,changes,requestId)).id,child.id);
 assert.equal((await f.read(child.id)).generationControl,'paused');assert.equal(f.control.plans.length,1);
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(child.id)).state==='completed');
 const done=await f.read(child.id);assert.equal(done.story.pages.length,3);assert.equal(done.selection.artStyle,'paper-cut');assert.equal(f.control.calls.length,3);
 await submit(f,id,base,changes,requestId);assert.equal((await f.read(child.id)).state,'completed');assert.equal(f.control.calls.length,3);
});

test('saving pauses the old version, keeps favorites and valid progress; replay respects later resume and pause',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(4);await until(async()=>(await f.read(id)).state==='completed');
 await f.json(`library/${id}/favorite`,'POST',{saved:true});
 await f.app.services.database.prepare('UPDATE reader_sessions SET page=3,last_read_at=? WHERE id=?').bind('2026-10-30T12:00:00Z',id).run();
 const base=await f.json(`sessions/${id}/revisions`),changes={length:2},requestId=crypto.randomUUID(),before=f.control.calls.length;
 const child=await submit(f,id,base,changes,requestId);assert.equal(child.saved,true);assert.equal(child.page,1);assert.equal(child.lastReadAt,'2026-10-30T12:00:00Z');
 assert.equal(child.generationControl,'paused');await f.app.services.production.tick();assert.equal(f.control.calls.length,before);
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'resume'});
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'pause'});
 await submit(f,id,base,changes,requestId);assert.equal((await f.read(child.id)).generationControl,'paused');
 const changedIntent=await f.request(`sessions/${id}/revisions`,'POST',{requestId,token:base.token,changes,paused:false});assert.equal(changedIntent.status,409);
 const rows=await f.app.services.database.prepare("SELECT id FROM reader_sessions WHERE json_extract(document,'$.revision.rootId')=?").bind(id).all();assert.equal(rows.results.length,1);
});

test('latest means submitted version, independent of status, reads, deletion and owner; independent same-title stories stay separate',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(3);await until(async()=>(await f.read(id)).state==='completed');
 const sameTitle=await f.create(3);await until(async()=>(await f.read(sameTitle)).state==='completed');
 const base=await f.json(`sessions/${id}/revisions`),child=await submit(f,id,base,{productionPrompt:'重新讲述。'});
 for(const state of ['idle','failed']){
  await f.app.services.database.prepare('UPDATE reader_sessions SET state=? WHERE id=?').bind(state,child.id).run();
  await f.app.services.database.prepare('UPDATE reader_sessions SET last_read_at=? WHERE id=?').bind('2099-01-01',id).run();
  assert.deepEqual(ids(await f.json('sessions')),ids([child,{id:sameTitle}]));
  assert.deepEqual(ids(readLibrarySummary(f.dataDirectory).stories),ids([child,{id:sameTitle}]));
 }
 const foreign=crypto.randomUUID();
 await f.app.services.database.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,state,created_at,updated_at) SELECT ?,'other-owner',selection,json_set(document,'$.revision.number',999),'idle',created_at,updated_at FROM reader_sessions WHERE id=?").bind(foreign,child.id).run();
 assert.deepEqual(ids(await f.json('sessions')),ids([child,{id:sameTitle}]));
 assert.equal((await f.request(`sessions/${id}`)).status,200,'Historical record remains directly readable');
 await f.json(`library/${child.id}`,'DELETE');assert.deepEqual(ids(await f.json('sessions')),[sameTitle]);
 assert.equal(readLibrarySummary(f.dataDirectory).stories.some(row=>row.id===id),false);
 await f.json(`library/${child.id}/restore`,'POST');assert.deepEqual(ids(await f.json('sessions')),ids([child,{id:sameTitle}]));
 assert.equal((await f.read(child.id)).generationControl,'stopped');
});

test('pre-confirmation drafts cannot bypass intake; empty-plan impact does not invent changes or reusable artwork',async t=>{
 const f=await productionFixture(t);f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后思考自己。'}],note:''});
 const id=crypto.randomUUID();await f.json('sessions','POST',{requestId:id,intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}});
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 assert.equal((await f.request(`sessions/${id}/revisions`)).status,409);
 const base={selection:{...selection,length:5},plan:null,images:[]};
 assert.equal(revisionImpact(base,{}).changed,false);assert.equal(revisionImpact(base,{artStyle:'paper-cut'}).replan,true);
 const revision=checkedRevision(base,{productionPrompt:'new'});assert.equal(revision.plan,null);assert.equal(revision.selection.length,5);
 assert.throws(()=>checkedRevision(base,{plan:makePlan(5)}),/完整分镜/);
});

test('client snapshots cannot replace the latest card with a historical direct read',()=>{
 const root={id:'root'},second={id:'second',revision:{rootId:'root',parentId:'root',number:2}},third={id:'third',revision:{rootId:'root',parentId:'second',number:3}},other={id:'same-title-independent'};
 assert.deepEqual(ids(latestStoryVersions([root,second,other,third])),['same-title-independent','third']);
 assert.deepEqual(ids(latestStoryVersions([root,third,other,second])),['same-title-independent','third']);
});

test('paused preparation saves settings beside a live call, then allows a different candidate without resuming',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后思考自己。'},{title:'大葫芦',description:'讨论葫芦的用处。'}],note:''});
 let release,entered=false;const held=new Promise(resolve=>release=resolve),generator=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>{const g=generator();return {...g,async recommend(...args){entered=true;await held;return g.recommend(...args);}};};
 t.after(()=>release());const id=crypto.randomUUID();await f.json('sessions','POST',{requestId:id,intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}});
 await until(async()=>(await f.read(id)).intake.phase==='choosing');
 const setup=async action=>f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,...action});
 await setup({action:'choose',batch:0,index:0});await until(()=>entered);
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 const settings={artStyle:'watercolor',productionPrompt:'保留手动修改。',narrativeDetail:'balanced',length:5};
 await setup({action:'draft',settings});assert.equal((await f.read(id)).state,'running');
 release();await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const saved=await f.read(id);assert.deepEqual(saved.intake.draft,settings);assert.equal(saved.generationControl,'paused');
 const other=await setup({action:'choose',batch:0,index:1,settings});assert.equal(other.selection.storyTitle,'大葫芦');assert.equal(other.generationControl,'paused');
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

for(const paused of [true,false])test(`concurrent ${paused?'paused':'running'} submission replay cannot overwrite a later user control`,async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(3);await until(async()=>(await f.read(id)).state==='completed');f.control.hold=true;
 const base=await f.json(`sessions/${id}/revisions`),requestId=crypto.randomUUID(),payload={requestId,token:base.token,changes:{artStyle:'paper-cut'},paused};
 const production=f.app.services.production,control=production.control.bind(production);
 let arrived=0,ready,release;const both=new Promise(resolve=>ready=resolve),delayed=new Promise(resolve=>release=resolve);t.after(()=>{ready();release();});
 production.control=async(...args)=>{
  if(args[1]===requestId&&args[3]){
   arrived++;if(arrived===1)await both;else if(arrived===2){ready();await delayed;}
  }
  return control(...args);
 };
 const first=f.request(`sessions/${id}/revisions`,'POST',payload);await until(()=>arrived===1);
 const second=f.request(`sessions/${id}/revisions`,'POST',payload);await until(()=>arrived===2);
 assert.equal((await first).status,201);
 await f.json(`sessions/${requestId}/production-control`,'POST',{action:paused?'resume':'pause'});
 release();assert.equal((await second).status,201);
 assert.equal((await f.read(requestId)).generationControl,paused?'active':'paused');
});
