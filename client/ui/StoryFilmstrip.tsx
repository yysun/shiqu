// 与发现页主图区一样使用原生横向滚动和吸附，让触控板位移、惯性与反向操作直接跟手。
// 滚动结束后才同步阅读进度；按钮跳页和容器缩放按当前页对齐，不打断进行中的手势。
import {memo,useLayoutEffect,useRef,type ReactNode,type TouchEvent} from 'react';
import type {Page} from '@/lib/content';
import {readerAtStart,readerCaptionOpacity,swipePageDirection} from '@/lib/reader-navigation';
import StoryPageSurface from './StoryPageSurface';

type FrameProps={index:number;image:string;alt:string;current:boolean;reload:number;onError:(index:number,image:string)=>void;onLoad:(image:string)=>void};
const FilmFrame=memo(function FilmFrame({index,image,alt,current,reload,onError,onLoad}:FrameProps){
 return image?<img key={image+'-'+reload} onError={()=>onError(index,image)} onLoad={()=>onLoad(image)} className={'yu-scene '+(current?'is-current':'')} src={image} alt={alt} draggable={false}/>:null;
});

type Props={pages:Page[];page:number;ending:ReactNode;reloads:Record<string,number>;onImageError:(index:number,image:string)=>void;onImageLoad:(image:string)=>void;onPageChange:(index:number)=>void;onCaptionOpacity:(opacity:number)=>void;onSwipeBack:()=>void;onToggleMetadata:()=>void};
export default memo(function StoryFilmstrip({pages,page,ending,reloads,onImageError,onImageLoad,onPageChange,onCaptionOpacity,onSwipeBack,onToggleMetadata}:Props){
 const track=useRef<HTMLDivElement>(null),selected=useRef(page),width=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const backTouch=useRef<{id:number;x:number;y:number}|null>(null);
 selected.current=page;
 useLayoutEffect(()=>{
  const el=track.current;if(!el)return;
  const align=()=>{width.current=el.clientWidth;el.style.scrollSnapType='';el.scrollTo({left:selected.current*width.current,behavior:'instant'});onCaptionOpacity(1);};
  align();const observer=new ResizeObserver(align);observer.observe(el);
  return()=>{observer.disconnect();if(timer.current)clearTimeout(timer.current);};
 },[pages.length,onCaptionOpacity]);
 useLayoutEffect(()=>{
  const el=track.current;if(!el)return;
  if(Math.abs(el.scrollLeft-page*el.clientWidth)>1)el.scrollTo({left:page*el.clientWidth,behavior:'instant'});
  onCaptionOpacity(1);
  // 翻页后把旧页面点击层的焦点交给新页面，避免焦点留在屏幕外且被隐藏的按钮上。
  const focused=document.activeElement;
  if(focused instanceof HTMLElement&&el.contains(focused)&&focused.matches('.yu-page-surface:not(.yu-swipe-surface)'))(el.querySelector<HTMLElement>('.yu-swipe-surface')||el).focus({preventScroll:true});
 },[page,onCaptionOpacity]);
 function settled(){
  const el=track.current;if(!el||!el.clientWidth||el.clientWidth!==width.current||el.style.scrollSnapType==='none')return;
  if(timer.current)clearTimeout(timer.current);
  const next=Math.max(0,Math.min(pages.length,Math.round(el.scrollLeft/el.clientWidth)));
  if(next!==selected.current){selected.current=next;onPageChange(next);}
 }
 function touchStart(event:TouchEvent<HTMLDivElement>){
  backTouch.current=null;
  if(event.touches.length!==1||!readerAtStart(page,event.currentTarget.scrollLeft)||!(event.target instanceof Element&&event.target.closest('.yu-swipe-surface')))return;
  const {identifier,clientX,clientY}=event.touches[0];
  backTouch.current={id:identifier,x:clientX,y:clientY};
 }
 function touchEnd(event:TouchEvent<HTMLDivElement>){
  const start=backTouch.current;
  backTouch.current=null;
  if(!start||!readerAtStart(page,event.currentTarget.scrollLeft))return;
  const touch=Array.from(event.changedTouches).find(touch=>touch.identifier===start.id);
  if(touch&&swipePageDirection(touch.clientX-start.x,touch.clientY-start.y)===-1)onSwipeBack();
 }
 return <div className="yu-filmstrip" ref={track} tabIndex={-1} onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={()=>{backTouch.current=null;}} onScrollEnd={settled} onScroll={event=>{
  const left=event.currentTarget.scrollLeft;
  if(left>1)backTouch.current=null;
  onCaptionOpacity(readerCaptionOpacity(left-page*width.current,width.current));
  // 旧浏览器没有 scrollend 时才用静止检测；这只同步进度，不拦截或锁定滚动。
  if(!('onscrollend'in event.currentTarget)){if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(settled,150);}
 }}>
  {pages.map((p,i)=><div className="yu-film-frame" key={i}>
   <FilmFrame index={i} image={p.image} alt={i===page?p.caption:''} current={i===page} reload={reloads[p.image]||0} onError={onImageError} onLoad={onImageLoad}/>
   <StoryPageSurface active={i===page} onDragEndAtSnap={settled} onSwipeBack={i===0?onSwipeBack:undefined} onToggleMetadata={onToggleMetadata}/>
  </div>)}
  <div className="yu-film-frame yu-film-ending">{page===pages.length?ending:null}</div>
 </div>;
});
