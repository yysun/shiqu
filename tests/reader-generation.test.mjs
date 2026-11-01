// Exercise durable checkpoints, immediate automatic recovery, and paid-call safeguards against SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import {makeGenerator,suggestStories,GeminiError,safeGeminiError,configuredModels} from '../lib/reader-gemini.ts';
import {view,selectionSchema} from '../lib/reader-model.ts';
import {runStoryGeneration} from '../lib/reader-generation.ts';
import {changeIntake} from '../server/reader-intake.ts';
const original={title:'《庄子·齐物论》',text:'昔者庄周梦为胡蝶，栩栩然胡蝶也。',url:'https://zh.wikisource.org/zh-hans/莊子/齊物論',kind:'passage',provider:'维基文库',retrievedAt:'2026-10-26T00:00:00Z'};
const selection={bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'放下执念',length:8,voice:false};
const plan={title:'谁在梦中',summary:'醒来后，他忽然不敢确定自己是谁。',sourceReference:'《庄子·齐物论》庄周梦蝶',adaptationNote:'用现代旁白重述梦蝶，画面细节为AI演绎。',reflection:'醒来之后，你更确定自己了吗？',characters:'Zhuang Zhou: adult male philosopher, plain blue-green robe, tied long black hair, calm face.',pages:Array.from({length:8},(_,i)=>({caption:'庄周做了一个梦，梦里的世界比醒着时还要清楚。',prompt:'Ancient Chinese philosopher in a calm garden, thoughtful adult face, scene number '+i}))};
function setup(){const db=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));const adapter={prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(query).get(...args)||null;},async all(){return {results:db.prepare(query).all(...args)};},async run(){const r=db.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}};}};return {repo:new ReaderRepository(adapter),db};}
function fake(){const calls=[];return {calls,recommend:async()=>({value:{count:8,reason:'完整讲述事件。',storySummary:plan.summary,storyMatchReason:'原文支持梦与醒的经历。'},model:'mock',requestId:'mock',usage:null}),reflection:async()=>({value:plan.reflection,model:'mock',requestId:'mock',usage:null}),reflectionCandidates:async()=>({value:{title:plan.title,candidates:[plan.reflection,'醒来之后，梦中的自在仍值得回味。','梦与醒的分界，也未必是心境的分界。']},model:'mock',requestId:'mock',usage:null}),review:async(_s,_p,_o,_outline,candidates)=>({value:{issues:[],titleReview:{title:_p.title,reason:'标题准确对应当前故事。'},...(candidates?{reflectionChoice:{index:1,reason:'保留原文支持的认识。'}}:{})},model:'mock',requestId:'mock',usage:null}),async original(){return {source:structuredClone(original),message:'',searchUrl:''};},async plan(){calls.push('plan');return {value:structuredClone(plan),model:'fake-text',requestId:'test',usage:{input_tokens:10,output_tokens:20}};},async image(p,page,id){calls.push('image:'+page);return {value:`/api/reader/media/${id}/${page}.webp`,model:'fake-image',requestId:'test',usage:null};},async audio(text,id,page){calls.push('audio:'+page);return {value:`/api/reader/media/${id}/${page}.wav`,model:'fake-audio',requestId:'test',usage:null};},safeError(){return '生成暂时失败，已保留内容';}};}
function client(repo,g,id,overrides={}){
 return {sessionId:id,throughPage:1,retries:new Map(),isActive:()=>true,onSession:()=>{},
  sleep:async()=>assert.fail('Checkpoint retries must not wait for a countdown'),
  request:async(path,method,data)=>method==='POST'?advanceStory(repo,g,'alice',id,data.throughPage,data.retry):view(await repo.get(id,'alice')),
  ...overrides};
}
test('client automatically recovers planning, source and each image without delays or repeating completed work',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 const generatePlan=g.plan,draw=g.image,attempts=new Map();let plans=0,lookups=0;
 g.plan=async(...args)=>{if(plans++===0)throw Error('temporary plan failure');return generatePlan(...args);};
 g.original=async()=>++lookups===1?{source:null,message:'temporary outage',searchUrl:''}:{source:original,message:'',searchUrl:''};
 g.image=async(...args)=>{const page=args[1],attempt=attempts.get(page)||0;attempts.set(page,attempt+1);if(attempt===0)throw Error('temporary image failure');return draw(...args);};
 assert.equal(await runStoryGeneration(client(repo,g,id)),'');
 assert.equal(plans,2);assert.equal(lookups,2);assert.deepEqual([...attempts.values()],[2,2]);
 assert.deepEqual(g.calls,['plan','image:0','image:1']);
 const result=view(await repo.get(id,'alice'));assert.equal(result.ready,2);assert.equal(result.state,'idle');
});
test('persistent failure exhausts two automatic retries and page changes cannot reset its budget',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 let attempts=0;const planStory=g.plan;g.plan=async()=>{attempts++;throw Error('persistent outage');};
 const options=client(repo,g,id);
 assert.equal(await runStoryGeneration(options),'生成暂时失败，已保留内容');assert.equal(attempts,3);
 assert.equal(await runStoryGeneration({...options,throughPage:2}),'生成暂时失败，已保留内容');assert.equal(attempts,3);
 g.plan=planStory;
 assert.equal(await runStoryGeneration({...options,retries:new Map()}),'');
 assert.deepEqual(g.calls,['plan','image:0','image:1']);
});
test('lost advance responses re-read the saved checkpoint and do not regenerate completed images',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 const options=client(repo,g,id),request=options.request;let dropped=false,reads=0;
 options.request=async(...args)=>{if(args[1]!=='POST')reads++;const result=await request(...args);if(!dropped&&result.ready===1){dropped=true;throw Error('connection lost');}return result;};
 assert.equal(await runStoryGeneration(options),'');assert.equal(reads,2);
 assert.deepEqual(g.calls,['plan','image:0','image:1']);
});
test('transport outages are bounded and leaving a story stops automatic recovery',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 let calls=0;
 assert.equal(await runStoryGeneration(client(repo,g,id,{request:async()=>{calls++;throw Error('offline');}})),'offline');assert.equal(calls,3);
 let active=true;const options=client(repo,g,id,{isActive:()=>active}),request=options.request;
 g.plan=async()=>{throw Error('temporary failure');};
 options.request=async(...args)=>{const result=await request(...args);if(result.state==='failed')active=false;return result;};
 assert.equal(await runStoryGeneration(options),'');assert.equal((await repo.get(id,'alice')).step_attempts,1);
});
test('running checkpoints are polled and leaving during a poll issues no further requests',async()=>{
 const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 db.prepare("UPDATE reader_sessions SET state='running',lock_token='in-flight',lock_until=? WHERE id=?").run(Date.now()+60000,id);
 let active=true;
 assert.equal(await runStoryGeneration(client(repo,g,id,{isActive:()=>active,sleep:async ms=>{assert.equal(ms,2000);active=false;}})),'');
 assert.deepEqual(g.calls,[]);assert.equal((await repo.get(id,'alice')).state,'running');
});
test('sessions are owner-scoped and client retries reuse a single session',async()=>{const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);await repo.create(id,'alice',selection);assert.equal((await repo.list('alice')).length,1);assert.equal((await repo.list('bob')).length,0);await assert.rejects(advanceStory(repo,g,'bob',id,1),e=>e.status===404);assert.deepEqual(g.calls,[]);});
test('new stories have no rolling daily cap, including concurrent starts',async()=>{
 const {repo}=setup();const rows=await Promise.all(Array.from({length:25},()=>repo.create(crypto.randomUUID(),'alice',selection)));
 assert.equal((await repo.list('alice')).length,25);
 const retries=await Promise.all(Array.from({length:5},()=>repo.create(rows[0].id,'alice',{...selection,theme:'人情冷暖'})));
 assert.ok(retries.every(row=>row.id===rows[0].id&&row.selection===rows[0].selection&&row.created_at===rows[0].created_at));
 assert.equal((await repo.list('alice')).length,25);
 await assert.rejects(repo.create(rows[0].id,'bob',selection),e=>e.status===404);
 assert.equal((await repo.list('bob')).length,0);
 await repo.create(crypto.randomUUID(),'bob',selection);
 await repo.create(crypto.randomUUID(),'alice',selection);
 assert.equal((await repo.list('alice')).length,26);
});
test('concurrent advances cannot duplicate a paid planning request',async()=>{const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);let unlock;const hold=new Promise(r=>unlock=r);g.plan=async()=>{g.calls.push('plan');await hold;return {value:plan,model:'fake',requestId:null,usage:null};};const a=advanceStory(repo,g,'alice',id,1);await new Promise(r=>setImmediate(r));const b=await advanceStory(repo,g,'alice',id,1);assert.equal(b.state,'running');unlock();await a;assert.deepEqual(g.calls,['plan']);});
test('only requested scenes are generated; completed scenes are reused and progress is separate',async()=>{const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);await advanceStory(repo,g,'alice',id,1);await advanceStory(repo,g,'alice',id,1);await advanceStory(repo,g,'alice',id,1);await advanceStory(repo,g,'alice',id,1);await repo.progress(id,'alice',0,true);await advanceStory(repo,g,'alice',id,1);await advanceStory(repo,g,'alice',id,1);assert.deepEqual(g.calls,['plan','image:0','image:1']);assert.equal((await repo.get(id,'alice')).saved,1);await assert.rejects(repo.progress(id,'alice',7,true),e=>e.status===400);});
test('paid image retries resume immediately when requested and reuse saved work',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 await advanceStory(repo,g,'alice',id,1);await advanceStory(repo,g,'alice',id,1);await advanceStory(repo,g,'alice',id,1);
 await advanceStory(repo,g,'alice',id,1); // Candidate selection completes before drawing.
 const draw=g.image;let failures=0;g.image=async()=>{failures++;throw Error('provider failure');};
 let s=await advanceStory(repo,g,'alice',id,1);
 for(let attempt=1;attempt<=5;attempt++){
  assert.equal(s.state,'failed');assert.equal(s.retryAllowed,true);assert.notEqual(s.retryStage,'source');
  assert.ok(s.story.pages[0].image);assert.equal(s.retryAt,null);assert.equal(failures,attempt);
  await advanceStory(repo,g,'alice',id,1);assert.equal(failures,attempt); // Polling alone cannot duplicate a paid call.
  if(attempt<5)s=await advanceStory(repo,g,'alice',id,1,true);
 }
 g.image=draw;const resumed=await advanceStory(repo,g,'alice',id,1,true);
 assert.equal(resumed.state,'idle');assert.equal(resumed.retryAt,null);assert.ok(resumed.story.pages[1].image);
 assert.equal((await repo.get(id,'alice')).step_attempts,6);
 assert.deepEqual(g.calls,['plan','image:0','image:1']);
});
test('planning can recover after the former cap and only one concurrent retry acquires the checkpoint',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 let calls=0;const planStory=g.plan;g.plan=async()=>{calls++;throw Error('temporary failure');};
 await advanceStory(repo,g,'alice',id,0);
 for(let attempt=0;attempt<3;attempt++){await advanceStory(repo,g,'alice',id,0,true);}
 assert.equal(calls,4);assert.equal(view(await repo.get(id,'alice')).retryAllowed,true);
 let release,started;const ready=new Promise(r=>started=r),hold=new Promise(r=>release=r);
 g.plan=async(...args)=>{calls++;started();await hold;return planStory(...args);};
 const first=advanceStory(repo,g,'alice',id,0,true);await ready;
 const second=await advanceStory(repo,g,'alice',id,0,true);assert.equal(second.state,'running');assert.equal(calls,5);
 release();const draft=await first;assert.equal(draft.state,'idle');assert.equal(draft.story,null);
 const result=await advanceStory(repo,g,'alice',id,0);assert.ok(result.story.sourceText);
 assert.equal(result.retryAt,null);assert.deepEqual(g.calls,['plan']);
});

