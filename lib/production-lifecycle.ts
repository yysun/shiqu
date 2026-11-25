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
export type ProductionReviewAttention=Attention|{target:string;reason:'replan'};
export type ProductionActionOffer=
 {event:ProductionControlEvent|'continue'|'apply-model'|'reprepare'}|
 {event:'retry'|'continue-repair'|'skip-review'|'override-review';faultId:string}|
 {event:SetupEvent;generation:number}|
 {event:'image-health';page:number}|
 {event:StoryCommand|'delete'|'restore'}|
 {event:'cancel-reselection'|'commit-reselection';parentId:string;generation:number};
export type ProductionService='available'|'unconfigured'|'snapshot-unavailable'|'credentials-invalid'|'quota-exhausted'|'rate-limited'|'stopping';
export const productionServiceMessages={
 unconfigured:'当前制作服务未配置或处于只读模式。',
 'snapshot-unavailable':'快照服务不可用，请恢复原模型服务或应用当前模型设置。',
 'credentials-invalid':'模型服务登录或密钥失效，请检查生成服务设置。',
 'quota-exhausted':'模型服务额度不足，请恢复额度或更换服务。',
 'rate-limited':'模型服务正在限流，请稍后继续。',
 stopping:'制作服务正在停止。',
};
export type ProductionLifecycle={
 phase:'selection'|'preparation'|'confirmation'|'production'|'completed';
 version:'current'|'superseded'|'deleted';
 preparationRefresh:'pending'|'none';
 replacementDraft:'open'|'none';
 control:GenerationControl;
 continuation:boolean;
 /** 已完成作品仍有可选工作（刷新建议、横图）待做。 */
 optionalWork:boolean;
 draining:boolean;
 faults:ProductionFault[];
 reviewAttention:ProductionReviewAttention[];
 review:'approved'|'attention'|'pending'|null;
 service:ProductionService;
 imageAvailability:'available'|'unavailable';
 imageChecks:ProductionImageCheck[];
 actions:ProductionActionOffer[];
 activity:{state:'running';jobs:ProductionActivity[]}|{state:'queued'|'idle'};
};

export function offersProductionAction(session:Pick<SessionView,'lifecycle'>,event:ProductionActionOffer['event'],legacy=true){
 return session.lifecycle?.actions.some(action=>action.event===event)??legacy;
}

export function preparationRefreshFault(session:Pick<SessionView,'lifecycle'>){
 return session.lifecycle?.preparationRefresh==='pending'?
  session.lifecycle.faults.find(fault=>fault.stage==='prepare'&&fault.state==='pending'):undefined;
}

export function recoveryFaultId(session:Pick<SessionView,'lifecycle'|'faults'>,requested?:string){
 const offers=session.lifecycle?.actions;
 if(offers){
  for(const offer of offers){
   if((offer.event==='retry'||offer.event==='continue-repair')&&(!requested||offer.faultId===requested))return offer.faultId;
  }
  return undefined;
 }
 return session.faults?.find(fault=>fault.retryAllowed&&(!requested||fault.id===requested))?.id;
}

