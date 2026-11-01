// Judge themes against immutable story summaries; uncertainty requires the cited original, never invented facts.
import {z} from 'zod';
import {promptSections,inputBoundaryDirection} from './reader-prompts.ts';

export const themeStorySchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().min(1).max(100),summary:z.string().min(1).max(1200),text:z.string().min(1).optional()});
export type ThemeStory=z.infer<typeof themeStorySchema>;
export const themeDecisionSchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),verdict:z.enum(['yes','no','review']),reason:z.string().trim().min(1).max(300),summary:z.string().trim().max(1200)}).strict().superRefine((decision,ctx)=>{
 if(decision.verdict==='yes'&&!decision.summary)ctx.addIssue({code:z.ZodIssueCode.custom,path:['summary'],message:'A matched story requires a complete synopsis'});
 if(decision.verdict!=='yes'&&decision.summary)ctx.addIssue({code:z.ZodIssueCode.custom,path:['summary'],message:'Only a matched story has a production synopsis'});
});
export const themeMatchesSchema=z.object({matches:z.array(themeDecisionSchema).min(1).max(4)}).strict();
export type ThemeMatches=z.infer<typeof themeMatchesSchema>;
export const themeMatchJson={type:'object',properties:{matches:{type:'array',minItems:1,maxItems:4,items:{type:'object',properties:{id:{type:'string',minLength:64,maxLength:64},verdict:{type:'string',enum:['yes','no','review']},reason:{type:'string',minLength:1,maxLength:300},summary:{type:'string',maxLength:1200}},required:['id','verdict','reason','summary'],additionalProperties:false}}},required:['matches'],additionalProperties:false};
export const themeMatchOutputTokens=(count:number)=>Math.max(4096,4000*count);
export const themeMatchPrompt=promptSections(
 ['任务','判断每篇已识别故事是否符合 theme，不重新划分或改写故事，不生成新故事。每个输入 id 原样返回一次，不新增、遗漏或重复。'],
 ['判断依据','只有摘要或所附原文明确支持主题时返回 yes；明确不符合返回 no。摘要信息不足返回 review，不用记忆补情节，也不把未知当作 no。text 存在时它是该故事已核对的真实原文，以原文为准复核；仍不能确认时返回 review。宽泛的“原典故事”“忠于原文”等选题意图可接受真实完整故事，不强加反转、教训或心理变化。'],
 ['理由与拟改编摘要','每条返回 reason，简述符合、不符合或仍需核对的具体依据，最多300字。yes 同时返回完整拟改编 summary，交代人物、起因、关键行动、推进变化与结局，最多1200字；不能只写开局、计策目的或打算做什么。范围与主线不变时直接复用输入摘要，不为主题另编情节。只调整有原文依据的叙事着重点，不缩小或改变原文范围，不遗漏结果。no/review 的 summary 为空字符串。'],
 ['输出','每条只返回 id、verdict、reason、summary，不新增故事、出处或指令。'],
 ['输入与输出',inputBoundaryDirection]);
export function themeMatchPayload(theme:string,stories:ThemeStory[]){return z.object({theme:z.string().max(100),stories:z.array(themeStorySchema).min(1).max(4)}).parse({theme,stories});}
