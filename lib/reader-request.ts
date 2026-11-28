// Bound the whole read, including retries and JSON bodies, without replaying writes or generation requests.
// 冲突响应附带的当前版本保留在错误上，调用方据此改用最新版本，而不是重复发送已过时的请求。
const retryableStatuses=new Set([500,502,503,504]);
const retryDelays=[250,500,1000];
export class ResponseError extends Error{
 readonly status:number;
 readonly session?:unknown;
 readonly body?:unknown;
 constructor(message:string,status:number,session?:unknown,body?:unknown){super(message);this.status=status;this.session=session;this.body=body;}
}
/** 409 冲突时服务端回读的当前版本；没有附带时返回 undefined。 */
export function conflictSession<T>(error:unknown):T|undefined{
 return error instanceof ResponseError&&error.status===409&&error.session&&typeof error.session==='object'?error.session as T:undefined;
}
export async function request(path:string,method='GET',data?:unknown,read=method.toUpperCase()==='GET'){
 const abort=read?new AbortController():undefined;
 const timer=abort?setTimeout(()=>abort.abort(),15000):undefined;
 try{
 for(let attempt=0;;attempt++){
  try{
   abort?.signal.throwIfAborted();
   const response=await fetch('/api/'+path,{method,headers:data instanceof FormData?{}:data?{'Content-Type':'application/json'}:{},body:data instanceof FormData?data:data?JSON.stringify(data):undefined,signal:abort?.signal});
   if(!response.ok){
    const value=await response.json().catch(()=>null);
    throw new ResponseError(value?.error||'请求失败',response.status,value?.session,value);
   }
   return await response.json();
  }catch(error){
   if(abort?.signal.aborted)throw new Error('读取超时，请检查网络后重试。');
   const transient=error instanceof ResponseError?retryableStatuses.has(error.status):error instanceof TypeError||error instanceof SyntaxError;
   if(!read||!transient||attempt>=retryDelays.length)throw error;
   await new Promise(resolve=>setTimeout(resolve,retryDelays[attempt]));
  }
 }
 }finally{clearTimeout(timer);}
}
