// 读者出口完整性：枚举生命周期各维度的组合，经正式规则与状态文案推导，再渲染正式的操作组件。
// 需要读者处理的状态必须给出可点击的操作或说明原因；提示点击某项操作的文案必须有对应入口。
// 防止「已保存，等待继续」却没有「继续制作」这类只有状态、没有入口的界面。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';
import {productionLifecycle} from '../lib/production-lifecycle.ts';
import {productionBlockedReason,shelfGenerationStatus} from '../lib/shelf-generation.ts';

const require=createRequire(import.meta.url);
const compiled=build({stdin:{contents:`
 import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
 import StoryGenerationControl from './client/ui/StoryGenerationControl.tsx';import StoryRetry from './client/ui/StoryRetry.tsx';
 export const render=session=>renderToStaticMarkup(createElement('div',null,
  createElement(StoryGenerationControl,{session,busy:false,onControl:async()=>{},link:true}),
  createElement(StoryRetry,{session,busy:false,onRetry:()=>{},display:'actions',link:true})));
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',
 alias:{'@':process.cwd()},loader:{'.css':'empty'},plugins:[{name:'root-alias',setup(b){b.onResolve({filter:/^@\//},args=>({path:require.resolve(path.join(process.cwd(),args.path.slice(2)+(/\.\w+$/.test(args.path)?'':'.ts')),{paths:[process.cwd()]})}));}}]});

async function renderer(){
 const bundle=await compiled,module={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
 return module.exports.render;
}

const services=['available','unconfigured','snapshot-unavailable','credentials-invalid','quota-exhausted','rate-limited','stopping'];
const fault={id:'fault',message:'这一步暂时没有完成。',page:null,stage:'generation',state:'pending',retryAllowed:true,kind:'step-failure',scope:'required',targets:[{node:'visual',key:'f1',page:0}]};

function* sessions(){
 for(const state of ['idle','failed','completed'])for(const awaitingContinue of [false,true])for(const control of ['active','paused','stopped'])
  for(const service of services)for(const superseded of [false,true])for(const faulted of [false,true])for(const optionalWork of [false,true]){
   if(state==='completed'&&(faulted||awaitingContinue))continue;
   const faults=faulted?[fault]:[];
   const lifecycle=productionLifecycle({state,intake:undefined,generationControl:control,awaitingContinue,superseded,deleted:false,replacementOpen:false,
    queued:false,faults,reviewAttention:[],review:null,service,now:1,order:['f1'],pendingImageChecks:[],optionalWork,modelApplicable:false,
    canReprepare:false,repreparing:false,stopping:service==='stopping',freeImageRecoveries:new Set(),canOverrideReview:false,owned:true},[]);
   yield {id:'s',state:faulted?'failed':state,awaitingContinue:awaitingContinue||undefined,generationControl:control,superseded:superseded||undefined,lifecycle,
    faults,error:faulted?fault.message:null,retryAllowed:faulted,selection:{},stage:'',generationMode:'background',productionState:control==='active'?'queued':'paused'};
  }
}

/** 读者必须处理：当前版本有修订等待继续、被暂停或停止的未完成工作，或有待处理的必需故障。 */
function needsReader(session){
 const {lifecycle}=session;
 if(lifecycle.version!=='current')return false;
 const unfinished=lifecycle.phase!=='completed'||session.optionalWork;
 return !!session.awaitingContinue||lifecycle.control!=='active'&&unfinished||lifecycle.faults.some(item=>item.state==='pending'&&item.scope==='required');
}

test('every state that needs the reader offers an action or explains why none is available',async()=>{
 const render=await renderer();
 let checked=0;
 const failures=[];
 for(const session of sessions()){
  const status=shelfGenerationStatus(session),markup=render(session);
  const clickable=/<(a|button)\b/.test(markup),reason=productionBlockedReason(session);
  const explained=markup.includes(reason)||status.detail===reason;
  const label=JSON.stringify({state:session.state,awaiting:!!session.awaitingContinue,control:session.generationControl,service:session.lifecycle.service,
   superseded:!!session.superseded,faulted:!!session.faults.length});
  if(status.expects&&!clickable)failures.push(`${label} 提示操作「${status.expects}」但没有入口`);
  if(needsReader({...session,optionalWork:false})&&!clickable&&!explained)failures.push(`${label} 需要读者处理，却没有操作也没有原因`);
  if(/点击“[^”]+”/.test(status.detail)&&!clickable)failures.push(`${label} 文案要求点击，但没有可点击的操作：${status.detail}`);
  checked++;
 }
 assert.ok(checked>500,`checked ${checked} states`);
 assert.deepEqual(failures,[]);
});

test('waiting to continue without a configured service names the reason instead of an empty slot',async()=>{
 const render=await renderer();
 const session=[...sessions()].find(item=>item.awaitingContinue&&item.lifecycle.service==='unconfigured'&&!item.superseded&&!item.faults.length&&item.generationControl==='active');
 const status=shelfGenerationStatus(session),markup=render(session);
 assert.equal(status.detail,'当前制作服务未配置或处于只读模式。');
 assert.notEqual(status.message,'已保存，等待继续');
 assert.match(markup,/当前制作服务未配置或处于只读模式/);
 assert.doesNotMatch(markup,/继续制作/);
});
