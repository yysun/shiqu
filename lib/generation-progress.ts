// Describe persisted milestones and real image counts; model planning has no measurable percentage.
import type {SessionView} from './reader-model.ts';
import {shelfGenerationStatus} from './shelf-generation.ts';
import {readerStoryboardBatchSize,readerMaxAutomaticRepairs} from './reader-limits.ts';
import {productionSteps} from './production-stages.ts';
import {isDirectSourceSelection} from './reader-discovery-themes.ts';
import type {RevisionRedraw} from './reader-revision-images.ts';

export function generationProgress(session:SessionView,now:number){
 const status=shelfGenerationStatus(session),meta=session.generationProgress;
 const running=status.group==='生成中',queued=status.group==='等待生成',failed=status.group==='生成失败';
 const total=meta?.frameCount??session.story?.pages.length??(typeof session.selection.length==='number'?session.selection.length:null);
 const ready=Math.max(0,Math.min(session.ready,total??session.ready));
 const phase=meta?.phase??(session.story?'image':session.frameRecommendation?'plan':'recommend');
 const sourceReady=meta?.sourceReady??!!session.story?.original;
 const countReady=meta?.frameCountConfirmed??(!!session.story||!!session.frameRecommendation);
 const activeState=failed?'failed' as const:running||queued||session.intake&&['choosing','confirming'].includes(session.intake.phase)?'current' as const:'paused' as const;
 const {intake,selection}=session,selected=intake?.selected;
 const intakeSource=selection.discovery?.mode==='auto'&&selection.discovery.combine?'combined':isDirectSourceSelection(selection)?'direct':'candidates';
 const steps=productionSteps({intakePhase:intake?.phase,intakeSource,intakeSelected:!!selected,candidateBatches:intake?.batches.length,selectedSourceLabel:selected?intake?.batches[selected.batch]?.stories[selected.index]?.sourceLabel:undefined,preparedSummary:!!session.frameRecommendation?.storySummary,estimatedFrames:session.frameRecommendation?.count,planReady:!!session.story,sourceReady,frameCountConfirmed:countReady,storyboardFrames:meta?.storyboardFrames,storyboardBatch:meta?.storyboardBatch,reviewOverridden:meta?.reviewOverridden,reviewStatus:meta?.reviewStatus,reviewPhase:meta?.reviewPhase,reviewRound:meta?.reviewRound,repairCompleted:meta?.repairCompleted,repairTotal:meta?.repairTotal,reviewAudits:meta?.reviewAudits,repairBatches:meta?.repairBatches,repairPasses:meta?.repairPasses,reviewStopReason:meta?.reviewStopReason,phase,total,ready,activeState});
 if(!session.intake&&!countReady&&session.frameRecommendation)steps[1].detail=`建议 ${session.frameRecommendation.count} 幅`;
 const elapsed=running&&meta?.startedAt!==null&&meta?.startedAt!==undefined&&Number.isFinite(meta.startedAt)?Math.max(0,Math.floor((now-meta.startedAt)/1000)):null;
 const remaining=elapsed!==null&&meta?.timeoutAt!==null&&meta?.timeoutAt!==undefined&&Number.isFinite(meta.timeoutAt)?Math.max(0,Math.ceil((meta.timeoutAt-now)/1000)):null;
 const measured=phase==='image'&&total!==null;
 const note=phase==='restyle'?'正在转换逐幅画面提示词，完成后开始绘图。':phase==='reflection'?'完整分镜已保存，正在结合原文和最终结局撰写结语；之后一起审核。':phase==='review'?(meta?.reviewPhase==='frames'?'正在依据原文核对叙事任务与画幅分配，检查缺失、重复及可删合段落；通过后继续全篇审核。':'正在检查全篇动作、画面、叙事递进、衔接与结语；审片通过后才开始绘图。'):phase==='repair'?`审核 → 定向修复 → 全篇复核，未通过继续循环；最多自动修复 ${readerMaxAutomaticRepairs} 轮，无变化则停下待处理。`:phase==='plan'?(meta?.storyboardBatch?`分镜目录已保存；每批最多 ${readerStoryboardBatchSize} 幅，当前编排第 ${meta.storyboardBatch.first}–${meta.storyboardBatch.last} 幅；完成一批保存一批。`:session.selection.length==='auto'||typeof session.selection.length==='number'&&session.selection.length>readerStoryboardBatchSize?`先确定全篇分镜目录，再按每批最多 ${readerStoryboardBatchSize} 幅编排并保存。`:'分镜完成后一次性返回，暂不提供百分比。'):phase==='image'?'只统计已生成并保存的画面。':'完成的步骤会自动更新。';
 return {running,queued,steps,elapsed,remaining,attempt:meta?.attempt||0,measured,total,ready,note,slow:phase==='plan'&&elapsed!==null&&elapsed>=90};
}

const redrawReasons:Record<RevisionRedraw['reason'],string>={'first-lost':'首幅原图已丢失，它是全篇的参考，需要全部重绘','first-changed':'审片修改了首幅，它是全篇的参考，需要全部重绘',lost:'部分原图已丢失，需要重绘',review:'审片修改了部分画面指令'};
export function redrawNotice(redraw:RevisionRedraw){return `实际需重绘 ${redraw.actual} 幅（预览 ${redraw.previewed} 幅）：${redrawReasons[redraw.reason]}。原版不受影响，可以随时暂停。`;}

export function generationDuration(seconds:number){
 const minutes=Math.floor(seconds/60),remaining=seconds%60;
 return `${minutes}分 ${String(remaining).padStart(2,'0')}秒`;
}
