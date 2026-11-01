// Judge themes against immutable story summaries; uncertainty requires the cited original, never invented facts.
import {z} from 'zod';
import {promptSections,inputBoundaryDirection} from './reader-prompts.ts';

export const themeStorySchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().min(1).max(100),summary:z.string().min(1).max(1200),text:z.string().min(1).optional()});
export type ThemeStory=z.infer<typeof themeStorySchema>;
export const themeMatchesSchema=z.object({matches:z.array(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),verdict:z.enum(['yes','no','review'])}).strict()).min(1).max(16)}).strict();
export type ThemeMatches=z.infer<typeof themeMatchesSchema>;
export const themeMatchJson={type:'object',properties:{matches:{type:'array',minItems:1,maxItems:16,items:{type:'object',properties:{id:{type:'string',minLength:64,maxLength:64},verdict:{type:'string',enum:['yes','no','review']}},required:['id','verdict'],additionalProperties:false}}},required:['matches'],additionalProperties:false};
export const themeMatchPrompt=promptSections(
 ['任务','判断每篇已识别故事是否符合 theme，不重新划分或改写故事，不生成新故事。每个输入 id 原样返回一次，不新增、遗漏或重复。'],
 ['判断依据','只有摘要或所附原文明确支持主题时返回 yes；明确不符合返回 no。摘要信息不足返回 review，不用记忆补情节，也不把未知当作 no。text 存在时它是该故事已核对的真实原文，以原文为准复核；仍不能确认时返回 review。宽泛的“原典故事”“忠于原文”等选题意图可接受真实完整故事，不强加反转、教训或心理变化。'],
 ['输出','verdict 仅 yes、no、review；不输出解释、改写内容或出处。'],
 ['输入与输出',inputBoundaryDirection]);
export function themeMatchPayload(theme:string,stories:ThemeStory[]){return z.object({theme:z.string().max(100),stories:z.array(themeStorySchema).min(1).max(16)}).parse({theme,stories});}
