// Shared read-only production timeline; skipped and legacy stages never masquerade as approval.
import {Check,Loader2,Minus,Pause,X} from 'lucide-react';
import type {ProductionStage} from '../../lib/production-stages';
import './production-timeline.css';
export default function ProductionTimeline({stages,moving=false,queued=false,layout='vertical'}:{stages:ProductionStage[];moving?:boolean;queued?:boolean;layout?:'vertical'|'horizontal'}){
 const labels={pending:'待进行',current:queued?'等待中':moving?'进行中':'等待更新',done:'已完成',skipped:'无需执行',unavailable:'未启用',failed:'待处理',paused:'已暂停'};
 const stateLabel=(step:ProductionStage)=>step.id==='count'&&step.state==='current'&&!moving&&!queued?'待确认':labels[step.state];
 const focused=stages.find(step=>['current','failed','paused'].includes(step.state))||stages.find(step=>step.state==='pending')||stages.at(-1);
 return <><ol className={'production-timeline'+(layout==='horizontal'?' production-timeline--horizontal':'')} aria-label="完整审片流程">{stages.map((step,index)=><li key={step.id} data-stage={step.id} data-state={step.state} aria-current={['current','failed','paused'].includes(step.state)?'step':undefined} title={layout==='horizontal'?`${step.label} · ${stateLabel(step)}\n${step.detail}`:undefined}>
  <span className="production-stage-icon" aria-hidden="true">{step.state==='done'?<Check size={13}/>:step.state==='failed'?<X size={13}/>:step.state==='paused'?<Pause size={12}/>:step.state==='skipped'||step.state==='unavailable'?<Minus size={13}/>:step.state==='current'&&moving?<Loader2 size={14} className="production-stage-spin"/>:index+1}</span>
  <span className="production-stage-copy"><strong>{step.label}</strong><small>{step.detail}</small></span><span className="production-stage-state">{stateLabel(step)}</span>
 </li>)}</ol>{layout==='horizontal'&&focused&&<p className="production-stage-current" data-state={focused.state} role="status"><strong>{focused.label} · {stateLabel(focused)}</strong><span>{focused.detail}</span></p>}</>;
}
