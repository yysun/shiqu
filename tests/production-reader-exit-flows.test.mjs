// 读者出口的端到端核对：用正式应用和受控模型把故事放进需要读者处理的状态，
// 渲染故事设置和书架的实际界面，取出界面给出的操作，调用对应的正式接口，确认服务端接受且故事继续向前。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,selection,until} from './fixtures/production.mjs';
import {completedStory,confirmedStory,saved,savedSelection} from './fixtures/production-dag-story.mjs';
import {enabledActions,shelfEntry,surfaces} from './fixtures/reader-surfaces.mjs';
import {evaluate} from '../lib/production-dag/engine.ts';
import {stateOf} from '../lib/production-dag/runner.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {readableLandscapeImage} from '../server/reader-image-health.ts';
import {createStoryPdf} from '../lib/reader-pdf.ts';
import {nativeExportRuntime} from '../server/story-export.ts';

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

for(const changedStyle of [false,true])test(`replanning ${changedStyle?'releases changed':'blocks matching'} drawing inputs`,async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 f.control.beforeImage=call=>{if(call.page===0)throw Error('受控绘图失败');};
 const id=await confirmedStory(f);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='failed');
 const original=(await f.read(id)).lifecycle.faults[0].targets[0];
 await control(f,id,'pause');
 const child=await fork(f,id,{narrativeDetail:'detailed',...(changedStyle?{artStyle:'watercolor'}:{})});
 const unresolved=(await f.read(child)).lifecycle.faults[0];
 assert.equal(unresolved.state,'awaiting-match');
 assert.deepEqual(unresolved.targets,[original]);
 f.control.beforeImage=null;
 await control(f,child,'continue');
 await f.restart();
 await drain(f);
 if(changedStyle){
  assert.equal((await f.read(child)).state,'completed');
  assert.equal(f.control.calls.filter(call=>call.page===0).length,2);
 }else{
  const [blocked]=(await f.read(child)).lifecycle.faults;
  assert.equal(blocked.state,'pending');
  assert.deepEqual(blocked.targets,[original]);
  assert.equal(f.control.calls.length,1);
  await f.json(`sessions/${child}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:blocked.id});
  await until(async()=>(await f.read(child)).state==='completed');
  assert.equal(f.control.calls.filter(call=>call.page===0).length,2);
 }
 assert.deepEqual((await f.read(child)).lifecycle.faults,[]);
});

for(const [targetPages,paid] of [[[0],false],[[1],false],[[1,2],true]])test(`changing length from four to five preserves drawing faults at new pages ${targetPages.map(page=>page+1).join(', ')}`,async t=>{
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
 const savedFault=(await f.read(child)).lifecycle.faults[0];
 assert.equal(savedFault.state,'awaiting-match');
 f.control.beforeImage=null;
 if(!targetPages.includes(0))f.control.beforeText=(call,payload)=>call==='visual'?{frames:payload.frames.map(({number})=>({number,
  prompt:`第 ${targetPages.includes(number-1)?1:number===1?2:number} 幅：成年的庄周身着布衣，坐在柳树下沉思，中景，晨光柔和。`,drawn:['庄周']}))}:undefined;
 await control(f,child,'continue');
 await f.restart();
 await drain(f);
 const doc=await saved(f,child),snapshot=await f.read(child),[fault]=snapshot.lifecycle.faults;
 assert.equal(doc.dag.order.length,5);
 assert.ok(!doc.dag.order.includes(first));
 for(const page of targetPages)assert.deepEqual(await hard(child,page),original);
 assert.equal(fault.id,savedFault.id);
 assert.equal(fault.state,'pending');
 assert.deepEqual(fault.targets,targetPages.map(page=>({node:'frameImage',key:doc.dag.order[page],page})));
 const count=targetPages.includes(0)?1:0;
 assert.equal(f.control.calls.filter(call=>targetPages.includes(call.page)).length,count);
 if(paid){
  f.options.production={autoStart:false,snapshots:{current:()=>undefined,provider:()=>null}};
  await f.restart();
  f.generation.status=async()=>({configured:false,message:'受控未配置'});
 }
 const recovered=await f.json(`sessions/${child}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 if(paid)assert.equal(recovered.state,'completed');
 await until(async()=>(await f.read(child)).state==='completed');
 assert.equal(f.control.calls.filter(call=>targetPages.includes(call.page)).length,paid?count:count+1);
 if(paid){
  const complete=await saved(f,child);
  assert.equal(complete.images[targetPages[0]],complete.images[targetPages[1]]);
  assert.equal(complete.usage.filter(entry=>entry.step==='dag:draw'&&entry.originId===id).length,1);
 }
});

