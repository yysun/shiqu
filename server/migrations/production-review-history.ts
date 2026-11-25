// 格式升级时把旧审片报告转换为可读的历史记录。
import type {HistoricalDocument} from './production-v2.ts';
import type {Plan,SessionRow} from '../../lib/reader-model.ts';
import type {ReviewRecordMeta,ReviewRepairRecord} from '../../lib/reader-review.ts';
import {usageRecord,type PromptRecord} from '../../lib/reader-prompt-records.ts';
import type {ReviewHistoryEntry,StoryReviewHistory} from '../../lib/reader-review-history.ts';
import {decodeDocument} from '../../lib/production-dag/document.ts';

type Frame=Plan['pages'][number];
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

export function legacyReviewHistory(row:Pick<SessionRow,'id'|'selection'|'document'|'error'>,records:Map<string,PromptRecord>=new Map()):StoryReviewHistory{
 const doc=decodeDocument(row),selection=object(JSON.parse(row.selection))!,review=(doc as HistoricalDocument).visualReview;
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
