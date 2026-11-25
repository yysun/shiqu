// 0025 与 0027 的历史制作模型。保留格式 2–3 的指纹、就绪门槛与旧故障匹配，只供迁移使用。
// 新制作用途不得导入本模块。历史回放由迁移测试维护，正式制作模型可以独立修改。
import {createHash,randomUUID} from 'node:crypto';
import type {Plan,Selection} from '../../lib/reader-model.ts';
import type {ProviderSettingsView} from '../../lib/provider-settings.ts';
import type {FrameCountReport,ReviewCheckpoint,ReviewIssue} from '../../lib/reader-review.ts';
import type {OriginalSource} from '../../lib/reader-source-types.ts';
import type {SyncStatements} from '../../lib/reader-repository.ts';
import {normalizeProductionPrompt} from '../../lib/reader-prompts.ts';
import {storyBriefVerified} from '../../lib/reader-story-brief.ts';

export type HistoricalDocument={
 dag?:DagDocument;
 plan?:Plan|null;
 draft?:Omit<Plan,'reflection'>;
 storyboard?:{outline:DagOutline&{characters:string};pages:Plan['pages']};
 images:string[];
 original?:OriginalSource;
 reflectionCandidates?:string[];
 visualReview?:ReviewCheckpoint;
 setupRequirements?:{suggestions?:unknown};
 frameRecommendation?:unknown;
 frameCountConfirmed?:boolean;
 reviewNotes?:string;
 intake?:{phase:string;generation:number};
 reselection?:unknown;
 revision?:{parentId:string;rootId:string;number:number;kind?:'selection';handoff?:boolean;redrawNotes?:Record<string,string>};
};
export type DagStory={id:string;doc:HistoricalDocument;selection:Selection;dag:DagDocument;confirmed:boolean;faults:Fault[];refSource?:string};
type RepairBudget={used:number;limit:number};

/** 永不进入指纹的展示与阅读字段。 */
const excludedFields=new Set(['displayTitle','credit','favorite','page','lastReadAt']);

function normalize(value:unknown):unknown{
 if(typeof value==='string')return value.trim();
 if(Array.isArray(value))return value.map(normalize);
 if(value&&typeof value==='object'){
  const out:Record<string,unknown>={};
  for(const key of Object.keys(value).sort()){
   const item=(value as Record<string,unknown>)[key];
   if(item===undefined||excludedFields.has(key))continue;
   out[key]=normalize(item);
  }
  return out;
 }
 return value===undefined?null:value;
}

