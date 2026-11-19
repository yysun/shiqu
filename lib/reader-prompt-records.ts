// Retain application-authored prompts with paid receipts; omit credentials and binary attachments.
// Records are fetched on demand rather than added to shelf or progress polling payloads.
// Archive references deduplicate exact system rules without altering saved history.
// 全文存于 prompt_records 表时，调用记录只含 promptRecordId，由 usageRecord 统一取用。
import {formatSystemPrompt} from './reader-prompt-format.ts';
export type PromptRecord={instructions:string;input:string;schema?:unknown;reference?:string};
export type PromptReceipt={step:string;model:string;originId:string;index:number;record:PromptRecord};
export type StoryPromptHistory={productionPrompt:string;acceptancePrompt:string;records:PromptReceipt[];missingRecords:Omit<PromptReceipt,'record'>[]};
export function promptRecord(instructions:string,input:unknown,schema?:unknown,reference?:string):PromptRecord{
 return {instructions:formatSystemPrompt(instructions),input:typeof input==='string'?input:JSON.stringify(input),...(schema?{schema}:{}),...(reference?{reference}:{})};
}
// 调用记录的提示词：内嵌优先，否则按引用从已读取的记录中取；记录缺失时返回 undefined。
export function usageRecord(entry:{promptRecord?:PromptRecord;promptRecordId?:string},records:Map<string,PromptRecord>){
 return entry.promptRecord||(entry.promptRecordId?records.get(entry.promptRecordId):undefined);
}
export function promptRecordText(record:PromptRecord){return ['## 系统指令',record.instructions,'## 文本输入',record.input,...(record.schema?['## 输出契约',JSON.stringify(record.schema,null,2)]:[]),...(record.reference?['## 图片参考',record.reference]:[])].join('\n\n');}
export function archivePromptHistory(history:StoryPromptHistory|null){
 const systemPrompts:{id:string;label:string;instructions:string}[]=[],byInstructions=new Map<string,typeof systemPrompts[number]>();
 const counts={production:0,acceptance:0,image:0},labels={production:'系统制作提示词',acceptance:'系统验收提示词',image:'系统绘图提示词'};
 const records=(history?.records??[]).map(item=>{
  const {instructions,...input}=item.record;
  let system=byInstructions.get(instructions);
  if(instructions&&!system){
   const kind=item.step.startsWith('review')?'acceptance':item.step.startsWith('image:')?'image':'production',number=++counts[kind];
   system={id:`system-${kind}-${number}`,label:labels[kind]+(number>1?` ${number}`:''),instructions};
   byInstructions.set(instructions,system);systemPrompts.push(system);
  }
  return {...item,record:{instructionsRef:system?.id??null,...input}};
 });
 return {productionPrompt:history?.productionPrompt??null,acceptancePrompt:history?.acceptancePrompt??null,systemPrompts,records,missingRecords:history?.missingRecords??[]};
}
export type StoryPromptArchive=ReturnType<typeof archivePromptHistory>;
