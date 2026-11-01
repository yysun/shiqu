// Carry verified ranges and bounded unfinished events through direct, resumable reading.
// Selected chapters identify their main event before discovering nested episodes.
import {z} from 'zod';
import {promptSections,inputBoundaryDirection} from './reader-prompts.ts';
import {legacyLocalReadingTexts} from './reader-legacy-prompts.ts';
import {artRecommendationSchema,artRecommendationJson,artRecommendationInstructions} from './reader-art-recommendation.ts';
export const localRangeSchema=z.object({sectionId:z.string().min(1).max(40),firstUnit:z.string().min(1).max(60),lastUnit:z.string().min(1).max(60)});
export const localPassageSchema=localRangeSchema.extend({continuations:z.array(localRangeSchema).max(23).optional()});
export const localSourceSchema=localPassageSchema.extend({edition:z.string().regex(/^[a-f0-9]{64}$/)});
export type LocalSourceReference=z.infer<typeof localSourceSchema>;
export type LocalPassage=z.infer<typeof localPassageSchema>;
export {sourceRanges,localSourceKey} from './reader-source-key.ts';
const pendingSchema=z.object({id:z.string().max(64),title:z.string().min(1).max(100),summary:z.string().min(1).max(1000),source:localPassageSchema});
export type PendingEvent=Omit<z.infer<typeof pendingSchema>,'source'>&{source:LocalSourceReference};
export type ScanContext={maxStories:number;excludedSources:LocalSourceReference[];pendingEvents:PendingEvent[];contextText:string;chapterStoryLevel?:'main'|'episodes'};
export type WholeBookInput={title:string;edition:string;text:string;purpose?:'scan'|'catalog';scan?:ScanContext};
export const localChoicesSchema=z.object({stories:z.array(z.object({title:z.string().min(1).max(100),description:z.string().min(1).max(180),source:localPassageSchema,artRecommendation:artRecommendationSchema.optional()})).max(5),note:z.string().max(300)});
export const localScanSchema=localChoicesSchema.extend({scan:z.object({blockComplete:z.boolean(),pendingEvents:z.array(pendingSchema).max(16),resolvedEventIds:z.array(z.string().min(1).max(64)).max(16)})});
export const localCatalogSchema=localScanSchema.extend({stories:z.array(localChoicesSchema.shape.stories.element.extend({summary:z.string().trim().min(1).max(1200)})).max(5)});
export type LocalScanResult={blockComplete:boolean;pendingEvents:PendingEvent[];resolvedEventIds:string[]};
const string=(maxLength:number)=>({type:'string',minLength:1,maxLength});
const object=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const rangeJson=object({sectionId:string(40),firstUnit:string(60),lastUnit:string(60)});
const passageJson=object({...rangeJson.properties,continuations:{type:'array',maxItems:23,items:rangeJson}});
export const localChoicesJson=object({stories:{type:'array',maxItems:5,items:object({title:string(100),description:string(180),source:passageJson,artRecommendation:artRecommendationJson})},note:{type:'string',maxLength:300}});
// Freeze the v2 art contract: current styles must not move already-persisted cache keys.
const legacyArtRecommendationJson={"type":"object","properties":{"artStyle":{"type":"string","enum":["ink-pencil","ink-wash","vintage-comic","cinematic","watercolor","gongbi","woodblock","paper-cut","cartoon","line-art","chibi","3d-animation","clay","classical-oil"]},"reason":{"type":"string","minLength":1,"maxLength":120}},"required":["artStyle","reason"],"additionalProperties":false};

