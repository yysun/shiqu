// Keep discovery compact so available stories stay visible; disclose real reading scope on demand.
import {BookOpen,ChevronDown,Loader2} from 'lucide-react';
import type {SuggestionProgress} from '@/lib/reader-suggestions';

export function StoryReadingState({book,theme,progress,elapsed,onCancel,hasStories=false}:{book:string;theme:string;progress:SuggestionProgress|null;elapsed:number;onCancel:()=>void;hasStories?:boolean}){
 const chapters=progress?.currentChapters||[],checking=progress?.stage==='checking';
 const stage=checking?'正在核对故事出处':progress?.stage==='selecting'?'正在整理候选故事':progress?.stage==='reading'||chapters.length?'正在阅读原文':'正在打开原文';
 return <section className="yu-reading-panel" aria-label="寻找故事">
  <div className="yu-reading-panel-heading">
   <div className="yu-reading-book" aria-hidden="true"><BookOpen size={22}/></div>
   <div className="yu-reading-title"><h3>{hasStories?'继续寻找，先挑一篇':'正在寻找好故事'}</h3><p>《{book}》<span> · {theme}</span></p></div>
  </div>
  <div className="yu-reading-status"><span role="status"><Loader2 size={14} className="spin" aria-hidden="true"/>{stage}</span><span className="yu-reading-elapsed">已用时 {elapsed} 秒</span></div>
  <details className="yu-reading-details">
   <summary><span>查看阅读进度</span>{!!progress?.completedChars&&<small>已读 {progress.completedChars.toLocaleString('zh-CN')} 字</small>}<ChevronDown size={14} aria-hidden="true"/></summary>
   <p className="yu-reading-scope">{chapters.length?'正在翻阅：'+chapters.join('、'):progress?`正在翻阅《${book}》原文。`:'正在准备原文，随后会显示当前阅读的篇章。'}</p>
   {checking&&<p className="yu-reading-scope">核对原文范围，确认故事完整。</p>}
  </details>
  <div className="yu-reading-panel-footer"><small>{hasStories?'已有故事可以直接选择。':'找到后会在这里显示，画风稍后再选。'}</small><button type="button" onClick={onCancel}>停止寻找</button></div>
 </section>;
}
