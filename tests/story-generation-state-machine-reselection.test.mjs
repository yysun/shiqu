// Verify invisible discovery drafts and shared family commits through the production API/queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,selection,until,turn} from './fixtures/production.mjs';
import {LocalBooks} from '../server/local-books.ts';

const candidates={stories:[{title:'庄周梦蝶',description:'原来的故事。'},{title:'大葫芦',description:'惠子与庄子谈用途。'}],note:''};
const settings={artStyle:'ink-pencil',productionPrompt:'quiet narration',narrativeDetail:'balanced'};
async function fixture(t,held=false){
 const f=await productionFixture(t);f.control.hold=held;
 f.generation.suggestions=async()=>structuredClone(candidates);
 const id=await f.create(3);
 await until(async()=>held?f.control.calls.length===1:(await f.read(id)).state==='completed');
 const original=(await f.json(`sessions/${id}/source`)).source,generator=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>({...generator(),prepareOriginal:async()=>({...original,title:'大葫芦',text:'惠子有大瓠之种，成而无所用，庄子说可以浮于江湖。',storyBrief:undefined})});
 return {f,id};
}
async function draft(f,id){
 const s=await f.json(`sessions/${id}/reselection`,'POST',{requestId:crypto.randomUUID()});
 await f.startDiscovery(s.id);await f.demand(s.id);await until(async()=>(await f.read(s.id)).intake.phase==='choosing');return f.read(s.id);
}
const choose=(f,id,s,body={requestId:crypto.randomUUID(),batch:0,index:1,settings})=>f.json(`sessions/${id}/reselection/${s.id}`,'POST',body);

