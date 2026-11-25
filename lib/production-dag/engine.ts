// 制作 DAG 的通用引擎：只读配置与版本状态，推导每个节点实例的有效性、就绪、门槛与完成。
// 纯函数，不做 I/O；调度、修订和测试共用同一套推导，规范中的修改范围表都是它的结果。
// 规则：有效 = 内容可读且记录的硬输入指纹等于当前上游指纹；首次生成须硬输入与核对输入都就绪，
// 失效重做只看硬输入；上游重算期间（硬输入未就绪）不判定复用；故障只阻断依赖它的工作。
import {nodes,nodeSpec,type NodeSpec,type InputRef,type Gate} from './registry.ts';
import {fingerprint,combine} from './fingerprint.ts';

export type Product={
 /** 产物内容指纹。 */
 hash:string;
 /** 生成时读取的硬输入指纹。 */
 inputs:Record<InputRef,string>;
 /** 可分条引用的部分，例如人物设定按人物、验收要求按条目、叙事结论的选定结语。 */
 parts?:Record<string,string>;
 readable?:boolean;
 outcome?:'pass'|'fail';
 overridden?:boolean;
 handEdited?:boolean;
};

export type Fault={id:string;node:string;key:string;state:'pending'|'recovering'|'resolved';inputHash?:string;optional?:boolean;imageLoss?:true};

export type VersionState={
 confirmed:boolean;
 /** 画幅身份序列。 */
 order:string[];
 frames:Record<string,{drawn?:string[]}>;
 products:Record<string,Product>;
 faults:Fault[];
 /** 确认后读者明确「重新准备」。 */
 reprepare?:boolean;
 /** 定长故事不做幅数与结构核对（与 v0.14.0 一致，只有「自动幅数」才核对）：该节点视为已通过，不派发。 */
 skipFrameCheck?:boolean;
};

export type Status='valid'|'missing'|'invalid'|'waiting';
export type Instance={
 node:string;key:string;id:string;
 status:Status;
 /** 本实例或其硬输入上游存在未解除的故障。 */
 blocked:boolean;
 /** 当前硬输入指纹；未就绪时为 undefined。 */
 hard?:Record<string,string>;
 check?:Record<string,string>;
 ready:boolean;
};

export const instanceId=(node:string,key='')=>`${node}:${key}`;
const verdictNodes=new Set(['frameVerdict','narrativeVerdict']);
const nullHash=fingerprint(null);

export function instanceKeys(state:VersionState,node:string):string[]{
 const spec=nodeSpec(node);
 if(spec.per==='story')return [''];
 return state.order;
}

export class Evaluation{
 private memo=new Map<string,Instance>();
 readonly state:VersionState;
 constructor(state:VersionState){this.state=state;}

 instance(node:string,key=''):Instance{
  const id=instanceId(node,key),cached=this.memo.get(id);
  if(cached)return cached;
  if(node==='frameCheck'&&this.state.skipFrameCheck){
   const skipped:Instance={node,key,id,status:'valid',blocked:false,ready:false};
   this.memo.set(id,skipped);return skipped;
  }
  const spec=nodeSpec(node),product=this.state.products[id];
  const faulted=this.state.faults.some(f=>(f.state==='pending'||f.state==='recovering')&&f.node===node&&f.key===key);
  if(spec.kind!=='model'){
   const result:Instance={node,key,id,status:'valid',blocked:false,ready:false};
   this.memo.set(id,result);return result;
  }
  const hardResolved=spec.hard.map(ref=>[ref,this.resolve(ref,key)] as const);
  const checkResolved=(spec.check||[]).map(ref=>[ref,this.resolve(ref,key)] as const);
  const hard=hardResolved.every(([,r])=>r.hash!==undefined)?Object.fromEntries(hardResolved.map(([ref,r])=>[ref,r.hash!])):undefined;
  const check=checkResolved.every(([,r])=>r.hash!==undefined)?Object.fromEntries(checkResolved.map(([ref,r])=>[ref,r.hash!])):undefined;
  const blocked=faulted||hardResolved.some(([,r])=>r.blocked);
  let status:Status;
  if(!product||product.readable===false)status='missing';
  else if(!hard)status='waiting';
  else if(product.handEdited?(node==='visual'&&product.inputs.style!==hard.style):!sameInputs(product.inputs,hard))status='invalid';
  else status='valid';
  const result:Instance={node,key,id,status,blocked,hard,check,ready:false};
  this.memo.set(id,result);
  // 首次生成须硬输入与核对输入都就绪；失效重做只看硬输入。
  // 失效重做一般只需硬输入；登记为 rerunWaitsForCheck 的节点（画幅图片）还须核对输入就绪，即等新首幅完成。
 result.ready=!blocked&&this.gateOpen(spec.gate)&&
  (status==='missing'?!!hard&&!!check:status==='invalid'&&!!hard&&(!spec.rerunWaitsForCheck||!!check));
  return result;
 }

