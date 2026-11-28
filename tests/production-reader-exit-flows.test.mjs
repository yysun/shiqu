// 读者出口的端到端核对：用正式应用和受控模型把故事放进需要读者处理的状态，
// 渲染故事设置和书架的实际界面，取出界面给出的操作，调用对应的正式接口，确认服务端接受且故事继续向前。
import {decodeDocument} from '../lib/production-dag/document.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,selection,until} from './fixtures/production.mjs';
import {completedStory,confirmedStory,saved,savedSelection} from './fixtures/production-dag-story.mjs';
import {enabledActions,shelfEntry,surfaces} from './fixtures/reader-surfaces.mjs';
import {evaluate} from '../lib/production-dag/engine.ts';
import {stateOf} from '../lib/production-dag/runner.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {createStoryPdf} from '../lib/reader-pdf.ts';
import {copySavedStory} from '../server/reader-copy.ts';
import {emptyPublication} from '../lib/story-publication.ts';
import {nativeExportRuntime} from '../server/story-export.ts';

const legacyFrameSuggestion=/画幅建议|上次估算|初步估计/;

/** 按界面操作名称调用正式接口；返回 HTTP 响应。 */
function click(f,session,label){
 const control=action=>f.request(`sessions/${session.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action});
 if(label==='继续制作'||/^重绘第 \d+ 幅$/.test(label))return control('continue');
 if(label==='暂停生成')return control('pause');
 if(label==='恢复生成'||label==='恢复准备')return control('resume');
 if(label==='应用当前模型设置')return control('apply-model');
 if(/^(重试|重绘)/.test(label)){
  const offer=session.lifecycle.actions.find(action=>action.event==='retry');
  assert.ok(offer,`${label} 对应可重试的故障`);
  return f.request(`sessions/${session.id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:offer.faultId});
 }
 throw Error(`未知操作：${label}`);
}

async function exitBoth(f,id,expected,showLandscape=false){
 const render=await surfaces(),session=await f.read(id);
 const settings=enabledActions(render.settings(session,showLandscape));
 const fromSettings=settings.filter(label=>expected.test(label));
 const fromShelf=enabledActions(shelfEntry(render.shelf(await f.json('library/shelf')),id)).filter(label=>expected.test(label));
 assert.equal(fromSettings.length,1,`故事设置显示 ${expected}：${settings.join('、')}`);
 assert.equal(fromShelf.length,1,`书架显示 ${expected}`);
 assert.equal(fromSettings[0],fromShelf[0]);
 const response=await click(f,session,fromSettings[0]);
 assert.ok(response.ok,`${fromSettings[0]} 被服务端接受：${response.status}`);
 return response.json();
}

test('each reader-facing waiting state exposes the same action on every surface, and that action moves the story on',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;

 // 修订已保存，等待继续。
 const original=(await completedStory(f)).id,snapshot=await f.json(`sessions/${original}/revisions`);
 const plan=structuredClone(snapshot.plan);plan.pages[1].caption='核对用修改：第二幅配文。';
 const revision=crypto.randomUUID();
 await f.json(`sessions/${original}/revisions`,'POST',{requestId:revision,token:snapshot.token,changes:{plan}});
 const render=await surfaces();
 assert.match(render.settings(await f.read(revision),false),/lucide-arrow-right[^]*?待继续/);
 await exitBoth(f,revision,/^继续制作$/);
 await until(async()=>(await f.read(revision)).state==='completed',20000);

 // 某一步失败，等待重试。
 let failing=true;f.control.beforeText=async name=>{if(name==='storyboard'&&failing)throw Error('controlled failure');};
 const failed=await confirmedStory(f,4);f.app.services.production.wake();
 await until(async()=>(await f.read(failed)).lifecycle.actions.some(action=>action.event==='retry'),20000);
 failing=false;f.control.beforeText=null;
 await exitBoth(f,failed,/^重试/);
 await until(async()=>(await f.read(failed)).state==='completed',20000);

 // 制作中暂停。
 f.control.hold=true;
 const paused=await confirmedStory(f,4);f.app.services.production.wake();
 await until(()=>f.control.calls.length>0,20000);
 await f.json(`sessions/${paused}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'pause'});
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>(await f.read(paused)).lifecycle.activity.state!=='running',20000);
 assert.match(render.settings(await f.read(paused),false),/lucide-pause[^]*?已暂停/);
 await exitBoth(f,paused,/^恢复生成$/);
 await until(async()=>(await f.read(paused)).state==='completed',20000);

 // 修订删除后恢复：控制为停止，同时等待继续。
 const kept=(await completedStory(f)).id,keptSnapshot=await f.json(`sessions/${kept}/revisions`);
 const keptPlan=structuredClone(keptSnapshot.plan);keptPlan.pages[0].caption='核对用修改：第一幅配文。';
 const restored=crypto.randomUUID();
 await f.json(`sessions/${kept}/revisions`,'POST',{requestId:restored,token:keptSnapshot.token,changes:{plan:keptPlan}});
 await f.json(`library/${restored}`,'DELETE');await f.json(`library/${restored}/restore`,'POST',{});
 await exitBoth(f,restored,/^继续制作$/);
 await until(async()=>{const s=await f.read(restored);return s.state==='completed'&&s.generationControl==='active';},20000);

 // 已完成作品刷新建议时暂停：书架卡片与故事设置都给出恢复。
 let release;const held=new Promise(resolve=>{release=resolve;});
 f.control.beforeText=async()=>{await held;};
 const refreshed=(await completedStory(f)).id;
 await f.json(`sessions/${refreshed}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'reprepare'});
 await until(async()=>(await f.read(refreshed)).lifecycle.preparationRefresh==='pending',20000);
 await f.json(`sessions/${refreshed}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'pause'});
 f.control.beforeText=null;release();
 await until(async()=>(await f.read(refreshed)).lifecycle.activity.state!=='running',20000);
 assert.match((await surfaces()).settings(await f.read(refreshed),false),/准备建议更新已暂停/);
 await exitBoth(f,refreshed,/^恢复生成$/);
 await until(async()=>(await f.read(refreshed)).lifecycle.preparationRefresh==='none',20000);
});

test('replanning continues in the storyboard row while a preparation refresh requested via API can finish',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f),{token}=await f.json(`sessions/${id}/revisions`);
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token,
  changes:{length:'auto',productionPrompt:'以庄周梦醒时的疑惑为主线。'}});
 const render=await surfaces();
 const row=(markup,stage)=>markup.match(new RegExp(`<li data-stage="${stage}"[^>]*>[\\s\\S]*?</li>`))?.[0]??'';
 const waiting=render.settings(child,false);
 assert.match(row(waiting,'plan'),/继续后编排新版分镜 · 新版幅数待编排，预计复用 0 幅旧图/);
 assert.ok(enabledActions(row(waiting,'plan')).includes('继续制作'));
 assert.doesNotMatch(waiting,legacyFrameSuggestion);

 const storyboard=Promise.withResolvers();
 f.control.beforeText=name=>name==='storyboard'?storyboard.promise:undefined;
 try{
  assert.ok((await click(f,child,'继续制作')).ok);
  let active;
  await until(async()=>{
   active=await f.read(child.id);
   return active.lifecycle.activity.state==='running'&&active.lifecycle.activity.jobs.some(job=>job.call==='storyboard');
  },15000);
  const producing=render.settings(active,false),plan=row(producing,'plan');
  assert.match(plan,/正在编排新版分镜/);
  assert.ok(enabledActions(plan).includes('暂停生成'));
  assert.doesNotMatch(producing,/继续制作|按当前要求重新准备/);
  assert.doesNotMatch(producing,legacyFrameSuggestion);
  const refreshing=await f.json(`sessions/${active.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'reprepare'});
  assert.equal(refreshing.lifecycle.preparationRefresh,'pending');
  const refreshMarkup=render.settings(refreshing,false),refreshRow=row(refreshMarkup,'count');
  assert.match(refreshRow,/等待更新准备建议/);
  assert.doesNotMatch(refreshMarkup,legacyFrameSuggestion);
 }finally{storyboard.resolve();}
 await until(async()=>{const current=await f.read(child.id);return current.state==='completed'&&current.lifecycle.preparationRefresh==='none';},20000);
});

