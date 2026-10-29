// Show real reading scope and an indeterminate in-flight state, without invented progress.
import {BookOpen,Check} from 'lucide-react';
import type {SuggestionProgress} from '@/lib/reader-suggestions';

export function StoryReadingState({book,theme,progress,elapsed,onCancel,hasStories=false}:{book:string;theme:string;progress:SuggestionProgress|null;elapsed:number;onCancel:()=>void;hasStories?:boolean}){
 const chapters=progress?.currentChapters||[],checking=progress?.stage==='checking';
 return <section className="yu-reading-panel" aria-label="寻找故事" aria-busy="true">
  <div className="yu-reading-panel-heading"><div className="yu-reading-book" aria-hidden="true"><BookOpen size={30}/><i/></div><div><small>正在翻阅《{book}》</small><h3>{checking?'核对故事出处':hasStories?'为你寻找更多故事':'为你寻找第一篇好故事'}</h3></div><span className="yu-reading-elapsed">已等待 {elapsed} 秒</span></div>
  <p className="yu-reading-scope" role="status">{checking?'正在核对原文范围，确认故事完整。':chapters.length?'正在阅读：'+chapters.join('、'):'正在打开原文，准备按章回寻找。'}</p>
  <p className="yu-reading-theme">寻找「{theme}」中的故事</p>
  <progress className="yu-reading-activity" aria-label={checking?'正在核对出处':'正在阅读原文'}/>
  {!!progress?.completedChars&&<small className="yu-reading-completed"><Check size={13}/>已完成 {progress.completedChars.toLocaleString('zh-CN')} 字原文，正在继续寻找</small>}
  <div className="yu-reading-placeholders" aria-hidden="true">{[0,1,2].map(index=><div className="yu-reading-placeholder" key={index}><i/><span/><span/></div>)}</div>
  <div className="yu-reading-panel-footer"><small>找到一篇完整故事就先给你，画风稍后再选。</small><button type="button" onClick={onCancel}>取消选题</button></div>
 </section>;
}