for(const legacy of [false,true])test(`a revision keeps the failed landscape retry ${legacy?'after a legacy false success':'when generic recovery is rejected'}`,async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4});
 f.control.hold=false;
 const make=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>{
  const generator=make();
  return {...generator,async image(...args){
   if(args[1]===2)throw Error('CONTENT_BLOCKED');
   return generator.image(...args);
  }};
 };
 const route=`sessions/${id}/landscape`;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>!!(await f.json(route)).retryToken);
 const child=await fork(f,id,{acceptancePrompt:'核对画面动作。'});
 f.generation.generator=make;
 if((await f.read(child)).lifecycle.continuation)await control(f,child,'continue');
 await f.restart();
 await drain(f);
 const current=`sessions/${child}/landscape`,status=await f.json(current);
 assert.deepEqual([status.state,status.ready,status.failed,status.controlAction],['partial',3,[3],undefined]);
 const snapshot=await f.read(child);
 assert.equal(snapshot.state,'completed');
 assert.equal(snapshot.ready,4);
 assert.equal(snapshot.lifecycle.activity.state,'idle');
 assert.ok(snapshot.lifecycle.actions.some(action=>action.event==='retry-landscape'));
 assert.ok(status.retryToken);
 const [fault]=snapshot.lifecycle.faults.filter(fault=>fault.scope==='optional');
 assert.equal(fault.retryAllowed,false);
 const requestId=crypto.randomUUID(),db=f.app.services.database;
 const generic=await f.request(`sessions/${child}/recover`,'POST',{requestId,faultId:fault.id});
 assert.equal(generic.status,409);
 assert.match((await generic.json()).error,/横版插图步骤/);
 assert.equal(await db.prepare('SELECT status FROM reader_commands WHERE request_id=?').bind(requestId).first(),null);
 if(legacy){
  const now=Date.now();
  await db.prepare(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,status,created_at,updated_at)
   SELECT ?,owner_id,session_id,'recover','legacy','{}',id,'succeeded',?,? FROM reader_faults WHERE id=?`).bind(requestId,now,now,fault.id).run();
  await db.prepare("UPDATE reader_faults SET state='resolved',command_id=? WHERE id=?").bind(requestId,fault.id).run();
 }
 await f.restart();
 await f.demand(child);
 await drain(f);
 const retained=await f.json(current),stillFailed=await f.read(child);
 assert.deepEqual([retained.state,retained.ready,retained.failed,retained.retryToken],['partial',3,[3],status.retryToken]);
 assert.equal(stillFailed.lifecycle.faults.find(target=>target.id===fault.id).state,'pending');
 assert.equal(stillFailed.lifecycle.activity.state,'idle');
 const before=f.control.calls.length;
 await f.json(current,'POST',{retryToken:retained.retryToken});
 await until(async()=>(await f.json(current)).state==='completed');
 assert.deepEqual(f.control.calls.slice(before).map(call=>[call.page,call.landscape]),[[2,true]]);
 assert.equal((await f.read(child)).lifecycle.faults.length,0);
 if(legacy)assert.equal((await f.app.services.database.prepare('SELECT status FROM reader_commands WHERE request_id=?').bind(requestId).first()).status,'succeeded');
});

for(const artStyle of [true,false])test(`ordinary ${artStyle?'style change':'single-frame redraw'} leaves stale landscapes out of PDF and requires a new request`,async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4});
 f.control.hold=false;
 const route=`sessions/${id}/landscape`;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 const parentStatus=await f.json(route),hidden=referenceImageKey(id,parentStatus.images[0]);
 const media=f.app.services.media,get=media.get.bind(media);
 media.get=async key=>{if(key===hidden)throw Error('受控横图读取中断');return get(key);};
 const temporary=await f.json(route);
 assert.deepEqual([temporary.state,temporary.ready,temporary.failed,temporary.images[0]],['partial',3,[],'']);
 assert.equal(temporary.startToken??temporary.retryToken,undefined);
 media.get=get;
 const afterParent=f.control.calls.length;
 const child=await fork(f,id,artStyle?{artStyle:'watercolor'}:{redrawPages:[2],redrawNotes:{'2':'背景改成雨夜。'}});
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 await f.restart();
 await f.demand(child);
 await drain(f);
 const current=`sessions/${child}/landscape`,status=await f.json(current),session=await f.read(child);
 const stale=artStyle?[0,1,2,3]:[1];
 assert.equal(status.ready,4-stale.length);
 assert.equal(status.state,artStyle?'idle':'partial');
 assert.deepEqual(status.failed,[]);
 assert.deepEqual(status.images.flatMap((url,page)=>url?[]:[page]),stale);
 assert.ok(status.startToken);
 assert.equal(status.retryToken,undefined);
 assert.equal(session.lifecycle.optionalWork,false);
 assert.ok(session.lifecycle.actions.some(action=>action.event==='start-landscape'));
 assert.equal(f.control.calls.slice(afterParent).filter(call=>call.landscape).length,0);
 const doc=await saved(f,child);
 const engine=evaluate(stateOf({id:child,doc,dag:doc.dag,selection:await savedSelection(f,child),confirmed:true,faults:[]}));
 for(const page of stale){
  const key=doc.dag.order[page];
  assert.ok(doc.dag.frames[key].landscape,'旧地址仍可从旧书库字段读到');
  assert.equal(engine.instance('landscape',key).status,'invalid');
 }
 if(artStyle)for(const layout of ['landscape','letter']){
  const runtime=nativeExportRuntime(process.cwd(),f.app),read=runtime.read,sources=new Set();
  runtime.read=(source,page)=>{sources.add(source);return read(source,page);};
  const pdf=await createStoryPdf(session.story,()=>{},runtime,layout,status.images);
  assert.equal(Buffer.from(pdf).subarray(0,5).toString(),'%PDF-');
  assert.deepEqual(sources,new Set(session.story.pages.map(page=>page.image)));
 }
 const db=f.app.services.database,coordinator=f.app.services.production;
 const row=await db.prepare('SELECT * FROM stories WHERE id=?').bind(child).first(),historical=await coordinator.dag.story(row,'skip');
 for(const page of stale)historical.dag.frames[historical.dag.order[page]].landscape='';
 const [failed,queued]=coordinator.dag.specs(row,historical).filter(spec=>spec.payload.work.call==='drawLandscape');
 await coordinator.queue.enqueue(failed);
 const now=Date.now(),target=failed.payload.work.instances[0].key;
 await db.prepare("UPDATE production_jobs SET state='failed',error='旧版派发失败' WHERE id=?").bind(failed.id).run();
 await db.prepare(`INSERT INTO reader_faults(id,session_id,owner_id,job_id,kind,node,node_key,version,message,created_at,updated_at)
  VALUES(?,?,?,?,'job','landscape',?,'dag','旧版派发失败',?,?)`).bind(crypto.randomUUID(),child,row.user_id,failed.id,target,now,now).run();
 if(queued)await coordinator.queue.enqueue(queued);
 const paid=f.control.calls.length;
 await f.json(current,'POST',{startToken:status.startToken});
 await until(async()=>(await f.json(current)).state==='completed');
 assert.deepEqual(f.control.calls.slice(paid).map(call=>call.page).sort((a,b)=>a-b),stale);
 assert.ok(f.control.calls.slice(paid).every(call=>call.landscape));
 assert.equal((await coordinator.queue.job(failed.id)).state,'failed');
 assert.equal((await f.read(child)).lifecycle.faults.length,0);
});

test('an inherited unfinished landscape request only authorizes its original drawing inputs',async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4});
 const route=`sessions/${id}/landscape`;
 f.control.hold=false;
 const media=f.app.services.media,get=media.get.bind(media);
 media.get=key=>key.startsWith(`reader/${id}/artifacts/2-`)?Promise.resolve(null):get(key);
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>{
  const status=await f.json(route);
  return status.ready===3&&status.failed.includes(3)&&!!status.retryToken;
 });
 await drain(f);
 media.get=get;
 const faulted=await saved(f,id),key=faulted.dag.order[2];
 assert.equal(faulted.dag.frames[key].landscape,'');
 assert.ok(faulted.dag.frames[key].landscapeError);
 const unchanged=await fork(f,id,{acceptancePrompt:'核对画面动作。'});
 await control(f,unchanged,'continue');
 await until(async()=>(await f.read(unchanged)).state==='completed');
 assert.deepEqual((await f.json(`sessions/${unchanged}/landscape`)).failed,[3]);
 const before=f.control.calls.length;
 const child=await fork(f,unchanged,{artStyle:'watercolor'});
 await control(f,child,'continue');
 await until(async()=>(await f.read(child)).state==='completed');
 const doc=await saved(f,child);
 assert.ok(doc.dag.frames[key].landscapeInputHash);
 delete doc.dag.frames[key].landscapeInputHash;
 await f.app.services.database.prepare('UPDATE stories SET document=? WHERE id=?').bind(JSON.stringify(doc),child).run();
 await f.restart();
 await f.demand(child);
 await drain(f);
 const status=await f.json(`sessions/${child}/landscape`);
 assert.deepEqual([status.state,status.ready,status.failed,status.retryToken],['idle',0,[],undefined]);
 assert.ok(status.startToken);
 assert.equal(f.control.calls.slice(before).filter(call=>call.landscape).length,0);
});

for(const stale of [true,false])test(`confirmed reader redraw ${stale?'ignores an obsolete landscape':'preserves Retry after a paired landscape fails'}`,async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4});
 f.control.hold=false;
 const route=`sessions/${id}/landscape`;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>(await f.json(route)).state==='completed');
 let source=id;
 if(stale){
  source=await fork(f,id,{artStyle:'watercolor'});
  await control(f,source,'continue');
  await until(async()=>(await f.read(source)).state==='completed');
 }else f.control.beforeImage=call=>{if(call.landscape&&call.page===1)throw Error('受控横图失败');};
 const revisions=`sessions/${source}/revisions`,{token}=await f.json(revisions),child=crypto.randomUUID(),before=f.control.calls.length;
 await f.json(revisions,'POST',{requestId:child,token,changes:{redrawPages:[2],redrawNotes:{'2':'雨夜。'}},startRedraw:true});
 await until(async()=>(await f.read(child)).state==='completed');
 const path=`sessions/${child}/landscape`;
 if(stale){
  await drain(f);
  assert.ok((await f.json(path)).startToken);
  assert.deepEqual(f.control.calls.slice(before).map(call=>[call.page,call.landscape]),[[1,false]]);
 }else{
  await until(async()=>!!(await f.json(path)).retryToken);
  assert.deepEqual((await f.json(path)).failed,[2]);
  assert.deepEqual(f.control.calls.slice(before).map(call=>[call.page,call.landscape]),[[1,false],[1,true]]);
  await f.restart();
  f.control.beforeImage=null;
  await f.json(path,'POST',{retryToken:(await f.json(path)).retryToken});
  await until(async()=>(await f.json(path)).state==='completed');
  assert.deepEqual(f.control.calls.slice(before).map(call=>[call.page,call.landscape]),[[1,false],[1,true],[1,true]]);
 }
});

for(const receiptState of ['first read failed','previously published','lost acknowledgement','invalid landscape'])test(`landscape retry verifies the ${receiptState} receipt before paying`,async t=>{
 const f=await productionFixture(t),{id}=await completedStory(f,{length:4}),route=`sessions/${id}/landscape`;
 f.control.hold=false;
 const media=f.app.services.media,get=media.get.bind(media);
 const prefix=`reader/${id}/artifacts/2-`;
 let missing=receiptState==='first read failed'?Infinity:0,sourceKey;
 media.get=async key=>{
  if(key.startsWith(prefix)&&(!sourceKey||sourceKey===key)){
   sourceKey=key;
   if(missing>0){missing--;return null;}
  }
  return get(key);
 };
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await until(async()=>{
  const status=await f.json(route);
  return receiptState==='first read failed'?!!status.retryToken:status.state==='completed';
 });
 await drain(f);
 assert.ok(sourceKey);
 const bytes=new Uint8Array(await (await get(sourceKey)).arrayBuffer());
 assert.ok(await readableLandscapeImage(bytes));
 const db=f.app.services.database,job=await db.prepare(`SELECT id,payload FROM production_jobs WHERE session_id=?
  AND json_extract(payload,'$.work.call')='drawLandscape' AND json_extract(payload,'$.page')=2`).bind(id).first();
 assert.equal(referenceImageKey(id,JSON.parse(job.payload).paid.value),sourceKey);
 if(receiptState==='first read failed')missing=0;
 if(receiptState==='previously published'||receiptState==='lost acknowledgement')missing=2;
 if(receiptState==='lost acknowledgement')await db.prepare("UPDATE production_jobs SET state='failed',result=NULL WHERE id=?").bind(job.id).run();
 if(receiptState==='invalid landscape'){
  const portrait=await get(referenceImageKey(id,(await saved(f,id)).images[2]));
  const portraitBytes=new Uint8Array(await portrait.arrayBuffer());
  assert.equal(await readableLandscapeImage(portraitBytes),false);
  await media.put(sourceKey,portraitBytes,{contentType:portrait.contentType});
 }
 const status=await f.json(route),calls=f.control.calls.length;
 assert.deepEqual(status.failed,[3]);
 await f.json(route,'POST',{retryToken:status.retryToken});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.slice(calls).map(call=>call.page),receiptState==='invalid landscape'?[2]:[]);
 if(receiptState!=='invalid landscape')assert.deepEqual(new Uint8Array(await (await get(sourceKey)).arrayBuffer()),bytes);
 assert.equal((await saved(f,id)).usage.filter(entry=>entry.step==='dag:drawLandscape').length,receiptState==='invalid landscape'?5:4);
});

test('settings and shelf offer local retry for an inherited paid portrait without a model',async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 const media=f.app.services.media,get=media.get.bind(media);
 let hidden=true;
 media.get=async key=>hidden&&key.startsWith(`reader/${id}/artifacts/1-`)?null:get(key);
 f.control.hold=false;
 f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).state==='failed');
 hidden=false;
 await control(f,id,'pause');
 const child=await fork(f,id,{acceptancePrompt:'核对画面动作。'});
 await control(f,child,'continue');
 await drain(f);
 f.options.production={autoStart:false,snapshots:{current:()=>undefined,provider:()=>null}};
 await f.restart();
 f.generation.status=async()=>({configured:false,message:'受控未配置'});
 const current=await f.read(child),[fault]=current.lifecycle.faults;
 assert.deepEqual([current.lifecycle.service,current.state,current.ready],['unconfigured','failed',1]);
 assert.ok(current.lifecycle.actions.some(action=>action.event==='retry'&&action.faultId===fault.id));
 const offlineMedia=f.app.services.media,offlineGet=offlineMedia.get.bind(offlineMedia);
 offlineMedia.get=async key=>key.startsWith(`reader/${id}/artifacts/1-`)?null:offlineGet(key);
 const before=f.control.calls.length;
 const unavailable=await f.request(`sessions/${child}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 assert.equal(unavailable.status,503);
 assert.equal((await f.read(child)).lifecycle.faults[0].id,fault.id);
 offlineMedia.get=offlineGet;
 const receipt=await exitBoth(f,child,/^重试生成$/);
 assert.deepEqual([receipt.state,receipt.ready,receipt.recoveryReceipt.status],['completed',2,'succeeded']);
 const after=await f.read(child);
 assert.deepEqual([after.state,after.ready,after.lifecycle.faults],['completed',2,[]]);
 assert.equal(f.control.calls.length,before);
});

