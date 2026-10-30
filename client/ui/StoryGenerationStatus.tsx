// Lead with the active stage and saved milestones; only saved images have measurable progress.
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowRight,BookOpen,Check,Clock3,Feather,Pause,X} from 'lucide-react';
import type {ProductionAction,SessionView} from '@/lib/reader-model';
import {shelfGenerationStatus} from '@/lib/shelf-generation';
import {generationDuration,generationProgress} from '@/lib/generation-progress';
import StoryRetry from './StoryRetry';
import ProductionTimeline from './ProductionTimeline';
import type {ProductionTimelineNavigation} from './ProductionTimeline';
import type {ProductionStage} from '@/lib/production-stages';
import StoryGenerationControl from './StoryGenerationControl';

export default function StoryGenerationStatus({session,busy,controlBusy,error,onControl,onRetry,onBack,timeline,stages,compact=false,children}:{compact?:boolean;children?:ReactNode;timeline?:ProductionTimelineNavigation;stages?:ProductionStage[];session:SessionView;busy:boolean;controlBusy:boolean;error:string;onControl:(id:string,action:ProductionAction)=>Promise<void>;onRetry:()=>void;onBack:()=>void}){
 const status=shelfGenerationStatus(session),stopped=status.group==='生成失败'||status.group==='生成已暂停';
 const [now,setNow]=useState(Date.now);
 const progress=generationProgress(session,now),moving=progress.running&&!error&&!stopped;
 useEffect(()=>{
  if(!moving)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(timer);
 },[session.id,session.generationProgress?.startedAt,moving]);
 const title=busy&&stopped?(session.state==='failed'?'正在重试生成':'正在请求生成'):error&&session.state!=='failed'?'暂时无法确认生成状态':status.message;
 const failed=!!error||status.group==='生成失败';
 const detail=session.generationControl&&session.generationControl!=='active'?'已保存的结果会保留，点击“恢复生成”后继续。已开始的任务仍会完成并保存。':status.detail;
 return <div className={'yu-generation-stage has-progress'+(moving?' is-generating':'')+(failed?' has-error':'')}>
  {(!compact||failed)&&<><div className="yu-generation-summary">
   <span className="yu-generation-mark" aria-hidden="true">{failed?<X size={23}/>:stopped?<Pause size={23}/>:session.state==='completed'?<Check size={23}/>:<Feather size={23}/>}</span>
   <div><p className="yu-generation-kicker">{failed?'需要处理':stopped?'进度已保留':session.state==='completed'?'制作完成':'把故事变成画面'}</p><h3>{title}</h3></div>
  </div>
  <p className="yu-generation-description" role={failed?'alert':'status'}>{busy&&stopped?'请求确认后会自动更新进度。':error||detail}</p></>}
  {(stopped||!!error)&&<StoryRetry session={session} busy={busy} onRetry={onRetry} primary/>}
  <section className="yu-generation-progress" aria-label="生成进展">
   <div className="yu-generation-progress-heading"><strong>{progress.measured?'画面生成进度':compact?'制作流程':'制作进度'}</strong><span>{moving&&progress.elapsed!==null?<><Clock3 size={12} aria-hidden="true"/>本阶段 {generationDuration(progress.elapsed)}</>:error&&session.state!=='failed'?'状态待同步':progress.queued?'排队中':stopped?'已保存的进度':session.state==='completed'?'已完成':session.intake?.phase==='confirming'?'待确认':session.intake?.phase==='choosing'?'待选择':'等待更新'}</span><StoryGenerationControl session={session} busy={controlBusy} onControl={onControl}/></div>
   {progress.measured&&<progress aria-label="画面生成进度" max={progress.total!} value={progress.ready}/>}
   <ProductionTimeline stages={stages||progress.steps} moving={moving} queued={progress.queued} {...timeline}/>
   {(moving||session.state==='failed')&&<p className="yu-generation-progress-note">{progress.note}</p>}
   {progress.attempt>1&&<p className="yu-generation-progress-note">{moving?`本阶段第 ${progress.attempt} 次尝试`:`本阶段已尝试 ${progress.attempt} 次`}</p>}
   {moving&&progress.slow&&<p className="yu-generation-slow" role="status">这一步耗时较长，尚未收到完整分镜。</p>}
  </section>
  {children}
  <button type="button" className="yu-generation-back" onClick={onBack}><BookOpen size={17} aria-hidden="true"/>返回书架<ArrowRight size={17} aria-hidden="true"/></button>
  <p className="yu-generation-exit-note">{session.intake&&session.intake.phase!=='confirmed'?'选题和制作内容会保存在书架，确认前不会生成分镜或画面。':session.state==='completed'?'完整故事已保存在书架。':stopped||failed?'已保存的内容会保留，可在书架中管理和继续生成。':'离开后继续生成整篇，可随时暂停或从书架查看进度。'}</p>
 </div>;
}
