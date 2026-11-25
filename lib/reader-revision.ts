// Plan revisions from actual image inputs. Captions/reflection never invalidate artwork;
// a changed anchor, cast, style or global image preference invalidates its dependants.
// Style and explicit image-only redraws preserve review; content and acceptance edits invalidate it.
import {z} from 'zod';
import {acceptancePromptSchema} from './reader-acceptance.ts';
import {planSchema,ReaderError} from './reader-model.ts';
import type {Selection} from './reader-model.ts';
import type {ReviewCheckpoint,ReviewIssue} from './reader-review.ts';
import {artStylePromptSchema,artStyleIds,artStyleSettings,sameArtDirection} from './reader-styles.ts';
import {readerMinFrames,readerMaxFrames} from './reader-limits.ts';
import {narrativeDetailSchema} from './reader-frame-recommendation.ts';
import {reusableRevisionImages} from './reader-revision-images.ts';
import type {RevisionBase,RevisionRedraw} from './reader-revision-images.ts';
export {reusableRevisionImages};
export type {RevisionBase};

export const redrawNoteMaxLength=500;
export const reviewNotesMaxLength=1200;
const redrawNotesSchema=z.record(z.string().regex(/^[1-9]\d*$/),z.string().trim().min(1).max(redrawNoteMaxLength));
const clearable=(value:z.ZodString)=>z.union([z.string().trim().length(0),value]);
const page=planSchema.shape.pages.element;
const revisionPlanSchema=planSchema.extend({reflection:clearable(planSchema.shape.reflection),characters:clearable(planSchema.shape.characters),
 pages:z.array(page.extend({caption:clearable(page.shape.caption),prompt:clearable(page.shape.prompt)})).min(readerMinFrames).max(readerMaxFrames)});
export const revisionChangesSchema=z.object({artStylePrompt:artStylePromptSchema,productionPrompt:z.string().max(1200).optional(),acceptancePrompt:acceptancePromptSchema.optional(),reviewNotes:z.string().trim().max(reviewNotesMaxLength).optional(),artStyle:z.enum(artStyleIds).optional(),length:z.union([z.number().int().min(readerMinFrames).max(readerMaxFrames),z.literal('auto')]).optional(),narrativeDetail:narrativeDetailSchema.optional(),plan:revisionPlanSchema.optional(),storySummary:clearable(planSchema.shape.summary).optional(),removedFrames:z.array(z.number().int().min(1).max(readerMaxFrames)).min(1).max(readerMaxFrames-1).refine(frames=>new Set(frames).size===frames.length,'删除幅号不能重复。').optional(),redrawPages:z.array(z.number().int().min(1).max(readerMaxFrames)).min(1).max(readerMaxFrames).refine(pages=>new Set(pages).size===pages.length,'重绘页码不能重复。').optional(),redrawNotes:redrawNotesSchema.optional(),
 /** 原稿幅号一基，闭区间替换；to=from-1 表示在该幅前插入。 */
 structureEdits:z.array(z.object({from:z.number().int().min(1).max(readerMaxFrames+1),to:z.number().int().min(0).max(readerMaxFrames),
  scenes:z.array(z.object({caption:planSchema.shape.pages.element.shape.caption}).strict()).max(readerMaxFrames)}).strict()).min(1).max(readerMaxFrames).optional(),
 /** 合并草稿将替代内容放在这些原幅号处。其余被合并的幅号列在 removedFrames。 */
 mergeTargets:z.array(z.number().int().min(1).max(readerMaxFrames)).min(1).max(readerMaxFrames-1).optional(),
 /** 确认放弃本次保存会移除的全部手改画幅内容。 */
 confirmHandEditLoss:z.boolean().optional()}).strict();
