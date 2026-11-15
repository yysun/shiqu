// 解析阅读区方向手势；触控板惯性与回弹在同一次手势内只翻一页。点按画面不翻页，只切换阅读信息。
// 惯性衰减中再次明显加速视为新的一次轻扫，立即可翻下一页，不必等惯性停止。
export type WheelGesture={lastEvent:number;x:number;y:number;committed:boolean;last:number;decaying:boolean};
export function newWheelGesture():WheelGesture{return {lastEvent:-Infinity,x:0,y:0,committed:false,last:0,decaying:false};}
export function swipePageDirection(x:number,y:number):number{
 const horizontal=Math.abs(x)>Math.abs(y)*1.3,vertical=Math.abs(y)>Math.abs(x)*1.3;
 const delta=horizontal?x:vertical?y:0;
 return Math.abs(delta)>45?-Math.sign(delta):0;
}
export function wheelPageDirection(gesture:WheelGesture,input:{x:number;y:number;mode:number;time:number;height:number}):number{
 if(!input.x&&!input.y)return 0;
 const scale=input.mode===1?20:input.mode===2?input.height:1;
 const dx=input.x*scale,dy=input.y*scale,magnitude=Math.hypot(dx,dy);
 // 空闲后，或已翻页的手势在惯性衰减中突然加速（新的一次轻扫）时，开始新手势；同一次手势的惯性与反向回弹仍保持锁定。
 const fresh=gesture.committed&&gesture.decaying&&magnitude>Math.max(gesture.last*2,12);
 if(input.time-gesture.lastEvent>240||fresh){gesture.x=0;gesture.y=0;gesture.committed=false;gesture.decaying=false;}
 else if(gesture.committed&&magnitude<gesture.last)gesture.decaying=true;
 gesture.last=magnitude;gesture.lastEvent=input.time;
 if(gesture.committed)return 0;
 gesture.x+=dx;gesture.y+=dy;
 // 累计位移确定主方向，避免首个微小的跨轴抖动锁错方向；斜向移动继续等待。
 const x=Math.abs(gesture.x),y=Math.abs(gesture.y);
 const distance=x>y*1.3?gesture.x:y>x*1.3?gesture.y:0;
 if(Math.abs(distance)<60)return 0;
 gesture.committed=true;
 return Math.sign(distance);
}
// 结语页：停在顶部时向上滚动才回到最后一幅；从内容中途开始的滚动（含惯性滚到顶部）在本次手势内不翻页。
export function endingWheelDirection(gesture:WheelGesture,input:{x:number;y:number;mode:number;time:number;height:number},atTop:boolean):number{
 if(!atTop||input.y>0){gesture.lastEvent=input.time;gesture.committed=true;return 0;}
 return wheelPageDirection(gesture,input)===-1?-1:0;
}
