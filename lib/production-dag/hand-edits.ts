// 按原稿幅号报告结构变化会移除的手改，保存与自动结构修订共用。
import type {DagDocument} from './document.ts';
import type {LostHandEdit} from '../reader-revision.ts';

export function structuralLoss(dag:DagDocument,retired:readonly string[]):LostHandEdit[]{
 const removed=new Set(retired);
 return dag.order.flatMap((id,index)=>{
  if(!removed.has(id))return [];
  const caption=dag.products[`scene:${id}`]?.handEdited?dag.frames[id].scene:undefined;
  const prompt=dag.products[`visual:${id}`]?.handEdited?dag.frames[id].visual:undefined;
  return caption===undefined&&prompt===undefined?[]:[{page:index+1,caption,prompt}];
 });
}
