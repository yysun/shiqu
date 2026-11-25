// Prove that initial intent, candidate receipts and confirmation gates survive real queued execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {productionFixture,until,selection} from './fixtures/production.mjs';
import {saveStoryOriginal} from '../lib/reader-source-storage.ts';
import {observeStoryGeneration} from '../lib/reader-production-client.ts';
import {shelfGenerationStatus} from '../lib/shelf-generation.ts';
import {heavy} from './fixtures/test-tier.mjs';
import {setupEvents} from '../lib/production-lifecycle.ts';
import {decodeDocument} from '../lib/production-dag/document.ts';
const batch={stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}},{title:'大葫芦',description:'惠子与庄子谈论大葫芦的用处。'}],note:''};
async function fixture(t){const f=await productionFixture(t);f.control.hold=false;f.discoveries=[];f.generation.suggestions=async(s,excluded,_local,reading)=>{f.discoveries.push({s,excluded});reading?.onProgress({completed:1,total:1,completedChars:100,totalChars:100,stage:'selecting'});return structuredClone(batch);};return f;}
async function create(f,requestId=crypto.randomUUID(),overrides={}) {const s=await f.json('sessions','POST',{requestId,intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced',...overrides}});if(s.intake.search.state==='idle'&&!s.intake.batches.length)await f.startDiscovery(s.id);await f.demand(s.id);return s.id;}
const setup=async(f,id,action,s)=>f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(s||await f.read(id)).intake.generation,...action});

test('setup routes accept each current intake action and reject stale input or unavailable preparation',async t=>{
 const f=await fixture(t),id=await create(f);
 const route=`sessions/${id}/setup`,seen=new Set();
 const settings={artStyle:'paper-cut',productionPrompt:'',narrativeDetail:'balanced'};
 const request=async(action,status,session=undefined)=>{
  const snapshot=session??await f.read(id);
  const offer=snapshot.lifecycle.actions.find(offer=>offer.event===action.action);
  if(status===200)assert.equal(offer?.generation,snapshot.intake.generation,action.action);
  const reply=await f.request(route,'POST',{requestId:crypto.randomUUID(),generation:snapshot.intake.generation,...action});
  assert.equal(reply.status,status,`${action.action}: ${await reply.text()}`);
  if(status===200)seen.add(action.action);
 };
 const choosing=()=>until(async()=>(await f.read(id)).intake.phase==='choosing');
 const confirming=()=>until(async()=>(await f.read(id)).intake.phase==='confirming');
 await choosing();
 await request({action:'conditions',conditions:{bookId:'zhuangzi',theme:selection.theme,productionPrompt:'',discovery:{mode:'auto'}}},200);
 await choosing();
 await request({action:'search',title:''},200);
 await choosing();
 await request({action:'more'},200);
 await choosing();
 await request({action:'confirm',settings:{...settings,length:4}},409);
 await request({action:'draft',settings:{...settings,length:4}},409);
 await request({action:'recommend',settings},409);
 await request({action:'choose',batch:20,index:0},400);
 const unselected=await f.read(id);
 await request({action:'choose',batch:0,index:0},200);
 await confirming();
 await request({action:'conditions',conditions:{bookId:'zhuangzi',theme:selection.theme,productionPrompt:''}},409,unselected);
 await request({action:'search',title:''},409);
 let prepared=await f.read(id);
 await request({action:'recommend',settings,draftToken:prepared.intake.draftToken},200);
 await confirming();
 prepared=await f.read(id);
 await request({action:'draft',settings:{...settings,length:4},draftToken:prepared.intake.draftToken},200);
 prepared=await f.read(id);
 await request({action:'confirm',settings:{...settings,length:4},draftToken:prepared.intake.draftToken},200);
 await request({action:'more'},409);
 assert.deepEqual([...seen].sort(),[...setupEvents].sort());
});

test('search timeouts use the same interruption cap and content rejection does not retry',async t=>{
 const f=await fixture(t);
 let attempts=0;
 f.generation.suggestions=async()=>{attempts++;throw Error('TIMEOUT');};
 const timedOut=await create(f);
 await until(async()=>(await f.read(timedOut)).intake.search.state==='failed');
 assert.equal(attempts,3);
 assert.equal((await f.read(timedOut)).lifecycle.faults.find(fault=>fault.stage==='source').kind,'interrupted');
 f.generation.suggestions=async()=>{attempts++;throw Error('CONTENT_BLOCKED');};
 const blocked=await create(f);
 await until(async()=>(await f.read(blocked)).intake.search.state==='failed');
 assert.equal(attempts,4);
 assert.equal((await f.read(blocked)).lifecycle.faults.find(fault=>fault.stage==='source').kind,'content-blocked');
});

test('intent is saved before discovery; restart and waiting for story choice never commission scripts/images',async t=>{
 const f=await fixture(t);let release;f.generation.suggestions=async()=>{f.discoveries.push(1);await new Promise(r=>release=r);return batch;};
 const id=await create(f),saved=await f.read(id);assert.equal(saved.selection.bookId,'zhuangzi');assert.equal(saved.selection.theme,selection.theme);
 await until(()=>release);assert.equal((await f.json('sessions')).some(s=>s.id===id),true);assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
 release();await until(async()=>(await f.read(id)).intake.phase==='choosing');await f.restart();
 const resumed=await f.read(id);assert.equal(resumed.intake.batches[0].stories.length,2);assert.equal(resumed.state,'idle');assert.equal(f.discoveries.length,1);assert.equal(f.control.calls.length,0);
});

test('choosing prepares saved source and count; only full production confirmation starts generation',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');const prepared=await f.read(id);
 const sameChoice={requestId:crypto.randomUUID(),generation:prepared.intake.generation,action:'choose',batch:0,index:0};
 assert.equal((await f.json(`sessions/${id}/setup`,'POST',sameChoice)).intake.generation,prepared.intake.generation);
 assert.equal(prepared.selection.storyTitle,'庄周梦蝶');assert.equal(prepared.selection.artStyle,'paper-cut');assert.equal(prepared.frameRecommendation.count,7);assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
 const stored=await f.app.services.database.prepare('SELECT * FROM story_rows WHERE id=?').bind(id).first();
 const doc=decodeDocument(stored);
 assert.ok(doc.dag.products['source:']);
 assert.ok(doc.dag.products['suggestions:']);
 assert.ok(doc.original.storyBrief.verified);
 assert.equal(doc.dag.modelSnapshot,undefined);
 assert.deepEqual(doc.dag.order,[]);
 const jobs=(await f.app.services.database.prepare('SELECT kind,payload FROM production_jobs WHERE session_id=?').bind(id).all()).results;
 assert.deepEqual(jobs.filter(job=>job.kind==='dag').map(job=>JSON.parse(job.payload).work.call).sort(),['prepareSuggestions','verifySource']);
 assert.ok(jobs.every(job=>job.kind!=='prepare'));
 assert.equal((await f.request(`sessions/${id}/source`)).status,200);
 assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count:4})).status,404,'the legacy frame-count entry is gone');
 await f.json(`sessions/${id}/advance`,'POST',{throughPage:79});await f.app.services.production.tick();assert.equal(f.control.dagCalls.length,0);
 const action={requestId:crypto.randomUUID(),generation:prepared.intake.generation,action:'confirm',settings:{artStyle:'watercolor',productionPrompt:'从庄周醒来开始。',narrativeDetail:'balanced',length:4}};
 const scopes=[];
 f.control.beforeText=(kind,payload)=>{if(kind==='brief')scopes.push(payload.productionPrompt);};
 await f.json(`sessions/${id}/setup`,'POST',action);await until(async()=>(await f.read(id)).state==='completed');assert.equal((await f.read(id)).story.pages.length,4);assert.equal(f.control.calls.length,4);
 assert.deepEqual(scopes,[action.settings.productionPrompt]);
 await f.json(`sessions/${id}/setup`,'POST',action);assert.equal(f.control.calls.length,4);
 const status=f.generation.status;
 f.generation.status=async()=>({configured:false,message:'controlled provider outage'});
 try{
  assert.equal((await f.request(`sessions/${id}/setup`,'POST',action)).status,200);
  assert.equal((await f.request(`sessions/${id}/setup`,'POST',sameChoice)).status,200);
  assert.equal((await f.request(`sessions/${id}/setup`,'POST',{...action,requestId:crypto.randomUUID()})).status,503);
 }finally{f.generation.status=status;}
});

