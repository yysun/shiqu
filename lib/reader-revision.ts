// Plan revisions from actual image inputs. Captions/reflection never invalidate artwork;
// a changed anchor, cast, style or global image preference invalidates its dependants.
// Style and explicit image-only redraws preserve review; content and acceptance edits invalidate it.
import {z} from 'zod';
import {acceptancePromptSchema} from './reader-acceptance.ts';
import {planSchema,ReaderError} from './reader-model.ts';
import type {Document,Plan,Selection} from './reader-model.ts';
import type {ReviewCheckpoint} from './reader-review.ts';
import {artStyleIds} from './reader-styles.ts';
import {readerMinFrames,readerMaxFrames} from './reader-limits.ts';
import {narrativeDetailSchema} from './reader-frame-recommendation.ts';
import {reusableRevisionImages} from './reader-revision-images.ts';
import type {RevisionBase,RevisionRedraw} from './reader-revision-images.ts';
export {reusableRevisionImages};
export type {RevisionBase};

export const redrawNoteMaxLength=500;
const redrawNotesSchema=z.record(z.string().regex(/^[1-9]\d*$/),z.string().trim().min(1).max(redrawNoteMaxLength));
export const revisionChangesSchema=z.object({productionPrompt:z.string().max(1200).optional(),acceptancePrompt:acceptancePromptSchema.optional(),artStyle:z.enum(artStyleIds).optional(),length:z.union([z.number().int().min(readerMinFrames).max(readerMaxFrames),z.literal('auto')]).optional(),narrativeDetail:narrativeDetailSchema.optional(),plan:planSchema.optional(),redrawPages:z.array(z.number().int().min(1).max(readerMaxFrames)).min(1).max(readerMaxFrames).refine(pages=>new Set(pages).size===pages.length,'重绘页码不能重复。').optional(),redrawNotes:redrawNotesSchema.optional()}).strict();
export type RevisionChanges=z.infer<typeof revisionChangesSchema>;
export type RevisionInfo={parentId:string;rootId:string;number:number};
export type RevisionView=RevisionInfo&{redraw?:RevisionRedraw};
export type RevisionRecord=RevisionInfo&{kind?:'selection';selectionRequest?:string;baseToken:string;requestHash:string;handoff?:boolean;base:RevisionBase;previewedRedraw?:number;actualRedraw?:number;lostPages?:number[];redrawPages?:number[];redrawNotes?:RevisionChanges['redrawNotes']};
export type RevisionSnapshot=RevisionBase&{token:string;epoch:number;reviewStatus?:ReviewCheckpoint['status'];revision?:RevisionInfo};
export type RevisionImpact={changed:boolean;replan:boolean;preserveScript:boolean;review:boolean;reused:number;redraw:number;total:number;reusePending:boolean;conflict:boolean};
export const revisionFrameCount=(base:RevisionBase)=>base.plan?.pages.length??(typeof base.selection.length==='number'?base.selection.length:base.frameRecommendation?.count??8);
export const preserveRevisionScript=(base:RevisionBase,changes:RevisionChanges)=>!base.plan&&base.savedFrameCount===revisionFrameCount(base)&&(changes.productionPrompt??base.selection.productionPrompt)===base.selection.productionPrompt&&(changes.narrativeDetail??base.selection.narrativeDetail??'balanced')===(base.selection.narrativeDetail||'balanced')&&(changes.length===undefined||changes.length===base.selection.length||changes.length===revisionFrameCount(base));
export function revisionImpact(base:RevisionBase,changes:RevisionChanges):RevisionImpact{
 const selection={...base.selection,productionPrompt:changes.productionPrompt??base.selection.productionPrompt,artStyle:changes.artStyle??base.selection.artStyle};
 const requirements=selection.productionPrompt!==base.selection.productionPrompt;
 const detail=changes.narrativeDetail!==undefined&&changes.narrativeDetail!==(base.selection.narrativeDetail||'balanced');
 const count=changes.length!==undefined&&(changes.length==='auto'?base.selection.length!=='auto':changes.length!==revisionFrameCount(base));
 const replan=!base.plan||requirements||detail||count,plan=changes.plan||base.plan;
 const manual=!!changes.plan&&JSON.stringify(changes.plan)!==JSON.stringify(base.plan);
 const acceptance=(changes.acceptancePrompt??base.selection.acceptancePrompt??'')!==(base.selection.acceptancePrompt||'');
 const changed=acceptance||requirements||detail||count||manual||selection.artStyle!==base.selection.artStyle||!!changes.redrawPages?.length;
 const total=typeof changes.length==='number'?changes.length:revisionFrameCount(base);
 const reusable=plan?reusableRevisionImages(base,selection,plan).filter((image,index)=>image&&!changes.redrawPages?.includes(index+1)).length:0;
 return {changed,replan,preserveScript:preserveRevisionScript(base,changes),review:replan||acceptance||manual,reused:replan?0:reusable,redraw:replan?total:total-reusable,total,reusePending:!!base.plan&&replan&&!requirements&&selection.artStyle===base.selection.artStyle,conflict:replan&&manual};
}
export function checkedRevision(base:RevisionBase,changes:RevisionChanges){
 const parsed=revisionChangesSchema.safeParse(changes);
 if(!parsed.success){
  const issue=parsed.error.issues[0],page=issue.path.indexOf('pages');
  if(issue.path[0]==='redrawNotes')throw new ReaderError(400,`请填写有效的重绘幅号及说明，每条说明最多 ${redrawNoteMaxLength} 字。`);
  throw new ReaderError(400,page>=0?`第 ${Number(issue.path[page+1])+1} 幅内容长度不符合要求：旁白 8–90 字，画面提示词 20–1800 字。`:'请检查制作要求、人物设定及余味的内容长度。');
 }
 const {redrawPages,redrawNotes}=parsed.data;
 if(redrawNotes&&(!redrawPages||Object.keys(redrawNotes).some(page=>!redrawPages.includes(Number(page)))))throw new ReaderError(400,'重绘说明只能用于本次选中的画幅。');
 if(changes.redrawPages){
  if(Object.keys(changes).some(key=>key!=='redrawPages'&&key!=='redrawNotes'))throw new ReaderError(400,'仅换图不能同时修改文字、分镜或制作设置。');
  if(!base.plan||changes.redrawPages.some(page=>page>base.plan!.pages.length))throw new ReaderError(400,'重绘页码必须属于已保存的完整分镜。');
 }
 const impact=revisionImpact(base,changes);
 if(changes.plan&&!base.plan)throw new ReaderError(400,'完整分镜保存后才可手动修改分镜。');
 if(!impact.changed)throw new ReaderError(400,'尚未修改内容，无需创建新版。');
 if(impact.conflict)throw new ReaderError(400,'重新编排与手动分镜不能同时提交，请选择保留哪一类修改。');
 if(changes.plan&&(['title','summary','sourceReference','adaptationNote'] as const).some(key=>changes.plan![key]!==base.plan![key]))throw new ReaderError(400,'本次仅修改分镜、人物与余味，原文出处和故事元信息保持不变。');
 if(changes.plan&&changes.plan.pages.length!==base.plan!.pages.length)throw new ReaderError(400,'请调整叙事详略，由模型重新编排数量，不要直接增删分镜。');
 const selection:Selection={...base.selection,...(changes.acceptancePrompt!==undefined?{acceptancePrompt:changes.acceptancePrompt}:{}),productionPrompt:changes.productionPrompt??base.selection.productionPrompt,artStyle:changes.artStyle??base.selection.artStyle,narrativeDetail:changes.narrativeDetail??base.selection.narrativeDetail,length:changes.length??(impact.replan?'auto':base.selection.length)};
 return {impact,selection,plan:impact.replan?null:structuredClone(changes.plan||base.plan)};
}
export function syncRevisionImages(doc:Document,selection:Selection){
 if(doc.revision&&doc.plan)doc.images=reusableRevisionImages(doc.revision.base,selection,doc.plan).map((image,index)=>doc.revision!.redrawPages?.includes(index+1)?'':image);
}

// 只在绘图请求中应用说明，保留审核过的分镜与后续编辑的基准。
export function redrawImagePlan(plan:Plan,revision:RevisionRecord|undefined,page:number):Plan{
 const note=revision?.redrawNotes?.[page+1];
 if(!note)return plan;
 const pages=[...plan.pages],scene=pages[page];
 pages[page]={...scene,prompt:scene.prompt+'\n本幅重绘说明（限于画面细节，沿用场景、人物和画风）：'+note};
 return {...plan,pages};
}
