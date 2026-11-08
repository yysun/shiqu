// Audit source-to-frame coverage and pacing; adaptive scripts may repair structure before a fresh audit.
import {acceptanceInput} from './reader-acceptance.ts';
import {normalizeProductionPrompt} from './reader-prompts.ts';
import {z} from 'zod';
import {acceptanceCriteria,acceptanceReviewDirection,acceptanceResultSchema,acceptanceResultsJson} from './reader-acceptance.ts';
import type {AcceptanceResult} from './reader-acceptance.ts';
import {planSchema,reflectionCandidatesSchema} from './reader-model.ts';
import type {Plan,Selection,StoryboardOutline,ReflectionCandidates} from './reader-model.ts';
import {verifiedOriginalPayload} from './reader-source-types.ts';
import {storyBriefPayload,assertStoryBriefReady,withoutStorySummary} from './reader-story-brief.ts';
import type {OriginalSource} from './reader-source-types.ts';
import type {Generated} from './reader-engine.ts';
import {getArtStyle} from './reader-styles.ts';
import {storyPageDirection,storySceneDirection} from './reader-generation-contract.ts';
import {promptSections,inputBoundaryDirection,reflectionMeaningDirection,titleDirection,storyEditorialContext,storyScopeDirection,storyOpeningDirection,storyReviewDirection,storyKnowledgeDirection,storyRoleDirection} from './reader-prompts.ts';
import {readerStoryboardBatchSize,readerMinFrames,readerMaxFrames} from './reader-limits.ts';
import {localPlanConstraint} from './reader-local-contract.ts';
import {editorialAuditDirection,editorialCoverageSchema,editorialCoverageJson,validateEditorialCoverage} from './reader-editorial.ts';
import type {EditorialCoverage} from './reader-editorial.ts';
import {structuralEditsSchema,structuralEditsJson} from './reader-structure.ts';
import type {StructuralEdits} from './reader-structure.ts';
import type {ReasoningTask} from './reader-reasoning.ts';
import {narrativeDetailInstructions} from './reader-frame-recommendation.ts';

