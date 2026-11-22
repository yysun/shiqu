// 手改保护：保存会使含手改的产物失效时给出处理选项；自动结构修订提交前检查手改损失。
// 换画风转换与修订保留画幅，可以手改为基准；重新编排产生新画幅，只能放弃或取消保存。
import {evaluate,type VersionState} from './engine.ts';

export type HandEditChoice={id:string;options:('use-as-base'|'discard'|'cancel')[]};

export function handEditChoices(base:VersionState,next:VersionState):HandEditChoice[]{
 const after=evaluate(next);
 const replan=after.instance('outline').status!=='valid';
 return Object.entries(base.products).filter(([,p])=>p.handEdited).flatMap(([id])=>{
  const [node,key]=id.split(':') as [string,string];
  const inst=after.instance(node,key);
  if(inst.status==='valid')return [];
  const options:HandEditChoice['options']=replan&&(node==='scene'||node==='visual')?['discard','cancel']:['use-as-base','discard'];
  return [{id,options}];
 });
}

export type StructureOps={deleted?:string[];merged?:string[][];split?:string[];rewritten?:string[]};

/** 自动结构修订会删除、合并、拆分或改写含手改的画幅时，返回受影响的画幅，修订须停在「需读者处理」。 */
export function structuralLoss(state:VersionState,ops:StructureOps):string[]{
 const edited=new Set(state.order.filter(id=>state.products[`scene:${id}`]?.handEdited||state.products[`visual:${id}`]?.handEdited));
 const touched=[...(ops.deleted||[]),...(ops.merged||[]).flat(),...(ops.split||[]),...(ops.rewritten||[])];
 return [...new Set(touched.filter(id=>edited.has(id)))];
}
