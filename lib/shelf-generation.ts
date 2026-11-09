// Explain saved generation checkpoints without treating a shelf visit as demand for new work.
// 书架“制作中”区域按状态优先级排序：需要用户处理的排在运行、排队与暂停之前，同一状态内保持原顺序。
import type {SessionView} from './reader-model.ts';
import type {ShelfSession} from './reader-shelf.ts';

export function shelfGenerationStatus(session:SessionView|ShelfSession){
 if(session.state!=='completed'&&session.generationControl&&session.generationControl!=='active')return {group:'生成已暂停',message:'生成已暂停',detail:'已保存的结果会保留；点击“恢复生成”后继续。已开始的任务仍会完成并保存。',action:'查看详情'};
 if(session.state==='failed'||session.error)return {group:'生成失败',message:'生成失败',detail:session.error||'已保存的结果会保留，请重试继续。',action:'查看详情'};
 if(session.state==='completed')return {group:'已完成',message:'故事已完整展开',detail:'所有画面已保存。',action:'开始阅读'};
 const intake=session.intake;
 const search=intake&&('searchState'in intake?intake.searchState:intake.search?.state);
 const hasCandidates=intake&&('hasCandidates'in intake?intake.hasCandidates:!!intake.batches?.length);
 if(intake?.phase==='choosing'&&!intake.selected&&search==='idle'&&!hasCandidates)return {group:'待提取故事',message:'等待开始提取',detail:'原文范围和主题已保存，进入窗口后点击按钮开始提取。',action:'提取故事'};
 if(session.intake?.phase==='choosing')return {group:'待选故事',message:'等待选择故事',detail:search==='failed'?'这次查找未完成，已找到的候选都保留，可以重试查找。':'书籍、主题和候选已保存，选定后继续准备制作内容。',action:'选择故事'};
 if(session.intake?.phase==='confirming')return {group:'待制作确认',message:'等待确认制作内容',detail:'确认故事、画风、幅数和制作要求后才编排分镜。',action:'确认制作'};
 if(session.awaitingFrameCount)return {group:'待选画幅数',message:'等待选择画幅数',detail:'选定画幅数后开始生成。',action:'选择画幅数'};
 if(session.productionState==='running'||!session.productionState&&session.state==='running')return {group:'生成中',message:session.stage,detail:session.intake&&session.intake.phase!=='confirmed'?'正在准备制作内容，离开后继续，确认前不编排分镜或绘图。':'正在生成整篇，离开页面后继续，可随时暂停。',action:'查看进度'};
 if(session.productionState==='queued'||session.generationMode==='background')return {group:'等待生成',message:'等待生成',detail:'已进入队列，轮到后自动开始。',action:'查看进度'};
 return {group:'生成已暂停',message:'生成已暂停',detail:'点击“继续生成”后恢复，已保存的结果会保留。',action:'查看详情'};
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
