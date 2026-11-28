// 已完成作品的横版插图步骤：显示后台进度，并提供启动、暂停、恢复及重试的文字链接。
// 横图操作仅提交到套图来源版本的横图接口。
import {productionServiceMessages} from '@/lib/production-lifecycle';
import {useEffect,useEffectEvent,useRef,useState} from 'react';
import type {LandscapeCommand,EarlierLandscapeWork,LandscapeStatus,LandscapePrintSetInfo} from '@/lib/reader-production';
import {getArtStyle,type ArtStyleId} from '@/lib/reader-styles';
import type {ProductionStageState} from '@/lib/production-stages';
import {ProductionTimelineRow} from './ProductionTimeline';
import StoryFlowAction from './StoryFlowAction';
import StoryArtStylePicker from './StoryArtStylePicker';
import {request} from './shared';

const printServiceMessages={...productionServiceMessages,'snapshot-unavailable':'这套横图原用的绘图服务不可用。'};

export function storyLandscapeRoute(id:string){return `reader/sessions/${encodeURIComponent(id)}/landscape`;}
export function landscapeSetList(id:string):Promise<LandscapePrintSetInfo[]>{return request(storyLandscapeRoute(id)+'/sets?summary=1');}
const setStates={completed:'已完成',running:'生成中',paused:'已暂停',partial:'缺图'};
export function landscapeSetLabel(set:LandscapePrintSetInfo){
 const date=new Date(set.createdAt);
 return [set.artStyle?getArtStyle(set.artStyle).label:'画风未记录',`${setStates[set.state]} ${set.ready}/${set.total} 幅`,
  Number.isNaN(date.valueOf())?'':date.toLocaleString('zh-CN',{dateStyle:'short',timeStyle:'medium'}),
  set.matchesSavedPages?'':`原分镜第 ${set.revision} 版`].filter(Boolean).join(' · ');
}