test('a story-only style prompt survives draft reload and reaches storyboard and image jobs',async t=>{
 const f=await fixture(t),id=await create(f);
 await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const prepared=await f.read(id),artStylePrompt='Use cool-gray ink on visible white silk.';
 const settings={...prepared.intake.draft,artStylePrompt,length:2};
 const saved=await setup(f,id,{action:'draft',settings,draftToken:prepared.intake.draftToken});
 assert.notEqual(saved.intake.draftToken,prepared.intake.draftToken);
 await f.restart();
 const reloaded=await f.read(id);
 assert.equal(reloaded.intake.draft.artStylePrompt,artStylePrompt);
 assert.equal(f.control.calls.length,0);
 await setup(f,id,{action:'confirm',settings:reloaded.intake.draft,draftToken:reloaded.intake.draftToken});
 await until(async()=>(await f.read(id)).state==='completed');
 assert.equal((await f.read(id)).selection.artStylePrompt,artStylePrompt);
 assert.ok(f.control.reviews.length>0&&f.control.reviews.every(r=>r.artDirection.includes(artStylePrompt)),'the story-only style reaches the DAG review payload');
 assert.equal(f.control.calls.length,2);
 assert.ok(f.control.calls.every(call=>call.prompt.includes(artStylePrompt)));
 assert.ok(f.control.calls.every(call=>!call.prompt.includes('Layered Chinese paper-cut illustration')));
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

test('a failed search stays with the search; obsolete jobs do not block the next one',async t=>{
 const f=await fixture(t);let failed=false;f.generation.suggestions=async()=>{f.discoveries.push(1);if(!failed){failed=true;throw Error('controlled failed extraction');}return batch;};
 const id=await create(f);await until(async()=>(await f.read(id)).intake.search.state==='failed');const old=await f.read(id);assert.equal(old.state,'idle');assert.equal(old.intake.phase,'choosing');assert.equal(shelfGenerationStatus(old).group,'待选故事');
 await setup(f,id,{action:'more'},old);await until(async()=>(await f.read(id)).intake.search.state==='idle');assert.equal(f.discoveries.length,2);assert.equal((await f.read(id)).state,'idle');
 await f.app.services.production.queue.enqueue({id:crypto.randomUUID(),sessionId:id,ownerId:'docker-local-owner',kind:'discover',pool:'search',version:'stale',dependencies:[],payload:{setupGeneration:old.intake.generation},priority:-100});
 await f.app.services.production.tick();assert.equal(f.discoveries.length,2);assert.equal((await f.read(id)).intake.phase,'choosing');
 const other=await f.create(2);await until(async()=>(await f.read(other)).state==='completed');assert.equal(f.control.dagCalls.filter(n=>n==='brief').length,1);
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
});

test('an obsolete recommendation failure cannot block a newer selection',async t=>{
 const f=await fixture(t),id=await create(f);
 await until(async()=>(await f.read(id)).intake.phase==='choosing');
 const generator=f.generation.generator.bind(f.generation);
 let fail,original;
 const gate=new Promise((_,reject)=>{fail=reject;});
 f.generation.generator=()=>{
  const g=generator();
  return {...g,prepareOriginal:async(selection,id)=>selection.storyTitle==='大葫芦'?original:await g.prepareOriginal?.(selection,id),recommend:async(...args)=>{
   if(args[0].storyTitle==='庄周梦蝶'){original=args[2];await gate;}
   return g.recommend(...args);
  }};
 };
 await setup(f,id,{action:'choose',batch:0,index:0});
 await until(()=>original);
 try{await setup(f,id,{action:'choose',batch:0,index:1});}
 finally{fail(Error('obsolete recommendation'));}
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const saved=await f.read(id);
 assert.equal(saved.selection.storyTitle,'大葫芦');
 assert.ok(!saved.faults?.length);
 assert.equal(f.control.recommendations.length,1);
});

test('recovering a saved recommendation receipt preserves edits and calls the provider once',async t=>{
 const f=await fixture(t),id=await create(f);
 await until(async()=>(await f.read(id)).intake.phase==='choosing');
 const database=f.app.services.database,transaction=database.transaction.bind(database);
 let reject=true;
 database.transaction=body=>transaction(tx=>body({...tx,run(query,...values){
  if(reject&&query.startsWith('UPDATE stories SET document=?,production_complete=?')&&JSON.parse(values[0]).intake?.phase==='confirming'){
   reject=false;
   throw Error('controlled document write failure');
  }
  return tx.run(query,...values);
 }}));
 await setup(f,id,{action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(id)).faults?.some(fault=>fault.retryAllowed),20000);
 const failed=await f.read(id);
 assert.equal(failed.intake.phase,'preparing');
 assert.equal(failed.frameRecommendation,null);
 const settings={artStyle:'watercolor',productionPrompt:'从庄周醒来开始。',narrativeDetail:'brief',length:4};
 await setup(f,id,{action:'draft',settings,draftToken:failed.intake.draftToken},failed);
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:failed.faults[0].id});
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const saved=await f.read(id);
 assert.equal(saved.intake.draft.productionPrompt,settings.productionPrompt);
 assert.equal(saved.intake.draft.artStyle,settings.artStyle);
 assert.equal(saved.frameRecommendation.count,7);
 assert.equal(f.control.recommendations.length,1);
});

