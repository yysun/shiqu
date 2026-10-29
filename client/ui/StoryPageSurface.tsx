// Use native button activation for taps and keyboard input. A completed swipe,
// drag, long press or canceled pointer must not also activate the next-page click.
import {useRef,type PointerEvent} from 'react';
import {swipePageDirection} from '@/lib/reader-navigation';

export default function StoryPageSurface({onTurn,onDrag}:{onTurn:(direction:number)=>void;onDrag:(distance:number)=>void}){
 const pointer=useRef<{id:number;x:number;y:number;startedAt:number;travel:number}|null>(null);
 const suppressClick=useRef(false);
 function cancel(){pointer.current=null;suppressClick.current=true;onDrag(0);}
 function down(event:PointerEvent<HTMLButtonElement>){
  if(!event.isPrimary||event.button!==0){cancel();return;}
  suppressClick.current=true;
  pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY,startedAt:event.timeStamp,travel:0};
  event.currentTarget.setPointerCapture(event.pointerId);
 }
 function move(event:PointerEvent<HTMLButtonElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  start.travel=Math.max(start.travel,Math.hypot(dx,dy));
  if(Math.abs(dx)>Math.abs(dy))onDrag(Math.max(-250,Math.min(250,dx)));
 }
 function up(event:PointerEvent<HTMLButtonElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  const direction=swipePageDirection(dx,dy);
  const travel=Math.max(start.travel,Math.hypot(dx,dy));
  pointer.current=null;onDrag(0);
  suppressClick.current=!!direction||travel>8||event.timeStamp-start.startedAt>450;
  if(direction)onTurn(direction);
 }
 return <button type="button" className="yu-swipe-surface" aria-label="点击画面进入下一页，也可上下或左右滑动翻页"
  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
  onClick={event=>{if(event.detail===0||!suppressClick.current)onTurn(1);suppressClick.current=true;}}/>;
}
