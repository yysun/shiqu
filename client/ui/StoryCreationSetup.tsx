// Keep discovery in the story picker; a chosen story enters one continuous production flow.
// Edits are saved as a draft on the side; only a recommendation or final confirmation starts work.
// Discovery continues one story at a time while open, and stops when a story is chosen or the picker closes.
// Extraction, preparation and human confirmation remain separate, with timings bound to real work.
// 传入 retainKey 时，未保存的设置与打开的子面板跨布局切换保留；恢复后只要服务器保存值未变，就不提示“另一台设备更新了制作内容”。
import StoryFlowAction from './StoryFlowAction';
import {readingChapterLabel} from '@/lib/reader-suggestions';
import {useEffect,useRef,useState} from 'react';
import {useRetainedState,hasRetained,retainedValue,retain} from './useRetainedState';
import type {ComponentProps} from 'react';
import {ArrowLeft,Loader2} from 'lucide-react';
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
import StoryGenerationControl from './StoryGenerationControl';
import StoryRetry from './StoryRetry';
import StoryExtractionSearch from './StoryExtractionSearch';
import StoryExtractionContext from './StoryExtractionContext';
import './story-revision.css';
type SetupTab=Exclude<StoryEditorTab,'script'>;
type Props={session:SessionView;book:string;busy:boolean;onAction:(command:IntakeCommand)=>Promise<void>;onBackToDiscovery?:()=>void;progress:Omit<ComponentProps<typeof StoryGenerationStatus>,'session'|'timeline'|'stages'|'children'|'compact'>};
// Stable titles prevent the initial discovery snapshot from flashing a production screen.
export function storyCreationTitle(session:SessionView){return session.intake?(session.intake.selected?'故事流程':'选择故事'):session.story?.title||session.selection.storyTitle||'你的故事，正在展开';}
const savedSettings=(session:SessionView)=>session.intake!.draft||{artStyle:session.selection.artStyle,productionPrompt:session.selection.productionPrompt,...(session.selection.acceptancePrompt!==undefined?{acceptancePrompt:session.selection.acceptancePrompt}:{}),narrativeDetail:session.selection.narrativeDetail||'balanced' as const,length:'auto' as const};
export default function StoryCreationSetup({session,book,busy,onAction,onBackToDiscovery,progress,onReplace,retainKey}:Props&{onReplace?:(batch:number,index:number,settings:ProductionSettings)=>Promise<void>;retainKey?:string}){
 const intake=session.intake!,saved={...savedSettings(session),length:'auto' as const},savedKey=JSON.stringify(saved);
 const targetTitle=session.selection.discovery?.mode==='title'?session.selection.discovery.title:undefined;
 const [error,setError]=useState('');
 const [finding,setFinding]=useState(false);
 const part=(name:string)=>retainKey&&retainKey+':'+name;
 const [editing,setEditing]=useRetainedState<SetupTab|null>(part('editing'),null),[choosing,setChoosing]=useRetainedState(part('choosing'),false),[sourceOpen,setSourceOpen]=useRetainedState(part('source'),false);
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
 const candidates=intake.batches.flatMap((saved,batchIndex)=>saved.stories.map((candidate,index)=>({candidate,batchIndex,index})));
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
 // 旧草稿可能停在尚未开始的状态，打开后沿用已保存的提取条件。
 const startedDraft=useRef<string|null>(null);
 useEffect(()=>{
  if(onReplace||busy||paused||selected||search.state!=='idle'||intake.batches.length||startedDraft.current===session.id)return;
  startedDraft.current=session.id;
  void act({action:'more'});
 },[session.id,busy,paused,selected,search.state,intake.batches.length,onReplace]);
 const isSelected=(batchIndex:number,index:number)=>intake.selected?.batch===batchIndex&&intake.selected.index===index;
 async function select(batchIndex:number,index:number){
  if(onReplace){await onReplace(batchIndex,index,{...settings,length:'auto'});return;}
  // The story already being prepared or waiting here has nothing to redo.
  if(isSelected(batchIndex,index)&&['preparing','confirming'].includes(intake.phase)){setChoosing(false);return;}
  if(await act({action:'choose',batch:batchIndex,index,...(selected?{settings:preferences}:{})}))setChoosing(false);
 }
 function closeEditor(){setEditing(null);if(JSON.stringify(settings)!==baseline.current&&!busy&&!remote)void act({action:'draft',settings});}
 function adoptRemote(){baseline.current=savedKey;setSettings({...saved,length:'auto'});setRemote(false);}
 function keepEdits(){baseline.current=savedKey;setRemote(false);void act({action:'draft',settings});}
 const remoteChoice=remote&&<div className="yu-revision-conflict-note" role="status"><p>另一台设备更新了制作内容。你的修改还没有保存。</p><div className="yu-revision-buttons"><StoryFlowAction disabled={busy} onClick={adoptRemote}>采用最新内容</StoryFlowAction><StoryFlowAction disabled={busy} onClick={keepEdits}>保留我的修改</StoryFlowAction></div></div>;
 const findMore=(!targetTitle||search.state==='failed')&&<StoryFlowAction asLink={!!selected} type="button" className="yu-refresh-batch" aria-busy={searching&&!paused} disabled={busy||searching||intake.batches.length>=40} onClick={()=>void act({action:'more'})}>{searching&&!paused&&<Loader2 size={14} className="spin" aria-hidden="true"/>}{searching?(paused?'恢复后继续查找':'正在查找…'):search.state==='failed'?'重试查找':'继续找故事'}</StoryFlowAction>;
 const terminalBatch=intake.batches.at(-1),terminalNote=terminalBatch?.stories.length===0?terminalBatch.note:'';
 const candidateList=<>
  <div className="yu-batch-heading"><h3>已找到 {candidates.length} 篇故事</h3>{findMore}</div>
  <div className="yu-candidate-list">{candidates.map(({candidate,batchIndex,index})=><button type="button" key={`${batchIndex}:${index}`} aria-pressed={isSelected(batchIndex,index)} className={isSelected(batchIndex,index)?'selected':''} disabled={(busy||session.state==='running'&&intake.phase==='preparing')&&!isSelected(batchIndex,index)} onClick={()=>void select(batchIndex,index)}><strong>{candidate.title}</strong><span className="yu-candidate-description">{candidate.description}</span>{candidate.sourceLabel&&<small>{candidate.sourceLabel}</small>}<span className="yu-candidate-action">{isSelected(batchIndex,index)?'已选这篇':onReplace?'选择并替换':'选择这篇'}</span></button>)}</div>
  {!searching&&search.state!=='failed'&&(!candidates.length||terminalBatch?.stories.length===0)&&<p className="yu-candidate-note">{terminalNote||(candidates.length?'暂时没有找到更多故事，已找到的故事都在上方。':'还没有找到符合主题的故事，可以继续查找，或换个主题。')}</p>}
  {intake.batches.length>=40&&<p className="yu-candidate-note">已达到候选保存上限，请从已找到的故事中选择，或换个主题。</p>}
 </>;
 // The service records preparation as count; confirmation is a human gate with no execution time.
 const {count:preparationSeconds,...workDurations}=session.generationProgress?.stageDurations||{};
 const stageDurations={...workDurations,...(preparationSeconds!==undefined?{prepare:preparationSeconds}:{})};
 const prepared=ready||intake.phase==='confirmed';
 const narrativeLabel=settings.narrativeDetail==='brief'?'简短':settings.narrativeDetail==='detailed'?'详细':'适中';
 const extractionContext=`《${book}》 · ${session.selection.theme==='原典故事'?'不限定主题':`主题：${session.selection.theme}`}${session.selection.discoverySources?.length?` · 已选 ${session.selection.discoverySources.length} 段原文`:''}`;
 const stages=generationProgress(session,Date.now()).steps.flatMap(step=>{
  if(step.id==='source')return [{...step,label:'提取故事',detail:extractionContext}];
  if(step.id==='count')return [
   {id:'prepare',label:'准备故事',state:prepared?'done' as const:step.state,detail:prepared?(session.frameRecommendation?.storySummary?'原文与梗概已核对':'原文与制作建议已保存'):preparable?'待准备这篇故事':'保存原文，核对梗概与制作建议'},
   {...step,state:prepared?step.state:'pending' as const,detail:'画幅数由编排与审核确定'},
  ];
  return [step];
 });
 const reading=intake.progress;
 const extractionStep=reading?.stage==='cache'?'正在查找缓存':reading?.stage==='retrieving'?'正在检索候选故事':reading?.stage==='selecting'?'正在整理候选故事':reading?.stage==='verifying'?'正在逐篇核对检索候选':reading?.stage==='checking'?'正在核对原文与提取条件':reading?'正在阅读原文':'正在准备提取';
 const retrievalLabels={
  hybrid:'文字和向量联合检索',
  'no-query-vector':'文字检索（缺少当前查询的向量）',
  'no-compatible-vectors':'文字检索（候选没有兼容向量）',
  'no-index':'当前版本无可用索引，改读原文',
  'no-candidates':'索引无可用候选，改读原文',
  scan:'按原文范围逐段读取',
 };
 const extractionStatus=searching&&<div className="yu-extraction-status" role="status">
  <p><strong>{paused?'提取已暂停':extractionStep}</strong></p>
  {!paused&&(reading?.retrieval||reading?.cachedMatches!==undefined)&&<p className="yu-extraction-status-detail">
   {reading?.cachedMatches!==undefined&&<span>{reading.cachedMatches?`缓存命中 ${reading.cachedMatches} 篇`:'未命中已确认结果缓存'}</span>}
   {reading?.retrieval&&<span>{reading.cachedMatches!==undefined?' · ':''}{retrievalLabels[reading.retrieval]}</span>}
  </p>}
  {!paused&&<p className="yu-extraction-status-detail">
   {!!reading?.currentChapters?.length&&<span>{readingChapterLabel(reading.currentChapters)} · </span>}
   {reading?.stage==='verifying'&&<span>已处理 {reading.completed} / {reading.total} 篇候选 · </span>}
   {!!reading?.totalChars&&<span>已处理 {reading.completedChars.toLocaleString('zh-CN')} / {reading.totalChars.toLocaleString('zh-CN')} 字 · </span>}
   已找到 {candidates.length} 篇
  </p>}
 </div>;
 const extractionError=search.state==='failed'&&<div className="yu-batch-error" role="alert"><p>提取未完成。{search.error}</p><p>已找到的故事会保留，可以重试或直接选择。</p>{selected&&findMore}</div>;
 return <section className="yu-creation-setup" aria-label={selected?'故事流程':'选择故事'}>
  {!selected&&<StoryExtractionContext selection={session.selection} book={book} backAction={onBackToDiscovery&&<StoryFlowAction disabled={busy} onClick={onBackToDiscovery}><ArrowLeft size={14} aria-hidden="true"/>返回修改提取条件</StoryFlowAction>}/>}
  {!selected&&onReplace&&<StoryExtractionSearch retainKey={retainKey&&'search:'+session.id} sessionId={session.id} title={targetTitle} local={session.selection.bookId!=='other'} busy={busy} hasCandidates={candidates.length>0} onSearch={title=>act({action:'search',title})}/>}
  {selected&&progress.showSummary!==false&&<div className="yu-batch-heading"><h3>{session.selection.storyTitle}</h3></div>}
  {!selected&&extractionStatus}
  {!selected&&extractionError}
  {!selected&&!onReplace&&search.state==='idle'&&!intake.batches.length&&error&&<StoryFlowAction disabled={busy||finding} onClick={()=>void act({action:'more'})}>重试提取</StoryFlowAction>}
  {!selected&&!editing&&remoteChoice}
  {!selected&&(intake.batches.length>0||search.state==='failed')&&candidateList}
  {selected?<StoryGenerationStatus session={session} {...progress} navigation={undefined} compact={ready} control={ready?null:undefined} stages={stages} timeline={{stageDurations}} stageContent={{source:<>
   <div className="yu-extraction-actions" role="group" aria-label="故事来源操作">
    <StoryFlowAction disabled={busy||!ready&&!session.generationProgress?.sourceReady} onClick={()=>setSourceOpen(true)}>原文</StoryFlowAction>
    <StoryFlowAction disabled={busy} onClick={()=>setChoosing(true)}>重新选择故事</StoryFlowAction>
   </div>
   {extractionStatus}{extractionError}
  </>,prepare:<>
   {preparable&&<StoryFlowAction type="button" className="yu-primary" disabled={busy||session.state==='running'} onClick={()=>void act({action:'choose',batch:intake.selected!.batch,index:intake.selected!.index,settings:preferences})}>准备这篇</StoryFlowAction>}
  </>,count:<>
   {!editing&&remoteChoice}
   {error&&<p className="yu-batch-error" role="alert">{error}</p>}
   {editable&&<div className="yu-confirmation-settings" role="group" aria-label="制作设置">
    <StoryFlowAction disabled={locked} onClick={()=>setEditing('requirements')}>制作要求</StoryFlowAction>
    <StoryFlowAction disabled={locked} onClick={()=>setEditing('acceptance')}>验收要求</StoryFlowAction>
    <StoryFlowAction disabled={locked} aria-label="修改画风" onClick={()=>setEditing('style')}>画风：{getArtStyle(settings.artStyle).label}</StoryFlowAction>
    <StoryFlowAction disabled={locked} aria-label="修改叙事详略" onClick={()=>setEditing('count')}>叙事详略：{narrativeLabel}</StoryFlowAction>
   </div>}
   {ready&&<StoryFlowAction type="button" className="yu-primary" disabled={busy||session.state==='running'} onClick={()=>void act({action:'confirm',settings})}>{busy?'正在保存…':'开始制作'}</StoryFlowAction>}
  </>}}/>:<>
   {(session.error||progress.error)&&<p className="yu-batch-error" role="alert">{progress.error||session.error}</p>}
   {(session.state==='failed'||!!progress.error)&&<StoryRetry session={session} busy={progress.busy} onRetry={progress.onRetry}/>}
   {paused&&<StoryGenerationControl session={session} busy={progress.controlBusy} onControl={progress.onControl} primary/>}
   {!onReplace&&!progress.hideBack&&<StoryBackToShelf onBack={progress.onBack}/>}
  </>}
  {!selected&&error&&<p className="yu-batch-error" role="alert">{error}</p>}
  {choosing&&<Sheet title="重新选择故事" busy={busy} onClose={()=>setChoosing(false)}>{candidateList}{error&&<p role="alert">{error}</p>}</Sheet>}
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
