// Edit the extraction target with one contextual hint above its action; typing never starts a search.
// 传入 retainKey 时输入跨布局切换保留；只有会话或目标标题真正变化时才重置输入。
// 输入的标题与目标标题不同时表单带 data-dirty（返回关闭前询问）。
import {useEffect} from 'react';
import {useRetainedState,hasRetained,retainedValue,retain} from './useRetainedState';
import './story-discovery.css';

export default function StoryExtractionSearch({sessionId,title,local,busy,hasCandidates,onSearch,retainKey}:{sessionId:string;title?:string;local:boolean;busy:boolean;hasCandidates:boolean;onSearch:(title:string)=>Promise<boolean>;retainKey?:string}){
 const part=(name:string)=>retainKey&&retainKey+':'+name;
 const [draft,setDraft]=useRetainedState(part('draft'),title||'');
 const [mode,setMode]=useRetainedState<'auto'|'input'>(part('mode'),title?'input':'auto');
 useEffect(()=>{
  const source=sessionId+'\n'+(title||'');
  if(hasRetained(part('for'))&&retainedValue(part('for')!)===source)return;
  retain(part('for'),source);setDraft(title||'');setMode(title?'input':'auto');
 },[sessionId,title]);
 const target=draft.trim();
 const invalid=busy||mode==='input'&&(!local||!target);
 const dirty=mode==='input'&&target!==(title||'').trim();
 return <form className="yu-extraction-query" aria-label="故事提取条件" data-dirty={dirty?'true':undefined} onSubmit={event=>{event.preventDefault();if(!invalid)void onSearch(mode==='input'?target:'');}}>
  <div className="yu-choice-label">标题方式</div>
  <div className="yu-options" role="group" aria-label="标题方式"><button type="button" disabled={busy} aria-pressed={mode==='auto'} className={mode==='auto'?'selected':''} onClick={()=>setMode('auto')}>自动标题</button><button type="button" disabled={busy||!local} aria-pressed={mode==='input'} className={mode==='input'?'selected':''} onClick={()=>setMode('input')}>输入标题</button></div>
  {mode==='input'&&<label className="yu-custom-input">故事标题<input disabled={busy||!local} required maxLength={100} value={draft} placeholder="例如：宋公明三败高俅" onChange={event=>setDraft(event.target.value)}/></label>}
  <p className="yu-extraction-help">{hasCandidates?'重新提取会替换当前候选。':mode==='input'?'按标题寻找完整故事，主题用于讲述重点。':'按所选原文和主题寻找故事，并自动拟题。'}</p>
  <button type="submit" className="yu-primary yu-discovery-submit" disabled={invalid} aria-busy={busy}>{busy?'正在保存查找条件…':mode==='input'?'按标题提取':'开始提取'}</button>
 </form>;
}
