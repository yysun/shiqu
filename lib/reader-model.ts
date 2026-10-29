// Validate saved story documents and expose the next resumable generation step.
import {z} from 'zod';
import type {Story} from './content';
import type {OriginalSource} from './reader-source-types.ts';
import {artStyleIds,getArtStyle} from './reader-styles.ts';
import {localSourceSchema} from './reader-local-contract.ts';
import {readerMinFrames,readerMaxFrames} from './reader-limits.ts';
import {narrativeDetailSchema} from './reader-frame-recommendation.ts';
import type {FrameRecommendation} from './reader-frame-recommendation.ts';
export {readerBooks} from './reader-books.ts';
export const selectionSchema=z.object({bookId:z.string().min(1).max(100),customBook:z.string().max(500).optional(),storyTitle:z.string().max(100).optional(),source:localSourceSchema.optional(),theme:z.string().trim().min(1).max(100),artStyle:z.enum(artStyleIds).default('ink-pencil'),productionPrompt:z.string().max(1200).default(''),narrativeDetail:narrativeDetailSchema.optional(),length:z.union([z.number().int().min(readerMinFrames).max(readerMaxFrames),z.literal('auto')]).default('auto'),voice:z.boolean().default(false).transform(()=>false)});
export type Selection=z.infer<typeof selectionSchema>;
export const planSchema=z.object({title:z.string().min(1).max(40),hook:z.string().min(1).max(100),sourceReference:z.string().min(1).max(150),adaptationNote:z.string().min(1).max(600),reflection:z.string().min(1).max(100),characters:z.string().min(20).max(2500),pages:z.array(z.object({caption:z.string().min(8).max(90),prompt:z.string().min(20).max(1800)})).min(readerMinFrames).max(readerMaxFrames)});
export type Plan=z.infer<typeof planSchema>;
export type GeneratedStory=Story&{generated:true;original?:OriginalSource;sourceReference:string;voiceRequested:boolean;artStyleLabel:string;productionPrompt:string};
export type Document={plan:Plan|null;original?:OriginalSource;frameRecommendation?:FrameRecommendation;frameCountConfirmed?:boolean;images:string[];audio:string[];usage:{step:string;model:string;requestId:string|null;usage:unknown}[]};
export type SessionRow={id:string;user_id:string;selection:string;document:string;state:'idle'|'running'|'failed'|'completed';error:string|null;step_key:string|null;step_attempts:number;lock_token:string|null;lock_until:number;page:number;saved:number;last_read_at:string|null;created_at:string;updated_at:string};
export type Step={kind:'recommend'|'plan'|'source'|'image'|'audio';page:number;key:string};
export type SessionView={id:string;selection:Selection;state:SessionRow['state'];productionState?:'running'|'queued'|'paused';error:string|null;retryAllowed:boolean;retryAt:number|null;retryMayCharge:boolean;retryStage?:'publication';stage:string;frameRecommendation:FrameRecommendation|null;awaitingFrameCount:boolean;ready:number;story:GeneratedStory|null;page:number;saved:boolean;lastReadAt:string|null;createdAt:string};
export function emptyDocument():Document{return {plan:null,images:[],audio:[],usage:[]};}
export function nextStep(doc:Document,selection:Selection,through:number):Step|null{
 if(!doc.plan){
  if(selection.narrativeDetail){
   if(!doc.frameRecommendation)return {kind:'recommend',page:0,key:'recommend'};
   if(!doc.frameCountConfirmed)return null;
  }
  return {kind:'plan',page:0,key:'plan'};
 }
 if(!doc.original)return {kind:'source',page:0,key:'source'};
 const end=Math.min(doc.plan.pages.length-1,Math.max(0,through));
 for(let page=0;page<=end;page++){if(!doc.images[page])return {kind:'image',page,key:'image:'+page};}
 return null;
}
export function awaitingFrameCount(doc:Document,selection:Selection){return !!selection.narrativeDetail&&!doc.plan&&!!doc.frameRecommendation&&!doc.frameCountConfirmed;}
export function view(row:SessionRow):SessionView{
 const selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document,p=doc.plan;
 const step=nextStep(doc,selection,readerMaxFrames-1);
 const retryMayCharge=!!step&&step.kind!=='source';
 const retryAt=null;
 const waiting=awaitingFrameCount(doc,selection);
 const stage=waiting?'请选择画幅数':step?.kind==='recommend'?'正在阅读原文，推荐画幅数':step?.kind==='plan'?'正在编排故事':step?.kind==='source'?'正在保存故事原文':step?.kind==='audio'?`正在配上第 ${step.page+1} 幅的声音`:step?`正在绘制第 ${step.page+1} 幅`:'故事已完整展开';
 const story:GeneratedStory|null=p?{id:row.id,title:p.title,hook:p.hook,bookId:selection.bookId,theme:selection.theme,status:'draft',pages:p.pages.map((v,i)=>({...v,image:doc.images[i]||'',audio:doc.audio[i]||''})),reflection:p.reflection,sourceText:doc.original?.text||'',sourceUrl:doc.original?.url||'',original:doc.original,sourceReference:doc.original?.title||p.sourceReference,adaptationNote:(doc.original?'AI 即时改编，非原文引述；原文节选与改编内容分开保存。':'AI 即时改编，非原文引述；原典线索由模型提供，尚未逐条核验。')+p.adaptationNote,checks:{source:!!doc.original,plot:false,visual:false},actualCost:null,currency:'USD',revision:1,createdAt:row.created_at,updatedAt:row.updated_at,generated:true,voiceRequested:selection.voice,artStyleLabel:getArtStyle(selection.artStyle).label,productionPrompt:selection.productionPrompt}:null;
 return {id:row.id,selection,state:row.state,error:row.error,retryAllowed:!!step,retryAt,retryMayCharge,stage,frameRecommendation:doc.frameRecommendation||null,awaitingFrameCount:waiting,ready:doc.images.filter(Boolean).length,story,page:row.page,saved:!!row.saved,lastReadAt:row.last_read_at||null,createdAt:row.created_at};
}
export class ReaderError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;}}