async function directIntake(t,{beforePrepare}={}){
 const f=await productionFixture(t),bookId='liaozhai';
 f.app.services.localBooks=new LocalBooks(process.cwd());
 f.control.hold=false;
 f.control.beforeText=kind=>kind==='recommend'?beforePrepare?.():undefined;
 const {entries:[first,second]}=await f.json(`books/${bookId}/contents?view=chapters`);
 const original=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,artStyle:'watercolor',bookId,storyTitle:undefined,source:first.source,length:'auto'}});
 const id=original.id,open=()=>f.json(`sessions/${id}/reselection`,'POST',{requestId:crypto.randomUUID()});
 async function selectNext(){
  const draft=await open();
  return f.json(`sessions/${draft.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:draft.intake.generation,action:'conditions',conditions:{bookId,source:second.source,theme:selection.theme,productionPrompt:selection.productionPrompt}});
 }
 const confirm=snapshot=>({requestId:crypto.randomUUID(),generation:snapshot.intake.generation,draftToken:snapshot.intake.draftToken,action:'confirm',settings:snapshot.intake.draft});
 const replace=draft=>({requestId:crypto.randomUUID(),generation:draft.intake.generation,...draft.intake.selected});
 return {f,id,original,first,second,open,selectNext,confirm,replace};
}

test('a paused direct-source intake can cancel or replace before confirmation, and rejects old confirmation',async t=>{
 const {f,id,first,second,open,selectNext,confirm,replace}=await directIntake(t);
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const before=await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 const draft=await open();
 assert.equal((await f.json(`sessions/${id}/current`)).id,id);
 assert.deepEqual((await f.json('sessions')).map(s=>s.id),[id]);
 const cancelled=await f.json(`sessions/${id}/reselection/${draft.id}`,'DELETE');
 assert.equal(cancelled.intake.phase,'confirming');
 assert.deepEqual(cancelled.selection.source,first.source);
 assert.equal((await f.request(`sessions/${id}/revisions`)).status,409);

 const staged=await selectNext(),command=replace(staged),next=await choose(f,id,staged,command);
 assert.deepEqual(next.selection.source,second.source);
 assert.equal(next.revision.parentId,id);
 assert.equal(next.generationControl,'paused');
 assert.equal(next.intake.phase,'preparing');
 assert.deepEqual((await f.json('sessions')).map(s=>s.id),[next.id]);
 assert.equal((await choose(f,id,staged,command)).id,next.id);
 assert.equal((await f.request(`sessions/${id}/setup`,'POST',confirm(before))).status,409);
 const historic=await f.read(id);
 assert.equal(historic.intake.phase,'confirming');
 assert.deepEqual(historic.selection.source,first.source);
 assert.equal(f.control.calls.length,0);
});

test('a prepared story confirmed in another window rejects an older replacement draft',async t=>{
 const {f,id,selectNext,confirm,replace}=await directIntake(t);
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const staged=await selectNext();
 const submittedCalls=f.control.recommendations.length;
 await f.demand(staged.id);
 await f.app.services.production.tick();
 assert.equal((await f.read(staged.id)).intake.phase,'preparing');
 assert.deepEqual(await f.app.services.production.queue.jobs(staged.id,f.app.services.ownerId),[]);
 assert.equal(f.control.recommendations.length,submittedCalls);

 const accepted=await f.json(`sessions/${id}/setup`,'POST',confirm(await f.read(id)));
 assert.equal(accepted.intake.phase,'confirmed');
 const stale=await f.request(`sessions/${id}/reselection/${staged.id}`,'POST',replace(staged));
 assert.equal(stale.status,409);
 assert.equal((await f.json(`sessions/${id}/current`)).id,id);
});

test('preparation can finish and update recommendations while a replacement is open',async t=>{
 const gate=Promise.withResolvers();t.after(gate.resolve);
 let preparing=false;
 const {f,id,original,selectNext,replace}=await directIntake(t,{beforePrepare:()=>{preparing=true;return gate.promise;}});
 await until(()=>preparing);
 const staged=await selectNext();
 gate.resolve();
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const prepared=await f.read(id);
 assert.equal(prepared.intake.generation,original.intake.generation);
 assert.notEqual(prepared.selection.artStyle,original.selection.artStyle);
 const next=await choose(f,id,staged,replace(staged));
 assert.notEqual(next.id,id);
 assert.equal((await f.json(`sessions/${id}/current`)).id,next.id);
});
test('opening and cancelling selection drafts never adds a shelf card; cancellation returns the current saved state',async t=>{
 const {f,id}=await fixture(t),s=await draft(f,id);
 assert.ok(s.reselection);assert.equal((await f.json('sessions')).length,1);
 assert.equal(f.control.calls.length,3);
 const cancelled=await f.json(`sessions/${id}/reselection/${s.id}`,'DELETE');assert.equal(cancelled.id,id);assert.equal(cancelled.state,'completed');
 assert.equal((await f.json('sessions')).length,1);assert.equal((await f.json('deletions')).length,0);
 assert.equal((await f.json(`sessions/${id}/reselection/${s.id}`,'DELETE')).id,id);
});
test('another story replaces one family card, leaves history intact, rejects old editing and replays without reactivation',async t=>{
 const {f,id}=await fixture(t),before=await f.read(id),base=await f.json(`sessions/${id}/revisions`),s=await draft(f,id);
 const body={requestId:crypto.randomUUID(),batch:0,index:1,settings},next=await choose(f,id,s,body);
 assert.equal(next.revision.rootId,id);assert.equal(next.revision.parentId,id);assert.equal(next.selection.storyTitle,'大葫芦');
 await until(async()=>(await f.read(next.id)).intake.phase==='confirming');
 assert.equal((await f.read(next.id)).story,null);assert.equal(f.control.calls.length,3);
 const cards=await f.json('sessions');assert.deepEqual(cards.map(card=>card.id),[next.id]);
 assert.deepEqual((await f.read(id)).story.pages,before.story.pages);
 assert.equal((await f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{artStyle:'watercolor'}})).status,409);
 await f.json(`sessions/${next.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'pause'});
 assert.equal((await choose(f,id,s,body)).generationControl,'paused');
 const other={...body,requestId:crypto.randomUUID()};assert.equal((await f.request(`sessions/${id}/reselection/${s.id}`,'POST',other)).status,409);
 assert.equal((await f.json(`sessions/${id}/current`)).id,next.id);
});
test('changing book and theme discovers replacements on the draft before any version is promoted',async t=>{
 const {f,id}=await fixture(t),before=await f.read(id),seen=[];
 f.generation.suggestions=async selection=>{seen.push(selection);return structuredClone(candidates);};
 const draft=await f.json(`sessions/${id}/reselection`,'POST',{requestId:crypto.randomUUID()});
 assert.equal(seen.length,0);
 const conditions={bookId:'other',customBook:'测试书',theme:'信义考验',discovery:{mode:'auto',themeInput:'preset'},productionPrompt:'保留因果'};
 const action={action:'conditions',requestId:crypto.randomUUID(),generation:draft.intake.generation,conditions};
 const staged=await f.json(`sessions/${draft.id}/setup`,'POST',action);
 assert.equal(staged.intake.search.state,'searching');
 assert.deepEqual((await f.json('sessions')).map(s=>s.id),[id]);
 await f.demand(draft.id);await until(async()=>(await f.read(draft.id)).intake.batches.length>0);
 assert.equal(seen[0].customBook,conditions.customBook);assert.equal(seen[0].theme,conditions.theme);
 const saved=await f.read(draft.id),next=await choose(f,id,saved,{requestId:crypto.randomUUID(),batch:0,index:1,generation:saved.intake.generation});
 assert.equal(next.selection.customBook,conditions.customBook);assert.equal(next.selection.theme,conditions.theme);
 assert.equal(next.selection.productionPrompt,conditions.productionPrompt);
 assert.deepEqual((await f.read(id)).story,before.story);
});
test('a pause arriving after the picker opens is inherited at commit, and only explicit resume prepares',async t=>{
 const {f,id}=await fixture(t,true),s=await draft(f,id),before=f.control.recommendations.length;
 await f.json(`sessions/${id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'pause'});
 const next=await choose(f,id,s);assert.equal(next.generationControl,'paused');assert.equal(next.intake.phase,'preparing');
 await f.app.services.production.tick();await turn();assert.equal(f.control.recommendations.length,before);
 f.control.calls[0].resolve();f.control.hold=false;
 await f.json(`sessions/${next.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'resume'});
 await until(async()=>(await f.read(next.id)).intake.phase==='confirming');
 assert.equal(f.control.calls.length,1);assert.equal((await f.read(next.id)).story,null);
});

