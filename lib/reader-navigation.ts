export type WheelGesture={lastEvent:number;lastTurn:number;distance:number;axis:'x'|'y';committed:boolean};
export function newWheelGesture():WheelGesture{return {lastEvent:-Infinity,lastTurn:-Infinity,distance:0,axis:'x',committed:false};}
export function swipePageDirection(x:number,y:number):number{
 const horizontal=Math.abs(x)>Math.abs(y)*1.3,vertical=Math.abs(y)>Math.abs(x)*1.3;
 const delta=horizontal?x:vertical?y:0;
 return Math.abs(delta)>45?-Math.sign(delta):0;
}
export function wheelPageDirection(gesture:WheelGesture,input:{x:number;y:number;mode:number;time:number;height:number}):number{
 if(!input.x&&!input.y)return 0;
 // Lock the entire gesture, including small reverse deltas during trackpad rebound.
 if(input.time-gesture.lastEvent>240){gesture.distance=0;gesture.committed=false;gesture.axis=Math.abs(input.x)>Math.abs(input.y)?'x':'y';}
 gesture.lastEvent=input.time;
 if(gesture.committed||input.time-gesture.lastTurn<420)return 0;
 const delta=gesture.axis==='x'?input.x:input.y;
 const scale=input.mode===1?20:input.mode===2?input.height:1;
 gesture.distance+=delta*scale;
 if(Math.abs(gesture.distance)<60)return 0;
 gesture.committed=true;gesture.lastTurn=input.time;
 return Math.sign(gesture.distance);
}
