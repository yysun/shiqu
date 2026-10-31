// Browse the shared shelf and queue; only explicit deletion writes reversible reader tombstones.
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {BookOpen,Check,ChevronRight,Clock3,Heart,Layers3,RefreshCw,Search,Sparkles,Trash2,Undo2} from 'lucide-react';
import {getArtStyle} from '../lib/reader-styles';
import {groupShelfByBook,matchesShelfSearch} from '../lib/shelf-browser';
import {productionSteps} from '../lib/production-stages';
import type {StorySummary} from './library-summary';
import {useLibrarySummary} from './useLibrarySummary';
import ProductionTimeline from '../client/ui/ProductionTimeline';

const states:Record<string,string>={idle:'待继续',running:'生成中',failed:'已暂停',completed:'已完成'};
function waitingLabel(story:StorySummary){return story.production?.intakePhase==='discovering'?'等待找故事':story.production?.intakePhase==='choosing'?'待选故事':story.production?.intakePhase==='confirming'?'待制作确认':states[story.state]||'待继续';}
function date(value:string){return new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(new Date(value));}
function StoryTags({story}:{story:StorySummary}){
 return <div className="story-tags"><span>主题 · {story.theme||'未记录'}</span><span>画风 · {getArtStyle(story.artStyle).label}</span></div>;
}
export function LibraryPane({tab,native,revision}:{tab:'library'|'queue';native:boolean;revision:string}){
 const {summary,error,loading,refresh}=useLibrarySummary(native,revision);
 const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[groupBy,setGroupBy]=useState('book');
 const [deleteTarget,setDeleteTarget]=useState<StorySummary|null>(null),[undo,setUndo]=useState<StorySummary|null>(null),[mutating,setMutating]=useState(false),[mutationError,setMutationError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),mutationLock=useRef(false),refreshButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(deleteTarget){if(!dialog.current?.open)dialog.current?.showModal();}else dialog.current?.close();},[deleteTarget]);
 useEffect(()=>{setUndo(null);setDeleteTarget(null);setMutationError('');},[revision]);
 async function changeDeleted(story:StorySummary,deleted:boolean){
  if(mutationLock.current)return;
  mutationLock.current=true;setMutating(true);setMutationError('');
  try{
   if(native)await invoke('set_library_story_deleted',{id:story.id,deleted});
   else{
    const response=await fetch('/__desktop/library/'+encodeURIComponent(story.id),{method:deleted?'DELETE':'PUT'});
    if(!response.ok)throw Error('故事暂时无法更新，请重试。');
   }
   setDeleteTarget(null);setUndo(deleted?story:null);refresh();refreshButton.current?.focus();
  }catch(e){setMutationError(String(e instanceof Error?e.message:e));}
  finally{mutationLock.current=false;setMutating(false);}
 }
 const stories=summary?.stories||[],queue=stories.filter(story=>story.jobs>0||story.state!=='completed');
 const needsAttention=(story:StorySummary)=>story.failed>0||story.state==='failed';
 const pending=(story:StorySummary)=>!needsAttention(story)&&(story.running>0||story.queued>0||story.state==='running');
 const completed=(story:StorySummary)=>story.state==='completed'&&!needsAttention(story)&&!pending(story);
 const activeCount=queue.filter(pending).length,failedCount=queue.filter(needsAttention).length;
 const source=tab==='library'?stories:queue;
 const visible=source.filter(s=>tab==='library'?(filter!=='saved'||s.saved)&&matchesShelfSearch({...s,artStyleLabel:getArtStyle(s.artStyle).label},search):filter==='active'?pending(s):filter==='failed'?needsAttention(s):true);
 // Partition by status while preserving source order and each group's native disclosure state.
 const queueGroups=[
  {id:'attention',label:'需要处理',items:visible.filter(needsAttention),Icon:Layers3},
  {id:'active',label:'进行中',items:visible.filter(pending),Icon:Clock3},
  {id:'paused',label:'待继续',items:visible.filter(story=>!needsAttention(story)&&!pending(story)&&!completed(story)),Icon:BookOpen},
  {id:'completed',label:'已完成的故事',items:visible.filter(completed),Icon:Check},
 ];
 function storyCard(story:StorySummary,index:number){
  return <article className="desktop-story" key={story.id}>
   <div className={'story-spine tone-'+index%4} aria-hidden="true"><BookOpen size={25} strokeWidth={1.3}/><span>{story.book}</span></div>
   <div className="story-description">
    <div className="story-meta"><span>{story.book}</span>{!!story.saved&&<Heart size={12} fill="currentColor" aria-label="已收藏"/>}</div>
    <h3>{story.title}</h3><StoryTags story={story}/>
    <div className="story-bottom"><span className={'story-state state-'+story.state}>{waitingLabel(story)}</span><span>{story.total?`${story.ready} / ${story.total} 幅`:'等待编排'}<i>·</i>{date(story.updatedAt)}</span></div>
   </div>
   <button className="story-delete" type="button" aria-label={'删除《'+story.title+'》'} title="从书架删除" disabled={mutating} onClick={()=>{setMutationError('');setDeleteTarget(story);}}><Trash2 size={15}/></button>
  </article>;
 }
 function queueCard(story:StorySummary){
  return <article className="desktop-queue-item" key={story.id}>
    <div className="queue-item-heading"><div><h3>{story.title}</h3><p>{story.book}</p></div><span className={'story-state state-'+(needsAttention(story)?'failed':story.running?'running':story.state)}>{needsAttention(story)?'已暂停':story.running?'生成中':story.queued?'等待生成':waitingLabel(story)}</span></div>
    <StoryTags story={story}/>
    <div className="queue-production-flow"><ProductionTimeline layout="horizontal" stages={productionSteps({...story.production,planReady:story.production?.planReady??story.total>0,total:story.total||null,ready:story.ready,activeState:needsAttention(story)?'failed':story.running||story.queued||['frame-count','story-choice','production-confirmation'].includes(story.production?.phase||'')?'current':'paused'})} moving={!needsAttention(story)&&story.running>0} queued={!story.running&&story.queued>0}/></div>
    <div className="queue-detail"><span>{story.succeeded} / {story.jobs} 项任务完成</span><span>{story.ready} / {story.total} 幅画面</span></div><div className="queue-task-counts"><span>等待 {story.queued}</span><span>生成 {story.running}</span>{story.failed>0&&<span className="error">暂停 {story.failed}</span>}</div>
   </article>;
 }
 return <section className="collection-pane">
  <div className="collection-heading"><div><p className="pane-kicker">{tab==='library'?'留在这里的故事':'故事正在慢慢展开'}</p><h2>{tab==='library'?'书架':'生成队列'}<span>{source.length}</span></h2><p>{tab==='library'?'读过的、收藏的，还有未完的故事。':'查看每篇故事的生成进度与任务状态。'}</p></div><button ref={refreshButton} className="refresh-button" aria-label="刷新本地数据" onClick={()=>refresh()} disabled={loading}><RefreshCw size={16}/></button></div>
  {tab==='library'?<>
   <div className="library-search"><Search size={16}/><input aria-label="搜索书架" placeholder="搜索故事、原典、主题或画风" value={search} onChange={event=>setSearch(event.target.value)}/></div>
   <div className="library-view-controls"><div className="collection-filters" aria-label="书架筛选">{[['all','全部故事'],['saved','我的收藏']].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div><label className="group-control"><span className="sr-only">书架分组</span><select aria-label="书架分组" value={groupBy} onChange={event=>setGroupBy(event.target.value)}><option value="book">按书名分组</option><option value="none">不分组</option></select></label></div>
  </>:<>
   <div className="queue-metrics"><div><Clock3 size={16}/><strong>{activeCount}</strong><span>等待 / 生成中</span></div><div><Layers3 size={16}/><strong>{failedCount}</strong><span>需要关注</span></div><div><Check size={16}/><strong>{queue.filter(completed).length}</strong><span>已完成故事</span></div></div>
   <div className="collection-filters" aria-label="队列筛选">{[['all','全部'],['active','进行中'],['failed','需要处理']].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
  </>}
  {undo&&<div className="library-undo" role="status"><span>已从书架删除《{undo.title}》</span><button type="button" onClick={()=>void changeDeleted(undo,false)} disabled={mutating}><Undo2 size={14}/>{mutating?'恢复中…':'撤销'}</button></div>}
  {(error||mutationError&&!deleteTarget)&&<div className="collection-error" role="alert">{error||mutationError}<button className="text-button" onClick={()=>{setMutationError('');refresh();}}>重新加载</button></div>}
  {loading&&!summary?<div className="collection-empty" role="status"><RefreshCw size={28}/><h3>正在打开{tab==='library'?'书架':'队列'}…</h3></div>:visible.length?
   tab==='library'?groupBy==='book'?<div className="book-groups">{groupShelfByBook(visible).map(({book,items:rows})=><details className="book-group" key={book} open><summary><ChevronRight size={15}/><BookOpen size={15}/><h3>{book}</h3><span>{rows.length} 篇</span></summary><div className="story-list">{rows.map(storyCard)}</div></details>)}</div>:<div className="story-list">{visible.map(storyCard)}</div>:
   <div className="queue-list">{queueGroups.filter(group=>group.items.length>0).map(({id,label,items,Icon})=><details key={id} className={"queue-group queue-group-"+id+(id==='completed'?' queue-completed':'')} open={id!=='completed'?true:undefined}><summary><ChevronRight size={15} aria-hidden="true"/><Icon size={15} aria-hidden="true"/><strong>{label}</strong><span>{items.length} 篇</span></summary><div>{items.map(queueCard)}</div></details>)}</div>:
   !error&&<div className="collection-empty">{tab==='library'?<BookOpen size={34} strokeWidth={1.2}/>:<Sparkles size={34} strokeWidth={1.2}/>}<h3>{source.length?'这里还没有匹配的故事':tab==='library'?'第一篇故事，等你翻开。':'此刻，没有生成任务。'}</h3><p>{source.length?'试试其他筛选或关键词。':tab==='library'?'在阅读端开启故事后，会自动留在这座书架。':'在阅读端开启或继续故事，这里会显示生成进度。'}</p></div>}
  <p className="collection-footnote">{tab==='library'?'与阅读端共用本机书架':'任务状态每 4 秒更新；继续或重试请在阅读端操作。'}</p>
  <dialog ref={dialog} className="library-delete-dialog" aria-labelledby="delete-story-heading" aria-describedby="delete-story-description" onCancel={event=>{if(mutating)event.preventDefault();else setDeleteTarget(null);}}>
   <div className="delete-dialog-icon"><Trash2 size={23}/></div><h2 id="delete-story-heading">删除《{deleteTarget?.title}》？</h2>
   <p id="delete-story-description">这篇故事将从桌面和阅读端书架移除。故事文件会保留，删除后可以撤销。</p>
   {mutationError&&<p className="error" role="alert">{mutationError}</p>}
   <div className="delete-dialog-actions"><button type="button" className="secondary" disabled={mutating} onClick={()=>setDeleteTarget(null)} autoFocus>取消</button><button type="button" className="delete-confirm" disabled={mutating||!deleteTarget} onClick={()=>deleteTarget&&void changeDeleted(deleteTarget,true)}>{mutating?'删除中…':'删除故事'}</button></div>
  </dialog>
 </section>;
}
