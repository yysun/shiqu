// Resolve saved source receipts through the book directory so reopened and replacement pickers name the originals.
import {useEffect,useState} from 'react';
import type {Selection} from '@/lib/reader-model';
import type {BookContents,BookContentEntry} from '@/lib/reader-contents';
import {localSourceKey} from '@/lib/reader-source-key';
import {request} from './shared';
import './story-discovery.css';

export default function StoryExtractionContext({selection,book}:{selection:Selection;book:string}){
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
 return <section className="yu-extraction-context" aria-label="已选原文与主题">
  <p className="yu-extraction-book">《{book}》</p>
  <dl><dt>原文范围</dt><dd>{!sources.length?'全书':!current?<span role="status">正在读取已选原文…</span>:<>
   {!!current.entries.length&&<ul>{current.entries.map(entry=><li key={entry.id}><strong>{entry.title}</strong>{entry.kind==='story'&&<p>{entry.excerpt}</p>}</li>)}</ul>}
   {current.error&&<div role="status"><p>{current.error}</p><button type="button" className="yu-context-retry" onClick={()=>setRetry(value=>value+1)}>重新加载原文名称</button></div>}
  </>}</dd><dt>主题</dt><dd>{selection.theme==='原典故事'?'不限定主题':selection.theme}</dd></dl>
 </section>;
}
