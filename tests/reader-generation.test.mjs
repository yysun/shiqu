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
import {getArtStyle} from '../lib/reader-styles.ts';
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
const b64=b=>Buffer.from(b).toString('base64');
function memoryAssets(){const stored=new Map();return {stored,async get(k){const entry=stored.get(k);return entry?{async arrayBuffer(){return entry.bytes.slice().buffer;}}:null;},async put(k,bytes,options){stored.set(k,{bytes,options});}};}
function geminiResponse(parts,extra={}){return new Response(JSON.stringify({candidates:[{content:{parts},finishReason:'STOP',...extra}],responseId:'test-response',usageMetadata:{totalTokenCount:10}}),{headers:{'Content-Type':'application/json'}});}
test('running checkpoints are polled and leaving during a poll issues no further requests',async()=>{
 const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);
 db.prepare("UPDATE stories SET state='running',lock_token='in-flight',lock_until=? WHERE id=?").run(Date.now()+60000,id);
 let active=true;
 assert.equal(await runStoryGeneration(client(repo,g,id,{isActive:()=>active,sleep:async ms=>{assert.equal(ms,2000);active=false;}})),'');
 assert.deepEqual(g.calls,[]);assert.equal((await repo.get(id,'alice')).state,'running');
});
test('sessions are owner-scoped and client retries reuse a single session',async()=>{const {repo}=setup(),id=crypto.randomUUID(),g=fake();await repo.create(id,'alice',selection);await repo.create(id,'alice',selection);assert.equal((await repo.list('alice')).length,1);assert.equal((await repo.list('bob')).length,0);await assert.rejects(advanceStory(repo,g,'bob',id,1),e=>e.status===404);assert.deepEqual(g.calls,[]);});
test('new stories have no rolling daily cap, including concurrent starts',async()=>{
 const {repo}=setup();const rows=await Promise.all(Array.from({length:25},()=>repo.create(crypto.randomUUID(),'alice',selection)));
 assert.equal((await repo.list('alice')).length,25);
 await assert.rejects(repo.create(rows[0].id,'alice',{...selection,theme:'人情冷暖'}),e=>e.status===409);
 const retries=await Promise.all(Array.from({length:5},()=>repo.create(rows[0].id,'alice',selection)));
 assert.ok(retries.every(row=>row.id===rows[0].id&&row.selection===rows[0].selection&&row.created_at===rows[0].created_at));
 assert.equal((await repo.list('alice')).length,25);
 await assert.rejects(repo.create(rows[0].id,'bob',selection),e=>e.status===404);
 assert.equal((await repo.list('bob')).length,0);
 await repo.create(crypto.randomUUID(),'bob',selection);
 await repo.create(crypto.randomUUID(),'alice',selection);
 assert.equal((await repo.list('alice')).length,26);
});
test('book suggestions preserve selected book and custom theme; stale URL fields are ignored',async()=>{
 let body;const result=await suggestStories('unit-test-only',{...selection,customBook:'https://example.org/old',theme:'一个小人物的选择'},{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify({stories:[{title:'庄周梦蝶',description:'一个醒来后的疑问。'}],note:''})}]);});
 assert.equal(result.stories[0].title,'庄周梦蝶');assert.equal(body.tools,undefined);
 assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),{book:'庄子',theme:'一个小人物的选择',excludeTitles:[]});
});
test('five story choices are requested and accepted without inventing a missing source',async()=>{
 let body;const choices=Array.from({length:5},(_,i)=>({title:'已知篇目'+i,description:'一个不剧透的故事简介。'}));
 const result=await suggestStories('unit-test-only',selection,{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify({stories:choices,note:''})}]);});
 assert.equal(result.stories.length,5);
 assert.equal(body.generationConfig.responseFormat.text.schema.properties.stories.maxItems,undefined);
 assert.match(body.generationConfig.responseFormat.text.schema.properties.stories.description,/At most 5 items/);
 assert.match(body.systemInstruction.parts[0].text,/未提供时至多5篇/);
 assert.match(body.systemInstruction.parts[0].text,/为1时只寻找一篇，找到即返回/);
 const unknown=await suggestStories('unit-test-only',selection,{},async()=>geminiResponse([{text:JSON.stringify({stories:[],note:'请补充原文。'})}]));
 assert.equal(unknown.stories.length,0);
});

test('new batches pass exclusions to Gemini and remove repeated or renamed titles',async()=>{
 let body;const result=await suggestStories('unit-test-only',selection,{},async(url,init)=>{body=JSON.parse(init.body);return geminiResponse([{text:JSON.stringify({stories:[{title:'《庄周梦蝶》',description:'已看过。'},{title:'庖丁解牛',description:'新篇目。'},{title:'庖丁解牛',description:'重复。'}],note:''})}]);},['庄周梦蝶']);
 assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).excludeTitles,['庄周梦蝶']);
 assert.deepEqual(result.stories.map(s=>s.title),['庖丁解牛']);
 assert.ok(result.note);
});

