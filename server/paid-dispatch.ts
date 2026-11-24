// 制作任务私有的发送许可。经异步准备与混合提供方包装传递，在付费发送点同步复核。
// 队列为每个任务建立任务范围。任务范围内缺少发送许可的付费发送一律拒绝，避免新的制作路径漏接复核后静默付费。
// 队列之外的调用（设置测试、读者当场发起的请求）不在任务范围内，由各自的命令提交授权。
import {AsyncLocalStorage} from 'node:async_hooks';

export type DispatchDenial='yield'|'obsolete';
type PaidDispatch={authorize:()=>void;receipt:(usage:unknown)=>void};
const dispatch=new AsyncLocalStorage<PaidDispatch>();
const productionJob=new AsyncLocalStorage<true>();

export class PaidDispatchDenied extends Error{
 reason:DispatchDenial;
 waitingFor?:'image-availability';
 constructor(reason:DispatchDenial,waitingFor?:'image-availability'){super(reason);this.reason=reason;this.waitingFor=waitingFor;}
}

/** 制作任务在发送前没有建立发送许可。属于程序缺陷，任务按失败记录，不发出请求。 */
export class PaidDispatchUnfenced extends Error{
 constructor(){super('PAID_DISPATCH_UNFENCED');}
}

export function withProductionJob<T>(run:()=>T):T{return productionJob.run(true,run);}
export function withPaidDispatch<T>(context:PaidDispatch,run:()=>T):T{return dispatch.run(context,run);}
export function beforePaidSend(){
 const context=dispatch.getStore();
 if(context){context.authorize();return;}
 if(productionJob.getStore())throw new PaidDispatchUnfenced();
}
export function recordPaidResponse(receipt:unknown){dispatch.getStore()?.receipt(receipt);}

/** 文件读取异常与确认缺失分别处理。返回 null 由提供方按确认缺失处理。 */
export async function readDrawingReference<T>(read:()=>Promise<T>):Promise<T>{
 try{return await read();}
 catch(error){
  if(dispatch.getStore())throw new PaidDispatchDenied('yield','image-availability');
  throw error;
 }
}
