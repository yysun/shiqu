// Active steps show only their deadline; saved final durations stay on completed checkpoints.
// Failed work offers recovery in the control slot; only active work offers pause.
// Standalone flows name the story; embedded settings reuse the title already shown above.
// Changing progress shares the navigation row in both presentations.
// Creation may split saved preparation timing from its separate confirmation gate.
import {useEffect,useState} from 'react';
import type {ComponentProps,ReactNode} from 'react';
import {Check,Clock3,Feather,Pause,X} from 'lucide-react';
import type {ProductionAction,SessionView} from '@/lib/reader-model';
import {shelfGenerationStatus} from '@/lib/shelf-generation';
import {generationDuration,generationProgress} from '@/lib/generation-progress';
import StoryBackToShelf from './StoryBackToShelf';
import StoryProductionTimeline from './StoryProductionTimeline';
import type {ProductionTimelineNavigation} from './ProductionTimeline';
import type {ProductionStage} from '@/lib/production-stages';
import StoryGenerationControl from './StoryGenerationControl';
import StoryFlowHeader from './StoryFlowHeader';
import type {StoryFlowNavigation} from './StoryFlowHeader';
import StoryFlowAction from './StoryFlowAction';
import {getArtStyle} from '@/lib/reader-styles';
import type {RevisionChanges,RevisionSnapshot} from '@/lib/reader-revision';
import {revisionDraftSteps} from './StoryRevisionEditor';

export default function StoryGenerationStatus({session,busy,controlBusy,error,onControl,onRetry,onBack,onHistory,onAcceptance,onEditStyle,navigation,timeline,stages,draft,control,compact=false,reviewTools,stageContent,children,hideBack=false,showSummary=true}:{reviewTools?:ReactNode;stageContent?:Record<string,ReactNode>;compact?:boolean;children?:ReactNode;control?:ReactNode;timeline?:ProductionTimelineNavigation&Pick<ComponentProps<typeof StoryProductionTimeline>,'stageDurations'>;stages?:ProductionStage[];draft?:{base:RevisionSnapshot;changes:RevisionChanges};session:SessionView;busy:boolean;controlBusy:boolean;error:string;onControl:(id:string,action:ProductionAction)=>Promise<void>;onRetry:(faultId?:string)=>void;onBack:()=>void;hideBack?:boolean;showSummary?:boolean;onHistory?:()=>void;onAcceptance?:()=>void;onEditStyle?:()=>void;navigation?:StoryFlowNavigation}){
 const status=shelfGenerationStatus(session),stopped=status.group==='生成失败'||status.group==='生成已暂停';
 const [,setNow]=useState(Date.now);
 const progress=generationProgress(session,Date.now()),moving=progress.running&&!error&&!stopped;
 useEffect(()=>{
  if(!moving)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(timer);
 },[session.id,session.generationProgress?.startedAt,moving]);
 const title=session.selection.displayTitle||session.story?.title||session.selection.storyTitle||'你的故事';
 const message=busy&&stopped?(session.state==='failed'?'正在重试生成':'正在请求生成'):error&&session.state!=='failed'?'暂时无法确认生成状态':status.message;
 const failed=!!error||status.group==='生成失败';
 const paused=!!session.generationControl&&session.generationControl!=='active';
 const generationControl=control===undefined?(paused||!failed?<StoryGenerationControl session={session} busy={controlBusy} onControl={onControl} primary={paused} link/>:null):control;
 const steps=draft?revisionDraftSteps(draft.base,draft.changes,progress.steps[0]):stages||progress.steps;
 const displayedSteps=onEditStyle?steps.map(step=>step.id==='count'?{...step,label:'叙事详略、篇幅与画风'}:step):steps;
 const content=onEditStyle?{...stageContent,count:<>
  <span><StoryFlowAction aria-label="修改画风" disabled={paused&&controlBusy} onClick={onEditStyle}>画风：{getArtStyle(draft?.changes.artStyle??session.selection.artStyle).label}</StoryFlowAction></span>
  {stageContent?.count}
 </>}:stageContent;
 return <div className={'yu-generation-stage has-progress'+(compact||!showSummary?' is-compact':'')+(moving?' is-generating':'')+(failed?' has-error':'')+(session.reviewIssues?.length?' has-review-issues':'')}>
  {showSummary&&(!compact||failed)&&<div className="yu-generation-summary">
   <span className="yu-generation-mark" aria-hidden="true">{failed?<X size={23}/>:stopped?<Pause size={23}/>:session.state==='completed'?<Check size={23}/>:<Feather size={23}/>}</span>
   <div><p className="yu-generation-kicker">{failed?'需要处理':stopped?'进度已保留':session.state==='completed'?'制作完成':'把故事变成画面'}</p><h3>{title}</h3></div>
  </div>}
  <StoryFlowHeader title={progress.measured?'画面生成进度':'制作流程'} status={message} {...navigation}/>
  <section className="yu-generation-progress" aria-label="生成进展">
   <StoryProductionTimeline session={session} busy={busy||controlBusy} error={error} onRetry={onRetry} onAcceptance={onAcceptance} reviewTools={reviewTools} stageContent={content} onHistory={onHistory} stages={displayedSteps} moving={moving} queued={progress.queued} {...timeline} currentTiming={moving?<><Clock3 size={12} aria-hidden="true"/>{progress.remaining===null?'超时信息待同步':progress.remaining>0?`距超时 ${generationDuration(progress.remaining)}`:'已达超时，等待状态更新'}</>:undefined} currentContent={session.state!=='completed'?generationControl:null}/>
  </section>
  {children}
  {!hideBack&&<StoryBackToShelf onBack={onBack} link/>}
  {!hideBack&&(!session.intake||session.intake.phase==='confirmed')&&<p className="yu-generation-exit-note">{session.state==='completed'?'完整故事已保存在书架。':stopped||failed?'已保存的内容会保留，可在书架中管理和继续生成。':'离开后继续生成整篇，可随时暂停或从书架查看进度。'}</p>}
 </div>;
}
