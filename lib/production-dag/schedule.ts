// 调度分组：把可运行实例按调用合并成批次，调度器与测试替身共用，确保调用数一致。
// 逐幅调用按画幅顺序每批最多 batch 幅，同批相邻画幅可互作衔接参考；审片每阶段一次，第二阶段等第一阶段完成。
// 未设置 batch 的调用逐实例执行。画面描述的转换或修订等替代调用由调度器经 callFor 指定，批量上限取所选调用。
import type {Evaluation,Instance} from './engine.ts';
import {calls,nodeSpec,type CallSpec} from './registry.ts';
import {reviewStage} from './review.ts';

export type CallGroup={call:string;stage?:1|2;instances:Instance[]};

const defaultCall=(instance:Instance)=>nodeSpec(instance.node).call!;

export function callGroups(evaluation:Evaluation,callFor:(instance:Instance)=>string=defaultCall):CallGroup[]{
 const {state}=evaluation;
 const position=new Map(state.order.map((id,i)=>[id,i]));
 const ready=evaluation.all().filter(i=>i.ready&&nodeSpec(i.node).call);
 const grouped=new Map<string,{call:string;stage?:1|2;instances:Instance[]}>();
 for(const instance of ready){
  const call=callFor(instance);
  const stage=call==='review'?reviewStage(state,instance):undefined;
  const key=stage?`${call}#${stage}`:call;
  if(!grouped.has(key))grouped.set(key,{call,...(stage?{stage}:{}),instances:[]});
  grouped.get(key)!.instances.push(instance);
 }
 // 第二阶段审片绑定第一阶段选定的结语，须等第一阶段本轮完成。
 if(grouped.has('review#1'))grouped.delete('review#2');
 const result:CallGroup[]=[];
 for(const group of grouped.values()){
  const batch=(calls as Record<string,CallSpec>)[group.call]?.batch;
  if(batch==='stage'){result.push(group);continue;}
  const size=batch||1;
  const instances=[...group.instances].sort((a,b)=>(position.get(a.key)??-1)-(position.get(b.key)??-1));
  for(let i=0;i<instances.length;i+=size)result.push({...group,instances:instances.slice(i,i+size)});
 }
 return result;
}
