// Exercise the real browser observation loop and queued discovery with isolated SQLite and fake inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,selection,turn} from './fixtures/production.mjs';
import {observeStoryGeneration} from '../lib/reader-production-client.ts';
import {createReaderProvider} from '../server/generation.ts';
import {withLocalBooks} from '../server/local-generation.ts';
const candidate=title=>({stories:[{title,description:'来自原书的完整故事。'}],note:''});
const create=async f=>(await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}})).id;
const choose=(f,id,generation=0)=>f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation,action:'choose',batch:0,index:0});
test('Codex, Gemini and OpenAI custom-book adapters receive a one-story request and bound the returned batch',async()=>{
 const stories=[{title:'第一篇',description:'完整故事。',artRecommendation:{artStyle:'ink-pencil',reason:'符合故事。'}},{title:'第二篇',description:'另一篇。',artRecommendation:{artStyle:'ink-pencil',reason:'符合故事。'}}];
 for(const name of ['codex','gemini','openai']){
  let payload;
  const runner={status:async()=>({configured:true}),run:async job=>{payload=JSON.parse(job.prompt);return {text:JSON.stringify({stories,note:''}),model:'fake'};}};
  const transport=async(_url,options)=>{
   const body=JSON.parse(options.body);payload=JSON.parse(name==='openai'?body.input[0].content:body.contents[0].parts[0].text);
   return Response.json(name==='openai'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({stories,note:''})}]}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({stories,note:''})}]}}]});
  };
  const adapter=createReaderProvider({SHIQU_AI_PROVIDER:name,GEMINI_API_KEY:'test-only',OPENAI_API_KEY:'test-only'}, {},transport,runner);
  const provider=withLocalBooks(adapter,{book:async()=>null},{});
  const result=await provider.suggestions({...selection,bookId:'other',customBook:'测试古籍'},[],undefined,{maxStories:1,signal:new AbortController().signal,onProgress:()=>{}});
  assert.equal(payload.maxStories,1,name);assert.equal(result.stories.length,1,name);
 }
});
function observe(f,id){
 let active=true;const calls=[],seen=[];
 const promise=observeStoryGeneration({sessionId:id,focus:{viewerId:crypto.randomUUID(),page:()=>0},watchChoices:true,isActive:()=>active,onSession:s=>seen.push(s),sleep:turn,
  request:async(path,method,body)=>{calls.push({path,method,body});return f.json(path.replace(/^reader\//,''),method,body);}});
 return {calls,seen,promise,stop(){active=false;}};
}

test('each saved story appears before the next completes; choosing fences the late result and automatic restart',async t=>{
 const f=await productionFixture(t);f.control.hold=false;let count=0,release;
 f.generation.suggestions=async(_s,excluded,_local,reading)=>{
  assert.equal(reading.maxStories,1);count++;
  if(count===2){assert.deepEqual(excluded,['庄周梦蝶']);await new Promise(resolve=>release=resolve);}
  return candidate(count===1?'庄周梦蝶':'迟到的故事');
 };
 const id=await create(f);await f.app.services.production.tick();assert.equal(count,0,'A shelf/background intent cannot start discovery');
 const observer=observe(f,id);t.after(async()=>{observer.stop();release?.();await observer.promise;});
 await until(()=>release);
 const first=await f.read(id);assert.equal(first.intake.batches.length,1);assert.equal(first.intake.search.state,'searching');
 assert.ok(observer.seen.some(s=>s.intake.batches[0]?.stories[0]?.title==='庄周梦蝶'));
 const selected=await choose(f,id);assert.equal(selected.intake.search.state,'idle');release();
 await f.app.services.production.tick();await f.app.services.production.queue.settle();
 const late=await f.json(`sessions/${id}/setup`,'POST',{action:'more',automatic:true,requestId:crypto.randomUUID(),generation:0});
 assert.equal(late.intake.search.state,'idle');assert.equal(late.selection.storyTitle,'庄周梦蝶');assert.equal(late.intake.batches.length,1);
 observer.stop();await observer.promise;await f.app.services.production.tick();
 assert.equal(count,2);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('leaving stops continuation; reopening retains stories and finds the next one; empty results stop automatically',async t=>{
 const f=await productionFixture(t);let count=0,release;
 f.generation.suggestions=async()=>{count++;if(count===2)await new Promise(resolve=>release=resolve);return count<4?candidate('故事'+count):{stories:[],note:'已查完。'};};
 const id=await create(f),observer=observe(f,id);t.after(async()=>{observer.stop();release?.();await observer.promise;});
 await until(()=>release);observer.stop();await observer.promise;await f.app.services.production.tick();release();await f.app.services.production.queue.settle();
 await f.app.services.production.tick();assert.equal(count,2);
 const saved=await f.read(id);assert.ok(saved.intake.batches[0].stories.length);
 const reopened=observe(f,id);t.after(async()=>{reopened.stop();await reopened.promise;});
 await until(async()=>(await f.read(id)).intake.batches.at(-1)?.stories.length===0);
 const ended=await f.read(id);assert.equal(ended.intake.search.state,'idle');assert.equal(ended.intake.batches.flatMap(b=>b.stories).length,3);
 for(let n=0;n<5;n++)await turn();assert.equal(count,4,'Empty results do not spin');
 reopened.stop();await reopened.promise;assert.equal(f.control.plans.length,0);
});

test('one viewer leaving preserves another; the last viewer and expired leases stop paid discovery',async t=>{
 const f=await productionFixture(t);let reading,calls=0;
 f.generation.suggestions=async(_s,_e,_l,observer)=>{calls++;reading=observer;await new Promise((_resolve,reject)=>observer.signal.addEventListener('abort',()=>reject(observer.signal.reason),{once:true}));};
 const id=await create(f),a=crypto.randomUUID(),b=crypto.randomUUID();await f.demand(id,a);await f.demand(id,b);await until(()=>reading);
 await f.leave(id,a);await f.app.services.production.tick();assert.equal(reading.signal.aborted,false);
 await f.leave(id,b);await f.app.services.production.tick();assert.equal(reading.signal.aborted,true);await f.app.services.production.queue.settle();
 await f.app.services.production.tick();assert.equal(calls,1);
 reading=null;await f.demand(id,a);await until(()=>reading);assert.equal(calls,2);
 await f.app.services.database.prepare('UPDATE production_demand SET expires_at=0 WHERE session_id=?').bind(id).run();
 await f.app.services.production.tick();assert.equal(reading.signal.aborted,true);await f.app.services.production.queue.settle();
 f.generation.suggestions=async()=>candidate('恢复后的故事');await f.demand(id,b);
 await until(async()=>(await f.read(id)).intake.search.state==='idle');assert.equal((await f.read(id)).intake.batches.length,1);
});

test('automatic more cannot race past a chosen story at the SQL write fence',async t=>{
 const f=await productionFixture(t);f.generation.suggestions=async()=>candidate('庄周梦蝶');const id=await create(f);await f.demand(id);
 await until(async()=>(await f.read(id)).intake.phase==='choosing');
 const database=f.app.services.database,prepare=database.prepare.bind(database);let resume,blocked;
 const gate=new Promise(resolve=>resume=resolve);
 database.prepare=sql=>{
  const statement=prepare(sql);
  if(sql.includes("AND json_type(document,'$.intake.selected') IS NOT 'object'")){
   const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),run=bound.run.bind(bound);bound.run=async()=>{blocked=true;await gate;return run();};return bound;};
  }
  return statement;
 };
 t.after(()=>{database.prepare=prepare;resume();});
 const pending=f.json(`sessions/${id}/setup`,'POST',{action:'more',automatic:true,requestId:crypto.randomUUID(),generation:0});
 await until(()=>blocked);await choose(f,id);resume();const result=await pending;
 assert.equal(result.intake.search.state,'idle');assert.equal(result.intake.selected.index,0);assert.equal(result.intake.batches.length,1);
});
