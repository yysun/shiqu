// 已完成作品的横版插图步骤：显示后台进度，并提供启动、暂停、恢复及重试的文字链接。
// 横图操作仅提交到套图来源版本的横图接口。
import {productionServiceMessages} from '@/lib/production-lifecycle';
import {useEffect,useEffectEvent,useRef,useState} from 'react';
import type {LandscapeCommand,EarlierLandscapeWork,LandscapeStatus,LandscapePrintSetInfo} from '@/lib/reader-production';
import {getArtStyle,type ArtStyleId} from '@/lib/reader-styles';
import type {ProductionStageState} from '@/lib/production-stages';
import {ProductionTimelineRow} from './ProductionTimeline';
import Sheet from './StorySheet';
import StoryArtStylePicker from './StoryArtStylePicker';
import StoryFlowAction from './StoryFlowAction';
import {request} from './shared';

const printServiceMessages={...productionServiceMessages,'snapshot-unavailable':'这套横图原用的绘图服务不可用。'};

export function storyLandscapeRoute(id:string){return `reader/sessions/${encodeURIComponent(id)}/landscape`;}
export function landscapeSetList(id:string):Promise<LandscapePrintSetInfo[]>{return request(storyLandscapeRoute(id)+'/sets?summary=1');}
const setStates={completed:'已完成',running:'生成中',paused:'已暂停',partial:'缺图'};
function landscapeSetRows(sets:LandscapePrintSetInfo[]){
 const rows=sets.map(set=>({
  set,
  style:set.artStyle?getArtStyle(set.artStyle).label:'画风未记录',
  progress:`${setStates[set.state]} ${set.ready}/${set.total} 幅`,
  revision:set.matchesSavedPages?'':`原分镜第 ${set.revision} 版`,
  setNumber:'',
 }));
 const byStyle=new Map<string,typeof rows>();
 for(const row of rows){
  const group=byStyle.get(row.style);
  if(group)group.push(row);
  else byStyle.set(row.style,[row]);
 }
 // 套图列表按最新优先返回，同画风从最早一套起编号。
 for(const group of byStyle.values()){
  if(group.length<2)continue;
  group.forEach((row,index)=>{row.setNumber=`第 ${group.length-index} 套`;});
 }
 return rows;
}
function landscapeSetLabel({style,setNumber,progress,revision}:ReturnType<typeof landscapeSetRows>[number]){
 return [style,setNumber,progress,revision].filter(Boolean).join(' · ');
}
export function landscapeSetOptions(sets:LandscapePrintSetInfo[]){
 return landscapeSetRows(sets).map(row=>({id:row.set.id,label:landscapeSetLabel(row)}));
}

