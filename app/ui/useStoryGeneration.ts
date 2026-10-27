'use client';
// Advance saved checkpoints serially; failures resume only after an explicit reader action.
import {useEffect,useRef,useState} from 'react';
import {randomId,request} from './shared';
import type {GeneratedStory,Selection,SessionView} from '@/lib/reader-model';
type Callbacks={onStory:(story:GeneratedStory,initialPage?:number,saved?:boolean)=>void;onProgress:(rows:{storyId:string;page:number;saved:number;updatedAt?:string|null}[])=>void};
export function useStoryGeneration(page:number,callbacks:Callbacks){
 const cb=useRef(callbacks);cb.current=callbacks;
 const [sessions,setSessions]=useState<SessionView[]>([]),[active,setActive]=useState<SessionView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connected,setConnected]=useState(false),[wake,setWake]=useState(0);
 const removed=useRef(new Set<string>());
 const creation=useRef<{signature:string;id:string}|null>(null);
 const id=useRef(''),pending=useRef<Promise<unknown>|null>(null),retry=useRef(false);
 function collect(s:SessionView){if(removed.current.has(s.id))return;setSessions(old=>[s,...old.filter(x=>x.id!==s.id)]);}
 useEffect(()=>{let live=true;request('reader/status').then(s=>{if(live)setConnected(s.configured);}).catch(()=>{});request('reader/sessions').then((rows:SessionView[])=>{if(!live)return;const visible=rows.filter(s=>!removed.current.has(s.id));setSessions(visible);cb.current.onProgress(visible.map(s=>({storyId:s.id,page:s.page,saved:s.saved?1:0,updatedAt:s.lastReadAt||s.createdAt})));}).catch(()=>{});return()=>{live=false;id.current='';};},[]);
 async function start(selection:Selection){const signature=JSON.stringify(selection);if(creation.current?.signature!==signature)creation.current={signature,id:randomId()};const requestId=creation.current.id;const s:SessionView=await request('reader/sessions','POST',{requestId,selection});creation.current=null;id.current=s.id;retry.current=false;setError('');setActive(s);collect(s);history.replaceState(null,'','/read?id='+s.id);setWake(v=>v+1);return s;}
 async function resume(sessionId:string,initialPage?:number){id.current=sessionId;retry.current=false;setError('');const s:SessionView=await request('reader/sessions/'+sessionId);if(id.current!==sessionId||removed.current.has(sessionId))return;setActive(s);collect(s);cb.current.onProgress([{storyId:s.id,page:s.page,saved:s.saved?1:0,updatedAt:s.lastReadAt||s.createdAt}]);if(s.story?.pages[0]?.image)cb.current.onStory(s.story,initialPage??s.page,s.saved);setWake(v=>v+1);}
 function leave(){id.current='';setActive(null);setBusy(false);setError('');}
 function remove(sessionId:string){removed.current.add(sessionId);if(id.current===sessionId)leave();setSessions(old=>old.filter(s=>s.id!==sessionId));}
 function retryStep(){if(busy||pending.current||retry.current||!active?.retryAllowed||(active.retryAt||0)>Date.now())return;retry.current=true;setBusy(true);setError('');setWake(v=>v+1);}
 useEffect(()=>{
  const sessionId=active?.id;if(!sessionId)return;
  let cancelled=false;
  async function run(){
   if(pending.current)await pending.current;
   if(cancelled||id.current!==sessionId||removed.current.has(sessionId))return;
   setBusy(true);const started=Date.now();
   try{
    let s:SessionView=await request('reader/sessions/'+sessionId);
    while(!cancelled&&id.current===sessionId&&!removed.current.has(sessionId)){
     collect(s);setActive(s);
     if(s.story?.pages[0]?.image)cb.current.onStory(s.story);
     if(s.state==='failed'&&!retry.current){setError(s.error||'这一步暂时没有完成');break;}
     const end=Math.min(page+1,s.selection.length-1);
     const needed=!s.story||s.story.pages.slice(0,end+1).some(p=>!p.image||(s.selection.voice&&!p.audio));
     if(!needed||s.state==='completed')break;
     if(Date.now()-started>360000){setError('这一幅等待较久，请稍后重新打开故事继续。');break;}
     if(s.state==='running'){await new Promise(r=>setTimeout(r,2000));if(cancelled)break;s=await request('reader/sessions/'+sessionId+'/advance','POST',{throughPage:end,retry:false});continue;}
     const retryNow=retry.current;retry.current=false;
     const operation:Promise<SessionView>=request('reader/sessions/'+sessionId+'/advance','POST',{throughPage:end,retry:retryNow});
     pending.current=operation.catch(()=>{});s=await operation;
    }
   }catch(e){if(!cancelled&&id.current===sessionId)setError(e instanceof Error?e.message:'生成暂停，请重新打开故事继续。');}
   finally{pending.current=null;retry.current=false;if(!cancelled)setBusy(false);}
  }
  run();return()=>{cancelled=true;};
 },[active?.id,page,wake]);
 return {sessions,active,busy,error,connected,start,resume,leave,remove,retryStep};
}
