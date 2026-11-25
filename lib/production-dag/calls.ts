// 按调用契约实现的生成调用：每个方法只接收契约所列输入的类型化参数，提示词由这些参数拼装。
// 指令文字复用正式流程的标准（编排、配文、画面、审片、修订），不另写一套；载荷按契约各自构造，
// 例如叙事分镜与提纲不含画风，结语与幅数核对只读配文。叙事分镜与画面描述按批调用，每幅结果仍按本幅输入记录；审片丢弃允许清单外的判断。
import {z} from 'zod';
import type {Generated} from '../reader-engine.ts';
import type {OriginalSource} from '../reader-source-types.ts';
import {verifiedOriginalPayload} from '../reader-source-types.ts';
import type {ReasoningTask} from '../reader-reasoning.ts';
import type {ArtStyleId} from '../reader-styles.ts';
import {getArtDirection,getArtStyle} from '../reader-styles.ts';
import {promptSections,inputBoundaryDirection,storyOpeningDirection,storyboardDirection,storyEditorialContext,titleDirection} from '../reader-prompts.ts';
import {storyPlanningDirection,storySceneDirection,storyOutlineMetadataDirection,storyCharacterDirection,storyDraftMetadataDirection,storyCaptionDirection,storyVisualDirection,storyStyleBoundaryDirection,storyDraftJson,imagePromptFor} from '../reader-generation-contract.ts';
import {outlineDirection,batchDirection,reflectionSystemPrompt,reflectionCandidatesDirection,restyleInstructions} from '../reader-storyboard.ts';
import {frameCountReviewRequest,fullReviewRequest,parseFrameCountReport,reviewReportSchema,scopedReviewIssuesSchema,reviewNotesDirection,reviewSystemPrompt,type FrameCountContext,type FrameCountReport,type ReviewIssue} from '../reader-review.ts';
import {validateEditorialCoverage} from '../reader-editorial.ts';
import {combinedOriginalsSummaryDirection,storyBriefVerified,storySummaryDirection,storySummaryScopeDirection} from '../reader-story-brief.ts';
import {localPlanConstraint} from '../reader-local-contract.ts';
import {acceptanceCriteria,type AcceptanceResult} from '../reader-acceptance.ts';
import {readerMinFrames,readerMaxFrames,readerStoryboardBatchSize,readerRestyleBatchSize} from '../reader-limits.ts';
import type {CharacterEntry} from './frames.ts';
import {fingerprint} from './fingerprint.ts';

export type Call=(task:ReasoningTask,instructions:string,payload:unknown,schema:unknown,maxOutputTokens:number,original?:OriginalSource)=>Promise<Generated<unknown>>;

/** 已核原文与出处：原文、书名、选定故事与主题都属于来源，本身是原文核对的产物。 */
export type SourceInput={original:OriginalSource;book:string;chosenStory?:string;theme?:string;variationSeed:string};
export type StyleInput={artStyle:ArtStyleId;artStylePrompt?:string|null};
export type SettingsInput={narrativeDetail:string;length:number|'auto'};
export type Character=CharacterEntry&{text:string};
export type Outline={title:string;summary:string;sourceReference:string;adaptationNote:string;beats:string[]};
/** 叙事分镜保存本幅配文。 */
export type Scene={caption:string};
/** 画面描述与实际入画人物名字。 */
export type Visual={prompt:string;drawn:string[]};

const str=(min:number,max:number)=>({type:'string',minLength:min,maxLength:max});
const obj=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const names={type:'array',maxItems:16,items:str(1,40)};
const local=(source:SourceInput)=>source.original.localSource?localPlanConstraint:'';

function sourcePayload(source:SourceInput,{seed=false}={}){
 const theme=source.theme||'';
 return {book:source.book,chosenStory:source.chosenStory,...(source.chosenStory?{}:{theme}),editorialContext:storyEditorialContext(theme),...(seed?{variationSeed:source.variationSeed}:{}),verifiedOriginal:verifiedOriginalPayload(source.original)};
}
const characterId=(name:string)=>`c-${fingerprint(name).slice(0,10)}`;
const characterCard=(c:Character)=>({name:c.name,aliases:c.aliases||[],setting:c.text});
const withoutSummary=({summary:_,...rest}:Outline)=>{void _;return rest;};

