// Describe persisted milestones and real image counts; model planning has no measurable percentage.
import type {SessionView} from './reader-model.ts';
import {shelfGenerationStatus} from './shelf-generation.ts';
import {readerStoryboardBatchSize} from './reader-limits.ts';

export function generationProgress(session:SessionView,now:number){
 const status=shelfGenerationStatus(session),meta=session.generationProgress;
 const running=status.group==='生成中',queued=status.group==='等待生成',failed=status.group==='生成失败';
 const total=meta?.frameCount??session.story?.pages.length??(typeof session.selection.length==='number'?session.selection.length:null);
 const ready=Math.max(0,Math.min(session.ready,total??session.ready));
 const phase=meta?.phase??(session.awaitingFrameCount?'frame-count':session.story?'image':session.frameRecommendation?'plan':'recommend');
 const sourceReady=meta?.sourceReady??!!session.story?.original;
 const countReady=meta?.frameCountConfirmed??(!!session.story||!!session.frameRecommendation&&!session.awaitingFrameCount);
 const reviewing=meta?.reviewStatus!==undefined,reviewDone=meta?.reviewStatus==='passed',imageIndex=reviewing?4:3;
 const current=phase==='source'||phase==='recommend'&&!sourceReady?0:phase==='recommend'||phase==='frame-count'?1:phase==='plan'?2:phase==='review'||phase==='repair'?3:imageIndex;
 const complete=[sourceReady,countReady,!!session.story,...(reviewing?[reviewDone]:[]),total!==null&&ready===total];
 const details=[sourceReady?'已保存':'待完成',countReady&&total!==null?`${total} 幅`:session.frameRecommendation?`建议 ${session.frameRecommendation.count} 幅`:'待确定',session.story?`${session.story.pages.length} 幅分镜已保存`:meta?.storyboardFrames!==undefined?`已保存 ${meta.storyboardFrames} / ${total} 幅分镜`:'分镜尚未返回',...(reviewing?[reviewDone?'已通过':meta?.reviewStatus==='blocked'?`仍有 ${meta.repairTotal||0} 幅待修订`:phase==='repair'?`已修订 ${meta?.repairCompleted||0} / ${meta?.repairTotal||0} 幅`:phase==='review'?(meta?.reviewRound?'正在复核全篇':'正在审核全篇'):'待审核']:[]),total!==null?`${ready} / ${total} 幅`:`已完成 ${ready} 幅`];
 const steps=['确认原文','确定画幅数','编排故事',...(reviewing?['审核分镜']:[]),'生成画面'].map((label,index)=>({
  label,
  state:complete[index]?'done':index===current?(failed?'failed':running||queued||session.awaitingFrameCount?'current':'paused'):'pending',
  detail:details[index],
 }));
 const elapsed=running&&meta?.startedAt!==null&&meta?.startedAt!==undefined&&Number.isFinite(meta.startedAt)?Math.max(0,Math.floor((now-meta.startedAt)/1000)):null;
 const measured=phase==='image'&&total!==null;
 const note=phase==='review'?'正在检查全篇动作、画面、叙事递进与衔接；审片通过后才开始绘图。':phase==='repair'?'只修订审片指出的幅号，保存后再次审核全篇；本轮最多自动修订一次。':phase==='plan'?(meta?.storyboardBatch?`分镜目录已保存；每批最多 ${readerStoryboardBatchSize} 幅，当前编排第 ${meta.storyboardBatch.first}–${meta.storyboardBatch.last} 幅；完成一批保存一批。`:session.selection.length==='auto'||typeof session.selection.length==='number'&&session.selection.length>readerStoryboardBatchSize?`先确定全篇分镜目录，再按每批最多 ${readerStoryboardBatchSize} 幅编排并保存。`:'分镜完成后一次性返回，暂不提供百分比。'):phase==='image'?'只统计已生成并保存的画面。':'完成的步骤会自动更新。';
 return {running,queued,steps,elapsed,attempt:meta?.attempt||0,measured,total,ready,note,slow:phase==='plan'&&elapsed!==null&&elapsed>=90};
}

export function generationDuration(seconds:number){
 const minutes=Math.floor(seconds/60),remaining=seconds%60;
 return minutes?`${minutes} 分 ${String(remaining).padStart(2,'0')} 秒`:`${remaining} 秒`;
}
