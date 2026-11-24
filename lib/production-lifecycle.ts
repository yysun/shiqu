// 从故事阶段、控制和任务租约推导生命周期视图。使用同一项在途任务提供步骤、幅号和计时。
import type {GenerationControl,SessionView,Step} from './reader-model.ts';
import type {FaultView} from './reader-recovery.ts';
import type {Attention,Work} from './production-dag/runner.ts';

export type ProductionActivity={
 id:string;call:string;pages:number[];startedAt:number;attempt:number;
};
export type ProductionService='available'|'unconfigured'|'snapshot-unavailable'|'stopping';
export const productionServiceMessages={
 unconfigured:'当前制作服务未配置或处于只读模式。',
 'snapshot-unavailable':'快照服务不可用，请恢复原模型服务或应用当前模型设置。',
 stopping:'制作服务正在停止。',
};
export type ProductionLifecycle={
 phase:'selection'|'preparation'|'confirmation'|'production'|'completed';
 version:'current'|'superseded';
 control:GenerationControl;
 continuation:boolean;
 draining:boolean;
 faults:FaultView[];
 reviewAttention:Attention[];
 service:ProductionService;
 imageAvailability:'available'|'unavailable';
 activity:{state:'running';jobs:ProductionActivity[]}|{state:'queued'|'idle'};
};

type ActivityJob={id:string;kind:string;payload:string;state:string;lease_until:number;updated_at:number;attempts:number};
type ActivityInput=Pick<SessionView,'state'|'intake'|'generationControl'|'awaitingContinue'> & {complete?:boolean;superseded:boolean;queued:boolean;faults:FaultView[];reviewAttention:Attention[];service:ProductionService;now:number;order:readonly string[]};

export function productionLifecycle(input:ActivityInput,jobs:readonly ActivityJob[]):ProductionLifecycle{
 const intake=input.intake?.phase;
 const phase=intake==='choosing'||intake==='discovering'?'selection':intake==='preparing'?'preparation':
  intake==='confirming'?'confirmation':(input.complete??input.state==='completed')?'completed':'production';
 const control=input.generationControl??'active';
 const running=jobs
  .filter(job=>job.state==='running'&&job.lease_until>input.now&&(job.kind!=='discover'||intake==='discovering'))
  .sort((a,b)=>a.updated_at-b.updated_at||(a.id<b.id?-1:a.id>b.id?1:0))
  .map(job=>{
   const {work,page}=JSON.parse(job.payload) as {work?:Work;page?:number};
   const pages=work?[...new Set(work.instances.map(instance=>input.order.indexOf(instance.key)+1).filter(n=>n>0))]:
    page===undefined?[]:[page+1];
   return {id:job.id,call:work?.call??job.kind,pages,startedAt:job.updated_at,attempt:job.attempts};
  });
 return {phase,version:input.superseded?'superseded':'current',control,continuation:!!input.awaitingContinue,
  faults:input.faults,reviewAttention:input.reviewAttention,service:input.service,
  imageAvailability:jobs.some(job=>['queued','running'].includes(job.state)&&JSON.parse(job.payload).waitingFor==='image-availability')?'unavailable':'available',
  draining:running.length>0&&(control!=='active'||input.superseded),
  activity:running.length?{state:'running',jobs:running}:{state:input.queued&&control==='active'&&!input.superseded&&!input.awaitingContinue?'queued':'idle'}};
}

const phases:Record<string,Step['kind']>={
 discover:'discover',verifySource:'source',prepareArt:'recommend',prepareSuggestions:'recommend',
 prepareBrief:'plan',characters:'plan',outline:'plan',registerItems:'plan',sceneBatch:'plan',visual:'plan',
 restyle:'restyle',ending:'reflection',frameCheck:'review',review:'review',draw:'image',drawLandscape:'image',
 sceneRepair:'repair',visualRepair:'repair',structureRepair:'repair',endingRepair:'repair',
};
const labels:Record<string,string>={
 prepareBrief:'整理故事梗概',characters:'设定人物',outline:'编排全篇提纲',registerItems:'登记验收要求',
 ending:'拟定标题与结语',frameCheck:'审核画幅数',review:'审核全篇分镜',
 sceneRepair:'修订叙事分镜',visualRepair:'修订画面描述',structureRepair:'修订分镜结构',endingRepair:'修订结语',
};
const batches:Record<string,string>={sceneBatch:'编排叙事分镜',visual:'生成画面描述',restyle:'按新画风转换画面描述'};

export function describeProductionCall(call:string,pages:readonly number[],repairPasses:number){
 const phase=phases[call];
 let label=call==='review'&&repairPasses?'复核全篇分镜':labels[call];
 if((call==='draw'||call==='drawLandscape')&&pages.length)label=`绘制第 ${pages[0]} 幅${call==='drawLandscape'?'横版插图':''}`;
 if(batches[call]&&pages.length){
  const contiguous=pages.every((page,index)=>page===pages[0]+index);
  const scope=pages.length===1?`第 ${pages[0]} 幅`:contiguous?`第 ${pages[0]}–${pages.at(-1)} 幅`:`本批 ${pages.length} 幅`;
  label=`${batches[call]}（${scope}）`;
 }
 return {phase,label};
}

export type DispatchState={
 version:'current'|'superseded'|'deleted';control:GenerationControl;continuation:boolean;
 generationCurrent:boolean;demand:boolean;fault:boolean;inputCurrent:boolean;
};
export type DispatchDecision='allow'|'yield'|'obsolete';

const obsoleteDispatch=(state:DispatchState)=>state.version==='superseded'||!state.generationCurrent||!state.inputCurrent;
const waitingDispatch=(state:DispatchState)=>state.version==='deleted'||state.control!=='active'||state.continuation||!state.demand||state.fault;

export const dispatchRules:readonly {matches:(state:DispatchState)=>boolean;decision:DispatchDecision}[]=[
 {matches:obsoleteDispatch,decision:'obsolete'},
 {matches:state=>!obsoleteDispatch(state)&&waitingDispatch(state),decision:'yield'},
 {matches:state=>!obsoleteDispatch(state)&&!waitingDispatch(state),decision:'allow'},
];

/** 领取和发送使用相同的工作许可。输入已换代的任务作废，暂时受阻的任务可以等待。 */
export function authorizeDispatch(state:DispatchState):DispatchDecision{
 return dispatchRules.find(rule=>rule.matches(state))!.decision;
}
