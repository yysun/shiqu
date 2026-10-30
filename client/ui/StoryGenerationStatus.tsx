// Show saved milestones and real timing; decorative motion stops whenever generation stops.
import {useEffect,useState} from 'react';
import {Check,Clock3,Feather,X} from 'lucide-react';
import type {ProductionAction,SessionView} from '@/lib/reader-model';
import {shelfGenerationStatus} from '@/lib/shelf-generation';
import {generationDuration,generationProgress} from '@/lib/generation-progress';
import StoryRetry from './StoryRetry';
import StoryGenerationControl from './StoryGenerationControl';

export default function StoryGenerationStatus({session,busy,controlBusy,error,onControl,onRetry,onBack}:{session:SessionView;busy:boolean;controlBusy:boolean;error:string;onControl:(id:string,action:ProductionAction)=>Promise<void>;onRetry:()=>void;onBack:()=>void}){
 const status=shelfGenerationStatus(session),stopped=status.group==='生成失败'||status.group==='生成已暂停';
 const [now,setNow]=useState(Date.now);
 const progress=generationProgress(session,now),moving=progress.running&&!error&&!stopped;
 useEffect(()=>{
  if(!moving)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(timer);
 },[session.id,session.generationProgress?.startedAt,moving]);
 const title=busy&&stopped?(session.state==='failed'?'正在重试生成':'正在请求生成'):error&&session.state!=='failed'?'暂时无法确认生成状态':status.message;
 return <div className={'yu-generation-stage has-progress'+(moving?' is-generating':'')}>
  <div className="yu-drawing-orbit yu-generation-orbit"><Feather size={32} strokeWidth={1}/></div>
  <h3>{title}</h3><p role={error||session.state==='failed'?'alert':'status'}>{busy&&stopped?'请求确认后会自动更新进度。':error||status.detail}</p>
  {(stopped||!!error)&&<StoryRetry session={session} busy={busy} onRetry={onRetry} primary/>}
  <section className="yu-generation-progress" aria-label="生成进展">
   <div className="yu-generation-progress-heading"><strong>{progress.measured?'画面生成进度':'制作进度'}</strong><span>{moving&&progress.elapsed!==null?<><Clock3 size={12} aria-hidden="true"/>本阶段 {generationDuration(progress.elapsed)}</>:error&&session.state!=='failed'?'状态待同步':progress.queued?'排队中':stopped?'已保存的进度':session.state==='completed'?'已完成':'等待更新'}</span><StoryGenerationControl session={session} busy={controlBusy} onControl={onControl}/></div>
   {progress.measured?<progress aria-label="画面生成进度" max={progress.total!} value={progress.ready}/>:moving?<progress aria-label="当前阶段进行中"/>:null}
   <ol aria-label="生成步骤">{progress.steps.map((step,index)=><li key={step.label} data-state={step.state} aria-current={step.state==='current'?'step':undefined}><span className="yu-generation-step-icon" aria-hidden="true">{step.state==='done'?<Check size={13}/>:step.state==='failed'?<X size={13}/>:index+1}</span><span>{step.label}</span><small>{step.detail}</small></li>)}</ol>
   {moving&&<p className="yu-generation-progress-note">{progress.note}</p>}
   {progress.attempt>1&&<p className="yu-generation-progress-note">{moving?`本阶段第 ${progress.attempt} 次尝试`:`本阶段已尝试 ${progress.attempt} 次`}</p>}
   {moving&&progress.slow&&<p className="yu-generation-slow" role="status">这一步耗时较长，尚未收到完整分镜。</p>}
  </section>
  <button className="yu-generation-later" onClick={onBack}>返回书架</button>
  <p className="yu-generation-exit-note">{session.state==='completed'?'完整故事已保存在书架。':stopped||!!error?'已保存的内容会保留，可在书架中管理和继续生成。':'离开后继续生成整篇，可随时暂停或从书架查看进度。'}</p>
 </div>;
}
