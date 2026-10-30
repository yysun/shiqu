// Prove that drafts, selections and searches survive each other, using real SQLite and files with a controlled provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {productionFixture,until,selection} from './fixtures/production.mjs';
import {shelfGenerationStatus} from '../lib/shelf-generation.ts';
import {generationProgress,redrawNotice} from '../lib/generation-progress.ts';

const owner='docker-local-owner';
const batch={stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}},{title:'大葫芦',description:'惠子与庄子谈论大葫芦的用处。',artRecommendation:{artStyle:'watercolor',reason:'适合。'}}],note:''};
const settings={artStyle:'watercolor',productionPrompt:'my edits',narrativeDetail:'balanced'};
async function fixture(t){const f=await productionFixture(t);f.control.hold=false;f.discoveries=[];f.generation.suggestions=async()=>{f.discoveries.push(1);return structuredClone(batch);};return f;}
const create=async f=>(await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}})).id;
const setup=async(f,id,action,s)=>f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(s||await f.read(id)).intake.generation,...action});
const setupStatus=async(f,id,action)=>(await f.request(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,...action})).status;
const phase=(f,id,value)=>until(async()=>{await f.app.services.production.tick();return (await f.read(id)).intake.phase===value;});
const searchIs=(f,id,value)=>until(async()=>{await f.app.services.production.tick();return (await f.read(id)).intake.search.state===value;});
async function prepared(f){const id=await create(f);await phase(f,id,'choosing');await searchIs(f,id,'idle');await setup(f,id,{action:'choose',batch:0,index:0});await phase(f,id,'confirming');await f.app.services.production.tick();await f.app.services.production.queue.settle();await f.app.services.production.tick();return id;}
const jobs=async(f,id,kind)=>(await f.app.services.database.prepare(`SELECT * FROM production_jobs WHERE session_id=?${kind?' AND kind=?':''}`).bind(id,...(kind?[kind]:[])).all()).results;
// The second candidate has no real source; reuse the saved text so that choosing it can prepare.
async function reuseSource(f,id){const source=(await f.json(`sessions/${id}/source`)).source,generator=f.generation.generator.bind(f.generation);f.generation.generator=()=>({...generator(),prepareOriginal:async()=>source});}
const stored=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first()).document);
// A provider call that ends when it is told to stop, as the local reading loop does between calls.
function heldSearch(f){
 const held={};
 f.generation.suggestions=async(_s,_e,_l,reading)=>{f.discoveries.push(1);held.reading=reading;await new Promise((resolve,reject)=>{held.release=()=>resolve();held.fail=reject;reading?.signal.addEventListener('abort',()=>reject(reading.signal.reason),{once:true});});return structuredClone(batch);};
 return held;
}

test('images and progress never invalidate a draft on a story still drawing',async t=>{
 const f=await productionFixture(t),id=await f.create(6);await until(()=>f.control.calls.length===1);
 const base=await f.json(`sessions/${id}/revisions`),plan=structuredClone(base.plan);plan.reflection='读者写下的新余味。';
 f.control.calls[0].resolve();await until(async()=>(await f.read(id)).ready===1);
 assert.equal((await f.json(`sessions/${id}/revisions`)).token,base.token,'A new image is not a conflict');
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan}});
 assert.equal(child.revision.parentId,id);assert.equal(child.ready,1,'The image saved after the draft began is reused');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
});

test('a real change conflicts, and the same submission stays idempotent',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(4);await until(async()=>(await f.read(id)).state==='completed');
 const base=await f.json(`sessions/${id}/revisions`),plan=structuredClone(base.plan);plan.reflection='第一份修改写下的余味。';
 const requestId=crypto.randomUUID(),first=await f.json(`sessions/${id}/revisions`,'POST',{requestId,token:base.token,changes:{plan}});
 assert.equal((await f.json(`sessions/${id}/revisions`,'POST',{requestId,token:base.token,changes:{plan}})).id,first.id);
 const other=structuredClone(base.plan);other.reflection='第二份修改写下的余味。';
 assert.equal((await f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan:other}})).status,409,'A sibling changed the version family');
});

