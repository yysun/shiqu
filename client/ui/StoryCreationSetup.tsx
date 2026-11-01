// Keep discovery in the story picker; a chosen story enters one continuous production flow.
// Edits are saved as a draft on the side; only a recommendation or final confirmation starts work.
// Discovery continues one story at a time while open, and stops when a story is chosen or the picker closes.
import {useEffect,useRef,useState} from 'react';
import type {ComponentProps} from 'react';
import {Loader2} from 'lucide-react';
import type {SessionView} from '@/lib/reader-model';
import type {IntakeCommand} from '@/lib/reader-intake';
import {getArtStyle} from '@/lib/reader-styles';
import {generationProgress} from '@/lib/generation-progress';
import StoryProductionEditor,{StoryEditorTabs} from './StoryProductionEditor';
import type {StoryEditorTab} from './StoryProductionEditor';
import Sheet from './StorySheet';
import StorySource from './StorySource';
import StoryGenerationStatus from './StoryGenerationStatus';
import StoryGenerationControl from './StoryGenerationControl';
import StoryRetry from './StoryRetry';
import './story-revision.css';
type SetupTab=Exclude<StoryEditorTab,'script'>;
type Props={session:SessionView;book:string;busy:boolean;onAction:(command:IntakeCommand)=>Promise<void>;progress:Omit<ComponentProps<typeof StoryGenerationStatus>,'session'|'timeline'|'stages'|'children'|'compact'>};
// Stable titles prevent the initial discovery snapshot from flashing a production screen.
export function storyCreationTitle(session:SessionView){return session.intake?(session.intake.selected?'故事流程':'选择故事'):session.story?.title||session.selection.storyTitle||'你的故事，正在展开';}
const savedSettings=(session:SessionView)=>session.intake!.draft||{artStyle:session.selection.artStyle,productionPrompt:session.selection.productionPrompt,narrativeDetail:session.selection.narrativeDetail||'balanced' as const,length:session.frameRecommendation?.count||8};
export default function StoryCreationSetup({session,book,busy,onAction,progress}:Props){
 const intake=session.intake!,saved=savedSettings(session),savedKey=JSON.stringify(saved);
 const [error,setError]=useState('');
 const [finding,setFinding]=useState(false);
 const [editing,setEditing]=useState<SetupTab|null>(null),[choosing,setChoosing]=useState(false),[sourceOpen,setSourceOpen]=useState(false);
 const [settings,setSettings]=useState(saved),[remote,setRemote]=useState(false);
 const baseline=useRef(savedKey),own=useRef(false),shown=useRef(session.id);
 useEffect(()=>{
  const mine=own.current,same=shown.current===session.id;own.current=false;shown.current=session.id;
  // Another device changed what is saved. Unsaved edits stay until the reader decides between them.
  if(same&&!mine&&JSON.stringify(settings)!==baseline.current){setRemote(true);return;}
  baseline.current=savedKey;setSettings(saved);setRemote(false);
  if(!same||mine){setSourceOpen(false);setEditing(null);setError('');}
 },[session.id,intake.generation,savedKey]);
 const search=intake.search,paused=!!session.generationControl&&session.generationControl!=='active';
 const searching=finding||search.state==='searching';
 const locked=busy||session.state==='running'&&!paused,ready=intake.phase==='confirming';
 const editable=ready||paused&&intake.phase==='preparing';
 const candidates=intake.batches.flatMap((saved,batchIndex)=>saved.stories.map((candidate,index)=>({candidate,batchIndex,index})));
 const selected=intake.selected?intake.batches[intake.selected.batch]?.stories[intake.selected.index]:null;
 const preparable=!!selected&&intake.phase==='choosing'&&session.state!=='failed';
 const preferences={artStyle:settings.artStyle,productionPrompt:settings.productionPrompt,narrativeDetail:settings.narrativeDetail};
 async function act(command:IntakeCommand){
  setError('');
  if(command.action==='more')setFinding(true);else own.current=true;
  try{await onAction(command);return true;}
  catch(e){own.current=false;setError(e instanceof Error?e.message:'操作暂未保存，请重试。');return false;}
  finally{if(command.action==='more')setFinding(false);}
 }
 const isSelected=(batchIndex:number,index:number)=>intake.selected?.batch===batchIndex&&intake.selected.index===index;
 async function select(batchIndex:number,index:number){
  // The story already being prepared or waiting here has nothing to redo.
  if(isSelected(batchIndex,index)&&['preparing','confirming'].includes(intake.phase)){setChoosing(false);return;}
  if(await act({action:'choose',batch:batchIndex,index,...(selected?{settings:preferences}:{})}))setChoosing(false);
 }
 function closeEditor(){setEditing(null);if(JSON.stringify(settings)!==baseline.current&&!busy&&!remote)void act({action:'draft',settings});}
 function adoptRemote(){baseline.current=savedKey;setSettings(saved);setRemote(false);}
 function keepEdits(){baseline.current=savedKey;setRemote(false);void act({action:'draft',settings});}
 const remoteChoice=remote&&<div className="yu-revision-conflict-note" role="status"><p>另一台设备更新了制作内容。你的修改还没有保存。</p><div className="yu-revision-buttons"><button type="button" disabled={busy} onClick={adoptRemote}>采用最新内容</button><button type="button" disabled={busy} onClick={keepEdits}>保留我的修改</button></div></div>;
 const findMore=<button type="button" className="yu-refresh-batch" aria-busy={searching&&!paused} disabled={busy||searching||intake.batches.length>=40} onClick={()=>void act({action:'more'})}>{searching&&!paused&&<Loader2 size={14} className="spin" aria-hidden="true"/>}{searching?(paused?'恢复后继续查找':'正在查找…'):search.state==='failed'?'重试查找':'继续找故事'}</button>;
 const candidateList=<>
  <div className="yu-batch-heading"><h3>已找到 {candidates.length} 篇故事</h3>{findMore}</div>
  <div className="yu-candidate-list">{candidates.map(({candidate,batchIndex,index})=><button type="button" key={`${batchIndex}:${index}`} aria-pressed={isSelected(batchIndex,index)} className={isSelected(batchIndex,index)?'selected':''} disabled={(busy||session.state==='running')&&!isSelected(batchIndex,index)} onClick={()=>void select(batchIndex,index)}><strong>{candidate.title}</strong><span className="yu-candidate-description">{candidate.description}</span>{candidate.sourceLabel&&<small>{candidate.sourceLabel}</small>}<span className="yu-candidate-action">{isSelected(batchIndex,index)?'已选这篇':'选择这篇'}</span></button>)}</div>
  {!searching&&search.state!=='failed'&&(!candidates.length?<p className="yu-candidate-note">还没有找到符合主题的故事，可以继续查找，或换个主题。</p>:intake.batches.at(-1)?.stories.length===0&&<p className="yu-candidate-note">暂时没有找到更多故事，已找到的故事都在上方。</p>)}
  {intake.batches.length>=40&&<p className="yu-candidate-note">已达到候选保存上限，请从已找到的故事中选择，或换个主题。</p>}
 </>;
 const stages=generationProgress(session,Date.now()).steps.map(step=>{
  if(ready&&step.id==='source')return {...step,label:'原文',detail:`画风：${getArtStyle(settings.artStyle).label}`};
  if(ready&&step.id==='count')return {...step,detail:`${settings.length===session.frameRecommendation?.count?'建议 ':''}${settings.length} 幅 · 待确认`};
  return step;
 });
 return <section className="yu-creation-setup" aria-label={selected?'故事流程':'选择故事'}>
  <p className="yu-sheet-intro">《{book}》 · {session.selection.theme}{session.selection.discoverySources?.length?` · 已选 ${session.selection.discoverySources.length} 章`:''}</p>
  {selected?<div className="yu-batch-heading"><h3>{session.selection.storyTitle}</h3><button type="button" className="yu-revision-open" disabled={!ready||busy} onClick={()=>setSourceOpen(true)}>原文</button></div>:<p className="yu-count-help">找到一篇就显示一篇，选中或离开后停止查找。已找到的故事会保留，重开后可继续。</p>}
  {search.state==='searching'&&(paused?<p role="status">查找已暂停，恢复生成后继续。已找到的故事都保留。</p>:<p role="status">正在寻找更多故事，找到后逐篇显示，已有故事可以直接选择。{intake.progress?.currentChapters?.length?`正在翻阅：${intake.progress.currentChapters.join('、')}`:''}{intake.progress?.completedChars?`已读 ${intake.progress.completedChars.toLocaleString('zh-CN')} 字。`:''}</p>)}
  {search.state==='failed'&&<div className="yu-batch-error" role="alert"><p>这次查找未完成。{search.error}</p><p>已找到的故事和已选内容都保留，可以重试查找，也可以直接继续。</p>{selected&&findMore}</div>}
  {!editing&&remoteChoice}
  {!selected&&(intake.batches.length>0||search.state==='failed')&&candidateList}
  {selected?<StoryGenerationStatus session={session} {...progress} compact={ready} control={ready?null:undefined} stages={stages} timeline={{
   links:{source:[{label:'重新选择故事',onClick:()=>{if(!busy)setChoosing(true);}},...(editable?[{label:'制作要求（可选）',onClick:()=>setEditing('requirements')}]:[])]},
   detailActions:editable?{source:{label:'修改画风',onClick:()=>setEditing('style')}}:undefined,
   actions:editable?{count:{label:'修改幅数',onClick:()=>setEditing('count')}}:undefined
  }}>
   {ready&&<><button type="button" className="yu-primary" disabled={busy||session.state==='running'} onClick={()=>void act({action:'confirm',settings})}>{busy?'正在保存…':paused?'恢复生成':'开始制作'}</button></>}
   {preparable&&<button type="button" className="yu-primary" disabled={busy||session.state==='running'} onClick={()=>void act({action:'choose',batch:intake.selected!.batch,index:intake.selected!.index,settings:preferences})}>准备这篇</button>}
  </StoryGenerationStatus>:<>
   {(session.error||progress.error)&&<p className="yu-batch-error" role="alert">{progress.error||session.error}</p>}
   {(session.state==='failed'||!!progress.error)&&<StoryRetry session={session} busy={progress.busy} onRetry={progress.onRetry}/>}
   {paused&&<StoryGenerationControl session={session} busy={progress.controlBusy} onControl={progress.onControl} primary/>}
   <button type="button" className="yu-generation-later" onClick={progress.onBack}>稍后从书架继续</button>
  </>}
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
  {choosing&&<Sheet title="重新选择故事" busy={busy} onClose={()=>setChoosing(false)}>{candidateList}{error&&<p role="alert">{error}</p>}</Sheet>}
  {sourceOpen&&<Sheet title="故事原文" onClose={()=>setSourceOpen(false)}><StorySource sessionId={session.id} book={book}/></Sheet>}
  {editing&&<Sheet title="修改故事" busy={busy} onClose={closeEditor}>
   {remoteChoice}
   <StoryEditorTabs tab={editing} disabled={locked} onChange={tab=>{if(tab!=='script')setEditing(tab);}}/>
   <StoryProductionEditor tab={editing} settings={settings} creation disabled={locked} recommendation={session.frameRecommendation} artRecommendation={selected?.artRecommendation} onChange={patch=>setSettings(s=>({...s,...patch}))} onRecommend={ready&&session.state!=='running'?()=>void act({action:'recommend',settings:preferences}):undefined}/>
   {error&&<p className="yu-batch-error" role="alert">{error}</p>}
   <button type="button" className="yu-primary" disabled={busy} onClick={closeEditor}>完成编辑</button><p className="yu-revision-note">设置会保存在这里，离开后也保留；确认制作后才开始生成。</p>
  </Sheet>}
 </section>;
}
