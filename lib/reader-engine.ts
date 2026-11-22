// 准备阶段的推进：在会话锁内核对原文、梗概并给出制作建议，保留每一次已付费的结果。
// 确认之后的全部制作由制作 DAG（lib/production-dag、server/dag-production.ts）调度，这里不再编排、审片或绘图。
// 保存失败会重新抛出以便恢复，不记为提供方失败。
import {nextStep,selectionSchema,view,ReaderError,productionComplete,readerBooks} from './reader-model.ts';
import type {Document,Plan,Selection} from './reader-model.ts';
import {persistenceError} from './reader-repository.ts';
import type {ReaderRepository} from './reader-repository.ts';
import type {ArtStyleId} from './reader-styles.ts';
import type {ImageLayout} from './reader-image-dimensions.ts';
import type {OriginalSource,SourceResult,SourceHint} from './reader-source-types.ts';
import {suggestedSettings} from './reader-requirements.ts';
import {frameRecommendationOutputSchema,preparesSelectedStory} from './reader-frame-recommendation.ts';
import {pendingStorySummary,storyBriefSchema} from './reader-story-brief.ts';
import {normalizeProductionPrompt,storyEditorialContext} from './reader-prompts.ts';
import type {FrameRecommendation} from './reader-frame-recommendation.ts';
import {artRecommendationSchema} from './reader-art-recommendation.ts';
import type {ArtRecommendation} from './reader-art-recommendation.ts';
import type {PromptRecord} from './reader-prompt-records.ts';
export type Generated<T>={promptRecord?:PromptRecord;value:T;model:string;requestId:string|null;usage:unknown;reasoningEffort?:string};
export interface StoryGenerator{/** 提供方的通用文字调用；制作 DAG 按调用契约经它发出请求。 */textCall?:(task:import('./reader-reasoning.ts').ReasoningTask,instructions:string,payload:unknown,schema:unknown,maxOutputTokens:number,original?:OriginalSource)=>Promise<Generated<unknown>>;/** 核对保存的原文仍属于所选出处；不符时抛出。 */verifyOriginal?(selection:Selection,original:OriginalSource|undefined):void;summarizeStoryboard?(pages:Plan['pages']):Promise<Generated<string>>;recommendArt?(selection:Selection,original:OriginalSource):Promise<ArtRecommendation>;prepareOriginal?(selection:Selection,id:string):Promise<OriginalSource|null>;recommend?(selection:Selection,id:string,original:OriginalSource,prepareRequirements?:boolean):Promise<Generated<FrameRecommendation>>;original(selection:Selection,plan:SourceHint,id:string):Promise<SourceResult>;image(plan:Plan,page:number,id:string,reference:string,style?:ArtStyleId,productionPrompt?:string,artifactId?:string,layout?:ImageLayout,artStylePrompt?:string|null,promptOverride?:string):Promise<Generated<string>>;audio(caption:string,id:string,page:number):Promise<Generated<string>>;safeError(error:unknown):string;}

