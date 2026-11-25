// Share the Responses text adapter with DeepSeek; only OpenAI supports image generation here.
// Never log provider bodies or credentials, fetch returned image URLs, retry, or fall back to another provider.
import {beforePaidSend,recordPaidResponse,readDrawingReference} from './paid-dispatch.ts';
import {formatSystemPrompt} from '../lib/reader-prompt-format.ts';
import {promptRecord} from '../lib/reader-prompt-records.ts';
import {discoveryCall} from '../lib/reader-discovery-call.ts';
import {z} from 'zod';
import {ReaderError} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import {configuredTaskReasoning,reasoningTasks} from '../lib/reader-reasoning.ts';
import type {ReasoningEffort,ReasoningTask} from '../lib/reader-reasoning.ts';
import {openaiDefaultModels} from '../lib/system-settings.ts';
import {storyboardGenerator} from '../lib/reader-storyboard.ts';
import {freshSuggestions,suggestionBatchSchema} from '../lib/reader-suggestions.ts';
import {localChoicesJson,localScanJson,localCardsJson,localCardsOutputTokens,localCatalogOutputJson,localCatalogOutputTokens,localChoices,localReadingPrompt,localSuggestionPayload} from '../lib/reader-local-contract.ts';
import type {ThemeMatchProtocol,ThemeStory} from '../lib/reader-theme-match.ts';
import type {DiscoveryContext} from '../lib/reader-discovery-call.ts';
import {binaryThemeMatch,themeVerificationProtocol,themeMatchModel,themeMatchEffort} from '../lib/reader-theme-match.ts';
import {choicesJson,suggestionSystemPrompt,imagePrompt,imageTypes,mediaType,storySource} from '../lib/reader-generation-contract.ts';
import {artRecommendationJson,artRecommendationSchema,selectedArtRecommendationPrompt,selectedArtRecommendationPayload} from '../lib/reader-art-recommendation.ts';
import {preparesSelectedStory,frameRecommendationOutputSchema,frameRecommendationOutputJson,frameRecommendationPrompt,frameRecommendationPayload} from '../lib/reader-frame-recommendation.ts';
import {saveStoryOriginal} from '../lib/reader-source-storage.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {imageDimensions,imageRequestSize,landscapeImageSize,matchesLandscapeImageRatio} from '../lib/reader-image-dimensions.ts';
import {readerStoryboardTimeoutMs} from '../lib/reader-limits.ts';
import {responsesDiagnostic} from '../lib/reader-responses-diagnostics.ts';
import {geminiReviewEvidence as sourceReviewEvidence} from '../lib/reader-gemini-evidence.ts';
import {strictOpenAISchema} from '../lib/reader-openai-schema.ts';
export {strictOpenAISchema} from '../lib/reader-openai-schema.ts';

