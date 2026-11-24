// Project saved production checkpoints into read-only history. Missing historical evidence stays missing;
// 审核记录显式留存来源版本时，允许引用该版本的调用收据。
// 调用记录只含提示词引用时，由调用方传入已读取的记录。
import type {Document,Plan,SessionRow} from './reader-model.ts';
import {usageRecord} from './reader-prompt-records.ts';
import type {PromptRecord} from './reader-prompt-records.ts';
import type {ReviewCheckpoint,ReviewIssue,ReviewRecordMeta,ReviewRepairRecord,FrameCountReview,FrameRequirement,RepairedPage} from './reader-review.ts';
import type {AcceptanceResult} from './reader-acceptance.ts';
import type {EditorialCoverage} from './reader-editorial.ts';
import {dagProgress} from './production-dag/progress.ts';
import {acceptanceCriteria} from './reader-acceptance.ts';
import type {DagDocument} from './production-dag/document.ts';

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
type ObjectValue=Record<string,unknown>;
const object=(value:unknown):ObjectValue|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:null;
const numbers=(value:unknown)=>Array.isArray(value)&&value.every(x=>Number.isInteger(x))?value as number[]:null;
const samePages=(a:number[],b:number[])=>JSON.stringify([...new Set(a)].sort((x,y)=>x-y))===JSON.stringify([...new Set(b)].sort((x,y)=>x-y));
const frame=(value:unknown):Frame|null=>{const item=object(value);return typeof item?.caption==='string'&&typeof item?.prompt==='string'?{caption:item.caption,prompt:item.prompt}:null;};
function input(value:string|undefined){try{return object(JSON.parse(value||''));}catch{return null;}}
function inputPlan(value:ObjectValue|null){return object(value?.plan)||object(value?.draft);}
function inputFrame(value:ObjectValue|null,page:number){const pages=inputPlan(value)?.pages;return Array.isArray(pages)?frame(pages[page-1]):null;}
function stepParts(step:string){
 let match=/^(review|repair):(frames|full):(\d+):(\d+)(?::(structure|\d+))?$/.exec(step);
 if(match)return {kind:match[1],phase:match[2],round:Number(match[3]),count:Number(match[4]),target:match[5]};
 match=/^(review|repair):(\d+)(?::(structure|\d+))?$/.exec(step);
 return match?{kind:match[1],phase:'full',round:Number(match[2]),count:null,target:match[3]}:null;
}

// 提示词全文由调用方按引用读取后传入；仍内嵌的记录直接使用。
/** 制作 DAG 故事的验收结果：每个验收条目取当前的结论（通过 / 未通过 / 无法判断）及其说明。 */
export function dagAcceptanceResults(dag:DagDocument):AcceptanceResult[]{
 return dag.items.flatMap((item,index)=>{
  const verdict=dag.verdicts?.[`itemVerdict:${item.id}`],product=dag.products[`itemVerdict:${item.id}`];
  if(!product&&!verdict)return [];
  const passed=verdict?verdict.outcome==='pass':product?.outcome!=='fail';
  return [{criterion:index+1,status:passed?'passed' as const:verdict?.requirements?'unknown' as const:'failed' as const,pages:[],evidence:verdict?.detail??''}];
 });
}

/**
 * 制作 DAG 故事的审片记录：引擎只保存当前结论而不保存逐轮报告，因此这里给出**当前**的幅数核对与审片结论，
 * 不重建历史轮次（历史轮次只存在于升级前的旧故事）。
 */
