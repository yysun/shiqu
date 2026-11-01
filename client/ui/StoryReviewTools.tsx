// Open a saved storyboard while no image exists, and answer a blocked review in any version of a story.
// Looking and editing start no work. Drawing past the review stays the reader's explicit choice.
import type {SessionView} from '@/lib/reader-model';
import {readerMaxAutomaticRepairs} from '@/lib/reader-limits';
import {RefreshCw,ArrowRight} from 'lucide-react';

export default function StoryReviewTools({session,busy,error,onScript,onEdit,onRetry,onDrawAnyway}:{session:SessionView;busy:boolean;error:string;onScript:()=>void;onEdit?:(page:number)=>void;onRetry:()=>void;onDrawAnyway:()=>void}){
 const issues=session.reviewIssues||[];
 const meta=session.generationProgress,paused=!!session.generationControl&&session.generationControl!=='active';
 const canRetry=session.retryAllowed&&!paused;
 const reason=meta?.reviewStopReason==='unchanged'?'上次修订没有产生实际变化，自动修复已停止。':meta?.reviewStopReason==='limit'?(typeof meta.repairPasses==='number'?`已完成 ${meta.repairPasses} 轮自动修复，复核仍未通过。`:'自动修复已到上限，复核仍未通过。'):'审片尚未通过，绘图已停止。';
 if(!session.story?.original||session.story.pages[0]?.image&&!issues.length)return null;
 return <section className={'yu-review-tools'+(issues.length?' has-issues':'')} aria-label="分镜与审片问题">
  {issues.length>0&&<>
   <header className="yu-review-heading"><span>审片待处理</span><h3>还有 {issues.length} 项问题需要修订</h3><p>{reason}</p>{meta&&<p className="yu-review-counts">{typeof meta.repairPasses==='number'&&`已修复 ${meta.repairPasses} 轮`}{typeof meta.repairPasses==='number'&&typeof meta.reviewAudits==='number'&&' · '}{typeof meta.reviewAudits==='number'&&`已审核 ${meta.reviewAudits} 次`}</p>}</header>
   <div className="yu-review-repair"><button type="button" className="yu-primary" disabled={busy||!canRetry} aria-busy={busy} onClick={onRetry}><RefreshCw size={17} aria-hidden="true"/>{busy?'正在请求修复…':'继续自动修复'}<ArrowRight size={17} aria-hidden="true"/></button><p>{paused?'制作已暂停，请先恢复生成，再继续自动修复。':`沿用已保存的问题继续修订，通过后自动绘图；本次最多 ${readerMaxAutomaticRepairs} 轮，无变化则停下。`}</p></div>
   <ul>{issues.map((issue,index)=><li key={index}><div className="yu-review-issue-heading"><strong>{issue.category==='reflection'?'结语':`第 ${issue.page} 幅`}</strong>{onEdit&&<button type="button" disabled={busy} aria-label={issue.category==='reflection'?'手动修改结语':`手动修改第 ${issue.page} 幅`} onClick={()=>onEdit(issue.page)}>手动修改</button>}</div><span>{issue.problem}</span><details><summary>修订建议</summary><p>{issue.instruction}</p></details></li>)}</ul>
  </>}
  <div className="yu-review-inspect"><button type="button" onClick={onScript}>查看分镜</button>{onEdit&&!issues.length&&<button type="button" disabled={busy} onClick={()=>onEdit(1)}>手动修改</button>}</div>
  {issues.length>0&&<div className="yu-review-skip"><button type="button" className="yu-review-override" disabled={busy} onClick={onDrawAnyway}>跳过问题并绘图</button><p>不再修订以上问题，直接按当前分镜绘制。</p></div>}
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
 </section>;
}
