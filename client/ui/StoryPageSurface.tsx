// Both mouse buttons and taps navigate by the outer quarter of the scene clicked.
// Swipes, drags and touch long presses must not trigger an extra page turn.
import {useRef,type PointerEvent,type MouseEvent} from 'react';
import {swipePageDirection,edgePageDirection} from '@/lib/reader-navigation';

export default function StoryPageSurface({onTurn,onDrag}:{onTurn:(direction:number)=>void;onDrag:(distance:number)=>void}){
 const pointer=useRef<{id:number;x:number;y:number;startedAt:number;travel:number}|null>(null);
 const suppressClick=useRef(false);
 const pointerType=useRef('');
 function edgeDirection(event:MouseEvent<HTMLButtonElement>){
  const bounds=event.currentTarget.getBoundingClientRect();
  return edgePageDirection(event.clientX,bounds.left,bounds.width);
 }
 function cancel(){pointer.current=null;suppressClick.current=true;onDrag(0);}
 function down(event:PointerEvent<HTMLButtonElement>){
  pointerType.current=event.pointerType;
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
 return <button type="button" className="yu-swipe-surface" aria-label="点击画面左侧边缘返回上一页，右侧边缘进入下一页，鼠标左右键均可，也可上下或左右滑动翻页"
  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
  onContextMenu={event=>{if(event.button!==2||pointerType.current==='touch')return;event.preventDefault();cancel();const direction=edgeDirection(event);if(direction)onTurn(direction);}}
  onClick={event=>{if(event.detail===0)onTurn(1);else if(!suppressClick.current){const direction=edgeDirection(event);if(direction)onTurn(direction);}suppressClick.current=true;}}/>;
}