const outlineSchema=z.object({title:z.string().min(1).max(40),summary:z.string().trim().min(1).max(1200),sourceReference:z.string().min(1).max(150),adaptationNote:z.string().min(1).max(600),beats:z.array(z.string().min(1).max(180)).min(readerMinFrames).max(readerMaxFrames)}).strict();
const captionSchema=z.string().min(8).max(90);
const promptSchema=z.string().min(20).max(1800);
/** 逐幅调用每批最多幅数，与叙事分镜批次一致；登记表 calls 的 batch 引用同一上限。 */
export const frameBatchSize=readerStoryboardBatchSize;
type VisualFrame={index:number;caption:string};
const cardDirection='characters 是全篇人物设定，用于辨认身份与外貌；drawn 只列出该幅画面中实际出现的人物名字。';
const frameBatchDirection='frames 每幅返回一条，number 与输入一致。每幅只依据该幅的输入，不写「同上」「承前幅」等依赖其他幅的说法；同批其他幅只作衔接参考。';
function checkBatch(frames:unknown[],limit=frameBatchSize){if(frames.length<1||frames.length>limit)throw Error('PLAN_LENGTH');}
const frameRef=(outline:Outline,f:{index:number})=>({number:f.index+1,beat:outline.beats[f.index]});
/** 按幅号取回批次结果：每幅恰好一条，顺序不限。 */
function byFrame<T extends {number:number}>(rows:T[],frames:{index:number}[]):T[]{
 const map=new Map(rows.map(r=>[r.number,r]));
 if(map.size!==frames.length||frames.some(f=>!map.has(f.index+1)))throw Error('INVALID_OUTPUT');
 return frames.map(f=>map.get(f.index+1)!);
}
const visualRows=(count:number,outline:Outline)=>obj({frames:{type:'array',minItems:count,maxItems:count,items:obj({number:{type:'integer',minimum:1,maximum:outline.beats.length},prompt:str(20,1800),drawn:names})}});
const visualTokens=(frames:unknown[])=>Math.max(4096,frames.length*1200);
function parseVisuals(value:unknown,frames:{index:number}[]):Visual[]{
 const rows=z.object({frames:z.array(z.object({number:z.number().int(),prompt:promptSchema,drawn:z.array(z.string().max(40)).max(16)}).strict()).length(frames.length)}).strict().parse(value).frames;
 return byFrame(rows,frames).map(r=>({prompt:r.prompt,drawn:r.drawn}));
}