test('stale requests become explicit failures instead of silently issuing another call',async()=>{const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);db.prepare("UPDATE reader_sessions SET state='running',lock_token='expired',lock_until=1,step_key='plan',step_attempts=1 WHERE id=?").run(id);const s=await advanceStory(repo,g,'alice',id,0);assert.equal(s.state,'failed');assert.deepEqual(g.calls,[]);});
test('an outdated checkpoint cannot acquire the same completed step again',async()=>{const {repo}=setup(),id=crypto.randomUUID(),g=fake();const old=await repo.create(id,'alice',selection);await advanceStory(repo,g,'alice',id,0);assert.equal(await repo.acquire(old,{kind:'plan',page:0,key:'plan'}),null);});
import {png,jpeg} from './fixtures/images.mjs';
const b64=b=>Buffer.from(b).toString('base64');
test('generation saves the original before drawing and keeps it on later checkpoints and reads',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake();let lookups=0;
 g.original=async()=>{lookups++;return {source:original,message:'',searchUrl:''};};
 await repo.create(id,'alice',selection);
 const draft=await advanceStory(repo,g,'alice',id,1);assert.equal(draft.story,null);
 const planned=await advanceStory(repo,g,'alice',id,1);
 assert.equal(planned.story.sourceText,original.text);assert.equal(planned.story.sourceUrl,original.url);
 assert.deepEqual((({storyBrief,...source})=>source)(JSON.parse((await repo.get(id,'alice')).document).original),original);
 assert.equal(planned.ready,0);
 const draw=g.image;g.image=async(...args)=>{assert.deepEqual((({storyBrief,...source})=>source)(JSON.parse((await repo.get(id,'alice')).document).original),original);return draw(...args);};
 await advanceStory(repo,g,'alice',id,1);await advanceStory(repo,g,'alice',id,1);
 assert.equal(lookups,1);assert.equal(view(await repo.get(id,'alice')).story.sourceText,original.text);
});
test('unavailable original blocks summary and planning, and recovery saves each paid result once',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake();let lookups=0;
 g.original=async()=>++lookups===1?{source:null,message:'原文来源无法连接。',searchUrl:''}:{source:original,message:'',searchUrl:''};
 await repo.create(id,'alice',selection);const failed=await advanceStory(repo,g,'alice',id,1);
 assert.equal(failed.state,'failed');assert.match(failed.error,/原文未能核对/);assert.deepEqual(g.calls,[]);
 let doc=JSON.parse((await repo.get(id,'alice')).document);assert.equal(doc.draft,undefined);assert.equal(doc.plan,null);assert.equal(doc.usage.length,0);
 await advanceStory(repo,g,'alice',id,1);assert.equal(lookups,1);
 await advanceStory(repo,g,'alice',id,1,true);doc=JSON.parse((await repo.get(id,'alice')).document);assert.equal(doc.original.storyBrief.verified,true);assert.equal(doc.draft.summary,plan.summary);
 const resumed=await advanceStory(repo,g,'alice',id,1);assert.equal(resumed.story.sourceText,original.text);assert.deepEqual(g.calls,['plan']);
 await advanceStory(repo,g,'alice',id,1);await advanceStory(repo,g,'alice',id,1);assert.deepEqual(g.calls,['plan','image:0']);assert.equal(lookups,2);
});
test('legacy backfill preserves images and progress and rejects an outdated document or active generation',async()=>{
 const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await repo.progress(id,'alice',0,true);
 db.prepare("UPDATE reader_sessions SET document=json_remove(document,'$.original') WHERE id=?").run(id);
 const old=await repo.get(id,'alice'),before=JSON.parse(old.document);
 const updated=await repo.saveOriginal(old,original);assert.equal(updated.page,old.page);assert.equal(updated.saved,1);
 assert.deepEqual(JSON.parse(updated.document),{...before,original});
 await assert.rejects(repo.saveOriginal(old,original),e=>e.status===409);
 db.prepare("UPDATE reader_sessions SET state='running' WHERE id=?").run(id);
 await assert.rejects(repo.saveOriginal(await repo.get(id,'alice'),original),e=>e.status===409);
});
test('saving a recovered original clears source failure while preserving an image failure for manual retry',async()=>{
 const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 g.original=async()=>({source:null,message:'暂时无法连接',searchUrl:''});
 await advanceStory(repo,g,'alice',id,0);const failed=await repo.get(id,'alice'),before=JSON.parse(failed.document);
 const recovered=await repo.saveOriginal(failed,original);
 assert.equal(recovered.state,'idle');assert.equal(recovered.error,null);assert.deepEqual(JSON.parse(recovered.document).plan,before.plan);assert.deepEqual(g.calls,[]);
 g.image=async()=>{throw Error('image failure');};await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);
 db.prepare("UPDATE reader_sessions SET document=json_remove(document,'$.original') WHERE id=?").run(id);
 const imageFailed=await repo.get(id,'alice'),backfilled=await repo.saveOriginal(imageFailed,original);
 assert.equal(backfilled.state,'failed');assert.equal(backfilled.error,imageFailed.error);
});
test('source recovery remains explicit after repeated outages and never repeats the paid plan',async()=>{
 const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();let lookups=0,available=false;
 g.original=async()=>{lookups++;return {source:available?original:null,message:'原文来源无法连接。',searchUrl:''};};
 await repo.create(id,'alice',selection);
 let result=await advanceStory(repo,g,'alice',id,0);
 for(let attempt=0;attempt<4;attempt++){
  assert.equal(result.state,'failed');assert.equal(result.retryAllowed,true);assert.equal(result.retryStage,'source');assert.equal(result.retryAt,null);
  const before=lookups;await advanceStory(repo,g,'alice',id,0);assert.equal(lookups,before);
  result=await advanceStory(repo,g,'alice',id,0,true);
 }
 assert.equal((await repo.get(id,'alice')).step_attempts,5);
 available=true;result=await advanceStory(repo,g,'alice',id,0,true);
 assert.equal(result.state,'idle');assert.equal(result.retryAllowed,true);assert.equal(result.story,null);
 result=await advanceStory(repo,g,'alice',id,0);assert.equal(result.story.sourceText,original.text);
 assert.deepEqual(g.calls,['plan']);
 await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);assert.deepEqual(g.calls,['plan','image:0']);
 assert.equal(JSON.parse((await repo.get(id,'alice')).document).usage.filter(u=>u.step==='plan').length,1);
 // A source backfill must also unlock the next image after the old source cap was reached.
 db.prepare("UPDATE reader_sessions SET state='failed',step_key='source',step_attempts=2 WHERE id=?").run(id);
 assert.equal(view(await repo.get(id,'alice')).retryAllowed,true);
});
function memoryAssets(){const stored=new Map();return {stored,async get(k){const entry=stored.get(k);return entry?{async arrayBuffer(){return entry.bytes.slice().buffer;}}:null;},async put(k,bytes,options){stored.set(k,{bytes,options});}};}
function geminiResponse(parts,extra={}){return new Response(JSON.stringify({candidates:[{content:{parts},finishReason:'STOP',...extra}],responseId:'test-response',usageMetadata:{totalTokenCount:10}}),{headers:{'Content-Type':'application/json'}});}
for(const length of ['auto',45])test(`legacy URL ${length} prepares source and summary before its directory and reuses them`,async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),url='https://example.org/classic',requests=[],chosen=selectionSchema.parse({bookId:'other',customBook:url,storyTitle:'庄周梦蝶',theme:'放下执念',length});
 const {pages,...metadata}=plan,outline={...metadata,beats:Array.from({length:45},(_,i)=>`故事第 ${i+1} 幅的事件。`)};
 const g=makeGenerator('controlled',memoryAssets(),{},async(_url,init)=>{
  const body=JSON.parse(init.body),payload=JSON.parse(body.contents[0].parts[0].text),schema=body.generationConfig.responseFormat.text.schema;requests.push({body,payload});
  if(schema.properties.count)return geminiResponse([{text:JSON.stringify({count:45,reason:'完整叙述。',storySummary:plan.summary,storyMatchReason:'按已核原文展开。'})}]);
  if(schema.properties.beats)return geminiResponse([{text:JSON.stringify(outline)}]);
  return geminiResponse([{text:JSON.stringify({pages:Array.from({length:20},()=>pages[0])})}]);
 });
 let lookups=0;g.original=async()=>({source:++lookups===1?null:original,message:'controlled outage',searchUrl:''});
 await repo.create(id,'alice',chosen);const failed=await advanceStory(repo,g,'alice',id,0);assert.equal(failed.state,'failed');assert.equal(requests.length,0);assert.equal(failed.retryStage,'source');
 await advanceStory(repo,g,'alice',id,0,true);assert.equal(requests.length,2);assert.equal(lookups,2);
 for(const item of requests){assert.equal(item.body.tools,undefined);assert.equal(item.payload.verifiedOriginal.text,original.text);}
 const saved=JSON.parse((await repo.get(id,'alice')).document);assert.equal(saved.original.storyBrief.verified,true);assert.equal(saved.storyboard.outline.summary,plan.summary);
 const batch=await advanceStory(repo,g,'alice',id,0);assert.equal(batch.generationProgress.storyboardFrames,20);assert.equal(requests.length,3);assert.equal(lookups,2);
});
test('a URL without a verifiable original cannot start summary or directory inference',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),chosen=selectionSchema.parse({bookId:'other',customBook:'https://example.org/classic',theme:'放下执念',length:45});let lookups=0,paid=0;
 const g=makeGenerator('controlled',memoryAssets(),{},async()=>{paid++;assert.fail('No inference without an original');});
 g.original=async()=>{lookups++;return {source:null,message:'未找到可核对的原文',searchUrl:''};};await repo.create(id,'alice',chosen);
 assert.equal((await advanceStory(repo,g,'alice',id,0)).state,'failed');assert.equal(lookups,1);assert.equal(paid,0);assert.equal(JSON.parse((await repo.get(id,'alice')).document).storyboard,undefined);
});
test('Gemini allows five-minute storyboards without extending image deadlines',async()=>{
 const timeouts=[],originalTimeout=AbortSignal.timeout;
 AbortSignal.timeout=function(ms){timeouts.push(ms);return originalTimeout.call(this,ms);};
 try{
  const g=makeGenerator('unit-test-only',memoryAssets(),{},async(url)=>url.includes('nano-banana')?geminiResponse([{inlineData:{mimeType:'image/png',data:b64(png)}}]):geminiResponse([{text:JSON.stringify(plan)}]));
  await g.plan(selection,'timeout-fixture');await g.image(plan,0,'timeout-fixture','');
  assert.deepEqual(timeouts,[300000,120000]);
 }finally{AbortSignal.timeout=originalTimeout;}
});
test('Gemini plans structured scenes and Nano Banana carries the first picture into subsequent scenes',async()=>{
 const requests=[],assets=memoryAssets();
 const fetcher=async(url,init)=>{const body=JSON.parse(init.body);requests.push({url,init,body});return url.includes('nano-banana')?geminiResponse([{thought:true,inlineData:{mimeType:'image/png',data:b64(jpeg)}},{inlineData:{mimeType:'image/png',data:b64(png)}}]):geminiResponse([{thought:true,text:'hidden reasoning'},{text:JSON.stringify(plan)}]);};
 const g=makeGenerator('unit-test-only',assets,{},fetcher),result=await g.plan(selection,'seed');
 assert.equal(result.value.title,plan.title);assert.equal(result.requestId,'test-response');
 assert.match(requests[0].url,/gemini-3.8-flash:generateContent$/);assert.equal(requests[0].body.store,false);
 assert.equal(requests[0].init.headers['x-goog-api-key'],'unit-test-only');assert.ok(!requests[0].url.includes('unit-test-only'));
 assert.equal(requests[0].body.generationConfig.responseFormat.text.schema.properties.pages.minItems,8);
 const a=await g.image(plan,0,'test-id','');await g.image(plan,1,'test-id',a.value);
 assert.equal(a.value,'/api/reader/media/test-id/0.png');assert.equal(assets.stored.size,2);
 assert.equal(assets.stored.get('reader/test-id/0.png').options.contentType,'image/png');
 assert.deepEqual(requests[2].body.contents[0].parts[0],{inlineData:{mimeType:'image/png',data:b64(png)}});
 assert.equal(requests[1].body.generationConfig.imageConfig.aspectRatio,'9:16');assert.equal(requests[1].body.generationConfig.imageConfig.imageSize,'1K');
 await assert.rejects(g.audio('旁白','test-id',0));assert.equal(requests.length,3);
});
test('Gemini failures are redacted, not retried, and never fall back to a different paid provider',async()=>{
 let count=0;const g=makeGenerator('unit-test-only',memoryAssets(),{},async()=>{count++;return new Response('sensitive provider detail',{status:429});});
 await assert.rejects(g.plan(selection,'seed'));assert.equal(count,1);
 assert.ok(!g.safeError(new Error('sensitive provider detail')).includes('sensitive'));
 assert.match(safeGeminiError(new GeminiError('PROVIDER_ERROR',429)),/额度/);
 assert.match(safeGeminiError(new GeminiError('PROVIDER_ERROR',402)),/计费状态和可用额度/);
 const timeoutMessage=safeGeminiError(new DOMException('expired','TimeoutError'));
 assert.match(timeoutMessage,/等待超时.*已保留.*手动重试/);assert.doesNotMatch(timeoutMessage,/费用|计费|收费/);
});
test('book suggestions preserve selected book and custom theme; stale URL fields are ignored',async()=>{
 let body;const result=await suggestStories('unit-test-only',{...selection,customBook:'https://example.org/old',theme:'一个小人物的选择'},{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify({stories:[{title:'庄周梦蝶',description:'一个醒来后的疑问。'}],note:''})}]);});
 assert.equal(result.stories[0].title,'庄周梦蝶');assert.equal(body.tools,undefined);
 assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),{book:'庄子',theme:'一个小人物的选择',excludeTitles:[]});
});
test('URL suggestions and plans fail closed when source retrieval is absent or failed',async()=>{
 const selected={...selection,bookId:'other',customBook:'https://example.org/classic'};
 const data={stories:[{title:'unverified',description:'unverified'}],note:''};
 const transport=async()=>geminiResponse([{text:JSON.stringify(data)}]);
 assert.equal((await suggestStories('unit-test-only',selected,{},transport)).stories.length,0);
 const g=makeGenerator('unit-test-only',memoryAssets(),{},async()=>geminiResponse([{text:JSON.stringify(plan)}]));
 await assert.rejects(g.plan(selected,'seed'),/SOURCE_UNAVAILABLE/);
 let body;const result=await suggestStories('unit-test-only',selected,{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify(data)}],{urlContextMetadata:{urlMetadata:[{retrievedUrl:selected.customBook,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_SUCCESS'}]}});});
 assert.equal(result.stories.length,1);assert.deepEqual(body.tools,[{urlContext:{}}]);
});
test('Nano Banana stores the actual MIME type and refuses missing anchors or invalid images',async()=>{
 const assets=memoryAssets();let calls=0;
 const g=makeGenerator('unit-test-only',assets,{},async()=>{calls++;return geminiResponse([{inlineData:{mimeType:'image/jpeg',data:b64(jpeg)}}]);});
 const image=await g.image(plan,0,'test-id','');assert.match(image.value,/0.jpg$/);
 assert.equal(assets.stored.get('reader/test-id/0.jpg').options.contentType,'image/jpeg');
 await assert.rejects(g.image(plan,1,'different-id',image.value),/MISSING_ANCHOR/);assert.equal(calls,1);
 const bad=makeGenerator('unit-test-only',assets,{},async()=>geminiResponse([{inlineData:{mimeType:'image/png',data:b64(jpeg)}}]));
 await assert.rejects(bad.image(plan,1,'test-id',''),/INVALID_MEDIA/);assert.equal(assets.stored.size,1);
});
test('blocked, truncated and malformed output never becomes a ready page or plan',async()=>{
 const assets=memoryAssets();
 for(const response of [()=>geminiResponse([],{finishReason:'SAFETY'}),()=>geminiResponse([{text:JSON.stringify(plan)}],{finishReason:'MAX_TOKENS'}),()=>geminiResponse([{text:'not JSON'}])]){
  const g=makeGenerator('unit-test-only',assets,{},async()=>response());await assert.rejects(g.plan(selection,'seed'));
 }
 assert.equal(assets.stored.size,0);
 assert.deepEqual(configuredModels({GEMINI_TEXT_MODEL:'gemini-3.6-flash',GEMINI_IMAGE_MODEL:'gemini-3.1-flash-image'}),{text:'gemini-3.6-flash',image:'gemini-3.1-flash-image'});
});

test('narration stays off even when an old client or saved session requests it',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake();
 await repo.create(id,'alice',{...selection,voice:true});
 let result;
 for(let i=0;i<9;i++)result=await advanceStory(repo,g,'alice',id,7);
 assert.equal(result.state,'completed');
 assert.equal(result.selection.voice,false);
 assert.equal(result.story.voiceRequested,false);
 assert.equal(g.calls.filter(x=>x.startsWith('audio:')).length,0);
 assert.equal(g.calls.filter(x=>x.startsWith('image:')).length,8);
});

test('chosen art direction persists across resume and reaches every image call',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake(),styles=[];
 const original=g.image;g.image=async(...args)=>{styles.push(args[4]);return original(...args);};
 await repo.create(id,'alice',{...selection,artStyle:'ink-wash'});
 await advanceStory(repo,g,'alice',id,1);
 await advanceStory(repo,g,'alice',id,1);
 await advanceStory(repo,g,'alice',id,1);
 await advanceStory(repo,g,'alice',id,1);
 const resumed=await advanceStory(repo,g,'alice',id,1);
 assert.equal(resumed.selection.artStyle,'ink-wash');assert.equal(resumed.story.artStyleLabel,'水墨写意');
 assert.deepEqual(styles,['ink-wash','ink-wash']);
 const oldId=crypto.randomUUID();await repo.create(oldId,'bob',selection);
 assert.equal((await advanceStory(repo,g,'bob',oldId,0)).selection.artStyle,'ink-pencil');
});
test('new art styles pass validation and reach planning and image generation without pencil fallback',async()=>{
 const styles=[['cinematic',/Photorealistic/],['watercolor',/watercolor storybook/],['gongbi',/gongbi painting/],['woodblock',/woodblock folk print/],['paper-cut',/paper-cut illustration/],['cartoon',/2D cartoon/],['line-art',/Minimalist line-art/],['chibi',/Cute chibi/],['3d-animation',/3D animated-film/],['clay',/clay stop-motion/],['classical-oil',/Classical figurative oil painting/]];
 for(const [style,expected] of styles){
  const requests=[];
  const g=makeGenerator('unit-test-only',memoryAssets(),{},async(url,init)=>{const body=JSON.parse(init.body);requests.push(body);return url.includes('nano-banana')?geminiResponse([{inlineData:{mimeType:'image/png',data:b64(png)}}]):geminiResponse([{text:JSON.stringify(plan)}]);});
  const choice=selectionSchema.parse({...selection,artStyle:style});
  await g.plan(choice,'seed');await g.image(plan,0,'style-id','',choice.artStyle);
  assert.match(JSON.parse(requests[0].contents[0].parts[0].text).artDirection,expected,style);
  assert.match(requests[1].contents[0].parts[0].text,expected,style);
  assert.ok(!requests[1].contents[0].parts[0].text.includes('textured colored pencil'),style);
 }
});

test('five story choices are requested and accepted without inventing a missing source',async()=>{
 let body;const choices=Array.from({length:5},(_,i)=>({title:'已知篇目'+i,description:'一个不剧透的故事简介。'}));
 const result=await suggestStories('unit-test-only',selection,{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify({stories:choices,note:''})}]);});
 assert.equal(result.stories.length,5);
 assert.equal(body.generationConfig.responseFormat.text.schema.properties.stories.maxItems,5);
 assert.match(body.systemInstruction.parts[0].text,/未提供时至多5篇/);
 assert.match(body.systemInstruction.parts[0].text,/为1时只寻找一篇，找到即返回/);
 const unknown=await suggestStories('unit-test-only',selection,{},async()=>geminiResponse([{text:JSON.stringify({stories:[],note:'请补充原文。'})}]));
 assert.equal(unknown.stories.length,0);
});

