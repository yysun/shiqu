// Resolve saved source receipts through the book directory so reopened and replacement pickers name the originals.
import {useEffect,useState,type ReactNode} from 'react';
import type {Selection} from '@/lib/reader-model';
import type {BookContents,BookContentEntry} from '@/lib/reader-contents';
import {localSourceKey} from '@/lib/reader-source-key';
import {request} from './shared';
import './story-discovery.css';

export default function StoryExtractionContext({selection,book,backAction}:{selection:Selection;book:string;backAction?:ReactNode}){
 const sources=selection.discoverySources||[],bookId=selection.bookId==='other'?selection.customBook||selection.bookId:selection.bookId;
 const key=JSON.stringify([bookId,...sources.map(localSourceKey)]);
 const [loaded,setLoaded]=useState<{key:string;entries:BookContentEntry[];error?:string}|null>(null),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!sources.length)return;
  let live=true;
  request('reader/books/'+encodeURIComponent(bookId)+'/contents?view=scope').then((contents:BookContents)=>{
   const directory=new Map(contents.entries.filter(entry=>entry.source).map(entry=>[localSourceKey(entry.source!),entry]));
   const entries=sources.flatMap(source=>{const entry=directory.get(localSourceKey(source));return entry?[entry]:[];});
   if(live)setLoaded({key,entries,...(entries.length!==sources.length?{error:'部分已选原文已更新，请返回核对原文范围。'}:{})});
  }).catch(()=>{if(live)setLoaded({key,entries:[],error:'所选原文名称暂未加载，请重试。'});});
  return()=>{live=false;};
 },[key,retry]);
 const current=loaded?.key===key?loaded:null;
 const theme=selection.theme==='原典故事'?'不限定主题':selection.theme;
 const title=selection.discovery?.mode==='title'?selection.discovery.title:null;
 return <section className="yu-extraction-context" aria-label="提取条件">
  <div className="yu-setting-row yu-story-name"><div><p>《{book}》</p></div></div>
  <div className="yu-extraction-meta-row"><p className="yu-extraction-meta">{theme==='不限定主题'?theme:`主题：${theme}`} · {sources.length?`已选 ${sources.length} 段原文`:'全书'} · {title?`指定标题：${title}`:'自动标题'}</p>{backAction}</div>
  {sources.length>0&&<details>
   <summary>查看已选原文</summary>
   {!current?<span role="status">正在读取已选原文…</span>:<>
    {!!current.entries.length&&<ul>{current.entries.map(entry=><li key={entry.id}>{entry.title}</li>)}</ul>}
    {current.error&&<div role="status"><p>{current.error}</p><button type="button" className="yu-context-retry" onClick={()=>setRetry(value=>value+1)}>重新加载原文名称</button></div>}
   </>}
  </details>}
 </section>;
}