export function fingerprint(value:unknown):string{
 return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

/** 多个输入合成一个指纹；任一项尚未就绪（undefined）时整体未就绪。 */
function combine(parts:readonly (readonly [string,string|undefined])[]):string|undefined{
 if(parts.some(([,hash])=>hash===undefined))return undefined;
 return fingerprint(parts.map(([key,hash])=>[key,hash]));
}
/** 产物粒度：story 每版一份；frame 按画幅身份；item 按全篇验收条目。 */
export type Granularity='story'|'frame'|'item';

/**
 * 输入引用。`节点` 读同一版本的故事级产物；`节点@self` 读同一画幅或条目；
 * `@window` 读本幅与相邻两幅；`@all` 按顺序读全部画幅；`characters@drawn` / `@candidates`
 * 只读本幅入画或候选人物的条目；`order` 是画幅身份序列；`reference` 是本幅实际参考图。
 */
export type InputRef=string;

/** 执行门槛：preparing 为确认前或读者明确「重新准备」，confirmed 为制作已确认，brief 为制作确认且事实梗概就绪，frameCheck 为幅数与结构核对通过，approved 为可绘图。 */
export type Gate='preparing'|'confirmed'|'brief'|'frameCheck'|'approved';

export type NodeSpec={
 label:string;
 specRow:string|null;
 per:Granularity;
 /** 读者输入、确认快照或派生值，不由模型调用产生。 */
 kind:'root'|'model'|'derived'|'annotation';
 hard:InputRef[];
 check?:InputRef[];
 /** 由验收条目登记的依据动态追加的硬输入，见 evidenceInputs。 */
 evidence?:boolean;
 /** 产生本节点的调用，对应 calls 的键；测试核对两者互相引用一致。 */
 call?:string;
 gate?:Gate;
 required:boolean;
 editable?:boolean;
 /** 只在读者请求时存在实例，例如横图。 */
 onDemand?:boolean;
 /** 失效后重做也须等核对输入就绪，例如画幅图片等新首幅完成后再以它为参考。 */
 rerunWaitsForCheck?:boolean;
};

export const nodes={
 selection:{label:'选定范围与出处版次',specRow:null,per:'story',kind:'root',hard:[],required:true},
 seed:{label:'改编重点',specRow:null,per:'story',kind:'root',hard:[],required:false},
 source:{label:'已核原文与出处',specRow:'已核原文与出处',per:'story',kind:'model',hard:['selection'],call:'verifySource',required:true},
 brief:{label:'事实梗概',specRow:'事实梗概',per:'story',kind:'model',hard:['source','productionReq'],call:'prepareBrief',required:true,editable:true},
 suggestions:{label:'两项要求建议、幅数与画风建议',specRow:'两项要求建议、幅数与画风建议',per:'story',kind:'model',hard:['source','seed'],call:'prepareSuggestions',gate:'preparing',required:false},
 productionReq:{label:'制作要求',specRow:'制作要求、验收要求、叙事详略与幅数策略、画风',per:'story',kind:'root',hard:[],required:true,editable:true},
 acceptanceReq:{label:'验收要求',specRow:'制作要求、验收要求、叙事详略与幅数策略、画风',per:'story',kind:'root',hard:[],required:true,editable:true},
 settings:{label:'叙事详略与幅数策略',specRow:'制作要求、验收要求、叙事详略与幅数策略、画风',per:'story',kind:'root',hard:[],required:true,editable:true},
 style:{label:'画风',specRow:'制作要求、验收要求、叙事详略与幅数策略、画风',per:'story',kind:'root',hard:[],required:true,editable:true},
 modelSnapshot:{label:'模型快照',specRow:'模型快照',per:'story',kind:'root',hard:[],required:true},
 renderer:{label:'绘图参数',specRow:'绘图参数',per:'story',kind:'root',hard:[],required:true,editable:true},
 outline:{label:'全篇提纲',specRow:'全篇提纲',per:'story',kind:'model',hard:['source','productionReq','settings'],call:'outline',gate:'brief',required:true},
 characters:{label:'人物设定',specRow:'人物设定',per:'story',kind:'model',hard:['source','productionReq'],call:'characters',gate:'confirmed',required:true,editable:true},
 scene:{label:'叙事分镜',specRow:'叙事分镜',per:'frame',kind:'model',hard:['outline','source','productionReq'],call:'sceneBatch',gate:'brief',required:true,editable:true},
 visual:{label:'画面描述',specRow:'画面描述',per:'frame',kind:'model',hard:['outline','productionReq','style'],check:['scene@self','characters@candidates'],call:'visual',gate:'confirmed',required:true,editable:true},
 ending:{label:'标题与结语候选',specRow:'标题与结语候选',per:'story',kind:'model',hard:['source','outline','order'],check:['scene@all'],call:'ending',gate:'confirmed',required:true,editable:true},
 frameCheck:{label:'幅数与结构核对',specRow:'幅数与结构核对',per:'story',kind:'model',hard:['source','outline','order','productionReq','settings','notes'],check:['scene@all'],call:'frameCheck',gate:'confirmed',required:true},
 notes:{label:'审核意见',specRow:'审核意见',per:'story',kind:'root',hard:[],required:false,editable:true},
 itemRegistration:{label:'验收条目登记',specRow:'验收条目',per:'item',kind:'model',hard:['item@self'],call:'registerItems',gate:'confirmed',required:true,editable:true},
 frameVerdict:{label:'逐幅审片结论',specRow:'逐幅审片结论',per:'frame',kind:'model',hard:['source','productionReq','acceptanceReq','style','notes','scene@window','visual@window','characters@drawn'],call:'review',gate:'frameCheck',required:true},
 endingConfirmed:{label:'读者确认的标题与结语',specRow:null,per:'story',kind:'root',hard:[],required:false,editable:true},
 narrativeVerdict:{label:'全篇叙事结论',specRow:'全篇叙事结论',per:'story',kind:'model',hard:['source','brief','productionReq','acceptanceReq','outline','order','ending','endingConfirmed','notes'],check:['scene@all'],call:'review',gate:'frameCheck',required:true},
 itemVerdict:{label:'全篇验收条目结论',specRow:'全篇验收条目结论',per:'item',kind:'model',hard:['source','item@self','itemRegistration@self','notes'],evidence:true,call:'review',gate:'frameCheck',required:true},
 override:{label:'明确放行',specRow:'明确放行',per:'story',kind:'annotation',hard:[],required:false},
 redrawNote:{label:'重绘说明',specRow:'重绘说明',per:'frame',kind:'root',hard:[],required:false,editable:true},
 refSource:{label:'书籍参考图或旧版画面',specRow:null,per:'story',kind:'root',hard:[],required:false},
 reference:{label:'参考图',specRow:'参考图',per:'frame',kind:'derived',hard:[],required:false},
 frameImage:{label:'画幅图片',specRow:'画幅图片',per:'frame',kind:'model',hard:['visual@self','characters@drawn','style','renderer','redrawNote@self'],check:['reference'],call:'draw',gate:'approved',required:true,rerunWaitsForCheck:true},
 landscape:{label:'横图',specRow:'横图',per:'frame',kind:'model',hard:['frameImage@self','visual@self','characters@drawn','style','renderer'],call:'drawLandscape',required:false,onDemand:true},
 complete:{label:'完整作品',specRow:'完整作品',per:'story',kind:'derived',hard:[],required:false},
} satisfies Record<string,NodeSpec>;

export const nodeSpec=(id:string):NodeSpec=>{
 const spec=(nodes as Record<string,NodeSpec>)[id];
 if(!spec)throw Error(`UNKNOWN_DAG_NODE: ${id}`);
 return spec;
};

/** 全篇验收条目登记的依据，决定条目结论追加哪些硬输入。 */
export type Evidence='scenes'|'visuals'|'order'|'ending';
export const evidenceInputs:Record<Evidence,InputRef[]>={
 scenes:['scene@all'],
 visuals:['visual@all','characters','style'],
 order:['order'],
 ending:['endingChoice'],
};
/** 未登记的条目按全部依据处理。 */
export const allEvidence:Evidence[]=['scenes','visuals','order','ending'];
export type Product={
 /** 产物内容指纹。 */
 hash:string;
 /** 生成时读取的硬输入指纹。 */
 inputs:Record<InputRef,string>;
 /** 生成时读取的核对输入指纹，变化只产生「基于旧输入」标记。 */
 checks?:Record<InputRef,string>;
 /** 可分条引用的部分，例如人物设定按人物、验收要求按条目、叙事结论的选定结语。 */
 parts?:Record<string,string>;
 readable?:boolean;
 outcome?:'pass'|'fail';
 overridden?:boolean;
 legacy?:boolean;
 /** 旧版缺少审核记录：计入完成；仅原样延续尚未完成的旧稿时授权绘图。 */
 unreviewed?:boolean;
 handEdited?:boolean;
 /** 验收条目登记：范围与依据。 */
 scope?:'story'|'frame';
 evidence?:Evidence[];
};

export type Fault={id:string;node:string;key:string;state:'pending'|'recovering'|'awaiting-match'|'resolved';inputHash?:string;optional?:boolean;origin?:string;imageLoss?:true};

export type VersionState={
 confirmed:boolean;
 /** 画幅身份序列。 */
 order:string[];
 /** 全篇验收条目身份，按验收要求的条目顺序。 */
 items:string[];
 frames:Record<string,{candidates?:string[];drawn?:string[]}>;
 /** 已请求横图的画幅。 */
 landscapes?:string[];
 products:Record<string,Product>;
 faults:Fault[];
 /** 确认后读者明确「重新准备」。 */
 reprepare?:boolean;
 resumeUnreviewed?:boolean;
 /** 定长故事不做幅数与结构核对（与 v0.14.0 一致，只有「自动幅数」才核对）：该节点视为已通过，不派发。 */
 skipFrameCheck?:boolean;
};

export type Status='valid'|'missing'|'invalid'|'waiting';
export type Instance={
 node:string;key:string;id:string;
 status:Status;
 /** 核对输入已变化：文字产物待审片确认，图片表示使用旧参考。 */
 basedOnOld:boolean;
 /** 本实例或其硬输入上游存在未解除的故障。 */
 blocked:boolean;
 /** 当前硬输入指纹；未就绪时为 undefined。 */
 hard?:Record<string,string>;
 check?:Record<string,string>;
 ready:boolean;
};

export const instanceId=(node:string,key='')=>`${node}:${key}`;
const verdictNodes=new Set(['frameVerdict','narrativeVerdict','itemVerdict']);
const nullHash=fingerprint(null);

export function instanceKeys(state:VersionState,node:string):string[]{
 const spec=nodeSpec(node);
 if(spec.per==='story')return [''];
 if(spec.per==='frame')return spec.onDemand?state.order.filter(id=>state.landscapes?.includes(id)):state.order;
 if(node==='itemVerdict')return state.items.filter(id=>state.products[instanceId('itemRegistration',id)]?.scope!=='frame');
 return state.items;
}

export class Evaluation{
 private memo=new Map<string,Instance>();
 readonly state:VersionState;
 constructor(state:VersionState){this.state=state;}

 instance(node:string,key=''):Instance{
  const id=instanceId(node,key),cached=this.memo.get(id);
  if(cached)return cached;
  if(node==='frameCheck'&&this.state.skipFrameCheck){
   const skipped:Instance={node,key,id,status:'valid',basedOnOld:false,blocked:false,ready:false};
   this.memo.set(id,skipped);return skipped;
  }
  const spec=nodeSpec(node),product=this.state.products[id];
  const faulted=this.state.faults.some(f=>(f.state==='pending'||f.state==='recovering')&&f.node===node&&f.key===key);
  if(spec.kind!=='model'){
   const result:Instance={node,key,id,status:'valid',basedOnOld:false,blocked:false,ready:false};
   this.memo.set(id,result);return result;
  }
  const hardRefs=[...spec.hard,...(spec.evidence?this.evidenceRefs(key):[])];
  // 横图绑定已保存的竖图。其文件在派发前单独核对，竖图制作的故障不阻断已授权的横图。
  const hardResolved=hardRefs.map(ref=>[ref,node==='landscape'&&ref==='frameImage@self'?
   {hash:this.state.products[instanceId('frameImage',key)]?.hash,blocked:false}:this.resolve(ref,key)] as const);
  const checkResolved=(spec.check||[]).map(ref=>[ref,this.resolve(ref,key)] as const);
  const hard=hardResolved.every(([,r])=>r.hash!==undefined)?Object.fromEntries(hardResolved.map(([ref,r])=>[ref,r.hash!])):undefined;
  const check=checkResolved.every(([,r])=>r.hash!==undefined)?Object.fromEntries(checkResolved.map(([ref,r])=>[ref,r.hash!])):undefined;
  const blocked=faulted||hardResolved.some(([,r])=>r.blocked);
  let status:Status;let basedOnOld=false;
  if(!product||product.readable===false)status='missing';
  else if(!hard)status='waiting';
  else if(!sameInputs(product.inputs,hard))status='invalid';
  else{
   status='valid';
   basedOnOld=checkResolved.some(([ref,r])=>r.hash!==undefined&&product.checks?.[ref]!==undefined&&product.checks[ref]!==r.hash);
   if(basedOnOld&&verdictNodes.has(node))status='invalid';
  }
  const result:Instance={node,key,id,status,basedOnOld,blocked,hard,check,ready:false};
  this.memo.set(id,result);
  // 首次生成须硬输入与核对输入都就绪；失效重做只看硬输入。
  // 失效重做一般只需硬输入；登记为 rerunWaitsForCheck 的节点（画幅图片）还须核对输入就绪，即等新首幅完成。
 result.ready=(!spec.onDemand||!!this.state.landscapes?.includes(key))&&!blocked&&this.gateOpen(spec.gate)&&
  (status==='missing'?!!hard&&!!check:status==='invalid'&&!!hard&&(!spec.rerunWaitsForCheck||!!check));
  return result;
 }

 private evidenceRefs(key:string):InputRef[]{
  const registration=this.state.products[instanceId('itemRegistration',key)];
  const evidence=registration?.evidence?.length?registration.evidence:allEvidence;
  return evidence.flatMap(e=>evidenceInputs[e]);
 }

 /** 解析输入引用为指纹；上游未有效时为 undefined。 */
 resolve(ref:InputRef,key:string):{hash?:string;blocked:boolean}{
  const [name,selector]=ref.split('@') as [string,string|undefined];
  if(name==='order')return {hash:fingerprint(this.state.order),blocked:false};
  if(name==='endingChoice'){
   const confirmed=this.state.products[instanceId('endingConfirmed')];
   if(confirmed&&confirmed.hash!==nullHash)return {hash:confirmed.hash,blocked:false};
   const verdict=this.instance('narrativeVerdict');
   const choice=this.state.products[verdict.id]?.parts?.endingChoice;
   return {hash:verdict.status==='valid'?choice:undefined,blocked:verdict.blocked};
  }
  if(name==='reference'){
   const first=this.state.order[0];
   const bookReference=this.one('refSource','');
   if(key===first||bookReference.hash!==nullHash)return bookReference;
   return this.one('frameImage',first);
  }
  if(name==='characters'&&selector){
   const list=this.state.frames[key]?.[selector==='drawn'?'drawn':'candidates'];
   const base=this.one('characters','');
   if(base.hash===undefined)return base;
   const parts=this.state.products[instanceId('characters')]?.parts||{};
   const ids=list??Object.keys(parts);
   return {hash:combine(ids.map(id=>[id,parts[id]??nullHash] as const)),blocked:base.blocked};
  }
  if(name==='item'){
   const parts=this.state.products[instanceId('acceptanceReq')]?.parts||{};
   return {hash:parts[key]??nullHash,blocked:false};
  }
  if(!selector)return this.one(name,'');
  if(selector==='self')return this.one(name,key);
  if(selector==='window'||selector==='all'){
   const at=this.state.order.indexOf(key);
   const keys=selector==='all'?this.state.order:[this.state.order[at-1],key,this.state.order[at+1]].filter((k):k is string=>!!k);
   const parts=keys.map(k=>[k,this.one(name,k)] as const);
   return {hash:combine(parts.map(([k,r])=>[k,r.hash] as const)),blocked:parts.some(([,r])=>r.blocked)};
  }
  throw Error(`UNKNOWN_DAG_SELECTOR: ${ref}`);
 }

 private one(node:string,key:string):{hash?:string;blocked:boolean}{
  const spec=nodeSpec(node),product=this.state.products[instanceId(node,key)];
  if(spec.kind==='root')return {hash:product?.hash??nullHash,blocked:false};
  const inst=this.instance(node,key);
  return {hash:inst.status==='valid'?product!.hash:undefined,blocked:inst.blocked};
 }

 gateOpen(gate?:Gate):boolean{
  if(!gate)return true;
  if(gate==='preparing')return !this.state.confirmed||!!this.state.reprepare;
  if(!this.state.confirmed)return false;
  if(gate==='confirmed')return true;
  if(gate==='brief')return this.instance('brief').status==='valid';
  // 定长故事没有幅数核对：审片仍等结语就绪（核对原本与结语同一轮完成），保持一次审片调用。
  if(gate==='frameCheck')return this.state.skipFrameCheck?this.instance('ending').status==='valid':this.passed('frameCheck','');
  return this.approved(false);
 }

 private passed(node:string,key:string){
  if(node==='frameCheck'&&this.state.skipFrameCheck)return true;
  const inst=this.instance(node,key),product=this.state.products[inst.id];
  return inst.status==='valid'&&!!product&&(product.outcome==='pass'||!!product.overridden);
 }
 private accepted(node:string,key:string,forCompletion:boolean){
  const product=this.state.products[instanceId(node,key)];
  return this.passed(node,key)&&(forCompletion||this.state.resumeUnreviewed||!product?.unreviewed);
 }

 /**
  * 可绘图：幅数与结构核对通过，且全部审片结论有效并通过或被放行。
  * forCompletion 为真时接受旧版无审核记录的完成记录，只用于整篇完成判定。
  */
 approved(forCompletion=false):boolean{
  if(!this.accepted('frameCheck','',forCompletion))return false;
  return [...verdictNodes].every(node=>instanceKeys(this.state,node).every(key=>this.accepted(node,key,forCompletion)));
 }

 all():Instance[]{
  return Object.keys(nodes).filter(node=>nodeSpec(node).kind==='model').flatMap(node=>instanceKeys(this.state,node).map(key=>this.instance(node,key)));
 }
}

const sameInputs=(a:Record<string,string>,b:Record<string,string>)=>{
 const ka=Object.keys(a),kb=Object.keys(b);
 return ka.length===kb.length&&kb.every(k=>a[k]===b[k]);
};

export const evaluate=(state:VersionState)=>new Evaluation(state);

/** 当前可以运行的实例；调度只需按调用分组提交。 */
export function runnable(state:VersionState):Instance[]{
 return evaluate(state).all().filter(i=>i.ready);
}

/** 整篇完成：必需节点全部有效、可绘图、必需节点没有未解除故障；可选产物不影响。 */
export function complete(state:VersionState):boolean{
 const evaluation=evaluate(state);
 if(!evaluation.approved(true))return false;
 const required=evaluation.all().filter(i=>nodeSpec(i.node).required);
 if(required.some(i=>i.status!=='valid'))return false;
 return !state.faults.some(f=>f.state!=='resolved'&&!f.optional&&nodeSpec(f.node).required);
}
export type DagFrame={
 /** 叙事分镜正文（配文、对白与动作）。 */
 scene:string;
 /** 画面描述。 */
 visual:string;
 candidates?:string[];
 /** 入画人物；未记录时按全部人物计算。 */
 drawn?:string[];
 /** 模型返回的涉及人物与入画人物名字；保存人物设定时据此重新匹配条目。 */
 people?:string[];
 drawnNames?:string[];
 redrawNote?:string;
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
  frames:Object.fromEntries(dag.order.map(id=>[id,{candidates:dag.frames[id]?.candidates,drawn:dag.frames[id]?.drawn}])),
  landscapes:dag.order.filter(id=>dag.frames[id]?.landscape===''),
  products:{...dag.products,...roots},
  faults:options.faults||[],
  reprepare:options.reprepare,
  resumeUnreviewed:dag.resumeUnreviewed,
  skipFrameCheck:options.skipFrameCheck,
 };
}
export const legacyFrameId=(index:number)=>`legacy-${index+1}`;
const legacyId='legacy';