type Props={storyId:string;savedPages:string;onActivityChange?:()=>void;exportMissing?:{total:number;ready:number;missingPages:number[]};tone?:'dark'};
export default function StoryLandscapeStep({storyId,savedPages,onActivityChange,exportMissing,tone}:Props){
 const path=storyLandscapeRoute(storyId);
 const [status,setStatus]=useState<LandscapeStatus|null>(null);
 const [refresh,setRefresh]=useState(0);
 const [submitting,setSubmitting]=useState(false);
 const [readError,setReadError]=useState('');
 const [actionError,setActionError]=useState('');
 const [setup,setSetup]=useState<{startToken:string;artStyle:ArtStyleId;label:string}|null>(null);
 const [sets,setSets]=useState<LandscapePrintSetInfo[]>([]);
 const [setsError,setSetsError]=useState('');
 const [confirmDiscard,setConfirmDiscard]=useState<string|null>(null);
 const submitLock=useRef(false);
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
 const printProgress=status?JSON.stringify([status.printId,status.state,status.ready,status.control,status.failed,
  status.earlier?.map(item=>[item.printId,item.state,item.ready,item.control,item.failed])]):'';
 useEffect(()=>{
  if(!printProgress||exportMissing)return;
  let live=true;
  void landscapeSetList(storyId).then(next=>{
   if(live){setSets(next);setSetsError('');}
  }).catch(()=>{if(live)setSetsError('暂时无法读取横图套图。');});
  return()=>{live=false;};
 },[storyId,printProgress,exportMissing,refresh,savedPages]);
 async function updatePrint(id:string,command:LandscapeCommand){
  if(submitLock.current||readError)return;
  submitLock.current=true;
  setSubmitting(true);setActionError('');
  try{
   const next:LandscapeStatus=await request(storyLandscapeRoute(id),'POST',command);
   if(id===storyId)setStatus(next);
   if('startToken'in command)setSetup(null);
   if('discardPrintId'in command)setConfirmDiscard(null);
  }catch(error){setActionError(error instanceof Error?error.message:'暂时无法更新横图。');}
  finally{submitLock.current=false;setSubmitting(false);setRefresh(value=>value+1);}
 }
 function actions(id:string,work:EarlierLandscapeWork|LandscapeStatus){
  const link=(label:string,command:LandscapeCommand)=><StoryFlowAction tone={tone} disabled={submitting} onClick={()=>void updatePrint(id,command)}>{label}</StoryFlowAction>;
  const earlier=id!==storyId;
  const earlierPages='matchesSavedPages' in work&&work.matchesSavedPages===false;
  const startToken=work.startToken;
  const startLabel=earlier?'继续绘制旧版横图':exportMissing?'开始制作横图':earlierPages?'按当前分镜绘制横图':work.state==='completed'?'另绘一套横版插图':'生成横版插图';
  return <>
   {(work.readUnavailable||work.referenceError)&&<StoryFlowAction tone={tone} onClick={()=>setRefresh(value=>value+1)}>{work.referenceError?'重新核对参考竖图':'重新读取进度'}</StoryFlowAction>}
   {work.modelToken&&work.state!=='completed'&&link('应用当前横图模型',{modelToken:work.modelToken})}
   {work.controlAction&&(work.controlAction==='pause'||!work.service||work.service==='available')&&
    link(work.controlAction==='pause'?(earlier?'暂停':'暂停生成'):(earlier?'恢复':'恢复生成'),{control:work.controlAction,printId:work.printId})}
   {work.retryToken&&link(earlierPages?'重试先前分镜的未完成画幅':'重试未完成画幅',{retryToken:work.retryToken})}
   {startToken&&(!work.retryToken||earlierPages)&&(!exportMissing||work.state!=='completed'||earlierPages)&&
    (earlier?link(startLabel,{startToken}):!setup&&
     <StoryFlowAction tone={tone} disabled={submitting} onClick={()=>setSetup({startToken,artStyle:status?.defaultArtStyle??getArtStyle(null).id,label:startLabel})}>{startLabel}</StoryFlowAction>)}
  </>;
 }
 const manual=status?.state==='running'&&status.control&&status.control!=='active';
 const partial=status?.state==='partial';
 const serviceBlocked=status&&status.state!=='completed'&&status.service&&status.service!=='available'?status.service:null;
 const canSubmit=status?.available&&!!(status.startToken||status.retryToken);
 const showExportMissing=exportMissing&&(!status||status.state==='idle'||status.matchesSavedPages===false);
 const startInHeading=!!exportMissing&&status?.state==='idle'&&!!status.startToken&&!readError&&!setup;
 // 可以启动或重试却没有令牌（旧版本、服务停止等）时说明原因，不只隐藏操作。
 const withheld=!!status?.available&&!canSubmit&&(status.state==='idle'||status.state==='partial'&&status.failed.length>0);
 const detail=serviceBlocked&&status?.retryToken?'可先核对已保存的横图。重新绘制需要可用的绘图服务。':serviceBlocked?printServiceMessages[serviceBlocked]:withheld&&!manual?'当前没有可执行的横图操作。':manual?'横版制作等待恢复，已保存的画幅会保留。':status?.state==='completed'?(status.matchesSavedPages===false?'这套横图已完成，对应先前保存的分镜。':exportMissing?'横图已齐全，可以导出打印 PDF。':'横图已齐全，打印时按当前分镜顺序排版。'):
  status?.state==='running'? `正在生成，已保存 ${status.ready} / ${status.total} 幅。`:
  status?.readUnavailable?`已核对 ${status.ready} / ${status.total} 幅。`:
  partial?`${status.matchesSavedPages===false?'先前分镜已保存':'已保存'} ${status.ready} / ${status.total} 幅${status.failed.length?'，待重试第 '+status.failed.join('、')+' 幅':''}。`:
  status?.available?'按原图和分镜绘制 3∶2 横图，供印刷使用。':status?'当前暂无法启动横版生成。':'正在读取横版进度…';
 const error=readError||actionError||status?.error;
 const running=status?.state==='running'&&!serviceBlocked&&!manual;
 const state:ProductionStageState=readError?'failed':serviceBlocked||manual?'paused':running?'current':status?.state==='completed'?'done':partial||actionError?'failed':status&&!status.available?'unavailable':'pending';
 const stateLabel={paused:serviceBlocked?'等待服务':'等待恢复',failed:readError||status?.readUnavailable?'读取失败':partial?'待重试':'提交失败',current:'进行中',done:'已完成',unavailable:'暂不可用',pending:status?'未生成':'读取中'}[state];
 const action=readError?<StoryFlowAction tone={tone} onClick={()=>setRefresh(value=>value+1)}>重新读取进度</StoryFlowAction>:
  status&&(status.referenceError||status.readUnavailable||status.controlAction||status.modelToken||canSubmit)?actions(storyId,status):null;
 return <ProductionTimelineRow step={{id:'landscape',label:exportMissing?'横版插图':'横版插图（可选）',state,detail:startInHeading?'':detail}}
  name={showExportMissing?`缺 ${exportMissing.missingPages.length} 幅横图`:undefined}
  stateLabel={startInHeading?'':stateLabel} navigation={startInHeading?action:undefined} moving={running} detailLive>
  {showExportMissing&&exportMissing.ready>0&&<details className="yu-recovery-detail"><summary>查看缺图幅号</summary><p>第 {exportMissing.missingPages.join('、')} 幅</p></details>}
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
  {status?.referenceError&&<p className="yu-batch-error" role="alert">{status.referenceError}</p>}
  {setup&&<div>
   <StoryArtStylePicker value={setup.artStyle} disabled={submitting} onChange={artStyle=>setSetup({...setup,artStyle})}/>
   {status?.startToken!==setup.startToken&&<p role="status">横图状态已更新，请取消后重新选择画风。</p>}
   <div className="production-stage-actions">
    <StoryFlowAction tone={tone} disabled={submitting} onClick={()=>{setSetup(null);setActionError('');}}>取消</StoryFlowAction>
    <StoryFlowAction tone={tone} disabled={submitting||status?.startToken!==setup.startToken||!!readError}
     onClick={()=>void updatePrint(storyId,{startToken:setup.startToken,artStyle:setup.artStyle})}>确认{setup.label}</StoryFlowAction>
   </div>
  </div>}
  {setsError&&<div className="production-stage-actions"><p className="yu-batch-error" role="alert">{setsError}</p><StoryFlowAction tone={tone} onClick={()=>setRefresh(value=>value+1)}>重新读取套图</StoryFlowAction></div>}
  {sets.length>0&&<details className="yu-recovery-detail" open={sets.length>1||undefined}><summary>横图套图（{sets.length} 套）</summary>
   <ul>{sets.map(set=><li key={set.id}>
    {landscapeSetLabel(set)}
    {set.awaitingSettle&&<small> · 正在收尾</small>}
    {set.discardable&&(confirmDiscard===set.id?<>
     <p>删除后，这套图将从制作和打印列表移除。</p>
     <div className="production-stage-actions">
      <StoryFlowAction tone={tone} disabled={submitting} onClick={()=>{setConfirmDiscard(null);setActionError('');}}>取消</StoryFlowAction>
      <StoryFlowAction tone={tone} disabled={submitting} onClick={()=>void updatePrint(set.storyId,{discardPrintId:set.id})}>确认删除</StoryFlowAction>
     </div>
    </>:<div className="production-stage-actions">
     <StoryFlowAction tone={tone} disabled={submitting||!!readError} aria-label={`删除未完成套图，${landscapeSetLabel(set)}`} onClick={()=>setConfirmDiscard(set.id)}>删除未完成套图</StoryFlowAction>
    </div>)}
   </li>)}</ul>
  </details>}
  {!exportMissing&&status?.earlier?.map(work=><div className="production-stage-actions" key={work.storyId}>
   <span>第 {work.revision} 版横图 · {work.ready} / {work.total} 幅</span>
   {!readError&&actions(work.storyId,work)}
   {work.service&&work.service!=='available'&&<span>{printServiceMessages[work.service]}</span>}
   {work.referenceError&&<p className="yu-batch-error" role="alert">{work.referenceError}</p>}
   {work.error&&<p className="yu-batch-error" role="alert">{work.error}</p>}
  </div>)}
  {action&&!startInHeading&&<div className="production-stage-actions">{action}</div>}
 </ProductionTimelineRow>;
}