function dagReviewHistory(row:SessionRow,doc:Document,selection:ObjectValue):StoryReviewHistory{
 const dag=doc.dag!,progress=dagProgress(doc,selection as never),review=progress?.review;
 const entries:ReviewHistoryEntry[]=[];
 const base={recordedAt:null,model:null,position:null};
 if(dag.frameCheck)entries.push({...base,id:'count:current',kind:'count',title:'幅数与结构核对',outcome:dag.frameCheck.frameCountReview.decision==='keep'?'passed':'needs-change',issues:dag.frameCheck.issues,countReview:dag.frameCheck.frameCountReview,requirements:dag.frameCheck.requirements,coverage:dag.frameCheck.coverage});
 if(dag.reviewSkip)entries.push({...base,id:'review:skip:'+dag.reviewSkip.faultId,kind:'review',title:'跳过本次审核',
  recordedAt:dag.reviewSkip.recordedAt,outcome:'unknown',issues:[]});
 const verdicts=Object.entries(dag.verdicts||{});
 if(verdicts.length||dag.issues?.length){
  const criteria=acceptanceCriteria(typeof selection.acceptancePrompt==='string'?selection.acceptancePrompt:'');
  const acceptance=dagAcceptanceResults(dag).map(result=>({...result,text:criteria[result.criterion-1]??null}));
  const failing=verdicts.some(([,v])=>v.outcome==='fail');
  entries.push({...base,id:'review:current',kind:'review',title:'全篇审片（当前结论）',outcome:acceptance.some(a=>a.status==='unknown')?'unknown':failing?'needs-change':'passed',issues:dag.issues??[],...(acceptance.length?{acceptance}:{})});
 }
 return {id:row.id,title:typeof selection.displayTitle==='string'?selection.displayTitle:doc.plan?.title||'故事',revision:doc.revision?.number||1,parentId:doc.revision?.parentId||null,status:review?.reviewStatus??null,phase:review?.reviewPhase??null,stopReason:(review?.reviewStopReason as ReviewCheckpoint['stopReason'])??null,overridden:!!review?.reviewOverridden,error:row.error,entries};
}