test('a blocked story shows every issue, can be edited, and draws on the reader\'s word exactly once',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 f.control.beforeText=async kind=>kind==='review'?{issues:[1,2,3,4].map(page=>({page,category:'caption',problem:`第${page}幅配文含混。`,instruction:'说清楚。'}))}:undefined;
 const id=await f.create(4);await until(async()=>(await f.read(id)).state==='failed',15000);
 const blocked=await f.read(id);assert.equal(blocked.reviewIssues.length,4,'The error text only summarizes; the view lists them all');assert.equal(blocked.story.pages[0].image,'');assert.equal(f.control.calls.length,0);
 const reviews=f.control.reviews.length,repairs=f.control.repairs.length;
 assert.equal((await f.request(`sessions/${id}/revisions`)).status,200);
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 const held=await f.json(`sessions/${id}/review-override`,'POST',{});assert.equal(held.generationControl,'paused');assert.equal(held.state,'idle');assert.equal(held.error,null);
 await f.app.services.production.tick();await f.app.services.production.queue.settle();await f.app.services.production.tick();assert.equal(f.control.calls.length,0,'Paused: recorded, not drawn');
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(id)).state==='completed',15000);
 assert.equal(f.control.calls.length,4);assert.equal(f.control.reviews.length,reviews,'No further review');assert.equal(f.control.repairs.length,repairs,'No repair of what the reader accepted');
 const done=await f.read(id);assert.equal(done.generationProgress.reviewOverridden,true);assert.equal(generationProgress(done,Date.now()).steps.find(s=>s.id==='recheck').detail,'未解决的问题由你确认放行');
 assert.equal((await f.request(`sessions/${id}/review-override`,'POST',{})).status,200,'A lost response can be repeated');assert.equal(f.control.calls.length,4);
 assert.equal((await jobs(f,id)).filter(job=>['queued','failed'].includes(job.state)).length,0,'Nothing is left waiting on the finished story');
 f.control.beforeText=null;const healthy=await f.create(1);await until(async()=>(await f.read(healthy)).state==='completed');assert.equal((await f.request(`sessions/${healthy}/review-override`,'POST',{})).status,409);
});

test('a blocked revision that reused its first image can still be drawn past',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(4);await until(async()=>(await f.read(id)).state==='completed');
 const base=await f.json(`sessions/${id}/revisions`),plan=structuredClone(base.plan);plan.pages[1].caption='庄周醒来，看着窗外，仍记得梦中自在飞翔的感觉。';
 f.control.beforeText=async(kind,payload)=>kind==='review'?{issues:[{page:3,category:'caption',problem:'配文含混。',instruction:'说清楚。'}]}:kind==='repair'?{pages:[{page:3,caption:payload.plan.pages[2].caption,prompt:payload.plan.pages[2].prompt}]}:undefined;
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan}});
 await until(async()=>(await f.read(child.id)).state==='failed',15000);
 const blocked=await f.read(child.id);assert.ok(blocked.story.pages[0].image,'The first image was reused');assert.equal(blocked.reviewIssues.length,1);assert.equal(blocked.retryStage,'review');
 const before=f.control.calls.length;await f.json(`sessions/${child.id}/review-override`,'POST',{});
 await until(async()=>(await f.read(child.id)).state==='completed',15000);assert.equal(f.control.calls.length,before,'Every image was reusable');
 const stages=generationProgress(await f.read(child.id),Date.now()).steps;
 assert.equal(stages.find(s=>s.id==='recheck').detail,'未解决的问题由你确认放行');assert.notEqual(stages.find(s=>s.id==='review').detail,'初审通过');assert.notEqual(stages.find(s=>s.id==='repair').state,'skipped');
});

test('repeating draw anyway cannot redraw a failed image or clear its marker',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 f.control.beforeText=async kind=>kind==='review'?{issues:[{page:1,category:'caption',problem:'配文含混。',instruction:'说清楚。'}]}:undefined;
 const id=await f.create(2);await until(async()=>(await f.read(id)).state==='failed',15000);
 f.control.beforeText=null;await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});await f.json(`sessions/${id}/review-override`,'POST',{});
 await f.app.services.production.queue.enqueue({id:crypto.randomUUID(),sessionId:id,ownerId:owner,kind:'image',pool:'image',version:'x',dependencies:[],payload:{page:1},priority:1});
 await f.app.services.database.prepare("UPDATE production_jobs SET state='failed',error='图片失败' WHERE session_id=? AND kind='image'").bind(id).run();
 await f.json(`sessions/${id}/review-override`,'POST',{});
 assert.equal((await jobs(f,id,'image'))[0].state,'failed');
});