test('production requirements persist on the story and reach planning and each picture',async()=>{
 const {repo}=setup(),id=crypto.randomUUID(),g=fake(),prompts=[];
 const productionPrompt='结尾不要直接提问，以一个无声动作收尾。';
 g.plan=async s=>{prompts.push(s.productionPrompt);return {value:plan,model:'fake',requestId:null,usage:null};};
 const image=g.image;g.image=async(...args)=>{prompts.push(args[5]);return image(...args);};
 await repo.create(id,'alice',{...selection,productionPrompt});
 for(let step=0;step<5;step++)await advanceStory(repo,g,'alice',id,1);
 assert.deepEqual(prompts,[productionPrompt,productionPrompt,productionPrompt]);
 assert.equal(view(await repo.get(id,'alice')).story.productionPrompt,productionPrompt);
 assert.equal(selectionSchema.parse(selection).productionPrompt,'');
 assert.throws(()=>selectionSchema.parse({...selection,productionPrompt:'x'.repeat(1201)}));
 const requests=[];
 const liveShape=makeGenerator('unit-test-only',memoryAssets(),{},async(url,init)=>{requests.push(JSON.parse(init.body));return url.includes('nano-banana')?geminiResponse([{inlineData:{mimeType:'image/png',data:b64(png)}}]):geminiResponse([{text:JSON.stringify(plan)}]);});
 await liveShape.plan({...selection,productionPrompt},id);await liveShape.image(plan,0,id,'','ink-pencil',productionPrompt);
 assert.equal(JSON.parse(requests[0].contents[0].parts[0].text).productionPrompt,productionPrompt);
 assert.ok(requests[1].contents[0].parts[0].text.includes(productionPrompt));
});


