// 审片结论的种类与自动修订额度。
import type {Evaluation,Product} from './engine.ts';
import type {ReviewIssue} from '../reader-review.ts';

export const verdictNodes=['frameVerdict','narrativeVerdict'] as const;
export const repairsPerGrant=20;
const visualCategories=new Set(['composition','style','action']);

/** 旧审片没有字段时，优先采用事实与衔接意见中明确指出的出错字段。 */
export function reviewRepairField(issue:ReviewIssue):'caption'|'prompt'{
 if(issue.repairField==='caption'||issue.repairField==='prompt')return issue.repairField;
 if(issue.category==='source'||issue.category==='continuity'){
  const prompt=/\bprompt\b|画面(?:提示词|描述)/i.test(issue.problem);
  const caption=/\bcaption\b|旁白|配文/i.test(issue.problem);
  if(prompt!==caption)return prompt?'prompt':'caption';
 }
 return visualCategories.has(issue.category)?'prompt':'caption';
}

/** 只返回仍绑定当前输入的审核产物；固定幅数时不采用旧的幅数核对。 */
export function currentReviewTargets(evaluation:Evaluation){
 const instances=[
  ...(!evaluation.state.skipFrameCheck?[evaluation.instance('frameCheck')]:[]),
  evaluation.instance('narrativeVerdict'),
  ...evaluation.state.order.map(key=>evaluation.instance('frameVerdict',key)),
 ];
 return new Set(instances.filter(instance=>instance.status==='valid').map(instance=>instance.id));
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
