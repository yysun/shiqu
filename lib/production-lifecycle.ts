// 从故事阶段、控制和任务租约推导生命周期视图。使用同一项在途任务提供步骤、幅号和计时。
import type {GenerationControl,SessionView,Step} from './reader-model.ts';
import type {FaultView} from './reader-recovery.ts';
import type {Attention,Work} from './production-dag/runner.ts';
import type {IntakeAction,IntakeSearch,StoryIntake} from './reader-intake.ts';

export type ProductionActivity={
 id:string;call:string;pages:number[];startedAt:number;attempt:number;
};
export type ProductionFault=FaultView&{
 kind:'step-failure'|'content-blocked'|'interrupted'|'image-loss';
 scope:'required'|'optional';
 targets:{node:string;key:string;page:number|null}[];
};
export type ProductionImageCheck={
 state:'pending'|'temporarily-unavailable';pages:number[];kind:'portrait'|'landscape'|'job';jobId?:string;
};
export type ProductionActionOffer=
 {event:ProductionControlEvent|'continue'|'apply-model'}|
 {event:'retry'|'continue-repair'|'skip-review'|'override-review';faultId:string};
export type ProductionService='available'|'unconfigured'|'snapshot-unavailable'|'stopping';
export const productionServiceMessages={
 unconfigured:'当前制作服务未配置或处于只读模式。',
 'snapshot-unavailable':'快照服务不可用，请恢复原模型服务或应用当前模型设置。',
 stopping:'制作服务正在停止。',
};
export type ProductionLifecycle={
 phase:'selection'|'preparation'|'confirmation'|'production'|'completed';
 version:'current'|'superseded';
 replacementDraft:'open'|'none';
 control:GenerationControl;
 continuation:boolean;
 draining:boolean;
 faults:ProductionFault[];
 reviewAttention:Attention[];
 service:ProductionService;
 imageAvailability:'available'|'unavailable';
 imageChecks:ProductionImageCheck[];
 actions:ProductionActionOffer[];
 activity:{state:'running';jobs:ProductionActivity[]}|{state:'queued'|'idle'};
};

type ActivityJob={id:string;kind:string;payload:string;state:string;lease_until:number;updated_at:number;attempts:number};
type ActivityInput=Pick<SessionView,'state'|'intake'|'generationControl'|'awaitingContinue'> & {
 complete?:boolean;superseded:boolean;replacementOpen:boolean;queued:boolean;faults:ProductionFault[];
 reviewAttention:Attention[];service:ProductionService;now:number;order:readonly string[];
 pendingImageChecks:ProductionImageCheck[];optionalWork:boolean;modelApplicable:boolean;
 reviewBlockId?:string;canOverrideReview:boolean;reviewSkipId?:string;
};

export function productionLifecycle(input:ActivityInput,jobs:readonly ActivityJob[]):ProductionLifecycle{
 const intake=input.intake?.phase;
 const phase=intake==='choosing'||intake==='discovering'?'selection':intake==='preparing'?'preparation':
  intake==='confirming'?'confirmation':(input.complete??input.state==='completed')?'completed':'production';
 const control=input.generationControl??'active';
 const inFlight=(job:ActivityJob)=>job.state==='running'&&job.lease_until>input.now&&(job.kind!=='discover'||intake==='discovering');
 const details=(job:ActivityJob)=>{
  const {work,page,waitingFor}=JSON.parse(job.payload) as {work?:Work;page?:number;waitingFor?:string};
  const pages=work?[...new Set(work.instances.map(instance=>input.order.indexOf(instance.key)+1).filter(n=>n>0))]:
   page===undefined?[]:[page+1];
  return {call:work?.call??job.kind,pages,waitingFor};
 };
 const running=jobs.filter(inFlight)
  .sort((a,b)=>a.updated_at-b.updated_at||(a.id<b.id?-1:a.id>b.id?1:0))
  .map(job=>{
   const {call,pages}=details(job);
   return {id:job.id,call,pages,startedAt:job.updated_at,attempt:job.attempts};
  });
 const waiting=jobs.flatMap<ProductionImageCheck>(job=>{
  if(job.state!=='queued'&&!inFlight(job))return [];
  const {waitingFor,pages}=details(job);
  return waitingFor==='image-availability'?[{state:'temporarily-unavailable',kind:'job',pages,jobId:job.id}]:[];
 });
 return {phase,version:input.superseded?'superseded':'current',replacementDraft:input.replacementOpen?'open':'none',control,continuation:!!input.awaitingContinue,
  faults:input.faults,reviewAttention:input.reviewAttention,service:input.service,
  imageAvailability:waiting.length?'unavailable':'available',imageChecks:[...input.pendingImageChecks,...waiting],
  actions:productionActionOffers(input,control),
  draining:running.length>0&&(control!=='active'||input.superseded),
  activity:running.length?{state:'running',jobs:running}:{state:input.queued&&control==='active'&&!input.superseded&&!input.awaitingContinue?'queued':'idle'}};
}

