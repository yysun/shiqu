// 图片核对故障只绑定发生核对的版本和画幅。
import {evaluate,type Fault,type VersionState} from './engine.ts';
import {fingerprint} from './fingerprint.ts';

const open=(fault:Fault)=>fault.state==='pending'||fault.state==='recovering';

/** 可读的图片解除故障。当前画幅被替换或绑定输入改变时，旧故障作废。 */
export function closedImageFaults(state:VersionState,instances:Fault[]){
 const evaluation=evaluate(state);
 const frames=state.order.map(key=>{
  const frame=evaluation.instance('frameImage',key);
  return {key,readable:frame.status==='valid',inputHash:frame.hard&&fingerprint(frame.hard)};
 });
 return instances.flatMap<{id:string;state:'resolved'|'replaced'}>(fault=>{
  const frame=frames.find(item=>item.key===fault.key);
  if(!open(fault))return [];
  if(frame?.readable)return [{id:fault.id,state:'resolved' as const}];
  if(!frame||frame.inputHash&&fault.inputHash&&frame.inputHash!==fault.inputHash)return [{id:fault.id,state:'replaced' as const}];
  return [];
 });
}