test('empty batches stay selectable, cap at forty, and pause never dispatches discovery',async t=>{
 const f=await fixture(t);f.generation.suggestions=async()=>({stories:[],note:'暂无更多可确认的故事。'});const id=await create(f);
 for(let n=1;n<=40;n++){
  await until(async()=>{await f.app.services.production.tick();return (await f.read(id)).intake.phase==='choosing';});
  assert.equal((await f.read(id)).state,'idle');if(n<40)await setup(f,id,{action:'more'});
 }
 assert.equal((await f.request(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,action:'more'})).status,400);
 assert.equal(f.control.calls.length,0);assert.equal(f.control.dagCalls.length,0);
 const other=await create(f);await f.json(`sessions/${other}/production-control`,'POST',{action:'pause'});await f.app.services.production.tick();assert.equal((await f.read(other)).generationControl,'paused');
});

test('display states distinguish queued extraction, waiting choice and full setup without false completion',async t=>{
 const {generationProgress}=await import('../lib/generation-progress.ts'),{shelfGenerationStatus}=await import('../lib/shelf-generation.ts');
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');let s=await f.read(id);
 assert.equal(shelfGenerationStatus(s).group,'待选故事');
 const steps=()=>generationProgress(s,Date.now()).steps.slice(0,3).map(step=>[step.label,step.state]);
 assert.deepEqual(steps(),[['提取故事','current'],['准备故事','pending'],['分批分镜','pending']]);
 assert.match(generationProgress(s,Date.now()).steps[0].detail,/待选择故事/);
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');s=await f.read(id);assert.equal(shelfGenerationStatus(s).group,'待制作确认');assert.equal(s.state,'idle');assert.equal(s.retryAllowed,false);assert.equal(s.generationProgress.phase,'production-confirmation');
 assert.deepEqual(steps(),[['提取故事','done'],['制作确认','current'],['分批分镜','pending']]);
});

