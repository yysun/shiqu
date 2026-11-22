// 文档 v2：document.dag 是制作内容与产物记录的权威来源，plan、images 是由它生成的存储投影。
// 画幅以身份为键存放，另存顺序；人物按条目、验收要求按条目保存。投影保持 v1 的 Plan 形状，
// 阅读、导出、复制等只读方继续读投影；每次保存在同一条语句中写入 dag 与投影。
import type {Plan,Selection} from '../reader-model.ts';
import type {ProviderSettingsView} from '../provider-settings.ts';
import type {FrameCountReport,ReviewIssue} from '../reader-review.ts';
import type {RepairBudget,Suggestion} from './review.ts';
import type {Product,Fault,VersionState} from './engine.ts';
import type {Evidence} from './registry.ts';
import {fingerprint} from './fingerprint.ts';

export type DagFrame={
 /** 叙事分镜正文（配文、对白与动作）。 */
 scene:string;
 /** 画面描述。 */
 visual:string;
 candidates?:string[];
 /** 入画人物；未记录时按全部人物计算。 */
 drawn?:string[];
 redrawNote?:string;
 image?:string;
 landscape?:string;
};
export type DagCharacter={id:string;name:string;aliases?:string[];text:string;legacy?:true};
export type DagItem={id:string;text:string;scope?:'story'|'frame';evidence?:Evidence[];legacy?:true};
/** 模型快照：提供方、模型与推理强度，不含凭据。models 中 null 表示沿用该服务自身的默认模型。 */
export type ModelSnapshot=Pick<ProviderSettingsView['runtime'],'provider'|'imageProvider'|'taskReasoningEfforts'>&{models:{text:string|null;image:string|null}};
export type DagOutline={title:string;summary:string;sourceReference:string;adaptationNote:string;beats:string[]};
/** 审片问题按结论归属：target 为结论实例身份（逐幅、叙事或条目）。stalled 表示自动修订后内容未变。 */
export type DagIssue=ReviewIssue&{target:string;stalled?:true};
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
 frameCheck?:FrameCountReport;
 /** 各结论的说明，键为结论实例身份；结论本身记录在 products。 */
 verdicts?:Record<string,{outcome:'pass'|'fail';detail?:string;requirements?:true}>;
 /** 最近一次审片中失败结论的问题，供自动修订使用。 */
 issues?:DagIssue[];
 suggestions?:Suggestion[];
 /** 本修订的自动修订额度。 */
 repairs?:RepairBudget;
 /** 用过的画风设置，键为画风输入指纹；换画风转换据此取得旧画风。 */
 styles?:Record<string,{artStyle:Selection['artStyle'];artStylePrompt?:string|null}>;
 products:Record<string,Product>;
 modelSnapshot?:ModelSnapshot;
 renderer:Renderer;
 /** 已保存、等待「继续制作」的修订；只有 continue 清除，resume 不清除。 */
 continuation?:{revision:number;reason:'revision-saved'};
 /** 转换自 v1，记录按旧规则产生。 */
 legacy?:true;
};

export const defaultRenderer:Renderer={layout:'portrait',aspectRatio:'9:16',size:'1K'};

/** 新故事的空 dag：尚无任何产物。 */
export const emptyDag=():DagDocument=>({version:2,order:[],frames:{},characters:[],items:[],products:{},renderer:defaultRenderer});

/** 由选择与 dag 计算根输入产物；缺省值先展开为实际值，保证与显式填写同指纹。 */
export function rootProducts(selection:Selection,dag:Pick<DagDocument,'items'|'modelSnapshot'|'renderer'|'ending'|'frames'|'order'>,extra:{notes?:string;seed?:unknown;refSource?:string}={}):Record<string,Product>{
 const root=(value:unknown,parts?:Record<string,string>):Product=>({hash:fingerprint(value),inputs:{},...(parts?{parts}:{})});
 const {displayTitle:_display,artStyle,artStylePrompt,productionPrompt,acceptancePrompt,narrativeDetail,length,voice:_voice,...source}=selection;
 void _display;void _voice;
 const products:Record<string,Product>={
  'selection:':root(source),
  'seed:':root(extra.seed??null),
  'productionReq:':root(productionPrompt??''),
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
export function versionState(dag:DagDocument,roots:Record<string,Product>,options:{confirmed:boolean;faults?:Fault[];reprepare?:boolean}):VersionState{
 return {
  confirmed:options.confirmed,
  order:dag.order,
  items:dag.items.filter(i=>i.scope!=='frame').map(i=>i.id),
  frames:Object.fromEntries(dag.order.map(id=>[id,{candidates:dag.frames[id]?.candidates,drawn:dag.frames[id]?.drawn}])),
  landscapes:dag.order.filter(id=>dag.frames[id]?.landscape!==undefined),
  products:{...dag.products,...roots},
  faults:options.faults||[],
  reprepare:options.reprepare,
 };
}

/** 存储投影：把 dag 的画幅写回 v1 的 plan.pages 与 images，其余 plan 字段沿用。 */
export function projectDocument(dag:DagDocument,plan:Plan):{plan:Plan;images:string[]}{
 const characters=dag.characters.map(c=>c.legacy?c.text:`${c.name}：${c.text}`).join('\n');
 const ending=dag.ending?.confirmed?.ending??dag.ending?.chosen??plan.reflection;
 const title=dag.ending?.confirmed?.title??dag.ending?.title??plan.title;
 return {
  plan:{...plan,title,reflection:ending,characters:characters||plan.characters,pages:dag.order.map(id=>({caption:dag.frames[id].scene,prompt:dag.frames[id].visual}))},
  images:dag.order.map(id=>dag.frames[id].image||''),
 };
}
