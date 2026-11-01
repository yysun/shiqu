// Use official OpenAI text/image APIs with isolated API billing and validated local reference images.
// Never log provider bodies or credentials, fetch returned image URLs, retry, or fall back to another provider.
import {normalizeProductionPrompt} from '../lib/reader-prompts.ts';
import {verifiedOriginalPayload} from '../lib/reader-source-types.ts';
import {z} from 'zod';
import {ReaderError,storyDraftSchema} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import {configuredTaskReasoning} from '../lib/reader-reasoning.ts';
import type {ReasoningEffort} from '../lib/reader-reasoning.ts';
import {openaiDefaultModels} from '../lib/system-settings.ts';
import {storyboardGenerator} from '../lib/reader-storyboard.ts';
import {freshSuggestions,suggestionBatchSchema} from '../lib/reader-suggestions.ts';
import {localChoicesJson,localScanJson,localChoices,localReadingPrompt,localSuggestionPayload} from '../lib/reader-local-contract.ts';
import {choicesJson,storyDraftJson,suggestionSystemPrompt,draftInstructions,imagePrompt,imageTypes,mediaType,storySource} from '../lib/reader-generation-contract.ts';
import {artRecommendationJson,artRecommendationSchema,selectedArtRecommendationPrompt,selectedArtRecommendationPayload} from '../lib/reader-art-recommendation.ts';
import {frameRecommendationSchema,frameRecommendationJson,frameRecommendationPrompt,frameRecommendationPayload} from '../lib/reader-frame-recommendation.ts';
import {getArtStyle} from '../lib/reader-styles.ts';
import {saveStoryOriginal} from '../lib/reader-source-storage.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {imageDimensions,imageRequestSize} from '../lib/reader-image-dimensions.ts';
import {readerStoryboardTimeoutMs} from '../lib/reader-limits.ts';

