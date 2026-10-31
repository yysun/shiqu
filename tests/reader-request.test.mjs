// Reproduce proxy restarts and truncated reads while protecting non-idempotent operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {request} from '../lib/reader-request.ts';

test('a read recovers from a disconnected server and a restarting proxy',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(url,'/api/reader/sessions');assert.equal(init.method,'GET');
  calls++;
  if(calls===1)throw new TypeError('Failed to fetch');
  if(calls===2)return new Response('proxy unavailable',{status:502});
  return Response.json([{id:'retained-story'}]);
 });
 assert.deepEqual(await request('reader/sessions'),[{id:'retained-story'}]);assert.equal(calls,3);
});

test('an interrupted JSON body is retried before displaying a loading error',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>++calls===1?new Response('{'):Response.json([{id:'sample'}]));
 assert.deepEqual(await request('stories'),[{id:'sample'}]);assert.equal(calls,2);
});

test('persistent read failures stop after a bounded number of attempts',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'服务重启中'},{status:503});});
 await assert.rejects(request('reader/sessions'),/服务重启中/);assert.equal(calls,4);
});

for(const body of [false,true])test(`a stalled ${body?'JSON body':'connection'} times out and the next refresh can succeed`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0,signal;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  signal=init.signal;
  if(++calls>1)return Response.json([{id:'retained-story'}]);
  if(!body)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  return new Response(new ReadableStream({start(controller){
   controller.enqueue(new TextEncoder().encode('[{"id":'));
   signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});
  }}));
 });
 const failed=assert.rejects(request('reader/sessions'),/读取超时.*重试/);
 await setImmediate();t.mock.timers.tick(15000);await failed;
 assert.equal(calls,1);assert.equal(signal.aborted,true);
 assert.deepEqual(await request('reader/sessions'),[{id:'retained-story'}]);
 assert.equal(signal.aborted,false);assert.equal(calls,2);
});

test('read retries share a deadline instead of extending a stalled refresh indefinitely',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const signals=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  signals.push(init.signal);
  if(signals.length===1)throw new TypeError('connection lost');
  return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
 });
 const failed=assert.rejects(request('reader/sessions'),/读取超时/);
 await setImmediate();t.mock.timers.tick(250);await setImmediate();
 assert.equal(signals.length,2);assert.equal(signals[0],signals[1]);
 t.mock.timers.tick(14750);await failed;assert.equal(signals.length,2);
});

test('missing or unauthorized stories are not retried',async t=>{
 for(const status of [400,401,403,404,429]){
  let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'不可读取'},{status});});
  await assert.rejects(request('reader/sessions/missing'),/不可读取/);assert.equal(calls,1);mock.mock.restore();
 }
});

test('generation, deletion and progress writes are never replayed after failures',async t=>{
 for(const [method,path] of [['POST','reader/sessions/id/advance'],['DELETE','reader/library/id'],['POST','me/progress']]){
  let calls=0;const mock=t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.equal(init.signal,undefined);throw new TypeError('connection lost');});
  await assert.rejects(request(path,method,{page:1}),/connection lost/);assert.equal(calls,1);mock.mock.restore();
 }
});

test('writes retain multipart bodies and server error messages',async t=>{
 const data=new FormData();data.append('file',new Blob(['image']),'image.png');let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.equal(init.body,data);assert.deepEqual(init.headers,{});return Response.json({error:'上传失败'},{status:503});});
 await assert.rejects(request('admin/upload','POST',data),/上传失败/);assert.equal(calls,1);
});
