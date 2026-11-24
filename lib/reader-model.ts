// Validate saved story documents; complete drafts wait for a separately edited title and ending before review.
import type {RequirementsSetup} from './reader-requirements.ts';
import {z} from 'zod';
import type {StoryPublication} from './story-publication';
import {acceptancePromptSchema} from './reader-acceptance.ts';
import type {PromptRecord} from './reader-prompt-records.ts';
import {sourceCardSchema,discoverySchema,effectiveIntakePhase,intakeDraftToken,intakeSearch} from './reader-intake.ts';
import type {StoryIntake,IntakeView,ReselectionDraft} from './reader-intake.ts';
import type {RevisionRecord,RevisionView} from './reader-revision.ts';
import {revisionRedraw} from './reader-revision-images.ts';
import type {Story} from './content';
import type {LandscapePrint} from './reader-production.ts';
import type {OriginalSource} from './reader-source-types.ts';
import {artStylePromptSchema,artStyleIds,getArtStyle} from './reader-styles.ts';
import {localSourceSchema} from './reader-local-contract.ts';
import {readerMinFrames,readerMaxFrames,readerStoryboardBatchSize} from './reader-limits.ts';
import {shelfCoverAsset,shelfCoverFilePattern} from './reader-image-assets.ts';
import {storyBriefVerified} from './reader-story-brief.ts';
import {narrativeDetailSchema} from './reader-frame-recommendation.ts';
import type {FrameRecommendation} from './reader-frame-recommendation.ts';
import type {ReviewCheckpoint,ReviewIssue} from './reader-review.ts';
import type {FaultView,RecoveryReceiptView,ReviewSkipOffer} from './reader-recovery.ts';
import type {DagDocument} from './production-dag/document.ts';
import type {DagProgress} from './production-dag/progress.ts';
import type {ProductionLifecycle} from './production-lifecycle.ts';
// 制作 DAG 的进度视图由 production-dag/progress.ts 在加载时登记：它经引擎与调用契约回引本模块，直接导入会形成循环。
let dagProgress:(doc:Document,selection:Selection)=>DagProgress|null=()=>null;
export function registerDagProgress(fn:typeof dagProgress){dagProgress=fn;}
export {readerBooks} from './reader-books.ts';
// A reader's display name stays separate from the selected source and AI-authored script.
export const displayTitleSchema=z.string().trim().min(1,'请输入故事名。').max(40,'故事名最多 40 字。').regex(/^[^\r\n]+$/,'故事名请写在一行内。');
// Discovery intent is distinct from the chosen candidate and the editable published title.
export const selectionSchema=z.object({bookId:z.string().min(1).max(100),customBook:z.string().max(500).optional(),discovery:discoverySchema.optional(),storyTitle:z.string().max(100).optional(),displayTitle:displayTitleSchema.optional(),source:localSourceSchema.optional(),sourceCard:sourceCardSchema.optional(),discoverySources:z.array(localSourceSchema).min(1).max(24).optional(),theme:z.string().trim().min(1).max(100),artStyle:z.enum(artStyleIds).default('ink-pencil'),artStylePrompt:artStylePromptSchema,productionPrompt:z.string().max(1200).default(''),acceptancePrompt:acceptancePromptSchema.optional(),narrativeDetail:narrativeDetailSchema.optional(),length:z.union([z.number().int().min(readerMinFrames).max(readerMaxFrames),z.literal('auto')]).default('auto'),voice:z.boolean().default(false).transform(()=>false)});
export type Selection=z.infer<typeof selectionSchema>;
export const planSchema=z.object({title:z.string().min(1).max(40),summary:z.string().trim().min(1).max(1200),sourceReference:z.string().min(1).max(150),adaptationNote:z.string().min(1).max(600),reflection:z.string().min(1).max(100),characters:z.string().min(20).max(2500),pages:z.array(z.object({caption:z.string().min(8).max(90),prompt:z.string().min(20).max(1800)})).min(readerMinFrames).max(readerMaxFrames)});
export type Plan=z.infer<typeof planSchema>;
export const reflectionCandidatesSchema=z.array(planSchema.shape.reflection.trim().min(1)).length(3).superRefine((values,ctx)=>{
 if(new Set(values).size!==3)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Ending candidates must be distinct'});
});
export type ReflectionCandidates=z.infer<typeof reflectionCandidatesSchema>;
export const storyPresentationSchema=z.object({title:planSchema.shape.title.trim().min(1),candidates:reflectionCandidatesSchema});
export type StoryPresentation=z.infer<typeof storyPresentationSchema>;
export const storyDraftSchema=planSchema.omit({reflection:true});
export type StoryDraft=z.infer<typeof storyDraftSchema>;
export const storyboardOutlineSchema=storyDraftSchema.omit({pages:true}).extend({beats:z.array(z.string().min(1).max(180)).min(readerMinFrames).max(readerMaxFrames)});
export type StoryboardOutline=z.infer<typeof storyboardOutlineSchema>;
export type Storyboard={outline:StoryboardOutline;pages:Plan['pages']};
export const storyboardBatchSchema=(count:number)=>z.object({pages:planSchema.shape.pages.length(count)});
export type GeneratedStory=Story&{generated:true;original?:OriginalSource;sourceReference:string;voiceRequested:boolean;artStyleLabel:string;productionPrompt:string;generationModels?:{step:string;model:string}[]};
export type Document={/** 文档 v2：制作内容与产物记录的权威来源，plan、images 为其存储投影。 */dag?:DagDocument;landscapePrints?:LandscapePrint[];copiedFrom?:{storyId:string;contentHash:string;draft?:boolean;imageChoice?:boolean;images?:'pending'|'complete'|'skipped'};setupRequirements?:RequirementsSetup;creationHash?:string;reselection?:ReselectionDraft;publication?:StoryPublication;intake?:StoryIntake;revision?:RevisionRecord;plan:Plan|null;draft?:StoryDraft;reflectionCandidates?:ReflectionCandidates;storyboard?:Storyboard;visualReview?:ReviewCheckpoint;reviewNotes?:string;original?:OriginalSource;summaryProductionPrompt?:string;storySummaryFromStoryboard?:true;frameRecommendation?:FrameRecommendation;frameCountConfirmed?:boolean;images:string[];audio:string[];usage:{step:string;model:string;requestId:string|null;usage:unknown;reasoningEffort?:string;promptRecord?:PromptRecord;promptRecordId?:string;originId?:string}[]};
/** 阅读模式已退役，所有故事都是整篇后台制作；保留类型以兼容已保存的视图。 */
export type GenerationMode='background';
export type GenerationControl='active'|'paused'|'stopped';
/** continue 只用于制作 DAG 的「已保存，等待继续」：清除等待并恢复后台制作。 */
export type ProductionAction='background'|'pause'|'stop'|'resume'|'continue'|'apply-model'|'reprepare';
export type SessionRow={family_shelf_cover?:string|null;id:string;user_id:string;selection:string;document:string;generation_mode?:GenerationMode;generation_control?:GenerationControl;state:'idle'|'running'|'failed'|'completed';error:string|null;step_key:string|null;step_attempts:number;lock_token:string|null;lock_until:number;page:number;saved:number;last_read_at:string|null;created_at:string;updated_at:string};
export type Step={kind:'discover'|'recommend'|'plan'|'source'|'reflection'|'review'|'repair'|'restyle'|'image'|'audio';page:number;key:string};
export type GenerationProgress={sourceReady:boolean;frameCountConfirmed:boolean;frameCount:number|null;storyboardFrames?:number;storyboardBatch?:{first:number;last:number};drawingFrames?:number;activity?:string;reviewStatus?:ReviewCheckpoint['status'];reviewPhase?:'frames'|'full';reviewRound?:number;repairCompleted?:number;repairTotal?:number;reviewAudits?:number;repairBatches?:number;repairPasses?:number;reviewStopReason?:'limit'|'unchanged'|'replan'|'requirements';reviewOverridden?:boolean;phase:Step['kind']|'frame-count'|'story-choice'|'production-confirmation'|'completed';startedAt:number|null;timeoutAt?:number|null;stageDurations?:Record<string,number>;attempt:number};
export type SessionView={
 reviewSkip?:ReviewSkipOffer;lifecycle?:ProductionLifecycle;
 shelfCover?:string;
 landscapeWork?:{printId:string;action:'pause'|'resume'};
 /** @deprecated 使用 lifecycle.continuation。 */
 awaitingContinue?:true;
 /** 仅换图的画幅号，从 1 开始。 */
 redrawPage?:number;
 /** @deprecated 使用 lifecycle.service。 */
 snapshotUnavailable?:true;
 reselection?:ReselectionDraft;faults?:FaultView[];recoveryReceipt?:RecoveryReceiptView;
 /** @deprecated 使用 lifecycle.version。 */
 superseded?:boolean;
 intake?:IntakeView;revision?:RevisionView;reviewIssues?:ReviewIssue[];id:string;selection:Selection;generationMode?:GenerationMode;
 /** @deprecated 使用 lifecycle.control 区分读者控制与等待继续。 */
 generationControl?:GenerationControl;
 state:SessionRow['state'];
 /** @deprecated 使用 lifecycle.activity 及控制状态。 */
 productionState?:'running'|'queued'|'paused';
 generationProgress?:GenerationProgress;error:string|null;retryAllowed:boolean;retryAt:number|null;
 retryStage?:'source'|'prepare'|'generation'|'publication'|'review'|'redraw';stage:string;frameRecommendation:FrameRecommendation|null;
 ready:number;story:GeneratedStory|null;page:number;saved:boolean;lastReadAt:string|null;createdAt:string;
};
export function reviewPassed(doc:Document){return !doc.visualReview||doc.visualReview.status==='passed';}
// Pending automatic drafts enter the count gate; old passed/blocked records keep their saved meaning.
export function reviewPhase(review:ReviewCheckpoint,selection:Selection):'frames'|'full'{return selection.length==='auto'?(review.phase||(review.status==='pending'?'frames':'full')):'full';}
// An unchanged repair resolved the pages it did change; only the rest still need the reader.
export function blockedIssues(review:ReviewCheckpoint){return review.stopReason==='unchanged'?review.issues.filter(issue=>!review.repaired.includes(issue.page)):review.issues;}
export function emptyDocument():Document{return {plan:null,images:[],audio:[],usage:[]};}
/**
 * 准备阶段的下一步：候选查找与「准备故事」（原文、梗概、制作建议）。进入制作 DAG 之后的全部工作由引擎调度，这里不再给出步骤。
 * 尚无 dag 且已有旧版内容的故事由 DagProduction.adopt() 转换，也不在此推进。
 */
