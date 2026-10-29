'use client';
// Present recent stories with their saved art style, theme, and reading progress.
import {useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Play,BookOpen} from 'lucide-react';
import type {Story} from '@/lib/content';
import type {GeneratedStory} from '@/lib/reader-model';
import type {recentHeroes} from '@/lib/reader-home';

const isGenerated=(story:Story):story is GeneratedStory=>'generated'in story&&story.generated===true;

type Props={items:ReturnType<typeof recentHeroes>;loading:boolean;bookName:(story:Story)=>string;onOpen:(story:Story,restart:boolean)=>void};
export default function RecentStories({items,loading,bookName,onOpen}:Props){
 const track=useRef<HTMLDivElement>(null),drag=useRef<{x:number;left:number;moved:boolean}|null>(null),suppressClick=useRef(false);
 const [index,setIndex]=useState(0);
 const active=Math.min(index,Math.max(0,items.length-1));
 function move(delta:number){const el=track.current;if(el)el.scrollTo({left:Math.max(0,Math.min(items.length-1,active+delta))*el.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 if(!items.length)return <div className="yu-feature-empty" role="status"><BookOpen size={32}/><strong>{loading?'正在打开故事…':'把下一篇故事留在这里'}</strong><p>{loading?'':'读过的故事会出现在这里，方便继续阅读。'}</p></div>;
 return <section className="yu-recent-hero" aria-label="最近阅读的故事">
  <div className="yu-hero-track" ref={track} onScroll={e=>setIndex(Math.round(e.currentTarget.scrollLeft/e.currentTarget.clientWidth))}
   onPointerDown={e=>{if(e.pointerType==='mouse'){drag.current={x:e.clientX,left:e.currentTarget.scrollLeft,moved:false};suppressClick.current=false;}}}
   onPointerMove={e=>{const d=drag.current;if(!d)return;const distance=e.clientX-d.x;if(Math.abs(distance)>6){d.moved=true;suppressClick.current=true;e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.style.scrollSnapType='none';}if(d.moved)e.currentTarget.scrollLeft=d.left-distance;}}
   onPointerUp={e=>{const d=drag.current;drag.current=null;if(d?.moved){e.currentTarget.style.scrollSnapType='';const el=e.currentTarget;el.scrollTo({left:Math.round(el.scrollLeft/el.clientWidth)*el.clientWidth,behavior:'smooth'});}}}
   onPointerCancel={e=>{drag.current=null;e.currentTarget.style.scrollSnapType='';}}
   onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}}>
   {items.map((item,i)=><button className="yu-feature" key={item.story.id} aria-label={(item.recent?'继续阅读':'开始阅读')+item.story.title} onClick={()=>onOpen(item.story,!item.recent)}>
    <img src={item.image} alt={item.story.title+'，第 '+(item.page+1)+' 幅'} draggable={false} loading={i===0?'eager':'lazy'}/><span className="yu-feature-wash"/>
    <span className="yu-feature-tag"><span/>{item.recent?'最近阅读 · '+bookName(item.story):'灵感来自《聊斋志异》'}</span>
    <span className="yu-feature-copy"><small>{isGenerated(item.story)?(item.story.artStyleLabel||'未记录画风'):'体验样篇画风'}{item.story.theme&&` · ${item.story.theme}`}</small><strong>{item.recent?item.story.title:<>一颗梨，<br/>能看清多少人心？</>}</strong><span className="yu-feature-bottom"><span>{item.recent?`继续阅读 · ${item.page+1} / ${item.story.pages.length} 幅`:`开始阅读 · ${item.story.pages.length} 幅`}</span><i><Play size={16} fill="currentColor"/></i></span></span>
   </button>)}
  </div>
  {items.length>1&&<div className="yu-hero-controls"><button aria-label="上一个最近故事" disabled={active===0} onClick={()=>move(-1)}><ChevronLeft size={19}/></button><span aria-live="polite">最近阅读 · {active+1} / {items.length}</span><button aria-label="下一个最近故事" disabled={active===items.length-1} onClick={()=>move(1)}><ChevronRight size={19}/></button></div>}
 </section>;
}
