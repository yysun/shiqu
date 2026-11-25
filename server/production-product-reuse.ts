// 只采用家族内与当前节点及硬输入相同的文字产物。版本自己的手改和放行由修订流程保留。
import type {Database} from '../lib/reader-repository.ts';
import type {Product} from '../lib/production-dag/engine.ts';
import type {DagStory,Work} from '../lib/production-dag/runner.ts';
import type {ReviewOutcome} from '../lib/production-dag/calls.ts';
import type {ReviewIssue} from '../lib/reader-review.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';

const scalarCalls=new Set(['verifySource','prepareBrief','prepareSuggestions','characters','outline','ending','frameCheck']);
const batchCalls=new Set(['sceneBatch','visual','restyle']);

type ReusedText={value:unknown;work:Work;products:Record<string,Product>};
export async function reusableTextProducts(db:Database,owner:string,story:DagStory,work:Work):Promise<ReusedText|undefined>{
 const root=story.doc.revision?.rootId,call=work.call;
 if(!root)return undefined;
 if(call==='storyboard'){
  // 家族中按相同输入保存的提纲、人物设定可免费采用，下一次合批分镜沿用。
  for(const target of work.instances.filter(target=>target.node==='outline'||target.node==='characters')){
   const reused=await reusableTextProducts(db,owner,story,{call:target.node,instances:[target]});
   if(reused)return reused;
  }
  return undefined;
 }
 if(!scalarCalls.has(call)&&!batchCalls.has(call)&&call!=='review')return undefined;
 const receiptRows=batchCalls.has(call)?await db.prepare(`SELECT detail FROM production_attempt_events
  WHERE event='paid-result' AND owner_id=? AND session_id!=? AND json_extract(detail,'$.rootId')=?
  AND json_extract(detail,'$.work.call')=? ORDER BY sequence DESC`).bind(owner,story.id,root,call).all<{detail:string}>():undefined;
 const pending=new Set(work.instances.map(target=>target.id)),late=new Map<string,unknown>();
 for(const {detail} of receiptRows?.results??[]){
  const saved=JSON.parse(detail) as {work:Work;receipt:{value:unknown[]}};
  if(!Array.isArray(saved.receipt?.value))continue;
  saved.work.instances.forEach((target,index)=>{
   if(!pending.has(target.id))return;
   const key=target.id+':'+fingerprint(target.hard);
   const value=saved.receipt.value[index];
   if(value!==undefined&&!late.has(key))late.set(key,value);
  });
 }
 const found=await Promise.all(work.instances.map(async target=>{
  const candidate=await db.prepare(`SELECT p.content,r.record FROM production_products p JOIN production_product_refs r
   ON r.product_id=p.id AND r.owner_id=p.owner_id
   WHERE p.owner_id=? AND p.root_id=? AND p.target=? AND p.input_hash=? AND r.session_id!=?
   AND p.content!='null' AND COALESCE(json_extract(r.record,'$.product.handEdited'),0)=0
   AND COALESCE(json_extract(r.record,'$.product.overridden'),0)=0
   ORDER BY p.id DESC,r.session_id LIMIT 1`).bind(owner,root,target.id,fingerprint(target.hard),story.id)
   .first<{content:string;record:string}>();
  if(!candidate){
   const value=late.get(target.id+':'+fingerprint(target.hard));
   if(value===undefined)return null;
   return {target,product:undefined,content:call==='sceneBatch'?(value as {caption:string}).caption:value};
  }
  const product=(JSON.parse(candidate.record) as {product:Product}).product;
  return {target,product,content:JSON.parse(candidate.content) as unknown};
 }));
 const candidates=found.filter(candidate=>candidate!==null);
 if(!candidates.length)return undefined;
 let value:unknown;
 if(call==='review'){
  const outcome:ReviewOutcome={judgements:[],issues:[],storyIssues:[]};
  for(const {target,product,content} of candidates){
   const saved=content as {verdict?:Omit<ReviewOutcome['judgements'][number],'id'>;issues?:ReviewIssue[];titleChoice?:string;endingChoice?:string};
   if(!product?.outcome)return undefined;
   outcome.judgements.push({id:target.id,...saved.verdict,outcome:product.outcome});
   if(target.node==='narrativeVerdict'){
    outcome.storyIssues=saved.issues??[];outcome.titleChoice=saved.titleChoice;outcome.endingChoice=saved.endingChoice;
   }else outcome.issues.push(...saved.issues??[]);
  }
  value=outcome;
 }else if(call==='sceneBatch')value=candidates.map(({content})=>({caption:content}));
 else if(batchCalls.has(call))value=candidates.map(({content})=>content);
 else value=candidates[0].content;
 return {value,work:{...work,instances:candidates.map(({target})=>target)},
  products:Object.fromEntries(candidates.flatMap(({target,product})=>product?[[target.id,product]]:[]))};
}
