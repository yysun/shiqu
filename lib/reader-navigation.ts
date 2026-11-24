// 解析阅读区方向手势；触控板惯性与回弹在同一次手势内只翻一页。点按画面不翻页，只切换阅读信息。
// 惯性衰减中再次明显加速视为新的一次轻扫，立即可翻下一页，不必等惯性停止。
const wheelIdleMs=240;
export type WheelGesture={lastEvent:number;x:number;y:number;direction:number;last:number;decaying:boolean;reversing:boolean;edgeBlocked:boolean};
type WheelInput={x:number;y:number;mode:number;time:number;height:number};
export function newWheelGesture():WheelGesture{return {lastEvent:-Infinity,x:0,y:0,direction:0,last:0,decaying:false,reversing:false,edgeBlocked:false};}
function dominantDistance(x:number,y:number):number{
 return Math.abs(x)>Math.abs(y)*1.3?x:Math.abs(y)>Math.abs(x)*1.3?y:0;
}
// 触摸与拖动只认左右轻扫：右滑向回、左滑向前；上下滑动不翻页（滚轮仍按上下翻页）。
export function swipePageDirection(x:number,y:number):number{
 return Math.abs(x)>Math.abs(y)*1.3&&Math.abs(x)>45?-Math.sign(x):0;
}
export function readerAtStart(page:number,scrollLeft:number):boolean{
 return page===0&&Math.abs(scrollLeft)<=1;
}
// 当前画幅居中时文字完全可见，移过半幅后隐藏，回到中心时随位移恢复。
export function readerCaptionOpacity(offset:number,frameWidth:number):number{
 return frameWidth>0?Math.max(0,1-2*Math.abs(offset)/frameWidth):1;
}
export function wheelPageDirection(gesture:WheelGesture,input:WheelInput):number{
 if(!input.x&&!input.y)return 0;
 const scale=input.mode===1?20:input.mode===2?input.height:1;
 const dx=input.x*scale,dy=input.y*scale,magnitude=Math.hypot(dx,dy);
 if(input.time-gesture.lastEvent>wheelIdleMs)Object.assign(gesture,newWheelGesture());
 const previousMagnitude=gesture.last;
 gesture.last=magnitude;gesture.lastEvent=input.time;
 if(gesture.edgeBlocked)return 0;
 if(gesture.direction){
  const direction=Math.sign(dominantDistance(dx,dy));
  if(gesture.reversing){
   gesture.reversing=false;
   if(direction!==-gesture.direction){gesture.x=0;gesture.y=0;return 0;}
  }else{
   // 衰减后重新加速可接续翻页；反向翻页需连续两次反向位移，避免把单次回弹当作轻扫。
   if(!direction||!gesture.decaying||magnitude<=Math.max(previousMagnitude*2,12)){
    if(magnitude<previousMagnitude)gesture.decaying=true;
    return 0;
   }
   gesture.x=0;gesture.y=0;
   if(direction!==gesture.direction){gesture.x=dx;gesture.y=dy;gesture.reversing=true;return 0;}
  }
  gesture.direction=0;gesture.decaying=false;
 }
 gesture.x+=dx;gesture.y+=dy;
 // 累计位移确定主方向，避免首个微小的跨轴抖动锁错方向；斜向移动继续等待。
 const distance=dominantDistance(gesture.x,gesture.y);
 if(Math.abs(distance)<60)return 0;
 gesture.direction=Math.sign(distance);
 return gesture.direction;
}
// 只有从边界开始的新手势才返回；从中途滑到边界后的惯性不会触发返回。
export function wheelBackAtStart(gesture:WheelGesture,input:WheelInput,atStart:boolean):number{
 if(!atStart||input.x>0||input.y>0){gesture.lastEvent=input.time;gesture.edgeBlocked=true;return 0;}
 return wheelPageDirection(gesture,input)===-1?-1:0;
}
// 结语向右轻扫直接返回最后一幅；屏蔽同一次手势的余势，避免接着翻到更早的画幅。
export function wheelBackFromEnding(gesture:WheelGesture,input:WheelInput,atEnding:boolean):'native'|'hold'|'previous'{
 if(!input.x)return 'native';
 if(!atEnding&&gesture.direction===-1){
  if(input.time-gesture.lastEvent<=wheelIdleMs){gesture.lastEvent=input.time;return 'hold';}
  Object.assign(gesture,newWheelGesture());
 }
 if(wheelBackAtStart(gesture,input,atEnding))return 'previous';
 return atEnding&&input.x<0?'hold':'native';
}

// 只在结语存在时监听阅读区，纵向滚动和控件点按由浏览器处理。
export function listenForEndingTouchSwipe(reader:HTMLElement,onDrag:(distance:number)=>void,onSwipeBack:()=>void):()=>void{
 let start:{touch:Touch;horizontal:boolean}|null=null;
 function cancelTouch(){if(start?.horizontal)onDrag(0);start=null;}
 function startTouch(event:TouchEvent){
  cancelTouch();
  if(event.touches.length===1)start={touch:event.touches[0],horizontal:false};
 }
 function moveTouch(event:TouchEvent){
  if(!start)return;
  const touch=event.touches[0];
  if(event.touches.length!==1||touch.identifier!==start.touch.identifier){cancelTouch();return;}
  const dx=touch.clientX-start.touch.clientX,dy=touch.clientY-start.touch.clientY;
  if(!start.horizontal){
   if(Math.max(Math.abs(dx),Math.abs(dy))<=6)return;
   if(Math.abs(dx)<=Math.abs(dy)||!event.cancelable){cancelTouch();return;}
   start.horizontal=true;
  }
  // 在 Safari 接管滚动或把手势变成按钮点击之前，只取消已判定为横向的触摸。
  event.preventDefault();
  onDrag(Math.min(180,Math.max(0,dx)));
 }
 function endTouch(event:TouchEvent){
  if(!start?.horizontal)return;
  const initial=start.touch;
  const touch=Array.from(event.changedTouches).find(touch=>touch.identifier===initial.identifier);
  if(touch&&swipePageDirection(touch.clientX-initial.clientX,touch.clientY-initial.clientY)===-1){
   event.preventDefault();cancelTouch();onSwipeBack();
  }
 }
 // Safari 的短促滑动可能只在 pointerup 提供结束坐标，touchend 仍是起点坐标。
 function endPointer(event:PointerEvent){
  if(!start||event.pointerType!=='touch'||!event.isPrimary)return;
  const initial=start.touch;
  cancelTouch();
  if(swipePageDirection(event.clientX-initial.clientX,event.clientY-initial.clientY)===-1)onSwipeBack();
 }
 reader.addEventListener('touchstart',startTouch,{passive:true});
 reader.addEventListener('touchmove',moveTouch,{passive:false});
 reader.addEventListener('touchend',endTouch);
 reader.addEventListener('touchcancel',cancelTouch);
 reader.addEventListener('pointerup',endPointer);
 return()=>{
  reader.removeEventListener('touchstart',startTouch);
  reader.removeEventListener('touchmove',moveTouch);
  reader.removeEventListener('touchend',endTouch);
  reader.removeEventListener('touchcancel',cancelTouch);
  reader.removeEventListener('pointerup',endPointer);
  cancelTouch();
 };
}
