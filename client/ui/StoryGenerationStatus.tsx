// Active steps show only their deadline; saved final durations stay on completed checkpoints.
// Failed work offers recovery in the control slot; only active work offers pause.
// Standalone flows name the story; embedded settings reuse the title already shown above.
// Changing progress shares the navigation row in both presentations.
// 已完成作品的可选工作暂停时，没有横版步骤可承载恢复操作，就在当前步骤给出恢复入口。
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
import StoryFlowAction from './StoryFlowAction';
import type {StoryFlowNavigation} from './StoryFlowHeader';
import {getArtStyle} from '@/lib/reader-styles';
import {narrativeDetails} from '@/lib/reader-frame-recommendation';
import {GenerationModelsDetails} from './StoryPublication';
import StoryLandscapeStep from './StoryLandscapeStep';
import {offersProductionAction,preparationRefreshFault} from '@/lib/production-lifecycle';

export default function StoryGenerationStatus({session,busy,controlBusy,error,onControl,onRetry,onBack,onHistory,onAcceptance,onEditStyle,onLandscapeActivityChange,navigation,timeline,stages,control,compact=false,reviewTools,stageContent,children,hideBack=false,showSummary=true,showLandscape:requestedLandscape}:{reviewTools?:ReactNode;stageContent?:Record<string,ReactNode>;compact?:boolean;children?:ReactNode;control?:ReactNode;timeline?:ProductionTimelineNavigation&Pick<ComponentProps<typeof StoryProductionTimeline>,'stageDurations'>;stages?:ProductionStage[];session:SessionView;busy:boolean;controlBusy:boolean;error:string;onControl:(id:string,action:ProductionAction)=>Promise<void>;onRetry:(faultId?:string)=>void;onBack:()=>void;hideBack?:boolean;showSummary?:boolean;showLandscape?:boolean;onLandscapeActivityChange?:()=>void;onHistory?:()=>void;onAcceptance?:()=>void;onEditStyle?:()=>void;navigation?:StoryFlowNavigation}){
 const portraitReady=!!session.story?.pages.length&&session.story.pages.every(page=>!!page.image);
 const showLandscape=requestedLandscape??(!!session.hasLandscape||!!session.revision||portraitReady);
 const status=shelfGenerationStatus(session),stopped=status.group==='生成失败'||status.group==='生成已暂停';
 const [,setNow]=useState(Date.now);
 const progress=generationProgress(session,Date.now()),moving=progress.running&&!error&&!stopped;
 useEffect(()=>{
  if(!moving)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(timer);
 },[session.id,session.generationProgress?.startedAt,moving]);
 const title=session.selection.displayTitle||session.story?.title||session.selection.storyTitle||'你的故事';
 const queuedActivity=session.generationProgress?.activity;
 const message=busy&&stopped?(session.state==='failed'?'正在重试生成':'正在请求生成'):error&&session.state!=='failed'?'暂时无法确认生成状态':progress.queued&&queuedActivity?`等待生成 · ${queuedActivity}`:status.message;
 const failed=!!error||status.group==='生成失败';
 const paused=!!session.generationControl&&session.generationControl!=='active';
 const generationControl=control===undefined?(paused||!failed?<StoryGenerationControl session={session} busy={controlBusy} onControl={onControl} primary={paused} link/>:null):control;
 const steps=stages||progress.steps;
 const planRevision=!!session.revision&&session.generationProgress?.phase==='plan';
 const displayedSteps=steps.map(step=>{
  if(step.id==='count'&&step.label==='叙事详略与篇幅'&&onEditStyle)return {...step,label:'制作设置'};
  if(step.id!=='plan'||!planRevision)return step;
  if(session.awaitingContinue){
   const artwork=progress.total===null?`新版幅数待编排，预计复用 ${progress.ready} 幅旧图`:
    `预计需绘制 ${progress.total-progress.ready} 幅，复用 ${progress.ready} 幅旧图`;
   return {...step,detail:`继续后编排新版分镜 · ${artwork}`};
  }
  if(step.state!=='current')return step;
  if(progress.queued)return {...step,detail:'新版分镜已排队，轮到后开始编排'};
  if(moving){
   const detail=step.detail.replace(/^编排(?:文字|叙事)分镜/,'正在编排新版分镜');
   return {...step,detail:detail===step.detail?`正在编排新版分镜 · ${detail}`:detail};
  }
  return step;
 });
 const {source,...flowNavigation}=navigation||{};
 const sourceLinks=source?[{...source,label:'查看原文'},...(timeline?.links?.source||[])]:timeline?.links?.source;
 const timelineLinks={...timeline?.links,...(sourceLinks?{source:sourceLinks}:{})};
 const countAction=timeline?.actions?.count;
 const narrativeLabel=(narrativeDetails.find(detail=>detail.id===session.selection.narrativeDetail)??narrativeDetails[1]).label;
 const styleLabel=getArtStyle(session.selection.artStyle).label;
 const refreshing=session.lifecycle?.preparationRefresh==='pending';
 const canRefresh=offersProductionAction(session,'reprepare',false);
 const recommendation=session.frameRecommendation;
 const activity=session.lifecycle?.activity;
 const updating=activity?.state==='running'&&activity.jobs.some(job=>job.call==='prepareSuggestions');
 const refreshStatus=paused?'画幅建议更新已暂停':preparationRefreshFault(session)?'画幅建议更新待处理':updating?'正在更新画幅建议':'等待更新画幅建议';
 const countContent=(canRefresh||refreshing)?<><div className="production-stage-actions">
  <details key={session.id} className="production-stage-details">
   <summary className="story-flow-link">画幅建议（可选）</summary>
   <p>{recommendation?`上次估算 ${recommendation.count} 幅。`:'这里可以按制作要求估算幅数。'}最终幅数由分镜编排和审核确定。</p>
   <p>更新期间，新任务会等待建议保存。</p>
   <div className="production-stage-actions"><StoryFlowAction disabled={controlBusy||!canRefresh} onClick={()=>void onControl(session.id,'reprepare')}>更新画幅建议</StoryFlowAction></div>
  </details>
 </div>{refreshing&&<div className="production-stage-footer"><small role="status">{refreshStatus}</small>{generationControl}</div>}</>:null;
 const links=onEditStyle?{...timelineLinks,count:[
  ...(countAction?[{...countAction,label:`详略：${narrativeLabel}`,ariaLabel:`修改叙事详略，当前${narrativeLabel}`}]:[]),
  {label:`画风：${styleLabel}`,ariaLabel:`修改画风，当前${styleLabel}`,disabled:paused&&controlBusy||!offersProductionAction(session,'edit-revision'),onClick:onEditStyle},
  ...(timeline?.links?.count??[]),
 ]}:timelineLinks;
 return <div className={'yu-generation-stage has-progress'+(compact||!showSummary?' is-compact':'')+(moving?' is-generating':'')+(failed?' has-error':'')+(session.reviewIssues?.length?' has-review-issues':'')}>
  {showSummary&&(!compact||failed)&&<div className="yu-generation-summary">
   <span className="yu-generation-mark" aria-hidden="true">{failed?<X size={23}/>:stopped?<Pause size={23}/>:session.state==='completed'?<Check size={23}/>:<Feather size={23}/>}</span>
   <div><p className="yu-generation-kicker">{failed?'需要处理':stopped?'进度已保留':session.state==='completed'?'制作完成':'把故事变成画面'}</p><h3>{title}</h3></div>
  </div>}
  <StoryFlowHeader title={progress.measured?'画面生成进度':'制作流程'} status={message} {...flowNavigation}/>
  <section className="yu-generation-progress" aria-label="生成进展">
   <StoryProductionTimeline session={session} busy={busy||controlBusy} error={error} onRetry={onRetry} onAcceptance={onAcceptance} reviewTools={reviewTools} stageContent={countContent?{...stageContent,count:<>{stageContent?.count}{countContent}</>}:stageContent} onHistory={onHistory} stages={displayedSteps} moving={moving} queued={progress.queued} {...timeline} links={links} currentTiming={moving?<><Clock3 size={12} aria-hidden="true"/>{progress.remaining===null?'超时信息待同步':progress.remaining>0?`距超时 ${generationDuration(progress.remaining)}`:'已达超时，等待状态更新'}</>:undefined} currentContent={!refreshing&&(session.state!=='completed'||!showLandscape)?generationControl:null}>
    {showLandscape&&<StoryLandscapeStep key={session.id} storyId={session.id} savedPages={JSON.stringify(session.story?.pages.map(page=>[page.image,page.prompt])??[])} onActivityChange={onLandscapeActivityChange}/>}
   </StoryProductionTimeline>
  </section>
  {session.story&&<GenerationModelsDetails story={session.story}/>}
  {children}
  {!hideBack&&<StoryBackToShelf onBack={onBack} link/>}
  {!hideBack&&(!session.intake||session.intake.phase==='confirmed')&&<p className="yu-generation-exit-note">{session.state==='completed'?'完整故事已保存在书架。':stopped||failed?'已保存的内容会保留，可在书架中管理和继续生成。':session.redrawPage?'离开后也会继续重绘，可从书架查看进度。':'离开后继续生成整篇，可随时暂停或从书架查看进度。'}</p>}
 </div>;
}
