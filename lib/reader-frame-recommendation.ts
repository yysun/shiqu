// Recommend pacing from a saved original before committing to a storyboard or images.
import {promptSections,inputBoundaryDirection,normalizeProductionPrompt,storyScopeDirection,storyOpeningDirection} from './reader-prompts.ts';
import {z} from 'zod';
import {localStoryContextConstraint} from './reader-local-contract.ts';
import {readerMinFrames,readerMaxFrames} from './reader-limits.ts';
import type {Selection} from './reader-model.ts';
import {verifiedOriginalPayload} from './reader-source-types.ts';
import type {OriginalSource} from './reader-source-types.ts';
export const narrativeDetailSchema=z.enum(['brief','balanced','detailed']);
export type NarrativeDetail=z.infer<typeof narrativeDetailSchema>;
export const narrativeDetails=[
 {id:'brief',label:'简短',description:'紧扣主线，合并次要细节'},
 {id:'balanced',label:'适中',description:'讲清因果，保留关键转折'},
 {id:'detailed',label:'详细',description:'展开动作、细节与停顿'},
] as const;
export const frameRecommendationSchema=z.object({count:z.number().int().min(readerMinFrames).max(readerMaxFrames),reason:z.string().trim().min(1).max(180)});
export type FrameRecommendation=z.infer<typeof frameRecommendationSchema>;
export const frameRecommendationJson={type:'object',properties:{count:{type:'integer',minimum:readerMinFrames,maximum:readerMaxFrames},reason:{type:'string',minLength:1,maxLength:180}},required:['count','reason'],additionalProperties:false};
export const narrativeDetailInstructions='叙事详略（narrativeDetail）决定展开程度，不是固定幅数：brief（简短）紧扣主线、合并次要细节但保留关键因果与转折；balanced（适中）完整讲清因果与关键转折；detailed（详细）展开必要动作、人物反应、环境细节与停顿。不得把三档绑定固定数量，也不为拉长篇幅重复画面。未提供时按适中处理。';
export const frameRecommendationPrompt=promptSections(
 ['任务','你是古典连环画编剧。完整阅读 verifiedOriginal.text 和存在时的 chapterContext.text，结合叙事详略及制作要求，推荐完整改编需要的画幅数；只建议数量，不生成分镜、配文或图片。count 只计算故事画幅，独立结束页不计入幅数。'],
 ['主事件与开场',storyScopeDirection+'\n'+storyOpeningDirection],
 ['展开程度',narrativeDetailInstructions],
 ['估算标准',`先辨认关键事件、因果、转折、动作、人物反应与有价值的停顿，再决定 ${readerMinFrames} 至 ${readerMaxFrames} 的整数。不预设常见数量区间，不按字数线性折算；短故事可很少，复杂故事给足关键戏，不省略转折，也不为拉长重复画面。`],
 ['来源边界','只依据已核原文；识别注释与版式标记，不将其当正文，不猜补缺文或未知字。'+localStoryContextConstraint],
 ['输出','返回 count 及一句不剧透的简体中文 reason，说明为什么适合本篇和所选详略，最多180字。'],
 ['输入边界',inputBoundaryDirection]);

export function frameRecommendationPayload(selection:Selection,original:OriginalSource){return {chosenStory:selection.storyTitle,narrativeDetail:selection.narrativeDetail||'balanced',productionPrompt:normalizeProductionPrompt(selection.productionPrompt||'',selection.theme),verifiedOriginal:verifiedOriginalPayload(original)};}