test('choosing a new candidate can carry unsaved manual preferences in the same atomic choice',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const source=(await f.json(`sessions/${id}/source`)).source,generator=f.generation.generator.bind(f.generation);f.generation.generator=()=>({...generator(),prepareOriginal:async()=>source});
 await setup(f,id,{action:'choose',batch:0,index:1,settings:{artStyle:'watercolor',productionPrompt:'Do not discard my edits.',narrativeDetail:'detailed'}});await until(async()=>(await f.read(id)).intake.phase==='confirming');const s=await f.read(id);assert.equal(s.selection.productionPrompt,'Do not discard my edits.');assert.equal(s.selection.artStyle,'watercolor');assert.equal(s.selection.narrativeDetail,'detailed');
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
 assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
});

test('finding another batch leaves the prepared story in place and observes until the search ends',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 let release;f.generation.suggestions=async()=>{await new Promise(r=>release=r);return {stories:[],note:'暂无更多。'};};
 await setup(f,id,{action:'more'});await until(()=>release);const finding=await f.read(id);
 assert.equal(finding.intake.phase,'confirming');assert.equal(finding.intake.search.state,'searching');assert.equal(finding.state,'idle');assert.equal(finding.generationProgress.phase,'production-confirmation');assert.equal(shelfGenerationStatus(finding).group,'待制作确认');
 const observed=[];let polls=0;
 await observeStoryGeneration({sessionId:id,isActive:()=>true,onSession:s=>observed.push(s.intake.search.state),request:async()=>{polls++;return f.read(id);},sleep:async()=>{release();await until(async()=>(await f.read(id)).intake.search.state==='idle');}});
 assert.equal(polls,2);assert.deepEqual(observed,['searching','idle']);assert.equal(shelfGenerationStatus(await f.read(id)).group,'待制作确认');assert.equal(f.control.recommendations.length,1);assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
});

