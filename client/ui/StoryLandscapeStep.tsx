// 已完成作品的横版插图步骤：显示后台进度，并提供启动、暂停、恢复及重试的文字链接。
// 服务不可用时无论横图处于哪一阶段都说明原因；快照服务不可用且生命周期提供「应用当前模型设置」时给出该操作。
import {offersProductionAction,productionServiceMessages} from '@/lib/production-lifecycle';
import {productionBlockedReason} from '@/lib/shelf-generation';
import {useEffect,useEffectEvent,useRef,useState} from 'react';
import type {EarlierLandscapeWork,LandscapeStatus} from '@/lib/reader-production';
import type {ProductionAction,SessionView} from '@/lib/reader-model';
import type {ProductionStageState} from '@/lib/production-stages';
import {ProductionTimelineRow} from './ProductionTimeline';
import StoryFlowAction from './StoryFlowAction';
import {request} from './shared';

export function storyLandscapeRoute(id:string){return `reader/sessions/${encodeURIComponent(id)}/landscape`;}

type Props={storyId:string;session:Pick<SessionView,'lifecycle'|'superseded'>;busy:boolean;onControl:(id:string,action:ProductionAction)=>Promise<void>;onActivityChange?:()=>void};
export default function StoryLandscapeStep({storyId,session,busy,onControl,onActivityChange}:Props){
 const path=storyLandscapeRoute(storyId);
 const [status,setStatus]=useState<LandscapeStatus|null>(null);
 const [refresh,setRefresh]=useState(0);
 const [submitting,setSubmitting]=useState(false);
 const [readError,setReadError]=useState('');
 const [actionError,setActionError]=useState('');
 const wasRunning=useRef(false);
 const activityChanged=useEffectEvent(()=>onActivityChange?.());
 const pending=status?.state==='running';
 useEffect(()=>{
  if(wasRunning.current===pending)return;
  wasRunning.current=pending;
  activityChanged();
 },[pending]);
 useEffect(()=>{
  let live=true,timer:ReturnType<typeof setTimeout>|undefined;
  async function poll(){
   try{
    const next:LandscapeStatus=await request(path);
    if(!live)return;
    setStatus(next);setReadError('');
    if(next.state==='running'||next.earlier?.some(item=>item.state==='running'))timer=setTimeout(()=>void poll(),2000);
   }catch(error){
    if(live)setReadError(error instanceof Error?error.message:'暂时无法读取横版进度。');
   }
  }
  void poll();
  return()=>{live=false;clearTimeout(timer);};
 },[path,refresh]);
 async function start(){
  if(!status?.available||submitting||readError)return;
  const command=status.retryToken?{retryToken:status.retryToken}:{startToken:status.startToken};
  setSubmitting(true);setActionError('');
  try{
   const next:LandscapeStatus=await request(path,'POST',command);
   setStatus(next);
   setRefresh(value=>value+1);
  }catch(error){
   setActionError(error instanceof Error?error.message:'暂时无法启动横版生成。');
   setRefresh(value=>value+1);
  }finally{setSubmitting(false);}
 }
 async function control(action:ProductionAction){
  setSubmitting(true);setActionError('');
  try{
   if(action==='pause'||action==='resume')setStatus(await request(path,'POST',{control:action,printId:status?.printId}));
   else await onControl(storyId,action);
  }
  catch(error){setActionError(error instanceof Error?error.message:'暂时无法更新生成状态。');}
  finally{setSubmitting(false);setRefresh(value=>value+1);}
 }
 async function updateEarlier(work:EarlierLandscapeWork){
  const command=work.controlAction?{control:work.controlAction,printId:work.printId}:work.startToken?{startToken:work.startToken}:{retryToken:work.retryToken};
  setSubmitting(true);setActionError('');
  try{await request(storyLandscapeRoute(work.storyId),'POST',command);}
  catch(error){setActionError(error instanceof Error?error.message:'暂时无法更新旧版横图。');}
  finally{setSubmitting(false);setRefresh(value=>value+1);}
 }
 const sessionControl=session.lifecycle?.control==='active'?'pause':'resume';
 const offeredControl=status?status.controlAction:
  session.lifecycle?.optionalWork&&offersProductionAction(session,sessionControl,false)?sessionControl:undefined;
 const manual=status?.state==='running'&&status.control&&status.control!=='active';
 const partial=status?.state==='partial';
 const serviceBlocked=status&&status.state!=='completed'&&status.service&&status.service!=='available'?status.service:null;
 const canSubmit=status?.available&&!!(status.startToken||status.retryToken);
 // 可以启动或重试却没有令牌（旧版本、服务停止等）时说明原因，不只隐藏操作。
 const withheld=!!status?.available&&!canSubmit&&(status.state==='idle'||status.state==='partial'&&status.failed.length>0);
 const applyable=!status?.printId&&serviceBlocked==='snapshot-unavailable'&&offersProductionAction(session,'apply-model',false);
 const detail=serviceBlocked?productionServiceMessages[serviceBlocked]:withheld&&!manual?productionBlockedReason(session):manual?'横版制作等待恢复，已保存的画幅会保留。':status?.state==='completed'?'横图已齐全，可在打印时选择这套插图。':
  status?.state==='running'? `正在生成，已保存 ${status.ready} / ${status.total} 幅。`:
  partial?`已保存 ${status.ready} / ${status.total} 幅${status.failed.length?'，待重试第 '+status.failed.join('、')+' 幅':''}。`:
  status?.available?'按原图和分镜绘制 3∶2 横图，供印刷使用。':status?'当前暂无法启动横版生成。':'正在读取横版进度…';
 const error=readError||actionError||status?.error;
 const running=status?.state==='running'&&!serviceBlocked&&!manual;
 const state:ProductionStageState=readError?'failed':serviceBlocked||manual?'paused':running?'current':status?.state==='completed'?'done':partial||actionError?'failed':status&&!status.available?'unavailable':'pending';
 const stateLabel={paused:serviceBlocked?'等待服务':'等待恢复',failed:readError?'读取失败':partial?'待重试':'提交失败',current:'进行中',done:'已完成',unavailable:'暂不可用',pending:status?'未生成':'读取中'}[state];
 const action=readError?<StoryFlowAction onClick={()=>setRefresh(value=>value+1)}>重新读取进度</StoryFlowAction>:
  applyable?<StoryFlowAction disabled={busy||submitting} aria-busy={busy||submitting} onClick={()=>void control('apply-model')}>应用当前模型设置</StoryFlowAction>:
  offeredControl&&(offeredControl==='pause'||!serviceBlocked)?<StoryFlowAction disabled={busy||submitting} aria-busy={busy||submitting} onClick={()=>void control(offeredControl)}>{offeredControl==='pause'?'暂停生成':'恢复生成'}</StoryFlowAction>:
  canSubmit&&(status.retryToken
   ?<StoryFlowAction disabled={submitting} aria-busy={submitting} onClick={start}>{submitting?'正在提交…':'重试未完成画幅'}</StoryFlowAction>
   :<StoryFlowAction disabled={submitting} aria-busy={submitting} onClick={start}>{submitting?'正在提交…':status.state==='completed'?'另绘一套横版插图':'生成横版插图'}</StoryFlowAction>);
 return <ProductionTimelineRow step={{id:'landscape',label:'横版插图（可选）',state,detail}} stateLabel={stateLabel} moving={running} detailLive>
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
  {status?.earlier?.map(work=><div className="production-stage-actions" key={work.storyId}>
   <span>第 {work.revision} 版横图 · {work.ready} / {work.total} 幅</span>
   {(work.controlAction||work.retryToken||work.startToken)&&<StoryFlowAction disabled={busy||submitting} onClick={()=>void updateEarlier(work)}>
    {work.controlAction==='pause'?'暂停':work.controlAction==='resume'?'恢复':work.startToken?'继续绘制旧版横图':'重试未完成画幅'}</StoryFlowAction>}
   {work.error&&<p className="yu-batch-error" role="alert">{work.error}</p>}
  </div>)}
  {action&&<div className="production-stage-actions">{action}</div>}
 </ProductionTimelineRow>;
}
