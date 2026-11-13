// 浏览章节或故事，筛选时保留表单中已选的原文范围。
import {useEffect,useId,useRef,useState} from 'react';
import {BookOpen} from 'lucide-react';
import type {LocalSourceReference} from '@/lib/reader-local-contract';
import {localSourceKey} from '@/lib/reader-source-key';
import type {BookContents,BookContentEntry} from '@/lib/reader-contents';
import {request} from './shared';
import Sheet from './StorySheet';
type Props={
 bookId:string;
 sources:LocalSourceReference[];
 disabled:boolean;
 onSelect:(entry:BookContentEntry)=>void;
 kind?:'chapter'|'story';
 query?:string;
 onQueryChange?:(query:string)=>void;
 sectionId?:string;
 resultEntries?:BookContentEntry[];
 onTotal?:(total:number|null)=>void;
 label?:string;
};

const storyPageSize=20;
async function listEntries(bookId:string,kind:NonNullable<Props['kind']>,query:string,offset=0,sectionId?:string){
 const book='reader/books/'+encodeURIComponent(bookId);
 const view=kind==='chapter'?'chapters':'stories';
 const params=new URLSearchParams({view,q:query});
 if(sectionId)params.set('section',sectionId);
 if(kind==='story'){params.set('limit',String(storyPageSize));params.set('offset',String(offset));}
 return await request(book+'/contents?'+params.toString()) as BookContents;
}

export default function StoryChapterPicker({bookId,sources,disabled,onSelect,kind='chapter',query:externalQuery,onQueryChange,sectionId,resultEntries,onTotal,label}:Props){
 const [loadedEntries,setEntries]=useState<BookContentEntry[]|null>(null),[total,setTotal]=useState<number|null>(null),[error,setError]=useState(''),[internalQuery,setInternalQuery]=useState(''),[retry,setRetry]=useState(0),[loadingMore,setLoadingMore]=useState(false);
 const [original,setOriginal]=useState<{title:string;text:string}|null>(null),[openingSource,setOpeningSource]=useState(''),[sourceError,setSourceError]=useState('');
 const listRef=useRef<HTMLDivElement>(null),loadMoreRef=useRef<HTMLDivElement>(null),loadingMoreRef=useRef(false);
 const group=useId();
 const query=externalQuery??internalQuery;
 const entries=resultEntries??loadedEntries;
 const story=kind!=='chapter',noun=story?'故事':'章节';
 useEffect(()=>{
  if(resultEntries)return;
  if(listRef.current)listRef.current.scrollTop=0;
  let live=true;setEntries(null);setTotal(null);setError('');setLoadingMore(false);loadingMoreRef.current=false;
  const timer=setTimeout(()=>{
   listEntries(bookId,kind,query.trim(),0,sectionId).then(value=>{if(live){setEntries(value.entries);setTotal(value.total??value.entries.length);}}).catch(e=>{if(live)setError(e instanceof Error?e.message:'目录暂未加载，请重试。');});
  },query.trim()?200:0);
  return()=>{live=false;clearTimeout(timer);};
 },[bookId,kind,query,retry,sectionId,resultEntries]);
 useEffect(()=>{onTotal?.(!query.trim()?total:null);},[onTotal,total,query]);
 useEffect(()=>{
  const root=listRef.current, sentinel=loadMoreRef.current;
  if(resultEntries||!story||!root||!sentinel||!entries||total===null||entries.length>=total||error)return;
  let live=true;
  const observer=new IntersectionObserver(([entry])=>{
   if(!entry.isIntersecting||loadingMoreRef.current)return;
   loadingMoreRef.current=true;setLoadingMore(true);
   listEntries(bookId,'story',query.trim(),entries.length,sectionId).then(page=>{
    if(live){setEntries(current=>current?[...current,...page.entries]:page.entries);setTotal(page.total??page.entries.length);}
   }).catch(e=>{if(live)setError(e instanceof Error?e.message:'目录暂未加载，请重试。');})
    .finally(()=>{loadingMoreRef.current=false;if(live)setLoadingMore(false);});
  },{root,rootMargin:'0px'});
  observer.observe(sentinel);
  return()=>{live=false;observer.disconnect();};
 },[bookId,entries,error,query,story,total,sectionId,resultEntries]);
 const isSelected=(entry:BookContentEntry)=>!!entry.source&&sources.some(source=>localSourceKey(source)===localSourceKey(entry.source!));
 async function viewOriginal(entry:BookContentEntry){
  if(!entry.source)return;
  setOpeningSource(entry.id);setSourceError('');
  try{const result=await request('reader/books/'+encodeURIComponent(bookId)+'/source?source='+encodeURIComponent(JSON.stringify(entry.source)));setOriginal({title:result.title,text:result.text});}
  catch(reason){setSourceError(reason instanceof Error?reason.message:'暂时无法打开原文。');}
  finally{setOpeningSource('');}
 }
 return <section className="yu-source-picker" aria-label={label||noun+'列表'}>
  {!resultEntries&&<label className="yu-custom-input">关键词筛选<input type="search" maxLength={200} value={query} disabled={disabled} placeholder={story?'如：道士 种梨（空格分隔）':'如：黄忠 定军山（空格分隔）'} onChange={e=>(onQueryChange??setInternalQuery)(e.target.value)}/></label>}
  {error?<div role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={()=>setRetry(n=>n+1)}>重试加载目录</button></div>:!entries?<p role="status">{query.trim()?'正在筛选':'正在加载'}{noun}…</p>:<>
   <p className="yu-candidate-count" role="status">{entries.length?(story?`共 ${total??entries.length} 则`:`${entries.length} 章`):story&&!query.trim()?sectionId?'本章暂无故事卡。':'暂无可选故事。':`没有匹配的${noun}。`}{sources.length>0&&` · 已选 ${sources.length} 项`}</p>
   <div className="yu-source-entries" ref={listRef}>{entries.map((entry,index)=>{
    const selectedEntry=isSelected(entry),locked=disabled||!entry.source||sources.length>=24&&!selectedEntry;
    const inputId=group+'-'+index;
    return <div key={entry.id} className={'yu-source-chapter'+(story?' yu-source-story':'')+(selectedEntry?' selected':'')}><input id={inputId} type="checkbox" aria-label={entry.title} checked={selectedEntry} disabled={locked} onChange={()=>onSelect(entry)}/><label className="yu-source-chapter-title" htmlFor={inputId}>{entry.title}{story&&entry.excerpt&&<small>{entry.excerpt}</small>}</label><button type="button" className="yu-source-original-link" disabled={!entry.source||openingSource===entry.id} onClick={()=>void viewOriginal(entry)}>{openingSource===entry.id?'打开中…':'看原文'}</button></div>;
   })}{!resultEntries&&story&&entries.length<(total??0)&&<div className="yu-source-page-sentinel" ref={loadMoreRef} aria-hidden="true"/>}{loadingMore&&<p role="status">正在加载下一批故事…</p>}</div>
   {sourceError&&<p className="yu-source-view-error" role="alert">{sourceError}</p>}
  </>}
  {original&&<Sheet title="原文" onClose={()=>setOriginal(null)}><div className="yu-picker-original"><h3>{original.title}</h3><p>{original.text}</p><div><BookOpen size={15}/>已核验出处</div></div></Sheet>}
 </section>;
}
