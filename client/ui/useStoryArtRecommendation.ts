'use client';
// Optional selected-source art work never blocks discovery or changes a reader's manual style.
// Source identity scopes results; cancellation prevents a stale response reaching another story.
import {useEffect,useRef,useState} from 'react';
import type {Selection} from '@/lib/reader-model';
import type {SuggestionBatch} from '@/lib/reader-suggestions';
import {artRecommendationSchema,storyCandidateKey} from '@/lib/reader-art-recommendation';
import type {ArtRecommendation} from '@/lib/reader-art-recommendation';

type Candidate=SuggestionBatch['stories'][number];
export function useStoryArtRecommendation(candidate:Candidate|undefined,selection:Selection){
 const key=candidate?JSON.stringify([selection.bookId,selection.customBook,selection.theme,storyCandidateKey(candidate)]):'';
 const cache=useRef(new Map<string,ArtRecommendation>());
 const [attempt,setAttempt]=useState(0),[state,setState]=useState<{key:string;recommendation?:ArtRecommendation;busy:boolean;error:string}>({key:'',busy:false,error:''});
 useEffect(()=>{
  if(!candidate||!key)return;
  const saved=candidate.artRecommendation||cache.current.get(key);
  if(saved){setState({key,recommendation:saved,busy:false,error:''});return;}
  if(!candidate.source)return;
  const abort=new AbortController();setState({key,busy:true,error:''});
  void (async()=>{
   try{
    const response=await fetch('/api/reader/art-recommendation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(65000)])});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'画风推荐暂不可用，可以手动选择。');
    const recommendation=artRecommendationSchema.parse(result);
    if(abort.signal.aborted)return;
    cache.current.set(key,recommendation);setState({key,recommendation,busy:false,error:''});
   }catch(error){if(!abort.signal.aborted)setState({key,busy:false,error:error instanceof Error?error.message:'画风推荐暂不可用，可以手动选择。'});}
  })();
  return()=>abort.abort();
 },[key,attempt]);
 return {...(state.key===key?state:{key,recommendation:candidate?.artRecommendation,busy:false,error:''}),retry:()=>setAttempt(value=>value+1)};
}
