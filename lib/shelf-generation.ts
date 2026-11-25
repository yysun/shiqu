// Explain saved generation checkpoints without treating a shelf visit as demand for new work.
// 书架“制作中”区域按状态优先级排序：需要用户处理的排在运行、排队与暂停之前，同一状态内保持原顺序。
// 提示读者点击某项操作的状态都标明所需动作（expects）。生命周期没有提供该动作时改为说明原因，界面不会只提示而没有入口。
import {offersProductionAction,preparationRefreshFault,productionServiceMessages,type ProductionActionOffer} from './production-lifecycle.ts';
import type {SessionView} from './reader-model.ts';
import type {ShelfSession} from './reader-shelf.ts';

type Status={group:string;message:string;detail:string;action:string;expects?:ProductionActionOffer['event']};
type ReasonSession=Pick<SessionView,'lifecycle'>&{superseded?:boolean};

/** 读者需要的动作暂不可用时的原因。服务原因优先，其次是旧版本，其余情况提示刷新。 */
export function productionBlockedReason(session:ReasonSession){
 const service=session.lifecycle?.service;
 if(service&&service!=='available')return productionServiceMessages[service];
 if(session.superseded||session.lifecycle?.version==='superseded')return '这是旧版本，请打开书架中的最新版本继续生成。';
 return '这一步暂时无法继续，请刷新后再试。';
}

export function shelfGenerationStatus(session:SessionView|ShelfSession):Status{
 const status=savedStatus(session);
 if(!status.expects||!session.lifecycle||offersProductionAction(session,status.expects))return status;
 const detail=productionBlockedReason(session);
 return {group:'生成已暂停',message:detail.replace(/，.*|。$/g,''),detail,action:'查看详情'};
}

