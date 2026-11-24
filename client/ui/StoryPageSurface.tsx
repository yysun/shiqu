// 横向触摸与触控板交给原生吸附滚动；鼠标拖动沿用发现页主图区的 scrollLeft 行为。
// 点按只切换阅读信息；拖动、长按和原生滚动不能额外触发点击。
import {useRef,type PointerEvent} from 'react';
import {readerAtStart,swipePageDirection} from '@/lib/reader-navigation';

export default function StoryPageSurface({active=true,onDragEndAtSnap,onSwipeBack,onToggleMetadata}:{active?:boolean;onDragEndAtSnap:()=>void;onSwipeBack?:()=>void;onToggleMetadata:()=>void}){
 const pointer=useRef<{id:number;x:number;y:number;startedAt:number;travel:number;left:number;dragged:boolean;canSwipeBack:boolean}|null>(null);
 const suppressClick=useRef(false);
 const track=(element:HTMLElement)=>element.closest<HTMLElement>('.yu-filmstrip');
 function cancel(){pointer.current=null;suppressClick.current=true;}
 function down(event:PointerEvent<HTMLButtonElement>){
  if(!event.isPrimary||event.button!==0){cancel();return;}
  suppressClick.current=true;
  const left=track(event.currentTarget)?.scrollLeft??Infinity;
  pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY,startedAt:event.timeStamp,travel:0,left,dragged:false,canSwipeBack:active&&!!onSwipeBack&&readerAtStart(0,left)};
 }
 function move(event:PointerEvent<HTMLButtonElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  start.travel=Math.max(start.travel,Math.hypot(dx,dy));
  const el=track(event.currentTarget);
  if(event.pointerType==='mouse'&&el&&(start.dragged||Math.abs(dx)>6&&Math.abs(dx)>Math.abs(dy))){
   start.dragged=true;event.currentTarget.setPointerCapture(event.pointerId);el.style.scrollSnapType='none';el.scrollLeft=start.left-dx;
   if(el.scrollLeft>1)start.canSwipeBack=false;
  }
 }
 function up(event:PointerEvent<HTMLButtonElement>){
  const start=pointer.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  const travel=Math.max(start.travel,Math.hypot(dx,dy));
  pointer.current=null;
  const el=track(event.currentTarget);
  suppressClick.current=start.dragged||travel>8||event.timeStamp-start.startedAt>450;
  if(start.dragged&&el&&el.clientWidth){
   const left=el.scrollLeft,target=Math.round(left/el.clientWidth)*el.clientWidth;
   el.style.scrollSnapType='';
   if(active&&start.canSwipeBack&&readerAtStart(0,left)&&swipePageDirection(dx,dy)===-1){onSwipeBack?.();return;}
   el.scrollTo({left:target,behavior:'smooth'});
   // 松手时若已对齐，浏览器不会再产生滚动结束事件。
   if(left===target)onDragEndAtSnap();
  }
 }
 return <button type="button" className={'yu-page-surface'+(active?' yu-swipe-surface':'')} tabIndex={active?0:-1} aria-hidden={!active} aria-label="点击画面显示或隐藏阅读信息与控件，旁白始终显示；左右滑动翻页"
  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={event=>{const el=track(event.currentTarget);if(el)el.style.scrollSnapType='';cancel();}}
  onClick={event=>{if(event.detail===0||!suppressClick.current)onToggleMetadata();suppressClick.current=true;}}/>;
}
