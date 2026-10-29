'use client';
// Preserve source receipts; v8 discards receipts from the replaced Honglou and Yushi editions.
// Cancel obsolete discovery and keep progress scoped to the active book and theme.
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import type {Selection} from '@/lib/reader-model';
import {freshSuggestions,maxSuggestionBatches,suggestionBatchSchema,suggestionKey} from '@/lib/reader-suggestions';
import type {SuggestionBatch,SuggestionProgress} from '@/lib/reader-suggestions';
import {requestSuggestions} from '@/lib/reader-suggestion-request';

const storageKey='shiqu-suggestion-batches-v8';
const historySchema=z.record(z.object({batches:z.array(suggestionBatchSchema).max(maxSuggestionBatches),index:z.number().int().min(0).max(maxSuggestionBatches-1)}));
type History=z.infer<typeof historySchema>;
export function useStorySuggestions(selection:Selection,theme:string){
 const [history,setHistory]=useState<History>({}),[ready,setReady]=useState(false),[finding,setFinding]=useState(false),[error,setError]=useState('');
 const [progress,setProgress]=useState<SuggestionProgress|null>(null),[elapsed,setElapsed]=useState(0);
 const key=suggestionKey(selection.bookId,selection.customBook,theme),activeKey=useRef(key),pending=useRef<AbortController|null>(null);activeKey.current=key;
 const entry=history[key],batches=entry?.batches||[],index=Math.min(entry?.index||0,Math.max(0,batches.length-1)),batch=batches[index];
 useEffect(()=>{try{setHistory(historySchema.parse(JSON.parse(sessionStorage.getItem(storageKey)||'{}')));}catch{}setReady(true);},[]);
 useEffect(()=>{if(ready)try{sessionStorage.setItem(storageKey,JSON.stringify(history));}catch{}},[history,ready]);
 function cancel(){const operation=pending.current;pending.current=null;operation?.abort();setFinding(false);setProgress(null);}
 useEffect(()=>{cancel();setError('');},[key]);
 useEffect(()=>()=>{pending.current?.abort();},[]);
 useEffect(()=>{if(!finding)return;const started=Date.now();setElapsed(0);const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[finding]);
 async function find(){
  if(pending.current||!ready)return false;
  if(batches.length>=maxSuggestionBatches){setError('这组书籍和主题已保存 40 批，可回看选择，或换个主题继续探索。');return false;}
  if(!theme.trim()||(selection.bookId==='other'&&!selection.customBook?.trim())){setError('请填写书名或 URL，以及想看的主题。');return false;}
  const operation=new AbortController();pending.current=operation;setFinding(true);setProgress(null);setError('');
  try{
   const excludeTitles=batches.flatMap(batch=>batch.stories.map(story=>story.title));
   const result=await requestSuggestions({...selection,storyTitle:undefined,source:undefined,theme,excludeTitles},operation.signal,value=>{if(pending.current===operation)setProgress(value);});
   if(operation.signal.aborted)return false;
   const next:SuggestionBatch=freshSuggestions(result,excludeTitles);
   if(!next.stories.length&&batches.length){if(activeKey.current===key)setError(next.note);return false;}
   setHistory(old=>{const previous=old[key]?.batches||[];return {...old,[key]:{batches:[...previous,next],index:previous.length}};});
   return activeKey.current===key;
  }catch(e){if(!operation.signal.aborted&&activeKey.current===key)setError(e instanceof Error?e.message:'选题暂时不可用，前面的批次已保留。');return false;}
  finally{if(pending.current===operation){pending.current=null;setFinding(false);setProgress(null);}}
 }
 function goTo(next:number){if(next<0||next>=batches.length)return;setHistory(old=>({...old,[key]:{...old[key],index:next}}));setError('');}
 return {key,batches,index,candidates:batch?.stories||[],note:batch?.note||'',finding,ready,error,progress,elapsed,find,goTo,cancel};
}
