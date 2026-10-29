// Explain saved generation checkpoints without treating a shelf visit as demand for new work.
import type {SessionView} from './reader-model.ts';

export function shelfGenerationStatus(session:SessionView){
 if(session.state==='completed')return {group:'已完成',message:'故事已完整展开',detail:'所有画面已保存。',action:'开始阅读'};
 if(session.awaitingFrameCount)return {group:'待选画幅数',message:'等待选择画幅数',detail:'选定画幅数后开始生成。',action:'选择画幅数'};
 if(session.productionState==='running'||!session.productionState&&session.state==='running')return {group:'生成中',message:session.stage,detail:'正在自动生成，无需重复操作。',action:'查看进度'};
 if(session.state==='failed'||session.error)return {group:'生成失败',message:'生成失败',detail:session.error||'已保存的结果会保留，请重试继续。',action:'重试生成'};
 if(session.productionState==='queued')return {group:'等待生成',message:'等待生成',detail:'已进入队列，轮到后自动开始。',action:'查看进度'};
 return {group:'生成已暂停',message:'生成已暂停',detail:'打开后继续，已保存的结果会保留。',action:'继续生成'};
}
