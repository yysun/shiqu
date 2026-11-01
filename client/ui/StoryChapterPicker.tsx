// Browse metadata only; clear stale requests and let the server revalidate every chosen receipt.
import {useEffect,useState} from 'react';
import {Converter} from 'opencc-js';
import type {BookContents,BookContentEntry} from '@/lib/reader-contents';
import {request} from './shared';
const simplified=Converter({from:'t',to:'cn'});
export default function StoryChapterPicker({bookId,selected,disabled,onSelect}:{bookId:string;selected?:string;disabled:boolean;onSelect:(entry:BookContentEntry)=>void}){
 const [contents,setContents]=useState<BookContents|null>(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let live=true;setContents(null);setError('');setQuery('');
  request('reader/books/'+encodeURIComponent(bookId)+'/contents').then(value=>{if(live)setContents(value);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'目录暂未加载，请重试。');});
  return()=>{live=false;};
 },[bookId,retry]);
 const entries=contents?.bookId===bookId?contents.entries:[];
 const key=simplified(query.normalize('NFKC').trim()).toLowerCase();
 const filtered=entries.filter(entry=>simplified(entry.title+' '+entry.chapter+' '+entry.excerpt).toLowerCase().includes(key));
 return <section className="yu-source-picker" aria-label="选择故事或章节">
  <label className="yu-custom-input">搜索故事或章节<input type="search" value={query} disabled={disabled} placeholder="标题、篇章或原文关键词" onChange={e=>setQuery(e.target.value)}/></label>
  {error?<div role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={()=>setRetry(n=>n+1)}>重试加载目录</button></div>:!contents?<p role="status">正在加载目录…</p>:<>
   <p className="yu-candidate-count" role="status">{filtered.length?`${filtered.length} 项${selected?' · 已选内容保留':''}`:'没有匹配的故事或章节，请换个关键词。'}</p>
   <div className="yu-source-entries">{filtered.map(entry=><button type="button" key={entry.id} className={selected===entry.id?'selected':''} aria-pressed={selected===entry.id} disabled={disabled||!entry.source} onClick={()=>onSelect(entry)}>
    <strong>{entry.title}</strong>{entry.chapter!==entry.title&&<small>{entry.chapter}</small>}<span>{entry.excerpt}</span>{entry.unavailable&&<small>{entry.unavailable}</small>}{selected===entry.id&&<b>已选这篇</b>}
   </button>)}</div>
  </>}
 </section>;
}