type Props={storyId:string;savedPages:string;onActivityChange?:()=>void;exportMissing?:{total:number;ready:number;missingPages:number[]};tone?:'dark'};
export default function StoryLandscapeStep({storyId,savedPages,onActivityChange,exportMissing,tone}:Props){
 const path=storyLandscapeRoute(storyId);
 const [status,setStatus]=useState<LandscapeStatus|null>(null);
 const [refresh,setRefresh]=useState(0);
 const [submitting,setSubmitting]=useState(false);
 const [readError,setReadError]=useState('');
 const [actionError,setActionError]=useState<{message:string;printId?:string}|null>(null);
 const [setup,setSetup]=useState<{startToken:string;artStyle:ArtStyleId;label:string}|null>(null);
 const [sets,setSets]=useState<LandscapePrintSetInfo[]>([]);
 const [setsError,setSetsError]=useState('');
 const [confirmDiscard,setConfirmDiscard]=useState<string|null>(null);
 const submitLock=useRef(false);
 const wasRunning=useRef(false);
 const selectedStyle=setup&&getArtStyle(setup.artStyle);
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
 async function updatePrint(id:string,command:LandscapeCommand,printId?:string){
  if(submitLock.current||readError)return;
  submitLock.current=true;
  setSubmitting(true);setActionError(null);
  try{
   const next:LandscapeStatus=await request(storyLandscapeRoute(id),'POST',command);
   if(id===storyId)setStatus(next);
   if('startToken'in command)setSetup(null);
   if('discardPrintId'in command)setConfirmDiscard(null);
  }catch(error){setActionError({message:error instanceof Error?error.message:'暂时无法更新横图。',printId});}
  finally{submitLock.current=false;setSubmitting(false);setRefresh(value=>value+1);}
 }
 function workActions(id:string,work:EarlierLandscapeWork|LandscapeStatus){
  if(readError)return null;
  const link=(label:string,command:LandscapeCommand)=><StoryFlowAction tone={tone} disabled={submitting} onClick={()=>void updatePrint(id,command,work.printId)}>{label}</StoryFlowAction>;
  const earlier=id!==storyId;
  const earlierPages='matchesSavedPages' in work&&work.matchesSavedPages===false;
  const referenceError=work.state!=='completed'&&work.referenceError;
  return <>
   {(work.readUnavailable||referenceError)&&<StoryFlowAction tone={tone} onClick={()=>setRefresh(value=>value+1)}>{referenceError?'重新核对参考竖图':'重新读取进度'}</StoryFlowAction>}
   {work.modelToken&&work.state!=='completed'&&link('应用当前横图模型',{modelToken:work.modelToken})}
   {work.controlAction&&(work.controlAction==='pause'||!work.service||work.service==='available')&&
    link(work.controlAction==='pause'?(earlier?'暂停':'暂停生成'):(earlier?'恢复':'恢复生成'),{control:work.controlAction,printId:work.printId})}
   {work.retryToken&&link(earlierPages?'重试先前分镜的未完成画幅':'重试未完成画幅',{retryToken:work.retryToken})}
  </>;
 }
 function startAction(id:string,work:EarlierLandscapeWork|LandscapeStatus){
  const {startToken}=work;
  const earlierPages='matchesSavedPages' in work&&work.matchesSavedPages===false;
  if(!startToken||readError||work.retryToken&&!earlierPages||exportMissing&&work.state==='completed'&&!earlierPages)return null;
  if(id!==storyId)return <StoryFlowAction tone={tone} disabled={submitting} onClick={()=>void updatePrint(id,{startToken},work.printId)}>继续绘制旧版横图</StoryFlowAction>;
  const label=exportMissing?'开始制作横图':earlierPages?'按当前分镜绘制横图':work.state==='completed'?'另绘一套横版插图':'生成横版插图';
  return <StoryFlowAction tone={tone} disabled={submitting} onClick={()=>setSetup({startToken,artStyle:status?.defaultArtStyle??getArtStyle(null).id,label})}>{label}</StoryFlowAction>;
 }
 function closeSetup(){
  if(submitLock.current)return;
  setSetup(null);setActionError(null);
 }
 const earlierWork=exportMissing?[]:status?.earlier??[];
 const hasSet=(printId:string|undefined)=>!!printId&&!exportMissing&&sets.some(set=>set.id===printId);
 const currentInList=hasSet(status?.printId);
 // 已完成套图的参考图核对针对下一次开画，提示和重试留在步骤中。
 const nextSetReferenceError=status?.state==='completed'&&status.referenceError;
 const stepReferenceError=nextSetReferenceError||(!currentInList&&status?.referenceError);
 const manual=status?.state==='running'&&status.control&&status.control!=='active';
 const partial=status?.state==='partial';
 const serviceBlocked=status&&status.state!=='completed'&&status.service&&status.service!=='available'?status.service:null;
 const canSubmit=status?.available&&!!(status.startToken||status.retryToken);
 const showExportMissing=exportMissing&&(!status||status.state==='idle'||status.matchesSavedPages===false);
 const startInHeading=!!exportMissing&&status?.state==='idle'&&!!status.startToken&&!readError;
 // 可以启动或重试却没有令牌（旧版本、服务停止等）时说明原因，不只隐藏操作。
 const withheld=!!status?.available&&!canSubmit&&(status.state==='idle'||status.state==='partial'&&status.failed.length>0);
 const detail=serviceBlocked&&status?.retryToken?'可先核对已保存的横图。重新绘制需要可用的绘图服务。':serviceBlocked?printServiceMessages[serviceBlocked]:withheld&&!manual?'当前没有可执行的横图操作。':manual?'横版制作等待恢复，已保存的画幅会保留。':status?.state==='completed'?(status.matchesSavedPages===false?'这套横图已完成，对应先前保存的分镜。':exportMissing?'横图已齐全，可以导出打印 PDF。':'横图已齐全，打印时按当前分镜顺序排版。'):
  status?.state==='running'? `正在生成，已保存 ${status.ready} / ${status.total} 幅。`:
  status?.readUnavailable?`已核对 ${status.ready} / ${status.total} 幅。`:
  partial?`${status.matchesSavedPages===false?'先前分镜已保存':'已保存'} ${status.ready} / ${status.total} 幅${status.failed.length?'，待重试第 '+status.failed.join('、')+' 幅':''}。`:
  status?.available?'按原图和分镜绘制 3∶2 横图，供印刷使用。':status?'当前暂无法启动横版生成。':'正在读取横版进度…';
 const setupError=setup&&(readError||(!actionError?.printId&&actionError?.message));
 const error=readError||(!setupError&&!hasSet(actionError?.printId)&&actionError?.message)||(!currentInList&&status?.error);
 const running=status?.state==='running'&&!serviceBlocked&&!manual;
 const state:ProductionStageState=readError?'failed':serviceBlocked||manual?'paused':running?'current':status?.state==='completed'?'done':partial||actionError?'failed':status&&!status.available?'unavailable':'pending';
 const runningInList=state==='current'&&!exportMissing&&sets.some(set=>set.id===status?.printId&&set.state==='running');
 const stateLabel={paused:serviceBlocked?'等待服务':'等待恢复',failed:readError||status?.readUnavailable?'读取失败':partial?'待重试':'提交失败',current:'',done:'已完成',unavailable:'暂不可用',pending:status?'未生成':'读取中'}[state];
 const start=status&&startAction(storyId,status);
 return <ProductionTimelineRow step={{id:'landscape',label:exportMissing?'横版插图':'横版插图（可选）',state,detail:startInHeading||runningInList?'':detail}}
  name={showExportMissing?`缺 ${exportMissing.missingPages.length} 幅横图`:undefined}
  stateLabel={startInHeading?'':stateLabel} navigation={startInHeading?start:undefined} moving={running} detailLive>
  {showExportMissing&&exportMissing.ready>0&&<details className="yu-recovery-detail"><summary>查看缺图幅号</summary><p>第 {exportMissing.missingPages.join('、')} 幅</p></details>}
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
  {stepReferenceError&&<p className="yu-batch-error" role="alert">{stepReferenceError}</p>}
  {setup&&selectedStyle&&<Sheet title="选择横图画风" busy={submitting} onClose={closeSetup}>
   <div className="landscape-style-dialog">
    <div className="landscape-style-options">
     <StoryArtStylePicker value={setup.artStyle} disabled={submitting} onChange={artStyle=>setSetup({...setup,artStyle})}/>
    </div>
    <div className="landscape-style-footer">
     <p role="status">已选 <strong>{selectedStyle.label}</strong> · {selectedStyle.description}
      {(selectedStyle.id==='3d-animation'||selectedStyle.id==='clay')&&'，输出静态画面'}
     </p>
     {setupError?<p role="alert">{setupError}</p>:status?.startToken!==setup.startToken&&<p role="alert">横图状态已更新，请关闭后重新打开画风选择。</p>}
     <div className="landscape-style-actions">
      <button type="button" className="yu-revision-open" disabled={submitting} onClick={closeSetup}>取消</button>
      <button type="button" className="yu-primary" disabled={submitting||status?.startToken!==setup.startToken||!!readError}
       onClick={()=>void updatePrint(storyId,{startToken:setup.startToken,artStyle:setup.artStyle})}>确认{setup.label}</button>
     </div>
    </div>
   </div>
  </Sheet>}
  {setsError&&<div className="production-stage-actions"><p className="yu-batch-error" role="alert">{setsError}</p><StoryFlowAction tone={tone} onClick={()=>setRefresh(value=>value+1)}>重新读取套图</StoryFlowAction></div>}
  {sets.length>0&&<section aria-label="横图套图">
   <ul className="landscape-set-list">{landscapeSetRows(sets).map(row=>{
    const {set,style,setNumber,progress,revision}=row;
    const current=status?.printId===set.id;
    const work=current?status:earlierWork.find(item=>item.printId===set.id);
    const rowError=actionError?.printId===set.id?actionError.message:work?.error;
    const confirming=set.discardable&&confirmDiscard===set.id;
    const discardLabel=set.state==='completed'?'删除套图':'删除未完成套图';
    return <li key={set.id}>
     <div className="landscape-set-heading">
      <p className="landscape-set-title"><span><strong>{style}</strong>{setNumber&&` ${setNumber}`}</span><span role={set.state==='running'?'status':undefined}>{progress}</span></p>
      {!confirming&&<div className="production-stage-actions">
       {work&&workActions(set.storyId,work)}
       {!current&&work&&startAction(set.storyId,work)}
       {set.discardable&&<StoryFlowAction tone={tone} disabled={submitting||!!readError} aria-label={`${discardLabel}，${landscapeSetLabel(row)}`}
        onClick={()=>setConfirmDiscard(set.id)}>{discardLabel}</StoryFlowAction>}
      </div>}
     </div>
     {(revision||set.awaitingSettle)&&<p className="landscape-set-meta">
      {revision&&<span>{revision}</span>}{set.awaitingSettle&&<span>正在收尾</span>}
     </p>}
     {!current&&work?.service&&work.service!=='available'&&<p>{printServiceMessages[work.service]}</p>}
     {work?.state!=='completed'&&work?.referenceError&&<p className="yu-batch-error" role="alert">{work.referenceError}</p>}
     {rowError&&<p className="yu-batch-error" role="alert">{rowError}</p>}
     {confirming&&<>
      <p>删除后，这套图将从制作和打印列表移除。</p>
      <div className="production-stage-actions">
       <StoryFlowAction tone={tone} disabled={submitting} onClick={()=>{setConfirmDiscard(null);setActionError(null);}}>取消</StoryFlowAction>
       <StoryFlowAction tone={tone} intent="danger" disabled={submitting||!!readError}
        onClick={()=>void updatePrint(set.storyId,{discardPrintId:set.id},set.id)}>确认删除这套横图</StoryFlowAction>
      </div>
     </>}
    </li>;
   })}</ul>
  </section>}
  {earlierWork.filter(work=>!hasSet(work.printId)).map(work=><div className="production-stage-actions" key={work.storyId}>
   <span>第 {work.revision} 版横图 · {work.ready} / {work.total} 幅</span>
   {workActions(work.storyId,work)}{startAction(work.storyId,work)}
   {work.service&&work.service!=='available'&&<span>{printServiceMessages[work.service]}</span>}
   {work.referenceError&&<p className="yu-batch-error" role="alert">{work.referenceError}</p>}
   {work.error&&<p className="yu-batch-error" role="alert">{work.error}</p>}
  </div>)}
  {!startInHeading&&<div className="production-stage-actions">{readError?<StoryFlowAction tone={tone} onClick={()=>setRefresh(value=>value+1)}>重新读取进度</StoryFlowAction>:<>
   {nextSetReferenceError&&<StoryFlowAction tone={tone} onClick={()=>setRefresh(value=>value+1)}>重新核对参考竖图</StoryFlowAction>}
   {status&&!currentInList&&workActions(storyId,status)}{start}
  </>}</div>}
 </ProductionTimelineRow>;
}
