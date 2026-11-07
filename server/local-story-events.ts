// 同一事件保留人物、行动、对象、目的和结果，原文引句用于核对来源。
import {z} from 'zod';

export const storyEventStatuses=['发生','成功','失败','未遂','计划','不明'] as const;
export const storyEventSchema=z.object({
 topic:z.string().trim().min(1).max(24),actor:z.string().trim().max(32),action:z.string().trim().min(1).max(60),object:z.string().trim().max(40),
 purpose:z.string().trim().max(60),outcome:z.string().trim().max(80),
 status:z.enum(storyEventStatuses),
 terms:z.array(z.string().trim().min(1).max(20)).min(1).max(6),
 evidence:z.array(z.string().trim().min(2).max(100)).min(1).max(3),
});
export const storyEventsSchema=z.array(storyEventSchema).max(6);
export type StoryEvent=z.infer<typeof storyEventSchema>;
export function groundedStoryEvents(value:unknown,text:string,key:(text:string)=>string,anchors?:string[]){
 const original=key(text);
 if(!Array.isArray(value)||value.length>6)return;
 const events=value.flatMap(event=>{
  const parsed=storyEventSchema.safeParse(anchors&&Array.isArray(event?.evidence)?{
   ...event,evidence:event.evidence.map((id:unknown)=>typeof id==='number'&&Number.isInteger(id)&&id>0?anchors[id-1]:undefined),
  }:event);
  if(!parsed.success)return [];
  return parsed.data.evidence.every(quote=>{const normalized=key(quote);return normalized.length>=2&&original.includes(normalized);})?[parsed.data]:[];
 });
 return events.length===value.length?events:undefined;
}
export const storyEventText=(event:StoryEvent)=>[
 `主题：${event.topic}`,`行动：${[event.actor,event.action,event.object].filter(Boolean).join('，')}`,
 event.purpose&&`目的：${event.purpose}`,event.outcome&&`结果：${event.outcome}`,`状态：${event.status}`,
].filter(Boolean).join('。');
