// Advance local story generation under one session lock, retaining every paid result it can save.
// A failed save is rethrown for recovery rather than recorded as a provider failure.
import {blockedIssues,nextStep,planSchema,reflectionCandidatesSchema,storyPresentationSchema,storyDraftSchema,storyboardOutlineSchema,storyboardBatchSchema,selectionSchema,view,ReaderError,productionComplete,readerBooks} from './reader-model.ts';
import type {Document,Plan,StoryDraft,ReflectionCandidates,StoryPresentation,Selection,SessionRow,Storyboard,StoryboardOutline} from './reader-model.ts';
import {persistenceError} from './reader-repository.ts';
import type {ReaderRepository} from './reader-repository.ts';
import type {ArtStyleId} from './reader-styles.ts';
import type {OriginalSource,SourceResult,SourceHint} from './reader-source-types.ts';
import {frameRecommendationOutputSchema} from './reader-frame-recommendation.ts';
import {storyBriefSchema,storyBriefVerified} from './reader-story-brief.ts';
import {storyEditorialContext} from './reader-prompts.ts';
import type {FrameRecommendation} from './reader-frame-recommendation.ts';
import {artRecommendationSchema} from './reader-art-recommendation.ts';
import type {ArtRecommendation} from './reader-art-recommendation.ts';
import {readerImageBatchSize,readerStoryboardBatchSize,readerMaxAutomaticRepairs} from './reader-limits.ts';
import {newReview,reviewReportSchema,repairOutputSchema,pendingRepairs,storyReplanMessage} from './reader-review.ts';
import {syncRevisionImages} from './reader-revision.ts';
import type {ReviewIssue,ReviewReport,RepairedPage} from './reader-review.ts';
export type Generated<T>={value:T;model:string;requestId:string|null;usage:unknown;reasoningEffort?:string};
export interface StoryGenerator{recommendArt?(selection:Selection,original:OriginalSource):Promise<ArtRecommendation>;prepareOriginal?(selection:Selection,id:string):Promise<OriginalSource|null>;recommend?(selection:Selection,id:string,original:OriginalSource):Promise<Generated<FrameRecommendation>>;outline?(selection:Selection,id:string,original?:OriginalSource):Promise<Generated<StoryboardOutline>>;planBatch?(selection:Selection,id:string,storyboard:Storyboard,original:OriginalSource):Promise<Generated<Plan['pages']>>;review?(selection:Selection,plan:Plan,original:OriginalSource,outline?:StoryboardOutline,candidates?:ReflectionCandidates):Promise<Generated<ReviewReport>>;repair?(selection:Selection,plan:Plan,original:OriginalSource,issues:ReviewIssue[],outline?:StoryboardOutline):Promise<Generated<RepairedPage[]>>;reflectionCandidates(selection:Selection,draft:StoryDraft,original:OriginalSource):Promise<Generated<StoryPresentation>>;reflection(selection:Selection,draft:StoryDraft,original:OriginalSource,revision?:{reflection:string;issues:ReviewIssue[]}):Promise<Generated<string>>;plan(selection:Selection,id:string,original?:OriginalSource):Promise<Generated<StoryDraft>>;original(selection:Selection,plan:SourceHint,id:string):Promise<SourceResult>;image(plan:Plan,page:number,id:string,reference:string,style?:ArtStyleId,productionPrompt?:string,artifactId?:string):Promise<Generated<string>>;audio(caption:string,id:string,page:number):Promise<Generated<string>>;safeError(error:unknown):string;}

async function drawRequestedImages(repo:ReaderRepository,generator:StoryGenerator,row:SessionRow,token:string,doc:Document,selection:Selection,throughPage:number){
 const pages=doc.plan!.pages.map((_,page)=>page).filter(page=>page<=throughPage&&!doc.images[page]);
 // A new story establishes its reference alone; later requests may draw three missing scenes.
 const batch=pages.slice(0,doc.images[0]?readerImageBatchSize:1);
 const reference=doc.images[0]||'';
 let writes=Promise.resolve();
 const drawing=batch.map(async page=>{
  const image=await generator.image(doc.plan!,page,row.id,reference,selection.artStyle,selection.productionPrompt);
  doc.images[page]=image.value;
  doc.usage.push({step:`image:${page}`,model:image.model,requestId:image.requestId,usage:image.usage});
  // Queue immutable snapshots; once a write fails, skip later writes until final recovery.
  const snapshot=structuredClone(doc);
  writes=writes.then(()=>repo.saveImageProgress(row,token,snapshot));
  await writes;
 });
 const outcomes=await Promise.allSettled(drawing);
 for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
}

