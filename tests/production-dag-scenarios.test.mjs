// 制作 DAG 经正式协调器的场景：在隔离的 SQLite 书库与受控提供方上运行，和应用使用同一条路径。
// 改一幅配文、保存、重启、继续：审片通过且绘图输入未变时，只重做受影响的审片，不产生任何绘图调用。
// 已确认的新故事从提纲一路制作到最后一幅图，按批调用，参考图取首幅成图。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn,makePlan} from './fixtures/production.mjs';
import {story,replies,drive} from './fixtures/production-dag-runner.mjs';
import {owner} from './fixtures/book-reference.mjs';
import {png} from './fixtures/images.mjs';
import {projectDocument,emptyDag} from '../lib/production-dag/document.ts';
import {evaluate} from '../lib/production-dag/engine.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {stateOf} from '../lib/production-dag/runner.ts';
import {selection} from './fixtures/production-data.mjs';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {generationProgress} from '../lib/generation-progress.ts';
import {shelfGenerationStatus} from '../lib/shelf-generation.ts';
import {authorizeDispatch,dispatchRules,authorizeProductionCommand,commandRules,productionCommandEvents,productionControlEvents} from '../lib/production-lifecycle.ts';
import {authorizeSetup,setupEvents,setupRules,authorizeReselectionCancel,reselectionCancelRules,
 authorizeReselectionCommit,reselectionCommitRules,authorizeLibraryControl,libraryControlRules,
 authorizeJobLease,jobLeaseRules,classifyJobFailure,jobFailureRules,resolveProductionService,runtimeServiceRules,
 resolveImageRead,imageReadRules,resolveInterruptedJob,interruptedJobRules} from '../lib/production-lifecycle.ts';

/** 一篇已完成、审片通过的 DAG 故事，图片文件写入隔离书库。 */
async function completedStory(f){
 const id=crypto.randomUUID(),s=story({length:6});s.id=id;
 drive(s,replies());
 for(const key of s.dag.order)await f.media.put(referenceImageKey(id,s.dag.frames[key].image),png,{contentType:'image/png'});
 const doc={...s.doc,dag:s.dag,...projectDocument(s.dag,null)},now=new Date().toISOString();
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at) VALUES(?,?,?,?,'background','active','completed',?,?)")
  .bind(id,owner,JSON.stringify(s.selection),JSON.stringify(doc),now,now).run();
 return {id,dag:s.dag};
}
const saved=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);
const textCalls=control=>control.plans.length+control.outlines.length+control.batches.length+control.reflections.length+control.reflectionRepairs.length+control.frameReviews.length+control.structures.length+control.repairs.length;
const timelineStep=(session,id)=>generationProgress(session,Date.now()).steps.find(step=>step.id===id);
const jobAttempts=async(f,id)=>(await f.app.services.database.prepare('SELECT id,kind,state,attempts,lease_token FROM production_jobs WHERE session_id=? ORDER BY id').bind(id).all()).results;
const offered=(session,event)=>session.lifecycle.actions.some(action=>action.event===event);

test('reprepare refreshes suggestions in a new generation without altering a confirmed story',async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f);
 const route=`sessions/${id}`,before=await f.read(id),command={requestId:crypto.randomUUID(),action:'reprepare'};
 assert.ok(offered(before,'reprepare'));
 const revision=await f.json(`${route}/revisions`);
 const draft=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection});
 assert.equal((await f.request(`sessions/${draft.id}/production-control`,'POST',{...command,requestId:crypto.randomUUID()})).status,409);
 const release=Promise.withResolvers(),generator=f.generation.generator.bind(f.generation);
 let started=false;
 f.generation.generator=()=>{
  const active=generator();
  return {...active,async recommend(...args){const result=await active.recommend(...args);started=true;await release.promise;return result;}};
 };
 try{
  const accepted=await f.json(`${route}/production-control`,'POST',command);
  assert.equal(accepted.lifecycle.phase,'completed');
  assert.equal(accepted.lifecycle.preparationRefresh,'pending');
  await until(()=>started);
  assert.equal((await f.request(`${route}/production-control`,'POST',{...command,requestId:crypto.randomUUID()})).status,409);
  assert.equal((await f.json(`${route}/production-control`,'POST',command)).id,id);
  assert.equal(offered(accepted,'edit-revision'),false);
  assert.equal((await f.request(`${route}/revisions`,'POST',{requestId:crypto.randomUUID(),token:revision.token,changes:{artStyle:before.selection.artStyle}})).status,409);
  await f.json(`${route}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'pause'});
 }finally{release.resolve();}
 await until(async()=>(await f.read(id)).lifecycle.preparationRefresh==='none');
 const after=await f.read(id),stored=await saved(f,id);
 assert.equal(after.state,'completed');
 assert.equal(after.lifecycle.control,'paused');
 assert.equal(after.frameRecommendation.count,7);
 assert.equal(stored.dag.preparationGeneration,1);
 assert.deepEqual(after.selection,before.selection);
 assert.deepEqual(after.story.pages,before.story.pages);
 assert.equal(f.control.calls.length,0);
 assert.equal(f.control.recommendations.length,1);
});

test('reprepare and standalone landscape drawings settle independently',async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f),route=`sessions/${id}`;
 const {startToken}=await f.json(`${route}/landscape`);
 await f.json(`${route}/landscape`,'POST',{startToken});
 await until(()=>f.control.calls.length>0);
 const release=Promise.withResolvers(),generator=f.generation.generator.bind(f.generation);
 let started=false;
 f.generation.generator=()=>{
  const active=generator();
  return {...active,async recommend(...args){started=true;await release.promise;return active.recommend(...args);}};
 };
 try{
  await f.json(`${route}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'reprepare'});
  await until(()=>started);
  assert.equal(f.control.calls.length,1);
  f.control.hold=false;
  f.control.calls[0].resolve();
  await until(async()=>(await f.json(`${route}/landscape`)).state==='completed');
  assert.equal((await saved(f,id)).dag.repreparing,true);
  assert.equal(f.control.calls.length,6);
  assert.ok(f.control.calls.every(call=>call.landscape));
 }finally{f.control.hold=false;release.resolve();}
 await until(async()=>(await f.read(id)).lifecycle.preparationRefresh==='none');
 assert.equal(f.control.recommendations.length,1);
});

test('CLI reprepare records intent and run awaits the refreshed recommendation',async t=>{
 const {executeHeadless}=await import('../server/headless-cli.ts');
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f),before=await f.read(id);
 await f.stop();
 const run=(...args)=>executeHeadless(process.cwd(),[...args,'--data-dir',f.dataDirectory],{generation:f.generation,variables:{}});
 const accepted=await run('stories','reprepare',id,'--request-id',crypto.randomUUID());
 assert.equal(accepted.session.lifecycle.phase,'completed');
 assert.equal(accepted.session.lifecycle.preparationRefresh,'pending');
 assert.equal(f.control.recommendations.length,0);
 const refreshed=await run('run',id,'--until','prepared','--timeout','20');
 assert.equal(refreshed.session.lifecycle.phase,'completed');
 assert.equal(refreshed.session.frameRecommendation.count,7);
 assert.deepEqual(refreshed.session.story.pages,before.story.pages);
 assert.equal(f.control.recommendations.length,1);
 assert.equal(f.control.calls.length,0);
});

test('CLI run reports a failed preparation refresh on a completed story',async t=>{
 const {executeHeadless}=await import('../server/headless-cli.ts');
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f);
 await f.stop();
 const generator=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>({...generator(),async recommend(){throw Error('controlled refresh failure');}});
 const command=(...args)=>executeHeadless(process.cwd(),[...args,'--data-dir',f.dataDirectory],{generation:f.generation,variables:{}});
 await command('stories','reprepare',id,'--request-id',crypto.randomUUID());
 const result=await command('run',id,'--until','prepared','--timeout','5');
 assert.equal(result.reason,'blocked');assert.equal(result.session.lifecycle.phase,'completed');
 assert.equal(result.session.lifecycle.faults.find(fault=>fault.stage==='prepare').state,'pending');
});

test('detail, shelf and revision write responses agree on current story action offers',async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f),route=`sessions/${id}`;
 const initial=await f.read(id);
 for(const event of ['open-reselection','edit-revision','save-revision','redraw','cover','copy','copy-draft','start-landscape','image-health','delete']){
  assert.ok(offered(initial,event),event);
 }
 assert.deepEqual(initial.lifecycle.actions.filter(action=>action.event==='image-health').map(action=>action.page),[1,2,3,4,5,6]);
 const draft=await f.json(`${route}/reselection`,'POST',{requestId:crypto.randomUUID()});
 assert.ok(offered(draft,'conditions'));
 assert.ok(offered(draft,'cancel-reselection'));
 assert.equal(offered(draft,'commit-reselection'),false);
 assert.equal(offered(draft,'confirm'),false);
 const staleDraft=await f.request(`sessions/${draft.id}/setup`,'POST',{action:'conditions',generation:draft.intake.generation+1,
  requestId:crypto.randomUUID(),conditions:{bookId:'zhuangzi',theme:'另一个主题',productionPrompt:''}});
 assert.equal(staleDraft.status,409);
 assert.equal((await staleDraft.json()).session.id,draft.id);
 assert.equal((await f.request(`${route}/reselection/${draft.id}`,'POST',{requestId:crypto.randomUUID(),batch:0,index:0,generation:draft.intake.generation})).status,400);
 assert.equal((await f.json(`${route}/reselection/${draft.id}`,'DELETE')).id,id);
 const {token}=await f.json(`${route}/revisions`),requestId=crypto.randomUUID();
 const revised=await f.json(`${route}/revisions`,'POST',{requestId,token,changes:{artStyle:'watercolor'}});
 const detail=await f.read(requestId),card=(await f.json('library/shelf')).find(item=>item.id===requestId);
 assert.deepEqual(revised.lifecycle.actions,detail.lifecycle.actions);
 assert.deepEqual(card.lifecycle.actions,detail.lifecycle.actions);
 assert.deepEqual((await f.read(id)).lifecycle.actions,[{event:'delete'}]);
 assert.equal((await f.request(`${route}/revisions`)).status,409);
 const conflict=await f.request(`${route}/reselection`,'POST',{requestId:crypto.randomUUID()});
 assert.equal(conflict.status,409);
 assert.deepEqual((await conflict.json()).session.lifecycle,detail.lifecycle);
 assert.equal((await f.request(`${route}/image-health`,'POST',{page:0,image:initial.story.pages[0].image})).status,409);
});

test('edit a caption, save, restart and continue: only the affected review runs and nothing is redrawn',async t=>{
 const f=await productionFixture(t,'codex');
 const {id,dag:before}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(snapshot.plan);
 plan.pages[2].caption='管仲与鲍叔牙分金时，鲍叔让管仲多拿一份。';
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});

 // 已保存，等待继续：在点击继续之前不产生任何模型调用。
 let doc=await saved(f,child);
 assert.equal(doc.dag.continuation?.reason,'revision-saved');
 assert.equal(doc.dag.frames[doc.dag.order[2]].scene,plan.pages[2].caption);
 // 桌面端据此显示「已保存，等待继续」与「继续制作」。
 assert.equal((await f.read(child)).awaitingContinue,true);
 const waiting=await f.read(child);
 assert.equal(waiting.generationControl,'paused','旧界面字段仍显示等待');
 assert.equal(waiting.lifecycle.control,'active','修订等待与读者暂停分别保存');
 assert.equal(waiting.lifecycle.continuation,true);
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.reviews.length,0);

 await f.restart();
 await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed',15000);
 assert.equal((await f.read(child)).awaitingContinue,undefined);

 doc=await saved(f,child);
 assert.equal(doc.dag.continuation,undefined);
 assert.equal(f.control.reviews.length,1,'one review call for the affected verdicts');
 assert.equal(f.control.calls.length,0,'no drawing calls');
 assert.equal(textCalls(f.control),0,'no planning, repair or frame-count calls');
 // 受影响的结论：被改画幅及相邻画幅的逐幅结论（硬输入变化）与叙事结论（核对输入变化）；其余结论原样保留。
 const recorded=p=>JSON.stringify([p?.inputs,p?.checks??null]);
 const changed=Object.keys(doc.dag.products).filter(k=>/Verdict:/.test(k)&&recorded(doc.dag.products[k])!==recorded(before.products[k])).sort();
 const [, second,third,fourth]=doc.dag.order;
 assert.deepEqual(changed,[`frameVerdict:${second}`,`frameVerdict:${third}`,`frameVerdict:${fourth}`,'narrativeVerdict:'].sort());
 assert.deepEqual(doc.dag.order.map(k=>doc.dag.products[`frameImage:${k}`].hash),before.order.map(k=>before.products[`frameImage:${k}`].hash));
 assert.equal(doc.images.length,6);
 assert.ok(doc.images.every(url=>url.startsWith(`/api/reader/media/${child}/`)),'the new version owns copies of its images');
});

const zhuangzi={title:'齐物论',text:'昔者庄周梦为胡蝶，栩栩然胡蝶也，自喻适志与！不知周也。俄然觉，则蘧蘧然周也。不知周之梦为胡蝶与，胡蝶之梦为周与？',url:'https://example.test/zhuangzi',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01'};
/** 一篇已确认、尚未制作的 DAG 故事。 */
async function confirmedStory(f,length=4,prepared={}){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const doc={plan:null,images:[],audio:[],usage:[],original:zhuangzi,dag:emptyDag(),...prepared};
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at) VALUES(?,?,?,?,'background','active','idle',?,?)")
  .bind(id,owner,JSON.stringify({...selection,length}),JSON.stringify(doc),now,now).run();
 return id;
}
const count=(list,name)=>list.filter(n=>n===name).length;

test('a confirmed story runs from the outline to its last image through the production path',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const doc=await saved(f,id);
 for(const [name,n] of [['brief',1],['characters',1],['outline',1],['sceneBatch',1],['visual',1]])assert.equal(count(f.control.dagCalls,name),n,name);
 assert.equal(f.control.reflections.length,1,'one ending call');
 assert.equal(f.control.frameReviews.length,0,'a fixed-length story has no frame-count check (as in v0.14.0)');
 assert.equal(f.control.reviews.length,1,'one review call');
 assert.equal(f.control.calls.length,4,'one drawing per frame');
 const first=f.control.calls.find(c=>c.page===0);
 assert.equal(first.reference,undefined,'the first frame has no reference image');
 assert.ok(f.control.calls.filter(c=>c.page>0).every(c=>c.reference),'later frames use the first image as reference');
 assert.equal(doc.plan.pages.length,4);
 assert.equal(doc.images.filter(Boolean).length,4);
 assert.ok(!f.control.calls.some(c=>c.prompt.includes(selection.productionPrompt)),'drawing prompts carry no production requirements');
});

/** 保存一次修订并继续制作到完成；返回新版文档。 */
async function revise(f,id,changes,{expectContinue=true}={}){
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:typeof changes==='function'?changes(snapshot):changes});
 if(expectContinue){
  assert.equal((await saved(f,child)).dag.continuation?.reason,'revision-saved');
  if(typeof changes!=='function'&&changes.redrawPages?.length===1){
   const waiting=await f.read(child);
   assert.equal(waiting.redrawPage,changes.redrawPages[0]);
   assert.equal(waiting.generationProgress.phase,'image');
   assert.equal(waiting.generationProgress.reviewStatus,'passed');
  }
  await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 }
 await until(async()=>(await f.read(child)).state==='completed',20000);
 return {child,doc:await saved(f,child)};
}

