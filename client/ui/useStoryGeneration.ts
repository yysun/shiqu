'use client';
// Separate status inspection from viewer demand and publish saved artwork as it arrives.
// An open story reports its page so that page is drawn first; that never starts or retries work.
// Polls reuse unchanged session rows and the active snapshot, so idle polling does not re-render the reader.
// 写入 /read?id= 时保留当前历史条目的状态（返回键步骤登记的标记）。
import type {StoryPublication} from '@/lib/story-publication';
import {useEffect,useRef,useState} from 'react';
import {randomId,request} from './shared';
import {observeOnlyGeneration,observeStoryGeneration,runQueuedStoryGeneration} from '@/lib/reader-production-client';
import type {IntakeCommand} from '@/lib/reader-intake';
import {latestStoryVersions} from '@/lib/reader-versions';
import {keepSnapshot,shareRows} from '@/lib/reader-snapshots';
import type {GeneratedStory,Selection,SessionView,ProductionAction} from '@/lib/reader-model';
import {summarizeShelfSession,type ShelfSession,type ShelfChanges} from '@/lib/reader-shelf';
import type {RecoveryRequest} from '@/lib/reader-recovery';
type Callbacks={onStory:(story:GeneratedStory,initialPage?:number,saved?:boolean)=>void;onProgress:(rows:{storyId:string;page:number;saved:number;updatedAt?:string|null}[],fromShelf?:boolean)=>void};
export function useStoryGeneration(page:number,callbacks:Callbacks,watchShelf=false){
 const cb=useRef(callbacks);cb.current=callbacks;
 const currentPage=useRef(page);currentPage.current=page;
 const [sessions,setSessions]=useState<ShelfSession[]>([]),[active,setActive]=useState<SessionView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connected,setConnected]=useState(false),[wake,setWake]=useState(0);
 const librarySessions=useRef<ShelfSession[]>([]);
 // StrictMode replays startup effects; both runs share one initial library request.
 const startupLibrary=useRef<Promise<ShelfSession[]>|null>(null),libraryReadAt=useRef(0);
 const [libraryLoading,setLibraryLoading]=useState(true),[libraryRefreshing,setLibraryRefreshing]=useState(false),[libraryError,setLibraryError]=useState('');
 const live=useRef(true),libraryRead=useRef(0),libraryChanges=useRef(0),refreshingReads=useRef(0);
 const removed=useRef(new Set<string>());
 const creation=useRef<{signature:string;id:string}|null>(null);
 const id=useRef(''),resumeRead=useRef(0),pending=useRef<Promise<unknown>|null>(null),retries=useRef(new Map<string,number>());
 const [controlBusy,setControlBusy]=useState(''),[controlError,setControlError]=useState('');
 const controlLock=useRef(false);
 const generationMode=useRef<'observe'|'generate'>('observe'),retryRequested=useRef(false);
 const passive=useRef(false),recoveryCommand=useRef<RecoveryRequest|null>(null);
 const controlRequest=useRef<{signature:string;body:{requestId:string;action:ProductionAction}}|null>(null),overrideRequest=useRef<{signature:string;body:RecoveryRequest}|null>(null);
 const imageChecks=useRef(new Map<string,Promise<SessionView>>());
 const recoveries=useRef(new Map<string,RecoveryRequest>()),recovering=useRef(new Set<string>());
 function collect(s:SessionView,submitted=false){
  // Only the list response or a new submission may add members; historical reads only update known cards.
  if(removed.current.has(s.id)||!submitted&&!librarySessions.current.some(row=>row.id===s.id))return;
  const card=summarizeShelfSession(s),previous=librarySessions.current.find(row=>row.id===s.id);
  const version=previous?.version;
  if(previous&&keepSnapshot(previous,{...card,version})===previous)return;
  libraryChanges.current++;
  librarySessions.current=latestStoryVersions([card,...librarySessions.current.filter(row=>row.id!==s.id)]);
  setSessions(librarySessions.current);
 }
 useEffect(()=>{live.current=true;request('reader/status').then(s=>{if(live.current)setConnected(s.configured);}).catch(()=>{});startupLibrary.current??=request('reader/library/shelf');refreshLibrary(startupLibrary.current).catch(()=>{}).finally(()=>{if(live.current)setLibraryLoading(false);});return()=>{live.current=false;libraryRead.current++;resumeRead.current++;id.current='';};},[]);
 async function start(selection:Selection,intake=false){
  passive.current=false;
  const signature=JSON.stringify([selection,intake]);
  if(creation.current?.signature!==signature)creation.current={signature,id:randomId()};
  const requestId=creation.current.id;
  const s:SessionView=await request('reader/sessions','POST',{requestId,selection,...(intake?{intake:true}:{})});
  creation.current=null;generationMode.current=observeOnlyGeneration(s)?'observe':'generate';retryRequested.current=false;id.current=s.id;retries.current=new Map();
  setBusy(!observeOnlyGeneration(s));setError('');setActive(s);collect(s,true);
  // The task is saved. A blocked URL update must not report failure and invite a duplicate submission.
  try{history.replaceState(history.state,'','/read?id='+s.id);}catch{}
  setWake(v=>v+1);return s;
 }
 function recoveryFor(s:SessionView,faultId?:string){
  const fault=s.faults?.find(f=>f.retryAllowed&&(!faultId||f.id===faultId));
  if(!fault)throw Error(s.error||'这项问题已更新，请刷新后再操作。');
  let command=recoveries.current.get(fault.id);if(!command){command={requestId:randomId(),faultId:fault.id};recoveries.current.set(fault.id,command);}
  recoveryCommand.current=command;return command;
 }
 function adopt(s:SessionView,readOnly=false,initialPage?:number){
  resumeRead.current++;id.current=s.id;passive.current=readOnly;generationMode.current=readOnly||observeOnlyGeneration(s)?'observe':'generate';retryRequested.current=false;
  setActive(s);collect(s,true);setBusy(false);setError(s.state==='failed'?s.error||'生成失败，请选择对应问题恢复。':'');
  try{history.replaceState(history.state,'','/read?id='+s.id);}catch{}
  cb.current.onProgress([{storyId:s.id,page:s.page,saved:s.saved?1:0,updatedAt:s.lastReadAt||s.createdAt}]);
  if(s.story?.pages[0]?.image)cb.current.onStory(s.story,initialPage,s.saved);setWake(v=>v+1);
 }
 async function resume(sessionId:string,initialPage?:number,retry=false,submitted=false,faultId?:string){
  const read=++resumeRead.current;
  id.current=sessionId;passive.current=false;retries.current=new Map();setError('');
  const s:SessionView=await request('reader/sessions/'+sessionId);if(read!==resumeRead.current||id.current!==sessionId||removed.current.has(sessionId))return;
  if(retry)recoveryFor(s,faultId);
  passive.current=!!s.intake&&!s.intake.selected&&!(s.selection.discovery?.mode==='auto'&&s.selection.discovery.combine);
  generationMode.current=retry||!passive.current&&!observeOnlyGeneration(s)?'generate':'observe';retryRequested.current=retry;
  setBusy(retry);setError(!retry&&s.state==='failed'?s.error||'生成失败，请选择对应问题恢复。':'');setActive(s);collect(s,submitted);
  history.replaceState(history.state,'','/read?id='+s.id);cb.current.onProgress([{storyId:s.id,page:s.page,saved:s.saved?1:0,updatedAt:s.lastReadAt||s.createdAt}]);
  if(s.story?.pages[0]?.image)cb.current.onStory(s.story,Math.max(0,Math.min(initialPage??s.page,s.story.pages.length-1)),s.saved);setWake(v=>v+1);return s;
 }
 async function checkImage(sessionId:string,page:number,image:string){
  const key=JSON.stringify([sessionId,page,image]),existing=imageChecks.current.get(key);if(existing)return existing;
  const operation=request(`reader/sessions/${sessionId}/image-health`,'POST',{page,image}).then((s:SessionView)=>{
   collect(s);if(id.current===sessionId){generationMode.current='observe';setActive(s);setError(s.state==='failed'?s.error||'图片需要处理。':'');if(s.story)cb.current.onStory(s.story);setWake(v=>v+1);}return s;
  }).finally(()=>imageChecks.current.delete(key));
  imageChecks.current.set(key,operation);return operation;
 }

 const setupLock=useRef(false),setupRequest=useRef<{signature:string;body:IntakeCommand&{requestId:string;generation:number}}|null>(null);
 const [setupBusy,setSetupBusy]=useState(false);
 async function setup(command:IntakeCommand){
  if(!active?.intake||setupLock.current)return;
  passive.current=false;
  const sessionId=active.id,signature=JSON.stringify([sessionId,command]);
  if(setupRequest.current?.signature!==signature)setupRequest.current={signature,body:{...command,requestId:randomId(),generation:active.intake.generation}};
  setupLock.current=true;setSetupBusy(true);
  try{const s:SessionView=await request(`reader/sessions/${sessionId}/setup`,'POST',setupRequest.current.body);setupRequest.current=null;if(id.current===sessionId){generationMode.current=observeOnlyGeneration(s)?'observe':'generate';setActive(s);collect(s);setError('');setWake(v=>v+1);}return s;}
  catch(error){
   // A rejected body stays rejected. Only a lost response may repeat it, so start again from what is saved now.
   if((error as {status?:number}).status!==undefined){
    setupRequest.current=null;
    await request('reader/sessions/'+sessionId).then((s:SessionView)=>{if(id.current===sessionId){setActive(s);collect(s);}}).catch(()=>{});
   }
   throw error;
  }
  finally{setupLock.current=false;setSetupBusy(false);}
 }
 async function retrySession(sessionId:string,faultId?:string){const s:SessionView=await request('reader/sessions/'+sessionId);adopt(s,false,s.page);await recoverFault(s,faultId);}
 async function renameTitle(sessionId:string,title:string){
  const s:SessionView=await request(`reader/sessions/${sessionId}/title`,'POST',{title});
  collect(s);
  if(id.current===sessionId){setActive(s);if(s.story)cb.current.onStory(s.story);}
 }
 async function savePublication(sessionId:string,publication:StoryPublication,expected:StoryPublication|null){
  try{
   const s:SessionView=await request(`reader/sessions/${sessionId}/publication`,'POST',{publication,expected});
   collect(s);if(id.current===sessionId){setActive(s);if(s.story)cb.current.onStory(s.story);}
  }catch(error){
   if((error as {status?:number}).status===409){
    const s:SessionView=await request(`reader/sessions/${sessionId}`);
    collect(s);if(id.current===sessionId){setActive(s);if(s.story)cb.current.onStory(s.story);}
   }
   throw error;
  }
 }
 async function confirmFrameCount(count:number|'auto'){
  if(busy||pending.current||!active?.awaitingFrameCount)return;
  const sessionId=active.id;setBusy(true);setError('');
  try{
   let s:SessionView;
   try{s=await request('reader/sessions/'+sessionId+'/frame-count','POST',{count});}
   catch(error){
    // A lost confirmation response must not replace an accepted choice or create a new story.
    const current:SessionView=await request('reader/sessions/'+sessionId);
    if(current.awaitingFrameCount||current.selection.length!==count)throw error;
    s=current;
   }
   if(id.current!==sessionId||removed.current.has(sessionId))return;
   generationMode.current=observeOnlyGeneration(s)?'observe':'generate';retryRequested.current=false;setActive(s);collect(s);retries.current=new Map();setWake(v=>v+1);
  }catch(error){if(id.current===sessionId)setError(error instanceof Error?error.message:'画幅数暂未保存，请再试一次。');}
  finally{if(id.current===sessionId)setBusy(false);}
 }
 async function control(sessionId:string,action:ProductionAction){
  if(controlLock.current)return;controlLock.current=true;setControlBusy(sessionId);setControlError('');
  const signature=JSON.stringify([sessionId,action]);if(controlRequest.current?.signature!==signature)controlRequest.current={signature,body:{requestId:randomId(),action}};
  try{
   const s:SessionView=await request('reader/sessions/'+sessionId+'/production-control','POST',controlRequest.current.body);
   controlRequest.current=null;passive.current=false;
   collect(s);
   if(id.current===sessionId){
    generationMode.current=observeOnlyGeneration(s)?'observe':'generate';
    retryRequested.current=false;setActive(s);setError(s.state==='failed'?s.error||'生成失败，请重试继续。':'');setWake(v=>v+1);
   }
  }catch(error){if((error as {status?:number}).status!==undefined)controlRequest.current=null;setControlError(error instanceof Error?error.message:'生成方式暂未保存，请重试。');}
  finally{controlLock.current=false;setControlBusy('');}
 }
 async function drawAnyway(sessionId:string){
  if(controlLock.current)return;controlLock.current=true;setControlBusy(sessionId);setControlError('');
  try{
   const current:SessionView=active?.id===sessionId?active:await request('reader/sessions/'+sessionId);
   const fault=current.faults?.find(f=>f.stage==='review'&&f.state==='pending');if(!fault&&!overrideRequest.current?.signature.startsWith(JSON.stringify([sessionId]).slice(0,-1)+','))throw Error('审核问题已更新，请刷新后再处理。');
   if(fault){const signature=JSON.stringify([sessionId,fault.id]);if(overrideRequest.current?.signature!==signature)overrideRequest.current={signature,body:{requestId:randomId(),faultId:fault.id}};}
   const s:SessionView=await request(`reader/sessions/${sessionId}/review-override`,'POST',overrideRequest.current!.body);
   overrideRequest.current=null;passive.current=false;
   collect(s);
   if(id.current===sessionId){setActive(s);setError(s.state==='failed'?s.error||'生成失败，请重试继续。':'');setWake(v=>v+1);}
  }catch(error){setControlError(error instanceof Error?error.message:'操作暂未保存，请重试。');}
  finally{controlLock.current=false;setControlBusy('');}
 }
 function leave(){resumeRead.current++;id.current='';setActive(null);setBusy(false);setError('');}
 function remove(sessionId:string){libraryChanges.current++;removed.current.add(sessionId);if(id.current===sessionId)leave();librarySessions.current=librarySessions.current.filter(s=>s.id!==sessionId);setSessions(librarySessions.current);}
 function publishShelf(rows:ShelfSession[],updated:ShelfSession[]){
  for(const row of updated)removed.current.delete(row.id);
  libraryReadAt.current=Date.now();
  librarySessions.current=shareRows(librarySessions.current,rows,row=>row.id);setSessions(librarySessions.current);setLibraryError('');
  if(updated.length)cb.current.onProgress(updated.map(s=>({storyId:s.id,page:s.page,saved:s.saved?1:0,updatedAt:s.lastReadAt||s.createdAt})),true);
 }
 async function refreshLibrary(snapshot?:Promise<ShelfSession[]>){
  const read=++libraryRead.current,changes=libraryChanges.current;
  refreshingReads.current++;setLibraryRefreshing(true);
  try{
   const rows:ShelfSession[]=await (snapshot||request('reader/library/shelf'));
   if(live.current&&read===libraryRead.current&&changes===libraryChanges.current)publishShelf(rows,rows);
   return rows;
  }catch(error){if(live.current&&read===libraryRead.current)setLibraryError('书架刷新失败，请重试。');throw error;}
  finally{if(--refreshingReads.current===0&&live.current)setLibraryRefreshing(false);}
 }
 async function refreshChanges(isCurrent:()=>boolean){
  if(refreshingReads.current)return;
  const read=++libraryRead.current,changes=libraryChanges.current,previous=librarySessions.current;
  try{
   const delta:ShelfChanges=await request('reader/library/shelf','POST',previous.map(row=>[row.id,row.version||'']),true);
   if(!live.current||!isCurrent()||read!==libraryRead.current||changes!==libraryChanges.current)return;
   if(!delta.changed.length&&!delta.removed.length){libraryReadAt.current=Date.now();setLibraryError('');return;}
   const rows=new Map(previous.map(row=>[row.id,row]));
   for(const id of delta.removed)rows.delete(id);
   for(const row of delta.changed)rows.set(row.id,row);
   publishShelf([...rows.values()],delta.changed);
  }catch(error){if(live.current&&isCurrent()&&read===libraryRead.current)setLibraryError('书架刷新失败，请重试。');throw error;}
 }
 const refresh=useRef(refreshChanges);refresh.current=refreshChanges;
 useEffect(()=>{
  if(!watchShelf||libraryLoading||active?.id)return;
  let stopped=false,inFlight=false;
  async function update(){
   if(stopped||inFlight||document.visibilityState==='hidden')return;
   inFlight=true;try{await refresh.current(()=>!stopped);}catch{/* Keep saved cards visible; expose the retry beside them. */}finally{inFlight=false;}
  }
  // A fresh startup snapshot needs no immediate second database read.
  if(Date.now()-libraryReadAt.current>=4000)void update();const timer=setInterval(()=>void update(),4000);
  window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[watchShelf,libraryLoading,active?.id]);
 async function recoverFault(s:SessionView,faultId?:string){
  const command=recoveryFor(s,faultId);if(recovering.current.has(command.faultId))return;
  recovering.current.add(command.faultId);setError('');
  try{
   const next:SessionView=await request(`reader/sessions/${s.id}/recover`,'POST',command);
   collect(next);if(id.current===s.id){passive.current=false;generationMode.current=next.generationMode==='reader'&&next.generationControl==='active'?'generate':'observe';setActive(next);setWake(v=>v+1);}
  }catch(e){if(id.current===s.id)setError(e instanceof Error?e.message:'恢复暂未受理，请重试。');}
  finally{recovering.current.delete(command.faultId);}
 }
 async function retryStep(faultId?:string){if(!active?.retryAllowed)return;await recoverFault(active,faultId);}

 useEffect(()=>{
  const sessionId=active?.id;if(!sessionId||active.state==='completed'&&!retryRequested.current)return;
  let cancelled=false;
  async function run(){
   if(pending.current)await pending.current;
   if(cancelled||id.current!==sessionId||removed.current.has(sessionId))return;
   const inspecting=generationMode.current==='observe',initialRetry=retryRequested.current;retryRequested.current=false;
   setBusy(!inspecting);
   const isActive=()=>!cancelled&&id.current===sessionId&&!removed.current.has(sessionId);
   const onSession=(s:SessionView)=>{
    const generating=s.productionState?s.productionState==='running'||s.productionState==='queued':s.state==='running';
    if(s.generationMode==='background'||s.generationControl&&s.generationControl!=='active'){if(!inspecting){generationMode.current='observe';setWake(v=>v+1);}}
    collect(s);setActive(old=>keepSnapshot(old,s));setBusy(!inspecting&&(generating||s.state==='failed'));setError(s.state==='failed'?(s.error||'生成失败，请重试继续。'):'');
    if(s.story?.pages[0]?.image){
     cb.current.onStory(s.story);
     if(inspecting&&!passive.current&&!observeOnlyGeneration(s)){generationMode.current='generate';setWake(v=>v+1);}
    }
   };
   const operation=inspecting?observeStoryGeneration({sessionId,request,isActive,onSession,focus:passive.current?undefined:{viewerId:randomId(),page:()=>currentPage.current},watchChoices:!passive.current}):runQueuedStoryGeneration({sessionId,viewerId:randomId(),page:()=>currentPage.current,request,retries:retries.current,initialRetry,initialRecovery:initialRetry?recoveryCommand.current||undefined:undefined,isActive,onSession});
   pending.current=operation;
   try{const message=await operation;if(!cancelled&&id.current===sessionId)setError(message);}
   finally{if(pending.current===operation)pending.current=null;if(!cancelled&&id.current===sessionId)setBusy(false);}
  }
  run();return()=>{cancelled=true;};
 },[active?.id,wake]);
 return {adopt,checkImage,setup,setupBusy,sessions,active,busy,error,connected,libraryLoading,libraryRefreshing,libraryError,start,resume,retrySession,renameTitle,savePublication,leave,remove,refreshLibrary,retryStep,confirmFrameCount,control,drawAnyway,controlBusy,controlError};
}
