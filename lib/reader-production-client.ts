// Renew one viewer's demand while polling individual checkpoints; page changes never cancel
// server work. Leaving releases only this viewer and the server drains already-paid results.
import type {SessionView} from './reader-model.ts';
type Options={sessionId:string;viewerId:string;page:()=>number;request:(path:string,method?:string,data?:unknown)=>Promise<SessionView>;retries:Map<string,number>;isActive:()=>boolean;onSession:(session:SessionView)=>void;sleep?:(ms:number)=>Promise<void>;now?:()=>number};
export async function runQueuedStoryGeneration({sessionId,viewerId,page,request,retries,isActive,onSession,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}:Options){
 const path='reader/sessions/'+sessionId;
 let heartbeat=-Infinity,lastPage=-1,transportRetries=0,lastProgress=now(),progress='',started=false;
 let session:SessionView|undefined,recovering=false;
 try{
  while(isActive()){
   try{
    if(recovering){session=await request(path);recovering=false;}
    else{
     const currentPage=page(),retry=session?.state==='failed';
     if(retry&&session){
      const key=sessionId+':'+session.stage,attempts=retries.get(key)||0;
      if(!session.retryAllowed||attempts>=2)return session.error||'制作暂停，请重试继续。';
      retries.set(key,attempts+1);
     }
     if(retry||currentPage!==lastPage||now()-heartbeat>=10000){
      started=true;session=await request(path+'/production','POST',{viewerId,page:currentPage,retry:!!retry});
      lastPage=currentPage;heartbeat=now();
     }else session=await request(path);
    }
    if(!isActive())break;
    transportRetries=0;onSession(session);
    if(session.state==='completed'||session.awaitingFrameCount)return '';
    const currentProgress=session.stage+':'+session.ready;
    if(currentProgress!==progress){progress=currentProgress;lastProgress=now();}
    if(session.state==='running'&&now()-lastProgress>360000)return '这一幅等待较久，请稍后重新打开故事继续。';
    if(session.state!=='running')lastProgress=now();
    await sleep(1000);
   }catch(error){
    if(!isActive())break;
    session=undefined;recovering=true;
    if(transportRetries++>=2)return error instanceof Error?error.message:'制作暂停，请重试继续。';
    await sleep(1000);
   }
  }
  return '';
 }finally{
  if(started)try{await request(path+'/production','DELETE',{viewerId});}catch{/* Expiring demand also stops dispatch after disconnect. */}
 }
}
