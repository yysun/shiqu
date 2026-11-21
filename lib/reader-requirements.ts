// Propose source-grounded adaptation choices and separately testable acceptance criteria.
// Saved suggestions identify automatic values on reselection; authored overrides remain intact.
import {z} from 'zod';
import {acceptanceCriteria,acceptancePromptSchema} from './reader-acceptance.ts';
import {normalizeProductionPrompt} from './reader-prompts.ts';
import type {Selection} from './reader-model.ts';

export const storyRequirementsSchema=z.object({
 productionPrompt:z.string().trim().min(1).max(1200),
 acceptancePrompt:acceptancePromptSchema.refine(text=>acceptanceCriteria(text).length>=2&&acceptanceCriteria(text).length<=4,'自动验收建议须有2–4条。'),
});
export type StoryRequirements=z.infer<typeof storyRequirementsSchema>;
export type RequirementsSetup={suggestions?:StoryRequirements;overrides?:Partial<StoryRequirements>};
export const storyRequirementsJson={type:'object',properties:{productionPrompt:{type:'string',minLength:1,maxLength:1200},acceptancePrompt:{type:'string',minLength:1,maxLength:1200}},required:['productionPrompt','acceptancePrompt'],additionalProperties:false};
export const storyRequirementsDirection='prepareRequirements=true时，同时返回requirements:{productionPrompt,acceptancePrompt}。完整阅读verifiedOriginal.text及chapterContext.text，与摘要核对使用同一原文事实；摘要只说发生什么，制作要求说明如何改编，不复述摘要或复制通用质量规则。productionPrompt用简体中文给出本篇具体的叙事重点、关键交锋/回应、应保留的对白或结局及可压缩的过程；落实读者已有制作要求，不新增事件、动机或硬锁幅数。acceptancePrompt按行写2–4条简体中文验收标准，对应这些改编选择，每条可从配文、画面描述或结语核实，指出应出现的人物、行动、回应或结果；须独立回查原文，不能仅把制作建议改写成标准。不得要求审核实际成图，不重复系统通用规则，不写泛泛“忠于原文”“画面生动”。两个字段各不超过1200字，都是读者可修改的建议。prepareRequirements未提供时不返回requirements。';

export function suggestedSettings(selection:Selection,requirements:StoryRequirements,overrides:Partial<StoryRequirements>={}){return {
 artStyle:selection.artStyle,artStylePrompt:selection.artStylePrompt,narrativeDetail:selection.narrativeDetail||'balanced' as const,length:'auto' as const,
 productionPrompt:normalizeProductionPrompt(selection.productionPrompt,selection.theme)||requirements.productionPrompt,
 acceptancePrompt:selection.acceptancePrompt?.trim()?selection.acceptancePrompt:requirements.acceptancePrompt,
 ...overrides,
};}
export function requirementsForReselection(selection:Selection,setup?:RequirementsSetup){
 const overrides={...setup?.overrides},next={...selection};
 for(const key of ['productionPrompt','acceptancePrompt'] as const){
  if(!setup?.suggestions){
   if(key in overrides)overrides[key]=selection[key]||'';
   continue;
  }
  if((selection[key]||'')===setup.suggestions[key]){next[key]='';delete overrides[key];}
  else overrides[key]=selection[key]||'';
 }
 return {selection:next,setup:{overrides} as RequirementsSetup};
}