export function dagGenerator(call:Call){
 return {
  /** 准备梗概：按读者指定的范围提炼已核原文。 */
  async prepareBrief(input:{source:SourceInput;productionPrompt:string}):Promise<Generated<string>>{
   const combined=(input.source.original.localParts?.length??0)>1;
   const instructions=promptSections(['任务','依据 verifiedOriginal 撰写本篇选定范围的事实梗概，只交代原文中的起因、关键行动与结果，不加评价，不补写原文没有的情节。'],['篇幅',storySummaryDirection],['本篇制作范围',storySummaryScopeDirection],['多段原文',combined?combinedOriginalsSummaryDirection:''],['本地原文',local(input.source)],['输入与输出',inputBoundaryDirection+'只返回 {summary}。']);
   const result=await call('frames',instructions,{...sourcePayload(input.source),productionPrompt:input.productionPrompt,...(combined?{combineSelectedOriginals:true}:{})},obj({summary:str(1,1200)}),4096,input.source.original);
   return {...result,value:z.object({summary:z.string().trim().min(1).max(1200)}).parse(result.value).summary};
  },

  /** 人物设定：只读原文与制作要求，不读提纲。 */
  async characters(input:{source:SourceInput;productionPrompt:string}):Promise<Generated<Character[]>>{
   const instructions=promptSections(['任务','你是古典连环画人物设定编辑。依据 verifiedOriginal 列出本篇有据出场的人物，每人一条。'],['人物标准',storyCharacterDirection],['本次输出','只返回 {characters:[{name,aliases,text}]}。name 用原文通行称谓，aliases 列出原文中的其他称呼；text 记录有据的时代、年龄、外貌、服饰、辨识特征及关键物件，不写画风或构图。'],['本地原文',local(input.source)],['输入与输出',inputBoundaryDirection]);
   const schema=obj({characters:{type:'array',minItems:1,maxItems:24,items:obj({name:str(1,40),aliases:names,text:str(10,600)})}});
   const result=await call('outline',instructions,{...sourcePayload(input.source),productionPrompt:input.productionPrompt},schema,8192,input.source.original);
   const parsed=z.object({characters:z.array(z.object({name:z.string().trim().min(1).max(40),aliases:z.array(z.string().trim().min(1).max(40)).max(16),text:z.string().trim().min(10).max(600)}).strict()).min(1).max(24)}).strict().parse(result.value);
   const seen=new Set<string>();
   const value=parsed.characters.filter(c=>!seen.has(c.name)&&seen.add(c.name)).map(c=>({id:characterId(c.name),name:c.name,aliases:c.aliases,text:c.text}));
   return {...result,value};
  },

  /** 全篇提纲：读原文、制作要求、详略与幅数策略；不读画风与人物设定。 */
  async outline(input:{source:SourceInput;productionPrompt:string;settings:SettingsInput}):Promise<Generated<Outline>>{
   const length=input.settings.length;
   const full=storyDraftJson(length),{pages:_p,characters:_c,...properties}=full.properties as Record<string,unknown>;void _p;void _c;
   const schema={...full,properties:{...properties,beats:{type:'array',minItems:length==='auto'?readerMinFrames:length,maxItems:length==='auto'?readerMaxFrames:length,items:str(1,180)}},required:[...Object.keys(properties),'beats']};
   const instructions=promptSections(['任务','你是古典连环画编剧，本次只制定全篇提纲。'],['编排标准',storyPlanningDirection],['元数据',storyOutlineMetadataDirection],['本地原文',local(input.source)],['本次输出',storyDraftMetadataDirection+'\n'+outlineDirection+'\n人物设定另行生成，本次不输出 characters。']);
   const result=await call('outline',instructions,{...sourcePayload(input.source,{seed:true}),exactPageCount:length,narrativeDetail:input.settings.narrativeDetail,productionPrompt:input.productionPrompt},schema,8192,input.source.original);
   const value=outlineSchema.parse(result.value);
   if(length!=='auto'&&value.beats.length!==length)throw Error('PLAN_LENGTH');
   return {...result,value};
  },

  /** 叙事分镜批次：依据提纲、原文、制作要求与之前批次撰写配文。 */
  async sceneBatch(input:{source:SourceInput;outline:Outline;productionPrompt:string;first:number;count?:number;previous:string[]}):Promise<Generated<Scene[]>>{
   const total=input.outline.beats.length,first=input.first,last=Math.min(first+(input.count??readerStoryboardBatchSize)-1,total),count=last-first+1;
   if(count<1)throw Error('PLAN_LENGTH');
   const schema=obj({pages:{type:'array',minItems:count,maxItems:count,items:obj({caption:str(8,90)})}});
   const instructions=promptSections(['任务','你是古典连环画分镜导演，本次只为指定批次撰写配文。'],['共同标准',storySceneDirection],['首幅要求',first===1?storyOpeningDirection:''],['配文',storyCaptionDirection],['本地原文',local(input.source)],['批次边界',batchDirection+'\n本次只返回配文，画面指令另行生成。'],['输入与输出',inputBoundaryDirection]);
   const result=await call('plan',instructions,{...sourcePayload(input.source,{seed:true}),productionPrompt:input.productionPrompt,exactPageCount:total,outline:withoutSummary(input.outline),batch:{first,last},previousCaptions:input.previous},schema,Math.max(4096,count*300),input.source.original);
   const pages=z.object({pages:z.array(z.object({caption:captionSchema}).strict()).length(count)}).strict().parse(result.value).pages;
   return {...result,value:pages};
  },

  /**
   * 画面描述按批生成。全篇人物设定只作为生成时可以参考的来源。
   */
  async visual(input:{outline:Outline;productionPrompt:string;style:StyleInput;characters:Character[];frames:VisualFrame[]}):Promise<Generated<Visual[]>>{
   const {frames,outline}=input;checkBatch(frames);
   const instructions=promptSections(['任务','你是古典连环画分镜导演，本次为 frames 中列出的各幅分别撰写画面指令。'],['静态画面与衔接',storyboardDirection],['画面指令',storyVisualDirection],['画风',storyStyleBoundaryDirection],['人物',cardDirection],['批次边界',frameBatchDirection],['输入与输出',inputBoundaryDirection+'只返回 {frames:[{number,prompt,drawn}]}。']);
   const payload={outline:withoutSummary(outline),total:outline.beats.length,frames:frames.map(f=>({...frameRef(outline,f),caption:f.caption})),productionPrompt:input.productionPrompt,artDirection:getArtDirection(input.style),characters:input.characters.map(characterCard)};
   const result=await call('plan',instructions,payload,visualRows(frames.length,outline),visualTokens(frames));
   return {...result,value:parseVisuals(result.value,frames)};
  },

  /** 换画风转换：按批调用；在画面描述的输入之外，以各幅旧画面描述与旧画风为来源。 */
  async restyle(input:{outline:Outline;productionPrompt:string;style:StyleInput;characters:Character[];previousStyle:StyleInput;frames:(VisualFrame&{previousPrompt:string})[]}):Promise<Generated<Visual[]>>{
   const {frames,outline}=input;checkBatch(frames,readerRestyleBatchSize);
   const instructions=restyleInstructions+'\n\n'+promptSections(['本次范围','逐幅转换 frames 中列出的各幅：scenePrompt 是该幅旧画面指令；caption 与 characters 只用于核对人物与情节。drawn 列出该幅画面中实际出现的人物名字。'],['批次边界',frameBatchDirection],['输入与输出','只返回 {frames:[{number,prompt,drawn}]}。']);
   const payload={outline:withoutSummary(outline),frames:frames.map(f=>({...frameRef(outline,f),caption:f.caption,scenePrompt:f.previousPrompt})),productionPrompt:input.productionPrompt,previousArtDirection:{...getArtStyle(input.previousStyle.artStyle),prompt:getArtDirection(input.previousStyle)},artDirection:{...getArtStyle(input.style.artStyle),prompt:getArtDirection(input.style)},characters:input.characters.map(characterCard)};
   const result=await call('repair',instructions,payload,visualRows(frames.length,outline),visualTokens(frames));
   return {...result,value:parseVisuals(result.value,frames)};
  },

  /** 叙事修订：按批调用，只改列出各幅的配文；各幅当前配文、相邻配文、问题与审核意见是来源。 */
  async sceneRepair(input:{source:SourceInput;outline:Outline;productionPrompt:string;frames:{index:number;caption:string;neighbors:{before?:string;after?:string};issues:ReviewIssue[]}[];notes?:string}):Promise<Generated<Scene[]>>{
   const {frames,outline}=input;checkBatch(frames);
   const instructions=promptSections(['任务','你是静态连环画修订编辑，只修订 frames 中列出各幅的配文，不重新编排全篇。'],['共同标准',storySceneDirection],['配文',storyCaptionDirection],['修订','按各幅 issues 回查原文逐项解决；只改需要改的部分。'],['审核意见',input.notes?reviewNotesDirection:''],['本地原文',local(input.source)],['批次边界',frameBatchDirection],['输入与输出',inputBoundaryDirection+'只返回 {frames:[{number,caption}]}。']);
   const payload={...sourcePayload(input.source),productionPrompt:input.productionPrompt,outline:withoutSummary(outline),frames:frames.map(f=>({...frameRef(outline,f),caption:f.caption,neighbors:f.neighbors,issues:f.issues})),...(input.notes?{reviewNotes:input.notes}:{})};
   const schema=obj({frames:{type:'array',minItems:frames.length,maxItems:frames.length,items:obj({number:{type:'integer',minimum:1,maximum:outline.beats.length},caption:str(8,90)})}});
   const result=await call('repair',instructions,payload,schema,Math.max(4096,frames.length*400),input.source.original);
   const rows=z.object({frames:z.array(z.object({number:z.number().int(),caption:captionSchema}).strict()).length(frames.length)}).strict().parse(result.value).frames;
   return {...result,value:byFrame(rows,frames).map(r=>({caption:r.caption}))};
  },

  /** 画面修订：按批调用，只改列出各幅的画面描述；各幅当前画面描述与入画人物、问题与审核意见是来源。 */
  async visualRepair(input:{outline:Outline;productionPrompt:string;style:StyleInput;characters:Character[];frames:(VisualFrame&{prompt:string;drawn:Character[];issues:ReviewIssue[]})[];notes?:string}):Promise<Generated<Visual[]>>{
   const {frames,outline}=input;checkBatch(frames);
   const instructions=promptSections(['任务','你是静态连环画修订编辑，只修订 frames 中列出各幅的画面指令。'],['静态画面与衔接',storyboardDirection],['画面指令',storyVisualDirection],['画风',storyStyleBoundaryDirection],['人物',cardDirection],['修订','按各幅 issues 逐项解决，保留无问题的可见细节。'],['审核意见',input.notes?reviewNotesDirection:''],['批次边界',frameBatchDirection],['输入与输出',inputBoundaryDirection+'只返回 {frames:[{number,prompt,drawn}]}。']);
   const payload={outline:withoutSummary(outline),frames:frames.map(f=>({...frameRef(outline,f),caption:f.caption,current:{prompt:f.prompt,drawn:f.drawn.map(c=>c.name)},issues:f.issues})),productionPrompt:input.productionPrompt,artDirection:getArtDirection(input.style),characters:input.characters.map(characterCard),...(input.notes?{reviewNotes:input.notes}:{})};
   const result=await call('repair',instructions,payload,visualRows(frames.length,outline),visualTokens(frames));
   return {...result,value:parseVisuals(result.value,frames)};
  },

  /** 结构修订：返回按幅号替换的配文段落；新画幅的画面描述随后按批生成。 */
  async structureRepair(input:{source:SourceInput;outline:Outline;productionPrompt:string;settings:SettingsInput;captions:string[];issues:ReviewIssue[];notes?:string;frameCountContext?:FrameCountContext}):Promise<Generated<{from:number;to:number;scenes:Scene[]}[]>>{
   const count=input.captions.length;
   const direction=`按原文及 issues 返回 {edits:[{from,to,pages:[{caption}]}]}。from/to 指修改前 1 起始的幅号，按 from 递增且范围不重叠；替换 from 至 to，from=k,to=k-1 表示在原第 k 幅前插入，from=原幅数+1 表示末尾追加，pages 为空表示删除。只改需协同的连续段落，一次合计最多 ${readerStoryboardBatchSize} 个新或替换画幅，总数 ${readerMinFrames}–${readerMaxFrames}。只返回配文，画面指令另行生成。`;
   const instructions=promptSections(['任务','你是古典静态连环画结构修订编辑。'],['共同标准',storySceneDirection],['配文',storyCaptionDirection],['结构输出',direction],['幅数核对要求',input.frameCountContext?'逐项落实 frameCountContext 的完整 requirements。建议幅数不是硬锁，先补足叙事任务再计数。':''],['审核意见',input.notes?reviewNotesDirection:''],['本地原文',local(input.source)],['输入边界',inputBoundaryDirection]);
   const schema=obj({edits:{type:'array',maxItems:readerStoryboardBatchSize,items:obj({from:{type:'integer',minimum:1,maximum:count+1},to:{type:'integer',minimum:0,maximum:count},pages:{type:'array',maxItems:readerStoryboardBatchSize,items:obj({caption:str(8,90)})}})}});
   const result=await call('repair',instructions,{...sourcePayload(input.source),productionPrompt:input.productionPrompt,narrativeDetail:input.settings.narrativeDetail,countPolicy:input.settings.length==='auto'?'adaptive':'fixed',outline:withoutSummary(input.outline),captions:input.captions,issues:input.issues,...(input.frameCountContext?{frameCountContext:input.frameCountContext}:{}),...(input.notes?{reviewNotes:input.notes}:{})},schema,16000,input.source.original);
   const editedPage=z.object({caption:captionSchema}).strict();
   const edits=z.object({edits:z.array(z.object({
    from:z.number().int().min(1).max(count+1),to:z.number().int().min(0).max(count),
    pages:z.array(editedPage).max(readerStoryboardBatchSize),
   }).strict()).max(readerStoryboardBatchSize)}).strict().parse(result.value).edits;
   let next=count,previousFrom=0,cursor=1,written=0;
   for(const {from,to,pages} of edits){
    written+=pages.length;
    if(from<=previousFrom||from<cursor||to<from-1||to===from-1&&!pages.length||written>readerStoryboardBatchSize)throw Error('INVALID_STRUCTURAL_EDIT');
    next+=pages.length-(to-from+1);
    previousFrom=from;cursor=to+1;
   }
   if(next<readerMinFrames||next>readerMaxFrames)throw Error('STRUCTURAL_FRAME_LIMIT');
   return {...result,value:edits.map(e=>({from:e.from,to:e.to,scenes:e.pages}))};
  },

  /** 标题与结语候选：读原文、提纲与配文；不读制作要求与画面描述。 */
  async ending(input:{source:SourceInput;outline:Outline;captions:string[]}):Promise<Generated<{title:string;candidates:string[]}>>{
   const instructions=reflectionSystemPrompt+'\n\n'+promptSections(['标题标准',titleDirection],['本地原文',local(input.source)],['本次输出',reflectionCandidatesDirection]);
   const schema=obj({title:str(1,40),candidates:{type:'array',minItems:3,maxItems:3,items:str(1,100)}});
   const result=await call('plan',instructions,{...sourcePayload(input.source),draft:{...withoutSummary(input.outline),pages:input.captions.map(caption=>({caption}))}},schema,4096,input.source.original);
   return {...result,value:z.object({title:z.string().trim().min(1).max(40),candidates:z.array(z.string().trim().min(1).max(100)).length(3)}).strict().parse(result.value)};
  },

  /** 结语修订：当前候选与选定结果、问题与审核意见是来源。 */
  async endingRepair(input:{source:SourceInput;outline:Outline;captions:string[];reflection:string;issues:ReviewIssue[];notes?:string}):Promise<Generated<string>>{
   const instructions=reflectionSystemPrompt+'\n\n'+promptSections(['本地原文',local(input.source)],['审核意见',input.notes?reviewNotesDirection:''],['本次输出','只返回 {reflection}，修订一句结语；不输出候选或其他字段。']);
   const result=await call('repair',instructions,{...sourcePayload(input.source),draft:{...withoutSummary(input.outline),pages:input.captions.map(caption=>({caption}))},revision:{reflection:input.reflection,issues:input.issues},...(input.notes?{reviewNotes:input.notes}:{})},obj({reflection:str(1,100)}),4096,input.source.original);
   return {...result,value:z.object({reflection:z.string().trim().min(1).max(100)}).strict().parse(result.value).reflection};
  },

  /** 幅数与结构核对：读原文、提纲、画幅顺序、制作要求、详略与幅数策略、审核意见与配文；不读画面描述。 */
  async frameCheck(input:{source:SourceInput;outline:Outline;productionPrompt:string;settings:SettingsInput;captions:string[];notes?:string}):Promise<Generated<FrameCountReport>>{
   const count=input.captions.length,{schema,instructions}=frameCountReviewRequest(count);
   const scope='\n\n'+promptSections(['本次输入','本次核对只提供配文，不提供画面描述；visualEvidence 一律填写「本次不提供画面描述」，判断依据写入 captionEvidence。']);
   const result=await call('review',instructions+(local(input.source)?'\n'+local(input.source):'')+scope+(input.notes?'\n\n'+reviewNotesDirection:''),{...sourcePayload(input.source),exactPageCount:count,narrativeDetail:input.settings.narrativeDetail||'balanced',countPolicy:input.settings.length==='auto'?'adaptive':'fixed',productionPrompt:input.productionPrompt,plan:{...withoutSummary(input.outline),pages:input.captions.map(caption=>({caption}))},...(input.notes?{reviewNotes:input.notes}:{})},schema,24000,input.source.original);
   const value=parseFrameCountReport(count,result.value);validateEditorialCoverage(value.coverage,input.source.original);
   return {...result,value};
  },

  /** 同一轮补齐允许清单内的逐幅结论以及全篇结论，逐条验收只在全篇结论中执行。 */
  async review(input:ReviewInput):Promise<Generated<ReviewOutcome>>{
   const count=input.frames.length,criteria=input.allowed.narrative?acceptanceCriteria(input.acceptancePrompt):[];
   const choosing=input.allowed.narrative&&!input.confirmedEnding&&input.candidates?.length===3?input.candidates as [string,string,string]:undefined;
   // 幅数与详略由幅数与结构核对负责，审片不重复判断，因此不提供详略设置、按固定幅数审核。
   const acceptancePrompt=criteria.length?input.acceptancePrompt:undefined;
   const {schema:fullSchema,instructions}=fullReviewRequest(count,false,choosing,acceptancePrompt);
   const schema=input.allowed.narrative?{...fullSchema,properties:{...fullSchema.properties,storyIssues:fullSchema.properties.issues},
    required:[...fullSchema.required,'storyIssues']}:fullSchema;
   const allowedText=`issues 只列允许清单内画幅（${input.allowed.pages.join('、')||'无'}）的局部问题，requiresReplan 为 false。${input.allowed.narrative?'storyIssues 单独列影响全篇的叙事、结构、标题、结语或验收问题。可用幅号定位全篇问题。coverage 和验收条目的问题引用 storyIssues，不从 issues 推定全篇问题。':'本轮无需全篇结论；不要判定标题、结语、全篇叙事和验收条目。'}`;
   const reflectionText=input.confirmedEnding?.ending??input.candidates?.[0],titleText=input.confirmedEnding?.title??input.title;
   const sections=promptSections(['本次结论范围',allowedText],['读者确认',input.confirmedEnding?'plan.title 与 plan.reflection 是读者确认的标题与结语，只判断是否合格。':''],['本次验收结果',criteria.length?'每条验收要求只判断一次。涉及全篇且无法定位到单幅的结果使用空 pages；可局部修订时在 pages 标出相关幅号及相应问题。':'']);
   const reflection=reflectionText,title=titleText;
   const original=input.source.original,verified=original.storyBrief;
   // 只有当前梗概仍采用核对过的原文摘要时，才沿用对应的选题依据。
   const matchReason=verified?.summary===input.brief&&storyBriefVerified(original)?verified?.matchReason:undefined;
   // 与正式审片相同的顺序：系统指令、本地原文约束、本次范围，再加本轮结论范围与审核意见。
   const system=instructions.slice(0,reviewSystemPrompt.length),rest=instructions.slice(reviewSystemPrompt.length);
   // 只发送本次允许结论绑定的输入与上下文（全篇叙事分镜与画面描述）；未绑定的提纲、画风、人物设定、制作要求不发送。
   const plan={...(title?{title}:{}),...(input.brief?{summary:input.brief}:{}),...(input.outline?{sourceReference:input.outline.sourceReference,adaptationNote:input.outline.adaptationNote}:{}),...(reflection?{reflection}:{}),...(input.characters?{characters:input.characters.map(c=>`${c.name}：${c.text}`).join('\n')}:{}),pages:input.frames.map(f=>({caption:f.caption,prompt:f.prompt}))};
   const result=await call('review',system+(local(input.source)?'\n'+local(input.source):'')+rest+'\n\n'+sections+(input.notes?'\n\n'+reviewNotesDirection:''),{
    ...sourcePayload(input.source),...(input.brief?{storyBrief:{summary:input.brief,...(matchReason?{matchReason}:{})}}:{}),exactPageCount:count,
    ...(criteria.length?{acceptancePrompt,acceptanceCriteria:criteria}:{}),
    ...(input.productionPrompt!==undefined?{productionPrompt:input.productionPrompt}:{}),...(input.style?{artDirection:getArtDirection(input.style)}:{}),
    plan,...(input.frameCheck?{frameCheck:input.frameCheck}:{}),...(input.outline?{outline:withoutSummary(input.outline)}:{}),...(choosing?{reflectionCandidates:choosing}:{}),...(input.notes?{reviewNotes:input.notes}:{}),
   },schema,24000,input.source.original);
   const raw=result.value as Record<string,unknown>;
   const acceptance=Array.isArray(raw?.acceptanceResults)?raw.acceptanceResults.filter(r=>Number.isInteger(r?.criterion)&&r.criterion>=1&&r.criterion<=criteria.length):raw?.acceptanceResults;
   const pages=new Set(input.allowed.pages);
   const localIssues=scopedReviewIssuesSchema(count).parse(Array.isArray(raw?.issues)?
    raw.issues.filter(issue=>pages.has(issue?.page)&&!issue.requiresReplan):raw.issues);
   const report=reviewReportSchema(count,choosing,acceptancePrompt,undefined,true).parse({...raw,
    issues:input.allowed.narrative?raw.storyIssues??[]:[],
    coverage:input.allowed.narrative?raw.coverage:undefined,acceptanceResults:criteria.length?acceptance:undefined});
   if(report.coverage)validateEditorialCoverage(report.coverage,input.source.original);
   return {...result,value:reviewOutcome(input,report,localIssues,choosing)};
  },
 };
}

