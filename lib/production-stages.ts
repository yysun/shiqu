// 制作时间线根据已保存的检查点显示进度。准备和确认共用一行。
// 选材阶段：候选已保存但尚未选中时，提取步骤保持进行中并提示待选择故事。
import {readerStoryboardBatchSize} from './reader-limits.ts';
export type ProductionStageState='pending'|'current'|'done'|'skipped'|'unavailable'|'failed'|'paused';
export type ProductionStage={id:string;label:string;state:ProductionStageState;detail:string;durationLabel?:string};
export type ProductionCheckpoint={reviewOverridden?:boolean|number|null;intakePhase?:string;candidateBatches?:number;planReady:boolean;sourceReady?:boolean;frameCountConfirmed?:boolean;phase?:string;storyboardFrames?:number|null;storyboardBatch?:{first:number;last:number};reviewStatus?:'pending'|'repair'|'passed'|'blocked'|null;reviewPhase?:'frames'|'full'|null;reviewRound?:number;repairCompleted?:number;repairTotal?:number;reviewAudits?:number;repairBatches?:number;repairPasses?:number;reviewStopReason?:'limit'|'unchanged'|'replan'|'requirements'};
type Input=ProductionCheckpoint&{phase?:string;total:number|null;ready:number;activity?:string;activeState?:'current'|'failed'|'paused';intakeSource?:'direct'|'combined'|'candidates';selectedSourceLabel?:string;intakeSelected?:boolean;preparedSummary?:boolean;estimatedFrames?:number};
export function productionStages(input:Input):ProductionStage[]{
 const {planReady,reviewStatus,reviewRound=0,repairCompleted=0,repairTotal=0,total,ready,activeState='current'}=input;
 const phase=input.phase||(!planReady?'plan':reviewStatus==='repair'?'repair':reviewStatus==='pending'||reviewStatus==='blocked'?'review':'image');
 const legacy=planReady&&!reviewStatus,passed=reviewStatus==='passed',blocked=reviewStatus==='blocked';
 const needsReplan=blocked&&input.reviewStopReason==='replan',requirementsBlocked=blocked&&input.reviewStopReason==='requirements';
 const requirementsRecheck=requirementsBlocked&&(input.reviewAudits??reviewRound)>1;
 const stoppedBeforeRepair=needsReplan||requirementsBlocked&&!requirementsRecheck;
 const rechecking=!needsReplan&&phase==='review'&&(input.activity?(input.repairPasses??0)>0:reviewRound>0||!!input.repairPasses);
 const repaired=reviewStatus==='repair'||blocked||rechecking||!!input.repairPasses||passed&&reviewRound>1||!!input.reviewOverridden;
 const active=(at:boolean):ProductionStageState=>at?activeState:'pending';
 const restyling=phase==='restyle',canDraw=planReady&&(legacy||passed);
 // 转换后仍待审片时，画风转换排在审片之前。
 const restyleReview=restyling&&!!reviewStatus&&!passed;
 const drawingDone=!restyling&&canDraw&&total!==null&&total>0&&ready>=total;
 const reviewState:ProductionStageState=stoppedBeforeRepair?'failed':legacy?'unavailable':passed||repaired?'done':active(phase==='review');
 const repairState:ProductionStageState=requirementsBlocked?(input.repairPasses?'done':'skipped'):stoppedBeforeRepair?'skipped':blocked&&input.reviewStopReason==='unchanged'?'failed':legacy?'unavailable':passed&&!repaired?'skipped':blocked||rechecking||passed&&repaired?'done':active(phase==='repair');
 const recheckState:ProductionStageState=stoppedBeforeRepair?'pending':blocked&&input.reviewStopReason==='unchanged'?'pending':legacy?'unavailable':passed?(repaired?'done':'skipped'):blocked?'failed':active(rechecking);
 const count=total===null?'':` / ${total}`;
 const batch=input.storyboardBatch||(!planReady&&input.storyboardFrames!=null&&total!==null&&input.storyboardFrames<total?{first:input.storyboardFrames+1,last:Math.min(input.storyboardFrames+readerStoryboardBatchSize,total)}:null);
 const planning=phase==='plan'||phase==='reflection';
 const planningDetail=input.activity&&planning?`${input.activity} · ${total===null?'新画幅数待编排':`已保存 ${input.storyboardFrames??0}${count} 幅叙事分镜`}`:undefined;
 // 全篇审核序号取留存的审核记录。自动修订计数会在手动继续时重置。
 const audits=input.reviewAudits;
 const repairProgress=`已修订 ${repairCompleted} / ${repairTotal} 项`;
 const repairDetail=input.reviewPhase==='frames'?`按画幅数审核修订 · ${repairProgress}`:audits?`按第 ${audits} 次全篇审核修订 · ${repairProgress}`:repairProgress;
 const recheckDetail=input.reviewPhase==='frames'?'正在复核画幅数与叙事任务':audits===undefined?'正在全篇复核':`正在第 ${audits+1} 次全篇审核`;
 const stages:ProductionStage[]=[
  {id:'plan',label:'分批分镜',state:planReady?'done':active(planning),detail:planningDetail??(phase==='reflection'?'完整分镜已保存，正在撰写结语':planReady?`${total===null?'全篇':total+' 幅'}分镜已保存`:batch?`已保存 ${input.storyboardFrames||0}${count} 幅分镜 · 当前第 ${batch.first}–${batch.last} 幅`:input.storyboardFrames!=null?`已保存 ${input.storyboardFrames}${count} 幅分镜`:'等待完整分镜返回')},
  {id:'review',label:input.reviewPhase==='frames'?'画幅数审核':'全篇审片',state:reviewState,detail:input.reviewOverridden?'未完成的审核由你确认跳过':restyling&&reviewState==='pending'?'等待画风转换完成':input.reviewPhase==='frames'?'按原文任务核对缺失、重复与画幅分配':requirementsBlocked&&!requirementsRecheck?'验收要求存在冲突或无法判断':needsReplan?'主事件未完整收束，需要重新编排':legacy?'旧故事未启用审片':reviewState==='done'?(passed&&!repaired?'初审通过':'全篇审片已完成'):phase==='review'&&!rechecking?'检查分镜、跨批衔接与结语':'等待分镜与结语完成'},
  {id:'repair',label:'定向修订',state:repairState,detail:requirementsBlocked&&!input.repairPasses?(requirementsRecheck?'本次重新审核前未执行自动修订':'等待调整验收要求，未执行自动修订'):needsReplan?'整篇结构需重编，未执行局部修补':legacy?'旧故事未启用审片':repairState==='skipped'?'初审通过，无需修订':phase==='repair'?repairDetail:repairState==='done'?typeof input.repairBatches==='number'?`已完成 ${input.repairBatches} 批定向修订`:'问题幅号已定向修订':'仅在审片发现问题时执行'},
  {id:'recheck',label:'复核',state:recheckState,detail:requirementsBlocked?(requirementsRecheck?'验收要求存在冲突或无法判断':'调整验收要求后重新审核'):needsReplan?'重新编排后再审核':legacy?'旧故事未启用审片':blocked?`仍有 ${repairTotal} 项待修订，绘图已阻止`:input.reviewOverridden?'未解决的问题由你确认放行':recheckState==='skipped'?'初审通过，无需复核':passed?(audits?`复核通过 · 全篇审核 ${audits} 次`:'复核通过'):rechecking?recheckDetail:'修订后重新审片'},
  {id:'image',label:'绘图',state:drawingDone?'done':active(canDraw&&phase==='image'),detail:restyling?(restyleReview?'等待审片通过':'等待画风转换完成'):requirementsBlocked?'等待调整验收要求，绘图已阻止':needsReplan?'等待重新编排，绘图已阻止':blocked?'待继续修订，绘图已阻止':reviewStatus&&!passed?'等待审片通过':total===null?`已保存 ${ready} 幅`:`${ready} / ${total} 幅画面已保存`},
 ];
 if(!restyling)return stages;
 // 画风转换单列一行，放在它实际执行的位置：需要重审时排在审片之前，否则排在绘图之前。
 const restyle:ProductionStage={id:'restyle',label:'画风转换',state:active(true),detail:`${input.activity||(restyleReview?'按新画风转换画面描述':'按新画风转换画面提示词')}，完成后${restyleReview?'重新审片':'开始出图'}`};
 stages.splice(stages.findIndex(stage=>stage.id===(restyleReview?'review':'image')),0,restyle);
 return stages;
}

