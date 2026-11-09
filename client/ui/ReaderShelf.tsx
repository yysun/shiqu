// 书架：搜索、收藏筛选与分组；尚无封面的制作任务与可阅读故事分区展示，操作互相独立并实时反映生成状态。
// “制作中”区域为紧凑行：需要用户处理的排在最前且始终可见，其余默认最多显示 5 行，搜索时全部显示；
// 通用状态说明只供读屏软件朗读，失败时的具体错误仍可见。分组只作用于可阅读故事，所有卡片同尺寸。
// 显示名同样适用于未完成的故事；确认制作前，以已保存的设置草稿作为展示画风。
// 封面上的收藏与删除按钮与阅读按钮互为兄弟节点，互不触发；已读完的“重读”从第一幅开始。
// ReaderShelf 顶层不调用 Hook（测试会把它当普通函数调用），有状态的部分放在子组件中，行内容以 children 传入。
// 桌面宽档（≥1024px，有右栏）传入 onSelect：封面与标题按钮改为选中故事（“选择《…》”），底部“继续阅读/重读”仍直接打开；
// 选中状态覆盖可阅读与制作中条目；不传 onSelect 时（手机与 768–1023px）封面与标题直接打开阅读。
// 所有故事条目都带 data-story-id，供焦点归还与测试定位。
import {useEffect,useState,type ReactNode} from 'react';
import {ArrowRight,Bookmark,BookOpen,ChevronDown,ChevronRight,Feather,Plus,RefreshCw,RotateCcw,Search,Trash2,X} from 'lucide-react';
import type {Story} from '@/lib/content';
import type {ProductionAction} from '@/lib/reader-model';
import type {ShelfSession,ShelfStory} from '@/lib/reader-shelf';
import StoryGenerationControl from './StoryGenerationControl';
import type {ReadingProgress} from '@/lib/reader-home';
import {getArtStyle} from '@/lib/reader-styles';
import {groupShelfItems,matchesShelfSearch,shelfGroupings,type ShelfGrouping} from '@/lib/shelf-browser';
import {shelfGenerationStatus,shelfNeedsUserGroups,sortShelfProductions} from '@/lib/shelf-generation';
import './ReaderShelf.css';

const productionLimit=5;
// 按分组模式分别记住每组的展开状态，跨筛选、阅读与刷新保留。
function usePersistentOpen(id:string){
 const storageKey='shiqu-shelf-group:'+id;
 const [open,setOpen]=useState(()=>{try{return localStorage.getItem(storageKey)!=='0';}catch{return true;}});
 return [open,(next:boolean)=>{setOpen(next);try{localStorage.setItem(storageKey,next?'1':'0');}catch{}}] as const;
}
// 选中的故事不在当前列表中（被筛掉或删除）时清除选中。
function SelectionGuard({selectedId,ids,onSelect}:{selectedId?:string|null;ids:string;onSelect:(id:string|null)=>void}){
 useEffect(()=>{if(selectedId&&!ids.split('\n').includes(selectedId))onSelect(null);},[selectedId,ids]);
 return null;
}
function ShelfGroup({id,children}:{id:string;children:ReactNode}){
 const [open,setOpen]=usePersistentOpen(id);
 return <details className="yu-shelf-book-group" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>{children}</details>;
}
// 行已按优先级排好序，截取前若干行即可保证需要处理的任务可见；“显示全部”不持久化。
function ProductionGroup({needs,limit,children}:{needs:number;limit:number|null;children:ReactNode[]}){
 const [open,setOpen]=usePersistentOpen('production'),[all,setAll]=useState(false);
 const hidden=limit===null?0:Math.max(0,children.length-limit);
 return <details className="yu-production" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><ChevronRight size={16} aria-hidden="true"/><h2>制作中</h2><span>{children.length} 项</span>{needs>0&&<em>{needs} 项待处理</em>}</summary>
  <ul>{hidden&&!all?children.slice(0,limit!):children}</ul>
  {hidden>0&&<button type="button" className="yu-production-more" aria-expanded={all} onClick={()=>setAll(!all)}>{all?'收起':`显示全部 ${children.length} 项`}</button>}
 </details>;
}

