// Generate story plans and media through Gemini, preserving safe errors and validated results.
import {z} from 'zod';
import {planSchema,readerBooks} from './reader-model.ts';
import type {Plan,Selection} from './reader-model.ts';
import type {StoryGenerator} from './reader-engine.ts';
import {freshSuggestions,suggestionBatchSchema} from './reader-suggestions.ts';
import {getArtStyle} from './reader-styles.ts';
import {choicesJson,planJson,suggestionSystemPrompt,planSystemPrompt,imagePrompt,imageTypes,mediaType} from './reader-generation-contract.ts';
export {imageTypes} from './reader-generation-contract.ts';
import type {ArtStyleId} from './reader-styles.ts';
import {saveStoryOriginal} from './reader-source-storage.ts';
import {localChoicesJson,localIndexJson,localChoices,localReadingPrompt,localPlanConstraint,localSuggestionPayload} from './reader-local-contract.ts';
import type {WholeBookInput} from './reader-local-contract.ts';
import type {OriginalSource} from './reader-source-types.ts';

export const defaultModels={text:'gemini-3.8-flash',image:'gemini-nano-banana-2.1'};
type Models=typeof defaultModels;
export interface Assets {
 get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>;
 put(key:string,value:ArrayBuffer|Uint8Array,options:{contentType:string}):Promise<unknown>;
}
type Part={text?:string;thought?:boolean;inlineData?:{mimeType:string;data:string}};
type UrlMetadata={retrievedUrl?:string;urlRetrievalStatus?:string;retrieved_url?:string;url_retrieval_status?:string};
type Candidate={content?:{parts?:Part[]};finishReason?:string;urlContextMetadata?:{urlMetadata?:UrlMetadata[]};url_context_metadata?:{url_metadata?:UrlMetadata[]}};
type Result={candidates?:Candidate[];promptFeedback?:{blockReason?:string};responseId?:string;modelVersion?:string;usageMetadata?:unknown};
export class GeminiError extends Error {
 status:number;
 constructor(code:string,status=502){super(code);this.status=status;}
}
const choicesSchema=suggestionBatchSchema;

