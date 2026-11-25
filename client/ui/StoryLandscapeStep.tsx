// 已完成作品的横版插图步骤：显示后台进度，并提供启动、暂停、恢复及重试的文字链接。
// 横图操作仅提交到套图来源版本的横图接口。
import {productionServiceMessages} from '@/lib/production-lifecycle';
import {useEffect,useEffectEvent,useRef,useState} from 'react';
import type {LandscapeCommand,EarlierLandscapeWork,LandscapeStatus} from '@/lib/reader-production';
import type {ProductionStageState} from '@/lib/production-stages';
import {ProductionTimelineRow} from './ProductionTimeline';
import StoryFlowAction from './StoryFlowAction';
import {request} from './shared';

const printServiceMessages={...productionServiceMessages,'snapshot-unavailable':'这套横图原用的绘图服务不可用。'};

export function storyLandscapeRoute(id:string){return `reader/sessions/${encodeURIComponent(id)}/landscape`;}

type Props={storyId:string;savedPages:string;onActivityChange?:()=>void};
export default function StoryLandscapeStep({storyId,savedPages,onActivityChange}:Props){
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
 },[path,refresh,savedPages]);
 async function updatePrint(id:string,command:LandscapeCommand){
  if(submitting||readError)return;
  setSubmitting(true);setActionError('');
  try{
   const next:LandscapeStatus=await request(storyLandscapeRoute(id),'POST',command);
   if(id===storyId)setStatus(next);
  }catch(error){setActionError(error instanceof Error?error.message:'暂时无法更新横图。');}
  finally{setSubmitting(false);setRefresh(value=>value+1);}
 }
 function actions(id:string,work:EarlierLandscapeWork|LandscapeStatus){
  const link=(label:string,command:LandscapeCommand)=><StoryFlowAction disabled={submitting} onClick={()=>void updatePrint(id,command)}>{label}</StoryFlowAction>;
  const earlier=id!==storyId;
  const earlierPages='matchesSavedPages' in work&&work.matchesSavedPages===false;
  const startLabel=earlier?'继续绘制旧版横图':earlierPages?'按当前分镜绘制横图':work.state==='completed'?'另绘一套横版插图':'生成横版插图';
  return <>
   {(work.readUnavailable||work.referenceError)&&<StoryFlowAction onClick={()=>setRefresh(value=>value+1)}>{work.referenceError?'重新核对参考竖图':'重新读取进度'}</StoryFlowAction>}
   {work.modelToken&&work.state!=='completed'&&link('应用当前横图模型',{modelToken:work.modelToken})}
   {work.controlAction&&(work.controlAction==='pause'||!work.service||work.service==='available')&&
    link(work.controlAction==='pause'?(earlier?'暂停':'暂停生成'):(earlier?'恢复':'恢复生成'),{control:work.controlAction,printId:work.printId})}
   {work.retryToken&&link(earlierPages?'重试先前分镜的未完成画幅':'重试未完成画幅',{retryToken:work.retryToken})}
   {work.startToken&&(!work.retryToken||earlierPages)&&link(startLabel,{startToken:work.startToken})}
  </>;
 }
 const manual=status?.state==='running'&&status.control&&status.control!=='active';
 const partial=status?.state==='partial';
 const serviceBlocked=status&&status.state!=='completed'&&status.service&&status.service!=='available'?status.service:null;
 const canSubmit=status?.available&&!!(status.startToken||status.retryToken);
 // 可以启动或重试却没有令牌（旧版本、服务停止等）时说明原因，不只隐藏操作。
 const withheld=!!status?.available&&!canSubmit&&(status.state==='idle'||status.state==='partial'&&status.failed.length>0);
 const detail=serviceBlocked&&status?.retryToken?'可先核对已保存的横图。重新绘制需要可用的绘图服务。':serviceBlocked?printServiceMessages[serviceBlocked]:withheld&&!manual?'当前没有可执行的横图操作。':manual?'横版制作等待恢复，已保存的画幅会保留。':status?.state==='completed'?(status.matchesSavedPages===false?'这套横图已完成，对应先前保存的分镜。':'横图已齐全，打印时按当前分镜顺序排版。'):
  status?.state==='running'? `正在生成，已保存 ${status.ready} / ${status.total} 幅。`:
  status?.readUnavailable?`已核对 ${status.ready} / ${status.total} 幅。`:
  partial?`${status.matchesSavedPages===false?'先前分镜已保存':'已保存'} ${status.ready} / ${status.total} 幅${status.failed.length?'，待重试第 '+status.failed.join('、')+' 幅':''}。`:
  status?.available?'按原图和分镜绘制 3∶2 横图，供印刷使用。':status?'当前暂无法启动横版生成。':'正在读取横版进度…';
 const error=readError||actionError||status?.error;
 const running=status?.state==='running'&&!serviceBlocked&&!manual;
 const state:ProductionStageState=readError?'failed':serviceBlocked||manual?'paused':running?'current':status?.state==='completed'?'done':partial||actionError?'failed':status&&!status.available?'unavailable':'pending';
 const stateLabel={paused:serviceBlocked?'等待服务':'等待恢复',failed:readError||status?.readUnavailable?'读取失败':partial?'待重试':'提交失败',current:'进行中',done:'已完成',unavailable:'暂不可用',pending:status?'未生成':'读取中'}[state];
 const action=readError?<StoryFlowAction onClick={()=>setRefresh(value=>value+1)}>重新读取进度</StoryFlowAction>:
  status&&(status.referenceError||status.readUnavailable||status.controlAction||status.modelToken||canSubmit)?actions(storyId,status):null;
 return <ProductionTimelineRow step={{id:'landscape',label:'横版插图（可选）',state,detail}} stateLabel={stateLabel} moving={running} detailLive>
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
  {status?.referenceError&&<p className="yu-batch-error" role="alert">{status.referenceError}</p>}
  {status?.earlier?.map(work=><div className="production-stage-actions" key={work.storyId}>
   <span>第 {work.revision} 版横图 · {work.ready} / {work.total} 幅</span>
   {!readError&&actions(work.storyId,work)}
   {work.service&&work.service!=='available'&&<span>{printServiceMessages[work.service]}</span>}
   {work.referenceError&&<p className="yu-batch-error" role="alert">{work.referenceError}</p>}
   {work.error&&<p className="yu-batch-error" role="alert">{work.error}</p>}
  </div>)}
  {action&&<div className="production-stage-actions">{action}</div>}
 </ProductionTimelineRow>;
}