export function nextStep(doc:Document,selection:Selection,_through?:number):Step|null{
 if(doc.reselection&&doc.intake?.phase!=='discovering')return null;
 if(doc.intake?.phase==='discovering')return {kind:'discover',page:0,key:'discover:'+doc.intake.generation};
 if(doc.intake&&['choosing','confirming'].includes(doc.intake.phase))return null;
 if(doc.dag&&(!doc.intake||doc.intake.phase==='confirmed')||doc.plan||doc.storyboard||doc.draft)return null;
 if((doc.original?.storyBrief||doc.intake?.briefRequired&&doc.intake.selected)&&!storyBriefVerified(doc.original))return {kind:'recommend',page:0,key:'recommend'};
 if(selection.narrativeDetail&&!doc.frameRecommendation)return {kind:'recommend',page:0,key:'recommend'};
 return null;
}
export function productionComplete(doc:Document,selection:Selection){return (!doc.intake||doc.intake.phase==='confirmed')&&!nextStep(doc,selection,readerMaxFrames-1);}
export function view(row:SessionRow):SessionView{
 const selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document,p=doc.plan;
 const progress=dagProgress(doc,selection),step=progress?progress.step:nextStep(doc,selection),intakePhase=effectiveIntakePhase(doc,selection);
 const legacyReview=doc.dag?undefined:doc.visualReview;
 const retryAt=null;
 const storyboardBatch=doc.storyboard&&!p&&!doc.draft?{first:doc.storyboard.pages.length+1,last:Math.min(doc.storyboard.pages.length+readerStoryboardBatchSize,doc.storyboard.outline.beats.length)}:undefined;
 const combining=selection.discovery?.mode==='auto'&&selection.discovery.combine;
 const stage=intakePhase==='discovering'?combining?'正在整理所选原文':'正在提取候选故事':intakePhase==='choosing'?combining?'故事整理待重试':'请选择故事':intakePhase==='confirming'?'请确认制作内容':progress?.activity?`正在${progress.activity}`:step?.kind==='recommend'?combining||selection.sourceCard?'正在准备故事与制作建议':'正在阅读原文，推荐画幅数':step?.kind==='plan'?(storyboardBatch?`正在编排第 ${storyboardBatch.first}–${storyboardBatch.last} 幅分镜`:selection.length==='auto'||selection.length>readerStoryboardBatchSize?'正在编制分镜目录':'正在编排故事'):step?.kind==='reflection'?'正在拟定标题与结语':step?.kind==='source'?'正在保存故事原文':step?.kind==='review'?(legacyReview?.status==='blocked'?'分镜审片待修订':legacyReview&&reviewPhase(legacyReview,selection)==='frames'?'正在审核画幅数':legacyReview?.repairs?'正在复核全篇分镜':'正在审核全篇分镜'):step?.kind==='repair'?(step.key.endsWith(':0')?'正在修订故事结语':'正在修订分镜画面'):step?.kind==='restyle'?'正在转换画面提示词':step?.kind==='audio'?`正在配上第 ${step.page+1} 幅的声音`:step?`正在绘制第 ${step.page+1} 幅`:'故事已完整展开';
 const story:GeneratedStory|null=p?{id:row.id,title:selection.displayTitle||p.title,summary:p.summary,bookId:selection.bookId,theme:selection.theme,status:'draft',pages:p.pages.map((v,i)=>({...v,image:doc.images[i]||'',audio:doc.audio[i]||''})),reflection:p.reflection,sourceText:doc.original?.chapterContext?.text||doc.original?.text||'',sourceUrl:doc.original?.url||'',original:doc.original,sourceReference:doc.original?.chapterContext?.title||doc.original?.title||p.sourceReference,adaptationNote:(doc.original?'AI 即时改编，非原文引述；原文节选与改编内容分开保存。':'AI 即时改编，非原文引述；原典线索由模型提供，尚未逐条核验。')+p.adaptationNote,checks:{source:!!doc.original,plot:false,visual:false},revision:doc.revision?.number||1,createdAt:row.created_at,updatedAt:row.updated_at,generated:true,voiceRequested:selection.voice,artStyleLabel:getArtStyle(selection.artStyle).label,productionPrompt:selection.productionPrompt}:null;
 // Export model provenance without exposing provider request IDs or raw usage payloads.
 if(story&&doc.publication)story.publication=doc.publication;
 if(story)story.generationModels=(doc.usage||[]).map(({step,model})=>({step,model}));
 const frameCountConfirmed=!!progress||!!p||!!doc.draft||!!doc.storyboard||!!doc.frameCountConfirmed||!selection.narrativeDetail&&typeof selection.length==='number';
 const generationProgress:GenerationProgress={sourceReady:!!doc.original,frameCountConfirmed,
  ...(progress?{frameCount:progress.frameCount,storyboardFrames:progress.storyboardFrames,drawingFrames:progress.drawingFrames,activity:progress.activity}:{
   frameCount:p?.pages.length??doc.draft?.pages.length??doc.storyboard?.outline.beats.length??(frameCountConfirmed&&typeof selection.length==='number'?selection.length:null),
   ...(doc.storyboard||doc.draft?{storyboardFrames:doc.draft?.pages.length??doc.storyboard!.pages.length,storyboardBatch}:{}),
  }),...(progress?progress.review:legacyReview?{reviewStatus:legacyReview.status,reviewPhase:reviewPhase(legacyReview,selection),reviewRound:legacyReview.round,repairCompleted:legacyReview.repaired.length,repairTotal:legacyReview.issues.length,reviewAudits:legacyReview.reports.length,repairBatches:legacyReview.history?.length,repairPasses:legacyReview.repairs,reviewStopReason:legacyReview.stopReason,reviewOverridden:!!legacyReview.overridden}:{}),phase:intakePhase==='choosing'?'story-choice':intakePhase==='confirming'?'production-confirmation':step?.kind||'completed',startedAt:null,attempt:row.step_attempts||0};
 const search=doc.intake?intakeSearch(doc.intake):undefined;
 const intake=doc.intake?{phase:intakePhase!,generation:doc.intake.generation,batches:doc.intake.batches,selected:doc.intake.selected,manualArt:doc.intake.manualArt,draft:doc.intake.draft,...(['preparing','confirming'].includes(intakePhase!)?{draftToken:intakeDraftToken(doc.intake.draft)}:{}),search:{state:search!.state,error:search!.error}}:undefined;
 const redraw=doc.revision&&p&&(doc.dag?progress?.review.reviewStatus==='passed':reviewPassed(doc))?revisionRedraw(doc.revision,selection,p,doc.images):undefined;
 const cover=row.family_shelf_cover;
 const shelfCover=cover&&shelfCoverFilePattern.test(cover)?shelfCoverAsset(doc.revision?.rootId||row.id,cover).url:undefined;
 return {...(shelfCover?{shelfCover}:{}),...(doc.dag?.continuation?{awaitingContinue:true as const}:{}),...(progress?.redrawPage?{redrawPage:progress.redrawPage}:{}),...(doc.reselection?{reselection:doc.reselection}:{}),...(doc.intake?{intake:intake as IntakeView}:{}),...(doc.revision?{revision:{parentId:doc.revision.parentId,rootId:doc.revision.rootId,number:doc.revision.number,...(redraw?{redraw}:{})}}:{}),...(legacyReview?.status==='blocked'?{reviewIssues:blockedIssues(legacyReview)}:{}),id:row.id,selection,generationMode:'background',generationControl:doc.dag?.continuation&&row.generation_control==='active'?'paused':row.generation_control||'active',state:row.state,generationProgress,error:row.error,retryAllowed:!!step&&!['replan','requirements'].includes(legacyReview?.stopReason||''),retryAt,...(legacyReview?.status==='blocked'?{retryStage:'review' as const}:step?.kind==='source'||row.state==='failed'&&!doc.original&&row.error?.startsWith('原文未能核对')?{retryStage:'source' as const}:{}),stage,frameRecommendation:doc.frameRecommendation||null,ready:doc.dag?doc.dag.order.filter(id=>doc.dag!.frames[id]?.image&&doc.dag!.products[`frameImage:${id}`]?.readable!==false).length:doc.images.filter(Boolean).length,story,page:row.page,saved:!!row.saved,lastReadAt:row.last_read_at||null,createdAt:row.created_at};
}
// Saved documents are not schema-checked, so rendering is the proof that a row can be used at all.
export function readableStory(row:SessionRow){try{view(row);return true;}catch{return false;}}
export class ReaderError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;}}