test('deleting a frame keeps every other image and identity: no drawing, one frame check and one review',async t=>{
 const f=await productionFixture(t,'codex');
 const {id,dag:before}=await completedStory(f);
 const {doc}=await revise(f,id,snapshot=>({removedFrames:[3],plan:{...snapshot.plan,pages:snapshot.plan.pages.filter((_,i)=>i!==2)}}));
 assert.deepEqual(doc.dag.order,before.order.filter((_,i)=>i!==2));
 assert.equal(f.control.calls.length,0,'no drawing calls');
 assert.equal(f.control.frameReviews.length,0,'no frame-count check for a fixed-length story');
 assert.equal(f.control.reviews.length,1);
 // 标题与结语候选绑定画幅身份序列，顺序改变后重新拟定；其余文字调用为零。
 assert.equal(f.control.reflections.length,1);
 assert.equal(textCalls(f.control)-f.control.reflections.length,0);
 assert.deepEqual(doc.dag.order.map(k=>doc.dag.products[`frameImage:${k}`].hash),before.order.filter((_,i)=>i!==2).map(k=>before.products[`frameImage:${k}`].hash));
});

test('redrawing one image with a note draws only that frame, with the note and the first image as reference',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const {doc}=await revise(f,id,{redrawPages:[2],redrawNotes:{'2':'把背景改成雨夜'}});
 assert.equal(f.control.calls.length,1);
 assert.equal(f.control.calls[0].page,1);
 assert.match(f.control.calls[0].prompt,/把背景改成雨夜/);
 assert.ok(f.control.calls[0].reference,'the first image is the reference');
 assert.equal(f.control.reviews.length+textCalls(f.control),0,'no text calls');
 assert.equal(doc.dag.frames[doc.dag.order[1]].redrawNote,'把背景改成雨夜');
});

test('confirming a reader redraw starts one frame immediately and replays without drawing again',async t=>{
 const f=await productionFixture(t,'codex');
 const {id,dag:before}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const requestId=crypto.randomUUID(),route=`sessions/${id}/revisions`;
 const submission={requestId,token:snapshot.token,changes:{redrawPages:[2]},startRedraw:true};
 const invalid=await f.request(route,'POST',{...submission,changes:{redrawPages:[2,3]}});
 assert.equal(invalid.status,400);
 assert.equal(f.control.calls.length,0);

 const session=await f.json(route,'POST',submission);
 assert.equal(session.id,requestId);
 assert.equal(session.awaitingContinue,undefined);
 assert.equal(session.generationControl,'active');
 assert.equal(session.redrawPage,2);
 assert.equal(session.generationProgress.reviewStatus,'passed');
 await until(()=>f.control.calls.length===1);
 assert.equal(f.control.calls[0].page,1);

 const running=await f.read(requestId),jobs=await jobAttempts(f,requestId);
 assert.equal(running.productionState,'running');
 assert.equal(shelfGenerationStatus(running).message,'正在重绘第 2 幅');
 assert.equal(timelineStep(running,'image').state,'current');
 assert.equal(generationProgress(running,Date.now()).ready,5);
 const renamed=await f.json(`sessions/${requestId}/title`,'POST',{title:'改过的书架显示名'});
 assert.equal(renamed.story.title,'改过的书架显示名');
 await t.test('a display-only write returns the same running status consumed by the reader',()=>{
  assert.deepEqual(renamed.lifecycle,running.lifecycle);
  assert.deepEqual([shelfGenerationStatus(renamed).message,renamed.generationProgress.startedAt],
   [shelfGenerationStatus(running).message,running.generationProgress.startedAt]);
 });
 const current=await f.read(requestId);
 assert.equal(current.id,running.id);
 assert.equal(current.revision.number,running.revision.number);
 assert.equal(current.generationControl,'active');
 assert.equal(current.productionState,'running');
 assert.equal(current.awaitingContinue,undefined);
 assert.equal(current.redrawPage,2);
 assert.deepEqual(current.generationProgress,running.generationProgress);
 assert.deepEqual(await jobAttempts(f,requestId),jobs);
 const shelf=await f.json('sessions');
 assert.deepEqual(shelf.map(s=>[s.id,s.story.title]),[[requestId,'改过的书架显示名']]);

 assert.equal((await f.json(route,'POST',submission)).id,requestId);
 f.control.calls[0].resolve();
 await until(async()=>(await f.read(requestId)).state==='completed',15000);

 const after=await saved(f,requestId);
 assert.deepEqual(after.plan,snapshot.plan);
 assert.equal((await f.read(requestId)).story.title,'改过的书架显示名');
 assert.equal(after.images.filter(Boolean).length,6);
 assert.equal(f.control.calls.length,1);
 assert.deepEqual(f.control.dagCalls,[]);
 assert.equal(f.control.reviews.length+textCalls(f.control),0);
 const reused=before.order.filter((_,index)=>index!==1).map(key=>`frameImage:${key}`);
 assert.deepEqual(reused.map(key=>after.dag.products[key]),reused.map(key=>before.products[key]));
 assert.deepEqual((await saved(f,id)).images,snapshot.images);
});

test('renaming a revision waiting for continue preserves its authorization and edit token',async t=>{
 const f=await productionFixture(t,'codex');
 const {id}=await completedStory(f);
 const parent=await f.json(`sessions/${id}/revisions`);
 const {id:child}=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:parent.token,changes:{artStyle:'watercolor'}});
 const route=`sessions/${child}`,before=await f.read(child),document=await saved(f,child);
 const {token}=await f.json(`${route}/revisions`);
 await f.json(`${route}/title`,'POST',{title:'等待继续的新故事名'});
 const current=await f.read(child),snapshot=await f.json(`${route}/revisions`);
 assert.equal(current.story.title,'等待继续的新故事名');
 assert.deepEqual(current.revision,before.revision);
 assert.equal(current.awaitingContinue,true);
 assert.equal(current.generationControl,'paused');
 assert.equal(shelfGenerationStatus(current).message,'已保存，等待继续');
 assert.equal(snapshot.token,token);
 assert.deepEqual(await saved(f,child),document);
 assert.deepEqual(await jobAttempts(f,child),[]);
 assert.equal(f.control.dagCalls.length+f.control.calls.length+f.control.reviews.length,0);
});

test('saving normalized-equivalent production settings leaves the current running revision alone',async t=>{
 const f=await productionFixture(t,'codex');
 const id=await f.create(3,{productionPrompt:''});
 await until(()=>f.control.calls.length===1);
 const route=`sessions/${id}`,before=await f.read(id),jobs=await jobAttempts(f,id);
 const {token}=await f.json(`${route}/revisions`),changes={productionPrompt:'   '};
 const preview=await f.json(`${route}/revisions/preview`,'POST',{token,changes});
 const command={requestId:crypto.randomUUID(),token,changes};
 assert.equal((await f.json(`${route}/revisions`,'POST',command)).id,id);
 assert.equal((await f.json(`${route}/revisions`,'POST',command)).id,id);
 assert.equal((await f.request(`${route}/revisions`,'POST',{...command,changes:{productionPrompt:'不同制作要求'}})).status,409);
 const latest=await f.json(`${route}/current`),current=await f.read(latest.id);
 assert.deepEqual({changed:preview.changed,sameId:current.id===id,control:current.generationControl,state:current.productionState,ready:current.ready,jobs:await jobAttempts(f,id)},
  {changed:false,sameId:true,control:before.generationControl,state:before.productionState,ready:before.ready,jobs});
});

test('running status names the active drawing when an earlier frame awaits recovery',async t=>{
 const f=await productionFixture(t,'codex');
 const {id}=await completedStory(f),db=f.app.services.database,doc=await saved(f,id);
 const blocked=doc.dag.order[1],drawable=doc.dag.order[4],now=Date.now();
 for(const [page,key] of [[1,blocked],[4,drawable]]){
  delete doc.dag.frames[key].image;
  delete doc.dag.products[`frameImage:${key}`];
  doc.images[page]='';
 }
 await db.prepare("UPDATE stories SET document=?,generation_control='paused',state='idle' WHERE id=?").bind(JSON.stringify(doc),id).run();
 await db.prepare("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,message,created_at,updated_at) VALUES(?,?,?,'job','frameImage',?,'dag','第 2 幅绘图失败',?,?)").bind(crypto.randomUUID(),id,owner,blocked,now,now).run();
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});
 await until(()=>f.control.calls.length===1);
 const current=await f.read(id),shelf=(await f.json('sessions')).find(s=>s.id===id);
 assert.deepEqual(f.control.calls.map(call=>call.page+1),[5]);
 assert.equal(current.productionState,'running');
 assert.deepEqual(current.faults.map(fault=>[fault.page+1,fault.state]),[[2,'pending']]);
 assert.equal(current.lifecycle.activity.state,'running');
 assert.deepEqual(current.lifecycle.activity.jobs.map(job=>job.pages),[[5]]);
 assert.equal(current.lifecycle.activity.jobs[0].startedAt,current.generationProgress.startedAt);
 assert.deepEqual(shelf.lifecycle,current.lifecycle);
 const card=(await f.json('library/shelf')).find(s=>s.id===id);
 assert.deepEqual(card.lifecycle,current.lifecycle);
 assert.equal(shelfGenerationStatus(card).detail,'第 2 幅待处理');
 f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).state==='failed');
 assert.deepEqual(f.control.calls.map(call=>call.page+1),[5]);
 assert.deepEqual([current.stage,shelfGenerationStatus(shelf).message],['正在绘制第 5 幅','正在绘制第 5 幅']);
});

for(const shelf of [false,true])test(`${shelf?'shelf':'detail'} reports one database state across a concurrent image health update`,async t=>{
 const {DatabaseSync}=await import('node:sqlite'),{join}=await import('node:path');
 const f=await productionFixture(t,'codex');
 f.options.production={autoStart:false};
 await f.restart();
 const {id}=await completedStory(f),doc=await saved(f,id),frame=doc.dag.order[1];
 const writer=new DatabaseSync(join(f.dataDirectory,'shiqu.sqlite'));
 const db=f.app.services.database,read=db.readTransaction.bind(db),faultId=crypto.randomUUID();
 const now=Date.now();
 let changed=false;
 doc.dag.products[`frameImage:${frame}`].readable=false;
 db.readTransaction=body=>read(tx=>body({...tx,all(sql,...args){
  const rows=tx.all(sql,...args);
  if(!changed&&sql.includes('FROM stories')){
   changed=true;
   writer.exec('BEGIN IMMEDIATE');
   writer.prepare("UPDATE stories SET generation_control='stopped',document=?,state='idle' WHERE id=?").run(JSON.stringify(doc),id);
   writer.prepare("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,image,message,created_at,updated_at) VALUES(?,?,?,'image-loss','frameImage',?,'dag',?,?,?,?)")
    .run(faultId,id,owner,frame,doc.images[1],'图片丢失',now,now);
   writer.exec('COMMIT');
  }
  return rows;
 }}));
 const snapshot=async()=>shelf?(await f.json('library/shelf')).find(card=>card.id===id):f.read(id);
 try{
  const before=(await snapshot()).lifecycle;
  assert.equal(changed,true);
  assert.deepEqual([before.phase,before.control,before.faults.length],['completed','active',0]);
  const after=(await snapshot()).lifecycle;
  assert.deepEqual([after.phase,after.control,after.faults[0].id],['production','stopped',faultId]);
 }finally{db.readTransaction=read;writer.close();}
});

test('dispatch rule guards are exhaustive and mutually exclusive',()=>{
 const checks=[false,true],reached=new Set();
 for(const version of ['current','superseded','deleted'])for(const control of ['active','paused','stopped'])
  for(const continuation of checks)for(const generationCurrent of checks)for(const demand of checks)for(const fault of checks)for(const inputCurrent of checks){
   const state={version,control,continuation,generationCurrent,demand,fault,inputCurrent};
   const matches=dispatchRules.filter(rule=>rule.matches(state));
   assert.equal(matches.length,1,JSON.stringify(state));
   reached.add(matches[0]);
   assert.equal(authorizeDispatch(state),matches[0].decision);
  }
 assert.equal(authorizeDispatch({version:'current',control:'active',continuation:false,generationCurrent:true,demand:true,fault:false,inputCurrent:true}),'allow');
 assert.equal(reached.size,dispatchRules.length);
});

test('production command guards choose one rule for every combination of persisted control and target validity',()=>{
 const flags=[false,true],reached=new Set();
 for(const event of productionCommandEvents)for(const version of ['current','superseded','deleted'])
  for(const control of ['active','paused','stopped'])for(const continuation of flags)for(const targetCurrent of flags)
   for(const targetReady of flags)for(const stopping of flags){
    const state={version,control,continuation,targetCurrent,targetReady,stopping};
    const matching=commandRules.filter(rule=>rule.matches(event,state));
    assert.equal(matching.length,1);
    reached.add(matching[0]);
    assert.deepEqual(authorizeProductionCommand(event,state),matching[0].decide(event,state));
   }
 assert.equal(reached.size,commandRules.length);
});

test('each production command has its own effect and refuses an invalid target or gate',()=>{
 const expected={
  background:{kind:'control',mode:'background',control:null},pause:{kind:'control',mode:null,control:'paused'},
  stop:{kind:'control',mode:null,control:'stopped'},resume:{kind:'control',mode:'background',control:'active'},
  continue:'continue-revision',retry:'recover-fault','continue-repair':'grant-repair-budget','skip-review':'save-skipped-review',
  'override-review':'release-review-target','apply-model':'replace-model-snapshot',reprepare:'refresh-preparation','image-health':'probe-image',
  'start-landscape':'queue-landscape','retry-landscape':'recover-landscape','open-reselection':'create-selection-draft','edit-revision':'read-edit-basis',
  'save-revision':'publish-revision','edit-review-notes':'save-review-notes',redraw:'queue-redraw',cover:'save-cover',copy:'copy-reviewed','copy-draft':'copy-text-draft',
 };
 assert.deepEqual([...productionCommandEvents].sort(),Object.keys(expected).sort());
 for(const event of productionCommandEvents){
  const state={version:'current',control:['resume','skip-review'].includes(event)?'paused':'active',
   continuation:event==='continue',targetCurrent:true,targetReady:true,stopping:false};
  const effect=expected[event];
  assert.deepEqual(authorizeProductionCommand(event,state),{allowed:true,effect:typeof effect==='string'?{kind:effect}:effect},event);
  const denied=authorizeProductionCommand(event,{...state,continuation:false,targetReady:false});
  assert.deepEqual([denied.allowed,denied.status],[false,409],event);
  const stopping=authorizeProductionCommand(event,{...state,stopping:true});
  assert.deepEqual([stopping.allowed,stopping.status],[false,503],event);
 }
});

function booleanStates(keys){
 return Array.from({length:2**keys.length},(_,bits)=>Object.fromEntries(keys.map((key,index)=>[key,!!(bits&(1<<index))])));
}

function checkRules(inputs,rules,authorize){
 const reached=new Set();
 for(const input of inputs){
  const candidates=rules.filter(rule=>rule.matches(input));
  assert.equal(candidates.length,1,JSON.stringify(input));
  const [matched]=candidates;
  reached.add(matched.id);
  assert.deepEqual(authorize(input),matched.decision);
 }
 assert.deepEqual([...reached].sort(),rules.map(rule=>rule.id).sort());
}

test('setup rules select one result over phase, token, lease and search equivalence classes',()=>{
 const common=['superseded','replacement','confirmed'];
 const extra={
  conditions:['generationCurrent','selected','locked'],
  search:['generationCurrent','selected','locked'],
  more:['selected','sameSearch','automatic','hasCandidates','searchLimit','combined'],
  choose:['generationCurrent','draftCurrent','locked','candidateExists'],
  draft:['generationCurrent','draftCurrent'],
  recommend:['generationCurrent','draftCurrent','locked','selected'],
  confirm:['generationCurrent','draftCurrent','locked','selected','preparationReady','briefReady'],
 };
 function* inputs(){
  for(const event of setupEvents)for(const guard of booleanStates([...common,...extra[event]]))
   for(const phase of [undefined,'discovering','choosing','preparing','confirming','confirmed'])
    for(const state of event==='more'?['idle','searching','failed']:['idle'])
     yield {event,state:{phase,search:{state},...guard}};
 }
 checkRules(inputs(),setupRules,({event,state})=>authorizeSetup(event,state));
});

