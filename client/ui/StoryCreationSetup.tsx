// Keep discovery in the story picker; a chosen story enters one continuous production flow.
// Edits are saved as a draft on the side; only a recommendation or final confirmation starts work.
// Extraction, preparation and human confirmation remain separate, with timings bound to real work.
// 传入 retainKey 时，未保存的设置与打开的子面板跨布局切换保留；恢复后只要服务器保存值未变，就不提示“另一台设备更新了制作内容”。
import StoryFlowAction from './StoryFlowAction';
import {useEffect,useRef,useState} from 'react';
import {useRetainedState,hasRetained,retainedValue,retain} from './useRetainedState';
import type {ComponentProps} from 'react';
import {ArrowLeft} from 'lucide-react';
import type {SessionView} from '@/lib/reader-model';
import type {IntakeCommand} from '@/lib/reader-intake';
import {getArtStyle} from '@/lib/reader-styles';
import {generationProgress} from '@/lib/generation-progress';
import StoryProductionEditor,{StoryEditorTabs} from './StoryProductionEditor';
import type {StoryEditorTab,ProductionSettings} from './StoryProductionEditor';
import Sheet from './StorySheet';
import StoryBackToShelf from './StoryBackToShelf';
import StorySource from './StorySource';
import StoryGenerationStatus from './StoryGenerationStatus';
import StoryExtractionContext from './StoryExtractionContext';
import './story-revision.css';
type SetupTab=Exclude<StoryEditorTab,'script'>;
type Props={session:SessionView;book:string;busy:boolean;onAction:(command:IntakeCommand)=>Promise<unknown>;onBackToDiscovery?:()=>void;progress:Omit<ComponentProps<typeof StoryGenerationStatus>,'session'|'timeline'|'stages'|'children'|'compact'>};
const savedSettings=(session:SessionView)=>session.intake!.draft||{artStyle:session.selection.artStyle,productionPrompt:session.selection.productionPrompt,...(session.selection.acceptancePrompt!==undefined?{acceptancePrompt:session.selection.acceptancePrompt}:{}),narrativeDetail:session.selection.narrativeDetail||'balanced' as const,length:'auto' as const};
export default function StoryCreationSetup({session,book,busy,onAction,onBackToDiscovery,progress,retainKey}:Props&{retainKey?:string}){
 const intake=session.intake!,saved={...savedSettings(session),length:'auto' as const},savedKey=JSON.stringify(saved);
 const [error,setError]=useState('');
 const [finding,setFinding]=useState(false);
 const part=(name:string)=>retainKey&&retainKey+':'+name;
 const [editing,setEditing]=useRetainedState<SetupTab|null>(part('editing'),null),[sourceOpen,setSourceOpen]=useRetainedState(part('source'),false);
 const [settings,setSettings]=useRetainedState(part('settings'),()=>({...saved,length:'auto' as const})),[remote,setRemote]=useRetainedState(part('remote'),false);
 const baseline=useRef(hasRetained(part('baseline'))?retainedValue<string>(part('baseline')!):savedKey),own=useRef(false),shown=useRef(session.id);
 // 布局切换后恢复的挂载：服务器保存值仍等于恢复的基线时保持原样（StrictMode 重复执行也不误报）。
 const restoredBaseline=useRef(hasRetained(part('baseline'))?baseline.current:null);
 useEffect(()=>{
  const mine=own.current,same=shown.current===session.id;own.current=false;shown.current=session.id;
  if(restoredBaseline.current!==null){if(savedKey===restoredBaseline.current)return;restoredBaseline.current=null;}
  // Another device changed what is saved. Unsaved edits stay until the reader decides between them.
  if(same&&!mine&&JSON.stringify(settings)!==baseline.current){setRemote(true);return;}
  baseline.current=savedKey;retain(part('baseline'),savedKey);setSettings({...saved,length:'auto'});setRemote(false);
  if(!same||mine){setSourceOpen(false);setEditing(null);setError('');}
 },[session.id,intake.generation,savedKey]);
 const search=intake.search,paused=!!session.generationControl&&session.generationControl!=='active';
 const searching=finding||search.state==='searching';
 const locked=busy||session.state==='running'&&!paused,ready=intake.phase==='confirming';
 const editable=ready||paused&&intake.phase==='preparing';
 const selected=intake.selected?intake.batches[intake.selected.batch]?.stories[intake.selected.index]:null;
 const preparable=!!selected&&intake.phase==='choosing'&&session.state!=='failed';
 const preferences={artStyle:settings.artStyle,productionPrompt:settings.productionPrompt,...(settings.acceptancePrompt!==undefined?{acceptancePrompt:settings.acceptancePrompt}:{}),narrativeDetail:settings.narrativeDetail};
 async function act(command:IntakeCommand){
  setError('');
  if(command.action==='more'||command.action==='search')setFinding(true);else own.current=true;
  try{await onAction(command);return true;}
  catch(e){own.current=false;setError(e instanceof Error?e.message:'操作暂未保存，请重试。');return false;}
  finally{if(command.action==='more'||command.action==='search')setFinding(false);}
 }
 function closeEditor(){setEditing(null);if(JSON.stringify(settings)!==baseline.current&&!busy&&!remote)void act({action:'draft',settings});}
 function adoptRemote(){baseline.current=savedKey;setSettings({...saved,length:'auto'});setRemote(false);}
 function keepEdits(){baseline.current=savedKey;setRemote(false);void act({action:'draft',settings});}
 const remoteChoice=remote&&<div className="yu-revision-conflict-note" role="status"><p>另一台设备更新了制作内容。你的修改还没有保存。</p><div className="yu-revision-buttons"><StoryFlowAction disabled={busy} onClick={adoptRemote}>采用最新内容</StoryFlowAction><StoryFlowAction disabled={busy} onClick={keepEdits}>保留我的修改</StoryFlowAction></div></div>;
 const failedSearch=search.state==='failed';
 const discovery=session.selection.discovery;
 const combining=discovery?.mode==='auto'&&discovery.combine;
 const directSource=!!selected?.source&&!discovery&&!session.selection.discoverySources?.length;
 const preparingSelected=directSource||combining;
 const searchAction=<StoryFlowAction disabled={busy||progress.controlBusy} onClick={()=>{
  if(paused)return progress.onControl(session.id,'resume');
  void act({action:'more'});
 }}>{paused?'恢复整理':'重试整理'}</StoryFlowAction>;
 // The service records preparation as count; confirmation is a human gate with no execution time.
 const {count:preparationSeconds,...workDurations}=session.generationProgress?.stageDurations||{};
 const stageDurations={...workDurations,...(preparationSeconds!==undefined?{prepare:preparationSeconds}:{})};
 const prepared=ready||intake.phase==='confirmed';
 const initialFrameCount=prepared?session.frameRecommendation?.count:undefined;
 const artStyleLabel=getArtStyle(settings.artStyle).label;
 const narrativeLabel=settings.narrativeDetail==='brief'?'简短':settings.narrativeDetail==='detailed'?'详细':'适中';
 const extractionContext=`《${book}》 · ${session.selection.theme==='原典故事'?'不限定主题':`主题：${session.selection.theme}`}${session.selection.discoverySources?.length?` · 已选 ${session.selection.discoverySources.length} 段原文`:''}`;
 const stages=generationProgress(session,Date.now()).steps.flatMap(step=>{
  if(step.id==='source'&&combining&&!selected)return [{
   ...step,label:'整理所选原文',detail:extractionContext,state:failedSearch?'failed' as const:paused?'paused' as const:'current' as const,
  }];
  if(step.id==='source')return [{...step,label:combining||directSource?'已选原文':'提取故事',detail:directSource?selected?.sourceLabel||`《${book}》`:extractionContext}];
  if(step.id==='count')return [
   {id:'prepare',label:'准备故事',state:prepared?'done' as const:combining&&!selected?'pending' as const:step.state,detail:prepared?(session.frameRecommendation?.storySummary?'原文与梗概已核对':'原文与制作建议已保存'):preparable?'待准备这篇故事':preparingSelected?'规划标题、画幅数和画风':'保存原文，核对梗概与制作建议'},
   {...step,state:prepared?step.state:'pending' as const,detail:initialFrameCount===undefined?'等待准备完成':`预计 ${initialFrameCount} 幅 · 最终幅数由编排与审核确定`},
  ];
  return [step];
 });
 if(combining&&!selected)return <section className="yu-creation-setup" aria-label="准备故事">
  <StoryExtractionContext selection={session.selection} book={book} backAction={onBackToDiscovery&&
   <StoryFlowAction disabled={busy} onClick={onBackToDiscovery}><ArrowLeft size={14} aria-hidden="true"/>返回选材</StoryFlowAction>}/>
  <StoryGenerationStatus session={session} {...progress} compact hideBack stages={stages} timeline={{stageDurations}}
   control={searching&&!paused?<StoryFlowAction disabled={progress.controlBusy} onClick={()=>void progress.onControl(session.id,'pause')}>暂停整理</StoryFlowAction>:null}
   stageContent={{source:failedSearch?<div role="alert"><p>{search.error}</p>{searchAction}</div>:
    paused?<div><p role="status">故事整理已暂停。</p>{searchAction}</div>:
    <p role="status">正在将所选原文整理为一篇故事…</p>}}/>
  {error&&<p role="alert">{error}</p>}
  {!progress.hideBack&&<StoryBackToShelf onBack={progress.onBack}/>}
 </section>;
 if(!selected)return null;
 return <section className="yu-creation-setup" aria-label="故事流程">
  {selected&&session.selection.storyTitle!=='待拟标题'&&progress.showSummary!==false&&<div className="yu-batch-heading"><h3>{session.selection.storyTitle}</h3></div>}
  {selected&&preparingSelected&&<div className="yu-selected-story-card">
   {!session.frameRecommendation?.storySummary&&intake.phase==='preparing'&&<p role="status">故事梗概准备中</p>}
   <StoryFlowAction disabled={busy||!session.generationProgress?.sourceReady} onClick={()=>setSourceOpen(true)}>查看原文</StoryFlowAction>
  </div>}
  <StoryGenerationStatus session={session} {...progress} navigation={undefined} compact={ready||preparingSelected} control={ready?null:undefined} stages={stages} timeline={{stageDurations}} stageContent={{source:<>
   {!preparingSelected&&<div className="yu-extraction-actions" role="group" aria-label="故事来源操作">
    <StoryFlowAction disabled={busy||!ready&&!session.generationProgress?.sourceReady} onClick={()=>setSourceOpen(true)}>原文</StoryFlowAction>
   </div>}
  </>,prepare:<>
   {preparable&&<StoryFlowAction type="button" className="yu-primary" disabled={busy||session.state==='running'} onClick={()=>void act({action:'choose',batch:intake.selected!.batch,index:intake.selected!.index,settings:preferences})}>准备这篇</StoryFlowAction>}
  </>,count:<>
   {!editing&&remoteChoice}
   {error&&<p className="yu-batch-error" role="alert">{error}</p>}
   {editable&&<div className="yu-confirmation-settings" role="group" aria-label="制作设置">
    <StoryFlowAction disabled={locked} onClick={()=>setEditing('requirements')}>制作要求</StoryFlowAction>
    <StoryFlowAction disabled={locked} onClick={()=>setEditing('acceptance')}>验收要求</StoryFlowAction>
    <StoryFlowAction disabled={locked} aria-label="修改画风" onClick={()=>setEditing('style')}>画风：{artStyleLabel}</StoryFlowAction>
    <StoryFlowAction disabled={locked} aria-label="修改叙事详略" onClick={()=>setEditing('count')}>叙事详略：{narrativeLabel}</StoryFlowAction>
   </div>}
   {ready&&<StoryFlowAction disabled={busy||session.state==='running'} onClick={()=>void act({action:'confirm',settings})}>{busy?'正在保存…':'开始制作'}</StoryFlowAction>}
  </>}}/>
  {sourceOpen&&<Sheet title="故事原文" onClose={()=>setSourceOpen(false)}><StorySource sessionId={session.id} book={book}/></Sheet>}
  {editing&&<Sheet title="修改故事" busy={busy} onClose={closeEditor}>
   {remoteChoice}
   <StoryEditorTabs tab={editing} disabled={locked} onChange={tab=>{if(tab!=='script')setEditing(tab);}}/>
   <StoryProductionEditor sessionId={session.id} tab={editing} settings={settings} creation disabled={locked} recommendation={session.frameRecommendation} artRecommendation={selected?.artRecommendation} onChange={patch=>setSettings(s=>({...s,...patch,length:'auto'}))} onRecommend={ready&&session.state!=='running'?()=>void act({action:'recommend',settings:preferences}):undefined}/>
   {error&&<p className="yu-batch-error" role="alert">{error}</p>}
   <button type="button" className="yu-primary" disabled={busy} onClick={closeEditor}>完成编辑</button><p className="yu-revision-note">设置会保存在这里，离开后也保留；确认制作后才开始生成。</p>
  </Sheet>}
 </section>;
}