type Extra=Partial<Pick<Product,'outcome'|'overridden'|'parts'|'scope'|'evidence'|'unreviewed'>>;

export function convertDocument(doc:HistoricalDocument,selection:Selection,options:{confirmed:boolean;modelSnapshot?:ModelSnapshot;notes?:string}):DagDocument{
 const plan=doc.plan,pages=plan?.pages??doc.storyboard?.pages??doc.draft?.pages??[];
 const outlineBase=plan??doc.draft;
 // 只存了部分分镜（提纲已定、批次未完）时，未保存的幅位也占位：其叙事分镜待生成，不能丢掉。
 const slots=!plan&&!doc.draft&&doc.storyboard?Math.max(pages.length,doc.storyboard.outline.beats.length):pages.length;
 const order=Array.from({length:slots},(_,i)=>legacyFrameId(i));
 const redraw=doc.revision?.redrawNotes as Record<string,string>|undefined;
 // 提纲与梗概写入 dag，修订、结语、幅数核对与审片读取它们；没有提纲记录的旧成稿或短篇分镜草稿以各幅配文作节点。
 const outline=doc.storyboard?.outline?{title:doc.storyboard.outline.title,summary:doc.storyboard.outline.summary,sourceReference:doc.storyboard.outline.sourceReference,adaptationNote:doc.storyboard.outline.adaptationNote,beats:doc.storyboard.outline.beats}
  :outlineBase?{title:outlineBase.title,summary:outlineBase.summary,sourceReference:outlineBase.sourceReference,adaptationNote:outlineBase.adaptationNote,beats:pages.map(p=>p.caption)}:undefined;
 const characters=plan?.characters??doc.draft?.characters??doc.storyboard?.outline.characters;
 const brief=plan?.summary||doc.draft?.summary||(!doc.original?.storyBrief||storyBriefVerified(doc.original)?doc.storyboard?.outline.summary:undefined)||
  (storyBriefVerified(doc.original)?doc.original?.storyBrief?.summary:undefined);
 const dag:DagDocument={
  version:2,legacy:true,order,
  ...(outline?{outline}:{}),...(brief?{brief}:{}),
  frames:Object.fromEntries(order.map((id,i)=>[id,{
   scene:pages[i]?.caption??'',visual:pages[i]?.prompt??'',
   ...(doc.images[i]?{image:doc.images[i]}:{}),
   ...(redraw?.[i+1]?{redrawNote:redraw[i+1]}:{}),
  }])),
  characters:characters?[{id:legacyId,name:'',text:characters,legacy:true}]:[],
  items:selection.acceptancePrompt?.trim()?[{id:legacyId,text:selection.acceptancePrompt,scope:'story',evidence:['scenes','visuals'],legacy:true}]:[],
  ...(plan?{ending:{title:plan.title,candidates:doc.reflectionCandidates??[plan.reflection],chosen:plan.reflection}}:{}),
  products:{},
  ...(options.modelSnapshot?{modelSnapshot:options.modelSnapshot}:{}),
  renderer:defaultRenderer,
  ...(doc.revision?.handoff?{continuation:{revision:doc.revision.number??1,reason:'revision-saved' as const}}:{}),
 };

 const review=doc.visualReview;
 const countReport=review?.frameCountReports?.at(-1);
 const failedCount=selection.length==='auto'&&review?.phase==='frames'&&countReport&&countReport.frameCountReview.decision!=='keep'&&['repair','blocked'].includes(review.status);
 const reviewed=!failedCount&&(review?.status==='passed'||review?.status==='blocked');
 const hasLegacyApproval=!review&&!!plan&&pages.length>0;
 if(hasLegacyApproval&&!pages.every((_,i)=>!!doc.images[i]))dag.resumeUnreviewed=true;
 if(countReport&&(failedCount||review?.phase==='full'||reviewed))dag.frameCheck=countReport;
 if(failedCount)dag.issues=countReport.issues.map(issue=>({...issue,target:'frameCheck:',...(review.status==='blocked'?{stalled:true as const}:{})}));
 const blockedPages=new Set(review?.status==='blocked'?review.issues.map(i=>i.page):[]);
 const verdict=(failing:boolean):Extra|undefined=>reviewed?{outcome:failing?'fail':'pass',...(review?.overridden?{overridden:true}:{})}:hasLegacyApproval?{outcome:'pass',unreviewed:true}:undefined;

 // 各节点实例在 v1 中的内容；undefined 表示该产物尚未产生。
 const content=(node:string,key:string):[unknown,Extra?]|undefined=>{
  const at=order.indexOf(key);
  switch(node){
   case 'source':return doc.original?[doc.original]:undefined;
   case 'brief':return dag.brief?[dag.brief]:undefined;
   case 'suggestions':return doc.setupRequirements?.suggestions||doc.frameRecommendation?[{requirements:doc.setupRequirements?.suggestions??null,frames:doc.frameRecommendation??null}]:undefined;
   case 'outline':return dag.outline?[dag.outline]:undefined;
   case 'characters':return dag.characters.length?[dag.characters,{parts:{[legacyId]:fingerprint(dag.characters[0].text)}}]:undefined;
   case 'scene':return at>=0&&pages[at]?[pages[at].caption]:undefined;
   case 'visual':return at>=0&&pages[at]?[pages[at].prompt]:undefined;
   case 'ending':return dag.ending?[{title:dag.ending.title,candidates:dag.ending.candidates}]:undefined;
   case 'frameCheck':return failedCount?[countReport,{outcome:'fail'}]
    :reviewed||review?.phase==='full'?[countReport??'legacy-frame-check',{outcome:'pass',...(review?.overridden?{overridden:true}:{})}]
    :hasLegacyApproval?['legacy-frame-check',{outcome:'pass',unreviewed:true}]:undefined;
   case 'itemRegistration':return key===legacyId&&dag.items.length?[dag.items[0].text,{scope:'story',evidence:['scenes','visuals']}]:undefined;
   case 'frameVerdict':{const v=verdict(blockedPages.has(at+1));return v?['legacy-verdict',v]:undefined;}
   case 'narrativeVerdict':{const v=verdict(blockedPages.has(0));return v&&plan?['legacy-verdict',{...v,parts:{endingChoice:fingerprint({title:plan.title,ending:plan.reflection})}}]:undefined;}
   case 'itemVerdict':{const v=verdict(review?.stopReason==='requirements');return v?['legacy-verdict',v]:undefined;}
   case 'frameImage':return at>=0&&doc.images[at]?[doc.images[at]]:undefined;
   default:return undefined;
  }
 };

 const roots=rootProducts(selection,dag,{notes:options.notes});
 // 按配置顺序逐个节点写入；每个实例以当前上游指纹为硬输入，因此转换结果全部有效。
 for(const node of Object.keys(nodes)){
  if(nodeSpec(node).kind!=='model')continue;
  const keys=instanceKeys(versionState(dag,roots,{confirmed:options.confirmed}),node);
  for(const key of keys){
   const found=content(node,key);
   if(!found)continue;
   const inst=evaluate(versionState(dag,roots,{confirmed:options.confirmed})).instance(node,key);
   if(!inst.hard)continue;
   dag.products[instanceId(node,key)]={hash:fingerprint(found[0]),inputs:inst.hard,...(inst.check&&Object.keys(inst.check).length?{checks:inst.check}:{}),legacy:true,...found[1]};
  }
 }
 return dag;
}

