// 返回键的步骤登记：已打开的东西（面板、阅读、新建页、工作区、抽屉）各自登记为一个“步骤”，
// 本模块据此维护浏览器历史，使返回一次只关闭最上层的一步，前进从不重新打开任何东西。
// - 条目带 {shiqu:1, load, depth}；depth 从应用第一条目起计数（绝对位置），baseDepth 是本次加载的基础条目。
// - 基础步骤（首次用户输入之前打开、且其下全是基础步骤）不占条目，返回从不关闭它们。
// - 其余步骤自下而上各占一个基础之上的条目；多出来的是“搭乘者”，返回关闭它后用 go(1) 恢复下层的条目。
// - 打开时先采用待释放的条目；否则自上次 push 以来有过用户输入才 push（与 Chrome 的可跳过条目规则一致）。
// - 应用内关闭后，在本次提交的被动效果全部执行完的微任务里结算，用 history.go(-n) 释放多余条目。
//   这依赖步骤在 useEffect（被动效果）里登记；改用 useLayoutEffect 会把一次提交拆成两次结算。
// - 排序：先按层级（阅读 0、新建页或工作区 1、抽屉 2、面板或对话框 3），对话框再按置顶顺序（raised）。
// - 过期条目（来自另一次加载）：页面加载时在渲染之前处理；同一文档内的过期返回跳出应用，过期前进弹回。
import {useEffect,useRef} from 'react';

export type StepRank=0|1|2|3;
export type StepInput={rank:StepRank;close:()=>void;busy?:()=>boolean;dirty?:()=>boolean;element?:()=>Element|null};
type Step=StepInput&{seq:number;base:boolean;closing:boolean};
export type Stamp={shiqu:1;load:string;depth:number};
type Live={load:string;depth:number;baseDepth:number};
type NavEntry={index:number};
type HistoryEnv={
 history:{state:unknown;length:number;scrollRestoration?:string;pushState(state:unknown,unused:string,url?:string):void;replaceState(state:unknown,unused:string,url?:string|null):void;go(delta:number):void};
 location:{href:string;hash:string};
 navigation?:{currentEntry?:NavEntry|null;entries?:()=>unknown[];activation?:{from?:NavEntry|null}|null}|null;
 storage?:{getItem(key:string):string|null;setItem(key:string,value:string):void}|null;
 navigationType?:string;
 confirm(message:string):boolean;
 setTimeout(fn:()=>void,ms:number):unknown;
 clearTimeout(id:unknown):void;
 queueMicrotask(fn:()=>void):void;
 addEventListener(type:string,fn:(event:any)=>void,capture?:boolean):void;
 randomId():string;
};

export const DISCARD_PROMPT='放弃未保存的输入？';
const KEY='shiqu-history',RESTART_KEY='shiqu-history-restart';
export const isStamp=(value:unknown):value is Stamp=>!!value&&typeof value==='object'&&(value as Stamp).shiqu===1&&typeof (value as Stamp).load==='string'&&Number.isInteger((value as Stamp).depth);

