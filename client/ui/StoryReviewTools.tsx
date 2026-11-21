// Open a saved storyboard while no image exists, and answer a blocked review in any version of a story.
// Looking and editing start no work. Drawing past the review stays the reader's explicit choice.
import StoryFlowAction from './StoryFlowAction';
import type {SessionView} from '@/lib/reader-model';
import {readerMaxAutomaticRepairs} from '@/lib/reader-limits';

export default function StoryReviewTools({session,busy,error,onEdit,onReplan,onRetry,onDrawAnyway}:{session:SessionView;busy:boolean;error:string;onEdit?:(page:number)=>void;onReplan?:()=>void;onRetry:()=>void;onDrawAnyway:()=>void}){
 const issues=session.reviewIssues||[];
 const meta=session.generationProgress,paused=!!session.generationControl&&session.generationControl!=='active';
 const replan=meta?.reviewStopReason==='replan',acceptanceBlocked=meta?.reviewStopReason==='requirements';
 const canRetry=session.retryAllowed&&!paused;
 const reason=replan?'故事主线或结局不完整，需要重新编排；局部自动修补与绘图已停止。':meta?.reviewStopReason==='unchanged'?'上次修订没有产生实际变化，自动修复已停止。':meta?.reviewStopReason==='limit'?(typeof meta.repairPasses==='number'?`本次已完成 ${meta.repairPasses} 轮自动修复，复核仍未通过。`:'自动修复已到上限，复核仍未通过。'):'审片尚未通过，绘图已停止。';
 const counts=[typeof meta?.reviewAudits==='number'&&`全篇审核 ${meta.reviewAudits} 次`,typeof meta?.repairBatches==='number'&&`修订 ${meta.repairBatches} 批`].filter(Boolean).join(' · ');
 if(!session.story||!(session.story.original||session.generationProgress?.sourceReady)||!issues.length&&!error&&!acceptanceBlocked)return null;
 return <section className={'yu-review-tools'+(issues.length?' has-issues':'')} aria-label="分镜与审片问题">
  {issues.length>0&&<>
   <header className="yu-review-heading"><span>审片待处理</span><h3>还有 {issues.length} 项问题需要修订</h3><p>{reason}</p>{counts&&<p className="yu-review-counts">{counts}</p>}</header>
   {acceptanceBlocked?<p>请查看验收结果中的原因，修改要求后重新审核。</p>:replan?<div className="yu-review-repair">{onReplan&&<StoryFlowAction type="button" className="yu-primary" disabled={busy} onClick={onReplan}>修改制作要求</StoryFlowAction>}<p>根据下面的建议修改制作要求或叙事详略，再开始制作。</p></div>:<div className="yu-review-repair"><StoryFlowAction type="button" className="yu-primary" disabled={busy||!canRetry} aria-busy={busy} onClick={onRetry}>{busy?'正在请求修复…':'继续自动修复'}</StoryFlowAction><p>{paused?'制作已暂停，请先恢复生成，再继续自动修复。':`沿用已保存的问题继续修订，通过后自动绘图；本次最多 ${readerMaxAutomaticRepairs} 轮，无变化则停下。`}</p></div>}
   <ul>{issues.map((issue,index)=><li key={index}><div className="yu-review-issue-heading"><strong>{issue.requiresReplan?'整篇结构':issue.category==='reflection'?'结语':`第 ${issue.page} 幅`}</strong>{onEdit&&!issue.requiresReplan&&<StoryFlowAction type="button" disabled={busy} aria-label={issue.category==='reflection'?'手动修改结语':`手动修改第 ${issue.page} 幅`} onClick={()=>onEdit(issue.page)}>手动修改</StoryFlowAction>}</div><span>{issue.problem}</span><details><summary>修订建议</summary><p>{issue.instruction}</p></details></li>)}</ul>
  </>}
  {issues.length>0&&<div className="yu-review-skip"><StoryFlowAction type="button" className="yu-review-override" disabled={busy} onClick={onDrawAnyway}>{paused?'跳过问题，保持暂停':'跳过问题并绘图'}</StoryFlowAction><p>{paused?'记录跳过，仍保持暂停；恢复后按当前分镜绘制。':'不再修订以上问题，按当前分镜绘制。'}</p></div>}
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
 </section>;
}

export function StoryAcceptanceNotice({busy,onAcceptance}:{busy:boolean;onAcceptance?:()=>void}){
 return <div role="alert" className="production-acceptance-notice"><strong>验收要求需要调整</strong><p>有要求与原文、制作要求冲突，或无法从文字分镜判断，已停止绘图。</p>{onAcceptance&&<div className="production-stage-actions"><StoryFlowAction type="button" className="yu-revision-open" disabled={busy} onClick={onAcceptance}>查看并修改验收要求</StoryFlowAction></div>}</div>;
}
