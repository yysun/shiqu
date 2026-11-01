// Audit the full main event, opening, title and ending; structural omissions stop frame-scoped repairs.
import {normalizeProductionPrompt} from './reader-prompts.ts';
import {z} from 'zod';
import {planSchema,reflectionCandidatesSchema} from './reader-model.ts';
import type {Plan,Selection,StoryboardOutline,ReflectionCandidates} from './reader-model.ts';
import {verifiedOriginalPayload} from './reader-source-types.ts';
import {storyBriefPayload} from './reader-story-brief.ts';
import type {OriginalSource} from './reader-source-types.ts';
import type {Generated} from './reader-engine.ts';
import {getArtStyle} from './reader-styles.ts';
import {storyPageDirection} from './reader-generation-contract.ts';
import {promptSections,inputBoundaryDirection,sourceFidelityDirection,storyboardDirection,narrativeMeaningDirection,reflectionMeaningDirection,editorialDirection,storyEditorialContext,storyScopeDirection,storyOpeningDirection,storyAdaptationDirection} from './reader-prompts.ts';
import {readerStoryboardBatchSize} from './reader-limits.ts';
import {localPlanConstraint} from './reader-local-contract.ts';
import type {ReasoningTask} from './reader-reasoning.ts';

// Zero identifies the separate ending, never a frame. Positive saved frame IDs stay unchanged.
const categories=['caption','action','composition','progression','continuity','source','style','reflection'] as const;
const issueSchema=z.object({page:z.number().int().min(0),category:z.enum(categories),problem:z.string().trim().min(1).max(180),instruction:z.string().trim().min(1).max(400),requiresReplan:z.boolean().optional()});
export type ReviewIssue=z.infer<typeof issueSchema>;
export type ReflectionChoice={index:number;reason:string};
export type TitleReview={title:string;reason:string};
export type ReviewReport={issues:ReviewIssue[];titleReview:TitleReview;reflectionChoice?:ReflectionChoice};
// Historical review reports remain readable without title audit metadata.
export type ReviewCheckpoint={overridden?:boolean;stopReason?:'limit'|'unchanged'|'replan';history?:{round:number;requested:number[];changes:RepairedPage[];reflection?:string}[];status:'pending'|'repair'|'passed'|'blocked';round:number;repairs:number;issues:ReviewIssue[];repaired:number[];reports:{round:number;issues:ReviewIssue[];titleReview?:TitleReview&{previousTitle:string};reflectionChoice?:ReflectionChoice&{candidates:ReflectionCandidates}}[]};
export type RepairedPage={page:number;caption:string;prompt:string};
export function reviewReportSchema(count:number,candidates?:ReflectionCandidates){return z.object({titleReview:z.object({title:planSchema.shape.title.trim().min(1),reason:z.string().trim().min(1).max(400)}),issues:z.array(issueSchema.extend({page:z.number().int().min(0).max(count)})).max(count+1),reflectionChoice:z.object({index:z.number().int().min(1).max(3),reason:z.string().trim().min(1).max(400)}).optional()}).superRefine((report,ctx)=>{
 if(new Set(report.issues.map(issue=>issue.page)).size!==report.issues.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate review page'});
 if(report.issues.some(issue=>(issue.page===0)!==(issue.category==='reflection')))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Reflection issues must target the ending; frame issues require positive pages'});
 if(report.issues.some(issue=>issue.requiresReplan&&(issue.page===0||issue.category!=='progression')))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Replanning issues must identify a positive frame and progression problem'});
 if(!!candidates!==!!report.reflectionChoice)ctx.addIssue({code:z.ZodIssueCode.custom,message:'An ending choice is required only when candidates are supplied'});
});}
export function repairOutputSchema(pages:number[]){return z.object({pages:z.array(planSchema.shape.pages.element.extend({page:z.number().int().min(1)})).length(pages.length)}).superRefine((result,ctx)=>{
 const actual=result.pages.map(page=>page.page);
 if(new Set(actual).size!==pages.length||actual.some(page=>!pages.includes(page)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Repair page set differs from requested pages'});
});}
export function pendingRepairs(review:ReviewCheckpoint){
 const pending=[...new Set(review.issues.map(issue=>issue.page))].filter(page=>!review.repaired.includes(page));
 const pages=pending.filter(page=>page>0).sort((a,b)=>a-b).slice(0,readerStoryboardBatchSize);
 return pages.length?pages:pending.includes(0)?[0]:[];
}
export const storyReplanMessage='故事主线或结局不完整，请修改制作要求或画幅数，重新编排故事。';
export function newReview():ReviewCheckpoint{return {history:[],status:'pending',round:0,repairs:0,issues:[],repaired:[],reports:[]};}

const string=(maxLength:number)=>({type:'string',minLength:1,maxLength});
const reflectionChoiceDirection='本次结语有三个候选（reflectionCandidates），按数组顺序编号1、2、3；plan.reflection 只是尚未选定时的占位，不表示推荐。先对照完整原文和分镜逐句判断成立与否，再在合格句中比较所保留的意味、准确程度、表达功能与语言取舍，选出最值得留下的一句。不要默认选第一句，不按长短、故事名词数量、修辞华丽或固定寓意排名；也不因覆盖更多情节、人物或支线，就优先选择更宽泛的一句。先比较判断是否明确、关系与分寸是否有原文依据、读完能带走什么，再结合入口规则选择表达角度。完整理解全篇不等于成句概括全篇；有据的不同读法可以成立，择优不等于只认可一种寓意。返回 reflectionChoice:{index,reason}，index 必须为现有候选编号，reason 简述所选句的原文依据及相对其余两句的具体优势；不能拼接、改写或另造第四句。有合格候选时，选定其中最优，不因淘汰句有问题或还能想到另一种说法而要求修订。结语的 reflection 问题只针对最终所选句；三个都不合格时也先选最接近要求的一句，并报告其具体问题，交给结语修订阶段处理。分镜仍按完整审核要求检查，择优不能跳过分镜审核。';
export const reviewSystemPrompt=promptSections(
 ['任务与边界','你是独立的静态连环画审片编辑。完整阅读已核原文，再参照主题/原典模式及核对摘要，连读全篇 caption 并结合 prompt 审核，依次检查主题与摘要的有据呈现、核心含义、分镜轻重、事实与连续性、语言。保护原稿有效表达，理解不等于把潜台词都写进旁白。审核文字分镜的可执行性，不能声称看过未生成图片。'],
 ['主题与摘要审核',storyAdaptationDirection],
 ['故事范围与开场',storyScopeDirection+'\n'+storyOpeningDirection],
 ['完整性与重新编排','独立依据原文确定主事件的起因和自然终点，再检查 plan.pages 是否覆盖关键行动及结果；有 outline 时也检查其是否截早，不把错误提纲当正确边界。原文已有结果、分镜却停在铺垫、分离或中途冲突时必须报告，不能用改编说明自称节选、定位名偏窄、改标题或结语补情节来通过；不机械要求全章或所有支线。整段重要阶段或结果缺失、必须重新分配全篇画幅时：category="progression"，requiresReplan=true，page 标出截断或失衡最明显的一幅；problem 指明原文遗漏的关键行动与结果，instruction 说明完整范围和可压缩的次要过程。此标记停止局部修补，不能要求末幅补一句结局。局部开场不足或一句衔接可修时 requiresReplan=false；背景已清楚不强加介绍。每条问题均返回该布尔值。'],
 ['共同叙事标准',narrativeMeaningDirection],
 ['逐幅事实边界',sourceFidelityDirection],
 ['配文与语义','只读配文并结合前后语境，普通成年读者应无须古文注释就能理解；不依赖画面提示词或读者翻译古文来补关键意思。按共同标准核对字面意思、说话者、指代、条件、范围与力度；有效原句和必要归属保留，不以词频判错。回忆或故事在入口交代归属与时间，连续语境自然承接，切回当下或更换讲述者再提示，避免每幅机械起头。逐幅核对对象、用途、操作、尺寸、位置、容器与承受能力，不能将操作受限误写成无处存放。即使已发现机械转述，也要检查删标签后是否仍含混；补最少关系，不靠增加代词、照搬古文或猜事实修补。自然省略与可由画面承担的细节可以保留。caption 正常目标8至55字，必要时可到90字硬上限；不因超过目标而机械判错。配文应匹配可见瞬间；纯文字问题保留无问题的 prompt。'],
 ['动作、构图、推进与连续性','检查静态单瞬间、可读的身体施力和接触、景别主次与空间关系，不以抽象情绪代动作，不塞入连续动作或不必要全员。逐对比较相邻画面的瞬间、主要动作、接触、物件状态、视线与第一焦点，不能因配文有新论点或已发现语言问题跳过。不同论点仍用同一姿势、对象与焦点且无独立停顿时，按 composition 指出重复，保留论点，指定已有动作结束、回应或新焦点，不能只要求换角度。配文和画面都无新任务时用 progression。有依据的关系、幽默、反应与停顿要保留，不强求威胁升级、反转、回忆或每幅悬念。核对诱因、关键言行、回应和收尾是否真正获得画幅；被概括或次要流程挤掉时指出原文依据及理解损失。按 continuity 检查人物朝向与位置、物件持有者与状态、时间和已揭信息，尤其每20幅边界；技术批次不是剧情分幕。按 style 检查 artDirection 冲突。'],
 ['标题与入口',editorialDirection+'\n标题准确、可识别且符合实际范围时保留，不为风格偏好改名。有范围不符、误导或无据扣题时直接修正。返回 titleReview:{title,reason}，说明保留依据或具体问题与修正收益，再核对事实；不改其他元数据，也不将标题问题记作某幅问题。'],
 ['结语标准',reflectionMeaningDirection],
 ['结语审核与改进','读者先读全部配文，再在独立结束页读 plan.reflection；制作要求中“最后一句”的感想针对结语，不能因末幅停在对白、动作或停顿就判缺总结。候选存在时按本次择优规则确定审核对象。将所选结语与末幅及前文连读，分别检查事实与立意、提炼或解说、语言铺垫。若解释正确却重复已说清的动机或只是重排情节，引用结语与重复配文，指出哪层意思重复，要求重新提炼而非补细节。立意成立而铺垫冗余时只删解释；误读才校准认识，不把所有语言问题升级为重写寓意。再检查有无明确更好的表达：当前句是否错过结局的重要意味、将有力量的关系稀释成标签或绕说削弱判断。须指出原文或配文依据、值得保留的判断、具体损失及修法收益；不接受“不够深刻、还可更好”，不为华丽、长短、更多故事词或另一种同等读法改写。若要更换立意，须证明哪个关键关系或收尾意味被实质削弱。已准确、有意味且凝练时保留；抽象而保留关系和限定的句子不因没点名细节而判错。不得指定最终金句、强加唯一寓意或把结语问题转嫁给末幅。'],
 ['报告契约','只报告有具体依据的实质表达损失、阅读障碍或事实错误，不凑问题，不按个人口味重写。病句、指代不清及打断连读的机械重复仍需修订。issues 为空才表示通过，需重编的问题也必须列入。幅号从1开始；独立结语用 category="reflection"、page=0，可与画幅问题同时报告。同一幅或结语的全部问题合为一条。problem 引用原文、配文或画面指令并说明误读或损失；instruction 说明删改哪句、保留哪句有效对白、补哪层条件或归属，或谁在什么动作后作什么可见回应。不能只写“抓住核心、加强冲突、更有感染力”，不能靠心理解说修事实。需要两幅配合时逐幅列出不同任务；只需后幅改时只报后幅。修订不得改变未列出的幅、增删幅号或靠一幅加解释掩盖结构缺失。'],
 ['输入与输出',inputBoundaryDirection]);
const repairDirection=`只修订 issues 指出且列在 requestedPages 中的画幅，返回 {pages:[{page,caption,prompt}]}，编号从1开始，与指定幅号一一对应，不增删、重复或改其他页。保留选定故事、总幅数、事件顺序、人物身份、画风和全部元数据。
默认沿用提纲对应事件；只有问题明确要求相邻幅协同调整时，才在本批指定幅号内重新分配原有事件与反应，不丢关键言行或改范围外画幅。依据原文和全篇理解每幅作用，逐项解决同幅全部问题，保留有效对白的口气、条件、力度及反差、回应、停顿和收尾；不将潜台词翻译成心理解说，不靠新增事件、动机或转移问题通过。
画面重复修完后，对照相邻幅的动作、接触、状态、视线和第一焦点确认差异可见；不能只换“安坐、端坐、松放”等近义词或景别，有效停顿仍保留。类比允许压缩重复例证，保留独立论证层次，不能换常用字后留下原有歧义。去掉机械转述后继续核对对象、指代、用途、操作、尺寸与空间关系，不能只删标签、加代词或抄含混原话。真有歧义用准确对白、最少语境或回应解决，不添加“借此讥讽、其实因为”等动机说明。
纯配文问题只改 caption，原样返回无问题的 prompt；涉及画面才修改可见瞬间与动作空间。修后连读全篇配文，消除病句、含混与生硬衔接；入口与必要转场保留说法归属，后续自然承接。reflection 在独立结束页，不复制或改写进末幅，末幅可自然停在对白、动作或停顿。只返回指定 JSON，不输出解释、评分或完整重写。`;
const repairSystemPrompt=promptSections(['任务','你是静态连环画修订编辑，本次仅定向修复指定画幅，不重新编排全篇。'],['开场要求',storyOpeningDirection],['叙事标准',narrativeMeaningDirection],['事实边界',sourceFidelityDirection],['静态画面',storyboardDirection],['逐幅要求',storyPageDirection],['修订范围与输出',repairDirection],['输入边界',inputBoundaryDirection]);

type Call=(task:ReasoningTask,instructions:string,payload:unknown,schema:unknown,maxOutputTokens:number,original?:OriginalSource)=>Promise<Generated<unknown>>;
export function storyboardReviewGenerator(call:Call){
 function payload(selection:Selection,plan:Plan,original:OriginalSource,outline?:StoryboardOutline){return {book:selection.customBook||selection.bookId,chosenStory:selection.storyTitle,editorialContext:storyEditorialContext(selection.theme),...storyBriefPayload(original),exactPageCount:plan.pages.length,productionPrompt:normalizeProductionPrompt(selection.productionPrompt||'',selection.theme),artDirection:getArtStyle(selection.artStyle).prompt,verifiedOriginal:verifiedOriginalPayload(original),plan,...(outline?{outline}:{})};}
 return {
  async review(selection:Selection,plan:Plan,original:OriginalSource,outline?:StoryboardOutline,reflectionCandidates?:ReflectionCandidates){
   const candidates=reflectionCandidates?reflectionCandidatesSchema.parse(reflectionCandidates):undefined;
   const count=plan.pages.length,schema={type:'object',properties:{titleReview:{type:'object',properties:{title:string(40),reason:string(400)},required:['title','reason'],additionalProperties:false},issues:{type:'array',maxItems:count+1,items:{type:'object',properties:{page:{type:'integer',minimum:0,maximum:count},category:{type:'string',enum:categories},problem:string(180),instruction:string(400),requiresReplan:{type:'boolean'}},required:['page','category','problem','instruction','requiresReplan'],additionalProperties:false}},...(candidates?{reflectionChoice:{type:'object',properties:{index:{type:'integer',enum:[1,2,3]},reason:string(400)},required:['index','reason'],additionalProperties:false}}:{})},required:['issues','titleReview',...(candidates?['reflectionChoice']:[])],additionalProperties:false};
   const result=await call('review',reviewSystemPrompt+(original.localSource?'\n'+localPlanConstraint:'')+'\n\n'+promptSections(['本次结语对象',candidates?reflectionChoiceDirection:'审核 plan.reflection，不输出 reflectionChoice。']),{...payload(selection,plan,original,outline),editorialContext:storyEditorialContext(selection.theme),...(candidates?{reflectionCandidates:candidates}:{})},schema,16000,original);
   return {...result,value:reviewReportSchema(count,candidates).parse(result.value)};
  },
  async repair(selection:Selection,plan:Plan,original:OriginalSource,issues:ReviewIssue[],outline?:StoryboardOutline){
   const requestedPages=issues.map(issue=>issue.page);
   if(issues.some(issue=>issue.requiresReplan)||requestedPages.some(page=>page<1)||!requestedPages.length||requestedPages.length>readerStoryboardBatchSize||new Set(requestedPages).size!==requestedPages.length)throw Error('INVALID_REPAIR_SCOPE');
   const schema={type:'object',properties:{pages:{type:'array',minItems:requestedPages.length,maxItems:requestedPages.length,items:{type:'object',properties:{page:{type:'integer',enum:requestedPages},caption:{type:'string',minLength:8,maxLength:90},prompt:{type:'string',minLength:20,maxLength:1800}},required:['page','caption','prompt'],additionalProperties:false}}},required:['pages'],additionalProperties:false};
   const result=await call('repair',repairSystemPrompt+'\n\n'+storyAdaptationDirection+(original.localSource?'\n\n## 本地原文\n'+localPlanConstraint:''),{...payload(selection,plan,original,outline),issues,requestedPages},schema,Math.max(8192,requestedPages.length*800),original);
   return {...result,value:repairOutputSchema(requestedPages).parse(result.value).pages};
  },
 };
}
