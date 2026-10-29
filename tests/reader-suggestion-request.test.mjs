// Reproduce stalled discovery, fragmented progress, disconnects, and cancelled server work.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {requestSuggestions} from '../lib/reader-suggestion-request.ts';
import {createApplication} from '../server/app.ts';
import {createHttpServer} from '../server/http.ts';
import {once} from 'node:events';
import {suggestionProgressSchema,suggestionReadingPercent} from '../lib/reader-suggestions.ts';

const selection={bookId:'zhuangzi',theme:'给我一个反转',artStyle:'ink-pencil',length:8,voice:false};
const batch={stories:[{title:'庄周梦蝶',description:'梦醒之后的疑问。'}],note:''};
const encode=value=>new TextEncoder().encode(JSON.stringify(value)+'\n');
const response=stream=>new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}});

test('reading percentage uses character totals, withholds 100% until complete, and validates bounds',()=>{
 const progress={completed:1,total:6,completedChars:19999,totalChars:20000,stage:'reading'};
 assert.equal(suggestionReadingPercent({...progress,completedChars:0,totalChars:0}),null);
 assert.equal(suggestionReadingPercent({...progress,completedChars:2500}),12);
 assert.equal(suggestionReadingPercent(progress),99);
 assert.equal(suggestionReadingPercent({...progress,completedChars:20000}),100);
 assert.throws(()=>suggestionProgressSchema.parse({...progress,completedChars:20001}));
});

test('fragmented UTF-8 progress reaches the caller before the final batch',async()=>{
 const events=[{type:'progress',progress:{completed:0,total:6,completedChars:0,totalChars:12000,stage:'reading'}},{type:'progress',progress:{completed:6,total:6,completedChars:12000,totalChars:12000,stage:'selecting'}},{type:'result',batch}];
 const bytes=new TextEncoder().encode(events.map(e=>JSON.stringify(e)+'\n').join(''));
 const seen=[];
 const transport=async(url,init)=>{assert.equal(init.headers.Accept,'application/x-ndjson');assert.equal(JSON.parse(init.body).bookId,'zhuangzi');return response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));};
 assert.deepEqual(await requestSuggestions(selection,new AbortController().signal,p=>seen.push(p),transport),batch);
 assert.deepEqual(seen,events.slice(0,2).map(e=>e.progress));
});

test('offline API, interrupted streams and provider failures reject instead of returning partial success',async()=>{
 const signal=new AbortController().signal;
 await assert.rejects(requestSuggestions(selection,signal,()=>{},async()=>new Response('',{status:502})),/选题服务暂时不可用/);
 await assert.rejects(requestSuggestions(selection,signal,()=>{},async()=>response(new ReadableStream({start(c){c.enqueue(encode({type:'progress',progress:{completed:1,total:6,completedChars:1500,totalChars:12000,stage:'reading'}}));c.close();}}))),/连接已中断/);
 await assert.rejects(requestSuggestions(selection,signal,()=>{},async()=>response(new ReadableStream({start(c){c.enqueue(encode({type:'error',error:'请稍后重试'}));c.close();}}))),/请稍后重试/);
});

test('both a stalled connection and a stalled body time out; explicit cancellation aborts the request',async()=>{
 const hang=body=>async(url,init)=>{
  if(!body)return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  return response(new ReadableStream({start(c){init.signal.addEventListener('abort',()=>c.error(init.signal.reason),{once:true});}}));
 };
 for(const body of [false,true])await assert.rejects(requestSuggestions(selection,new AbortController().signal,()=>{},hang(body),10),/通读等待超时/);
 const abort=new AbortController(),pending=requestSuggestions(selection,abort.signal,()=>{},hang(true));
 abort.abort();await assert.rejects(pending,e=>e.name==='AbortError');
});

test('HTTP keeps JSON clients working, streams progress early, safely reports errors and signals cancellation',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu-suggestion-test-'));let release,observed;
 const provider={status:async()=>({configured:true,provider:'codex',models:{text:'mock',image:'mock'},voiceEnabled:false}),safeError:()=> '安全错误',generator:()=>({}),
  async suggestions(s,excluded,book,reading){
   if(!reading)return batch;
   observed=reading.signal;reading.onProgress({completed:2,total:6,completedChars:3000,totalChars:12000,stage:'reading'});
   await new Promise(resolve=>{release=resolve;});return batch;
  }};
 const app=createApplication({root:process.cwd(),dataDirectory:directory,generation:provider});
 t.after(async()=>{app.close();await rm(directory,{recursive:true,force:true});});
 const call=accept=>app.handle(new Request('http://localhost/api/reader/suggestions',{method:'POST',headers:{'Content-Type':'application/json',Accept:accept},body:JSON.stringify(selection)}));
 assert.deepEqual(await (await call('application/json')).json(),batch);
 const streamed=await call('application/x-ndjson'),reader=streamed.body.getReader();
 assert.match(streamed.headers.get('cache-control'),/no-store/);
 assert.match(new TextDecoder().decode((await reader.read()).value),/progress/);
 assert.equal(observed.aborted,false);await reader.cancel();assert.equal(observed.aborted,true);release();
 provider.suggestions=async(s,e,b,reading)=>{reading.onProgress({completed:6,total:6,completedChars:12000,totalChars:12000,stage:'selecting'});return batch;};
 assert.deepEqual(await requestSuggestions(selection,new AbortController().signal,()=>{},async()=>call('application/x-ndjson')),batch);
 provider.suggestions=async()=>{throw Error('private diagnostic');};
 await assert.rejects(requestSuggestions(selection,new AbortController().signal,()=>{},async()=>call('application/x-ndjson')),/安全错误/);
});

test('Node HTTP flushes progress without waiting for completion and cancels work on disconnect',async t=>{
 let cancelled;
 const disconnected=new Promise(resolve=>{cancelled=resolve;});
 const server=createHttpServer(async()=>response(new ReadableStream({start(c){c.enqueue(encode({type:'progress',progress:{completed:0,total:6,completedChars:0,totalChars:12000,stage:'reading'}}));},cancel(){cancelled();}})));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const abort=new AbortController();
 const stream=await fetch(`http://127.0.0.1:${server.address().port}`,{signal:abort.signal}),reader=stream.body.getReader();
 assert.match(new TextDecoder().decode((await reader.read()).value),/progress/);
 abort.abort();await disconnected;
});
