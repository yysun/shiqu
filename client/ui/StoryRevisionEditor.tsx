// 编辑面板直接提交修改，制作时间线只显示已受理的任务进度。
import {useState} from 'react';
import StoryFlowAction from './StoryFlowAction';
import StoryProductionEditor,{StoryEditorTabs} from './StoryProductionEditor';
import type {StoryRevisionEditorState} from './useStoryRevision';
import type {Plan} from '@/lib/reader-model';
import type {ReviewIssue} from '@/lib/reader-review';
import {revisionReviewNotesChanged,revisionStorySummaryChanged,reviewNotesMaxLength,survivingRevisionFrames} from '@/lib/reader-revision';
import type {RevisionSnapshot} from '@/lib/reader-revision';
import type {ProductionStage} from '@/lib/production-stages';
import {normalizeProductionPrompt} from '@/lib/reader-prompts';
import {artStyleSettings,getArtStyle,sameArtDirection} from '@/lib/reader-styles';
import './story-revision.css';

export function reviewEditingStage(steps:ProductionStage[]){
 const review=steps.filter(step=>['review','repair','recheck'].includes(step.id));
 return review.find(step=>['paused','failed'].includes(step.state))||review.findLast(step=>step.state==='done');
}

function RevisionConflicts({editor}:{editor:StoryRevisionEditorState}){
 const waiting=editor.busy||editor.loading;
 return <>
  {editor.impact?.conflict&&<div role="alert">
   <p>重新编排会替换草稿的分镜与梗概，请选择保留哪类修改。</p>
   <div className="production-stage-actions">
    <StoryFlowAction disabled={waiting} onClick={()=>editor.setChanges(c=>({...c,plan:undefined,removedFrames:undefined,storySummary:undefined}))}>保留重新编排设置</StoryFlowAction>
    <StoryFlowAction disabled={waiting} onClick={()=>editor.setChanges(c=>({...c,productionPrompt:undefined,length:undefined,narrativeDetail:undefined}))}>保留分镜或梗概修改</StoryFlowAction>
   </div>
  </div>}
  {editor.conflict&&<div className="yu-revision-conflict-note" role="alert">
   <p>故事已在别处更新。载入最新版本会替换当前草稿，你可以先复制需要保留的内容。</p>
   <div className="production-stage-actions"><StoryFlowAction disabled={waiting} onClick={editor.loadLatest}>载入最新版本</StoryFlowAction></div>
  </div>}
 </>;
}

export function StoryRevisionActions({editor,resuming=false}:{editor:StoryRevisionEditorState;resuming?:boolean}){
 const {impact,base,changes,busy}=editor;
 if(!impact||!base)return null;
 const droppedRedrawNotePages=editor.preview?.droppedRedrawNotePages??[];
 const style=artStyleSettings(base.selection,changes);
 const restyle=!impact.review&&!sameArtDirection(base.selection,style);
 const summaryOnly=!impact.review&&!restyle&&revisionStorySummaryChanged(base,changes);
 const action=impact.replan?(impact.preserveScript?'继续编排':'重新编排'):
  impact.review?'重新审核':
  restyle?(resuming?'应用画风并继续':'应用新画风'):
  summaryOnly?(resuming?'保存梗概并恢复':'保存梗概'):'应用修改';
 const artwork=impact.estimated?`预计复用 ${impact.reused} 幅，需绘制 ${impact.redraw} 幅。`:'预估暂不可用。';
 let detail='';
 if(impact.changed){
  if(impact.replan){
   detail=impact.preserveScript?'沿用已保存的分镜，完成编排后审核。':
    changes.productionPrompt!==undefined&&changes.productionPrompt!==base.selection.productionPrompt?'按新制作要求生成梗概并重新编排。':'按所选叙事详略重新编排并审核。';
  }else if(summaryOnly)detail='保存新梗概，沿用现有分镜和审核进度。';
  else if(restyle)detail=`按${getArtStyle(style.artStyle).label}应用画风，沿用分镜编排和审核进度。${artwork}`;
  else if(impact.review)detail=`审核通过后继续绘图。${artwork}`;
 }
 return <section className="yu-revision-impact" aria-label="本次修改影响">
  {detail&&<p role="status">{detail}</p>}
  {droppedRedrawNotePages.length>0&&<p role="status">将丢弃原第 {droppedRedrawNotePages.join('、')} 幅的重绘说明。</p>}
  <RevisionConflicts editor={editor}/>
  {editor.error&&<p role="alert">{editor.error}</p>}
  <div className="production-stage-actions"><button type="button" className="yu-primary" disabled={busy||editor.loading||!impact.changed||impact.conflict||editor.conflict} aria-busy={busy} onClick={()=>void editor.submit()}>{busy?'正在提交…':action}</button></div>
 </section>;
}

