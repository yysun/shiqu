// Open a saved storyboard while no image exists, and answer a blocked review in any version of a story.
// Looking and editing start no work. Drawing past the review stays the reader's explicit choice.
import StoryFlowAction from './StoryFlowAction';
import {useState} from 'react';
import type {SessionView} from '@/lib/reader-model';
import type {ReviewIssue} from '@/lib/reader-review';
import type {ReviewOverride,ReviewOverrideOffer} from '@/lib/reader-recovery';
import {readerMaxAutomaticRepairs} from '@/lib/reader-limits';

type DrawAnyway=(faultId:string,ending?:ReviewOverride['ending'])=>void;

function ReviewRelease({offer,busy,waiting,onDrawAnyway}:{offer:ReviewOverrideOffer;busy:boolean;waiting:boolean;onDrawAnyway:DrawAnyway}){
 const [title,setTitle]=useState(offer.title),[reflection,setReflection]=useState(offer.reflection);
 return <div className="yu-review-skip">
  {offer.needsEnding&&<fieldset className="yu-revision-fields" disabled={busy}>
   <label className="yu-revision-field">确认标题<input value={title} maxLength={40} onChange={event=>setTitle(event.target.value)}/></label>
   <label className="yu-revision-field">确认结语<textarea rows={2} value={reflection} maxLength={100} onChange={event=>setReflection(event.target.value)}/></label>
  </fieldset>}
  <p>{waiting?'放行当前稿件，继续或恢复制作后绘图。':'按当前稿件放行并绘图。'}</p>
  <div className="production-stage-actions"><StoryFlowAction disabled={busy||!title.trim()||!reflection.trim()} onClick={()=>onDrawAnyway(offer.faultId,offer.needsEnding?{title,reflection}:undefined)}>仍然绘图</StoryFlowAction></div>
 </div>;
}

function ReviewIssueRow({issue,busy,onEdit,onAutoEdit}:{issue:ReviewIssue;busy:boolean;onEdit?:(page:number)=>void;onAutoEdit?:(issue:ReviewIssue)=>Promise<string|undefined>}){
 const [pending,setPending]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const label=issue.category==='reflection'?'结语':`第 ${issue.page} 幅`;
 async function apply(){
  if(!onAutoEdit)return;
  setPending(true);setMessage('');setError('');
  try{
   if(await onAutoEdit(issue)==='unchanged')setMessage('建议没有产生实际变化，可手动修改。');
  }catch(e){setError(e instanceof Error?e.message:'暂时无法自动修改，请重试。');}
  finally{setPending(false);}
 }
 return <li>
  <div className="yu-review-issue-heading">
   <strong>{issue.requiresReplan?'整篇结构':label}</strong>
   {!issue.requiresReplan&&(onEdit||onAutoEdit)&&<div className="production-stage-actions">
    {onEdit&&<StoryFlowAction disabled={busy} aria-label={`手动修改${label}`} onClick={()=>onEdit(issue.page)}>手动修改</StoryFlowAction>}
    {onAutoEdit&&<StoryFlowAction disabled={busy||pending} aria-label={`自动修改${label}`} aria-busy={pending} onClick={apply}>{pending?'正在修改…':'自动修改'}</StoryFlowAction>}
   </div>}
  </div>
  <span>{issue.problem}</span>
  <details><summary>修订建议</summary><p>{issue.instruction}</p></details>
  {message&&<p role="status">{message}</p>}
  {error&&<p role="alert">{error}</p>}
 </li>;
}

