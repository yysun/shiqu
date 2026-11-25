// 制作内容以有序画幅和产物为准。读取时导出 Plan 与图片序列，供阅读、复制和导出使用。
import type {Document,Selection} from '../reader-model.ts';
import {normalizeProductionPrompt} from '../reader-prompts.ts';
import type {ProviderSettingsView} from '../provider-settings.ts';
import type {FrameCountReport,ReviewIssue} from '../reader-review.ts';
import type {RepairBudget} from './review.ts';
import type {Product,Fault,VersionState} from './engine.ts';
import type {AcceptanceResult} from '../reader-acceptance.ts';
import {fingerprint} from './fingerprint.ts';

export function landscapeSourceReady(doc:Document){
 const dag=doc.dag;
 return !!dag?.order.length&&dag.order.length===doc.plan?.pages.length&&dag.order.every((key,i)=>
  !!dag.frames[key]?.visual&&!!doc.images[i]&&dag.frames[key].image===doc.images[i]);
}

export type DagFrame={
 /** 叙事分镜正文（配文、对白与动作）。 */
 scene:string;
 /** 画面描述。 */
 visual:string;
 /** 本幅入画的人物身份。 */
 drawn?:string[];
 /** 模型返回的入画人物名字。 */
 drawnNames?:string[];
 redrawNote?:string;
 /** 本版读者已明确要求重新绘制此幅。 */
 redrawRequested?:true;
 image?:string;

};
export type DagCharacter={id:string;name:string;aliases?:string[];text:string};
/** 绘图使用版本记下的服务与模型。分辨率和构图参数由对应绘图流程保存。 */
type DrawingSnapshot={provider:ProviderSettingsView['runtime']['provider'];models:{image:string|null}};
/** 旧库迁移前兼容读取原快照。文字设置不再参与生产派发。 */
type LegacyModelSnapshot=Pick<ProviderSettingsView['runtime'],'provider'|'imageProvider'|'taskReasoningEfforts'>&{models:{text:string|null;image:string|null}};
export type ModelSnapshot=DrawingSnapshot|LegacyModelSnapshot;
export type DagOutline={title:string;summary:string;sourceReference:string;adaptationNote:string;beats:string[]};
/** 审片问题按结论归属；自动修订未改变内容或会破坏手改时，保留阻断原因。 */
export type DagIssue=ReviewIssue&{target:string;stalled?:true|'hand-edited';handEditedPages?:number[]};
export type Renderer={layout:'portrait';aspectRatio:'9:16';size:'1K'};

export type DagDocument={
 version:2;
 order:string[];
 frames:Record<string,DagFrame>;
 characters:DagCharacter[];
 ending?:{title:string;candidates:string[];selectedTitle?:string;chosen?:string;confirmed?:{title:string;ending?:string}};
 /** 事实梗概（准备梗概或读者手改）。 */
 brief?:string;
 outline?:DagOutline;
 /** 新制作和重新编排使用合批；旧稿保留其未完成的 0.17 调用。 */
 combinedStoryboard?:true;
 /** 本轮已尝试独立画风建议，缺少该能力的服务也可继续给出制作建议。 */
 preparedArt?:true;
 /** 已确认作品重新准备时单独更新建议，隔离旧世代的制作任务。 */
 preparationGeneration?:number;
 repreparing?:true;
 frameCheck?:FrameCountReport;
 /** 各结论的说明，键为结论实例身份；结论本身记录在 products。 */
 verdicts?:Record<string,{outcome:'pass'|'fail';detail?:string;requirements?:true;acceptance?:AcceptanceResult[]}>;
 /** 最近一次审片中失败结论的问题，供自动修订使用。 */
 issues?:DagIssue[];
 /** 本修订的自动修订额度。 */
 repairs?:RepairBudget;
 /** 用过的画风设置，键为画风输入指纹；换画风转换据此取得旧画风。 */
 styles?:Record<string,{artStyle:Selection['artStyle'];artStylePrompt?:string|null}>;
 products:Record<string,Product>;
 /** 清空手改后的目标，写回新内容以前不采用以前的自动产物。 */
 resetText?:string[];
 /** 产物引用变化时同步改变，作为版本写入的内容校验。 */
 productSignature?:string;
 modelSnapshot?:ModelSnapshot;
 renderer:Renderer;
 /** 已保存、等待「继续制作」的修订；只有 continue 清除，resume 不清除。 */
 continuation?:{revision:number;reason:'revision-saved'};
 /** 读者指定的首幅原图（换画风时）：画面描述转换完成、首幅的输入就绪后由 settle() 记为该幅的成图产物，不再绘制。 */
 cover?:{frame:string};
};

