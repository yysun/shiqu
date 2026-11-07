// 解析阅读区边缘点击和方向手势；触控板惯性与回弹在同一次手势内只翻一页。
export type WheelGesture={lastEvent:number;x:number;y:number;committed:boolean};
export function edgePageDirection(clientX:number,left:number,width:number):number{
 if(width<=0)return 0;
 const position=(clientX-left)/width;
 if(position<0||position>1)return 0;
 return position<=.25?-1:position>=.75?1:0;
}
export function newWheelGesture():WheelGesture{return {lastEvent:-Infinity,x:0,y:0,committed:false};}
export function swipePageDirection(x:number,y:number):number{
 const horizontal=Math.abs(x)>Math.abs(y)*1.3,vertical=Math.abs(y)>Math.abs(x)*1.3;
 const delta=horizontal?x:vertical?y:0;
 return Math.abs(delta)>45?-Math.sign(delta):0;
}
export function wheelPageDirection(gesture:WheelGesture,input:{x:number;y:number;mode:number;time:number;height:number}):number{
 if(!input.x&&!input.y)return 0;
 // 空闲后允许下一次短促滑动；同一次手势的惯性与反向回弹仍保持锁定。
 if(input.time-gesture.lastEvent>240){gesture.x=0;gesture.y=0;gesture.committed=false;}
 gesture.lastEvent=input.time;
 if(gesture.committed)return 0;
 const scale=input.mode===1?20:input.mode===2?input.height:1;
 gesture.x+=input.x*scale;gesture.y+=input.y*scale;
 // 累计位移确定主方向，避免首个微小的跨轴抖动锁错方向；斜向移动继续等待。
 const x=Math.abs(gesture.x),y=Math.abs(gesture.y);
 const distance=x>y*1.3?gesture.x:y>x*1.3?gesture.y:0;
 if(Math.abs(distance)<60)return 0;
 gesture.committed=true;
 return Math.sign(distance);
}
