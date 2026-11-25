// 制作 DAG 的服务端执行器：把执行层给出的一项工作交给提供方完成，返回带用量的生成结果。
// 文字工作与绘图输入都经 requests.ts 的读取器，只用登记表声明的输入；文字工作经 dagGenerator 发出，绘图与横图经提供方的 image()，提示词取契约提示词 framePrompt，
// 参考图按规范取首幅的书籍参考或首幅成图。是否保存、何时保存由协调器在会话锁下用 apply() 决定。
import type {Generated,StoryGenerator} from '../lib/reader-engine.ts';
import {dagGenerator} from '../lib/production-dag/calls.ts';
import {requestFor,drawInput,type DagStory,type Work} from '../lib/production-dag/runner.ts';
import {projectDocument} from '../lib/production-dag/document.ts';
import {ReaderError,type Plan} from '../lib/reader-model.ts';
import {bookLabel} from '../lib/production-dag/requests.ts';
import {preparationOriginal,preparationPending} from '../lib/reader-preparation.ts';
import {frameRecommendationOutputSchema,preparesSelectedStory} from '../lib/reader-frame-recommendation.ts';
import {artRecommendationSchema} from '../lib/reader-art-recommendation.ts';

/** 绘图调用仍要求一份 plan 形状的参数；契约提示词已完整给出，plan 只用于提供方的文件命名与旧接口。 */
function drawingPlan(story:DagStory):Plan{
 const projected=projectDocument(story.dag,story.doc.plan).plan;
 if(projected)return projected;
 const pages=story.dag.order.map(id=>({caption:story.dag.frames[id]?.scene??'',prompt:story.dag.frames[id]?.visual??''}));
 return {title:story.dag.outline?.title??'',summary:'',sourceReference:'',adaptationNote:'',reflection:'',characters:'',pages};
}

export async function executeWork(generator:StoryGenerator,story:DagStory,item:Work,artifactId:string):Promise<Generated<unknown>>{
 if(item.call==='draw'||item.call==='drawLandscape'){
  const input=drawInput(story,item);
  // 绘图不读制作要求：契约提示词已完整给出，旧参数传空。
  return generator.image(drawingPlan(story),input.index,story.id,input.reference,input.style.artStyle,'',artifactId,input.layout,input.style.artStylePrompt,input.prompt);
 }
 const {doc,selection,id}=story;
 if(item.call==='verifySource'){
  let original=await generator.prepareOriginal?.(selection,id);
  if(!original){
   const result=await generator.original(selection,{sourceReference:`《${bookLabel(selection)}》${selection.storyTitle||''}`},id);
   if(!result.source)throw new ReaderError(503,'原文未能核对，暂时无法'+(preparationPending(doc)?'准备故事摘要。':'开始制作。')+result.message);
   original=result.source;
  }
  const value=preparationPending(doc)?preparationOriginal(doc,selection,original):original;
  return {value,model:'',requestId:null,usage:null};
 }
 // 原文核对之后的文字调用都读取保存的原文：本地出处不符时在付费前停止。
 if(doc.original)generator.verifyOriginal?.(selection,doc.original);
 if(item.call==='prepareArt'||item.call==='prepareSuggestions'){
  if(!doc.original)throw new ReaderError(409,'原文尚未保存，请先核对原文。');
  if(item.call==='prepareArt'){
   const value=generator.recommendArt?artRecommendationSchema.parse(await generator.recommendArt(selection,doc.original)):null;
   return {value,model:'',requestId:null,usage:null};
  }
  if(!generator.recommend)throw new ReaderError(503,'生成服务暂不支持画幅建议，请更新服务后重试。');
  const requirements=preparationPending(doc);
  const result=await generator.recommend(selection,id,doc.original,requirements);
  const value=frameRecommendationOutputSchema(doc.original,requirements,preparesSelectedStory(selection,doc.original)).parse(result.value);
  return {...result,value};
 }
 if(!generator.textCall)throw Error('DAG_TEXT_CALL_UNAVAILABLE');
 const {method,args}=requestFor(story,item);
 const calls=dagGenerator(generator.textCall) as unknown as Record<string,(args:unknown)=>Promise<Generated<unknown>>>;
 const run=calls[method];
 if(!run)throw Error(`DAG_METHOD_UNKNOWN: ${method}`);
 return run(args);
}
