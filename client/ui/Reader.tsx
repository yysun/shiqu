'use client';
// Coordinate story discovery, resumable generation, and the reading sheets.

import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Bookmark, BookOpen, Check, ChevronLeft, ChevronRight, Compass, Download, Feather, Heart, Leaf, Moon, Play, RotateCcw, ImageDown, Settings2, Sparkles, UserRound, X, Loader2, FileDown, RefreshCw, Trash2} from 'lucide-react';
import {randomId, request} from './shared';
import type {Story} from '@/lib/content';
import {historicalBookTitle} from '@/lib/story-book';
import type {GeneratedStory,Selection} from '@/lib/reader-model';
import {readerBooks,type ReaderBook} from '@/lib/reader-books';
import {useStoryGeneration} from './useStoryGeneration';
const isGenerated=(s:Story|null):s is GeneratedStory=>!!s&&'generated'in s&&s.generated===true;
import {artStyleGroups,getArtStyle} from '@/lib/reader-styles';
import {selectSuggestedStory,isSelectedStory} from '@/lib/reader-art-recommendation';
import {StoryArtRecommendation} from './StoryArtRecommendation';
import {defaultProductionPrompt,promptAfterThemeChange} from '@/lib/reader-prompts';
import {recentHeroes,mergeReadingProgress,reconcileReadingProgress} from '@/lib/reader-home';
import RecentStories from './RecentStories';
import ReaderShelf from './ReaderShelf';
import type {ShelfGrouping} from '@/lib/shelf-browser';
import DeletedStories,{type DeletedStory} from './DeletedStories';
import {useStorySuggestions} from './useStorySuggestions';
import {StoryReadingState} from './StoryReadingState';
import {useStoryArtRecommendation} from './useStoryArtRecommendation';
import StorySource from './StorySource';
import {localSourceKey} from '@/lib/reader-source-key';
import StoryScript from './StoryScript';
import StoryFrameCount,{StoryNarrativeDetail} from './StoryFrameCount';
import {narrativeDetailSchema,narrativeDetails} from '@/lib/reader-frame-recommendation';
import StoryRetry from './StoryRetry';
import StoryGenerationStatus from './StoryGenerationStatus';
import StoryPageSurface from './StoryPageSurface';
import StoryEndingSurface from './StoryEndingSurface';
import {newWheelGesture,wheelPageDirection,swipePageDirection} from '@/lib/reader-navigation';
import './reader.css';

type Book = ReaderBook;
type Progress = {storyId:string; page:number; saved?:number; updatedAt?:string|null};
type ExportFormat='pdf'|'png';
const choices:Book[] = [...readerBooks,{id:'other',title:'其他',author:'书名或 URL',era:'自选',genre:'自选',note:'带上你自己的那本书'}];
const moods:Selection['theme'][] = ['给我一个反转','人情冷暖','放下执念','聪明与糊涂','善意与误解','命运与选择','欲望与代价','勇气与成长','爱情与错过','幽默与讽刺','因果与报应','其他'];

function Sheet({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}) {
 const dialogRef=useRef<HTMLDialogElement>(null),contentRef=useRef<HTMLElement>(null);
 useEffect(()=>{
  const dialog=dialogRef.current!,body=document.body,root=document.documentElement;
  const prior=document.activeElement as HTMLElement,scrollY=window.scrollY,priorUrl=location.href;
  const bodyStyle={position:body.style.position,top:body.style.top,width:body.style.width,overflow:body.style.overflow};
  const rootOverflow=root.style.overflow;
  // Fixed-body locking also prevents background rubber-band scrolling on iOS.
  Object.assign(body.style,{position:'fixed',top:`-${scrollY}px`,width:'100%',overflow:'hidden'});
  root.style.overflow='hidden';
  dialog.showModal();contentRef.current?.focus({preventScroll:true});
  return()=>{
   dialog.close();Object.assign(body.style,bodyStyle);root.style.overflow=rootOverflow;
   if(prior?.isConnected)prior.focus({preventScroll:true});
   window.scrollTo({top:location.href===priorUrl?scrollY:0,behavior:'instant'});
  };
 },[]);
 return <dialog className="yu-backdrop" ref={dialogRef} aria-label={title} aria-modal="true" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section className="yu-sheet" tabIndex={-1} ref={contentRef}><div className="yu-handle"/><header><h2>{title}</h2><button className="yu-icon" aria-label="关闭" onClick={onClose}><X size={21}/></button></header>{children}</section></dialog>;
}

