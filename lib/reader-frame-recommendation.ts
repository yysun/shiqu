// Recommend pacing from a saved original before committing to a storyboard or images.
import {storyRequirementsSchema,storyRequirementsJson,storyRequirementsDirection} from './reader-requirements.ts';
import {promptSections,inputBoundaryDirection,normalizeProductionPrompt,storyScopeDirection,storyOpeningDirection,storyEditorialContext} from './reader-prompts.ts';
import {z} from 'zod';
import {artRecommendationSchema,artRecommendationJson} from './reader-art-recommendation.ts';
import {localStoryContextConstraint} from './reader-local-contract.ts';
import {readerMinFrames,readerMaxFrames} from './reader-limits.ts';
import type {Selection} from './reader-model.ts';
import {verifiedOriginalPayload} from './reader-source-types.ts';
import type {OriginalSource} from './reader-source-types.ts';
import {storySummarySchema,storyBriefPayload,storySummaryDirection} from './reader-story-brief.ts';
export const narrativeDetailSchema=z.enum(['brief','balanced','detailed']);
export type NarrativeDetail=z.infer<typeof narrativeDetailSchema>;
export const narrativeDetails=[
 {id:'brief',label:'简短',description:'紧扣主线，合并次要细节'},
 {id:'balanced',label:'适中',description:'讲清因果，保留关键转折'},
 {id:'detailed',label:'详细',description:'展开动作、细节与停顿'},
] as const;
export const frameRecommendationSchema=z.object({count:z.number().int().min(readerMinFrames).max(readerMaxFrames),reason:z.string().trim().min(1).max(180),requirements:storyRequirementsSchema.optional(),storySummary:storySummarySchema.optional(),storyTitle:z.string().trim().min(1).max(100).optional(),artRecommendation:artRecommendationSchema.optional(),storyMatchReason:z.string().trim().min(1).max(300).optional()});
export type FrameRecommendation=z.infer<typeof frameRecommendationSchema>;
export const frameRecommendationJson={type:'object',properties:{count:{type:'integer',minimum:readerMinFrames,maximum:readerMaxFrames},reason:{type:'string',minLength:1,maxLength:180}},required:['count','reason'],additionalProperties:false};
export function preparesSelectedStory(selection:Selection,original:OriginalSource){
 return !!original.storyBrief&&(selection.discovery?.mode==='auto'&&selection.discovery.combine===true||
  !!selection.source&&!selection.discovery&&!selection.discoverySources?.length);
}
export function frameRecommendationOutputSchema(original:OriginalSource,prepareRequirements=false,selectedStory=false){
 const base=original.storyBrief?frameRecommendationSchema.extend({storySummary:storySummarySchema,storyMatchReason:z.string().trim().min(1).max(300)}):frameRecommendationSchema;
 const schema=selectedStory?base.extend({storyTitle:frameRecommendationSchema.shape.storyTitle.unwrap(),artRecommendation:artRecommendationSchema}):base;
 return prepareRequirements?schema.extend({requirements:storyRequirementsSchema}):schema;
}
export function frameRecommendationOutputJson(original:OriginalSource,prepareRequirements=false,selectedStory=false){
 const base=original.storyBrief?{...frameRecommendationJson,properties:{...frameRecommendationJson.properties,storySummary:{type:'string',minLength:1,maxLength:1200},storyMatchReason:{type:'string',minLength:1,maxLength:300}},required:[...frameRecommendationJson.required,'storySummary','storyMatchReason']}:frameRecommendationJson;
 const schema=selectedStory?{...base,properties:{...base.properties,storyTitle:{type:'string',minLength:1,maxLength:100},artRecommendation:artRecommendationJson},required:[...base.required,'storyTitle','artRecommendation']}:base;
 return prepareRequirements?{...schema,properties:{...schema.properties,requirements:storyRequirementsJson},required:[...schema.required,'requirements']}:schema;
}
export const narrativeDetailInstructions='叙事详略（narrativeDetail）决定展开程度，不是固定幅数：brief（简短）紧扣主线、合并次要细节但保留关键因果与转折；balanced（适中）完整讲清因果与关键转折；detailed（详细）展开必要动作、人物反应、环境细节与停顿。不得把三档绑定固定数量，也不为拉长篇幅重复画面。未提供时按适中处理。自动模式下，制作要求中的具体幅数仅作偏好，不把它当作不可增减的目标。';
export const frameRecommendationPrompt=promptSections(
 ['任务','你是古典连环画编剧。完整阅读 verifiedOriginal.text 和存在时的 chapterContext.text，结合叙事详略及制作要求，必要时校准输入摘要，再推荐完整改编需要的画幅数；不生成分镜、配文或图片。count 只计算故事画幅，独立结束页不计入幅数。'],
 ['主事件与开场',storyScopeDirection+'\n'+storyOpeningDirection],
 ['摘要篇幅',storySummaryDirection],
 ['摘要核对','输入存在 storyBrief 时，先逐项对照原文/章节上下文核对拟改编摘要和匹配理由的人物、行动、因果、范围与结局，纠正无据的动机、误读、遗漏及截早，再据完整主线估算幅数。摘要必须交代实际行动、推进、变化和最终结果，不能停在计策目的、设局介绍或“打算做什么”；原作开放结尾保留其真实停点。额外返回 storySummary（核对后的完整摘要，最多1200字）和 storyMatchReason（按原文校准的匹配理由，最多300字）；无冲突则保留准确原意。匹配理由不能重新引入已被原文否定的事实。不存在 storyBrief 时只返回 count/reason，不另造摘要。'],
 ['选题与估算','主题仅用于核对匹配理由是否有原文依据；原典模式不额外套主题。sourcesConfirmed 为 true 时，读者已经确认选材，按原文准备故事，不重新判断选材是否符合主题。幅数依据原文中的关键言行、回应与因果估算，不按摘要句子或字数分幅；核对摘要保存后供审核检查完整性。'],
 ['准备已选故事','sourcesConfirmed 为 true 时，同时返回准确的标题 storyTitle、完整梗概、画幅数和 artRecommendation（画风及简短理由）。已有标题准确且贴合原文时可沿用。'],
 ['多段原文','combineSelectedOriginals 为 true 时，梗概覆盖全部已选原文的关键事件及结局。彼此独立的事件可并列或用框架串联，不虚构事件之间的因果和人物关系。'],
 ['展开程度',narrativeDetailInstructions],
 ['数量性质','count是编排前的估计，不是固定目标；后续提纲与审核可按原文和所选详略增减，不让读者替编剧手定数量。'],
 ['估算标准',`先辨认关键事件、因果、转折、动作、人物反应与有价值的停顿，再决定 ${readerMinFrames} 至 ${readerMaxFrames} 的整数。不预设常见数量区间，不按字数线性折算；短故事可很少，复杂故事给足关键戏，不省略转折，也不为拉长重复画面。`],
 ['来源边界','只依据已核原文；识别注释与版式标记，不将其当正文，不猜补缺文或未知字。'+localStoryContextConstraint],
 ['输出','按给定schema返回 count 及一句不剧透的简体中文 reason，说明为什么适合本篇和所选详略，最多180字；有 storyBrief 时还必须返回核对后的 storySummary 和 storyMatchReason。'],
 ['本篇制作与验收建议',storyRequirementsDirection],['输入边界',inputBoundaryDirection]);

export function frameRecommendationPayload(selection:Selection,original:OriginalSource,prepareRequirements=false){return {chosenStory:selection.storyTitle==='待拟标题'?undefined:selection.storyTitle,...(preparesSelectedStory(selection,original)?{sourcesConfirmed:true}:{}),...(selection.discovery?.mode==='auto'&&selection.discovery.combine?{combineSelectedOriginals:true}:{}),editorialContext:storyEditorialContext(selection.theme),...storyBriefPayload(original,true),narrativeDetail:selection.narrativeDetail||'balanced',...(prepareRequirements?{prepareRequirements:true}:{}),productionPrompt:normalizeProductionPrompt(selection.productionPrompt||'',selection.theme),verifiedOriginal:verifiedOriginalPayload(original)};}
