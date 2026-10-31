// Edit one local draft through existing controls, showing the dependency-based work before queueing.
import {useState} from 'react';
import StoryProductionEditor,{StoryEditorTabs} from './StoryProductionEditor';
import type {StoryRevisionEditorState} from './useStoryRevision';
import type {Plan} from '@/lib/reader-model';
import {revisionFrameCount} from '@/lib/reader-revision';
import './story-revision.css';
export function StoryRevisionActions({editor}:{editor:StoryRevisionEditorState}){
 const impact=editor.impact;if(!impact)return null;
 return <section className="yu-revision-impact" aria-label="本次修改影响">
  <p role="status">{!impact.changed?'修改先保存在草稿，提交后才会生成新版。':impact.replan?`将重新编排 ${impact.total} 幅并审片。${impact.reusePending?'原图能否复用，待新分镜完成后逐幅比较。':`需重绘 ${impact.total} 幅。`}`:`保留分镜编排，重新审片；预计复用 ${impact.reused} 幅、重绘 ${impact.redraw} 幅。`}</p>
  {impact.changed&&!impact.replan&&<small>审片若修改画面指令，会增加重绘；首幅变化时全部重绘。</small>}
  {impact.conflict&&<div role="alert"><p>制作要求或画幅数的变化需要重新编排，会替换手改分镜。请选择保留哪类修改：</p><div className="yu-revision-conflict"><button type="button" disabled={editor.busy} onClick={()=>editor.setChanges(c=>({...c,plan:undefined}))}>保留重新编排设置</button><button type="button" disabled={editor.busy} onClick={()=>editor.setChanges(c=>({...c,productionPrompt:undefined,length:undefined}))}>保留手改分镜</button></div></div>}
  {editor.error&&<p role="alert">{editor.error}</p>}
  {editor.conflict&&<div className="yu-revision-conflict-note" role="alert"><p>这篇故事的分镜、制作要求或版本已在别处更新。草稿仍在这里，不会自动合并；需要的内容可以先复制出来。</p><button type="button" className="yu-revision-reload" disabled={editor.busy} onClick={()=>void editor.load()}>丢弃草稿，载入最新</button></div>}
  <div className="yu-revision-buttons"><button type="button" className="yu-primary" disabled={!impact.changed||impact.conflict||editor.conflict||editor.busy} onClick={()=>void editor.submit()}>{editor.busy?'正在保存…':'保存修改，保持暂停'}</button><button type="button" disabled={editor.busy} onClick={editor.discard}>丢弃草稿</button></div>
  <small>保存后仍暂停，恢复生成时应用修改。书架只显示最新版，旧内容在后台保留。</small>
 </section>;
}
export default function StoryRevisionEditor({editor}:{editor:StoryRevisionEditorState}){
 const [page,setPage]=useState(0);
 const {base,changes,busy,loading}=editor;
 if(loading)return <p role="status">正在载入已保存的制作内容…</p>;
 if(!base)return <div><p role="alert">{editor.error||'制作内容尚未载入。'}</p><button type="button" onClick={()=>void editor.load()}>重新载入</button></div>;
 const plan=changes.plan||base.plan;
 const updatePlan=(update:(plan:Plan)=>void)=>editor.setChanges(c=>{const next=structuredClone(c.plan||base.plan);if(!next)return c;update(next);return {...c,plan:next};});
 return <div className="yu-revision-editor">
  <StoryEditorTabs tab={editor.tab!} onChange={editor.setTab} script={!!plan} disabled={busy}/>
  {editor.tab&&editor.tab!=='script'&&<StoryProductionEditor tab={editor.tab} settings={{artStyle:changes.artStyle??base.selection.artStyle,productionPrompt:changes.productionPrompt??base.selection.productionPrompt,length:changes.length??revisionFrameCount(base)}} recommendation={base.frameRecommendation} disabled={busy} onChange={patch=>editor.setChanges(c=>({...c,...patch}))}/>}
  <fieldset disabled={busy} className="yu-revision-fields">
   {editor.tab==='script'&&plan&&<section className="yu-revision-script">
    <label className="yu-revision-field">选择分镜<select value={page} onChange={e=>setPage(Number(e.target.value))}>{plan.pages.map((_,index)=><option key={index} value={index}>第 {index+1} 幅</option>)}</select></label>
    <section aria-label={`修改第 ${page+1} 幅`}><h3>第 {page+1} 幅</h3><label className="yu-revision-field">旁白<textarea rows={3} minLength={8} maxLength={90} value={plan.pages[page].caption} onChange={e=>updatePlan(p=>{p.pages[page].caption=e.target.value;})}/></label><label className="yu-revision-field">画面提示词<textarea rows={5} minLength={20} maxLength={1800} value={plan.pages[page].prompt} onChange={e=>updatePlan(p=>{p.pages[page].prompt=e.target.value;})}/></label></section>
    <details><summary>人物设定（修改后重绘全篇）</summary><label className="yu-revision-field">人物设定<textarea rows={4} minLength={20} maxLength={2500} value={plan.characters} onChange={e=>updatePlan(p=>{p.characters=e.target.value;})}/></label></details>
    <label className="yu-revision-field">余味<textarea rows={3} minLength={1} maxLength={100} value={plan.reflection} onChange={e=>updatePlan(p=>{p.reflection=e.target.value;})}/></label>
   </section>}

  </fieldset>
  <StoryRevisionActions editor={editor}/>
  <p className="yu-revision-note">关闭弹窗保留本次草稿；离开这篇故事后草稿会清除。</p>
 </div>;
}
