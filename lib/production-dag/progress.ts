// 制作 DAG 故事的进度视图：由引擎状态推出当前步骤与审片状态，供故事视图与制作时间线显示。
// 纯函数，不做 I/O；只读文档中的 dag，不考虑故障（故障由协调器另行呈现）。
import {registerDagProgress} from '../reader-model.ts';
import type {Document,Selection,Step} from '../reader-model.ts';
import {settle,work,attention,finished,type DagStory} from './runner.ts';

export type DagReviewProgress={
 reviewStatus:'pending'|'repair'|'blocked'|'passed';
 reviewPhase:'frames'|'full';
 reviewRound:number;repairCompleted:number;repairTotal:number;reviewAudits:number;repairPasses:number;
 reviewStopReason?:'limit'|'unchanged'|'requirements'|'replan';
 reviewOverridden:boolean;
};
export type DagProgress={step:Step|null;review:DagReviewProgress;complete:boolean};

const repairCalls=new Set(['sceneRepair','visualRepair','structureRepair','endingRepair']);
const callKinds:Record<string,Step['kind']>={
 verifySource:'source',brief:'plan',characters:'plan',outline:'plan',registerItems:'plan',sceneBatch:'plan',visual:'plan',
 restyle:'restyle',ending:'reflection',frameCheck:'review',review:'review',
 sceneRepair:'repair',visualRepair:'repair',structureRepair:'repair',endingRepair:'repair',
};

/** 故事当前在做什么：第一项文字工作决定步骤，只剩绘图时为绘图；无工作时 step 为 null。 */
export function dagProgress(doc:Document,selection:Selection):DagProgress|null{
 if(!doc.dag||doc.legacyFramePreparation||doc.intake&&doc.intake.phase!=='confirmed')return null;
 const base:DagStory={id:'',doc,selection,dag:doc.dag,confirmed:true,faults:[]};
 const story={...base,dag:settle(base)};
 const items=story.dag.continuation?[]:work(story);
 const text=items.find(item=>item.call!=='draw'&&item.call!=='drawLandscape');
 const drawing=items.find(item=>item.call==='draw');
 const waiting=attention(story);
 const complete=finished(story);
 const key=text?`${text.call}:${text.stage??0}`:'';
 const step:Step|null=text?{kind:callKinds[text.call]??'plan',page:0,key}
  :drawing?{kind:'image',page:Math.max(0,story.dag.order.indexOf(drawing.instances[0].key)),key:`image:${drawing.instances[0].key}`}:null;
 const reviewWork=items.some(item=>item.call==='frameCheck'||item.call==='review');
 const repairing=items.some(item=>repairCalls.has(item.call));
 const stop=waiting[0]?.reason;
 const used=story.dag.repairs?.used??0;
 const review:DagReviewProgress={
  reviewStatus:complete||(!text&&!!drawing&&!waiting.length)?'passed':waiting.length&&!text?'blocked':repairing?'repair':'pending',
  reviewPhase:typeof selection.length==='number'?'full':items.some(item=>item.call==='frameCheck')||!story.dag.frameCheck?'frames':'full',
  reviewRound:used+1,repairCompleted:0,repairTotal:story.dag.issues?.length??0,reviewAudits:used+(reviewWork?0:1),repairPasses:used,
  ...(stop==='limit'||stop==='unchanged'||stop==='requirements'?{reviewStopReason:stop}:stop==='unrepairable'?{reviewStopReason:'replan' as const}:{}),
  reviewOverridden:Object.values(story.dag.products).some(product=>product.overridden),
 };
 return {step,review,complete};
}

registerDagProgress(dagProgress);
