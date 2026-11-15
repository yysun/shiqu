// Present saved production checkpoints consistently without dispatching work or inferring review approval.
// 选材阶段：候选已保存但尚未选中时，提取步骤保持进行中并提示待选择故事。
import {readerStoryboardBatchSize} from './reader-limits.ts';
export type ProductionStageState='pending'|'current'|'done'|'skipped'|'unavailable'|'failed'|'paused';
export type ProductionStage={id:string;label:string;state:ProductionStageState;detail:string};
export type ProductionCheckpoint={reviewOverridden?:boolean|number|null;intakePhase?:string;candidateBatches?:number;planReady:boolean;sourceReady?:boolean;frameCountConfirmed?:boolean;phase?:string;storyboardFrames?:number|null;storyboardBatch?:{first:number;last:number};reviewStatus?:'pending'|'repair'|'passed'|'blocked'|null;reviewPhase?:'frames'|'full'|null;reviewRound?:number;repairCompleted?:number;repairTotal?:number;reviewAudits?:number;repairBatches?:number;repairPasses?:number;reviewStopReason?:'limit'|'unchanged'|'replan'|'requirements'};
type Input=ProductionCheckpoint&{phase?:string;total:number|null;ready:number;activeState?:'current'|'failed'|'paused';intakeSource?:'direct'|'combined'|'candidates';selectedSourceLabel?:string;intakeSelected?:boolean;preparedSummary?:boolean;estimatedFrames?:number};
export function productionStages(input:Input):ProductionStage[]{
 const {planReady,reviewStatus,reviewRound=0,repairCompleted=0,repairTotal=0,total,ready,activeState='current'}=input;
 const phase=input.phase||(!planReady?'plan':reviewStatus==='repair'?'repair':reviewStatus==='pending'||reviewStatus==='blocked'?'review':'image');
 const legacy=planReady&&!reviewStatus,passed=reviewStatus==='passed',blocked=reviewStatus==='blocked';
 const needsReplan=blocked&&input.reviewStopReason==='replan',requirementsBlocked=blocked&&input.reviewStopReason==='requirements';
 const requirementsRecheck=requirementsBlocked&&(input.reviewAudits??reviewRound)>1;
 const stoppedBeforeRepair=needsReplan||requirementsBlocked&&!requirementsRecheck;
 const rechecking=!needsReplan&&phase==='review'&&(reviewRound>0||!!input.repairPasses);
 const repaired=reviewStatus==='repair'||blocked||rechecking||!!input.repairPasses||passed&&reviewRound>1||!!input.reviewOverridden;
 const active=(at:boolean):ProductionStageState=>at?activeState:'pending';
 const restyling=phase==='restyle',canDraw=planReady&&(legacy||passed);
 const drawingDone=!restyling&&canDraw&&total!==null&&total>0&&ready>=total;
 const reviewState:ProductionStageState=stoppedBeforeRepair?'failed':legacy?'unavailable':passed||repaired?'done':active(phase==='review');
 const repairState:ProductionStageState=requirementsBlocked?(input.repairPasses?'done':'skipped'):stoppedBeforeRepair?'skipped':blocked&&input.reviewStopReason==='unchanged'?'failed':legacy?'unavailable':passed&&!repaired?'skipped':blocked||rechecking||passed&&repaired?'done':active(phase==='repair');
 const recheckState:ProductionStageState=stoppedBeforeRepair?'pending':blocked&&input.reviewStopReason==='unchanged'?'pending':legacy?'unavailable':passed?(repaired?'done':'skipped'):blocked?'failed':active(rechecking);
 const count=total===null?'':` / ${total}`;
 const batch=input.storyboardBatch||(!planReady&&input.storyboardFrames!=null&&total!==null&&input.storyboardFrames<total?{first:input.storyboardFrames+1,last:Math.min(input.storyboardFrames+readerStoryboardBatchSize,total)}:null);
 return [
  {id:'plan',label:'分批分镜',state:planReady?'done':active(phase==='plan'||phase==='reflection'),detail:phase==='reflection'?'完整分镜已保存，正在撰写结语':planReady?`${total===null?'全篇':total+' 幅'}分镜已保存`:batch?`已保存 ${input.storyboardFrames||0}${count} 幅分镜 · 当前第 ${batch.first}–${batch.last} 幅`:input.storyboardFrames!=null?`已保存 ${input.storyboardFrames}${count} 幅分镜`:'等待完整分镜返回'},
  {id:'review',label:input.reviewPhase==='frames'?'画幅数审核':'全篇审片',state:reviewState,detail:input.reviewOverridden?'未完成的审核由你确认跳过':input.reviewPhase==='frames'?'按原文任务核对缺失、重复与画幅分配':requirementsBlocked&&!requirementsRecheck?'验收要求存在冲突或无法判断':needsReplan?'主事件未完整收束，需要重新编排':legacy?'旧故事未启用审片':reviewState==='done'?(passed&&!repaired?'初审通过':'全篇审片已完成'):phase==='review'&&!rechecking?'检查分镜、跨批衔接与结语':'等待分镜与结语完成'},
  {id:'repair',label:'定向修订',state:repairState,detail:requirementsBlocked&&!input.repairPasses?(requirementsRecheck?'本次重新审核前未执行自动修订':'等待调整验收要求，未执行自动修订'):needsReplan?'整篇结构需重编，未执行局部修补':legacy?'旧故事未启用审片':repairState==='skipped'?'初审通过，无需修订':phase==='repair'?`第 ${(input.repairPasses||0)+1} 轮 · 已修订 ${repairCompleted} / ${repairTotal} 项`:repairState==='done'?typeof input.repairBatches==='number'?`已完成 ${input.repairBatches} 批定向修订`:'问题幅号已定向修订':'仅在审片发现问题时执行'},
  {id:'recheck',label:'复核',state:recheckState,detail:requirementsBlocked?(requirementsRecheck?'验收要求存在冲突或无法判断':'调整验收要求后重新审核'):needsReplan?'重新编排后再审核':legacy?'旧故事未启用审片':blocked?`仍有 ${repairTotal} 项待修订，绘图已阻止`:input.reviewOverridden?'未解决的问题由你确认放行':recheckState==='skipped'?'初审通过，无需复核':passed?`复核通过 · 已审核 ${input.reviewAudits??reviewRound} 次`:rechecking?(input.reviewPhase==='frames'?'正在复核画幅数与叙事任务':`正在第 ${(input.reviewAudits??reviewRound)+1} 次全篇审核`):'修订后重新审片'},
  {id:'image',label:'绘图',state:drawingDone?'done':active(canDraw&&(restyling||phase==='image')),detail:requirementsBlocked?'等待调整验收要求，绘图已阻止':needsReplan?'等待重新编排，绘图已阻止':blocked?'待继续修订，绘图已阻止':reviewStatus&&!passed?'等待审片通过':restyling?'按新画风转换画面提示词，完成后开始出图':total===null?`已保存 ${ready} 幅`:`${ready} / ${total} 幅画面已保存`},
 ];
}