for(const restoredAtDispatch of [false,true])test(`a revision adopts the paid artifact when readable at ${restoredAtDispatch?'dispatch':'authorization'}`,async t=>{
 const f=await productionFixture(t),id=await f.create(2);
 await until(()=>f.control.calls.length===1);
 const store=f.app.services.media,get=store.get.bind(store);
 let unavailable='missing',originKey;
 store.get=async key=>{
  if(key.startsWith(`reader/${id}/artifacts/0-`)){
   originKey=key;
   if(unavailable==='missing')return null;
   if(unavailable==='once'){unavailable=null;return null;}
   if(unavailable==='temporary')throw Error('受控图片读取中断');
  }
  return get(key);
 };
 f.control.hold=false;
 f.control.calls[0].resolve();
 await until(async()=>(await f.read(id)).state==='failed');
 unavailable=null;
 await control(f,id,'pause');
 const child=await fork(f,id,{acceptancePrompt:'请核对画面动作。'});
 await control(f,child,'continue');
 await drain(f);
 assert.equal(f.control.calls.length,1,'普通继续不采用故障的付费图片，也不重新绘图');
 const fault=(await f.read(child)).lifecycle.faults[0],route=`sessions/${child}/recover`;
 const recovery={requestId:crypto.randomUUID(),faultId:fault.id};
 unavailable='temporary';
 assert.equal((await f.request(route,'POST',recovery)).status,503);
 assert.equal((await f.read(child)).lifecycle.faults[0].id,fault.id);
 unavailable=restoredAtDispatch?'once':null;
 const result=await f.json(route,'POST',recovery);
 assert.equal(result.recoveryReceipt.status,'succeeded');
 await f.json(route,'POST',recovery);
 await until(async()=>(await f.read(child)).state==='completed');
 assert.equal(f.control.calls.filter(call=>call.page===0).length,1);
 const row=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(child).first();
 const doc=JSON.parse(row.document),image=doc.images[0];
 assert.ok(image.startsWith(`/api/reader/media/${child}/`));
 assert.deepEqual(await (await get(originKey)).arrayBuffer(),await (await get(`reader/${image.slice('/api/reader/media/'.length)}`)).arrayBuffer());
 assert.equal(doc.usage.filter(item=>item.step==='dag:draw'&&item.originId===id).length,1);
 assert.equal((await f.read(id)).lifecycle.faults.length,1,'祖先版本的任务和故障不被改写');
});

