// Renew one viewer's demand while polling individual checkpoints; page changes never cancel
// server work. Manual control ends demand; durable background work is observed without retries,
// and tells the server which page is open only so that page is drawn first.
import type {SessionView} from './reader-model.ts';
// Mode/control changes and passive reads must never turn a saved failure into a paid retry.
export function observeOnlyGeneration(session:SessionView){
 return session.state==='failed'||session.state==='completed'||session.generationMode==='background'||!!session.generationControl&&session.generationControl!=='active';
}
type Observation={sessionId:string;request:(path:string,method?:string,data?:unknown)=>Promise<SessionView>;isActive:()=>boolean;onSession:(session:SessionView)=>void;focus?:{viewerId:string;page:()=>number};sleep?:(ms:number)=>Promise<void>;now?:()=>number};
// Inspecting a saved failure or paused story never renews demand or retries paid work.
export async function observeStoryGeneration({sessionId,request,isActive,onSession,focus,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}:Observation){
 const path='reader/sessions/'+sessionId;
 let failures=0,focusPage=-1,focusAt=-Infinity,focused=false,posting:Promise<unknown>|null=null;
 try{
  while(isActive()){
   try{
    const session=await request(path);
    if(!isActive())break;
    failures=0;onSession(session);
    if(session.state==='completed'||session.awaitingFrameCount||session.intake&&['choosing','confirming'].includes(session.intake.phase))return '';
    if(focus&&session.generationMode==='background'&&session.generationControl==='active'&&session.state!=='failed'){
     // The reader's page can be left over from another story until this one has a first image.
     const pages=session.story?.pages,page=pages?.[0]?.image?Math.min(focus.page(),pages.length-1):0;
     if(!posting&&(page!==focusPage||now()-focusAt>=10000)){
      focusPage=page;focusAt=now();focused=true;
      // Priority is best effort, so a slow or failed request must never hold up status updates.
      posting=request(path+'/production','POST',{viewerId:focus.viewerId,page,retry:false}).catch(()=>{}).finally(()=>{posting=null;});
     }
    }
   }catch(error){if(!isActive())break;if(++failures>=3)return error instanceof Error?error.message:'暂时无法更新生成状态，请稍后重新打开。';}
   await sleep(1000);
  }
  return '';
 }finally{
  if(focused)try{if(posting)await Promise.race([posting,sleep(2000)]);await request(path+'/production','DELETE',{viewerId:focus!.viewerId});}catch{/* Expiring demand also ends priority after disconnect. */}
 }
}
type Options={sessionId:string;viewerId:string;page:()=>number;request:(path:string,method?:string,data?:unknown)=>Promise<SessionView>;retries:Map<string,number>;isActive:()=>boolean;onSession:(session:SessionView)=>void;initialRetry?:boolean;sleep?:(ms:number)=>Promise<void>;now?:()=>number};
export async function runQueuedStoryGeneration({sessionId,viewerId,page,request,retries,isActive,onSession,initialRetry=false,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}:Options){
 const path='reader/sessions/'+sessionId;
 let heartbeat=-Infinity,lastPage=-1,transportRetries=0,lastProgress=now(),progress='',started=false;
 let session:SessionView|undefined,recovering=false;
 try{
  while(isActive()){
   try{
    if(recovering){session=await request(path);recovering=false;}
    else{
     const currentPage=page(),retry=initialRetry||session?.state==='failed';
     if(retry&&session){
      if(session.retryStage==='review'&&!initialRetry)return session.error||'分镜审片尚未通过，请手动继续修订。';
      if(session.retryStage==='redraw'&&!initialRetry)return session.error||'这幅图片需要重新绘制，请手动重试。';
      const key=sessionId+':'+session.stage,attempts=retries.get(key)||0;
      if(!session.retryAllowed||attempts>=2)return session.error||'制作暂停，请重试继续。';
      retries.set(key,attempts+1);
     }
     if(retry||currentPage!==lastPage||now()-heartbeat>=10000){
      started=true;initialRetry=false;session=await request(path+'/production','POST',{viewerId,page:currentPage,retry:!!retry});
      lastPage=currentPage;heartbeat=now();
     }else session=await request(path);
    }
    if(!isActive())break;
    transportRetries=0;onSession(session);
    if(session.state==='completed'||session.awaitingFrameCount||session.generationMode==='background'||session.generationControl&&session.generationControl!=='active')return '';
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