export type LegacyFault={id:string;kind:string;page:number|null;state:string};

/**
 * 未结的旧故障映射到新节点，版本记为 legacy。图片相关故障按页码（从 0 开始）映射到画幅身份；
 * 没有页码的旧文字步骤故障挂到转换后下一个可运行的节点上，即当初失败的那一步，避免继续时被静默重试。
 */
export function mapLegacyFaults(faults:LegacyFault[],state:VersionState):(Fault&{version:'legacy'})[]{
 const next=runnable(state)[0];
 return faults.filter(f=>f.state==='pending'||f.state==='recovering').flatMap(f=>{
  const base={id:f.id,state:f.state as Fault['state'],version:'legacy' as const};
  if(f.page===null||f.page===undefined)return next?[{...base,node:next.node,key:next.key}]:[];
  const key=state.order[f.page];
  if(!key)return [];
  return f.kind==='landscape-image'?[{...base,node:'landscape',key,optional:true}]:[{...base,node:'frameImage',key}];
 });
}
export type ReviewSkip={faultId:string;recordedAt:string;binding:string;targets:string[]};

function skipBasis(state:VersionState,dag:DagDocument){
 if(!dag.ending?.confirmed)return null;
 const ev=evaluate(state);
 if(!state.skipFrameCheck){
  const count=ev.instance('frameCheck');
  if(count.status!=='valid'||state.products[count.id]?.outcome!=='pass')return null;
 }
 const registration=dag.items.map(item=>[item,ev.instance('itemRegistration',item.id),state.products[instanceId('itemRegistration',item.id)]] as const);
 if(registration.some(([,instance])=>instance.status!=='valid'))return null;
 const verdicts=ev.all().filter(item=>verdictNodes.has(item.node));
 if(!verdicts.length||verdicts.some(item=>!item.hard))return null;
 const pending=verdicts.filter(item=>item.status!=='valid');
 if(!pending.length)return null;
 const binding=fingerprint([verdicts.map(item=>[item.id,item.hard]),registration.map(([item,,value])=>[item,value]),
  dag.ending.confirmed,state.skipFrameCheck?null:[dag.frameCheck,state.products['frameCheck:']]]);
 return {binding,pending};
}

