// Exercise the real workerd fetch implementation; only the upstream HTTP service is simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const runtimeRequire=createRequire(realpathSync(new URL('../node_modules/wrangler/package.json',import.meta.url)));
const {Miniflare,Response:UpstreamResponse}=runtimeRequire('miniflare');
const {build}=runtimeRequire('esbuild');
const {outputFiles}=await build({stdin:{contents:`
 import {lookupOriginal} from './lib/reader-source.ts';
 export default {async fetch(){
  return Response.json(await lookupOriginal(
   {bookId:'西游记',storyTitle:'高老庄',theme:'幽默与讽刺',length:10,voice:false},
   {sourceReference:'《西游记》第十八回 观音院唐僧脱难 高老庄大圣除魔',pages:[]}
  ));
 }};
`,resolveDir:root,sourcefile:'source-worker-probe.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
const script=outputFiles[0].text;

test('uncached chapter lookup reaches Wikisource through the real workerd fetch API',async()=>{
 const requests=[];
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-05-15',script,outboundService:request=>{
  requests.push(request.url);const url=new URL(request.url);
  assert.equal(url.origin,'https://zh.wikisource.org');assert.equal(url.searchParams.get('page'),'西遊記/第018回');
  return UpstreamResponse.json({parse:{title:'西遊記/第018回',text:'<p>却说那高老庄上有一高太公，他因女儿婚事忧愁，请来大圣识破妖怪，还这庄上一片安宁。</p>'}});
 }});
 try{
  const result=await (await runtime.dispatchFetch('http://localhost/')).json();
  assert.ok(result.source,result.failure?.code);assert.equal(result.source.kind,'chapter');assert.match(result.source.text,/高太公/);assert.equal(requests.length,1);
 }finally{await runtime.dispose();}
});

test('workerd rejects upstream redirects without following them to another host',async()=>{
 const requests=[];
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-05-15',script,outboundService:request=>{
  requests.push(request.url);return new UpstreamResponse(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});
 }});
 try{
  const result=await (await runtime.dispatchFetch('http://localhost/')).json();
  assert.equal(result.source,null);assert.deepEqual(result.failure,{code:'SOURCE_HTTP_ERROR',status:302});assert.equal(requests.length,1);
  assert.ok(requests.every(url=>new URL(url).origin==='https://zh.wikisource.org'));
 }finally{await runtime.dispose();}
});
