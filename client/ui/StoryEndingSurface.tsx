// 结语页向右拖动返回最后一幅，不拦截页内按钮与链接；点按不翻页。
// 顶部下拉与滚轮上滚由 Reader 处理；拖动、长按不会误触页内控件。
// The drag offset is subscribed here, so a swipe re-renders this surface but not Reader or its children.
import {useRef,type ReactNode,type RefObject,type PointerEvent} from 'react';
import {useDragOffset,type DragOffset} from './useDragOffset';

export default function StoryEndingSurface({children,onTurn,onDrag,drag:dragOffset,surfaceRef}:{children:ReactNode;onTurn:(direction:number)=>void;onDrag:(distance:number)=>void;drag:DragOffset;surfaceRef:RefObject<HTMLElement|null>}){
 const drag=useDragOffset(dragOffset);
 const pointer=useRef<{id:number;x:number;y:number;startedAt:number;travel:number}|null>(null);
 const control=(target:EventTarget)=>target instanceof Element&&!!target.closest('button,a,input,textarea,select,[role="button"]');
 function cancel(){pointer.current=null;onDrag(0);}
 function down(event:PointerEvent<HTMLElement>){
  if(control(event.target)||!event.isPrimary||event.button!==0){pointer.current=null;return;}
  pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY,startedAt:event.timeStamp,travel:0};
  event.currentTarget.setPointerCapture(event.pointerId);
 }
 function move(event:PointerEvent<HTMLElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  start.travel=Math.max(start.travel,Math.hypot(dx,dy));
  if(dx>0&&Math.abs(dx)>Math.abs(dy)*1.3)onDrag(Math.min(180,dx));
 }
 function up(event:PointerEvent<HTMLElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  const previous=dx>45&&dx>Math.abs(dy)*1.3;
  pointer.current=null;onDrag(0);
  if(previous)onTurn(-1);
 }
 return <section className="yu-ending" ref={surfaceRef} aria-label="故事结束：向右滑动，或在顶部下拉、向上滚动，返回最后一幅"
  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
  style={{transform:`translateX(${drag}px)`,transition:drag?'none':'transform 180ms ease-out'}}>{children}</section>;
}
