// Choose original scope before theme; restore saved source receipts when returning from extraction.
// 传入 retainKey 时表单输入跨布局切换保留；Reader 在关闭新建或提交成功时清除。
// 书、主题、自定义主题或原文范围与打开时不同时，隐藏的标记带 data-dirty（返回关闭前询问）。
import {useRetainedState} from './useRetainedState';
import {ArrowRight} from 'lucide-react';
import type {Selection} from '@/lib/reader-model';
import type {LocalSourceReference} from '@/lib/reader-local-contract';
import {localSourceKey} from '@/lib/reader-source-key';
import type {BookContentEntry} from '@/lib/reader-contents';
import {discoveryThemePresets,promptAfterThemeChange} from '@/lib/reader-prompts';
import StoryChapterPicker from './StoryChapterPicker';
import './story-discovery.css';

export const discoveryThemes=[...discoveryThemePresets,'其他'];
export default function StoryDiscoveryForm({selection,books,semanticIndexBooks,busy,error,onBookChange,onSubmit,retainKey}:{selection:Selection;books:{id:string;title:string}[];semanticIndexBooks?:readonly {id:string}[];busy:boolean;error:string;onBookChange:(bookId:string)=>void;onSubmit:(selection:Selection)=>Promise<void>;retainKey?:string}){
 const part=(name:string)=>retainKey&&retainKey+':'+name;
 const custom=selection.theme!=='原典故事'&&!discoveryThemes.includes(selection.theme);
 const [draft,setDraft]=useRetainedState(part('draft'),()=>({...selection,theme:custom?'其他':selection.theme}));
 const [sources,setSources]=useRetainedState<LocalSourceReference[]>(part('sources'),selection.discoverySources||[]),[limited,setLimited]=useRetainedState(part('limited'),!!selection.discoverySources?.length);
 const [customTheme,setCustomTheme]=useRetainedState(part('theme'),custom?selection.theme:'');
 const local=draft.bookId!=='other';
 const initialTitle=selection.discovery?.mode==='title'?selection.discovery.title:undefined;
 const initialManualTitle=selection.discovery?.mode==='title';
 const [manualTitle,setManualTitle]=useRetainedState(part('manual-title'),initialManualTitle);
 const [title,setTitle]=useRetainedState(part('title'),initialTitle||'');
 const byTitle=local&&manualTitle;
 // 打开时的选择；与草稿一起保留，跨布局重新挂载后仍按打开时比较
 const [opened]=useRetainedState(part('opened'),()=>JSON.stringify([{...selection,theme:custom?'其他':selection.theme},custom?selection.theme:'',selection.discoverySources||[],!!selection.discoverySources?.length]));
 const dirty=JSON.stringify([draft,customTheme,sources,limited])!==opened||local&&manualTitle!==initialManualTitle||byTitle&&title!==(initialTitle||'');
 function changeBook(bookId:string){
  setDraft(old=>({...old,bookId,storyTitle:undefined,source:undefined,discoverySources:undefined}));
  setSources([]);setLimited(false);onBookChange(bookId);
 }
 function useWholeBook(){
  if(!limited)return;
  setLimited(false);setSources([]);
  setDraft(old=>old.source?{...old,storyTitle:undefined,source:undefined}:old);
 }
 function select(entry:BookContentEntry){
  const source=entry.source;if(!source)return;
  const key=localSourceKey(source);
  setSources(old=>{
   const current=old.length?old:draft.source?[draft.source]:[];
   return current.some(item=>localSourceKey(item)===key)?current.filter(item=>localSourceKey(item)!==key):current.length<24?[...current,source]:current;
  });
  setDraft(old=>({...old,storyTitle:undefined,source:undefined}));
 }
 const theme=draft.theme==='其他'?customTheme.trim():draft.theme;
 const invalid=byTitle&&!title.trim()||draft.bookId==='other'&&!draft.customBook?.trim()||draft.theme==='其他'&&!theme||limited&&!draft.source&&!sources.length;
 async function submit(){
  if(busy||invalid)return;
  await onSubmit({...draft,discovery:byTitle?{mode:'title',title:title.trim()}:{mode:'auto'},theme:theme||'原典故事',storyTitle:undefined,source:undefined,discoverySources:limited?(sources.length?sources:draft.source?[draft.source]:undefined):undefined,length:'auto',voice:false});
 }
 return <>
  <span hidden data-dirty={dirty?'true':undefined}/>
  <p className="yu-sheet-intro">主题和原文范围都可选。确认标题方式后，即可开始提取。</p>
  <div className="yu-choice-label">从哪本书出发</div>
  <div className="yu-options" role="group" aria-label="选择书籍">{books.map(book=><button type="button" key={book.id} disabled={busy} aria-pressed={draft.bookId===book.id} className={draft.bookId===book.id?'selected':''} onClick={()=>changeBook(book.id)}>{semanticIndexBooks?.some(index=>index.id===book.id)?<strong>{book.title}</strong>:book.title}</button>)}</div>
  {!local&&<label className="yu-custom-input">书名或公开网页 URL<input disabled={busy} maxLength={500} value={draft.customBook||''} placeholder="例如：三言二拍，或 https://…" onChange={event=>setDraft(old=>({...old,customBook:event.target.value}))}/></label>}
  {local&&<>
   <div className="yu-choice-label">原文范围（可选）</div>
   <div className="yu-options" role="group" aria-label="原文范围">
    <button type="button" disabled={busy} aria-pressed={!limited} className={!limited?'selected':''} onClick={useWholeBook}>全书</button>
    <button type="button" disabled={busy} aria-pressed={limited} className={limited?'selected':''} onClick={()=>setLimited(true)}>选择章节</button>
   </div>
   {limited&&<StoryChapterPicker key={draft.bookId} bookId={draft.bookId} sources={sources.length?sources:draft.source?[draft.source]:[]} disabled={busy} onSelect={select}/>}
  </>}
  <div className="yu-choice-label">主题（可选）</div>
  <div className="yu-options" role="group" aria-label="故事主题">{['原典故事',...discoveryThemes].map(value=><button type="button" key={value} disabled={busy} aria-pressed={draft.theme===value} className={draft.theme===value?'selected':''} onClick={()=>setDraft(old=>({...old,theme:value,productionPrompt:promptAfterThemeChange(old.productionPrompt,old.theme==='其他'?customTheme:old.theme,value)}))}>{value==='原典故事'?'不限定主题':value}</button>)}</div>
  {draft.theme==='其他'&&<label className="yu-custom-input">写下想看的主题<input disabled={busy} maxLength={100} value={customTheme} placeholder="例如：善良的人如何守住底线" onChange={event=>setCustomTheme(event.target.value)}/></label>}
  <p className="yu-choice-footnote">{byTitle?'按标题寻找完整故事，主题用于讲述重点。':'按主题筛选故事；选择“不限定主题”可自由发现。'}</p>
  {local&&<>
   <div className="yu-choice-label">标题方式</div>
   <div className="yu-options" role="group" aria-label="标题方式">
    <button type="button" disabled={busy} aria-pressed={!byTitle} className={!byTitle?'selected':''} onClick={()=>setManualTitle(false)}>自动标题</button>
    <button type="button" disabled={busy} aria-pressed={byTitle} className={byTitle?'selected':''} onClick={()=>setManualTitle(true)}>输入标题</button>
   </div>
   {byTitle&&<label className="yu-custom-input">故事标题<input disabled={busy} placeholder="例如：宋公明三败高俅" maxLength={100} value={title} onChange={event=>setTitle(event.target.value)}/></label>}
  </>}
  <button type="button" className="yu-primary yu-discovery-submit" disabled={busy||!!invalid} onClick={()=>void submit()}>{busy?'正在保存任务…':byTitle?'按标题提取':'开始提取'}<ArrowRight size={19}/></button>
  <p className="yu-choice-footnote">《{local?books.find(book=>book.id===draft.bookId)?.title:draft.customBook||'自选书籍'}》 · {limited?'指定原文范围':'全书'}{theme&&theme!=='原典故事'?` · ${theme}`:''}</p>
  {error&&<div className="yu-unavailable" role="alert"><strong>任务暂未保存</strong><p>{error}</p></div>}
 </>;
}