test('replacement and library guards exhaust ownership, membership, token and deletion classes',()=>{
 checkRules(['foreign','draft','promoted'],reselectionCancelRules,authorizeReselectionCancel);
 checkRules(booleanStates(['draftCurrent','generationCurrent','basisCurrent','requirementsCurrent','candidateExists']),reselectionCommitRules,authorizeReselectionCommit);
 checkRules(['delete','restore'].flatMap(event=>booleanStates(['owned','deleted']).map(state=>({event,...state}))),libraryControlRules,authorizeLibraryControl);
});

test('job rules select one result through lease expiry, send, settlement and failure classes',()=>{
 checkRules(['paid-send','settle'].flatMap(event=>booleanStates(['held','expired']).map(state=>({event,...state}))),jobLeaseRules,authorizeJobLease);
 checkRules(booleanStates(['persistence','yielded','stopping','drains','terminal','timeout','contentBlocked']),jobFailureRules,classifyJobFailure);
});

test('service availability, image checks and interrupted tasks partition their observed inputs',()=>{
 checkRules(booleanStates(['configured','stopping','snapshotAvailable']),runtimeServiceRules,resolveProductionService);
 checkRules(['missing','readable','unavailable'].flatMap(result=>[true,false].map(fault=>({result,fault}))),imageReadRules,resolveImageRead);
 checkRules(booleanStates(['running','localLease','resume']).filter(state=>state.running||!state.localLease),interruptedJobRules,resolveInterruptedJob);
});

test('delete and restore require an owned story and replay a completed restore without resuming',async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f),missing=crypto.randomUUID();
 assert.equal((await f.request(`library/${missing}`,'DELETE')).status,404);
 assert.equal((await f.request(`library/${missing}/restore`,'POST',{})).status,404);
 const removed=await f.json(`library/${id}`,'DELETE');
 assert.deepEqual(await f.json(`library/${id}`,'DELETE'),removed);
 assert.equal((await f.request(`sessions/${id}`)).status,404);
 assert.equal((await f.json(`library/${id}/restore`,'POST',{})).restored,true);
 assert.equal((await f.json(`library/${id}/restore`,'POST',{})).restored,false);
 assert.equal((await f.read(id)).lifecycle.control,'stopped');
});

test('production control routes accept current work and reject a finished or superseded version',async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f);
 const route=`sessions/${id}`,{token}=await f.json(`${route}/revisions`);
 for(const action of productionControlEvents){
  const response=await f.request(`${route}/production-control`,'POST',{requestId:crypto.randomUUID(),action});
  assert.equal(response.status,409,action);
 }
 const child=crypto.randomUUID(),plan=structuredClone((await f.json(`${route}/revisions`)).plan);
 plan.pages[0].caption='庄周从梦中醒来。';
 await f.json(`${route}/revisions`,'POST',{requestId:child,token,changes:{plan}});
 const childRoute=`sessions/${child}/production-control`;
 for(const [action,expected] of [['pause','paused'],['background','paused'],['stop','stopped'],['resume','active']]){
  const command={requestId:crypto.randomUUID(),action};
  const changed=await f.json(childRoute,'POST',command);
  assert.equal(changed.lifecycle.control,expected,action);
  assert.equal(changed.lifecycle.continuation,true,action);
  assert.equal((await f.json(childRoute,'POST',command)).lifecycle.control,expected,`重放 ${action}`);
  assert.equal((await f.request(`${route}/production-control`,'POST',{...command,requestId:crypto.randomUUID()})).status,409,action);
 }
});

test('preparation only offers and accepts resume after an explicit pause',async t=>{
 const f=await productionFixture(t,'codex');
 f.options.production={autoStart:false};await f.restart();
 const {id}=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection});
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.intake.phase','preparing') WHERE id=?").bind(id).run();
 const route=`sessions/${id}/production-control`,active=await f.read(id);
 assert.equal(active.lifecycle.phase,'preparation');assert.equal(offered(active,'resume'),false);
 assert.equal((await f.request(route,'POST',{action:'resume'})).status,409);
 const paused=await f.json(route,'POST',{action:'pause'});
 assert.equal(offered(paused,'resume'),true);
 const resumed=await f.json(route,'POST',{action:'resume'});
 assert.equal(resumed.lifecycle.control,'active');assert.equal(offered(resumed,'resume'),false);
});

for(const action of ['pause','stop','delete','replace'])test(`${action} between prescreen and claim grants no lease or drawing call`,async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f);
 const route=`sessions/${id}`,requestId=crypto.randomUUID(),{token}=await f.json(`${route}/revisions`);
 const {queue}=f.app.services.production,canRun=queue.options.canRun;
 const screened=Promise.withResolvers(),release=Promise.withResolvers();
 queue.options.canRun=async job=>{
  const allowed=await canRun(job);
  if(allowed&&job.session_id===requestId){screened.resolve();await release.promise;}
  return allowed;
 };
 await f.json(`${route}/revisions`,'POST',{requestId,token,changes:{redrawPages:[2]},startRedraw:true});
 try{
  await until(async()=>await Promise.race([screened.promise.then(()=>true),turn().then(()=>false)]));
  await changeBeforeDrawing(f,requestId,action);
 }finally{release.resolve();}
 await until(()=>!queue.busy);
 const jobs=await jobAttempts(f,requestId);
 assert.ok(jobs.every(job=>job.attempts===0&&job.lease_token===null));
 if(action!=='replace')assert.deepEqual(jobs.map(job=>job.state),['queued']);
 assert.equal(f.control.calls.length,0);
});

async function changeBeforeDrawing(f,id,action){
 const route=`sessions/${id}`;
 if(action==='delete')return f.json(`library/${id}`,'DELETE');
 if(action!=='replace')return f.json(`${route}/production-control`,'POST',{action});
 const {token}=await f.json(`${route}/revisions`),requestId=crypto.randomUUID();
 return f.json(`${route}/revisions`,'POST',{requestId,token,changes:{artStyle:'watercolor'}});
}

for(const [provider,action] of [['codex','pause'],['codex','stop'],['codex','replace'],['codex','delete'],['gemini','pause'],['gemini','replace'],['openai','pause'],['openai','replace']])test(`${provider}: a drawing held in reference reading pays nothing when ${action} commits`,async t=>{
 const f=provider==='openai'?await productionFixture(t,'codex',{},{imageProvider:'openai'}):await productionFixture(t,provider);
 const {id}=await completedStory(f);
 const route=`sessions/${id}`,requestId=crypto.randomUUID(),{token}=await f.json(`${route}/revisions`);
 const gotReference=Promise.withResolvers(),release=Promise.withResolvers();
 const get=f.media.get.bind(f.media);
 let held=false;
 f.media.get=async key=>{
  if(!held&&key.startsWith(`reader/${requestId}/`)){held=true;gotReference.resolve();await release.promise;}
  return get(key);
 };
 await f.json(`${route}/revisions`,'POST',{requestId,token,changes:{redrawPages:[2]},startRedraw:true});
 try{
  await until(async()=>await Promise.race([gotReference.promise.then(()=>true),turn().then(()=>false)]));
  await changeBeforeDrawing(f,requestId,action);
 }finally{release.resolve();}
 await until(()=>!f.app.services.production.queue.busy);
 assert.equal(f.control.calls.length,0);
 if(action==='pause'||action==='stop')assert.deepEqual((await jobAttempts(f,requestId)).map(({state,attempts})=>[state,attempts]),[['queued',0]]);
 if(action==='delete'){
  await f.json(`library/${requestId}/restore`,'POST',{});
  assert.equal((await f.read(requestId)).lifecycle.control,'stopped');
  assert.equal(f.control.calls.length,0);
 }
});

for(const provider of ['deepseek','claude'])for(const action of ['pause','replace'])test(`${provider}: production text pays nothing when ${action} commits before send`,async t=>{
 const f=await productionFixture(t,provider==='deepseek'?'deepseek':'codex');
 let cliLog,providerApi=f.generation;
 if(provider==='claude'){
  const {writeFile}=await import('node:fs/promises');
  const {join}=await import('node:path'),binary=join(f.root,'claude-fixture');
  cliLog=join(f.root,'claude-paid');
  await writeFile(binary,`#!${process.execPath}
import {appendFileSync} from 'node:fs';
if(process.argv.includes('auth'))console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'}));
else appendFileSync(${JSON.stringify(cliLog)},'paid\\n');
`,{mode:0o755});
  const {createReaderProvider}=await import('../server/generation.ts');
  providerApi=createReaderProvider({SHIQU_AI_PROVIDER:'claude',CLAUDE_BIN:binary},f.media,async()=>assert.fail('no external request'));
  f.options.generation=providerApi;
  await f.restart();
 }
 const {id}=await completedStory(f),route=`sessions/${id}`;
 const {plan,token}=await f.json(`${route}/revisions`),requestId=crypto.randomUUID();
 plan.pages[1].caption='庄周梦醒后从柳树下起身。';
 await f.json(`${route}/revisions`,'POST',{requestId,token,changes:{plan}});
 const release=Promise.withResolvers(),generator=providerApi.generator.bind(providerApi);
 let held=false;
 providerApi.generator=()=>{
  const active=generator();
  return {...active,async textCall(...args){held=true;await release.promise;return active.textCall(...args);}};
 };
 try{
  await f.json(`sessions/${requestId}/production-control`,'POST',{action:'continue'});
  await until(()=>held);
  await changeBeforeDrawing(f,requestId,action);
 }finally{release.resolve();}
 await until(()=>!f.app.services.production.queue.busy);
 if(cliLog){
  const {existsSync}=await import('node:fs');
  assert.equal(existsSync(cliLog),false);
 }else assert.equal(f.control.dagCalls.length,0);
 if(action==='pause')assert.ok((await jobAttempts(f,requestId)).every(job=>job.state==='queued'&&job.attempts===0));
});

test('a drawing held after claim cannot send at the lease expiry boundary',async t=>{
 const f=await productionFixture(t,'codex');
 let now=Date.now();
 f.options.production={now:()=>now};
 await f.restart();
 const {id}=await completedStory(f),route=`sessions/${id}`,requestId=crypto.randomUUID();
 const {token}=await f.json(`${route}/revisions`);
 const media=f.media,read=media.get.bind(media),ready=Promise.withResolvers(),release=Promise.withResolvers();
 media.get=async key=>{
  if(key.startsWith(`reader/${requestId}/`)){ready.resolve();await release.promise;}
  return read(key);
 };
 await f.json(`${route}/revisions`,'POST',{requestId,token,changes:{redrawPages:[2]},startRedraw:true});
 const {queue}=f.app.services.production;
 try{
  await ready.promise;
  const [job]=await queue.jobs(requestId,owner);
  assert.equal(job.state,'running');
  queue.options.canRun=async()=>false;
  queue.renew=async()=>{};
  now=job.lease_until;
 }finally{release.resolve();}
 await until(()=>!queue.busy);
 assert.equal(f.control.calls.length,0);
 assert.deepEqual((await jobAttempts(f,requestId)).map(({state,attempts})=>[state,attempts]),[['queued',0]]);
});

test('dispatch skips an already claimed drawing if the target becomes readable during preparation',async t=>{
 const f=await productionFixture(t,'codex'),{id,dag}=await completedStory(f);
 const route=`sessions/${id}`,requestId=crypto.randomUUID(),{token}=await f.json(`${route}/revisions`);
 const started=Promise.withResolvers(),release=Promise.withResolvers(),get=f.media.get.bind(f.media);
 let held=false;
 f.media.get=async key=>{
  if(!held&&key.startsWith(`reader/${requestId}/`)){held=true;started.resolve();await release.promise;}
  return get(key);
 };
 await f.json(`${route}/revisions`,'POST',{requestId,token,changes:{redrawPages:[2]},startRedraw:true});
 try{
  await until(async()=>await Promise.race([started.promise.then(()=>true),turn().then(()=>false)]));
  const doc=await saved(f,requestId),key=doc.dag.order[1];
  const replacement=`/api/reader/media/${requestId}/1.png`;
  await f.media.put(referenceImageKey(requestId,replacement),png,{contentType:'image/png'});
  doc.dag.frames[key].image=replacement;
  doc.dag.products[`frameImage:${key}`]=dag.products[`frameImage:${dag.order[1]}`];
  doc.images[1]=replacement;
  await f.app.services.database.prepare('UPDATE stories SET document=? WHERE id=?').bind(JSON.stringify(doc),requestId).run();
 }finally{release.resolve();}
 await until(()=>!f.app.services.production.queue.busy);
 assert.equal(f.control.calls.length,0);
 assert.equal((await f.read(requestId)).lifecycle.phase,'completed');
});

test('temporary reference read failure yields the drawing without spending an attempt',async t=>{
 const f=await productionFixture(t,'gemini'),{id}=await completedStory(f);
 f.control.hold=false;
 const route=`sessions/${id}`,requestId=crypto.randomUUID(),{token}=await f.json(`${route}/revisions`);
 const get=f.media.get.bind(f.media);
 let inaccessible=true;
 f.media.get=async key=>{
  if(inaccessible&&key.startsWith(`reader/${requestId}/artifacts/0-`))throw Error('controlled reference I/O failure');
  return get(key);
 };
 await f.json(`${route}/revisions`,'POST',{requestId,token,changes:{redrawPages:[2]},startRedraw:true});
 await until(async()=>(await f.read(requestId)).lifecycle.imageAvailability==='unavailable',5000);
 const pending=await f.read(requestId);
 assert.deepEqual(pending.lifecycle.imageChecks.map(({state,pages})=>({state,pages})),[{state:'temporarily-unavailable',pages:[2]}]);
 assert.equal(pending.lifecycle.faults.length,0);
 assert.equal(f.control.calls.length,0);
 assert.deepEqual((await jobAttempts(f,requestId)).map(({state,attempts})=>[state,attempts]),[['queued',0]]);
 inaccessible=false;
 await until(async()=>(await f.read(requestId)).state==='completed',5000);
 assert.deepEqual((await f.read(requestId)).lifecycle.imageChecks,[]);
 assert.deepEqual(f.control.calls.map(call=>call.page),[1]);
});

for(const action of ['pause','stop','replace','delete'])test(`a sent drawing saves its receipt on the original version when ${action} commits`,async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f);
 const route=`sessions/${id}`,requestId=crypto.randomUUID(),{token}=await f.json(`${route}/revisions`);
 await f.json(`${route}/revisions`,'POST',{requestId,token,changes:{redrawPages:[2]},startRedraw:true});
 await until(()=>f.control.calls.length===1);
 const successor=await changeBeforeDrawing(f,requestId,action);
 if(action==='delete'){
  const entry=(await f.json('deletions')).find(item=>item.storyId===requestId);
  assert.equal(entry.lifecycle.version,'deleted');assert.equal(entry.lifecycle.draining,true);
  assert.deepEqual(entry.lifecycle.actions,[{event:'restore'}]);
 }
 f.control.calls[0].resolve();
 await until(async()=>(await jobAttempts(f,requestId)).some(job=>job.state==='succeeded'));
 assert.ok((await saved(f,requestId)).images[1]);
 assert.equal((await saved(f,requestId)).usage.filter(item=>item.step==='dag:draw'&&!item.originId).length,1);
 assert.equal(f.control.calls.length,1);
 if(action==='replace')assert.equal((await saved(f,successor.id)).images[1],'');
 if(action==='delete'){
  const entry=(await f.json('deletions')).find(item=>item.storyId===requestId);
  assert.equal(entry.lifecycle.draining,false);
  assert.equal(entry.lifecycle.phase,'completed');
  await f.json(`library/${requestId}/restore`,'POST',{});
  assert.equal((await f.read(requestId)).lifecycle.control,'stopped');
 }
});

