// Present saved production checkpoints consistently without dispatching work or inferring review approval.
import {readerStoryboardBatchSize} from './reader-limits.ts';
export type ProductionStageState='pending'|'current'|'done'|'skipped'|'unavailable'|'failed'|'paused';
export type ProductionStage={id:string;label:string;state:ProductionStageState;detail:string};
export type ProductionCheckpoint={reviewOverridden?:boolean|number|null;intakePhase?:string;candidateBatches?:number;planReady:boolean;sourceReady?:boolean;frameCountConfirmed?:boolean;phase?:string;storyboardFrames?:number|null;storyboardBatch?:{first:number;last:number};reviewStatus?:'pending'|'repair'|'passed'|'blocked'|null;reviewRound?:number;repairCompleted?:number;repairTotal?:number;reviewAudits?:number;repairBatches?:number;repairPasses?:number;reviewStopReason?:'limit'|'unchanged'};
type Input=ProductionCheckpoint&{phase?:string;total:number|null;ready:number;activeState?:'current'|'failed'|'paused'};
export function productionStages(input:Input):ProductionStage[]{
 const {planReady,reviewStatus,reviewRound=0,repairCompleted=0,repairTotal=0,total,ready,activeState='current'}=input;
 const phase=input.phase||(!planReady?'plan':reviewStatus==='repair'?'repair':reviewStatus==='pending'||reviewStatus==='blocked'?'review':'image');
 const legacy=planReady&&!reviewStatus,passed=reviewStatus==='passed',blocked=reviewStatus==='blocked';
 const rechecking=phase==='review'&&reviewRound>0;
 const repaired=reviewStatus==='repair'||blocked||rechecking||passed&&reviewRound>1||!!input.reviewOverridden;
 const active=(at:boolean):ProductionStageState=>at?activeState:'pending';
 const reviewState:ProductionStageState=legacy?'unavailable':passed||repaired?'done':active(phase==='review');
 const repairState:ProductionStageState=blocked&&input.reviewStopReason==='unchanged'?'failed':legacy?'unavailable':passed&&!repaired?'skipped':blocked||rechecking||passed&&repaired?'done':active(phase==='repair');
 const recheckState:ProductionStageState=blocked&&input.reviewStopReason==='unchanged'?'pending':legacy?'unavailable':passed?(repaired?'done':'skipped'):blocked?'failed':active(rechecking);
 const count=total===null?'':` / ${total}`;
 const batch=input.storyboardBatch||(!planReady&&input.storyboardFrames!=null&&total!==null&&input.storyboardFrames<total?{first:input.storyboardFrames+1,last:Math.min(input.storyboardFrames+readerStoryboardBatchSize,total)}:null);
 return [
  {id:'plan',label:'分批分镜',state:planReady?'done':active(phase==='plan'||phase==='reflection'),detail:phase==='reflection'?'完整分镜已保存，正在撰写结语':planReady?`${total===null?'全篇':total+' 幅'}分镜已保存`:batch?`已保存 ${input.storyboardFrames||0}${count} 幅分镜 · 当前第 ${batch.first}–${batch.last} 幅`:input.storyboardFrames!=null?`已保存 ${input.storyboardFrames}${count} 幅分镜`:'等待完整分镜返回'},
  {id:'review',label:'全篇审片',state:reviewState,detail:legacy?'旧故事未启用审片':reviewState==='done'?(passed&&!repaired?'初审通过':'全篇审片已完成'):phase==='review'&&!rechecking?'检查分镜、跨批衔接与结语':'等待分镜与结语完成'},
  {id:'repair',label:'定向修订',state:repairState,detail:legacy?'旧故事未启用审片':repairState==='skipped'?'初审通过，无需修订':phase==='repair'?`第 ${(input.repairPasses||0)+1} 轮 · 已修订 ${repairCompleted} / ${repairTotal} 项`:repairState==='done'?typeof input.repairBatches==='number'?`已完成 ${input.repairBatches} 批定向修订`:'问题幅号已定向修订':'仅在审片发现问题时执行'},
  {id:'recheck',label:'复核',state:recheckState,detail:legacy?'旧故事未启用审片':blocked?`仍有 ${repairTotal} 项待修订，绘图已阻止`:input.reviewOverridden?'未解决的问题由你确认放行':recheckState==='skipped'?'初审通过，无需复核':passed?`复核通过 · 已审核 ${input.reviewAudits??reviewRound} 次`:rechecking?`正在第 ${(input.reviewAudits??reviewRound)+1} 次全篇审核`:'修订后重新审片'},
  {id:'image',label:'绘图',state:planReady&&(legacy||passed)&&total!==null&&total>0&&ready>=total?'done':active(phase==='image'&&planReady&&(legacy||passed)),detail:blocked?'待继续修订，绘图已阻止':reviewStatus&&!passed?'等待审片通过':total===null?`已保存 ${ready} 幅`:`${ready} / ${total} 幅画面已保存`},
 ];
}

export function productionSteps(input:Input):ProductionStage[]{
 const sourceReady=input.sourceReady??input.planReady,countReady=input.frameCountConfirmed??input.planReady;
 const activeState=input.activeState||'current',phase=input.phase||(!input.planReady?'plan':undefined);
 return [
  {id:'source',label:'确认原文',state:sourceReady?'done':phase==='source'||phase==='recommend'?activeState:'pending',detail:sourceReady?'已保存':'待完成'},
  {id:'count',label:'确定画幅数',state:countReady?'done':phase==='frame-count'||phase==='recommend'&&sourceReady?activeState:'pending',detail:countReady&&input.total!==null?`${input.total} 幅`:'待确定'},
  ...productionStages(input),
 ].map(step=>input.intakePhase&&step.id==='source'?{...step,label:'提取故事',state:input.intakePhase==='discovering'?activeState:'done',detail:input.intakePhase==='discovering'?'正在寻找并保存候选故事':`已保存 ${input.candidateBatches||0} 批候选`}:input.intakePhase&&step.id==='count'?{...step,label:'制作确认',state:input.intakePhase==='confirmed'?'done':input.intakePhase==='discovering'?'pending':activeState,detail:input.intakePhase==='choosing'?'待选择故事':input.intakePhase==='preparing'?'正在保存原文与制作建议':input.intakePhase==='confirming'?'确认故事、画风、幅数和制作要求':input.intakePhase==='confirmed'?`${input.total||''} 幅 · 制作内容已确认`:'等待候选故事'}:step) as ProductionStage[];
}
