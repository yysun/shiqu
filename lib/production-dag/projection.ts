// 读者端和服务端共享同一读取投影，这里不引入任务或指纹计算。
import type {Document,Plan} from '../reader-model.ts';
import type {FrameCountReport} from '../reader-review.ts';
import type {Product} from './engine.ts';
import type {DagCharacter,DagDocument,DagOutline} from './document.ts';
import type {RepairBudget} from './review.ts';

/**
 * 由制作稿生成阅读器、导出和复制所需的稿件与图片视图。
 * 全部画幅都有叙事分镜与画面描述、且已有结语候选时才形成完整分镜。
 */
export function projectDocument(dag:DagDocument,base:Plan|null=null):{plan:Plan|null;images:string[]}{
 const images=dag.order.map(id=>dag.frames[id]?.image||'');
 const pages=dag.order.map(id=>({caption:dag.frames[id]?.scene??'',prompt:dag.frames[id]?.visual??''}));
 const reflection=dag.ending?.confirmed?.ending??dag.ending?.chosen??dag.ending?.candidates[0]??base?.reflection;
 const outline=dag.outline;
 if(!pages.length||pages.some(p=>!p.caption||!p.prompt)||!reflection||!(outline||base))return {plan:null,images};
 const characters=dag.characters.map(c=>c.name?`${c.name}：${c.text}`:c.text).join('\n');
 return {
  plan:{
   title:dag.ending?.confirmed?.title??dag.ending?.selectedTitle??dag.ending?.title??outline?.title??base!.title,
   summary:dag.brief??outline?.summary??base!.summary,
   sourceReference:outline?.sourceReference??base!.sourceReference,
   adaptationNote:outline?.adaptationNote??base!.adaptationNote,
   reflection,
   characters:characters||base?.characters||'',
   pages,
  },
  images,
 };
}

/** 读取故事时按当前稿件建立阅读所需的视图。迁移未能转换的记录仍可查看已保存的投影。 */
type ProductBody={record:{product:Product;picture?:string};content:unknown;sharedReadable?:number|null};

/** 版本行带上该版本采用的产物。独立迁移夹具和未转换记录也可读取原始文档。 */
export function decodeDocument(raw:string|{document:string;production_products?:string;production_repair_budget?:string|null}):Document{
 const doc=JSON.parse(typeof raw==='string'?raw:raw.document) as Document,dag=doc.dag;
 if(dag&&typeof raw!=='string'&&raw.production_products){
  const saved=JSON.parse(raw.production_products) as Record<string,ProductBody>;
  for(const [target,{record,content,sharedReadable}] of Object.entries(saved)){
   if(dag.products[target])continue;
   dag.products[target]=record.product;
   if(sharedReadable===0)dag.products[target].readable=false;
   if(sharedReadable===1)delete dag.products[target].readable;
   if(content===null)continue;
   const [node,key]=target.split(':',2),frame=dag.frames[key];
   switch(node){
    case 'source':doc.original??=content as Document['original'];break;
    case 'brief':dag.brief??=content as string;break;
    case 'characters':if(!dag.characters.length)dag.characters=content as DagCharacter[];break;
    case 'outline':dag.outline??=content as DagOutline;break;
    case 'ending':{
     const candidates=content as Pick<NonNullable<DagDocument['ending']>,'title'|'candidates'>;
     if(dag.ending&&!dag.ending.candidates.length)dag.ending={...dag.ending,...candidates};
     break;
    }
    case 'frameCheck':dag.frameCheck??=content as FrameCountReport;break;
    case 'scene':if(frame&&!frame.scene)frame.scene=content as string;break;
    case 'visual':if(frame&&!frame.visual)frame.visual=(content as {prompt:string}).prompt;break;
    case 'frameImage':if(frame)frame.image??=record.picture??content as string;break;
    case 'frameVerdict':case 'narrativeVerdict':{
     const value=(content as {verdict?:NonNullable<DagDocument['verdicts']>[string]}).verdict;
     if(value)(dag.verdicts??={})[target]??=value;
     break;
    }
   }
  }
 }
 if(dag){
  if(!dag.repairs&&typeof raw!=='string'&&raw.production_repair_budget)dag.repairs=JSON.parse(raw.production_repair_budget) as RepairBudget|null??undefined;
  return {...doc,...projectDocument(dag,doc.plan??null)};
 }
 return {...doc,plan:doc.plan??null,images:doc.images??[]};
}

/** 只保存权威记录。无法转换的历史故事仍保留原始内容和媒体引用。 */
export function encodeDocument(doc:Document):string{
 const {plan,images,...stored}=doc;
 return JSON.stringify(doc.dag||!plan&&!images.length?stored:doc);
}