test('same source selection is a durable no-op, including replay after the draft is discarded',async t=>{
 const {f,id}=await fixture(t),source={edition:'a'.repeat(64),sectionId:'chapter',firstUnit:'u1',lastUnit:'u1'};
 await f.app.services.database.prepare("UPDATE stories SET selection=json_set(selection,'$.source',json(?)) WHERE id=?").bind(JSON.stringify(source),id).run();
 f.generation.suggestions=async()=>({stories:[{...candidates.stories[0],source}],note:''});
 const s=await draft(f,id),body={requestId:crypto.randomUUID(),batch:0,index:0,settings};
 assert.equal((await choose(f,id,s,body)).id,id);assert.equal((await choose(f,id,s,body)).id,id);assert.equal((await f.json('sessions')).length,1);assert.equal(f.control.calls.length,3);
 const children=await f.app.services.database.prepare("SELECT id FROM stories WHERE json_extract(document,'$.revision.rootId')=?").bind(id).all();assert.equal(children.results.length,0);
});
test('concurrent ordinary edit and replacement share one family CAS; stale choice remains inspectable',async t=>{
 const {f,id}=await fixture(t),s=await draft(f,id),base=await f.json(`sessions/${id}/revisions`),body={requestId:crypto.randomUUID(),batch:0,index:1,settings},plan=structuredClone(base.plan);plan.reflection='醒来后，仍能记住梦中的自由。';
 const results=await Promise.all([f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan}}),f.request(`sessions/${id}/reselection/${s.id}`,'POST',body)]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.status===409).length,1);assert.equal((await f.json('sessions')).length,1);
 const current=await f.json(`sessions/${id}/current`);assert.notEqual(current.id,id);
 const cancelled=await f.json(`sessions/${id}/reselection/${s.id}`,'DELETE');assert.equal(cancelled.id,current.id);
});
test('cancel follows another window current version and never revives a deleted latest version',async t=>{
 const {f,id}=await fixture(t),a=await draft(f,id),b=await draft(f,id),next=await choose(f,id,b);
 assert.equal((await f.json(`sessions/${id}/reselection/${a.id}`,'DELETE')).id,next.id);
 await f.json(`library/${next.id}`,'DELETE');assert.equal((await f.request(`sessions/${id}/current`)).status,404);
 assert.equal((await f.request(`sessions/${id}/reselection/${a.id}`,'DELETE')).status,404);assert.deepEqual(await f.json('sessions'),[]);
});
for(const stopped of [false,true])test(`replacement of a ${stopped?'stopped':'failed active'} story inherits current control but clears only the new work`,async t=>{
 const {f,id}=await fixture(t,true);f.control.calls[0].reject(Error('controlled old story failure'));await until(async()=>(await f.read(id)).state==='failed');
 if(stopped)await f.json(`sessions/${id}/production-control`,'POST',{action:'stop'});
 const old=await f.read(id),rawOf=()=>f.app.services.database.prepare('SELECT state,error,generation_control FROM stories WHERE id=?').bind(id).first(),rawBefore=await rawOf(),s=await draft(f,id),next=await choose(f,id,s);assert.equal(next.generationControl,stopped?'stopped':'active');assert.equal(next.error,null);assert.equal(next.faults,undefined);
 assert.deepEqual(await rawOf(),rawBefore,'the replaced story row is left untouched');const history=await f.app.services.database.prepare('SELECT message FROM reader_faults WHERE id=?').bind(old.faults[0].id).first();assert.equal(history.message,old.faults[0].message);assert.equal(f.control.calls.length,1);
 if(stopped){await f.app.services.production.tick();assert.equal((await f.read(next.id)).intake.phase,'preparing');await f.json(`sessions/${next.id}/production-control`,'POST',{action:'resume'});}
 await until(async()=>(await f.read(next.id)).intake.phase==='confirming');assert.equal(f.control.calls.length,1);
});
test('cancel after old in-flight completion returns its new saved checkpoint without resetting it',async t=>{
 const {f,id}=await fixture(t,true),s=await draft(f,id);f.control.hold=false;f.control.calls[0].resolve();await until(async()=>(await f.read(id)).state==='completed');
 const result=await f.json(`sessions/${id}/reselection/${s.id}`,'DELETE');assert.equal(result.state,'completed');assert.equal(result.ready,3);assert.equal(f.control.calls.length,3);
});

test('a matching title without verifiable source identity is not silently discarded as the current story',async t=>{
 const {f,id}=await fixture(t),s=await draft(f,id);const next=await choose(f,id,s,{requestId:crypto.randomUUID(),batch:0,index:0,settings});assert.notEqual(next.id,id);assert.equal(next.revision.rootId,id);assert.equal((await f.json('sessions')).length,1);
});

test('a committed replacement occupies its request ID across families and command kinds',async t=>{
 const {f,id}=await fixture(t),s=await draft(f,id),requestId=crypto.randomUUID(),body={requestId,batch:0,index:1,settings},next=await choose(f,id,s,body);
 assert.equal((await choose(f,id,s,body)).id,next.id);
 assert.equal((await f.request(`sessions/${next.id}/production-control`,'POST',{requestId,action:'pause'})).status,409);
 assert.equal((await f.request('sessions','POST',{requestId,selection:{bookId:'zhuangzi',theme:'新的创建',length:1}})).status,409);
 const other=await f.create(3);await until(async()=>(await f.read(other)).state==='completed');const otherDraft=await draft(f,other);
 assert.equal((await f.request(`sessions/${other}/reselection/${otherDraft.id}`,'POST',body)).status,409);assert.equal((await f.json('sessions')).length,2);
});
