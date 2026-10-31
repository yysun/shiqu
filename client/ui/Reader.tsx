'use client';
// Coordinate story discovery, resumable generation, and the reading sheets.

import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Bookmark, BookOpen, Check, ChevronLeft, ChevronRight, Compass, Download, Feather, Leaf, Moon, Play, RotateCcw, ImageDown, Settings2, Sparkles, UserRound, X, Loader2, FileDown, FileArchive, RefreshCw, Trash2} from 'lucide-react';
import {randomId, request} from './shared';
import type {Story} from '@/lib/content';
import {historicalBookTitle} from '@/lib/story-book';
import type {GeneratedStory,Selection,SessionView} from '@/lib/reader-model';
import {readerBooks,type ReaderBook} from '@/lib/reader-books';
import {useStoryGeneration} from './useStoryGeneration';
const isGenerated=(s:Story|null):s is GeneratedStory=>!!s&&'generated'in s&&s.generated===true;
import {getArtStyle} from '@/lib/reader-styles';
import StoryRevisionEditor,{StoryRevisionActions} from './StoryRevisionEditor';
import {useStoryRevision} from './useStoryRevision';
import {defaultProductionPrompt,promptAfterThemeChange} from '@/lib/reader-prompts';
import {recentHeroes,mergeReadingProgress,reconcileReadingProgress} from '@/lib/reader-home';
import RecentStories from './RecentStories';
import ReaderShelf from './ReaderShelf';
import type {ShelfGrouping} from '@/lib/shelf-browser';
import DeletedStories,{type DeletedStory} from './DeletedStories';
import StorySource from './StorySource';
import StoryScript from './StoryScript';
import StoryCreationSetup,{storyCreationTitle} from './StoryCreationSetup';
import StoryReviewTools from './StoryReviewTools';
import StoryPausedEditing from './StoryPausedEditing';
import Sheet from './StorySheet';
import StoryFrameCount from './StoryFrameCount';
import {narrativeDetailSchema} from '@/lib/reader-frame-recommendation';
import StoryRetry from './StoryRetry';
import StoryGenerationControl from './StoryGenerationControl';
import StoryGenerationStatus from './StoryGenerationStatus';
import StoryPageSurface from './StoryPageSurface';
import StoryEndingSurface from './StoryEndingSurface';
import ProductionTimeline from './ProductionTimeline';
import {generationProgress,redrawNotice} from '@/lib/generation-progress';
import {productionSteps} from '@/lib/production-stages';
import {newWheelGesture,wheelPageDirection,swipePageDirection} from '@/lib/reader-navigation';
import './reader.css';

type Book = ReaderBook;
type Progress = {storyId:string; page:number; saved?:number; updatedAt?:string|null};
type ExportFormat='pdf'|'png'|'zip';
const exportOptions={
 pdf:{label:'下载 PDF',description:'逐幅阅读',Icon:FileDown},
 png:{label:'下载 PNG',description:'一页总览',Icon:ImageDown},
 zip:{label:'下载 ZIP',description:'分镜 + 原图',Icon:FileArchive},
};
const choices:Book[] = [...readerBooks,{id:'other',title:'其他',author:'书名或 URL',era:'自选',genre:'自选',note:'带上你自己的那本书'}];
const moods:Selection['theme'][] = ['给我一个反转','人情冷暖','放下执念','聪明与糊涂','善意与误解','命运与选择','欲望与代价','勇气与成长','爱情与错过','幽默与讽刺','因果与报应','其他'];


