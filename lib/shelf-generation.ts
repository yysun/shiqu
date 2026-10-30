// Explain saved generation checkpoints without treating a shelf visit as demand for new work.
import type {SessionView} from './reader-model.ts';

export function shelfGenerationStatus(session:SessionView){
 if(session.state!=='completed'&&session.generationControl&&session.generationControl!=='active')return {group:'生成已暂停',message:'生成已暂停',detail:'已保存的结果会保留；点击“恢复生成”后继续。已开始的任务仍会完成并保存。',action:'查看详情'};
 if(session.state==='failed'||session.error)return {group:'生成失败',message:'生成失败',detail:session.error||'已保存的结果会保留，请重试继续。',action:'查看详情'};
 if(session.state==='completed')return {group:'已完成',message:'故事已完整展开',detail:'所有画面已保存。',action:'开始阅读'};
 if(session.intake?.phase==='choosing')return {group:'待选故事',message:'等待选择故事',detail:session.intake.search?.state==='failed'?'这次查找未完成，已找到的候选都保留，可以重试查找。':'书籍、主题和候选已保存，选定后继续准备制作内容。',action:'选择故事'};
 if(session.intake?.phase==='confirming')return {group:'待制作确认',message:'等待确认制作内容',detail:'确认故事、画风、幅数和制作要求后才编排分镜。',action:'确认制作'};
 if(session.awaitingFrameCount)return {group:'待选画幅数',message:'等待选择画幅数',detail:'选定画幅数后开始生成。',action:'选择画幅数'};
 if(session.productionState==='running'||!session.productionState&&session.state==='running')return {group:'生成中',message:session.stage,detail:session.intake&&session.intake.phase!=='confirmed'?'正在准备制作内容，离开后继续，确认前不编排分镜或绘图。':'正在生成整篇，离开页面后继续，可随时暂停。',action:'查看进度'};
 if(session.productionState==='queued'||session.generationMode==='background')return {group:'等待生成',message:'等待生成',detail:'已进入队列，轮到后自动开始。',action:'查看进度'};
 return {group:'生成已暂停',message:'生成已暂停',detail:'点击“继续生成”后恢复，已保存的结果会保留。',action:'查看详情'};
}
