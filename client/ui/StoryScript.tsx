// 单幅操作与批量操作共用修订草稿，原稿幅号在草稿编辑期间保持稳定。
import {Ellipsis} from 'lucide-react';
import {useEffect,useRef,useState,type PointerEvent} from 'react';
import type {Story} from '@/lib/content';
import {planSchema,type Plan} from '@/lib/reader-model';
import {survivingRevisionFrames} from '@/lib/reader-revision';
import type {StoryRevisionEditorState} from './useStoryRevision';
import StoryFlowAction from './StoryFlowAction';
import {StoryRevisionActions} from './StoryRevisionEditor';
import './story-script.css';

type Frame=Plan['pages'][number];
type RowProps={frame:Frame;number:number;editable:boolean;selecting:boolean;selected:boolean;open:boolean;onlyFrame:boolean;onOpen:(open:boolean)=>void;onSelect:()=>void;onEdit:()=>void;onDelete:()=>void};

function ScriptFrameRow({frame,number,editable,selecting,selected,open,onlyFrame,onOpen,onSelect,onEdit,onDelete}:RowProps){
 const actions=useRef<HTMLDivElement>(null),menu=useRef<HTMLButtonElement>(null),pointer=useRef<{id:number;x:number;y:number;dragging:boolean}|null>(null);
 const [offset,setOffset]=useState<number|null>(null);
 function start(event:PointerEvent<HTMLDivElement>){
  if(!editable||selecting||!event.isPrimary||event.button!==0||(event.target as Element).closest('button,input,summary'))return;
  pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY,dragging:false};
 }
 function move(event:PointerEvent<HTMLDivElement>){
  const gesture=pointer.current;
  if(!gesture||gesture.id!==event.pointerId)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y,width=actions.current?.offsetWidth??0;
  if(!gesture.dragging){
   if(Math.abs(dy)>8&&Math.abs(dy)>=Math.abs(dx)){pointer.current=null;return;}
   if(Math.abs(dx)<8||Math.abs(dx)<=Math.abs(dy)||(!open&&dx>0))return;
   gesture.dragging=true;
   event.currentTarget.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  setOffset(Math.min(0,Math.max(-width,(open?-width:0)+dx)));
 }
 function clear(){pointer.current=null;setOffset(null);}
 function end(event:PointerEvent<HTMLDivElement>){
  const gesture=pointer.current;
  if(gesture?.id!==event.pointerId)return;
  const dx=event.clientX-gesture.x;
  if(gesture.dragging&&Math.abs(dx)>=32)onOpen(dx<0);
  clear();
 }
 return <section className="yu-script-scene yu-script-row" aria-label={`第 ${number} 幅剧本`} data-open={open||undefined} data-selected={selected||undefined}
  onKeyDown={event=>{if(open&&event.key==='Escape'){event.preventDefault();event.stopPropagation();onOpen(false);menu.current?.focus();}}}>
  <div className="yu-script-row-face" style={offset===null?undefined:{transform:`translateX(${offset}px)`,transition:'none'}}
   onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={clear} onLostPointerCapture={clear}>
   <div className="yu-script-row-heading">
    <h4>第 {number} 幅</h4>
    {selecting?<label className="yu-script-check"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`选择第 ${number} 幅`}/></label>:
     editable&&<button ref={menu} type="button" className="yu-script-row-menu" aria-label={`第 ${number} 幅操作`} aria-expanded={open} onClick={event=>{
      onOpen(!open);
      if(!open&&event.detail===0)requestAnimationFrame(()=>actions.current?.querySelector('button')?.focus());
     }}><Ellipsis size={19}/></button>}
   </div>
   <p>{frame.caption||'这幅的旁白尚未保存。'}</p>
   <details className="yu-script-prompt"><summary>画面提示词</summary><p>{frame.prompt||'这幅未保存画面提示词。'}</p></details>
  </div>
  {editable&&!selecting&&<div ref={actions} className="yu-script-row-actions" inert={!open}>
   <button type="button" onClick={onEdit} aria-label={`修改第 ${number} 幅`}>修改</button>
   <button type="button" onClick={onDelete} disabled={onlyFrame} aria-label={`删除第 ${number} 幅`}>删除</button>
  </div>}
 </section>;
}

