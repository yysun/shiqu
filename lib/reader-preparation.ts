// 准备调用与现有确认界面共用的输入和结果投影，不写书库、不派发任务。
import type {Document,Selection} from './reader-model.ts';
import type {OriginalSource} from './reader-source-types.ts';
import type {FrameRecommendation} from './reader-frame-recommendation.ts';
import {preparesSelectedStory} from './reader-frame-recommendation.ts';
import {pendingStorySummary,storyBriefSchema} from './reader-story-brief.ts';
import {normalizeProductionPrompt,storyEditorialContext} from './reader-prompts.ts';
import {suggestedSettings} from './reader-requirements.ts';

export function preparationPending(doc:Document){
 return doc.intake?.phase==='preparing';
}

export function preparationCandidate(doc:Document){
 const intake=doc.intake;
 if(!intake?.selected||intake.phase==='confirmed')return undefined;
 const {batch,index}=intake.selected;
 return intake.batches[batch]?.stories[index];
}

export function preparationOriginal(doc:Document,selection:Selection,original:OriginalSource):OriginalSource{
 if(original.storyBrief)return original;
 const candidate=preparationCandidate(doc),combining=selection.discovery?.mode==='auto'&&selection.discovery.combine;
 const description=selection.sourceCard?.description;
 const reason=combining?'读者已选定多段原文，按整理后的结构保留各段关键事实。'
  :description||storyEditorialContext(selection.theme).mode==='source'?'读者已直接选定原文，依据原文补齐完整主线。'
  :'已选中此故事，须对照原文确认具体主题依据并补齐完整主线。';
 const brief=candidate?.storyBrief||{summary:description||doc.storyboard?.outline.summary||pendingStorySummary,matchReason:candidate?.matchReason||reason};
 return {...original,storyBrief:{...storyBriefSchema.parse(brief),verified:false}};
}

export function preparationResult(doc:Document,selection:Selection,recommendation:FrameRecommendation){
 const candidate=preparationCandidate(doc),intake=doc.intake,original=doc.original!;
 if(intake&&candidate&&preparesSelectedStory(selection,original)){
  const art=candidate.artRecommendation||recommendation.artRecommendation!;
  recommendation={...recommendation,artRecommendation:art};
  candidate.title=selection.storyTitle=recommendation.storyTitle!;
  candidate.description=recommendation.storySummary!.slice(0,180);
  candidate.artRecommendation=art;
  if(!intake.manualArt)selection.artStyle=art.artStyle;
 }
 if(intake&&recommendation.requirements&&!doc.setupRequirements?.suggestions){
  doc.setupRequirements={...doc.setupRequirements,suggestions:recommendation.requirements};
  intake.draft??=suggestedSettings(selection,recommendation.requirements,doc.setupRequirements.overrides);
 }
 doc.original={...original,storyBrief:{summary:recommendation.storySummary!,matchReason:recommendation.storyMatchReason!,verified:true}};
 doc.summaryProductionPrompt=normalizeProductionPrompt(selection.productionPrompt,selection.theme);
 doc.frameRecommendation=recommendation;
 if(intake)intake.phase='confirming';
}
