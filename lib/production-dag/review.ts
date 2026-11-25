// 审片结论的种类与自动修订额度。
import type {Product} from './engine.ts';

export const verdictNodes=['frameVerdict','narrativeVerdict'] as const;
export const repairsPerGrant=20;

/** 放行只更新被放行的结论；结论输入变化后产物失效，放行随之失效。 */
export function override(product:Product):Product{
 return {...product,overridden:true};
}

export type RepairBudget={used:number;limit:number};
export const newRepairBudget=():RepairBudget=>({used:0,limit:repairsPerGrant});
export const canRepair=(budget:RepairBudget)=>budget.used<budget.limit;
/** 「继续自动修复」授予新的 20 次。 */
export const grantRepairs=(budget:RepairBudget):RepairBudget=>({used:budget.used,limit:budget.used+repairsPerGrant});
