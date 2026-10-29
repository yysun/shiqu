// Advance local story generation under one session lock, retaining every completed paid result.
import {nextStep,planSchema,storyboardOutlineSchema,storyboardBatchSchema,selectionSchema,view,ReaderError,awaitingFrameCount,readerBooks} from './reader-model.ts';
import type {Document,Plan,Selection,SessionRow,Storyboard,StoryboardOutline} from './reader-model.ts';
import type {ReaderRepository} from './reader-repository.ts';
import type {ArtStyleId} from './reader-styles.ts';
import type {OriginalSource,SourceResult,SourceHint} from './reader-source-types.ts';
import {frameRecommendationSchema} from './reader-frame-recommendation.ts';
import type {FrameRecommendation} from './reader-frame-recommendation.ts';
import {readerImageBatchSize,readerMaxFrames,readerStoryboardBatchSize} from './reader-limits.ts';
export type Generated<T>={value:T;model:string;requestId:string|null;usage:unknown};
export interface StoryGenerator{prepareOriginal?(selection:Selection,id:string):Promise<OriginalSource|null>;recommend?(selection:Selection,id:string,original:OriginalSource):Promise<Generated<FrameRecommendation>>;outline?(selection:Selection,id:string,original?:OriginalSource):Promise<Generated<StoryboardOutline>>;planBatch?(selection:Selection,id:string,storyboard:Storyboard,original:OriginalSource):Promise<Generated<Plan['pages']>>;plan(selection:Selection,id:string,original?:OriginalSource):Promise<Generated<Plan>>;original(selection:Selection,plan:SourceHint,id:string):Promise<SourceResult>;image(plan:Plan,page:number,id:string,reference:string,style?:ArtStyleId,productionPrompt?:string,artifactId?:string):Promise<Generated<string>>;audio(caption:string,id:string,page:number):Promise<Generated<string>>;safeError(error:unknown):string;}

async function drawRequestedImages(repo:ReaderRepository,generator:StoryGenerator,row:SessionRow,token:string,doc:Document,selection:Selection,throughPage:number){
 const pages=doc.plan!.pages.map((_,page)=>page).filter(page=>page<=throughPage&&!doc.images[page]);
 // A new story establishes its reference alone; later requests may draw three missing scenes.
 const batch=pages.slice(0,doc.images[0]?readerImageBatchSize:1);
 const reference=doc.images[0]||'';
 let writes=Promise.resolve();
 const drawing=batch.map(async page=>{
  const image=await generator.image(doc.plan!,page,row.id,reference,selection.artStyle,selection.productionPrompt);
  doc.images[page]=image.value;
  doc.usage.push({step:`image:${page}`,model:image.model,requestId:image.requestId,usage:image.usage});
  // Queue immutable snapshots; once a write fails, skip later writes until final recovery.
  const snapshot=structuredClone(doc);
  writes=writes.then(()=>repo.saveImageProgress(row,token,snapshot));
  await writes;
 });
 const outcomes=await Promise.allSettled(drawing);
 for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
}

