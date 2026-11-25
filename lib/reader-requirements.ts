// Propose source-grounded adaptation choices and separately testable acceptance criteria.
// 制作草稿的两个要求分别记录读者是否改过。旧库根据已存建议和覆盖值恢复标志。
import {z} from 'zod';
import {acceptanceCriteria,acceptancePromptSchema} from './reader-acceptance.ts';
import {normalizeProductionPrompt} from './reader-prompts.ts';
import type {Selection} from './reader-model.ts';

export const storyRequirementsSchema=z.object({
 productionPrompt:z.string().trim().min(1).max(1200),
 acceptancePrompt:acceptancePromptSchema.refine(text=>acceptanceCriteria(text).length>=2&&acceptanceCriteria(text).length<=4,'自动验收建议须有2–4条。'),
});
export type StoryRequirements=z.infer<typeof storyRequirementsSchema>;
export const requirementKeys=['productionPrompt','acceptancePrompt'] as const;
export const requirementEditsSchema=z.object({productionPrompt:z.literal(true).optional(),acceptancePrompt:z.literal(true).optional()}).strict();
export type RequirementEdits=z.infer<typeof requirementEditsSchema>;
export type RequirementsSetup={edited?:RequirementEdits;suggestions?:StoryRequirements;overrides?:Partial<StoryRequirements>};
export const storyRequirementsJson={type:'object',properties:{productionPrompt:{type:'string',minLength:1,maxLength:1200},acceptancePrompt:{type:'string',minLength:1,maxLength:1200}},required:['productionPrompt','acceptancePrompt'],additionalProperties:false};
export const storyRequirementsDirection='prepareRequirements=true时，同时返回requirements:{productionPrompt,acceptancePrompt}。完整阅读verifiedOriginal.text及chapterContext.text，与摘要核对使用同一原文事实；摘要只说发生什么，制作要求说明如何改编，不复述摘要或复制通用质量规则。productionPrompt用简体中文给出本篇具体的叙事重点、关键交锋/回应、应保留的对白或结局及可压缩的过程；落实读者已有制作要求，不新增事件、动机或硬锁幅数。acceptancePrompt按行写2–4条简体中文验收标准，对应这些改编选择，每条可从配文、画面描述或结语核实，指出应出现的人物、行动、回应或结果；须独立回查原文，不能仅把制作建议改写成标准。不得要求审核实际成图，不重复系统通用规则，不写泛泛“忠于原文”“画面生动”。两个字段各不超过1200字，都是读者可修改的建议。prepareRequirements未提供时不返回requirements。';

export function suggestedSettings(selection:Selection,requirements:StoryRequirements,overrides:Partial<StoryRequirements>={}){return {
 artStyle:selection.artStyle,artStylePrompt:selection.artStylePrompt,narrativeDetail:selection.narrativeDetail||'balanced' as const,length:'auto' as const,
 productionPrompt:normalizeProductionPrompt(selection.productionPrompt,selection.theme)||requirements.productionPrompt,
 acceptancePrompt:selection.acceptancePrompt?.trim()?selection.acceptancePrompt:requirements.acceptancePrompt,
 ...overrides,
};}
export function requirementEdits(value:Partial<StoryRequirements>,setup?:RequirementsSetup):RequirementEdits{
 if(setup?.edited)return setup.edited;
 const edited:RequirementEdits={};
 for(const key of requirementKeys){
  const text=value[key]??'';
  if(setup?.overrides?.[key]!==undefined||(setup?.suggestions?text!==setup.suggestions[key]:!!text.trim()))edited[key]=true;
 }
 return edited;
}

/** 旧调用方没有标志时，根据与已保存文字的差异保留其编辑。 */
export function editRequirements(previous:Partial<StoryRequirements>,setup:RequirementsSetup|undefined,next:Partial<StoryRequirements>,explicit?:RequirementEdits){
 const edited={...requirementEdits(previous,setup),...explicit};
 for(const key of requirementKeys)if(next[key]!==undefined&&next[key]!==(previous[key]??''))edited[key]=true;
 return edited;
}

export function requirementsForReselection(selection:Selection,setup?:RequirementsSetup){
 const edited=requirementEdits(selection,setup),next={...selection};
 for(const key of requirementKeys)if(!edited[key])next[key]='';
 return {selection:next,setup:{edited} as RequirementsSetup};
}