type ActivityJob={id:string;kind:string;payload:string;state:string;lease_until:number;updated_at:number;attempts:number};
type ActivityInput=Pick<SessionView,'state'|'intake'|'generationControl'|'awaitingContinue'> & {
 complete?:boolean;superseded:boolean;deleted?:boolean;replacementOpen:boolean;queued:boolean;faults:ProductionFault[];
 reviewAttention:ProductionReviewAttention[];review:ProductionLifecycle['review'];service:ProductionService;now:number;order:readonly string[];
 pendingImageChecks:ProductionImageCheck[];optionalWork:boolean;modelApplicable:boolean;canReprepare:boolean;repreparing:boolean;stopping:boolean;
 freeImageRecoveries:ReadonlySet<string>;
 reviewBlockId?:string;canOverrideReview:boolean;reviewSkipId?:string;
 setup?:{state:SetupState;generation:number};
 storyActions?:{event:StoryCommand;ready:boolean}[];
 replacement?:{parentId:string;generation:number;commit:ReselectionCommitState};
 imagePages?:number[];
 owned?:boolean;
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
 return {phase,version:input.deleted?'deleted':input.superseded?'superseded':'current',preparationRefresh:input.repreparing?'pending':'none',replacementDraft:input.replacementOpen?'open':'none',control,continuation:!!input.awaitingContinue,optionalWork:input.optionalWork,
  faults:input.faults,reviewAttention:input.reviewAttention,review:input.review,service:input.service,
  imageAvailability:waiting.length?'unavailable':'available',imageChecks:[...input.pendingImageChecks,...waiting],
  actions:productionActionOffers(input,control),
  draining:running.length>0&&(control!=='active'||input.superseded||!!input.deleted),
  activity:running.length?{state:'running',jobs:running}:{state:input.queued&&control==='active'&&!input.deleted&&!input.superseded&&!input.awaitingContinue?'queued':'idle'}};
}

function productionActionOffers(input:ActivityInput,control:GenerationControl):ProductionActionOffer[]{
 if(input.deleted)return authorizeLibraryControl({event:'restore',owned:!!input.owned,deleted:true})==='restore'?[{event:'restore'}]:[];
 const state:CommandState={version:input.superseded?'superseded':'current',control,continuation:!!input.awaitingContinue,
  stopping:input.stopping,targetCurrent:true,targetReady:true};
 const configured=input.service!=='unconfigured',actions:ProductionActionOffer[]=[];
 const allowed=(event:ProductionCommand,ready=true)=>authorizeProductionCommand(event,{...state,targetReady:ready}).allowed;
 for(const event of productionControlEvents){
  if(event==='resume'&&state.control==='active')continue;
  if((event!=='resume'||configured)&&allowed(event,input.state!=='completed'||input.optionalWork||input.repreparing))actions.push({event});
 }
 if(configured&&allowed('continue'))actions.push({event:'continue'});
 if(input.modelApplicable&&allowed('apply-model'))actions.push({event:'apply-model'});
 if(configured&&allowed('reprepare',input.canReprepare))actions.push({event:'reprepare'});
 if(input.reviewBlockId){
  if(configured&&allowed('continue-repair',input.reviewAttention.some(reason=>reason.reason==='limit')))actions.push({event:'continue-repair',faultId:input.reviewBlockId});
  if(configured&&allowed('override-review',input.canOverrideReview))actions.push({event:'override-review',faultId:input.reviewBlockId});
 }
 if(input.reviewSkipId&&allowed('skip-review'))actions.push({event:'skip-review',faultId:input.reviewSkipId});
 for(const fault of input.faults){
  if(fault.scope==='required'&&fault.state==='pending'&&fault.retryAllowed&&(configured||input.freeImageRecoveries.has(fault.id))&&allowed('retry'))
   actions.push({event:'retry',faultId:fault.id});
 }
 if(input.setup){
  for(const event of setupEvents){
   if(authorizeSetup(event,input.setup.state).effect==='apply')actions.push({event,generation:input.setup.generation});
  }
 }
 for(const {event,ready} of input.storyActions??[]){
  if(authorizeProductionCommand(event,{...state,targetReady:ready,stopping:event==='start-landscape'||event==='retry-landscape'?state.stopping:false}).allowed)actions.push({event});
 }
 const replacement=input.replacement;
 if(replacement){
  const {parentId,generation,commit}=replacement;
  if(authorizeReselectionCancel('draft').effect==='apply')actions.push({event:'cancel-reselection',parentId,generation});
  if(authorizeReselectionCommit(commit).effect==='apply')actions.push({event:'commit-reselection',parentId,generation});
 }
 if(authorizeProductionCommand('image-health',{...state,stopping:false}).allowed){
  for(const page of input.imagePages??[])actions.push({event:'image-health',page});
 }
 if(authorizeLibraryControl({event:'delete',owned:!!input.owned})==='delete')actions.push({event:'delete'});
 return actions;
}

