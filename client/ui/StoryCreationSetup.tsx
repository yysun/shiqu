// Keep discovery in the story picker; a chosen story enters one continuous production flow.
// Edits are saved as a draft on the side; only a recommendation or final confirmation starts work.
// 选材单独显示。准备和人工确认依次出现在同一个步骤。
// 传入 retainKey 时，未保存的设置与打开的子面板跨布局切换保留；恢复后只要服务器保存值未变，就不提示“另一台设备更新了制作内容”。
import {isDirectSourceSelection} from '@/lib/reader-discovery-themes';
import StoryFlowAction from './StoryFlowAction';
import {useEffect,useRef,useState} from 'react';
import {useRetainedState,hasRetained,retainedValue,retain} from './useRetainedState';
import type {ComponentProps} from 'react';
import {ArrowLeft} from 'lucide-react';
import type {SessionView} from '@/lib/reader-model';
import {intakeDraftToken,type IntakeCommand} from '@/lib/reader-intake';
import {getArtStyle} from '@/lib/reader-styles';
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
function savedSettings(session:SessionView):ProductionSettings{
 const settings=session.intake!.draft??session.selection;
 return {
  artStyle:settings.artStyle,artStylePrompt:settings.artStylePrompt,productionPrompt:settings.productionPrompt,
  acceptancePrompt:settings.acceptancePrompt,narrativeDetail:settings.narrativeDetail??'balanced',length:'auto',
 };
}
export default function StoryCreationSetup({session,book,busy,onAction,onBackToDiscovery,progress,retainKey}:Props&{retainKey?:string}){
 const intake=session.intake!,saved={...savedSettings(session),length:'auto' as const},savedKey=intakeDraftToken(saved);
 const [error,setError]=useState('');
 const [finding,setFinding]=useState(false);
 const part=(name:string)=>retainKey&&retainKey+':'+name;
 const [editing,setEditing]=useRetainedState<SetupTab|null>(part('editing'),null),[sourceOpen,setSourceOpen]=useRetainedState(part('source'),false);
 const [settings,setSettings]=useRetainedState(part('settings'),()=>({...saved,length:'auto' as const})),[remote,setRemote]=useRetainedState(part('remote'),false);
 const baseline=useRef(hasRetained(part('baseline'))?retainedValue<string>(part('baseline')!):savedKey),shown=useRef(session.id);
 const baselineToken=useRef(hasRetained(part('baseline-token'))?retainedValue<string|undefined>(part('baseline-token')!):intake.draftToken);
 function rememberSaved(){
  baseline.current=savedKey;baselineToken.current=intake.draftToken;
  retain(part('baseline'),savedKey);retain(part('baseline-token'),intake.draftToken);
 }
 useEffect(()=>{
  const same=shown.current===session.id;shown.current=session.id;
  if(same&&savedKey===baseline.current&&intake.draftToken===baselineToken.current)return;
  const localKey=intakeDraftToken(settings);
  if(same&&localKey!==baseline.current&&localKey!==savedKey){setRemote(true);return;}
  rememberSaved();setSettings(saved);setRemote(false);
  if(!same){setSourceOpen(false);setEditing(null);setError('');}
 },[session.id,intake.generation,intake.draftToken,savedKey]);
 const search=intake.search,paused=!!session.generationControl&&session.generationControl!=='active';
 const searching=finding||search.state==='searching';
 const locked=busy||session.state==='running'&&!paused,ready=intake.phase==='confirming';
 const editable=ready||paused&&intake.phase==='preparing';
 const selected=intake.selected?intake.batches[intake.selected.batch]?.stories[intake.selected.index]:null;
 const preparable=!!selected&&intake.phase==='choosing'&&session.state!=='failed';
 const preferences={artStyle:settings.artStyle,artStylePrompt:settings.artStylePrompt,productionPrompt:settings.productionPrompt,...(settings.acceptancePrompt!==undefined?{acceptancePrompt:settings.acceptancePrompt}:{}),narrativeDetail:settings.narrativeDetail};
 async function act(command:IntakeCommand){
  setError('');
  if(command.action==='more'||command.action==='search')setFinding(true);
  try{await onAction(command);return true;}
  catch(e){setError(e instanceof Error?e.message:'操作暂未保存，请重试。');return false;}
  finally{if(command.action==='more'||command.action==='search')setFinding(false);}
 }
 function closeEditor(){setEditing(null);if(intakeDraftToken(settings)!==baseline.current&&!busy&&!remote)void act({action:'draft',settings,draftToken:baselineToken.current});}
 function adoptRemote(){rememberSaved();setSettings(saved);setRemote(false);setError('');}
 async function keepEdits(){
  if(await act({action:'draft',settings,draftToken:intake.draftToken}))setRemote(false);
 }
 const remoteChoice=remote&&<div className="yu-revision-conflict-note" role="status"><p>另一台设备更新了制作内容。你的修改还没有保存。</p><div className="yu-revision-buttons"><StoryFlowAction disabled={busy} onClick={adoptRemote}>采用最新内容</StoryFlowAction><StoryFlowAction disabled={busy} onClick={keepEdits}>保留我的修改</StoryFlowAction></div></div>;
 const failedSearch=search.state==='failed';
 const discovery=session.selection.discovery;
 const combining=discovery?.mode==='auto'&&discovery.combine;
 const directSource=!!selected?.source&&isDirectSourceSelection(session.selection);
 const preparingSelected=directSource||combining;
 const searchAction=<StoryFlowAction disabled={busy||progress.controlBusy} onClick={()=>{
  if(paused)return progress.onControl(session.id,'resume');
  void act({action:'more'});
 }}>{paused?'恢复整理':'重试整理'}</StoryFlowAction>;
 const artStyleLabel=getArtStyle(settings.artStyle).label;
 const narrativeLabel=settings.narrativeDetail==='brief'?'简短':settings.narrativeDetail==='detailed'?'详细':'适中';
 if(combining&&!selected)return <section className="yu-creation-setup" aria-label="准备故事">
  <StoryExtractionContext selection={session.selection} book={book} backAction={onBackToDiscovery&&
   <StoryFlowAction disabled={busy} onClick={onBackToDiscovery}><ArrowLeft size={14} aria-hidden="true"/>返回选材</StoryFlowAction>}/>
  <StoryGenerationStatus session={session} {...progress} compact hideBack
   control={searching&&!paused?<StoryFlowAction disabled={progress.controlBusy} onClick={()=>void progress.onControl(session.id,'pause')}>暂停整理</StoryFlowAction>:null}
   stageContent={{source:failedSearch?<div role="alert"><p>{search.error}</p><div className="production-stage-actions">{searchAction}</div></div>:
    paused?<div><p role="status">故事整理已暂停。</p><div className="production-stage-actions">{searchAction}</div></div>:
    <p role="status">正在将所选原文整理为一篇故事…</p>}}/>
  {error&&<p role="alert">{error}</p>}
  {!progress.hideBack&&<StoryBackToShelf onBack={progress.onBack}/>}
 </section>;
 if(!selected)return null;
 return <section className="yu-creation-setup" aria-label="故事流程">
  {selected&&session.selection.storyTitle!=='待拟标题'&&progress.showSummary!==false&&<div className="yu-batch-heading"><h3>{session.selection.storyTitle}</h3></div>}
  <StoryGenerationStatus session={session} {...progress} navigation={undefined} compact={ready||preparingSelected} control={ready?null:undefined}
   timeline={{links:{source:[{label:'查看原文',disabled:busy||!session.generationProgress?.sourceReady,onClick:()=>setSourceOpen(true)}]}}} stageContent={{count:<>
   {!editing&&remoteChoice}
   {error&&<p className="yu-batch-error" role="alert">{error}</p>}
   {editable&&<div className="production-stage-actions production-stage-actions--settings" role="group" aria-label="制作设置">
    <StoryFlowAction disabled={locked} onClick={()=>setEditing('requirements')}>制作要求</StoryFlowAction>
    <StoryFlowAction disabled={locked} onClick={()=>setEditing('acceptance')}>验收要求</StoryFlowAction>
    <StoryFlowAction disabled={locked} aria-label={`修改画风，当前${artStyleLabel}`} onClick={()=>setEditing('style')}><span><span className="production-setting-style-prefix">画风·</span>{artStyleLabel}</span></StoryFlowAction>
    <StoryFlowAction disabled={locked} aria-label={`修改叙事详略，当前${narrativeLabel}`} onClick={()=>setEditing('count')}><span><span className="production-setting-narrative-prefix">叙事</span>详略·{narrativeLabel}</span></StoryFlowAction>
   </div>}
   {preparable&&<button type="button" className="yu-primary" disabled={busy||session.state==='running'} onClick={()=>void act({action:'choose',batch:intake.selected!.batch,index:intake.selected!.index,settings:preferences})}>准备这篇</button>}
   {ready&&<StoryFlowAction disabled={busy||remote||session.state==='running'} onClick={()=>void act({action:'confirm',settings,draftToken:baselineToken.current})}>{busy?'正在保存…':'开始制作'}</StoryFlowAction>}
  </>}}/>
  {sourceOpen&&<Sheet title="故事原文" onClose={()=>setSourceOpen(false)}><StorySource sessionId={session.id} book={book}/></Sheet>}
  {editing&&<Sheet title="修改故事" busy={busy} onClose={closeEditor}>
   {remoteChoice}
   <StoryEditorTabs tab={editing} disabled={locked} onChange={tab=>{if(tab!=='script')setEditing(tab);}}/>
   <StoryProductionEditor sessionId={session.id} tab={editing} settings={settings} creation disabled={locked} recommendation={session.frameRecommendation} artRecommendation={selected?.artRecommendation} onChange={patch=>setSettings(s=>({...s,...patch,length:'auto'}))} onRecommend={ready&&!remote&&session.state!=='running'?()=>void act({action:'recommend',settings:preferences,draftToken:baselineToken.current}):undefined}/>
   {error&&<p className="yu-batch-error" role="alert">{error}</p>}
   <button type="button" className="yu-primary" disabled={busy} onClick={closeEditor}>完成编辑</button><p className="yu-revision-note">设置会保存在这里，离开后也保留；确认制作后才开始生成。</p>
  </Sheet>}
 </section>;
}
