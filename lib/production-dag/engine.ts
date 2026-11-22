// 制作 DAG 的通用引擎：只读配置与版本状态，推导每个节点实例的有效性、就绪、门槛与完成。
// 纯函数，不做 I/O；调度、修订和测试共用同一套推导，规范中的修改范围表都是它的结果。
// 规则：有效 = 内容可读且记录的硬输入指纹等于当前上游指纹；首次生成须硬输入与核对输入都就绪，
// 失效重做只看硬输入；上游重算期间（硬输入未就绪）不判定复用；故障只阻断依赖它的工作。
import {nodes,nodeSpec,evidenceInputs,allEvidence,type NodeSpec,type InputRef,type Evidence,type Gate} from './registry.ts';
import {fingerprint,combine} from './fingerprint.ts';

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
 /** 旧版缺少审核记录、但整篇已完成：计入完成判定，不授权新的绘图。 */
 unreviewed?:boolean;
 handEdited?:boolean;
 /** 验收条目登记：范围与依据。 */
 scope?:'story'|'frame';
 evidence?:Evidence[];
};

export type Fault={id:string;node:string;key:string;state:'pending'|'recovering'|'awaiting-match';inputHash?:string;optional?:boolean;origin?:string};

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
  const spec=nodeSpec(node),product=this.state.products[id];
  const faulted=this.state.faults.some(f=>f.node===node&&f.key===key);
  if(spec.kind!=='model'){
   const result:Instance={node,key,id,status:'valid',basedOnOld:false,blocked:false,ready:false};
   this.memo.set(id,result);return result;
  }
  const hardRefs=[...spec.hard,...(spec.evidence?this.evidenceRefs(key):[])];
  const hardResolved=hardRefs.map(ref=>[ref,this.resolve(ref,key)] as const);
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
 result.ready=!blocked&&this.gateOpen(spec.gate)&&(status==='missing'?!!hard&&!!check:status==='invalid'&&!!hard&&(!spec.rerunWaitsForCheck||!!check));
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
   if(key===first)return this.one('refSource','');
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
  if(gate==='frameCheck')return this.passed('frameCheck','');
  return this.approved(false);
 }

 private passed(node:string,key:string){
  const inst=this.instance(node,key),product=this.state.products[inst.id];
  return inst.status==='valid'&&!!product&&(product.outcome==='pass'||!!product.overridden);
 }
 private accepted(node:string,key:string,forCompletion:boolean){
  const product=this.state.products[instanceId(node,key)];
  return this.passed(node,key)&&(forCompletion||!product?.unreviewed);
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

/** 本实例当前硬输入的合成指纹，用于任务身份与故障延续；未就绪时为 undefined。 */
export function hardInputHash(state:VersionState,node:string,key=''):string|undefined{
 const hard=evaluate(state).instance(node,key).hard;
 return hard?fingerprint(hard):undefined;
}

export function jobIdentity(sessionId:string,node:string,key:string,inputs:Record<string,string>){
 return fingerprint(['dag-job',sessionId,node,key,inputs]);
}

/** 整篇完成：必需节点全部有效、可绘图、必需节点没有未解除故障；可选产物不影响。 */
export function complete(state:VersionState):boolean{
 const evaluation=evaluate(state);
 if(!evaluation.approved(true))return false;
 const required=evaluation.all().filter(i=>nodeSpec(i.node).required);
 if(required.some(i=>i.status!=='valid'))return false;
 return !state.faults.some(f=>!f.optional&&nodeSpec(f.node).required);
}

/** 图片按绘图硬输入复用，不要求画幅身份相同：在候选产物中找硬输入完全一致且可读的一份。 */
export function reusable(pool:Product[],hard:Record<string,string>):Product|undefined{
 return pool.find(p=>p.readable!==false&&sameInputs(p.inputs,hard));
}

export type Preview={resumeAt?:string;invalidatedImages:number;oldReference:number;pending:number};

/** 保存前预估：接续点、将失效的图片数与使用旧参考的画幅数。 */
export function preview(base:VersionState,next:VersionState):Preview{
 const before=evaluate(base),after=evaluate(next).all();
 const images=after.filter(i=>i.node==='frameImage');
 const invalidatedImages=images.filter(i=>i.status!=='valid'&&before.instance('frameImage',i.key).status==='valid').length;
 const oldReference=images.filter(i=>i.status==='valid'&&i.basedOnOld).length;
 const pendingList=after.filter(i=>i.status!=='valid'&&nodeSpec(i.node).required);
 return {resumeAt:pendingList[0]?nodeSpec(pendingList[0].node).label:undefined,invalidatedImages,oldReference,pending:pendingList.length};
}

export type {NodeSpec};