test('confirming a portrait redraw leaves the earlier landscape set available without a paired draw',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f),route=`sessions/${id}/landscape`;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed',15000);
 const before=f.control.calls.length,old=(await f.json(route)).images;
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:snapshot.token,changes:{redrawPages:[1]},startRedraw:true});
 await until(async()=>(await f.read(child.id)).state==='completed',15000);
 assert.deepEqual(f.control.calls.slice(before).map(({page,landscape})=>[page,landscape]),[[0,false]]);
 assert.equal(f.control.reviews.length+textCalls(f.control),0);
 const [original]=await f.json(`sessions/${child.id}/landscape/sets`);
 assert.equal(original.story.id,id);
 assert.deepEqual(original.images,old);
 assert.equal((await f.json(`sessions/${child.id}/landscape`)).state,'idle');
});

test('a style change converts image descriptions in one batch, re-reviews frames and redraws every image',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const {token}=await f.json(`sessions/${id}/revisions`);
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token,changes:{artStyle:'watercolor'}});
 assert.equal(child.story.pages.length,6);
 assert.equal(timelineStep(child,'plan').state,'done');
 assert.equal(timelineStep(child,'image').state,'paused');
 assert.match(timelineStep(child,'image').detail,/按新画风转换画面描述（第 1–6 幅），完成后重新审片/);
 assert.equal(generationProgress(child,Date.now()).ready,0,'prior images remain readable but do not count toward the new style');
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'continue'});
 await until(async()=>(await f.read(child.id)).state==='completed',15000);
 assert.equal(count(f.control.dagCalls,'restyle'),1,'six frames in one conversion batch');
 assert.equal(count(f.control.dagCalls,'visual'),0);
 assert.equal(f.control.reviews.length,1);
 assert.equal(f.control.calls.length,6);
 // 其余画幅等新首幅完成后再以它为参考绘制。
 assert.equal(f.control.calls[0].page,0);
 assert.ok(f.control.calls.slice(1).every(c=>c.page>0));
});

test('changing detail and style shows the new storyboard progress while the previous pages are readable',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 f.control.autoLength=9;
 const {id}=await completedStory(f);
 const {token}=await f.json(`sessions/${id}/revisions`);
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token,changes:{artStyle:'watercolor',narrativeDetail:'detailed',length:'auto'}});
 assert.equal(child.story.pages.length,6);
 assert.equal(shelfGenerationStatus(child).message,'已保存，等待继续');
 assert.equal(timelineStep(child,'plan').state,'paused');
 assert.equal(timelineStep(child,'plan').detail,'编排全篇提纲 · 新画幅数待编排');
 assert.equal(generationProgress(child,Date.now()).total,null);

 const outline=Promise.withResolvers(),scenes=Promise.withResolvers(),frameCheck=Promise.withResolvers();
 f.control.beforeText=name=>name==='outline'?outline.promise:name==='sceneBatch'?scenes.promise:name==='frames'?frameCheck.promise:undefined;
 const readRunning=async phase=>{
  let session;
  await until(async()=>{session=await f.read(child.id);return session.productionState==='running'&&session.generationProgress.activity?.startsWith(phase);},15000);
  return session;
 };
 try{
  await f.json(`sessions/${child.id}/production-control`,'POST',{action:'continue'});
  const planning=await readRunning('编排全篇提纲');
  assert.equal(shelfGenerationStatus(planning).message,'正在编排全篇提纲');
  assert.equal(timelineStep(planning,'plan').state,'current');
  outline.resolve();
  const drafting=await readRunning('编排叙事分镜');
  assert.equal(timelineStep(drafting,'plan').detail,'编排叙事分镜（第 1–9 幅） · 已保存 0 / 9 幅叙事分镜');
  scenes.resolve();
  const checking=await readRunning('审核画幅数');
  assert.equal(timelineStep(checking,'plan').detail,'9 幅分镜已保存');
  assert.equal(timelineStep(checking,'review').state,'current');
  assert.equal(f.control.calls.length,0,'drawing waits for approval');
 }finally{
  outline.resolve();scenes.resolve();frameCheck.resolve();
 }
 await until(async()=>(await f.read(child.id)).state==='completed',15000);
});

test('a save that would discard a hand edit needs the reader to choose; discarding it then replans',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const edit=await revise(f,id,snapshot=>{const plan=structuredClone(snapshot.plan);plan.pages[1].caption='鲍叔牙在集市上替管仲付了账。';return {plan};});
 const snapshot=await f.json(`sessions/${edit.child}/revisions`);
 const refused=await f.request(`sessions/${edit.child}/revisions`,'POST',{requestId:crypto.randomUUID(),token:snapshot.token,changes:{productionPrompt:'写清选择与代价'}});
 assert.equal(refused.status,409);
 assert.match((await refused.json()).error,/手改/);
 const scene=`scene:${edit.doc.dag.order[1]}`;
 const {doc}=await revise(f,edit.child,{productionPrompt:'写清选择与代价',handEdits:{[scene]:'discard'}});
 assert.notDeepEqual(doc.dag.order,edit.doc.dag.order,'replanning gives frames new identities');
 assert.ok(count(f.control.dagCalls,'outline')>=1);
});

test('a failed step blocks only its dependants: independent steps finish, and recovery completes the story',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 let failing=true;
 f.control.beforeText=async name=>{if(name==='visual'&&failing){failing=false;throw Error('controlled failure');}};
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.length>0&&f.control.reflections.length===1,20000);
 // 不依赖画面描述的结语与幅数核对照常完成；依赖它的审片与绘图都未开始。
 assert.equal(f.control.reviews.length,0);
 assert.equal(f.control.calls.length,0);
 const fault=(await f.read(id)).faults[0];
 assert.equal(fault.state,'pending');
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(count(f.control.dagCalls,'visual'),2);
 assert.equal(f.control.reviews.length,1);
 assert.equal(f.control.calls.length,4);
 assert.ok(!(await f.read(id)).faults?.length);
});

test('landscape images are drawn on request for a completed story; a failure stays on its frame and can be retried',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 let failing=true;
 let status=await f.json(`sessions/${id}/landscape`);
 assert.equal(status.state,'idle');
 assert.ok(status.startToken);
 assert.ok(offered(await f.read(id),'start-landscape'));
 assert.equal((await f.request(`sessions/${id}/landscape`,'POST',{startToken:'0'.repeat(64)})).status,409);
 // 第三幅的横图第一次失败。
 f.control.beforeImage=call=>{if(call.landscape&&call.page===2&&failing){failing=false;throw Error('controlled landscape failure');}};
 status=await f.json(`sessions/${id}/landscape`,'POST',{startToken:status.startToken});
 await until(async()=>{const s=await f.json(`sessions/${id}/landscape`);return s.state!=='running';},20000);
 status=await f.json(`sessions/${id}/landscape`);
 assert.equal(status.state,'partial');
 assert.deepEqual(status.failed,[3]);
 assert.equal((await f.read(id)).state,'completed','an optional failure never undoes completion');
 assert.deepEqual((await f.read(id)).lifecycle.faults,[]);
 assert.ok(status.retryToken);
 assert.equal((await f.request(`sessions/${id}/landscape`,'POST',{retryToken:'0'.repeat(64)})).status,409);
 status=await f.json(`sessions/${id}/landscape`,'POST',{retryToken:status.retryToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
 const landscapes=f.control.calls.filter(c=>c.landscape);
 assert.equal(landscapes.length,7,'six landscapes plus one retry');
 assert.ok(landscapes.every(c=>c.reference),'each landscape uses its portrait as reference');
});

test('a landscape failure that lands after deletion stays retryable once the story is restored',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 f.control.beforeImage=call=>{f.control.hold=call.landscape&&call.page===2;};
 const {id}=await completedStory(f);
 const {startToken}=await f.json(`sessions/${id}/landscape`);
 await f.json(`sessions/${id}/landscape`,'POST',{startToken});
 await until(()=>f.control.calls.some(call=>call.landscape&&call.page===2),20000);
 await f.json(`library/${id}`,'DELETE');
 // 已发出的第三幅横图在删除后返回不可读的结果：失败须记在原版画幅上。
 const broken=f.control.calls.find(call=>call.landscape&&call.page===2);
 broken.bytes=Buffer.from('not an image').toString('base64');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>!(await f.app.services.database.prepare("SELECT 1 FROM production_jobs WHERE session_id=? AND state='running'").bind(id).first()),20000);
 await f.json(`library/${id}/restore`,'POST',{});
 f.control.beforeImage=null;
 const {printId}=await f.json(`sessions/${id}/landscape`);
 await f.json(`sessions/${id}/landscape`,'POST',{control:'resume',printId});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state!=='running',20000);
 const status=await f.json(`sessions/${id}/landscape`);
 assert.equal(status.state,'partial');
 assert.deepEqual(status.failed,[3]);
 assert.ok(status.retryToken,'the failed frame offers a retry');
 assert.deepEqual((await f.read(id)).lifecycle.faults,[]);
 await f.json(`sessions/${id}/landscape`,'POST',{retryToken:status.retryToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
});

test('replacing a completed story withdraws its landscape action and rejects the old token',async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f);
 const route=`sessions/${id}`;
 const {startToken}=await f.json(`${route}/landscape`);
 assert.ok(startToken);
 const {token,plan}=await f.json(`${route}/revisions`);
 plan.pages[0].caption='庄周从梦中醒来。';
 await f.json(`${route}/revisions`,'POST',{requestId:crypto.randomUUID(),token,changes:{plan}});
 assert.equal((await f.json(`${route}/landscape`)).startToken,undefined);
 assert.equal((await f.request(`${route}/landscape`,'POST',{startToken})).status,409);
 const {dag}=await saved(f,id);
 assert.ok(dag.order.every(frame=>dag.frames[frame].landscape===undefined));
});

test('a retained queue-level landscape failure never blocks the completed story after retry',async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f);
 f.control.hold=false;
 const {queue}=f.app.services.production,handler=queue.options.handlers['landscape-print'],run=handler.run;
 handler.run=async(job,context)=>{
  const payload=JSON.parse(job.payload);
  if(payload.input.index===2&&!payload.retry)
   throw Error('controlled failure in the queue boundary');
  return run(job,context);
 };
 const route=`sessions/${id}/landscape`,{startToken}=await f.json(route);
 await f.json(route,'POST',{startToken});
 let landscape;
 await until(async()=>{landscape=await f.json(route);return !!landscape.retryToken;});
 assert.equal((await f.read(id)).state,'completed');
 assert.deepEqual((await f.read(id)).lifecycle.faults,[]);
 await f.json(route,'POST',{retryToken:landscape.retryToken});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.equal((await f.read(id)).state,'completed');
 assert.equal((await f.json('library/shelf')).find(row=>row.id===id).lifecycle.phase,'completed');
 assert.ok((await queue.jobs(id,owner)).some(job=>job.state==='failed'));
 assert.equal((await f.read(id)).lifecycle.faults.length,0);
});

test('a provider content rejection stays on the landscape job',async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f);
 f.control.hold=false;
 const generator=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>{
  const active=generator();
  return {...active,async image(...args){
   if(args[1]===2)throw Error('CONTENT_BLOCKED');
   return active.image(...args);
  }};
 };
 const route=`sessions/${id}/landscape`,{startToken}=await f.json(route);
 await f.json(route,'POST',{startToken});
 await until(async()=>(await f.json(route)).failed.includes(3));
 const state=(await f.read(id)).lifecycle;
 assert.equal(state.phase,'completed');
 assert.deepEqual(state.faults,[]);
 const jobs=(await f.app.services.production.queue.jobs(id,owner)).filter(job=>job.error_code==='CONTENT_BLOCKED');
 assert.deepEqual(jobs.map(job=>[job.attempts,job.interrupted]),[[1,0]]);
});

test('preparation results carry into production: a verified summary and saved suggestions are not paid for again',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const summary='庄周梦见自己化为蝴蝶，翩然自得，醒来后不知是庄周梦为蝴蝶，还是蝴蝶梦为庄周。';
 const id=await confirmedStory(f,4,{original:{...zhuangzi,storyBrief:{summary,matchReason:'原文完整记载梦蝶与醒后的疑问。',verified:true}},frameRecommendation:{count:4,reason:'梦、醒、疑三段各需展开。'},frameCountConfirmed:true});
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const doc=await saved(f,id);
 assert.equal(count(f.control.dagCalls,'brief'),0,'the verified summary is adopted');
 assert.equal(doc.dag.brief,summary);
 assert.equal(doc.plan.summary,summary);
 assert.equal(f.control.reviews.length,1);
});

test('changing the production scope refreshes the factual synopsis once with the new scope',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const summary='庄周梦见化蝶，醒后追问梦与醒的区别。';
 const revisionSummary='庄周醒后想起梦中化蝶，追问庄周与蝴蝶的区别。';
 const scope='从庄周醒来开始，保留最后的追问。';
 const id=await confirmedStory(f,3,{
  original:{...zhuangzi,storyBrief:{summary,matchReason:'原文交代梦蝶与醒后的追问。',verified:true}},
  summaryProductionPrompt:selection.productionPrompt,
 });
 await until(async()=>(await f.read(id)).state==='completed',15000);
 assert.equal(count(f.control.dagCalls,'brief'),0);
 assert.deepEqual(f.control.reviews[0].storyBrief,{summary,matchReason:'原文交代梦蝶与醒后的追问。'});
 const requests=[];
 f.control.beforeText=(name,payload)=>{
  if(name==='brief'){requests.push(payload);return {summary:revisionSummary};}
 };
 const {doc}=await revise(f,id,{productionPrompt:scope});
 assert.equal(requests.length,1);
 assert.equal(requests[0].productionPrompt,scope);
 assert.equal(requests[0].verifiedOriginal.text,zhuangzi.text);
 assert.equal(doc.plan.summary,revisionSummary);
 assert.deepEqual(f.control.reviews.at(-1).storyBrief,{summary:revisionSummary});
});

// ——— 审查意见第 2 轮：正式入口与边界 ———

const snapshotA={provider:'codex',models:{text:'model-at-confirmation',image:null}};
/** 带模型快照服务的夹具：current 给出确认时的快照，provider 按快照给出提供方（null 表示服务不可用）。 */
async function snapshotFixture(t,service){
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 f.options.production={snapshots:service};
 await f.restart();
 return f;
}

/** 从创建、查找、选题到确认，全部经正式接口；返回故事编号。 */
async function confirmThroughIntake(f){
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}}],note:''});
 const created=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}});
 const id=created.id;
 if(created.intake.search.state==='idle'&&!created.intake.batches.length)await f.startDiscovery(id);
 // 查找候选需要阅读需求（选题窗口打开）。
 await f.demand(id);
 await until(async()=>(await f.read(id)).intake.phase==='choosing',20000);
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(id)).intake.phase==='confirming',20000);
 // 确认本身走正式接口：确认后由 adopt() 建立 dag，并记录当时的模型快照。
 const prepared=await f.read(id);
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:prepared.intake.generation,action:'confirm',settings:{artStyle:'watercolor',productionPrompt:'clear captions',narrativeDetail:'balanced',length:4}});
 return id;
}

