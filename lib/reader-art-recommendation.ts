// Recommend from already-read story content; preserve manual choices on reselect
// and accept old cached candidates without inventing a recommendation.
import {z} from 'zod';
import {artStyleIds,artStyles} from './reader-styles.ts';
import type {Selection} from './reader-model.ts';
import type {LocalSourceReference} from './reader-local-contract.ts';

export const artRecommendationSchema=z.object({artStyle:z.enum(artStyleIds),reason:z.string().trim().min(1).max(120)});
export type ArtRecommendation=z.infer<typeof artRecommendationSchema>;
export const artRecommendationJson={type:'object',properties:{artStyle:{type:'string',enum:[...artStyleIds]},reason:{type:'string',minLength:1,maxLength:120}},required:['artStyle','reason'],additionalProperties:false};
export const artRecommendationInstructions=`为每个故事同时返回 artRecommendation：artStyle 从以下已有画风中选一个，reason 用一句简体中文说明它如何适合本篇的情绪、关键动作、人物关系或场景，理由不剧透、不超过120字。依据已读到的具体故事内容判断，不按书名或题材机械分类，不受读者上一次画风影响，不一律选择彩铅国漫，也不为凑齐不同画风而强行分散。这里只推荐画风，不生成图片。可选画风：${artStyles.map(style=>`${style.id}（${style.label}：${style.description}）`).join('；')}。`;
type Candidate={title:string;source?:LocalSourceReference;artRecommendation?:z.infer<typeof artRecommendationSchema>};
export function selectSuggestedStory(selection:Selection,story:Candidate):Selection{
 const sameStory=selection.storyTitle===story.title&&(['edition','sectionId','firstUnit','lastUnit'] as const).every(key=>selection.source?.[key]===story.source?.[key]);
 return {...selection,storyTitle:story.title,source:story.source,artStyle:sameStory?selection.artStyle:story.artRecommendation?.artStyle||selection.artStyle};
}
