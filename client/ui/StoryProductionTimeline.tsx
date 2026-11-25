// Attach each production fault, recovery action and review panel to its saved checkpoint.
// Keep retries scoped to their original fault IDs and in the same footer as production controls.
import {Fragment} from 'react';
import type {ComponentProps,ReactNode} from 'react';
import type {SessionView} from '@/lib/reader-model';
import type {FaultView} from '@/lib/reader-recovery';
import ProductionTimeline from './ProductionTimeline';
import StoryRetry from './StoryRetry';
import {StoryAcceptanceNotice} from './StoryReviewTools';

type Props=ComponentProps<typeof ProductionTimeline>&{session?:SessionView;busy?:boolean;error?:string;onRetry?:(faultId?:string)=>void;onAcceptance?:()=>void;reviewTools?:ReactNode;currentContent?:ReactNode;currentTiming?:ReactNode};
export default function StoryProductionTimeline({session,busy=false,error='',onRetry,onAcceptance,reviewTools,currentContent,currentTiming,stageContent={},...props}:Props){
 const {stages}=props;
 if(!session)return <ProductionTimeline {...props} stageContent={stageContent}/>;
 const meta=session.generationProgress;
 const focused=stages.find(step=>step.state==='failed')||stages.find(step=>step.state==='current'||step.state==='paused');
 const phase=meta?.phase;
 const current=focused?.id||(phase==='image'||phase==='restyle'?'image':phase==='source'||phase==='discover'?'source':phase==='recommend'||phase==='production-confirmation'?'count':phase==='repair'?'repair':phase==='review'?'review':'plan');
 const review=stages.find(step=>['review','repair','recheck'].includes(step.id)&&step.state==='failed')?.id||stages.find(step=>['review','repair','recheck'].includes(step.id)&&step.state==='current')?.id||'review';
 const reviewBlocked=!!session.reviewOverride||!!session.reviewIssues?.length||meta?.reviewStopReason==='requirements';
 const ownsReview=reviewBlocked&&!!reviewTools,intakePhase=session.intake?.phase;
 function stageFor(fault:FaultView){
  if(fault.stage==='prepare'||fault.stage==='source'&&intakePhase&&intakePhase!=='confirmed')return 'count';
  return fault.stage==='source'?'source':fault.stage==='review'?review:fault.stage==='publication'||fault.stage==='redraw'||fault.page!==null?'image':current;
 }
 const content:Record<string,ReactNode[]>={};
 const footer:Record<string,ReactNode[]>={};
 function add(stage:string,node:ReactNode){if(node)(content[stage]||=[]).push(node);}
 function retry(stage:string,scoped:SessionView,key:string){
  add(stage,<div key={key} role={scoped.faults?.some(fault=>fault.state==='pending')?'alert':'status'}><StoryRetry session={scoped} busy={busy} onRetry={onRetry!} display="feedback"/></div>);
  (footer[stage]||=[]).push(<StoryRetry key={key} session={scoped} busy={busy} onRetry={onRetry!} display="actions" primary link/>);
 }
 const faults=session.faults||[];
 for(const stage of new Set(faults.map(stageFor))){
  const scoped=faults.filter(fault=>stageFor(fault)===stage&&!(fault.stage==='review'&&!fault.retryReview&&(ownsReview||meta?.reviewStopReason==='requirements')));
  if(scoped.length&&onRetry)retry(stage,{...session,faults:scoped},'faults');
 }
 const message=error||session.error;
 if(message&&!faults.some(fault=>fault.message===message)&&!(reviewBlocked&&(ownsReview||meta?.reviewStopReason==='requirements')&&(!error||error===session.error)))add(current,<p key="error" className="yu-batch-error" role="alert">{message}</p>);
 if(!faults.length&&!ownsReview&&meta?.reviewStopReason!=='requirements'&&(session.state==='failed'||!!error)&&onRetry)retry(current,session,'retry');
 if(meta?.reviewStopReason==='requirements')add(review,<StoryAcceptanceNotice key="acceptance" busy={busy} onAcceptance={onAcceptance}/>);
 if(reviewTools)add(reviewBlocked?review:current,reviewTools);
 for(const [stage,node] of Object.entries(stageContent))add(stage,node);
 if(currentContent)(footer[current]||=[]).push(<Fragment key="control">{currentContent}</Fragment>);
 for(const [stage,nodes] of Object.entries(footer))add(stage,<div key="footer" className="production-stage-footer">{nodes}</div>);
 return <ProductionTimeline {...props} awaitingContinue={session.awaitingContinue} stageDurations={props.stageDurations??meta?.stageDurations} stageTimes={{...props.stageTimes,[current]:currentTiming}} stageContent={Object.fromEntries(Object.entries(content).map(([stage,nodes])=>[stage,<Fragment key={stage}>{nodes.map((node,index)=><Fragment key={index}>{node}</Fragment>)}</Fragment>]))}/>;
}
