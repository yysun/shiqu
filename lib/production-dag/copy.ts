// 复制制作 DAG 故事：副本带上文字、结论与审片记录，图片按画幅身份另行附加；不带图片时，副本里的绘图产物记为尚未完成。
// 纯函数，不做 I/O。
import type {DagDocument} from './document.ts';

/** 只含文字的 dag：去掉成图、横图与它们的产物记录，以及等待继续的状态。 */
export function textOnlyDag(dag:DagDocument):DagDocument{
 const copy=structuredClone(dag);
 delete copy.continuation;
 delete copy.resumeUnreviewed;
 for(const [id,product] of Object.entries(copy.products))if(product.unreviewed)delete copy.products[id];
 for(const id of copy.order){
  const frame=copy.frames[id];
  if(!frame)continue;
  delete frame.image;delete frame.landscape;delete frame.landscapeError;
  delete copy.products[`frameImage:${id}`];delete copy.products[`landscape:${id}`];
 }
 return copy;
}

/** 为副本附加已复制的图片：images 按画幅顺序给出新地址；来源中可读的成图产物按身份带上，保持有效。 */
export function attachImages(dag:DagDocument,source:DagDocument,images:readonly string[]):DagDocument{
 const copy=structuredClone(dag);
 copy.order.forEach((id,index)=>{
  const image=images[index],record=source.products[`frameImage:${id}`];
  if(!image||!record||record.readable===false||!copy.frames[id])return;
  copy.frames[id].image=image;
  const {readable:_,...kept}=record;void _;
  copy.products[`frameImage:${id}`]=kept;
 });
 return copy;
}