function StoryReviewNotesEditor({editor,base}:{editor:StoryRevisionEditorState;base:RevisionSnapshot}){
 // 审核意见在点击开始审核时提交，关闭本面板不会把意见带回制作流程。
 const [reviewNotes,setReviewNotes]=useState(base.reviewNotes??'');
 const changes={...editor.changes,reviewNotes};
 const blocked=editor.conflict||editor.impact?.conflict;
 const waiting=editor.busy||editor.loading;
 const disabled=waiting||!base.canEditReviewNotes||blocked||!revisionReviewNotesChanged(base,changes);
 return <div className="yu-revision-editor">
  {editor.loading&&!editor.busy&&<p role="status">正在同步审核意见…</p>}
  <fieldset disabled={waiting} className="yu-revision-fields">
   {!!base.priorReviewIssues?.length&&<details className="yu-revision-review"><summary>上轮审核意见</summary>
    {base.priorReviewIssues.map(issue=><dl key={issue.page}><dt>{issue.page===0?'结语':`第 ${issue.page} 幅`}</dt><dd>{issue.problem}</dd><dd>{issue.instruction}</dd></dl>)}
   </details>}
   <label className="yu-revision-field">审核意见<textarea rows={6} maxLength={reviewNotesMaxLength} value={reviewNotes} disabled={!base.canEditReviewNotes} onChange={event=>setReviewNotes(event.target.value)}/><small>{base.canEditReviewNotes?'补充或更正上轮意见，然后开始审核。':'请先暂停审核，再修改意见。'}</small></label>
   <RevisionConflicts editor={editor}/>
   {!blocked&&editor.impact?.changed&&<p>{editor.impact.replan?'会一并应用已有草稿，重新编排后开始审核。':'已有制作草稿也会一并应用。'}</p>}
   {editor.error&&<p role="alert">{editor.error}</p>}
   <div className="production-stage-actions"><button type="button" className="yu-primary" disabled={disabled} aria-busy={editor.busy} onClick={()=>void editor.submit(changes)}>{editor.busy?'正在提交…':'开始审核'}</button></div>
  </fieldset>
 </div>;
}

export default function StoryRevisionEditor({editor,resuming=false,reviewIssues=[]}:{editor:StoryRevisionEditorState;resuming?:boolean;reviewIssues?:ReviewIssue[]}){
 const {base,changes,busy,loading}=editor;
 if(loading&&!base)return <p role="status">正在载入已保存的制作内容…</p>;
 if(!base)return <div><p role="alert">{editor.error||'制作内容尚未载入。'}</p><div className="production-stage-actions"><StoryFlowAction onClick={editor.conflict?editor.loadLatest:editor.load}>{editor.conflict?'载入最新版本':'重新载入'}</StoryFlowAction></div></div>;
 if(editor.tab==='review')return <StoryReviewNotesEditor key={base.token} editor={editor} base={base}/>;
 const plan=changes.plan||base.plan;
 const target=Math.max(0,Math.min(editor.scriptPage??1,plan?.pages.length??1)),page=Math.max(0,target-1);
 const originalPage=!changes.removedFrames||target===0?target:survivingRevisionFrames(base.plan?.pages.length??0,changes.removedFrames)[page]+1;
 const issues=reviewIssues.filter(issue=>issue.page===originalPage);
 const updatePlan=(update:(plan:Plan)=>void,changesFrame=false)=>editor.setChanges(c=>{const next=structuredClone(c.plan||base.plan);if(!next)return c;update(next);return {...c,plan:next,...(changesFrame?{storySummary:undefined}:{})};});
 return <div className="yu-revision-editor">
  {editor.tab&&<StoryEditorTabs tab={editor.tab} onChange={editor.setTab} script={!!plan} disabled={busy}/>}
  {editor.tab&&editor.tab!=='script'&&<StoryProductionEditor sessionId={editor.sessionId} tab={editor.tab} settings={{...artStyleSettings(base.selection,changes),productionPrompt:changes.productionPrompt??normalizeProductionPrompt(base.selection.productionPrompt,base.selection.theme),acceptancePrompt:changes.acceptancePrompt??base.selection.acceptancePrompt,length:changes.length??base.selection.length,narrativeDetail:changes.narrativeDetail??base.selection.narrativeDetail??'balanced'}} recommendation={base.frameRecommendation} disabled={busy} onChange={patch=>editor.setChanges(c=>({...c,...patch}))}/>}
  <fieldset disabled={busy} className="yu-revision-fields">
   {editor.tab==='script'&&plan&&<section className="yu-revision-script">
    <label className="yu-revision-field">选择分镜<select value={target} onChange={e=>editor.setScriptPage(Number(e.target.value))}>{plan.pages.map((_,index)=><option key={index} value={index+1}>第 {index+1} 幅</option>)}<option value={0}>结语</option></select></label>
    {issues.length>0&&<details key={target} open className="yu-revision-review" aria-label={target===0?'结语审核意见':`第 ${target} 幅审核意见`}>
     <summary>{target===0?'结语':`第 ${target} 幅`} · 上次审核意见</summary>
     {issues.map((issue,index)=><dl key={index}><dt>审核问题</dt><dd>{issue.problem}</dd><dt>修订建议</dt><dd>{issue.instruction}</dd></dl>)}
    </details>}
    {target>0&&<><section aria-label={`修改第 ${page+1} 幅`}><h3>第 {page+1} 幅</h3><label className="yu-revision-field">旁白<textarea rows={3} minLength={8} maxLength={90} value={plan.pages[page].caption} onChange={e=>updatePlan(p=>{p.pages[page].caption=e.target.value;},true)}/></label><label className="yu-revision-field">画面提示词<textarea rows={5} minLength={20} maxLength={1800} value={plan.pages[page].prompt} onChange={e=>updatePlan(p=>{p.pages[page].prompt=e.target.value;},true)}/></label></section>
    <details><summary>人物设定（修改后重绘全篇）</summary><label className="yu-revision-field">人物设定<textarea rows={4} minLength={20} maxLength={2500} value={plan.characters} onChange={e=>updatePlan(p=>{p.characters=e.target.value;})}/></label></details></>}
    <label className="yu-revision-field">余味<textarea rows={3} minLength={1} maxLength={100} value={plan.reflection} onChange={e=>updatePlan(p=>{p.reflection=e.target.value;})}/></label>
   </section>}

  </fieldset>
  <StoryRevisionActions editor={editor} resuming={resuming}/>
  <p className="yu-revision-note">关闭弹窗保留本次草稿；离开这篇故事后草稿会清除。</p>
 </div>;
}