test('a lost image is redrawn in the new version rather than blocking it',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(4);await until(async()=>(await f.read(id)).state==='completed');
 const s=await f.read(id),file=page=>path.join(f.dataDirectory,'media',s.story.pages[page].image.replace('/api/reader/media/','reader/'));
 await rm(file(2),{force:true});
 const after=await f.json(`sessions/${id}/revisions`);const plan=structuredClone(after.plan);plan.pages[1].caption='庄周醒来，看着窗外，仍记得梦中自在飞翔的感觉。';
 const before=f.control.calls.length;
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:after.token,changes:{plan}});
 await until(async()=>(await f.read(child.id)).state==='completed',15000);
 assert.equal(f.control.calls.length-before,1,'Only the lost page is drawn again');
 const done=await f.read(child.id);assert.deepEqual(done.revision.redraw,{previewed:0,actual:1,reason:'lost'});assert.match(redrawNotice(done.revision.redraw),/实际需重绘 1 幅（预览 0 幅）/);
 assert.ok(!(await stored(f,id)).images.some(value=>!value),'The original keeps its saved image references');
 const g=await productionFixture(t);g.control.hold=false;const whole=await g.create(3);await until(async()=>(await g.read(whole)).state==='completed');
 const lost=await g.read(whole);await rm(path.join(g.dataDirectory,'media',lost.story.pages[2].image.replace('/api/reader/media/','reader/')),{force:true});
 const base=await g.json(`sessions/${whole}/revisions`),replan=await g.request(`sessions/${whole}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{length:5}});
 assert.equal(replan.status,201,'A count change does not depend on old images');
});

test('a lost first image redraws everything, and an unreadable one creates nothing',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(3);await until(async()=>(await f.read(id)).state==='completed');
 const s=await f.read(id);await rm(path.join(f.dataDirectory,'media',s.story.pages[0].image.replace('/api/reader/media/','reader/')),{force:true});
 const base=await f.json(`sessions/${id}/revisions`),plan=structuredClone(base.plan);plan.pages[1].caption='庄周醒来，看着窗外，仍记得梦中自在飞翔的感觉。';
 const media=f.app.services.media,get=media.get.bind(media);media.get=async()=>{throw Error('disk busy');};
 const requestId=crypto.randomUUID(),busy=await f.request(`sessions/${id}/revisions`,'POST',{requestId,token:base.token,changes:{plan}});
 media.get=get;assert.equal(busy.status,503);assert.equal((await f.request(`sessions/${requestId}`)).status,404,'No new version from a temporary read failure');
 const before=f.control.calls.length,child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan}});
 await until(async()=>(await f.read(child.id)).state==='completed',15000);
 assert.equal(f.control.calls.length-before,3);assert.equal((await f.read(child.id)).revision.redraw.reason,'first-lost');
});

test('review changing the first frame reports the real redraw count; no preview, no notice',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(8);await until(async()=>(await f.read(id)).state==='completed');
 const base=await f.json(`sessions/${id}/revisions`),plan=structuredClone(base.plan);plan.pages[3].caption='庄周醒来，看着窗外，仍记得梦中自在飞翔的感觉。';
 let flagged=false;f.control.beforeText=async kind=>{if(kind==='review'&&!flagged){flagged=true;return {issues:[{page:1,category:'action',problem:'动作不清楚。',instruction:'说清动作。'}]};}};
 const before=f.control.calls.length,child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan}});
 await until(async()=>(await f.read(child.id)).state==='completed',15000);
 assert.equal(f.control.calls.length-before,8);assert.deepEqual((await f.read(child.id)).revision.redraw,{previewed:0,actual:8,reason:'first-changed'});
 const latest=await f.json(`sessions/${child.id}/revisions`),replan=await f.json(`sessions/${child.id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:latest.token,changes:{productionPrompt:'全新的制作要求。'}});
 await until(async()=>(await f.read(replan.id)).state==='completed',15000);assert.equal((await f.read(replan.id)).revision.redraw,undefined);
});

test('searching leaves preparation alone, and neither loses the other\'s saved state',async t=>{
 const f=await fixture(t),id=await create(f);await phase(f,id,'choosing');await searchIs(f,id,'idle');
 const generator=f.generation.generator.bind(f.generation);let release,started=false;
 f.generation.generator=()=>{const g=generator();return {...g,recommend:async(...args)=>{started=true;await new Promise(r=>release=r);return g.recommend(...args);}};};
 await setup(f,id,{action:'choose',batch:0,index:0});await until(()=>started);
 const running=await f.read(id);assert.equal(running.state,'running');assert.equal(running.intake.generation,1);
 await setup(f,id,{action:'more'},running);
 assert.equal((await f.read(id)).intake.generation,1,'A search is not a new selection');
 await setup(f,id,{action:'draft',settings:{...settings,length:5}},running);
 assert.equal((await f.read(id)).state,'running','A draft leaves the running step and its lock in place');
 release();await phase(f,id,'confirming');await searchIs(f,id,'idle');
 const s=await f.read(id);assert.equal(s.intake.batches.length,2,'The search ran once preparation freed the text slot');assert.deepEqual(s.intake.draft,{...settings,length:5},'The worker save kept the draft');assert.equal(s.frameRecommendation.count,7);assert.equal(f.discoveries.length,2);
});

test('a queued preparation survives a search requested before it starts',async t=>{
 const f=await fixture(t),id=await create(f);await phase(f,id,'choosing');await searchIs(f,id,'idle');
 const s=await setup(f,id,{action:'choose',batch:0,index:0});
 const after=await setup(f,id,{action:'more'},s);
 assert.equal(after.intake.phase,'preparing');assert.deepEqual(after.intake.selected,{batch:0,index:0});assert.equal(after.selection.storyTitle,'庄周梦蝶');
 await phase(f,id,'confirming');assert.equal((await f.read(id)).frameRecommendation.count,7);
 await setup(f,id,{action:'confirm',settings:{...settings,length:2}});await until(async()=>(await f.read(id)).state==='completed');
});

