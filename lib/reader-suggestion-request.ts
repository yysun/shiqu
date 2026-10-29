// Read real whole-book progress; stalled or disconnected streams must release the picker.
import {suggestionBatchSchema,suggestionProgressSchema} from './reader-suggestions.ts';
import type {SuggestionBatch,SuggestionProgress} from './reader-suggestions.ts';

export async function requestSuggestions(data:unknown,signal:AbortSignal,onProgress:(progress:SuggestionProgress)=>void,transport:typeof fetch=fetch,idleMs=210000):Promise<SuggestionBatch>{
 const abort=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
 const cancel=()=>abort.abort(signal.reason);
 signal.addEventListener('abort',cancel,{once:true});
 if(signal.aborted)cancel();
 const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;abort.abort();},idleMs);};
 touch();
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const response=await transport('/api/reader/suggestions',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify(data),signal:abort.signal});
  if(!response.ok){let message='选题服务暂时不可用，请稍后重试。';try{const value=await response.json();if(typeof value.error==='string')message=value.error;}catch{}throw new Error(message);}
  if(!response.body||!response.headers.get('content-type')?.includes('application/x-ndjson'))throw new Error('选题连接已中断，请重试。');
  reader=response.body.getReader();
  const decoder=new TextDecoder();let buffer='';
  while(true){
   const {value,done}=await reader.read();
   buffer+=decoder.decode(value,{stream:!done});
   let newline:number;
   while((newline=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;
    const event=JSON.parse(line);
    if(event.type==='progress'){onProgress(suggestionProgressSchema.parse(event.progress));touch();}
    else if(event.type==='result')return suggestionBatchSchema.parse(event.batch);
    else if(event.type==='error')throw new Error(typeof event.error==='string'?event.error:'选题暂时不可用，请重试。');
    else throw new Error('选题响应不完整，请重试。');
   }
   if(done)throw new Error('选题连接已中断，请重试。');
  }
 }catch(error){
  if(timedOut)throw new Error('通读等待超时，请重试。前面的推荐批次已保留。');
  throw error;
 }finally{
  clearTimeout(timer);signal.removeEventListener('abort',cancel);
  await reader?.cancel().catch(()=>{});
 }
}