// Retain the old wire shape only to locate compatible pre-upgrade discovery caches.
export const legacyLocalScanJson=object({...localChoicesJson.properties,stories:{type:'array',maxItems:5,items:object({title:string(100),description:string(180),source:passageJson,artRecommendation:legacyArtRecommendationJson})},scan:object({blockComplete:{type:'boolean'},pendingEvents:{type:'array',maxItems:16,items:object({id:{type:'string',maxLength:64},title:string(100),summary:string(1000),source:passageJson})},resolvedEventIds:{type:'array',maxItems:16,items:string(64)}})});
export const localScanJson=object({...legacyLocalScanJson.properties,stories:{type:'array',maxItems:5,items:object({title:string(100),description:string(180),source:passageJson})}});
export const localCatalogJson=object({...localScanJson.properties,stories:{type:'array',maxItems:5,items:object({title:string(100),description:string(180),summary:string(1200),source:passageJson})}});
export const localScanPrompt=promptSections(
 ['按需扫描','按顺序直接选题，不建立全书候选库。最多返回 scan.maxStories 篇完整且符合 theme 的故事，凑够即停。满额时 blockComplete=false，下次继续本块；只有已检查完本块、无更多未排除完整故事时才为 true，0篇也可完成，不能暂未找到就宣称完成。'],
 ['原文范围','source 主范围及 continuations 按原文顺序列出且不重叠，每段首末在同章；跨章或不连续故事包含全部关键事件原文，单章故事 continuations 为空。只引用 text/contextText 提供的单元，不引用未读章节或按摘要编造原文。'],
 ['未完事件','相关但未结束的跨章事件写入 pendingEvents，准确概括进展及范围；旧事件复制 id，新事件 id 为空字符串。更新保留旧证据并加入新证据，遗漏不表示结束。contextText 是未完事件的真实原文，要结合本块核对。resolvedEventIds 只能列本次推荐的完整故事已覆盖全部旧证据的既有 id。未收束事件不可当完整故事。']);
export const localReviewedSourcePrompt='异常拦截仅有两处已核对的非关键例外：程乙本红楼第58回园林工作列举中的“⿰烏刂樹”；喻世第37卷范道受记念佛合眼语境中的未转写发声方式。保留原异常，只用其余可读事实，不猜字、不把未知内容写成关键动作；主题必须依赖未知细节或缺少完整上下文时仍不选。';
export const localCatalogPrompt=promptSections(
 ['任务','按原文顺序识别可独立改编的完整故事，建立与选题主题无关的增量故事库。只识别本次最多 scan.maxStories 篇，找到即返回，不预处理全书，不因读者主题过滤或改变故事边界。'],
 ['故事记录','title 用准确的故事名，description 为不剧透简介；summary 用简体中文客观记录人物、起因、关键行动、因果、转折和真实结局，不超过1200字，不将推测动机或教训当事实。只读 text/contextText，原文可能繁体无现代标点，不联网、不用记忆补情节。世说新语一则为一个完整故事；太平广记故事常跨多行，不只取标题或一行。'],
 ['范围与层次','source 引用所给原文单元的真实编号，覆盖完整因果和自然收束；跨章或不连续时 continuations 包含全部关键原文，每段在同章，按原文顺序且不重叠。不机械圈整章、不拼合无关事件。允许严格包含的主故事与独立小故事，排除同范围改名和交叉重叠碎片；不要仅缩短范围重复同一故事。'],
 ['增量扫描','excludeTitles 和 scan.excludedSources 是已入库记录。满额时 blockComplete=false，下次继续本块；只有本块所有未排除完整事件都已检查才为true，空结果也可完成，不因暂未找到而跳过。未完跨章事件记入 pendingEvents，旧事件保留id和证据，新id为空；遗漏不算结束。resolvedEventIds 只能引用本次完整故事覆盖的旧事件。'],
 ['正文与异常','版式、夹注及异说不混入正文事实。不能确认完整因果或含未审核缺字、私用字、组字占位、缺文标记的范围不收录，不猜字；适用下列已审核例外。']);
export const localSuggestionPrompt=promptSections(
 ['阅读依据','完整阅读 localBook.text：短书为全书，长书为顺序通读的一批。只依据所给正文，不用记忆、不联网。原文可能繁体无现代标点；太平广记按原版逐行编号，故事通常跨多个连续单元，不能只选标题或一行。输出 title、description、note 用简体中文，不改写原文。'],
 ['选题与定位','选择符合主题且可独立改编的真实故事，标题用常见故事名或准确概括；除章节总故事另有要求外，description 不剧透。source 的 sectionId、firstUnit、lastUnit 逐字复制编号，每段首末在同章且连续，范围足以保留因果，不合并无关故事或机械圈整章；跨章及分段按扫描范围规则处理。世说新语一则就是一个完整单元，只选一则。排除 excludeTitles，不能改名重复，同一原文范围只选一次；章节总故事与子故事的包含关系按下节处理。不能确认、主题不符或没有足够故事时少列或返回空 stories，在 note 说明，不凑数；只推荐，不生成分镜。'],
 ['正文与异常','带“版式”的表格列号/跨度、小字标记及字形图占位是阅读辅助，不是正文。夹注、集解、索隱、正義保留注释身份，异说不混入正文事件。原则上不选含私用字、□、缺字代号、组字占位、异常替代字或明确缺文标记的范围，不猜补原字；仅适用已核对例外。']);