test('preparation refresh requests are rejected until review, repair and portrait drawing settle',async t=>{
 const f=await productionFixture(t,'codex'),render=await surfaces();
 const recommendation={count:6,reason:'供制作确认时参考的幅数。'};
 const id=await confirmedStory(f,4,{frameRecommendation:recommendation});
 const firstReview=Promise.withResolvers(),repair=Promise.withResolvers(),recheck=Promise.withResolvers();
 let reviews=0;
 f.control.beforeText=async(call,payload)=>{
  if(call==='review'){
   if(++reviews===1){
    await firstReview.promise;
    return {issues:[{page:2,category:'composition',repairField:'prompt',problem:'画面中的动作不清楚。',instruction:'写清楚人物醒来的动作。',requiresReplan:false}]};
   }
   await recheck.promise;
  }
  if(call==='visualRepair'){
   await repair.promise;
   return {frames:payload.frames.map(({number,current})=>({number,drawn:current.drawn,prompt:'庄周从席上撑起身子，抬眼望着窗外的庭院。'}))};
  }
 };
 async function verifyRejected(call){
  let session;
  await until(async()=>{
   session=await f.read(id);
   return session.lifecycle.activity.jobs?.some(job=>job.call===call);
  },15000);
  const settings=render.settings(session,false);
  const shelf=shelfEntry(render.shelf(await f.json('library/shelf')),id);
  assert.ok(shelf,call+' 阶段的故事出现在书架');
  assert.doesNotMatch(settings,legacyFrameSuggestion,call+' 阶段的故事设置');
  assert.doesNotMatch(shelf,legacyFrameSuggestion,call+' 阶段的书架');
  const response=await f.request(`sessions/${id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'reprepare'});
  assert.equal(response.status,409,`${call} 拒绝旧页面发出的更新请求`);
  assert.match((await response.json()).error,/分镜.*制作完成/);
  assert.equal(session.story.pages.length,4);
  assert.ok(!session.lifecycle.actions.some(action=>action.event==='reprepare'));
  const after=await f.read(id);
  assert.deepEqual(after.lifecycle.activity,session.lifecycle.activity);
  assert.equal(after.lifecycle.preparationRefresh,'none');
  assert.deepEqual(after.frameRecommendation,session.frameRecommendation);
  assert.equal(f.control.recommendations.length,0);
 }
 f.app.services.production.wake();
 try{
  await verifyRejected('review');
  firstReview.resolve();
  await verifyRejected('visualRepair');
  repair.resolve();
  await verifyRejected('review');
  recheck.resolve();
  await verifyRejected('draw');
 }finally{
  firstReview.resolve();repair.resolve();recheck.resolve();
  f.control.hold=false;for(const call of f.control.calls)call.resolve();
 }
 await until(async()=>(await f.read(id)).state==='completed',15000);
 const done=await f.read(id);
 assert.ok(done.lifecycle.actions.some(action=>action.event==='reprepare'));
 assert.equal(done.story.pages.length,4);
 assert.equal(f.control.calls.length,4);
 assert.equal(f.control.recommendations.length,0);
});

const revisionCases=[
 {call:'storyboard',requirements:['第一条要求。','第二条要求。'],changes:{acceptancePrompt:'另一条要求。'},expected:[1,4]},
 {call:'review',requirements:['第一条要求。','第二条要求。'],changes:{artStyle:'watercolor'},expected:['第一条要求。','第二条要求。']},
 {call:'review',requirements:['第一条要求。','第二条要求。','第三条要求。'],changes:{acceptancePrompt:'第一条要求。\n改写后的要求。'},expected:['第一条要求。','改写后的要求。']},
];

for(const {call,requirements,changes,expected} of revisionCases){
 test(`a revision commissions new ${call} work on continuation after a prior batch failure`,async t=>{
  const f=await productionFixture(t);
  f.control.hold=false;
  f.control.beforeText=async name=>{if(name===call)throw Error('受控步骤故障');};
  const id=await confirmedStory(f,4,{}, {acceptancePrompt:requirements.join('\n')});
  f.app.services.production.wake();
  await until(async()=>(await f.read(id)).state==='failed');
  const [failed]=(await f.read(id)).lifecycle.faults;
  await control(f,id,'pause');
  const child=await fork(f,id,changes),route=`sessions/${child}`;
  assert.deepEqual((await f.read(child)).lifecycle.faults,[]);
  const batches=[];
  f.control.beforeText=async(name,payload)=>{if(name===call)batches.push(payload.acceptanceCriteria??[payload.batch.first,payload.batch.last]);};
  await f.json(route+'/production-control','POST',{action:'continue'});
  await until(async()=>(await f.read(child)).state==='completed');
  await f.restart();
  assert.deepEqual(batches,[expected]);
  assert.equal((await f.read(id)).lifecycle.faults[0].id,failed.id);
  for(const session of [await f.read(child),(await f.json('library/shelf')).find(session=>session.id===child)]){
   assert.equal(session.state,'completed');
   assert.equal(session.ready,4);
   assert.equal(session.lifecycle.review,'approved');
   assert.deepEqual(session.lifecycle.faults,[]);
  }
 });
}

async function preparedIntake(f){
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。'}],note:''});
 const {id}=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto'}});
 const route=`sessions/${id}`;
 await f.startDiscovery(id);
 await f.demand(id);
 await until(async()=>(await f.read(id)).intake.batches.length===1);
 const {generation}=(await f.read(id)).intake;
 await f.json(route+'/setup','POST',{action:'choose',generation,batch:0,index:0,requestId:crypto.randomUUID()});
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 return id;
}

test('C069: readers see one frame estimate before confirming and actual counts after storyboarding',async t=>{
 const f=await productionFixture(t),render=await surfaces();
 f.control.hold=false;
 const id=await preparedIntake(f),prepared=await f.read(id);
 assert.equal(prepared.frameRecommendation.count,7);
 const setup=render.setup(prepared),editing=render.setup(prepared,'count');
 const detail=editing.match(/<dialog\b[^>]*aria-label="修改故事"[^>]*>[\s\S]*?<\/dialog>/)?.[0];
 assert.ok(detail,'叙事详略在修改故事对话框中');
 const estimate=/预计\s*\d+\s*幅/;
 assert.match(setup,/修改叙事详略/);
 assert.ok(enabledActions(setup).includes('开始制作'));
 for(const label of ['简短','适中','详细'])assert.ok(enabledActions(detail).some(action=>action.startsWith(label)));
 assert.deepEqual(setup.match(new RegExp(estimate.source,'g')),['预计 7 幅']);
 assert.match(setup,/最终幅数由编排与审核确定/);
 assert.doesNotMatch(setup,legacyFrameSuggestion);
 assert.doesNotMatch(detail,legacyFrameSuggestion);
 assert.doesNotMatch(detail,estimate);
 assert.ok(!enabledActions(detail).includes('按当前要求重新准备'));
 assert.ok(enabledActions(render.setup(prepared,'requirements')).includes('按当前要求重新准备'));

 const review=Promise.withResolvers();
 f.control.beforeText=call=>call==='review'?review.promise:undefined;
 try{
  await f.json(`sessions/${id}/setup`,'POST',{action:'confirm',generation:prepared.intake.generation,draftToken:prepared.intake.draftToken,
   requestId:crypto.randomUUID(),settings:{...prepared.intake.draft,narrativeDetail:'brief'}});
  let auditing;
  await until(async()=>{
   auditing=await f.read(id);
   return auditing.lifecycle.activity.jobs?.some(job=>job.call==='review');
  },15000);
  assert.equal(auditing.selection.narrativeDetail,'brief');
  assert.equal(auditing.story.pages.length,8);
  const progress=render.settings(auditing,false);
  assert.match(progress,/8 幅分镜已保存/);
  assert.doesNotMatch(progress,estimate,'审核中显示实际分镜数');
  assert.doesNotMatch(progress,legacyFrameSuggestion);
 }finally{review.resolve();}
 await until(async()=>(await f.read(id)).state==='completed',15000);
 const completed=await f.read(id),completion=render.settings(completed,false);
 assert.match(completion,/8 幅分镜已保存/);
 assert.doesNotMatch(completion,estimate,'完成后显示实际分镜数');
 assert.doesNotMatch(completion,legacyFrameSuggestion);
 assert.equal(f.control.recommendations.length,1);
});

test('a saved recommendation with a lost receipt settles on restart without another model call',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 const id=await preparedIntake(f),route=`sessions/${id}`;
 await f.app.services.production.queue.settle();
 const before=await f.read(id);
 const savedUsage=async()=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document).usage;
 const usage=await savedUsage();
 const job=await f.app.services.database.prepare("SELECT id FROM production_jobs WHERE session_id=? AND state='succeeded' AND json_extract(payload,'$.work.call')='prepareSuggestions'").bind(id).first();
 const queue=()=>f.app.services.production.queue;
 await queue().rerun(job.id);
 assert.equal((await queue().job(job.id)).state,'queued');
 const restoredFault=crypto.randomUUID();
 const persisted=await queue().job(job.id);
 await f.app.services.database.prepare(`INSERT INTO production_faults(id,session_id,owner_id,job_id,kind,version,message,state,created_at,updated_at)
  VALUES(?,?,?,?,'interrupted',?,'准备结果回执丢失','recovering',1,1)`).bind(restoredFault,id,persisted.owner_id,job.id,persisted.version).run();
 await f.restart();
 await until(async()=>(await queue().job(job.id))?.state==='succeeded');
 const after=await f.read(id),shelf=(await f.json('library/shelf')).find(session=>session.id===id);
 assert.equal((await queue().job(job.id)).attempts,0);
 assert.equal((await f.app.services.database.prepare('SELECT state FROM production_faults WHERE id=?').bind(restoredFault).first()).state,'resolved');
 assert.deepEqual(after.frameRecommendation,before.frameRecommendation);
 assert.deepEqual(after.intake.draft,before.intake.draft);
 assert.deepEqual(await savedUsage(),usage);
 assert.equal(f.control.recommendations.length,1);
 for(const session of [after,shelf]){
  assert.equal(session.state,'idle');
  assert.equal(session.lifecycle.activity.state,'idle');
  assert.ok(session.lifecycle.actions.some(action=>action.event==='confirm'));
 }
 await f.json(route+'/setup','POST',{action:'confirm',generation:after.intake.generation,draftToken:after.intake.draftToken,
  requestId:crypto.randomUUID(),settings:{...after.intake.draft,length:4}});
 assert.equal((await f.read(id)).intake.phase,'confirmed');
});

test('landscape pause drains sent work without pausing a portrait revision',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 const {startToken}=await f.json(route);
 const started=await f.json(route,'POST',{startToken});
 assert.equal(started.controlAction,'pause');
 await until(()=>f.control.calls.length===1);
 const [active]=await f.json('library/shelf'),render=await surfaces();
 assert.deepEqual(active.landscapeWork,{printId:started.printId,action:'pause',ready:0,total:4,activePage:1});
 assert.match(shelfEntry(render.shelf([active]),id),/正在绘制第 1 幅横图 · <span[^>]+>0 \/ 4 幅<\/span>/);
 await f.json(route,'POST',{control:'pause',printId:started.printId});
 const [paused]=await f.json('library/shelf');
 assert.deepEqual(paused.landscapeWork,{printId:started.printId,action:'resume',ready:0,total:4,activePage:1});
 f.control.hold=false;f.control.calls[0].resolve();
 await until(async()=>(await f.json(route)).ready===1);
 const {changed:[advanced],removed}=await f.json('library/shelf','POST',[[id,paused.version]]);
 assert.deepEqual(removed,[]);
 assert.deepEqual(advanced.landscapeWork,{printId:started.printId,action:'resume',ready:1,total:4});
 assert.match(shelfEntry(render.shelf([advanced]),id),/横图已暂停 · <span[^>]+>1 \/ 4 幅<\/span>/);
 const child=await fork(f,id,{artStyle:'watercolor',length:5});
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 assert.deepEqual(f.control.calls.filter(call=>call.landscape).map(call=>call.page),[0]);
 assert.equal((await f.read(child)).ready,5);
 assert.equal((await f.read(child)).generationControl,'active');
 const [previous]=(await f.json(`sessions/${child}/landscape`)).earlier;
 assert.deepEqual([previous.storyId,previous.ready,previous.total,previous.controlAction],[id,1,4,'resume']);
 await f.restart();
 assert.equal((await f.json(route)).control,'paused');
 await f.json(route,'POST',{control:'resume',printId:previous.printId});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.filter(call=>call.landscape).map(call=>call.page),[0,1,2,3]);
 const sets=await f.json(`sessions/${child}/landscape/sets`);
 assert.equal(sets.length,1);
 const [print]=sets,source=await f.read(id);
 assert.equal(print.story.id,id);
 assert.deepEqual(print.story.pages.map(page=>page.caption),source.story.pages.map(page=>page.caption));
 assert.equal(print.images.length,4);
 for(const layout of ['landscape','letter']){
  const runtime=nativeExportRuntime(process.cwd(),f.app),read=runtime.read,sources=new Set();
  runtime.read=(url,page)=>{sources.add(url);return read(url,page);};
  assert.equal(Buffer.from(await createStoryPdf(print.story,()=>{},runtime,layout,print.images,3)).subarray(0,5).toString(),'%PDF-');
  assert.deepEqual(sources,new Set(print.images));
 }
});

const control=(f,id,action)=>f.json(`sessions/${id}/production-control`,'POST',{action});
async function fork(f,id,changes){
 const route=`sessions/${id}/revisions`,{token}=await f.json(route),child=crypto.randomUUID();
 await f.json(route,'POST',{requestId:child,token,changes});
 return child;
}
async function drain(f,cycles=12){
 for(let n=0;n<cycles;n++){
  await f.app.services.production.tick();
  await f.app.services.production.queue.settle();
 }
}

for(const legacyDeletion of [false,true])test(`deleting a shelf card holds earlier prints through restore (${legacyDeletion?'older deletion record':'current delete'})`,async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4});
 const route=`sessions/${id}/landscape`,{startToken}=await f.json(route);
 const {printId}=await f.json(route,'POST',{startToken});
 await until(()=>f.control.calls.length===1);
 const child=await fork(f,id,{acceptancePrompt:'核对画面动作。'});
 if((await f.read(child)).lifecycle.continuation)await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 assert.deepEqual((await f.json('library/shelf')).map(item=>item.id),[child]);
 if(legacyDeletion){
  // 旧版删除书架卡片时没有暂停父版套图，保留当时的数据库状态。
  await f.app.services.database.prepare("INSERT INTO library_deletions(user_id,story_id,kind,deleted_at) SELECT user_id,id,'generated',? FROM stories WHERE id=?")
   .bind(new Date().toISOString(),child).run();
 }else await f.json(`library/${child}`,'DELETE');
 assert.deepEqual(await f.json('library/shelf'),[]);
 assert.equal((await f.request(route)).status,404);
 assert.equal((await f.request(route,'POST',{control:'resume',printId})).status,404);
 f.control.hold=false;f.control.calls[0].resolve();
 await drain(f,3);
 await f.restart();await drain(f,3);
 const sent=()=>f.control.calls.filter(call=>call.landscape).map(call=>call.page+1);
 assert.deepEqual(sent(),[1]);
 await f.json(`library/${child}/restore`,'POST',{});
 await drain(f,3);
 const [previous]=(await f.json(`sessions/${child}/landscape`)).earlier;
 assert.deepEqual([previous.storyId,previous.printId,previous.ready,previous.total,previous.controlAction],[id,printId,1,4,'resume']);
 assert.deepEqual(sent(),[1]);
 await f.json(route,'POST',{control:'resume',printId:previous.printId});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(sent(),[1,2,3,4]);
});

test('a claimed landscape waits if the visible card is deleted before the paid send',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4});
 const route=`sessions/${id}/landscape`,{startToken}=await f.json(route);
 const generator=f.generation.generator.bind(f.generation),release=Promise.withResolvers();
 let entered=false;
 f.generation.generator=()=>{
  const active=generator();
  return {...active,async image(...args){entered=true;await release.promise;return active.image(...args);}};
 };
 f.control.hold=false;
 let child,printId;
 try{
  ({printId}=await f.json(route,'POST',{startToken}));
  await until(()=>entered);
  child=await fork(f,id,{acceptancePrompt:'核对画面动作。'});
  if((await f.read(child)).lifecycle.continuation)await control(f,child,'continue');
  await until(async()=>(await f.read(child)).state==='completed');
  await f.json(`library/${child}`,'DELETE');
 }finally{release.resolve();}
 await drain(f,3);
 assert.equal(f.control.calls.length,0);
 await f.json(`library/${child}/restore`,'POST',{});
 await drain(f,3);
 assert.equal(f.control.calls.length,0);
 await f.json(route,'POST',{control:'resume',printId});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.map(call=>call.page+1),[1,2,3,4]);
});

test('deleting a historical revision leaves the current print running',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4});
 const child=await fork(f,id,{acceptancePrompt:'核对画面动作。'});
 if((await f.read(child)).lifecycle.continuation)await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 const route=`sessions/${child}/landscape`,{startToken}=await f.json(route);
 await f.json(route,'POST',{startToken});
 await until(()=>f.control.calls.length===1);
 await f.json(`library/${id}`,'DELETE');
 assert.deepEqual((await f.json('library/shelf')).map(row=>row.id),[child]);
 f.control.hold=false;f.control.calls[0].resolve();
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.filter(call=>call.landscape).map(call=>call.page+1),[1,2,3,4]);
});

for(const changedStyle of [false,true])test(`replanning retries ${changedStyle?'changed':'matching'} drawing inputs on continuation`,async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 f.control.beforeImage=call=>{if(call.page===0)throw Error('受控绘图失败');};
 const id=await confirmedStory(f);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='failed');
 const [original]=(await f.read(id)).lifecycle.faults;
 await control(f,id,'pause');
 const child=await fork(f,id,{narrativeDetail:'detailed',...(changedStyle?{artStyle:'watercolor'}:{})});
 assert.deepEqual((await f.read(child)).lifecycle.faults,[]);
 f.control.beforeImage=null;
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 assert.equal(f.control.calls.filter(call=>call.page===0).length,2);
 assert.deepEqual((await f.read(child)).lifecycle.faults,[]);
 assert.equal((await f.read(id)).lifecycle.faults[0].id,original.id);
});

for(const [targetPages,paid] of [[[0],false],[[1],false],[[1,2],true]])test(`changing length from four to five fills frames with prior inputs at pages ${targetPages.map(page=>page+1).join(', ')}`,async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 const id=await confirmedStory(f);
 const media=f.app.services.media,get=media.get.bind(media);
 if(paid)media.get=async key=>key.startsWith(`reader/${id}/artifacts/0-`)?null:get(key);
 else f.control.beforeImage=call=>{if(call.page===0)throw Error('受控首图失败');};
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='failed');
 const first=(await f.read(id)).lifecycle.faults[0].targets[0].key;
 const hard=async(storyId,page)=>{
  const doc=await saved(f,storyId),dag=doc.dag,key=dag.order[page];
  const evaluation=evaluate(stateOf({id:storyId,doc,dag,selection:await savedSelection(f,storyId),confirmed:true,faults:[]}));
  return evaluation.instance('frameImage',key).hard;
 };
 const original=await hard(id,0);
 assert.equal(Object.keys(original).length,5);
 await control(f,id,'pause');
 const child=await fork(f,id,{length:5});
 assert.deepEqual((await f.read(child)).lifecycle.faults,[]);
 if(paid)media.get=get;
 f.control.beforeImage=null;
 if(!targetPages.includes(0))f.control.beforeText=(call,payload,schema,result)=>call==='storyboard'?{
  ...result,frames:result.frames.map(frame=>({...frame,
   prompt:`第 ${targetPages.includes(frame.number-1)?1:frame.number===1?2:frame.number} 幅：成年的庄周身着布衣，坐在柳树下沉思，中景，晨光柔和。`,
  })),
 }:undefined;
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 const doc=await saved(f,child),snapshot=await f.read(child);
 assert.equal(doc.dag.order.length,5);
 assert.ok(!doc.dag.order.includes(first));
 for(const page of targetPages)assert.deepEqual(await hard(child,page),original);
 assert.deepEqual(snapshot.lifecycle.faults,[]);
 const count=Number(targetPages.includes(0));
 assert.equal(f.control.calls.filter(call=>targetPages.includes(call.page)).length,paid?count:count+1);
 if(paid){
  const complete=await saved(f,child);
  assert.equal(complete.images[targetPages[0]],complete.images[targetPages[1]]);
  assert.equal(complete.usage.filter(entry=>entry.step==='dag:draw'&&entry.originId===id).length,1);
 }
});

test('an older version keeps its landscape failure and dedicated Retry after a revision',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;
 f.control.beforeImage=call=>{
  if(!call.landscape)return;
  if(call.page===2)throw Error('受控横图失败');
  if(call.page===3)f.control.hold=true;
 };
 const {printId}=await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(()=>f.control.calls.length===4);
 const running=await f.json(route);
 assert.deepEqual([running.state,running.ready,running.failed],['running',2,[3]]);
 assert.equal(running.error,undefined);
 await f.json(route,'POST',{printId,control:'pause'});
 const resumed=await f.json(route,'POST',{printId,control:'resume'});
 assert.deepEqual([resumed.state,resumed.control,resumed.failed,resumed.error],['running','active',[3],undefined]);
 f.control.hold=false;f.control.calls[3].resolve();
 await until(async()=>!!(await f.json(route)).retryToken);
 const child=await fork(f,id,{acceptancePrompt:'核对画面动作。'});
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 assert.deepEqual((await f.read(child)).lifecycle.faults,[]);
 const [previous]=(await f.json(`sessions/${child}/landscape`)).earlier;
 assert.deepEqual([previous.storyId,previous.state,previous.ready,previous.failed],[id,'partial',3,[3]]);
 assert.ok(previous.error);
 assert.equal((await f.read(id)).lifecycle.faults.length,0);
 const count=f.control.calls.filter(call=>call.landscape).length;
 await f.restart();
 f.control.beforeImage=null;
 await f.json(route,'POST',{retryToken:previous.retryToken});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.filter(call=>call.landscape).slice(count).map(call=>call.page),[2]);
});

test('a completed landscape set is printable from a revised story in the original order',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const original=(await f.json(route)).images;
 assert.deepEqual((await f.json(`sessions/${id}/export?layout=landscape`)).images,original);
 const child=await fork(f,id,{artStyle:'watercolor'});
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 const [print]=await f.json(`sessions/${child}/landscape/sets`);
 const refused=await f.request(`sessions/${id}/export?layout=landscape`);
 assert.equal(refused.status,409);
 const latest=await refused.json();
 assert.equal(latest.id,child);assert.deepEqual(latest.missingPages,[1,2,3,4]);
 assert.equal(print.story.id,id);
 assert.deepEqual(print.images,original);
 const selected=await f.json(`sessions/${child}/export?layout=letter&setId=${print.id}`);
 assert.equal(selected.id,child);
 assert.equal(selected.mark.revision,1);
 assert.deepEqual(selected.story.pages,print.story.pages);
 assert.deepEqual(selected.images,original);
 assert.equal((await f.json(`sessions/${child}/landscape`)).ready,0);
 assert.equal(f.control.calls.filter(call=>call.landscape).length,4);
});


test('changing the unavailable model of an earlier print only resumes explicitly authorized pages',async t=>{
 const f=await productionFixture(t);
 const original={provider:'codex',models:{text:'A',image:'A'}},replacement={provider:'codex',models:{text:'B',image:'B'}};
 let current=original,available=true;
 f.options.production={snapshots:{current:()=>current,provider:key=>available||key.models.image==='B'?f.generation:null}};
 await f.restart();f.control.hold=true;
 const {id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 const {printId}=await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(()=>f.control.calls.length===1);
 await f.json(route,'POST',{control:'pause',printId});
 f.control.hold=false;f.control.calls[0].resolve();await drain(f,3);
 const child=await fork(f,id,{acceptancePrompt:'核对画面动作。'});
 if((await f.read(child)).lifecycle.continuation)await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 const portraitBefore=(await saved(f,id)).dag;
 available=false;current=replacement;
 const childRoute=`sessions/${child}/landscape`;
 const [work]=(await f.json(childRoute)).earlier;
 assert.equal(work.service,'snapshot-unavailable');assert.ok(work.modelToken);
 assert.equal((await f.request(route,'POST',{control:'resume',printId})).status,503);
 for(const cmd of [{modelToken:work.modelToken},{control:'pause',printId},{control:'pause'}])
  assert.equal((await f.request(childRoute,'POST',cmd)).status,409);
 const status=await f.json(route,'POST',{modelToken:work.modelToken});
 assert.deepEqual([status.service,status.control,status.ready],['available','paused',1]);
 assert.equal((await f.request(route,'POST',{modelToken:work.modelToken})).status,409);
 await f.restart();await drain(f,3);
 assert.equal(f.control.calls.length,1);
 await f.json(route,'POST',{control:'resume',printId});
 await until(async()=>(await f.json(route)).ready===4);
 assert.deepEqual(f.control.calls.map(call=>[call.landscape,call.page]),[[true,0],[true,1],[true,2],[true,3]]);
 assert.deepEqual((await saved(f,id)).dag,portraitBefore);
 assert.equal((await f.read(child)).lifecycle.control,'active');
 assert.equal((await f.json(childRoute)).ready,0);
});

test('the shelf can switch an active print model while an already sent page finishes',async t=>{
 const f=await productionFixture(t),a={provider:'codex',models:{text:'A',image:'A'}},b={provider:'codex',models:{text:'B',image:'B'}};
 let current=a;
 const draws=[];
 const providerFor=model=>({...f.generation,generator(){
  const generator=f.generation.generator();
  return {...generator,async image(...args){draws.push([args[1]+1,model]);return generator.image(...args);}};
 }});
 const providers={A:providerFor('A'),B:providerFor('B')};
 f.options.production={snapshots:{current:()=>current,provider:s=>s.models.image===current.models.image?providers[s.models.image]:null}};
 await f.restart();f.control.hold=true;
 const {id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});await until(()=>f.control.calls.length===1);
 const before=(await saved(f,id)).dag;
 current=b;
 const [{landscapeWork}]=await f.json('library/shelf');assert.ok(landscapeWork.modelToken);
 assert.equal(landscapeWork.service,'snapshot-unavailable');
 await f.json(route,'POST',{modelToken:landscapeWork.modelToken});
 f.control.hold=false;f.control.calls[0].resolve();
 await until(async()=>(await f.json(route)).ready===4);
 assert.deepEqual(draws,[[1,'A'],[2,'B'],[3,'B'],[4,'B']]);
 assert.deepEqual((await saved(f,id)).dag,before);
});

test('standalone landscape controls leave portrait control intact and survive restart',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 const {printId}=await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(()=>f.control.calls.length>0);
 await f.json(route,'POST',{control:'pause',printId});
 assert.equal((await f.read(id)).lifecycle.control,'active');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await drain(f,3);const count=f.control.calls.length;assert.ok(count<4);
 await f.restart();await drain(f,3);
 assert.equal(f.control.calls.length,count);
 assert.equal((await f.json(route)).controlAction,'resume');
 await f.json(route,'POST',{control:'resume',printId});
 await until(async()=>(await f.json(route)).ready===4);
 assert.equal((await f.read(id)).lifecycle.control,'active');
});

test('a new print set preserves its predecessor and rejects controls for the previous set',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;
 const first=await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const exportRoute=`sessions/${id}/export?layout=landscape`,firstImages=(await f.json(route)).images;
 f.control.hold=true;
 const next=await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 assert.deepEqual((await f.json(route+'/sets')).map(set=>set.id),[next.printId,first.printId]);
 assert.deepEqual((await f.json(exportRoute)).images,firstImages);
 const stale=await f.request(route,'POST',{control:'pause',printId:first.printId});
 assert.equal(stale.status,409);
 assert.deepEqual([(await f.json(route)).printId,(await f.json(route)).control],[next.printId,'active']);
 f.control.hold=false;
 for(const call of f.control.calls)call.resolve();
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual((await f.json(route+'/sets')).map(set=>set.id),[next.printId,first.printId]);
 const currentImages=(await f.json(route)).images;
 assert.notDeepEqual(currentImages,firstImages);
 await f.json(`sessions/${id}/title`,'POST',{title:'最新印本'});
 assert.ok((await f.json(route+'/sets')).every(set=>set.story.title==='最新印本'));
 f.options.production={autoStart:false};await f.restart();
 const db=f.app.services.database;
 await db.prepare("UPDATE stories SET production_complete=0,generation_control='paused' WHERE id=?").bind(id).run();
 const tables=['stories','production_jobs','reader_commands','production_faults','production_demand'];
 const capture=()=>Promise.all(tables.map(name=>db.prepare('SELECT * FROM '+name+' ORDER BY '+(name==='production_faults'?'id':'rowid')).all()));
 const before=await capture(),calls=f.control.calls.length;
 const worker=f.app.services.production;
 try{
  f.app.services.production=undefined;
  for(const layout of ['landscape','letter']){
   const source=await f.json(exportRoute);
   assert.equal(source.story.title,'最新印本');assert.deepEqual(source.images,currentImages);
   const bytes=await createStoryPdf(source.story,()=>{},nativeExportRuntime(process.cwd(),f.app),layout,source.images);
   assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
  }
  const media=f.app.services.media,get=media.get.bind(media);
  const newestKey=referenceImageKey(id,currentImages[2]),olderKey=referenceImageKey(id,firstImages[1]);
  let olderUnavailable=false;
  media.get=async key=>{if(key===newestKey||olderUnavailable&&key===olderKey)throw Error('受控读取失败');return get(key);};
  try{
   assert.deepEqual((await f.json(exportRoute)).images,firstImages);
   olderUnavailable=true;
   const refused=await f.request(exportRoute);
   assert.equal(refused.status,409);assert.deepEqual((await refused.json()).missingPages,[3]);
  }finally{media.get=get;}
  await f.media.remove(referenceImageKey(id,currentImages[2]));
  const fallback=await f.json(exportRoute);
  assert.deepEqual(fallback.images,firstImages);
  const render=async source=>{
   for(const layout of ['letter','landscape']){
    const bytes=await createStoryPdf(source.story,()=>{},nativeExportRuntime(process.cwd(),f.app),layout,source.images);
    assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
   }
  };
  await render(fallback);
  await f.media.put(referenceImageKey(id,firstImages[1]),new Uint8Array([0,1,2]),{contentType:'image/png'});
  for(const layout of ['landscape','letter']){
   const refused=await f.request(`sessions/${id}/export?layout=${layout}`);
   assert.equal(refused.status,409);
   const {error,ready,total,missingPages,story}=await refused.json();
   assert.match(error,/横版插图未完成.*3 \/ 4 幅.*第 3 幅/);
   assert.deepEqual({ready,total,missingPages},{ready:3,total:4,missingPages:[3]});
   assert.equal(story,undefined);
  }
  assert.equal((await f.json(`sessions/${id}/export`)).images,undefined);
 }finally{f.app.services.production=worker;}
 assert.deepEqual(await capture(),before);assert.equal(f.control.calls.length,calls);
});

test('landscape editions select and retry an independent style, including empty and partial print drafts',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4,selection:{artStyle:'gongbi'}});
 const route=`sessions/${id}/landscape`,exportRoute=`sessions/${id}/export`;
 const portrait=(await f.read(id)).story.pages.map(page=>page.image);
 f.control.hold=false;
 const offer=await f.json(route);
 assert.equal(offer.defaultArtStyle,'gongbi');
 const invalid=await f.request(route,'POST',{startToken:offer.startToken,artStyle:'unknown'});
 assert.equal(invalid.status,400);
 const water=await f.json(route,'POST',{startToken:offer.startToken,artStyle:'watercolor'});
 await until(async()=>(await f.json(route)).state==='completed');
 const original=(await f.json(route)).images;
 assert.equal(f.control.calls.length,4);
 assert.ok(f.control.calls.every(call=>call.landscape&&call.prompt.includes('Hand-painted watercolor')));

 f.control.hold=true;
 f.control.beforeImage=call=>{if(call.page%2)throw Error('受控横图未生成');};
 const ink=await f.json(route,'POST',{startToken:(await f.json(route)).startToken,artStyle:'ink-wash'});
 const empty=await f.json(exportRoute+`?layout=landscape&setId=${ink.printId}`);
 assert.deepEqual(empty.images,['','','','']);
 assert.equal(empty.mark.draft,true);
 const emptyPDF=await createStoryPdf(empty.story,undefined,nativeExportRuntime(process.cwd(),f.app),'landscape',empty.images,null,empty.mark);
 assert.equal(Buffer.from(emptyPDF).subarray(0,5).toString(),'%PDF-');
 f.control.hold=false;
 for(const call of f.control.calls)call.resolve();
 await until(async()=>!!(await f.json(route)).retryToken);
 const sets=await f.json(route+'/sets');
 assert.deepEqual(sets.map(set=>[set.id,set.artStyle,set.state,set.ready,set.total]),[
  [ink.printId,'ink-wash','partial',2,4],[water.printId,'watercolor','completed',4,4],
 ]);
 assert.deepEqual(sets.map(set=>set.discardable),[true,false]);
 const count=f.control.calls.length;
 for(const layout of ['landscape','letter']){
  const full=await f.json(exportRoute+`?layout=${layout}&setId=${water.printId}`);
  assert.deepEqual(full.images,original);
  assert.equal(full.mark.draft,false);
  const draft=await f.json(exportRoute+`?layout=${layout}&setId=${ink.printId}`);
  assert.equal(draft.mark.draft,true);
  assert.deepEqual(draft.images.map(Boolean),[true,false,true,false]);
  assert.ok(draft.images.filter(Boolean).every(image=>!original.includes(image)));
  assert.deepEqual(draft.story.pages.map(page=>page.image),portrait);
  const runtime=nativeExportRuntime(process.cwd(),f.app),read=runtime.read,sources=[];
  runtime.read=(url,page)=>{sources.push([page,url]);return read(url,page);};
  const pdf=await createStoryPdf(draft.story,undefined,runtime,layout,draft.images,2,draft.mark);
  assert.equal(Buffer.from(pdf).subarray(0,5).toString(),'%PDF-');
  assert.deepEqual(sources,[[2,draft.images[2]],[0,draft.images[0]]]);
 }
 const another=await completedStory(f,{length:4});
 assert.equal((await f.request(`sessions/${another.id}/export?layout=letter&setId=${ink.printId}`)).status,404);
 assert.equal(f.control.calls.length,count);
 f.control.beforeImage=null;
 await f.json(route,'POST',{retryToken:(await f.json(route)).retryToken});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.slice(count).map(call=>call.page).sort(),[1,3]);
 assert.ok(f.control.calls.slice(4).every(call=>call.landscape&&call.prompt.includes('Traditional Chinese ink-wash')));
 assert.deepEqual((await f.read(id)).story.pages.map(page=>page.image),portrait);
 assert.equal((await savedSelection(f,id)).artStyle,'gongbi');
 assert.equal((await f.json(route+'/sets'))[0].createdAt,sets[0].createdAt);
});

test('discarding a paused landscape edition after it drains preserves the earlier set and fences stale commands',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4,selection:{artStyle:'gongbi'}});
 const route=`sessions/${id}/landscape`,source=`sessions/${id}/export?layout=letter`;
 const portraits=(await f.read(id)).story.pages.map(page=>page.image);
 f.control.hold=false;
 const first=await f.json(route,'POST',{startToken:(await f.json(route)).startToken,artStyle:'watercolor'});
 await until(async()=>(await f.json(route)).state==='completed');
 const original=(await f.json(route)).images;
 const {startToken}=await f.json(route);
 f.control.hold=true;
 const paused=await f.json(route,'POST',{startToken,artStyle:'ink-wash'});
 await until(()=>f.control.calls.length===5);
 assert.equal((await f.request(route,'POST',{discardPrintId:paused.printId})).status,409);
 await f.json(route,'POST',{control:'pause',printId:paused.printId});
 const setsWhileDraining=await f.json(route+'/sets?summary=1');
 assert.deepEqual(setsWhileDraining.map(set=>[set.id,set.state,set.discardable]),[
  [paused.printId,'paused',false],[first.printId,'completed',false],
 ]);
 assert.equal(setsWhileDraining[0].awaitingSettle,true);
 assert.equal((await f.request(route,'POST',{discardPrintId:paused.printId})).status,409);
 f.control.hold=false;f.control.calls[4].resolve();
 await until(async()=>(await f.json(route+'/sets?summary=1'))[0]?.discardable);
 assert.equal((await f.json(route+'/sets?summary=1'))[0].ready,1);
 const retained=(await f.json(source+`&setId=${paused.printId}`)).images[0];
 assert.ok(retained);
 const after=await f.json(route,'POST',{discardPrintId:paused.printId});
 assert.equal(after.printId,first.printId);
 assert.notEqual(after.startToken,startToken);
 assert.equal((await f.request(route,'POST',{startToken,artStyle:'ink-wash'})).status,409);
 assert.equal((await f.request(route,'POST',{control:'resume',printId:paused.printId})).status,409);
 assert.equal((await f.request(route,'POST',{discardPrintId:first.printId})).status,409);
 assert.equal((await f.request(source+`&setId=${paused.printId}`)).status,404);
 const receipts=await f.app.services.database.prepare('SELECT result FROM production_jobs WHERE session_id=? AND version=? ORDER BY priority').bind(id,paused.printId).all();
 assert.equal(JSON.parse(receipts.results[0].result).image,retained);
 assert.deepEqual(receipts.results.slice(1).map(job=>JSON.parse(job.result)),Array.from({length:3},()=>({obsolete:1})));
 await f.restart();
 const remaining=await f.json(route+'/sets?summary=1');
 assert.deepEqual(remaining.map(set=>set.id),[first.printId]);
 assert.deepEqual((await f.json(source)).images,original);
 assert.equal(f.control.calls.length,5);
 const redrawn=await f.json(route,'POST',{startToken:(await f.json(route)).startToken,artStyle:'paper-cut'});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.ok(f.control.calls.slice(5).every(call=>call.landscape&&call.prompt.includes('Layered Chinese paper-cut')));
 assert.equal(f.control.calls.length,9);
 assert.deepEqual((await f.json(route+'/sets?summary=1')).map(set=>set.id),[redrawn.printId,first.printId]);
 assert.deepEqual((await f.json(source+`&setId=${first.printId}`)).images,original);
 assert.deepEqual((await f.read(id)).story.pages.map(page=>page.image),portraits);
});

test('discard recognizes a legacy paused set without queued jobs and protects a completed set with an unreadable file',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;
 const first=await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const complete=(await f.json(route)).images;
 await f.media.remove(referenceImageKey(id,complete[0]));
 const [damaged]=await f.json(route+'/sets?summary=1');
 assert.deepEqual([damaged.state,damaged.ready,damaged.discardable],['partial',3,false]);
 assert.equal((await f.request(route,'POST',{discardPrintId:first.printId})).status,409);

 // 历史迁移只为请求过的画幅保留任务，未请求的画幅没有排队记录。
 const db=f.app.services.database;
 await db.prepare("UPDATE stories SET document=json_set(document,'$.landscapePrints[#-1].control','paused') WHERE id=?").bind(id).run();
 await db.prepare("DELETE FROM production_jobs WHERE session_id=? AND version=? AND json_extract(payload,'$.input.index')<3").bind(id,first.printId).run();
 const [legacy]=await f.json(route+'/sets?summary=1');
 assert.deepEqual([legacy.state,legacy.ready,legacy.discardable],['paused',1,true]);
 await f.json(route,'POST',{discardPrintId:first.printId});
 assert.deepEqual(await f.json(route+'/sets?summary=1'),[]);
 assert.equal(f.control.calls.length,4);
});

test('a queued retry keeps its print set when a competing start finishes authorization',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;f.control.beforeImage=call=>{if(call.landscape&&call.page===2)throw Error('受控横图失败');};
 const first=await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>!!(await f.json(route)).retryToken);
 f.options.production={autoStart:false};await f.restart();f.control.beforeImage=null;
 const {startToken,retryToken}=await f.json(route),entered=Promise.withResolvers(),release=Promise.withResolvers();
 const second=f.app.services.production.startLandscape(f.app.services.ownerId,id,{startToken},async()=>{entered.resolve();await release.promise;});
 await entered.promise;
 try{
  assert.ok((await f.request(route,'POST',{retryToken})).ok);
 }finally{release.resolve();}
 await assert.rejects(second,error=>error.status===409);
 assert.equal((await f.json(route)).printId,first.printId);
 f.app.startGeneration();
 await until(async()=>(await f.json(route)).ready===4);
 assert.equal(f.control.calls.filter(call=>call.landscape&&call.page===2).length,2);
});

test('a landscape print switches models from the shelf and resumes without changing the portrait snapshot',async t=>{
 const f=await productionFixture(t),a={provider:'codex',models:{text:'A',image:'A'}},b={provider:'codex',models:{text:'B',image:'B'}};
 let current=a;
 f.options.production={autoStart:false,snapshots:{current:()=>current,provider:s=>s.models.image===current.models.image?f.generation:null}};
 await f.restart();
 const {id}=await completedStory(f,{length:4}),db=f.app.services.database,route=`sessions/${id}/landscape`;
 await db.prepare("UPDATE stories SET document=json_set(document,'$.dag.modelSnapshot',json(?)) WHERE id=?").bind(JSON.stringify(a),id).run();
 const {printId}=await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await f.json(route,'POST',{control:'pause',printId});current=b;
 const status=await f.json(route),[shelf]=await f.json('library/shelf');
 assert.equal(status.controlAction,undefined);assert.ok(status.modelToken);
 assert.equal(shelf.landscapeWork.modelToken,status.modelToken);
 assert.equal(shelf.lifecycle.optionalWork,false);
 assert.equal((await f.request(route,'POST',{control:'resume',printId})).status,503);
 const next=await f.json(route,'POST',{modelToken:shelf.landscapeWork.modelToken});
 assert.equal(next.controlAction,'resume');
 assert.equal((await f.request(route,'POST',{modelToken:status.modelToken})).status,409);
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,a);
 await f.restart();f.control.hold=false;await f.json(route,'POST',{control:'resume',printId});
 f.app.startGeneration();await until(async()=>(await f.json(route)).ready===4);
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,a);
 assert.equal(f.control.calls.filter(call=>call.landscape).length,4);
});

test('copy-images accepts a paused portrait copy after independent landscape work',async t=>{
 const source=await productionFixture(t),target=await productionFixture(t),{id}=await completedStory(source,{length:4});
 const route=`sessions/${id}/landscape`,requestId=crypto.randomUUID(),original=await source.read(id);
 const copy=options=>copySavedStory(target.app,process.cwd(),target.dataDirectory,source.dataDirectory,id,requestId,original.selection.artStyle,options);
 await source.stop();await copy({});
 await source.restart();source.control.hold=false;
 await source.json(route,'POST',{startToken:(await source.json(route)).startToken});
 await until(async()=>(await source.json(route)).ready===4);
 await source.stop();
 const copied=await copy({images:true,existing:true});
 assert.equal(copied.ready,4);assert.equal(copied.generationControl,'paused');
 assert.equal((await saved(target,requestId)).landscapePrints,undefined);
});

for(const conflict of ['metadata','new revision','same request'])test('concurrent revision save handles '+conflict,async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/revisions`;
 const child=crypto.randomUUID(),{token}=await f.json(route),input={requestId:child,token,changes:{acceptancePrompt:'核对画面动作。'}};
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),media=f.app.services.media,get=media.get.bind(media);
 let held=false;
 media.get=async key=>{
  if(key.startsWith('reader/'+id+'/')&&!held){held=true;entered.resolve();await release.promise;}
  return get(key);
 };
 const first=f.request(route,'POST',input);
 await entered.promise;
 try{
  if(conflict==='metadata'){
   await f.json(`sessions/${id}/title`,'POST',{title:'新书名'});
   await f.json(`sessions/${id}/publication`,'POST',{expected:null,publication:{...emptyPublication,author:'新署名'}});
  }else await f.json(route,'POST',{...input,requestId:conflict==='same request'?child:crypto.randomUUID()});
 }finally{release.resolve();}
 const response=await first;
 const aliases=await f.app.services.database.prepare('SELECT alias_key FROM production_media_aliases WHERE session_id=?').bind(child).all();
 if(conflict==='new revision'){
  assert.equal(response.status,409);
  assert.deepEqual(aliases.results,[]);
 }else{
  assert.ok(response.ok);
  const result=(await f.read(child)).story;
  if(conflict==='metadata'){assert.equal(result.title,'新书名');assert.equal(result.publication.author,'新署名');}
  const expected=result.pages.map(page=>referenceImageKey(child,page.image));
  assert.deepEqual(aliases.results.map(row=>row.alias_key).sort(),expected.sort());
 }
});

test('landscape retry only dispatches the pages authorized by its token',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const media=f.app.services.media,get=media.get.bind(media);
 let hideThird=false,hideSecond=true;
 media.get=async key=>hideSecond&&key.startsWith(`reader/${id}/artifacts/1-`)||hideThird&&key.startsWith(`reader/${id}/artifacts/2-`)?null:get(key);
 const {retryToken}=await f.json(route);
 let thirdReads=0;
 const before=f.control.calls.length,visible=media.get;
 media.get=async key=>{
  if(key.startsWith(`reader/${id}/artifacts/2-`)&&++thirdReads>1)hideThird=true;
  if(key.startsWith(`reader/${id}/artifacts/1-`)&&f.control.calls.length>before)hideSecond=false;
  return visible(key);
 };
 await f.json(route,'POST',{retryToken});
 await until(()=>f.control.calls.length>before);
 await f.app.services.production.queue.settle();
 assert.deepEqual(f.control.calls.slice(before).map(call=>call.page),[1]);
 assert.deepEqual((await f.json(route)).failed,[3]);
 hideSecond=hideThird=false;media.get=get;
 assert.equal((await f.json(route)).state,'completed');
});