test('new batches pass exclusions to Gemini and remove repeated or renamed titles',async()=>{
 let body;const result=await suggestStories('unit-test-only',selection,{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify({stories:[{title:'《庄周梦蝶》',description:'已看过。'},{title:'庖丁解牛',description:'新篇目。'},{title:'庖丁解牛',description:'重复。'}],note:''})}]);},['庄周梦蝶']);
 assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).excludeTitles,['庄周梦蝶']);
 assert.deepEqual(result.stories.map(s=>s.title),['庖丁解牛']);
 assert.ok(result.note);
});

test('soft deletion is owner-scoped, durable and does not erase content or block new stories',async()=>{
 const {repo,db}=setup(),ids=Array.from({length:10},()=>crypto.randomUUID());for(const id of ids)await repo.create(id,'alice',selection);
 const id=ids[0],g=fake();await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await repo.progress(id,'alice',0,true);
 const before=await repo.get(id,'alice');assert.ok(before.last_read_at);
 await assert.rejects(repo.remove(id,'bob'),e=>e.status===404);
 const removed=await repo.remove(id,'alice');assert.equal(removed.storyId,id);assert.ok(removed.deletedAt);
 assert.deepEqual({...await repo.remove(id,'alice')},removed);
 assert.equal((await repo.list('alice')).some(s=>s.id===id),false);
 await assert.rejects(repo.get(id,'alice'),e=>e.status===404);
 await assert.rejects(repo.create(id,'alice',selection),e=>e.status===404);
 await assert.rejects(repo.progress(id,'alice',0,false),e=>e.status===404);
 await repo.create(crypto.randomUUID(),'alice',selection);assert.equal((await repo.list('alice')).length,10);
 const stored=db.prepare('SELECT * FROM reader_sessions WHERE id=?').get(id);assert.equal(stored.document,before.document);assert.equal(stored.saved,1);assert.equal(stored.last_read_at,before.last_read_at);
 assert.equal((await repo.deletions('bob')).length,0);assert.equal((await repo.deletions('alice')).length,1);
 assert.equal(await repo.acquire(before,{kind:'image',page:1,key:'image:1'}),null);
});
test('deleting during a paid step retains its result but cannot resume or resurrect the story',async()=>{
 const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 let release;const hold=new Promise(resolve=>release=resolve);let started;const ready=new Promise(resolve=>started=resolve);
 g.plan=async()=>{started();await hold;return {value:plan,model:'fake',requestId:'paid',usage:{tokens:10}};};
 const operation=advanceStory(repo,g,'alice',id,0);await ready;await repo.remove(id,'alice');release();
 await assert.rejects(operation,e=>e.status===404);
 const stored=db.prepare('SELECT document,state FROM reader_sessions WHERE id=?').get(id);assert.equal(JSON.parse(stored.document).draft.title,plan.title);assert.equal(JSON.parse(stored.document).usage.find(item=>item.step==='plan').requestId,'paid');assert.notEqual(stored.state,'running');
 await assert.rejects(advanceStory(repo,g,'alice',id,0),e=>e.status===404);assert.equal((await repo.list('alice')).length,0);
});
test('removing a shared sample affects only that reader and retains the published original',async()=>{
 const {repo,db}=setup();db.prepare("INSERT INTO stories(id,title,summary,book_id,theme,status,pages,reflection,source_text,source_url,adaptation_note,checks,created_at,updated_at) VALUES('shared','样篇','','liaozhai','','published','[]','','','','','{}','2026-01-01','2026-01-01')").run();
 await repo.remove('shared','alice');assert.equal((await repo.deletions('alice'))[0].storyId,'shared');assert.equal((await repo.deletions('bob')).length,0);assert.equal(db.prepare("SELECT status FROM stories WHERE id='shared'").get().status,'published');
});
test('restoring preserves content and progress without reactivating deleted generation',async()=>{
 const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await advanceStory(repo,g,'alice',id,0);await repo.progress(id,'alice',0,true);
 const before=await repo.get(id,'alice');await repo.remove(id,'alice');
 await assert.rejects(repo.restore(id,'bob'),e=>e.status===404);assert.equal((await repo.deletions('alice')).length,1);
 assert.deepEqual(await repo.restore(id,'alice'),{storyId:id,restored:true});assert.deepEqual({...await repo.get(id,'alice')},{...before,generation_control:'stopped'});
 assert.equal((await repo.list('alice')).some(s=>s.id===id),true);assert.equal((await repo.deletions('alice')).length,0);
 assert.deepEqual(await repo.restore(id,'alice'),{storyId:id,restored:false});assert.deepEqual(g.calls,['plan','image:0']);
 await repo.remove(id,'alice');db.prepare("UPDATE reader_sessions SET state='failed',error='原文暂时不可用' WHERE id=?").run(id);
 await repo.restore(id,'alice');assert.equal((await repo.get(id,'alice')).state,'failed');assert.deepEqual(g.calls,['plan','image:0']);
 await assert.rejects(repo.restore(crypto.randomUUID(),'alice'),e=>e.status===404);
});
test('restoring a shared story leaves other readers deletion markers in place',async()=>{
 const {repo,db}=setup();db.prepare("INSERT INTO stories(id,title,summary,book_id,theme,status,pages,reflection,source_text,source_url,adaptation_note,checks,created_at,updated_at) VALUES('shared','样篇','','liaozhai','','published','[]','','','','','{}','2026-01-01','2026-01-01')").run();
 await repo.remove('shared','alice');await repo.remove('shared','bob');await repo.restore('shared','alice');
 assert.equal((await repo.deletions('alice')).length,0);assert.equal((await repo.deletions('bob')).length,1);assert.equal(db.prepare("SELECT status FROM stories WHERE id='shared'").get().status,'published');
});

