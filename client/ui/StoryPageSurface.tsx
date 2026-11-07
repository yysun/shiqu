// 横向触摸与触控板交给原生吸附滚动；鼠标拖动沿用发现页主图区的 scrollLeft 行为。
// 纵向滑动与边缘点按仍可翻页；拖动、长按和原生滚动不能额外触发点击。
import {useRef,type PointerEvent,type MouseEvent} from 'react';
import {swipePageDirection,edgePageDirection} from '@/lib/reader-navigation';

export default function StoryPageSurface({active=true,onTurn,onToggleMetadata}:{active?:boolean;onTurn:(direction:number)=>void;onToggleMetadata:()=>void}){
 const pointer=useRef<{id:number;x:number;y:number;startedAt:number;travel:number;left:number;dragged:boolean}|null>(null);
 const suppressClick=useRef(false);
 const pointerType=useRef('');
 function edgeDirection(event:MouseEvent<HTMLButtonElement>){
  const bounds=event.currentTarget.getBoundingClientRect();
  return edgePageDirection(event.clientX,bounds.left,bounds.width);
 }
 const track=(element:HTMLElement)=>element.closest<HTMLElement>('.yu-filmstrip');
 function cancel(){pointer.current=null;suppressClick.current=true;}
 function down(event:PointerEvent<HTMLButtonElement>){
  pointerType.current=event.pointerType;
  if(!event.isPrimary||event.button!==0){cancel();return;}
  suppressClick.current=true;
  pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY,startedAt:event.timeStamp,travel:0,left:track(event.currentTarget)?.scrollLeft||0,dragged:false};
 }
 function move(event:PointerEvent<HTMLButtonElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  start.travel=Math.max(start.travel,Math.hypot(dx,dy));
  const el=track(event.currentTarget);
  if(event.pointerType==='mouse'&&el&&(start.dragged||Math.abs(dx)>6&&Math.abs(dx)>Math.abs(dy))){
   start.dragged=true;event.currentTarget.setPointerCapture(event.pointerId);el.style.scrollSnapType='none';el.scrollLeft=start.left-dx;
  }
 }
 function up(event:PointerEvent<HTMLButtonElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  const direction=Math.abs(dy)>Math.abs(dx)*1.3?swipePageDirection(dx,dy):0;
  const travel=Math.max(start.travel,Math.hypot(dx,dy));
  pointer.current=null;
  const el=track(event.currentTarget);
  if(start.dragged&&el){el.style.scrollSnapType='';el.scrollTo({left:Math.round(el.scrollLeft/el.clientWidth)*el.clientWidth,behavior:'smooth'});}
  suppressClick.current=start.dragged||!!direction||travel>8||event.timeStamp-start.startedAt>450;
  if(direction)onTurn(direction);
 }
 return <button type="button" className={'yu-page-surface'+(active?' yu-swipe-surface':'')} tabIndex={active?0:-1} aria-hidden={!active} aria-label="点击画面中间显示或隐藏阅读信息与控件，旁白始终显示，左侧边缘返回上一页，右侧边缘进入下一页，也可上下或左右滑动翻页"
  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={event=>{const el=track(event.currentTarget);if(el)el.style.scrollSnapType='';cancel();}}
  onContextMenu={event=>{if(event.button!==2||pointerType.current==='touch')return;event.preventDefault();cancel();const direction=edgeDirection(event);if(direction)onTurn(direction);}}
  onClick={event=>{if(event.detail===0)onToggleMetadata();else if(!suppressClick.current){const direction=edgeDirection(event);if(direction)onTurn(direction);else onToggleMetadata();}suppressClick.current=true;}}/>;
}
