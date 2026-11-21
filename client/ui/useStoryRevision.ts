'use client';
// Keep edits separate from live production until one explicit, idempotent revision submission.
// A draft outlives progress on its story. Review links select saved frame numbers; zero selects the ending.
import {useEffect,useRef,useState} from 'react';
import {randomId,request} from './shared';
import {checkedRevision,revisionImpact} from '@/lib/reader-revision';
import type {RevisionChanges,RevisionSnapshot} from '@/lib/reader-revision';
import type {SessionView} from '@/lib/reader-model';
import type {StoryEditorTab} from './StoryProductionEditor';
export type RevisionTab=StoryEditorTab|'review';
export function useStoryRevision(storyId:string|undefined,onSubmitted:(session:SessionView,changes:RevisionChanges)=>Promise<void>,onOpenLatest?:(storyId:string)=>Promise<void>){
 const [tab,setTab]=useState<RevisionTab|null>(null),[base,setBase]=useState<RevisionSnapshot|null>(null),[changes,setChanges]=useState<RevisionChanges>({}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 const [scriptPage,setScriptPage]=useState(1),[summarizing,setSummarizing]=useState(false);
 const latest=useRef(storyId);latest.current=storyId;
 const currentChanges=useRef(changes);currentChanges.current=changes;
 const read=useRef(0),lock=useRef(false),submission=useRef<{signature:string;id:string}|null>(null),callback=useRef(onSubmitted);callback.current=onSubmitted;
 useEffect(()=>{read.current++;setTab(null);setScriptPage(1);setBase(null);setChanges({});setError('');setConflict(false);setLoading(false);submission.current=null;},[storyId]);
 async function readSnapshot(openLatest=false){
  if(!storyId)return;const serial=++read.current,id=storyId;setLoading(true);setError('');
  const isCurrent=()=>latest.current===id&&read.current===serial;
  try{
   if(openLatest&&onOpenLatest){
    const current:{id:string}=await request(`reader/sessions/${id}/current`);
    if(!isCurrent())return;
    if(current.id!==id){await onOpenLatest(current.id);return;}
   }
   const snapshot:RevisionSnapshot=await request(`reader/sessions/${id}/revisions`);
   if(isCurrent()){setBase(snapshot);setChanges({});setConflict(false);submission.current=null;}
  }
  catch(e){
   if(isCurrent()){
    setError(e instanceof Error?e.message:'编辑内容暂时无法载入。');
    if((e as {status?:number}).status===409)setConflict(true);
   }
  }
  finally{if(latest.current===id&&read.current===serial)setLoading(false);}
 }
 const load=()=>readSnapshot();
 async function loadLatest(){
  if(lock.current)return;
  lock.current=true;setBusy(true);
  try{await readSnapshot(true);}finally{lock.current=false;setBusy(false);}
 }
 // Compare a saved draft with its story again; newer images only improve what can be reused.
 async function refresh(submitted?:RevisionChanges){
  if(!storyId||!base)return;const serial=++read.current,id=storyId;
  try{
   const snapshot:RevisionSnapshot=await request(`reader/sessions/${id}/revisions`);
   if(latest.current!==id||read.current!==serial)return;
   if(snapshot.token===base.token){setBase(snapshot);setConflict(false);return;}
   if(revisionImpact(base,submitted??currentChanges.current).changed){setConflict(true);setError('');}
   else{setBase(snapshot);setChanges({});setConflict(false);}
  }catch(e){
   // 旧版无法读取编辑快照，保留当前草稿并提供切换到书架当前版本的入口。
   if(latest.current===id&&read.current===serial&&(e as {status?:number}).status===409)setConflict(true);
  }
 }
 function prepare(){if(!base&&!loading)void load();}
 function open(value:RevisionTab,page=1){setTab(value);if(value==='script')setScriptPage(page);if(loading)return;if(!base)void load();else void refresh();}
 function discard(){setBase(null);setChanges({});setTab(null);setError('');setConflict(false);submission.current=null;}
 async function summarize(){
  if(!base?.plan||!storyId||lock.current||conflict)return false;
  const id=storyId,{plan,removedFrames}=changes;
  lock.current=true;setBusy(true);setSummarizing(true);setError('');
  try{
   const {summary}: {summary:string}=await request(`reader/sessions/${id}/storyboard-summary`,'POST',{token:base.token,plan,removedFrames});
   if(latest.current!==id)return false;
   const changed=summary!==base.plan.summary;
   setChanges(current=>current.plan===plan&&current.removedFrames===removedFrames?{...current,storySummary:changed?summary:undefined}:current);
   return changed?'updated':'unchanged';
  }catch(e){
   if(latest.current===id){
    setError(e instanceof Error?e.message:'暂时无法生成梗概，请重试。');
    if((e as {status?:number}).status===409)await refresh();
   }
   return false;
  }finally{lock.current=false;setBusy(false);setSummarizing(false);}
 }
 async function submit(submittedChanges=changes){
  if(!base||!storyId||lock.current)return;
  try{checkedRevision(base,submittedChanges);}catch(e){setError(e instanceof Error?e.message:'请检查修改内容。');return;}
  const signature=JSON.stringify([storyId,base.token,submittedChanges]);
  if(submission.current?.signature!==signature)submission.current={signature,id:randomId()};
  // 提交时废弃先前的快照读取，避免回写已经提交的版本。
  read.current++;
  lock.current=true;setBusy(true);setError('');
  try{
   const originId=storyId;
   const session:SessionView=await request(`reader/sessions/${storyId}/revisions`,'POST',{requestId:submission.current.id,token:base.token,changes:submittedChanges});
   if(latest.current!==originId)return;
   setTab(null);setBase(null);setChanges({});submission.current=null;
   await callback.current(session,submittedChanges);
  }catch(e){setError(e instanceof Error?e.message:'新版暂未提交，请重试。');if((e as {status?:number}).status===409)await refresh(submittedChanges);}
  finally{lock.current=false;setBusy(false);}
 }
 return {sessionId:storyId,tab,setTab,scriptPage,setScriptPage,base,changes,setChanges,loading,busy,error,conflict,load,loadLatest,prepare,open,discard,summarize,summarizing,submit,impact:base?revisionImpact(base,changes):null};
}
export type StoryRevisionEditorState=ReturnType<typeof useStoryRevision>;