// Follow preparation through real SQLite, including edits made while art inference is running.
async function artPreparation(){
 const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();
 const source={edition:'a'.repeat(64),sectionId:'s0',firstUnit:'u0',lastUnit:'u0'};
 const chosen=selectionSchema.parse({...selection,storyTitle:'梦蝶',source,narrativeDetail:'balanced',length:'auto'});
 await repo.create(id,'alice',chosen);
 const doc={plan:null,images:[],audio:[],usage:[],original:{...original,localSource:source},intake:{phase:'preparing',generation:0,creationHash:'test',selected:{batch:0,index:0},search:{round:1,state:'idle'},batches:[{stories:[{title:'梦蝶',description:'梦与醒。',source},{title:'大葫芦',description:'器物与用处。',source:{...source,firstUnit:'u1',lastUnit:'u1'}}],note:''}]}};
 db.prepare('UPDATE reader_sessions SET document=? WHERE id=?').run(JSON.stringify(doc),id);
 g.prepareOriginal=async s=>({...original,localSource:s.source});
 g.recommend=async()=>({value:{count:7,reason:'保留完整因果。',storySummary:plan.summary,storyMatchReason:'按原典主线展开。'},model:'mock',requestId:'frames',usage:null});
 const read=()=>view(db.prepare('SELECT * FROM reader_sessions WHERE id=?').get(id));
 const choose=async index=>{const current=read();await changeIntake(repo,id,'alice',{action:'choose',batch:0,index,generation:current.intake.generation,requestId:crypto.randomUUID(),settings:{artStyle:current.selection.artStyle,productionPrompt:'',narrativeDetail:'balanced'}});};
 return {repo,db,id,g,read,choose};
}

