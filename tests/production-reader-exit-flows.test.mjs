// 读者出口的端到端核对：用正式应用和受控模型把故事放进需要读者处理的状态，
// 渲染故事设置和书架的实际界面，取出界面给出的操作，调用对应的正式接口，确认服务端接受且故事继续向前。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {completedStory,confirmedStory} from './fixtures/production-dag-story.mjs';
import {enabledActions,shelfEntry,surfaces} from './fixtures/reader-surfaces.mjs';

/** 按界面操作名称调用正式接口；返回 HTTP 响应。 */
function click(f,session,label){
 const control=action=>f.request(`sessions/${session.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action});
 if(label==='继续制作'||/^重绘第 \d+ 幅$/.test(label))return control('continue');
 if(label==='恢复生成'||label==='恢复准备')return control('resume');
 if(label==='应用当前模型设置')return control('apply-model');
 if(/^(重试|重绘)/.test(label)){
  const offer=session.lifecycle.actions.find(action=>action.event==='retry');
  assert.ok(offer,`${label} 对应可重试的故障`);
  return f.request(`sessions/${session.id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:offer.faultId});
 }
 throw Error(`未知操作：${label}`);
}

async function exitBoth(f,id,expected){
 const render=await surfaces(),session=await f.read(id);
 const fromSettings=enabledActions(render.settings(session)).filter(label=>expected.test(label));
 const fromShelf=enabledActions(shelfEntry(render.shelf(await f.json('library/shelf')),id)).filter(label=>expected.test(label));
 assert.equal(fromSettings.length,1,`故事设置显示 ${expected}：${enabledActions(render.settings(session)).join('、')}`);
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
