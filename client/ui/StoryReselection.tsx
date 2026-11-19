// 替换选题共用选材页。草稿独立于书架，提交选中的原文后才切换版本。
import {useEffect,useRef,useState} from 'react';
import {request,randomId} from './shared';
import Sheet from './StorySheet';
import StoryDiscoveryForm from './StoryDiscoveryForm';
import StoryFlowAction from './StoryFlowAction';
import type {Selection,SessionView} from '@/lib/reader-model';
import type {IntakeCommand} from '@/lib/reader-intake';
import type {ReplacementChoice} from '@/lib/reader-reselection';
import {observeStoryGeneration} from '@/lib/reader-production-client';

type Conditions=Extract<IntakeCommand,{action:'conditions'}>['conditions'];
type Setup={signature:string;requestId:string;generation:number;saved?:SessionView};
type Props={parentId:string;books:{id:string;title:string}[];semanticIndexBooks?:readonly {id:string}[];onSubmitted:(session:SessionView)=>void;onCancelled:(session:SessionView|null,error?:string)=>void};

export default function StoryReselection({parentId,books,semanticIndexBooks,onSubmitted,onCancelled}:Props){
 const [draft,setDraft]=useState<SessionView|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const openId=useRef(randomId()),closed=useRef(false),lock=useRef(false);
 const setup=useRef<Setup|null>(null),replacement=useRef<ReplacementChoice|null>(null);
 const control=useRef<{requestId:string;action:'pause'|'resume'}|null>(null);
 async function open(){
  setLoading(true);setError('');
  try{const s:SessionView=await request(`reader/sessions/${parentId}/reselection`,'POST',{requestId:openId.current});if(!closed.current){if(s.reselection)setDraft(s);else{closed.current=true;onSubmitted(s);}}}
  catch(e){if(!closed.current)setError(e instanceof Error?e.message:'暂时无法打开选题。');}
  finally{if(!closed.current)setLoading(false);}
 }
 useEffect(()=>{closed.current=false;void open();return()=>{closed.current=true;};},[parentId]);
 const discoveryId=draft?.selection.bookId==='other'?draft.id:undefined;
 useEffect(()=>{
  if(!discoveryId)return;
  let cancelled=false;
  void observeStoryGeneration({sessionId:discoveryId,request,isActive:()=>!cancelled&&!closed.current,onSession:s=>{
   if(!lock.current)setDraft(current=>(s.intake?.generation??0)>=(current?.intake?.generation??0)?s:current);
  },focus:{viewerId:randomId(),page:()=>0},watchChoices:true}).then(message=>{if(!cancelled&&!closed.current&&message)setError(message);});
  return()=>{cancelled=true;};
 },[discoveryId]);
 async function save(action:()=>Promise<void>){
  if(lock.current||closed.current)return;
  lock.current=true;setBusy(true);setError('');
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'替换未完成，请重试。');}
  finally{lock.current=false;setBusy(false);}
 }
 async function replace(id:string,generation:number,batch:number,index:number){
  const pending=replacement.current;
  if(pending?.generation!==generation||pending.batch!==batch||pending.index!==index)replacement.current={requestId:randomId(),generation,batch,index};
  const next:SessionView=await request(`reader/sessions/${parentId}/reselection/${id}`,'POST',replacement.current);
  closed.current=true;onSubmitted(next);
 }
 async function submit({discovery,source,sourceCard,bookId,customBook,theme,discoverySources,productionPrompt}:Selection){
  if(!draft?.intake)return;
  const {id,intake:{generation}}=draft;
  const conditions:Conditions={discovery,source,sourceCard,bookId,customBook,theme,discoverySources,productionPrompt};
  await save(async()=>{
   const signature=JSON.stringify(conditions);
   if(setup.current?.signature!==signature)setup.current={signature,requestId:randomId(),generation};
   const pending=setup.current;
   // 选段已保存时直接重试提交，避免丢失替换响应后重写已提交的草稿。
   const saved:SessionView=pending.saved??await request(`reader/sessions/${id}/setup`,'POST',{action:'conditions',conditions,requestId:pending.requestId,generation:pending.generation});
   setDraft(saved);
   if(saved.intake?.selected){
    pending.saved=saved;
    const {batch,index}=saved.intake.selected;
    await replace(id,saved.intake.generation,batch,index);
   }else setup.current=null;
  });
 }
 async function controlSearch(action:'pause'|'resume'){
  if(!draft)return;
  await save(async()=>{
   if(control.current?.action!==action)control.current={requestId:randomId(),action};
   const saved:SessionView=await request(`reader/sessions/${draft.id}/production-control`,'POST',control.current);
   control.current=null;setDraft(saved);
  });
 }
 async function cancel(){
  if(lock.current||loading)return;lock.current=true;setBusy(true);setError('');
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
 return <Sheet title="替换选题" fixedHeight busy={busy||loading} onClose={()=>void cancel()}>
  {loading?<p role="status">正在打开选题…</p>:draft&&intake?<StoryDiscoveryForm bookChosen selection={draft.selection}
   books={books} semanticIndexBooks={semanticIndexBooks} busy={busy} error="" onSubmit={submit} submitLabel="选择并替换"
   savedSelection={discoveryId?draft.selection:undefined} savedIntake={discoveryId?intake:undefined}
   savedSearchPaused={draft.generationControl!=='active'} onSavedSearchControl={controlSearch}
   onSavedChoice={(batch,index)=>save(()=>replace(draft.id,intake.generation,batch,index))}/>
   :<StoryFlowAction onClick={()=>void open()}>重新打开选题</StoryFlowAction>}
  {error&&<p role="alert">{error}</p>}
  <StoryFlowAction disabled={busy||loading} onClick={()=>void cancel()}>取消替换</StoryFlowAction>
 </Sheet>;
}
