// Renew one viewer's demand while polling individual checkpoints; page changes never cancel
// server work. Manual control ends demand; durable background work is observed without retries,
// and tells the server which page is open only so that page is drawn first.
// An open picker also owns discovery demand and requests the next single story after each receipt.
import type {SessionView} from './reader-model.ts';
import {maxSuggestionBatches} from './reader-suggestions.ts';
import {randomId} from './reader-random-id.ts';
// Mode/control changes and passive reads must never turn a saved failure into a paid retry.
export function observeOnlyGeneration(session:SessionView){
 return session.state==='failed'||session.state==='completed'||session.generationMode==='background'||!!session.generationControl&&session.generationControl!=='active';
}
type Observation={sessionId:string;request:(path:string,method?:string,data?:unknown)=>Promise<SessionView>;isActive:()=>boolean;onSession:(session:SessionView)=>void;focus?:{viewerId:string;page:()=>number};watchChoices?:boolean;sleep?:(ms:number)=>Promise<void>;now?:()=>number};
// Inspecting a saved failure or paused story never renews demand or retries paid work.
export async function observeStoryGeneration({sessionId,request,isActive,onSession,focus,watchChoices=false,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}:Observation){
 const path='reader/sessions/'+sessionId;
 let failures=0,focusPage=-1,focusAt=-Infinity,focused=false,posting:Promise<unknown>|null=null,waiting=false;
 try{
  while(isActive()){
   try{
    const session=await request(path);
    if(!isActive())break;
    failures=0;onSession(session);
    // A choice can wait on another device or a search, so an open page keeps following it.
    const choosing=!!session.intake&&['choosing','confirming'].includes(session.intake.phase);waiting=choosing&&watchChoices;
    if(session.state==='completed'||session.awaitingFrameCount||choosing&&!watchChoices&&session.intake?.search?.state!=='searching')return '';
    const intake=session.intake,canDiscover=!!intake&&(intake.search.state==='searching'||watchChoices&&!intake.selected&&intake.phase==='choosing');
    if(focus&&(canDiscover||!choosing&&session.generationMode==='background')&&session.generationControl==='active'&&session.state!=='failed'){
     // The reader's page can be left over from another story until this one has a first image.
     const pages=session.story?.pages,page=pages?.[0]?.image?Math.min(focus.page(),pages.length-1):0;
     if(!posting&&(page!==focusPage||now()-focusAt>=10000)){
      focusPage=page;focusAt=now();focused=true;
      // Priority is best effort, so a slow or failed request must never hold up status updates.
      posting=request(path+'/production','POST',{viewerId:focus.viewerId,page,retry:false}).catch(()=>{}).finally(()=>{posting=null;});
     }
    }
    if(focus&&watchChoices&&isActive()&&intake&&!intake.selected&&intake.phase==='choosing'&&intake.search.state==='idle'&&intake.batches.length<maxSuggestionBatches&&intake.batches.at(-1)?.stories.length&&session.generationControl==='active'&&session.state!=='failed'){
     // A lost response must stop here, rather than retrying a paid request under a new identity.
     try{
      const next=await request(path+'/setup','POST',{action:'more',automatic:true,requestId:randomId(),generation:intake.generation});
      if(!isActive())break;
      onSession(next);
     }catch(error){return error instanceof Error?error.message:'连续查找暂时中断，请重试继续。';}
    }
   }catch(error){
    if(!isActive())break;
    // A connection can come back while a choice waits. A refusal, such as a deleted story, will not.
    const status=(error as {status?:number}).status;
    if(++failures>=3&&!(waiting&&(status===undefined||status>=500)))return error instanceof Error?error.message:'暂时无法更新生成状态，请稍后重新打开。';}
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
