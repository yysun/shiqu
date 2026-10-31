// Bound the whole read, including retries and JSON bodies, without replaying writes or generation requests.
const retryableStatuses=new Set([500,502,503,504]);
const retryDelays=[250,500,1000];
class ResponseError extends Error{
 readonly status:number;
 constructor(message:string,status:number){super(message);this.status=status;}
}
export async function request(path:string,method='GET',data?:unknown){
 const read=method.toUpperCase()==='GET';
 const abort=read?new AbortController():undefined;
 const timer=abort?setTimeout(()=>abort.abort(),15000):undefined;
 try{
 for(let attempt=0;;attempt++){
  try{
   abort?.signal.throwIfAborted();
   const response=await fetch('/api/'+path,{method,headers:data instanceof FormData?{}:data?{'Content-Type':'application/json'}:{},body:data instanceof FormData?data:data?JSON.stringify(data):undefined,signal:abort?.signal});
   if(!response.ok){
    const value=await response.json().catch(()=>null);
    throw new ResponseError(value?.error||'请求失败',response.status);
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