function productionActionOffers(input:ActivityInput,control:GenerationControl):ProductionActionOffer[]{
 const state:CommandState={version:input.superseded?'superseded':'current',control,continuation:!!input.awaitingContinue,
  stopping:input.service==='stopping',targetCurrent:true,targetReady:true};
 const configured=input.service!=='unconfigured',actions:ProductionActionOffer[]=[];
 const allowed=(event:ProductionCommand,ready=true)=>authorizeProductionCommand(event,{...state,targetReady:ready}).allowed;
 for(const event of productionControlEvents){
  if((event!=='resume'&&event!=='background'||configured)&&allowed(event,input.state!=='completed'||event!=='background'&&input.optionalWork))actions.push({event});
 }
 if(configured&&allowed('continue'))actions.push({event:'continue'});
 if(input.modelApplicable&&allowed('apply-model'))actions.push({event:'apply-model'});
 if(input.reviewBlockId){
  if(configured&&allowed('continue-repair',input.reviewAttention.some(reason=>reason.reason==='limit')))actions.push({event:'continue-repair',faultId:input.reviewBlockId});
  if(configured&&allowed('override-review',input.canOverrideReview))actions.push({event:'override-review',faultId:input.reviewBlockId});
 }
 if(input.reviewSkipId&&allowed('skip-review'))actions.push({event:'skip-review',faultId:input.reviewSkipId});
 for(const fault of input.faults){
  if(fault.scope==='required'&&fault.state==='pending'&&fault.retryAllowed&&(configured||fault.kind==='image-loss')&&allowed('retry'))
   actions.push({event:'retry',faultId:fault.id});
 }
 return actions;
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

export const productionControlEvents=['background','pause','stop','resume'] as const;
export type ProductionControlEvent=(typeof productionControlEvents)[number];
export type ProductionCommand='continue'|'retry'|'continue-repair'|'skip-review'|'override-review'|'apply-model'|'image-health'|'start-landscape'|'retry-landscape'|'open-reselection'|'edit-revision'|'save-revision'|'redraw'|'cover'|'copy'|'copy-draft'|ProductionControlEvent;
type CommandState={
 version:DispatchState['version'];control:GenerationControl;continuation:boolean;
 targetCurrent:boolean;targetReady:boolean;stopping:boolean;
};
type CommandDecision={allowed:true}|{allowed:false;status:409|503;message:string};

const controlCommand={allows:(state:CommandState)=>state.targetReady,denial:'故事已完成或版本已更新，请刷新后再操作。'};
const landscapeCommand={allows:(state:CommandState)=>state.targetCurrent&&state.targetReady,
 denial:(state:CommandState)=>state.targetReady?'横图状态已更新，请刷新后再操作。':'请先完成当前版本的竖版插图。'};
const commands={
 background:controlCommand,
 pause:controlCommand,
 stop:controlCommand,
 resume:controlCommand,
 continue:{allows:state=>state.continuation,denial:'这篇故事没有等待继续的修改，或版本已更新。'},
 retry:{allows:state=>state.control==='active'&&!state.continuation&&state.targetCurrent&&state.targetReady,
  denial:state=>state.control==='active'&&!state.continuation?'这项问题或输入已更新，请刷新后再操作。':'请恢复当前版本的制作，再重试当前问题。'},
 'continue-repair':{allows:state=>state.control==='active'&&!state.continuation&&state.targetCurrent&&state.targetReady,
  denial:'审片结果、制作许可或修订额度已更新，请刷新后再操作。'},
 'skip-review':{allows:state=>(state.control!=='active'||state.continuation)&&state.targetCurrent&&state.targetReady,
  denial:'请先暂停制作并保存完整稿件，或刷新后重试当前审核。'},
 'override-review':{allows:state=>state.targetCurrent&&state.targetReady,
  denial:state=>state.targetCurrent?'分镜和结语仍在准备，请等稿件保存后再放行绘图。':'审核结果已更新，请刷新后再操作。'},
 'apply-model':{allows:state=>state.targetCurrent&&state.targetReady,
  denial:state=>state.targetReady?'这篇故事还没有进入制作或已有新版，无法应用模型设置。':'当前模型设置不可用，请先在设置中配置生成服务。'},
 'image-health':{allows:state=>state.targetCurrent&&state.targetReady,
  denial:state=>state.targetCurrent?'图片地址无法核对。':'这幅图片已更新，请刷新后再检查。'},
 'start-landscape':landscapeCommand,
 'retry-landscape':landscapeCommand,
 'open-reselection':{allows:state=>state.targetCurrent&&state.targetReady,
  denial:state=>state.targetReady?'当前选题或制作设置已更新，请重新打开选题。':'请先选择一篇故事。'},
 'edit-revision':{allows:state=>state.targetCurrent&&state.targetReady,
  denial:state=>state.targetCurrent?'请先暂停生成，再修改制作内容。':'请在制作确认前保存设置草稿。'},
 'save-revision':{allows:state=>state.targetCurrent&&state.targetReady,
  denial:state=>state.targetReady?'故事或版本已更新，请重新载入后再修改。':'这篇故事还没有进入制作，请稍后再修改。'},
 redraw:{allows:state=>state.targetCurrent&&state.targetReady,
  denial:state=>state.targetCurrent?'目前无法只重绘选中的画幅，请检查作品状态后重试。':'仅换图需要已完成的故事，且不能同时修改文字或设置。'},
 cover:{allows:state=>state.targetReady,denial:'指定首幅原图仅适用于已完成且审核通过的故事换画风。'},
 copy:{allows:state=>state.targetCurrent&&state.targetReady,
  denial:state=>state.targetCurrent?'只能复制已保存原文、分镜及已通过审核的故事；未通过的文本请显式选择草稿复制。':'只能复制已停止且已保存完整原文、分镜的故事。'},
 'copy-draft':{allows:state=>state.targetCurrent&&state.targetReady,
  denial:state=>state.targetCurrent?'草稿须有完整分镜、原文和已保存的审核检查点。':'只能复制已停止且已保存完整原文、分镜的故事。'},
} satisfies Record<ProductionCommand,{allows:(state:CommandState)=>boolean;denial:string|((state:CommandState)=>string)}>;
export const productionCommandEvents=Object.keys(commands) as ProductionCommand[];

export const commandRules:readonly {matches:(event:ProductionCommand,state:CommandState)=>boolean;decide:(event:ProductionCommand,state:CommandState)=>CommandDecision}[]=[
 {matches:(_,state)=>state.version!=='current',decide:()=>({allowed:false,status:409,message:'故事或版本已更新，请刷新后再操作。'})},
 {matches:(_,state)=>state.version==='current'&&state.stopping,decide:()=>({allowed:false,status:503,message:'制作服务正在停止，请稍后重试。'})},
 {matches:(event,state)=>state.version==='current'&&!state.stopping&&commands[event].allows(state),decide:()=>({allowed:true})},
 {matches:(event,state)=>state.version==='current'&&!state.stopping&&!commands[event].allows(state),decide:(event,state)=>{
  const {denial}=commands[event];
  return {allowed:false,status:409,message:typeof denial==='function'?denial(state):denial};
 }},
];

/** 回执已在调用方处理。对尚未接受的命令按当前状态与目标作唯一判定。 */
export function authorizeProductionCommand(event:ProductionCommand,state:CommandState):CommandDecision{
 return commandRules.find(rule=>rule.matches(event,state))!.decide(event,state);
}

export type SetupState={
 phase:StoryIntake['phase']|undefined;superseded:boolean;replacement:boolean;confirmed:boolean;
 generationCurrent:boolean;draftCurrent:boolean;selected:boolean;locked:boolean;candidateExists:boolean;
 search:Pick<IntakeSearch,'state'>;sameSearch:boolean;automatic:boolean;hasCandidates:boolean;searchLimit:boolean;
 combined:boolean;preparationReady:boolean;briefReady:boolean;
};
type SetupDecision={effect:'apply'|'noop'}|{effect:'reject';status:400|409;message:string};
const applySetup={effect:'apply'} as const;
const noSetupChange={effect:'noop'} as const;
const rejectSetup=(message:string,status:400|409=409):SetupDecision=>({effect:'reject',status,message});
export const setupEvents=['conditions','search','more','choose','draft','recommend','confirm'] as const satisfies readonly IntakeAction['action'][];

/** 已接受的回执由调用方重放。此处判定新查找、选题与确认前的操作。 */
export function authorizeSetup(event:IntakeAction['action'],state:SetupState):SetupDecision{
 const {phase}=state;
 if(state.replacement&&event!=='more'&&event!=='search'&&event!=='conditions')
  return rejectSetup('请在替换选题窗口提交选择；草稿不能开始制作。');
 if(!phase)return rejectSetup('这篇故事使用旧制作流程，请继续原来的步骤。');
 if(state.superseded)return rejectSetup('这篇故事已被替换，请打开书架当前版本。');
 if(event==='more'){
  if(state.selected&&state.combined)return rejectSetup('原文已选定，请继续准备故事。');
  if(state.search.state==='searching'||state.search.state==='idle'&&state.sameSearch||
    state.automatic&&(state.selected||phase!=='choosing'||state.search.state!=='idle'||!state.hasCandidates))return noSetupChange;
 }else if(!state.generationCurrent)return rejectSetup('制作内容已由另一次操作更新，请重新打开后继续。');
 if(state.confirmed||phase==='confirmed')return rejectSetup('制作已确认；需要调整时请创建修订版本。');
 if(event==='more')return state.searchLimit?rejectSetup('已保存40批候选，请回看选择，或新建其他书籍与主题。',400):applySetup;
 if(event==='conditions'||event==='search'){
  const stagedReplacement=event==='conditions'&&state.replacement&&phase==='preparing';
  if(!stagedReplacement&&(state.selected||phase!=='discovering'&&phase!=='choosing'))
   return rejectSetup(event==='conditions'?'这篇故事已经选定，不能修改提取条件。':'这篇故事已经选定，请在重选草稿中修改提取标题。');
  if(state.locked)return rejectSetup(event==='conditions'?'当前任务正在保存，请稍后再修改提取条件。':'当前任务正在保存，请稍后再修改提取标题。');
  return applySetup;
 }
 if(!state.draftCurrent)return rejectSetup('另一台设备更新了制作内容。请查看最新草稿后再操作。');
 if(event==='draft')return phase==='preparing'||phase==='confirming'?applySetup:rejectSetup('请先选择故事。');
 if(state.locked)return rejectSetup('当前任务正在保存，请稍后再修改选择。');
 if(event==='choose')return state.candidateExists?applySetup:rejectSetup('请选择已保存的候选故事。',400);
 if(!state.selected||phase!=='confirming')return rejectSetup('请先选择故事并等待制作建议保存。');
 if(event==='recommend')return applySetup;
 if(!state.preparationReady)return rejectSetup('原文和制作建议尚未保存。');
 return state.briefReady?applySetup:rejectSetup('故事摘要尚未对照原文核对，请重新准备制作。');
}

export function authorizeReselectionCancel(target:'draft'|'promoted'|'foreign'):SetupDecision{
 if(target==='foreign')return rejectSetup('草稿不属于这篇故事。');
 return target==='draft'?applySetup:noSetupChange;
}

export function authorizeReselectionCommit(state:{
 draftCurrent:boolean;generationCurrent:boolean;basisCurrent:boolean;requirementsCurrent:boolean;candidateExists:boolean;
}):SetupDecision{
 if(!state.draftCurrent)return rejectSetup('这不是当前故事的重选草稿。');
 if(!state.generationCurrent)return rejectSetup('选材条件已更新，请重新选择。');
 if(!state.basisCurrent)return rejectSetup('当前选题或制作设置已更新，请保留草稿并重新核对。');
 if(!state.requirementsCurrent)return rejectSetup('原故事的制作或验收要求已更新，请重新打开选题。');
 return state.candidateExists?applySetup:rejectSetup('请选择已保存的候选故事。',400);
}
