// 修订故障继承原调用的硬输入指纹，输入暂未齐备时仍保留阻断；调度和领取按当前指纹解除已失效的阻断。
import {randomUUID} from 'node:crypto';
import {evaluate,instanceId,instanceKeys,type Evaluation,type Instance} from '../lib/production-dag/engine.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {stateOf,type DagStory} from '../lib/production-dag/runner.ts';
import {verdictNodes} from '../lib/production-dag/review.ts';
import type {SyncStatements} from '../lib/reader-repository.ts';
import type {ReaderFault} from './reader-commands.ts';

export type CarriedFault={id:string;kind:string;node:string;node_key:string;message:string;image:string|null;input_hash:string|null;origin_fault_id:string|null;optional:number;created_at:number};
export type FaultToCarry=CarriedFault&{payload:string|null};
export const recordedFaultRows=`SELECT f.id,f.kind,f.node,f.node_key,f.message,f.image,f.input_hash,f.origin_fault_id,f.optional,f.created_at,j.payload
 FROM reader_faults f LEFT JOIN production_jobs j ON j.id=f.job_id AND j.session_id=f.session_id AND j.owner_id=f.owner_id
 WHERE f.session_id=? AND f.owner_id=? AND f.node IS NOT NULL`;
export const carriedFaultRows=recordedFaultRows+" AND f.state IN ('pending','recovering','awaiting-match')";
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
    if(!instanceKeys(after.state,node).includes(key))return [];
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
export function carriedJobFaultState(evaluation:Evaluation,fault:Pick<ReaderFault,'node'|'node_key'|'input_hash'>){
 const {node,node_key:key,input_hash:hash}=fault;
 if(!node||!hash||!instanceKeys(evaluation.state,node).includes(key))return 'replaced';
 const instance=evaluation.instance(node,key);
 if(!instance.hard)return instance.status==='valid'?'replaced':'awaiting-match';
 return fingerprint(instance.hard)===hash?'pending':'replaced';
}

export const isCarriedReviewFault=(fault:ReaderFault)=>fault.kind==='job'&&!fault.job_id&&!!fault.origin_fault_id&&
 verdictNodes.some(node=>node===fault.node);

export function reconcileCarriedJobFaults(db:SyncStatements,ownerId:string,story:DagStory,now:number){
 const rows=db.all<ReaderFault>(`SELECT * FROM reader_faults WHERE session_id=? AND owner_id=? AND state='pending'
  AND kind='job' AND job_id IS NULL AND origin_fault_id IS NOT NULL AND input_hash IS NOT NULL`,story.id,ownerId);
 if(!rows.length)return;
 const evaluation=evaluate(stateOf(story));
 for(const row of rows)if(carriedJobFaultState(evaluation,row)==='replaced'){
  db.run("UPDATE reader_faults SET state='replaced',updated_at=? WHERE id=?",now,row.id);
 }
}

export function insertCarriedJobFault(db:SyncStatements,sessionId:string,ownerId:string,fault:CarriedFault,now:number,createdAt=now){
 db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,input_hash,origin_fault_id,optional,version,image,message,created_at,updated_at) VALUES(?,?,?,'job',?,?,?,?,?,'dag',NULL,?,?,?)",
  randomUUID(),sessionId,ownerId,fault.node,fault.node_key,fault.input_hash,fault.origin_fault_id??fault.id,fault.optional,fault.message,createdAt,now);
}