export type RevisionChanges=z.infer<typeof revisionChangesSchema>;
export type LostHandEdit={page:number;caption?:string;prompt?:string};
export type RevisionInfo={parentId:string;rootId:string;number:number};
export type RevisionView=RevisionInfo&{redraw?:RevisionRedraw};
// 横图按幅号排列。URL 代表继承的图片，null 代表待重绘，空字符串代表原版缺幅。
export type RevisionRecord=RevisionInfo&{kind?:'selection';selectionRequest?:string;baseToken:string;requestHash:string;/** 仅旧版本写入的字段；只由升级转换读取，新代码不再设置或使用。 */handoff?:boolean;base:Pick<RevisionBase,'selection'>&Partial<Omit<RevisionBase,'selection'>>&{readyFrames?:number[]};storyImageReference?:true;restyle?:{from:Selection['artStyle'];fromPrompt?:string;next:number};previewedRedraw?:number;actualRedraw?:number;lostPages?:number[];/** 阅读器已确认立即重绘的画幅身份。 */redrawFrame?:string;redrawPages?:number[];redrawNotes?:RevisionChanges['redrawNotes'];landscapeRedraw?:(string|null)[]};
type RevisionContent=RevisionBase&{reviewNotes?:string};
export type RevisionSnapshot=RevisionContent&{token:string;epoch:number;reviewStatus?:ReviewCheckpoint['status'];canEditReviewNotes?:boolean;priorReviewIssues?:ReviewIssue[];revision?:RevisionInfo};
export type RevisionImpact={changed:boolean;replan:boolean;preserveScript:boolean;review:boolean;reused:number;redraw:number;total:number;reusePending:boolean;conflict:boolean};
export const revisionFrameCount=(base:RevisionBase)=>base.plan?.pages.length??(typeof base.selection.length==='number'?base.selection.length:base.frameRecommendation?.count??8);
export const preserveRevisionScript=(base:RevisionBase,changes:RevisionChanges)=>!base.plan&&base.savedFrameCount===revisionFrameCount(base)&&(changes.productionPrompt??base.selection.productionPrompt)===base.selection.productionPrompt&&(changes.narrativeDetail??base.selection.narrativeDetail??'balanced')===(base.selection.narrativeDetail||'balanced')&&(changes.length===undefined||changes.length===base.selection.length||changes.length===revisionFrameCount(base));
export function revisionReviewNotesChanged(base:Pick<RevisionContent,'reviewNotes'>,changes:RevisionChanges){
 return changes.reviewNotes!==undefined&&changes.reviewNotes.trim()!==(base.reviewNotes||'');
}
// 删除幅号对应原稿，返回用于图像复用和阅读进度的原始索引。
export function survivingRevisionFrames(count:number,removed:readonly number[]=[]){
 const omitted=new Set(removed);
 return Array.from({length:count},(_,index)=>index).filter(index=>!omitted.has(index+1));
}
export function revisionStorySummaryChanged(base:RevisionBase,changes:RevisionChanges){
 return changes.storySummary!==undefined&&changes.storySummary.trim()!==base.plan?.summary;
}
export function revisionImpact(base:RevisionContent,changes:RevisionChanges):RevisionImpact{
 const selection={...base.selection,...artStyleSettings(base.selection,changes),productionPrompt:changes.productionPrompt??base.selection.productionPrompt};
 const styleChanged=!sameArtDirection(selection,base.selection);
 const requirements=selection.productionPrompt!==base.selection.productionPrompt;
 const detail=changes.narrativeDetail!==undefined&&changes.narrativeDetail!==(base.selection.narrativeDetail||'balanced');
 const count=changes.length!==undefined&&(changes.length==='auto'?base.selection.length!=='auto':changes.length!==revisionFrameCount(base));
 const replan=!base.plan||requirements||detail||count,plan=changes.plan||base.plan;
 const manual=!!changes.plan&&JSON.stringify(changes.plan)!==JSON.stringify(base.plan);
 const acceptance=(changes.acceptancePrompt??base.selection.acceptancePrompt??'')!==(base.selection.acceptancePrompt||'');
 const reviewNotes=revisionReviewNotesChanged(base,changes);
 const summary=revisionStorySummaryChanged(base,changes);
 const changed=acceptance||requirements||detail||count||manual||styleChanged||reviewNotes||summary||!!changes.redrawPages?.length||!!changes.structureEdits;
 const survivors=changes.removedFrames&&base.plan?survivingRevisionFrames(base.plan.pages.length,changes.removedFrames):undefined;
 const sourcePages=survivors?.length===plan?.pages.length?survivors:undefined;
 const total=!replan&&plan?plan.pages.length:typeof changes.length==='number'?changes.length:revisionFrameCount(base);
 const reusable=plan?reusableRevisionImages(base,selection,plan,sourcePages).filter((image,index)=>image&&!changes.redrawPages?.includes(index+1)).length:0;
 return {changed,replan,preserveScript:preserveRevisionScript(base,changes),review:replan||acceptance||manual||reviewNotes,reused:replan?0:reusable,redraw:replan?total:total-reusable,total,reusePending:!!base.plan&&replan&&!requirements&&!styleChanged,conflict:replan&&(manual||summary)};
}
export function checkedRevision(base:RevisionContent,input:RevisionChanges){
 const parsed=revisionChangesSchema.safeParse(input);
 if(!parsed.success){
  const issue=parsed.error.issues[0],page=issue.path.indexOf('pages');
  if(issue.path[0]==='artStylePrompt')throw new ReaderError(400,'请填写有效的画风提示词，最多 3000 字。');
  if(issue.path[0]==='redrawNotes')throw new ReaderError(400,`请填写有效的重绘幅号及说明，每条说明最多 ${redrawNoteMaxLength} 字。`);
  if(issue.path[0]==='storySummary')throw new ReaderError(400,'梗概须填写内容，最多 1200 字。');
  if(issue.path[0]==='removedFrames')throw new ReaderError(400,'请提交不重复的有效删除幅号，并且至少保留一幅。');
  if(issue.path[0]==='reviewNotes')throw new ReaderError(400,`审核意见最多 ${reviewNotesMaxLength} 字。`);
  throw new ReaderError(400,page>=0?`第 ${Number(issue.path[page+1])+1} 幅内容长度不符合要求：旁白 8–90 字，画面提示词 20–1800 字。`:'请检查制作要求、人物设定及余味的内容长度。');
 }
 const changes=parsed.data,{redrawPages,redrawNotes}=changes;
 if(redrawNotes&&(!redrawPages||Object.keys(redrawNotes).some(page=>!redrawPages.includes(Number(page)))))throw new ReaderError(400,'重绘说明只能用于本次选中的画幅。');
 if(changes.redrawPages){
  if(Object.keys(changes).some(key=>key!=='redrawPages'&&key!=='redrawNotes'))throw new ReaderError(400,'仅换图不能同时修改文字、分镜或制作设置。');
  if(!base.plan||changes.redrawPages.some(page=>page>base.plan!.pages.length))throw new ReaderError(400,'重绘页码必须属于已保存的完整分镜。');
 }
 if((changes.plan||changes.storySummary!==undefined)&&!base.plan)throw new ReaderError(400,'请先保存完整分镜，再修改分镜或梗概。');
 const removed=changes.removedFrames;
 if(changes.mergeTargets&&(!removed||!base.plan||new Set(changes.mergeTargets).size!==changes.mergeTargets.length||
  changes.mergeTargets.some(page=>page>base.plan!.pages.length||removed.includes(page))))throw new ReaderError(400,'请检查合并保留位置和删除幅号。');
 const sourcePages=removed&&base.plan?survivingRevisionFrames(base.plan.pages.length,removed):undefined;
 if(removed&&(!base.plan||!changes.plan||removed.some(page=>page>base.plan!.pages.length)||!sourcePages?.length||sourcePages.length!==changes.plan.pages.length))throw new ReaderError(400,'删除幅号和修改后的分镜数量必须一致，故事至少保留一幅。');
 if(!removed&&changes.plan&&changes.plan.pages.length!==base.plan!.pages.length)throw new ReaderError(400,'减幅时请提供原稿中删除的幅号。');
 const impact=revisionImpact(base,changes);
 if(!impact.changed)throw new ReaderError(400,'尚未修改内容，无需创建新版。');
 if(impact.conflict)throw new ReaderError(400,'重新编排与分镜或梗概编辑不能同时提交，请选择保留哪一类修改。');
 if(changes.plan&&(['title','summary','sourceReference','adaptationNote'] as const).some(key=>changes.plan![key]!==base.plan![key]))throw new ReaderError(400,'本次仅修改分镜、人物与余味，原文出处和故事元信息保持不变。');

 const selection:Selection={...base.selection,...(changes.acceptancePrompt!==undefined?{acceptancePrompt:changes.acceptancePrompt}:{}),productionPrompt:changes.productionPrompt??base.selection.productionPrompt,...artStyleSettings(base.selection,changes),narrativeDetail:changes.narrativeDetail??base.selection.narrativeDetail,length:sourcePages?.length??changes.length??(impact.replan?'auto':base.selection.length)};
 const plan=impact.replan?null:structuredClone(changes.plan||base.plan);
 if(plan&&changes.storySummary!==undefined)plan.summary=changes.storySummary;
 return {impact,selection,plan,sourcePages};
}

// 换画风后，本篇后续版本也用自己的首幅作参考。旧版换画风记录可从修订基准识别。
export function usesStoryImageReference(revision:RevisionRecord|undefined,style:Selection['artStyle']){
 if(!revision||revision.kind==='selection')return false;
 const previousStyle=revision.base?.selection?.artStyle;
 return revision.storyImageReference===true||!!previousStyle&&previousStyle!==style;
}

// 只在绘图请求中应用说明，保留审核过的分镜与后续编辑的基准。