test('an inherited review failure still offers and authorizes Skip Review on the complete paused draft',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 f.control.beforeText=async name=>{if(name==='review')throw Error('受控审核失败');};
 const id=await confirmedStory(f);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.some(fault=>fault.retryReview));
 const parent=await control(f,id,'pause');
 assert.ok(parent.reviewSkip);
 const child=await fork(f,id,{storySummary:'庄周醒后细想梦蝶的经历。'});
 await control(f,child,'continue');
 f.control.beforeText=null;
 await drain(f);
 const active=await f.read(child),route=`sessions/${child}/review-override`;
 const failure=active.lifecycle.faults[0],command={requestId:crypto.randomUUID(),faultId:failure.id,ending:'default'};
 assert.equal(failure.stage,'review');assert.equal(failure.targets.length,4);
 assert.equal(active.generationProgress.storyboardFrames,4);
 assert.equal((await f.request(route,'POST',command)).status,409);
 const paused=await control(f,child,'pause');
 assert.equal(paused.reviewSkip.faultId,failure.id);
 assert.equal((await f.request(route,'POST',{...command,faultId:parent.reviewSkip.faultId})).status,409);
 const skipped=await f.json(route,'POST',command);
 assert.equal(skipped.generationControl,'paused');
 assert.deepEqual(skipped.lifecycle.faults,[]);
 await f.json(route,'POST',command);
 assert.equal(f.control.calls.length,0,'跳过审核没有恢复绘图');
 await control(f,child,'resume');
 await until(async()=>(await f.read(child)).state==='completed');
 assert.equal(f.control.calls.length,4);
});