test('preparation recommends each chosen story and durably reuses its art on reselection',async()=>{
 const f=await artPreparation();let calls=0;
 f.g.recommendArt=async(s,text)=>{calls++;assert.deepEqual(text.localSource,s.source);return {artStyle:s.storyTitle==='梦蝶'?'paper-cut':'woodblock',reason:`适合${s.storyTitle}的动作与意境。`};};
 await advanceStory(f.repo,f.g,'alice',f.id,0);
 let saved=f.read();assert.equal(saved.intake.phase,'confirming');assert.equal(saved.selection.artStyle,'paper-cut');assert.equal(saved.intake.batches[0].stories[0].artRecommendation.reason,'适合梦蝶的动作与意境。');
 await f.choose(1);await advanceStory(f.repo,f.g,'alice',f.id,0);
 saved=f.read();assert.equal(saved.selection.artStyle,'woodblock');assert.equal(saved.intake.batches[0].stories[1].artRecommendation.artStyle,'woodblock');
 await f.choose(0);await advanceStory(new ReaderRepository(f.repo.db),f.g,'alice',f.id,0);
 assert.equal(f.read().selection.artStyle,'paper-cut');assert.equal(calls,2,'Reselection reuses the persisted recommendation');
 f.db.close();
});

test('an in-flight art result preserves a manual draft and concurrently appended search results',async()=>{
 const f=await artPreparation();let release,started;
 const waiting=new Promise(resolve=>{started=resolve;});
 f.g.recommendArt=async()=>{started();return new Promise(resolve=>{release=resolve;});};
 const work=advanceStory(f.repo,f.g,'alice',f.id,0);await waiting;
 const draft={artStyle:'cinematic',productionPrompt:'我的要求',narrativeDetail:'balanced',length:5};
 await changeIntake(f.repo,f.id,'alice',{action:'draft',settings:draft,generation:0,requestId:crypto.randomUUID()});
 const extra={stories:[{title:'追加的故事',description:'查找的新结果。'}],note:''};
 f.db.prepare("UPDATE reader_sessions SET document=json_insert(document,'$.intake.batches[#]',json(?)) WHERE id=?").run(JSON.stringify(extra),f.id);
 release({artStyle:'paper-cut',reason:'纸影适合梦境。'});await work;
 const saved=f.read();assert.equal(saved.selection.artStyle,'ink-pencil','The saved draft owns the manual style until confirmation');assert.deepEqual(saved.intake.draft,draft);assert.deepEqual(saved.intake.batches[1],extra);assert.equal(saved.intake.batches[0].stories[0].artRecommendation.artStyle,'paper-cut');
 await changeIntake(f.repo,f.id,'alice',{action:'confirm',settings:draft,generation:0,requestId:crypto.randomUUID()});
 assert.equal(f.read().selection.artStyle,'cinematic');f.db.close();
});

