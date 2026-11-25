// 审片规则：分阶段批量调用与修订额度。
// 结论的失效由引擎按各自输入推导；每阶段一次调用的分组由 schedule.ts 的 callGroups() 决定。
// 第二阶段（依赖选定结语的条目）在引擎中天然等待叙事结论有效，因此每阶段最多一次调用。
import {instanceId,type Instance,type VersionState,type Product} from './engine.ts';

export const verdictNodes=['frameVerdict','narrativeVerdict','itemVerdict'] as const;
export const repairsPerGrant=20;

/** 依赖选定结语的条目属于第二阶段，其余属于第一阶段。 */
export function reviewStage(state:VersionState,instance:Pick<Instance,'node'|'key'>):1|2{
 if(instance.node!=='itemVerdict')return 1;
 const evidence=state.products[instanceId('itemRegistration',instance.key)]?.evidence;
 return !evidence?.length||evidence.includes('ending')?2:1;
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
