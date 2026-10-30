// Resume saved candidates and confirm all production inputs before releasing the generation gate.
import {useEffect,useState} from 'react';
import type {SessionView} from '@/lib/reader-model';
import type {IntakeCommand} from '@/lib/reader-intake';
import {StoryFrameCountInput,StoryNarrativeDetail} from './StoryFrameCount';
import StoryArtStylePicker from './StoryArtStylePicker';
import {StoryArtRecommendation} from './StoryArtRecommendation';
import {request} from './shared';
import './story-revision.css';
type Props={session:SessionView;book:string;busy:boolean;onAction:(command:IntakeCommand)=>Promise<void>};
export default function StoryCreationSetup({session,book,busy,onAction}:Props){
 const intake=session.intake!;
 const [batch,setBatch]=useState(intake.selected?.batch??Math.max(0,intake.batches.length-1)),[error,setError]=useState(''),[source,setSource]=useState('');
 const [settings,setSettings]=useState({artStyle:session.selection.artStyle,productionPrompt:session.selection.productionPrompt,narrativeDetail:session.selection.narrativeDetail||'balanced' as const,length:session.frameRecommendation?.count||8});
 useEffect(()=>{setSettings({artStyle:session.selection.artStyle,productionPrompt:session.selection.productionPrompt,narrativeDetail:session.selection.narrativeDetail||'balanced',length:session.frameRecommendation?.count||8});setSource('');setError('');},[session.id,intake.generation,session.frameRecommendation?.count]);
 useEffect(()=>{setBatch(Math.max(0,intake.batches.length-1));},[intake.batches.length]);
 const locked=busy||session.state==='running',candidates=intake.batches[batch]?.stories||[];
 const selected=intake.selected?intake.batches[intake.selected.batch]?.stories[intake.selected.index]:null;
 const preferences={artStyle:settings.artStyle,productionPrompt:settings.productionPrompt,narrativeDetail:settings.narrativeDetail};
 async function act(command:IntakeCommand){setError('');try{await onAction(command);}catch(e){setError(e instanceof Error?e.message:'操作暂未保存，请重试。');}}
 async function original(){setError('');try{const result=await request(`reader/sessions/${session.id}/source`);setSource(result.source?.text||'原文尚未保存。');}catch(e){setError(e instanceof Error?e.message:'原文暂时无法读取。');}}
 return <section className="yu-creation-setup" aria-label="制作确认">
  <p className="yu-sheet-intro">《{book}》 · {session.selection.theme}</p><p className="yu-count-help">书籍和主题已保存到书架，离开后可继续。确认制作内容前不会编排分镜或绘图。</p>
  {intake.phase==='discovering'&&<p role="status">正在提取候选故事，已保存的批次仍可回看。{intake.progress?.currentChapters?.length?`正在翻阅：${intake.progress.currentChapters.join('、')}`:''}{intake.progress?.completedChars?`已读 ${intake.progress.completedChars.toLocaleString('zh-CN')} 字。`:''}</p>}
  {intake.batches.length>0&&<>
   <div className="yu-batch-heading"><h3>选择故事</h3><button type="button" className="yu-refresh-batch" disabled={locked||intake.phase==='discovering'||intake.batches.length>=40} onClick={()=>void act({action:'more',...(selected?{settings:preferences}:{})})}>再找一批</button></div>
   {intake.batches.length>1&&<label className="yu-revision-field">候选批次<select value={batch} onChange={e=>setBatch(Number(e.target.value))}>{intake.batches.map((_,index)=><option key={index} value={index}>第 {index+1} 批</option>)}</select></label>}
   <div className="yu-candidate-list">{candidates.map((candidate,index)=><button type="button" key={index} aria-pressed={intake.selected?.batch===batch&&intake.selected.index===index} className={intake.selected?.batch===batch&&intake.selected.index===index?'selected':''} disabled={locked} onClick={()=>void act({action:'choose',batch,index,...(selected?{settings:preferences}:{})})}><strong>{candidate.title}</strong><span className="yu-candidate-description">{candidate.description}</span>{candidate.sourceLabel&&<small>{candidate.sourceLabel}</small>}<span className="yu-candidate-action">{intake.selected?.batch===batch&&intake.selected.index===index?'已选这篇':'选择这篇'}</span></button>)}</div>
   {intake.batches[batch]?.note&&<p className="yu-candidate-note">{intake.batches[batch].note}</p>}
  </>}
  {intake.phase==='preparing'&&<p role="status">已选《{session.selection.storyTitle}》，正在保存原文并推荐幅数。</p>}
  {intake.phase==='confirming'&&<fieldset disabled={locked} className="yu-revision-fields">
   <h3>制作确认 · {session.selection.storyTitle}</h3>
   <button type="button" className="yu-revision-open" onClick={()=>void original()}>查看原文</button>{source&&<details open><summary>已保存的原文</summary><p className="yu-original">{source}</p></details>}
   <StoryNarrativeDetail value={settings.narrativeDetail} disabled={locked} onChange={narrativeDetail=>setSettings(s=>({...s,narrativeDetail}))}/>
   {selected?.artRecommendation&&<StoryArtRecommendation recommendation={selected.artRecommendation} selected={settings.artStyle} disabled={locked} onApply={()=>setSettings(s=>({...s,artStyle:selected.artRecommendation!.artStyle}))}/>}
   <StoryArtStylePicker value={settings.artStyle} disabled={locked} onChange={artStyle=>setSettings(s=>({...s,artStyle}))}/>
   <label className="yu-revision-field">制作要求<textarea rows={5} maxLength={1200} value={settings.productionPrompt} onChange={e=>setSettings(s=>({...s,productionPrompt:e.target.value}))}/></label>
   <h3>画幅数</h3><p className="yu-count-help">建议 {session.frameRecommendation?.count} 幅 · {session.frameRecommendation?.reason}</p>
   <StoryFrameCountInput count={settings.length} disabled={locked} onChange={length=>setSettings(s=>({...s,length}))}/>
   <button type="button" className="yu-revision-open" onClick={()=>void act({action:'recommend',settings:preferences})}>按当前要求重新推荐幅数</button>
   <p className="yu-count-help">上方建议对应已保存的制作要求。修改要求或详略后，可重新推荐，也可确认你自行选择的幅数。</p>
   <button type="button" className="yu-primary" onClick={()=>void act({action:'confirm',settings})}>{busy?'正在保存…':`确认制作并生成 ${settings.length} 幅`}</button>
  </fieldset>}
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
 </section>;
}
