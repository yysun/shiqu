// 制作 DAG 故事的进度视图：由引擎状态推出当前步骤与审片状态，供故事视图与制作时间线显示。
// 纯函数，不做 I/O；只读文档中的 dag，不考虑故障（故障由协调器另行呈现）。
import {registerDagProgress} from '../reader-model.ts';
import type {Document,Selection,Step} from '../reader-model.ts';
import {describeProductionCall} from '../production-lifecycle.ts';
import {settle,deriveProduction,attention,stateOf,type DagStory} from './runner.ts';
import {currentReviewTargets} from './review.ts';

export type DagReviewProgress={
 reviewStatus:'pending'|'repair'|'blocked'|'passed';
 reviewPhase:'frames'|'full';
 reviewRound:number;repairCompleted:number;repairTotal:number;reviewAudits:number;repairPasses:number;
 reviewStopReason?:'limit'|'unchanged'|'requirements'|'replan';
 reviewOverridden:boolean;
};
export type DagProgress={step:Step|null;review:DagReviewProgress;complete:boolean;frameCount:number|null;storyboardFrames:number;drawingFrames:number;activity?:string;redrawPage?:number};

const repairCalls=new Set(['sceneRepair','visualRepair','structureRepair','endingRepair']);
/** 只展示当前结论对应的问题，已失效或已放行的问题仍可在历史中查看。 */
export function reviewAttention(story:DagStory,reasons=attention(story)){
 const targets=new Set(reasons.map(item=>item.target));
 const issues=(story.dag.issues??[]).filter(issue=>targets.has(issue.target));
 return {reasons,issues};
}

/** 故事当前在做什么：第一项文字工作决定步骤，只剩绘图时为绘图；无工作时 step 为 null。 */
export function dagProgress(doc:Document,selection:Selection):DagProgress|null{
 if(!doc.dag||doc.intake&&doc.intake.phase!=='confirmed')return null;
 const base:DagStory={id:'',doc,selection,dag:doc.dag,confirmed:true,faults:[]};
 const story={...base,dag:settle(base)};
 const {order}=story.dag,{evaluation,work:items,attention:waiting,complete}=deriveProduction(story);
 // 旧版产物仍可阅读，制作进度只统计当前设置下有效的产物。
 const frameCount=evaluation.instance('outline').status==='valid'?order.length:typeof selection.length==='number'?selection.length:null;
 const storyboardFrames=order.filter(id=>evaluation.instance('scene',id).status==='valid').length;
 const drawingFrames=order.filter(id=>evaluation.instance('frameImage',id).status==='valid').length;
 // 等待继续时仍显示真实的接续步骤，调度由持久化等待状态阻止。
 const text=items.find(item=>item.call!=='draw');
 const drawing=items.find(item=>item.call==='draw');
 const used=story.dag.repairs?.used??0;
 const key=text?text.call:'';
 const description=text&&describeProductionCall(text.call,text.instances.map(instance=>order.indexOf(instance.key)+1).filter(n=>n>0),used);
 const activity=description?.label;
 const step:Step|null=text?{kind:description?.phase??'plan',page:0,key}
  :drawing?{kind:'image',page:Math.max(0,story.dag.order.indexOf(drawing.instances[0].key)),key:`image:${drawing.instances[0].key}`}:waiting.length?{kind:'review',page:0,key:'review:attention'}:null;
 const redrawPage=step?.kind==='image'&&items.length===1&&(doc.revision?.base?.readyFrames?.includes(step.page)||doc.revision?.base?.images?.[step.page])&&!doc.images[step.page]&&doc.images.filter(Boolean).length===story.dag.order.length-1?step.page+1:undefined;
 const reviewWork=items.some(item=>item.call==='frameCheck'||item.call==='review');
 const repairing=items.some(item=>repairCalls.has(item.call));
 const reasons=waiting.map(item=>item.reason);
 // 缺少单幅修订意见也会产生 unrepairable，须有结构核对或结构意见才提示重新编排。
 const needsReplan=waiting.some(({target,reason})=>(reason==='unrepairable'||reason==='unchanged')&&
  (target==='frameCheck:'||story.dag.issues?.some(issue=>issue.target===target&&issue.requiresReplan)));
 const stop=reasons.includes('requirements')?'requirements':needsReplan?'replan':
  reasons.includes('unchanged')?'unchanged':reasons.includes('limit')?'limit':undefined;
 const frameCheck=story.dag.products['frameCheck:'];
 const frameCheckPassed=evaluation.instance('frameCheck').status==='valid'&&(frameCheck?.outcome==='pass'||frameCheck?.overridden);
 const review:DagReviewProgress={
  reviewStatus:complete||(!text&&!!drawing&&!waiting.length)?'passed':waiting.length&&!text?'blocked':repairing?'repair':'pending',
  reviewPhase:typeof selection.length==='number'||frameCheckPassed?'full':'frames',
  reviewRound:used+1,repairCompleted:0,repairTotal:story.dag.issues?.length??0,reviewAudits:used+(reviewWork?0:1),repairPasses:used,
  ...(stop?{reviewStopReason:stop}:{}),
  reviewOverridden:evaluation.approved()&&[...currentReviewTargets(evaluation)].some(id=>story.dag.products[id]?.overridden),
 };
 return {step,review,complete,frameCount,storyboardFrames,drawingFrames,activity,...(redrawPage?{redrawPage}:{})};
}

registerDagProgress(dagProgress);
