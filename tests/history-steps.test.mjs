// 返回键步骤登记：push 与采用、基础步骤、搭乘者恢复、忙碌与输入守卫、前进弹回、排序、过期条目与页面加载。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistorySteps,isStamp} from '../client/ui/historySteps.ts';

let loads=0;
// 模拟浏览器历史：go 异步（flush 时执行），落到应用之外的条目记为离开
function browser({state=null,url='/',navigationType='navigate',storage={},nav=false,before=1,entries:given}={}){
 const entries=given??[...Array(before)].map(()=>({state:null,url:'about:blank',foreign:true})).concat([{state,url}]);
 let index=entries.length-1,answer=true,left=false,timers=[];
 const listeners={},micro=[],pendingGo=[],prompts=[];
 const env={
  history:{get state(){return entries[index].state;},get length(){return entries.length;},
   pushState(s,_,u){entries.splice(index+1);entries.push({state:s,url:u??entries[index].url});index++;},
   replaceState(s,_,u){entries[index]={...entries[index],state:s,url:u??entries[index].url};},
   go(d){pendingGo.push(d);}},
  location:{get href(){return entries[index].url;},get hash(){const u=entries[index].url;return u.includes('#')?u.slice(u.indexOf('#')):'';}},
  // Navigation API 只列出同源（非 foreign）条目
  navigation:nav?{get currentEntry(){return {index:entries.slice(0,index).filter(e=>!e.foreign).length};},entries:()=>entries.filter(e=>!e.foreign),activation:nav.activation??null}:null,
  storage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=v;}},
  navigationType,
  confirm(message){prompts.push(message);return answer;},
  setTimeout(fn){timers.push(fn);return timers.length-1;},clearTimeout(id){timers[id]=null;},
  queueMicrotask:fn=>micro.push(fn),
  addEventListener(type,fn){(listeners[type]??=[]).push(fn);},
  randomId:()=>'L'+(++loads),
 };
 const reg=createHistorySteps(env);
 const settle=()=>{while(micro.length)micro.shift()();};
 function traverse(d){
  const next=index+d;if(next<0||next>=entries.length)return;index=next;
  if(entries[index].foreign){left=true;return;}
  left=false;for(const fn of listeners.popstate??[])fn({state:entries[index].state});
 }
 const commits=[];
 // React 的一次提交：先执行卸载，再在微任务里结算；flush 执行排队的 go
 function stage(){while(commits.length)commits.shift()();settle();}
 function flush(){while(pendingGo.length){traverse(pendingGo.shift());stage();}}
 function commit(){stage();flush();}
 function step(rank,{busy=false,dirty=false,element=null}={}){
  const s={rank,busy,dirty,open:true,unregister:null};
  s.unregister=reg.register({rank,close:()=>{if(s.busy)return;commits.push(()=>{s.open=false;s.unregister();});},busy:()=>s.busy,dirty:()=>s.dirty,element:()=>element});
  // 应用内关闭：React 先执行卸载，再执行同一次提交里的挂载效果
  s.closeInApp=()=>{s.open=false;s.unregister();};
  return s;
 }
 return {env,reg,entries,step,commit,settle,timers,prompts,
  get index(){return index;},get left(){return left;},stage,flush,queueBack(){pendingGo.push(-1);},
  answer(value){answer=value;},
  click(){for(const fn of listeners.pointerdown??[])fn();},
  back(){traverse(-1);commit();},forward(){traverse(1);commit();},
  fire(type,event={}){for(const fn of listeners[type]??[])fn(event);},
  runTimers(){const list=timers;timers=[];list.forEach(fn=>fn?.());commit();},
  boot(){let rendered=false;const ok=reg.boot(()=>{rendered=true;});commit();return {ok,get rendered(){return rendered;}};},
 };
}

test('a gesture pushes, back closes only the topmost step, and the next back leaves',()=>{
 const b=browser();b.boot();
 b.click();const reader=b.step(0);b.commit();
 b.click();const sheet=b.step(3);b.commit();
 assert.equal(b.entries.length,4);
 b.back();assert.equal(sheet.open,false);assert.equal(reader.open,true);
 b.back();assert.equal(reader.open,false);assert.equal(b.left,false);
 b.back();assert.equal(b.left,true);
});

test('pushing restores the entry URL from the time of the input',()=>{
 const b=browser();b.boot();
 b.click();b.env.history.replaceState(b.env.history.state,'','/read?id=a');b.step(0);b.commit();
 assert.deepEqual(b.entries.slice(1).map(e=>e.url),['/','/read?id=a']);
});

test('a second step from the same input rides; back closes it and restores the entry below',()=>{
 const b=browser();b.boot();
 b.click();const reader=b.step(0);b.commit();
 const drawer=b.step(2);b.commit();
 assert.equal(b.entries.length,3);
 b.back();assert.equal(drawer.open,false);assert.equal(reader.open,true);
 assert.equal(b.index,2,'go(1) restored the reader entry');
 b.back();assert.equal(reader.open,false);
});