test('settings and shelf offer local retry for a paid portrait without a model',async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 const media=f.app.services.media,get=media.get.bind(media);
 let hidden=true;
 media.get=async key=>hidden&&key.startsWith(`reader/${id}/artifacts/1-`)?null:get(key);
 f.control.hold=false;
 f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).state==='failed');
 hidden=false;
 await drain(f);
 f.options.production={autoStart:false,snapshots:{current:()=>undefined,provider:()=>null}};
 await f.restart();
 f.generation.status=async()=>({configured:false,message:'受控未配置'});
 const current=await f.read(id),[fault]=current.lifecycle.faults;
 assert.deepEqual([current.lifecycle.service,current.state,current.ready],['unconfigured','failed',1]);
 assert.ok(current.lifecycle.actions.some(action=>action.event==='retry'&&action.faultId===fault.id));
 const offlineMedia=f.app.services.media,offlineGet=offlineMedia.get.bind(offlineMedia);
 offlineMedia.get=async key=>key.startsWith(`reader/${id}/artifacts/1-`)?null:offlineGet(key);
 const before=f.control.calls.length;
 const unavailable=await f.request(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 assert.equal(unavailable.status,503);
 assert.equal((await f.read(id)).lifecycle.faults[0].id,fault.id);
 offlineMedia.get=offlineGet;
 const receipt=await exitBoth(f,id,/^重试生成$/);
 assert.deepEqual([receipt.state,receipt.ready,receipt.recoveryReceipt.status],['completed',2,'succeeded']);
 const after=await f.read(id);
 assert.deepEqual([after.state,after.ready,after.lifecycle.faults],['completed',2,[]]);
 assert.equal(f.control.calls.length,before);
});