export function activeReviewSkip(state:VersionState,dag:DagDocument){
 const record=dag.reviewSkip;
 if(!record)return null;
 const basis=skipBasis(state,dag);
 return basis&&basis.binding===record.binding&&basis.pending.every(item=>record.targets.includes(item.id))?basis:null;
}

export function withReviewSkip(state:VersionState,dag:DagDocument):VersionState{
 const active=activeReviewSkip(state,dag);
 if(!active)return state;
 const products={...state.products};
 for(const item of active.pending){
  const product:Product={hash:fingerprint([item.id,active.binding]),inputs:item.hard!,checks:item.check,outcome:'fail',overridden:true};
  products[item.id]=product;
 }
 return {...state,products};
}
export function stateOf(story:DagStory):VersionState{
 const reprepare=!!story.dag.repreparing;
 const preparing=reprepare||story.doc.intake?.phase==='preparing'||story.doc.intake?.phase==='confirming';
 const seed=preparing?{generation:story.dag.preparationGeneration??story.doc.intake?.generation,production:normalizeProductionPrompt(story.selection.productionPrompt||'',story.selection.theme||''),detail:story.selection.narrativeDetail}:undefined;
 const roots=rootProducts(story.selection,story.dag,{notes:story.doc.reviewNotes,refSource:story.refSource,seed});
 // 横图局部失败也须读者明确重试，查看作品或重建队列不能自动重新购买。
 const landscapeFaults=story.dag.order.flatMap((key):Fault[]=>story.dag.frames[key]?.landscape===''&&story.dag.frames[key].landscapeError?
  [{id:`landscape:${key}`,node:'landscape',key,state:'pending',optional:true}]:[]);
 const state=versionState(story.dag,roots,{confirmed:story.confirmed,faults:[...story.faults,...landscapeFaults],reprepare,skipFrameCheck:typeof story.selection.length==='number'});
 if(state.landscapes?.some(key=>story.dag.frames[key].landscapeInputHash)){
  const evaluation=evaluate(state);
  state.landscapes=state.landscapes.filter(key=>{
   const binding=story.dag.frames[key].landscapeInputHash;
   const hard=binding?evaluation.instance('landscape',key).hard:undefined;
   return !hard||fingerprint(hard)===binding;
  });
 }
 return withReviewSkip(state,story.dag);
}
export type CarriedFault={id:string;kind:string;node:string;node_key:string;message:string;image:string|null;input_hash:string|null;origin_fault_id:string|null;optional:number;created_at:number};
export type FaultToCarry=CarriedFault&{payload:string|null};
export const recordedFaultRows=`SELECT f.id,f.kind,f.node,f.node_key,f.message,f.image,f.input_hash,f.origin_fault_id,f.optional,f.created_at,j.payload
 FROM reader_faults f LEFT JOIN production_jobs j ON j.id=f.job_id AND j.session_id=f.session_id AND j.owner_id=f.owner_id
 WHERE f.session_id=? AND f.owner_id=? AND f.node IS NOT NULL`;
