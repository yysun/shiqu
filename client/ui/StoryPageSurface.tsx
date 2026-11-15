// 横向触摸与触控板交给原生吸附滚动；鼠标拖动沿用发现页主图区的 scrollLeft 行为。
// 纵向滑动仍可翻页；点按只切换阅读信息，不再按左右边缘翻页。拖动、长按和原生滚动不能额外触发点击。
// 鼠标在第一幅向右拖动时无处可滚，视为向回翻（离开阅读）。
import {useRef,type PointerEvent} from 'react';
import {swipePageDirection} from '@/lib/reader-navigation';

export default function StoryPageSurface({active=true,onTurn,onToggleMetadata}:{active?:boolean;onTurn:(direction:number)=>void;onToggleMetadata:()=>void}){
 const pointer=useRef<{id:number;x:number;y:number;startedAt:number;travel:number;left:number;dragged:boolean}|null>(null);
 const suppressClick=useRef(false);
 const track=(element:HTMLElement)=>element.closest<HTMLElement>('.yu-filmstrip');
 function cancel(){pointer.current=null;suppressClick.current=true;}
 function down(event:PointerEvent<HTMLButtonElement>){
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
  const back=start.dragged&&start.left<=1&&dx>45&&dx>Math.abs(dy)*1.3;
  if(direction)onTurn(direction);else if(back)onTurn(-1);
 }
 return <button type="button" className={'yu-page-surface'+(active?' yu-swipe-surface':'')} tabIndex={active?0:-1} aria-hidden={!active} aria-label="点击画面显示或隐藏阅读信息与控件，旁白始终显示；上下或左右滑动翻页"
  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={event=>{const el=track(event.currentTarget);if(el)el.style.scrollSnapType='';cancel();}}
  onClick={event=>{if(event.detail===0||!suppressClick.current)onToggleMetadata();suppressClick.current=true;}}/>;
}
