// 文档 v2：document.dag 是制作内容与产物记录的权威来源，plan、images 是由它生成的存储投影。
// 画幅以身份为键存放，另存顺序；人物按条目、验收要求按条目保存。投影保持 v1 的 Plan 形状，
// 阅读、导出、复制等只读方继续读投影；每次保存在同一条语句中写入 dag 与投影。
import type {Document,Plan,Selection} from '../reader-model.ts';
import {normalizeProductionPrompt} from '../reader-prompts.ts';
import type {ProviderSettingsView} from '../provider-settings.ts';
import type {FrameCountReport,ReviewIssue} from '../reader-review.ts';
import type {ReviewSkip} from './review-skip.ts';
import type {RepairBudget} from './review.ts';
import type {Product,Fault,VersionState} from './engine.ts';
import type {Evidence} from './registry.ts';
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
 /** 入画人物；未记录时按全部人物计算。 */
 drawn?:string[];
 /** 模型返回的入画人物名字。 */
 drawnNames?:string[];
 redrawNote?:string;
 /** 本版读者已明确要求重新绘制此幅。 */
 redrawRequested?:true;
 image?:string;
 /** 横图：空字符串表示读者已请求、尚未生成。 */
 landscape?:string;
 /** 未完成的横图请求或故障绑定的绘图输入。 */
 landscapeInputHash?:string;
 /** 读者授权的横图重试代次，旧任务及其付费回执保留。 */
 landscapeAttempt?:number;
 /** 横图生成失败的说明；横图是可选产物，失败不阻断完成或导出。 */
 landscapeError?:string;
};
export type DagCharacter={id:string;name:string;aliases?:string[];text:string;legacy?:true};
export type DagItem={id:string;text:string;scope?:'story'|'frame';evidence?:Evidence[];legacy?:true};
/** 模型快照：提供方、模型与推理强度，不含凭据。models 中 null 表示沿用该服务自身的默认模型。 */
export type ModelSnapshot=Pick<ProviderSettingsView['runtime'],'provider'|'imageProvider'|'taskReasoningEfforts'>&{models:{text:string|null;image:string|null}};
export type DagOutline={title:string;summary:string;sourceReference:string;adaptationNote:string;beats:string[]};
/** 审片问题按结论归属；自动修订未改变内容或会破坏手改时，保留阻断原因。 */
export type DagIssue=ReviewIssue&{target:string;stalled?:true|'hand-edited'};
export type Renderer={layout:'portrait';aspectRatio:'9:16';size:'1K'};

export type DagDocument={
 version:2;
 order:string[];
 frames:Record<string,DagFrame>;
 characters:DagCharacter[];
 items:DagItem[];
 ending?:{title:string;candidates:string[];chosen?:string;confirmed?:{title:string;ending:string}};
 /** 事实梗概（准备梗概或读者手改）。 */
 brief?:string;
 outline?:DagOutline;
 /** 本轮已尝试独立画风建议，缺少该能力的服务也可继续给出制作建议。 */
 preparedArt?:true;
 /** 已确认作品重新准备时单独更新建议，隔离旧世代的制作任务。 */
 preparationGeneration?:number;
 repreparing?:true;
 frameCheck?:FrameCountReport;
 /** 各结论的说明，键为结论实例身份；结论本身记录在 products。 */
 verdicts?:Record<string,{outcome:'pass'|'fail';detail?:string;requirements?:true}>;
 /** 最近一次审片中失败结论的问题，供自动修订使用。 */
 issues?:DagIssue[];
 /** 格式 3 已保存的审片建议；此字段不参与推导。 */
 suggestions?:unknown;
 /** 本修订的自动修订额度。 */
 repairs?:RepairBudget;
 /** 本版读者跳过审核的记录，使用时重新核对绑定。 */
 reviewSkip?:ReviewSkip;
 /** 用过的画风设置，键为画风输入指纹；换画风转换据此取得旧画风。 */
 styles?:Record<string,{artStyle:Selection['artStyle'];artStylePrompt?:string|null}>;
 products:Record<string,Product>;
 modelSnapshot?:ModelSnapshot;
 renderer:Renderer;
 /** 已保存、等待「继续制作」的修订；只有 continue 清除，resume 不清除。 */
 continuation?:{revision:number;reason:'revision-saved'};
 /** 读者指定的首幅原图（换画风时）：画面描述转换完成、首幅的输入就绪后由 settle() 记为该幅的成图产物，不再绘制。 */
 cover?:{frame:string};
 /** 转换自 v1，记录按旧规则产生。 */
 legacy?:true;
 /** 旧版已有未完成成稿且原本无需审核；只延续此稿的绘图权限。 */
 resumeUnreviewed?:true;
};

