// Match complete cited originals in small batches; binary receipts never contain a synopsis.
import {z} from 'zod';
import {promptSections,inputBoundaryDirection,compoundDiscoveryThemeDirection} from './reader-prompts.ts';
export const themeMatchBatchSize=4;
export const themeMatchModel='gpt-6-luna';
export const themeMatchEffort='low' as const;
export const themeStorySchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().min(1).max(100),text:z.string().trim().min(1)}).strict();
export type ThemeStory=z.infer<typeof themeStorySchema>;
const matchScore=z.number().int().min(0).max(100).optional();
const matchScoreJson={type:'integer',minimum:0,maximum:100};
export const themeScoreDirection='matchScore 为 0 至 100 的整数，表示主题与故事情节的贴合度。90–100 表示主题构成主线且原文证据明确，75–89 表示充分符合，60–74 表示有依据但主题较次要或联系较隐含，1–59 表示只符合部分要素或证据不足，0 表示无关。符合的故事给 60–100 分，不符合给 0–59 分。';
function scoreFields(score:number|undefined,matched:boolean){
 return score!==undefined&&(score>=60)===matched?{matchScore:score}:{};
}
export const themeDecisionSchema=z.object({id:themeStorySchema.shape.id,verdict:z.enum(['yes','no']),reason:z.string().trim().min(1).max(120),matchScore}).strict();
export const themeMatchesSchema=z.object({matches:z.array(themeDecisionSchema).max(themeMatchBatchSize)}).strict();
export type ThemeMatches=z.infer<typeof themeMatchesSchema>;
export const themeMatchContract='original-binary-v1';
export const themeMatchJson={type:'object',properties:{matches:{type:'array',minItems:0,maxItems:themeMatchBatchSize,items:{type:'object',properties:{id:{type:'integer',minimum:1,maximum:4},reason:{type:'string',minLength:1,maxLength:120},verdict:{type:'string',enum:['yes','no']},matchScore:matchScoreJson},required:['id','reason','verdict','matchScore'],additionalProperties:false}}},required:['matches'],additionalProperties:false};
export const themeMatchOutputTokens=(_count:number)=>2048;
export const themeMatchPrompt=promptSections(
 ['任务','逐篇完整阅读所附text原文，判断是否符合theme，不重新划分或改写故事，不生成摘要。每个输入批内短编号id原样返回一次，不新增、遗漏或重复；各篇独立判断。'],
 ['原文依据','只依据本篇原文已有事件、行动、关系和结果判断，不用记忆补情节，不依靠标题猜主题。原文有明确依据支持主题返回yes，缺乏主题依据返回no；不要把普通争执自动等同于成长、和解或永久错过。宽泛的“原典故事”“忠于原文”等选题意图可接受真实完整故事，不额外强加寓意。'],
 ['复合主题',compoundDiscoveryThemeDirection],
 ['主题贴合度',themeScoreDirection],
 ['输出','只返回matches，每篇包含id、reason（一句具体原文依据，最多120字）、verdict(yes或no)和matchScore，先给依据再判定。不返回review、summary、故事重述或制作建议。'],
 ['输入与输出',inputBoundaryDirection]);
export function themeMatchPayload(theme:string,stories:ThemeStory[]){
 z.string().max(100).parse(theme);z.array(themeStorySchema).min(1).max(themeMatchBatchSize).parse(stories);
 return {stories:stories.map((story,index)=>({id:index+1,title:story.title,text:story.text})),theme};
}
// Keep individually valid receipts even when another entry is missing, duplicated, or malformed.
export function parseThemeMatches(value:unknown,stories:ThemeStory[]):ThemeMatches{
 const raw=z.object({matches:z.array(z.unknown()).max(32)}).parse(value),counts=new Map<unknown,number>();
 for(const item of raw.matches){const id=(item as {id?:unknown})?.id;counts.set(id,(counts.get(id)||0)+1);}
 const matches:ThemeMatches['matches']=[];
 for(const item of raw.matches){
  const parsed=themeDecisionSchema.extend({id:z.number().int().min(1).max(stories.length)}).safeParse(item);
  if(parsed.success&&counts.get(parsed.data.id)===1){
   const {id,matchScore,...decision}=parsed.data;
   matches.push({id:stories[id-1].id,...decision,...scoreFields(matchScore,decision.verdict==='yes')});
  }
 }
 return {matches};
}

