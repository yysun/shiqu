// 结语页在阅读区内识别触摸横滑，覆盖正文和页眉。纵向触摸继续由浏览器滚动。
// 单独订阅拖动位移，避免每次移动都重绘整个阅读器。
import {useEffect,useEffectEvent,useRef,type ReactNode,type RefObject,type PointerEvent} from 'react';
import {listenForEndingTouchSwipe,swipePageDirection} from '@/lib/reader-navigation';
import {useDragOffset,type DragOffset} from './useDragOffset';

export default function StoryEndingSurface({children,onSwipeBack,onDrag,drag:dragOffset,surfaceRef,readerRef}:{children:ReactNode;onSwipeBack:()=>void;onDrag:(distance:number)=>void;drag:DragOffset;surfaceRef:RefObject<HTMLElement|null>;readerRef:RefObject<HTMLElement|null>}){
 const drag=useDragOffset(dragOffset);
 const pointer=useRef<{id:number;x:number;y:number}|null>(null);
 const returnToImage=useEffectEvent(onSwipeBack);
 useEffect(()=>{
  const reader=readerRef.current;if(!reader)return;
  return listenForEndingTouchSwipe(reader,onDrag,returnToImage);
 },[readerRef,onDrag]);
 function cancel(){pointer.current=null;onDrag(0);}
 function down(event:PointerEvent<HTMLElement>){
  if(event.pointerType==='touch')return;
  if(!event.isPrimary||event.button!==0){cancel();return;}
  pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY};
 }
 function move(event:PointerEvent<HTMLElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  const horizontal=Math.abs(dx)>6&&Math.abs(dx)>Math.abs(dy)*1.3;
  if(horizontal&&!event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.setPointerCapture(event.pointerId);
  onDrag(horizontal?Math.min(180,Math.max(0,dx)):0);
 }
 function up(event:PointerEvent<HTMLElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  const previous=swipePageDirection(dx,dy)===-1;
  pointer.current=null;onDrag(0);
  if(previous)onSwipeBack();
 }
 return <section className="yu-ending" ref={surfaceRef} aria-label="故事结束：向右滑动，或在顶部向上滚动，返回最后一幅"
  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={event=>{if(pointer.current?.id===event.pointerId)cancel();}}
  style={{transform:`translateX(${drag}px)`,transition:drag?'none':'transform 180ms ease-out'}}>{children}</section>;
}