for(const temporarilyUnavailable of [false,true])test(`a continued revision adopts a paid parent artifact ${temporarilyUnavailable?'after a temporary read interruption':'before drawing'}`,async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 const store=f.app.services.media,get=store.get.bind(store);
 let unavailable='missing',originKey;
 store.get=async key=>{
  if(key.startsWith(`reader/${id}/artifacts/0-`)){
   originKey=key;
   if(unavailable==='missing')return null;
   if(unavailable==='temporary'){unavailable=null;throw Error('受控图片读取中断');}
  }
  return get(key);
 };
 f.control.hold=false;
 f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).state==='failed');
 unavailable=temporarilyUnavailable?'temporary':null;
 await control(f,id,'pause');
 const child=await fork(f,id,{acceptancePrompt:'请核对画面动作。'});
 assert.deepEqual((await f.read(child)).lifecycle.faults,[]);
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 assert.equal(f.control.calls.filter(call=>call.page===0).length,1);
 const row=await f.app.services.database.prepare('SELECT * FROM story_rows WHERE id=?').bind(child).first();
 const doc=decodeDocument(row),image=doc.images[0];
 assert.ok(image.startsWith(`/api/reader/media/${child}/`));
 assert.deepEqual(await (await get(originKey)).arrayBuffer(),await (await get(`reader/${image.slice('/api/reader/media/'.length)}`)).arrayBuffer());
 assert.equal(doc.usage.filter(item=>item.step==='dag:draw'&&item.originId===id).length,1);
 assert.equal((await f.read(id)).lifecycle.faults.length,1,'祖先版本的任务和故障不被改写');
});