const base='https://api.openai.com/v1';
export class OpenAIError extends Error{status:number;constructor(code:string,status=502){super(code);this.status=status;}}
// Responses strict schemas require every property. Nullable optional properties are restored before Zod validation.
export function strictOpenAISchema(input:unknown):any{
 if(!input||typeof input!=='object')return input;
 if(Array.isArray(input))return input.map(strictOpenAISchema);
 const value=input as Record<string,any>,output=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,strictOpenAISchema(item)]));
 if(value.type==='object'&&value.properties){
  const required=new Set(value.required||[]);
  output.properties=Object.fromEntries(Object.entries(value.properties).map(([key,schema])=>[key,required.has(key)?strictOpenAISchema(schema):{anyOf:[strictOpenAISchema(schema),{type:'null'}]}]));
  output.required=Object.keys(value.properties);output.additionalProperties=false;
 }
 return output;
}
function restoreOptional(value:any,schema:any):any{
 if(Array.isArray(value))return value.map(item=>restoreOptional(item,schema?.items));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key,item])=>item!==null||schema?.required?.includes(key)).map(([key,item])=>[key,restoreOptional(item,schema?.properties?.[key])]));
 return value;
}
export function safeOpenAIError(error:unknown){
 const code=error instanceof OpenAIError?error.message:error instanceof z.ZodError?'INVALID_OUTPUT':error instanceof Error&&/abort|timeout/i.test(error.name)?'TIMEOUT':'PROVIDER_ERROR';
 console.error('openai_request_failed',JSON.stringify({code,status:error instanceof OpenAIError?error.status:undefined}));
 if(error instanceof OpenAIError){
  if(error.status===401||error.status===403)return 'OpenAI API 密钥或模型权限不可用，请检查服务配置。';
  if(error.status===402||error.status===429)return 'OpenAI API 计费、额度或速率限制暂不可用；进度已保留。';
  if(error.status===404)return 'OpenAI API 模型不可用，请检查文本与图片模型设置。';
  if(code==='REFUSED')return 'OpenAI 暂时无法生成这段内容，请调整故事或制作要求。';
 }
 return code==='TIMEOUT'?'OpenAI API 等待超时，已保留进度。':'OpenAI API 暂时无法完成这一步，已保留进度。';
}
export function createOpenAIProvider(variables:Record<string,string|undefined>,media:MediaStore,transport:typeof fetch):ReaderProvider{
 const key=variables.OPENAI_API_KEY?.trim()||'',models={text:variables.OPENAI_TEXT_MODEL?.trim()||openaiDefaultModels.text,image:variables.OPENAI_IMAGE_MODEL?.trim()||openaiDefaultModels.image},reasoning=configuredTaskReasoning(variables);
 if(Object.values(models).some(model=>!model.match(/^[\w.-]{1,100}$/)))throw new OpenAIError('INVALID_MODEL',400);
 async function request(route:string,body:Record<string,unknown>|FormData,timeout=readerStoryboardTimeoutMs){
  if(!key)throw new OpenAIError('KEY_REQUIRED',401);
  const multipart=body instanceof FormData;
  const response=await transport(base+route,{method:'POST',headers:{Authorization:'Bearer '+key,...(!multipart?{'Content-Type':'application/json'}:{})},body:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(timeout),redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw new OpenAIError('PROVIDER_ERROR',response.status);}
  return {value:await response.json() as any,requestId:response.headers.get('x-request-id')};
 }
 async function text(instructions:string,payload:unknown,schema:unknown,effort:ReasoningEffort,maxOutputTokens=8192){
  const {value,requestId}=await request('/responses',{model:models.text,instructions,input:[{role:'user',content:JSON.stringify(payload)}],reasoning:{effort},text:{format:{type:'json_schema',name:'story_result',strict:true,schema:strictOpenAISchema(schema)}},max_output_tokens:maxOutputTokens,store:false});
  if(value.status!=='completed')throw new OpenAIError('INCOMPLETE_RESPONSE');
  const content=(value.output||[]).filter((item:any)=>item.type==='message').flatMap((item:any)=>item.content||[]);
  if(content.some((item:any)=>item.type==='refusal'))throw new OpenAIError('REFUSED');
  const output=content.filter((item:any)=>item.type==='output_text').map((item:any)=>item.text).join('');
  let parsed;try{parsed=JSON.parse(output);}catch{throw new OpenAIError('INVALID_OUTPUT');}
  return {value:restoreOptional(parsed,schema),model:value.model||models.text,requestId:value.id||requestId,usage:value.usage||null,reasoningEffort:effort};
 }
 function book(selection:Parameters<ReaderProvider['suggestions']>[0]){
  const source=storySource(selection);if(source.isUrl)throw new ReaderError(400,'OpenAI API 模式请使用内置书籍或书名；网页 URL 来源请使用 Gemini。');return source.book;
 }
 return {
  async status(){return {configured:!!key,provider:'openai',models,voiceEnabled:false,taskReasoningEfforts:reasoning};},
  async suggestions(selection,excluded,localBook,reading){
   const scanning=localBook?.purpose==='scan';
   const result=await text(localBook?localReadingPrompt(localBook):suggestionSystemPrompt,localSuggestionPayload(book(selection),selection.theme,excluded,localBook,reading?.maxStories),scanning?localScanJson:localBook?localChoicesJson:choicesJson,reasoning.suggest,scanning?10000:localBook?5000:2500);
   const batch=localBook?localChoices(result.value,localBook):suggestionBatchSchema.parse(result.value),fresh=scanning?batch:freshSuggestions(batch,excluded);
   return reading?.maxStories?{...fresh,stories:fresh.stories.slice(0,reading.maxStories)}:fresh;
  },
  async recommendArt(selection,original){
   if(!original?.localSource)throw new ReaderError(400,'请先选择已核对出处的故事。');
   const result=await text(selectedArtRecommendationPrompt,selectedArtRecommendationPayload(selection,original),artRecommendationJson,reasoning.art,2048);return artRecommendationSchema.parse(result.value);
  },
  generator(){return {
   ...storyboardGenerator(book,(task,instructions,payload,schema,maxOutputTokens)=>text(instructions,payload,schema,reasoning[task],maxOutputTokens)),
   original:(selection,plan,id)=>saveStoryOriginal(media,selection,plan,id,transport),
   async recommend(selection,_id,original){const result=await text(frameRecommendationPrompt,frameRecommendationPayload(selection,original),frameRecommendationJson,reasoning.frames,2048);return {...result,value:frameRecommendationSchema.parse(result.value)};},
   async plan(selection,id,original){
    const result=await text(draftInstructions(!!original?.localSource),{book:book(selection),chosenStory:selection.storyTitle,...(selection.storyTitle?{}:{theme:selection.theme}),exactPageCount:selection.length,narrativeDetail:selection.narrativeDetail,productionPrompt:normalizeProductionPrompt(selection.productionPrompt||'',selection.theme),artDirection:getArtStyle(selection.artStyle).prompt,variationSeed:id,...(original?{verifiedOriginal:verifiedOriginalPayload(original)}:{})},storyDraftJson(selection.length),reasoning.plan,Math.max(8192,(selection.length==='auto'?20:selection.length)*800));
    const value=storyDraftSchema.parse(result.value);if(selection.length!=='auto'&&value.pages.length!==selection.length)throw new OpenAIError('PLAN_LENGTH');return {...result,value};
   },
   async image(plan,page,id,reference,style='ink-pencil',productionPrompt='',artifactId){
    const size=imageRequestSize(variables.IMAGE_SIZE);if(!size)throw new OpenAIError('INVALID_IMAGE_SIZE',400);
    const prompt=imagePrompt(plan,page,style,productionPrompt,page>0&&!!reference);
    let body:Record<string,unknown>|FormData={model:models.image,prompt,n:1,size:size.size,output_format:'png'},route='/images/generations';
    if(page>0&&reference){
     const ref=referenceImageKey(id,reference);if(!ref)throw new OpenAIError('INVALID_ANCHOR');
     const saved=await media.get(ref);if(!saved)throw new OpenAIError('INVALID_ANCHOR');
     const bytes=new Uint8Array(await saved.arrayBuffer()),mime=mediaType(bytes);
     if(!mime||!imageDimensions(bytes)||bytes.length>12*1024*1024)throw new OpenAIError('INVALID_ANCHOR');
     const form=new FormData();for(const [name,value] of Object.entries(body))form.set(name,String(value));
     form.set('image[]',new Blob([bytes],{type:mime}),'reference.'+imageTypes[mime]);body=form;route='/images/edits';
    }
    const {value,requestId}=await request(route,body),encoded=value.data?.[0]?.b64_json;
    if(typeof encoded!=='string'||!encoded.length||encoded.length>17*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new OpenAIError('INVALID_IMAGE');
    const bytes=new Uint8Array(Buffer.from(encoded,'base64')),mime=mediaType(bytes);
    if(!mime||!imageDimensions(bytes)||bytes.length>12*1024*1024)throw new OpenAIError('INVALID_IMAGE');
    const asset=readerImageAsset(id,page,imageTypes[mime],artifactId);await media.put(asset.key,bytes,{contentType:mime});
    return {value:asset.url,model:models.image,requestId,usage:value.usage||null};
   },
   async audio(){throw new ReaderError(400,'当前不提供配音。');},safeError:safeOpenAIError,
  };},safeError:safeOpenAIError,
 };
}