/**
 * 逐个延续输入未变的故障实例。批量故障拆成具体节点与键保存，保留原故障编号，供读者一次恢复该批留下的目标。
 */
export function carryFaults(faults:FaultToCarry[],parent:DagStory,child:DagStory):CarriedFault[]{
 if(!faults.length)return [];
 const before=evaluate(stateOf(parent)),after=evaluate(stateOf(child));
 return faults.flatMap(({payload,...fault})=>{
  if(fault.kind==='image-loss'&&fault.node==='frameImage'){
   const product=parent.dag.products[instanceId(fault.node,fault.node_key)];
   const input_hash=fault.input_hash??(product?fingerprint(product.inputs):null);
   if(input_hash)return [{...fault,input_hash}];
  }
  let instances:Pick<Instance,'node'|'key'|'hard'>[]=[{node:fault.node,key:fault.node_key}];
  try{
   const recorded=payload?(JSON.parse(payload) as {work?:{instances?:Instance[]}}).work?.instances:undefined;
   if(recorded?.length)instances=recorded;
  }catch{/* 沿用记录的节点 */}
  return instances.flatMap(({node,key,hard})=>{
   try{
    if(!instanceKeys(after.state,node).includes(key)){
     if(node==='frameImage'&&fault.origin_fault_id&&fault.input_hash&&!before.state.order.includes(key)&&
        carriedJobFaultState(before,fault)==='awaiting-match')return [{...fault,input_hash:fault.input_hash}];
     return [];
    }
    const inputs=hard??before.instance(node,key).hard,instance=after.instance(node,key),current=instance.hard;
    if(fault.kind==='image-loss')return fingerprint(inputs??null)===fingerprint(current??null)?[{...fault,node,node_key:key}]:[];
    const input_hash=fault.input_hash??(inputs?fingerprint(inputs):null);
    if(!input_hash||(!current?instance.status==='valid':input_hash!==fingerprint(current)))return [];
    return [{...fault,node,node_key:key,input_hash}];
   }catch{return [];}
  });
 });
}

/** 仅对从原任务继承且绑定了输入的故障重新匹配；原任务故障仍由任务及读者命令管理。 */
function carriedJobFaultState(evaluation:Evaluation,fault:Pick<CarriedFault,'node'|'node_key'|'input_hash'>){
 const {node,node_key:key,input_hash:hash}=fault;
 if(!node||!hash)return 'replaced';
 if(!instanceKeys(evaluation.state,node).includes(key))return node==='frameImage'?'awaiting-match':'replaced';
 const instance=evaluation.instance(node,key);
 if(!instance.hard)return instance.status==='valid'?'replaced':'awaiting-match';
 return fingerprint(instance.hard)===hash?'pending':'replaced';
}

export function insertCarriedJobFault(db:SyncStatements,sessionId:string,ownerId:string,fault:CarriedFault,now:number,createdAt=now){
 db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,input_hash,origin_fault_id,optional,version,image,message,created_at,updated_at) VALUES(?,?,?,'job',?,?,?,?,?,'dag',NULL,?,?,?)",
  randomUUID(),sessionId,ownerId,fault.node,fault.node_key,fault.input_hash,fault.origin_fault_id??fault.id,fault.optional,fault.message,createdAt,now);
}
