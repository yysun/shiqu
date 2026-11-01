// Search and group readable and unfinished stories with independent actions and live generation status.
import {ArrowRight,Bookmark,BookOpen,ChevronDown,ChevronRight,Feather,Plus,RefreshCw,Search,Trash2,X} from 'lucide-react';
import type {Story} from '@/lib/content';
import type {GeneratedStory,SessionView,ProductionAction} from '@/lib/reader-model';
import StoryGenerationControl from './StoryGenerationControl';
import type {ReadingProgress} from '@/lib/reader-home';
import {getArtStyle} from '@/lib/reader-styles';
import {groupShelfItems,matchesShelfSearch,shelfGroupings,type ShelfGrouping} from '@/lib/shelf-browser';
import {shelfGenerationStatus} from '@/lib/shelf-generation';

type ShelfItem={processingStatus:string;id:string;title:string;book:string;theme:string;artStyleLabel:string;story:Story|null;session?:SessionView;page:number;saved:boolean};
type Props={onControl:(id:string,action:ProductionAction)=>Promise<void>;controlBusy:string;stories:Story[];pending:SessionView[];sessions:SessionView[];progress:ReadingProgress[];loading:boolean;refreshing:boolean;onRefresh:()=>void;error:string;tab:string;onTab:(tab:string)=>void;query:string;onQuery:(query:string)=>void;grouping:ShelfGrouping;onGrouping:(grouping:ShelfGrouping)=>void;bookName:(story:Pick<Story,'id'|'bookId'>)=>string;onOpen:(story:Story)=>void;onResume:(session:SessionView)=>void;onRetry:(session:SessionView)=>void;onDelete:(id:string,title:string)=>void;onFavorite:(id:string,saved:boolean)=>void;favoriteBusy:string;onCreate:()=>void;onDiscover:()=>void};
export default function ReaderShelf({onControl,controlBusy,stories,pending,sessions,progress,loading,refreshing,onRefresh,error,tab,onTab,query,onQuery,grouping,onGrouping,bookName,onOpen,onResume,onRetry,onDelete,onFavorite,favoriteBusy,onCreate,onDiscover}:Props){
 const progressById=new Map(progress.map(row=>[row.storyId,row]));
 const sessionById=new Map(sessions.map(session=>[session.id,session]));
 const processingStatus=(story:Story)=>{const session=sessionById.get(story.id);return session?shelfGenerationStatus(session).group:story.pages.every(page=>!!page.image)?'已完成':'生成已暂停';};
 const items:ShelfItem[]=[
  ...pending.map(session=>({processingStatus:shelfGenerationStatus(session).group,id:session.id,title:session.story?.title||session.selection.storyTitle||(session.intake?'等待选题的故事':'还在展开的故事'),book:bookName({id:session.id,bookId:session.selection.bookId}),theme:session.selection.theme,artStyleLabel:getArtStyle(session.selection.artStyle).label,story:null,session,page:session.page,saved:!!(progressById.get(session.id)?.saved??session.saved)})),
  ...stories.map(story=>({processingStatus:processingStatus(story),id:story.id,title:story.title,book:bookName(story),theme:story.theme,artStyleLabel:(story as GeneratedStory).generated?((story as GeneratedStory).artStyleLabel||'未记录画风'):'未记录画风',story,page:progressById.get(story.id)?.page||0,saved:!!progressById.get(story.id)?.saved})),
 ];
 const visible=items.filter(item=>(tab!=='saved'||item.saved)&&matchesShelfSearch(item,query));
 const filtered=!!query.trim()||tab==='saved';
 function resetFilters(){onQuery('');onTab('recent');}
 function card(item:ShelfItem,fullWidth:boolean){
  const {story}=item,session=item.session||sessionById.get(item.id),compact=!!story&&!fullWidth;
  const generation=session?shelfGenerationStatus(session):null;
  const number=session?.revision?.number||story?.revision||1,edition=number>1||sessions.some(s=>s.revision?.rootId===item.id)?`${number}`:'';
  const cover=story&&(story.pages[0].image?<img src={story.pages[0].image} alt=""/>:<span className="yu-shelf-pending"><Feather size={25}/></span>);
  const details=story&&<div>{!compact&&<small>{item.book}</small>}<h2>{item.title}</h2><div className="yu-shelf-tags"><span title={item.theme}>{item.theme}</span><span title={item.artStyleLabel}>{item.artStyleLabel}</span>{edition&&<span>{edition}</span>}</div><span className="yu-shelf-reading-meta"><span>第 {item.page+1} / {story.pages.length} 幅</span><span className="yu-shelf-continue">接着看 <ArrowRight size={15}/></span></span></div>;
  const actions=<div className="yu-shelf-card-actions"><button type="button" className={'yu-shelf-favorite'+(item.saved?' is-saved':'')} aria-label={(item.saved?'不再收藏':'收藏')+'《'+item.title+'》'} title={item.saved?'不再收藏':'收藏'} aria-pressed={item.saved} disabled={!!favoriteBusy||refreshing} onClick={()=>onFavorite(item.id,!item.saved)}><Bookmark size={18} fill={item.saved?'currentColor':'none'}/><span>{favoriteBusy===item.id?'保存中…':item.saved?'不再收藏':'收藏'}</span></button><button className="yu-delete-story" aria-label={'删除《'+item.title+'》'} title="删除故事" disabled={!!favoriteBusy||refreshing} onClick={()=>onDelete(item.id,item.title)}><Trash2 size={18}/></button></div>;
  return <div className={'yu-shelf-row'+(item.session?' yu-shelf-row-pending':'')+(compact?' yu-shelf-row-compact':'')} key={item.id}>
   {compact&&story?<>
    <button className="yu-shelf-cover" aria-label={'打开《'+item.title+'》'} onClick={()=>onOpen(story)}>{cover}</button>
    <div className="yu-shelf-card-toolbar"><small>{item.book}</small>{actions}</div>
    <button className="yu-shelf-card yu-shelf-card-details" aria-label={'继续阅读《'+item.title+'》'} onClick={()=>onOpen(story)}>{details}</button>
   </>:<>
    {item.session&&session?<button className="yu-pending-story" aria-label={generation!.action+'《'+item.title+'》'} onClick={()=>onResume(session)}><Feather size={21}/><span><strong>{item.title}</strong><small>{generation!.detail}</small><small>{item.book}</small><span className="yu-shelf-tags"><span title={item.theme}>{item.theme}</span><span title={item.artStyleLabel}>{item.artStyleLabel}</span>{edition&&<span>{edition}</span>}</span></span></button>:story&&<button className="yu-shelf-card" aria-label={'继续阅读《'+item.title+'》'} onClick={()=>onOpen(story)}>{cover}{details}</button>}
    {session&&generation&&generation.group==='生成已暂停'&&session.retryAllowed&&(!session.generationControl||session.generationControl==='active')&&<div className="yu-pending-retry"><button type="button" disabled={refreshing||!!favoriteBusy} onClick={()=>onRetry(session)}>继续生成 <ArrowRight size={15}/></button></div>}
    {actions}
   </>}
   {session&&session.state!=='completed'&&<div className="yu-shelf-generation-progress"><span role="status">{generation!.message}{session.story&&` · ${session.ready} / ${session.story.pages.length} 幅`}</span>{generation!.group==='生成失败'?session.retryAllowed&&<button type="button" className="yu-generation-control" disabled={refreshing||!!favoriteBusy||!!controlBusy} onClick={()=>onRetry(session)}>重试生成</button>:<StoryGenerationControl session={session} busy={!!controlBusy} onControl={onControl}/>}</div>}
  </div>;
 }
 return <section className="yu-shelf">
  <p className="yu-kicker">那些还想再翻一遍的故事</p><h1>我的书架</h1>
  <div className="yu-shelf-search"><Search size={18} aria-hidden="true"/><input type="search" aria-label="搜索书架" placeholder="搜索故事、书名、主题或画风" value={query} onChange={event=>onQuery(event.target.value)}/>{query&&<button aria-label="清空搜索" onClick={()=>onQuery('')}><X size={16}/></button>}</div>
  <div className="yu-shelf-tabs"><button className={tab==='recent'?'active':''} aria-pressed={tab==='recent'} onClick={()=>onTab('recent')}>全部故事</button><button className={tab==='saved'?'active':''} aria-pressed={tab==='saved'} onClick={()=>onTab('saved')}>我的收藏</button><button type="button" className="yu-shelf-create" onClick={onCreate}><Plus size={15} aria-hidden="true"/>新建故事</button></div>
  <div className="yu-shelf-view"><div className="yu-shelf-result"><span role="status" aria-live="polite">{filtered?`找到 ${visible.length} / ${items.length} 篇`:`共 ${items.length} 篇故事`}</span>{filtered&&<button type="button" onClick={resetFilters}>清除筛选</button>}</div><button type="button" className="yu-shelf-refresh" onClick={onRefresh} disabled={refreshing||loading||!!favoriteBusy} aria-label="刷新书架" aria-busy={refreshing}><RefreshCw size={15} className={refreshing?'spin':undefined} aria-hidden="true"/>{refreshing?'刷新中…':'刷新'}</button><label><span className="sr-only">书架分组</span><select aria-label="书架分组" value={grouping} onChange={event=>onGrouping(event.target.value as ShelfGrouping)}>{shelfGroupings.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} aria-hidden="true"/></label></div>
  {loading?<p className="yu-inline-status" role="status">正在打开书架…</p>:error?<div className="yu-inline-status" role="alert">{error}<button onClick={onRefresh} disabled={refreshing}>重试刷新</button></div>:null}
  {visible.length?grouping!=='none'?<div className="yu-shelf-groups">{groupShelfItems(visible,grouping).map(({label,items})=><details className="yu-shelf-book-group" key={grouping+':'+label} open><summary><ChevronRight size={16}/>{grouping==='book'&&<BookOpen size={16}/>}<h2>{label}</h2><span>{items.length} 篇</span></summary><div className={'yu-shelf-grid'+(items.length===1?' yu-shelf-grid-single':'')}>{items.map(item=>card(item,items.length===1))}</div></details>)}</div>:<div className="yu-shelf-grid">{visible.map(item=>card(item,false))}</div>:loading||error?null:query.trim()?<div className="yu-empty"><Search size={32} strokeWidth={1.2}/><h2>还没找到这篇故事</h2><p>试试其他故事名、书名、主题或画风。</p><button className="yu-primary" onClick={()=>onQuery('')}>清空搜索</button></div>:<div className="yu-empty"><BookOpen size={35} strokeWidth={1}/><h2>{tab==='recent'?'你的故事，从这里开始':'值得回味的，先收起来'}</h2><p>{tab==='recent'?'已保存和待生成的故事都会留在这里。':'阅读时轻点书签，下次一眼找到。'}</p><button className="yu-primary" onClick={onDiscover}>创作第一篇故事 <ArrowRight size={17}/></button></div>}
 </section>;
}
