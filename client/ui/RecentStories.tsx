'use client';
// 展示已加载的最近故事，并在容器缩放和布局切换时保持当前故事。
// 已读到最后一幅的故事显示“已读完 · 重读”，点击从第一幅重新开始。
import {useLayoutEffect,useRef} from 'react';
import {ChevronLeft,ChevronRight,Play,BookOpen,RotateCcw} from 'lucide-react';
import type {Story} from '@/lib/content';
import type {GeneratedStory} from '@/lib/reader-model';
import type {recentHeroes} from '@/lib/reader-home';

const isGenerated=(story:Story):story is GeneratedStory=>'generated'in story&&story.generated===true;

type Props={activeStoryId?:string;onActiveStoryChange?:(id:string)=>void;items:ReturnType<typeof recentHeroes>;loading:boolean;bookName:(story:Story)=>string;onOpen:(story:Story,restart:boolean)=>void};
export default function RecentStories({items,loading,bookName,onOpen,activeStoryId,onActiveStoryChange}:Props){
 const track=useRef<HTMLDivElement>(null),drag=useRef<{x:number;left:number;moved:boolean}|null>(null),suppressClick=useRef(false);
 const width=useRef(0);
 const active=Math.max(0,items.findIndex(item=>item.story.id===activeStoryId));
 const current=useRef(active);current.current=active;
 useLayoutEffect(()=>{
  const el=track.current;if(!el)return;
  function align(){
   if(!el)return;
   width.current=el.clientWidth;
   drag.current=null;el.style.scrollSnapType='';
   el.scrollTo({left:current.current*width.current,behavior:'instant'});
  }
  align();
  const observer=new ResizeObserver(align);observer.observe(el);
  return()=>observer.disconnect();
 },[loading,items.length]);
 function scroll(el:HTMLDivElement){
  if(!el.clientWidth)return;
  // 缩放触发的滚动事件可能早于观察器，不能用新宽度解读旧偏移。
  if(width.current!==el.clientWidth){width.current=el.clientWidth;el.scrollTo({left:current.current*width.current,behavior:'instant'});return;}
  const next=Math.max(0,Math.min(items.length-1,Math.round(el.scrollLeft/width.current)));
  current.current=next;
  if(items[next])onActiveStoryChange?.(items[next].story.id);
 }
 function move(delta:number){const el=track.current;if(el)el.scrollTo({left:Math.max(0,Math.min(items.length-1,active+delta))*el.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 if(loading||!items.length)return <div className="yu-feature-empty" role="status" aria-busy={loading}><BookOpen size={32}/><strong>{loading?'正在打开故事…':'把下一篇故事留在这里'}</strong><p>{loading?'':'选择一本书，开启你的第一篇故事。'}</p></div>;
 return <section className="yu-recent-hero" aria-label="最近阅读的故事">
  <div className="yu-hero-track" ref={track} onScroll={e=>scroll(e.currentTarget)}
   onPointerDown={e=>{if(e.pointerType==='mouse'){drag.current={x:e.clientX,left:e.currentTarget.scrollLeft,moved:false};suppressClick.current=false;}}}
   onPointerMove={e=>{const d=drag.current;if(!d)return;const distance=e.clientX-d.x;if(Math.abs(distance)>6){d.moved=true;suppressClick.current=true;e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.style.scrollSnapType='none';}if(d.moved)e.currentTarget.scrollLeft=d.left-distance;}}
   onPointerUp={e=>{const d=drag.current;drag.current=null;if(d?.moved){e.currentTarget.style.scrollSnapType='';const el=e.currentTarget;el.scrollTo({left:Math.round(el.scrollLeft/el.clientWidth)*el.clientWidth,behavior:'smooth'});}}}
   onPointerCancel={e=>{drag.current=null;e.currentTarget.style.scrollSnapType='';}}
   onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}}>
   {items.map((item,i)=>{const finished=item.recent&&item.page+1>=item.story.pages.length;return <button className="yu-feature" key={item.story.id} aria-label={(finished?'重读':item.recent?'继续阅读':'开始阅读')+item.story.title} onClick={()=>onOpen(item.story,finished||!item.recent)}>
    <img src={item.image} alt={item.story.title+'，第 '+(item.page+1)+' 幅'} draggable={false} loading={i===0?'eager':'lazy'}/><span className="yu-feature-wash"/>
    <span className="yu-feature-tag"><span/>{item.recent?'最近阅读 · '+bookName(item.story):'灵感来自《'+bookName(item.story)+'》'}</span>
    <span className="yu-feature-copy"><small>{item.story.theme&&`${item.story.theme} · `}{isGenerated(item.story)?(item.story.artStyleLabel||'未记录画风'):'未记录画风'}</small><strong>{item.story.title}</strong><span className="yu-feature-bottom"><span>{finished?`已读完 · 重读 · ${item.story.pages.length} 幅`:item.recent?`继续阅读 · ${item.page+1} / ${item.story.pages.length} 幅`:`开始阅读 · ${item.story.pages.length} 幅`}</span><i>{finished?<RotateCcw size={16}/>:<Play size={16} fill="currentColor"/>}</i></span></span>
   </button>;})}
  </div>
  {items.length>1&&<div className="yu-hero-controls"><button aria-label="上一个最近故事" disabled={active===0} onClick={()=>move(-1)}><ChevronLeft size={19}/></button><span aria-live="polite">最近阅读 · {active+1} / {items.length}</span><button aria-label="下一个最近故事" disabled={active===items.length-1} onClick={()=>move(1)}><ChevronRight size={19}/></button></div>}
 </section>;
}