test('observing a choice survives a dropped connection',async()=>{
 const {observeStoryGeneration}=await import('../lib/reader-production-client.ts');
 const waiting={state:'idle',intake:{phase:'confirming',search:{state:'idle'}}};let calls=0,active=true;
 const result=await observeStoryGeneration({sessionId:'x',watchChoices:true,isActive:()=>active,onSession:()=>{},sleep:async()=>{},request:async()=>{calls++;if(calls===1)return waiting;if(calls<8)throw Error('offline');active=false;return waiting;}});
 assert.equal(result,'');assert.equal(calls,8,'Keeps trying past the three failures that stop other observers');
 // A refusal will not come back: another device deleted the story, so the page is told.
 let refused=0;
 const gone=await observeStoryGeneration({sessionId:'x',watchChoices:true,isActive:()=>true,onSession:()=>{},sleep:async()=>{},request:async()=>{refused++;if(refused===1)return waiting;throw Object.assign(Error('这篇故事不在你的书架里'),{status:404});}});
 assert.equal(gone,'这篇故事不在你的书架里');assert.equal(refused,4);
});

test('a failed search leaves a prepared story confirmable without repeating any work',async t=>{
 const f=await fixture(t),id=await prepared(f),before=f.control.recommendations.length;
 f.generation.suggestions=async()=>{throw Error('controlled failure');};
 await setup(f,id,{action:'more'});await searchIs(f,id,'failed');
 const s=await f.read(id);assert.equal(s.state,'idle');assert.equal(s.error,null);assert.equal(s.intake.phase,'confirming');assert.ok(s.intake.search.error);assert.equal(s.retryAllowed,false);assert.equal(shelfGenerationStatus(s).group,'待制作确认');
 const {readLibrarySummary}=await import('../desktop/library-preview.ts'),summary=readLibrarySummary(f.dataDirectory).stories.find(row=>row.id===id);assert.equal(summary.failed,0);assert.equal(summary.state,'idle');assert.equal(summary.production.intakePhase,'confirming');
 f.generation.suggestions=async()=>({stories:[],note:'暂无更多。'});
 await setup(f,id,{action:'more'});await searchIs(f,id,'idle');assert.equal((await f.read(id)).intake.batches.length,2,'Retrying the search appends');
 assert.equal(f.control.recommendations.length,before);
 await setup(f,id,{action:'confirm',settings:{...settings,length:2}});await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.recommendations.length,before);
});

test('a candidate can be chosen while a search runs, and the search carries on',async t=>{
 const f=await fixture(t),id=await create(f);await phase(f,id,'choosing');await searchIs(f,id,'idle');
 const held=heldSearch(f);await setup(f,id,{action:'more'});await until(()=>held.reading);
 const s=await f.read(id);assert.equal(s.intake.phase,'discovering');assert.equal(s.productionState,'running');assert.equal(s.state,'idle');
 const summaryRow=(await import('../desktop/library-preview.ts')).readLibrarySummary(f.dataDirectory).stories.find(row=>row.id===id);assert.equal(summaryRow.running,1,'Finding a story is what this story is doing');
 const chosen=await setup(f,id,{action:'choose',batch:0,index:1},s);assert.equal(chosen.intake.phase,'preparing');assert.equal(held.reading.signal.aborted,false);
 held.release();await searchIs(f,id,'idle');const after=await f.read(id);assert.equal(after.intake.batches.length,2);assert.equal(after.intake.phase,'preparing','The result does not move the phase of a chosen story');
});

test('confirming ends the search: nothing queued starts and nothing late is added',async t=>{
 const f=await fixture(t),id=await prepared(f);
 const held=heldSearch(f);await setup(f,id,{action:'more'});await until(()=>held.reading);
 await setup(f,id,{action:'confirm',settings:{...settings,length:2}});
 assert.equal((await f.read(id)).intake.search.state,'idle');
 await f.app.services.production.tick();assert.equal(held.reading.signal.aborted,true,'A running search stops at its current call');
 await until(async()=>(await f.read(id)).state==='completed');assert.equal((await f.read(id)).intake.batches.length,1);assert.equal(f.discoveries.length,2);
 // A queued search in the same position is removed rather than left to be checked forever.
 const g=await fixture(t),queued=await prepared(g),busy=heldSearch(g),other=await create(g);await until(()=>busy.reading);
 await setup(g,queued,{action:'more'});await g.app.services.production.tick();
 assert.equal((await jobs(g,queued,'discover')).filter(job=>job.state==='queued').length,1,'Waiting behind the other story');
 await setup(g,queued,{action:'confirm',settings:{...settings,length:1}});await g.app.services.production.tick();
 assert.equal((await jobs(g,queued,'discover')).filter(job=>job.state==='queued').length,0);
 busy.release();await until(async()=>(await g.read(other)).intake.search.state==='idle');await until(async()=>(await g.read(queued)).state==='completed');
});