test('a story confirmed through intake runs on the DAG path with its setup generation',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const id=await confirmThroughIntake(f);
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const doc=await saved(f,id);
 assert.equal(doc.dag.order.length,4);
 assert.equal(f.control.calls.length,4);
 const jobs=(await f.app.services.database.prepare("SELECT payload FROM production_jobs WHERE session_id=? AND kind IN ('dag','dag-draw')").bind(id).all()).results;
 const work=jobs.map(j=>JSON.parse(j.payload));
 const preparation=work.filter(j=>['verifySource','prepareArt','prepareSuggestions'].includes(j.work.call));
 const production=work.filter(j=>!preparation.includes(j));
 assert.ok(preparation.some(j=>j.work.call==='prepareSuggestions'));
 assert.ok(preparation.every(j=>j.setupGeneration===doc.intake.generation-1));
 assert.ok(production.length&&production.every(j=>j.setupGeneration===doc.intake.generation));
 assert.equal(doc.dag.modelSnapshot,undefined,'an injected provider has no snapshot service');
});

test('the review-only mode never starts a DAG drawing',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 f.app.stopGeneration();
 const {ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(f.app.services.database,f.generation,f.media,{stopBeforeImages:true});f.coordinators.push(coordinator);
 const id=await confirmedStory(f,4);
 coordinator.wake();
 await until(()=>f.control.reviews.length===1,20000);
 for(let i=0;i<30;i++){coordinator.wake();await turn();}
 assert.equal(f.control.calls.length,0);
 assert.ok((await f.app.services.database.prepare("SELECT id FROM production_jobs WHERE session_id=? AND kind='dag-draw' AND state='queued'").bind(id).first()),'drawings wait in the queue');
});

test('a repeated review issue gets a second repair rather than reusing the finished job',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 let reviews=0;
 const issue={page:3,category:'caption',problem:'配文没有交代庄周醒来',instruction:'补写醒来的动作',requiresReplan:false};
 f.control.beforeText=async name=>name==='review'&&reviews++<2?{issues:[issue]}:undefined;
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(count(f.control.dagCalls,'sceneRepair'),2,'the second identical issue is repaired again');
 assert.equal((await saved(f,id)).dag.repairs.used,2);
});

test('continue is idempotent for its own request and refuses a request ID used for another action',async t=>{
 const f=await productionFixture(t,'codex');
 const {id}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(snapshot.plan);plan.pages[0].caption='庄周在柳树下打盹，梦里化作蝴蝶。';
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});
 const paused=crypto.randomUUID();
 await f.json(`sessions/${child}/production-control`,'POST',{requestId:paused,action:'pause'});
 assert.equal((await f.request(`sessions/${child}/production-control`,'POST',{requestId:paused,action:'continue'})).status,409);
 const requestId=crypto.randomUUID();
 await f.json(`sessions/${child}/production-control`,'POST',{requestId,action:'continue'});
 const receipt=await f.app.services.database.prepare('SELECT fingerprint FROM reader_commands WHERE request_id=?').bind(requestId).first();
 assert.match(receipt.fingerprint,/^continue:/);
 assert.equal((await saved(f,child)).dag.continuation,undefined);
 await f.json(`sessions/${child}/production-control`,'POST',{requestId,action:'continue'});
});

test('an image lost while saving a revision blocks completion until the reader asks for a redraw',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id,dag:before}=await completedStory(f);
 const {rm}=await import('node:fs/promises');const path=await import('node:path');
 await rm(path.join(f.dataDirectory,'media','reader',id,'4.png'));
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(snapshot.plan);plan.pages[0].caption='庄周在柳树下打盹，梦里化作蝴蝶。';
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});
 await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 await until(()=>f.control.reviews.length===1,20000);
 for(let i=0;i<30;i++){f.app.services.production.wake();await turn();}
 const blocked=await f.read(child);
 assert.notEqual(blocked.state,'completed');
 assert.equal(f.control.calls.length,0,'nothing is redrawn without the reader');
 const fault=blocked.faults.find(x=>x.stage==='redraw');
 assert.ok(fault);
 await f.json(`sessions/${child}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(child)).state==='completed',20000);
 assert.deepEqual(f.control.calls.map(c=>c.page),[4]);
 assert.ok(before.order[4]);
});

// ——— 审查意见第 3 轮 ———

test('the CLI stops at reviewed only after the DAG review approves drawing, and reports blocked when the reader must act',async t=>{
 const {executeHeadless}=await import('../server/headless-cli.ts');
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const approved=await confirmedStory(f,4);
 const stuck=await confirmedStory(f,4,{});
 await f.stop();
 const run=id=>executeHeadless(process.cwd(),['run',id,'--until','reviewed','--timeout','20','--data-dir',f.dataDirectory],{generation:f.generation,variables:{}});
 const first=await run(approved);
 assert.equal(first.reason,'reviewed');
 assert.equal(f.control.calls.length,0);
 assert.equal(f.control.reviews.length,1);
 // 审片反复指出同一幅的问题，自动修订额度用尽后停在需读者处理。
 const issue={page:2,category:'caption',problem:'配文没有交代庄周醒来',instruction:'补写醒来的动作',requiresReplan:false};
 f.control.beforeText=async name=>name==='review'?{issues:[issue]}:undefined;
 const second=await run(stuck);
 assert.equal(second.reason,'blocked');
 assert.equal(f.control.calls.length,0);
});

test('an accepted continue replays even after the version is superseded',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const edit=async(storyId,caption)=>{const snapshot=await f.json(`sessions/${storyId}/revisions`);const plan=structuredClone(snapshot.plan);plan.pages[0].caption=caption;const child=crypto.randomUUID();await f.json(`sessions/${storyId}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});return child;};
 const child=await edit(id,'庄周在柳树下打盹，梦里化作蝴蝶。');
 const requestId=crypto.randomUUID();
 await f.json(`sessions/${child}/production-control`,'POST',{requestId,action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed',20000);
 await edit(child,'庄周醒来，摸着自己的手臂发怔。');
 const replay=await f.request(`sessions/${child}/production-control`,'POST',{requestId,action:'continue'});
 assert.equal(replay.status,200);
});

test('a live image check marks the loss with its fault; recovery redraws it and only the engine completes the story',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const {rm}=await import('node:fs/promises');const path=await import('node:path');
 const before=await f.read(id);
 const image=before.story.pages[2].image;
 assert.equal((await f.request(`sessions/${id}/image-health`,'POST',{page:1,image})).status,409);
 await rm(path.join(f.dataDirectory,'media','reader',id,'2.png'));
 await f.json(`sessions/${id}/image-health`,'POST',{page:2,image});
 let doc=await saved(f,id);
 assert.equal(doc.dag.products[`frameImage:${doc.dag.order[2]}`].readable,false);
 const checked=await f.read(id);
 assert.notEqual(checked.state,'completed');
 const fault=checked.faults.find(x=>x.stage==='redraw');
 assert.ok(fault);
 const observed=checked.lifecycle.faults.find(item=>item.id===fault.id);
 assert.equal(observed.kind,'image-loss');
 assert.equal(observed.scope,'required');
 assert.equal(observed.targets[0].page,2);
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.calls.length,0,'nothing is redrawn before the reader asks');
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.deepEqual(f.control.calls.map(c=>c.page),[2]);
 doc=await saved(f,id);
 assert.equal(doc.dag.products[`frameImage:${doc.dag.order[2]}`].readable,undefined);
});

test('an image check in flight cannot record a new fault after deletion',async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f);
 const before=await f.read(id),image=before.story.pages[2].image;
 const key=referenceImageKey(id,image),started=Promise.withResolvers(),resume=Promise.withResolvers();
 const media=f.app.services.media,read=media.get.bind(media);
 t.after(()=>resume.resolve());
 media.get=async path=>{
  if(path!==key)return read(path);
  started.resolve();
  await resume.promise;
  return null;
 };
 const checking=f.request(`sessions/${id}/image-health`,'POST',{page:2,image});
 try{
  await started.promise;
  const pending=(await f.read(id)).lifecycle;
  assert.deepEqual(pending.imageChecks,[{kind:'portrait',pages:[3],state:'pending'}]);
  assert.equal(pending.faults.length,0);
  await f.json(`library/${id}`,'DELETE');
 }finally{resume.resolve();}
 assert.equal((await checking).status,409);
 assert.equal((await f.app.services.database.prepare('SELECT count(*) AS count FROM reader_faults WHERE session_id=?').bind(id).first()).count,0);
 const {dag}=await saved(f,id);
 assert.equal(dag.products[`frameImage:${dag.order[2]}`].readable,undefined);
});


// ——— 决策 7：模型快照 ———

test('confirmation records the model snapshot and its jobs are built from it, not from the current settings',async t=>{
 const built=[];
 const f=await snapshotFixture(t,{current:()=>snapshotA,provider:snapshot=>{built.push(snapshot);return f.generation;}});
 const id=await confirmThroughIntake(f);
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const doc=await saved(f,id);
 assert.deepEqual(doc.dag.modelSnapshot,snapshotA);
 assert.ok(built.length>0&&built.every(snapshot=>snapshot.models.text==='model-at-confirmation'),'every job builds its provider from the recorded snapshot');
 assert.equal(f.control.calls.length,4);
});

