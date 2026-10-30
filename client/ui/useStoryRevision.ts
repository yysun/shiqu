'use client';
// Keep edits separate from live production until one explicit, idempotent revision submission.
// A draft outlives progress on its story. Only a real conflict is reported, and only the reader discards it.
import {useEffect,useRef,useState} from 'react';
import {randomId,request} from './shared';
import {checkedRevision,revisionImpact} from '@/lib/reader-revision';
import type {RevisionChanges,RevisionSnapshot} from '@/lib/reader-revision';
import type {SessionView} from '@/lib/reader-model';
import type {StoryEditorTab} from './StoryProductionEditor';
export type RevisionTab=StoryEditorTab;
export function useStoryRevision(storyId:string|undefined,onSubmitted:(session:SessionView)=>Promise<void>){
 const [tab,setTab]=useState<RevisionTab|null>(null),[base,setBase]=useState<RevisionSnapshot|null>(null),[changes,setChanges]=useState<RevisionChanges>({}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 const latest=useRef(storyId);latest.current=storyId;
 const read=useRef(0),lock=useRef(false),submission=useRef<{signature:string;id:string}|null>(null),callback=useRef(onSubmitted);callback.current=onSubmitted;
 useEffect(()=>{read.current++;setTab(null);setBase(null);setChanges({});setError('');setConflict(false);setLoading(false);submission.current=null;},[storyId]);
 async function load(){
  if(!storyId)return;const serial=++read.current,id=storyId;setLoading(true);setError('');
  try{const snapshot:RevisionSnapshot=await request(`reader/sessions/${id}/revisions`);if(latest.current===id&&read.current===serial){setBase(snapshot);setChanges({});setConflict(false);submission.current=null;}}
  catch(e){if(latest.current===id&&read.current===serial)setError(e instanceof Error?e.message:'编辑内容暂时无法载入。');}
  finally{if(latest.current===id&&read.current===serial)setLoading(false);}
 }
 // Compare a saved draft with its story again; newer images only improve what can be reused.
 async function refresh(){
  if(!storyId||!base)return;const serial=++read.current,id=storyId;
  try{
   const snapshot:RevisionSnapshot=await request(`reader/sessions/${id}/revisions`);
   if(latest.current!==id||read.current!==serial)return;
   if(snapshot.token===base.token){setBase(snapshot);setConflict(false);return;}
   if(revisionImpact(base,changes).changed){setConflict(true);setError('');}
   else{setBase(snapshot);setChanges({});setConflict(false);}
  }catch{/* The draft stays usable, and submitting reports what is wrong. */}
 }
 function open(value:RevisionTab){setTab(value);if(loading)return;if(!base)void load();else void refresh();}
 function discard(){setBase(null);setChanges({});setTab(null);setError('');setConflict(false);submission.current=null;}
 async function submit(){
  if(!base||!storyId||lock.current)return;
  try{checkedRevision(base,changes);}catch(e){setError(e instanceof Error?e.message:'请检查修改内容。');return;}
  const signature=JSON.stringify([storyId,base.token,changes]);
  if(submission.current?.signature!==signature)submission.current={signature,id:randomId()};
  lock.current=true;setBusy(true);setError('');
  try{
   const originId=storyId;
   const session:SessionView=await request(`reader/sessions/${storyId}/revisions`,'POST',{requestId:submission.current.id,token:base.token,changes});
   if(latest.current!==originId)return;
   setTab(null);setBase(null);setChanges({});submission.current=null;
   await callback.current(session);
  }catch(e){setError(e instanceof Error?e.message:'新版暂未提交，请重试。');if((e as {status?:number}).status===409)await refresh();}
  finally{lock.current=false;setBusy(false);}
 }
 return {tab,setTab,base,changes,setChanges,loading,busy,error,conflict,load,open,discard,submit,impact:base?revisionImpact(base,changes):null};
}
export type StoryRevisionEditorState=ReturnType<typeof useStoryRevision>;
