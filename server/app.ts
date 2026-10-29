// Serve public assets and narrowly scoped historical artwork preserved in the local media store.
import path from 'node:path';
import {readFile,realpath,stat} from 'node:fs/promises';
import {openDatabase} from './database.ts';
import {FileMedia} from './media.ts';
import {localOwnerId} from './config.ts';
import {createReaderProvider} from './generation.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {createApi} from '../lib/server.ts';
import type {Services} from '../lib/services.ts';
import {LocalBooks} from './local-books.ts';
import {withLocalBooks} from './local-generation.ts';
import {ReaderProductionCoordinator,configuredImageWorkers} from './reader-production.ts';

const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ico':'image/x-icon'};
export function createApplication(options:{root:string;dataDirectory:string;variables?:Record<string,string|undefined>;transport?:typeof fetch;generation?:ReaderProvider}){
 const media=new FileMedia(path.join(options.dataDirectory,'media'));
 const generation=options.generation||withLocalBooks(createReaderProvider(options.variables||{},media,options.transport||fetch),new LocalBooks(options.root),media);
 const imageWorkers=configuredImageWorkers(options.variables?.SHIQU_IMAGE_WORKERS);
 const local=openDatabase(options.dataDirectory,options.root);
 const production=new ReaderProductionCoordinator(local.database,generation,media,{imageWorkers});
 const services:Services={db:local.db,database:local.database,media,variables:options.variables||{},ownerId:localOwnerId,transport:options.transport||fetch,generation,production};
 const api=createApi(services),publicDirectory=path.resolve(options.root,'dist/client');
 let closed=false,closing:Promise<void>|undefined;
 return {services,stopGeneration:()=>production.stop(),close(){
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
   if(/^\/art\/(?:pear-(?:[1-9]|10)|dongguo-(?:[1-9]|[12][0-9]|30))\.png$/.test(pathname)){
    const saved=await media.get('legacy-art/'+pathname.split('/').at(-1));
    return saved?new Response(request.method==='HEAD'?null:saved.body,{headers:{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-cache'}}):new Response('Not found',{status:404});
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