export function productionSteps(input:Input):ProductionStage[]{
 const sourceReady=input.sourceReady??input.planReady,countReady=input.frameCountConfirmed??input.planReady;
 const activeState=input.activeState||'current',phase=input.phase||(!input.planReady?'plan':undefined);
 const intake=input.intakePhase;
 if(intake){
  const candidates=(input.intakeSource??'candidates')==='candidates',combined=input.intakeSource==='combined';
  const selected=!!input.intakeSelected||intake==='preparing'||intake==='confirming'||intake==='confirmed';
  const prepared=intake==='confirming'||intake==='confirmed';
  const sourceLabel=candidates?'提取故事':combined?'整理所选原文':'已选原文';
  // 候选已提取但还没选中时，选故事就是当前要做的事，提取步骤保持进行中。
  const choosing=candidates&&!selected&&intake==='choosing';
  const sourceDetail=candidates
   ?choosing?input.candidateBatches?`已保存 ${input.candidateBatches} 批候选 · 待选择故事`:'待开始提取'
   :selected||intake!=='discovering'?`已保存 ${input.candidateBatches||0} 批候选`:'正在寻找并保存候选故事'
   :sourceReady?input.selectedSourceLabel||'已保存原文':combined?'将所选原文整理为一篇故事':'等待保存原文';
  return [
   {id:'source',label:sourceLabel,state:candidates?intake==='discovering'||choosing?activeState:'done':sourceReady?'done':activeState,detail:sourceDetail},
   {id:'prepare',label:'准备故事',state:prepared?'done':intake==='preparing'&&(candidates||sourceReady)?activeState:'pending',detail:prepared?input.preparedSummary?'原文与梗概已核对':'原文与制作建议已保存':intake==='preparing'?'保存原文，核对梗概与制作建议':selected?'待准备这篇故事':'等待选材完成'},
   {id:'count',label:'制作确认',state:intake==='confirmed'?'done':intake==='confirming'?'current':'pending',detail:intake==='confirmed'?'制作内容已确认 · 幅数随编排与审核确定':intake==='confirming'?(input.estimatedFrames?`预计 ${input.estimatedFrames} 幅 · 最终幅数由编排与审核确定`:'确认画风、叙事详略、制作要求和验收要求'):'等待准备完成'},
   ...productionStages(input),
  ];
 }
 return [
  {id:'source',label:'确认原文',state:sourceReady?'done':phase==='source'||phase==='recommend'?activeState:'pending',detail:sourceReady?'已保存':'待完成'},
  {id:'count',label:'叙事详略与篇幅',state:countReady?'done':phase==='frame-count'||phase==='recommend'&&sourceReady?activeState:'pending',detail:countReady&&input.total!==null?`${input.total} 幅`:'待确定'},
  ...productionStages(input),
 ];
}
