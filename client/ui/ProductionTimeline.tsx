// Keep every checkpoint on a shared icon axis, with navigation and feedback under its step.
// 审核记录与耗时归入同一详情行，让故事设置里的所有步骤使用一致的对齐规则。
import {Fragment} from 'react';
import StoryFlowAction from './StoryFlowAction';
import {generationDuration} from '@/lib/generation-progress';
import type {ReactNode} from 'react';
import {readerMaxAutomaticRepairs} from '../../lib/reader-limits';
import {Check,Loader2,Minus,Pause,X} from 'lucide-react';
import type {ProductionStage} from '../../lib/production-stages';
import './production-timeline.css';
type StageAction={label:string;onClick:()=>void};
export type ProductionTimelineNavigation={actions?:Record<string,StageAction>;links?:Record<string,StageAction[]>};
export default function ProductionTimeline({stages,moving=false,queued=false,layout='vertical',actions={},links={},onHistory,stageContent={},stageDurations={},stageTimes={}}:{stages:ProductionStage[];moving?:boolean;queued?:boolean;layout?:'vertical'|'horizontal';onHistory?:()=>void;stageContent?:Record<string,ReactNode>;stageDurations?:Record<string,number>;stageTimes?:Record<string,ReactNode>;} & ProductionTimelineNavigation){
 const labels={pending:'待进行',current:queued?'等待中':moving?'进行中':'等待更新',done:'已完成',skipped:'无需执行',unavailable:'未启用',failed:'待处理',paused:'已暂停'};
 const stateLabel=(step:ProductionStage)=>step.id==='count'&&step.state==='current'&&!moving&&!queued?'待确认':labels[step.state];
 const focused=stages.find(step=>['current','failed','paused'].includes(step.state))||stages.find(step=>step.state==='pending')||stages.at(-1);
 const historyStage=[...stages].reverse().find(step=>['review','repair','recheck'].includes(step.id)&&!['pending','skipped','unavailable'].includes(step.state))||stages.find(step=>step.id==='review'&&step.state!=='unavailable');
 return <><ol className={'production-timeline'+(layout==='horizontal'?' production-timeline--horizontal':'')} aria-label="完整审片流程">{stages.map((step,index)=>{
 const done=layout==='vertical'&&step.state==='done',duration=stageDurations[step.id];
 const timing=done?(typeof duration==='number'&&Number.isFinite(duration)&&duration>=0?`耗时 ${generationDuration(duration)}`:null):stageTimes[step.id];
 const history=layout==='vertical'&&onHistory&&step.id===historyStage?.id;
 const name=links[step.id]?.length?links[step.id].map((link,index)=><Fragment key={link.label}>{index>0&&<span aria-hidden="true">与</span>}<StoryFlowAction onClick={link.onClick}>{link.label}</StoryFlowAction></Fragment>):actions[step.id]?<StoryFlowAction aria-label={actions[step.id].label} onClick={actions[step.id].onClick}>{step.label}</StoryFlowAction>:step.label;
 return <li key={step.id} className={[done?'production-stage-complete':'',layout==='vertical'&&stageContent[step.id]?'has-stage-content':''].filter(Boolean).join(' ')||undefined} data-stage={step.id} data-state={step.state} aria-current={['current','failed','paused'].includes(step.state)?'step':undefined} title={layout==='horizontal'?`${step.label} · ${stateLabel(step)}\n${step.detail}`:undefined}>
  <span className="production-stage-icon" aria-hidden="true">{step.state==='done'?<Check size={13}/>:step.state==='failed'?<X size={13}/>:step.state==='paused'?<Pause size={12}/>:step.state==='skipped'||step.state==='unavailable'?<Minus size={13}/>:step.state==='current'&&moving?<Loader2 size={14} className="production-stage-spin"/>:index+1}</span>
  <span className="production-stage-copy"><strong className={links[step.id]?.length?'production-stage-links':undefined}>{name}</strong><small>{step.detail}</small></span>
  {(!done||timing||history)&&<span className="production-stage-meta">{!done&&<span className="production-stage-state">{stateLabel(step)}</span>}{(timing||history)&&<span className="production-stage-details">{timing&&<span className="production-stage-timing">{timing}</span>}{history&&<StoryFlowAction onClick={onHistory}>审核记录</StoryFlowAction>}</span>}</span>}
  {layout==='vertical'&&stageContent[step.id]&&<div className="production-stage-notice">{stageContent[step.id]}</div>}
 </li>;
 })}</ol>{layout==='vertical'&&!onHistory&&stages.some(step=>step.id==='review'&&step.state!=='unavailable')&&<p className="production-review-loop" aria-label="审核修复循环">审核 → 修复 → 全篇复核，未通过继续修复；最多自动 {readerMaxAutomaticRepairs} 轮，无变化或到上限则待处理。</p>}{layout==='horizontal'&&focused&&<p className="production-stage-current" data-state={focused.state} role="status"><strong>{focused.label} · {stateLabel(focused)}</strong><span>{focused.detail}</span></p>}</>;
}
