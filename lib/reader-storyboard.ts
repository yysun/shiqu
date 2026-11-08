// Save source-grounded scene batches, then finalize the title and ending from the complete story.
import {normalizeProductionPrompt} from './reader-prompts.ts';
import {storyboardOutlineSchema,storyboardBatchSchema,planSchema,storyPresentationSchema} from './reader-model.ts';
import type {Selection,Storyboard,StoryDraft} from './reader-model.ts';
import {verifiedOriginalPayload} from './reader-source-types.ts';
import {assertStoryBriefReady,withoutStorySummary} from './reader-story-brief.ts';
import type {OriginalSource} from './reader-source-types.ts';
import type {Generated} from './reader-engine.ts';
import {readerStoryboardBatchSize,readerMinFrames,readerMaxFrames} from './reader-limits.ts';
import {planJson,storyDraftJson,storyDraftMetadataDirection,storyPlanningDirection,storySceneDirection,storyMetadataDirection,storyPageDirection} from './reader-generation-contract.ts';
import {localPlanConstraint} from './reader-local-contract.ts';
import {getArtStyle} from './reader-styles.ts';
import {storyboardReviewGenerator} from './reader-review.ts';
import {promptSections,inputBoundaryDirection,reflectionMeaningDirection,titleDirection,storyOpeningDirection,storyEditorialContext} from './reader-prompts.ts';
import type {ReasoningTask} from './reader-reasoning.ts';
import type {ReviewIssue} from './reader-review.ts';
import {narrativeDetailInstructions} from './reader-frame-recommendation.ts';

type Call=(task:ReasoningTask,instructions:string,payload:unknown,schema:unknown,maxOutputTokens:number,original?:OriginalSource)=>Promise<Generated<unknown>>;
export const outlineDirection=`只制定全篇提纲，以beats替代pages，不生成caption、prompt或reflection。每节点一句，按故事顺序明确一个静态可见瞬间及承载的行动、回应、信息或停顿，以及相对前幅的新任务。保留关键交锋、接受者反应与自然结果，连续议论也须有不同焦点，不能只把新台词分给同一站姿。末节点优先安排主事件已有的实际后果，留出表现当事人处境变化的空间；开放结尾停在最后可证的状态。自述往事注明归属，指控不列成客观事件。保留规定元数据与characters；节点数就是全篇幅数，exactPageCount为数字时一致，为auto时按任务在${readerMinFrames}至${readerMaxFrames}内决定。不新增核心分析字段。`;
export const batchDirection='只细化outline.beats中batch.first至batch.last，按原编号依次返回对应pages，数量为last-first+1。全篇范围、总幅数、事件顺序与元数据已定，不重新选题、分配全篇幅数或修改提纲。将各节点的行动、回应与停顿落实成可画瞬间；查阅完整原文核实表达，保留本批外的任务，不重复前批或提前收尾。接续previousPages末幅的朝向、接触、状态和未完行动；技术批次不是剧情分幕，不重新开场或强造高潮。';
const reflectionSystemPrompt=promptSections(
 ['任务','你是古典连环画的标题与结语编辑。完整阅读verifiedOriginal和draft.pages；原文约束事实，分镜说明读者已知什么。只处理本次指定字段，保留其余元数据与全部分镜，不输出理解过程。'],
 ['余味标准',reflectionMeaningDirection],
 ['修订原则','有revision时逐项解决结语问题：先校正事实，再按本篇体裁修订。长篇选段删过程复述，留下结局中真正发生的变化；独立短篇删重复解释，从言行与后果中重新提炼有据的意味。更换立意须说明原文依据及表达收益，无实质问题时保留。末幅与结语连读，修结语不改末幅。'],
 ['语言','每句最多100字，不套固定句式。'],['输入与输出',inputBoundaryDirection]);

const reflectionCandidatesDirection='依据完整原文与分镜拟定title，再生成三个独立成立的结语候选。候选在有据的观察角度、着重点或表达上有真实区别，不拆同一句、不设陪衬或排名；只支持同一层认识时可比较不同表达，不为差异造新事实或拔高。只返回{title,candidates:[第一句,第二句,第三句]}。';

