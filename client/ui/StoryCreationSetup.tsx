// Keep discovery in the story picker; a chosen story enters one continuous production flow.
// Edits are saved as a draft on the side; only a recommendation or final confirmation starts work.
// 索引候选按召回顺序更新核对状态，逐段阅读的结果随查找追加到同一种列表。
// Extraction, preparation and human confirmation remain separate, with timings bound to real work.
// 传入 retainKey 时，未保存的设置与打开的子面板跨布局切换保留；恢复后只要服务器保存值未变，就不提示“另一台设备更新了制作内容”。
import StoryFlowAction from './StoryFlowAction';
import {maxSuggestionBatches,readingChapterLabel} from '@/lib/reader-suggestions';
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
 const indexed=intake.indexedCandidates;
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
  if(onReplace||busy||paused||selected||search.state!=='idle'||indexed||intake.batches.length||startedDraft.current===session.id)return;
  startedDraft.current=session.id;
  void act({action:'more'});
 },[session.id,busy,paused,selected,search.state,indexed,intake.batches.length,onReplace]);
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
 const terminalBatch=intake.batches.at(-1);
 const atLimit=intake.batches.length>=maxSuggestionBatches&&(!indexed||intake.batches.every(batch=>batch.stories.length>=5));
 const failedSearch=search.state==='failed';
 const initialRetry=!onReplace&&!selected&&!terminalBatch&&!!error;
 const canResume=paused&&!selected&&!onReplace;
 const indexedChecked=indexed?.filter(candidate=>candidate.status!=='pending').length??0;
 const indexedMatches=indexed?.filter(candidate=>candidate.status==='match').length??0;
 const incompleteIndex=!!indexed&&indexedChecked<indexed.length;
 const searchLabel=paused?'查找已暂停':searching?'正在查找…':failedSearch||initialRetry?'查找未完成':atLimit?'已达候选上限':terminalBatch?.stories.length===0?(candidates.length?'暂无更多故事':'未找到故事'):candidates.length?'':onReplace?'等待提取':'正在提取…';
 const searchSummary=indexed?`已核对 ${indexedChecked}/${indexed.length} · ${indexedMatches} 条符合`:[searchLabel,candidates.length?`已找到 ${candidates.length} 篇`:''].filter(Boolean).join(' ');
 const canFindMore=failedSearch||initialRetry||(indexed?incompleteIndex&&!searching:!targetTitle);
 const actionLabel=canResume?'恢复查找':indexed?'重试核对':failedSearch||initialRetry?'重试查找':'继续查找';
 const searchAction=<StoryFlowAction disabled={busy||(canResume?progress.controlBusy:searching||paused||!indexed&&!terminalBatch&&!failedSearch&&!initialRetry)} onClick={()=>{if(canResume)return progress.onControl(session.id,'resume');void act({action:'more'});}}>{actionLabel}</StoryFlowAction>;
 // The service records preparation as count; confirmation is a human gate with no execution time.
 const {count:preparationSeconds,...workDurations}=session.generationProgress?.stageDurations||{};
 const stageDurations={...workDurations,...(preparationSeconds!==undefined?{prepare:preparationSeconds}:{})};
 const prepared=ready||intake.phase==='confirmed';
 const narrativeLabel=settings.narrativeDetail==='brief'?'简短':settings.narrativeDetail==='detailed'?'详细':'适中';
 const initialFrameCount=prepared?session.frameRecommendation?.count:undefined;
 const extractionContext=`《${book}》 · ${session.selection.theme==='原典故事'?'不限定主题':`主题：${session.selection.theme}`}${session.selection.discoverySources?.length?` · 已选 ${session.selection.discoverySources.length} 段原文`:''}`;
 const stages=generationProgress(session,Date.now()).steps.flatMap(step=>{
  if(step.id==='source')return [{...step,label:'提取故事',detail:extractionContext}];
  if(step.id==='count')return [
   {id:'prepare',label:'准备故事',state:prepared?'done' as const:step.state,detail:prepared?(session.frameRecommendation?.storySummary?'原文与梗概已核对':'原文与制作建议已保存'):preparable?'待准备这篇故事':'保存原文，核对梗概与制作建议'},
   {...step,state:prepared?step.state:'pending' as const,detail:`${initialFrameCount===undefined?'':`模型初估 ${initialFrameCount} 幅 · `}画幅数由编排与审核确定`},
  ];
  return [step];
 });
 const reading=intake.progress;
 const checkingIds=new Set(searching&&!paused?reading?.checkingCandidates:undefined);
 const extractionStep=reading?.stage==='cache'?'正在查找缓存':reading?.stage==='retrieving'?'正在检索候选故事':reading?.stage==='selecting'?'正在整理候选故事':reading?.stage==='verifying'?'正在逐篇核对检索候选':reading?.stage==='checking'?'正在核对原文与提取条件':reading?'正在阅读原文':'正在准备提取';
 const extractionDetail=[
  reading?.currentChapters?.length?readingChapterLabel(reading.currentChapters):null,
  reading?.stage==='verifying'?`已处理 ${reading.completed} / ${reading.total} 篇候选`:null,
  reading?.totalChars?`已处理 ${reading.completedChars.toLocaleString('zh-CN')} / ${reading.totalChars.toLocaleString('zh-CN')} 字`:null,
 ].filter(Boolean).join(' · ');
 const searchNotice=failedSearch&&!searching?search.error:indexed
  ?paused?'查找已暂停，已核对的结果可以继续选择。':atLimit?'已达候选保存上限，可以从已保存的故事中选择。':!searching&&incompleteIndex?'还有候选待核对，可以重试。':null
  :searching&&!paused&&reading?[extractionStep,extractionDetail].filter(Boolean).join(' · ')
   :!searching&&!paused&&terminalBatch?.stories.length===0?terminalBatch.note:null;
 const indexedChoices=new Set(indexed?.flatMap(({choice})=>choice?[`${choice.batch}:${choice.index}`]:[]));
 const candidateRows=[
  ...(indexed??[]).map(({id,title,summary,status,choice,matchScore})=>({id,title,summary,status,choice,matchScore,sourceLabel:undefined})),
  ...candidates.flatMap(({candidate,batchIndex,index})=>{
   const id=`${batchIndex}:${index}`;
   return indexedChoices.has(id)?[]:[{id,title:candidate.title,summary:candidate.description,sourceLabel:candidate.sourceLabel,status:'match' as const,choice:{batch:batchIndex,index},matchScore:candidate.matchScore}];
  }),
 ];
 const candidateList=<>
  <div className="yu-candidate-search" aria-label="查找故事">
   <p className="yu-candidate-search-status" role="status"><span className="yu-candidate-search-icon">{searching&&!paused&&<Loader2 size={14} className="spin" aria-hidden="true"/>}</span>{searchSummary}</p>
   <div className="yu-candidate-search-actions">
    {(canResume||canFindMore&&!atLimit)&&searchAction}
   </div>
  </div>
  {searchNotice&&<p className="yu-search-notice" role={failedSearch?'alert':'status'}>{searchNotice}</p>}
  {candidateRows.length>0&&<ul className="yu-extraction-candidates" aria-label="候选故事">{candidateRows.map(({id,title,summary,sourceLabel,status,choice,matchScore})=>{
   const current=choice&&isSelected(choice.batch,choice.index);
   const label=status==='match'?(targetTitle?'已核对':'符合'):status==='rejected'?'不符合':checkingIds.has(id)?'核对中':'待核对';
   return <li key={id} data-status={status}>
    <div className="yu-extraction-candidate-copy"><strong>{title}</strong>{summary&&<p>{summary}</p>}{sourceLabel&&<small>{sourceLabel}</small>}</div>
    <div className="yu-extraction-candidate-controls">
     <span className="yu-extraction-candidate-status">{label}{matchScore!==undefined&&<span className="yu-extraction-candidate-score" aria-label={`主题贴合度 ${matchScore}%`}>{matchScore}%</span>}</span>
     {choice&&<button type="button" aria-label={`${onReplace?'选择并替换':'选择'} ${title}`} aria-pressed={!!current} disabled={(busy||session.state==='running'&&intake.phase==='preparing')&&!current} onClick={()=>void select(choice.batch,choice.index)}>{current?'已选':onReplace?'选择并替换':'选择'}</button>}
    </div>
   </li>;
  })}</ul>}
 </>;
 const extractionError=failedSearch&&<div className="yu-batch-error" role="alert"><p>提取未完成。{search.error}</p><p>已找到的故事仍可选择。</p>{!atLimit&&searchAction}</div>;
 return <section className="yu-creation-setup" aria-label={selected?'故事流程':'选择故事'}>
  {!selected&&<StoryExtractionContext selection={session.selection} book={book} backAction={onBackToDiscovery&&<StoryFlowAction disabled={busy} onClick={onBackToDiscovery}><ArrowLeft size={14} aria-hidden="true"/>修改提取条件</StoryFlowAction>}/>}
  {!selected&&onReplace&&<StoryExtractionSearch retainKey={retainKey&&'search:'+session.id} sessionId={session.id} title={targetTitle} local={session.selection.bookId!=='other'} busy={busy} hasCandidates={candidates.length>0} onSearch={title=>act({action:'search',title})}/>}
  {selected&&progress.showSummary!==false&&<div className="yu-batch-heading"><h3>{session.selection.storyTitle}</h3></div>}
  {!selected&&candidateList}
  {!selected&&!editing&&remoteChoice}
  {selected?<StoryGenerationStatus session={session} {...progress} navigation={undefined} compact={ready} control={ready?null:undefined} stages={stages} timeline={{stageDurations}} stageContent={{source:<>
   <div className="yu-extraction-actions" role="group" aria-label="故事来源操作">
    <StoryFlowAction disabled={busy||!ready&&!session.generationProgress?.sourceReady} onClick={()=>setSourceOpen(true)}>原文</StoryFlowAction>
    <StoryFlowAction disabled={busy} onClick={()=>setChoosing(true)}>重新选择故事</StoryFlowAction>
   </div>
   {extractionError}
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
   {!onReplace&&!progress.hideBack&&<StoryBackToShelf onBack={progress.onBack}/>}
  </>}
  {!selected&&error&&<p className="yu-batch-error" role="alert">{error}</p>}
  {choosing&&<Sheet title="重新选择故事" fixedHeight busy={busy} onClose={()=>setChoosing(false)}>{candidateList}{error&&<p role="alert">{error}</p>}</Sheet>}
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
