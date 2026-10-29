// Verify the browser's demand lifecycle without coupling tests to React rendering internals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {observeOnlyGeneration,observeStoryGeneration,runQueuedStoryGeneration} from '../lib/reader-production-client.ts';
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
test('quality review blockage stops automatic retries; explicit continue is dispatched exactly once',async()=>{
 for(const initialRetry of [false,true]){
  const calls=[];const blocked={...base,state:'failed',retryStage:'review',error:'分镜复核仍有问题。'};
  const result=await runQueuedStoryGeneration({sessionId:'story',viewerId:'viewer',initialRetry,page:()=>0,retries:new Map(),isActive:()=>true,onSession:()=>{},sleep:async()=>{},request:async(path,method,body)=>{calls.push({method,body});return blocked;}});
  assert.equal(result,blocked.error);assert.deepEqual(calls.filter(c=>c.method==='POST').map(c=>c.body.retry),[initialRetry]);assert.equal(calls.at(-1).method,'DELETE');
 }
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

test('inspecting stopped and failed checkpoints only polls snapshots and reflects external changes',async()=>{
 let active=true,reads=0;const calls=[],seen=[];
 const states=['failed','idle','running','failed'];
 const result=await observeStoryGeneration({sessionId:'story',isActive:()=>active,onSession:s=>seen.push([s.state,s.error]),sleep:async()=>{if(reads===states.length)active=false;},
  request:async(...args)=>{calls.push(args);const state=states[reads++];return {...base,state,error:state==='failed'?'编排超时':null};},
 });
 assert.equal(result,'');assert.deepEqual(seen.map(([state])=>state),states);
 assert.equal(seen[0][1],'编排超时');assert.equal(seen[2][1],null);
 assert.deepEqual(calls,states.map(()=>['reader/sessions/story']));
});
test('inspection connection errors never dispatch work and late snapshots cannot update a closed dialog',async()=>{
 let calls=0;
 assert.equal(await observeStoryGeneration({sessionId:'story',isActive:()=>true,onSession:()=>assert.fail('No snapshot'),sleep:async()=>{},request:async(...args)=>{assert.equal(args.length,1);calls++;throw Error('offline');}}),'offline');
 assert.equal(calls,3);
 let active=true;
 await observeStoryGeneration({sessionId:'story',isActive:()=>active,onSession:()=>assert.fail('Dialog closed'),request:async()=>{active=false;return base;},sleep:async()=>assert.fail('No further polling')});
});
test('inspecting a count confirmation releases the observation so the user can choose a frame count',async()=>{
 let reads=0;
 assert.equal(await observeStoryGeneration({sessionId:'story',isActive:()=>true,onSession:()=>{},request:async()=>{reads++;return {...base,awaitingFrameCount:true};},sleep:async()=>assert.fail('Do not keep the confirmation action busy')}),'');
 assert.equal(reads,1);
});
test('explicit retry sets retry on the first dispatch and never replays an uncertain retry request',async()=>{
 const calls=[];let first=true;
 const result=await runQueuedStoryGeneration({sessionId:'story',viewerId:'viewer',initialRetry:true,page:()=>0,retries:new Map(),isActive:()=>true,onSession:()=>{},sleep:async()=>{},
  request:async(path,method,body)=>{
   calls.push({method,body});if(method==='DELETE')return base;
   if(method==='POST'&&first){first=false;throw Error('lost accepted retry response');}
   if(!method)return {...base,state:'running'};
   return {...base,state:'completed'};
  },
 });
 assert.equal(result,'');assert.deepEqual(calls.filter(c=>c.method==='POST').map(c=>c.body.retry),[true,false]);
 assert.equal(calls.at(-1).method,'DELETE');
});

for(const fields of [{generationControl:'paused'},{generationControl:'stopped'},{generationMode:'background'}])test(`viewer loop stops dispatch and automatic retries for ${JSON.stringify(fields)}`,async()=>{
 const calls=[];
 const result=await runQueuedStoryGeneration({sessionId:'story',viewerId:'viewer',page:()=>0,retries:new Map(),isActive:()=>true,onSession:()=>{},sleep:async()=>assert.fail('No demand renewal or automatic retry'),
  request:async(path,method,body)=>{calls.push({method,body});return {...base,state:'failed',...fields};},
 });
 assert.equal(result,'');assert.deepEqual(calls.map(c=>c.method),['POST','DELETE']);
});

test('mode changes and manual resume preserve failed stories as observations until explicit Retry',async()=>{
 for(const generationMode of ['reader','background'])for(const generationControl of ['active','paused','stopped']){
  const session={...base,state:'failed',generationMode,generationControl,error:'real provider failure'};
  assert.equal(observeOnlyGeneration(session),true);
  const calls=[];let active=true;
  await observeStoryGeneration({sessionId:'story',request:async(...args)=>{calls.push(args);active=false;return session;},isActive:()=>active,onSession:()=>{},sleep:async()=>{}});
  assert.deepEqual(calls,[['reader/sessions/story']]);
 }
 assert.equal(observeOnlyGeneration({...base,generationMode:'reader',generationControl:'active'}),false);
});