/** 审片输入：只含本次允许结论绑定的输入；未绑定的提纲、梗概、画风、人物设定、制作要求为 undefined，不发送。 */
export type ReviewInput={
 source:SourceInput;brief?:string;outline?:Outline;title?:string;productionPrompt?:string;acceptancePrompt?:string;style?:StyleInput;
 characters?:Character[];
 frames:{id:string;caption:string;prompt:string}[];
 candidates?:string[];confirmedEnding?:{title:string;ending:string};notes?:string;frameCheck?:FrameCountReport;
 allowed:{pages:number[];narrative:boolean};
};
export type Judgement={id:string;outcome:'pass'|'fail';detail?:string;requirements?:boolean;acceptance?:AcceptanceResult[]};
export type ReviewOutcome={
 judgements:Judgement[];
 titleChoice?:string;
 endingChoice?:string;
 issues:ReviewIssue[];
 storyIssues?:ReviewIssue[];
};

type Report=ReturnType<ReturnType<typeof reviewReportSchema>['parse']>;

/** 只映射允许清单内的结论。验收问题单独归属全篇结论，可定向修订未参与本轮逐幅审片的画幅。 */
function reviewOutcome(input:ReviewInput,report:Report,issues:ReviewIssue[],choosing?:string[]){
 const results=report.acceptanceResults??[],storyIssues=report.issues;
 const failed=results.filter(result=>result.status==='failed');
 const judgements:Judgement[]=input.allowed.pages.map(page=>{
  const local=issues.filter(issue=>issue.page===page);
  return {id:`frameVerdict:${input.frames[page-1].id}`,outcome:local.length?'fail':'pass',...(local.length?{detail:local.map(issue=>issue.problem).join('；')}:{})};
 });
 if(!input.allowed.narrative)return {judgements,issues};
 const requirements=results.some(result=>result.status==='unknown');
 const detail=[...storyIssues.map(issue=>issue.problem),...results.filter(result=>result.status!=='passed').map(result=>result.evidence)].join('；');
 judgements.push({id:'narrativeVerdict:',outcome:storyIssues.length||failed.length||requirements?'fail':'pass',acceptance:results,...(detail?{detail}:{}),...(requirements?{requirements:true}:{})});
 const choice=choosing&&report.reflectionChoice?choosing[report.reflectionChoice.index-1]:input.candidates?.[0];
 return {judgements,issues,storyIssues,...(input.confirmedEnding?{}:{titleChoice:report.titleReview.title,...(choice?{endingChoice:choice}:{})})};
}

/**
 * 绘图与横图的提示词：只用本幅画面描述、入画人物设定、画风与重绘说明，不含配文和制作要求。
 * 提供方以 promptOverride 接收，参考图与画幅比例仍按原参数传入。
 */
export function framePrompt(input:{visual:string;redrawNote?:string;drawn:Character[];style:StyleInput;index:number;reference:boolean;layout?:'portrait'|'landscape'}){
 const scene=input.redrawNote?input.visual+'\n本幅重绘说明（限于画面细节，沿用场景、人物和画风）：'+input.redrawNote:input.visual;
 return imagePromptFor({scene,characters:input.drawn.map(c=>`${c.name}：${c.text}`).join('\n'),page:input.index,style:input.style.artStyle,artStylePrompt:input.style.artStylePrompt,reference:input.reference,layout:input.layout});
}