export function storyboardGenerator(book:(selection:Selection)=>string,call:Call){
 function payload(selection:Selection,id:string,original?:OriginalSource){assertStoryBriefReady(original);return {book:book(selection),chosenStory:selection.storyTitle,...(selection.storyTitle?{}:{theme:selection.theme}),editorialContext:storyEditorialContext(selection.theme),exactPageCount:selection.length,narrativeDetail:selection.narrativeDetail,productionPrompt:normalizeProductionPrompt(selection.productionPrompt||'',selection.theme),artDirection:getArtStyle(selection.artStyle).prompt,variationSeed:id,...(original?{verifiedOriginal:verifiedOriginalPayload(original)}:{})};}
 function instructions(original:OriginalSource|undefined,stage:'outline'|'batch',opening=false){return stage==='outline'?promptSections(
  ['任务','你是古典连环画编剧，本次只制定全篇提纲。'],['编排标准',storyPlanningDirection],['元数据',storyMetadataDirection],
  ['本地原文',original?.localSource?localPlanConstraint:''],['本次输出',storyDraftMetadataDirection+'\n'+outlineDirection]):promptSections(
  ['任务','你是古典连环画分镜导演，本次只细化指定批次。'],['共同标准',storySceneDirection],['展开程度',narrativeDetailInstructions],
  ['首幅要求',opening?storyOpeningDirection:''],
  ['逐幅要求',storyPageDirection],['本地原文',original?.localSource?localPlanConstraint:''],
  ['批次边界',batchDirection],['输入与输出',inputBoundaryDirection]);}
 return {
  ...storyboardReviewGenerator(call),
  async outline(selection:Selection,id:string,original?:OriginalSource){
   const full=storyDraftJson(selection.length),{pages:_,...properties}=full.properties;void _;
   const schema={...full,properties:{...properties,beats:{type:'array',minItems:selection.length==='auto'?readerMinFrames:selection.length,maxItems:selection.length==='auto'?readerMaxFrames:selection.length,items:{type:'string',minLength:1,maxLength:180}}},required:[...Object.keys(properties),'beats']};
   const result=await call('outline',instructions(original,'outline'),payload(selection,id,original),schema,8192,original);
   const value=storyboardOutlineSchema.parse(result.value);
   if(selection.length!=='auto'&&value.beats.length!==selection.length)throw Error('PLAN_LENGTH');
   return {...result,value};
  },
  async planBatch(selection:Selection,id:string,storyboard:Storyboard,original:OriginalSource){
   const first=storyboard.pages.length+1,last=Math.min(first+readerStoryboardBatchSize-1,storyboard.outline.beats.length),count=last-first+1;
   if(count<1)throw Error('PLAN_LENGTH');
   const full=planJson(count),schema={type:'object',properties:{pages:full.properties.pages},required:['pages'],additionalProperties:false};
   const result=await call('plan',instructions(original,'batch',first===1),{...payload(selection,id,original),exactPageCount:storyboard.outline.beats.length,outline:withoutStorySummary(storyboard.outline),batch:{first,last},previousPages:storyboard.pages},schema,Math.max(8192,count*800),original);
   return {...result,value:storyboardBatchSchema(count).parse(result.value).pages};
  },
  async reflection(selection:Selection,draft:StoryDraft,original:OriginalSource,revision?:{reflection:string;issues:ReviewIssue[]}){
   const schema={type:'object',properties:{reflection:{type:'string',minLength:1,maxLength:100}},required:['reflection'],additionalProperties:false};
   const result=await call(revision?'repair':'plan',reflectionSystemPrompt+'\n\n'+promptSections(['本地原文',original.localSource?localPlanConstraint:''],['本次输出','只返回 {reflection}，撰写或修订一句结语；保留标题及全部分镜，不输出候选或其他字段。']),{...payload(selection,'',original),editorialContext:storyEditorialContext(selection.theme),draft:withoutStorySummary(draft),...(revision?{revision}:{})},schema,4096,original);
   return {...result,value:planSchema.pick({reflection:true}).parse(result.value).reflection};
  },
  async reflectionCandidates(selection:Selection,draft:StoryDraft,original:OriginalSource){
   const schema={type:'object',properties:{title:{type:'string',minLength:1,maxLength:40},candidates:{type:'array',minItems:3,maxItems:3,items:{type:'string',minLength:1,maxLength:100}}},required:['title','candidates'],additionalProperties:false};
   const result=await call('plan',reflectionSystemPrompt+'\n\n'+promptSections(['标题标准',titleDirection],['本地原文',original.localSource?localPlanConstraint:''],['本次输出',reflectionCandidatesDirection]),{...payload(selection,'',original),editorialContext:storyEditorialContext(selection.theme),draft:withoutStorySummary(draft)},schema,4096,original);
   return {...result,value:storyPresentationSchema.parse(result.value)};
  },
 };
}