export class OpenAIError extends Error{usage?:unknown;model?:string;status:number;constructor(code:string,status=502){super(code);this.status=status;}}
function restoreOptional(value:any,schema:any):any{
 if(Array.isArray(value))return value.map(item=>restoreOptional(item,schema?.items));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key,item])=>item!==null||schema?.required?.includes(key)).map(([key,item])=>[key,restoreOptional(item,schema?.properties?.[key])]));
 return value;
}
export function safeOpenAIError(error:unknown){
 const code=error instanceof OpenAIError?error.message:error instanceof z.ZodError?'INVALID_OUTPUT':error instanceof Error&&/abort|timeout/i.test(error.name)?'TIMEOUT':'PROVIDER_ERROR';
 console.error('openai_request_failed',JSON.stringify({code,status:error instanceof OpenAIError?error.status:undefined}));
 if(error instanceof OpenAIError){
  if(code==='MODEL_UNAVAILABLE')return 'OpenAI 未采用指定的主题匹配模型，请检查 Luna 模型权限后重试。';
  if(error.status===401||error.status===403)return 'OpenAI API 密钥或模型权限不可用，请检查服务配置。';
  if(error.status===402||error.status===429)return 'OpenAI API 计费、额度或速率限制暂不可用；进度已保留。';
  if(error.status===404)return 'OpenAI API 模型不可用，请检查文本与图片模型设置。';
  if(code==='REFUSED')return 'OpenAI 暂时无法生成这段内容，请调整故事或制作要求。';
  if(code==='INVALID_LANDSCAPE_RATIO')return 'OpenAI 未返回 3∶2 横版图片，已保存的画面可继续使用。请重试这一幅。';
 }
 return code==='TIMEOUT'?'OpenAI API 等待超时，已保留进度。':'OpenAI API 暂时无法完成这一步，已保留进度。';
}
export function createOpenAIProvider(variables:Record<string,string|undefined>,media:MediaStore,transport:typeof fetch):ReaderProvider{
 return createResponsesProvider('openai',variables,media,transport);
}
export function createDeepSeekProvider(variables:Record<string,string|undefined>,media:MediaStore,transport:typeof fetch):ReaderProvider{
 return createResponsesProvider('deepseek',variables,media,transport);
}
function safeDeepSeekError(error:unknown){
 const validation=error instanceof Error&&['EDITORIAL_SOURCE_QUOTE','EDITORIAL_COVERAGE_REQUIRED','FRAME_COUNT_REVIEW_SCOPE'].includes(error.message)?error.message:undefined;
 const code=error instanceof OpenAIError?error.message:error instanceof z.ZodError?'INVALID_OUTPUT':validation|| (error instanceof Error&&/abort|timeout/i.test(error.name)?'TIMEOUT':'PROVIDER_ERROR');
 console.error('deepseek_request_failed',JSON.stringify({code,status:error instanceof OpenAIError?error.status:undefined}));
 if(error instanceof OpenAIError){
  if(error.status===401||error.status===403)return 'DeepSeek API 密钥或模型权限不可用，请检查服务配置。';
  if(error.status===402||error.status===429)return 'DeepSeek API 计费、额度或速率限制暂不可用；进度已保留。';
  if(error.status===404)return 'DeepSeek API 模型不可用，请检查文本模型设置。';
 }
 return code==='TIMEOUT'?'DeepSeek API 等待超时，已保留进度。':'DeepSeek API 暂时无法完成这一步，已保留进度。';
}
function deepSeekEffort(effort:ReasoningEffort):ReasoningEffort{
 // DeepSeek maps medium and xhigh to high; expose the effective effort in saved call metadata.
 return effort==='medium'||effort==='xhigh'?'high':effort;
}
function createResponsesProvider(provider:'openai'|'deepseek',variables:Record<string,string|undefined>,media:MediaStore,transport:typeof fetch):ReaderProvider{
 const deepseek=provider==='deepseek',base=deepseek?'https://api.deepseek.com':'https://api.openai.com/v1';
 const key=(deepseek?variables.DEEPSEEK_API_KEY:variables.OPENAI_API_KEY)?.trim()||'';
 const models=deepseek?{text:variables.DEEPSEEK_TEXT_MODEL?.trim()||'deepseek-flash',image:''}:{text:variables.OPENAI_TEXT_MODEL?.trim()||openaiDefaultModels.text,image:variables.OPENAI_IMAGE_MODEL?.trim()||openaiDefaultModels.image};
 const reasoning=configuredTaskReasoning(variables),timeoutMs=deepseek?15*60*1000:readerStoryboardTimeoutMs,safeError=deepseek?safeDeepSeekError:safeOpenAIError;
 if(deepseek)for(const task of reasoningTasks)reasoning[task]=deepSeekEffort(reasoning[task]);
 const matchingModel=deepseek?models.text:themeMatchModel,matchingEffort=deepseek?deepSeekEffort(themeMatchEffort):themeMatchEffort,label=deepseek?'DeepSeek API':'OpenAI API';
 if([models.text,...(deepseek?[]:[models.image])].some(model=>!model.match(/^[\w.-]{1,100}$/)))throw new OpenAIError('INVALID_MODEL',400);
 async function request(route:string,body:Record<string,unknown>|FormData,timeout=timeoutMs,signal?:AbortSignal){
  if(!key)throw new OpenAIError('KEY_REQUIRED',401);
  const multipart=body instanceof FormData;
  const options:RequestInit={method:'POST',headers:{Authorization:'Bearer '+key,...(!multipart?{'Content-Type':'application/json'}:{})},body:multipart?body:JSON.stringify(body),signal:signal?AbortSignal.any([AbortSignal.timeout(timeout),signal]):AbortSignal.timeout(timeout),redirect:'error'};
  beforePaidSend();
  const response=await transport(base+route,options);
  if(!response.ok){await response.body?.cancel();throw new OpenAIError('PROVIDER_ERROR',response.status);}
  let value:any;try{value=await response.json();}catch{throw new OpenAIError('PROVIDER_ERROR',502);}
  if(!value||typeof value!=='object')throw new OpenAIError('PROVIDER_ERROR',502);
  const requestId=response.headers.get('x-request-id');
  recordPaidResponse({requestId:value.id||requestId,usage:value.usage??null});
  return {value,requestId};
 }
 async function text(instructions:string,payload:unknown,schema:unknown,effort:ReasoningEffort,maxOutputTokens=8192,requestedModel=models.text,task?:ReasoningTask,signal?:AbortSignal){
  // Resolve only exact saved source references before the unchanged canonical review validators.
  const evidence=deepseek?sourceReviewEvidence(payload,schema):{payload,schema,direction:'',resolve:(value:unknown)=>value};
  if(evidence.direction)instructions+='\n\n'+evidence.direction;
  instructions=formatSystemPrompt(instructions);
  // Full-story review can consume 32K in reasoning alone, before it emits its JSON report.
  const tokenLimit=deepseek?Math.max(maxOutputTokens,effort==='max'||effort==='high'&&task==='review'?65536:effort==='high'?32768:8192):maxOutputTokens;
  const started=Date.now();
  const outputSchema=strictOpenAISchema(evidence.schema);
  const {value,requestId}=await request('/responses',{model:requestedModel,instructions,input:[{role:'user',content:JSON.stringify(evidence.payload)}],reasoning:{effort},text:{format:{type:'json_schema',name:'story_result',strict:true,schema:outputSchema}},max_output_tokens:tokenLimit,store:false},timeoutMs,signal);
  if(deepseek)console.info('deepseek_response',JSON.stringify(responsesDiagnostic({status:value.status,incompleteReason:value.incomplete_details?.reason,inputTokens:value.usage?.input_tokens,outputTokens:value.usage?.output_tokens,reasoningTokens:value.usage?.output_tokens_details?.reasoning_tokens,cachedInputTokens:value.usage?.input_tokens_details?.cached_tokens,maxOutputTokens:tokenLimit,reasoningEffort:effort,elapsedMs:Date.now()-started})));
  const fail=(code:string)=>Object.assign(new OpenAIError(code),{usage:value.usage,model:value.model});
  if(!deepseek&&requestedModel===themeMatchModel&&value.model&&value.model!==requestedModel)throw fail('MODEL_UNAVAILABLE');
  if(value.status!=='completed')throw fail('INCOMPLETE_RESPONSE');
  const content=(value.output||[]).filter((item:any)=>item.type==='message').flatMap((item:any)=>item.content||[]);
  if(content.some((item:any)=>item.type==='refusal'))throw fail('REFUSED');
  const output=content.filter((item:any)=>item.type==='output_text').map((item:any)=>item.text).join('');
  let parsed;try{parsed=JSON.parse(output);}catch{throw fail('INVALID_OUTPUT');}
  return {value:evidence.resolve(restoreOptional(parsed,evidence.schema)),model:value.model||requestedModel,requestId:value.id||requestId,usage:value.usage||null,reasoningEffort:effort,promptRecord:promptRecord(instructions,evidence.payload,outputSchema)};
 }
 function book(selection:Parameters<ReaderProvider['suggestions']>[0]){
  const source=storySource(selection);if(source.isUrl)throw new ReaderError(400,label+' 模式请使用内置书籍或书名；网页 URL 来源请使用 Gemini。');return source.book;
 }
 const checkThemes=<T extends {matches:unknown[]}>(theme:string,stories:ThemeStory[],context:DiscoveryContext|undefined,contract:ThemeMatchProtocol<T>,model=models.text)=>
  discoveryCall({stage:'matching',provider,model,effort:matchingEffort,requestedCount:stories.length},context,async report=>{
   const result=await text(contract.prompt,contract.payload(theme,stories),contract.json,matchingEffort,contract.outputTokens(stories.length),model);report(result);
   const parsed=contract.parse(result.value,stories);report({acceptedCount:parsed.matches.length});return parsed;
  });
 return {
  generationTimeoutMs:phase=>['recommend','plan','reflection','review','repair','restyle','image'].includes(phase)?timeoutMs:null,
  async status(){return {configured:!!key,provider,models,voiceEnabled:false,taskReasoningEfforts:reasoning,themeMatching:{model:matchingModel,reasoningEffort:matchingEffort},...(deepseek&&!key?{message:'请通过 DEEPSEEK_API_KEY 提供 DeepSeek 密钥；不会使用其他提供方的密钥。'}:{})};},
  async suggestions(selection,excluded,localBook,reading){
   const scanning=localBook?.purpose==='scan'||localBook?.purpose==='catalog';
   const cards=localBook?.purpose==='cards';reading?.signal?.throwIfAborted();
   const run=async(report:(meta:{model?:string;usage?:unknown;acceptedCount?:number})=>void)=>{
    const result=await text(localBook?localReadingPrompt(localBook):suggestionSystemPrompt,localSuggestionPayload(book(selection),selection.theme,excluded,localBook,reading?.maxStories),localBook?.purpose==='catalog'?localCatalogOutputJson(localBook):cards?localCardsJson:scanning?localScanJson:localBook?localChoicesJson:choicesJson,reasoning.suggest,localBook?.purpose==='catalog'?localCatalogOutputTokens(localBook.scan?.maxStories||1):cards?localCardsOutputTokens:scanning?10000:localBook?5000:2500,models.text,undefined,reading?.signal);
    report(result);const batch=localBook?localChoices(result.value,localBook):suggestionBatchSchema.parse(result.value),fresh=scanning?batch:freshSuggestions(batch,excluded);report({acceptedCount:fresh.stories.length});
    return reading?.maxStories?{...fresh,stories:fresh.stories.slice(0,reading.maxStories)}:fresh;
   };
   return scanning||cards?discoveryCall({stage:'extraction',provider,model:models.text,effort:reasoning.suggest,requestedCount:cards?5:localBook?.scan?.maxStories||1},reading,run):run(()=>{});
  },
  matchStories:(theme,stories,context)=>checkThemes(theme,stories,context,binaryThemeMatch,matchingModel),
  verifyThemeStories:(theme,stories,context,evidence)=>checkThemes(theme,stories,context,themeVerificationProtocol(evidence)),
  async recommendArt(selection,original){
   if(!original?.localSource)throw new ReaderError(400,'请先选择已核对出处的故事。');
   const result=await text(selectedArtRecommendationPrompt,selectedArtRecommendationPayload(selection,original),artRecommendationJson,reasoning.art,2048);return artRecommendationSchema.parse(result.value);
  },
  generator(){return {
   ...storyboardGenerator(book,(task,instructions,payload,schema,maxOutputTokens)=>text(instructions,payload,schema,reasoning[task],maxOutputTokens,models.text,task)),
   original:(selection,plan,id)=>saveStoryOriginal(media,selection,plan,id,transport),
   async recommend(selection,_id,original,prepareRequirements=false){const result=await text(frameRecommendationPrompt,frameRecommendationPayload(selection,original,prepareRequirements),frameRecommendationOutputJson(original,prepareRequirements,preparesSelectedStory(selection,original)),reasoning.frames,original.storyBrief?4096:2048);return {...result,value:frameRecommendationOutputSchema(original,prepareRequirements,preparesSelectedStory(selection,original)).parse(result.value)};},
   async image(plan,page,id,reference,style='ink-pencil',productionPrompt='',artifactId,layout='portrait',artStylePrompt,promptOverride){
    if(deepseek)throw new ReaderError(400,'DeepSeek 当前仅支持文字制作，请在分镜审核后停止；不会自动调用其他提供方生图。');
    if(layout==='landscape'&&(!reference||!artifactId))throw new OpenAIError('INVALID_ANCHOR');
    const size=layout==='landscape'?landscapeImageSize:imageRequestSize(variables.IMAGE_SIZE)?.size;if(!size)throw new OpenAIError('INVALID_IMAGE_SIZE',400);
    const prompt=promptOverride??imagePrompt(plan,page,style,productionPrompt,!!reference,layout,artStylePrompt);
    let body:Record<string,unknown>|FormData={model:models.image,prompt,n:1,size,output_format:'png'},route='/images/generations';
    if(reference){
     const ref=referenceImageKey(id,reference);if(!ref)throw new OpenAIError('INVALID_ANCHOR');
     const saved=await readDrawingReference(()=>media.get(ref));if(!saved)throw new OpenAIError('INVALID_ANCHOR');
     const bytes=new Uint8Array(await readDrawingReference(()=>saved.arrayBuffer())),mime=mediaType(bytes);
     if(!mime||!imageDimensions(bytes)||bytes.length>12*1024*1024)throw new OpenAIError('INVALID_ANCHOR');
     const form=new FormData();for(const [name,value] of Object.entries(body))form.set(name,String(value));
     form.set('image[]',new Blob([bytes],{type:mime}),'reference.'+imageTypes[mime]);body=form;route='/images/edits';
    }
    const {value,requestId}=await request(route,body),encoded=value.data?.[0]?.b64_json;
    if(typeof encoded!=='string'||!encoded.length||encoded.length>17*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new OpenAIError('INVALID_IMAGE');
    const bytes=new Uint8Array(Buffer.from(encoded,'base64')),mime=mediaType(bytes);
    const dimensions=imageDimensions(bytes);
    if(!mime||!dimensions||bytes.length>12*1024*1024)throw new OpenAIError('INVALID_IMAGE');
    if(layout==='landscape'&&!matchesLandscapeImageRatio(dimensions))throw new OpenAIError('INVALID_LANDSCAPE_RATIO');
    const asset=readerImageAsset(id,page,imageTypes[mime],artifactId);await media.put(asset.key,bytes,{contentType:mime});
    return {value:asset.url,model:models.image,requestId,usage:value.usage||null,promptRecord:promptRecord('',prompt,undefined,reference||undefined)};
   },
   async audio(){throw new ReaderError(400,'当前不提供配音。');},safeError,
  };},safeError,
 };
}
