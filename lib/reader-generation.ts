// Resume checkpoints serially, hiding bounded transient retries from the reading flow.
// Re-read after transport failures because an interrupted request may have saved its result.
import type {SessionView} from './reader-model.ts';
import {readerImageBatchSize,readerMaxFrames} from './reader-limits.ts';

export function requestedImageEnd(page:number,length:number|'auto'){
 return Math.min((length==='auto'?readerMaxFrames:length)-1,(Math.floor(page/readerImageBatchSize)+1)*readerImageBatchSize-1);
}

type Options={
 sessionId:string;throughPage:number;
 request:(path:string,method?:string,data?:unknown)=>Promise<SessionView>;
 retries:Map<string,number>;isActive:()=>boolean;onSession:(session:SessionView)=>void;
 sleep?:(ms:number)=>Promise<void>;now?:()=>number;
};
export async function runStoryGeneration({sessionId,throughPage,request,retries,isActive,onSession,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}:Options):Promise<string>{
 const path='reader/sessions/'+sessionId;
 let lastProgress=now(),progress='';
 let session:SessionView|undefined,transportRetries=0;
 while(isActive()){
  try{
   session??=await request(path);
   if(!isActive())break;
   const s=session;
   onSession(s);
   const end=Math.min(throughPage,(s.story?.pages.length??(s.selection.length==='auto'?readerMaxFrames:s.selection.length))-1);
   const needed=!s.story||s.story.pages.slice(0,end+1).some(p=>!p.image||(s.selection.voice&&!p.audio));
   if(!needed||s.state==='completed')return '';
   // Out-of-order images count as progress even while the first missing scene stays unchanged.
   const currentProgress=s.stage+':'+s.ready;
   if(currentProgress!==progress){progress=currentProgress;lastProgress=now();}
   if(now()-lastProgress>360000)return '这一幅等待较久，请稍后重新打开故事继续。';
   if(s.state==='running'){
    await sleep(2000);
    if(!isActive())break;
   }
   const retry=s.state==='failed';
   if(retry){
    const key=sessionId+':'+s.stage,attempts=retries.get(key)||0;
    if(!s.retryAllowed||attempts>=2)return s.error||'这一步暂时没有完成，请再试一次。';
    retries.set(key,attempts+1);
   }
   session=await request(path+'/advance','POST',{throughPage:end,retry});
   transportRetries=0;
  }catch(error){
   if(!isActive())break;
   if(transportRetries++>=2)return error instanceof Error?error.message:'生成暂停，请再试一次。';
   session=undefined;
  }
 }
 return '';
}