test('an in-app close releases the entry; a swap in one commit adopts it',()=>{
 const b=browser();b.boot();
 b.click();const create=b.step(3);b.commit();
 create.closeInApp();b.commit();
 assert.equal(b.index,1,'released');
 // 创建提交：同一次提交里卸载新建面板、挂载制作流程面板
 b.click();const sheet=b.step(3);b.commit();
 b.click();sheet.closeInApp();b.stage();
 assert.equal(b.index,2);
});

test('adopt comes before push even right after an input',()=>{
 const b=browser();b.boot();
 b.click();const settings=b.step(3);b.commit();
 b.click();settings.closeInApp();
 // 替换选题：隐藏故事设置与显示替换选题在同一次提交
 const reselect=b.step(3);b.commit();
 assert.equal(b.entries.length,3);assert.equal(b.index,2);
 b.back();assert.equal(reselect.open,false);b.back();assert.equal(b.left,true);
});

test('steps opened before the first input are base steps; back from the base leaves the app',()=>{
 const b=browser({url:'/read?id=a'});b.boot();
 const reader=b.step(0);b.commit();
 assert.equal(b.reg.snapshot().steps[0].base,true);
 b.click();const sheet=b.step(3);b.commit();
 b.back();assert.equal(sheet.open,false);assert.equal(reader.open,true);
 b.back();assert.equal(b.left,true);
});

test('after the first input no new step becomes a base step, and a late open after input pushes',()=>{
 const b=browser({url:'/read?id=a'});b.boot();
 b.step(0);b.commit();b.click();
 // 作品还未署名：点击后较晚才打开
 const late=b.step(3);b.commit();
 assert.equal(b.reg.snapshot().steps.at(-1).base,false);assert.equal(b.entries.length,3);
 b.back();assert.equal(late.open,false);assert.equal(b.left,false);
});

test('ordering: a child sheet registered before the reader in one commit stays on top',()=>{
 const b=browser();b.boot();
 const parent={},child={};
 b.click();const sheet=b.step(3,{element:parent});const nested=b.step(3,{element:child});
 b.reg.raised(child);b.reg.raised(parent);b.reg.raised(child);
 const reader=b.step(0);b.commit();
 b.back();assert.equal(nested.open,false);assert.equal(sheet.open,true);assert.equal(reader.open,true);
});

test('ordering: a re-raised surviving dialog stays above remounted sheets',()=>{
 const b=browser();b.boot();
 const settingsEl={},renameEl={},remounted={};
 b.click();const settings=b.step(3,{element:settingsEl});b.reg.raised(settingsEl);b.commit();
 b.click();const rename=b.step(3,{element:renameEl});b.reg.raised(renameEl);b.commit();
 // 跨档切换：故事设置重新挂载并登记，重命名不重新登记，但随后被重新置顶
 settings.closeInApp();const again=b.step(3,{element:remounted});b.reg.raised(remounted);b.reg.raised(renameEl);b.commit();
 assert.equal(b.entries.length,4);
 b.back();assert.equal(rename.open,false);assert.equal(again.open,true);
});

test('busy steps keep their entry; dirty steps ask, keep restores and discard closes',()=>{
 const b=browser();b.boot();
 b.click();const sheet=b.step(3,{busy:true});b.commit();
 b.back();assert.equal(sheet.open,true);assert.equal(b.index,2);
 sheet.busy=false;sheet.dirty=true;b.answer(false);
 b.back();assert.equal(sheet.open,true);assert.equal(b.index,2);assert.equal(b.prompts.length,1);
 b.answer(true);b.back();assert.equal(sheet.open,false);assert.equal(b.index,1);
});

test('forward bounces back and reopens nothing',()=>{
 const b=browser();b.boot();
 b.click();const sheet=b.step(3);b.commit();
 b.back();assert.equal(sheet.open,false);
 b.forward();assert.equal(b.index,1);assert.equal(b.reg.snapshot().steps.length,0);
});

test('closing several steps in one go releases all their entries',()=>{
 const b=browser();b.boot();
 b.click();const reader=b.step(0);b.commit();b.click();const panel=b.step(1);b.commit();b.click();const sheet=b.step(3);b.commit();
 sheet.closeInApp();panel.closeInApp();reader.closeInApp();b.commit();
 assert.equal(b.index,1);b.back();assert.equal(b.left,true);
});

test('StrictMode re-registration in one commit changes no history',()=>{
 const b=browser();b.boot();
 b.click();const first=b.step(3);first.unregister();const again=b.step(3);b.commit();
 assert.equal(b.entries.length,3);assert.equal(b.index,2);
 b.back();assert.equal(again.open,false);b.back();assert.equal(b.left,true);
});