export const defaultRenderer:Renderer={layout:'portrait',aspectRatio:'9:16',size:'1K'};

/** 新故事的空 dag：尚无任何产物。 */
/**
 * 选定的标题与结语：读者确认的优先，否则为标题与叙事结论选定的结语（尚未选定时取第一个候选）。
 * 依据「标题与结语」的条目绑定这一对值的指纹，标题或结语任一改变都会使其失效。
 */
export function endingChoice(ending:DagDocument['ending']):{title:string;ending:string}|undefined{
 const chosen=ending?.confirmed?.ending??ending?.chosen??ending?.candidates[0];
 return ending&&chosen?{title:ending.confirmed?.title??ending.selectedTitle??ending.title,ending:chosen}:undefined;
}

export const emptyDag=():DagDocument=>({version:2,order:[],frames:{},characters:[],products:{},renderer:defaultRenderer});

/** 由选择与 dag 计算根输入产物；缺省值先展开为实际值，保证与显式填写同指纹。 */
export function rootProducts(selection:Selection,dag:Pick<DagDocument,'modelSnapshot'|'renderer'|'ending'|'frames'|'order'>,extra:{notes?:string;seed?:unknown;refSource?:string}={}):Record<string,Product>{
 const root=(value:unknown,parts?:Record<string,string>):Product=>({hash:fingerprint(value),inputs:{},...(parts?{parts}:{})});
 const {displayTitle:_display,artStyle,artStylePrompt,productionPrompt,acceptancePrompt,narrativeDetail,length,voice:_voice,...source}=selection;
 void _display;void _voice;
 const products:Record<string,Product>={
  'selection:':root(source),
  'seed:':root(extra.seed??null),
  // 制作要求按主题规范化后的实际值计算指纹，与请求中发送的文字一致。
  'productionReq:':root(normalizeProductionPrompt(productionPrompt??'',source.theme||'')),
  'acceptanceReq:':root(acceptancePrompt??''),
  'settings:':root({narrativeDetail:narrativeDetail||'balanced',length}),
  'style:':root({artStyle,artStylePrompt:artStylePrompt??null}),
  'modelSnapshot:':root(dag.modelSnapshot??null),
  'renderer:':root(dag.renderer),
  'notes:':root(extra.notes??''),
  'refSource:':root(extra.refSource??null),
 };
 if(dag.ending?.confirmed)products['endingConfirmed:']=root(dag.ending.confirmed);
 for(const id of dag.order){
  const note=dag.frames[id]?.redrawNote;
  if(note)products[`redrawNote:${id}`]=root(note);
 }
 return products;
}

/** 引擎所需的版本状态：dag 产物加根输入，故障单独传入。 */
export function versionState(dag:DagDocument,roots:Record<string,Product>,options:{confirmed:boolean;faults?:Fault[];reprepare?:boolean;skipFrameCheck?:boolean}):VersionState{
 return {
  confirmed:options.confirmed,
  order:dag.order,
  frames:Object.fromEntries(dag.order.map(id=>[id,{drawn:dag.frames[id]?.drawn}])),
  products:{...dag.products,...roots},
  faults:options.faults||[],
  reprepare:options.reprepare,
  skipFrameCheck:options.skipFrameCheck,
 };
}

export {decodeDocument,encodeDocument,projectDocument} from './projection.ts';