test('an unavailable snapshot service stops the story with a clear message; applying the current settings lets it finish',async t=>{
 const current={provider:'codex',models:{text:'model-now',image:null}};
 let available=false,now=snapshotA;
 const f=await snapshotFixture(t,{current:()=>now,provider:snapshot=>available||snapshot.models.text==='model-now'?f.generation:null});
 const id=await confirmThroughIntake(f);
 await until(async()=>(await f.read(id)).lifecycle.service==='snapshot-unavailable',20000);
 const blocked=await f.read(id);
 assert.equal(blocked.faults,undefined);
 assert.match(shelfGenerationStatus(blocked).detail,/快照服务不可用/);
 assert.equal(blocked.snapshotUnavailable,true,'the view offers 应用当前模型设置');
 assert.equal(f.control.dagCalls.length,0,'no model call is paid while the snapshot service is unavailable');
 now=current;
 await f.json(`sessions/${id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'apply-model'});
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,current);
 assert.equal((await f.read(id)).lifecycle.service,'available');
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(f.control.calls.length,4);
});

// ——— 没有准备流程的故事：原文核对经 DAG ———

test('a story created without the preparation flow gets its source through the DAG and then runs to the end',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const id=await f.create(4);
 await until(async()=>(await f.read(id)).state==='completed',30000);
 const doc=await saved(f,id);
 assert.ok(doc.original?.text,'the verified source is saved by the verifySource work');
 assert.equal(doc.dag.order.length,4);
 assert.equal(f.control.calls.length,4);
});

// ——— 复制与阅读优先 ———

test('copying a DAG story keeps its text and review; only the images run in the destination, or the saved images attach by frame identity',async t=>{
 const {copySavedStory}=await import('../server/reader-copy.ts');
 const source=await productionFixture(t,'codex');
 const {id,dag:before}=await completedStory(source);
 await source.stop();
 // 默认只复制文字：副本保留分镜与审片结论，图片按画幅重新绘制，不再有任何文字或审片调用。
 const textOnly=await productionFixture(t,'codex');
 textOnly.control.hold=false;
 const copyId=crypto.randomUUID();
 await copySavedStory(textOnly.app,process.cwd(),textOnly.dataDirectory,source.dataDirectory,id,copyId,undefined,{});
 let doc=await saved(textOnly,copyId);
 assert.deepEqual(doc.dag.order,before.order,'frame identities are preserved');
 assert.ok(doc.dag.order.every(key=>!doc.dag.frames[key].image&&!doc.dag.products[`frameImage:${key}`]),'no image record without images');
 assert.ok(doc.dag.products[`frameVerdict:${doc.dag.order[0]}`],'the review verdicts are kept');
 await textOnly.json(`sessions/${copyId}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await textOnly.read(copyId)).state==='completed',20000);
 assert.equal(textOnly.control.calls.length,6,'every frame is drawn in the destination');
 assert.equal(textOnly.control.reviews.length+textCalls(textOnly.control),0,'no text or review calls');

 // 显式复制图片：已保存的图片按画幅身份附加，目标不再绘图。
 const withImages=await productionFixture(t,'codex');
 withImages.control.hold=false;
 const imageCopy=crypto.randomUUID();
 const copied=await copySavedStory(withImages.app,process.cwd(),withImages.dataDirectory,source.dataDirectory,id,imageCopy,undefined,{images:true});
 assert.equal(copied.lifecycle.control,'paused');
 doc=await saved(withImages,imageCopy);
 assert.equal(doc.copiedFrom.images,'complete');
 assert.ok(doc.dag.order.every(key=>doc.dag.frames[key].image&&doc.dag.products[`frameImage:${key}`]));
 assert.equal(doc.images.filter(Boolean).length,6);
 await withImages.json(`sessions/${imageCopy}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await withImages.read(imageCopy)).state==='completed',20000);
 assert.equal(withImages.control.calls.length,0,'copied images are not drawn again');
});

test('a paused image copy cannot publish attachments after it is superseded',async t=>{
 const {copySavedStory}=await import('../server/reader-copy.ts');
 const source=await productionFixture(t,'codex'),{id}=await completedStory(source);
 await source.stop();
 const target=await productionFixture(t,'codex'),requestId=crypto.randomUUID();
 const media=target.app.services.media,put=media.put.bind(media);
 const writing=Promise.withResolvers(),release=Promise.withResolvers();
 media.put=async(key,bytes,options)=>{
  if(key.startsWith(`reader/${requestId}/`)){writing.resolve();await release.promise;}
  return put(key,bytes,options);
 };
 const copying=assert.rejects(copySavedStory(target.app,process.cwd(),target.dataDirectory,source.dataDirectory,id,requestId,undefined,{images:true}),error=>error.status===409);
 const route=`sessions/${requestId}`,nextId=crypto.randomUUID();
 try{
  await writing.promise;
  const {token}=await target.json(`${route}/revisions`);
  await target.json(`${route}/revisions`,'POST',{requestId:nextId,token,changes:{artStyle:'watercolor'}});
 }finally{release.resolve();}
 await copying;
 assert.ok(!(await saved(target,requestId)).images.some(Boolean));
 assert.equal((await target.json(`${route}/current`)).id,nextId);
});

for(const duplicate of [true,false])test(`a revision media copy rechecks ${duplicate?'matching replay':'a conflicting request number'} before publication`,async t=>{
 const f=await productionFixture(t,'codex'),{id}=await completedStory(f),requestId=crypto.randomUUID();
 const route=`sessions/${id}`,{token}=await f.json(`${route}/revisions`);
 const command={requestId,token,changes:{artStyle:'watercolor'}},media=f.app.services.media;
 const read=media.get.bind(media),reached=Promise.withResolvers(),resume=Promise.withResolvers();
 let held=false;
 media.get=async key=>{
  if(!held&&key.startsWith(`reader/${id}/`)){held=true;reached.resolve();await resume.promise;}
  return read(key);
 };
 const pending=f.request(`${route}/revisions`,'POST',command);
 try{
  await reached.promise;
  if(duplicate)assert.equal((await f.request(`${route}/revisions`,'POST',command)).status,201);
  else{
   const other=await confirmedStory(f,4);
   await f.json(`sessions/${other}/production-control`,'POST',{requestId,action:'pause'});
  }
 }finally{resume.resolve();}
 assert.equal((await pending).status,duplicate?201:409);
 const current=await f.json(`${route}/current`);
 assert.equal(current.id,duplicate?requestId:id);
});

test('viewed pages and the first image go ahead of unread drawings; leaving restores page order',async()=>{
 const {viewedPriority}=await import('../server/dag-production.ts');
 const viewing=[{page:3,through:9}];
 assert.ok(viewedPriority(3,viewing)<viewedPriority(0,[]),'the current page goes ahead of any unread story');
 assert.ok(viewedPriority(9,viewing)<viewedPriority(0,[]),'read-ahead pages go ahead too');
 assert.ok(viewedPriority(0,viewing)<viewedPriority(1,[]),'the first image is the reference for every page');
 assert.equal(viewedPriority(10,viewing),10,'pages beyond the read-ahead keep page order');
 assert.equal(viewedPriority(5,[]),5,'without a reader every page keeps page order');
});

test('the copy command requires passed review unless the reader explicitly copies a draft',async t=>{
 const {copySavedStory}=await import('../server/reader-copy.ts');
 const source=await productionFixture(t,'codex');
 source.control.beforeText=name=>{if(name==='review')throw Error('controlled failure before the review receipt');};
 const id=await confirmedStory(source,4);
 source.app.services.production.wake();
 await until(async()=>(await source.read(id)).faults?.some(fault=>fault.retryReview));
 await source.stop();
 const target=await productionFixture(t,'codex'),copy=options=>copySavedStory(target.app,process.cwd(),target.dataDirectory,source.dataDirectory,id,crypto.randomUUID(),undefined,options);
 await assert.rejects(copy({}),error=>error.status===409);
 await assert.rejects(copy({draft:true,images:true}),error=>error.status===400);
 const draft=await copy({draft:true});
 assert.equal(draft.lifecycle.control,'paused');
 assert.equal(draft.lifecycle.review,'pending');
 assert.equal(draft.story.pages.length,4);
 assert.equal(draft.ready,0);
 assert.equal(target.control.calls.length,0);
});

// ——— 审查：修订不得绕过明确恢复 ———

test('a revision keeps an unresolved drawing fault whose inputs did not change; a general continue does not redraw that frame',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id,dag}=await completedStory(f);
 const key=dag.order[1],doc0=await saved(f,id);
 // 第 2 幅绘图失败：没有成图记录，故障待读者恢复。
 delete doc0.dag.frames[key].image;delete doc0.dag.products[`frameImage:${key}`];doc0.images[1]='';
 await f.app.services.database.prepare("UPDATE stories SET document=?,state='idle' WHERE id=?").bind(JSON.stringify(doc0),id).run();
 const now=Date.now();
 await f.app.services.database.prepare("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,message,created_at,updated_at) VALUES('drawfault',?,?,'job','frameImage',?,'dag','绘图失败',?,?)").bind(id,owner,key,now,now).run();
 const snapshot=await f.json(`sessions/${id}/revisions`),childId=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:childId,token:snapshot.token,changes:{storySummary:'一段与绘图无关的新梗概，只改变梗概文字。'}});
 const faults=(await f.app.services.database.prepare("SELECT node,node_key,state FROM reader_faults WHERE session_id=?").bind(childId).all()).results;
 assert.deepEqual(faults.map(x=>[x.node,x.node_key,x.state]),[['frameImage',key,'pending']],'the unchanged fault is carried to the new version');
 await f.json(`sessions/${childId}/production-control`,'POST',{action:'continue'}).catch(()=>{});
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.calls.length,0,'nothing is drawn without an explicit recovery');
});

for(const changed of [false,true])test(`replanning ${changed?'releases':'matches'} a lost-image fault by drawing inputs before dispatching a new frame`,async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const id=await f.create(3),route=`sessions/${id}`;
 await until(async()=>(await f.read(id)).state==='completed');
 const prior=await saved(f,id),image=prior.images[1],oldKey=prior.dag.order[1];
 const {rm}=await import('node:fs/promises'),{join}=await import('node:path');
 await rm(join(f.dataDirectory,'media',referenceImageKey(id,image)));
 const lost=await f.json(`${route}/image-health`,'POST',{page:1,image});
 assert.equal(lost.faults.find(fault=>fault.stage==='redraw').page,1);
 f.control.beforeText=(name,payload)=>{
  if(changed&&name==='visual')return {frames:payload.frames.map(frame=>({number:frame.number,
   prompt:prior.dag.frames[prior.dag.order[frame.number-1]].visual+(frame.number===2?' 第二幅改为雨夜，室内点灯。':''),drawn:['庄周']}))};
  if(name!=='outline')return;
  const {title,summary,sourceReference,adaptationNote}=makePlan(3);
  return {title,summary,sourceReference,adaptationNote,beats:['新版开场提纲','新版转折提纲','新版结局提纲']};
 };
 const {token}=await f.json(`${route}/revisions`),before=f.control.calls.length;
 const child=await f.json(`${route}/revisions`,'POST',{requestId:crypto.randomUUID(),token,changes:{productionPrompt:'在不改变情节的前提下重新编排。'}});
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'continue'});
 let current,next;
 await until(async()=>{
  next=await saved(f,child.id);
  if(next.dag.order[1]===oldKey)return false;
  current=await f.read(child.id);
  return current.generationProgress.reviewStatus==='passed'&&['failed','completed'].includes(current.state);
 },15000);
 for(let attempt=0;attempt<20;attempt++){
  await f.app.services.production.tick();
  await turn();
 }
 current=await f.read(child.id);
 const newKey=next.dag.order[1];
 assert.notEqual(newKey,oldKey);
 const evaluation=evaluate(stateOf({id:child.id,doc:next,dag:next.dag,selection:current.selection,confirmed:true,faults:[]}));
 const inputs=evaluation.instance('frameImage',newKey).hard,priorInputs=prior.dag.products[`frameImage:${oldKey}`].inputs;
 const result={state:current.state,lostFrames:current.faults?.filter(fault=>fault.stage==='redraw').map(fault=>fault.page)??[],drawn:f.control.calls.slice(before).map(call=>call.page)};
 if(changed){
  assert.notDeepEqual(inputs,priorInputs);
  assert.deepEqual(result,{state:'completed',lostFrames:[],drawn:[1]});
 }else{
  assert.deepEqual(inputs,priorInputs);
  assert.deepEqual(result,{state:'failed',lostFrames:[1],drawn:[]});
 }
});

test('one lost drawing binds two new frames, and recovering one supplies the other for free after restart',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const id=await f.create(3),route=`sessions/${id}`;
 await until(async()=>(await f.read(id)).state==='completed');
 const prior=await saved(f,id),oldKey=prior.dag.order[1],image=prior.images[1];
 const {rm}=await import('node:fs/promises'),{join}=await import('node:path');
 await rm(join(f.dataDirectory,'media',referenceImageKey(id,image)));
 await f.json(`${route}/image-health`,'POST',{page:1,image});
 f.control.beforeText=(name,payload)=>{
  if(name==='visual')return {frames:payload.frames.map(frame=>({number:frame.number,
   prompt:prior.dag.frames[prior.dag.order[frame.number===3?1:frame.number-1]].visual,drawn:['庄周']}))};
 };
 const {token}=await f.json(`${route}/revisions`),before=f.control.calls.length;
 const child=await f.json(`${route}/revisions`,'POST',{requestId:crypto.randomUUID(),token,changes:{productionPrompt:'采用新的主线编排方式。'}});
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'continue'});
 let blocked;
 await until(async()=>{blocked=await f.read(child.id);return blocked.faults?.filter(fault=>fault.stage==='redraw').length===2;});
 const faults=blocked.faults.filter(fault=>fault.stage==='redraw').sort((a,b)=>a.page-b.page);
 assert.deepEqual(faults.map(fault=>fault.page),[1,2]);
 assert.equal(f.control.calls.length,before);
 f.control.hold=true;
 await f.json(`sessions/${child.id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:faults[0].id});
 await until(()=>f.control.calls.length===before+1);
 assert.equal(f.control.calls.at(-1).page,1);
 assert.ok((await f.read(child.id)).faults.some(fault=>fault.id===faults[1].id));
 f.control.calls.at(-1).resolve();
 await until(async()=>(await f.read(child.id)).state==='completed');
 await f.restart();
 f.app.services.production.wake();
 await until(async()=>(await f.read(child.id)).state==='completed');
 const rows=(await f.app.services.database.prepare("SELECT node_key,input_hash,origin_fault_id,state FROM reader_faults WHERE session_id=? ORDER BY node_key").bind(child.id).all()).results;
 assert.equal(rows.length,3);
 assert.ok(rows.every(row=>row.state==='resolved'));
 assert.equal(rows[1].origin_fault_id,rows[2].origin_fault_id);
 assert.equal(rows[1].input_hash,rows[2].input_hash);
 assert.equal(f.control.calls.length,before+1);
});

test('a paid drawing is kept on its job before it is saved: a failed save and its retry do not pay twice',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 // 第一次保存绘图结果时让故事文档写入失败，之后恢复。
 let failing=true;
 const database=f.app.services.database,original=database.prepare.bind(database);
 database.prepare=query=>{
  const statement=original(query);
  if(failing&&/UPDATE stories SET document=\?,state=CASE/.test(query)&&f.control.calls.length>0){
   return {...statement,bind:(...values)=>{const bound=statement.bind(...values);return {...bound,run:async()=>{failing=false;throw Object.assign(Error('SQLITE_BUSY'),{code:'SQLITE_BUSY'});}};}};
  }
  return statement;
 };
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.length>0,20000);
 assert.equal(failing,false,'the injected save failure happened');
 const fault=(await f.read(id)).faults[0];
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed',30000);
 const paid=f.control.calls.filter(c=>c.page===0).length;
 assert.equal(paid,1,'the first frame is drawn once even though its first save failed');
});


test('a story without a snapshot (for example upgraded) gets the current settings recorded before its jobs run',async t=>{
 const f=await snapshotFixture(t,{current:()=>snapshotA,provider:()=>f.generation});
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,snapshotA);
});

test('apply-model replays by its request id and never rewrites the snapshot from later settings; override is bound to its fault id',async t=>{
 let now=snapshotA;
 const f=await snapshotFixture(t,{current:()=>now,provider:()=>f.generation});
 const id=await confirmedStory(f,4);
 await f.app.services.database.prepare("UPDATE stories SET generation_control='paused' WHERE id=?").bind(id).run();
 f.app.services.production.wake();
 const requestId=crypto.randomUUID(),second={provider:'codex',models:{text:'model-second',image:null}};
 assert.ok((await f.read(id)).lifecycle.actions.some(action=>action.event==='apply-model'));
 await f.json(`sessions/${id}/production-control`,'POST',{requestId,action:'apply-model'});
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,snapshotA);
 now=second;
 await f.json(`sessions/${id}/production-control`,'POST',{requestId,action:'apply-model'});
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,snapshotA,'a replay does not write the newer settings');
 await f.json(`sessions/${id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'apply-model'});
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,second,'a new request applies the current settings');
 const other=await f.request(`sessions/${id}/production-control`,'POST',{requestId,action:'pause'});
 assert.equal(other.status,409,'the request id cannot be reused for another action');
});

test('a review override only approves the problem the reader saw: a stale or wrong fault id is refused',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const issue={page:2,category:'caption',problem:'配文没有交代庄周醒来',instruction:'补写醒来的动作',requiresReplan:false};
 f.control.beforeText=async name=>name==='review'?{issues:[issue]}:undefined;
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.some(x=>x.stage==='review'),30000);
 const fault=(await f.read(id)).faults.find(x=>x.stage==='review');
 assert.match(fault.id,/^review:/);
 const wrong=await f.request(`sessions/${id}/review-override`,'POST',{requestId:crypto.randomUUID(),faultId:'review:'+'0'.repeat(32)});
 assert.equal(wrong.status,409);
 assert.equal((await f.json(`sessions/${id}/review-override`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id})).id,id);
});

test('an exhausted DAG review exposes its issues and can grant another repair attempt',async t=>{
 const f=await productionFixture(t,'codex');
 const issue={page:2,category:'caption',problem:'配文没有交代庄周醒来',instruction:'补写醒来的动作',requiresReplan:false};
 f.control.beforeText=async name=>name==='review'?{issues:[issue]}:undefined;
 const id=await confirmedStory(f,4),route=`sessions/${id}`;
 f.app.services.production.wake();
 let blocked;
 await until(async()=>{blocked=await f.read(id);return blocked.faults?.some(fault=>fault.stage==='review');},30000);
 const fault=blocked.faults.find(fault=>fault.stage==='review');
 const repairOffer={event:'continue-repair',faultId:fault.id};
 assert.ok(blocked.lifecycle.actions.some(action=>JSON.stringify(action)===JSON.stringify(repairOffer)));
 assert.deepEqual((await f.json('library/shelf')).find(card=>card.id===id).lifecycle.actions,blocked.lifecycle.actions);
 assert.equal(blocked.generationProgress.reviewStopReason,'limit');
 assert.equal(f.control.calls.length,0);
 const held=await f.json(`${route}/production-control`,'POST',{action:'pause'});
 assert.ok(!held.lifecycle.actions.some(action=>action.event==='continue-repair'));
 const rejected=await f.request(`${route}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 assert.equal(rejected.status,409);
 const paused=await f.json(`${route}/revisions`);
 await f.json(`${route}/production-control`,'POST',{action:'resume'});
 const command={requestId:crypto.randomUUID(),faultId:fault.id};
 const retry=await f.request(`${route}/recover`,'POST',command);
 const grant=(await saved(f,id)).dag.repairs;
 assert.equal((await f.request(`${route}/recover`,'POST',command)).status,202);
 assert.equal((await saved(f,id)).dag.repairs.limit,grant.limit);
 assert.equal((await f.request(`${route}/recover`,'POST',{...command,requestId:crypto.randomUUID()})).status,409);
 assert.deepEqual({claimsCompletion:blocked.generationProgress.phase==='completed',issues:blocked.reviewIssues?.map(item=>item.page)??[],retryable:fault.retryAllowed,canEditNotes:paused.canEditReviewNotes??false,status:retry.status},
  {claimsCompletion:false,issues:[2],retryable:true,canEditNotes:true,status:202});
});

for(const action of ['pause','stop','continue'])test(`a complete draft under ${action} can skip failed review without starting drawing`,async t=>{
 const f=await productionFixture(t,'codex');
 f.control.beforeText=name=>{if(name==='review')throw Error('controlled review failure before any verdict');};
 const id=await confirmedStory(f,4),route=`sessions/${id}`;
 f.app.services.production.wake();
 let failed;
 await until(async()=>{failed=await f.read(id);return failed.state==='failed';});
 assert.equal(failed.generationProgress.phase,'review');
 assert.equal(failed.generationProgress.reviewStatus,'pending');
 assert.equal(failed.story.pages.length,4);
 assert.ok(failed.story.original);
 assert.ok((await saved(f,id)).plan.reflection,'the complete draft has an ending available');
 assert.equal(f.control.calls.length,0);
 if(action==='continue'){
  await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.dag.continuation',json(?)) WHERE id=?")
   .bind(JSON.stringify({revision:1,reason:'revision-saved'}),id).run();
 }else await f.json(`${route}/production-control`,'POST',{action});
 const paused=await f.read(id),fault=paused.faults.find(fault=>fault.state==='pending');
 const override=`${route}/review-override`,command={requestId:crypto.randomUUID(),faultId:fault.id,ending:'default'};
 assert.equal((await f.request(override,'POST',{...command,faultId:crypto.randomUUID()})).status,409);
 const result=await f.request(override,'POST',command),after=await f.read(id);
 assert.deepEqual({faultStage:fault.stage,status:result.status,control:after.lifecycle.control,continuation:after.lifecycle.continuation,overridden:after.generationProgress.reviewOverridden,drawings:f.control.calls.length},
  {faultStage:'review',status:200,control:action==='pause'?'paused':action==='stop'?'stopped':'active',continuation:action==='continue',overridden:true,drawings:0});
 assert.equal((await f.request(override,'POST',command)).status,200);
 await f.app.services.production.tick();
 assert.equal(f.control.calls.length,0);
 f.control.hold=false;
 await f.json(`${route}/production-control`,'POST',{action:action==='continue'?'continue':'resume'});
 await until(async()=>(await f.read(id)).state==='completed');
 assert.deepEqual(f.control.calls.map(call=>call.page).sort(),[0,1,2,3]);
});