// Zero identifies the separate ending, never a frame. Positive saved frame IDs stay unchanged.
const categories=['caption','action','composition','progression','continuity','source','style','reflection'] as const;
const issueSchema=z.object({page:z.number().int().min(0),category:z.enum(categories),problem:z.string().trim().min(1).max(180),instruction:z.string().trim().min(1).max(400),requiresReplan:z.boolean().optional()});
export type ReviewIssue=z.infer<typeof issueSchema>;
export type ReflectionChoice={index:number;reason:string};
export type TitleReview={title:string;reason:string};
export const frameCountReviewSchema=(count:number)=>z.object({decision:z.enum(['keep','expand','reduce','redistribute']),proposedCount:z.number().int().min(readerMinFrames).max(readerMaxFrames),reason:z.string().trim().min(1).max(400)}).strict().superRefine((value,ctx)=>{
 if((value.decision==='keep'||value.decision==='redistribute')&&value.proposedCount!==count||value.decision==='expand'&&value.proposedCount<=count||value.decision==='reduce'&&value.proposedCount>=count)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Frame-count verdict and proposed direction disagree'});
});
export type FrameCountReview=z.infer<ReturnType<typeof frameCountReviewSchema>>;
export const frameRequirementSchema=(count:number)=>z.object({page:z.number().int().min(1).max(count),quote:z.string().trim().min(2).max(120),task:z.string().trim().min(1).max(120),captionEvidence:z.string().trim().min(1).max(180),visualEvidence:z.string().trim().min(1).max(180),loss:z.string().trim().min(1).max(180),instruction:z.string().trim().min(1).max(400)}).strict();
export type FrameRequirement=z.infer<ReturnType<typeof frameRequirementSchema>>;
export type FrameCountReport={frameCountReview:FrameCountReview;requirements:FrameRequirement[];issues:ReviewIssue[];coverage:EditorialCoverage[]};
export type FrameCountContext=Pick<FrameCountReport,'frameCountReview'|'requirements'>;
export type ReviewReport={acceptanceResults?:AcceptanceResult[];frameCountReview?:FrameCountReview;issues:ReviewIssue[];titleReview:TitleReview;reflectionChoice?:ReflectionChoice;coverage?:EditorialCoverage[]};
// Historical review reports remain readable without title audit metadata.
export type ReviewRecordMeta={step?:string;recordedAt?:string};
export type ReviewRepairRecord=ReviewRecordMeta&{round:number;requested:number[];changes:RepairedPage[];changed?:boolean;before?:RepairedPage[];reflection?:string;previousReflection?:string;structure?:StructuralEdits&{before:number;after:number;sourcePages:(number|null)[];removed:RepairedPage[];previousOutline?:StoryboardOutline;previousCharacters?:string}};
export type ReviewCheckpoint={phase?:'frames'|'full';frameCountReports?:(FrameCountReport&ReviewRecordMeta)[];overridden?:boolean;stopReason?:'limit'|'unchanged'|'replan'|'requirements';history?:ReviewRepairRecord[];status:'pending'|'repair'|'passed'|'blocked';round:number;repairs:number;issues:ReviewIssue[];repaired:number[];reports:(ReviewRecordMeta&{round:number;acceptanceResults?:AcceptanceResult[];frameCountReview?:FrameCountReview;issues:ReviewIssue[];coverage?:EditorialCoverage[];titleReview?:TitleReview&{previousTitle:string};reflectionChoice?:ReflectionChoice&{candidates:ReflectionCandidates}})[]};
export type RepairedPage={page:number;caption:string;prompt:string};
export function reviewReportSchema(count:number,candidates?:ReflectionCandidates,acceptancePrompt=''){return z.object({acceptanceResults:z.array(acceptanceResultSchema).max(20).optional(),frameCountReview:frameCountReviewSchema(count).optional(),titleReview:z.object({title:planSchema.shape.title.trim().min(1),reason:z.string().trim().min(1).max(400)}),issues:z.array(issueSchema.extend({page:z.number().int().min(0).max(count)})).max(count+1),coverage:z.array(editorialCoverageSchema).min(1).max(32).optional(),reflectionChoice:z.object({index:z.number().int().min(1).max(3),reason:z.string().trim().min(1).max(400)}).optional()}).superRefine((report,ctx)=>{
 const criteria=acceptanceCriteria(acceptancePrompt),results=report.acceptanceResults||[];
 if(criteria.length&&(results.length!==criteria.length||new Set(results.map(r=>r.criterion)).size!==criteria.length||results.some(r=>r.criterion>criteria.length)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Acceptance results must cover each criterion exactly once'});
 if(!criteria.length&&results.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Unexpected acceptance results'});
 for(const result of results){if(result.pages.some(page=>page>count)||new Set(result.pages).size!==result.pages.length||result.status==='failed'&&!result.pages.some(page=>report.issues.some(issue=>issue.page===page)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Failed acceptance criteria require valid pages and corresponding repair issues'});}
 if(report.frameCountReview&&(report.frameCountReview.decision!=='keep')!==report.issues.some(issue=>issue.requiresReplan))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Frame-count adjustment must correspond to concrete structural issues'});
 if(new Set(report.issues.map(issue=>issue.page)).size!==report.issues.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate review page'});
 if(report.issues.some(issue=>(issue.page===0)!==(issue.category==='reflection')))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Reflection issues must target the ending; frame issues require positive pages'});
 if(report.issues.some(issue=>issue.requiresReplan&&(issue.page===0||!['progression','continuity'].includes(issue.category))))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Global revisions must identify a positive frame and progression or global continuity problem'});
 if(!!candidates!==!!report.reflectionChoice)ctx.addIssue({code:z.ZodIssueCode.custom,message:'An ending choice is required only when candidates are supplied'});
 for(const item of report.coverage||[]){
  if(item.pages.some(page=>page>count)||new Set(item.pages).size!==item.pages.length||item.issuePage>count||item.assessment==='adequate'&&(!item.pages.length||item.issuePage!==0)||item.assessment==='needs-change'&&(!item.issuePage||!report.issues.some(issue=>issue.page===item.issuePage)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Editorial coverage must identify valid frames and its corresponding issue'});
 }
});}
export function parseFrameCountReport(count:number,value:unknown):FrameCountReport{
 const parsed=z.object({frameCountReview:frameCountReviewSchema(count),requirements:z.array(frameRequirementSchema(count)).max(readerStoryboardBatchSize)}).strict().parse(value);
 if((parsed.frameCountReview.decision==='keep')!==!parsed.requirements.length)throw Error('FRAME_COUNT_REVIEW_SCOPE');
 const pages=[...new Set(parsed.requirements.map(item=>item.page))];
 const issues:ReviewIssue[]=pages.map(page=>{const related=parsed.requirements.filter(item=>item.page===page);return {page,category:'progression',problem:related.map(item=>item.loss).join('；').slice(0,180),instruction:related.map(item=>item.instruction).join('；').slice(0,400),requiresReplan:true};});
 const coverage:EditorialCoverage[]=parsed.requirements.map(item=>({quote:item.quote,task:item.task,pages:[item.page],assessment:'needs-change',reason:item.loss,issuePage:item.page}));
 return {...parsed,issues,coverage};
}
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
const frameCountReviewJson={type:'object',properties:{decision:{type:'string',enum:['keep','expand','reduce','redistribute']},proposedCount:{type:'integer',minimum:readerMinFrames,maximum:readerMaxFrames},reason:{type:'string',minLength:1,maxLength:400}},required:['decision','proposedCount','reason'],additionalProperties:false};
export const frameCountReviewDirection=`本次只审核叙事空间与分配，不能先定一个新数量再凑内容：
1. 从完整原文找出有独立作用的言行、回应、停顿和自然结果。${storyRoleDirection}原文叙述、内心独白、诗词和人物讲述也须辨别各层作用，不能只留熟悉结论；按narrativeDetail取舍，不把所有有据细节升级为必需画幅。
2. 找这些任务在旧稿中的对应幅，分别说明caption交代什么、prompt计划突出什么。提到整场戏、呈现事后状态，不等于关键过程已展开；多层转念不能只列一串结论便算表现，也不机械逐句拆分。本阶段没有成图，不判断渲染质量。
3. 判断压缩损失：指出哪层交锋、承受、认识变化或余波被挤掉。合理合并保留作用时不报问题；重复、过细拆分或范围失衡则合并、删除或重分配。保留改变主事件意味的后果，压缩无独立任务的手续和传话，不按尾声比例或预设总数判冗长；不自动追收连载引子，也不强闭原作开放结尾。
4. 将缺失、重复或失衡写成具体修订要求，说明补/拆/合/删的原范围及各幅不同任务，再重编计数。现有幅数不是目标；修法有原文依据，保留有效对白与判断归属，不以加长旁白、心理解说或换景别掩盖结构缺失。
requirements只列有实质损失的任务：page锚定原稿；quote为原文一个连续短引，允许简繁、标点差别，不改字、拼接或用省略号；task写独立作用，captionEvidence与visualEvidence分别据caption、prompt举证，loss写理解或节奏损失，instruction给出具体修法。缺段锚定最近幅，同幅多个任务可分列，不声称看过成图。
frameCountReview按任务返回decision、proposedCount、reason：keep保持当前数且requirements为空；expand增加，reduce减少，redistribute总数不变但重分配，后三者均须有具体requirements。总数在1–80内，不含封面或系统另页展示的plan.reflection；删除纯装饰、复制结语等占位，保留原文已有自然收束。建议数不是新硬锁，修后仍须全篇复核。不审核标题或结语，只返回requirements及frameCountReview。`;

const reflectionChoiceDirection='reflectionCandidates按顺序编号1、2、3，plan.reflection只是占位。依结语标准先判成立，再比较意味、准确程度与表达取舍，返回reflectionChoice:{index,reason}；reason说明原文依据及相对另两句的具体优势。不默认选第一句，不按长短、名词多少、华丽或覆盖支线多少排名，不拼接或另造第四句。有合格候选时择优，不因淘汰句有问题而要求修订；三个都不合格时选最接近的一句，仅报告所选句的具体reflection问题。分镜仍须完整审核。';
const storyEndingReviewDirection='从已核原文辨认本篇主事件，用实际标题核对叙事承诺，再找主事件及必要后果的自然收束。核对末幅是否落到当事人的实际处境；若原文写出了决定性后果，分镜却停在发令、决定或预告，指出漏掉的具体结果及受影响的人。试删末尾数幅：若不损主事件的结果与意味，却新开人物、目标、行动或追问，把关键回答留在本篇之外，应删去连载引子；若主事件自身仍未完成，则回查原文补足必要结果。报告指出已完成或未完成的主事件、末尾新增的未决问题及具体修订边界，不因原文章节到此或旧审核通过便放行。区分主事件自身的开放结局与附加支线的截断，保留有据且成立的留白；不凭标题偏窄删去决定性后续，也不为追收新悬念无限延伸。';
const storyPacingReviewDirection='逐段核对每幅相对前文新增的信息、关系变化、行动后果或不可替代的反应与停顿。对连续筹备、赠物、问答、传话及办事手续做试删、试合：删幅或将必要信息并入邻幅后，起因、选择、对方回应及结果仍清楚，且不损人物对照、感官递进或有作用的停顿，就不必独占一幅。仅换动作、台词或景别，每幅都有原文依据，均不足以证明任务独立。报告列明原幅范围、重复任务、须保留的信息与代表瞬间及具体合并方案；不先定总数或尾声比例，不以一段长旁白吞掉关键过程。';
export const reviewSystemPrompt=promptSections(
 ['任务与边界','你是独立的静态连环画审片编辑。完整阅读原文及全篇caption、prompt、characters，先独立判断，再参考摘要和提纲。只审核文字分镜的表达与可执行性，不能声称检查过成图或断言实际画风、表情、伤痕已呈现。'],
 ['共同标准',storySceneDirection],
 ['展开程度',narrativeDetailInstructions],
 ['逐幅要求',storyPageDirection],
 ['故事范围与开场',storyScopeDirection+'\n'+storyOpeningDirection],
 ['主事件与末尾核对',storyEndingReviewDirection],
 ['删合检验',storyPacingReviewDirection],
 ['主题与摘要审核',storyReviewDirection],
 ['原文覆盖与节奏核对',editorialAuditDirection],
 ['问题判定','配文独立连读应让普通成年读者无需古文注释即可理解；不靠prompt、人物设定或摘要里的解释补正文缺失。按共同标准判断事实、语义、动作、构图、递进、连续性与artDirection，只有可指出的错误、阅读障碍或实质表达损失才报告。合理压缩、有效停顿及同等成立的编辑偏好不触发修订，不因超过目标字数而机械报错。'],
 ['结构问题与修订边界','缺整段关键阶段或结果、需增删幅或重分配时，用category=progression、requiresReplan=true，page锚定截断或失衡处，instruction说明完整范围及插入/删除/替换任务；不可塞一句结局到末幅掩盖缺戏。局部可修时false，不改变其他幅或幅号。全局characters与原文及正确pages冲突时，用category=continuity、requiresReplan=true，锚定首处冲突，明确只修人物说明并保留正确pages；普通位置、物件或伤势承接用局部continuity，不为文风重写全局设定。'],
 ['标题标准',titleDirection],
 ['标题审核','返回titleReview:{title,reason}，保留准确标题或直接修正范围不符、误导、无据扣题的标题，说明依据与收益；不把标题问题挂到某一幅，也不改其他元数据。'],
 ['结语标准',reflectionMeaningDirection],
 ['结语审核','结语在全篇之后独立展示；末幅可停在动作、对白或停顿，不因缺总结而报错。与末幅及前文连读，按本篇体裁核对最终结语；候选存在时，结语问题只针对所选句。长篇选段核对结语是否点明本段结局中最重要的处境、关系或局势变化。独立短篇先从原文的关键言行与实际后果辨认有据的寓意、讽刺或人情观察，再验证所选结语是否准确提炼了其中一层。遗漏决定性变化、仅复述情节、套用泛泛道理或总结了原文不支持的寓意时，须报告page=0、category=reflection，指出结语遗漏或误读了哪一层，并引用支持判断的原文细节；修订指令说明要提炼的角度，不代写最终句。允许不同的有据解读，不把结语问题转嫁给末幅。'],
 ['本篇验收要求',acceptanceReviewDirection],
 ['制作与验收职责','productionPrompt仅用于理解本篇改编意图，不将其中每项偏好自动升级为额外验收门槛。自定义验收按acceptanceCriteria逐条判定；默认质量仍按上述系统审核标准检查。'],
 ['报告契约','优先报告事实与因果错误、关键结果缺失，再报告有据的连续性与表达损失。issues只列需修问题，不评分或另列建议；为空且全部验收条目passed才通过。幅号从1开始，结语用page=0、category=reflection；同幅全部问题合一条，每条返回requiresReplan。problem引用原文、配文或prompt并说明损失；instruction写最小可执行修法及须保留的有效对白、性格与画面。跨幅协同时逐幅列不同任务，只改后幅即可时只报后幅；不以“更深刻、加强冲突、更有感染力”代替证据。纯caption问题保留无问题的prompt。'],
 ['输入与输出',inputBoundaryDirection]);
const repairDirection=`只修issues指出且在requestedPages内的画幅，返回{pages:[{page,caption,prompt}]}，原编号一一对应，不增删幅、不改未指定页或任何元数据。
逐项解决同幅全部问题，保留有效的对白口气、条件、反差、回应及停顿。默认沿用提纲事件，只有问题明确要求时才在本批指定幅内协同调整原有事件，不转移问题或新增动机。画面重复须在动作、接触、状态或第一焦点上有可见区别，不能只换近义词或景别。
纯配文问题只改caption、原样返回prompt；修画面才调整瞬间与空间。修后结合全篇检查语义与衔接，不用心理解说补事实，不把独立结语写进末幅。只返回指定JSON。`;
export const repairSystemPrompt=promptSections(['任务','你是静态连环画修订编辑，只定向修复指定画幅，不重新编排全篇。'],['共同标准',storySceneDirection],['首幅要求',storyOpeningDirection],['逐幅要求',storyPageDirection],['修订范围与输出',repairDirection],['输入边界',inputBoundaryDirection]);

type Call=(task:ReasoningTask,instructions:string,payload:unknown,schema:unknown,maxOutputTokens:number,original?:OriginalSource)=>Promise<Generated<unknown>>;
export function storyboardReviewGenerator(call:Call){
 function payload(selection:Selection,plan:Plan,original:OriginalSource,outline?:StoryboardOutline,reviewing=true){assertStoryBriefReady(original);return {book:selection.customBook||selection.bookId,chosenStory:selection.storyTitle,editorialContext:storyEditorialContext(selection.theme),...(reviewing?storyBriefPayload(original):{}),exactPageCount:plan.pages.length,narrativeDetail:selection.narrativeDetail||'balanced',countPolicy:selection.length==='auto'?'adaptive':'fixed',...(reviewing?acceptanceInput(selection):{}),productionPrompt:normalizeProductionPrompt(selection.productionPrompt||'',selection.theme),artDirection:getArtStyle(selection.artStyle).prompt,verifiedOriginal:verifiedOriginalPayload(original),plan:reviewing?plan:withoutStorySummary(plan),...(outline?{outline:reviewing?outline:withoutStorySummary(outline)}:{})};}
 return {
  async reviewFrameCount(selection:Selection,plan:Plan,original:OriginalSource){
   if(selection.length!=='auto')throw Error('FRAME_COUNT_REVIEW_MODE');
   const count=plan.pages.length,schema={type:'object',properties:{requirements:{type:'array',maxItems:readerStoryboardBatchSize,items:{type:'object',properties:{page:{type:'integer',minimum:1,maximum:count},quote:{type:'string',minLength:2,maxLength:120},task:string(120),captionEvidence:string(180),visualEvidence:string(180),loss:string(180),instruction:string(400)},required:['page','quote','task','captionEvidence','visualEvidence','loss','instruction'],additionalProperties:false}},frameCountReview:frameCountReviewJson},required:['requirements','frameCountReview'],additionalProperties:false};
   const instructions=promptSections(['任务','你是连环画叙事空间与幅数编辑，这是第一道审核门。只判断关键任务的叙事空间与分配，识别缺戏、重复和过细拆分，再按必要任务计数；事实细查、语言润色、构图和连续性检查、标题与结语择优留给下一道原有全面审片。原文仍是依据，不凭改编说明或旧审核通过来放行。'],['作品知识与补文',storyKnowledgeDirection],['故事范围',storyScopeDirection],['主事件与末尾核对',storyEndingReviewDirection],['删合检验',storyPacingReviewDirection],['展开程度',narrativeDetailInstructions],['审核顺序',frameCountReviewDirection],['输入边界',inputBoundaryDirection]);
   const result=await call('review',instructions+(original.localSource?'\n'+localPlanConstraint:''),payload(selection,plan,original,undefined,false),schema,24000,original);
   const value=parseFrameCountReport(count,result.value);validateEditorialCoverage(value.coverage,original);return {...result,value};
  },
  async review(selection:Selection,plan:Plan,original:OriginalSource,outline?:StoryboardOutline,reflectionCandidates?:ReflectionCandidates){
   const candidates=reflectionCandidates?reflectionCandidatesSchema.parse(reflectionCandidates):undefined;
   const count=plan.pages.length,schema={type:'object',properties:{...(acceptanceCriteria(selection.acceptancePrompt).length?{acceptanceResults:acceptanceResultsJson}:{}),coverage:editorialCoverageJson(count),titleReview:{type:'object',properties:{title:string(40),reason:string(400)},required:['title','reason'],additionalProperties:false},issues:{type:'array',maxItems:count+1,items:{type:'object',properties:{page:{type:'integer',minimum:0,maximum:count},category:{type:'string',enum:categories},problem:string(180),instruction:string(400),requiresReplan:{type:'boolean'}},required:['page','category','problem','instruction','requiresReplan'],additionalProperties:false}},...(candidates?{reflectionChoice:{type:'object',properties:{index:{type:'integer',enum:[1,2,3]},reason:string(400)},required:['index','reason'],additionalProperties:false}}:{})},required:['issues','titleReview','coverage',...(acceptanceCriteria(selection.acceptancePrompt).length?['acceptanceResults']:[]),...(candidates?['reflectionChoice']:[])],additionalProperties:false};
   const result=await call('review',reviewSystemPrompt+(original.localSource?'\n'+localPlanConstraint:'')+'\n\n'+promptSections(
    ['本次数量约束',selection.length==='auto'?'countPolicy=adaptive：exactPageCount是当前数，不是目标；有据的增删或重分配标requiresReplan=true，由结构修订处理。':'countPolicy=fixed：旧数值稿确需改变结构时仍标requiresReplan=true，不伪造局部修法。'],
    ['本次结语对象',candidates?reflectionChoiceDirection:'审核plan.reflection，不输出reflectionChoice。']),
    {...payload(selection,plan,original,outline),...(candidates?{reflectionCandidates:candidates}:{})},schema,24000,original);
   const value=reviewReportSchema(count,candidates,selection.acceptancePrompt).parse(result.value);if(selection.length==='auto'&&!value.coverage)throw Error('EDITORIAL_COVERAGE_REQUIRED');if(value.coverage)validateEditorialCoverage(value.coverage,original);
   return {...result,value};
  },
  async restructure(selection:Selection,plan:Plan,original:OriginalSource,issues:ReviewIssue[],coverage?:EditorialCoverage[],frameCountContext?:FrameCountContext){
   if(selection.length!=='auto'||!issues.some(issue=>issue.requiresReplan))throw Error('INVALID_STRUCTURAL_SCOPE');
   const direction=`按原文及issues返回{edits:[{from,to,pages:[{caption,prompt}]}]}。from/to指修改前1起始幅号，按from递增且范围不重叠；替换from至to，from=k,to=k-1在原第k幅前插入，from=原幅数+1末尾追加，pages为空则删除。
只改需协同的连续段落，一次合计最多${readerStoryboardBatchSize}个新/替换画幅，总数1–80；覆盖关键言行、回应与结果，删合无任务重复，不截断结局凑预算。coverage仅是线索，原文才是依据。结构修后全篇复核，结语及局部问题留待后续处理；不返回完整稿、封面或独立结束页。
必要时可返回characters修正与正确pages冲突的全局说明，或因重排而过期的幅号、状态；按剧情阶段描述动态痕迹，保留稳定身份、服色及正确pages，不编新事件。仅改characters时edits可空；缺省或null保留原说明，其他元数据不改。`;
   const instructions=promptSections(['任务','你是古典静态连环画结构修订编辑。'],['共同标准',storySceneDirection],['故事范围',storyScopeDirection],['逐幅要求',storyPageDirection],['结构输出',direction+(frameCountContext?'\n逐项落实frameCountContext完整requirements，不只照截短issues处理；frameCountReview不是新硬锁，先补任务再计数。':'')],['输入边界',inputBoundaryDirection]);
   const result=await call('repair',instructions+(original.localSource?'\n'+localPlanConstraint:''),{...payload(selection,plan,original,undefined,false),issues,...(coverage?{coverage}:{}),...(frameCountContext?{frameCountContext}:{})},structuralEditsJson(plan.pages.length),16000,original);
   return {...result,value:structuralEditsSchema.parse(result.value)};
  },
  async repair(selection:Selection,plan:Plan,original:OriginalSource,issues:ReviewIssue[],outline?:StoryboardOutline){
   const requestedPages=issues.map(issue=>issue.page);
   if(issues.some(issue=>issue.requiresReplan)||requestedPages.some(page=>page<1)||!requestedPages.length||requestedPages.length>readerStoryboardBatchSize||new Set(requestedPages).size!==requestedPages.length)throw Error('INVALID_REPAIR_SCOPE');
   const schema={type:'object',properties:{pages:{type:'array',minItems:requestedPages.length,maxItems:requestedPages.length,items:{type:'object',properties:{page:{type:'integer',enum:requestedPages},caption:{type:'string',minLength:8,maxLength:90},prompt:{type:'string',minLength:20,maxLength:1800}},required:['page','caption','prompt'],additionalProperties:false}}},required:['pages'],additionalProperties:false};
   const result=await call('repair',repairSystemPrompt+(original.localSource?'\n\n## 本地原文\n'+localPlanConstraint:''),{...payload(selection,plan,original,outline,false),issues,requestedPages},schema,Math.max(8192,requestedPages.length*800),original);
   return {...result,value:repairOutputSchema(requestedPages).parse(result.value).pages};
  },
 };
}