export default function StoryReviewTools({session,busy,error,onEdit,onAutoEdit,onReplan,onRetry,onDrawAnyway}:{session:SessionView;busy:boolean;error:string;onEdit?:(page:number)=>void;onAutoEdit?:(issue:ReviewIssue)=>Promise<string|undefined>;onReplan?:()=>void;onRetry:()=>void;onDrawAnyway:DrawAnyway}){
 const issues=session.reviewIssues||[],offer=session.reviewOverride;
 const meta=session.generationProgress,paused=!!session.generationControl&&session.generationControl!=='active';
 const replan=meta?.reviewStopReason==='replan',acceptanceBlocked=meta?.reviewStopReason==='requirements';
 const canRetry=session.lifecycle?.actions?.some(action=>action.event==='continue-repair')??(session.retryAllowed&&!paused&&!session.awaitingContinue);
 const canOverride=session.lifecycle?.actions?.some(action=>action.event==='override-review')??true;
 const showRepair=session.lifecycle?session.lifecycle.reviewAttention.some(item=>item.reason==='limit'):true;
 const reason=replan?'故事主线或结局不完整，需要重新编排；局部自动修补与绘图已停止。':meta?.reviewStopReason==='unchanged'?'上次修订没有产生实际变化，自动修复已停止。':meta?.reviewStopReason==='limit'?(typeof meta.repairPasses==='number'?`本次已完成 ${meta.repairPasses} 轮自动修复，复核仍未通过。`:'自动修复已到上限，复核仍未通过。'):'审片尚未通过，绘图已停止。';
 const counts=[typeof meta?.reviewAudits==='number'&&`全篇审核 ${meta.reviewAudits} 次`,typeof meta?.repairBatches==='number'&&`修订 ${meta.repairBatches} 批`].filter(Boolean).join(' · ');
 if(!session.story||!(session.story.original||session.generationProgress?.sourceReady)||!issues.length&&!error&&!acceptanceBlocked&&!offer)return null;
 return <section className={'yu-review-tools'+(issues.length?' has-issues':'')} aria-label="分镜与审片问题">
  {issues.length>0&&<>
   <header className="yu-review-heading"><span>审片待处理</span><h3>还有 {issues.length} 项问题需要修订</h3><p>{reason}</p>{counts&&<p className="yu-review-counts">{counts}</p>}</header>
   {acceptanceBlocked?<p>请查看验收结果中的原因，修改要求后重新审核。</p>:replan?<div className="yu-review-repair">{onReplan&&<StoryFlowAction type="button" className="yu-primary" disabled={busy} onClick={onReplan}>修改制作要求</StoryFlowAction>}<p>根据下面的建议修改制作要求或叙事详略，再开始制作。</p></div>:showRepair&&<div className="yu-review-repair"><StoryFlowAction type="button" disabled={busy||!canRetry} aria-busy={busy} onClick={onRetry}>{busy?'正在请求修复…':'继续自动修复'}</StoryFlowAction><p>{paused?'制作已暂停，请先恢复生成，再继续自动修复。':`沿用已保存的问题继续修订，通过后自动绘图；本次最多 ${readerMaxAutomaticRepairs} 轮，无变化则停下。`}</p></div>}
   <ul>{issues.map((issue,index)=><ReviewIssueRow key={JSON.stringify([issue.page,issue.problem,issue.instruction,index])} issue={issue} busy={busy} onEdit={onEdit} onAutoEdit={onAutoEdit}/>)}</ul>
  </>}
  {offer&&canOverride&&<ReviewRelease key={offer.faultId} offer={offer} busy={busy} waiting={paused||!!session.awaitingContinue} onDrawAnyway={onDrawAnyway}/>}
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
 </section>;
}

export function StoryAcceptanceNotice({busy,onAcceptance}:{busy:boolean;onAcceptance?:()=>void}){
 return <div role="alert" className="production-acceptance-notice"><strong>验收要求需要调整</strong><p>有要求与原文、制作要求冲突，或无法从文字分镜判断，已停止绘图。</p>{onAcceptance&&<div className="production-stage-actions"><StoryFlowAction type="button" className="yu-revision-open" disabled={busy} onClick={onAcceptance}>查看并修改验收要求</StoryFlowAction></div>}</div>;
}