test('clicking the selected story redoes nothing; a stale device can retry from what is saved',async t=>{
 const f=await fixture(t),id=await prepared(f),before=f.control.recommendations.length,s=await f.read(id);
 const same=await setup(f,id,{action:'choose',batch:0,index:0,settings},s);assert.equal(same.intake.generation,s.intake.generation);assert.equal(same.frameRecommendation.count,7);
 await f.app.services.production.tick();assert.equal(f.control.recommendations.length,before);
 // Another device picks a different story; this one's choice is refused, then works against the latest.
 await reuseSource(f,id);
 await setup(f,id,{action:'choose',batch:0,index:1},s);
 const stale=await f.request(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:s.intake.generation,action:'confirm',settings:{...settings,length:2}});assert.equal(stale.status,409);
 await phase(f,id,'confirming');await setup(f,id,{action:'confirm',settings:{...settings,length:2}});await until(async()=>(await f.read(id)).state==='completed');
});

test('art recommendations apply until the reader really changes the style',async t=>{
 const f=await fixture(t),id=await prepared(f),first=await f.read(id);assert.equal(first.selection.artStyle,'paper-cut');
 await reuseSource(f,id);
 await setup(f,id,{action:'choose',batch:0,index:1,settings:{artStyle:'paper-cut',productionPrompt:first.selection.productionPrompt,narrativeDetail:'balanced'}},first);await phase(f,id,'confirming');
 const second=await f.read(id);assert.equal(second.selection.artStyle,'watercolor','Sending back the recommended style is not a manual choice');assert.equal(second.intake.manualArt,false);
 await setup(f,id,{action:'choose',batch:0,index:0,settings:{artStyle:'ink-pencil',productionPrompt:'',narrativeDetail:'balanced'}},second);await phase(f,id,'confirming');
 const third=await f.read(id);assert.equal(third.selection.artStyle,'ink-pencil');assert.equal(third.intake.manualArt,true);
});

test('saved settings survive a search and a restart, and reset only with the story or a new recommendation',async t=>{
 const f=await fixture(t),id=await prepared(f);await reuseSource(f,id);
 const draft={...settings,length:5},s=await setup(f,id,{action:'draft',settings:draft});assert.deepEqual(s.intake.draft,draft);assert.equal(s.selection.artStyle,'paper-cut','Selection stays put, so no job version changes');assert.equal(s.intake.manualArt,true);
 await setup(f,id,{action:'more'});await searchIs(f,id,'idle');await f.restart();
 assert.deepEqual((await f.read(id)).intake.draft,draft);
 assert.equal((await f.request(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:s.intake.generation-1,action:'draft',settings:draft})).status,409,'A stale device cannot save onto a newer selection');
 const recommended=await setup(f,id,{action:'recommend',settings});assert.equal(recommended.intake.draft,undefined);
 await phase(f,id,'confirming');await setup(f,id,{action:'draft',settings:draft});
 const changed=await setup(f,id,{action:'choose',batch:0,index:1,settings});assert.equal(changed.intake.draft,undefined);
 await phase(f,id,'confirming');await setup(f,id,{action:'draft',settings:draft});
 await setup(f,id,{action:'confirm',settings:draft});assert.equal((await f.read(id)).intake.draft,undefined);
});

for(const [name,stop] of [['pause',(f,id)=>f.json(`sessions/${id}/production-control`,'POST',{action:'pause'})],['delete',(f,id)=>f.json(`library/${id}`,'DELETE')]])test(`${name} stops a search between calls and frees the text slot`,async t=>{
 const f=await fixture(t),id=await create(f),original=heldSearch(f);await until(()=>original.reading);
 await stop(f,id);await f.app.services.production.tick();
 assert.equal(original.reading.signal.aborted,true);
 await until(async()=>(await jobs(f,id,'discover'))[0].state==='queued');const [job]=await jobs(f,id,'discover');assert.equal(job.attempts,0,'A clean stop spends no attempt');
 const other=await f.create(2);f.control.hold=false;await until(async()=>(await f.read(other)).state==='completed');
 assert.equal(f.discoveries.length,1,'It does not start again while unwanted');
 f.generation.suggestions=async()=>{f.discoveries.push(1);return structuredClone(batch);};
 if(name==='delete')await f.json(`library/${id}/restore`,'POST',{});
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});
 await until(async()=>{await f.app.services.production.tick();return (await f.read(id)).intake.search.state==='idle';});assert.equal(f.discoveries.length,2);
});