function savedStatus(session:SessionView|ShelfSession):Status{
 const lifecycle=session.lifecycle,complete=lifecycle?.phase==='completed'||!lifecycle&&session.state==='completed';
 const refreshing=lifecycle?.preparationRefresh==='pending';
 // 已完成作品的可选工作（刷新建议、横图）被暂停且可恢复时，同样需要读者处理。
 const resumable=!!session.generationControl&&session.generationControl!=='active'&&(lifecycle?.optionalWork??offersProductionAction(session,'resume',false));
 const completedWork=complete&&(refreshing||lifecycle?.activity.state==='running'||lifecycle?.activity.state==='queued'||resumable);
 const redraw=session.redrawPage?`重绘第 ${session.redrawPage} 幅`:null;
 if(redraw&&session.awaitingContinue)return {group:'生成已暂停',message:`等待${redraw}`,detail:'分镜、审片结果和其他画幅已保留。',action:redraw,expects:'continue'};
 if(session.awaitingContinue&&session.state!=='completed')return {group:'生成已暂停',message:'已保存，等待继续',detail:'修改已保存为新版本，点击“继续制作”后才开始重新制作，已有的结果会保留。',action:'继续制作',expects:'continue'};
 const phase=session.intake?.phase,preparing=phase==='preparing'||phase==='discovering';
 const pausedStage=session.stage?.replace(/^正在/,'');
 const service=session.lifecycle?.service;
 const offlineRetry=service==='unconfigured'&&offersProductionAction(session,'retry',false);
 if(service&&service!=='available'&&!offlineRetry&&(!complete||completedWork)&&lifecycle?.activity.state!=='running'){
  const detail=productionServiceMessages[service];
  return {group:'生成已暂停',message:detail.replace(/，.*|。$/g,''),detail,action:'查看详情'};
 }
 if(session.lifecycle?.imageAvailability==='unavailable'&&session.lifecycle.activity.state!=='running')
  return {group:'生成已暂停',message:'图片暂时无法核对',detail:'系统会继续核对已保存的图片，暂时不会重新绘制。',action:'查看详情'};
 if((!complete||completedWork)&&session.generationControl&&session.generationControl!=='active')return {group:'生成已暂停',message:refreshing?'已暂停 · 重新准备':pausedStage?`已暂停 · ${pausedStage}`:'生成已暂停',detail:`已保存的结果会保留。点击“${preparing?'恢复准备':'恢复生成'}”后继续。`,action:'查看详情',expects:'resume'};
 if(completedWork&&lifecycle?.activity.state==='running')return {group:'生成中',message:session.stage,detail:'原有内容及成图仍可阅读。',action:'查看进度'};
 const refreshFault=preparationRefreshFault(session);
 if(complete&&refreshFault)return {group:'生成失败',message:'重新准备失败',detail:refreshFault.message,action:'查看详情'};
 if(completedWork&&lifecycle?.activity.state==='queued')return {group:'等待生成',message:refreshing?'等待重新准备':'等待绘制横图',detail:'原有内容及成图仍可阅读。',action:'查看进度'};
 // 已完成作品的可选产物失败（如横图）由所在步骤提供重试，不把整篇显示为生成失败。
 if(!complete&&(session.state==='failed'||session.error))return {group:'生成失败',message:'生成失败',detail:session.error||'已保存的结果会保留，请重试继续。',action:'查看详情'};
 if(complete)return {group:'已完成',message:'故事已完整展开',detail:'所有画面已保存。',action:'开始阅读'};
 const intake=session.intake;
 const search=intake&&('searchState'in intake?intake.searchState:intake.search?.state);
 const hasCandidates=intake&&('hasCandidates'in intake?intake.hasCandidates:!!intake.batches?.length);
 if(intake?.phase==='choosing'&&!intake.selected&&search==='idle'&&!hasCandidates)return {group:'待提取故事',message:'等待开始提取',detail:'原文范围和主题已保存，进入窗口后点击按钮开始提取。',action:'提取故事'};
 if(session.intake?.phase==='choosing')return {group:'待选故事',message:'等待选择故事',detail:search==='failed'?'这次查找未完成，已找到的候选都保留，可以重试查找。':'书籍、主题和候选已保存，选定后继续准备制作内容。',action:'选择故事'};
 if(session.intake?.phase==='confirming')return {group:'待制作确认',message:'等待确认制作内容',detail:'确认故事、画风、叙事详略、制作要求和验收要求后才编排分镜。',action:'确认制作'};
 const primary=session.lifecycle?.activity.state==='running'?session.lifecycle.activity.jobs[0]:undefined;
 const pending=session.lifecycle?.faults.filter(fault=>fault.state==='pending')??[];
 if(session.productionState==='running'||!session.productionState&&session.state==='running')return {group:'生成中',message:redraw&&(!primary||primary.call==='draw'&&primary.pages[0]===session.redrawPage)?`正在${redraw}`:session.stage,detail:pending.length?pending.map(fault=>fault.page===null?fault.message:`第 ${fault.page+1} 幅待处理`).join('；'):redraw?'重绘在后台继续，其他画幅可随时阅读。':session.intake&&session.intake.phase!=='confirmed'?'正在准备制作内容，离开后继续，确认前不编排分镜或绘图。':'正在生成整篇，离开页面后继续，可随时暂停。',action:'查看进度'};
 if(session.productionState==='queued'||session.generationMode==='background')return {group:'等待生成',message:redraw?`排队${redraw}`:'等待生成',detail:'已进入队列，轮到后自动开始。',action:'查看进度'};
 return {group:'生成已暂停',message:pausedStage?`已暂停 · ${pausedStage}`:'生成已暂停',detail:'可用时点击“重试生成”，已保存的结果会保留。',action:'查看详情',expects:'retry'};
}

export function shelfDrawingCount(session:ShelfSession,group:string){
 if(!session.story||group==='生成已暂停'&&!session.stage.startsWith('正在绘制'))return '';
 return ` · ${session.ready} / ${session.story.frameCount} 幅`;
}

// 需要用户操作才能继续的状态，在书架“制作中”区域始终显示且排在最前。
export const shelfNeedsUserGroups=['待提取故事','待选故事','待制作确认','待选画幅数','生成失败'] as const;
const productionOrder=[...shelfNeedsUserGroups,'生成中','等待生成','生成已暂停'];
export function shelfProductionPriority(group:string){
 const index=productionOrder.indexOf(group);
 return index<0?productionOrder.length:index;
}
export function sortShelfProductions<T>(items:T[],group:(item:T)=>string){
 // Array.prototype.sort 为稳定排序，同一状态内保持书架原有顺序。
 return [...items].sort((a,b)=>shelfProductionPriority(group(a))-shelfProductionPriority(group(b)));
}