export function storyReviewHistory(row:SessionRow,records:Map<string,PromptRecord>=new Map()):StoryReviewHistory{
 const doc=JSON.parse(row.document) as Document,selection=object(JSON.parse(row.selection))!,review=doc.visualReview;
 if(doc.dag)return dagReviewHistory(row,doc,selection);
 const calls=(doc.usage||[]).flatMap((call,position)=>{
  const parts=stepParts(call.step);
  return parts?[{...call,position,input:input(usageRecord(call,records)?.input),parts}]:[];
 });
 type Call=typeof calls[number];
 function locate(meta:ReviewRecordMeta,predicate:(call:Call)=>boolean){
  const matches=calls.filter(call=>(meta.originId?call.originId===meta.originId:!call.originId||call.originId===row.id||call.originId===doc.copiedFrom?.storyId)&&(!meta.step||call.step===meta.step)&&predicate(call));return matches.length===1?matches[0]:null;
 }
 function common(id:string,kind:ReviewHistoryEntry['kind'],title:string,meta:ReviewRecordMeta,call:Call|null):Pick<ReviewHistoryEntry,'id'|'kind'|'title'|'position'|'recordedAt'|'model'>{
  return {id,kind,title,position:call?.position??null,recordedAt:typeof meta.recordedAt==='string'&&Number.isFinite(Date.parse(meta.recordedAt))?meta.recordedAt:null,model:call?.model||null};
 }
 const entries:ReviewHistoryEntry[]=[];
 for(const [index,report] of (review?.frameCountReports||[]).entries()){
  const call=locate(report,call=>call.parts?.kind==='review'&&call.parts.phase==='frames'&&call.parts.count===index);
  entries.push({...common('count:'+index,'count',`第${index+1}次数量${index?'复核':'审核'}`,report,call),outcome:report.frameCountReview.decision==='keep'?'passed':'needs-change',issues:report.issues,countReview:report.frameCountReview,requirements:report.requirements});
 }
 for(const [index,report] of (review?.reports||[]).entries()){
  const call=locate(report,call=>call.parts?.kind==='review'&&call.parts.phase==='full'&&call.parts.round===report.round);
  const fromInput=call?.input?.acceptanceCriteria,criteria=Array.isArray(fromInput)&&fromInput.every(x=>typeof x==='string')?fromInput as string[]:typeof selection.acceptancePrompt==='string'?selection.acceptancePrompt.split(/\r?\n/).map(x=>x.trim()).filter(Boolean):[];
  const outcome=report.acceptanceResults?.some(x=>x.status==='unknown')?'unknown':report.issues.length||report.acceptanceResults?.some(x=>x.status==='failed')?'needs-change':'passed';
  const chosen=report.reflectionChoice;
  entries.push({...common('review:'+index,'review',`第${index+1}次全篇${index?'复核':'审核'}`,report,call),outcome,issues:report.issues,coverage:report.coverage,
   ...(report.acceptanceResults?{acceptance:report.acceptanceResults.map(result=>({...result,text:criteria[result.criterion-1]??null}))}:{}),
   ...(report.titleReview?{titleChange:{before:typeof report.titleReview.previousTitle==='string'?report.titleReview.previousTitle:null,after:report.titleReview.title,reason:report.titleReview.reason}}:{}),
   ...(chosen?{reflectionChoice:{text:Array.isArray(chosen.candidates)&&typeof chosen.candidates[chosen.index-1]==='string'?chosen.candidates[chosen.index-1]:null,reason:chosen.reason}}:{})});
 }
 for(const [index,record] of (review?.history||[]).entries()){
  const target=record.structure?'structure':String(record.requested.filter(x=>x>0).sort((a,b)=>a-b)[0]??0);
  const call=locate(record,call=>{
   if(call.parts?.kind!=='repair'||call.parts.round!==record.round||call.parts.target!==target)return false;
   const requested=numbers(call.input?.requestedPages);if(requested&&!samePages(requested,record.requested))return false;
   if(record.structure){
    const plan=inputPlan(call.input),pages=plan?.pages;
    if(Array.isArray(pages)&&(pages.length!==record.structure.before||(record.structure.removed||[]).some(old=>{const current=frame(pages[old.page-1]);return !current||current.caption!==old.caption||current.prompt!==old.prompt;})))return false;
    const issues=call.input?.issues;
    if(Array.isArray(issues)){
     const all=issues.map(object).filter(x=>!!x),structural=all.filter(x=>x!.requiresReplan===true),relevant=structural.length?structural:all;
     const issuePages=relevant.flatMap(x=>Number.isInteger(x!.page)?[x!.page as number]:[]);
     if(issuePages.length&&!samePages(issuePages,record.requested))return false;
    }
   }
   return true;
  });
  const changes=record.changes.map(after=>({page:after.page,before:frame(record.before?.find(x=>x.page===after.page))||inputFrame(call?.input??null,after.page),after:{caption:after.caption,prompt:after.prompt}}));
  const repair:NonNullable<ReviewHistoryEntry['repair']>={requested:record.requested,pages:changes};
  if(record.reflection!==undefined){
   const previous=record.previousReflection??inputPlan(call?.input??null)?.reflection??object(call?.input?.revision)?.reflection;
   repair.reflection={before:typeof previous==='string'?previous:null,after:record.reflection};
  }
  if(record.structure){
   const structure=record.structure;let offset=0;
   const edits=structure.edits.map(edit=>{const newFrom=edit.from+offset;offset+=edit.pages.length-(edit.to-edit.from+1);return {from:edit.from,to:edit.to,newFrom,before:Array.isArray(structure.removed)?structure.removed.filter(x=>x.page>=edit.from&&x.page<=edit.to):null,after:edit.pages.map((page,i)=>({...page,page:newFrom+i}))};});
   repair.structure={before:structure.before,after:structure.after,edits};
   if(structure.characters)repair.characters={before:structure.previousCharacters??null,after:structure.characters};
  }
  const changed=repairChanged(record,repair);
  entries.push({...common('repair:'+index,'repair',`第${index+1}批修订`,record,call),outcome:changed===null?'unknown':changed?'changed':'unchanged',issues:[],repair});
 }
 entries.sort((a,b)=>(a.position??Infinity)-(b.position??Infinity));
 return {id:row.id,title:typeof selection.displayTitle==='string'?selection.displayTitle:doc.plan?.title||'故事',revision:doc.revision?.number||1,parentId:doc.revision?.parentId||null,status:review?.status||null,phase:review?.phase||null,stopReason:review?.stopReason||null,overridden:!!review?.overridden,error:row.error,entries};
}
function repairChanged(record:ReviewRepairRecord,repair:NonNullable<ReviewHistoryEntry['repair']>):boolean|null{
 if(record.changed!==undefined)return record.changed;
 if(record.changes.length||record.reflection!==undefined)return true;
 if(!repair.structure)return false;
 if(repair.structure.before!==repair.structure.after||repair.characters&&repair.characters.before!==null&&repair.characters.before!==repair.characters.after)return true;
 if(repair.characters?.before===null||repair.structure.edits.some(edit=>edit.before===null))return null;
 return repair.structure.edits.some(edit=>JSON.stringify(edit.before?.map(({caption,prompt})=>({caption,prompt})))!==JSON.stringify(edit.after.map(({caption,prompt})=>({caption,prompt}))));
}
