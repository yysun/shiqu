// 逐跳解析并固定公网地址，避免网页导入访问本机、内网或被重绑定的主机。
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import type {RequestOptions} from 'node:https';

export const importSourceLimit=12*1024*1024,importSourceCountLimit=100,importBookBytesLimit=64*1024*1024,importPageTimeoutMs=30_000,importBatchTimeoutMs=5*60_000,importRedirectLimit=5;
export class BookImportFetchError extends Error{url:string;constructor(code:string,url:string){super(code);this.name='BookImportFetchError';this.url=url;}}
function ipv4Blocked(value:string){
 const parts=value.split('.').map(Number);if(parts.length!==4||parts.some(part=>!Number.isInteger(part)||part<0||part>255))return true;
 const [a,b]=parts;
 const c=parts[2];
 return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===0||b===88&&c===99||b===168||b===0&&c===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113;
}
function ipv6Blocked(value:string){
 const address=value.toLowerCase().split('%')[0];let expanded=address;
 if(address.includes('.')){
  const colon=address.lastIndexOf(':'),octets=address.slice(colon+1).split('.').map(Number);
  if(octets.length!==4||octets.some(part=>!Number.isInteger(part)||part<0||part>255))return true;
  expanded=`${address.slice(0,colon)}:${((octets[0]<<8)|octets[1]).toString(16)}:${((octets[2]<<8)|octets[3]).toString(16)}`;
 }
 const marker=expanded.indexOf('::'),left=(marker<0?expanded:expanded.slice(0,marker)).split(':').filter(Boolean),right=marker<0?[]:expanded.slice(marker+2).split(':').filter(Boolean),missing=8-left.length-right.length;
 if(missing<0||marker<0&&missing!==0)return true;
 const words=[...left,...Array(marker<0?0:missing).fill('0'),...right].map(part=>parseInt(part,16));if(words.length!==8||words.some(word=>!Number.isInteger(word)))return true;
 const [first,second,third,fourth,fifth,sixth]=words;
 if(words.slice(0,6).every(word=>word===0)||words.slice(0,5).every(word=>word===0)&&sixth===0xffff)return true;
 if(first===0x0064&&second===0xff9b&&(third===0&&fourth===0&&fifth===0&&sixth===0||third===1))return true;
 if(first===0x0100&&second===0&&third===0&&fourth===0)return true;
 if((first&0xfe00)===0xfc00||(first&0xffc0)===0xfe80||(first&0xff00)===0xff00)return true;
 if(first<0x2000||first>0x3fff||first===0x2001&&(second<=0x01ff||second===0x0db8)||first===0x2002||first===0x3fff&&(second&0xf000)===0)return true;
 return false;
}
export function isPublicImportAddress(address:string){const family=isIP(address);return family===4?!ipv4Blocked(address):family===6?!ipv6Blocked(address):false;}
async function pinnedLookup(hostname:string){
 if(hostname.toLowerCase()==='host.docker.internal')throw new Error('PRIVATE_ADDRESS');
 let records:{address:string;family:number}[];
 try{records=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await lookup(hostname,{all:true,verbatim:true});}catch{throw new Error('DNS_FAILED');}
 if(!records.length||records.some(item=>!isPublicImportAddress(item.address)))throw new Error('PRIVATE_ADDRESS');
 return records[0];
}
type ResolveImportHost=(hostname:string)=>Promise<{address:string;family:number}>;
type ImportTransport=(url:URL,options:RequestOptions)=>ReturnType<typeof httpsRequest>;
export function requestImportPage(url:URL,deadline:number,signal?:AbortSignal,resolveHost:ResolveImportHost=pinnedLookup,requestWith:ImportTransport=(target,options)=>target.protocol==='https:'?httpsRequest(target,options):httpRequest(target,options)):
 Promise<{bytes:Uint8Array;contentType:string;url:string;fetchedAt:string}>{
 return new Promise((resolve,reject)=>{
  let settled=false,active:ReturnType<typeof httpRequest>|ReturnType<typeof httpsRequest>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const finish=(error?:Error,value?:{bytes:Uint8Array;contentType:string;url:string;fetchedAt:string})=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value!);};
  const abort=()=>{const error=new BookImportFetchError('CANCELLED',url.href);if(active)active.destroy(error);else finish(error);};
  const remaining=deadline-Date.now();if(remaining<=0){finish(new BookImportFetchError('TOTAL_TIMEOUT',url.href));return;}
  timer=setTimeout(()=>{const error=new BookImportFetchError(remaining<importPageTimeoutMs?'TOTAL_TIMEOUT':'PAGE_TIMEOUT',url.href);if(active)active.destroy(error);else finish(error);},Math.min(importPageTimeoutMs,remaining));
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  void (async()=>{
   let selected:{address:string;family:number};try{selected=await resolveHost(url.hostname);}catch(error){if(settled)return;finish(new BookImportFetchError(error instanceof Error?error.message:'DNS_FAILED',url.href));return;}
   if(settled)return;
   if(signal?.aborted){abort();return;}
   if(Date.now()>=deadline){finish(new BookImportFetchError('TOTAL_TIMEOUT',url.href));return;}
   const lookupPinned:NonNullable<RequestOptions['lookup']>=(_host,options,callback)=>{
    if(typeof options==='object'&&options.all)callback(null,[selected]);
    else callback(null,selected.address,selected.family);
   };
   const req=requestWith(url,{method:'GET',headers:{'User-Agent':'ShiquBookImport/1.0','Accept':'text/html, text/plain, application/epub+zip'},lookup:lookupPinned,servername:url.hostname,agent:false});active=req;
   req.on('response',response=>{
    const status=response.statusCode||0;
    if(status>=300&&status<400&&response.headers.location){response.resume();finish(undefined,{bytes:new Uint8Array(),contentType:`redirect:${response.headers.location}`,url:url.href,fetchedAt:new Date().toISOString()});return;}
    if(status<200||status>=300){response.resume();finish(new BookImportFetchError('HTTP_STATUS',url.href));return;}
    const contentType=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    if(!['text/html','text/plain','application/epub+zip'].includes(contentType)){response.resume();finish(new BookImportFetchError('CONTENT_TYPE',url.href));return;}
    const length=Number(response.headers['content-length']||0);if(length>importSourceLimit){response.resume();finish(new BookImportFetchError('SIZE_LIMIT',url.href));return;}
    const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>importSourceLimit){response.destroy(new BookImportFetchError('SIZE_LIMIT',url.href));return;}chunks.push(chunk);});
    response.on('error',error=>finish(error instanceof BookImportFetchError?error:new BookImportFetchError('FETCH_FAILED',url.href)));
    response.on('end',()=>{if(!size){finish(new BookImportFetchError('EMPTY_RESPONSE',url.href));return;}finish(undefined,{bytes:new Uint8Array(Buffer.concat(chunks)),contentType,url:url.href,fetchedAt:new Date().toISOString()});});
   });
   req.on('error',error=>finish(error instanceof BookImportFetchError?error:new BookImportFetchError('FETCH_FAILED',url.href)));req.end();
  })();
 });
}
export async function fetchImportUrl(input:string,options:{signal?:AbortSignal;deadline?:number}={}){
 let current:URL;try{current=new URL(input);}catch{throw new BookImportFetchError('URL_INVALID',input.slice(0,500));}
 if(!['http:','https:'].includes(current.protocol)||current.username||current.password)throw new BookImportFetchError('URL_INVALID',current.href);
 const deadline=options.deadline||Date.now()+importBatchTimeoutMs;
 for(let redirects=0;redirects<=importRedirectLimit;redirects++){
  if(Date.now()>=deadline)throw new BookImportFetchError('TOTAL_TIMEOUT',current.href);
  const response=await requestImportPage(current,deadline,options.signal);
  if(response.contentType.startsWith('redirect:')){
   if(redirects===importRedirectLimit)throw new BookImportFetchError('REDIRECT_LIMIT',current.href);
   try{current=new URL(response.contentType.slice('redirect:'.length),current);}catch{throw new BookImportFetchError('REDIRECT_INVALID',current.href);}
   if(!['http:','https:'].includes(current.protocol)||current.username||current.password)throw new BookImportFetchError('URL_INVALID',current.href);
   continue;
  }
  return response;
 }
 throw new BookImportFetchError('REDIRECT_LIMIT',current.href);
}
export async function fetchImportUrls(urls:string[],options:{signal?:AbortSignal;now?:()=>number}={}){
 if(!urls.length||urls.length>importSourceCountLimit)throw new BookImportFetchError('SOURCE_COUNT_LIMIT',urls[0]||'');
 const deadline=(options.now||Date.now)()+importBatchTimeoutMs,results:{bytes:Uint8Array;contentType:string;url:string;fetchedAt:string}[]=[];let total=0;
 for(const url of urls){const result=await fetchImportUrl(url,{signal:options.signal,deadline});total+=result.bytes.length;if(total>importBookBytesLimit)throw new BookImportFetchError('BOOK_SIZE_LIMIT',result.url);results.push(result);}
 return results;
}
