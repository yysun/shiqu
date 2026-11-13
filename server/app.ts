// 共用正式 API、生产调度与媒体；动态生成配置在每项任务入口固定，不重启服务或数据库。
import path from 'node:path';
import {readFile,realpath,stat} from 'node:fs/promises';
import {currentMediaKeys} from './library-upgrade.ts';
import {openDatabase} from './database.ts';
import {FileMedia} from './media.ts';
import {localOwnerId} from './config.ts';
import {createReaderProvider} from './generation.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {createApi} from '../lib/server.ts';
import type {Services} from '../lib/services.ts';
import {LocalBooks} from './local-books.ts';
import {applicationStorySearch} from './local-story-search.ts';
import {withLocalBooks} from './local-generation.ts';
import {ReaderProductionCoordinator,configuredImageWorkers} from './reader-production.ts';
import type {ProductionOptions} from './reader-production.ts';
import {providerSignature} from './provider-runtime.ts';
import {providerReady} from './cli-setup.ts';
import {StoryDiscoveryCache} from './story-discovery-cache.ts';
import {ReaderError} from '../lib/reader-model.ts';

type Variables=Record<string,string|undefined>;
// 属性读取绑定当前实例，生产 capture 则返回固定代际；退出和错误处理不再访问设置库。
export function liveReaderProvider(initial:Variables,read:()=>Variables,create:(variables:Variables)=>ReaderProvider):ReaderProvider{
 let current=create(initial),signature=providerSignature(initial);
 function snapshot(){
  let variables:Variables;
  try{variables=read();}catch{throw new ReaderError(503,'暂时无法读取生成配置，请重新读取设置后再试。');}
  const nextSignature=providerSignature(variables);
  if(signature!==nextSignature){const next=create(variables);current=next;signature=nextSignature;}
  let ready=false;try{ready=variables.SHIQU_AI_PROVIDER!=='readonly'&&providerReady(variables);}catch{/* 无效启动凭据不能派发新任务。 */}
  return {provider:current,ready};
 }
 return new Proxy(current,{get(_target,property){
  if(property==='capture')return ()=>{const next=snapshot();return next.ready?next.provider:null;};
  if(property==='status'){const next=snapshot();return async()=>{const status=await next.provider.status();return next.ready?status:{...status,configured:false};};}
  const provider=['safeError','discoveryBusy','settleDiscovery'].includes(String(property))?current:snapshot().provider;
  const value=Reflect.get(provider,property);return typeof value==='function'?value.bind(provider):value;
 }});
}

const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ico':'image/x-icon'};
export function createApplication(options:{root:string;dataDirectory:string;variables?:Variables;providerVariables?:()=>Variables;transport?:typeof fetch;generation?:ReaderProvider;production?:ProductionOptions;commandOnly?:boolean}){
 const media=new FileMedia(path.join(options.dataDirectory,'media'));
 const storySearch=applicationStorySearch(options.root,options.dataDirectory,()=>localBooks,options.transport||fetch);
 const localBooks:LocalBooks=new LocalBooks(options.root,storySearch);
 const cache=new StoryDiscoveryCache(media),create=(variables:Variables)=>withLocalBooks(createReaderProvider(variables,media,options.transport||fetch),localBooks,media,cache,storySearch);
 const generation=options.generation||(options.providerVariables?liveReaderProvider(options.variables||{},options.providerVariables,create):create(options.variables||{}));
 const imageWorkers=configuredImageWorkers(options.variables?.SHIQU_IMAGE_WORKERS);
 const local=openDatabase(options.dataDirectory,options.root);
 let retainedLegacyArt:Set<string>|undefined;
 const production=new ReaderProductionCoordinator(local.database,generation,media,{imageWorkers,...options.production});
 if(!options.providerVariables&&options.variables?.SHIQU_AI_PROVIDER==='readonly'&&options.production?.autoStart!==false)production.stop();
 const services:Services={db:local.db,database:local.database,media,variables:options.variables||{},ownerId:localOwnerId,localBooks,transport:options.transport||fetch,generation,production,commandOnly:options.commandOnly};
 const api=createApi(services),publicDirectory=path.resolve(options.root,'dist/client');
 let closed=false,closing:Promise<void>|undefined;
 return {services,get generating(){return production.busy;},startGeneration:()=>production.start(),stopGeneration:()=>production.stop(),close(){
  if(closed)return closing;
  production.stop();closed=true;
  if(!production.busy){void production.close();local.close();return;}
  return closing=production.close().then(()=>local.close());
 },async handle(request:Request){
  const url=new URL(request.url);
  try{
   if(url.pathname==='/api'||url.pathname.startsWith('/api/')){
    const segments=url.pathname.slice(5).split('/').filter(Boolean).map(decodeURIComponent);
    return await api(request,segments);
   }
   if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
   const pathname=decodeURIComponent(url.pathname);
   if(pathname.split('/').some(segment=>segment.startsWith('.')||segment.includes('\\')))return new Response('Not found',{status:404});
   // Legacy art is served only while a current story uses it. Inventory once on first request so startup
   // never scans the library; an unreadable inventory serves nothing instead of failing the app.
   if(pathname.startsWith('/art/')){
    const key='legacy-art/'+pathname.slice(5);
    if(!retainedLegacyArt)try{retainedLegacyArt=currentMediaKeys(local.sqlite,options.dataDirectory);}catch{retainedLegacyArt=new Set();}
    if(!retainedLegacyArt.has(key))return new Response('Not found',{status:404});
    const object=await media.get(key);if(!object)return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:object.body,{headers:{'Content-Type':object.contentType,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'}});
   }
   const file=path.join(publicDirectory,pathname==='/'||pathname==='/read'?'index.html':pathname);
   let resolved,publicRoot;
   try{publicRoot=await realpath(publicDirectory);resolved=await realpath(file);}catch{return new Response('Not found',{status:404});}
   if(!resolved.startsWith(publicRoot+path.sep)||!(await stat(resolved)).isFile())return new Response('Not found',{status:404});
   const headers=new Headers({'Content-Type':types[path.extname(resolved)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
   return new Response(request.method==='HEAD'?null:new Uint8Array(await readFile(resolved)),{headers});
  }catch(error){
   if(error instanceof URIError)return Response.json({error:'无效路径'},{status:400});
   console.error('request_failed',error instanceof Error?error.name:'Unknown');
   return Response.json({error:'服务暂时不可用，请稍后重试。'},{status:500});
  }
 }};
}
