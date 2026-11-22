// 审片规则：分阶段批量调用、允许清单、建议、核对标记确认与修订额度。
// 结论的失效由引擎按各自输入推导；每阶段一次调用的分组由 schedule.ts 的 callGroups() 决定。
// 第二阶段（依赖选定结语的条目）在引擎中天然等待叙事结论有效，因此每阶段最多一次调用。
import {evaluate,instanceId,type Instance,type VersionState,type Product} from './engine.ts';

export const verdictNodes=['frameVerdict','narrativeVerdict','itemVerdict'] as const;
export const repairsPerGrant=20;

/** 依赖选定结语的条目属于第二阶段，其余属于第一阶段。 */
export function reviewStage(state:VersionState,instance:Pick<Instance,'node'|'key'>):1|2{
 if(instance.node!=='itemVerdict')return 1;
 const evidence=state.products[instanceId('itemRegistration',instance.key)]?.evidence;
 return !evidence?.length||evidence.includes('ending')?2:1;
}

/** 一次审片调用替换的结论；由调度分组 callGroups() 给出，测试与正式调度共用。 */
export type ReviewBatch={stage:1|2;allowed:string[]};

export type ReviewJudgement={id:string;outcome:'pass'|'fail';detail?:string};

/** 只替换允许清单内的结论；清单外的判断记为建议，不阻断、不触发修订。 */
export function splitJudgements(batch:ReviewBatch,judgements:ReviewJudgement[]){
 const allowed=new Set(batch.allowed);
 return {replace:judgements.filter(j=>allowed.has(j.id)),suggestions:judgements.filter(j=>!allowed.has(j.id))};
}

export type Suggestion={target:string;targetHash?:string;detail:string};

/** 建议在目标下一次产出结论时消失；不带入之后的版本。 */
export function liveSuggestions(state:VersionState,suggestions:Suggestion[]):Suggestion[]{
 return suggestions.filter(s=>state.products[s.target]?.hash===s.targetHash);
}

/**
 * 读取当前内容的审片通过后，确认相应文字产物的核对输入：返回需要改写 checks 的产物。
 * 逐幅结论确认本幅画面描述；叙事结论确认标题与结语候选及幅数核对。
 */
export function acknowledgedChecks(state:VersionState,passed:string[]):{id:string;checks:Record<string,string>}[]{
 const evaluation=evaluate(state),out:{id:string;checks:Record<string,string>}[]=[];
 const take=(node:string,key:string)=>{
  const inst=evaluation.instance(node,key);
  if(inst.status==='valid'&&inst.basedOnOld&&inst.check)out.push({id:inst.id,checks:inst.check});
 };
 for(const id of passed){
  const [node,key]=id.split(':') as [string,string];
  if(node==='frameVerdict')take('visual',key);
  if(node==='narrativeVerdict'){take('ending','');take('frameCheck','');}
 }
 return out;
}

/** 放行只更新被放行的结论；结论输入变化后产物失效，放行随之失效。 */
export function override(product:Product):Product{
 return {...product,overridden:true};
}

export type RepairBudget={used:number;limit:number};
export const newRepairBudget=():RepairBudget=>({used:0,limit:repairsPerGrant});
export const canRepair=(budget:RepairBudget)=>budget.used<budget.limit;
/** 「继续自动修复」授予新的 20 次。 */
export const grantRepairs=(budget:RepairBudget):RepairBudget=>({used:budget.used,limit:budget.used+repairsPerGrant});
