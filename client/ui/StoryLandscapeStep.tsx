// 已完成作品的横版插图步骤，后台继续生成，界面只读取状态并提交明确的启动或重试操作。
import {useEffect,useState} from 'react';
import type {LandscapeStatus} from '@/lib/reader-production';
import type {ProductionStageState} from '@/lib/production-stages';
import {ProductionTimelineRow} from './ProductionTimeline';
import StoryFlowAction from './StoryFlowAction';
import {request} from './shared';

export function storyLandscapeRoute(id:string){return `reader/sessions/${encodeURIComponent(id)}/landscape`;}

export default function StoryLandscapeStep({storyId}:{storyId:string}){
 const path=storyLandscapeRoute(storyId);
 const [status,setStatus]=useState<LandscapeStatus|null>(null);
 const [refresh,setRefresh]=useState(0);
 const [submitting,setSubmitting]=useState(false);
 const [readError,setReadError]=useState('');
 const [actionError,setActionError]=useState('');
 useEffect(()=>{
  let live=true,timer:ReturnType<typeof setTimeout>|undefined;
  async function poll(){
   try{
    const next:LandscapeStatus=await request(path);
    if(!live)return;
    setStatus(next);setReadError('');
    if(next.state==='running')timer=setTimeout(()=>void poll(),2000);
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
 const partial=status?.state==='partial';
 const canSubmit=status?.available&&!!(status.startToken||status.retryToken);
 const detail=status?.state==='completed'?'插图已齐全，横版 PDF 会使用这套图。':
  status?.state==='running'? `正在生成，已保存 ${status.ready} / ${status.total} 幅。`:
  partial?`已保存 ${status.ready} / ${status.total} 幅${status.failed.length?'，待重试第 '+status.failed.join('、')+' 幅':''}。`:
  status?.available?'按原图和分镜绘制 3∶2 横图，供印刷使用。':status?'当前暂无法启动横版生成。':'正在读取横版进度…';
 const error=readError||actionError||status?.error;
 const running=status?.state==='running';
 const state:ProductionStageState=readError?'failed':running?'current':status?.state==='completed'?'done':partial||actionError?'failed':status&&!status.available?'unavailable':'pending';
 const stateLabel={failed:readError?'读取失败':partial?'待重试':'提交失败',current:'进行中',done:'已完成',unavailable:'暂不可用',pending:status?'未生成':'读取中'}[state];
 const action=readError?<StoryFlowAction onClick={()=>setRefresh(value=>value+1)}>重新读取进度</StoryFlowAction>:
  canSubmit&&<StoryFlowAction disabled={submitting} aria-busy={submitting} onClick={start}>{submitting?'正在提交…':partial?'重试未完成画幅':'生成横版插图'}</StoryFlowAction>;
 return <ProductionTimelineRow step={{id:'landscape',label:'横版插图（可选）',state,detail}} stateLabel={stateLabel} moving={running} detailLive>
  {(error||action)&&<>{error&&<p className="yu-batch-error" role="alert">{error}</p>}{action&&<span>{action}</span>}</>}
 </ProductionTimelineRow>;
}