export function createHistorySteps(env:HistoryEnv){
 let load=env.randomId(),depth=0,baseDepth=0,seq=0,raiseSeq=0;
 let inputSeq=0,pushedSeq=0,hadInput=false,inputUrl:string|null=null;
 let settleQueued=false,fallback:unknown=null;
 let expected:{depth:number;then?:()=>void}|null=null;
 let onStart:(()=>void)|null=null;
 const steps:Step[]=[],raised=new WeakMap<Element,number>(),reservations:object[]=[];
 const stamp=(d:number):Stamp=>({shiqu:1,load,depth:d});
 const save=()=>{try{env.storage?.setItem(KEY,JSON.stringify({load,depth,baseDepth}));}catch{}};
 const order=(a:Step,b:Step)=>a.rank-b.rank||(a.rank===3?raiseOf(a)-raiseOf(b):0)||a.seq-b.seq;
 const raiseOf=(s:Step)=>{const el=s.element?.();return el?raised.get(el)??0:0;};
 const open=()=>steps.filter(s=>!s.closing).sort(order);
 const owned=()=>open().filter(s=>!s.base);
 function go(delta:number,then?:()=>void){depth+=delta;expected={depth,then};env.history.go(delta);}
 function schedule(){if(!settleQueued){settleQueued=true;env.queueMicrotask(settle);}}
 function settle(){
  settleQueued=false;
  // 自身的跳转落地后再结算
  if(expected)return;
  const excess=depth-baseDepth-owned().length-reservations.length;
  if(excess>0)go(-excess);
  save();
 }
 function push(){
  const href=env.location.href;
  // open() 等已把新步骤的 URL 写到当前条目上：当前条目恢复输入时的 URL，新 URL 随新条目
  if(inputUrl&&inputUrl!==href)env.history.replaceState(stamp(depth),'',inputUrl);
  depth++;env.history.pushState(stamp(depth),'',href);pushedSeq=inputSeq;
 }
 function register(input:StepInput){
  const step:Step={...input,seq:++seq,base:false,closing:false};
  if(depth-baseDepth>owned().length){reservations.shift();} // 采用待释放（或哈希预留）的条目
  else if(!hadInput&&steps.every(s=>s.base))step.base=true;
  else if(inputSeq>pushedSeq)push();
  // 其余情况是搭乘者，不占条目
  steps.push(step);schedule();
  return()=>{const i=steps.indexOf(step);if(i<0)return;steps.splice(i,1);schedule();};
 }
 function closeStep(step:Step){
  step.closing=true;step.close();
  // 关闭被拒绝（例如仍在忙）时恢复计数，该步骤此后按搭乘者处理
  env.setTimeout(()=>{if(step.closing&&steps.includes(step)){step.closing=false;schedule();}},1000);
 }
 const blocked=(step:Step|undefined)=>!!step&&(!!step.busy?.()||(!!step.dirty?.()&&!env.confirm(DISCARD_PROMPT)));
 function back(target:number){
  const from=depth;depth=target;
  const delta=from-target,top=owned().at(-1);
  if(!top){save();return;}
  if(blocked(top)){go(delta);return;}
  closeStep(top);
  // 多级后退（长按返回菜单）：每个条目关闭一步，遇到忙碌或有输入的步骤为止
  for(let i=1;i<delta;i++){const next=owned().at(-1);if(!next||next.busy?.()||next.dirty?.())break;closeStep(next);}
  // 关闭的是搭乘者时，下层步骤的条目已被消耗，恢复它
  const extra=Math.min(owned().length-(depth-baseDepth),delta);
  if(extra>0)go(extra);else save();
 }
 // 应用第一条目之前是否有条目。Navigation API 只列同源条目：之前有同源条目即可离开；
 // 历史里另有跨源条目时无法判断它们在前还是在后，尝试离开并用计时回退；全部都是应用的条目则不能离开。
 function canLeave(d:number):'yes'|'maybe'|'no'{
  const nav=env.navigation,entry=nav?.currentEntry;
  if(entry&&nav?.entries){if(entry.index-d>0)return 'yes';return env.history.length>nav.entries().length?'maybe':'no';}
  return env.history.length>d+1?'maybe':'no';
 }
 function cancelFallback(){if(fallback!==null){env.clearTimeout(fallback);fallback=null;}}
 // 跳出应用：没有更早的条目时（应用是标签页的第一页）回到应用第一条目并显示起始视图
 function leave(d:number,ms:number,restart:()=>void){
  const can=canLeave(d);
  if(can==='no'){restart();return;}
  try{env.storage?.setItem(KEY,JSON.stringify({load,depth:-1,baseDepth:-1}));}catch{}
  env.history.go(-(d+1));
  if(can==='maybe')fallback=env.setTimeout(()=>{fallback=null;restart();},ms);
 }
 function restampStart(){depth=0;baseDepth=0;env.history.replaceState(stamp(0),'','/');save();}
 function restartLive(d:number){
  for(const s of open().reverse())closeStep(s);
  baseDepth=0;
  if(d>0){expected={depth:0,then:()=>{restampStart();onStart?.();}};depth=0;env.history.go(-d);}
  else{restampStart();onStart?.();}
 }
 function stale(state:Stamp){
  const from=depth;
  if(state.depth>from){depth=state.depth;go(-(state.depth-from));return;}
  depth=state.depth;
  if(blocked(open().at(-1))){go(from-state.depth);return;}
  leave(state.depth,400,()=>restartLive(state.depth));
 }
 function popstate(event:{state:unknown}){
  const state=event.state;
  // 哈希导航带来的空状态 popstate 交给 hashchange；其他外来条目不处理
  if(!isStamp(state))return;
  cancelFallback();
  if(expected){
   const wanted=expected;expected=null;
   if(state.depth===wanted.depth){wanted.then?.();schedule();return;}
   // 自身跳转途中到达的真实按键：depth 已是预期落点，按差值处理
  }
  if(state.load!==load){stale(state);return;}
  if(state.depth>depth){const from=depth;depth=state.depth;go(-(state.depth-from));}
  else if(state.depth<depth)back(state.depth);
 }
 function hashchange(){
  if(env.location.hash!=='#provider-settings'||isStamp(env.history.state))return;
  depth++;env.history.replaceState(stamp(depth),'',env.location.href);
  // 预留给即将打开的设置对话框（可能晚几次提交才挂载）
  const token={};reservations.push(token);
  env.setTimeout(()=>{const i=reservations.indexOf(token);if(i>=0){reservations.splice(i,1);schedule();}},2000);
  save();
 }
 function input(){inputSeq++;hadInput=true;inputUrl=env.location.href;}
 function pageshow(event:{persisted?:boolean}){
  const state=env.history.state;
  if(!event.persisted||!isStamp(state)||state.load===load)return;
  for(const s of open().reverse())closeStep(s);
  depth=baseDepth=state.depth;env.history.replaceState(stamp(depth),'','/');save();onStart?.();
 }
 // 页面加载：在渲染与加载数据之前决定。返回 false 表示正在跳出应用，不要渲染。
 function boot(render:()=>void):boolean{
  onStart=null;
  // 滚动由应用自己恢复（返回阅读前的列表位置）；浏览器在遍历时恢复的位置会覆盖它
  env.history.scrollRestoration='manual';
  env.addEventListener('popstate',popstate);env.addEventListener('hashchange',hashchange);
  for(const type of ['pointerdown','keydown'])env.addEventListener(type,input,true);
  env.addEventListener('pagehide',cancelFallback);env.addEventListener('visibilitychange',cancelFallback);
  env.addEventListener('pageshow',pageshow);
  const state=env.history.state;let prior:Live|null=null;
  try{prior=JSON.parse(env.storage?.getItem(KEY)||'null');}catch{}
  let restarting=false;try{restarting=env.storage?.getItem(RESTART_KEY)==='1';env.storage?.setItem(RESTART_KEY,'');}catch{}
  const start=()=>{restampStart();render();};
  if(!isStamp(state)){env.history.replaceState(stamp(0),'',env.location.href);save();render();return true;}
  // 回退到应用第一条目的跨文档落地
  if(restarting&&state.depth===0){start();return true;}
  if(env.navigationType!=='back_forward'){
   // 重新加载：当前条目成为基础步骤，保留绝对 depth
   depth=baseDepth=state.depth;env.history.replaceState(stamp(depth),'',env.location.href);save();render();return true;
  }
  // 过期条目的前进/后退加载。方向：同源的上一条目用 Navigation API；否则与上次记录的 depth 比较，
  // 跳出应用时记录为 -1，因此从应用之前返回的都是前进；回到离开时的同一条目也按前进（显示起始视图）
  const from=env.navigation?.activation?.from,current=env.navigation?.currentEntry;
  const isBack=from&&current?from.index>current.index:!!prior&&state.depth<prior.depth;
  if(!isBack){depth=baseDepth=state.depth;env.history.replaceState(stamp(depth),'','/');save();render();return true;}
  const restart=()=>{
   if(state.depth===0){start();return;}
   try{env.storage?.setItem(RESTART_KEY,'1');}catch{}
   onStart=()=>{try{env.storage?.setItem(RESTART_KEY,'');}catch{}render();};
   expected={depth:0,then:()=>{restampStart();onStart?.();onStart=null;}};depth=0;env.history.go(-state.depth);
  };
  depth=state.depth;leave(state.depth,1000,restart);
  return false;
 }
 return {
  boot,register,popstate,hashchange,input,pageshow,
  // 对话框每次 showModal（含重新置顶）后调用，记录置顶顺序
  raised(el:Element){raised.set(el,++raiseSeq);},
  // 在当前顺序里位于 el 下方、最近的对话框步骤
  dialogBelow(el:Element){const list=open().filter(s=>s.rank===3);const i=list.findIndex(s=>s.element?.()===el);const below=i<0?list.at(-1):list[i-1];return below?.element?.()??null;},
  atBase:()=>depth===baseDepth,
  onStartView(fn:(()=>void)|null){onStart=fn;},
  snapshot:()=>({load,depth,baseDepth,steps:open().map(s=>({rank:s.rank,base:s.base}))}),
 };
}