export function configuredModels(vars:Record<string,string|undefined>):Models {
 return {text:vars.GEMINI_TEXT_MODEL?.trim()||defaultModels.text,image:vars.GEMINI_IMAGE_MODEL?.trim()||defaultModels.image};
}
function source(selection:Selection){
 const book=(selection.bookId==='other'?selection.customBook:readerBooks.find(b=>b.id===selection.bookId)?.title||selection.bookId)?.trim();
 if(!book)throw new GeminiError('INVALID_SOURCE',400);
 let url='';
 if(/^https?:/i.test(book)){
  try{const parsed=new URL(book);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();parsed.hash='';url=parsed.href;}catch{throw new GeminiError('INVALID_SOURCE',400);}
 }
 return {book:url||book,url};
}
function wasRead(candidate:Candidate,url:string){
 const metadata=candidate.urlContextMetadata?.urlMetadata||candidate.url_context_metadata?.url_metadata||[];
 return metadata.some(m=>{
  try{const retrieved=new URL(m.retrievedUrl||m.retrieved_url||'');retrieved.hash='';return retrieved.href===url&&(m.urlRetrievalStatus||m.url_retrieval_status)==='URL_RETRIEVAL_STATUS_SUCCESS';}catch{return false;}
 });
}
function encode(bytes:Uint8Array){
 // Avoid spreading an entire image onto the JS stack in a Worker.
 let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(binary);
}
export function safeGeminiError(error:unknown){
 // Log only codes and validation paths, never raw provider messages, prompts or credentials.
 console.error('reader_generation_error',JSON.stringify(error instanceof GeminiError?{code:error.message,status:error.status}:error instanceof z.ZodError?{code:'INVALID_OUTPUT',fields:error.issues.map(i=>i.path.join('.'))}:{code:error instanceof Error?error.name:'UNKNOWN'}));
 if(error instanceof GeminiError){
  if(error.message==='SOURCE_UNAVAILABLE')return '暂时无法读取这个链接，请换一个可公开访问的原文页面。';
  if(error.message==='INVALID_SOURCE')return '请填写有效的书名或公开网页链接。';
  if(error.message==='CONTENT_BLOCKED')return '这段内容暂时无法生成，请换一个故事再试。';
  if(error.status===401||error.status===403)return '生成服务的密钥或模型权限暂不可用，请检查服务配置。';
  if(error.status===402)return '生成服务的计费或余额暂不可用，请检查 Gemini 项目的计费状态和可用额度。你的选择已保留。';
  if(error.status===404)return '所选模型暂不可用，请检查服务配置。';
  if(error.status===429)return '生成服务繁忙或额度暂不可用，已保留你的故事。';
 }
 if(error instanceof Error&&/timeout|abort/i.test(error.name))return '生成等待超时，已保留前面的内容。可手动重试。';
 return '这一步暂时没能生成，已保留前面的内容。可手动重试。';
}
function client(key:string,transport:typeof fetch){
 return async(model:string,input:Record<string,unknown>,timeout=120000)=>{
  if(!/^[a-zA-Z0-9._-]+$/.test(model))throw new GeminiError('INVALID_MODEL',400);
  const response=await transport(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
   method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
   body:JSON.stringify({...input,store:false}),signal:AbortSignal.timeout(timeout),
  });
  // Never propagate a provider's response body; it may echo private prompts or credentials.
  if(!response.ok){
   let failure:{error?:{status?:string;message?:string}}={};try{failure=await response.json() as typeof failure;}catch{}
   const status=failure.error?.status,unknownFields=[...(failure.error?.message||'').matchAll(/Unknown name "([A-Za-z_][A-Za-z0-9_.]{0,70})"/g)].map(m=>m[1]);
   console.error('gemini_request_rejected',JSON.stringify({httpStatus:response.status,model,status:status&&/^[A-Z_]{1,50}$/.test(status)?status:undefined,unknownFields}));
   throw new GeminiError('PROVIDER_ERROR',response.status);
  }
  const result=await response.json() as Result,candidate=result.candidates?.[0];
  if(result.promptFeedback?.blockReason||candidate?.finishReason&&['SAFETY','IMAGE_SAFETY','PROHIBITED_CONTENT','BLOCKLIST','RECITATION'].includes(candidate.finishReason))throw new GeminiError('CONTENT_BLOCKED');
  if(!candidate||candidate.finishReason&&candidate.finishReason!=='STOP')throw new GeminiError('INCOMPLETE_RESPONSE');
  return {result,candidate,metadata:{model:result.modelVersion||model,requestId:result.responseId||response.headers.get('x-request-id')||null,usage:result.usageMetadata||null}};
 };
}
function textRequest(system:string,data:unknown,schema:unknown,url:string,maxOutputTokens:number){
 return {systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:JSON.stringify(data)}]}],
  ...(url?{tools:[{urlContext:{}}]}:{}),
  generationConfig:{maxOutputTokens,thinkingConfig:{thinkingLevel:'LOW'},responseFormat:{text:{mimeType:'APPLICATION_JSON',schema}}}};
}
function parseText(candidate:Candidate){
 const value=candidate.content?.parts?.filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('');
 if(!value)throw new GeminiError('INVALID_TEXT');
 try{return JSON.parse(value);}catch{throw new GeminiError('INVALID_JSON');}
}
export async function suggestStories(key:string,selection:Selection,config:Partial<Models>={},transport:typeof fetch=fetch,excludeTitles:string[]=[],localBook?:WholeBookInput){
 const models={...defaultModels,...config},{book,url}=source(selection),index=localBook?.purpose==='story-index';
 const {candidate}=await client(key,transport)(models.text,textRequest(
  localBook?localReadingPrompt(localBook):suggestionSystemPrompt,
  localSuggestionPayload(book,selection.theme,excludeTitles,localBook),index?localIndexJson:localBook?localChoicesJson:choicesJson,url,index?8000:localBook?5000:2500),index?180000:localBook?120000:60000);
 if(url&&!wasRead(candidate,url))return {stories:[],note:'暂时无法读取这个链接，请提供可公开访问的原文页面，或直接输入书名。'};
 const batch=localBook?localChoices(parseText(candidate),localBook):choicesSchema.parse(parseText(candidate));
 return index||localBook?.purpose==='candidate-summary'?batch:freshSuggestions(batch,excludeTitles);
}
export function makeGenerator(key:string,assets:Assets,config:Partial<Models>={},transport:typeof fetch=fetch):StoryGenerator{
 const models={...defaultModels,...config},generate=client(key,transport);
 return {
  original:(selection,plan,id)=>saveStoryOriginal(assets,selection,plan,id,transport),
  async plan(selection:Selection,id:string,original?:OriginalSource){
   const {book,url}=source(selection);
   const {candidate,metadata}=await generate(models.text,textRequest(
    planSystemPrompt+(original?.localSource?'\n'+localPlanConstraint:''),
    {book,chosenStory:selection.storyTitle,theme:selection.theme,exactPageCount:selection.length,productionPrompt:selection.productionPrompt||'',artDirection:getArtStyle(selection.artStyle).prompt,variationSeed:id,...(original?.localSource?{verifiedOriginal:{title:original.title,text:original.text,url:original.url}}:{})},planJson(selection.length),url,8192));
   if(url&&!wasRead(candidate,url))throw new GeminiError('SOURCE_UNAVAILABLE');
   const value=planSchema.parse(parseText(candidate));
   if(value.pages.length!==selection.length)throw new GeminiError('INVALID_PLAN');
   return {value,...metadata};
  },
  async image(plan:Plan,page:number,id:string,reference:string,style:ArtStyleId='ink-pencil',productionPrompt=''){
   const parts:Part[]=[];
   if(page>0&&reference){
    // Only load the existing first scene from this story's own bucket prefix.
    const file=reference.split('/').pop()||'';
    if(!/^0\.(png|jpg|webp)$/.test(file))throw new GeminiError('INVALID_ANCHOR');
    const anchor=await assets.get(`reader/${id}/${file}`);if(!anchor)throw new GeminiError('MISSING_ANCHOR');
    const bytes=new Uint8Array(await anchor.arrayBuffer()),mimeType=mediaType(bytes);
    if(!mimeType||bytes.length>12*1024*1024)throw new GeminiError('INVALID_ANCHOR');
    parts.push({inlineData:{mimeType,data:encode(bytes)}});
   }
   parts.push({text:imagePrompt(plan,page,style,productionPrompt,!!reference)});
   const {candidate,metadata}=await generate(models.image,{contents:[{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'2:3',imageSize:'1K'}}});
   const output=candidate.content?.parts?.find(p=>!p.thought&&p.inlineData)?.inlineData;
   if(!output||!(output.mimeType in imageTypes)||output.data.length>17*1024*1024)throw new GeminiError('INVALID_MEDIA');
   let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(output.data),c=>c.charCodeAt(0));}catch{throw new GeminiError('INVALID_MEDIA');}
   if(!bytes.length||bytes.length>12*1024*1024||mediaType(bytes)!==output.mimeType)throw new GeminiError('INVALID_MEDIA');
   const extension=imageTypes[output.mimeType as keyof typeof imageTypes],file=`${page}.${extension}`;
   await assets.put(`reader/${id}/${file}`,bytes,{contentType:output.mimeType});
   return {value:`/api/reader/media/${id}/${file}`,...metadata};
  },
  async audio(){throw new GeminiError('VOICE_DISABLED');},
  safeError:safeGeminiError,
 };
}
