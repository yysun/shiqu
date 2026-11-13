// 将章节浏览与故事/主题检索放在同一选书流程中；原文视图始终使用已核验出处。
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,BookOpen,Loader2,Search} from 'lucide-react';
import {request} from './shared';
import './StoryCardSearch.css';

type Book={id:string;title:string};
type Source={edition:string;sectionId:string;firstUnit:string;lastUnit:string;continuations?:{sectionId:string;firstUnit:string;lastUnit:string}[]};
type Entry={kind?:string;id?:string;title:string;chapter?:string;excerpt?:string;summary?:string;source?:Source;verified?:boolean;exact?:boolean;reason?:string;evidence?:string[]};
type Mode='chapter'|'story'|'theme';
const modes:{id:Mode;title:string;hint:string;placeholder:string;button:string}[]=[
 {id:'chapter',title:'章节',hint:'浏览目录、原文和已有故事卡，例如“卷十一”',placeholder:'输入卷名或篇名',button:'查看章节'},
 {id:'story',title:'故事',hint:'定位一则故事，例如“找《种梨》”或描述情节',placeholder:'故事标题、别名或记得的情节',button:'找故事'},
 {id:'theme',title:'主题',hint:'找多则符合条件的故事，例如“求下雨”',placeholder:'输入主题或情节描述',button:'找主题'},
];
async function readStream(response:Response,onEvent:(event:any)=>void){
 if(!response.ok){let data:any={};try{data=await response.json();}catch{}throw Error(data.error||'检索暂时失败，请重试。');}
 if(!response.body)throw Error('浏览器无法读取检索进度。');
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
 while(true){const {done,value}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines)if(line.trim())onEvent(JSON.parse(line));if(done)break;}
}
export default function StoryCardSearch({books,onClose}:{books:Book[];onClose:()=>void}){
 const [bookId,setBookId]=useState('liaozhai'),[mode,setMode]=useState<Mode>('chapter'),[query,setQuery]=useState(''),[section,setSection]=useState(''),[chapters,setChapters]=useState<Entry[]>([]),[results,setResults]=useState<Entry[]>([]),[original,setOriginal]=useState<{title:string;text:string}|null>(null);
 const [loadingChapters,setLoadingChapters]=useState(false),[busy,setBusy]=useState(false),[continuing,setContinuing]=useState(false),[progress,setProgress]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
 const continueController=useRef<AbortController|null>(null);
 useEffect(()=>()=>continueController.current?.abort(),[]);
 useEffect(()=>{let active=true;setLoadingChapters(true);setSection('');setResults([]);setOriginal(null);request(`reader/books/${encodeURIComponent(bookId)}/contents?view=chapters`).then((data:{entries:Entry[]})=>{if(active)setChapters(data.entries||[]);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'无法读取目录。');}).finally(()=>{if(active)setLoadingChapters(false);});return()=>{active=false;};},[bookId]);
 function selectMode(next:Mode){setMode(next);setResults([]);setError('');setNote('');setProgress('');setOriginal(null);if(next!=='theme')setSection('');}
 async function search(){
  if(mode!=='chapter'&&!query.trim()){setError('先写下要找的故事或主题。');return;}
  setBusy(true);setError('');setNote('');setResults([]);setProgress(mode==='theme'?'正在查找候选…':'');
  try{
   const params=new URLSearchParams({mode,q:query.trim()});if(section&&mode==='theme')params.set('section',section);
   if(mode==='theme')await readStream(await fetch(`/api/reader/books/${encodeURIComponent(bookId)}/search?${params}`),event=>{if(event.type==='progress')setProgress(event.stage==='verifying'?'正在核对原文…':'正在查找候选…');if(event.type==='error')throw Error(event.error);if(event.type==='result'){setResults(event.results||[]);setNote(event.note||'');setProgress(event.verified?`已核对 ${event.checked}/${event.total} 条候选`:'候选尚未核对');}});
   else{const data=await request(`reader/books/${encodeURIComponent(bookId)}/search?${params}`);setResults(data.results||[]);setNote(mode==='story'&&data.results?.some((row:Entry)=>row.exact)?'唯一标题命中，无需等待模型。':'');}
  }catch(reason){setError(reason instanceof Error?reason.message:'检索暂时失败，请重试。');}finally{setBusy(false);}
 }
 async function openSource(source:Source){
  setError('');try{const data=await request(`reader/books/${encodeURIComponent(bookId)}/source?source=${encodeURIComponent(JSON.stringify(source))}`);setOriginal({title:data.title,text:data.text});}catch(reason){setError(reason instanceof Error?reason.message:'暂时无法打开原文。');}
 }
 async function continueOriginal(){
  setContinuing(true);setBusy(true);setError('');setProgress('正在准备原文查找…');
  const titleMode=mode==='story',theme=titleMode?'原典故事':query.trim().slice(0,100),source=section?chapters.find(entry=>entry.source?.sectionId===section)?.source:undefined;
  const controller=new AbortController();continueController.current=controller;
  const selection={bookId,theme,artStyle:'ink-pencil',productionPrompt:'',length:'auto',voice:false,discovery:titleMode?{mode:'title',title:query.trim().slice(0,100)}:{mode:'auto'},...(source?{discoverySources:[source]}:{})};
  try{
   const response=await fetch('/api/reader/suggestions',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({...selection,excludeTitles:[],excludeSources:[]}),signal:controller.signal});
   await readStream(response,event=>{
    if(event.type==='progress'){const p=event.progress;setProgress(p?.totalChars?`正在读取原文 ${p.completedChars.toLocaleString('zh-CN')} / ${p.totalChars.toLocaleString('zh-CN')} 字${p.currentChapters?.length?' · '+p.currentChapters.join('、'):''}`:'正在读取原文…');}
    if(event.type==='error')throw Error(event.error);
    if(event.type==='result'){const batch=event.batch;setResults((batch?.stories||[]).flatMap((story:Entry)=>story.source?[{...story,verified:true}]:[]));setNote(batch?.note||'');setProgress(batch?.note||'原文查找已完成。');}
   });
  }catch(reason){if(!(reason instanceof Error&&reason.name==='AbortError'))setError(reason instanceof Error?reason.message:'继续查找原文失败。');else setProgress('已取消查找；已保存的阅读进度保留。');}finally{continueController.current=null;setBusy(false);setContinuing(false);}
 }
 const active=modes.find(item=>item.id===mode)!;
 return <section className="yu-card-search" aria-label="选书检索">
  {original?<><header className="yu-card-search-head"><button type="button" onClick={()=>setOriginal(null)}><ArrowLeft size={16}/>返回结果</button><span>{books.find(book=>book.id===bookId)?.title} · 原文</span></header><article className="yu-card-original"><h1>{original.title}</h1><pre>{original.text}</pre></article></>:<>
   <header className="yu-card-search-head"><button type="button" onClick={onClose}><ArrowLeft size={16}/>返回发现</button><strong>从原文里找故事</strong><span>·</span></header>
   <label className="yu-card-search-book">正在查<select value={bookId} disabled={busy} onChange={event=>setBookId(event.target.value)}>{books.map(book=><option key={book.id} value={book.id}>{book.title}</option>)}</select></label>
   <div className="yu-card-search-modes" role="tablist" aria-label="检索方式">{modes.map(item=><button key={item.id} type="button" role="tab" aria-selected={mode===item.id} className={mode===item.id?'active':''} onClick={()=>selectMode(item.id)}>{item.title}</button>)}</div>
   <p className="yu-card-search-hint">{active.hint}</p>
   <div className="yu-card-search-input"><input aria-label={active.title==='章节'?'搜索章节':'搜索内容'} placeholder={active.placeholder} value={query} maxLength={200} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void search();}}/><button type="button" disabled={busy||loadingChapters} onClick={()=>void search()}>{busy?<Loader2 size={16} className="spin"/>:<Search size={16}/>} {active.button}</button></div>
   {mode==='theme'&&<label className="yu-card-search-scope">限定章节（可跳过）<select value={section} disabled={busy} onChange={event=>setSection(event.target.value)}><option value="">全书</option>{chapters.map(entry=><option key={entry.id} value={entry.source?.sectionId}>{entry.title}</option>)}</select><button type="button" onClick={()=>setSection('')}>清除</button></label>}
   {loadingChapters?<p role="status">正在读取目录…</p>:null}
   {progress&&<p className="yu-card-search-status" role="status">{progress}</p>}
   {note&&<p className="yu-card-search-note" role="status">{note}</p>}
   {error&&<p className="yu-card-search-error" role="alert">{error}</p>}
   <div className="yu-card-search-results">{results.map((entry,index)=><article className="yu-card-result" key={(entry.source?.sectionId||'')+':'+(entry.source?.firstUnit||index)}>
    <div><h2>{entry.title}</h2>{entry.summary&&<p>{entry.summary}</p>}<small>{entry.chapter?entry.chapter+' · ':''}{books.find(book=>book.id===bookId)?.title}{entry.chapter?' · '+entry.title:''}</small>
     {entry.verified===false?<em>候选 · 尚未核对</em>:entry.reason&&<em>匹配依据：{entry.reason}</em>}{entry.evidence?.length? <blockquote>原文依据：{entry.evidence[0]}</blockquote>:null}</div>
    <button type="button" disabled={!entry.source||busy} onClick={()=>entry.source&&void openSource(entry.source)}><BookOpen size={15}/>打开原文</button>
   </article>)}</div>
   {mode==='chapter'&&!results.length&&<button className="yu-card-search-browse" type="button" onClick={()=>{setResults(chapters);setNote('目录和原文无需配置模型即可查看。');}} disabled={loadingChapters||busy}>浏览全部章节</button>}
   {!busy&&mode!=='chapter'&&!results.length&&query.trim()&&<section className="yu-card-search-empty"><strong>候选中还没定位到</strong><span>可以继续查找所选范围的原文。</span><button type="button" onClick={()=>void continueOriginal()}>继续查找原文</button></section>}
   {continuing&&<button type="button" className="yu-card-search-cancel" onClick={()=>continueController.current?.abort()}>取消查找</button>}
  </>}
 </section>;
}