 /** 解析输入引用为指纹；上游未有效时为 undefined。 */
 resolve(ref:InputRef,key:string):{hash?:string;blocked:boolean}{
  const [name,selector]=ref.split('@') as [string,string|undefined];
  if(name==='order')return {hash:fingerprint(this.state.order),blocked:false};
  if(name==='reference'){
   const first=this.state.order[0];
   const bookReference=this.one('refSource','');
   if(key===first||bookReference.hash!==nullHash)return bookReference;
   return this.one('frameImage',first);
  }
  if(name==='characters'&&selector==='drawn'){
   const ids=this.state.frames[key]?.drawn??[];
   const base=this.one('characters','');
   if(base.hash===undefined)return base;
   const parts=this.state.products[instanceId('characters')]?.parts||{};
   return {hash:combine(ids.map(id=>[id,parts[id]??nullHash] as const)),blocked:base.blocked};
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
  if(node==='frameCheck'&&this.state.skipFrameCheck)return {hash:nullHash,blocked:false};
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
  if(gate==='characters')return this.instance('characters').status==='valid';
  // 所有稿件就绪后，同一轮评审才能同时补齐全篇和逐幅结论。
  if(gate==='review')return this.state.order.length>0&&this.passed('frameCheck','')&&this.instance('ending').status==='valid'&&
   this.resolve('scene@all','').hash!==undefined&&this.resolve('visual@all','').hash!==undefined;
  return this.approved();
 }

 private passed(node:string,key:string){
  if(node==='frameCheck'&&this.state.skipFrameCheck)return true;
  const inst=this.instance(node,key),product=this.state.products[inst.id];
  return inst.status==='valid'&&!!product&&(product.outcome==='pass'||!!product.overridden);
 }
 /** 幅数核对、逐幅结论和全篇结论均有效且通过或已放行时可绘图。 */
 approved():boolean{
  if(!this.passed('frameCheck',''))return false;
  return [...verdictNodes].every(node=>instanceKeys(this.state,node).every(key=>this.passed(node,key)));
 }

 all():Instance[]{
  return Object.keys(nodes).filter(node=>nodeSpec(node).kind==='model').flatMap(node=>instanceKeys(this.state,node).map(key=>this.instance(node,key)));
 }

 /** 必需节点和审核都有效、且没有未解除的必需故障时完成。 */
 complete():boolean{
  if(!this.approved())return false;
  const required=this.all().filter(i=>nodeSpec(i.node).required);
  if(required.some(i=>i.status!=='valid'))return false;
  return !this.state.faults.some(f=>f.state!=='resolved'&&!f.optional&&nodeSpec(f.node).required);
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
 return evaluate(state).complete();
}

/** 图片按绘图硬输入复用，不要求画幅身份相同：在候选产物中找硬输入完全一致且可读的一份。 */
export function reusable(pool:Product[],hard:Record<string,string>):Product|undefined{
 return pool.find(p=>p.readable!==false&&sameInputs(p.inputs,hard));
}

export type Preview={resumeAt?:string;invalidatedImages:number;pending:number};

/** 保存前预估接续点及将失效的图片数。 */
export function preview(base:VersionState,next:VersionState):Preview{
 const before=evaluate(base),after=evaluate(next).all();
 const images=after.filter(i=>i.node==='frameImage');
 const invalidatedImages=images.filter(i=>i.status!=='valid'&&before.instance('frameImage',i.key).status==='valid').length;
 const pendingList=after.filter(i=>i.status!=='valid'&&nodeSpec(i.node).required);
 return {resumeAt:pendingList[0]?nodeSpec(pendingList[0].node).label:undefined,invalidatedImages,pending:pendingList.length};
}

export type {NodeSpec};
