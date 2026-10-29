// Verify the browser's demand lifecycle without coupling tests to React rendering internals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runQueuedStoryGeneration} from '../lib/reader-production-client.ts';
const base={id:'story',state:'idle',ready:7,stage:'drawing 8',selection:{length:8},retryAllowed:true,error:null,story:{pages:[]}};
test('a full buffer keeps its viewer alive, page changes update demand, and leaving releases only that viewer',async()=>{
 let active=true,time=0,page=0,reads=0;const calls=[];
 const result=await runQueuedStoryGeneration({sessionId:'story',viewerId:'viewer-a',page:()=>page,retries:new Map(),isActive:()=>active,onSession:()=>{},now:()=>time,
  sleep:async ms=>{assert.equal(ms,1000);time+=1000;if(time===3000)page=1;if(time===13000)active=false;},
  request:async(path,method,body)=>{calls.push({path,method,body,time});if(!method)reads++;return structuredClone(base);},
 });
 assert.equal(result,'');assert.ok(reads>5);assert.deepEqual(calls.filter(c=>c.method==='POST').map(c=>[c.time,c.body.page]),[[0,0],[3000,1]]);
 assert.deepEqual(calls.at(-1).body,{viewerId:'viewer-a'});assert.equal(calls.at(-1).method,'DELETE');
});
test('persistent failures have two automatic retries',async()=>{
 let time=0,attempts=0;const calls=[],retries=new Map();
 const result=await runQueuedStoryGeneration({sessionId:'story',viewerId:'viewer',page:()=>0,retries,isActive:()=>true,onSession:()=>{},now:()=>time,sleep:async()=>{time+=1000;},
  request:async(path,method,body)=>{calls.push({method,body});if(method==='DELETE')return base;if(method==='POST')attempts++;return {...base,state:'failed',error:'controlled failure'};},
 });
 assert.equal(result,'controlled failure');assert.equal(attempts,3);assert.equal(retries.get('story:drawing 8'),2);assert.equal(calls.at(-1).method,'DELETE');
});

test('accepted but lost retry responses re-read progress before spending the next retry',async()=>{
 let time=0,retryPosts=0,reads=0;const retries=new Map(),calls=[];
 const result=await runQueuedStoryGeneration({sessionId:'story',viewerId:'viewer',page:()=>0,retries,isActive:()=>true,onSession:()=>{},now:()=>time,sleep:async()=>{time+=1000;},
  request:async(path,method,body)=>{
   calls.push({method,body});if(method==='DELETE')return base;
   if(method==='POST'&&body.retry){retryPosts++;throw Error('response lost after acceptance');}
   if(!method){reads++;if(retryPosts===2)return {...base,state:'completed'};}
   return {...base,state:'failed',error:'stale failure'};
  },
 });
 assert.equal(result,'');assert.equal(retryPosts,2);assert.equal(reads,2);assert.equal(retries.get('story:drawing 8'),2);assert.equal(calls.at(-1).method,'DELETE');
});
test('connection failure after starting demand still sends leave; lost leave falls back to server lease expiry',async()=>{
 let calls=0,sleeps=0;
 const message=await runQueuedStoryGeneration({sessionId:'story',viewerId:'viewer',page:()=>0,retries:new Map(),isActive:()=>true,onSession:()=>{},sleep:async()=>{sleeps++;},request:async()=>{calls++;throw Error('offline');}});
 assert.equal(message,'offline');assert.equal(calls,4);assert.equal(sleeps,2);
});

test('awaiting count confirmation releases demand without issuing storyboard or image requests',async()=>{
 const calls=[];
 const result=await runQueuedStoryGeneration({sessionId:'story',viewerId:'viewer',page:()=>0,retries:new Map(),isActive:()=>true,onSession:()=>{},sleep:async()=>assert.fail('Do not poll the confirmation gate'),request:async(path,method,body)=>{calls.push({method,body});return {...base,awaitingFrameCount:true};}});
 assert.equal(result,'');assert.deepEqual(calls.map(c=>c.method),['POST','DELETE']);
});