test('a current failed review can be retried while active using its saved fault identity',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 let failing=true;
 f.control.beforeText=name=>{if(name==='review'&&failing){failing=false;throw Error('controlled first review failure');}};
 const id=await confirmedStory(f,4),route=`sessions/${id}`;
 let fault;
 await until(async()=>{fault=(await f.read(id)).faults?.find(fault=>fault.retryReview);return !!fault;});
 assert.equal((await f.request(`${route}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:crypto.randomUUID()})).status,409);
 assert.equal(f.control.calls.length,0);
 await f.json(`${route}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed');
 assert.equal(f.control.reviews.length,2);
 assert.equal(f.control.calls.length,4);
});

test('saving notes against exhausted repair gives a new saved revision and waits for explicit continue',async t=>{
 const f=await productionFixture(t,'codex');
 const issue={page:2,category:'caption',problem:'配文没有交代庄周醒来',instruction:'补写醒来的动作',requiresReplan:false};
 f.control.beforeText=name=>name==='review'?{issues:[issue]}:undefined;
 const id=await confirmedStory(f,4),route=`sessions/${id}`;
 await until(async()=>(await f.read(id)).lifecycle.reviewAttention.some(reason=>reason.reason==='limit'));
 const snapshot=await f.json(`${route}/revisions`),requestId=crypto.randomUUID(),reviewNotes='第 2 幅要明确写出醒来的动作。';
 assert.equal(snapshot.canEditReviewNotes,true);
 const result=await f.json(`${route}/revisions`,'POST',{requestId,token:snapshot.token,changes:{reviewNotes}});
 assert.equal(result.id,requestId);assert.equal(result.lifecycle.continuation,true);
 assert.equal((await saved(f,requestId)).reviewNotes,reviewNotes);
 assert.equal(f.control.calls.length,0);
});

for(const change of ['registration','ending','visual'])test(`review skip is invalidated before any drawing when ${change} changes`,async t=>{
 const f=await productionFixture(t,'codex');
 f.control.beforeText=name=>{if(name==='review')throw Error('controlled review failure');};
 const id=await confirmedStory(f,4),route=`sessions/${id}`,db=f.app.services.database;
 await db.prepare("UPDATE stories SET selection=json_set(selection,'$.acceptancePrompt',?) WHERE id=?").bind('验收时核对人物行动。',id).run();
 f.app.services.production.wake();
 let view;
 await until(async()=>{view=await f.read(id);return view.faults?.some(fault=>fault.retryReview);});
 const command={requestId:crypto.randomUUID(),faultId:view.faults.find(fault=>fault.retryReview).id,ending:'default'};
 assert.equal((await f.request(`${route}/review-override`,'POST',command)).status,409);
 await f.json(`${route}/production-control`,'POST',{action:'pause'});
 const offer=(await f.read(id)).reviewSkip;
 assert.equal(offer.faultId,command.faultId);
 const skipped=await f.json(`${route}/review-override`,'POST',command);
 assert.equal(skipped.generationProgress.reviewOverridden,true);
 assert.equal((await f.json(`${route}/review-history`)).entries.find(item=>item.title==='跳过本次审核').outcome,'unknown');
 const doc=await saved(f,id);
 if(change==='registration'){
  const item=doc.dag.items[0],product=doc.dag.products[`itemRegistration:${item.id}`];
  item.scope='frame';product.scope='frame';
 }else if(change==='ending')doc.dag.ending.confirmed.ending='修改后的结语使审核绑定失效。';
 else{
  const frame=doc.dag.order[1];
  doc.dag.frames[frame].visual+=' 改为暮色。';
  doc.dag.products[`visual:${frame}`].hash=fingerprint(doc.dag.frames[frame].visual);
 }
 await db.prepare('UPDATE stories SET document=? WHERE id=?').bind(JSON.stringify(doc),id).run();
 assert.equal((await f.read(id)).generationProgress.reviewOverridden,false);
 await f.json(`${route}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(id)).faults?.some(fault=>fault.retryReview&&fault.id!==command.faultId));
 assert.equal(f.control.calls.length,0);
});

test('a failed task before the draft is complete cannot be manually released for drawing',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.beforeText=name=>{if(name==='visual')throw Error('controlled failure before complete storyboard');};
 const id=await confirmedStory(f,4),route=`sessions/${id}`;
 f.app.services.production.wake();
 let failed;
 await until(async()=>{failed=await f.read(id);return failed.state==='failed';});
 const fault=failed.faults[0];
 assert.equal(failed.story,null);
 await f.json(`${route}/production-control`,'POST',{action:'pause'});
 assert.equal((await f.request(`${route}/review-override`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id})).status,409);
 assert.equal(f.control.calls.length,0);
});

test('a file restored before the reader clicks recover is reused for free, without a redraw',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const {rm,writeFile,readFile}=await import('node:fs/promises');const path=await import('node:path');
 const file=path.join(f.dataDirectory,'media','reader',id,'2.png');
 const bytes=await readFile(file);
 const image=(await f.read(id)).story.pages[2].image;
 await rm(file);
 await f.json(`sessions/${id}/image-health`,'POST',{page:2,image});
 const fault=(await f.read(id)).faults.find(x=>x.stage==='redraw');
 assert.ok(fault);
 // 点击恢复之前，文件已被放回原处。
 await writeFile(file,bytes);
 const command={requestId:crypto.randomUUID(),faultId:fault.id};
 const media=f.app.services.media,read=media.get.bind(media);
 const key=referenceImageKey(id,image);
 media.get=async path=>{
  if(path===key)throw Error('controlled transient read error');
  return read(path);
 };
 try{
  assert.equal((await f.request(`sessions/${id}/recover`,'POST',command)).status,503);
  assert.equal((await f.read(id)).faults.find(item=>item.id===fault.id).state,'pending');
 }finally{media.get=read;}
 const providerStatus=f.generation.status;
 f.generation.status=async()=>({configured:false,message:'controlled provider outage'});
 const response=await f.json(`sessions/${id}/recover`,'POST',command).finally(()=>{f.generation.status=providerStatus;});
 assert.equal(response.recoveryReceipt.status,'succeeded');
 assert.deepEqual((await f.json(`sessions/${id}/recover`,'POST',command)).recoveryReceipt,response.recoveryReceipt);
 assert.equal((await f.request(`sessions/${id}/recover`,'POST',{...command,requestId:crypto.randomUUID()})).status,409);
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(f.control.calls.length,0,'the restored file is reused, nothing is drawn or paid');
 assert.ok(!(await f.read(id)).faults?.length);
});

test('unconfigured service only offers an image recovery when the current file can be probed',async t=>{
 const f=await productionFixture(t,'codex');
 f.options.production={autoStart:false,snapshots:{current:()=>undefined,provider:()=>null}};
 await f.restart();
 f.generation.status=async()=>({configured:false,message:'controlled provider outage'});
 const {id}=await completedStory(f),doc=await saved(f,id);
 const first=doc.dag.order[1],second=doc.dag.order[2],a=crypto.randomUUID(),b=crypto.randomUUID();
 delete doc.dag.frames[first].image;
 doc.dag.products[`frameImage:${first}`].readable=false;
 doc.dag.products[`frameImage:${second}`].readable=false;
 doc.images[1]='';
 const db=f.app.services.database,now=Date.now();
 await db.prepare("UPDATE stories SET document=?,state='idle' WHERE id=?").bind(JSON.stringify(doc),id).run();
 for(const [fault,key] of [[a,first],[b,second]])await db.prepare("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,message,created_at,updated_at) VALUES(?,?,?,'image-loss','frameImage',?,'dag','图片丢失',?,?)").bind(fault,id,owner,key,now,now).run();
 const lifecycle=(await f.read(id)).lifecycle;
 assert.equal(lifecycle.service,'unconfigured');
 assert.deepEqual(lifecycle.actions.filter(action=>action.event==='retry'),[{event:'retry',faultId:b}]);
 assert.equal((await f.request(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:a})).status,503);
 assert.equal((await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:b})).recoveryReceipt.status,'succeeded');
 f.app.stopGeneration();
 const stopping=(await f.read(id)).lifecycle;
 assert.equal(stopping.service,'unconfigured');
 assert.deepEqual(stopping.actions.filter(action=>['retry','resume','apply-model','continue','reprepare'].includes(action.event)),[]);
 assert.ok(stopping.actions.some(action=>action.event==='edit-revision'));
 assert.ok(stopping.actions.some(action=>action.event==='delete'));
});

test('CLI: a saved revision waits for stories continue; run reports continue_required and never continues on its own',async t=>{
 const {executeHeadless}=await import('../server/headless-cli.ts');
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 await f.stop();
 const call=(args,input)=>executeHeadless(process.cwd(),[...args,'--data-dir',f.dataDirectory],{generation:f.generation,variables:{},input:input||{}});
 const revisions=await call(['stories','revisions',id]),plan=structuredClone(revisions.plan);
 plan.pages[2].caption='管仲与鲍叔牙分金时，鲍叔让管仲多拿一份。';
 const edited=await call(['stories','edit',id,'--request-id',crypto.randomUUID()],{token:revisions.token,changes:{plan}});
 const child=edited.session.id;
 assert.equal(edited.session.awaitingContinue,true);
 const blocked=await call(['run',child,'--until','reviewed','--timeout','20']);
 assert.equal(blocked.reason,'continue_required');
 const help=await call(['help','--json']);
 assert.ok(help.runResults.includes(blocked.reason));
 assert.ok(!help.runResults.includes('frame_count_required'));
 assert.equal(f.control.reviews.length,0,'run did not start any work');
 await call(['stories','resume',child,'--request-id',crypto.randomUUID()]);
 assert.equal((await call(['run',child,'--until','reviewed','--timeout','20'])).reason,'continue_required','resume does not clear the wait');
 const continued=await call(['stories','continue',child,'--request-id',crypto.randomUUID()]);
 assert.equal(continued.session.awaitingContinue,undefined);
 assert.equal((await call(['run',child,'--until','completed','--timeout','30'])).reason,'completed');
});

test('the revision preview uses the same engine rules as saving and writes nothing',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const before=(await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM stories').first()).n;
 // 只改一幅配文：该幅画面描述与相邻审片需重做，图片不变（配文不是绘图输入）。
 const plan=structuredClone(snapshot.plan);plan.pages[2].caption='管仲与鲍叔牙分金时，鲍叔让管仲多拿一份。';
 const caption=await f.json(`sessions/${id}/revisions/preview`,'POST',{token:snapshot.token,changes:{plan}});
 assert.equal(caption.changed,true);assert.equal(caption.total,6);assert.equal(caption.redraw,0);assert.equal(caption.reused,6);
 assert.equal(caption.continues,true,'the review has to run again');
 // 换画风：全部画幅需重绘。
 const style=await f.json(`sessions/${id}/revisions/preview`,'POST',{token:snapshot.token,changes:{artStyle:'watercolor'}});
 assert.equal(style.redraw,6);assert.equal(style.reused,0);
 assert.ok(style.textWork.restyle>=1,'the descriptions are converted first');
 // 预览不创建新版，也不改动原版。
 assert.equal((await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM stories').first()).n,before);
 assert.equal((await f.request(`sessions/${id}/revisions/preview`,'POST',{token:'0'.repeat(64),changes:{}})).status,409);
 // 与保存一致：保存同一修改，新版需要「继续制作」且图片全部保留。
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});
 assert.equal((await f.read(child)).awaitingContinue,true);
});

test('a revision drops a fault whose inputs changed and keeps one whose inputs did not',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 // 提纲失败：读者改了制作要求后，旧故障不再适用，新提纲在「继续制作」后运行。
 let failing=true;
 f.control.beforeText=async name=>{if(name==='outline'&&failing){failing=false;throw Error('controlled outline failure');}};
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.length>0,20000);
 await f.json(`sessions/${id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'pause'});
 const snapshot=await f.json(`sessions/${id}/revisions`),child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{productionPrompt:'写清选择与代价，突出人物的转变'}});
 const carried=(await f.app.services.database.prepare("SELECT node FROM reader_faults WHERE session_id=? AND state='pending'").bind(child).all()).results;
 assert.deepEqual(carried,[],'the outline fault is not carried: its inputs changed');
 await f.json(`sessions/${child}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed',30000);
 assert.equal(count(f.control.dagCalls,'outline'),2,'the failed outline plus the new one');
});

// ——— v0.14.0 对等：换画风并指定首幅原图 ———

test('a style revision saves the supplied first frame byte for byte and draws only the remaining pages (v0.14.0 parity)',async t=>{
 const {jpeg}=await import('./fixtures/images.mjs');
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 await f.json(`library/${id}/reference`,'POST',{page:0,starred:true}).catch(()=>{});
 const snapshot=await f.json(`sessions/${id}/revisions`),image=new Blob([Uint8Array.from(jpeg)],{type:'image/jpeg'});
 const requestId=crypto.randomUUID(),revision={requestId,token:snapshot.token,changes:{artStyle:'watercolor'}};
 const send=(cover,submitted=revision)=>{
  const form=new FormData();form.set('revision',JSON.stringify(submitted));form.set('cover',cover,'first.jpg');
  return f.app.handle(new Request(`http://shiqu.local/api/reader/sessions/${id}/revisions`,{method:'POST',body:form}));
 };
 assert.equal((await send(image,{...revision,requestId:crypto.randomUUID(),changes:{productionPrompt:'重新安排制作重点'}})).status,409);
 assert.equal((await send(new Blob(['broken']))).status,400,'an unreadable file is refused');
 const response=await send(image);assert.equal(response.status,201);
 const child=await response.json();
 // 与 v0.14.0 的差别：旧画风的其余画幅在重绘前仍可见（不再清空），所以这里不断言 ready===1。
 assert.ok(child.story.pages[0].image,'the supplied first frame is shown at once');
 assert.deepEqual(await (await f.request(child.story.pages[0].image.replace('/api/reader/',''))).arrayBuffer(),await image.arrayBuffer(),'the bytes are kept as supplied');
 assert.equal((await send(image)).status,201,'a replay reuses the same version');
 assert.equal((await send(new Blob(['different']))).status,409,'the request id cannot carry another image');
 const next=crypto.randomUUID(),route=`sessions/${child.id}/revisions`;
 await f.json(route,'POST',{requestId:next,token:(await f.json(route)).token,changes:{acceptancePrompt:'核对角色动作。'}});
 const first=(await saved(f,next)).images[0];
 assert.ok(referenceImageKey(next,first));
 // 旧稿可能还带有上一版的首幅地址。继续制作和导出都应使用本版的画幅。
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.dag.cover.image',?) WHERE id=?").bind(child.story.pages[0].image,next).run();
 const before=f.control.calls.length;
 await f.json(`sessions/${next}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'continue'});
 await until(async()=>(await f.read(next)).state==='completed',30000);
 const calls=f.control.calls.slice(before);
 assert.deepEqual(calls.map(call=>call.page).sort((a,b)=>a-b),[1,2,3,4,5]);
 const reference=Buffer.from(await image.arrayBuffer()).toString('base64');
 assert.ok(calls.every(call=>call.reference===reference));
 assert.equal((await saved(f,next)).dag.cover,undefined);
 await f.json(`library/${child.id}`,'DELETE');
 const output=await f.json(`sessions/${id}/export`);
 assert.equal(output.story.id,next);
 assert.equal(output.story.pages[0].image,first);
 assert.deepEqual(await (await f.request(first.replace('/api/reader/',''))).arrayBuffer(),await image.arrayBuffer());
});

test('preview and save share one calculation: review notes count, hand edits are protected, and neither starts a model call',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 // 先手改一幅配文并继续到完成，使其成为受保护的手改。
 const edit=await revise(f,id,snapshot=>{const plan=structuredClone(snapshot.plan);plan.pages[1].caption='鲍叔牙在集市上替管仲付了账。';return {plan};});
 const base=await f.json(`sessions/${edit.child}/revisions`);
 const text=()=>f.control.reviews.length+f.control.calls.length+f.control.dagCalls.length;
 const calls=text();
 // 审核意见的变化会重新审片：预估必须计入。
 const notes=await f.json(`sessions/${edit.child}/revisions/preview`,'POST',{token:base.token,changes:{reviewNotes:'请复核第 2 幅的人物关系'}});
 assert.equal(notes.continues,true);assert.ok(notes.textWork.review>=1||Object.keys(notes.textWork).length>0,'the review notes make the review run again');
 // 制作要求改变会重新编排并丢弃该手改：预估列为冲突，保存被拒绝且不留下新版。
 const prompt=await f.json(`sessions/${edit.child}/revisions/preview`,'POST',{token:base.token,changes:{productionPrompt:'写清选择与代价，突出转变'}});
 assert.ok(prompt.conflicts.length>0,'the hand edit conflicts with a re-plan');
 const stories=(await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM stories').first()).n;
 const refused=await f.request(`sessions/${edit.child}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{productionPrompt:'写清选择与代价，突出转变'}});
 assert.equal(refused.status,409);const message=(await refused.json()).error;assert.match(message,/第 \d+ 幅的配文/,'names the frame, not an internal id');assert.doesNotMatch(message,/\bn\d+\b/);
 assert.equal((await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM stories').first()).n,stories,'nothing is saved when it would drop a hand edit');
 // 画风改变只需以手改为基础转换：不弹窗、不拒绝。
 const style=await f.json(`sessions/${edit.child}/revisions/preview`,'POST',{token:base.token,changes:{artStyle:'watercolor'}});
 assert.deepEqual(style.conflicts,[]);
 assert.equal(text(),calls,'preview and a refused save started no model call');
});

// ——— 阶段 3：正确性缺口 ———

test('ready does not count a lost image; the review history and acceptance results come from the engine',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const {rm}=await import('node:fs/promises');const path=await import('node:path');
 const before=await f.read(id);assert.equal(before.ready,6);
 const image=before.story.pages[2].image;
 await rm(path.join(f.dataDirectory,'media','reader',id,'2.png'));
 await f.json(`sessions/${id}/image-health`,'POST',{page:2,image});
 assert.equal((await f.read(id)).ready,5,'the lost image is not ready');
 const history=await f.json(`sessions/${id}/review-history`);
 assert.equal(history.status,'passed');
 assert.ok(history.entries.some(e=>e.kind==='review'&&e.outcome==='passed'),'the current review verdicts are listed');
 const prompts=await f.json(`sessions/${id}/prompts`);
 assert.ok(Array.isArray(prompts.results));
});