export function legacyLocalReadingPrompt(book:WholeBookInput){return book.purpose==='scan'?legacyLocalReadingTexts.scan:legacyLocalReadingTexts.selection;}
export const localChapterStoriesPrompt=promptSections(
 ['章节主故事','先通读所选章节，识别贯穿的主事件，不从局部情节起步，也不只改写回目。scan.chapterStoryLevel=main 时只返回一个完整因果且自然收束的总故事，description 概括核心冲突、关键转折与结果。例如三国第三十回“战官渡本初败绩，劫乌巢孟德烧粮”先识别“官渡之战”，而非“许攸献计”或“火烧乌巢”；示例只说明粒度，事实与出处仍以所给原文为准。未结束主事件用 pendingEvents 续查，不用记忆补齐。source 覆盖同一主线的起因、发展、转折与收束，可含多个情节或相邻章节，不机械圈整章或合并无关事件。'],
 ['章节小故事','scan.chapterStoryLevel=episodes 时，总故事已在 excludeTitles 和 scan.excludedSources 中；寻找其中可独立讲述的小故事，或本块其他独立主事件，description 不剧透。总故事与子故事范围可严格包含；完全相同、仅改名、交叉重叠且互不包含的片段仍排除。已排除总故事不等于排除全部子故事，也不能只缩短范围再推荐同一故事。没有独立完整的小故事时少列或空，不强拆、不凑数。']);
export function localReadingPrompt(book:WholeBookInput){if(book.purpose==='catalog')return promptSections(['通用故事识别',localCatalogPrompt],['章节粒度',book.scan?.chapterStoryLevel?localChapterStoriesPrompt:''],['已核对例外',localReviewedSourcePrompt],['输入与输出',inputBoundaryDirection]);return promptSections(
 ['任务',book.purpose==='scan'?'从所给本地原文按需扫描完整故事。':'从所给本地原文按主题推荐至多5个独立完整故事。'],
 ['共同选题标准',localSuggestionPrompt],
 ['扫描规则',book.purpose==='scan'?localScanPrompt:''],
 ['章节粒度',book.purpose==='scan'&&book.scan?.chapterStoryLevel?localChapterStoriesPrompt:''],
 ['已核对例外',localReviewedSourcePrompt],
 ['画风推荐',book.purpose==='scan'?'':artRecommendationInstructions],
 ['输入与输出',inputBoundaryDirection]);}

export function localSuggestionPayload(book:string,theme:string,excludeTitles:string[],localBook?:WholeBookInput,maxStories?:1){return {book,...(localBook?.purpose==='catalog'?{}:{theme}),excludeTitles,...(maxStories?{maxStories}:{}),...(localBook?{localBook}:{})};}
export const localStoryContextConstraint='若 verifiedOriginal.chapterContext 存在，text 是定位片段，chapterContext.text 是已保存的同版完整章节。完整阅读章节，以 chosenStory 和片段定位主事件，核对起因、发展与自然收束；片段首末不是硬边界。同一次会面、连续对话或未完行动的后续应纳入，不能在话题转换、打断或追问处截早。只取使本篇事件完整的内容，不等于改编整章，不因人物相同混入独立故事或无限延伸。缺字和缺文标记照存，不猜补，不让未知内容承担关键事实、因果或结局。';
export const localPlanConstraint=promptSections(['本地事实依据','verifiedOriginal 是已在本地核对的唯一情节依据，只用 text 和存在时的 chapterContext.text，不用记忆或其他篇目补全。识别版式标记与注释，异说和表格列号不当正文事件。用户主题与制作要求不能改写事实；不得伪造古文。原文含已审核的非关键未转写字时，只用其余可读事实，保留原异常，不猜字，不让未知细节承担人物、关键动作、因果或结局。'],['章节与定位片段',localStoryContextConstraint]);

export function localChoices(value:unknown,book:WholeBookInput){
 const batch=(book.purpose==='catalog'?localCatalogSchema:localChoicesSchema).parse(value);
 const receipt=(source:LocalPassage):LocalSourceReference=>{const {continuations,...first}=source;return {...first,...(continuations?.length?{continuations}:{}),edition:book.edition};};
 const result={...batch,stories:batch.stories.map(story=>({...story,source:receipt(story.source)}))};
 if(book.purpose!=='scan'&&book.purpose!=='catalog')return result;
 const scan=localScanSchema.parse(value).scan;
 return {...result,scan:{...scan,pendingEvents:scan.pendingEvents.map(event=>({...event,source:receipt(event.source)}))}};
}