test('a new review failure can be released while active, independently of the parent',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 f.control.beforeText=async name=>{if(name==='review')throw Error('受控审核失败');};
 const id=await confirmedStory(f);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.some(fault=>fault.retryReview));
 const parent=await control(f,id,'pause');
 assert.ok(parent.reviewOverride);
 const child=await fork(f,id,{storySummary:'庄周醒后细想梦蝶的经历。'});
 assert.deepEqual((await f.read(child)).lifecycle.faults,[]);
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).faults?.some(fault=>fault.retryReview));
 const active=await f.read(child),route=`sessions/${child}/review-override`;
 const failure=active.lifecycle.faults[0],command={requestId:crypto.randomUUID(),faultId:failure.id,ending:'default'};
 assert.equal(failure.stage,'review');assert.equal(failure.targets.filter(target=>target.node==='frameVerdict').length,4);
 assert.equal(active.generationProgress.storyboardFrames,4);
 assert.equal(active.reviewOverride.faultId,failure.id);
 assert.equal((await f.request(route,'POST',{...command,faultId:parent.reviewOverride.faultId})).status,409);
 const released=await f.json(route,'POST',command);
 assert.equal(released.generationControl,'active');
 assert.deepEqual(released.lifecycle.faults,[]);
 await f.json(route,'POST',command);
 await until(async()=>(await f.read(child)).state==='completed');
 assert.equal(f.control.calls.length,4);
});

