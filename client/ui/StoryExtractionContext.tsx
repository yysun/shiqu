// 重新打开提取设置时，按已选出处读取完整原文。
import {useEffect,useState,type ReactNode} from 'react';
import type {Selection} from '@/lib/reader-model';
import type {LocalSourceReference} from '@/lib/reader-local-contract';
import {localSourceKey} from '@/lib/reader-source-key';
import {request} from './shared';
import './story-discovery.css';

export default function StoryExtractionContext({selection,book,backAction}:{selection:Selection;book:string;backAction?:ReactNode}){
 const sources=selection.discoverySources||[],bookId=selection.bookId==='other'?selection.customBook||selection.bookId:selection.bookId;
 const key=JSON.stringify([bookId,...sources.map(localSourceKey)]);
 const [loaded,setLoaded]=useState<{key:string;entries:{id:string;title:string;text:string}[];error?:string}|null>(null),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!sources.length)return;
  let live=true;
  Promise.all(sources.map(async(source:LocalSourceReference,index)=>{
   const result=await request('reader/books/'+encodeURIComponent(bookId)+'/source?source='+encodeURIComponent(JSON.stringify(source)));
   return {id:localSourceKey(source)+index,title:result.title,text:result.text};
  })).then(entries=>{if(live)setLoaded({key,entries});})
   .catch(()=>{if(live)setLoaded({key,entries:[],error:'所选原文暂未加载，请重试。'});});
  return()=>{live=false;};
 },[key,retry]);
 const current=loaded?.key===key?loaded:null;
 const theme=selection.theme==='原典故事'?'不限定主题':selection.theme;
 const combining=selection.discovery?.mode==='auto'&&selection.discovery.combine;
 const title=selection.discovery?.mode==='title'?selection.discovery.title:null;
 return <section className="yu-extraction-context" aria-label="提取条件">
  <div className="yu-setting-row yu-story-name"><div><p>《{book}》</p></div></div>
  <div className="yu-extraction-meta-row"><p className="yu-extraction-meta">{combining?`已选 ${sources.length} 段原文`:<>{theme==='不限定主题'?theme:`主题：${theme}`} · {sources.length?`已选 ${sources.length} 段原文`:'全书'} · {title?`指定标题：${title}`:'自动标题'}</>}</p>{backAction}</div>
  {sources.length>0&&<details>
   <summary>查看已选原文</summary>
   {!current?<span role="status">正在读取已选原文…</span>:<>
    {!!current.entries.length&&<div className="yu-extraction-originals">{current.entries.map(entry=><article key={entry.id}><h4>{entry.title}</h4><p>{entry.text}</p></article>)}</div>}
    {current.error&&<div role="status"><p>{current.error}</p><button type="button" className="yu-context-retry" onClick={()=>setRetry(value=>value+1)}>重新加载原文</button></div>}
   </>}
  </details>}
 </section>;
}
