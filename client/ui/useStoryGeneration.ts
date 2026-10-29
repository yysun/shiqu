'use client';
// Maintain viewer demand independently of navigation and publish each saved image as it arrives.
import {useEffect,useRef,useState} from 'react';
import {randomId,request} from './shared';
import {runQueuedStoryGeneration} from '@/lib/reader-production-client';
import type {GeneratedStory,Selection,SessionView} from '@/lib/reader-model';
type Callbacks={onStory:(story:GeneratedStory,initialPage?:number,saved?:boolean)=>void;onProgress:(rows:{storyId:string;page:number;saved:number;updatedAt?:string|null}[])=>void};
export function useStoryGeneration(page:number,callbacks:Callbacks,watchShelf=false){
 const cb=useRef(callbacks);cb.current=callbacks;
 const currentPage=useRef(page);currentPage.current=page;
 const [sessions,setSessions]=useState<SessionView[]>([]),[active,setActive]=useState<SessionView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connected,setConnected]=useState(false),[wake,setWake]=useState(0);
 const [libraryLoading,setLibraryLoading]=useState(true),[libraryRefreshing,setLibraryRefreshing]=useState(false),[libraryError,setLibraryError]=useState('');
 const live=useRef(true),libraryRead=useRef(0),libraryChanges=useRef(0);
 const removed=useRef(new Set<string>());
 const creation=useRef<{signature:string;id:string}|null>(null);
 const id=useRef(''),pending=useRef<Promise<unknown>|null>(null),retries=useRef(new Map<string,number>());
 function collect(s:SessionView){if(removed.current.has(s.id))return;libraryChanges.current++;setSessions(old=>[s,...old.filter(x=>x.id!==s.id)]);}
 useEffect(()=>{live.current=true;request('reader/status').then(s=>{if(live.current)setConnected(s.configured);}).catch(()=>{});refreshLibrary().catch(()=>{}).finally(()=>{if(live.current)setLibraryLoading(false);});return()=>{live.current=false;libraryRead.current++;id.current='';};},[]);
 async function start(selection:Selection){const signature=JSON.stringify(selection);if(creation.current?.signature!==signature)creation.current={signature,id:randomId()};const requestId=creation.current.id;const s:SessionView=await request('reader/sessions','POST',{requestId,selection});creation.current=null;id.current=s.id;retries.current=new Map();setError('');setActive(s);collect(s);history.replaceState(null,'','/read?id='+s.id);setWake(v=>v+1);return s;}
 async function resume(sessionId:string,initialPage?:number){id.current=sessionId;retries.current=new Map();setError('');const s:SessionView=await request('reader/sessions/'+sessionId);if(id.current!==sessionId||removed.current.has(sessionId))return;setActive(s);collect(s);history.replaceState(null,'','/read?id='+s.id);cb.current.onProgress([{storyId:s.id,page:s.page,saved:s.saved?1:0,updatedAt:s.lastReadAt||s.createdAt}]);if(s.story?.pages[0]?.image)cb.current.onStory(s.story,initialPage??s.page,s.saved);setWake(v=>v+1);}
 async function confirmFrameCount(count:number){
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
   setActive(s);collect(s);retries.current=new Map();setWake(v=>v+1);
  }catch(error){if(id.current===sessionId)setError(error instanceof Error?error.message:'画幅数暂未保存，请再试一次。');}
  finally{if(id.current===sessionId)setBusy(false);}
 }
 function leave(){id.current='';setActive(null);setBusy(false);setError('');}
 function remove(sessionId:string){libraryChanges.current++;removed.current.add(sessionId);if(id.current===sessionId)leave();setSessions(old=>old.filter(s=>s.id!==sessionId));}
 async function refreshLibrary(restoredId?:string,isCurrent:()=>boolean=()=>true){
  // A recovery reads snapshots only; resume() would create viewer demand and can dispatch generation.
  const read=++libraryRead.current,changes=libraryChanges.current;setLibraryRefreshing(true);
  try{
   const [rows,restored]:[SessionView[],SessionView|null]=await Promise.all([request('reader/sessions'),restoredId?request('reader/sessions/'+encodeURIComponent(restoredId)):Promise.resolve(null)]);
   if(restored&&live.current&&read===libraryRead.current)removed.current.delete(restored.id);
   const visible=(restored?[restored,...rows.filter(s=>s.id!==restored.id)]:rows).filter(s=>!removed.current.has(s.id));
   if(live.current&&isCurrent()&&read===libraryRead.current&&changes===libraryChanges.current){
    setSessions(visible);setLibraryError('');
    cb.current.onProgress(visible.map(s=>({storyId:s.id,page:s.page,saved:s.saved?1:0,updatedAt:s.lastReadAt||s.createdAt})));
   }
   return visible;
  }catch(error){if(live.current&&isCurrent()&&read===libraryRead.current)setLibraryError('书架刷新失败，请重试。');throw error;}
  finally{if(live.current&&read===libraryRead.current)setLibraryRefreshing(false);}
 }
 const refresh=useRef(refreshLibrary);refresh.current=refreshLibrary;
 useEffect(()=>{
  if(!watchShelf||libraryLoading||active?.id)return;
  let stopped=false,inFlight=false;
  async function update(){
   if(stopped||inFlight||document.visibilityState==='hidden')return;
   inFlight=true;try{await refresh.current(undefined,()=>!stopped);}catch{/* Keep saved cards visible; expose the retry beside them. */}finally{inFlight=false;}
  }
  void update();const timer=setInterval(()=>void update(),4000);
  window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);if(live.current)setLibraryRefreshing(false);};
 },[watchShelf,libraryLoading,active?.id]);
 function retryStep(){if(busy||pending.current||!active?.retryAllowed)return;retries.current=new Map();setBusy(true);setError('');setWake(v=>v+1);}
 useEffect(()=>{
  const sessionId=active?.id;if(!sessionId)return;
  let cancelled=false;
  async function run(){
   if(pending.current)await pending.current;
   if(cancelled||id.current!==sessionId||removed.current.has(sessionId))return;
   setBusy(true);setError('');
   const operation=runQueuedStoryGeneration({sessionId,viewerId:randomId(),page:()=>currentPage.current,request,retries:retries.current,
    isActive:()=>!cancelled&&id.current===sessionId&&!removed.current.has(sessionId),
    onSession:s=>{collect(s);setActive(s);setBusy(s.state==='running');if(s.story?.pages[0]?.image)cb.current.onStory(s.story);},
   });
   pending.current=operation;
   try{const message=await operation;if(!cancelled&&id.current===sessionId)setError(message);}
   finally{if(pending.current===operation)pending.current=null;if(!cancelled&&id.current===sessionId)setBusy(false);}
  }
  run();return()=>{cancelled=true;};
 },[active?.id,wake]);
 return {sessions,active,busy,error,connected,libraryLoading,libraryRefreshing,libraryError,start,resume,leave,remove,refreshLibrary,retryStep,confirmFrameCount};
}
