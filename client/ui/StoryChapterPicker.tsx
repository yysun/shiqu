// 浏览章节或故事，筛选时保留表单中已选的原文范围。
import {useEffect,useId,useRef,useState} from 'react';
import type {LocalSourceReference} from '@/lib/reader-local-contract';
import {localSourceKey} from '@/lib/reader-source-key';
import type {BookContents,BookContentEntry} from '@/lib/reader-contents';
import {request} from './shared';
type Props={
 bookId:string;
 sources:LocalSourceReference[];
 disabled:boolean;
 onSelect:(entry:BookContentEntry)=>void;
 kind?:'chapter'|'story';
 query?:string;
 onQueryChange?:(query:string)=>void;
};

const storyPageSize=20;
async function listEntries(bookId:string,kind:NonNullable<Props['kind']>,query:string,offset=0){
 const book='reader/books/'+encodeURIComponent(bookId);
 const view=kind==='chapter'?'chapters':'stories';
 const params=new URLSearchParams({view,q:query});
 if(kind==='story'){params.set('limit',String(storyPageSize));params.set('offset',String(offset));}
 return await request(book+'/contents?'+params.toString()) as BookContents;
}

export default function StoryChapterPicker({bookId,sources,disabled,onSelect,kind='chapter',query:externalQuery,onQueryChange}:Props){
 const [entries,setEntries]=useState<BookContentEntry[]|null>(null),[total,setTotal]=useState<number|null>(null),[error,setError]=useState(''),[internalQuery,setInternalQuery]=useState(''),[retry,setRetry]=useState(0),[loadingMore,setLoadingMore]=useState(false);
 const listRef=useRef<HTMLDivElement>(null),loadMoreRef=useRef<HTMLDivElement>(null),loadingMoreRef=useRef(false);
 const group=useId();
 const query=externalQuery??internalQuery;
 const story=kind!=='chapter',noun=story?'故事':'章节';
 useEffect(()=>{
  if(listRef.current)listRef.current.scrollTop=0;
  let live=true;setEntries(null);setTotal(null);setError('');setLoadingMore(false);loadingMoreRef.current=false;
  const timer=setTimeout(()=>{
   listEntries(bookId,kind,query.trim()).then(value=>{if(live){setEntries(value.entries);setTotal(value.total??value.entries.length);}}).catch(e=>{if(live)setError(e instanceof Error?e.message:'目录暂未加载，请重试。');});
  },query.trim()?200:0);
  return()=>{live=false;clearTimeout(timer);};
 },[bookId,kind,query,retry]);
 useEffect(()=>{
  const root=listRef.current, sentinel=loadMoreRef.current;
  if(!story||!root||!sentinel||!entries||total===null||entries.length>=total||error)return;
  let live=true;
  const observer=new IntersectionObserver(([entry])=>{
   if(!entry.isIntersecting||loadingMoreRef.current)return;
   loadingMoreRef.current=true;setLoadingMore(true);
   listEntries(bookId,'story',query.trim(),entries.length).then(page=>{
    if(live){setEntries(current=>current?[...current,...page.entries]:page.entries);setTotal(page.total??page.entries.length);}
   }).catch(e=>{if(live)setError(e instanceof Error?e.message:'目录暂未加载，请重试。');})
    .finally(()=>{loadingMoreRef.current=false;if(live)setLoadingMore(false);});
  },{root,rootMargin:'0px'});
  observer.observe(sentinel);
  return()=>{live=false;observer.disconnect();};
 },[bookId,entries,error,query,story,total]);
 const isSelected=(entry:BookContentEntry)=>!!entry.source&&sources.some(source=>localSourceKey(source)===localSourceKey(entry.source!));
 return <section className="yu-source-picker" aria-label={noun+'列表'}>
  <label className="yu-custom-input">关键词筛选<input type="search" maxLength={200} value={query} disabled={disabled} placeholder={story?'如：道士 种梨（空格分隔）':'如：黄忠 定军山（空格分隔）'} onChange={e=>(onQueryChange??setInternalQuery)(e.target.value)}/></label>
  {error?<div role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={()=>setRetry(n=>n+1)}>重试加载目录</button></div>:!entries?<p role="status">{query.trim()?'正在筛选':'正在加载'}{noun}…</p>:<>
   <p className="yu-candidate-count" role="status">{entries.length?(story?`共 ${total??entries.length} 则，已加载 ${entries.length} 则`:`${entries.length} 章`):story&&!query.trim()?'这本书暂无可选故事。':`没有匹配的${noun}。`}{sources.length>0&&` · 已选 ${sources.length} 项`}</p>
   <div className="yu-source-entries" ref={listRef}>{entries.map(entry=>{
    const selectedEntry=isSelected(entry),locked=disabled||!entry.source||!story&&sources.length>=24&&!selectedEntry;
    return <label key={entry.id} className={'yu-source-chapter'+(selectedEntry?' selected':'')}><input type={story?'radio':'checkbox'} name={story?group:undefined} aria-label={entry.title} checked={selectedEntry} disabled={locked} onChange={()=>onSelect(entry)}/><strong>{entry.title}</strong></label>;
   })}{story&&entries.length<(total??0)&&<div className="yu-source-page-sentinel" ref={loadMoreRef} aria-hidden="true"/>}{loadingMore&&<p role="status">正在加载下一批故事…</p>}</div>
  </>}
 </section>;
}
