// 按章名和原文过滤章节，保留筛选前勾选的范围。
import {useEffect,useState} from 'react';
import type {LocalSourceReference} from '@/lib/reader-local-contract';
import {localSourceKey} from '@/lib/reader-source-key';
import type {BookContents,BookContentEntry} from '@/lib/reader-contents';
import {request} from './shared';
export default function StoryChapterPicker({bookId,sources,disabled,onSelect}:{bookId:string;sources:LocalSourceReference[];disabled:boolean;onSelect:(entry:BookContentEntry)=>void}){
 const [contents,setContents]=useState<BookContents|null>(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let live=true;setContents(null);setError('');
  const timer=setTimeout(()=>{
   request('reader/books/'+encodeURIComponent(bookId)+'/contents?view=chapters&q='+encodeURIComponent(query)).then(value=>{if(live)setContents(value);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'目录暂未加载，请重试。');});
  },query.trim()?200:0);
  return()=>{live=false;clearTimeout(timer);};
 },[bookId,query,retry]);
 const entries=contents?.bookId===bookId?contents.entries:[];
 const isSelected=(entry:BookContentEntry)=>!!entry.source&&sources.some(source=>localSourceKey(source)===localSourceKey(entry.source!));
 return <section className="yu-source-picker" aria-label="章节列表">
  <label className="yu-custom-input">关键词筛选<input type="search" maxLength={200} value={query} disabled={disabled} placeholder="如：黄忠 定军山（空格分隔）" onChange={e=>setQuery(e.target.value)}/></label>
  {error?<div role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={()=>setRetry(n=>n+1)}>重试加载目录</button></div>:!contents?<p role="status">{query.trim()?'正在筛选章节…':'正在加载章节…'}</p>:<>
   <p className="yu-candidate-count" role="status">{entries.length?`${entries.length} 章`:'没有匹配的章节。'}{sources.length>0&&` · 已选 ${sources.length} 项`}</p>
   <div className="yu-source-entries">{entries.map(entry=>{
    const selectedEntry=isSelected(entry),locked=disabled||!entry.source||sources.length>=24&&!selectedEntry;
    return <label key={entry.id} className={'yu-source-chapter'+(selectedEntry?' selected':'')}><input type="checkbox" aria-label={entry.title} checked={selectedEntry} disabled={locked} onChange={()=>onSelect(entry)}/><strong>{entry.title}</strong></label>;
   })}</div>
  </>}
 </section>;
}