export default function StoryScript({story,editor,onEdit,resuming=false}:{story:Story;editor?:StoryRevisionEditorState;onEdit:(page?:number)=>void;resuming?:boolean}){
 const base=editor?.base?.plan,plan=editor?.changes.plan||base;
 const frames=plan?.pages??story.pages;
 const originalIds=survivingRevisionFrames(base?.pages.length??frames.length,editor?.changes.removedFrames).map(index=>index+1);
 const editable=!!base&&!editor?.loading&&!editor?.busy&&!editor?.conflict;
 const [open,setOpen]=useState<number|null>(null);
 const [selecting,setSelecting]=useState(false),[selected,setSelected]=useState<Set<number>>(new Set());
 const [merge,setMerge]=useState<Frame|null>(null),[notice,setNotice]=useState('');
 const toolbar=useRef<HTMLDivElement>(null),caption=useRef<HTMLTextAreaElement>(null);
 const chosen=originalIds.filter(id=>selected.has(id)),merging=merge!==null;
 const showActions=!!editor?.base&&!editor.loading&&!merging&&(editor.impact?.changed||editor.conflict);
 useEffect(()=>{if(merging)caption.current?.focus();},[merging]);
 function toggle(id:number){
  if(merge)return;
  setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
 }
 function toggleSelection(){
  setSelecting(!selecting);setOpen(null);setSelected(new Set());setMerge(null);
 }
 function startMerge(){
  const group=frames.filter((_,index)=>selected.has(originalIds[index]));
  if(group.length<2)return;
  setMerge({caption:group.map(frame=>frame.caption.trim()).join('\n'),prompt:group[0].prompt});
 }
 function apply(ids:number[],replacement?:Frame){
  if(!editor||!base||!editable||!ids.length||frames.length-ids.length+(replacement?1:0)<1)return;
  const first=ids[0],removed=ids.slice(replacement?1:0),omitted=new Set(removed);
  editor.setChanges(current=>{
   const savedPlan=current.plan||base;
   const surviving=survivingRevisionFrames(base.pages.length,current.removedFrames);
   const pages=savedPlan.pages.flatMap((frame,index)=>{
    const id=surviving[index]+1;
    return omitted.has(id)?[]:[replacement&&id===first?replacement:frame];
   });
   return {...current,plan:{...savedPlan,pages},storySummary:undefined,removedFrames:[...(current.removedFrames||[]),...removed].sort((a,b)=>a-b)};
  });
  setOpen(null);setSelected(new Set());setMerge(null);setSelecting(false);
  setNotice(replacement?`已合并 ${ids.length} 幅，修改已加入草稿。`:`已删除 ${ids.length} 幅，修改已加入草稿。`);
  toolbar.current?.focus({preventScroll:true});
 }
 const replacement=merge&&planSchema.shape.pages.element.safeParse({caption:merge.caption.trim(),prompt:merge.prompt.trim()});
 return <div className="yu-script-content">
  <h3>{story.title}</h3>
  {(editor?.changes.storySummary||story.summary)&&<p className="yu-script-intro">{editor?.changes.storySummary||story.summary}</p>}
  {editor&&<div className="yu-script-toolbar" ref={toolbar} tabIndex={-1} role="group" aria-label="分镜编辑">
   {selecting?<div className="yu-script-selection">
    <span role="status">已选 {chosen.length} 幅</span>
    <div className="yu-script-tools">
     <button type="button" disabled={!editable||chosen.length<2||!!merge} onClick={startMerge}>合并</button>
     <button type="button" className="yu-script-danger" disabled={!editable||!chosen.length||chosen.length===frames.length||!!merge} onClick={()=>apply(chosen)}>删除所选</button>
     <StoryFlowAction onClick={toggleSelection}>取消选择</StoryFlowAction>
    </div>
    {!!chosen.length&&chosen.length===frames.length&&<small>故事至少需要保留一幅。</small>}
   </div>:<div className="yu-script-toolbar-line">
    <StoryFlowAction disabled={!editable} aria-busy={editor.summarizing} onClick={async()=>{
     setNotice('');
     const result=await editor.summarize();
     if(result)setNotice(result==='updated'?'新梗概已加入草稿。':'生成结果与已保存的梗概一致。');
    }}>{editor.summarizing?'正在生成梗概…':'重新生成故事梗概'}</StoryFlowAction>
    <div className="yu-script-tools">
     <StoryFlowAction disabled={!editable||frames.length<2} onClick={toggleSelection}>选择</StoryFlowAction>
    </div>
   </div>}
   {showActions&&<StoryRevisionActions editor={editor} resuming={resuming}/>}
   {editor.loading?<p role="status">正在载入分镜…</p>:!showActions&&editor.error?<div role="alert"><p>{editor.error}</p>{!base&&<StoryFlowAction onClick={editor.conflict?editor.loadLatest:editor.load}>{editor.conflict?'载入最新版本':'重试载入'}</StoryFlowAction>}</div>:null}
   {notice&&<p role="status">{notice}</p>}
  </div>}
  {merge&&<section className="yu-script-merge" aria-label="合并分镜">
   <h3>合并为第 {originalIds.indexOf(chosen[0])+1} 幅</h3>
   <label className="yu-revision-field">合并后的旁白<textarea ref={caption} rows={4} value={merge.caption} onChange={event=>setMerge({...merge,caption:event.target.value})}/><small>8–90 字 · 当前 {merge.caption.trim().length} 字</small></label>
   <label className="yu-revision-field">合并后的画面提示词<textarea rows={5} maxLength={1800} value={merge.prompt} onChange={event=>setMerge({...merge,prompt:event.target.value})}/><small>保留一个可画的瞬间 · 20–1800 字</small></label>
   <div className="yu-script-tools"><button type="button" onClick={()=>setMerge(null)}>取消合并</button><button type="button" disabled={!editable||!replacement||!replacement.success} onClick={()=>{if(replacement&&replacement.success)apply(chosen,replacement.data);}}>预览合并</button></div>
  </section>}
  <div className="yu-script-frames">
   {frames.length?frames.map((frame,index)=>{
    const id=originalIds[index];
    return <ScriptFrameRow key={id} frame={frame} number={index+1} editable={editable} selecting={selecting} selected={selected.has(id)} open={editable&&!selecting&&open===id}
     onlyFrame={frames.length===1} onOpen={value=>setOpen(value?id:null)} onSelect={()=>toggle(id)} onEdit={()=>onEdit(index+1)} onDelete={()=>apply([id])}/>;
   }):<p>这篇故事还没有保存分镜剧本。</p>}
   {(plan?.reflection||story.reflection)&&<section className="yu-script-scene"><h4>余味</h4><p>{plan?.reflection||story.reflection}</p></section>}
   {story.adaptationNote&&<details className="yu-script-prompt"><summary>改编说明</summary><p>{story.adaptationNote}</p></details>}
  </div>
 </div>;
}
