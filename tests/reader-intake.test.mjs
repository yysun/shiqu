// Prove that initial intent, candidate receipts and confirmation gates survive real queued execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,selection} from './fixtures/production.mjs';
import {saveStoryOriginal} from '../lib/reader-source-storage.ts';
import {observeStoryGeneration} from '../lib/reader-production-client.ts';
import {shelfGenerationStatus} from '../lib/shelf-generation.ts';
const batch={stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}},{title:'大葫芦',description:'惠子与庄子谈论大葫芦的用处。'}],note:''};
async function fixture(t){const f=await productionFixture(t);f.control.hold=false;f.discoveries=[];f.generation.suggestions=async(s,excluded,_local,reading)=>{f.discoveries.push({s,excluded});reading?.onProgress({completed:1,total:1,completedChars:100,totalChars:100,stage:'selecting'});return structuredClone(batch);};return f;}
async function create(f,requestId=crypto.randomUUID(),overrides={}) {const s=await f.json('sessions','POST',{requestId,intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced',...overrides}});return s.id;}
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

test('display states distinguish queued extraction, waiting choice and full setup without false completion',async t=>{
 const {generationProgress}=await import('../lib/generation-progress.ts'),{shelfGenerationStatus}=await import('../lib/shelf-generation.ts');
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');let s=await f.read(id);
 assert.equal(shelfGenerationStatus(s).group,'待选故事');let steps=generationProgress(s,Date.now()).steps;assert.equal(steps[0].label,'提取故事');assert.equal(steps[0].state,'done');assert.equal(steps[1].label,'制作确认');assert.equal(steps[1].state,'current');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');s=await f.read(id);assert.equal(shelfGenerationStatus(s).group,'待制作确认');assert.equal(s.state,'idle');assert.equal(s.retryAllowed,false);assert.equal(s.generationProgress.phase,'production-confirmation');
});

test('choosing a new candidate can carry unsaved manual preferences in the same atomic choice',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const source=(await f.json(`sessions/${id}/source`)).source,generator=f.generation.generator.bind(f.generation);f.generation.generator=()=>({...generator(),prepareOriginal:async()=>source});
 await setup(f,id,{action:'choose',batch:0,index:1,settings:{artStyle:'watercolor',productionPrompt:'Do not discard my edits.',narrativeDetail:'detailed'}});await until(async()=>(await f.read(id)).intake.phase==='confirming');const s=await f.read(id);assert.equal(s.selection.productionPrompt,'Do not discard my edits.');assert.equal(s.selection.artStyle,'watercolor');assert.equal(s.selection.narrativeDetail,'detailed');
});

test('native/preview shared summary follows intake gates and ignores obsolete job failures without exposing content',async t=>{
 const {readLibrarySummary}=await import('../desktop/library-preview.ts'),{productionSteps}=await import('../lib/production-stages.ts');
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await f.app.services.production.queue.enqueue({id:crypto.randomUUID(),sessionId:id,ownerId:'docker-local-owner',kind:'discover',pool:'text',version:'old',dependencies:[],payload:{setupGeneration:-1},priority:-100});
 await f.app.services.database.prepare("UPDATE production_jobs SET state='failed',error='private old failure' WHERE version='old'").run();
 let summary=readLibrarySummary(f.dataDirectory).stories.find(s=>s.id===id);assert.equal(summary.failed,0);assert.equal(summary.production.phase,'story-choice');assert.equal(summary.production.intakePhase,'choosing');assert.equal(productionSteps({...summary.production,total:null,ready:0})[1].label,'制作确认');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');summary=readLibrarySummary(f.dataDirectory).stories.find(s=>s.id===id);assert.equal(summary.production.phase,'production-confirmation');assert.equal(summary.failed,0);assert.doesNotMatch(JSON.stringify(summary),/quiet narration|private old failure|梦为胡蝶/);
});

test('reselecting remote candidates prepares distinct originals through the real source cache, while returning to one reuses its text',async t=>{
 const f=await fixture(t),titles=['第一篇','第二篇'];
 f.generation.suggestions=async()=>({stories:titles.map(title=>({title,description:'来自所选古籍的独立故事。'})),note:''});
 const generator=f.generation.generator.bind(f.generation),retrieved=[];
 f.generation.generator=()=>({...generator(),original:(s,hint,id)=>saveStoryOriginal(f.media,s,hint,id,async url=>{
  const page=new URL(url).searchParams.get('page');retrieved.push(page);
  return Response.json({parse:{title:page,text:`<p>这是${page}的独立原文，人物和事件属于当前所选故事，不能被另一篇故事替代，字数足够核验章节出处。</p>`}});
 })});
 const id=await create(f,crypto.randomUUID(),{bookId:'other',customBook:'测试古籍'});await until(async()=>(await f.read(id)).intake.phase==='choosing');
 // Unbound caches from before candidate reselection must never be mistaken for the chosen text.
 await f.media.put(`reader/${id}/source.json`,new TextEncoder().encode(JSON.stringify({title:'旧缓存',text:'另一篇旧故事',url:'https://example.com/wrong'})),{contentType:'application/json'});
 const originals=[];
 for(const index of [0,1,0]){
  await setup(f,id,{action:'choose',batch:0,index});await until(async()=>(await f.read(id)).intake.phase==='confirming');
  const source=(await f.json(`sessions/${id}/source`)).source;originals.push(source);
  assert.match(source.text,new RegExp(titles[index]));assert.equal(f.control.recommendations.at(-1).verifiedOriginal.text,source.text);
 }
 assert.notEqual(originals[0].text,originals[1].text);assert.deepEqual(originals[0],originals[2]);assert.equal(retrieved.length,2);
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('finding another batch preserves the prepared story and observes through its confirmation gate',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 let release;f.generation.suggestions=async()=>{await new Promise(r=>release=r);return {stories:[],note:'暂无更多。'};};
 await setup(f,id,{action:'more'});await until(()=>release);const discovering=await f.read(id);
 assert.equal(discovering.intake.phase,'discovering');assert.equal(discovering.awaitingFrameCount,false);assert.equal(discovering.generationProgress.phase,'discover');assert.notEqual(shelfGenerationStatus(discovering).group,'待选画幅数');
 const observed=[];let polls=0;
 await observeStoryGeneration({sessionId:id,isActive:()=>true,onSession:s=>observed.push(s.intake.phase),request:async()=>{polls++;return f.read(id);},sleep:async()=>{release();await until(async()=>(await f.read(id)).intake.phase==='confirming');}});
 assert.equal(polls,2);assert.deepEqual(observed,['discovering','confirming']);assert.equal(shelfGenerationStatus(await f.read(id)).group,'待制作确认');assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('confirmed intake draws eighty frames once across four storyboard batches',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 await setup(f,id,{action:'confirm',settings:{artStyle:'paper-cut',productionPrompt:'Complete causality without repeated scenes.',narrativeDetail:'detailed',length:80}});
 await until(async()=>(await f.read(id)).state==='completed',15000);
 assert.deepEqual(f.control.batches.map(p=>p.batch),[{first:1,last:20},{first:21,last:40},{first:41,last:60},{first:61,last:80}]);
 assert.equal(f.control.calls.length,80);assert.equal((await f.read(id)).ready,80);
});


test('legacy prepared choice receipts read as confirming without writes or paid work, and can confirm directly',async t=>{
 const {readLibrarySummary}=await import('../desktop/library-preview.ts');
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 await f.app.services.production.queue.settle();await f.app.services.production.tick();
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.intake.phase','choosing') WHERE id=?").bind(id).run();
 const before=await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first();
 const s=await f.read(id);assert.equal(s.intake.phase,'confirming');assert.equal(s.generationProgress.phase,'production-confirmation');assert.equal(shelfGenerationStatus(s).group,'待制作确认');
 const summary=readLibrarySummary(f.dataDirectory).stories.find(s=>s.id===id);assert.equal(summary.production.intakePhase,'confirming');assert.equal(summary.production.phase,'production-confirmation');
 assert.equal((await f.app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first()).document,before.document,'Reading normalizes the view, never the stored record');
 assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 await setup(f,id,{action:'confirm',settings:{artStyle:s.selection.artStyle,productionPrompt:s.selection.productionPrompt,narrativeDetail:'balanced',length:4}},s);
 await until(async()=>(await f.read(id)).state==='completed');assert.equal((await f.read(id)).ready,4);assert.equal(f.control.recommendations.length,1);
});

test('phase recovery compares local source ranges canonically and rejects partial or mismatched checkpoints',async t=>{
 const {readLibrarySummary}=await import('../desktop/library-preview.ts');
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');await f.app.services.production.queue.settle();await f.app.services.production.tick();
 const row=await f.app.services.database.prepare('SELECT document,selection FROM reader_sessions WHERE id=?').bind(id).first(),base=JSON.parse(row.document),selected=JSON.parse(row.selection);
 const source={sectionId:'s1',firstUnit:'u1',lastUnit:'u2',continuations:[{sectionId:'s2',firstUnit:'u3',lastUnit:'u4'}],edition:'a'.repeat(64)};
 base.intake.phase='choosing';base.intake.batches[0].stories[0].source=source;selected.source=source;
 base.original.localSource={edition:source.edition,continuations:[{lastUnit:'u4',firstUnit:'u3',sectionId:'s2'}],lastUnit:'u2',firstUnit:'u1',sectionId:'s1'};
 for(const [mutate,phase] of [
  [()=>{},'confirming'],
  [doc=>{delete doc.original;},'choosing'],
  [doc=>{delete doc.frameRecommendation;},'choosing'],
  [doc=>{doc.intake.selected.index=4;},'choosing'],
  [doc=>{doc.intake.batches[0].stories[0].title='另一篇故事';},'choosing'],
  [doc=>{doc.original.localSource.continuations[0].lastUnit='other-unit';},'choosing'],
 ]){
  const doc=structuredClone(base);mutate(doc);await f.app.services.database.prepare('UPDATE reader_sessions SET document=?,selection=? WHERE id=?').bind(JSON.stringify(doc),JSON.stringify(selected),id).run();
  assert.equal((await f.read(id)).intake.phase,phase);
  const summary=readLibrarySummary(f.dataDirectory).stories.find(s=>s.id===id);assert.equal(summary.production.intakePhase,phase);
 }
 assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});
