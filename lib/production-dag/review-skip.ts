// 人工跳过只在绑定仍有效时为引擎提供临时放行结论。正式审片记录与产物保持独立。
import {evaluate,instanceId,type Product,type VersionState} from './engine.ts';
import {fingerprint} from './fingerprint.ts';
import type {DagDocument} from './document.ts';
import {verdictNodes} from './review.ts';

export type ReviewSkip={faultId:string;recordedAt:string;binding:string;targets:string[]};

function skipBasis(state:VersionState,dag:DagDocument){
 if(!dag.ending?.confirmed)return null;
 const ev=evaluate(state);
 if(!state.skipFrameCheck){
  const count=ev.instance('frameCheck');
  if(count.status!=='valid'||state.products[count.id]?.outcome!=='pass')return null;
 }
 const registration=dag.items.map(item=>[item,ev.instance('itemRegistration',item.id),state.products[instanceId('itemRegistration',item.id)]] as const);
 if(registration.some(([,instance])=>instance.status!=='valid'))return null;
 const verdicts=ev.all().filter(item=>verdictNodes.some(node=>node===item.node));
 if(!verdicts.length||verdicts.some(item=>!item.hard))return null;
 const pending=verdicts.filter(item=>item.status!=='valid');
 if(!pending.length)return null;
 const binding=fingerprint([verdicts.map(item=>[item.id,item.hard]),registration.map(([item,,value])=>[item,value]),
  dag.ending.confirmed,state.skipFrameCheck?null:[dag.frameCheck,state.products['frameCheck:']]]);
 return {binding,pending};
}

export function activeReviewSkip(state:VersionState,dag:DagDocument){
 const record=dag.reviewSkip;
 if(!record)return null;
 const basis=skipBasis(state,dag);
 return basis&&basis.binding===record.binding&&basis.pending.every(item=>record.targets.includes(item.id))?basis:null;
}

export function withReviewSkip(state:VersionState,dag:DagDocument):VersionState{
 const active=activeReviewSkip(state,dag);
 if(!active)return state;
 const products={...state.products};
 for(const item of active.pending){
  const product:Product={hash:fingerprint([item.id,active.binding]),inputs:item.hard!,checks:item.check,outcome:'fail',overridden:true};
  products[item.id]=product;
 }
 return {...state,products};
}
