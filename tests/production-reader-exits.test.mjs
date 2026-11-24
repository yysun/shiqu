// 读者出口完整性：枚举生命周期各维度的组合，经正式规则与状态文案推导，渲染故事设置和书架的实际界面。
// 需要读者处理的状态必须显示生命周期提供的那项可用操作，或说明原因；界面不得显示生命周期未提供的可用操作。
// 防止「已保存，等待继续」却没有「继续制作」这类只有状态、没有入口的界面。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionLifecycle} from '../lib/production-lifecycle.ts';
import {productionBlockedReason,shelfGenerationStatus} from '../lib/shelf-generation.ts';
import {enabledActions,shelfEntry,surfaces} from './fixtures/reader-surfaces.mjs';

const services=['available','unconfigured','snapshot-unavailable','credentials-invalid','quota-exhausted','rate-limited','stopping'];
const fault={id:'fault',message:'这一步暂时没有完成。',page:null,stage:'generation',state:'pending',retryAllowed:true,kind:'step-failure',scope:'required',targets:[{node:'visual',key:'f1',page:0}]};
/** 界面操作名称对应的生命周期事件。 */
const labels=[[/^(继续制作|重绘第 \d+ 幅)$/,'continue'],[/^(恢复生成|恢复准备)$/,'resume'],[/^暂停生成$/,'pause'],[/^(重试|重绘)/,'retry'],[/^应用当前模型设置$/,'apply-model']];
const eventOf=label=>labels.find(([pattern])=>pattern.test(label))?.[1];

function* sessions(){
 for(const state of ['idle','failed','completed'])for(const awaitingContinue of [false,true])for(const control of ['active','paused','stopped'])
  for(const service of services)for(const superseded of [false,true])for(const faulted of [false,true])for(const optionalWork of [false,true]){
   if(state==='completed'&&(faulted||awaitingContinue))continue;
   const faults=faulted?[fault]:[];
   const lifecycle=productionLifecycle({state,intake:undefined,generationControl:control,awaitingContinue,superseded,deleted:false,replacementOpen:false,
    queued:false,faults,reviewAttention:[],review:null,service,now:1,order:['f1'],pendingImageChecks:[],optionalWork,modelApplicable:service==='snapshot-unavailable',
    canReprepare:false,repreparing:false,stopping:service==='stopping',freeImageRecoveries:new Set(),canOverrideReview:false,owned:true},[]);
   yield {id:'s',state:faulted?'failed':state,awaitingContinue:awaitingContinue||undefined,generationControl:control,superseded:superseded||undefined,lifecycle,
    snapshotUnavailable:service==='snapshot-unavailable'||undefined,faults,error:faulted?fault.message:null,retryAllowed:faulted,
    selection:{bookId:'zhuangzi',theme:'核对',artStyle:'ink-pencil',narrativeDetail:'balanced'},stage:'',generationMode:'background',
    productionState:control==='active'?'queued':'paused',ready:0,page:0,saved:false,createdAt:'2026-11-24T00:00:00.000Z',optionalWork};
  }
}

/** 读者必须处理：当前版本有修订等待继续、暂停或停止的未完成工作（含已完成作品的可选工作），或有待处理的必需故障。 */
function needsReader(session){
 const {lifecycle}=session;
 if(lifecycle.version!=='current')return false;
 const unfinished=lifecycle.phase!=='completed'||session.optionalWork;
 return !!session.awaitingContinue||lifecycle.control!=='active'&&unfinished||lifecycle.faults.some(item=>item.state==='pending'&&item.scope==='required');
}
const offered=(session,event)=>session.lifecycle.actions.some(action=>action.event===event);
const exits=['continue','resume','retry','apply-model'];

test('every surface shows the specific offered exit or the reason, and never an action the lifecycle withholds',async()=>{
 const render=await surfaces();
 let checked=0;
 const failures=[];
 for(const session of sessions()){
  const status=shelfGenerationStatus(session),reason=productionBlockedReason(session);
  const label=JSON.stringify({state:session.state,awaiting:!!session.awaitingContinue,control:session.generationControl,service:session.lifecycle.service,
   superseded:!!session.superseded,faulted:!!session.faults.length,optional:session.optionalWork});
  const views={故事设置:render.settings(session),书架:shelfEntry(render.shelf([session]),session.id)};
  for(const [surface,markup] of Object.entries(views)){
   const events=enabledActions(markup).map(eventOf).filter(Boolean);
   for(const event of events)if(!offered(session,event))failures.push(`${label} ${surface}显示了未提供的操作「${event}」`);
   if(status.expects&&!events.includes(status.expects))failures.push(`${label} ${surface}提示「${status.expects}」却没有该操作`);
   if(surface==='故事设置'&&needsReader(session)&&!events.some(event=>exits.includes(event))&&![reason,reason.replace(/。$/,''),status.detail].some(text=>markup.includes(text)))
    failures.push(`${label} ${surface}需要读者处理，却没有可用操作也没有原因`);
  }
  checked++;
 }
 assert.ok(checked>500,`checked ${checked} states`);
 assert.deepEqual(failures,[]);
});

test('waiting to continue without a configured service names the reason instead of an empty slot',async()=>{
 const render=await surfaces();
 const session=[...sessions()].find(item=>item.awaitingContinue&&item.lifecycle.service==='unconfigured'&&!item.superseded&&!item.faults.length&&item.generationControl==='active');
 const status=shelfGenerationStatus(session),markup=render.settings(session);
 assert.equal(status.detail,'当前制作服务未配置或处于只读模式。');
 assert.notEqual(status.message,'已保存，等待继续');
 assert.match(markup,/当前制作服务未配置或处于只读模式/);
 assert.deepEqual(enabledActions(markup).filter(eventOf),[]);
});
