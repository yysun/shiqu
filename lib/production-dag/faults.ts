// 故障随修订延续：按节点实例的硬输入指纹决定延续、放弃或暂存为待匹配。
// 延续故障在新版建立新实例并记录来源，恢复动作须针对新版；上一版的恢复请求仍归上一版。
import {hardInputHash,type Fault,type VersionState} from './engine.ts';
import {nodeSpec} from './registry.ts';

export type CarryResult={carried:Fault[];awaiting:Fault[];dropped:Fault[]};

const open=(f:Fault)=>f.state==='pending'||f.state==='recovering'||f.state==='awaiting-match';

/** 提交普通修订时处理上一版未解除的故障。替换选题不调用本函数，故障不延续。 */
export function carryFaults(previous:Fault[],next:VersionState,newId:(f:Fault)=>string):CarryResult{
 const result:CarryResult={carried:[],awaiting:[],dropped:[]};
 for(const fault of previous.filter(open)){
  const decision=matchFault(fault,next);
  if(decision==='carry')result.carried.push({...fault,id:newId(fault),state:'pending',origin:fault.origin??fault.id});
  else if(decision==='awaiting')result.awaiting.push({...fault,id:newId(fault),state:'awaiting-match',origin:fault.origin??fault.id});
  else result.dropped.push(fault);
 }
 return result;
}

/** 待匹配故障在新指纹确定后、为该节点启动任务前处理。 */
export function settleAwaiting(state:VersionState):{carry:Fault[];drop:Fault[]}{
 const carry:Fault[]=[],drop:Fault[]=[];
 for(const fault of state.faults.filter(f=>f.state==='awaiting-match')){
  const decision=matchFault(fault,state);
  if(decision==='carry')carry.push({...fault,state:'pending'});
  else if(decision==='drop')drop.push(fault);
 }
 return {carry,drop};
}

function matchFault(fault:Fault,state:VersionState):'carry'|'awaiting'|'drop'{
 const exists=nodeSpec(fault.node).per!=='frame'||state.order.includes(fault.key);
 if(!exists)return 'drop';
 const current=hardInputHash(state,fault.node,fault.key);
 if(current===undefined)return 'awaiting';
 return current===fault.inputHash?'carry':'drop';
}