test('a paused search reads as waiting, not running',async t=>{
 const f=await fixture(t),id=await prepared(f);await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 const s=await setup(f,id,{action:'more'});assert.equal(s.intake.search.state,'searching');assert.equal(s.productionState,'paused');assert.equal(s.generationControl,'paused');
 await f.app.services.production.tick();await f.app.services.production.queue.settle();assert.equal(f.discoveries.length,1);
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});await searchIs(f,id,'idle');assert.equal(f.discoveries.length,2);
});

test('a clean stop between calls resumes after restart without spending an attempt',async t=>{
 const f=await fixture(t),id=await create(f),held=heldSearch(f);await until(()=>held.reading);
 f.generation.suggestions=async()=>{f.discoveries.push(1);return structuredClone(batch);};
 f.app.services.production.stop();await until(async()=>(await jobs(f,id,'discover'))[0].state==='queued');
 assert.equal((await jobs(f,id,'discover'))[0].attempts,0);
 await f.restart();await until(async()=>(await f.read(id)).intake.search.state==='idle');assert.equal((await f.read(id)).intake.phase,'choosing');assert.equal(f.discoveries.length,2);
});

test('a call killed by a stop counts as an interruption, resumes after restart and is capped',async t=>{
 // A stop kills the provider process, so the call rejects with its own error rather than the abort.
 async function killed(f){
  const id=await create(f);await phase(f,id,'choosing');await searchIs(f,id,'idle');
  let reject;f.generation.suggestions=()=>new Promise((_,no)=>{reject=no;});
  await setup(f,id,{action:'more'});await until(()=>reject);
  f.app.services.production.stop();reject(Error('PROCESS_EXIT'));
  await until(async()=>(await jobs(f,id,'discover')).some(job=>job.state==='failed'));
  const job=(await jobs(f,id,'discover')).find(job=>job.state==='failed');
  assert.equal(job.interrupted,1);assert.equal(job.attempts,1,'The killed call spent its attempt');assert.equal((await f.read(id)).intake.search.state,'searching');
  return {id,job};
 }
 const f=await fixture(t),resumed=await killed(f);
 f.generation.suggestions=async()=>({stories:[],note:'暂无更多。'});
 await f.restart();await until(async()=>(await f.read(resumed.id)).intake.search.state==='idle');assert.equal((await f.read(resumed.id)).intake.batches.length,2);
 const g=await fixture(t),capped=await killed(g);
 await g.app.services.database.prepare('UPDATE production_jobs SET attempts=3 WHERE id=?').bind(capped.job.id).run();
 await g.restart();await searchIs(g,capped.id,'failed');
 assert.equal((await jobs(g,capped.id,'discover')).some(job=>job.id===capped.job.id),false);assert.equal((await g.read(capped.id)).state,'idle');
});

test('an interrupted search on a paused story waits instead of failing',async t=>{
 const f=await fixture(t),id=await create(f);await phase(f,id,'choosing');await searchIs(f,id,'idle');
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});await setup(f,id,{action:'more'});
 await f.app.services.production.queue.enqueue({id:crypto.randomUUID(),sessionId:id,ownerId:owner,kind:'discover',pool:'text',version:'2',dependencies:[],payload:{searchRound:2},priority:-10});
 await f.app.services.database.prepare("UPDATE production_jobs SET state='failed',interrupted=1,attempts=3,error='上次生成已中断' WHERE session_id=? AND state='queued'").bind(id).run();
 await f.app.services.production.tick();assert.equal((await f.read(id)).intake.search.state,'searching');
});

test('retry restores only the current selection; superseded jobs leave the queue',async t=>{
 const f=await fixture(t),id=await create(f);await phase(f,id,'choosing');await searchIs(f,id,'idle');
 const generator=f.generation.generator.bind(f.generation);let reject=true;
 f.generation.generator=()=>{const g=generator();return {...g,recommend:async(...args)=>{if(reject)throw Error('controlled preparation failure');return g.recommend(...args);}};};
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).state==='failed');
 const failed=await jobs(f,id,'prepare');assert.equal(failed.length,1);assert.equal(failed[0].state,'failed');
 reject=false;await reuseSource(f,id);await setup(f,id,{action:'choose',batch:0,index:1});await phase(f,id,'confirming');
 assert.equal((await jobs(f,id,'prepare')).filter(job=>job.state==='failed').length,0,'The old failure is gone, not requeued or left to be checked');
 const current=await f.read(id);await f.json(`sessions/${id}/production`,'POST',{viewerId:crypto.randomUUID(),page:0,retry:true});
 assert.equal((await jobs(f,id,'prepare')).filter(job=>job.state==='queued').length,0);assert.equal((await f.read(id)).intake.generation,current.intake.generation);
});