export default function Reader(){
 const [stories,setStories]=useState<Story[]>([]),[books,setBooks]=useState<Book[]>(choices),[progress,setProgress]=useState<Progress[]>([]);
 const authoritativeProgress=useRef<Progress[]>([]);
 const [shelfQuery,setShelfQuery]=useState(''),[shelfGrouping,setShelfGrouping]=useState<ShelfGrouping>('book');
 const [shelfRefreshing,setShelfRefreshing]=useState(false);
 const [tab,setTab]=useState('discover'),[shelfTab,setShelfTab]=useState('recent'),[story,setStory]=useState<Story|null>(null),[page,setPage]=useState(0),[ended,setEnded]=useState(false),[saved,setSaved]=useState(false);
 const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[toast,setToast]=useState(''),[source,setSource]=useState(false),[configure,setConfigure]=useState(false),[unavailable,setUnavailable]=useState(''),[settings,setSettings]=useState(false);
 const [script,setScript]=useState(false),[requirements,setRequirements]=useState(false),[reselectError,setReselectError]=useState('');
 const [selection,setSelection]=useState<Selection>({bookId:'liaozhai',theme:'给我一个反转',artStyle:'ink-pencil',productionPrompt:defaultProductionPrompt('给我一个反转'),length:'auto',narrativeDetail:'balanced',voice:false}),[largeText,setLargeText]=useState(false),[install,setInstall]=useState<any>(null),[motion,setMotion]=useState('forward'),[creating,setCreating]=useState(false);
 const [deletedIds,setDeletedIds]=useState<string[]>([]),[deleteTarget,setDeleteTarget]=useState<{id:string;title:string}|null>(null),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('');
 const [favoriteBusy,setFavoriteBusy]=useState('');
 const [deletedStories,setDeletedStories]=useState<DeletedStory[]>([]),[recoveryOpen,setRecoveryOpen]=useState(false),[recoveryLoading,setRecoveryLoading]=useState(false),[recoveryError,setRecoveryError]=useState(''),[restoring,setRestoring]=useState(''),[undoTarget,setUndoTarget]=useState<DeletedStory|null>(null);
 const restoreLock=useRef(false),recoveryLoad=useRef(0),pendingRestores=useRef(new Map<string,DeletedStory>());
 const favoriteLock=useRef(false);
 const deleted=useRef(new Set<string>());
 const [customTheme,setCustomTheme]=useState('');
 const [exporting,setExporting]=useState<ExportFormat|null>(null),[exportProgress,setExportProgress]=useState(''),[pdfDownload,setPdfDownload]=useState<{url:string;filename:string;storyId:string}|null>(null),[pngDownload,setPngDownload]=useState<{url:string;filename:string;storyId:string}|null>(null),[zipDownload,setZipDownload]=useState<{url:string;filename:string;storyId:string}|null>(null);
 useEffect(()=>()=>{if(pdfDownload)URL.revokeObjectURL(pdfDownload.url);},[pdfDownload]);
 useEffect(()=>()=>{if(pngDownload)URL.revokeObjectURL(pngDownload.url);},[pngDownload]);
 useEffect(()=>()=>{if(zipDownload)URL.revokeObjectURL(zipDownload.url);},[zipDownload]);
 const exportLock=useRef(false),reselectLock=useRef(false);
 const [drag,setDrag]=useState(0),[lastReadId,setLastReadId]=useState('');
 const [metadataVisible,setMetadataVisible]=useState(true);
 useEffect(()=>{setMetadataVisible(true);setReselectError('');},[story?.id]);
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
 // The id stays the same when the first image arrives, so a draft written before it survives.
 const revision=useStoryRevision(story?(isGenerated(story)?story.id:undefined):gen.active&&(!gen.active.intake||gen.active.intake.phase==='confirmed')?gen.active.id:undefined,async next=>{await switchVersion(next.id);});
 async function switchVersion(id:string){
  const previous={story,page,saved,ended,drag,motion,seen:seen.current,session:session.current};setSettings(false);setSource(false);setRequirements(false);setScript(false);revision.setTab(null);setStory(null);setPage(0);setEnded(false);setSaved(false);setDrag(0);setMotion('forward');seen.current=new Set();session.current=randomId();gen.leave();
  try{await gen.resume(id,0,false,true);}catch{setPage(previous.page);setSaved(previous.saved);setEnded(previous.ended);setDrag(previous.drag);setMotion(previous.motion);seen.current=previous.seen;session.current=previous.session;setStory(previous.story);void gen.refreshLibrary().catch(()=>{});notify('这个版本暂时无法打开，已保存的新版可从书架继续。');}
 }
 const visitor=useRef(''),session=useRef(''),seen=useRef(new Set<number>()),noticeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const notify=(text:string)=>{setToast(text);if(noticeTimer.current)clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setToast(''),4000);};
 async function refreshShelf(){
  if(shelfRefreshing)return;setShelfRefreshing(true);
  try{
   const [published,,serverProgress]:[Story[],unknown,Progress[]]=await Promise.all([request('stories'),gen.refreshLibrary(),request('me/progress')]);
   setStories(old=>[...old.filter(s=>isGenerated(s)&&!deleted.current.has(s.id)),...published.filter(s=>!deleted.current.has(s.id))]);
   acceptServerProgress(serverProgress);setLoadError('');
  }catch(error){notify(error instanceof Error?error.message:'书架刷新失败，请重试。');}
  finally{setShelfRefreshing(false);}
 }

 function track(kind:string,s:Story|null=story,index:number|null=null){if(!s||!visitor.current||!session.current)return;request(isGenerated(s)?'reader/sessions/'+s.id+'/events':'events','POST',{id:session.current+':'+s.id+':'+kind+(index===null?'':':'+index),visitor:visitor.current,session:session.current,storyId:s.id,kind,page:index,mode:'manual',cohort:'internal'}).catch(()=>{});}
 function remember(s:Story,index:number,isSaved:boolean){if(deleted.current.has(s.id))return;authoritativeProgress.current=reconcileReadingProgress(authoritativeProgress.current,[{storyId:s.id,page:index,saved:isSaved?1:0,updatedAt:new Date().toISOString()}]);setLastReadId(s.id);try{localStorage.setItem('shiqu-last-read',s.id);}catch{}setProgress(pr=>{const rows=[{storyId:s.id,page:index,saved:isSaved?1:0,updatedAt:new Date().toISOString()},...pr.filter(p=>p.storyId!==s.id)];localStorage.setItem('yiyu-reading',JSON.stringify(rows));return rows;});request(isGenerated(s)?'reader/sessions/'+s.id+'/progress':'me/progress','POST',{storyId:s.id,page:index,saved:isSaved}).catch(()=>{});}
 function open(s:Story,restart=false){if(deleted.current.has(s.id))return;setDrag(0);if(isGenerated(s))gen.resume(s.id,restart?0:undefined).catch(e=>notify(e.message));else gen.leave();setConfigure(false);setUnavailable('');const pr=progress.find(p=>p.storyId===s.id);const index=restart?0:Math.min(pr?.page||0,s.pages.length-1);setPage(index);setStory(s);setSaved(!!pr?.saved);setEnded(false);setMotion('forward');seen.current=new Set();session.current=randomId();history.replaceState(null,'','/read?id='+encodeURIComponent(s.id));track('start',s);window.scrollTo(0,0);}
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


 async function exportStory(format:ExportFormat){
  if(!story||exportLock.current)return;
  exportLock.current=true;setExporting(format);setExportProgress('正在准备'+format.toUpperCase());
  try{
   if(format==='zip'){
    const {downloadStoryZip}=await import('@/lib/reader-zip');
    const result=await downloadStoryZip(story,setExportProgress);setZipDownload({...result,storyId:story.id});
    notify('ZIP 已准备好，包含分镜和全部原图。');
   }else if(format==='png'){
    const {downloadStoryPng}=await import('@/lib/reader-png');
    const result=await downloadStoryPng(story,setExportProgress);setPngDownload({...result,storyId:story.id});
    notify('一页 PNG 已准备好，可再次下载。');
   }else{
    const {downloadStoryPdf}=await import('@/lib/reader-pdf');
    const result=await downloadStoryPdf(story,setExportProgress);setPdfDownload({...result,storyId:story.id});
    notify('PDF 已准备好，可再次下载。');
   }
  }catch(e){notify(e instanceof Error?e.message:'导出失败，请保持联网后重试。');}
  finally{exportLock.current=false;setExporting(null);setExportProgress('');}
 }
 async function generate(){
  if(creating)return;const theme=selection.theme==='其他'?customTheme:selection.theme;
  if(!theme.trim()||(selection.bookId==='other'&&!selection.customBook?.trim())){setUnavailable('请填写书名和主题。');return;}
  setCreating(true);setUnavailable('');
  try{gen.leave();session.current=randomId();seen.current=new Set();setPage(0);setSaved(false);setStory(null);setEnded(false);await gen.start({...selection,storyTitle:undefined,source:undefined,length:'auto',narrativeDetail:selection.narrativeDetail||'balanced',voice:false,theme},true);setConfigure(false);}
  catch(e){setUnavailable(e instanceof Error?e.message:'任务暂未保存，请重试。');}finally{setCreating(false);}
 }

 async function reselectStory(){
  const originId=story&&isGenerated(story)?story.id:gen.active?.id;
  if(!originId||reselectLock.current||creating||revision.busy)return;reselectLock.current=true;setCreating(true);setReselectError('');
  try{
   const original:SessionView=await request('reader/sessions/'+originId);
   // The original stays on screen and keeps its reading state until the new task is durable.
   await gen.start({...original.selection,storyTitle:undefined,source:undefined,length:'auto',voice:false},true);
   setStory(null);setSettings(false);setSource(false);setRequirements(false);setScript(false);revision.setTab(null);
   setPage(0);setSaved(false);setEnded(false);setDrag(0);setMotion('forward');seen.current=new Set();session.current=randomId();
  }catch(e){setReselectError(e instanceof Error?e.message:'新的选题任务暂未保存，原故事保持不变。');}
  finally{reselectLock.current=false;setCreating(false);}
 }

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
  const download=format==='zip'?zipDownload:format==='png'?pngDownload:pdfDownload,{label,description,Icon}=exportOptions[format];
  const busy=exporting===format;
  const content=<>{busy?<Loader2 size={20} className="spin"/>:<Icon size={20}/>}<span>{busy?(format==='zip'?'打包中…':'导出中…'):label}<small>{description}</small></span></>;
  return download?.storyId===story.id?<a className={className} href={download.url} download={download.filename}>{content}</a>:<button className={className} aria-busy={busy} disabled={!!exporting||!story.pages.length||story.pages.some(p=>!p.image)} onClick={()=>exportStory(format)}>{content}</button>;
 }
 function exportStatus(showReadiness=true){
  if(!story)return null;
  return <p className="yu-export-status" role="status">{exportProgress||(showReadiness&&story.pages.some(p=>!p.image)?`画面已完成 ${story.pages.filter(p=>p.image).length} / ${story.pages.length} 幅，全部生成后可下载。`:'')}</p>;
 }
 // Session lists contain only the newest submission; cached artwork must not resurrect older editions.
 const latestIds=new Set(gen.sessions.map(session=>session.id));
 const allStories=[...stories.filter(s=>!isGenerated(s)),...gen.sessions.flatMap(s=>s.story?[s.story]:[])].filter(s=>!deletedIds.includes(s.id));
 const heroes=recentHeroes(allStories,deletedIds.includes(lastReadId)?'':lastReadId,progress.filter(p=>!deletedIds.includes(p.storyId)));
 const bookName=(s:Pick<Story,'id'|'bookId'>)=>(s.bookId==='other'?gen.sessions.find(session=>session.id===s.id)?.selection.customBook:'')||books.find(b=>b.id===s.bookId)?.title||historicalBookTitle(s.bookId)||s.bookId;
 const current=story?.pages[page],selectedBook=books.find(b=>b.id===selection.bookId)||choices[0];
 const activeProgress=mergeReadingProgress(progress,gen.sessions.map(s=>({storyId:s.id,page:s.page,saved:s.saved?1:0,updatedAt:s.lastReadAt||s.createdAt}))).filter(p=>!deletedIds.includes(p.storyId)&&(!stories.some(s=>s.id===p.storyId&&isGenerated(s))||latestIds.has(p.storyId)));
 const readingSession=story?(gen.active?.id===story.id?gen.active:gen.sessions.find(session=>session.id===story.id)):undefined;
 const readingProduction=readingSession?generationProgress(readingSession,Date.now()):null;
 const scriptStory=story||gen.active?.story||null;
 const readingSteps=story?(readingProduction?.steps??productionSteps({planReady:true,sourceReady:!!story.sourceText,frameCountConfirmed:true,total:story.pages.length,ready:story.pages.filter(page=>!!page.image).length,activeState:'paused'})).map(step=>step.id==='source'?{...step,label:'原文与制作要求',detail:`画风：${isGenerated(story)?(story.artStyleLabel||'未记录画风'):'未记录画风'}`}:step):[];
 const pendingStories=gen.sessions.filter(s=>!deletedIds.includes(s.id)&&!s.story?.pages[0]?.image);
 const shelf=activeProgress.flatMap(p=>{const s=allStories.find(s=>s.id===p.storyId);return s&&s.pages[0]?.image?[s]:[];});

 const shelfCount=shelf.length+pendingStories.length;
 const progressById=new Map(activeProgress.map(p=>[p.storyId,p]));
 const favoriteCount=shelf.filter(s=>progressById.get(s.id)?.saved).length+pendingStories.filter(s=>progressById.get(s.id)?.saved??s.saved).length;

 return <div className={'yu-world'+(story?' yu-reading-world':'')}><div className={'yu-app'+(story?' yu-immersive':'')}>
 {story?<main className={'yu-reader'+(!metadataVisible&&!ended?' yu-metadata-hidden':'')} ref={readerRef} aria-label={'阅读'+story.title}>
 {!ended&&<div className="yu-filmstrip" style={{transform:`translateX(calc(${-page*100}% + ${drag}px))`,transition:drag?'none':undefined}}>{story.pages.map((p,i)=><div className="yu-film-frame" key={i}>{p.image&&<img className={'yu-scene '+(i===page?'is-current':'')} src={p.image} alt={i===page?p.caption:''} draggable={false}/>}</div>)}</div>}
 {ended&&<div className="yu-scene-shade"/>}
 {!!readingSession?.reviewIssues?.length&&!settings&&<button type="button" className="yu-reader-review-notice" onClick={()=>setSettings(true)}>审片还有 {readingSession.reviewIssues.length} 处问题，已停止绘图。查看并处理</button>}
 {!ended&&!current?.image&&<div className="yu-drawing" role="status"><div className="yu-drawing-orbit"><Feather size={35} strokeWidth={1}/></div><span>{gen.error?'画笔暂停了一下':'这一幅，正在展开'}</span><small>{gen.error||gen.active?.stage||'正在为你绘制画面'}</small>{gen.error&&gen.active&&<StoryRetry session={gen.active} busy={gen.busy} onRetry={gen.retryStep}/>}</div>}
 <header className="yu-reader-top"><div className="yu-progress" aria-label={`第${page+1}幅，共${story.pages.length}幅`}>{story.pages.map((_,i)=><span key={i} className={i<=page?'read':''}/>)}</div><div className="yu-reader-heading"><button className="yu-glass" onClick={home} aria-label="返回发现"><ArrowLeft size={21}/></button><div><strong>{story.title}</strong><span>{bookName(story)}</span></div><button className="yu-glass" onClick={bookmark} aria-label={saved?'取消收藏':'收藏故事'}><Bookmark size={20} fill={saved?'currentColor':'none'}/></button><button className="yu-glass" onClick={()=>setSettings(true)} aria-label="阅读偏好"><Settings2 size={19}/></button></div></header>
 {ended?<StoryEndingSurface surfaceRef={endingRef} onTurn={turn} onDrag={setDrag} drag={drag}><div className="yu-ending-mark"><Leaf size={32} strokeWidth={1.3}/></div><p className="yu-kicker">故事到这里，余味留给你</p><h1>{story.reflection}</h1><div className="yu-end-line"/><p>有些故事的最后一页，<br/>其实在你的生活里。</p><button className="yu-primary" onClick={()=>open(story,true)}><RotateCcw size={18}/>从头再看<ArrowRight size={19}/></button><div className="yu-ending-navigation"><button onClick={()=>turn(-1)}><ChevronLeft size={17}/>返回上一幅</button><button onClick={()=>{home();setTab('shelf');window.scrollTo({top:0,behavior:'instant'});}}><BookOpen size={16}/>书架</button><button onClick={()=>{home();choose();}}><Sparkles size={16}/>开启下一篇</button></div><section className="yu-ending-downloads" aria-label="下载故事"><h2>把故事带走</h2><div className="yu-ending-formats">{exportControl('pdf','yu-ending-download')}{exportControl('png','yu-ending-download')}{exportControl('zip','yu-ending-download yu-download-zip')}</div>{exportStatus()}</section><button className="yu-end-source" onClick={()=>setSource(true)}>读一读原文 <ChevronRight size={13}/></button></StoryEndingSurface>:<>
 <StoryPageSurface onTurn={turn} onDrag={setDrag} onToggleMetadata={()=>setMetadataVisible(visible=>!visible)}/>
 <div className={'yu-scene-caption '+(largeText?'large':'')} key={'caption-'+page}><div className="yu-scene-number"><span>{String(page+1).padStart(2,'0')}</span><i/><span>{String(story.pages.length).padStart(2,'0')}</span>{isGenerated(story)&&gen.busy&&<span className="yu-scene-generation" role="status"><Loader2 size={12} className="spin"/>{gen.active?.stage||'正在生成'}</span>}</div><p>{current?.caption}</p>{gen.error&&current?.image&&<div className="yu-reader-error">{gen.error}{gen.active&&<StoryRetry session={gen.active} busy={gen.busy} onRetry={gen.retryStep}/>}</div>}</div>
 <footer className="yu-reader-bottom"><button className="yu-source-button" onClick={()=>setSource(true)}><BookOpen size={17}/><span>原文</span></button><span className="yu-style-label" aria-label="本篇主题与画风"><Feather size={17} aria-hidden="true"/><span>{story.theme&&`${story.theme} · `}{isGenerated(story)?(story.artStyleLabel||'未记录画风'):'未记录画风'}</span></span><div className="yu-arrows"><button className="yu-reader-restart" onClick={()=>open(story,true)}>从头看</button><button className="yu-glass" onClick={()=>page===0?home():turn(-1)} aria-label={page===0?'返回主页':'上一幅'}><ChevronLeft size={22}/></button><button className="yu-next" onClick={()=>turn(1)} aria-label={page===story.pages.length-1?'读完，回味':'下一幅'}>{page===story.pages.length-1?<Leaf size={20}/>:<ChevronRight size={23}/>}</button></div></footer>
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
 </>:tab==='shelf'?<ReaderShelf onControl={gen.control} controlBusy={gen.controlBusy} stories={shelf} pending={pendingStories} sessions={gen.sessions} progress={activeProgress} refreshing={shelfRefreshing||gen.libraryRefreshing} onRefresh={()=>{void refreshShelf();}} loading={loading||gen.libraryLoading} error={loadError||gen.libraryError} tab={shelfTab} onTab={setShelfTab} query={shelfQuery} onQuery={setShelfQuery} grouping={shelfGrouping} onGrouping={setShelfGrouping} bookName={bookName} onOpen={open} onResume={session=>{setStory(null);setPage(session.page);gen.resume(session.id).catch(e=>notify(e.message));}} onRetry={session=>{setStory(null);setPage(session.page);gen.retrySession(session.id).catch(e=>notify(e.message));}} onDelete={askDelete} onFavorite={favoriteFromShelf} favoriteBusy={favoriteBusy} onDiscover={()=>setTab('discover')}/>:<section className="yu-profile"><div className="yu-profile-portrait"><UserRound size={33} strokeWidth={1.2}/></div><h1>留一点时间，给自己。</h1><p>拾趣，随身的一小座故事馆。</p><div className="yu-profile-stats"><div><strong>{shelfCount}</strong><span>书架故事</span></div><div><strong>{favoriteCount}</strong><span>已收藏</span></div></div><div className="yu-preferences"><button onClick={()=>{setRecoveryOpen(true);void loadDeletedStories();}}><Trash2 size={20}/>已删除的故事<ChevronRight size={18}/></button><button onClick={()=>setSettings(true)}><Settings2 size={20}/>阅读偏好<ChevronRight size={18}/></button><a href="/offline.html"><Download size={20}/>离线故事<ChevronRight size={18}/></a><button onClick={async()=>{if(install){await install.prompt();setInstall(null);}else notify('在浏览器的分享或菜单中，选择“添加到主屏幕”。');}}><BookOpen size={20}/>把拾趣放到桌面<ChevronRight size={18}/></button></div><p className="yu-profile-quote">“故事有尽，余味未尽。”</p></section>}
 </main>
 <nav className="yu-tabbar" aria-label="主导航">{[{id:'discover',title:'发现',Icon:Compass},{id:'shelf',title:'书架',Icon:BookOpen},{id:'me',title:'我的',Icon:UserRound}].map(({id,title,Icon})=><button key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);window.scrollTo({top:0,behavior:'instant'});}}><Icon size={22} strokeWidth={tab===id?2:1.6}/><span>{title}</span>{tab===id&&<i/>}</button>)}</nav>
 </>}
 {configure&&<Sheet title="这一篇，想怎样读？" busy={creating} onClose={()=>setConfigure(false)}><p className="yu-sheet-intro">选一本书，一种心情。加入队列后选择故事。</p><div className="yu-choice-label">从哪本书出发</div><div className="yu-options">{choices.map(b=><button aria-pressed={selection.bookId===b.id} className={selection.bookId===b.id?'selected':''} key={b.id} onClick={()=>{setSelection(s=>({...s,bookId:b.id,storyTitle:undefined,source:undefined}));}}>{b.title}</button>)}</div>{selection.bookId==='other'&&<label className="yu-custom-input">书名或公开网页 URL<input maxLength={500} value={selection.customBook||''} placeholder="例如：三言二拍，或 https://…" onChange={e=>{setSelection(s=>({...s,customBook:e.target.value,storyTitle:undefined,source:undefined}));}}/></label>}<div className="yu-choice-label">想看什么</div><div className="yu-options">{moods.map(m=><button aria-pressed={selection.theme===m} key={m} className={selection.theme===m?'selected':''} onClick={()=>{setSelection(s=>({...s,theme:m,productionPrompt:promptAfterThemeChange(s.productionPrompt,s.theme==='其他'?customTheme:s.theme,m==='其他'?customTheme:m),storyTitle:undefined,source:undefined}));}}>{m}</button>)}</div>{selection.theme==='其他'&&<label className="yu-custom-input">写下想看的主题<input maxLength={100} placeholder="例如：善良的人如何守住底线" value={customTheme} onChange={e=>{const value=e.target.value;setSelection(s=>({...s,productionPrompt:promptAfterThemeChange(s.productionPrompt,customTheme,value),storyTitle:undefined,source:undefined}));setCustomTheme(value);}}/></label>}<button className="yu-primary" disabled={creating} onClick={()=>void generate()}>{creating?'正在保存任务…':'加入队列并找故事'}<ArrowRight size={19}/></button><p className="yu-choice-footnote">《{selection.bookId==='other'?(selection.customBook||'自选书籍'):selectedBook.title}》 · {selection.theme==='其他'?customTheme:selection.theme}</p>{unavailable&&<div className="yu-unavailable" role="alert"><strong>任务暂未保存</strong><p>{unavailable}</p></div>}</Sheet>}

 {gen.active&&!story&&!configure&&<Sheet title={storyCreationTitle(gen.active)} busy={gen.setupBusy} onClose={()=>gen.leave()}>{gen.active.intake&&gen.active.intake.phase!=='confirmed'?<><StoryCreationSetup session={gen.active} book={bookName({id:gen.active.id,bookId:gen.active.selection.bookId})} busy={gen.setupBusy} onAction={gen.setup} progress={{busy:gen.busy,controlBusy:!!gen.controlBusy,onControl:gen.control,error:gen.error,onRetry:gen.retryStep,onBack:()=>{gen.leave();setTab('shelf');}}}/></>:gen.active.awaitingFrameCount&&gen.active.frameRecommendation?<><StoryFrameCount key={gen.active.id} recommendation={gen.active.frameRecommendation} disabled={gen.busy} onConfirm={gen.confirmFrameCount}/>{gen.error&&<p className="yu-batch-error" role="alert">{gen.error}</p>}<button className="yu-generation-later" onClick={()=>{gen.leave();setTab('shelf');}}>稍后从书架继续</button></>:<StoryGenerationStatus session={gen.active} busy={gen.busy} controlBusy={!!gen.controlBusy} onControl={gen.control} error={gen.error} onRetry={gen.retryStep} onBack={()=>{gen.leave();setTab('shelf');}}><StoryPausedEditing session={gen.active} busy={creating||revision.busy||!!gen.controlBusy} onEdit={revision.open} onReselect={()=>void reselectStory()}/>{reselectError&&<p className="yu-batch-error" role="alert">{reselectError}</p>}<StoryReviewTools session={gen.active} busy={gen.busy||!!gen.controlBusy} error={gen.controlError} onScript={()=>setScript(true)} onEdit={()=>revision.open('script')} onDrawAnyway={()=>void gen.drawAnyway(gen.active!.id)}/></StoryGenerationStatus>}</Sheet>}
 {source&&story&&<Sheet title="故事从哪里来" onClose={()=>setSource(false)}><StorySource key={story.id} story={story} book={bookName(story)}/></Sheet>}
 {script&&scriptStory&&<Sheet title="分镜剧本" onClose={()=>setScript(false)}>{isGenerated(scriptStory)&&<button type="button" className="yu-revision-open" onClick={()=>revision.open('script')}>修改分镜</button>}<StoryScript story={scriptStory} standalone/></Sheet>}
 {requirements&&story&&<Sheet title="制作要求" onClose={()=>setRequirements(false)}>{isGenerated(story)&&<button type="button" className="yu-revision-open" onClick={()=>revision.open('requirements')}>修改制作要求</button>}<section className="yu-saved-prompt" aria-label="本篇制作要求"><h3>{story.title}</h3><p>{isGenerated(story)?(story.productionPrompt||'这篇故事未保存自定义制作要求。'):'这是体验样篇，没有读者自定义的制作要求。'}</p>{isGenerated(story)&&story.productionPrompt&&<small>生成时使用的要求，已随这篇故事保存。</small>}</section></Sheet>}
 {recoveryOpen&&<Sheet title="已删除的故事" onClose={()=>{if(!restoring)setRecoveryOpen(false);}}><DeletedStories items={deletedStories} loading={recoveryLoading} error={recoveryError} busy={restoring} onRestore={item=>void restoreStory(item)} onRetry={()=>void loadDeletedStories()}/></Sheet>}
 {undoTarget&&!recoveryOpen&&<div className="yu-undo-notice" role="status"><div><span>已删除《{undoTarget.title}》</span>{recoveryError&&<small role="alert">{recoveryError}</small>}</div><button type="button" disabled={!!restoring} onClick={()=>void restoreStory(undoTarget)}><RotateCcw size={17}/>{restoring?'恢复中…':'撤销删除'}</button><button type="button" className="yu-undo-dismiss" aria-label="关闭撤销提示" disabled={!!restoring} onClick={()=>setUndoTarget(null)}><X size={18}/></button></div>}
 {deleteTarget&&<Sheet title="删除这篇故事？" onClose={()=>{if(!deleting)setDeleteTarget(null);}}><div className="yu-delete-confirm"><h3>{deleteTarget.title}</h3><p>将从首页、书架和收藏中移除。故事文件和阅读进度会保留，可撤销删除，也可在「我的 → 已删除的故事」中恢复。</p>{deleteError&&<p role="alert">{deleteError}</p>}<div><button className="yu-delete-cancel" disabled={deleting} onClick={()=>setDeleteTarget(null)}>保留故事</button><button className="yu-delete-submit" disabled={deleting} onClick={deleteStory}>{deleting?'正在删除…':'删除故事'}</button></div></div></Sheet>}
 {gen.controlError&&<div className="yu-toast" role="alert">{gen.controlError}</div>}
 {settings&&<Sheet title="舒服地读" busy={revision.busy||creating} onClose={()=>setSettings(false)}><fieldset className="yu-revision-fields" disabled={creating}><div className="yu-setting-row"><div><strong>大一点的文字</strong><p>让画面上的旁白更容易读</p></div><button className={'yu-switch '+(largeText?'on':'')} role="switch" aria-checked={largeText} aria-label="大一点的文字" onClick={()=>{setLargeText(!largeText);localStorage.setItem('yiyu-large-text',largeText?'0':'1');}}><i/></button></div>{story&&<><div className="yu-pdf-setting"><div className="yu-settings-formats" aria-label="下载故事">{exportControl('pdf','yu-settings-download')}{exportControl('png','yu-settings-download')}{exportControl('zip','yu-settings-download')}</div>{exportStatus(false)}{story.pages.some(p=>!p.image)&&<p className="yu-settings-export-readiness" role="status">画面已完成 {story.pages.filter(p=>p.image).length} / {story.pages.length} 幅，全部生成后可导出。</p>}</div><section className="yu-settings-flow" aria-label="本篇制作流程"><div className="yu-batch-heading"><h3>制作流程</h3>{isGenerated(story)&&<button type="button" className="yu-revision-open" title="沿用书籍和主题另建故事，原故事保留" onClick={()=>void reselectStory()}>{creating?'正在创建…':'重新选择故事'}</button>}</div>{readingSession?.revision?.redraw&&<p className="yu-revision-note" role="status">{redrawNotice(readingSession.revision.redraw)}</p>}{readingSession&&<StoryReviewTools session={readingSession} busy={gen.busy||!!gen.controlBusy} error={gen.controlError} onScript={()=>setScript(true)} onEdit={()=>revision.open('script')} onDrawAnyway={()=>void gen.drawAnyway(readingSession.id)}/>}{reselectError&&<p className="yu-batch-error" role="alert">{reselectError}</p>}<ProductionTimeline stages={readingSteps} moving={readingProduction?.running} queued={readingProduction?.queued} actions={{plan:{label:'查看剧本',onClick:()=>setScript(true)},...(isGenerated(story)?{count:{label:'修改画幅数',onClick:()=>revision.open('count')}}:{})}} detailActions={isGenerated(story)?{source:{label:'修改画风',onClick:()=>revision.open('style')}}:undefined} links={{source:[{label:'原文',onClick:()=>setSource(true)},{label:'制作要求',onClick:()=>isGenerated(story)?revision.open('requirements'):setRequirements(true)}]}}/>{readingSession&&<StoryGenerationControl session={readingSession} busy={!!gen.controlBusy} onControl={gen.control}/>}</section>{revision.impact?.changed&&<StoryRevisionActions editor={revision}/>}</>}</fieldset></Sheet>}
 {revision.tab&&<Sheet title="修改故事" busy={revision.busy} onClose={()=>{if(!revision.busy)revision.setTab(null);}}><StoryRevisionEditor editor={revision}/></Sheet>}
 {toast&&<div className="yu-toast" role="status"><Check size={16}/>{toast}</div>}
 </div></div>;
}