type ShelfItem={processingStatus:string;id:string;title:string;book:string;theme:string;artStyleLabel:string;story:ShelfStory|null;session?:ShelfSession;page:number;saved:boolean};
type Props={onControl:(id:string,action:ProductionAction)=>Promise<void>;controlBusy:string;stories:ShelfStory[];pending:ShelfSession[];sessions:ShelfSession[];progress:ReadingProgress[];loading:boolean;refreshing:boolean;onRefresh:()=>void;error:string;tab:string;onTab:(tab:string)=>void;query:string;onQuery:(query:string)=>void;grouping:ShelfGrouping;onGrouping:(grouping:ShelfGrouping)=>void;bookName:(story:Pick<Story,'id'|'bookId'>)=>string;onOpen:(story:ShelfStory,restart?:boolean)=>void;onResume:(session:ShelfSession)=>void;onRetry:(session:ShelfSession)=>void;onDelete:(id:string,title:string)=>void;onFavorite:(id:string,saved:boolean)=>void;favoriteBusy:string;onCreate:()=>void;onDiscover:()=>void;selectedId?:string|null;onSelect?:(id:string|null)=>void};
export default function ReaderShelf({onControl,controlBusy,stories,pending,sessions,progress,loading,refreshing,onRefresh,error,tab,onTab,query,onQuery,grouping,onGrouping,bookName,onOpen,onResume,onRetry,onDelete,onFavorite,favoriteBusy,onCreate,onDiscover,selectedId,onSelect}:Props){
 const progressById=new Map(progress.map(row=>[row.storyId,row]));
 const sessionById=new Map(sessions.map(session=>[session.id,session]));
 const processingStatus=(story:ShelfStory)=>{const session=sessionById.get(story.id);return session?shelfGenerationStatus(session).group:'已完成';};
 const items:ShelfItem[]=[
  ...pending.map(session=>({processingStatus:shelfGenerationStatus(session).group,id:session.id,title:session.selection.displayTitle||session.story?.title||session.selection.storyTitle||(session.intake?'等待选题的故事':'还在展开的故事'),book:bookName({id:session.id,bookId:session.selection.bookId}),theme:session.selection.theme,artStyleLabel:getArtStyle((session.intake?.phase!=='confirmed'?session.intake?.artStyle:undefined)??session.selection.artStyle).label,story:null,session,page:session.page,saved:!!(progressById.get(session.id)?.saved??session.saved)})),
  ...stories.map(story=>({processingStatus:processingStatus(story),id:story.id,title:story.title,book:bookName(story),theme:story.theme,artStyleLabel:story.artStyleLabel||'未记录画风',story,page:progressById.get(story.id)?.page||0,saved:!!progressById.get(story.id)?.saved})),
 ];
 const visible=items.filter(item=>(tab!=='saved'||item.saved)&&matchesShelfSearch(item,query));
 const productions=sortShelfProductions(visible.filter(item=>!item.story),item=>item.processingStatus),readable=visible.filter(item=>item.story);
 const needs=productions.filter(item=>(shelfNeedsUserGroups as readonly string[]).includes(item.processingStatus)).length;
 const filtered=!!query.trim()||tab==='saved',busyAny=refreshing||!!favoriteBusy;
 function resetFilters(){onQuery('');onTab('recent');}
 function edition(item:ShelfItem,session?:ShelfSession){
  const number=session?.revision?.number||item.story?.revision||1;
  return number>1||sessions.some(s=>s.revision?.rootId===item.id)?`${number}`:'';
 }
 function actions(item:ShelfItem){
  return <div className="yu-shelf-card-actions"><button type="button" className={'yu-shelf-favorite'+(item.saved?' is-saved':'')} aria-label={(item.saved?'不再收藏':'收藏')+'《'+item.title+'》'} title={item.saved?'不再收藏':'收藏'} aria-pressed={item.saved} disabled={busyAny} onClick={()=>onFavorite(item.id,!item.saved)}><Bookmark size={17} fill={item.saved?'currentColor':'none'}/><span>{favoriteBusy===item.id?'保存中…':item.saved?'不再收藏':'收藏'}</span></button><button className="yu-delete-story" aria-label={'删除《'+item.title+'》'} title="删除故事" disabled={busyAny} onClick={()=>onDelete(item.id,item.title)}><Trash2 size={17}/></button></div>;
 }
 // 失败且可重试时只给“重试生成”；其余状态沿用暂停/恢复控制。
 function control(session:ShelfSession,group:string){
  if(group==='生成失败')return session.retryAllowed?<button type="button" className="yu-generation-control" disabled={busyAny||!!controlBusy} onClick={()=>onRetry(session)}>重试生成</button>:null;
  return <StoryGenerationControl session={session} busy={!!controlBusy} onControl={onControl}/>;
 }
 function productionRow(item:ShelfItem){
  const session=item.session!,generation=shelfGenerationStatus(session),number=edition(item,session);
  const tone=generation.group==='生成失败'?'failed':(shelfNeedsUserGroups as readonly string[]).includes(generation.group)?'needs':generation.group==='生成已暂停'?'paused':'active';
  // 系统自动暂停且可重试时，“继续生成”即主操作；需要用户选择的状态以整行按钮进入，不再另给控制按钮。
  const autoRetry=generation.group==='生成已暂停'&&session.retryAllowed&&(!session.generationControl||session.generationControl==='active');
  const side=autoRetry?<button type="button" className="yu-generation-control" disabled={busyAny} onClick={()=>onRetry(session)}>继续生成</button>:tone==='needs'?null:control(session,generation.group);
  const selected=!!onSelect&&selectedId===item.id;
  return <li className={'yu-production-row '+tone+(selected?' is-selected':'')} key={item.id} data-story-id={item.id}>
   <button className="yu-pending-story" aria-label={generation.action+'《'+item.title+'》'} aria-pressed={onSelect?selected:undefined} onClick={()=>onResume(session)}>
    <span className="yu-production-title"><strong>{item.title}</strong><em role="status">{generation.message}{session.story&&` · ${session.ready} / ${session.story.frameCount} 幅`}</em></span>
    <small className="yu-shelf-tags">{[item.book,item.theme,item.artStyleLabel].filter(Boolean).map(text=><span key={text} title={text}>{text}</span>)}{number&&<span>第 {number} 版</span>}</small>
    {generation.group==='生成失败'&&session.error?<small className="yu-production-error">{session.error}</small>:<span className="sr-only">{generation.detail}</span>}
   </button>
   <div className="yu-production-side">{side}{actions(item)}</div>
  </li>;
 }
 function card(item:ShelfItem){
  const story=item.story!,session=sessionById.get(item.id),generation=session?shelfGenerationStatus(session):null,number=edition(item,session);
  const total=story.frameCount,finished=total>0&&item.page+1>=total;
  const feedback=session&&session.state!=='completed'&&<div className="yu-shelf-generation-progress"><span role="status">{generation!.message}{session.story&&` · ${session.ready} / ${session.story.frameCount} 幅`}</span>{control(session,generation!.group)}</div>;
  const selected=!!onSelect&&selectedId===item.id,pick=onSelect?()=>onSelect(item.id):()=>onOpen(story);
  return <div className={'yu-shelf-row yu-shelf-row-readable'+(selected?' is-selected':'')} key={item.id} data-story-id={item.id}>
   <div className="yu-shelf-cover-wrap">
    <button className="yu-shelf-cover" aria-label={(onSelect?'选择《':'打开《')+item.title+'》'} title={item.book} onClick={pick}>{story.cover?<img src={story.cover} alt="" loading="lazy"/>:<span className="yu-shelf-pending"><Feather size={25}/></span>}</button>
    <div className="yu-shelf-cover-overlay"><small className="yu-shelf-book-badge">{item.book}</small>{actions(item)}</div>
   </div>
   <div className="yu-shelf-card-body">
    <button className="yu-shelf-card yu-shelf-card-details" aria-label={(onSelect?'选择《':'阅读《')+item.title+'》'} aria-pressed={onSelect?selected:undefined} onClick={pick}><h2>{item.title}</h2><span className="yu-shelf-tags"><span title={item.theme}>{item.theme}</span><span title={item.artStyleLabel}>{item.artStyleLabel}</span>{number&&<span>第 {number} 版</span>}</span></button>
    {feedback}
    <button className={'yu-shelf-reading-footer'+(finished?' finished':'')} aria-label={(finished?'重读《':'继续阅读《')+item.title+'》'} onClick={()=>finished?onOpen(story,true):onOpen(story)}>
     <span className="yu-shelf-progress" aria-hidden="true"><i style={{width:`${total?Math.min(100,Math.round((item.page+1)/total*100)):0}%`}}/></span>
     <span className="yu-shelf-reading-meta">{finished?<><span>已读完 · {total} 幅</span><span className="yu-shelf-continue">重读 <RotateCcw size={14}/></span></>:<><span>第 {item.page+1} / {total} 幅</span><span className="yu-shelf-continue">接着看 <ArrowRight size={15}/></span></>}</span>
    </button>
   </div>
  </div>;
 }
 const savedCount=items.filter(item=>item.saved).length;
 const readableView=grouping!=='none'?<div className="yu-shelf-groups">{groupShelfItems(readable,grouping).map(({label,items})=><ShelfGroup key={grouping+':'+label} id={grouping+':'+label}><summary><ChevronRight size={16}/>{grouping==='book'&&<BookOpen size={16}/>}<h2>{label}</h2><span>{items.length} 篇</span></summary><div className="yu-shelf-grid">{items.map(card)}</div></ShelfGroup>)}</div>:<div className="yu-shelf-grid">{readable.map(card)}</div>;
 return <section className="yu-shelf">
  {onSelect&&<SelectionGuard selectedId={selectedId} ids={visible.map(item=>item.id).join('\n')} onSelect={onSelect}/>}
  <h1>我的书架</h1>
  <div className="yu-shelf-search"><Search size={18} aria-hidden="true"/><input type="search" aria-label="搜索书架" placeholder="搜索故事、书名、主题或画风" value={query} onChange={event=>onQuery(event.target.value)}/>{query&&<button aria-label="清空搜索" onClick={()=>onQuery('')}><X size={16}/></button>}</div>
  <div className="yu-shelf-tabs"><button className={tab==='recent'?'active':''} aria-pressed={tab==='recent'} onClick={()=>onTab('recent')}>全部故事 <span>{items.length}</span></button><button className={tab==='saved'?'active':''} aria-pressed={tab==='saved'} onClick={()=>onTab('saved')}>我的收藏 <span>{savedCount}</span></button><button type="button" className="yu-shelf-create" onClick={onCreate}><Plus size={15} aria-hidden="true"/>新建故事</button></div>
  <div className="yu-shelf-view"><div className="yu-shelf-result"><span role="status" aria-live="polite">{filtered?`找到 ${visible.length} / ${items.length} 篇`:`共 ${items.length} 篇故事`}</span>{filtered&&<button type="button" onClick={resetFilters}>清除筛选</button>}</div><button type="button" className="yu-shelf-refresh" onClick={onRefresh} disabled={refreshing||loading||!!favoriteBusy} aria-label="刷新书架" title={refreshing?'刷新中…':'刷新书架'} aria-busy={refreshing}><RefreshCw size={16} className={refreshing?'spin':undefined} aria-hidden="true"/></button><label><span className="sr-only">书架分组</span><select aria-label="书架分组" value={grouping} onChange={event=>onGrouping(event.target.value as ShelfGrouping)}>{shelfGroupings.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} aria-hidden="true"/></label></div>
  {loading?<p className="yu-inline-status" role="status">正在打开书架…</p>:error?<div className="yu-inline-status" role="alert">{error}<button onClick={onRefresh} disabled={refreshing}>重试刷新</button></div>:null}
  {productions.length>0&&<ProductionGroup needs={needs} limit={query.trim()?null:Math.max(productionLimit,needs)}>{productions.map(productionRow)}</ProductionGroup>}
  {readable.length?<>{productions.length>0&&<h2 className="yu-shelf-region-title">可阅读<span>{readable.length} 篇</span></h2>}{readableView}</>
   :productions.length?(!filtered&&<p className="yu-shelf-region-empty">还没有可阅读的故事，完成制作后会出现在这里。</p>)
   :loading||error?null:query.trim()?<div className="yu-empty"><Search size={32} strokeWidth={1.2}/><h2>还没找到这篇故事</h2><p>试试其他故事名、书名、主题或画风。</p><button className="yu-primary" onClick={()=>onQuery('')}>清空搜索</button></div>:<div className="yu-empty"><BookOpen size={35} strokeWidth={1}/><h2>{tab==='recent'?'你的故事，从这里开始':'值得回味的，先收起来'}</h2><p>{tab==='recent'?'已保存和待生成的故事都会留在这里。':'阅读时轻点书签，下次一眼找到。'}</p><button className="yu-primary" onClick={onDiscover}>创作第一篇故事 <ArrowRight size={17}/></button></div>}
 </section>;
}
