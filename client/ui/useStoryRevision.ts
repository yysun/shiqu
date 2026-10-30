'use client';
// Keep edits separate from live production until one explicit, idempotent revision submission.
import {useEffect,useRef,useState} from 'react';
import {randomId,request} from './shared';
import {checkedRevision,revisionImpact} from '@/lib/reader-revision';
import type {RevisionChanges,RevisionSnapshot} from '@/lib/reader-revision';
import type {SessionView} from '@/lib/reader-model';
export type RevisionTab='requirements'|'style'|'count'|'script';
export function useStoryRevision(storyId:string|undefined,onSubmitted:(session:SessionView)=>Promise<void>){
 const [tab,setTab]=useState<RevisionTab|null>(null),[base,setBase]=useState<RevisionSnapshot|null>(null),[changes,setChanges]=useState<RevisionChanges>({}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const latest=useRef(storyId);latest.current=storyId;
 const read=useRef(0),lock=useRef(false),submission=useRef<{signature:string;id:string}|null>(null),callback=useRef(onSubmitted);callback.current=onSubmitted;
 useEffect(()=>{read.current++;setTab(null);setBase(null);setChanges({});setError('');setLoading(false);submission.current=null;},[storyId]);
 async function load(){
  if(!storyId)return;const serial=++read.current,id=storyId;setLoading(true);setError('');
  try{const snapshot:RevisionSnapshot=await request(`reader/sessions/${id}/revisions`);if(latest.current===id&&read.current===serial){setBase(snapshot);setChanges({});submission.current=null;}}
  catch(e){if(latest.current===id&&read.current===serial)setError(e instanceof Error?e.message:'编辑内容暂时无法载入。');}
  finally{if(latest.current===id&&read.current===serial)setLoading(false);}
 }
 function open(value:RevisionTab){setTab(value);if(!base&&!loading)void load();}
 function discard(){setChanges({});setTab(null);setError('');submission.current=null;}
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
  }catch(e){setError(e instanceof Error?e.message:'新版暂未提交，请重试。');}
  finally{lock.current=false;setBusy(false);}
 }
 return {tab,setTab,base,changes,setChanges,loading,busy,error,load,open,discard,submit,impact:base?revisionImpact(base,changes):null};
}
export type StoryRevisionEditorState=ReturnType<typeof useStoryRevision>;
