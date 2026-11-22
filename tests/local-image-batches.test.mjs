// Exercise legacy counts and reader demand through the same durable queue as production.
// Batch-era assertions follow saved checkpoints rather than synchronous HTTP completion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn,makePlan,selection} from './fixtures/production.mjs';
import {emptyDag} from '../lib/production-dag/document.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {flowProviders,fullTier,heavy} from './fixtures/test-tier.mjs';
const owner='docker-local-owner';
const zhuangzi={title:'齐物论',text:'昔者庄周梦为胡蝶，栩栩然胡蝶也，自喻适志与！不知周也。俄然觉，则蘧蘧然周也。不知周之梦为胡蝶与，胡蝶之梦为周与？',url:'https://example.test/zhuangzi',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01'};
/** 一篇已确认、尚未制作的 DAG 故事（原文已核对，不经准备流程）。 */
async function confirmedStory(f,length=4){
 const id=crypto.randomUUID(),now=new Date().toISOString(),doc={plan:null,images:[],audio:[],usage:[],original:zhuangzi,dag:emptyDag()};
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at) VALUES(?,?,?,?,'background','active','idle',?,?)").bind(id,owner,JSON.stringify({...selection,length}),JSON.stringify(doc),now,now).run();
 return id;
}
const control=(f,id,action)=>f.json(`sessions/${id}/production-control`,'POST',{action});
async function finish(f,id,page=0){await f.demand(id,crypto.randomUUID(),page);await until(async()=>(await f.read(id)).state==='completed',60000);return f.read(id);}
async function waiting(f,id){await until(async()=>{const s=await f.read(id);return s.state==='failed';});return f.read(id);}

test('auto is the count default; invalid counts never create a production story',async t=>{
 const f=await productionFixture(t);assert.equal(selectionSchema.parse({bookId:'zhuangzi',theme:'测试'}).length,'auto');
 for(const length of [0,81,1.5,null,'30'])assert.equal((await f.request('sessions','POST',{requestId:crypto.randomUUID(),selection:{bookId:'zhuangzi',theme:'测试',length}})).status,400);
 assert.equal((await f.json('sessions')).length,0);
});
for(const provider of flowProviders(['gemini','codex'])){
 test(`${provider}: invalid exact outline fails before images; only explicit fault recovery proceeds`,async t=>{
  const f=await productionFixture(t,provider);f.control.hold=false;
  f.control.beforeText=async kind=>kind==='outline'?{...makePlan(1),beats:['只有一幅。']}:undefined;
  // Outlines exist only for batched stories (over 20 frames); 21 is the smallest, the full tier uses a long story.
  const length=fullTier?60:21,id=await f.create(length);await until(async()=>(await f.read(id)).state==='failed');assert.equal(f.control.calls.length,0);
  f.control.beforeText=null;await f.demand(id,crypto.randomUUID(),0,true);await until(async()=>(await f.read(id)).state==='completed',60000);assert.equal((await f.read(id)).ready,length);
 });
 test(`${provider}: anchor runs alone, later scenes publish out of order through the DAG drawing jobs`,async t=>{
  const f=await productionFixture(t,provider),id=await confirmedStory(f,8);f.app.services.production.wake();
  await until(()=>f.control.calls.length===1);assert.equal(f.control.calls[0].page,0);
  await turn();assert.equal(f.control.calls.length,1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
  const first=f.control.calls.find(c=>c.page===1);for(const page of [3,2]){f.control.calls.find(c=>c.page===page).resolve();await until(async()=>(await f.read(id)).story.pages[page].image);assert.equal((await f.read(id)).story.pages[1].image,'');}
  first.resolve();f.control.hold=false;for(const c of f.control.calls)c.resolve();await until(async()=>(await f.read(id)).state==='completed',20000);
  const doc=JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);
  for(let page=0;page<8;page++)assert.equal(f.control.calls.filter(c=>c.page===page).length,1,`frame ${page} is drawn once`);
  assert.equal(doc.images.filter(Boolean).length,8);
 });
 test(`${provider}: invalid recommendations preserve the original and require an authorized retry`,async t=>{
  // 准备流程里的幅数建议校验：无效建议不进入确认，保留原文，不产生任何绘图，读者授权重试后才继续。
  const f=await productionFixture(t,provider);f.control.hold=false;
  f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}}],note:''});
  let last;
  for(const bad of [{count:0},{count:81},{count:1.5},{count:'7'},{reason:'   '}]){
   f.control.beforeText=async kind=>kind==='recommend'?bad:undefined;
   last=(await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}})).id;
   await f.startDiscovery(last);await f.demand(last);
   await until(async()=>(await f.read(last)).intake.phase==='choosing',20000);
   await f.json(`sessions/${last}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(last)).intake.generation,action:'choose',batch:0,index:0});
   await until(async()=>(await f.read(last)).state==='failed',20000);
   const failed=await f.read(last);assert.equal(failed.intake.phase,'preparing');assert.equal(failed.frameRecommendation,null);assert.equal(f.control.calls.length,0);assert.ok(failed.faults.some(x=>x.stage==='prepare'&&x.retryAllowed));
   const doc=JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(last).first()).document);assert.ok(doc.dag===undefined||doc.dag.order.length===0,'no production started');
  }
  f.control.beforeText=null;await f.demand(last,crypto.randomUUID(),0,true);
  await until(async()=>(await f.read(last)).intake.phase==='confirming',20000);assert.equal((await f.read(last)).state,'idle');assert.equal(f.control.calls.length,0);
 });
}
test('frame 80 media, events and saved progress remain owner scoped and survive restart',heavy,async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(80),saved=await finish(f,id);
 assert.equal((await f.request(saved.story.pages[79].image.replace('/api/reader/',''))).status,200);
 assert.equal((await f.json(`sessions/${id}/progress`,'POST',{page:79,saved:true})).page,79);
 const event={id:crypto.randomUUID(),visitor:crypto.randomUUID(),session:crypto.randomUUID(),storyId:id,kind:'page',page:79,mode:'manual',cohort:'internal'};
 assert.equal((await f.request(`sessions/${id}/events`,'POST',event)).status,200);
 for(const suffix of ['progress','advance','events'])assert.equal((await f.request(`sessions/${id}/${suffix}`,'POST',suffix==='progress'?{page:80,saved:true}:suffix==='advance'?{throughPage:80}:{...event,page:80})).status,400);
 for(const file of ['80.png','079.png','79.svg','-1.png','1.png/extra'])assert.equal((await f.request(`media/${id}/${file}`)).status,404);
 await f.restart();const restored=await f.read(id);assert.equal(restored.page,79);assert.equal(restored.saved,true);assert.equal(restored.ready,80);
 const short=await f.create(1);await finish(f,short);assert.equal((await f.request(`sessions/${short}/progress`,'POST',{page:79,saved:true})).status,400);
});
test('reader lease exit drains started calls and dispatches no additional images',async t=>{
 const f=await productionFixture(t),id=await f.create(10),viewer=crypto.randomUUID();await f.demand(id,viewer);await until(()=>f.control.calls.length===1);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);await f.leave(id,viewer);for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).ready===4);await f.app.services.production.tick();assert.equal(f.control.calls.length,4);
});
test('unverifiable originals stop before recommendation, plan or images',async t=>{
 const f=await productionFixture(t,'gemini'),id=await f.create(8,{bookId:'other',customBook:'https://example.com/story',storyTitle:'未知故事',narrativeDetail:'balanced'});
 const failed=await waiting(f,id);assert.match(failed.error,/原文未能核对/);assert.equal(f.control.recommendations.length,0);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});
