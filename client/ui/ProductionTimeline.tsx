// Show saved production states, with optional navigation to existing reader content.
import {Fragment} from 'react';
import {readerMaxAutomaticRepairs} from '../../lib/reader-limits';
import {Check,Loader2,Minus,Pause,X} from 'lucide-react';
import type {ProductionStage} from '../../lib/production-stages';
import './production-timeline.css';
type StageAction={label:string;onClick:()=>void};
export type ProductionTimelineNavigation={actions?:Record<string,StageAction>;links?:Record<string,StageAction[]>;detailActions?:Record<string,StageAction>};
export default function ProductionTimeline({stages,moving=false,queued=false,layout='vertical',actions={},links={},detailActions={}}:{stages:ProductionStage[];moving?:boolean;queued?:boolean;layout?:'vertical'|'horizontal';} & ProductionTimelineNavigation){
 const labels={pending:'待进行',current:queued?'等待中':moving?'进行中':'等待更新',done:'已完成',skipped:'无需执行',unavailable:'未启用',failed:'待处理',paused:'已暂停'};
 const stateLabel=(step:ProductionStage)=>step.id==='count'&&step.state==='current'&&!moving&&!queued?'待确认':labels[step.state];
 const focused=stages.find(step=>['current','failed','paused'].includes(step.state))||stages.find(step=>step.state==='pending')||stages.at(-1);
 return <><ol className={'production-timeline'+(layout==='horizontal'?' production-timeline--horizontal':'')} aria-label="完整审片流程">{stages.map((step,index)=>{
 const content=<><span className="production-stage-icon" aria-hidden="true">{step.state==='done'?<Check size={13}/>:step.state==='failed'?<X size={13}/>:step.state==='paused'?<Pause size={12}/>:step.state==='skipped'||step.state==='unavailable'?<Minus size={13}/>:step.state==='current'&&moving?<Loader2 size={14} className="production-stage-spin"/>:index+1}</span>
  <span className="production-stage-copy"><strong className={links[step.id]?.length?'production-stage-links':undefined}>{links[step.id]?.length?links[step.id].map((link,index)=><Fragment key={link.label}>{index>0&&<span aria-hidden="true">与</span>}<button type="button" onClick={link.onClick}>{link.label}</button></Fragment>):step.label}</strong><small>{detailActions[step.id]?<button type="button" className="production-stage-detail-action" aria-label={detailActions[step.id].label} onClick={detailActions[step.id].onClick}>{step.detail}</button>:step.detail}</small></span><span className="production-stage-state">{stateLabel(step)}</span></>;
 return <li key={step.id} data-stage={step.id} data-state={step.state} aria-current={['current','failed','paused'].includes(step.state)?'step':undefined} title={layout==='horizontal'?`${step.label} · ${stateLabel(step)}\n${step.detail}`:undefined}>
  {actions[step.id]&&!links[step.id]?.length?<button type="button" className="production-stage-action" aria-label={actions[step.id].label} onClick={actions[step.id].onClick}>{content}</button>:content}
 </li>;
 })}</ol>{layout==='vertical'&&stages.some(step=>step.id==='review'&&step.state!=='unavailable')&&<p className="production-review-loop" aria-label="审核修复循环">审核 → 修复 → 全篇复核，未通过继续修复；最多自动 {readerMaxAutomaticRepairs} 轮，无变化或到上限则待处理。</p>}{layout==='horizontal'&&focused&&<p className="production-stage-current" data-state={focused.state} role="status"><strong>{focused.label} · {stateLabel(focused)}</strong><span>{focused.detail}</span></p>}</>;
}
