// 制作任务私有的发送许可。经异步准备与混合提供方包装传递，在付费发送点同步复核。
import {AsyncLocalStorage} from 'node:async_hooks';

export type DispatchDenial='yield'|'obsolete';
type PaidDispatch={authorize:()=>void;receipt:(usage:unknown)=>void};
const dispatch=new AsyncLocalStorage<PaidDispatch>();

export class PaidDispatchDenied extends Error{
 reason:DispatchDenial;
 waitingFor?:'image-availability';
 constructor(reason:DispatchDenial,waitingFor?:'image-availability'){super(reason);this.reason=reason;this.waitingFor=waitingFor;}
}

export function withPaidDispatch<T>(context:PaidDispatch,run:()=>T):T{return dispatch.run(context,run);}
export function beforePaidSend(){dispatch.getStore()?.authorize();}
export function recordPaidResponse(receipt:unknown){dispatch.getStore()?.receipt(receipt);}

/** 文件读取异常与确认缺失分别处理。返回 null 由提供方按确认缺失处理。 */
export async function readDrawingReference<T>(read:()=>Promise<T>):Promise<T>{
 try{return await read();}
 catch(error){
  if(dispatch.getStore())throw new PaidDispatchDenied('yield','image-availability');
  throw error;
 }
}