export default function Reader(){
 const [stories,setStories]=useState<Story[]>([]),[books,setBooks]=useState<Book[]>(choices),[progress,setProgress]=useState<Progress[]>([]);
 const authoritativeProgress=useRef<Progress[]>([]);
 const [shelfQuery,setShelfQuery]=useState(''),[shelfGrouping,setShelfGrouping]=useState<ShelfGrouping>('book');
 const [shelfRefreshing,setShelfRefreshing]=useState(false);
 const [tab,setTab]=useState('discover'),[shelfTab,setShelfTab]=useState('recent'),[story,setStory]=useState<Story|null>(null),[page,setPage]=useState(0),[ended,setEnded]=useState(false),[saved,setSaved]=useState(false);
 const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[toast,setToast]=useState(''),[source,setSource]=useState(false),[configure,setConfigure]=useState(false),[unavailable,setUnavailable]=useState(''),[settings,setSettings]=useState(false);
 const [selection,setSelection]=useState<Selection>({bookId:'liaozhai',theme:'给我一个反转',artStyle:'ink-pencil',productionPrompt:defaultProductionPrompt('给我一个反转'),length:'auto',narrativeDetail:'balanced',voice:false}),[feedback,setFeedback]=useState(''),[largeText,setLargeText]=useState(false),[install,setInstall]=useState<any>(null),[motion,setMotion]=useState('forward'),[creating,setCreating]=useState(false);
 const [deletedIds,setDeletedIds]=useState<string[]>([]),[deleteTarget,setDeleteTarget]=useState<{id:string;title:string}|null>(null),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('');
 const [favoriteBusy,setFavoriteBusy]=useState('');
 const [deletedStories,setDeletedStories]=useState<DeletedStory[]>([]),[recoveryOpen,setRecoveryOpen]=useState(false),[recoveryLoading,setRecoveryLoading]=useState(false),[recoveryError,setRecoveryError]=useState(''),[restoring,setRestoring]=useState(''),[undoTarget,setUndoTarget]=useState<DeletedStory|null>(null);
 const restoreLock=useRef(false),recoveryLoad=useRef(0),pendingRestores=useRef(new Map<string,DeletedStory>());
 const favoriteLock=useRef(false);
 const deleted=useRef(new Set<string>());
 const [customTheme,setCustomTheme]=useState('');
 const suggestions=useStorySuggestions(selection,selection.theme==='其他'?customTheme:selection.theme);
 const {candidates,finding,note:candidateNote}=suggestions;
 const selectedCandidate=suggestions.batches.flatMap(batch=>batch.stories).find(candidate=>isSelectedStory(selection,candidate));
 const hasSelectedStory=useRef(false);hasSelectedStory.current=!!selectedCandidate;
 const storyArt=useStoryArtRecommendation(configure&&!creating?selectedCandidate:undefined,{...selection,theme:selection.theme==='其他'?customTheme:selection.theme});
 const [exporting,setExporting]=useState<ExportFormat|null>(null),[exportProgress,setExportProgress]=useState(''),[pdfDownload,setPdfDownload]=useState<{url:string;filename:string;storyId:string}|null>(null),[pngDownload,setPngDownload]=useState<{url:string;filename:string;storyId:string}|null>(null);
 useEffect(()=>()=>{if(pdfDownload)URL.revokeObjectURL(pdfDownload.url);},[pdfDownload]);
 useEffect(()=>()=>{if(pngDownload)URL.revokeObjectURL(pngDownload.url);},[pngDownload]);
 const exportLock=useRef(false),styleRef=useRef<HTMLElement>(null),candidateRef=useRef<HTMLDivElement>(null),readingRef=useRef<HTMLDivElement>(null);
 const [scrollRequest,setScrollRequest]=useState<{target:'styles'|'candidates'|'reading';stamp:number}|null>(null);
 useEffect(()=>{if(!configure||!scrollRequest)return;const target=scrollRequest.target==='styles'?styleRef.current:scrollRequest.target==='reading'?readingRef.current:candidateRef.current;if(!target)return;target.focus({preventScroll:true});const sheet=target.closest('.yu-sheet');if(sheet)sheet.scrollTo({top:sheet.scrollTop+target.getBoundingClientRect().top-sheet.getBoundingClientRect().top-20,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[scrollRequest,configure]);
 const [drag,setDrag]=useState(0),[lastReadId,setLastReadId]=useState('');
 const [metadataVisible,setMetadataVisible]=useState(true);
 useEffect(()=>{setMetadataVisible(true);},[story?.id]);
 const readerRef=useRef<HTMLElement>(null),endingRef=useRef<HTMLElement>(null);
 const wheelGesture=useRef(newWheelGesture());
 function acceptServerProgress(rows:Progress[]){
  authoritativeProgress.current=reconcileReadingProgress(authoritativeProgress.current,rows);
  setProgress(old=>{
   let cached:Progress[]=[];try{cached=JSON.parse(localStorage.getItem('yiyu-reading')||'[]');}catch{}
   const merged=reconcileReadingProgress(mergeReadingProgress(old,cached),authoritativeProgress.current).filter(p=>!deleted.current.has(p.storyId));
   try{localStorage.setItem('yiyu-reading',JSON.stringify(merged));}catch{}
   return merged;
  });
 }
 const gen=useStoryGeneration(page,{onStory:(s,p,b)=>{if(deleted.current.has(s.id))return;setStory(s);setStories(old=>[s,...old.filter(x=>x.id!==s.id)]);if(p!==undefined){setPage(p);setSaved(!!b);}},onProgress:acceptServerProgress},tab==='shelf'&&!story&&!configure&&!favoriteBusy&&!deleting&&!restoring&&!shelfRefreshing);
 const visitor=useRef(''),session=useRef(''),seen=useRef(new Set<number>()),noticeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const notify=(text:string)=>{setToast(text);if(noticeTimer.current)clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setToast(''),4000);};
 async function refreshShelf(){
  if(shelfRefreshing)return;setShelfRefreshing(true);
  try{
   const [published,,serverProgress]:[Story[],unknown,Progress[]]=await Promise.all([request('stories'),gen.refreshLibrary(),request('me/progress')]);
   setStories(old=>[...old.filter(s=>isGenerated(s)&&!deleted.current.has(s.id)),...published.filter(s=>!deleted.current.has(s.id))]);
   acceptServerProgress(serverProgress);setLoadError('');
  }catch{notify('书架刷新失败，请重试。');}
  finally{setShelfRefreshing(false);}
 }

 function track(kind:string,s:Story|null=story,index:number|null=null){if(!s||!visitor.current||!session.current)return;request(isGenerated(s)?'reader/sessions/'+s.id+'/events':'events','POST',{id:session.current+':'+s.id+':'+kind+(index===null?'':':'+index),visitor:visitor.current,session:session.current,storyId:s.id,kind,page:index,mode:'manual',cohort:'internal'}).catch(()=>{});}
 function remember(s:Story,index:number,isSaved:boolean){if(deleted.current.has(s.id))return;authoritativeProgress.current=reconcileReadingProgress(authoritativeProgress.current,[{storyId:s.id,page:index,saved:isSaved?1:0,updatedAt:new Date().toISOString()}]);setLastReadId(s.id);try{localStorage.setItem('shiqu-last-read',s.id);}catch{}setProgress(pr=>{const rows=[{storyId:s.id,page:index,saved:isSaved?1:0,updatedAt:new Date().toISOString()},...pr.filter(p=>p.storyId!==s.id)];localStorage.setItem('yiyu-reading',JSON.stringify(rows));return rows;});request(isGenerated(s)?'reader/sessions/'+s.id+'/progress':'me/progress','POST',{storyId:s.id,page:index,saved:isSaved}).catch(()=>{});}
 function open(s:Story,restart=false){if(deleted.current.has(s.id))return;setDrag(0);if(isGenerated(s))gen.resume(s.id,restart?0:undefined).catch(e=>notify(e.message));else gen.leave();setConfigure(false);setUnavailable('');const pr=progress.find(p=>p.storyId===s.id);const index=restart?0:Math.min(pr?.page||0,s.pages.length-1);setPage(index);setStory(s);setSaved(!!pr?.saved);setEnded(false);setFeedback('');setMotion('forward');seen.current=new Set();session.current=randomId();history.replaceState(null,'','/read?id='+encodeURIComponent(s.id));track('start',s);window.scrollTo(0,0);}
 function home(){setDrag(0);gen.leave();setStory(null);setEnded(false);setSource(false);history.replaceState(null,'','/');}
 function turn(delta:number){if(!story)return;if(!ended&&page===0&&delta<0)return;if(ended){if(delta<0){setDrag(0);setPage(story.pages.length-1);setEnded(false);setMotion('back');}else if(delta>0)home();return;}if(delta>0&&!story.pages[page]?.image){notify('这一幅还在绘制，稍等一下。');return;}setMotion(delta>0?'forward':'back');if(page+delta>=story.pages.length){setEnded(true);if(seen.current.size===story.pages.length)track('complete');}else setPage(p=>Math.max(0,p+delta));}
 function choose(bookId:Selection['bookId']=selection.bookId,theme:Selection['theme']=selection.theme){setSelection(s=>({...s,bookId,theme,productionPrompt:promptAfterThemeChange(s.productionPrompt,s.theme==='其他'?customTheme:s.theme,theme==='其他'?customTheme:theme),storyTitle:undefined,source:undefined}));setConfigure(true);setUnavailable('');}
 useEffect(()=>{visitor.current=localStorage.getItem('yiyu-visitor')||randomId();localStorage.setItem('yiyu-visitor',visitor.current);try{const selected=JSON.parse(localStorage.getItem('yiyu-preferences')||'null');if(selected&&typeof selected.bookId==='string')setSelection({...selection,...selected,artStyle:getArtStyle(selected.artStyle).id,productionPrompt:typeof selected.productionPrompt==='string'?selected.productionPrompt:defaultProductionPrompt(selected.theme||selection.theme),length:'auto',narrativeDetail:narrativeDetailSchema.safeParse(selected.narrativeDetail).success?selected.narrativeDetail:'balanced',voice:false});setLargeText(localStorage.getItem('yiyu-large-text')==='1');}catch{}const installHandler=(e:Event)=>{e.preventDefault();setInstall(e);};window.addEventListener('beforeinstallprompt',installHandler);if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
 Promise.all([request('stories'),request('books'),request('me/progress').catch(()=>null),request('reader/deletions')]).then(([list,bookList,serverProgress,deletions])=>{setDeletedStories(deletions);const hidden:string[]=deletions.map((d:{storyId:string})=>d.storyId);hidden.forEach(id=>deleted.current.add(id));setDeletedIds([...deleted.current]);setStories(list.filter((s:Story)=>!deleted.current.has(s.id)));setBooks(choices);let local:Progress[]=[];try{local=JSON.parse(localStorage.getItem('yiyu-reading')||'[]');setLastReadId(localStorage.getItem('shiqu-last-read')||local[0]?.storyId||'');}catch{}authoritativeProgress.current=reconcileReadingProgress(authoritativeProgress.current,serverProgress||[]);const merged=reconcileReadingProgress(local,authoritativeProgress.current).filter(p=>!deleted.current.has(p.storyId));setProgress(old=>reconcileReadingProgress(mergeReadingProgress(old,merged),authoritativeProgress.current).filter(p=>!deleted.current.has(p.storyId)));localStorage.setItem('yiyu-reading',JSON.stringify(merged));const id=new URLSearchParams(location.search).get('id');const selected=list.find((s:Story)=>s.id===id);if(selected&&!deleted.current.has(selected.id)){const pr=merged.find(p=>p.storyId===id);setPage(Math.min(pr?.page||0,selected.pages.length-1));setSaved(!!pr?.saved);setStory(selected);session.current=randomId();track('start',selected);}else if(id&&!deleted.current.has(id)){gen.resume(id).catch(()=>setLoadError('这篇故事暂时无法打开。'));}}).catch(()=>setLoadError('故事暂时没有加载出来，请检查网络后再试。')).finally(()=>setLoading(false));return()=>{window.removeEventListener('beforeinstallprompt',installHandler);if(noticeTimer.current)clearTimeout(noticeTimer.current);};},[]);
 useEffect(()=>{if(story){if(!session.current)session.current=randomId();track('start',story);}},[story?.id]);
 useEffect(()=>{if(!story||ended||!story.pages[page]?.image)return;seen.current.add(page);track('page',story,page);remember(story,page,saved);const next=story.pages[page+1]?.image;if(next){const img=new Image();img.src=next;}},[story?.id,story?.pages[page]?.image,page,ended]);
 useEffect(()=>{function key(e:KeyboardEvent){if(!story||source||settings||configure)return;if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();turn(1);}if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();turn(-1);}if(e.key==='Escape')home();}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[story,page,ended,source,settings,configure]);
 useEffect(()=>{
  const reader=readerRef.current;if(!reader||!story||source||settings||configure)return;
  const gesture=wheelGesture.current;
  function wheel(e:WheelEvent){
   if(e.ctrlKey||e.metaKey)return; // Preserve browser zoom and trackpad pinch.
   const horizontal=Math.abs(e.deltaX)>Math.abs(e.deltaY);
   if(ended&&!horizontal)return; // The closing page keeps its native vertical scroll.
   const raw=horizontal?e.deltaX:e.deltaY;if(!raw)return;
   e.preventDefault();
   const direction=wheelPageDirection(gesture,{x:e.deltaX,y:e.deltaY,mode:e.deltaMode,time:performance.now(),height:reader!.clientHeight});
   if(direction)turn(direction);
  }
  reader.addEventListener('wheel',wheel,{passive:false});
  return()=>reader.removeEventListener('wheel',wheel);
 },[story,page,ended,source,settings,configure]);
 useEffect(()=>{
  const ending=endingRef.current;if(!ending||!ended||source||settings||configure)return;
  let start:{x:number;y:number}|null=null;
  const touchStart=(e:TouchEvent)=>{const target=e.target as HTMLElement;start=ending.scrollTop<=1&&e.touches.length===1&&!target.closest('button,a')?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;};
  const touchMove=(e:TouchEvent)=>{if(!start||e.touches.length!==1)return;const dx=e.touches[0].clientX-start.x,dy=e.touches[0].clientY-start.y;if(dy>0&&Math.abs(dy)>Math.abs(dx)*1.3){e.preventDefault();if(swipePageDirection(dx,dy)===-1){start=null;turn(-1);}}};
  ending.addEventListener('touchstart',touchStart,{passive:true});ending.addEventListener('touchmove',touchMove,{passive:false});
  return()=>{ending.removeEventListener('touchstart',touchStart);ending.removeEventListener('touchmove',touchMove);};
 },[ended,story,source,settings,configure]);
 useEffect(()=>{localStorage.setItem('yiyu-preferences',JSON.stringify(selection));},[selection]);
 function bookmark(){if(!story)return;const value=!saved;setSaved(value);remember(story,page,value);if(value)track('save');notify(value?'收好了，下次接着看。':'已移出收藏');}
 async function favoriteFromShelf(id:string,value:boolean){
  if(favoriteLock.current||deleted.current.has(id))return;
  favoriteLock.current=true;setFavoriteBusy(id);
  try{
   const result:Progress=await request('reader/library/'+encodeURIComponent(id)+'/favorite','POST',{saved:value});
   acceptServerProgress([result]);
   notify(value?'已收藏，下次接着看。':'已不再收藏');
  }catch(error){notify(error instanceof Error?error.message:'收藏暂未保存，请重试。');}
  finally{favoriteLock.current=false;setFavoriteBusy('');}
 }

 async function findStories(){setUnavailable('');setScrollRequest({target:'reading',stamp:Date.now()});if(await suggestions.find()&&!hasSelectedStory.current)setScrollRequest({target:'candidates',stamp:Date.now()});}
 function visitBatch(index:number){suggestions.goTo(index);setSelection(s=>({...s,storyTitle:undefined,source:undefined}));setUnavailable('');setScrollRequest({target:'candidates',stamp:Date.now()});}
 async function exportStory(format:ExportFormat){if(!story||exportLock.current)return;exportLock.current=true;setExporting(format);setExportProgress(format==='png'?'正在准备一页 PNG':'正在准备 PDF');try{if(format==='png'){const {downloadStoryPng}=await import('@/lib/reader-png');const result=await downloadStoryPng(story,setExportProgress);setPngDownload({...result,storyId:story.id});notify('一页 PNG 已准备好；可点“下载一页 PNG”再次下载。');}else{const {downloadStoryPdf}=await import('@/lib/reader-pdf');const result=await downloadStoryPdf(story,setExportProgress);setPdfDownload({...result,storyId:story.id});notify('PDF 已准备好；可点“下载 PDF”再次下载。');}}catch(e){notify(e instanceof Error?e.message:'导出失败，请保持联网后重试。');}finally{exportLock.current=false;setExporting(null);setExportProgress('');}}
 async function generate(){if(creating||!selectedCandidate)return;suggestions.cancel();setCreating(true);setUnavailable('');try{gen.leave();session.current=randomId();seen.current=new Set();setFeedback('');setPage(0);setSaved(false);setStory(null);setEnded(false);await gen.start({...selection,length:'auto',narrativeDetail:selection.narrativeDetail||'balanced',source:selectedCandidate.source,voice:false,theme:selection.theme==='其他'?customTheme:selection.theme});setConfigure(false);}catch(e){setUnavailable(e instanceof Error?e.message:'暂时无法开启故事');}finally{setCreating(false);}}
 async function deleteStory(){
  if(!deleteTarget||deleting)return;const target=deleteTarget;setDeleting(true);setDeleteError('');
  try{
   const result=await request('reader/library/'+encodeURIComponent(target.id),'DELETE');
   const record:DeletedStory={storyId:target.id,title:target.title,deletedAt:result.deletedAt,kind:gen.sessions.some(s=>s.id===target.id)?'generated':'published'};
   setDeletedStories(rows=>[record,...rows.filter(row=>row.storyId!==record.storyId)]);setUndoTarget(record);setRecoveryError('');setToast('');
   deleted.current.add(target.id);setDeletedIds([...deleted.current]);gen.remove(target.id);setStories(old=>old.filter(s=>s.id!==target.id));
   setProgress(old=>{const rows=old.filter(p=>p.storyId!==target.id);try{localStorage.setItem('yiyu-reading',JSON.stringify(rows));}catch{}return rows;});
   if(lastReadId===target.id){setLastReadId('');try{localStorage.removeItem('shiqu-last-read');}catch{}}
   try{const cache=await caches.open('yiyu-offline-v1');await cache.delete('/offline-data/'+target.id);}catch{}
   if(story?.id===target.id)home();setDeleteTarget(null);
  }catch(e){setDeleteError(e instanceof Error?e.message:'删除失败，请重试。');}finally{setDeleting(false);}
 }
 async function loadDeletedStories(){
  const attempt=++recoveryLoad.current;setRecoveryLoading(true);setRecoveryError('');
  try{
   // A restore may have committed before its snapshot reload failed; keep that recovery retryable.
   for(const target of pendingRestores.current.values())await restoreStory(target);
   if(pendingRestores.current.size)return;
   const rows:DeletedStory[]=await request('reader/deletions');if(attempt===recoveryLoad.current)setDeletedStories(rows);
  }
  catch(error){if(attempt===recoveryLoad.current)setRecoveryError(error instanceof Error?error.message:'已删除的故事暂未加载，请重试。');}
  finally{if(attempt===recoveryLoad.current)setRecoveryLoading(false);}
 }
 async function restoreStory(target:DeletedStory){
  if(restoreLock.current)return;restoreLock.current=true;setRestoring(target.storyId);setRecoveryError('');
  try{
   pendingRestores.current.set(target.storyId,target);
   await request('reader/library/'+encodeURIComponent(target.storyId)+'/restore','POST');
   const [published,sessions,serverProgress]:[Story[],Awaited<ReturnType<typeof gen.refreshLibrary>>,Progress[]]=await Promise.all([request('stories'),gen.refreshLibrary(target.kind==='generated'?target.storyId:undefined),request('me/progress')]);
   deleted.current.delete(target.storyId);setDeletedIds([...deleted.current]);
   setStories(published.filter(s=>!deleted.current.has(s.id)));
   acceptServerProgress([...serverProgress,...sessions.map(s=>({storyId:s.id,page:s.page,saved:s.saved?1:0,updatedAt:s.lastReadAt||s.createdAt}))]);
   pendingRestores.current.delete(target.storyId);
   setDeletedStories(rows=>rows.filter(row=>row.storyId!==target.storyId));setUndoTarget(old=>old?.storyId===target.storyId?null:old);
   notify('已恢复《'+target.title+'》，可从书架继续。');
  }catch(error){setRecoveryError(error instanceof Error?error.message:'恢复暂未完成，请重试。');}
  finally{restoreLock.current=false;setRestoring('');}
 }
 function askDelete(id:string,title:string){setDeleteError('');setDeleteTarget({id,title});}
 function exportControl(format:ExportFormat,className:string){
  if(!story)return null;
  const download=format==='png'?pngDownload:pdfDownload,Icon=format==='png'?ImageDown:FileDown;
  return download?.storyId===story.id?<a className={className} href={download.url} download={download.filename}><Icon size={19}/><span>{format==='png'?'下载一页 PNG':'下载 PDF'}</span></a>:<button className={className} disabled={!!exporting||!story.pages.length||story.pages.some(p=>!p.image)} onClick={()=>exportStory(format)}>{exporting===format?<Loader2 size={19} className="spin"/>:<Icon size={19}/>}<span>{exporting===format?exportProgress:format==='png'?'一页输出（PNG）':'导出故事 PDF'}</span></button>;
 }
 const allStories=[...stories,...gen.sessions.flatMap(s=>s.story&&!stories.some(x=>x.id===s.id)?[s.story]:[])].filter(s=>!deletedIds.includes(s.id));
 const heroes=recentHeroes(allStories,deletedIds.includes(lastReadId)?'':lastReadId,progress.filter(p=>!deletedIds.includes(p.storyId)));
 const bookName=(s:Pick<Story,'id'|'bookId'>)=>(s.bookId==='other'?gen.sessions.find(session=>session.id===s.id)?.selection.customBook:'')||books.find(b=>b.id===s.bookId)?.title||historicalBookTitle(s.bookId)||s.bookId;
 const current=story?.pages[page],selectedBook=books.find(b=>b.id===selection.bookId)||choices[0];
 const activeProgress=mergeReadingProgress(progress).filter(p=>!deletedIds.includes(p.storyId));
 const pendingStories=gen.sessions.filter(s=>!deletedIds.includes(s.id)&&!s.story?.pages[0]?.image);
 const shelf=activeProgress.flatMap(p=>{const s=allStories.find(s=>s.id===p.storyId);return s&&s.pages[0]?.image?[s]:[];});

 const shelfCount=shelf.length+pendingStories.length;
 const progressById=new Map(activeProgress.map(p=>[p.storyId,p]));
 const favoriteCount=shelf.filter(s=>progressById.get(s.id)?.saved).length+pendingStories.filter(s=>progressById.get(s.id)?.saved??s.saved).length;

 return <div className={'yu-world'+(story?' yu-reading-world':'')}><div className={'yu-app'+(story?' yu-immersive':'')}>
 {story?<main className={'yu-reader'+(!metadataVisible&&!ended?' yu-metadata-hidden':'')} ref={readerRef} aria-label={'阅读'+story.title}>
 {!ended&&<div className="yu-filmstrip" style={{transform:`translateX(calc(${-page*100}% + ${drag}px))`,transition:drag?'none':undefined}}>{story.pages.map((p,i)=><div className="yu-film-frame" key={i}>{p.image&&<img className={'yu-scene '+(i===page?'is-current':'')} src={p.image} alt={i===page?p.caption:''} draggable={false}/>}</div>)}</div>}
 <div className="yu-scene-shade"/>
 {!ended&&!current?.image&&<div className="yu-drawing" role="status"><div className="yu-drawing-orbit"><Feather size={35} strokeWidth={1}/></div><span>{gen.error?'画笔暂停了一下':'这一幅，正在展开'}</span><small>{gen.error||gen.active?.stage||'正在为你绘制画面'}</small>{gen.error&&gen.active&&<StoryRetry session={gen.active} busy={gen.busy} onRetry={gen.retryStep}/>}</div>}
 <header className="yu-reader-top"><div className="yu-progress" aria-label={`第${page+1}幅，共${story.pages.length}幅`}>{story.pages.map((_,i)=><span key={i} className={i<=page?'read':''}/>)}</div><div className="yu-reader-heading"><button className="yu-glass" onClick={home} aria-label="返回发现"><ArrowLeft size={21}/></button><div><strong>{story.title}</strong><span>{bookName(story)}</span></div><button className="yu-glass" onClick={bookmark} aria-label={saved?'取消收藏':'收藏故事'}><Bookmark size={20} fill={saved?'currentColor':'none'}/></button><button className="yu-glass" onClick={()=>setSettings(true)} aria-label="阅读偏好"><Settings2 size={19}/></button></div></header>
 {ended?<StoryEndingSurface surfaceRef={endingRef} onTurn={turn} onDrag={setDrag} drag={drag}><div className="yu-ending-mark"><Leaf size={32} strokeWidth={1.3}/></div><p className="yu-kicker">故事到这里，余味留给你</p><h1>{story.reflection}</h1><div className="yu-end-line"/><p>有些故事的最后一页，<br/>其实在你的生活里。</p><div className="yu-feelings"><button disabled={!!feedback} aria-pressed={feedback==='positive'} onClick={()=>{setFeedback('positive');track('feedback_positive');}}><Heart size={18} fill={feedback==='positive'?'currentColor':'none'}/>有点余味</button><button disabled={!!feedback} aria-pressed={feedback==='negative'} onClick={()=>{setFeedback('negative');track('feedback_negative');}}>再想想</button></div><button className="yu-primary" onClick={()=>{home();choose();}}><Sparkles size={18}/>开启下一篇<ArrowRight size={19}/></button><div className="yu-ending-navigation"><button onClick={()=>turn(-1)}><ChevronLeft size={17}/>返回上一幅</button><button onClick={()=>open(story,true)}><RotateCcw size={16}/>从头再看</button></div>{exportControl('pdf','yu-ending-pdf')}{exportControl('png','yu-ending-pdf')}<button className="yu-end-source" onClick={()=>setSource(true)}>读一读原文 <ChevronRight size={13}/></button></StoryEndingSurface>:<>
 <StoryPageSurface onTurn={turn} onDrag={setDrag} onToggleMetadata={()=>setMetadataVisible(visible=>!visible)}/>
 <div className={'yu-scene-caption '+(largeText?'large':'')} key={'caption-'+page}><div className="yu-scene-number"><span>{String(page+1).padStart(2,'0')}</span><i/><span>{String(story.pages.length).padStart(2,'0')}</span>{isGenerated(story)&&gen.busy&&<span className="yu-scene-generation" role="status"><Loader2 size={12} className="spin"/>{gen.active?.stage||'正在生成'}</span>}</div><p>{current?.caption}</p>{gen.error&&current?.image&&<div className="yu-reader-error">{gen.error}{gen.active&&<StoryRetry session={gen.active} busy={gen.busy} onRetry={gen.retryStep}/>}</div>}</div>
 <footer className="yu-reader-bottom"><button className="yu-source-button" onClick={()=>setSource(true)}><BookOpen size={17}/><span>原文</span></button><span className="yu-style-label" aria-label="本篇主题与画风"><Feather size={17} aria-hidden="true"/><span>{story.theme&&`${story.theme} · `}{isGenerated(story)?(story.artStyleLabel||'未记录画风'):'未记录画风'}</span></span><div className="yu-arrows"><button className="yu-glass" onClick={()=>page===0?home():turn(-1)} aria-label={page===0?'返回主页':'上一幅'}><ChevronLeft size={22}/></button><button className="yu-next" onClick={()=>turn(1)} aria-label={page===story.pages.length-1?'读完，回味':'下一幅'}>{page===story.pages.length-1?<Leaf size={20}/>:<ChevronRight size={23}/>}</button></div></footer>
 </>}
 </main>:<>
 <header className="yu-header"><button className="yu-logo" onClick={()=>setTab('discover')} aria-label="拾趣，返回发现"><span><Feather size={22}/></span><strong>拾趣</strong><i/></button><span className="yu-header-note">片刻入戏，久久回味</span><button className="yu-avatar" onClick={()=>setTab('me')} aria-label="我的"><UserRound size={19}/></button></header>
 <main className="yu-home">
 {tab==='discover'?<>
 <section className="yu-intro"><div><p className="yu-kicker">把片刻，留给一个好故事</p><h1>今天，想遇见<br/>什么<span>故事</span>？</h1></div><span className="yu-stamp">古意<br/>新生</span></section>
 <RecentStories key={heroes.map(h=>h.story.id).join('|')} items={heroes} loading={loading} bookName={bookName} onOpen={open}/>
 <button className="yu-new-story-link" onClick={()=>choose()}><Sparkles size={16}/><span>生成我的故事</span><ArrowRight size={16}/></button>
 <section className="yu-section"><div className="yu-section-title"><h2>从一本书开始</h2><span>熟悉的经典，新的相遇</span></div><div className="yu-books">{choices.map((b,i)=><button key={b.id} onClick={()=>choose(b.id)} aria-label={'选择'+b.title}><span className={'yu-book-cover book-'+(i%3)}><span className="yu-book-border"/><small>{b.era} · {b.author}</small><strong className={b.title.length>5?'yu-book-title-long':undefined}>{b.title}</strong><i>{b.genre}</i><span className="yu-book-ornament">{i===0?<Moon size={44} strokeWidth={.7}/>:i===1?<Leaf size={52} strokeWidth={.7}/>:<Feather size={48} strokeWidth={.7}/>}</span></span><strong>{b.title}</strong><small>{b.note}</small></button>)}</div></section>
 <section className="yu-section yu-theme-section"><div className="yu-section-title"><h2>或者，跟着心情走</h2><Sparkles size={17}/></div><div className="yu-moods">{moods.map((m,i)=><button key={m} className={selection.theme===m?'selected':''} onClick={()=>choose(selection.bookId,m)}>{i===0&&<Sparkles size={13}/>} {m}</button>)}</div></section>
 <button className="yu-surprise" onClick={()=>{const b=choices[Math.floor(Math.random()*(choices.length-1))];choose(b.id,moods[Math.floor(Math.random()*(moods.length-1))]);}}><span><Feather size={24}/></span><div><strong>不挑了，给我一个故事</strong><small>让偶然替你翻开第一页</small></div><ArrowRight size={19}/></button>
 <div className="yu-generation-note"><Sparkles size={13}/><p>故事、画面与文字，由 AI 为这一次阅读生成。</p></div>
 {loading?<p className="yu-inline-status" role="status">正在打开书页…</p>:loadError?<div className="yu-inline-status" role="alert">{loadError}<button onClick={()=>location.reload()}>重新加载</button></div>:null}
 </>:tab==='shelf'?<ReaderShelf stories={shelf} pending={pendingStories} sessions={gen.sessions} progress={activeProgress} refreshing={shelfRefreshing||gen.libraryRefreshing} onRefresh={()=>{void refreshShelf();}} loading={loading||gen.libraryLoading} error={loadError||gen.libraryError} tab={shelfTab} onTab={setShelfTab} query={shelfQuery} onQuery={setShelfQuery} grouping={shelfGrouping} onGrouping={setShelfGrouping} bookName={bookName} onOpen={open} onResume={session=>{setStory(null);setPage(session.page);gen.resume(session.id).catch(e=>notify(e.message));}} onRetry={session=>{setStory(null);setPage(session.page);gen.retrySession(session.id).catch(e=>notify(e.message));}} onDelete={askDelete} onFavorite={favoriteFromShelf} favoriteBusy={favoriteBusy} onDiscover={()=>setTab('discover')}/>:<section className="yu-profile"><div className="yu-profile-portrait"><UserRound size={33} strokeWidth={1.2}/></div><h1>留一点时间，给自己。</h1><p>拾趣，随身的一小座故事馆。</p><div className="yu-profile-stats"><div><strong>{shelfCount}</strong><span>书架故事</span></div><div><strong>{favoriteCount}</strong><span>已收藏</span></div></div><div className="yu-preferences"><button onClick={()=>{setRecoveryOpen(true);void loadDeletedStories();}}><Trash2 size={20}/>已删除的故事<ChevronRight size={18}/></button><button onClick={()=>setSettings(true)}><Settings2 size={20}/>阅读偏好<ChevronRight size={18}/></button><a href="/offline.html"><Download size={20}/>离线故事<ChevronRight size={18}/></a><button onClick={async()=>{if(install){await install.prompt();setInstall(null);}else notify('在浏览器的分享或菜单中，选择“添加到主屏幕”。');}}><BookOpen size={20}/>把拾趣放到桌面<ChevronRight size={18}/></button></div><p className="yu-profile-quote">“故事有尽，余味未尽。”</p></section>}
 </main>
 <nav className="yu-tabbar" aria-label="主导航">{[{id:'discover',title:'发现',Icon:Compass},{id:'shelf',title:'书架',Icon:BookOpen},{id:'me',title:'我的',Icon:UserRound}].map(({id,title,Icon})=><button key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);window.scrollTo({top:0,behavior:'instant'});}}><Icon size={22} strokeWidth={tab===id?2:1.6}/><span>{title}</span>{tab===id&&<i/>}</button>)}</nav>
 </>}
 {configure&&<Sheet title="这一篇，想怎样读？" onClose={()=>{suggestions.cancel();setConfigure(false);}}><p className="yu-sheet-intro">先选书和主题，再挑一篇故事。按主题从原文中找故事，已有故事立即显示，新找到的故事先给你，不必等满五篇。换一批会优先复用缓存，再从保存的位置继续。</p><div className="yu-choice-label">从哪本书出发</div><div className="yu-options">{choices.map(b=><button aria-pressed={selection.bookId===b.id} className={selection.bookId===b.id?'selected':''} key={b.id} onClick={()=>{setSelection(s=>({...s,bookId:b.id,storyTitle:undefined,source:undefined}));}}>{b.title}</button>)}</div>{selection.bookId==='other'&&<label className="yu-custom-input">书名或公开网页 URL<input maxLength={500} value={selection.customBook||''} placeholder="例如：三言二拍，或 https://…" onChange={e=>{setSelection(s=>({...s,customBook:e.target.value,storyTitle:undefined,source:undefined}));}}/></label>}<div className="yu-choice-label">想看什么</div><div className="yu-options">{moods.map(m=><button aria-pressed={selection.theme===m} key={m} className={selection.theme===m?'selected':''} onClick={()=>{setSelection(s=>({...s,theme:m,productionPrompt:promptAfterThemeChange(s.productionPrompt,s.theme==='其他'?customTheme:s.theme,m==='其他'?customTheme:m),storyTitle:undefined,source:undefined}));}}>{m}</button>)}</div>{selection.theme==='其他'&&<label className="yu-custom-input">写下想看的主题<input maxLength={100} placeholder="例如：善良的人如何守住底线" value={customTheme} onChange={e=>{const value=e.target.value;setSelection(s=>({...s,productionPrompt:promptAfterThemeChange(s.productionPrompt,customTheme,value),storyTitle:undefined,source:undefined}));setCustomTheme(value);}}/></label>}{suggestions.batches.length===0&&<button className="yu-primary yu-find-stories" disabled={!suggestions.ready} onClick={finding?suggestions.cancel:findStories}>{finding?<><Loader2 size={19} className="spin"/>取消选题</>:'看看有哪些故事'}<ArrowRight size={19}/></button>}
 {finding&&<div className="yu-reading-focus" tabIndex={-1} ref={readingRef}><StoryReadingState book={selection.bookId==='other'?(selection.customBook||'自选书籍'):selectedBook.title} theme={selection.theme==='其他'?customTheme:selection.theme} progress={suggestions.progress} elapsed={suggestions.elapsed} onCancel={suggestions.cancel} hasStories={suggestions.batches.length>0}/></div>}
 {suggestions.batches.length>0&&<div className="yu-candidates" ref={candidateRef} tabIndex={-1}><h3>哪一篇，让你想翻开？</h3><div className="yu-batch-heading"><p className="yu-candidate-count">第 {suggestions.index+1} 批 · {candidates.length} 篇故事</p><button className="yu-refresh-batch" disabled={finding||creating} onClick={findStories}>{finding?<Loader2 size={14} className="spin"/>:<RefreshCw size={14}/>} {finding?'正在找新故事':'找更多故事'}</button></div>{candidateNote&&<p className="yu-choice-footnote" role="status">{candidateNote}</p>}
 <div className="yu-candidate-list">{candidates.map(c=><button key={c.source?localSourceKey(c.source):c.title} aria-pressed={selection.source&&c.source?localSourceKey(selection.source)===localSourceKey(c.source):selection.storyTitle===c.title} className={(selection.source&&c.source?localSourceKey(selection.source)===localSourceKey(c.source):selection.storyTitle===c.title)?'selected':''} disabled={creating} onClick={()=>{setSelection(s=>selectSuggestedStory(s,c));setScrollRequest({target:'styles',stamp:Date.now()});}}><strong>{c.title}</strong><span>{c.description}</span>{c.sourceLabel&&<small>已核对本地出处 · {c.sourceLabel}</small>}</button>)}</div>
 {suggestions.batches.length>1&&<nav className="yu-batch-nav" aria-label="故事推荐批次"><button disabled={suggestions.index===0||creating} onClick={()=>visitBatch(suggestions.index-1)}><ChevronLeft size={16}/>前一批</button><label><span className="sr-only">查看故事批次</span><select aria-label="查看故事批次" value={suggestions.index} disabled={creating} onChange={e=>visitBatch(Number(e.target.value))}>{suggestions.batches.map((_,i)=><option key={i} value={i}>第 {i+1} / {suggestions.batches.length} 批</option>)}</select></label><button disabled={suggestions.index===suggestions.batches.length-1||creating} onClick={()=>visitBatch(suggestions.index+1)}>后一批<ChevronRight size={16}/></button></nav>}</div>}
 {suggestions.error&&<p className="yu-batch-error" role="status">{suggestions.error}</p>}
 {!!selectedCandidate&&<section className="yu-story-preferences" aria-label="阅读方式" ref={styleRef} tabIndex={-1}><StoryNarrativeDetail value={selection.narrativeDetail||'balanced'} disabled={creating} onChange={narrativeDetail=>setSelection(s=>({...s,narrativeDetail,length:'auto'}))}/><h3>为这篇故事搭配画风</h3>{storyArt.busy&&<p className="yu-art-pending" role="status"><Loader2 size={14} className="spin"/>正在为这篇故事推荐画风，也可以直接手动选择。</p>}{storyArt.error&&<p className="yu-art-pending" role="status">画风推荐暂不可用，可以手动选择。<button type="button" onClick={storyArt.retry}>重试推荐</button></p>}{storyArt.recommendation&&<StoryArtRecommendation recommendation={storyArt.recommendation} selected={selection.artStyle} disabled={creating} onApply={()=>setSelection(s=>({...s,artStyle:storyArt.recommendation!.artStyle}))}/>}<fieldset className="yu-style-picker" disabled={creating}><legend className="yu-choice-label">图片样式</legend><div className="yu-style-groups">{artStyleGroups.map(group=><section className="yu-style-group" key={group.label} aria-label={group.label}><h4>{group.label}</h4><div className="yu-style-grid">{group.ids.map(id=>getArtStyle(id)).map(style=><label key={style.id} className={'yu-style-card style-'+style.id+(selection.artStyle===style.id?' selected':'')}><input type="radio" name="art-style" value={style.id} checked={selection.artStyle===style.id} onChange={()=>setSelection(s=>({...s,artStyle:style.id}))}/><span className="yu-style-swatch" aria-hidden="true"><Feather size={25} strokeWidth={1.2}/><i/><i/><i/></span><span className="yu-style-name">{style.label}<Check size={14}/></span><span className="yu-style-description">{style.description}</span></label>)}</div></section>)}</div><p className="yu-style-note">整篇沿用同一画风；3D 与定格生成的是静态画面。</p></fieldset><div className="yu-production-field"><label htmlFor="production-prompt">制作要求</label><p id="production-prompt-help">根据“想看什么”预填，也可以写下你想要的节奏、反转或画面细节。</p><textarea id="production-prompt" aria-describedby="production-prompt-help" rows={5} maxLength={1200} disabled={creating} value={selection.productionPrompt} onChange={e=>setSelection(s=>({...s,productionPrompt:e.target.value}))}/><div className="yu-prompt-actions"><button type="button" disabled={creating} onClick={()=>setSelection(s=>({...s,productionPrompt:defaultProductionPrompt(s.theme==='其他'?customTheme:s.theme)}))}>恢复主题建议</button><span>{selection.productionPrompt.length} / 1200</span></div></div><button className="yu-primary" disabled={creating} onClick={generate}>{creating?<Loader2 size={18} className="spin"/>:<Sparkles size={18}/>} {creating?'正在开启':'推荐画幅数'}<ArrowRight size={19}/></button></section>}<p className="yu-choice-footnote">《{selection.bookId==='other'?(selection.customBook||'自选书籍'):selectedBook.title}》 · {selection.theme==='其他'?(customTheme||'自选主题'):selection.theme}{selectedCandidate?` · ${getArtStyle(selection.artStyle).label} · ${narrativeDetails.find(d=>d.id===(selection.narrativeDetail||'balanced'))?.label}`:''}</p>{unavailable&&<div className="yu-unavailable" role="status"><strong>这次还没能开启故事</strong><p>{unavailable}</p></div>}</Sheet>}
 {gen.active&&!story&&!configure&&<Sheet title={gen.active.story?.title||gen.active.selection.storyTitle||'你的故事，正在展开'} onClose={()=>gen.leave()}>{gen.active.awaitingFrameCount&&gen.active.frameRecommendation?<><StoryFrameCount key={gen.active.id} recommendation={gen.active.frameRecommendation} disabled={gen.busy} onConfirm={gen.confirmFrameCount}/>{gen.error&&<p className="yu-batch-error" role="alert">{gen.error}</p>}<button className="yu-generation-later" onClick={()=>{gen.leave();setTab('shelf');}}>稍后从书架继续</button></>:<StoryGenerationStatus session={gen.active} busy={gen.busy} error={gen.error} onRetry={gen.retryStep} onBack={()=>{gen.leave();setTab('shelf');}}/>}</Sheet>}
 {source&&story&&<Sheet title="故事从哪里来" onClose={()=>setSource(false)}><StorySource key={story.id} story={story} book={bookName(story)}/></Sheet>}
 {recoveryOpen&&<Sheet title="已删除的故事" onClose={()=>{if(!restoring)setRecoveryOpen(false);}}><DeletedStories items={deletedStories} loading={recoveryLoading} error={recoveryError} busy={restoring} onRestore={item=>void restoreStory(item)} onRetry={()=>void loadDeletedStories()}/></Sheet>}
 {undoTarget&&!recoveryOpen&&<div className="yu-undo-notice" role="status"><div><span>已删除《{undoTarget.title}》</span>{recoveryError&&<small role="alert">{recoveryError}</small>}</div><button type="button" disabled={!!restoring} onClick={()=>void restoreStory(undoTarget)}><RotateCcw size={17}/>{restoring?'恢复中…':'撤销删除'}</button><button type="button" className="yu-undo-dismiss" aria-label="关闭撤销提示" disabled={!!restoring} onClick={()=>setUndoTarget(null)}><X size={18}/></button></div>}
 {deleteTarget&&<Sheet title="删除这篇故事？" onClose={()=>{if(!deleting)setDeleteTarget(null);}}><div className="yu-delete-confirm"><h3>{deleteTarget.title}</h3><p>将从首页、书架和收藏中移除。故事文件和阅读进度会保留，可撤销删除，也可在「我的 → 已删除的故事」中恢复。</p>{deleteError&&<p role="alert">{deleteError}</p>}<div><button className="yu-delete-cancel" disabled={deleting} onClick={()=>setDeleteTarget(null)}>保留故事</button><button className="yu-delete-submit" disabled={deleting} onClick={deleteStory}>{deleting?'正在删除…':'删除故事'}</button></div></div></Sheet>}
 {settings&&<Sheet title="舒服地读" onClose={()=>setSettings(false)}><div className="yu-setting-row"><div><strong>大一点的文字</strong><p>让画面上的旁白更容易读</p></div><button className={'yu-switch '+(largeText?'on':'')} role="switch" aria-checked={largeText} aria-label="大一点的文字" onClick={()=>{setLargeText(!largeText);localStorage.setItem('yiyu-large-text',largeText?'0':'1');}}><i/></button></div>{story&&<div className="yu-pdf-setting">{exportControl('pdf','yu-settings-download')}{exportControl('png','yu-settings-download')}<p role="status">{story.pages.some(p=>!p.image)?`画面已完成 ${story.pages.filter(p=>p.image).length} / ${story.pages.length} 幅，全部生成后可导出。`:'PDF 一幅一页；PNG 将全部画面、旁白和余味排成一页总览。'}</p></div>}{story&&<section className="yu-saved-prompt" aria-label="本篇制作要求"><h3>制作要求</h3><p>{isGenerated(story)?(story.productionPrompt||'这篇故事未保存自定义制作要求。'):'这是体验样篇，没有读者自定义的制作要求。'}</p>{isGenerated(story)&&story.productionPrompt&&<small>生成时使用的要求，已随这篇故事保存。</small>}</section>}{story&&<StoryScript story={story}/>}<p className="yu-settings-note">轻点画面左侧边缘返回上一页，右侧边缘进入下一页；鼠标左右键均遵循此规则，中间区域不翻页。总结页左侧返回最后一幅，右侧回到打开故事前的主页或书架。也可滑动、使用滚轮或箭头翻页。</p></Sheet>}
 {toast&&<div className="yu-toast" role="status"><Check size={16}/>{toast}</div>}
 </div></div>;
}