export function productionSteps(input:Input):ProductionStage[]{
 const sourceReady=input.sourceReady??input.planReady,countReady=input.frameCountConfirmed??input.planReady;
 const activeState=input.activeState||'current',phase=input.phase||(!input.planReady?'plan':undefined);
 const intake=input.intakePhase;
 if(intake){
  const candidates=(input.intakeSource??'candidates')==='candidates',combined=input.intakeSource==='combined';
  const selected=!!input.intakeSelected||intake==='preparing'||intake==='confirming'||intake==='confirmed';
  const prepared=intake==='confirming'||intake==='confirmed';
  const confirmed=intake==='confirmed';
  const sourceLabel=candidates?'提取故事':combined?'整理所选原文':'已选原文';
  // 候选已提取但还没选中时，选故事就是当前要做的事，提取步骤保持进行中。
  const choosing=candidates&&!selected&&intake==='choosing';
  const sourceDetail=candidates
   ?choosing?input.candidateBatches?`已保存 ${input.candidateBatches} 批候选 · 待选择故事`:'待开始提取'
   :selected||intake!=='discovering'?`已保存 ${input.candidateBatches||0} 批候选`:'正在寻找并保存候选故事'
   :sourceReady?input.selectedSourceLabel||'已保存原文':combined?'将所选原文整理为一篇故事':'等待保存原文';
  const preparationDetail=input.preparedSummary?'原文与梗概已核对':'原文与制作建议已保存';
  const confirmationDetail=input.estimatedFrames?`预计 ${input.estimatedFrames} 幅 · 最终幅数由编排与审核确定`:'确认画风、叙事详略、制作要求和验收要求';
  const setupDetail=confirmed?`${preparationDetail} · 制作内容已确认`
   :prepared?confirmationDetail
   :intake==='preparing'?'保存原文，核对梗概与制作建议':selected?'待准备这篇故事':'等待选材完成';
  return [
   {id:'source',label:sourceLabel,state:candidates?intake==='discovering'||choosing?activeState:'done':sourceReady?'done':activeState,detail:sourceDetail},
   {id:'count',label:prepared?'制作确认':'准备故事',state:confirmed?'done':prepared?'current':intake==='preparing'&&(candidates||sourceReady)?activeState:'pending',detail:setupDetail,durationLabel:'准备耗时'},
   ...productionStages(input),
  ];
 }
 return [
  {id:'source',label:'确认原文',state:sourceReady?'done':phase==='source'||phase==='recommend'?activeState:'pending',detail:sourceReady?'已保存':'待完成'},
  {id:'count',label:'叙事详略与篇幅',state:countReady?'done':phase==='recommend'&&sourceReady?activeState:'pending',detail:countReady?(input.total===null?'画幅数待编排':`${input.total} 幅`):'待确定'},
  ...productionStages(input),
 ];
}