test('a saved manual style survives later story recommendations',async()=>{
 const f=await artPreparation();
 f.db.prepare("UPDATE reader_sessions SET selection=json_set(selection,'$.artStyle','cinematic'),document=json_set(document,'$.intake.manualArt',json('true')) WHERE id=?").run(f.id);
 f.g.recommendArt=async()=>({artStyle:'paper-cut',reason:'纸影适合梦境。'});
 await advanceStory(f.repo,f.g,'alice',f.id,0);
 assert.equal(f.read().selection.artStyle,'cinematic');assert.equal(f.read().intake.batches[0].stories[0].artRecommendation.artStyle,'paper-cut');f.db.close();
});

test('frame recommendation retries reuse saved art and art failures never pretend a default was recommended',async()=>{
 const f=await artPreparation();let calls=0,frames=0,failArt=true;
 f.g.recommendArt=async()=>{calls++;if(failArt)throw Error('art unavailable');return {artStyle:'woodblock',reason:'轮廓适合动作。'};};
 f.g.recommend=async()=>{if(frames++===0)throw Error('frames unavailable');return {value:{count:7,reason:'保留完整因果。',storySummary:plan.summary,storyMatchReason:'按原典主线展开。'},model:'mock',requestId:'frames',usage:null};};
 await advanceStory(f.repo,f.g,'alice',f.id,0);
 assert.equal(f.read().state,'failed');assert.equal(f.read().intake.batches[0].stories[0].artRecommendation,undefined);assert.equal(frames,0);
 failArt=false;await advanceStory(f.repo,f.g,'alice',f.id,0,true);
 assert.equal(f.read().state,'failed');assert.equal(f.read().selection.artStyle,'woodblock');
 await advanceStory(new ReaderRepository(f.repo.db),f.g,'alice',f.id,0,true);
 assert.equal(f.read().intake.phase,'confirming');assert.equal(calls,2,'Frame retry does not pay for art again');f.db.close();
});

test('a replaced generation rejects an in-flight art result',async()=>{
 const f=await artPreparation();
 f.g.recommendArt=async()=>{f.db.prepare("UPDATE reader_sessions SET document=json_set(document,'$.intake.generation',1),lock_token=NULL,state='idle' WHERE id=?").run(f.id);return {artStyle:'paper-cut',reason:'纸影适合梦境。'};};
 await assert.rejects(advanceStory(f.repo,f.g,'alice',f.id,0),error=>error.status===409);
 assert.equal(f.read().selection.artStyle,'ink-pencil');assert.equal(f.read().intake.batches[0].stories[0].artRecommendation,undefined);f.db.close();
});
