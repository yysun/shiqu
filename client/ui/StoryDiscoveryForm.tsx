// Choose original scope before theme; restore saved source receipts when returning from extraction.
// 传入 retainKey 时表单输入跨布局切换保留；Reader 在关闭新建或提交成功时清除。
// 书、主题、自定义主题或原文范围与打开时不同时，隐藏的标记带 data-dirty（返回关闭前询问）。
import {useState} from 'react';
import {useRetainedState} from './useRetainedState';
import {ArrowRight} from 'lucide-react';
import type {Selection} from '@/lib/reader-model';
import type {LocalSourceReference} from '@/lib/reader-local-contract';
import {localSourceKey} from '@/lib/reader-source-key';
import type {BookContentEntry} from '@/lib/reader-contents';
import {promptAfterThemeChange} from '@/lib/reader-prompts';
import StoryChapterPicker from './StoryChapterPicker';
import './story-discovery.css';

export const discoveryThemes=['给我一个反转','人情冷暖','放下执念','聪明与糊涂','善意与误解','命运与选择','欲望与代价','勇气与成长','爱情与错过','幽默与讽刺','因果与报应','其他'];
export default function StoryDiscoveryForm({selection,books,busy,error,onBookChange,onSubmit,retainKey}:{selection:Selection;books:{id:string;title:string}[];busy:boolean;error:string;onBookChange:(bookId:string)=>void;onSubmit:(selection:Selection)=>Promise<void>;retainKey?:string}){
 const part=(name:string)=>retainKey&&retainKey+':'+name;
 const custom=selection.theme!=='原典故事'&&!discoveryThemes.includes(selection.theme);
 const [draft,setDraft]=useRetainedState(part('draft'),()=>({...selection,theme:custom?'其他':selection.theme}));
 const [sources,setSources]=useRetainedState<LocalSourceReference[]>(part('sources'),selection.discoverySources||[]),[limited,setLimited]=useRetainedState(part('limited'),!!selection.discoverySources?.length);
 const [rangeOpen,setRangeOpen]=useRetainedState(part('range'),false);
 const [customTheme,setCustomTheme]=useRetainedState(part('theme'),custom?selection.theme:'');
 const local=draft.bookId!=='other';
 // 打开时的选择；挂载时取一次，跨布局重新挂载时由同一份选择重新得到
 const [opened]=useState(()=>JSON.stringify([{...selection,theme:custom?'其他':selection.theme},custom?selection.theme:'',selection.discoverySources||[],!!selection.discoverySources?.length]));
 const dirty=JSON.stringify([draft,customTheme,sources,limited])!==opened;
 function changeBook(bookId:string){
  setDraft(old=>({...old,bookId,storyTitle:undefined,source:undefined,discoverySources:undefined}));
  setSources([]);setLimited(false);setRangeOpen(false);onBookChange(bookId);
 }
 function select(entry:BookContentEntry){
  if(entry.kind==='chapter'){
   setDraft(old=>({...old,storyTitle:undefined,source:undefined}));
   setSources(old=>old.some(chapter=>localSourceKey(chapter)===localSourceKey(entry.source!))?old.filter(chapter=>localSourceKey(chapter)!==localSourceKey(entry.source!)):old.length<24?[...old,entry.source!]:old);
  }else{setSources([]);setDraft(old=>({...old,storyTitle:entry.title,source:entry.source}));}
 }
 const theme=draft.theme==='其他'?customTheme.trim():draft.theme;
 const rangeSummary=sources.length?`已选 ${sources.length} 段原文`:draft.source?`已选段落：${draft.storyTitle}`:'选择原文章节或故事段落';
 const invalid=draft.bookId==='other'&&!draft.customBook?.trim()||draft.theme==='其他'&&!theme||limited&&!draft.source&&!sources.length;
 async function submit(){
  if(busy||invalid)return;
  await onSubmit({...draft,discovery:{mode:'auto'},theme:theme||'原典故事',storyTitle:undefined,source:undefined,discoverySources:limited?(sources.length?sources:draft.source?[draft.source]:undefined):undefined,length:'auto',voice:false});
 }
 return <>
  <span hidden data-dirty={dirty?'true':undefined}/>
  <p className="yu-sheet-intro">主题和原文范围都可选。进入故事提取窗口后，可以输入或修改标题，按标题查找。</p>
  <div className="yu-choice-label">从哪本书出发</div>
  <div className="yu-options" role="group" aria-label="选择书籍">{books.map(book=><button type="button" key={book.id} disabled={busy} aria-pressed={draft.bookId===book.id} className={draft.bookId===book.id?'selected':''} onClick={()=>changeBook(book.id)}>{book.title}</button>)}</div>
  {!local&&<label className="yu-custom-input">书名或公开网页 URL<input disabled={busy} maxLength={500} value={draft.customBook||''} placeholder="例如：三言二拍，或 https://…" onChange={event=>setDraft(old=>({...old,customBook:event.target.value}))}/></label>}
  {local&&<><div className="yu-choice-label">原文范围（可选）</div><div className="yu-options" role="group" aria-label="原文范围"><button type="button" disabled={busy} aria-pressed={!limited} className={!limited?'selected':''} onClick={()=>{setLimited(false);setRangeOpen(false);}}>自动</button><button type="button" disabled={busy} aria-pressed={limited} className={limited?'selected':''} onClick={()=>{setLimited(true);setRangeOpen(true);}}>选择章节或已有故事段落</button></div>{limited&&<details className="yu-scope-selection" open={rangeOpen} onToggle={event=>setRangeOpen(event.currentTarget.open)}><summary>{rangeSummary}<span>{rangeOpen?'收起':'点击修改'}</span></summary><StoryChapterPicker key={draft.bookId} bookId={draft.bookId} selected={draft.source?.firstUnit} sources={sources} disabled={busy} onSelect={select}/><button type="button" className="yu-scope-complete" disabled={busy||!draft.source&&!sources.length} onClick={()=>setRangeOpen(false)}>完成原文选择</button></details>}</>}
  <div className="yu-choice-label">主题（可选）</div>
  <div className="yu-options" role="group" aria-label="故事主题">{['原典故事',...discoveryThemes].map(value=><button type="button" key={value} disabled={busy} aria-pressed={draft.theme===value} className={draft.theme===value?'selected':''} onClick={()=>setDraft(old=>({...old,theme:value,productionPrompt:promptAfterThemeChange(old.productionPrompt,old.theme==='其他'?customTheme:old.theme,value)}))}>{value==='原典故事'?'不限定主题':value}</button>)}</div>
  {draft.theme==='其他'&&<label className="yu-custom-input">写下想看的主题<input disabled={busy} maxLength={100} value={customTheme} placeholder="例如：善良的人如何守住底线" onChange={event=>setCustomTheme(event.target.value)}/></label>}
  <p className="yu-choice-footnote">按主题筛选故事；选择“不限定主题”可自由发现。</p>
  <button type="button" className="yu-primary yu-discovery-submit" disabled={busy||!!invalid} onClick={()=>void submit()}>{busy?'正在保存任务…':'进入故事提取'}<ArrowRight size={19}/></button>
  <p className="yu-choice-footnote">《{local?books.find(book=>book.id===draft.bookId)?.title:draft.customBook||'自选书籍'}》 · {limited?(sources.length?`已选 ${sources.length} 段原文`:`已选段落：${draft.storyTitle||'待选择'}`):'自动'}{theme&&theme!=='原典故事'?` · ${theme}`:''}</p>
  {error&&<div className="yu-unavailable" role="alert"><strong>任务暂未保存</strong><p>{error}</p></div>}
 </>;
}