test('superseded jobs leave the queue on finished, paused and deleted stories too',async t=>{
 const f=await fixture(t),done=await prepared(f);await setup(f,done,{action:'confirm',settings:{...settings,length:1}});await until(async()=>(await f.read(done)).state==='completed');
 const paused=await prepared(f),deleted=await prepared(f);await f.json(`sessions/${paused}/production-control`,'POST',{action:'pause'});await f.json(`library/${deleted}`,'DELETE');
 const production=f.app.services.production,stale=(id,version,state,interrupted=0)=>production.queue.enqueue({id:crypto.randomUUID(),sessionId:id,ownerId:owner,kind:'prepare',pool:'text',version,dependencies:[],payload:{setupGeneration:-1},priority:-10}).then(()=>f.app.services.database.prepare('UPDATE production_jobs SET state=?,interrupted=? WHERE version=? AND session_id=?').bind(state,interrupted,version,id).run());
 for(const id of [done,paused,deleted]){await stale(id,'old-queued','queued');await stale(id,'old-failed','failed',1);}
 await production.tick();
 for(const id of [done,paused,deleted])assert.deepEqual((await jobs(f,id)).filter(job=>job.version.startsWith('old-')),[]);
 assert.ok((await jobs(f,done,'script')).every(job=>job.state==='succeeded'),'Current work is left alone');
 // A paused search of the current round stays, ready to resume.
 await setup(f,paused,{action:'more'});await f.json(`sessions/${paused}/production-control`,'POST',{action:'resume'});await f.json(`sessions/${paused}/production-control`,'POST',{action:'pause'});
 await production.queue.enqueue({id:crypto.randomUUID(),sessionId:paused,ownerId:owner,kind:'discover',pool:'text',version:'current',dependencies:[],payload:{searchRound:(await stored(f,paused)).intake.search.round},priority:-10});
 await production.tick();assert.equal((await jobs(f,paused,'discover')).filter(job=>job.version==='current').length,1);
});

test('a dead lock on a paused story blocks nothing and does not resume it; confirming still starts it',async t=>{
 const f=await fixture(t),id=await prepared(f);
 await f.app.services.database.prepare("UPDATE reader_sessions SET state='running',lock_token='dead',lock_until=1,generation_control='paused' WHERE id=?").bind(id).run();
 assert.equal(await setupStatus(f,id,{action:'more'}),200,'Search ignores the lock');
 await f.app.services.production.tick();
 const s=await f.read(id);assert.equal(s.state,'idle');assert.equal(s.generationControl,'paused');
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});await searchIs(f,id,'idle');await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 await f.app.services.database.prepare("UPDATE reader_sessions SET state='running',lock_token='dead',lock_until=1 WHERE id=?").bind(id).run();
 await setup(f,id,{action:'confirm',settings:{...settings,length:2}});assert.equal((await f.read(id)).generationControl,'active');
 await until(async()=>(await f.read(id)).state==='completed');
});

test('a preparation whose receipt was lost after saving settles instead of cycling',async t=>{
 const f=await fixture(t),id=await prepared(f),s=await f.read(id);
 await f.app.services.production.queue.enqueue({id:crypto.randomUUID(),sessionId:id,ownerId:owner,kind:'prepare',pool:'text',version:'lost',dependencies:[],payload:{setupGeneration:s.intake.generation,stepKey:''},priority:-10});
 await until(async()=>{await f.app.services.production.tick();return (await jobs(f,id,'prepare')).every(job=>job.state==='succeeded');});
 const after=await f.read(id);assert.equal(after.state,'idle');assert.equal(after.intake.phase,'confirming');assert.equal(f.control.recommendations.length,1);
});

test('a story without intake never gains one from a worker save',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(2);await until(async()=>(await f.read(id)).state==='completed');
 assert.equal('intake' in await stored(f,id),false);
});

test('a discovering record an older release wrote still finds its stories',async t=>{
 const f=await fixture(t),id=await create(f);await phase(f,id,'choosing');await searchIs(f,id,'idle');
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.intake.phase','discovering') WHERE id=?").bind(id).run();
 await until(async()=>{await f.app.services.production.tick();const s=await f.read(id);return s.intake.phase==='choosing'&&s.intake.batches.length===2;});assert.equal(f.discoveries.length,2);
 // With no search stored at all, the record reads as searching and starts one round.
 const fresh=await create(f);await phase(f,fresh,'choosing');await searchIs(f,fresh,'idle');
 await f.app.services.database.prepare("DELETE FROM production_jobs WHERE session_id=?").bind(fresh).run();
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(json_remove(document,'$.intake.search'),'$.intake.phase','discovering') WHERE id=?").bind(fresh).run();
 assert.equal((await f.read(fresh)).intake.search.state,'searching');
 await until(async()=>{await f.app.services.production.tick();return (await f.read(fresh)).intake.batches.length===2;});
});

