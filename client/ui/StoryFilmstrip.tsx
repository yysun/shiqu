// 与发现页主图区一样使用原生横向滚动和吸附，让触控板位移、惯性与反向操作直接跟手。
// 滚动结束后才同步阅读进度；按钮跳页和容器缩放按当前页对齐，不打断进行中的手势。
import {memo,useLayoutEffect,useRef,type ReactNode} from 'react';
import type {Page} from '@/lib/content';
import StoryPageSurface from './StoryPageSurface';

type FrameProps={index:number;image:string;alt:string;current:boolean;reload:number;onError:(index:number,image:string)=>void;onLoad:(image:string)=>void};
const FilmFrame=memo(function FilmFrame({index,image,alt,current,reload,onError,onLoad}:FrameProps){
 return image?<img key={image+'-'+reload} onError={()=>onError(index,image)} onLoad={()=>onLoad(image)} className={'yu-scene '+(current?'is-current':'')} src={image} alt={alt} draggable={false}/>:null;
});

type Props={pages:Page[];page:number;ending:ReactNode;reloads:Record<string,number>;onImageError:(index:number,image:string)=>void;onImageLoad:(image:string)=>void;onPageChange:(index:number)=>void;onTurn:(direction:number)=>void;onToggleMetadata:()=>void};
export default memo(function StoryFilmstrip({pages,page,ending,reloads,onImageError,onImageLoad,onPageChange,onTurn,onToggleMetadata}:Props){
 const track=useRef<HTMLDivElement>(null),selected=useRef(page),width=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 selected.current=page;
 useLayoutEffect(()=>{
  const el=track.current;if(!el)return;
  const align=()=>{width.current=el.clientWidth;el.style.scrollSnapType='';el.scrollTo({left:selected.current*width.current,behavior:'instant'});};
  align();const observer=new ResizeObserver(align);observer.observe(el);
  return()=>{observer.disconnect();if(timer.current)clearTimeout(timer.current);};
 },[pages.length]);
 useLayoutEffect(()=>{
  const el=track.current;if(!el)return;
  if(Math.abs(el.scrollLeft-page*el.clientWidth)>1)el.scrollTo({left:page*el.clientWidth,behavior:'instant'});
  // 翻页后把旧页面点击层的焦点交给新页面，避免焦点留在屏幕外且被隐藏的按钮上。
  const focused=document.activeElement;
  if(focused instanceof HTMLElement&&el.contains(focused)&&focused.matches('.yu-page-surface:not(.yu-swipe-surface)'))(el.querySelector<HTMLElement>('.yu-swipe-surface')||el).focus({preventScroll:true});
 },[page]);
 function settled(){
  const el=track.current;if(!el||!el.clientWidth||el.clientWidth!==width.current)return;
  if(timer.current)clearTimeout(timer.current);
  const next=Math.max(0,Math.min(pages.length,Math.round(el.scrollLeft/el.clientWidth)));
  if(next!==selected.current){selected.current=next;onPageChange(next);}
 }
 return <div className="yu-filmstrip" ref={track} tabIndex={-1} onScrollEnd={settled} onScroll={event=>{
  // 旧浏览器没有 scrollend 时才用静止检测；这只同步进度，不拦截或锁定滚动。
  if(!('onscrollend'in event.currentTarget)){if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(settled,150);}
 }}>
  {pages.map((p,i)=><div className="yu-film-frame" key={i}>
   <FilmFrame index={i} image={p.image} alt={i===page?p.caption:''} current={i===page} reload={reloads[p.image]||0} onError={onImageError} onLoad={onImageLoad}/>
   <StoryPageSurface active={i===page} onTurn={onTurn} onToggleMetadata={onToggleMetadata}/>
  </div>)}
  <div className="yu-film-frame yu-film-ending">{page===pages.length?ending:null}</div>
 </div>;
});