export const defaultRenderer:Renderer={layout:'portrait',aspectRatio:'9:16',size:'1K'};

/** 新故事的空 dag：尚无任何产物。 */
/**
 * 选定的标题与结语：读者确认的优先，否则为标题与叙事结论选定的结语（尚未选定时取第一个候选）。
 * 依据「标题与结语」的条目绑定这一对值的指纹，标题或结语任一改变都会使其失效。
 */
export function endingChoice(ending:DagDocument['ending']):{title:string;ending:string}|undefined{
 if(ending?.confirmed)return ending.confirmed;
 const chosen=ending?.chosen??ending?.candidates[0];
 return ending&&chosen?{title:ending.title,ending:chosen}:undefined;
}

export const emptyDag=():DagDocument=>({version:2,order:[],frames:{},characters:[],items:[],products:{},renderer:defaultRenderer});

/** 由选择与 dag 计算根输入产物；缺省值先展开为实际值，保证与显式填写同指纹。 */
export function rootProducts(selection:Selection,dag:Pick<DagDocument,'items'|'modelSnapshot'|'renderer'|'ending'|'frames'|'order'>,extra:{notes?:string;seed?:unknown;refSource?:string}={}):Record<string,Product>{
 const root=(value:unknown,parts?:Record<string,string>):Product=>({hash:fingerprint(value),inputs:{},...(parts?{parts}:{})});
 const {displayTitle:_display,artStyle,artStylePrompt,productionPrompt,acceptancePrompt,narrativeDetail,length,voice:_voice,...source}=selection;
 void _display;void _voice;
 const products:Record<string,Product>={
  'selection:':root(source),
  'seed:':root(extra.seed??null),
  // 制作要求按主题规范化后的实际值计算指纹，与请求中发送的文字一致。
  'productionReq:':root(normalizeProductionPrompt(productionPrompt??'',source.theme||'')),
  'acceptanceReq:':root(acceptancePrompt??'',Object.fromEntries(dag.items.map(i=>[i.id,fingerprint(i.text)]))),
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
  items:dag.items.filter(i=>i.scope!=='frame').map(i=>i.id),
  frames:Object.fromEntries(dag.order.map(id=>[id,{drawn:dag.frames[id]?.drawn}])),
  landscapes:dag.order.filter(id=>dag.frames[id]?.landscape===''),
  products:{...dag.products,...roots},
  faults:options.faults||[],
  reprepare:options.reprepare,
  resumeUnreviewed:dag.resumeUnreviewed,
  skipFrameCheck:options.skipFrameCheck,
 };
}

/**
 * 存储投影：由 dag 生成 v1 的 plan 与 images，供阅读、导出、复制等只读方使用。
 * 全部画幅都有叙事分镜与画面描述、且已有结语候选时才有 plan；转换的旧故事没有提纲，沿用原 plan 的其余字段。
 */
export function projectDocument(dag:DagDocument,base:Plan|null=null):{plan:Plan|null;images:string[]}{
 const images=dag.order.map(id=>dag.frames[id]?.image||'');
 const pages=dag.order.map(id=>({caption:dag.frames[id]?.scene??'',prompt:dag.frames[id]?.visual??''}));
 const reflection=dag.ending?.confirmed?.ending??dag.ending?.chosen??dag.ending?.candidates[0]??base?.reflection;
 const outline=dag.outline;
 if(!pages.length||pages.some(p=>!p.caption||!p.prompt)||!reflection||!(outline||base))return {plan:null,images};
 const characters=dag.characters.map(c=>c.legacy?c.text:`${c.name}：${c.text}`).join('\n');
 return {
  plan:{
   title:dag.ending?.confirmed?.title??dag.ending?.title??outline?.title??base!.title,
   summary:dag.brief??outline?.summary??base!.summary,
   sourceReference:outline?.sourceReference??base!.sourceReference,
   adaptationNote:outline?.adaptationNote??base!.adaptationNote,
   reflection,
   characters:characters||base?.characters||'',
   pages,
  },
  images,
 };
}