function oldLibrary(names){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort().filter(names))sqlite.exec(readFileSync(path.join('drizzle',name),'utf8'));
 return sqlite;
}
test('the migration carries saved searches over without new work or lost choices',()=>{
 const sqlite=oldLibrary(name=>name<'0006'),candidates=[{stories:[{title:'庄周梦蝶',description:'一个故事。'}],note:''}];
 const doc=(intake,extra={})=>JSON.stringify({plan:null,images:[],audio:[],usage:[],intake:{generation:2,creationHash:'x',batches:candidates,...intake},...extra});
 const row=(id,document,state='idle',error=null,control='active')=>sqlite.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,generation_mode,generation_control,state,error,step_attempts,lock_token,lock_until,page,saved,created_at,updated_at) VALUES(?,?,?,?,'background',?,?,?,0,?,?,0,0,'2026-10-29','2026-10-29')").run(id,owner,JSON.stringify(selection),document,control,state,error,state==='running'?'dead':null,state==='running'?1:0);
 row('queued',doc({phase:'discovering',progress:{completed:1}}));
 row('dead',doc({phase:'discovering'}),'running');
 row('failed-none',doc({phase:'discovering'}),'failed','找不到');
 row('failed-chosen',doc({phase:'discovering',selected:{batch:0,index:0}},{frameRecommendation:{count:7,reason:'好'}}),'failed','找不到');
 row('chosen',doc({phase:'discovering',selected:{batch:0,index:0}}));
 row('paused',doc({phase:'discovering'}),'idle',null,'paused');
 row('other',doc({phase:'confirming',selected:{batch:0,index:0}}));
 row('plain',JSON.stringify({plan:null,images:[],audio:[],usage:[]}));
 row('broken','{not json','failed','坏');
 sqlite.prepare("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,priority,attempts,lease_until,created_at,updated_at) VALUES('old','queued',?,'discover','text','v','[]','{\"setupGeneration\":2}','queued',-10,0,0,0,0),('done','other',?,'discover','text','v','[]','{\"setupGeneration\":1}','succeeded',-10,1,0,0,0)").run(owner,owner);
 sqlite.exec(readFileSync('drizzle/0006_intake_search.sql','utf8'));
 const read=id=>{const value=sqlite.prepare('SELECT * FROM reader_sessions WHERE id=?').get(id);return {...value,doc:value.id==='broken'?null:JSON.parse(value.document)};};
 const queued=read('queued');assert.equal(queued.doc.intake.phase,'discovering');assert.equal(queued.doc.intake.search.state,'searching');assert.equal(queued.doc.intake.progress,undefined);assert.deepEqual(queued.doc.intake.batches,candidates);
 const dead=read('dead');assert.equal(dead.state,'idle');assert.equal(dead.lock_token,null);assert.equal(dead.lock_until,0);assert.equal(dead.doc.intake.search.state,'searching');
 const none=read('failed-none');assert.equal(none.doc.intake.phase,'choosing');assert.equal(none.doc.intake.search.state,'failed');assert.equal(none.doc.intake.search.error,'找不到');assert.equal(none.state,'idle');assert.equal(none.error,null);
 const chosen=read('failed-chosen');assert.equal(chosen.doc.intake.phase,'choosing');assert.deepEqual(chosen.doc.intake.selected,{batch:0,index:0});assert.equal(chosen.state,'idle');
 assert.equal(read('chosen').doc.intake.phase,'choosing');assert.equal(read('chosen').doc.intake.search.state,'searching');
 assert.equal(read('paused').generation_control,'paused');assert.equal(read('paused').doc.intake.search.state,'searching');
 assert.equal(read('other').doc.intake.search,undefined);assert.equal(read('other').doc.intake.phase,'confirming');
 assert.equal('intake' in read('plain').doc,false);
 assert.equal(sqlite.prepare("SELECT document FROM reader_sessions WHERE id='broken'").get().document,'{not json');assert.equal(read('broken').state,'failed');
 assert.deepEqual(sqlite.prepare('SELECT id FROM production_jobs').all().map(job=>job.id),['done']);
 sqlite.close();
});

test('the desktop summary still reads a library older than the service\'s migrations',()=>{
 const sqlite=oldLibrary(name=>name<'0004');
 sqlite.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,state,created_at,updated_at) VALUES('test','owner','{\"bookId\":\"book\",\"storyTitle\":\"故事\"}','{\"plan\":null,\"images\":[]}','idle','2026-10-29','2026-10-29')").run();
 const summary=JSON.parse(Object.values(sqlite.prepare(readFileSync('desktop/library.sql','utf8')).get())[0]);
 assert.equal(summary.stories[0].title,'故事');assert.equal(summary.stories[0].jobs,0);sqlite.close();
});
