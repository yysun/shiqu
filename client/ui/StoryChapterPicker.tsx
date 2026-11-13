// 浏览章节或故事，筛选时保留表单中已选的原文范围。
import {useEffect,useId,useState} from 'react';
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

async function listEntries(bookId:string,kind:NonNullable<Props['kind']>,query:string){
 const book='reader/books/'+encodeURIComponent(bookId);
 const q=encodeURIComponent(query);
 if(kind==='chapter'){
  const contents:BookContents=await request(book+'/contents?view=chapters&q='+q);
  return contents.entries;
 }
 const contents:BookContents=await request(book+'/contents?q='+q);
 return contents.entries.filter(entry=>entry.kind==='story'&&entry.source);
}

export default function StoryChapterPicker({bookId,sources,disabled,onSelect,kind='chapter',query:externalQuery,onQueryChange}:Props){
 const [entries,setEntries]=useState<BookContentEntry[]|null>(null),[error,setError]=useState(''),[internalQuery,setInternalQuery]=useState(''),[retry,setRetry]=useState(0);
 const [visibleCount,setVisibleCount]=useState(100);
 const group=useId();
 const query=externalQuery??internalQuery;
 const story=kind!=='chapter',noun=story?'故事':'章节';
 useEffect(()=>{
  let live=true;setEntries(null);setError('');setVisibleCount(100);
  const timer=setTimeout(()=>{
   listEntries(bookId,kind,query.trim()).then(value=>{if(live)setEntries(value);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'目录暂未加载，请重试。');});
  },query.trim()?200:0);
  return()=>{live=false;clearTimeout(timer);};
 },[bookId,kind,query,retry]);
 const isSelected=(entry:BookContentEntry)=>!!entry.source&&sources.some(source=>localSourceKey(source)===localSourceKey(entry.source!));
 const visible=story?entries?.slice(0,visibleCount):entries;
 return <section className="yu-source-picker" aria-label={noun+'列表'}>
  <label className="yu-custom-input">关键词筛选<input type="search" maxLength={200} value={query} disabled={disabled} placeholder={story?'如：道士 种梨（空格分隔）':'如：黄忠 定军山（空格分隔）'} onChange={e=>(onQueryChange??setInternalQuery)(e.target.value)}/></label>
  {error?<div role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={()=>setRetry(n=>n+1)}>重试加载目录</button></div>:!entries?<p role="status">{query.trim()?'正在筛选':'正在加载'}{noun}…</p>:<>
   <p className="yu-candidate-count" role="status">{entries.length?`${entries.length} ${story?'则':'章'}`:story&&!query.trim()?'这本书暂无可选故事。':`没有匹配的${noun}。`}{sources.length>0&&` · 已选 ${sources.length} 项`}</p>
   <div className="yu-source-entries">{visible?.map(entry=>{
    const selectedEntry=isSelected(entry),locked=disabled||!entry.source||!story&&sources.length>=24&&!selectedEntry;
    return <label key={entry.id} className={'yu-source-chapter'+(selectedEntry?' selected':'')}><input type={story?'radio':'checkbox'} name={story?group:undefined} aria-label={entry.title} checked={selectedEntry} disabled={locked} onChange={()=>onSelect(entry)}/><strong>{entry.title}</strong></label>;
   })}</div>
   {story&&entries.length>visibleCount&&<button type="button" className="yu-book-search-link" disabled={disabled} onClick={()=>setVisibleCount(count=>count+100)}>显示更多故事</button>}
  </>}
 </section>;
}