test('a continued revision waits for a matching parent drawing in flight',async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 const child=await fork(f,id,{acceptancePrompt:'请核对画面动作。'});
 await control(f,child,'continue');
 await until(async()=>!!(await f.app.services.database.prepare(`SELECT 1 FROM production_jobs
  WHERE session_id=? AND state='queued' AND json_extract(payload,'$.waitingFor')='image-availability'`).bind(child).first()));
 assert.equal(f.control.calls.length,1);
 f.control.hold=false;
 f.control.calls[0].resolve();
 await until(async()=>(await f.read(child)).state==='completed');
 assert.deepEqual(f.control.calls.map(call=>call.page),[0,1]);
 assert.equal((await saved(f,child)).usage.filter(entry=>entry.step==='dag:draw'&&entry.originId===id).length,1);
});

test('switching to a fixed length releases the failed automatic frame check',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;f.control.autoLength=4;
 f.control.beforeText=async name=>{if(name==='frames')throw Error('受控幅数核对故障');};
 const id=await confirmedStory(f,'auto');
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).lifecycle.faults.some(fault=>fault.targets.some(target=>target.node==='frameCheck')));
 await control(f,id,'pause');
 const child=await fork(f,id,{length:4});
 assert.deepEqual((await f.read(child)).lifecycle.faults,[]);
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 assert.equal(f.control.calls.length,4);
});