export type ThemeMatchProtocol<T>={prompt:string;json:typeof themeMatchJson|typeof verifiedThemeJson;payload:(theme:string,stories:ThemeStory[])=>ReturnType<typeof themeMatchPayload>;parse:(value:unknown,stories:ThemeStory[])=>T;outputTokens:(count:number)=>number};
export const binaryThemeMatch={prompt:themeMatchPrompt,json:themeMatchJson,payload:themeMatchPayload,parse:parseThemeMatches,outputTokens:themeMatchOutputTokens};

export const verifiedThemeBatchSize=50;
const verdicts=['direct','implicit','no'] as const;
const verdictFields={verdict:z.enum(verdicts),reason:z.string().trim().min(1).max(95),evidence:z.array(z.string().trim().min(4).max(100)).max(3),matchScore};
export const verifiedThemeDecision=z.object({id:themeStorySchema.shape.id,...verdictFields}).strict();
export type VerifiedThemeDecision=z.infer<typeof verifiedThemeDecision>;
export type VerifiedThemeMatches={matches:VerifiedThemeDecision[]};
const verifiedThemeJson={type:'object',properties:{matches:{type:'array',minItems:0,maxItems:verifiedThemeBatchSize,items:{type:'object',properties:{id:{type:'integer',minimum:1,maximum:verifiedThemeBatchSize},verdict:{type:'string',enum:[...verdicts]},reason:{type:'string',minLength:1,maxLength:95},evidence:{type:'array',maxItems:3,items:{type:'string',minLength:4,maxLength:100}},matchScore:matchScoreJson},required:['id','verdict','reason','evidence','matchScore'],additionalProperties:false}}},required:['matches'],additionalProperties:false};
const verifiedThemePrompt=promptSections(
 ['任务','逐篇读完所附原文，按主题筛选故事。每个编号独立判断并恰好返回一次。标题只用于定位；判断须依据本篇原文。'],
 ['判定','原文明确记载符合主题的行动、关系或结果，判 direct。原文有具体情节支持但需要推断关键动机或联系，判 implicit。只有字词相近、普通冲突、宽泛报应或没有足够证据，判 no。判断动作、对象、因果和事实状态是否符合查询。'],
 ['复合主题',compoundDiscoveryThemeDirection],
 ['排除近似','先分清主题要求谁对谁做了什么、为何如此、是否发生。只发现前因、误会、指控、受害、查明真相、依法处置、后来自然遭祸，不能替代主题所要求的行为或动机。死者现身或索回物品也不能单独证明其在报复。隐含命中需要原文明示的行动与后果之间存在具体联系，单凭先后不够。'],
 ['证据','每条 direct 或 implicit 附一到三段同篇连续原文，每段四到一百字。第一段优先引用最能证明主题的行动、动机或结果，关键因果分散时补引相关原文。只引前情或受害经过不足以支持正向判断。保留古字和繁简原样，不改写，不用省略号拼接。reason 用一句话说明情节和判断，最多九十五字，不能新增所引原文和上下文都没有写出的行为或结果。no 的 evidence 可为空。'],
 ['主题贴合度',themeScoreDirection],
 ['输出','只返回 matches，每项为 id、verdict、reason、evidence 和 matchScore。'],
 ['输入与输出',inputBoundaryDirection]);
function verifiedThemePayload(theme:string,stories:ThemeStory[]){
 z.string().max(100).parse(theme);z.array(themeStorySchema).min(1).max(verifiedThemeBatchSize).parse(stories);
 return {stories:stories.map((story,index)=>({id:index+1,title:story.title,text:story.text})),theme};
}
function parseVerifiedThemeMatches(value:unknown,stories:ThemeStory[]):VerifiedThemeMatches{
 const raw=z.object({matches:z.array(z.unknown()).max(verifiedThemeBatchSize*2)}).parse(value);
 const counts=new Map<unknown,number>();
 for(const item of raw.matches){const id=(item as {id?:unknown})?.id;counts.set(id,(counts.get(id)||0)+1);}
 const row=z.object({id:z.number().int().min(1).max(stories.length),...verdictFields}).strict();
 return {matches:raw.matches.flatMap(item=>{
  const parsed=row.safeParse(item);
  if(!parsed.success||counts.get(parsed.data.id)!==1)return [];
  const {id,matchScore,...decision}=parsed.data;
  return [{id:stories[id-1].id,...decision,...scoreFields(matchScore,decision.verdict!=='no')}];
 })};
}
export const verifiedThemeMatch={prompt:verifiedThemePrompt,json:verifiedThemeJson,payload:verifiedThemePayload,parse:parseVerifiedThemeMatches,outputTokens:(count:number)=>Math.max(4096,count*240)};
