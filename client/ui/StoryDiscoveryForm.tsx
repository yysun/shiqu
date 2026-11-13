// 三种检索共用选书页。提交只带当前方式的条件。
import {useEffect,useRef,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import type {Selection} from '@/lib/reader-model';
import type {LocalSourceReference} from '@/lib/reader-local-contract';
import {localSourceKey} from '@/lib/reader-source-key';
import type {BookContentEntry} from '@/lib/reader-contents';
import {discoveryThemePresets,promptAfterThemeChange} from '@/lib/reader-prompts';
import StoryChapterPicker from './StoryChapterPicker';
import {useRetainedState} from './useRetainedState';
import {readStorySearchStream} from './readStorySearchStream';
import './story-discovery.css';

export const discoveryThemes=[...discoveryThemePresets,'其他'];
const modes=[['chapter','按章节'],['story','按故事'],['theme','按主题']] as const;
type Mode=typeof modes[number][0];
type Choice={title:string;description:string;source:LocalSourceReference};
type Extraction={key:string;entries:BookContentEntry[];note:string};
function toggle<T>(values:T[],item:T,source:(item:T)=>LocalSourceReference){
 const key=localSourceKey(source(item));
 return values.some(value=>localSourceKey(source(value))===key)
  ?values.filter(value=>localSourceKey(source(value))!==key):values.length<24?[...values,item]:values;
}

export default function StoryDiscoveryForm({selection,books,semanticIndexBooks,busy,error,onBookChange,onSubmit,retainKey}:{selection:Selection;books:{id:string;title:string}[];semanticIndexBooks?:readonly {id:string}[];busy:boolean;error:string;onBookChange:(bookId:string)=>void;onSubmit:(selection:Selection)=>Promise<void>;retainKey?:string}){
 const part=(name:string)=>retainKey&&retainKey+':'+name;
 const originalTitle=selection.discovery?.mode==='title'?selection.discovery.title:'';
 const originalSources=selection.discoverySources||[];
 const savedPlot=selection.discovery?.mode==='auto'&&selection.discovery.plot;
 const savedTheme=selection.discovery?.mode==='auto'&&(selection.discovery.scanOnly||selection.discovery.vectorFirst)&&!savedPlot;
 const initialMode:Mode=originalTitle||savedPlot||savedTheme||!originalSources.length?'theme':'chapter';
 const initialTheme=originalTitle||(selection.theme==='原典故事'||selection.theme==='其他'?'':selection.theme);
 const initialPreset=selection.discovery?.mode==='auto'&&selection.discovery.themeInput==='custom'
  ?undefined:discoveryThemePresets.find(value=>value===initialTheme);
 const [bookId,setBookId]=useRetainedState(part('book'),selection.bookId);
 const [customBook,setCustomBook]=useRetainedState(part('custom-book'),selection.customBook||'');
 const [mode,setMode]=useRetainedState<Mode>(part('mode'),initialMode);
 const [sources,setSources]=useRetainedState(part('sources'),initialMode==='chapter'?originalSources:[]);
 const [storyQuery,setStoryQuery]=useRetainedState(part('story-query'),'');
 const [stories,setStories]=useRetainedState<Choice[]>(part('stories'),[]);
 const [chapterStories,setChapterStories]=useRetainedState<Choice[]>(part('chapter-stories'),[]);
 const [chapterTotal,setChapterTotal]=useState<number|null>(null);
 const [extraction,setExtraction]=useRetainedState<Extraction|null>(part('extraction'),null);
 const [extractedChoices,setExtractedChoices]=useRetainedState<Choice[]>(part('extracted-choices'),[]);
 const [searchProgress,setSearchProgress]=useState(''),[searchError,setSearchError]=useState('');
 const search=useRef<AbortController|null>(null);
 useEffect(()=>()=>{search.current?.abort();search.current=null;},[]);
 const [preset,setPreset]=useRetainedState<string|null>(part('theme-preset'),initialPreset??null);
 const [customTheme,setCustomTheme]=useRetainedState(part('custom-theme'),initialPreset?'':initialTheme);
 const [showCustom,setShowCustom]=useRetainedState(part('show-custom-theme'),!initialPreset&&(!!initialTheme||selection.theme==='其他'));
 const theme=showCustom?customTheme.trim():preset||'';
 const [opened]=useRetainedState(part('opened'),()=>JSON.stringify([bookId,customBook,mode,sources,preset,customTheme,showCustom]));
 const local=bookId!=='other';
 const active=local&&(mode==='chapter'||mode==='story')?mode:'theme';
 const dirty=JSON.stringify([bookId,customBook,mode,sources,preset,customTheme,showCustom])!==opened
  ||!!(storyQuery||stories.length||chapterStories.length||extraction);

 const searchKey=JSON.stringify([bookId,theme,showCustom]);
 const results=extraction?.key===searchKey?extraction:null;
 const searching=!!searchProgress;
 const blocked=busy||searching;
 const singleChapter=active==='chapter'&&sources.length===1?sources[0]:undefined;
 const cards=active==='story'?stories:active==='theme'&&results?extractedChoices:active==='chapter'?chapterStories:[];
 const directCard=cards.length===1?cards[0]:undefined;
 const directChapter=singleChapter&&chapterTotal===0?singleChapter:undefined;
 const selectedSources=cards.length?cards.map(card=>card.source):active==='chapter'&&sources.length>1?sources:[];
 const directSource=directCard?.source||directChapter;
 const invalid=local?!directSource&&!selectedSources.length:!theme||!customBook.trim();

 function changeBook(next:string){
  if(next===bookId)return;
  setBookId(next);setSources([]);setStories([]);setStoryQuery('');
  setChapterStories([]);setChapterTotal(null);resetSearch();
  onBookChange(next);
 }
 function selectChapter({source}:BookContentEntry){
  if(!source)return;
  setSources(old=>toggle(old,source,value=>value));
  setChapterStories([]);setChapterTotal(null);
 }
 function selectStory(entry:BookContentEntry,setChoices:typeof setStories){
  if(!entry.source)return;
  const choice={title:entry.title,description:entry.excerpt||entry.title,source:entry.source};
  setChoices(old=>toggle(old,choice,value=>value.source));
 }
 function resetSearch(){
  setExtraction(null);setExtractedChoices([]);setSearchError('');
 }
 function input():Selection{
  const topic=active==='theme'?theme:'原典故事';
  return {...selection,bookId,customBook:local?undefined:customBook.trim(),theme:topic,
   productionPrompt:promptAfterThemeChange(selection.productionPrompt,selection.theme,topic),
   storyTitle:undefined,source:undefined,sourceCard:undefined,discoverySources:undefined,discovery:undefined,length:'auto',voice:false};
 }
 async function extract(scan=false){
  if(!local||!theme||busy||search.current)return;
  const controller=new AbortController();
  search.current=controller;
  setSearchError('');setSearchProgress('正在查找故事…');
  try{
   const selection={...input(),discovery:{mode:'auto',...(scan?{scanOnly:true}:{vectorFirst:true}),themeInput:showCustom?'custom':'preset'}};
   const response=await fetch('/api/reader/suggestions',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},
    signal:controller.signal,body:JSON.stringify({...selection,excludeSources:results?.entries.slice(-200).flatMap(entry=>entry.source?[entry.source]:[])})});
   let received=false;
   await readStorySearchStream(response,event=>{
    if(event.type==='error')throw Error(event.error);
    if(event.type==='progress'){
     const p=event.progress;
     setSearchProgress(p?.stage==='verifying'?'正在核对候选…':p?.totalChars
      ?`正在阅读原文 · ${p.completedChars.toLocaleString()} / ${p.totalChars.toLocaleString()} 字`:'正在查找故事…');
    }
    if(event.type==='result'){
     const entries=new Map((results?.entries||[]).map(entry=>[entry.id,entry]));
     for(const story of event.batch.stories as Choice[]){
      if(!story.source)continue;
      const id=localSourceKey(story.source);
      entries.set(id,{id,title:story.title,excerpt:story.description,source:story.source,kind:'story',chapter:''});
     }
     setExtraction({key:searchKey,entries:[...entries.values()],note:event.batch.note});
     received=true;
    }
   });
   if(!received)throw Error('检索未完成，请重试。');
  }catch(error){
   if(!controller.signal.aborted)setSearchError(error instanceof Error?error.message:'检索暂时失败，请重试。');
  }finally{
   if(search.current===controller){search.current=null;setSearchProgress('');}
  }
 }
 async function submit(){
  if(blocked||invalid)return;
  await onSubmit({...input(),
   source:directSource,
   sourceCard:directCard?{title:directCard.title,description:directCard.description}:undefined,
   discoverySources:selectedSources.length>1?selectedSources:undefined,
   discovery:local?directSource?undefined:{mode:'auto',combine:true}:{mode:'auto'},
  });
 }

 return <>
  <span hidden data-dirty={dirty?'true':undefined}/>
  <h2 className="yu-discovery-heading">从哪本书出发</h2>
  <div className="yu-options" role="group" aria-label="选择书籍">
   {books.map(book=><button type="button" key={book.id} disabled={blocked} aria-pressed={bookId===book.id}
    className={bookId===book.id?'selected':''} onClick={()=>changeBook(book.id)}>
    {semanticIndexBooks?.some(index=>index.id===book.id)?<strong>{book.title}</strong>:book.title}
   </button>)}
  </div>
  {!local&&<label className="yu-custom-input">书名或公开网页 URL<input disabled={blocked} maxLength={500} value={customBook} onChange={event=>setCustomBook(event.target.value)}/></label>}
  <div className="yu-discovery-mode-row">
   <h2 className="yu-discovery-heading">检索方式</h2>
   <div className="yu-discovery-modes" role="group" aria-label="检索方式">
    {modes.map(([id,label])=><button key={id} type="button" disabled={blocked||!local&&id!=='theme'}
     aria-pressed={active===id} onClick={()=>setMode(id)}>{label}</button>)}
   </div>
  </div>
  {active==='chapter'&&<>
   <StoryChapterPicker key={bookId} bookId={bookId} sources={sources} disabled={blocked} onSelect={selectChapter}/>
   {singleChapter&&<>
    <h2 className="yu-discovery-heading">本章故事卡</h2>
    <StoryChapterPicker key={localSourceKey(singleChapter)} bookId={bookId} kind="story" sectionId={singleChapter.sectionId}
     label="本章故事卡" onTotal={setChapterTotal} sources={chapterStories.map(card=>card.source)}
     disabled={blocked} onSelect={entry=>selectStory(entry,setChapterStories)}/>
   </>}
  </>}
  {active==='story'&&<StoryChapterPicker key={bookId+':story'} bookId={bookId} kind="story" query={storyQuery} onQueryChange={setStoryQuery}
   sources={stories.map(card=>card.source)} disabled={blocked} onSelect={entry=>selectStory(entry,setStories)}/>}
  {active==='theme'&&<>
   <div className="yu-options" role="group" aria-label="故事主题">
    {discoveryThemePresets.map(value=><button key={value} type="button" disabled={blocked}
     aria-pressed={!showCustom&&preset===value} className={!showCustom&&preset===value?'selected':''}
     onClick={()=>{if(!showCustom&&preset===value)return;setPreset(value);setShowCustom(false);resetSearch();}}>
     {value}
    </button>)}
    <button type="button" disabled={blocked} aria-pressed={showCustom} className={showCustom?'selected':''}
     onClick={()=>{if(showCustom)return;setShowCustom(true);resetSearch();}}>其它</button>
   </div>
   {showCustom&&<label className="yu-custom-input">自定义主题或情节<input disabled={blocked} maxLength={100} value={customTheme}
    placeholder="例如：求雨的故事，或道士当街种出梨树"
    onChange={event=>{setCustomTheme(event.target.value);resetSearch();}}/></label>}
   {local&&<div className="yu-discovery-extract">
    <button type="button" disabled={blocked||!theme} onClick={()=>void extract()}>{results?'继续查找故事':'开始找故事'}</button>
    {results&&<button type="button" disabled={blocked} onClick={()=>void extract(true)}>从原文提取更多</button>}
    {searching&&<><p role="status">{searchProgress}</p><button type="button" onClick={()=>search.current?.abort()}>取消查找</button></>}
    {searchError&&<p role="alert">{searchError}</p>}
    {results&&<>
     <StoryChapterPicker key={searchKey} bookId={bookId} kind="story" label="查找结果" resultEntries={results.entries}
      sources={extractedChoices.map(card=>card.source)} disabled={blocked} onSelect={entry=>selectStory(entry,setExtractedChoices)}/>
     {!results.entries.length&&results.note&&<p role="status">{results.note}</p>}
    </>}
   </div>}
  </>}
  <button type="button" className="yu-primary yu-discovery-submit" disabled={blocked||invalid} onClick={()=>void submit()}>
   {busy?'正在保存任务…':!local?'开始找故事':'准备故事'}<ArrowRight size={19}/>
  </button>
  {error&&<div className="yu-unavailable" role="alert"><strong>任务暂未保存</strong><p>{error}</p></div>}
 </>;
}