test('a revision cannot change the source reference, and a shortened story keeps the reading position inside it',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const invented=await f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:snapshot.token,changes:{plan:{...snapshot.plan,sourceReference:'虚构的出处'}}});
 assert.equal(invented.status,400);
 await f.app.services.database.prepare('UPDATE stories SET page=5 WHERE id=?').bind(id).run();
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{removedFrames:[5,6],plan:{...snapshot.plan,pages:snapshot.plan.pages.slice(0,4)}}});
 assert.ok((await f.read(child)).page<=3,'the reading position stays inside the shortened story');
});

test('a landscape file that is no longer readable shows as failed and is redrawn on retry',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 let status=await f.json(`sessions/${id}/landscape`);
 await f.json(`sessions/${id}/landscape`,'POST',{startToken:status.startToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
 status=await f.json(`sessions/${id}/landscape`);
 const beforeCard=(await f.json('library/shelf')).find(card=>card.id===id);
 const file=referenceImageKey(id,status.images[2]);
 await f.media.put(file,new TextEncoder().encode('not an image'),{contentType:'image/png'});
 status=await f.json(`sessions/${id}/landscape`);
 assert.deepEqual(status.failed,[3]);assert.equal(status.state,'partial');
 const media=f.app.services.media,get=media.get.bind(media);
 try{
  media.get=key=>{if(key===file)throw Error('controlled transient landscape read');return get(key);};
  const unavailable=await f.json(`sessions/${id}/landscape`);
  assert.deepEqual(unavailable.failed,[]);
  assert.equal(unavailable.retryToken,undefined);
 }finally{media.get=get;}
 const afterCard=(await f.json('library/shelf')).find(card=>card.id===id);
 const portrait=({actions,...state})=>({...state,actions:actions.filter(action=>!action.event.endsWith('-landscape'))});
 assert.deepEqual(portrait(afterCard.lifecycle),portrait(beforeCard.lifecycle));
 assert.ok(!afterCard.lifecycle.actions.some(action=>action.event==='start-landscape'));
 const before=f.control.calls.filter(c=>c.landscape).length;
 const oldJobs=(await f.app.services.production.queue.jobs(id,owner)).filter(job=>job.kind==='landscape-print');
 await f.json(`sessions/${id}/landscape`,'POST',{retryToken:status.retryToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
 assert.equal(f.control.calls.filter(c=>c.landscape).length-before,1,'only the damaged landscape is redrawn');
 const newJobs=await f.app.services.production.queue.jobs(id,owner);
 for(const old of oldJobs)assert.equal(newJobs.find(job=>job.id===old.id)?.result,old.result,'the original landscape result is retained');
 assert.equal(newJobs.filter(job=>JSON.parse(job.payload).attempt===1).length,1);
});

// ——— 审查意见：快照停滞、画风预设与横图比例 ———

test('a story with a saved snapshot keeps running when the current global provider is unavailable',async t=>{
 const f=await snapshotFixture(t,{current:()=>snapshotA,provider:()=>f.generation});
 f.generation.capture=()=>undefined;
 const id=await confirmedStory(f,4,{dag:{...emptyDag(),modelSnapshot:snapshotA}});
 for(let i=0;i<5;i++){f.app.services.production.wake();await turn();}
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(f.control.calls.length,4,'all four drawings ran on the saved provider');
});

test('a preset change without a new custom prompt drops the old custom art instructions',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 await f.app.services.database.prepare("UPDATE stories SET selection=json_set(selection,'$.artStyle','ink-pencil','$.artStylePrompt','自定义铅笔：粗线条、灰调') WHERE id=?").bind(id).run();
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{artStyle:'watercolor'}});
 const row=await f.app.services.database.prepare('SELECT selection FROM stories WHERE id=?').bind(child).first();
 const next=JSON.parse(row.selection);
 assert.equal(next.artStyle,'watercolor');
 assert.ok(!next.artStylePrompt,'the pencil prompt must not follow the watercolor preset');
 // 同时给出新的自定义说明时按给出的保存。
 const again=crypto.randomUUID(),fresh=await f.json(`sessions/${child}/revisions`);
 await f.json(`sessions/${child}/revisions`,'POST',{requestId:again,token:fresh.token,changes:{artStyle:'ink-pencil',artStylePrompt:'新的铅笔说明'}});
 assert.equal(JSON.parse((await f.app.services.database.prepare('SELECT selection FROM stories WHERE id=?').bind(again).first()).selection).artStylePrompt,'新的铅笔说明');
});

test('a square replacement is not accepted as part of a complete 3:2 landscape set',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 let status=await f.json(`sessions/${id}/landscape`);
 await f.json(`sessions/${id}/landscape`,'POST',{startToken:status.startToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
 status=await f.json(`sessions/${id}/landscape`);
 const {createCanvas}=await import('@napi-rs/canvas');
 await f.media.put(referenceImageKey(id,status.images[1]),createCanvas(64,64).toBuffer('image/png'),{contentType:'image/png'});
 status=await f.json(`sessions/${id}/landscape`);
 assert.deepEqual(status.failed,[2]);assert.equal(status.state,'partial');
});

test('saving an edited character setting or ending keeps the edit and redraws only what depends on it',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id,dag:before}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(snapshot.plan);
 const lines=plan.characters.split('\n');
 const [name]=lines[0].split('：');
 lines[0]=`${name}：改动后的人物设定，披着深色长袍。`;
 plan.characters=lines.join('\n');
 plan.reflection='改动后的余味。';
 plan.title='改动后的标题';
 const preview=await f.json(`sessions/${id}/revisions/preview`,'POST',{token:snapshot.token,changes:{plan}});
 assert.ok(preview.redraw>0,'the character edit redraws the frames that show that character');
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});
 const doc=await saved(f,child);
 assert.ok(doc.dag.characters[0].text.includes('深色长袍'));
 assert.equal(doc.plan.characters.split('\n')[0],lines[0]);
 assert.equal(doc.plan.reflection,'改动后的余味。');
 assert.equal(doc.plan.title,'改动后的标题');
 assert.equal(doc.dag.ending.confirmed.ending,'改动后的余味。');
 // 只有画过被改人物的画幅换了图片输入。
 assert.equal(doc.dag.continuation?.reason,'revision-saved','the dependent drawings and reviews wait for 继续制作');
 // 无法逐行对应的人物设定被拒绝，而不是静默丢弃。
 const bad=structuredClone(snapshot.plan);bad.characters='随便一行';
 const refused=await f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:snapshot.token,changes:{plan:bad}});
 assert.equal(refused.status,400);
});

test('hand-editing a picture description passes the newly drawn character to the drawing job',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id,dag}=await completedStory(f),newCharacter=dag.characters.find(character=>character.name==='鲍叔牙');
 const {doc}=await revise(f,id,snapshot=>{
  const plan=structuredClone(snapshot.plan);
  plan.pages[1].prompt+='，画面右侧新增入画人物鲍叔牙，与主人公对坐。';
  return {plan};
 });
 assert.deepEqual(f.control.calls.map(call=>call.page),[1]);
 const frame=doc.dag.frames[doc.dag.order[1]];
 assert.deepEqual({includedInFrame:frame.drawn.includes(newCharacter.id),includedInDraw:f.control.calls[0].prompt.includes(newCharacter.text)},
  {includedInFrame:true,includedInDraw:true});
});

test('a hand-edited picture description that refers to people only by pronoun keeps the frame cast',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id,dag}=await completedStory(f),key=dag.order[1],before=dag.frames[key].drawn;
 assert.ok(before?.length,'the frame has a recorded cast');
 const {doc}=await revise(f,id,snapshot=>{
  const plan=structuredClone(snapshot.plan);
  plan.pages[1].prompt='他独自坐在窗前，神情专注，暮色中只见侧影。';
  return {plan};
 });
 assert.deepEqual(doc.dag.frames[key].drawn,before,'no one named in the text, so the existing cast stays');
 const character=dag.characters.find(item=>item.id===before[0]);
 assert.ok(f.control.calls.at(-1).prompt.includes(character.text),'the redraw still sends the existing character description');
});

test('a transient read error keeps the paid image receipt and the queue reads it without paying again',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f),route=`sessions/${id}`,requestId=crypto.randomUUID(),{token}=await f.json(`${route}/revisions`);
 const media=f.app.services.media,read=media.get.bind(media);
 let unavailable=true;
 media.get=async key=>{
  if(unavailable&&key.startsWith(`reader/${requestId}/artifacts/1-`))throw Error('controlled transient read error');
  return read(key);
 };
 await f.json(`${route}/revisions`,'POST',{requestId,token,changes:{redrawPages:[2]},startRedraw:true});
 await until(async()=>(await f.read(requestId)).lifecycle.imageAvailability==='unavailable',5000);
 const blocked=await f.read(requestId);
 assert.equal(blocked.faults,undefined);
 assert.equal(f.control.calls.length,1);
 const [queued]=await f.app.services.production.queue.jobs(requestId,owner);
 assert.equal(queued.attempts,0);
 assert.ok(JSON.parse(queued.payload).paid.value);
 unavailable=false;
 await until(async()=>(await f.read(requestId)).state==='completed',5000);
 assert.equal(f.control.calls.length,1);
 assert.equal((await f.read(requestId)).lifecycle.imageAvailability,'available');
});

test('queued landscapes show a snapshot service blocker and resume after service recovery',async t=>{
 let available=false;
 const f=await snapshotFixture(t,{current:()=>snapshotA,provider:()=>available?f.generation:null});
 const {id}=await completedStory(f);
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.dag.modelSnapshot',json(?)) WHERE id=?").bind(JSON.stringify(snapshotA),id).run();
 const route=`sessions/${id}/landscape`,start=await f.json(route);
 const status=await f.json(route,'POST',{startToken:start.startToken});
 assert.equal(status.service,'snapshot-unavailable');
 assert.deepEqual(status.failed,[]);
 assert.equal(status.retryToken,undefined);
 await f.app.services.production.tick();
 assert.equal(f.control.calls.length,0);
 available=true;
 f.app.services.production.wake();
 await until(async()=>(await f.json(route)).state==='completed',20000);
 assert.equal(f.control.calls.filter(c=>c.landscape).length,6);
});

test('a restored completed story can explicitly start landscapes while portrait work stays stopped',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f),route=`sessions/${id}/landscape`;
 await f.json(`library/${id}`,'DELETE');
 await f.json(`library/${id}/restore`,'POST',{});
 const {startToken}=await f.json(route);
 const queued=await f.json(route,'POST',{startToken});
 assert.equal(queued.control,'active');
 await until(async()=>(await f.json(route)).state==='completed',10000);
 assert.equal((await f.read(id)).generationControl,'stopped');
 assert.equal(f.control.calls.length,6);
 assert.ok(f.control.calls.every(call=>call.landscape));
});

test('read-only mode starts no generation even when the story has a usable model snapshot',async t=>{
 // 当前设置为只读时快照服务没有当前快照；故事保存的快照仍可构造提供方，但任务不得派发。
 const f=await snapshotFixture(t,{current:()=>undefined,provider:()=>f.generation});
 const id=await confirmedStory(f,4,{dag:{...emptyDag(),modelSnapshot:snapshotA}});
 for(let i=0;i<15;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.dagCalls.length+f.control.calls.length,0,'no paid call was made');
 assert.notEqual((await f.read(id)).state,'completed');
});

test('changing art direction again before continuing redraws the supplied first illustration',async t=>{
 const {jpeg}=await import('./fixtures/images.mjs');
 const f=await productionFixture(t),{id}=await completedStory(f);f.control.hold=false;
 const a=crypto.randomUUID(),b=crypto.randomUUID(),parent=`sessions/${id}/revisions`;
 const form=new FormData();form.set('revision',JSON.stringify({token:(await f.json(parent)).token,requestId:a,changes:{artStyle:'watercolor'}}));
 form.set('cover',new Blob([Uint8Array.from(jpeg)],{type:'image/jpeg'}),'first.jpg');
 assert.equal((await f.app.handle(new Request('http://localhost/api/reader/'+parent,{method:'POST',body:form}))).status,201);
 const route=`sessions/${a}/revisions`;
 await f.json(route,'POST',{token:(await f.json(route)).token,requestId:b,changes:{artStyle:'clay'}});
 assert.ok((await saved(f,a)).images[0]);
 await f.json(`sessions/${b}/production-control`,'POST',{action:'continue'});
 await until(async()=>(await f.read(b)).state==='completed');
 assert.deepEqual(f.control.calls.map(call=>call.page).sort(),[0,1,2,3,4,5]);
 const latest=await f.json(`sessions/${id}/export`);assert.equal(latest.story.id,b);
 const bytes=await (await f.request(latest.story.pages[0].image.replace('/api/reader/',''))).arrayBuffer();
 assert.notDeepEqual(Buffer.from(bytes),Buffer.from(jpeg));
});