test('library update repairs old fault rows across revisions and preserves saved results and recoveries',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 const faultsFor=id=>f.app.services.database.prepare('SELECT * FROM reader_faults WHERE session_id=? ORDER BY id').bind(id).all();
 const recovery=async(id,faultId)=>
  f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId});
 async function failedParent(call){
  f.control.beforeText=async name=>{if(name===call)throw Error('受控批量故障');};
  const id=await confirmedStory(f,4,{}, {acceptancePrompt:'第一条要求。\n第二条要求。'});
  f.app.services.production.wake();
  await until(async()=>(await f.read(id)).state==='failed');
  await control(f,id,'pause');
  f.control.beforeText=null;
  return id;
 }
 const visual=await failedParent('visual'),visualTargets=(await f.read(visual)).lifecycle.faults[0].targets;
 const visualChild=await fork(f,visual,{acceptancePrompt:'另一条。'});
 const items=await failedParent('registerItems'),itemTargets=(await f.read(items)).lifecycle.faults[0].targets;
 const draft=await fork(f,items,{artStyle:'watercolor'});
 const grandchild=await fork(f,draft,{artStyle:'paper-cut'});
 const recoveredParent=await failedParent('visual');
 const recovered=await fork(f,recoveredParent,{acceptancePrompt:'另一条。'});
 await control(f,recovered,'continue');
 const recoveredFault=(await f.read(recovered)).lifecycle.faults[0];
 await recovery(recovered,recoveredFault.id);
 await until(async()=>(await f.read(recovered)).state==='completed');
 const exported=(await f.read(recovered)).story;
 const ghostParent=await failedParent('visual'),ghost=await fork(f,ghostParent,{acceptancePrompt:'另一条。'});
 await control(f,ghost,'continue');
 const ghostFault=(await f.read(ghost)).lifecycle.faults[0];
 await recovery(ghost,ghostFault.id);
 await until(async()=>(await f.read(ghost)).state==='completed');
 const ghostImages=(await f.read(ghost)).story.pages.map(page=>page.image);
 const database=f.app.services.database;
 // 模拟迁移前的格式 3 行。空键故障仅保留一行，登记故障完全遗漏，已获授权的故障保留原回执。
 const legacyId=(await faultsFor(visualChild)).results[0].id;
 await database.prepare('DELETE FROM reader_faults WHERE session_id=? AND id!=?').bind(visualChild,legacyId).run();
 await database.prepare("UPDATE reader_faults SET node_key='',input_hash=NULL,origin_fault_id=NULL,created_at=created_at+2000 WHERE id=?").bind(legacyId).run();
 for(const id of [draft,grandchild])await database.prepare('DELETE FROM reader_faults WHERE session_id=?').bind(id).run();
 await database.prepare('DELETE FROM reader_faults WHERE session_id=? AND id!=?').bind(recovered,recoveredFault.id).run();
 await database.prepare("UPDATE reader_faults SET node_key='',input_hash=NULL,origin_fault_id=NULL WHERE id=?").bind(recoveredFault.id).run();
 // 模拟旧版已重复生成且留有空键故障的作品，保留全部已生成结果。
 await database.prepare('DELETE FROM reader_faults WHERE session_id=? AND id!=?').bind(ghost,ghostFault.id).run();
 await database.prepare("UPDATE reader_faults SET node_key='',input_hash=NULL,origin_fault_id=NULL,command_id=NULL,state='pending' WHERE id=?").bind(ghostFault.id).run();
 await database.prepare("DELETE FROM reader_commands WHERE session_id=? AND action='recover' AND fault_id=?").bind(ghost,ghostFault.id).run();
 await database.prepare("UPDATE stories SET state='idle',generation_control='paused' WHERE id=?").bind(ghost).run();
 assert.equal((await f.read(ghost)).state,'failed');
 await database.prepare('DROP INDEX reader_faults_origin_job').run();
 await database.prepare("DELETE FROM app_migrations WHERE name='0027_revision_fault_targets.sql'").run();
 await f.restart();
 const sorted=targets=>targets.map(target=>target.key).sort();
 const assertion=async(id,expected)=>{
  const [fault]=(await f.read(id)).lifecycle.faults;
  assert.deepEqual(sorted(fault.targets),sorted(expected));
  return fault.id;
 };
 const visualFault=await assertion(visualChild,visualTargets);
 assert.equal((await faultsFor(visualChild)).results.find(fault=>fault.id===legacyId).state,'pending');
 await assertion(draft,itemTargets);
 const itemFault=await assertion(grandchild,itemTargets);
 assert.deepEqual((await f.read(recovered)).story.pages,exported.pages);
 assert.equal((await faultsFor(recovered)).results[0].state,'resolved');
 const repaired=await f.read(ghost);
 assert.equal(repaired.state,'completed');
 assert.equal(repaired.generationControl,'paused');
 assert.deepEqual(repaired.story.pages.map(page=>page.image),ghostImages);
 await f.restart();
 assert.equal(await assertion(visualChild,visualTargets),visualFault);
 assert.equal(await assertion(grandchild,itemTargets),itemFault);
 const count=call=>f.control.dagCalls.filter(name=>name===call).length;
 for(const [id,call,fault] of [[visualChild,'visual',legacyId],[grandchild,'registerItems',itemFault]]){
  const before=count(call);
  await control(f,id,'continue');
  await drain(f);
  assert.equal(count(call),before);
  await recovery(id,fault);
  await until(async()=>(await f.read(id)).state==='completed');
  assert.equal(count(call),before+1);
 }
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