const browser=typeof window==='undefined'?null:window;
export const historySteps=createHistorySteps({
 history:browser?.history??{state:null,length:0,pushState(){},replaceState(){},go(){}},
 location:browser?.location??{href:'',hash:''},
 navigation:(browser as unknown as {navigation?:HistoryEnv['navigation']})?.navigation??null,
 get storage(){try{return browser?.sessionStorage??null;}catch{return null;}},
 navigationType:browser?(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined)?.type:undefined,
 confirm:message=>browser?browser.confirm(message):true,
 setTimeout:(fn,ms)=>setTimeout(fn,ms),
 clearTimeout:id=>clearTimeout(id as ReturnType<typeof setTimeout>),
 queueMicrotask:fn=>queueMicrotask(fn),
 addEventListener:(type,fn,capture)=>{(type==='visibilitychange'?document:browser)?.addEventListener(type,fn,capture);},
 randomId:()=>Math.random().toString(36).slice(2,10),
});

// 非对话框步骤：active 为真时登记，关闭、忙碌与输入判断读取最新的回调
export function useHistoryStep(active:boolean,rank:StepRank,close:()=>void,dirty?:()=>boolean){
 const latest=useRef({close,dirty});latest.current={close,dirty};
 useEffect(()=>{
  if(!active)return;
  return historySteps.register({rank,close:()=>latest.current.close(),dirty:()=>!!latest.current.dirty?.()});
 },[active,rank]);
}
