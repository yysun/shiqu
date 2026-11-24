// 丢图来源按绘图硬输入跨画幅匹配，各实例独立恢复，关闭后的记录始终用于去重。
import {evaluate,type Fault,type VersionState} from './engine.ts';
import {fingerprint} from './fingerprint.ts';

const open=(fault:Fault)=>fault.state==='pending'||fault.state==='recovering';

/** 每幅独立匹配。来源在提纲与全部在制画幅的绘图硬输入齐备后才关闭。 */
export function matchImageLoss(state:VersionState,sources:Fault[],instances:Fault[]){
 const evaluation=evaluate(state);
 const frames=state.order.map(key=>{
  const frame=evaluation.instance('frameImage',key);
  return {key,readable:frame.status==='valid',inputHash:frame.hard&&fingerprint(frame.hard)};
 });
 const close=instances.flatMap<{id:string;state:'resolved'|'replaced'}>(fault=>{
  const frame=frames.find(item=>item.key===fault.key);
  if(!open(fault))return [];
  if(frame?.readable)return [{id:fault.id,state:'resolved' as const}];
  if(!frame||frame.inputHash&&fault.inputHash&&frame.inputHash!==fault.inputHash)return [{id:fault.id,state:'replaced' as const}];
  return [];
 });
 const additions:{source:Fault;key:string;inputHash:string}[]=[];
 const finished:{id:string;state:'resolved'|'replaced'}[]=[];
 for(const source of sources){
  for(const frame of frames){
   if(frame.readable||!frame.inputHash||frame.inputHash!==source.inputHash)continue;
   if(instances.some(fault=>fault.key===frame.key&&(!!fault.origin&&fault.inputHash===frame.inputHash||open(fault)&&!close.some(record=>record.id===fault.id))))continue;
   if(!additions.some(item=>item.key===frame.key))additions.push({source,key:frame.key,inputHash:frame.inputHash});
  }
  if(evaluation.instance('outline').status==='valid'&&frames.length&&frames.every(frame=>frame.readable||frame.inputHash))
   finished.push({id:source.id,state:frames.some(frame=>frame.inputHash===source.inputHash)||instances.some(fault=>fault.origin===source.id)?'resolved':'replaced'});
 }
 return {close,additions,finished};
}