test('migration keeps distinct legacy batches with the same failure message independently recoverable',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 f.control.beforeText=async name=>{if(name==='visual')throw Error('受控同类故障');};
 const id=await confirmedStory(f,22);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).lifecycle.faults.filter(fault=>fault.targets[0]?.node==='visual').length===2);
 const parent=(await f.read(id)).lifecycle.faults;
 assert.equal(parent[0].message,parent[1].message);
 await control(f,id,'pause');
 const child=await fork(f,id,{acceptancePrompt:'另一条。'});
 const database=f.app.services.database,legacyIds=[];
 for(const fault of parent){
  const rows=await database.prepare('SELECT id FROM reader_faults WHERE session_id=? AND origin_fault_id=? ORDER BY rowid').bind(child,fault.id).all();
  const legacy=rows.results[0].id;
  legacyIds.push(legacy);
  await database.prepare('DELETE FROM reader_faults WHERE session_id=? AND origin_fault_id=? AND id!=?').bind(child,fault.id,legacy).run();
  await database.prepare("UPDATE reader_faults SET node_key='',input_hash=NULL,origin_fault_id=NULL WHERE id=?").bind(legacy).run();
 }
 await database.prepare('DROP INDEX reader_faults_origin_job').run();
 await database.prepare("DELETE FROM app_migrations WHERE name='0027_revision_fault_targets.sql'").run();
 await f.restart();
 const repaired=(await f.read(child)).lifecycle.faults;
 const targetSets=faults=>faults.map(fault=>fault.targets.map(target=>target.key).sort().join(',')).sort();
 assert.deepEqual(targetSets(repaired),targetSets(parent));
 const before=f.control.dagCalls.filter(name=>name==='visual').length;
 f.control.beforeText=null;
 await control(f,child,'continue');
 await drain(f);
 assert.equal(f.control.dagCalls.filter(name=>name==='visual').length,before);
 await f.json(`sessions/${child}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:legacyIds[0]});
 await drain(f);
 assert.equal((await f.read(child)).lifecycle.faults.length,1);
 assert.equal(f.control.dagCalls.filter(name=>name==='visual').length,before+1);
 await f.json(`sessions/${child}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:legacyIds[1]});
 await until(async()=>(await f.read(child)).state==='completed',20000);
 assert.equal(f.control.dagCalls.filter(name=>name==='visual').length,before+2);
});
