// Recommend from already-read story content; preserve manual choices on reselect
// and accept old cached candidates without inventing a recommendation.
import {promptSections,inputBoundaryDirection} from './reader-prompts.ts';
import {localSourceKey} from './reader-source-key.ts';
import {z} from 'zod';
import {artStyleIds,artStyles} from './reader-styles.ts';
import type {Selection} from './reader-model.ts';
import type {LocalSourceReference} from './reader-local-contract.ts';
import type {OriginalSource} from './reader-source-types.ts';

export const artRecommendationSchema=z.object({artStyle:z.enum(artStyleIds),reason:z.string().trim().min(1).max(120)});
export type ArtRecommendation=z.infer<typeof artRecommendationSchema>;
export const artRecommendationJson={type:'object',properties:{artStyle:{type:'string',enum:[...artStyleIds]},reason:{type:'string',minLength:1,maxLength:120}},required:['artStyle','reason'],additionalProperties:false};
const artSelectionDirection='依据已读到的具体故事内容，从已有画风中选择最适合本篇情绪、关键动作、人物关系或场景的一项，不按书名或题材机械分类，不受读者上次选择影响，不一律选彩铅国漫，也不为凑不同画风强行分散。reason 用一句不剧透的简体中文说明适合本篇的理由，最多120字。这里只推荐，不生成图片。';
const availableArtStyles=artStyles.map(style=>`${style.id}（${style.label}：${style.description}）`).join('；')+'。';
export const artRecommendationInstructions=promptSections(['每篇画风','每个故事同时返回 artRecommendation:{artStyle,reason}。'+artSelectionDirection],['可选画风',availableArtStyles]);
export const selectedArtRecommendationPrompt=promptSections(['任务','为读者已选中的一篇故事推荐画风，以 verifiedOriginal 的已核对原文为依据，只返回顶层 artStyle 和 reason，不生成故事、分镜或图片。'],['选择标准',artSelectionDirection],['可选画风',availableArtStyles],['输入与输出',inputBoundaryDirection]);

export function selectedArtRecommendationPayload(selection:Selection,original:OriginalSource){return {chosenStory:selection.storyTitle,theme:selection.theme,verifiedOriginal:{title:original.title,text:original.text}};}
type Candidate={title:string;source?:LocalSourceReference;artRecommendation?:z.infer<typeof artRecommendationSchema>};
export function storyCandidateKey(story:Candidate){return JSON.stringify([story.title,story.source?localSourceKey(story.source):null]);}
export function isSelectedStory(selection:Selection,story:Candidate){return selection.storyTitle===story.title&&(selection.source&&story.source?localSourceKey(selection.source)===localSourceKey(story.source):selection.source===story.source);}
export function selectSuggestedStory(selection:Selection,story:Candidate):Selection{
 const sameStory=isSelectedStory(selection,story);
 return {...selection,storyTitle:story.title,source:story.source,artStyle:sameStory?selection.artStyle:story.artRecommendation?.artStyle||selection.artStyle};
}