test('a queued landscape retry waits for its saved model without reclaiming the job',async t=>{
 const f=await productionFixture(t);
 const original={provider:'codex',models:{text:'A',image:'A'}},replacement={provider:'codex',models:{text:'B',image:'B'}};
 let current=original;
 f.options.production={autoStart:false,snapshots:{current:()=>current,provider:s=>s.models.image===current.models.image?f.generation:null}};
 await f.restart();f.control.hold=false;
 f.control.beforeImage=call=>{if(call.landscape&&call.page===1)throw Error('controlled failure');};
 const {id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await drain(f,6);
 const {retryToken}=await f.json(route);assert.ok(retryToken);
 await f.json(route,'POST',{retryToken});current=replacement;f.control.beforeImage=null;
 const db=f.app.services.database;
 await db.prepare('CREATE TEMP TABLE claims(id TEXT)').run();
 await db.prepare("CREATE TEMP TRIGGER count_claim AFTER UPDATE OF state ON production_jobs WHEN NEW.kind='landscape-print' AND NEW.state='running' BEGIN INSERT INTO claims VALUES(NEW.id); END").run();
 await drain(f,5);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM claims').first()).n,0);
 assert.equal(f.control.calls.length,4);
 current=original;
 await drain(f,3);
 assert.equal((await f.json(route)).state,'completed');
 assert.deepEqual(f.control.calls.slice(4).map(call=>[call.landscape,call.page]),[[true,1]]);
});

test('a portrait fault leaves an existing partial print visible and independently retryable',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;
 f.control.beforeImage=call=>{if(call.landscape&&call.page===1)throw Error('controlled failure');};
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>!!(await f.json(route)).retryToken);
 const image=(await f.read(id)).story.pages[3].image;
 await f.media.remove(referenceImageKey(id,image));
 assert.ok((await f.request(`sessions/${id}/image-health`,'POST',{page:3,image})).ok);
 const failed=await f.read(id);
 assert.equal(failed.state,'failed');
 assert.match((await surfaces()).settings(failed),/横版插图（可选）/);
 const status=await f.json(route);assert.ok(status.retryToken);assert.equal(status.startToken,undefined);
 const dag=(await saved(f,id)).dag,before=f.control.calls.length;
 f.control.beforeImage=null;
 await f.json(route,'POST',{retryToken:status.retryToken});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.slice(before).map(call=>[call.landscape,call.page]),[[true,1]]);
 assert.deepEqual((await saved(f,id)).dag,dag);
 assert.equal((await f.read(id)).state,'failed');
});

test('portrait model recovery is available from both settings and shelf',async t=>{
 const f=await productionFixture(t),previous={provider:'codex',models:{text:'A',image:'A'}},current={provider:'codex',models:{text:'B',image:'B'}};
 f.options.production={autoStart:false,snapshots:{current:()=>current,provider:s=>s.models.image===current.models.image?f.generation:null}};
 await f.restart();
 f.app.startGeneration();
 const {id}=await completedStory(f,{length:4}),doc=await saved(f,id),key=doc.dag.order[1];
 doc.dag.modelSnapshot=previous;
 delete doc.dag.products[`frameImage:${key}`];delete doc.dag.frames[key].image;doc.images[1]='';
 await f.app.services.database.prepare("UPDATE stories SET document=?,production_complete=0 WHERE id=?").bind(JSON.stringify(doc),id).run();
 const updated=await exitBoth(f,id,/^应用当前模型设置$/);
 assert.equal(updated.lifecycle.service,'available');
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,current);
});

test('failed re-preparation stays retryable on the shelf while the completed story remains readable',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),generator=f.generation.generator.bind(f.generation);
 const images=(await saved(f,id)).images;
 f.generation.generator=()=>({...generator(),async recommend(){throw Error('controlled failure');}});
 await control(f,id,'reprepare');
 await until(async()=>(await f.read(id)).lifecycle.faults.some(fault=>fault.stage==='prepare'));
 const render=await surfaces(),card=shelfEntry(render.shelf(await f.json('library/shelf')),id);
 assert.match(card,/重新准备失败/);assert.match(card,/接着看/);
 f.generation.generator=generator;
 await exitBoth(f,id,/^重试准备$/);
 await until(async()=>(await f.read(id)).lifecycle.preparationRefresh==='none');
 assert.equal((await f.read(id)).state,'completed');
 assert.deepEqual((await saved(f,id)).images,images);
});

test('a landscape set starts from saved frames while portrait production is paused and survives metadata edits',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.options.production={autoStart:false};await f.restart();
 const db=f.app.services.database;
 await db.prepare("UPDATE stories SET production_complete=0,generation_control='paused' WHERE id=?").bind(id).run();
 const {startToken}=await f.json(route);assert.ok(startToken);
 await f.json(`sessions/${id}/title`,'POST',{title:'改名后的故事'});
 const started=await f.app.services.production.startLandscape(f.app.services.ownerId,id,{startToken},()=>
  f.json(`sessions/${id}/publication`,'POST',{expected:null,publication:{...emptyPublication,author:'新署名'}}));
 assert.ok(started.printId);
 assert.equal(started.state,'running');
 const events=async()=>(await f.read(id)).lifecycle.actions.map(action=>action.event);
 assert.ok(!(await events()).includes('start-landscape'));
 f.control.hold=false;f.control.beforeImage=call=>{if(call.landscape&&call.page===1)throw Error('受控横图失败');};
 f.app.startGeneration();await until(async()=>!!(await f.json(route)).retryToken);
 assert.ok((await events()).includes('retry-landscape'));
 assert.equal((await f.read(id)).generationControl,'paused');
 assert.ok(f.control.calls.every(call=>call.landscape&&call.reference));
 const [print]=(await saved(f,id)).landscapePrints;
 assert.equal(print.story.title,'改名后的故事');assert.equal(print.story.publication.author,'新署名');
});

test('a temporary read failure offers a recheck of the same landscape set',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const original=await f.json(route),key=referenceImageKey(id,original.images[2]);
 const media=f.app.services.media,get=media.get.bind(media);
 media.get=async name=>{if(name===key)throw Error('介质暂不可读');return get(name);};
 try{
  const partial=await f.json(route);
  assert.ok(partial.readUnavailable);assert.equal(partial.retryToken,undefined);assert.equal(partial.startToken,undefined);
  assert.equal((await f.request(route,'POST',{startToken:original.startToken})).status,409);
  assert.ok(!(await f.read(id)).lifecycle.actions.some(action=>action.event==='start-landscape'));
 }finally{media.get=get;}
 const recovered=await f.json(route);
 assert.equal(recovered.state,'completed');assert.equal(recovered.printId,original.printId);
 assert.equal(f.control.calls.length,4);
});

test('an older landscape set retries page two while an unrelated portrait fault remains open',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;f.control.beforeImage=call=>{if(call.landscape&&call.page===1)throw Error('受控失败');};
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>!!(await f.json(route)).retryToken);
 const refused=await f.request(`sessions/${id}/export?layout=landscape`);
 assert.equal(refused.status,409);assert.deepEqual((await refused.json()).missingPages,[2]);
 const {retryToken}=await f.json(route),img=(await f.read(id)).story.pages[3].image;
 await f.media.remove(referenceImageKey(id,img));await f.json(`sessions/${id}/image-health`,'POST',{page:3,image:img});
 assert.equal((await f.read(id)).state,'failed');
 await control(f,id,'pause');
 assert.equal((await f.json(route)).retryToken,retryToken);
 assert.equal((await f.json(route)).startToken,undefined);
 f.control.beforeImage=null;const count=f.control.calls.length;
 await f.json(route,'POST',{retryToken});
 await until(()=>f.control.calls.length>count);
 await until(async()=>!(await f.json(route)).failed.includes(2)&&(await f.json(route)).images[1]);
 assert.equal((await f.json(route)).ready,4);
 assert.deepEqual((await f.json(`sessions/${id}/export?layout=landscape`)).images,(await f.json(route)).images);
 assert.deepEqual(f.control.calls.slice(count).map(call=>[call.page,call.landscape]),[[1,true]]);
 const portrait=await f.read(id);assert.equal(portrait.state,'failed');assert.equal(portrait.generationControl,'paused');
});

test('a landscape start verifies saved portraits before queueing and accepts a restored reference independently',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),base='sessions/'+id,route=base+'/landscape';
 const initial=await f.read(id),image=initial.story.pages[3].image,key=referenceImageKey(id,image),asset=await f.media.get(key);
 const {startToken}=await f.json(route);
 const store=f.app.services.media,get=store.get.bind(store);
 store.get=async name=>{if(name===key)throw Error('受控读取失败');return get(name);};
 try{
  const blocked=await f.json(route);assert.match(blocked.referenceError,/第 4 幅/);assert.equal(blocked.startToken,undefined);
  assert.equal((await f.request(route,'POST',{startToken})).status,503);
 }finally{store.get=get;}
 await f.media.remove(key);
 const refused=await f.request(route,'POST',{startToken});
 assert.equal(refused.status,409);assert.match((await refused.json()).error,/第 4 幅/);
 assert.equal((await f.json(route)).startToken,undefined);
 assert.equal((await saved(f,id)).landscapePrints,undefined);assert.equal(f.control.calls.length,0);
 await f.json(base+'/image-health','POST',{page:3,image});
 await f.media.put(key,asset.body,{contentType:asset.contentType});
 const portraitState=await f.read(id);
 assert.equal((await f.json(route)).startToken,startToken);
 assert.ok((await f.read(id)).lifecycle.actions.some(action=>action.event==='start-landscape'));
 f.control.hold=false;
 await f.json(route,'POST',{startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const after=await f.read(id);
 assert.equal(after.state,portraitState.state);assert.deepEqual(after.faults,portraitState.faults);
 assert.equal(f.control.calls.length,4);assert.ok(f.control.calls.every(call=>call.landscape&&call.reference));
});

