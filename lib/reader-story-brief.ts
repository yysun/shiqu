// Prepare and audit a verified synopsis; production reads originals without synopsis metadata.
import {z} from 'zod';
import type {OriginalSource} from './reader-source-types.ts';
import type {Document} from './reader-model.ts';
export const storySummaryDirection='简短完整摘要：优先用2–3句，尽量80–150字，交代起因、关键行动和实际结果；简单故事不凑字，复杂故事仅为保留关键因果适当加长。不逐段复述，不停在开局、计谋目的或“打算做什么”，开放结尾保留原文真实停点。';
export const storySummarySchema=z.string().trim().min(1).max(1200);
export const storySummaryScopeDirection='productionPrompt 明确圈定改编起点、终点或主事件时，梗概以该范围为准。重新从已核原文提炼范围内的因果与收束；章节上下文可用于核对，摘要不续述范围外的事件。旧摘要只作线索，若范围不符就重写。';
export const combinedOriginalsSummaryDirection='combineSelectedOriginals 为 true 且读者未进一步限定范围时，梗概覆盖全部已选原文的关键事件及结局。彼此独立的事件可并列或用框架串联，不虚构事件之间的因果和人物关系。';
export const storyBriefSchema=z.object({summary:storySummarySchema,matchReason:z.string().trim().min(1).max(300)});
export type StoryBrief=z.infer<typeof storyBriefSchema>;
export type StoryBriefRecord=StoryBrief&{verified:boolean};
export const pendingStorySummary='尚未准备完整摘要，请依据已核原文生成。';
export function invalidateStoryBrief(doc:Document){
 if(doc.original)doc.original={...doc.original,storyBrief:{
  summary:pendingStorySummary,
  matchReason:doc.original.storyBrief?.matchReason||'读者已选定原文，按本篇制作要求核对故事范围。',
  verified:false,
 }};
 delete doc.frameRecommendation;
}
// 兼容旧版已重编分镜、但仍沿用上版梗概的修订。
export function storyBriefVerified(original:OriginalSource|undefined){return original?.storyBrief?.verified===true&&storyBriefSchema.safeParse(original.storyBrief).success;}
export function assertStoryBriefReady(original:OriginalSource|undefined){
 if(original?.storyBrief&&!storyBriefVerified(original))throw Error('STORY_BRIEF_UNVERIFIED');
}
export function withoutStorySummary<T extends {summary:string}>(story:T){const {summary:_,...rest}=story;void _;return rest;}
export function storyBriefPayload(original:OriginalSource|undefined,allowUnverified=false){
 if(!original?.storyBrief)return {};
 if(!allowUnverified)assertStoryBriefReady(original);
 return {storyBrief:storyBriefSchema.parse(original.storyBrief)};
}
