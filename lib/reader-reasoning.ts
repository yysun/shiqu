// Text tasks own their reasoning budget; provider-specific unsupported values fail instead of downgrading.
import {z} from 'zod';
import {codexReasoningEfforts} from './codex-settings.ts';

export const reasoningTasks=['suggest','art','frames','outline','plan','review','repair'] as const;
export type ReasoningTask=typeof reasoningTasks[number];
export type ReasoningEffort=typeof codexReasoningEfforts[number];
export const taskReasoningDefaults={suggest:'medium',art:'low',frames:'medium',outline:'high',plan:'high',review:'high',repair:'high'} as const;
export const taskReasoningLabels={suggest:'原文选题',art:'画风推荐',frames:'画幅数建议',outline:'全篇提纲',plan:'详细分镜',review:'审核与复核',repair:'定向修订'} as const;
export const taskReasoningSchema=z.object({
 suggest:z.enum(codexReasoningEfforts).default(taskReasoningDefaults.suggest),art:z.enum(codexReasoningEfforts).default(taskReasoningDefaults.art),
 frames:z.enum(codexReasoningEfforts).default(taskReasoningDefaults.frames),outline:z.enum(codexReasoningEfforts).default(taskReasoningDefaults.outline),
 plan:z.enum(codexReasoningEfforts).default(taskReasoningDefaults.plan),review:z.enum(codexReasoningEfforts).default(taskReasoningDefaults.review),repair:z.enum(codexReasoningEfforts).default(taskReasoningDefaults.repair),
}).strict().default({});
export type TaskReasoningEfforts=z.infer<typeof taskReasoningSchema>;
export const geminiReasoningEfforts=['low','medium','high'] as const;
export function configuredTaskReasoning(variables:Record<string,string|undefined>){
 return taskReasoningSchema.parse(Object.fromEntries(reasoningTasks.flatMap(task=>{
  const value=variables['SHIQU_REASONING_'+task.toUpperCase()]?.trim();return value?[[task,value]]:[];
 })));
}
export function geminiThinkingLevel(effort:ReasoningEffort){
 if(!(geminiReasoningEfforts as readonly string[]).includes(effort))throw Error('UNSUPPORTED_GEMINI_REASONING_EFFORT');
 return effort.toUpperCase();
}
