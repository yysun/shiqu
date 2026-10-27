import {nextStep,planSchema,selectionSchema,view,ReaderError} from './reader-model.ts';
import type {Document,Plan,Selection,SessionRow,Step} from './reader-model.ts';
import type {ReaderRepository} from './reader-repository.ts';
import type {ArtStyleId} from './reader-styles.ts';
import type {SourceResult} from './reader-source-types.ts';
export type Generated<T>={value:T;model:string;requestId:string|null;usage:unknown};
export interface StoryGenerator{plan(selection:Selection,id:string):Promise<Generated<Plan>>;original(selection:Selection,plan:Plan,id:string):Promise<SourceResult>;image(plan:Plan,page:number,id:string,reference:string,style?:ArtStyleId,productionPrompt?:string):Promise<Generated<string>>;audio(caption:string,id:string,page:number):Promise<Generated<string>>;safeError(error:unknown):string;}
export async function advanceStory(repo:ReaderRepository,generator:StoryGenerator,uid:string,id:string,throughPage:number,retry=false){
 let row=await repo.get(id,uid);
 if(row.state==='running'){if(row.lock_until>Date.now())return view(row);row=await repo.stale(row);}
 if(row.state==='failed'&&!retry)return view(row);
 const selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document;
 const step=nextStep(doc,selection,throughPage);if(!step)return view(row);
 const token=await repo.acquire(row,step);if(!token)return view(await repo.get(id,uid));
 try{
  let generated:Generated<unknown>|undefined;
  if(step.kind==='plan'){const result=await generator.plan(selection,id);const plan=planSchema.parse(result.value);if(plan.pages.length!==selection.length)throw Error('PLAN_LENGTH');doc.plan=plan;generated=result;}
  else if(step.kind==='source'){/* Resume original retrieval without paying to re-plan. */}
  else if(step.kind==='image'){const result=await generator.image(doc.plan!,step.page,id,doc.images[0]||'',selection.artStyle,selection.productionPrompt);doc.images[step.page]=result.value;generated=result;}
  else{const result=await generator.audio(doc.plan!.pages[step.page].caption,id,step.page);doc.audio[step.page]=result.value;generated=result;}
  if(generated)doc.usage.push({step:step.key,model:generated.model,requestId:generated.requestId,usage:generated.usage});
  if(step.kind==='plan'||step.kind==='source'){
   const result=await generator.original(selection,doc.plan!,id);
   if(!result.source)throw new ReaderError(503,'原文未能保存。'+result.message+' 故事编排已保留，可重试补全原文。');
   doc.original=result.source;
  }
  return view(await repo.save(row,token,doc,!nextStep(doc,selection,selection.length-1)));
 }catch(error){if(error instanceof ReaderError&&error.status===404)throw error;return view(await repo.save(row,token,doc,false,error instanceof ReaderError?error.message:generator.safeError(error)));}
}