test('unknown retired identities cannot enter current reader library actions',async()=>{
 const {repo}=setup();
 for(const owner of ['alice','bob']){
  await assert.rejects(repo.remove('shared',owner),e=>e.status===404);
  await assert.rejects(repo.restore('shared',owner),e=>e.status===404);
  await assert.rejects(repo.favorite('shared',owner,true),e=>e.status===404);
  assert.deepEqual(await repo.list(owner),[]);assert.deepEqual(await repo.deletions(owner),[]);
 }
});
test('restoring a current story leaves the other owner’s deletion markers untouched',async()=>{
 const {repo}=setup(),alice=crypto.randomUUID(),bob=crypto.randomUUID();
 await repo.create(alice,'alice',selection);await repo.create(bob,'bob',selection);
 await repo.remove(alice,'alice');await repo.remove(bob,'bob');await repo.restore(alice,'alice');
 assert.equal((await repo.deletions('alice')).length,0);assert.equal((await repo.deletions('bob'))[0].storyId,bob);
 await assert.rejects(repo.restore(bob,'alice'),e=>e.status===404);
 assert.equal((await repo.deletions('bob')).length,1);
});

// Follow preparation through real SQLite, including edits made while art inference is running.
async function artPreparation(){
 const {repo,db}=setup(),id=crypto.randomUUID(),g=fake();
 const source={edition:'a'.repeat(64),sectionId:'s0',firstUnit:'u0',lastUnit:'u0'};
 const chosen=selectionSchema.parse({...selection,storyTitle:'梦蝶',source,narrativeDetail:'balanced',length:'auto'});
 await repo.create(id,'alice',chosen);
 const doc={plan:null,images:[],audio:[],usage:[],original:{...original,localSource:source},intake:{phase:'preparing',generation:0,creationHash:'test',selected:{batch:0,index:0},search:{round:1,state:'idle'},batches:[{stories:[{title:'梦蝶',description:'梦与醒。',source},{title:'大葫芦',description:'器物与用处。',source:{...source,firstUnit:'u1',lastUnit:'u1'}}],note:''}]}};
 db.prepare('UPDATE stories SET document=? WHERE id=?').run(JSON.stringify(doc),id);
 g.prepareOriginal=async s=>({...original,localSource:s.source});
 g.recommend=async selection=>frameForStory(selection,selection.artStyle,'沿用当前画风。');
 const read=()=>view(db.prepare('SELECT * FROM stories WHERE id=?').get(id));
 const choose=async index=>{const current=read();await changeIntake(repo,id,'alice',{action:'choose',batch:0,index,generation:current.intake.generation,requestId:crypto.randomUUID(),settings:{artStyle:current.selection.artStyle,productionPrompt:'',narrativeDetail:'balanced'}});};
 return {repo,db,id,g,read,choose};
}

function frameForStory(selection,artStyle,reason){
 return {value:{count:7,reason:'保留完整因果。',storyTitle:selection.storyTitle,storySummary:plan.summary,storyMatchReason:'按原典主线展开。',artRecommendation:{artStyle,reason},requirements:{productionPrompt:'保留梦蝶与醒来的对照。',acceptancePrompt:'交代庄周梦中化蝶。\n交代庄周醒来的真实停点。'}},model:'mock',requestId:'frames',usage:null};
}

test('a saved manual style survives later story recommendations',async()=>{
 const f=await artPreparation();
 f.db.prepare("UPDATE stories SET selection=json_set(selection,'$.artStyle','cinematic'),document=json_set(document,'$.intake.manualArt',json('true')) WHERE id=?").run(f.id);
 f.g.recommend=async selection=>frameForStory(selection,'paper-cut','纸影适合梦境。');
 await advanceStory(f.repo,f.g,'alice',f.id,0);
 assert.equal(f.read().selection.artStyle,'cinematic');assert.equal(f.read().intake.batches[0].stories[0].artRecommendation.artStyle,'paper-cut');f.db.close();
});

test('frame recommendation retries reuse saved art and art failures never pretend a default was recommended',async()=>{
 const f=await artPreparation();let calls=0;
 f.g.recommend=async selection=>{if(calls++===0)throw Error('art unavailable');return frameForStory(selection,'woodblock','轮廓适合动作。');};
 await advanceStory(f.repo,f.g,'alice',f.id,0);
 assert.equal(f.read().state,'failed');assert.equal(f.read().intake.batches[0].stories[0].artRecommendation,undefined);assert.equal(calls,1);
 await advanceStory(f.repo,f.g,'alice',f.id,0,true);
 assert.equal(f.read().intake.phase,'confirming');assert.equal(f.read().selection.artStyle,'woodblock');assert.equal(f.read().intake.batches[0].stories[0].artRecommendation.artStyle,'woodblock');assert.equal(calls,2);f.db.close();
});

test('a replaced generation rejects an in-flight art result',async()=>{
 const f=await artPreparation();
 f.g.recommend=async selection=>{f.db.prepare("UPDATE stories SET document=json_set(document,'$.intake.generation',1),lock_token=NULL,state='idle' WHERE id=?").run(f.id);return frameForStory(selection,'paper-cut','纸影适合梦境。');};
 await assert.rejects(advanceStory(f.repo,f.g,'alice',f.id,0),error=>error.status===409);
 assert.equal(f.read().selection.artStyle,'ink-pencil');assert.equal(f.read().intake.batches[0].stories[0].artRecommendation,undefined);f.db.close();
});
