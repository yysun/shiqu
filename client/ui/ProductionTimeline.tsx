// 各步骤共用一条图标轴。标题行容纳状态和查看、编辑入口，说明与耗时另起一行。
import StoryFlowAction from './StoryFlowAction';
import {generationDuration} from '@/lib/generation-progress';
import type {ReactNode} from 'react';
import {readerMaxAutomaticRepairs} from '../../lib/reader-limits';
import {ArrowRight,Check,Loader2,Minus,Pause,X} from 'lucide-react';
import type {ProductionStage} from '../../lib/production-stages';
import './production-timeline.css';
type StageAction={label:string;ariaLabel?:string;disabled?:boolean;onClick:()=>void};
export type ProductionTimelineNavigation={actions?:Record<string,StageAction>;links?:Record<string,StageAction[]>};
type TimelineLayout='vertical'|'horizontal';

export function ProductionTimelineRow({step,number,layout='vertical',moving=false,awaitingContinue=false,stateLabel,name=step.label,timing,navigation,onHistory,detailLive=false,children}:{step:ProductionStage;number?:number;layout?:TimelineLayout;moving?:boolean;awaitingContinue?:boolean;stateLabel:string;name?:ReactNode;timing?:ReactNode;navigation?:ReactNode;onHistory?:()=>void;detailLive?:boolean;children?:ReactNode}){
 const done=layout==='vertical'&&step.state==='done';
 const PausedIcon=awaitingContinue?ArrowRight:Pause;
 return <li data-stage={step.id} data-state={step.state} aria-current={['current','failed','paused'].includes(step.state)?'step':undefined} title={layout==='horizontal'?`${step.label} · ${stateLabel}\n${step.detail}`:undefined}>
  <span className="production-stage-icon" aria-hidden="true">{step.state==='done'?<Check size={13}/>:step.state==='failed'?<X size={13}/>:step.state==='paused'?<PausedIcon size={12}/>:step.state==='current'&&moving?<Loader2 size={14} className="production-stage-spin"/>:step.state==='skipped'||step.state==='unavailable'||number===undefined?<Minus size={13}/>:number}</span>
  <div className="production-stage-copy">
   <div className="production-stage-heading">
    <strong>{name}</strong>
    {!done&&<span className="production-stage-state">{stateLabel}</span>}
    {layout==='vertical'&&(navigation||onHistory)&&<div className="production-stage-actions">
     {navigation}{onHistory&&<StoryFlowAction onClick={onHistory}>审核记录</StoryFlowAction>}
    </div>}
   </div>
   {(step.detail||timing)&&<div className="production-stage-summary">
    {step.detail&&<small role={detailLive?'status':undefined}>{step.detail}</small>}
    {timing&&<span className="production-stage-timing">{timing}</span>}
   </div>}
  </div>
  {layout==='vertical'&&children&&<div className="production-stage-notice">{children}</div>}
 </li>;
}

export default function ProductionTimeline({stages,moving=false,queued=false,awaitingContinue=false,layout='vertical',actions={},links={},onHistory,stageContent={},stageDurations={},stageTimes={},children}:{stages:ProductionStage[];moving?:boolean;queued?:boolean;awaitingContinue?:boolean;layout?:TimelineLayout;onHistory?:()=>void;stageContent?:Record<string,ReactNode>;stageDurations?:Record<string,number>;stageTimes?:Record<string,ReactNode>;children?:ReactNode;} & ProductionTimelineNavigation){
 const labels={pending:'待进行',current:queued?'等待中':moving?'进行中':'等待更新',done:'已完成',skipped:'无需执行',unavailable:'未启用',failed:'待处理',paused:awaitingContinue?'待继续':'已暂停'};
 const stateLabel=(step:ProductionStage)=>step.id==='count'&&step.state==='current'&&!moving&&!queued?'待确认':labels[step.state];
 const focused=stages.find(step=>['current','failed','paused'].includes(step.state))||stages.find(step=>step.state==='pending')||stages.at(-1);
 const historyStage=[...stages].reverse().find(step=>['review','repair','recheck'].includes(step.id)&&!['pending','skipped','unavailable'].includes(step.state))||stages.find(step=>step.id==='review'&&step.state!=='unavailable');
 return <><ol className={'production-timeline'+(layout==='horizontal'?' production-timeline--horizontal':'')} aria-label="完整审片流程">{stages.map((step,index)=>{
 const done=layout==='vertical'&&step.state==='done',duration=stageDurations[step.id];
 const timing=done?(typeof duration==='number'&&Number.isFinite(duration)&&duration>=0?`${step.durationLabel??'耗时'} ${generationDuration(duration)}`:null):stageTimes[step.id];
 const history=layout==='vertical'&&onHistory&&step.id===historyStage?.id;
 const action=actions[step.id],stepLinks=links[step.id]?.length?links[step.id]:action?[action]:[];
 const navigation=stepLinks.map(link=><StoryFlowAction key={link.ariaLabel??link.label} aria-label={link.ariaLabel} disabled={link.disabled} onClick={link.onClick}>{link.label}</StoryFlowAction>);
 return <ProductionTimelineRow key={step.id} step={step} number={index+1} layout={layout} moving={moving} awaitingContinue={awaitingContinue} stateLabel={stateLabel(step)} name={layout==='horizontal'&&navigation.length?navigation:step.label} timing={timing} navigation={navigation.length?navigation:undefined} onHistory={history?onHistory:undefined}>
  {stageContent[step.id]}
 </ProductionTimelineRow>;
 })}{children}</ol>{layout==='vertical'&&!onHistory&&stages.some(step=>step.id==='review'&&step.state!=='unavailable')&&<p className="production-review-loop" aria-label="审核修复循环">审核 → 修复 → 全篇复核，未通过继续修复；最多自动 {readerMaxAutomaticRepairs} 轮，无变化或到上限则待处理。</p>}{layout==='horizontal'&&focused&&<p className="production-stage-current" data-state={focused.state} role="status"><strong>{focused.label} · {stateLabel(focused)}</strong><span>{focused.detail}</span></p>}</>;
}
