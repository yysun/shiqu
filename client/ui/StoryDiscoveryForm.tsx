// 三种检索共用选书页。提交只带当前方式的条件。
import {ArrowRight} from 'lucide-react';
import type {Selection} from '@/lib/reader-model';
import type {LocalSourceReference} from '@/lib/reader-local-contract';
import {localSourceKey} from '@/lib/reader-source-key';
import type {BookContentEntry} from '@/lib/reader-contents';
import {discoveryThemePresets,promptAfterThemeChange} from '@/lib/reader-prompts';
import StoryChapterPicker from './StoryChapterPicker';
import {useRetainedState} from './useRetainedState';
import './story-discovery.css';

export const discoveryThemes=[...discoveryThemePresets,'其他'];
const modes=[['chapter','按章节'],['story','按故事'],['theme','按主题']] as const;
type Mode=typeof modes[number][0];
type Choice={title:string;source:LocalSourceReference};

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
 const [story,setStory]=useRetainedState<Choice|null>(part('story'),null);
 const [preset,setPreset]=useRetainedState<string|null>(part('theme-preset'),initialPreset??null);
 const [customTheme,setCustomTheme]=useRetainedState(part('custom-theme'),initialPreset?'':initialTheme);
 const [showCustom,setShowCustom]=useRetainedState(part('show-custom-theme'),!initialPreset&&(!!initialTheme||selection.theme==='其他'));
 const [themeScope,setThemeScope]=useRetainedState(part('theme-scope'),initialMode==='theme'?originalSources:[]);
 const theme=showCustom?customTheme.trim():preset||'';
 const [opened]=useRetainedState(part('opened'),()=>JSON.stringify([bookId,customBook,mode,sources,preset,customTheme,showCustom]));
 const local=bookId!=='other';
 const active=local&&(mode==='chapter'||mode==='story')?mode:'theme';
 const dirty=JSON.stringify([bookId,customBook,mode,sources,preset,customTheme,showCustom])!==opened
  ||!!(storyQuery||story);

 function changeBook(next:string){
  if(next===bookId)return;
  setBookId(next);setSources([]);setStory(null);setStoryQuery('');
  clearThemeScope();
  onBookChange(next);
 }
 function selectChapter({source}:BookContentEntry){
  if(!source)return;
  const key=localSourceKey(source);
  setSources(old=>old.some(item=>localSourceKey(item)===key)
   ?old.filter(item=>localSourceKey(item)!==key):old.length<24?[...old,source]:old);
 }
 function clearThemeScope(){
  setThemeScope([]);
 }
 const invalid=active==='chapter'&&!sources.length||active==='story'&&!story
  ||active==='theme'&&!theme||!local&&!customBook.trim();
 async function submit(){
  if(busy||invalid)return;
  const topic=active==='theme'?theme:'原典故事';
  const choice=active==='story'?story:null;
  const discoverySources=choice?[choice.source]:active==='chapter'?sources:active==='theme'&&themeScope.length?themeScope:undefined;
  await onSubmit({
   ...selection,bookId,customBook:local?undefined:customBook.trim(),
   discovery:local&&active==='theme'?{mode:'auto',vectorFirst:true,themeInput:showCustom?'custom':'preset'}:{mode:'auto'},
   theme:topic,productionPrompt:promptAfterThemeChange(selection.productionPrompt,selection.theme,topic),
   storyTitle:undefined,source:undefined,discoverySources,length:'auto',voice:false,
  });
 }

 return <>
  <span hidden data-dirty={dirty?'true':undefined}/>
  <h2 className="yu-discovery-heading">从哪本书出发</h2>
  <div className="yu-options" role="group" aria-label="选择书籍">
   {books.map(book=><button type="button" key={book.id} disabled={busy} aria-pressed={bookId===book.id}
    className={bookId===book.id?'selected':''} onClick={()=>changeBook(book.id)}>
    {semanticIndexBooks?.some(index=>index.id===book.id)?<strong>{book.title}</strong>:book.title}
   </button>)}
  </div>
  {!local&&<label className="yu-custom-input">书名或公开网页 URL<input disabled={busy} maxLength={500} value={customBook} onChange={event=>setCustomBook(event.target.value)}/></label>}
  <div className="yu-discovery-mode-row">
   <h2 className="yu-discovery-heading">检索方式</h2>
   <div className="yu-discovery-modes" role="group" aria-label="检索方式">
    {modes.map(([id,label])=><button key={id} type="button" disabled={busy||!local&&id!=='theme'}
     aria-pressed={active===id} onClick={()=>setMode(id)}>{label}</button>)}
   </div>
  </div>
  {active==='chapter'&&<StoryChapterPicker key={bookId} bookId={bookId} sources={sources} disabled={busy} onSelect={selectChapter}/>}
  {active==='story'&&<>
   <StoryChapterPicker key={bookId+':story'} bookId={bookId} kind="story" query={storyQuery} onQueryChange={setStoryQuery}
    sources={story?[story.source]:[]} disabled={busy} onSelect={({title,source})=>{if(source)setStory({title,source});}}/>
   {story&&<p className="yu-choice-footnote" role="status">已选《{story.title}》</p>}
  </>}
  {active==='theme'&&<>
   <div className="yu-options" role="group" aria-label="故事主题">
    {discoveryThemePresets.map(value=><button key={value} type="button" disabled={busy}
     aria-pressed={!showCustom&&preset===value} className={!showCustom&&preset===value?'selected':''}
     onClick={()=>{if(!showCustom&&preset===value)return;setPreset(value);setShowCustom(false);clearThemeScope();}}>
     {value}
    </button>)}
    <button type="button" disabled={busy} aria-pressed={showCustom} className={showCustom?'selected':''}
     onClick={()=>{if(showCustom)return;setShowCustom(true);clearThemeScope();}}>其它</button>
   </div>
   {showCustom&&<label className="yu-custom-input">自定义主题或情节<input disabled={busy} maxLength={100} value={customTheme}
    placeholder="例如：求雨的故事，或道士当街种出梨树"
    onChange={event=>{setCustomTheme(event.target.value);clearThemeScope();}}/></label>}
  </>}
  <button type="button" className="yu-primary yu-discovery-submit" disabled={busy||!!invalid} onClick={()=>void submit()}>
   {busy?'正在保存任务…':active==='theme'?'开始找故事':'开始提取'}<ArrowRight size={19}/>
  </button>
  {error&&<div className="yu-unavailable" role="alert"><strong>任务暂未保存</strong><p>{error}</p></div>}
 </>;
}
