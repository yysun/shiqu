// Add edge navigation around the scrollable conclusion without intercepting its
// controls. Scrolls, drags and long presses must not become accidental edge taps.
import {useRef,type ReactNode,type RefObject,type PointerEvent,type MouseEvent} from 'react';
import {edgePageDirection} from '@/lib/reader-navigation';

export default function StoryEndingSurface({children,onTurn,onDrag,drag,surfaceRef}:{children:ReactNode;onTurn:(direction:number)=>void;onDrag:(distance:number)=>void;drag:number;surfaceRef:RefObject<HTMLElement|null>}){
 const pointer=useRef<{id:number;x:number;y:number;startedAt:number;travel:number}|null>(null);
 const pointerType=useRef(''),suppressClick=useRef(false);
 const control=(target:EventTarget)=>target instanceof Element&&!!target.closest('button,a,input,textarea,select,[role="button"]');
 function cancel(){pointer.current=null;suppressClick.current=true;onDrag(0);}
 function down(event:PointerEvent<HTMLElement>){
  pointerType.current=event.pointerType;
  suppressClick.current=true;
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
  suppressClick.current=previous||Math.max(start.travel,Math.hypot(dx,dy))>8||event.timeStamp-start.startedAt>450;
  if(previous)onTurn(-1);
 }
 function edge(event:MouseEvent<HTMLElement>){
  const bounds=event.currentTarget.getBoundingClientRect();
  const direction=edgePageDirection(event.clientX,bounds.left,bounds.width);
  if(direction)onTurn(direction);
 }
 return <section className="yu-ending" ref={surfaceRef} aria-label="故事结束：点击左侧边缘返回最后一幅，右侧边缘返回主页或书架"
  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
  onClick={event=>{if(!control(event.target)&&!suppressClick.current)edge(event);suppressClick.current=true;}}
  onContextMenu={event=>{if(control(event.target)||event.button!==2||pointerType.current==='touch')return;event.preventDefault();cancel();edge(event);}}
  style={{transform:`translateX(${drag}px)`,transition:drag?'none':'transform 180ms ease-out'}}>{children}</section>;
}
