// Project saved production checkpoints into read-only history. Missing historical evidence stays missing;
// 审核记录显式留存来源版本时，允许引用该版本的调用收据。
// 调用记录只含提示词引用时，由调用方传入已读取的记录。
import {decodeDocument} from './production-dag/document.ts';
import {selectionSchema,type Document,type Plan,type Selection,type SessionRow} from './reader-model.ts';
import type {ReviewCheckpoint,ReviewIssue,FrameCountReview,FrameRequirement,RepairedPage} from './reader-review.ts';
import type {AcceptanceResult} from './reader-acceptance.ts';
import type {EditorialCoverage} from './reader-editorial.ts';
import {dagProgress} from './production-dag/progress.ts';
import {acceptanceCriteria} from './reader-acceptance.ts';
import {evaluate} from './production-dag/engine.ts';
import {currentReviewTargets} from './production-dag/review.ts';
import {stateOf} from './production-dag/runner.ts';

type Frame=Plan['pages'][number];
export type ReviewPageChange={page:number;before:Frame|null;after:Frame};
export type ReviewTextChange={before:string|null;after:string};
export type ReviewStructureChange={from:number;to:number;newFrom:number;before:RepairedPage[]|null;after:RepairedPage[]};
export type ReviewHistoryEntry={
 id:string;kind:'count'|'review'|'repair';title:string;position:number|null;recordedAt:string|null;model:string|null;
 outcome:'passed'|'needs-change'|'unknown'|'changed'|'unchanged';issues:ReviewIssue[];
 countReview?:FrameCountReview;requirements?:FrameRequirement[];coverage?:EditorialCoverage[];
 acceptance?:{criterion:number;text:string|null;status:AcceptanceResult['status'];pages:number[];evidence:string}[];
 titleChange?:{before:string|null;after:string;reason:string};reflectionChoice?:{text:string|null;reason:string};
 repair?:{requested:number[];pages:ReviewPageChange[];reflection?:ReviewTextChange;characters?:ReviewTextChange;structure?:{before:number;after:number;edits:ReviewStructureChange[]}};
};
export type StoryReviewHistory={id:string;title:string;revision:number;parentId:string|null;status:ReviewCheckpoint['status']|null;phase:'frames'|'full'|null;stopReason:ReviewCheckpoint['stopReason']|null;overridden:boolean;error:string|null;entries:ReviewHistoryEntry[]};
/** 制作 DAG 故事的验收结果：每个验收条目取当前的结论（通过 / 未通过 / 无法判断）及其说明。 */
export function currentStoryReview(doc:Document,selection:Selection){
 const dag=doc.dag,confirmed=!doc.intake||doc.intake.phase==='confirmed';
 const targets=dag&&confirmed?currentReviewTargets(evaluate(stateOf({id:'',doc,selection,dag,confirmed,faults:[]}))):new Set<string>();
 const results=targets.has('narrativeVerdict:')?dag?.verdicts?.['narrativeVerdict:']?.acceptance??[]:[];
 const overridden=[...targets].some(id=>dag?.products[id]?.overridden);
 return {targets,results,overridden};
}

/**
 * 制作 DAG 故事的审片记录：引擎只保存当前结论而不保存逐轮报告，因此这里给出**当前**的幅数核对与审片结论，
 * 随书库升级保留的历史报告在当前结论之前显示。
 */
function dagReviewHistory(row:SessionRow,doc:Document,selection:Selection):StoryReviewHistory{
 const dag=doc.dag!,review=dagProgress(doc,selection)?.review;
 const {targets,results,overridden}=currentStoryReview(doc,selection);
 const entries:ReviewHistoryEntry[]=[...(doc.archivedReviewHistory??[])];
 const base={recordedAt:null,model:null,position:null};
 if(targets.has('frameCheck:')&&dag.frameCheck)entries.push({...base,id:'count:current',kind:'count',title:'幅数与结构核对',outcome:dag.frameCheck.frameCountReview.decision==='keep'?'passed':'needs-change',issues:dag.frameCheck.issues,countReview:dag.frameCheck.frameCountReview,requirements:dag.frameCheck.requirements,coverage:dag.frameCheck.coverage});
 if(overridden)entries.push({...base,id:'review:overridden',kind:'review',title:'仍然绘图',
  recordedAt:null,outcome:'unknown',issues:[]});
 if(targets.has('narrativeVerdict:')&&dag.verdicts?.['narrativeVerdict:']){
  const criteria=acceptanceCriteria(selection.acceptancePrompt);
  const acceptance=results.map(result=>({...result,text:criteria[result.criterion-1]??null}));
  const failing=Object.entries(dag.verdicts).some(([id,verdict])=>targets.has(id)&&verdict.outcome==='fail');
  const issues=(dag.issues??[]).filter(issue=>targets.has(issue.target));
  entries.push({...base,id:'review:current',kind:'review',title:'全篇审片（当前结论）',outcome:acceptance.some(a=>a.status==='unknown')?'unknown':failing?'needs-change':'passed',issues,...(acceptance.length?{acceptance}:{})});
 }
 return {id:row.id,title:selection.displayTitle||doc.plan?.title||'故事',revision:doc.revision?.number||1,parentId:doc.revision?.parentId||null,status:review?.reviewStatus??null,phase:review?.reviewPhase??null,stopReason:(review?.reviewStopReason as ReviewCheckpoint['stopReason'])??null,overridden,error:row.error,entries};
}

export function storyReviewHistory(row:SessionRow):StoryReviewHistory{
 const doc=decodeDocument(row),selection=JSON.parse(row.selection);
 if(doc.dag)return dagReviewHistory(row,doc,selectionSchema.parse(selection));
 return {id:row.id,title:typeof selection?.displayTitle==='string'?selection.displayTitle:doc.plan?.title||'故事',
  revision:doc.revision?.number||1,parentId:doc.revision?.parentId||null,status:null,phase:null,stopReason:null,
  overridden:false,error:row.error,entries:doc.archivedReviewHistory??[]};
}