const phases:Record<string,Step['kind']>={
 discover:'discover',verifySource:'source',prepareArt:'recommend',prepareSuggestions:'recommend',
 prepareBrief:'plan',characters:'plan',outline:'plan',registerItems:'plan',sceneBatch:'plan',visual:'plan',
 restyle:'restyle',ending:'reflection',frameCheck:'review',review:'review',draw:'image',drawLandscape:'image',
 sceneRepair:'repair',visualRepair:'repair',structureRepair:'repair',endingRepair:'repair',
};
const labels:Record<string,string>={
 prepareSuggestions:'准备制作建议',
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

export const productionControlEvents=['pause','stop','resume'] as const;
export type ProductionControlEvent=(typeof productionControlEvents)[number];
export type ProductionCommand='continue'|'retry'|'continue-repair'|'skip-review'|'override-review'|'apply-model'|'reprepare'|'image-health'|'start-landscape'|'retry-landscape'|'open-reselection'|'edit-revision'|'save-revision'|'edit-review-notes'|'redraw'|'cover'|'copy'|'copy-draft'|ProductionControlEvent;
type SetupEvent=IntakeAction['action'];
type StoryCommand=Extract<ProductionCommand,'open-reselection'|'edit-revision'|'save-revision'|'edit-review-notes'|'redraw'|'cover'|'copy'|'copy-draft'|'start-landscape'|'retry-landscape'>;
type CommandState={
 version:DispatchState['version'];control:GenerationControl;continuation:boolean;
 targetCurrent:boolean;targetReady:boolean;stopping:boolean;
};
const commandEffects={
 pause:{kind:'control',control:'paused'},
 stop:{kind:'control',control:'stopped'},
 resume:{kind:'control',control:'active'},
 continue:{kind:'continue-revision'},retry:{kind:'recover-fault'},
 'continue-repair':{kind:'grant-repair-budget'},'skip-review':{kind:'save-skipped-review'},'override-review':{kind:'release-review-target'},
 'apply-model':{kind:'replace-model-snapshot'},reprepare:{kind:'refresh-preparation'},'image-health':{kind:'probe-image'},
 'start-landscape':{kind:'queue-landscape'},'retry-landscape':{kind:'recover-landscape'},'open-reselection':{kind:'create-selection-draft'},
 'edit-revision':{kind:'read-edit-basis'},'save-revision':{kind:'publish-revision'},'edit-review-notes':{kind:'save-review-notes'},
 redraw:{kind:'queue-redraw'},cover:{kind:'save-cover'},copy:{kind:'copy-reviewed'},'copy-draft':{kind:'copy-text-draft'},
} as const satisfies Record<ProductionCommand,{kind:string;control?:GenerationControl}>;
type CommandEffect=(typeof commandEffects)[ProductionCommand];
type CommandDecision={allowed:true;effect:CommandEffect}|{allowed:false;status:409|503;message:string};

const controlCommand={allows:(state:CommandState)=>state.targetReady,denial:'故事已完成或版本已更新，请刷新后再操作。'};
const landscapeCommand={allows:(state:CommandState)=>state.targetCurrent&&state.targetReady,
 denial:(state:CommandState)=>state.targetReady?'横图状态已更新，请刷新后再操作。':'请先完成当前版本的竖版插图。'};
const commands={
 reprepare:{allows:(state:CommandState)=>state.targetCurrent&&state.targetReady&&!state.continuation,
  denial:'请先确认制作并保存原文。已有准备任务时，请等待或重试该任务。'},
 pause:controlCommand,
 stop:controlCommand,
 resume:{allows:(state:CommandState)=>(state.control!=='active'||state.continuation)&&state.targetReady,denial:'当前制作没有暂停，或版本已更新。'},
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
 'edit-review-notes':{allows:state=>state.targetCurrent&&state.targetReady,denial:'请打开当前版本的完整稿件后重新修改审核意见。'},
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
 {matches:(event,state)=>state.version==='current'&&!state.stopping&&commands[event].allows(state),decide:event=>({allowed:true,effect:commandEffects[event]})},
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

type GuardedClause<Input,Decision>={id:string;when:(input:Input)=>boolean;decision:Decision};

/** 让每条规则显式排除先发生的拒绝或幂等结果，守卫可枚举且不会重复命中。 */
function exclusiveRules<Input,Decision>(clauses:readonly GuardedClause<Input,Decision>[]){
 return clauses.map(({id,when,decision},index)=>{
  const earlier=clauses.slice(0,index);
  return {id,decision,matches:(input:Input)=>when(input)&&!earlier.some(clause=>clause.when(input))};
 });
}
type SetupInput={event:IntakeAction['action'];state:SetupState};
const browsing=(event:SetupInput['event'])=>event==='conditions'||event==='search'||event==='more';
const selecting=(state:SetupState)=>state.phase==='discovering'||state.phase==='choosing';
const preparing=(state:SetupState)=>state.phase==='preparing'||state.phase==='confirming';
const canChangeScope=({event,state}:SetupInput)=>event==='conditions'&&state.replacement&&state.phase==='preparing'||!state.selected&&selecting(state);
const setupClauses:GuardedClause<SetupInput,SetupDecision>[]=[
 {id:'replacement',when:({event,state})=>state.replacement&&!browsing(event),decision:rejectSetup('请在替换选题窗口提交选择；草稿不能开始制作。')},
 {id:'legacy',when:({state})=>!state.phase,decision:rejectSetup('这篇故事使用旧制作流程，请继续原来的步骤。')},
 {id:'superseded',when:({state})=>state.superseded,decision:rejectSetup('这篇故事已被替换，请打开书架当前版本。')},
 {id:'combined-source',when:({event,state})=>event==='more'&&state.selected&&state.combined,decision:rejectSetup('原文已选定，请继续准备故事。')},
 {id:'search-already-handled',when:({event,state})=>event==='more'&&(state.search.state==='searching'||state.search.state==='idle'&&state.sameSearch||
  state.automatic&&(state.selected||state.phase!=='choosing'||state.search.state!=='idle'||!state.hasCandidates)),decision:noSetupChange},
 {id:'generation',when:({event,state})=>event!=='more'&&!state.generationCurrent,decision:rejectSetup('制作内容已由另一次操作更新，请重新打开后继续。')},
 {id:'confirmed',when:({state})=>state.confirmed||state.phase==='confirmed',decision:rejectSetup('制作已确认；需要调整时请创建修订版本。')},
 {id:'search-limit',when:({event,state})=>event==='more'&&state.searchLimit,decision:rejectSetup('已保存40批候选，请回看选择，或新建其他书籍与主题。',400)},
 {id:'conditions-after-choice',when:input=>input.event==='conditions'&&!canChangeScope(input),decision:rejectSetup('这篇故事已经选定，不能修改提取条件。')},
 {id:'title-after-choice',when:input=>input.event==='search'&&!canChangeScope(input),decision:rejectSetup('这篇故事已经选定，请在重选草稿中修改提取标题。')},
 {id:'conditions-locked',when:({event,state})=>event==='conditions'&&state.locked,decision:rejectSetup('当前任务正在保存，请稍后再修改提取条件。')},
 {id:'title-locked',when:({event,state})=>event==='search'&&state.locked,decision:rejectSetup('当前任务正在保存，请稍后再修改提取标题。')},
 {id:'draft-token',when:({event,state})=>!browsing(event)&&!state.draftCurrent,decision:rejectSetup('另一台设备更新了制作内容。请查看最新草稿后再操作。')},
 {id:'draft-needs-choice',when:({event,state})=>event==='draft'&&!preparing(state),decision:rejectSetup('请先选择故事。')},
 {id:'selection-locked',when:({event,state})=>!browsing(event)&&event!=='draft'&&state.locked,decision:rejectSetup('当前任务正在保存，请稍后再修改选择。')},
 {id:'candidate-missing',when:({event,state})=>event==='choose'&&!state.candidateExists,decision:rejectSetup('请选择已保存的候选故事。',400)},
 {id:'choice-not-prepared',when:({event,state})=>(event==='confirm'||event==='recommend')&&(!state.selected||state.phase!=='confirming'),
  decision:rejectSetup('请先选择故事并等待制作建议保存。')},
 {id:'preparation-missing',when:({event,state})=>event==='confirm'&&!state.preparationReady,decision:rejectSetup('原文和制作建议尚未保存。')},
 {id:'brief-unverified',when:({event,state})=>event==='confirm'&&!state.briefReady,decision:rejectSetup('故事摘要尚未对照原文核对，请重新准备制作。')},
 {id:'apply',when:()=>true,decision:applySetup},
];
export const setupRules=exclusiveRules(setupClauses);

/** 已接受的回执由调用方重放。此处判定新查找、选题与确认前的操作。 */
export function authorizeSetup(event:IntakeAction['action'],state:SetupState):SetupDecision{
 const input={event,state};
 return setupRules.find(rule=>rule.matches(input))!.decision;
}

type ReselectionTarget='draft'|'promoted'|'foreign';
export const reselectionCancelRules=exclusiveRules<ReselectionTarget,SetupDecision>([
 {id:'foreign',when:target=>target==='foreign',decision:rejectSetup('草稿不属于这篇故事。')},
 {id:'draft',when:target=>target==='draft',decision:applySetup},
 {id:'promoted',when:target=>target==='promoted',decision:noSetupChange},
]);

export function authorizeReselectionCancel(target:ReselectionTarget):SetupDecision{
 return reselectionCancelRules.find(rule=>rule.matches(target))!.decision;
}

type ReselectionCommitState={
 draftCurrent:boolean;generationCurrent:boolean;basisCurrent:boolean;requirementsCurrent:boolean;candidateExists:boolean;
};
export const reselectionCommitRules=exclusiveRules<ReselectionCommitState,SetupDecision>([
 {id:'draft',when:state=>!state.draftCurrent,decision:rejectSetup('这不是当前故事的重选草稿。')},
 {id:'generation',when:state=>!state.generationCurrent,decision:rejectSetup('选材条件已更新，请重新选择。')},
 {id:'basis',when:state=>!state.basisCurrent,decision:rejectSetup('当前选题或制作设置已更新，请保留草稿并重新核对。')},
 {id:'requirements',when:state=>!state.requirementsCurrent,decision:rejectSetup('原故事的制作或验收要求已更新，请重新打开选题。')},
 {id:'candidate',when:state=>!state.candidateExists,decision:rejectSetup('请选择已保存的候选故事。',400)},
 {id:'apply',when:()=>true,decision:applySetup},
]);

export function authorizeReselectionCommit(state:ReselectionCommitState):SetupDecision{
 return reselectionCommitRules.find(rule=>rule.matches(state))!.decision;
}

type LibraryControlState={event:'delete';owned:boolean}|{event:'restore';owned:boolean;deleted:boolean};
type LibraryControlDecision='delete'|'restore'|'noop'|'missing';
export const libraryControlRules=exclusiveRules<LibraryControlState,LibraryControlDecision>([
 {id:'missing',when:state=>!state.owned,decision:'missing'},
 {id:'delete',when:state=>state.event==='delete',decision:'delete'},
 {id:'restore',when:state=>state.event==='restore'&&state.deleted,decision:'restore'},
 {id:'visible',when:()=>true,decision:'noop'},
]);

export function authorizeLibraryControl(state:LibraryControlState):LibraryControlDecision{
 return libraryControlRules.find(rule=>rule.matches(state))!.decision;
}

type JobLeaseState={event:'paid-send'|'settle';held:boolean;expired:boolean};
export const jobLeaseRules=exclusiveRules<JobLeaseState,DispatchDecision>([
 {id:'lease-lost',when:state=>!state.held,decision:'obsolete'},
 {id:'send-expired',when:state=>state.event==='paid-send'&&state.expired,decision:'yield'},
 {id:'retained-lease',when:()=>true,decision:'allow'},
]);
export function authorizeJobLease(state:JobLeaseState):DispatchDecision{
 return jobLeaseRules.find(rule=>rule.matches(state))!.decision;
}

type JobFailureState={persistence:boolean;yielded:boolean;stopping:boolean;drains:boolean;terminal:boolean;timeout:boolean;contentBlocked:boolean};
type JobFailureDecision='unsaved'|'yield'|'interrupted'|'content-blocked'|'failed';
export const jobFailureRules=exclusiveRules<JobFailureState,JobFailureDecision>([
 {id:'persistence',when:state=>state.persistence,decision:'unsaved'},
 {id:'yielded',when:state=>state.yielded,decision:'yield'},
 {id:'content-blocked',when:state=>state.contentBlocked,decision:'content-blocked'},
 {id:'interrupted',when:state=>state.timeout||state.stopping&&!state.drains&&!state.terminal,decision:'interrupted'},
 {id:'failure',when:()=>true,decision:'failed'},
]);
export function classifyJobFailure(state:JobFailureState):JobFailureDecision{
 return jobFailureRules.find(rule=>rule.matches(state))!.decision;
}

type RuntimeServiceState={configured:boolean;stopping:boolean;snapshotAvailable:boolean};
export const runtimeServiceRules=exclusiveRules<RuntimeServiceState,ProductionService>([
 {id:'unconfigured',when:state=>!state.configured,decision:'unconfigured'},
 {id:'stopping',when:state=>state.stopping,decision:'stopping'},
 {id:'snapshot-unavailable',when:state=>!state.snapshotAvailable,decision:'snapshot-unavailable'},
 {id:'available',when:()=>true,decision:'available'},
]);
export function resolveProductionService(state:RuntimeServiceState):ProductionService{
 return runtimeServiceRules.find(rule=>rule.matches(state))!.decision;
}

type ImageReadState={result:'missing'|'readable'|'unavailable';fault:boolean};
export const imageReadRules=exclusiveRules<ImageReadState,'defer'|'mark-lost'|'restore-readable'|'preserve'>([
 {id:'defer',when:state=>state.result==='unavailable',decision:'defer'},
 {id:'mark-lost',when:state=>state.result==='missing',decision:'mark-lost'},
 {id:'restore-readable',when:state=>state.fault,decision:'restore-readable'},
 {id:'preserve',when:()=>true,decision:'preserve'},
]);
export function resolveImageRead(state:ImageReadState){
 return imageReadRules.find(rule=>rule.matches(state))!.decision;
}

type InterruptedJobState={running:boolean;localLease:boolean;resume:boolean};
export const interruptedJobRules=exclusiveRules<InterruptedJobState,'requeue'|'fail'|'preserve'>([
 {id:'local-lease',when:state=>state.running&&state.localLease,decision:'preserve'},
 {id:'requeue',when:state=>state.resume,decision:'requeue'},
 {id:'fail',when:state=>state.running,decision:'fail'},
 {id:'already-failed',when:()=>true,decision:'preserve'},
]);
export function resolveInterruptedJob(state:InterruptedJobState){
 return interruptedJobRules.find(rule=>rule.matches(state))!.decision;
}
