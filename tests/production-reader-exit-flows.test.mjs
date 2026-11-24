// 读者出口的端到端核对：用正式应用和受控模型把故事放进需要读者处理的状态，
// 渲染故事设置和书架的实际界面，取出界面给出的操作，调用对应的正式接口，确认服务端接受且故事继续向前。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,selection,until} from './fixtures/production.mjs';
import {completedStory,confirmedStory} from './fixtures/production-dag-story.mjs';
import {enabledActions,shelfEntry,surfaces} from './fixtures/reader-surfaces.mjs';

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
 return session;
}

test('each reader-facing waiting state exposes the same action on every surface, and that action moves the story on',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;

 // 修订已保存，等待继续。
 const original=(await completedStory(f)).id,snapshot=await f.json(`sessions/${original}/revisions`);
 const plan=structuredClone(snapshot.plan);plan.pages[1].caption='核对用修改：第二幅配文。';
 const revision=crypto.randomUUID();
 await f.json(`sessions/${original}/revisions`,'POST',{requestId:revision,token:snapshot.token,changes:{plan}});
 await exitBoth(f,revision,/^继续制作$/);
 await until(async()=>(await f.read(revision)).state==='completed',20000);

 // 某一步失败，等待重试。
 let failing=true;f.control.beforeText=async name=>{if(name==='visual'&&failing)throw Error('controlled failure');};
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
 await exitBoth(f,refreshed,/^恢复生成$/);
 await until(async()=>(await f.read(refreshed)).lifecycle.preparationRefresh==='none',20000);
});

const revisionCases=[
 {call:'visual',requirements:['第一条要求。','第二条要求。'],changes:{acceptancePrompt:'另一条要求。'},retained:4},
 {call:'registerItems',requirements:['第一条要求。','第二条要求。'],changes:{artStyle:'watercolor'},retained:2},
 {call:'registerItems',requirements:['第一条要求。','第二条要求。','第三条要求。'],changes:{acceptancePrompt:'第一条要求。\n改写后的要求。'},retained:1,newItems:['改写后的要求。']},
];

for(const {call,requirements,changes,retained,newItems} of revisionCases){
 test(`a revision blocks ${retained} surviving ${call} targets until one explicit recovery`,async t=>{
  const f=await productionFixture(t);
  f.control.hold=false;
  f.control.beforeText=async name=>{if(name===call)throw Error('受控步骤故障');};
  const id=await confirmedStory(f,4,{}, {acceptancePrompt:requirements.join('\n')});
  f.app.services.production.wake();
  await until(async()=>(await f.read(id)).state==='failed');
  const [failed]=(await f.read(id)).lifecycle.faults;
  assert.equal(failed.targets.length,call==='visual'?4:requirements.length);
  await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
  const {token}=await f.json(`sessions/${id}/revisions`);
  const preview=await f.json(`sessions/${id}/revisions/preview`,'POST',{token,changes});
  assert.equal(preview.carriedFaults,retained);
  const child=crypto.randomUUID(),route=`sessions/${child}`;
  await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token,changes});
  const [carried]=(await f.read(child)).lifecycle.faults;
  assert.deepEqual(carried.targets.map(target=>target.key).sort(),failed.targets.slice(0,retained).map(target=>target.key).sort());
  assert.ok(carried.targets.every(target=>target.node===failed.targets[0].node));
  const batches=[];
  f.control.beforeText=async(name,payload)=>{if(name===call)batches.push(payload.items?.map(item=>item.text)??payload.frames.map(frame=>frame.number));};
  await f.json(route+'/production-control','POST',{action:'continue'});
  await f.restart();
  for(let n=0;n<8;n++){
   await f.app.services.production.tick();
   await f.app.services.production.queue.settle();
  }
  assert.deepEqual(batches,newItems?[newItems]:[]);
  const blocked=await f.read(child);
  assert.equal(blocked.state,'failed');
  assert.equal(blocked.lifecycle.activity.state,'idle');
  assert.deepEqual(blocked.lifecycle.faults,[carried]);
  assert.deepEqual(blocked.lifecycle.actions.filter(action=>action.event==='retry'),[{event:'retry',faultId:carried.id}]);
  const recovery={requestId:crypto.randomUUID(),faultId:carried.id};
  await f.json(route+'/recover','POST',recovery);
  await f.json(route+'/recover','POST',recovery);
  await until(async()=>(await f.read(child)).state==='completed');
  assert.deepEqual(batches.at(-1),call==='visual'?[1,2,3,4]:requirements.slice(0,retained));
  assert.equal(batches.length,newItems?2:1);
  for(const session of [await f.read(child),(await f.json('library/shelf')).find(session=>session.id===child)]){
   assert.equal(session.state,'completed');
   assert.equal(session.ready,4);
   assert.equal(session.lifecycle.review,'approved');
   assert.deepEqual(session.lifecycle.faults,[]);
  }
 });
}

test('a saved recommendation with a lost receipt settles on restart without another model call',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。'}],note:''});
 const {id}=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto'}});
 const route=`sessions/${id}`;
 await f.startDiscovery(id);
 await f.demand(id);
 await until(async()=>(await f.read(id)).intake.batches.length===1);
 const {generation}=(await f.read(id)).intake;
 await f.json(route+'/setup','POST',{action:'choose',generation,batch:0,index:0,requestId:crypto.randomUUID()});
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 await f.app.services.production.queue.settle();
 const before=await f.read(id);
 const savedUsage=async()=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document).usage;
 const usage=await savedUsage();
 const job=await f.app.services.database.prepare("SELECT id FROM production_jobs WHERE session_id=? AND state='succeeded' AND json_extract(payload,'$.work.call')='prepareSuggestions'").bind(id).first();
 const queue=()=>f.app.services.production.queue;
 await queue().rerun(job.id);
 assert.equal((await queue().job(job.id)).state,'queued');
 await f.restart();
 await until(async()=>(await queue().job(job.id))?.state==='succeeded');
 const after=await f.read(id),shelf=(await f.json('library/shelf')).find(session=>session.id===id);
 assert.equal((await queue().job(job.id)).attempts,0);
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

test('settings and shelf expose landscape pause, which drains sent work and holds the last drawing until resume',async t=>{
 const f=await productionFixture(t);
 const {id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 const portraits=(await f.read(id)).story.pages.map(page=>page.image);
 const {startToken}=await f.json(route);
 const started=await f.json(route,'POST',{startToken});
 assert.equal(started.controlAction,'pause');
 await until(()=>f.control.calls.length===3);
 await exitBoth(f,id,/^暂停生成$/,true);
 f.control.hold=false;
 for(const call of f.control.calls)call.resolve();
 await until(async()=>(await f.json(route)).ready===3);
 await f.app.services.production.tick();
 assert.equal(f.control.calls.length,3);
 assert.equal((await f.json(route)).controlAction,'resume');
 assert.equal((await f.read(id)).state,'completed');
 assert.deepEqual((await f.read(id)).story.pages.map(page=>page.image),portraits);
 await exitBoth(f,id,/^恢复生成$/,true);
 await until(async()=>(await f.json(route)).state==='completed');
 assert.equal(f.control.calls.length,4);
 assert.ok(f.control.calls.every(call=>call.landscape));
 assert.equal((await f.json(route)).controlAction,undefined);
});
