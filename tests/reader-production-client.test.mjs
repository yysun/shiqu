// Verify the browser's demand lifecycle without coupling tests to React rendering internals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {observeOnlyGeneration,observeStoryGeneration,runQueuedStoryGeneration} from '../lib/reader-production-client.ts';
const base={id:'story',state:'idle',ready:7,stage:'drawing 8',selection:{length:8},retryAllowed:true,error:null,story:{pages:[]}};
test('automatic discovery stops on an uncertain POST response and releases its viewer without repeating it',async()=>{
 const calls=[],session={...base,generationMode:'background',generationControl:'active',intake:{phase:'choosing',generation:0,search:{state:'idle'},batches:[{stories:[{title:'第一篇'}]}]}};
 const result=await observeStoryGeneration({sessionId:'story',focus:{viewerId:'viewer',page:()=>0},watchChoices:true,isActive:()=>true,onSession:()=>{},sleep:async()=>{},request:async(path,method,data)=>{
  calls.push({path,method,data});if(path.endsWith('/setup'))throw Error('lost response');return session;
 }});
 assert.equal(result,'lost response');assert.equal(calls.filter(c=>c.path.endsWith('/setup')).length,1);assert.equal(calls.at(-1).method,'DELETE');assert.equal(calls.find(c=>c.path.endsWith('/setup')).data.automatic,true);
});
test('empty, failed, paused, capped and selected pickers never automatically request another story',async()=>{
 const intake={phase:'choosing',generation:0,search:{state:'idle'},batches:[{stories:[{title:'一篇'}]}]};
 for(const fields of [{intake:{...intake,batches:[{stories:[]}]}},{intake:{...intake,search:{state:'failed'}}},{generationControl:'paused'},{intake:{...intake,batches:Array.from({length:40},()=>({stories:[{title:'一篇'}]}))}},{intake:{...intake,selected:{batch:0,index:0}}}]){
  let active=true;const calls=[];
  await observeStoryGeneration({sessionId:'story',focus:{viewerId:'viewer',page:()=>0},watchChoices:true,isActive:()=>active,onSession:()=>{},sleep:async()=>{active=false;},request:async(path,method)=>{calls.push(path);return {...base,generationMode:'background',generationControl:'active',intake,...fields};}});
  assert.ok(calls.every(path=>!path.endsWith('/setup')),JSON.stringify(fields));
 }
});
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

const open={...base,state:'running',generationMode:'background',generationControl:'active',story:{pages:Array.from({length:10},()=>({image:'/saved.png'}))}};
function focusCalls(session){
 const calls=[];let active=true,polls=0,page=4,time=0;
 return {calls,set page(value){page=value;},run:rounds=>observeStoryGeneration({sessionId:'story',focus:{viewerId:'viewer',page:()=>page},now:()=>time,isActive:()=>active,onSession:()=>{},sleep:async()=>{time+=1000;if(polls>=rounds)active=false;},
  request:async(path,method,data)=>{calls.push([method||'GET',data]);if(!method)polls++;return typeof session==='function'?session(polls):session;}})};
}
test('an open active story reports its page for priority, follows page changes and leaves on exit',async()=>{
 const observer=focusCalls(open);await observer.run(3);
 const posts=observer.calls.filter(([method])=>method==='POST');
 assert.deepEqual(posts,[['POST',{viewerId:'viewer',page:4,retry:false}]],'One report until the page or heartbeat changes');
 assert.deepEqual(observer.calls.at(-1),['DELETE',{viewerId:'viewer'}]);
 const heartbeat=focusCalls(open);await heartbeat.run(12);
 assert.equal(heartbeat.calls.filter(([method])=>method==='POST').length,2,'The report renews every ten seconds');
 let page=2;const moved=[];let polls=0,active=true;
 await observeStoryGeneration({sessionId:'story',focus:{viewerId:'viewer',page:()=>page},isActive:()=>active,onSession:()=>{},sleep:async()=>{if(polls===1)page=7;if(polls>=2)active=false;},request:async(path,method,data)=>{if(method==='POST')moved.push(data.page);if(!method)polls++;return open;}});
 assert.deepEqual(moved,[2,7]);
});
test('priority reports clamp a stale page and use page 0 before the first image exists',async()=>{
 const clamped=focusCalls(open);clamped.page=99;await clamped.run(1);
 assert.equal(clamped.calls.find(([method])=>method==='POST')[1].page,9);
 const early=focusCalls({...open,story:{pages:[{image:''},{image:''}]}});await early.run(1);
 assert.equal(early.calls.find(([method])=>method==='POST')[1].page,0);
 const planning=focusCalls({...open,story:null});await planning.run(1);
 assert.equal(planning.calls.find(([method])=>method==='POST')[1].page,0);
});
test('a story that is not actively generating never reports a page',async()=>{
 for(const session of [{...open,state:'failed'},{...open,generationControl:'paused'},{...open,generationControl:'stopped'},{...open,state:'completed'},{...open,awaitingFrameCount:true},{...open,generationMode:'reader'}]){
  const observer=focusCalls(session);await observer.run(2);
  assert.ok(observer.calls.every(([method])=>method==='GET'),JSON.stringify(session));
 }
 const failing=focusCalls(polls=>polls===1?open:{...open,state:'failed'});await failing.run(3);
 assert.equal(failing.calls.filter(([method])=>method==='POST').length,1,'A failure stops reports');
});
test('a failed or hung priority report never interrupts status updates or exit',async()=>{
 for(const report of [()=>Promise.reject(Error('offline')),()=>new Promise(()=>{})]){
  let polls=0,active=true,seen=0,deleted=0;
  const result=await observeStoryGeneration({sessionId:'story',focus:{viewerId:'viewer',page:()=>1},isActive:()=>active,onSession:()=>seen++,sleep:async()=>{if(polls>=4)active=false;},
   request:async(path,method)=>{if(method==='POST')return report();if(method==='DELETE'){deleted++;return open;}polls++;return open;}});
  assert.equal(result,'');assert.equal(seen,4);assert.equal(deleted,1);
 }
});
test('automatic retry stops on a lost image, and only an explicit retry goes through',async()=>{
 const lost={...base,state:'failed',retryStage:'redraw',retryAllowed:true,error:'这幅图片的文件已丢失或损坏。'};
 for(const initialRetry of [false,true]){
  const posts=[];let reads=0;
  const result=await runQueuedStoryGeneration({sessionId:'story',viewerId:'viewer',page:()=>0,retries:new Map(),isActive:()=>true,onSession:()=>{},sleep:async()=>{},initialRetry,now:()=>0,
   request:async(path,method,data)=>{if(method==='POST'){posts.push(data.retry);return initialRetry&&posts.length===1?{...lost,state:'running',retryStage:undefined}:lost;}reads++;return lost;}});
  assert.match(result,/已丢失/);assert.deepEqual(posts,initialRetry?[true]:[false],'A later failure is never retried automatically');
 }
});