export async function advanceStory(repo:ReaderRepository,generator:StoryGenerator,uid:string,id:string,throughPage:number,retry=false,onAcquired?:(token:string)=>void,onFailed?:(error:unknown)=>void){
 let row=await repo.get(id,uid);
 if(row.generation_control&&row.generation_control!=='active')return view(row);
 if(row.state==='running'){if(row.lock_until>Date.now())return view(row);row=await repo.stale(row);}
 if(row.state==='failed'&&!retry)return view(row);
 const selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document;
 const step=nextStep(doc,selection,throughPage);if(!step||step.kind==='discover')return view(row);
 const token=await repo.acquire(row,step);if(!token)return view(await repo.get(id,uid));
 onAcquired?.(token);
 try{
  let generated:Generated<unknown>|undefined;
  // Both explicit preparation and the legacy planning fallback save the same verified checkpoint.
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
   const chosen=doc.intake?.selected,candidate=chosen?doc.intake!.batches[chosen.batch]?.stories[chosen.index]:undefined;
   // Candidate guidance or an explicit placeholder stays bound to the saved original until checked.
   const pendingBrief=candidate?.storyBrief||{summary:candidate?.description||doc.storyboard?.outline.summary||'尚未准备完整摘要，请依据已核原文生成。',matchReason:storyEditorialContext(selection.theme).mode==='source'?'直接选择原典故事，须按原文补齐完整主线，不额外套主题。':'已选中此故事，须对照原文确认具体主题依据并补齐完整主线。'};
   if(!doc.original.storyBrief){
    doc.original.storyBrief={...storyBriefSchema.parse(pendingBrief),verified:false};
    await repo.saveImageProgress(row,ownedToken,structuredClone(doc));
   }
   if(candidate?.source&&!candidate.artRecommendation&&generator.recommendArt){
    const recommendation=artRecommendationSchema.parse(await generator.recommendArt(selection,doc.original));
    await repo.saveArtRecommendation(row,ownedToken,doc,recommendation);
    candidate.artRecommendation=recommendation;
   }
   if(!generator.recommend)throw new ReaderError(503,'生成服务暂不支持画幅建议，请更新服务后重试。');
   const result=await generator.recommend(selection,id,doc.original),recommendation=frameRecommendationOutputSchema(doc.original).parse(result.value);
   if(doc.original.storyBrief)doc.original.storyBrief={summary:recommendation.storySummary!,matchReason:recommendation.storyMatchReason!,verified:true};
   doc.frameRecommendation=recommendation;return result;
  }
  if(step.kind==='recommend'){generated=await prepareRecommendation(token);if(doc.intake&&doc.intake.phase!=='confirmed')doc.intake.phase='confirming';}
  else if(step.kind==='plan'){
   if(doc.original?.storyBrief&&!storyBriefVerified(doc.original)||!storyBriefVerified(doc.original)&&!doc.storyboard?.outline.summary?.trim()){
    const result=await prepareRecommendation(token);
    doc.usage.push({step:'summary',model:result.model,requestId:result.requestId,usage:result.usage,...(result.reasoningEffort?{reasoningEffort:result.reasoningEffort}:{})});
    await repo.saveImageProgress(row,token,structuredClone(doc));
   }
   if(generator.prepareOriginal&&!doc.original){
    const original=await generator.prepareOriginal(selection,id);
    if(original){doc.original=structuredClone(original);await repo.saveImageProgress(row,token,structuredClone(doc));}
   }
   if(doc.storyboard||generator.outline&&generator.planBatch&&(selection.length==='auto'||selection.length>readerStoryboardBatchSize)){
    if(!doc.storyboard){
     if(!generator.outline)throw Error('STORYBOARD_UNAVAILABLE');
     const result=await generator.outline(selection,id,doc.original),outline=storyboardOutlineSchema.parse(result.value);
     if(storyBriefVerified(doc.original))outline.summary=doc.original!.storyBrief!.summary;
     if(selection.length!=='auto'&&outline.beats.length!==selection.length)throw Error('PLAN_LENGTH');
     doc.storyboard={outline,pages:[]};generated=result;
    }else{
     if(!doc.original)throw new ReaderError(503,'原文尚未核对，暂时无法细化分镜。');
     if(!generator.planBatch)throw Error('STORYBOARD_UNAVAILABLE');
     const draft=doc.storyboard,count=Math.min(readerStoryboardBatchSize,draft.outline.beats.length-draft.pages.length);
     if(storyBriefVerified(doc.original))draft.outline.summary=doc.original!.storyBrief!.summary;
     const result=await generator.planBatch(selection,id,structuredClone(draft),doc.original);
     const pages=[...draft.pages,...storyboardBatchSchema(count).parse({pages:result.value}).pages];
     const plan=pages.length===draft.outline.beats.length?storyDraftSchema.parse({...draft.outline,pages}):null;
     doc.storyboard={outline:draft.outline,pages};if(plan)doc.draft=plan;generated=result;
    }
   }else{
    const result=await generator.plan(selection,id,doc.original);if(selection.length!=='auto'&&result.value.pages.length!==selection.length)throw Error('PLAN_LENGTH');
    doc.draft=storyDraftSchema.parse(result.value);if(storyBriefVerified(doc.original))doc.draft.summary=doc.original!.storyBrief!.summary;generated=result;
   }
  }
  else if(step.kind==='reflection'){
   if(!generator.review)throw new ReaderError(503,'生成服务暂不支持结语择优，请更新服务后重试。');
   const result=await generator.reflectionCandidates(selection,structuredClone(doc.draft!),doc.original!);
   const {title,candidates}=storyPresentationSchema.parse(result.value);
   doc.plan=planSchema.parse({...doc.draft,title,reflection:candidates[0]});doc.reflectionCandidates=candidates;delete doc.draft;generated=result;
  }
  else if(step.kind==='source'){/* Resume original retrieval without paying to re-plan. */}
  else if(step.kind==='review'){
   const review=doc.visualReview!;
   if(review.status==='blocked'){
    // Only an explicit retry can reach a blocked session; reuse the saved issues without a new audit.
    if(review.stopReason==='replan')throw new ReaderError(409,storyReplanMessage);
    if(!retry)throw new ReaderError(409,'分镜审片尚未通过，请手动继续修订。');
    // Give the continuation its own generation so the later recheck cannot reuse this receipt.
    const partial=review.stopReason==='unchanged';review.round++;review.status='repair';review.repairs=0;if(!partial)review.repaired=[];delete review.stopReason;
   }else{
    if(!generator.review)throw new ReaderError(503,'生成服务暂不支持分镜审片，请更新服务后重试。');
    const candidates=doc.reflectionCandidates?reflectionCandidatesSchema.parse(doc.reflectionCandidates):undefined;
    const result=await generator.review(selection,structuredClone(doc.plan!),doc.original!,doc.storyboard?.outline,candidates);
    const report=reviewReportSchema(doc.plan!.pages.length,candidates).parse(result.value);
    const previousTitle=doc.plan!.title;doc.plan={...doc.plan!,title:report.titleReview.title};
    if(candidates&&report.reflectionChoice){doc.plan={...doc.plan!,reflection:candidates[report.reflectionChoice.index-1]};delete doc.reflectionCandidates;}
    review.reports.push({round:review.round,issues:report.issues,titleReview:{...report.titleReview,previousTitle},...(candidates&&report.reflectionChoice?{reflectionChoice:{...report.reflectionChoice,candidates}}:{})});review.round++;review.issues=report.issues;review.repaired=[];
    const replan=report.issues.some(issue=>issue.requiresReplan);
    review.status=!report.issues.length?'passed':replan||review.repairs>=readerMaxAutomaticRepairs?'blocked':'repair';if(review.status==='blocked')review.stopReason=replan?'replan':'limit';else delete review.stopReason;generated=result;
   }
  }
  else if(step.kind==='repair'){
   const review=doc.visualReview!,requested=pendingRepairs(review),issues=review.issues.filter(issue=>requested.includes(issue.page));
   if(requested[0]===0){
    const result=await generator.reflection(selection,structuredClone(doc.plan!),doc.original!,{reflection:doc.plan!.reflection,issues});
    const reflection=planSchema.shape.reflection.parse(result.value),changed=reflection!==doc.plan!.reflection;
    (review.history??=[]).push({round:review.round,requested,changes:[],...(changed?{reflection}:{})});
    if(!changed){review.status='blocked';review.stopReason='unchanged';}
    else{doc.plan={...doc.plan!,reflection};review.repaired.push(0);review.status='pending';review.repairs++;}
    generated=result;
   }else{
    if(!generator.repair)throw new ReaderError(503,'生成服务暂不支持分镜修订，请更新服务后重试。');
    const result=await generator.repair(selection,structuredClone(doc.plan!),doc.original!,issues,doc.storyboard?.outline);
    const pages=repairOutputSchema(requested).parse({pages:result.value}).pages,updated=structuredClone(doc.plan!);
    const changed=pages.filter(({page,caption,prompt})=>caption!==doc.plan!.pages[page-1].caption||prompt!==doc.plan!.pages[page-1].prompt);
    (review.history??=[]).push({round:review.round,requested:[...requested],changes:structuredClone(changed)});
    for(const {page,caption,prompt} of pages)updated.pages[page-1]={caption,prompt};
    doc.plan=planSchema.parse(updated);if(doc.storyboard)doc.storyboard.pages=structuredClone(doc.plan.pages);
    if(!changed.length){review.status='blocked';review.stopReason='unchanged';}else{review.repaired.push(...requested);if(!pendingRepairs(review).length){review.status='pending';review.repairs++;}}generated=result;
   }
  }
  else if(step.kind==='image')await drawRequestedImages(repo,generator,row,token,doc,selection,throughPage);
  else{const result=await generator.audio(doc.plan!.pages[step.page].caption,id,step.page);doc.audio[step.page]=result.value;generated=result;}
  if((step.kind==='plan'||step.kind==='reflection'||step.kind==='repair')&&doc.plan)syncRevisionImages(doc,selection);
  if(generated)doc.usage.push({step:step.key,model:generated.model,requestId:generated.requestId,usage:generated.usage,...(generated.reasoningEffort?{reasoningEffort:generated.reasoningEffort}:{})});
  if((step.kind==='plan'||step.kind==='reflection')&&doc.plan&&!doc.visualReview&&(doc.reflectionCandidates||generator.review&&generator.repair))doc.visualReview=newReview();
  if((step.kind==='plan'||step.kind==='source')&&!doc.original){
   // URL-backed legacy sessions first resolve a real citation through provider URL context.
   // Save that paid directory before source lookup so a source outage cannot replay inference.
   if(doc.storyboard)await repo.saveImageProgress(row,token,structuredClone(doc));
   const result=await generator.original(selection,doc.plan||doc.draft||doc.storyboard!.outline,id);
   if(!result.source)throw new ReaderError(503,'原文未能保存。'+result.message+' 故事编排已保留，可重试补全原文。');
   doc.original=result.source;
  }
  if(doc.visualReview?.status==='blocked'){
   if(doc.visualReview.stopReason==='replan')throw new ReaderError(422,storyReplanMessage+' '+doc.visualReview.issues.filter(issue=>issue.requiresReplan).map(issue=>issue.problem).join('；'));
   const issues=blockedIssues(doc.visualReview),summary=issues.slice(0,3).map(issue=>`${issue.category==='reflection'?'结语':`第 ${issue.page} 幅`}：${issue.problem}`).join('；');
   throw new ReaderError(422,`${doc.visualReview.stopReason==='unchanged'?'修订没有产生实际变化':`已自动修复 ${readerMaxAutomaticRepairs} 轮，复核未通过`}，仍有 ${issues.length} 处问题，已停止绘图。${summary}。可手动继续修订。`);
  }
  return view(await repo.save(row,token,doc,productionComplete(doc,selection)));
 }catch(error){if(error instanceof ReaderError&&error.status===404||persistenceError(error))throw error;onFailed?.(error);return view(await repo.save(row,token,doc,false,error instanceof ReaderError?error.message:generator.safeError(error)));}
}