export async function advanceStory(repo:ReaderRepository,generator:StoryGenerator,uid:string,id:string,throughPage:number,retry=false,onAcquired?:(token:string)=>void,onFailed?:(error:unknown)=>void){
 let row=await repo.get(id,uid);
 if(row.generation_control&&row.generation_control!=='active')return view(row);
 if(row.state==='running'){if(row.lock_until>Date.now())return view(row);row=await repo.stale(row);}
 if(row.state==='failed'&&!retry)return view(row);
 const selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document;
 const step=nextStep(doc,selection,throughPage);if(!step||step.kind!=='recommend')return view(row);
 const token=await repo.acquire(row,step);if(!token)return view(await repo.get(id,uid));
 onAcquired?.(token);
 try{
  let preparedStory:Parameters<ReaderRepository['save']>[6];
  // 准备阶段：保存已核对的原文、梗概与制作建议的检查点。
  async function prepareRecommendation(ownedToken:string){
   if(!doc.original){
    let original=await generator.prepareOriginal?.(selection,id);
    if(!original){
     const book=selection.bookId==='other'?selection.customBook:readerBooks.find(b=>b.id===selection.bookId)?.title||selection.bookId;
     const result=await generator.original(selection,{sourceReference:`《${book||''}》${selection.storyTitle||''}`},id);
     if(!result.source)throw new ReaderError(503,'原文未能核对，暂时无法准备故事摘要。'+result.message);
     original=result.source;
    }
    doc.original=structuredClone(original);await repo.saveImageProgress(row,ownedToken,structuredClone(doc));
   }
   const chosen=doc.intake?.phase!=='confirmed'?doc.intake?.selected:undefined,candidate=chosen?doc.intake!.batches[chosen.batch]?.stories[chosen.index]:undefined;
   // Candidate guidance or an explicit placeholder stays bound to the saved original until checked.
   const combining=selection.discovery?.mode==='auto'&&selection.discovery.combine;
   const selectedSummary=selection.sourceCard?.description;
   const sourceReason=combining?'读者已选定多段原文，按整理后的结构保留各段关键事实。'
    :selectedSummary||storyEditorialContext(selection.theme).mode==='source'?'读者已直接选定原文，依据原文补齐完整主线。'
    :'已选中此故事，须对照原文确认具体主题依据并补齐完整主线。';
   const pendingBrief=candidate?.storyBrief||{
    summary:selectedSummary||doc.storyboard?.outline.summary||pendingStorySummary,
    matchReason:candidate?.matchReason||sourceReason,
   };
   if(!doc.original.storyBrief){
    doc.original.storyBrief={...storyBriefSchema.parse(pendingBrief),verified:false};
    await repo.saveImageProgress(row,ownedToken,structuredClone(doc));
   }
   const selectedStory=preparesSelectedStory(selection,doc.original);
   if(!selectedStory&&candidate?.source&&!candidate.artRecommendation&&generator.recommendArt){
    const recommendation=artRecommendationSchema.parse(await generator.recommendArt(selection,doc.original));
    await repo.saveArtRecommendation(row,ownedToken,doc,recommendation);
    candidate.artRecommendation=recommendation;
    if(!doc.intake!.manualArt)selection.artStyle=recommendation.artStyle;
   }
   if(!generator.recommend)throw new ReaderError(503,'生成服务暂不支持画幅建议，请更新服务后重试。');
   const prepareRequirements=!!doc.intake&&doc.intake.phase!=='confirmed'&&!doc.setupRequirements?.suggestions;
   const result=await generator.recommend(selection,id,doc.original,prepareRequirements),recommendation=frameRecommendationOutputSchema(doc.original,prepareRequirements,selectedStory).parse(result.value);
   if(selectedStory&&candidate&&chosen){
    const art=candidate.artRecommendation||recommendation.artRecommendation!;
    recommendation.artRecommendation=art;
    selection.storyTitle=recommendation.storyTitle!;
    if(!doc.intake!.manualArt)selection.artStyle=art.artStyle;
    preparedStory={title:selection.storyTitle,description:recommendation.storySummary!.slice(0,180),artRecommendation:art,batch:chosen.batch,index:chosen.index};
   }
   if(prepareRequirements){
    doc.setupRequirements={...doc.setupRequirements,suggestions:recommendation.requirements!};
    doc.intake!.draft??=suggestedSettings(selection,doc.setupRequirements.suggestions!,doc.setupRequirements.overrides);
   }
   if(doc.original.storyBrief)doc.original.storyBrief={summary:recommendation.storySummary!,matchReason:recommendation.storyMatchReason!,verified:true};
   doc.summaryProductionPrompt=normalizeProductionPrompt(selection.productionPrompt,selection.theme);
   doc.frameRecommendation=recommendation;if(selection.length==='auto'&&!doc.intake)doc.frameCountConfirmed=true;return result;
  }
  const generated=await prepareRecommendation(token);
  if(doc.intake&&doc.intake.phase!=='confirmed')doc.intake.phase='confirming';
  doc.usage.push({step:step.key,model:generated.model,requestId:generated.requestId,usage:generated.usage,...(generated.promptRecord?{promptRecord:generated.promptRecord}:{}),...(generated.reasoningEffort?{reasoningEffort:generated.reasoningEffort}:{})});
  return view(await repo.save(row,token,doc,productionComplete(doc,selection),null,undefined,preparedStory));
 }catch(error){if(error instanceof ReaderError&&error.status===404||persistenceError(error))throw error;onFailed?.(error);return view(await repo.save(row,token,doc,false,error instanceof ReaderError?error.message:generator.safeError(error)));}
}