export async function advanceStory(repo:ReaderRepository,generator:StoryGenerator,uid:string,id:string,throughPage:number,retry=false,onAcquired?:(token:string)=>void){
 let row=await repo.get(id,uid);
 if(row.generation_control&&row.generation_control!=='active')return view(row);
 if(row.state==='running'){if(row.lock_until>Date.now())return view(row);row=await repo.stale(row);}
 if(row.state==='failed'&&!retry)return view(row);
 const selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document;
 const step=nextStep(doc,selection,throughPage);if(!step)return view(row);
 const token=await repo.acquire(row,step);if(!token)return view(await repo.get(id,uid));
 onAcquired?.(token);
 try{
  let generated:Generated<unknown>|undefined;
  if(step.kind==='recommend'){
   if(!doc.original){
    let original=await generator.prepareOriginal?.(selection,id);
    if(!original){
     const book=selection.bookId==='other'?selection.customBook:readerBooks.find(b=>b.id===selection.bookId)?.title||selection.bookId;
     const result=await generator.original(selection,{sourceReference:`《${book||''}》${selection.storyTitle||''}`},id);
     if(!result.source)throw new ReaderError(503,'原文未能核对，暂时无法推荐画幅数。'+result.message);
     original=result.source;
    }
    doc.original=original;await repo.saveImageProgress(row,token,structuredClone(doc));
   }
   if(!generator.recommend)throw new ReaderError(503,'生成服务暂不支持画幅建议，请更新服务后重试。');
   const result=await generator.recommend(selection,id,doc.original);doc.frameRecommendation=frameRecommendationSchema.parse(result.value);generated=result;
  }
  else if(step.kind==='plan'){
   if(generator.prepareOriginal&&!doc.original){
    const original=await generator.prepareOriginal(selection,id);
    if(original){doc.original=original;await repo.saveImageProgress(row,token,structuredClone(doc));}
   }
   if(doc.storyboard||generator.outline&&generator.planBatch&&(selection.length==='auto'||selection.length>readerStoryboardBatchSize)){
    if(!doc.storyboard){
     if(!generator.outline)throw Error('STORYBOARD_UNAVAILABLE');
     const result=await generator.outline(selection,id,doc.original),outline=storyboardOutlineSchema.parse(result.value);
     if(selection.length!=='auto'&&outline.beats.length!==selection.length)throw Error('PLAN_LENGTH');
     doc.storyboard={outline,pages:[]};generated=result;
    }else{
     if(!doc.original)throw new ReaderError(503,'原文尚未核对，暂时无法细化分镜。');
     if(!generator.planBatch)throw Error('STORYBOARD_UNAVAILABLE');
     const draft=doc.storyboard,count=Math.min(readerStoryboardBatchSize,draft.outline.beats.length-draft.pages.length);
     const result=await generator.planBatch(selection,id,structuredClone(draft),doc.original);
     const pages=[...draft.pages,...storyboardBatchSchema(count).parse({pages:result.value}).pages];
     const plan=pages.length===draft.outline.beats.length?planSchema.parse({...draft.outline,pages}):null;
     doc.storyboard={outline:draft.outline,pages};if(plan)doc.plan=plan;generated=result;
    }
   }else{
    const result=await generator.plan(selection,id,doc.original);const plan=planSchema.parse(result.value);if(selection.length!=='auto'&&plan.pages.length!==selection.length)throw Error('PLAN_LENGTH');doc.plan=plan;generated=result;
   }
  }
  else if(step.kind==='source'){/* Resume original retrieval without paying to re-plan. */}
  else if(step.kind==='image')await drawRequestedImages(repo,generator,row,token,doc,selection,throughPage);
  else{const result=await generator.audio(doc.plan!.pages[step.page].caption,id,step.page);doc.audio[step.page]=result.value;generated=result;}
  if(generated)doc.usage.push({step:step.key,model:generated.model,requestId:generated.requestId,usage:generated.usage});
  if((step.kind==='plan'||step.kind==='source')&&!doc.original){
   // URL-backed legacy sessions first resolve a real citation through provider URL context.
   // Save that paid directory before source lookup so a source outage cannot replay inference.
   if(doc.storyboard)await repo.saveImageProgress(row,token,structuredClone(doc));
   const result=await generator.original(selection,doc.plan||doc.storyboard!.outline,id);
   if(!result.source)throw new ReaderError(503,'原文未能保存。'+result.message+' 故事编排已保留，可重试补全原文。');
   doc.original=result.source;
  }
  return view(await repo.save(row,token,doc,!awaitingFrameCount(doc,selection)&&!nextStep(doc,selection,readerMaxFrames-1)));
 }catch(error){if(error instanceof ReaderError&&error.status===404)throw error;return view(await repo.save(row,token,doc,false,error instanceof ReaderError?error.message:generator.safeError(error)));}
}