test('confirmed intake draws eighty frames once across four storyboard batches',heavy,async t=>{
 const f=await fixture(t),batches=[];
 f.control.beforeText=(kind,payload)=>{if(kind==='sceneBatch')batches.push(payload.batch);};
 const id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 await setup(f,id,{action:'confirm',settings:{artStyle:'paper-cut',productionPrompt:'Complete causality without repeated scenes.',narrativeDetail:'detailed',length:80}});
 // 以有间隔的详情轮询检查完成，避免连续读取 80 幅作品的全量状态占用队列的执行时间。
 await until(async()=>{await delay(100);return (await f.read(id)).state==='completed';},60000);
 assert.deepEqual(batches,[{first:1,last:20},{first:21,last:40},{first:41,last:60},{first:61,last:80}]);
 assert.deepEqual(f.control.calls.map(call=>call.page).sort((a,b)=>a-b),Array.from({length:80},(_,page)=>page));assert.equal((await f.read(id)).ready,80);
});


test('legacy prepared choice receipts read as confirming without writes or paid work, and can confirm directly',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 await f.app.services.production.queue.settle();await f.app.services.production.tick();
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.intake.phase','choosing') WHERE id=?").bind(id).run();
 const before=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first();
 const s=await f.read(id);assert.equal(s.intake.phase,'confirming');assert.equal(s.generationProgress.phase,'production-confirmation');assert.equal(shelfGenerationStatus(s).group,'待制作确认');
 assert.equal((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document,before.document,'Reading normalizes the view, never the stored record');
 assert.equal(f.control.recommendations.length,1);assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
 await setup(f,id,{action:'confirm',settings:{artStyle:s.selection.artStyle,productionPrompt:s.selection.productionPrompt,narrativeDetail:'balanced',length:4}},s);
 await until(async()=>(await f.read(id)).state==='completed');assert.equal((await f.read(id)).ready,4);assert.equal(f.control.recommendations.length,1);
});

test('phase recovery compares local source ranges canonically and rejects partial or mismatched checkpoints',async t=>{
 const f=await fixture(t),id=await create(f);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');await f.app.services.production.queue.settle();await f.app.services.production.tick();
 const row=await f.app.services.database.prepare('SELECT * FROM story_rows WHERE id=?').bind(id).first(),base=decodeDocument(row),selected=JSON.parse(row.selection);
 await f.app.services.database.prepare("DELETE FROM production_product_refs WHERE session_id=? AND target='source:'").bind(id).run();
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
  const doc=structuredClone(base);mutate(doc);await f.app.services.database.prepare('UPDATE stories SET document=?,selection=? WHERE id=?').bind(JSON.stringify(doc),JSON.stringify(selected),id).run();
  assert.equal((await f.read(id)).intake.phase,phase);
 }
 assert.equal(f.control.recommendations.length,1);assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
});


test('a paused source-and-summary story can be renamed without changing preparation or starting generation',async t=>{
 const f=await fixture(t),id=await create(f);
 await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await setup(f,id,{action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 const before=await f.app.services.database.prepare('SELECT * FROM stories WHERE id=?').bind(id).first();
 const original=await f.json(`sessions/${id}/source`),jobs=await f.app.services.database.prepare('SELECT * FROM production_jobs').all();
 const calls=[f.control.recommendations.length,f.control.dagCalls.length,f.control.calls.length];
 f.generation.status=async()=>({configured:false});
 const saved=await f.json(`sessions/${id}/title`,'POST',{title:'  梦醒之后  '});
 assert.equal(saved.selection.displayTitle,'梦醒之后');assert.equal(saved.selection.storyTitle,'庄周梦蝶');
 assert.equal(saved.story,null);assert.equal(saved.ready,0);assert.equal(saved.generationControl,'paused');assert.equal(saved.intake.phase,'confirming');
 const after=await f.app.services.database.prepare('SELECT * FROM stories WHERE id=?').bind(id).first();
 assert.equal(after.document,before.document);assert.equal(after.state,before.state);assert.equal(after.generation_control,before.generation_control);
 assert.deepEqual(JSON.parse(after.selection),{...JSON.parse(before.selection),displayTitle:'梦醒之后'});
 assert.deepEqual(await f.json(`sessions/${id}/source`),original);
 assert.deepEqual(await f.app.services.database.prepare('SELECT * FROM production_jobs').all(),jobs);
 assert.deepEqual([f.control.recommendations.length,f.control.dagCalls.length,f.control.calls.length],calls);
 await f.restart();
 const reopened=await f.read(id);assert.equal(reopened.selection.displayTitle,'梦醒之后');assert.equal(reopened.generationControl,'paused');assert.equal(reopened.story,null);
 assert.equal((await f.json('sessions')).find(s=>s.id===id).selection.displayTitle,'梦醒之后');
});
