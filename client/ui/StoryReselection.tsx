// Keep the current book visible while a separate, off-shelf draft discovers replacements.
// Only choosing commits; cancel reads the authoritative family without restarting old work.
import {useEffect,useRef,useState} from 'react';
import {request,randomId} from './shared';
import Sheet from './StorySheet';
import StoryExtractionSearch from './StoryExtractionSearch';
import StoryFlowAction from './StoryFlowAction';
import type {SessionView} from '@/lib/reader-model';
import type {IntakeCommand} from '@/lib/reader-intake';
import type {ProductionSettings} from './StoryProductionEditor';
import {observeStoryGeneration} from '@/lib/reader-production-client';

export default function StoryReselection({parentId,onSubmitted,onCancelled}:{parentId:string;onSubmitted:(session:SessionView)=>void;onCancelled:(session:SessionView|null,error?:string)=>void}){
 const [draft,setDraft]=useState<SessionView|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const openId=useRef(randomId()),closed=useRef(false),lock=useRef(false);
 const pending=useRef<{signature:string;body:unknown}|null>(null);
 async function open(){
  setLoading(true);setError('');
  try{const s:SessionView=await request(`reader/sessions/${parentId}/reselection`,'POST',{requestId:openId.current});if(!closed.current){if(s.reselection)setDraft(s);else{closed.current=true;onSubmitted(s);}}}
  catch(e){if(!closed.current)setError(e instanceof Error?e.message:'暂时无法打开选题。');}
  finally{if(!closed.current)setLoading(false);}
 }
 useEffect(()=>{closed.current=false;void open();return()=>{closed.current=true;};},[parentId]);
 useEffect(()=>{
  if(!draft?.id)return;
  let cancelled=false;
  void observeStoryGeneration({sessionId:draft.id,request,isActive:()=>!cancelled&&!closed.current,onSession:s=>setDraft(s),focus:{viewerId:randomId(),page:()=>0},watchChoices:true}).then(message=>{if(!cancelled&&!closed.current&&message)setError(message);});
  return()=>{cancelled=true;};
 },[draft?.id]);
 async function act(action:IntakeCommand){
  if(!draft?.intake||lock.current)return false;
  const signature=JSON.stringify([draft.id,action]);
  if(pending.current?.signature!==signature)pending.current={signature,body:{...action,requestId:randomId(),generation:draft.intake.generation}};
  lock.current=true;setBusy(true);setError('');
  try{const s:SessionView=await request(`reader/sessions/${draft.id}/setup`,'POST',pending.current.body);pending.current=null;if(!closed.current)setDraft(s);return true;}
  catch(e){setError(e instanceof Error?e.message:'查找暂时未完成，请重试。');return false;}
  finally{lock.current=false;setBusy(false);}
 }
 async function replace(batch:number,index:number,settings:ProductionSettings){
  if(!draft||lock.current)return;
  const signature=JSON.stringify([draft.id,batch,index,settings]);
  if(pending.current?.signature!==signature)pending.current={signature,body:{requestId:randomId(),batch,index,settings:{artStyle:settings.artStyle,productionPrompt:settings.productionPrompt,acceptancePrompt:settings.acceptancePrompt,narrativeDetail:settings.narrativeDetail}}};
  lock.current=true;setBusy(true);setError('');
  try{const next:SessionView=await request(`reader/sessions/${parentId}/reselection/${draft.id}`,'POST',pending.current.body);pending.current=null;closed.current=true;onSubmitted(next);}
  catch(e){setError(e instanceof Error?e.message:'替换未完成，草稿与旧结果已保留。');}
  finally{lock.current=false;setBusy(false);}
 }
 async function cancel(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   let current:SessionView;
   try{current=await request(`reader/sessions/${parentId}/reselection/${draft?.id||openId.current}`,'DELETE');}
   catch(e){if((e as {status?:number}).status!==404)throw e;current=await request(`reader/sessions/${parentId}/current`);}
   closed.current=true;onCancelled(current);
  }catch(e){
   const status=(e as {status?:number}).status;
   if(status===404||status===403){closed.current=true;onCancelled(null,'当前故事已删除或不可访问。');}
   else setError('暂时无法读取最新状态，请重试取消；不会回滚旧快照。');
  }finally{lock.current=false;setBusy(false);}
 }
 const intake=draft?.intake;
 const searching=intake?.search.state==='searching';
 const settings=draft?.intake?.draft??draft?.selection;
 const title=draft?.selection.discovery?.mode==='title'?draft.selection.discovery.title:undefined;
 return <Sheet title="替换选题" fixedHeight busy={busy} onClose={()=>void cancel()}>
  <p className="yu-sheet-intro">书架保留一张卡片，旧结果保留为历史。选择后先准备原文，再确认制作；原故事的暂停状态会保留。</p>
  {loading?<p role="status">正在打开选题…</p>:draft&&intake&&settings?<>
   <StoryExtractionSearch sessionId={draft.id} title={title} local={draft.selection.bookId!=='other'} busy={busy}
    hasCandidates={intake.batches.some(batch=>batch.stories.length>0)} onSearch={title=>act({action:'search',title})}/>
   {searching&&<p role="status">正在查找故事…</p>}
   {intake.search.error&&<p role="alert">{intake.search.error}</p>}
   <ul className="yu-extraction-candidates" aria-label="替换选题结果">
    {intake.batches.flatMap((batch,b)=>batch.stories.map((story,index)=><li key={b+':'+index}>
     <div className="yu-extraction-candidate-copy"><strong>{story.title}</strong><p>{story.description}</p><small>{story.sourceLabel}</small></div>
     <StoryFlowAction disabled={busy} aria-label={`选择并替换 ${story.title}`} onClick={()=>replace(b,index,{...settings,length:'auto',narrativeDetail:settings.narrativeDetail||'balanced'})}>选择并替换</StoryFlowAction>
    </li>))}
   </ul>
   {(intake.search.state==='failed'||!searching&&intake.batches.at(-1)?.stories.length===0)&&
    <StoryFlowAction disabled={busy} onClick={()=>{void act({action:'more'});}}>{intake.search.state==='failed'?'重试查找':'继续查找'}</StoryFlowAction>}
  </>:<button type="button" onClick={()=>void open()}>重新打开选题</button>}
  {error&&<p role="alert">{error}</p>}
  <button type="button" disabled={busy} onClick={()=>void cancel()}>取消替换</button>
 </Sheet>;
}
