// Plan revisions from actual image inputs. Captions/reflection never invalidate artwork;
// a changed anchor, cast, style or global image preference invalidates its dependants.
import {z} from 'zod';
import {planSchema,ReaderError} from './reader-model.ts';
import type {Document,Plan,Selection} from './reader-model.ts';
import {artStyleIds} from './reader-styles.ts';
import {readerMinFrames,readerMaxFrames} from './reader-limits.ts';

export const revisionChangesSchema=z.object({productionPrompt:z.string().max(1200).optional(),artStyle:z.enum(artStyleIds).optional(),length:z.number().int().min(readerMinFrames).max(readerMaxFrames).optional(),plan:planSchema.optional()}).strict();
export type RevisionChanges=z.infer<typeof revisionChangesSchema>;
export type RevisionBase={selection:Selection;plan:Plan;images:string[]};
export type RevisionInfo={parentId:string;rootId:string;number:number};
export type RevisionRecord=RevisionInfo&{baseToken:string;requestHash:string;handoff?:boolean;base:RevisionBase};
export type RevisionSnapshot=RevisionBase&{token:string;epoch:number;revision?:RevisionInfo};
export type RevisionImpact={changed:boolean;replan:boolean;review:boolean;reused:number;redraw:number;total:number;reusePending:boolean;conflict:boolean};
export function reusableRevisionImages(base:RevisionBase,selection:Selection,plan:Plan){
 const stable=base.selection.artStyle===selection.artStyle&&base.selection.productionPrompt===selection.productionPrompt&&base.plan.characters===plan.characters;
 const anchor=stable&&!!base.images[0]&&base.plan.pages[0]?.prompt===plan.pages[0]?.prompt;
 return plan.pages.map((page,index)=>anchor&&base.plan.pages[index]?.prompt===page.prompt?base.images[index]||'':'');
}
export function revisionImpact(base:RevisionBase,changes:RevisionChanges):RevisionImpact{
 const selection={...base.selection,productionPrompt:changes.productionPrompt??base.selection.productionPrompt,artStyle:changes.artStyle??base.selection.artStyle};
 const requirements=selection.productionPrompt!==base.selection.productionPrompt;
 const count=changes.length!==undefined&&changes.length!==base.plan.pages.length;
 const replan=requirements||count,plan=changes.plan||base.plan;
 const manual=JSON.stringify(plan)!==JSON.stringify(base.plan);
 const changed=replan||manual||selection.artStyle!==base.selection.artStyle;
 const total=count?changes.length!:base.plan.pages.length;
 const reusable=reusableRevisionImages(base,selection,plan).filter(Boolean).length;
 return {changed,replan,review:changed,reused:replan?0:reusable,redraw:replan?total:total-reusable,total,reusePending:replan&&!requirements&&selection.artStyle===base.selection.artStyle,conflict:replan&&manual};
}
export function checkedRevision(base:RevisionBase,changes:RevisionChanges){
 const parsed=revisionChangesSchema.safeParse(changes);
 if(!parsed.success){const issue=parsed.error.issues[0],page=issue.path.indexOf('pages');throw new ReaderError(400,page>=0?`第 ${Number(issue.path[page+1])+1} 幅内容长度不符合要求：旁白 8–90 字，画面提示词 20–1800 字。`:'请检查制作要求、人物设定及余味的内容长度。');}
 const impact=revisionImpact(base,changes);
 if(!impact.changed)throw new ReaderError(400,'尚未修改内容，无需创建新版。');
 if(impact.conflict)throw new ReaderError(400,'重新编排与手动分镜不能同时提交，请选择保留哪一类修改。');
 if(changes.plan&&(['title','hook','sourceReference','adaptationNote'] as const).some(key=>changes.plan![key]!==base.plan[key]))throw new ReaderError(400,'本次仅修改分镜、人物与余味，原文出处和故事元信息保持不变。');
 if(changes.plan&&changes.plan.pages.length!==base.plan.pages.length)throw new ReaderError(400,'请通过画幅数调整数量，不要直接增删分镜。');
 const selection:Selection={...base.selection,productionPrompt:changes.productionPrompt??base.selection.productionPrompt,artStyle:changes.artStyle??base.selection.artStyle,length:changes.length??base.plan.pages.length};
 return {impact,selection,plan:impact.replan?null:structuredClone(changes.plan||base.plan)};
}
export function syncRevisionImages(doc:Document,selection:Selection){
 if(doc.revision&&doc.plan)doc.images=reusableRevisionImages(doc.revision.base,selection,doc.plan);
}
