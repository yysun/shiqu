// Edit a local draft; saving review corrections submits directly to the existing review-and-draw flow.
import StoryFlowAction from './StoryFlowAction';
import StoryProductionEditor,{StoryEditorTabs} from './StoryProductionEditor';
import type {StoryRevisionEditorState} from './useStoryRevision';
import type {Plan} from '@/lib/reader-model';
import type {ReviewIssue} from '@/lib/reader-review';
import {revisionFrameCount,revisionImpact} from '@/lib/reader-revision';
import type {RevisionChanges,RevisionSnapshot} from '@/lib/reader-revision';
import {productionSteps,type ProductionStage} from '@/lib/production-stages';
import {normalizeProductionPrompt} from '@/lib/reader-prompts';
import './story-revision.css';
export function revisionDraftSteps(base:RevisionSnapshot,changes:RevisionChanges,source?:ProductionStage){
 const impact=revisionImpact(base,changes);
 const reviewStatus=impact.review?'pending':base.reviewStatus;
 const phase=impact.replan?'frame-count':reviewStatus==='repair'?'repair':reviewStatus&&reviewStatus!=='passed'?'review':'image';
 return productionSteps({sourceReady:true,frameCountConfirmed:!impact.replan,planReady:!impact.replan,reviewStatus,phase,total:impact.total,ready:0}).map(step=>{
  if(step.id==='source'&&source)return source;
  if(step.id==='count'&&impact.replan)return {...step,detail:'按叙事详略编排 · 审核后确定数量'};
  if(step.id==='review'&&!impact.review)return {...step,detail:'沿用原审片进度，不重新审核'};
  if(step.id==='plan'&&changes.plan&&impact.review&&!impact.replan)return {...step,detail:'已修改分镜 · 待审片'};
  return step;
 });
}
export function StoryRevisionActions({editor,onDone,resuming=false,reviewOnSave=false,link=false}:{editor:StoryRevisionEditorState;onDone?:()=>void;resuming?:boolean;reviewOnSave?:boolean;link?:boolean}){
 const Action=link?StoryFlowAction:'button';
 const impact=editor.impact;if(!impact)return null;
 const finish=reviewOnSave?undefined:onDone;
 return <section className="yu-revision-impact" aria-label="本次修改影响">
  <p role="status">{!impact.changed?(reviewOnSave?'修改分镜后，保存并重新审核，通过后继续绘图。':resuming?'完成编辑后，恢复生成时继续制作。':'调整制作内容，确认后开始制作。'):impact.replan?impact.preserveScript?`保留已保存的分镜与草稿，只完成剩余编排并审片；需绘制 ${impact.total} 幅。`:`将按叙事详略重新编排并审片，审核后确定画幅数。${impact.reusePending?'原图能否复用，待新分镜完成后逐幅比较。':'新分镜完成后重新核对图片。'}`:`保留分镜编排，${impact.review?'重新审片':'沿用原审片进度，不重新审核'}；预计复用 ${impact.reused} 幅、重绘 ${impact.redraw} 幅。`}</p>
  {impact.changed&&!impact.replan&&<small>画面指令或首幅参考变化时会重新核对旧图复用。</small>}
  {impact.conflict&&<div role="alert"><p>制作要求或叙事详略的变化需要重新编排，会替换手改分镜。请选择保留哪类修改：</p><div className="yu-revision-conflict"><Action type="button" disabled={editor.busy} onClick={()=>editor.setChanges(c=>({...c,plan:undefined}))}>保留重新编排设置</Action><Action type="button" disabled={editor.busy} onClick={()=>editor.setChanges(c=>({...c,productionPrompt:undefined,length:undefined,narrativeDetail:undefined}))}>保留手改分镜</Action></div></div>}
  {editor.error&&<p role="alert">{editor.error}</p>}
  {editor.conflict&&<div className="yu-revision-conflict-note" role="alert"><p>这篇故事的分镜、制作要求或版本已在别处更新。草稿仍在这里，不会自动合并；需要的内容可以先复制出来。</p><Action type="button" className="yu-revision-reload" disabled={editor.busy} onClick={()=>void editor.load()}>丢弃草稿，载入最新</Action></div>}
  <div className="yu-revision-buttons"><Action type="button" className="yu-primary" disabled={editor.busy||!finish&&(!impact.changed||impact.conflict||editor.conflict)} onClick={()=>{if(finish)finish();else void editor.submit();}}>{editor.busy?'正在提交…':finish?'完成编辑':resuming?'应用修改并恢复':reviewOnSave?(impact.review?'保存并重新审核':'保存修改'):'开始制作'}</Action><Action type="button" disabled={editor.busy} onClick={editor.discard}>丢弃草稿</Action></div>
  <small>{impact.changed&&!impact.review?'只修改画风，沿用原审片进度；审片已通过时直接重绘。书架显示最新版，原故事保留。':reviewOnSave?'保存后自动重新审片，通过后继续绘图；书架显示最新版，原故事保留。':resuming?(finish?'完成编辑后回到制作流程，点击“应用修改并恢复”时应用修改。':'恢复生成时应用修改，已保存的内容保留。'):finish?'完成编辑后回到制作流程，确认后才开始制作。':'开始制作后会自动编排、审片和绘图。书架显示最新版，原故事保留。'}</small>
 </section>;
}
export default function StoryRevisionEditor({editor,onDone,resuming=false,reviewIssues=[]}:{editor:StoryRevisionEditorState;onDone?:()=>void;resuming?:boolean;reviewIssues?:ReviewIssue[]}){
 const {base,changes,busy,loading}=editor;
 if(loading)return <p role="status">正在载入已保存的制作内容…</p>;
 if(!base)return <div><p role="alert">{editor.error||'制作内容尚未载入。'}</p><button type="button" onClick={()=>void editor.load()}>重新载入</button></div>;
 const plan=changes.plan||base.plan;
 const target=Math.max(0,Math.min(editor.scriptPage??1,plan?.pages.length??1)),page=Math.max(0,target-1);
 const issues=reviewIssues.filter(issue=>issue.page===target);
 const updatePlan=(update:(plan:Plan)=>void)=>editor.setChanges(c=>{const next=structuredClone(c.plan||base.plan);if(!next)return c;update(next);return {...c,plan:next};});
 return <div className="yu-revision-editor">
  <StoryEditorTabs tab={editor.tab!} onChange={editor.setTab} script={!!plan} disabled={busy}/>
  {editor.tab&&editor.tab!=='script'&&<StoryProductionEditor sessionId={editor.sessionId} tab={editor.tab} settings={{artStyle:changes.artStyle??base.selection.artStyle,productionPrompt:changes.productionPrompt??normalizeProductionPrompt(base.selection.productionPrompt,base.selection.theme),acceptancePrompt:changes.acceptancePrompt??base.selection.acceptancePrompt,length:changes.length??base.selection.length,narrativeDetail:changes.narrativeDetail??base.selection.narrativeDetail??'balanced'}} recommendation={base.frameRecommendation} disabled={busy} onChange={patch=>editor.setChanges(c=>({...c,...patch}))}/>}
  <fieldset disabled={busy} className="yu-revision-fields">
   {editor.tab==='script'&&plan&&<section className="yu-revision-script">
    <label className="yu-revision-field">选择分镜<select value={target} onChange={e=>editor.setScriptPage(Number(e.target.value))}>{plan.pages.map((_,index)=><option key={index} value={index+1}>第 {index+1} 幅</option>)}<option value={0}>结语</option></select></label>
    {issues.length>0&&<details key={target} open className="yu-revision-review" aria-label={target===0?'结语审核意见':`第 ${target} 幅审核意见`}>
     <summary>{target===0?'结语':`第 ${target} 幅`} · 上次审核意见</summary>
     {issues.map((issue,index)=><dl key={index}><dt>审核问题</dt><dd>{issue.problem}</dd><dt>修订建议</dt><dd>{issue.instruction}</dd></dl>)}
    </details>}
    {target>0&&<><section aria-label={`修改第 ${page+1} 幅`}><h3>第 {page+1} 幅</h3><label className="yu-revision-field">旁白<textarea rows={3} minLength={8} maxLength={90} value={plan.pages[page].caption} onChange={e=>updatePlan(p=>{p.pages[page].caption=e.target.value;})}/></label><label className="yu-revision-field">画面提示词<textarea rows={5} minLength={20} maxLength={1800} value={plan.pages[page].prompt} onChange={e=>updatePlan(p=>{p.pages[page].prompt=e.target.value;})}/></label></section>
    <details><summary>人物设定（修改后重绘全篇）</summary><label className="yu-revision-field">人物设定<textarea rows={4} minLength={20} maxLength={2500} value={plan.characters} onChange={e=>updatePlan(p=>{p.characters=e.target.value;})}/></label></details></>}
    <label className="yu-revision-field">余味<textarea rows={3} minLength={1} maxLength={100} value={plan.reflection} onChange={e=>updatePlan(p=>{p.reflection=e.target.value;})}/></label>
   </section>}

  </fieldset>
  <StoryRevisionActions editor={editor} onDone={onDone} resuming={resuming} reviewOnSave={reviewIssues.length>0}/>
  <p className="yu-revision-note">关闭弹窗保留本次草稿；离开这篇故事后草稿会清除。</p>
 </div>;
}