test('a real press during the registry\'s own traversal is still handled',()=>{
 const b=browser();b.boot();
 b.click();const reader=b.step(0);b.commit();b.click();const sheet=b.step(3);b.commit();b.click();const top=b.step(3);b.commit();
 // 释放用的 go(-1) 尚未落地时用户按下返回
 top.closeInApp();b.stage();b.queueBack();b.flush();
 assert.equal(top.open,false);assert.equal(sheet.open,false);assert.equal(reader.open,true);assert.equal(b.index,2);
});

test('the provider hash entry is reserved for the dialog that opens later, and back closes it',()=>{
 const b=browser();b.boot();
 b.env.history.pushState(null,'','/#provider-settings');b.fire('hashchange');b.commit();
 assert.equal(b.index,2);assert.ok(isStamp(b.env.history.state));
 const provider=b.step(3);b.commit();
 b.back();assert.equal(provider.open,false);b.back();assert.equal(b.left,true);
});

test('a directly loaded provider dialog is a base step',()=>{
 const b=browser({url:'/#provider-settings'});b.boot();
 b.step(3);b.commit();assert.equal(b.reg.atBase(),true);
});

test('reload makes the current entry the base; stale back skips every old entry in one press',()=>{
 const storage={};
 const b=browser({storage,nav:{}});b.boot();
 b.click();b.step(0);b.commit();b.click();b.step(3);b.commit();
 // 重新加载：同一条目、同一组历史，新的文档
 const r=browser({entries:b.entries.map(e=>({...e})),storage,navigationType:'reload',nav:{}});
 const boot=r.boot();assert.ok(boot.rendered);assert.equal(r.reg.atBase(),true);
 r.step(0);r.commit();
 r.back();assert.equal(r.left,true,'one press left the app');
 assert.equal(r.index,0);
});

test('stale back with nothing before the app moves to the first entry and shows the start view',()=>{
 const storage={};
 const b=browser({storage,before:0,nav:{}});b.boot();
 b.click();b.step(0);b.commit();b.click();b.step(3);b.commit();
 const r=browser({entries:b.entries.map(e=>({...e})),storage,navigationType:'reload',nav:{}});
 let started=0;r.boot();r.reg.onStartView(()=>started++);const reader=r.step(0);r.commit();
 r.back();
 assert.equal(reader.open,false);assert.equal(r.index,0);assert.equal(started,1);
 assert.equal(r.entries[0].url,'/');assert.equal(r.reg.snapshot().depth,0);
 // 再按返回：浏览器自己的第一条目行为，应用内没有变化
 r.back();assert.equal(r.index,0);
 // 前进到其后的条目被弹回
 r.forward();assert.equal(r.index,0);
});

test('without the Navigation API a skip that goes nowhere falls back to the start view',()=>{
 const storage={};
 const b=browser({storage});b.boot();
 b.click();b.step(0);b.commit();b.click();b.step(3);b.commit();
 const r=browser({entries:b.entries.map(e=>({...e})),storage,navigationType:'reload'});r.boot();
 let started=0;r.reg.onStartView(()=>started++);const reader=r.step(0);r.commit();
 // history.length 认为有更早的条目，但这次跳转没有离开
 const go=r.env.history.go;r.env.history.go=()=>{};r.back();
 assert.equal(started,0);assert.equal(r.left,false);
 r.env.history.go=go;r.runTimers();
 assert.equal(started,1);assert.equal(reader.open,false);assert.equal(r.index,1);
});

test('page load: a stale entry loaded by back skips out before rendering; by forward it opens the start view',()=>{
 const stamp=(depth,load='OLD')=>({shiqu:1,load,depth});
 const back=browser({entries:[{state:null,url:'about:blank',foreign:true},{state:stamp(0),url:'/'},{state:stamp(1),url:'/read?id=a'}],navigationType:'back_forward',storage:{'shiqu-history':JSON.stringify({load:'X',depth:2,baseDepth:2})},nav:{}});
 const result=back.boot();assert.equal(result.ok,false);assert.equal(result.rendered,false);assert.equal(back.left,true);
 const forward=browser({entries:[{state:null,url:'about:blank',foreign:true},{state:stamp(0),url:'/read?id=a'}],navigationType:'back_forward',storage:{'shiqu-history':JSON.stringify({load:'X',depth:-1,baseDepth:-1})}});
 const shown=forward.boot();assert.ok(shown.rendered);assert.equal(forward.entries[1].url,'/');
});

test('page load: a direct link stamps depth 0; a bfcache restore of a live entry changes nothing',()=>{
 const b=browser({url:'/read?id=a'});const boot=b.boot();
 assert.ok(boot.rendered);assert.deepEqual({...b.env.history.state,load:'?'},{shiqu:1,load:'?',depth:0});
 b.click();b.step(3);b.commit();
 b.fire('pageshow',{persisted:true});b.commit();assert.equal(b.reg.snapshot().steps.length,1);
});