test('late pause is refused and retry of a previously paused terminal print runs immediately',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route='sessions/'+id+'/landscape';
 const {printId,controlAction}=await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 assert.equal(controlAction,'pause');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>(await f.json(route)).state==='completed');
 const done=await f.json(route);
 assert.equal((await f.request(route,'POST',{printId,control:'pause'})).status,409);
 assert.equal((await f.json(route)).control,'active');
 const db=f.app.services.database;
 await db.prepare("UPDATE stories SET document=json_set(document,'$.landscapePrints[#-1].control','paused') WHERE id=?").bind(id).run();
 await f.media.remove(referenceImageKey(id,done.images[2]));
 const {retryToken}=await f.json(route);
 assert.equal((await f.json(route,'POST',{retryToken})).control,'active');
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.slice(4).map(call=>call.page),[2]);
});

test('landscape PDF and Letter require a complete set for the latest saved pages after a replan',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),child=await fork(f,id,{length:3});
 const base='sessions/'+child,route=base+'/landscape';
 f.control.hold=false;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const completed=await f.json(route);
 assert.equal(completed.images.length,4);
 const exact=layout=>base+`/export?layout=${layout}&setId=${completed.printId}`;
 const beforeRevision=await f.json(exact('landscape'));
 assert.equal(beforeRevision.mark.revision,undefined);
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 const latest=await f.read(child),db=f.app.services.database;
 const capture=()=>Promise.all(['stories','production_jobs','reader_commands','production_faults'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY '+(table==='production_faults'?'id':'rowid')).all()));
 const before=await capture(),calls=f.control.calls.length;
 const status=await f.json(route);assert.equal(status.state,'completed');assert.equal(status.matchesSavedPages,false);assert.ok(status.startToken);
 for(const layout of ['landscape','letter']){
  const refused=await f.request(`sessions/${id}/export?layout=${layout}`);
  assert.equal(refused.status,409);
  const result=await refused.json();
  assert.equal(result.id,child);assert.deepEqual(result.missingPages,[1,2,3]);
  const historical=await f.json(exact(layout));
  assert.equal(historical.story.id,beforeRevision.story.id);
  assert.equal(historical.mark.revision,beforeRevision.story.revision);
  assert.deepEqual(historical.images,beforeRevision.images);
  assert.deepEqual(historical.story.pages,beforeRevision.story.pages);
 }
 const source=await f.json('sessions/'+id+'/export');
 assert.equal(source.id,child);assert.deepEqual(source.story.pages,latest.story.pages);
 assert.deepEqual(await capture(),before);assert.equal(f.control.calls.length,calls);
});

test('saved landscape sets align with current page order, including sets created before frame keys were recorded',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),base='sessions/'+id,route=base+'/landscape';
 f.control.hold=false;await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const original=(await f.json(route)).images,doc=await saved(f,id),db=f.app.services.database;
 const order=[1,2,0,3];
 doc.dag.order=order.map(index=>doc.dag.order[index]);doc.images=order.map(index=>doc.images[index]);doc.plan.pages=order.map(index=>doc.plan.pages[index]);
 for(const old of [false,true]){
  if(old)delete doc.landscapePrints[0].frameKeys;
  await db.prepare('UPDATE stories SET document=? WHERE id=?').bind(JSON.stringify(doc),id).run();
  const source=await f.json(base+'/export?layout=landscape');
  assert.equal((await f.json(route)).matchesSavedPages,true);
  assert.deepEqual(source.images,order.map(index=>original[index]));assert.deepEqual(source.story.pages.map(page=>page.image),doc.images);
  const replaced=structuredClone(doc);
  if(old)replaced.dag.frames[replaced.dag.order[0]].visual+=' 改为全新的画面。';
  else{
   const [previous]=replaced.dag.order,replacement=crypto.randomUUID();
   replaced.dag.frames[replacement]=replaced.dag.frames[previous];
   replaced.dag.order[0]=replacement;
  }
  await db.prepare('UPDATE stories SET document=? WHERE id=?').bind(JSON.stringify(replaced),id).run();
  const refused=await f.request(base+'/export?layout=landscape');
  assert.equal(refused.status,409);assert.deepEqual((await refused.json()).missingPages,[1,2,3,4]);
 }
});

test('landscape retry disappears from the reader and shelf when its failed page lacks its required portrait',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),base='sessions/'+id,route=base+'/landscape';
 f.control.hold=false;f.control.beforeImage=call=>{if(call.landscape&&call.page===1)throw Error('受控横图失败');};
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>!!(await f.json(route)).retryToken);
 const img=(await f.read(id)).story.pages[1].image;
 await f.media.remove(referenceImageKey(id,img));await f.json(base+'/image-health','POST',{page:1,image:img});
 assert.equal((await f.json(route)).retryToken,undefined);
 for(const session of [await f.read(id),(await f.json('library/shelf')).find(row=>row.id===id)]){
  assert.ok(!session.lifecycle.actions.some(action=>action.event==='retry-landscape'));
 }
});

test('a landscape retry validates only the saved references needed for redraw before authorizing the batch',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route='sessions/'+id+'/landscape';
 f.control.hold=false;f.control.beforeImage=call=>{if(call.landscape&&[1,3].includes(call.page))throw Error('受控失败');};
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>!!(await f.json(route)).retryToken);
 const {retryToken}=await f.json(route),images=(await saved(f,id)).images;
 const key=referenceImageKey(id,images[3]),asset=await f.media.get(key);
 await f.media.remove(key);f.control.beforeImage=null;
 const db=f.app.services.database,before=await db.prepare('SELECT * FROM production_jobs WHERE session_id=? ORDER BY id').bind(id).all(),calls=f.control.calls.length;
 const withheld=await f.json(route);
 assert.equal(withheld.retryToken,undefined);assert.match(withheld.referenceError,/第 4 幅/);
 assert.ok(!(await f.read(id)).lifecycle.actions.some(action=>action.event==='retry-landscape'));
 const refused=await f.request(route,'POST',{retryToken});
 assert.equal(refused.status,409);assert.match((await refused.json()).error,/第 4 幅/);
 assert.deepEqual(await db.prepare('SELECT * FROM production_jobs WHERE session_id=? ORDER BY id').bind(id).all(),before);
 assert.equal(f.control.calls.length,calls);
 await f.media.put(key,asset.body,{contentType:asset.contentType});await f.media.remove(referenceImageKey(id,images[0]));
 assert.equal((await f.json(route)).retryToken,retryToken);
 await f.json(route,'POST',{retryToken});await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.slice(calls).map(call=>call.page).sort(),[1,3]);
});

test('retrying a damaged completed print set runs even when portrait production is paused',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),base='sessions/'+id,route=base+'/landscape';
 f.control.hold=false;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const landscape=(await f.json(route)).images,portrait=(await f.read(id)).story.pages[0].image;
 await f.media.remove(referenceImageKey(id,portrait));await f.json(base+'/image-health','POST',{page:0,image:portrait});
 await control(f,id,'pause');await f.media.remove(referenceImageKey(id,landscape[2]));
 const before=await f.read(id),{retryToken}=await f.json(route);assert.ok(retryToken);
 const retry=await f.json(route,'POST',{retryToken});assert.equal(retry.control,'active');
 await until(async()=>(await f.json(route)).state==='completed');
 const after=await f.read(id);assert.equal(after.generationControl,'paused');assert.deepEqual(after.faults,before.faults);
 assert.deepEqual(f.control.calls.slice(4).map(call=>call.page),[2]);
});


test('an authorized landscape print finishes from a restored saved portrait while its portrait fault stays open',async t=>{
 const f=await productionFixture(t);f.options.production={autoStart:false};await f.restart();
 const {id}=await completedStory(f,{length:4}),base='sessions/'+id,route=base+'/landscape';
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 const image=(await saved(f,id)).images[3],key=referenceImageKey(id,image),asset=await f.media.get(key);
 await f.media.remove(key);await f.json(base+'/image-health','POST',{page:3,image});
 await f.media.put(key,asset.body,{contentType:asset.contentType});
 const before=await f.read(id);assert.equal(before.state,'failed');
 f.control.hold=false;f.app.startGeneration();await until(async()=>(await f.json(route)).state==='completed');
 const after=await f.read(id);assert.equal(after.state,'failed');assert.deepEqual(after.faults,before.faults);
 assert.deepEqual(f.control.calls.map(call=>call.page).sort(),[0,1,2,3]);assert.ok(f.control.calls.every(call=>call.landscape&&call.reference));
});

test('shelf polling reports a fault that changes no story row',async t=>{
 // 书架复用未变化故事的推导；只新增故障时仍须报告变化。
 const f=await productionFixture(t);f.control.hold=false;
 const id=await f.create(4);
 await until(async()=>(await f.read(id)).state==='completed');
 const db=f.app.services.database;
 const before=(await f.json('library/shelf')).find(row=>row.id===id);
 assert.deepEqual(await f.json('library/shelf','POST',[[id,before.version]]),{changed:[],removed:[]});
 const story=await db.prepare('SELECT user_id,document FROM stories WHERE id=?').bind(id).first();
 const key=JSON.parse(story.document).dag.order[0],now=Date.now();
 await db.prepare(`INSERT INTO production_faults(id,session_id,owner_id,job_id,kind,node,node_key,input_hash,origin_fault_id,optional,version,image,message,state,command_id,created_at,updated_at)
  VALUES(?,?,?,NULL,'image-loss','frameImage',?,NULL,NULL,0,'current',NULL,'受控丢图','pending',NULL,?,?)`).bind(crypto.randomUUID(),id,story.user_id,key,now,now).run();
 const {changed:[after]}=await f.json('library/shelf','POST',[[id,before.version]]);
 assert.ok(after,'新增故障后书架应返回变化');
 assert.notEqual(after.version,before.version);
});
