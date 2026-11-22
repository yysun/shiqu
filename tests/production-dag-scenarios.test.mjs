// 制作 DAG 经正式协调器的场景：在隔离的 SQLite 书库与受控提供方上运行，和应用使用同一条路径。
// 改一幅配文、保存、重启、继续：审片通过且绘图输入未变时，只重做受影响的审片，不产生任何绘图调用。
// 已确认的新故事从提纲一路制作到最后一幅图，按批调用，参考图取首幅成图。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn} from './fixtures/production.mjs';
import {story,replies,drive} from './fixtures/production-dag-runner.mjs';
import {owner} from './fixtures/book-reference.mjs';
import {png} from './fixtures/images.mjs';
import {projectDocument,emptyDag} from '../lib/production-dag/document.ts';
import {selection} from './fixtures/production-data.mjs';
import {referenceImageKey} from '../lib/reader-image-assets.ts';

/** 一篇已完成、审片通过的 DAG 故事，图片文件写入隔离书库。 */
async function completedStory(f){
 const id=crypto.randomUUID(),s=story({length:6});s.id=id;
 drive(s,replies());
 for(const key of s.dag.order)await f.media.put(referenceImageKey(id,s.dag.frames[key].image),png,{contentType:'image/png'});
 const doc={...s.doc,dag:s.dag,...projectDocument(s.dag,null)},now=new Date().toISOString();
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at) VALUES(?,?,?,?,'background','active','completed',?,?)")
  .bind(id,owner,JSON.stringify(s.selection),JSON.stringify(doc),now,now).run();
 return {id,dag:s.dag};
}
const saved=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);
const textCalls=control=>control.plans.length+control.outlines.length+control.batches.length+control.reflections.length+control.reflectionRepairs.length+control.frameReviews.length+control.structures.length+control.repairs.length;

test('edit a caption, save, restart and continue: only the affected review runs and nothing is redrawn',async t=>{
 const f=await productionFixture(t,'codex');
 const {id,dag:before}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(snapshot.plan);
 plan.pages[2].caption='管仲与鲍叔牙分金时，鲍叔让管仲多拿一份。';
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});

 // 已保存，等待继续：在点击继续之前不产生任何模型调用。
 let doc=await saved(f,child);
 assert.equal(doc.dag.continuation?.reason,'revision-saved');
 assert.equal(doc.dag.frames[doc.dag.order[2]].scene,plan.pages[2].caption);
 // 桌面端据此显示「已保存，等待继续」与「继续制作」。
 assert.equal((await f.read(child)).awaitingContinue,true);
 assert.equal((await f.read(child)).generationControl,'paused','the saved revision is also paused, so the paused-editing screens apply');
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.reviews.length,0);

 await f.restart();
 await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed',15000);
 assert.equal((await f.read(child)).awaitingContinue,undefined);

 doc=await saved(f,child);
 assert.equal(doc.dag.continuation,undefined);
 assert.equal(f.control.reviews.length,1,'one review call for the affected verdicts');
 assert.equal(f.control.calls.length,0,'no drawing calls');
 assert.equal(textCalls(f.control),0,'no planning, repair or frame-count calls');
 // 受影响的结论：被改画幅及相邻画幅的逐幅结论（硬输入变化）与叙事结论（核对输入变化）；其余结论原样保留。
 const recorded=p=>JSON.stringify([p?.inputs,p?.checks??null]);
 const changed=Object.keys(doc.dag.products).filter(k=>/Verdict:/.test(k)&&recorded(doc.dag.products[k])!==recorded(before.products[k])).sort();
 const [, second,third,fourth]=doc.dag.order;
 assert.deepEqual(changed,[`frameVerdict:${second}`,`frameVerdict:${third}`,`frameVerdict:${fourth}`,'narrativeVerdict:'].sort());
 assert.deepEqual(doc.dag.order.map(k=>doc.dag.products[`frameImage:${k}`].hash),before.order.map(k=>before.products[`frameImage:${k}`].hash));
 assert.equal(doc.images.length,6);
 assert.ok(doc.images.every(url=>url.startsWith(`/api/reader/media/${child}/`)),'the new version owns copies of its images');
});

const zhuangzi={title:'齐物论',text:'昔者庄周梦为胡蝶，栩栩然胡蝶也，自喻适志与！不知周也。俄然觉，则蘧蘧然周也。不知周之梦为胡蝶与，胡蝶之梦为周与？',url:'https://example.test/zhuangzi',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01'};
/** 一篇已确认、尚未制作的 DAG 故事。 */
async function confirmedStory(f,length=4,prepared={}){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const doc={plan:null,images:[],audio:[],usage:[],original:zhuangzi,dag:emptyDag(),...prepared};
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at) VALUES(?,?,?,?,'background','active','idle',?,?)")
  .bind(id,owner,JSON.stringify({...selection,length}),JSON.stringify(doc),now,now).run();
 return id;
}
const count=(list,name)=>list.filter(n=>n===name).length;

test('a confirmed story runs from the outline to its last image through the production path',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const doc=await saved(f,id);
 for(const [name,n] of [['brief',1],['characters',1],['outline',1],['sceneBatch',1],['visual',1]])assert.equal(count(f.control.dagCalls,name),n,name);
 assert.equal(f.control.reflections.length,1,'one ending call');
 assert.equal(f.control.frameReviews.length,0,'a fixed-length story has no frame-count check (as in v0.14.0)');
 assert.equal(f.control.reviews.length,1,'one review call');
 assert.equal(f.control.calls.length,4,'one drawing per frame');
 const first=f.control.calls.find(c=>c.page===0);
 assert.equal(first.reference,undefined,'the first frame has no reference image');
 assert.ok(f.control.calls.filter(c=>c.page>0).every(c=>c.reference),'later frames use the first image as reference');
 assert.equal(doc.plan.pages.length,4);
 assert.equal(doc.images.filter(Boolean).length,4);
 assert.ok(!f.control.calls.some(c=>c.prompt.includes(selection.productionPrompt)),'drawing prompts carry no production requirements');
});

/** 保存一次修订并继续制作到完成；返回新版文档。 */
async function revise(f,id,changes,{expectContinue=true}={}){
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:typeof changes==='function'?changes(snapshot):changes});
 if(expectContinue){
  assert.equal((await saved(f,child)).dag.continuation?.reason,'revision-saved');
  await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 }
 await until(async()=>(await f.read(child)).state==='completed',20000);
 return {child,doc:await saved(f,child)};
}

test('deleting a frame keeps every other image and identity: no drawing, one frame check and one review',async t=>{
 const f=await productionFixture(t,'codex');
 const {id,dag:before}=await completedStory(f);
 const {doc}=await revise(f,id,snapshot=>({removedFrames:[3],plan:{...snapshot.plan,pages:snapshot.plan.pages.filter((_,i)=>i!==2)}}));
 assert.deepEqual(doc.dag.order,before.order.filter((_,i)=>i!==2));
 assert.equal(f.control.calls.length,0,'no drawing calls');
 assert.equal(f.control.frameReviews.length,0,'no frame-count check for a fixed-length story');
 assert.equal(f.control.reviews.length,1);
 // 标题与结语候选绑定画幅身份序列，顺序改变后重新拟定；其余文字调用为零。
 assert.equal(f.control.reflections.length,1);
 assert.equal(textCalls(f.control)-f.control.reflections.length,0);
 assert.deepEqual(doc.dag.order.map(k=>doc.dag.products[`frameImage:${k}`].hash),before.order.filter((_,i)=>i!==2).map(k=>before.products[`frameImage:${k}`].hash));
});

test('redrawing one image with a note draws only that frame, with the note and the first image as reference',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const {doc}=await revise(f,id,{redrawPages:[2],redrawNotes:{'2':'把背景改成雨夜'}});
 assert.equal(f.control.calls.length,1);
 assert.equal(f.control.calls[0].page,1);
 assert.match(f.control.calls[0].prompt,/把背景改成雨夜/);
 assert.ok(f.control.calls[0].reference,'the first image is the reference');
 assert.equal(f.control.reviews.length+textCalls(f.control),0,'no text calls');
 assert.equal(doc.dag.frames[doc.dag.order[1]].redrawNote,'把背景改成雨夜');
});

test('a style change converts image descriptions in one batch, re-reviews frames and redraws every image',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 await revise(f,id,{artStyle:'watercolor'});
 assert.equal(count(f.control.dagCalls,'restyle'),1,'six frames in one conversion batch');
 assert.equal(count(f.control.dagCalls,'visual'),0);
 assert.equal(f.control.reviews.length,1);
 assert.equal(f.control.calls.length,6);
 // 其余画幅等新首幅完成后再以它为参考绘制。
 assert.equal(f.control.calls[0].page,0);
 assert.ok(f.control.calls.slice(1).every(c=>c.page>0));
});

test('a save that would discard a hand edit needs the reader to choose; discarding it then replans',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const edit=await revise(f,id,snapshot=>{const plan=structuredClone(snapshot.plan);plan.pages[1].caption='鲍叔牙在集市上替管仲付了账。';return {plan};});
 const snapshot=await f.json(`sessions/${edit.child}/revisions`);
 const refused=await f.request(`sessions/${edit.child}/revisions`,'POST',{requestId:crypto.randomUUID(),token:snapshot.token,changes:{productionPrompt:'写清选择与代价'}});
 assert.equal(refused.status,409);
 assert.match((await refused.json()).error,/手改/);
 const scene=`scene:${edit.doc.dag.order[1]}`;
 const {doc}=await revise(f,edit.child,{productionPrompt:'写清选择与代价',handEdits:{[scene]:'discard'}});
 assert.notDeepEqual(doc.dag.order,edit.doc.dag.order,'replanning gives frames new identities');
 assert.ok(count(f.control.dagCalls,'outline')>=1);
});

test('a failed step blocks only its dependants: independent steps finish, and recovery completes the story',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 let failing=true;
 f.control.beforeText=async name=>{if(name==='visual'&&failing){failing=false;throw Error('controlled failure');}};
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.length>0&&f.control.reflections.length===1,20000);
 // 不依赖画面描述的结语与幅数核对照常完成；依赖它的审片与绘图都未开始。
 assert.equal(f.control.reviews.length,0);
 assert.equal(f.control.calls.length,0);
 const fault=(await f.read(id)).faults[0];
 assert.equal(fault.state,'pending');
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(count(f.control.dagCalls,'visual'),2);
 assert.equal(f.control.reviews.length,1);
 assert.equal(f.control.calls.length,4);
 assert.ok(!(await f.read(id)).faults?.length);
});

test('landscape images are drawn on request for a completed story; a failure stays on its frame and can be retried',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 let failing=true;
 let status=await f.json(`sessions/${id}/landscape`);
 assert.equal(status.state,'idle');
 assert.ok(status.startToken);
 // 第三幅的横图第一次失败。
 f.control.beforeImage=call=>{if(call.landscape&&call.page===2&&failing){failing=false;throw Error('controlled landscape failure');}};
 status=await f.json(`sessions/${id}/landscape`,'POST',{startToken:status.startToken});
 await until(async()=>{const s=await f.json(`sessions/${id}/landscape`);return s.state!=='running';},20000);
 status=await f.json(`sessions/${id}/landscape`);
 assert.equal(status.state,'partial');
 assert.deepEqual(status.failed,[3]);
 assert.equal((await f.read(id)).state,'completed','an optional failure never undoes completion');
 status=await f.json(`sessions/${id}/landscape`,'POST',{retryToken:status.retryToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
 const landscapes=f.control.calls.filter(c=>c.landscape);
 assert.equal(landscapes.length,7,'six landscapes plus one retry');
 assert.ok(landscapes.every(c=>c.reference),'each landscape uses its portrait as reference');
});

test('preparation results carry into production: a verified summary and saved suggestions are not paid for again',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const summary='庄周梦见自己化为蝴蝶，翩然自得，醒来后不知是庄周梦为蝴蝶，还是蝴蝶梦为庄周。';
 const id=await confirmedStory(f,4,{original:{...zhuangzi,storyBrief:{summary,matchReason:'原文完整记载梦蝶与醒后的疑问。',verified:true}},frameRecommendation:{count:4,reason:'梦、醒、疑三段各需展开。'},frameCountConfirmed:true});
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const doc=await saved(f,id);
 assert.equal(count(f.control.dagCalls,'brief'),0,'the verified summary is adopted');
 assert.equal(doc.dag.brief,summary);
 assert.equal(doc.plan.summary,summary);
 assert.equal(f.control.reviews.length,1);
});

test('changing the production scope refreshes the factual synopsis once with the new scope',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const summary='庄周梦见化蝶，醒后追问梦与醒的区别。';
 const revisionSummary='庄周醒后想起梦中化蝶，追问庄周与蝴蝶的区别。';
 const scope='从庄周醒来开始，保留最后的追问。';
 const id=await confirmedStory(f,3,{
  original:{...zhuangzi,storyBrief:{summary,matchReason:'原文交代梦蝶与醒后的追问。',verified:true}},
  summaryProductionPrompt:selection.productionPrompt,
 });
 await until(async()=>(await f.read(id)).state==='completed',15000);
 assert.equal(count(f.control.dagCalls,'brief'),0);
 assert.deepEqual(f.control.reviews[0].storyBrief,{summary,matchReason:'原文交代梦蝶与醒后的追问。'});
 const requests=[];
 f.control.beforeText=(name,payload)=>{
  if(name==='brief'){requests.push(payload);return {summary:revisionSummary};}
 };
 const {doc}=await revise(f,id,{productionPrompt:scope});
 assert.equal(requests.length,1);
 assert.equal(requests[0].productionPrompt,scope);
 assert.equal(requests[0].verifiedOriginal.text,zhuangzi.text);
 assert.equal(doc.plan.summary,revisionSummary);
 assert.deepEqual(f.control.reviews.at(-1).storyBrief,{summary:revisionSummary});
});

// ——— 审查意见第 2 轮：正式入口与边界 ———

const snapshotA={provider:'codex',models:{text:'model-at-confirmation',image:null}};
/** 带模型快照服务的夹具：current 给出确认时的快照，provider 按快照给出提供方（null 表示服务不可用）。 */
async function snapshotFixture(t,service){
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 f.options.production={snapshots:service};
 await f.restart();
 return f;
}

/** 从创建、查找、选题到确认，全部经正式接口；返回故事编号。 */
async function confirmThroughIntake(f){
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}}],note:''});
 const created=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}});
 const id=created.id;
 if(created.intake.search.state==='idle'&&!created.intake.batches.length)await f.startDiscovery(id);
 // 查找候选需要阅读需求（选题窗口打开）。
 await f.demand(id);
 await until(async()=>(await f.read(id)).intake.phase==='choosing',20000);
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(id)).intake.phase==='confirming',20000);
 // 确认本身走正式接口：确认后由 adopt() 建立 dag，并记录当时的模型快照。
 const prepared=await f.read(id);
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:prepared.intake.generation,action:'confirm',settings:{artStyle:'watercolor',productionPrompt:'clear captions',narrativeDetail:'balanced',length:4}});
 return id;
}

test('a story confirmed through intake runs on the DAG path with its setup generation',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const id=await confirmThroughIntake(f);
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const doc=await saved(f,id);
 assert.equal(doc.dag.order.length,4);
 assert.equal(f.control.calls.length,4);
 const jobs=(await f.app.services.database.prepare("SELECT payload FROM production_jobs WHERE session_id=? AND kind IN ('dag','dag-draw')").bind(id).all()).results;
 const work=jobs.map(j=>JSON.parse(j.payload));
 const preparation=work.filter(j=>['verifySource','prepareArt','prepareSuggestions'].includes(j.work.call));
 const production=work.filter(j=>!preparation.includes(j));
 assert.ok(preparation.some(j=>j.work.call==='prepareSuggestions'));
 assert.ok(preparation.every(j=>j.setupGeneration===doc.intake.generation-1));
 assert.ok(production.length&&production.every(j=>j.setupGeneration===doc.intake.generation));
 assert.equal(doc.dag.modelSnapshot,undefined,'an injected provider has no snapshot service');
});

test('the review-only mode never starts a DAG drawing',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 f.app.stopGeneration();
 const {ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(f.app.services.database,f.generation,f.media,{stopBeforeImages:true});f.coordinators.push(coordinator);
 const id=await confirmedStory(f,4);
 coordinator.wake();
 await until(()=>f.control.reviews.length===1,20000);
 for(let i=0;i<30;i++){coordinator.wake();await turn();}
 assert.equal(f.control.calls.length,0);
 assert.ok((await f.app.services.database.prepare("SELECT id FROM production_jobs WHERE session_id=? AND kind='dag-draw' AND state='queued'").bind(id).first()),'drawings wait in the queue');
});

test('a repeated review issue gets a second repair rather than reusing the finished job',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 let reviews=0;
 const issue={page:3,category:'caption',problem:'配文没有交代庄周醒来',instruction:'补写醒来的动作',requiresReplan:false};
 f.control.beforeText=async name=>name==='review'&&reviews++<2?{issues:[issue]}:undefined;
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(count(f.control.dagCalls,'sceneRepair'),2,'the second identical issue is repaired again');
 assert.equal((await saved(f,id)).dag.repairs.used,2);
});

test('continue is idempotent for its own request and refuses a request ID used for another action',async t=>{
 const f=await productionFixture(t,'codex');
 const {id}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(snapshot.plan);plan.pages[0].caption='庄周在柳树下打盹，梦里化作蝴蝶。';
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});
 const paused=crypto.randomUUID();
 await f.json(`sessions/${child}/production-control`,'POST',{requestId:paused,action:'pause'});
 assert.equal((await f.request(`sessions/${child}/production-control`,'POST',{requestId:paused,action:'continue'})).status,409);
 const requestId=crypto.randomUUID();
 await f.json(`sessions/${child}/production-control`,'POST',{requestId,action:'continue'});
 const receipt=await f.app.services.database.prepare('SELECT fingerprint FROM reader_commands WHERE request_id=?').bind(requestId).first();
 assert.match(receipt.fingerprint,/^continue:/);
 assert.equal((await saved(f,child)).dag.continuation,undefined);
 await f.json(`sessions/${child}/production-control`,'POST',{requestId,action:'continue'});
});

test('an image lost while saving a revision blocks completion until the reader asks for a redraw',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id,dag:before}=await completedStory(f);
 const {rm}=await import('node:fs/promises');const path=await import('node:path');
 await rm(path.join(f.dataDirectory,'media','reader',id,'4.png'));
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(snapshot.plan);plan.pages[0].caption='庄周在柳树下打盹，梦里化作蝴蝶。';
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});
 await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 await until(()=>f.control.reviews.length===1,20000);
 for(let i=0;i<30;i++){f.app.services.production.wake();await turn();}
 const blocked=await f.read(child);
 assert.notEqual(blocked.state,'completed');
 assert.equal(f.control.calls.length,0,'nothing is redrawn without the reader');
 const fault=blocked.faults.find(x=>x.stage==='redraw');
 assert.ok(fault);
 await f.json(`sessions/${child}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(child)).state==='completed',20000);
 assert.deepEqual(f.control.calls.map(c=>c.page),[4]);
 assert.ok(before.order[4]);
});

// ——— 审查意见第 3 轮 ———

test('the CLI stops at reviewed only after the DAG review approves drawing, and reports blocked when the reader must act',async t=>{
 const {executeHeadless}=await import('../server/headless-cli.ts');
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const approved=await confirmedStory(f,4);
 const stuck=await confirmedStory(f,4,{});
 await f.stop();
 const run=id=>executeHeadless(process.cwd(),['run',id,'--until','reviewed','--timeout','20','--data-dir',f.dataDirectory],{generation:f.generation,variables:{}});
 const first=await run(approved);
 assert.equal(first.reason,'reviewed');
 assert.equal(f.control.calls.length,0);
 assert.equal(f.control.reviews.length,1);
 // 审片反复指出同一幅的问题，自动修订额度用尽后停在需读者处理。
 const issue={page:2,category:'caption',problem:'配文没有交代庄周醒来',instruction:'补写醒来的动作',requiresReplan:false};
 f.control.beforeText=async name=>name==='review'?{issues:[issue]}:undefined;
 const second=await run(stuck);
 assert.equal(second.reason,'blocked');
 assert.equal(f.control.calls.length,0);
});

test('an accepted continue replays even after the version is superseded',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const edit=async(storyId,caption)=>{const snapshot=await f.json(`sessions/${storyId}/revisions`);const plan=structuredClone(snapshot.plan);plan.pages[0].caption=caption;const child=crypto.randomUUID();await f.json(`sessions/${storyId}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});return child;};
 const child=await edit(id,'庄周在柳树下打盹，梦里化作蝴蝶。');
 const requestId=crypto.randomUUID();
 await f.json(`sessions/${child}/production-control`,'POST',{requestId,action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed',20000);
 await edit(child,'庄周醒来，摸着自己的手臂发怔。');
 const replay=await f.request(`sessions/${child}/production-control`,'POST',{requestId,action:'continue'});
 assert.equal(replay.status,200);
});

test('a live image check marks the loss with its fault; recovery redraws it and only the engine completes the story',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const {rm}=await import('node:fs/promises');const path=await import('node:path');
 const before=await f.read(id);
 const image=before.story.pages[2].image;
 await rm(path.join(f.dataDirectory,'media','reader',id,'2.png'));
 await f.json(`sessions/${id}/image-health`,'POST',{page:2,image});
 let doc=await saved(f,id);
 assert.equal(doc.dag.products[`frameImage:${doc.dag.order[2]}`].readable,false);
 const checked=await f.read(id);
 assert.notEqual(checked.state,'completed');
 const fault=checked.faults.find(x=>x.stage==='redraw');
 assert.ok(fault);
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.calls.length,0,'nothing is redrawn before the reader asks');
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.deepEqual(f.control.calls.map(c=>c.page),[2]);
 doc=await saved(f,id);
 assert.equal(doc.dag.products[`frameImage:${doc.dag.order[2]}`].readable,undefined);
});


// ——— 决策 7：模型快照 ———

test('confirmation records the model snapshot and its jobs are built from it, not from the current settings',async t=>{
 const built=[];
 const f=await snapshotFixture(t,{current:()=>snapshotA,provider:snapshot=>{built.push(snapshot);return f.generation;}});
 const id=await confirmThroughIntake(f);
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const doc=await saved(f,id);
 assert.deepEqual(doc.dag.modelSnapshot,snapshotA);
 assert.ok(built.length>0&&built.every(snapshot=>snapshot.models.text==='model-at-confirmation'),'every job builds its provider from the recorded snapshot');
 assert.equal(f.control.calls.length,4);
});

test('an unavailable snapshot service stops the story with a clear message; applying the current settings lets it finish',async t=>{
 const current={provider:'codex',models:{text:'model-now',image:null}};
 let available=false,now=snapshotA;
 const f=await snapshotFixture(t,{current:()=>now,provider:snapshot=>available||snapshot.models.text==='model-now'?f.generation:null});
 const id=await confirmThroughIntake(f);
 await until(async()=>(await f.read(id)).faults?.length>0,20000);
 const blocked=await f.read(id);
 assert.match(blocked.faults[0].message||blocked.error||'', /快照服务不可用/);
 assert.equal(blocked.snapshotUnavailable,true,'the view offers 应用当前模型设置');
 assert.equal(f.control.dagCalls.length,0,'no model call is paid while the snapshot service is unavailable');
 now=current;
 await f.json(`sessions/${id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'apply-model'});
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,current);
 assert.equal((await f.read(id)).snapshotUnavailable,true,'the failed job stays until the reader retries');
 const fault=(await f.read(id)).faults.find(x=>x.state==='pending');
 if(fault)await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(f.control.calls.length,4);
});

// ——— 没有准备流程的故事：原文核对经 DAG ———

test('a story created without the preparation flow gets its source through the DAG and then runs to the end',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const id=await f.create(4);
 await until(async()=>(await f.read(id)).state==='completed',30000);
 const doc=await saved(f,id);
 assert.ok(doc.original?.text,'the verified source is saved by the verifySource work');
 assert.equal(doc.dag.order.length,4);
 assert.equal(f.control.calls.length,4);
});

// ——— 复制与阅读优先 ———

test('copying a DAG story keeps its text and review; only the images run in the destination, or the saved images attach by frame identity',async t=>{
 const {copySavedStory}=await import('../server/reader-copy.ts');
 const source=await productionFixture(t,'codex');
 const {id,dag:before}=await completedStory(source);
 await source.stop();
 // 默认只复制文字：副本保留分镜与审片结论，图片按画幅重新绘制，不再有任何文字或审片调用。
 const textOnly=await productionFixture(t,'codex');
 textOnly.control.hold=false;
 const copyId=crypto.randomUUID();
 await copySavedStory(textOnly.app,process.cwd(),textOnly.dataDirectory,source.dataDirectory,id,copyId,undefined,{});
 let doc=await saved(textOnly,copyId);
 assert.deepEqual(doc.dag.order,before.order,'frame identities are preserved');
 assert.ok(doc.dag.order.every(key=>!doc.dag.frames[key].image&&!doc.dag.products[`frameImage:${key}`]),'no image record without images');
 assert.ok(doc.dag.products[`frameVerdict:${doc.dag.order[0]}`],'the review verdicts are kept');
 await textOnly.json(`sessions/${copyId}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await textOnly.read(copyId)).state==='completed',20000);
 assert.equal(textOnly.control.calls.length,6,'every frame is drawn in the destination');
 assert.equal(textOnly.control.reviews.length+textCalls(textOnly.control),0,'no text or review calls');

 // 显式复制图片：已保存的图片按画幅身份附加，目标不再绘图。
 const withImages=await productionFixture(t,'codex');
 withImages.control.hold=false;
 const imageCopy=crypto.randomUUID();
 await copySavedStory(withImages.app,process.cwd(),withImages.dataDirectory,source.dataDirectory,id,imageCopy,undefined,{images:true});
 doc=await saved(withImages,imageCopy);
 assert.equal(doc.copiedFrom.images,'complete');
 assert.ok(doc.dag.order.every(key=>doc.dag.frames[key].image&&doc.dag.products[`frameImage:${key}`]));
 assert.equal(doc.images.filter(Boolean).length,6);
 await withImages.json(`sessions/${imageCopy}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await withImages.read(imageCopy)).state==='completed',20000);
 assert.equal(withImages.control.calls.length,0,'copied images are not drawn again');
});

test('viewed pages and the first image go ahead of unread drawings; leaving restores page order',async()=>{
 const {viewedPriority}=await import('../server/dag-production.ts');
 const viewing=[{page:3,through:9}];
 assert.ok(viewedPriority(3,viewing)<viewedPriority(0,[]),'the current page goes ahead of any unread story');
 assert.ok(viewedPriority(9,viewing)<viewedPriority(0,[]),'read-ahead pages go ahead too');
 assert.ok(viewedPriority(0,viewing)<viewedPriority(1,[]),'the first image is the reference for every page');
 assert.equal(viewedPriority(10,viewing),10,'pages beyond the read-ahead keep page order');
 assert.equal(viewedPriority(5,[]),5,'without a reader every page keeps page order');
});

// ——— 审查：修订不得绕过明确恢复 ———

test('a revision keeps an unresolved drawing fault whose inputs did not change; a general continue does not redraw that frame',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id,dag}=await completedStory(f);
 const key=dag.order[1],doc0=await saved(f,id);
 // 第 2 幅绘图失败：没有成图记录，故障待读者恢复。
 delete doc0.dag.frames[key].image;delete doc0.dag.products[`frameImage:${key}`];doc0.images[1]='';
 await f.app.services.database.prepare("UPDATE stories SET document=?,state='idle' WHERE id=?").bind(JSON.stringify(doc0),id).run();
 const now=Date.now();
 await f.app.services.database.prepare("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,message,created_at,updated_at) VALUES('drawfault',?,?,'job','frameImage',?,'dag','绘图失败',?,?)").bind(id,owner,key,now,now).run();
 const snapshot=await f.json(`sessions/${id}/revisions`),childId=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:childId,token:snapshot.token,changes:{plan:{...snapshot.plan,summary:'一段与绘图无关的新梗概，只改变梗概文字。'}}});
 const faults=(await f.app.services.database.prepare("SELECT node,node_key,state FROM reader_faults WHERE session_id=?").bind(childId).all()).results;
 assert.deepEqual(faults.map(x=>[x.node,x.node_key,x.state]),[['frameImage',key,'pending']],'the unchanged fault is carried to the new version');
 await f.json(`sessions/${childId}/production-control`,'POST',{action:'continue'}).catch(()=>{});
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.calls.length,0,'nothing is drawn without an explicit recovery');
});

test('a paid drawing is kept on its job before it is saved: a failed save and its retry do not pay twice',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 // 第一次保存绘图结果时让故事文档写入失败，之后恢复。
 let failing=true;
 const database=f.app.services.database,original=database.prepare.bind(database);
 database.prepare=query=>{
  const statement=original(query);
  if(failing&&/UPDATE stories SET document=\?,state=CASE/.test(query)&&f.control.calls.length>0){
   return {...statement,bind:(...values)=>{const bound=statement.bind(...values);return {...bound,run:async()=>{failing=false;throw Object.assign(Error('SQLITE_BUSY'),{code:'SQLITE_BUSY'});}};}};
  }
  return statement;
 };
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.length>0,20000);
 assert.equal(failing,false,'the injected save failure happened');
 const fault=(await f.read(id)).faults[0];
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed',30000);
 const paid=f.control.calls.filter(c=>c.page===0).length;
 assert.equal(paid,1,'the first frame is drawn once even though its first save failed');
});


test('a story without a snapshot (for example upgraded) gets the current settings recorded before its jobs run',async t=>{
 const f=await snapshotFixture(t,{current:()=>snapshotA,provider:()=>f.generation});
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,snapshotA);
});

test('apply-model replays by its request id and never rewrites the snapshot from later settings; override is bound to its fault id',async t=>{
 let now=snapshotA;
 const f=await snapshotFixture(t,{current:()=>now,provider:()=>f.generation});
 const id=await confirmedStory(f,4);
 await f.app.services.database.prepare("UPDATE stories SET generation_control='paused' WHERE id=?").bind(id).run();
 f.app.services.production.wake();
 const requestId=crypto.randomUUID(),second={provider:'codex',models:{text:'model-second',image:null}};
 await f.json(`sessions/${id}/production-control`,'POST',{requestId,action:'apply-model'});
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,snapshotA);
 now=second;
 await f.json(`sessions/${id}/production-control`,'POST',{requestId,action:'apply-model'});
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,snapshotA,'a replay does not write the newer settings');
 await f.json(`sessions/${id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'apply-model'});
 assert.deepEqual((await saved(f,id)).dag.modelSnapshot,second,'a new request applies the current settings');
 const other=await f.request(`sessions/${id}/production-control`,'POST',{requestId,action:'pause'});
 assert.equal(other.status,409,'the request id cannot be reused for another action');
});

test('a review override only approves the problem the reader saw: a stale or wrong fault id is refused',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const issue={page:2,category:'caption',problem:'配文没有交代庄周醒来',instruction:'补写醒来的动作',requiresReplan:false};
 f.control.beforeText=async name=>name==='review'?{issues:[issue]}:undefined;
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.some(x=>x.stage==='review'),30000);
 const fault=(await f.read(id)).faults.find(x=>x.stage==='review');
 assert.match(fault.id,/^review:/);
 const wrong=await f.request(`sessions/${id}/review-override`,'POST',{requestId:crypto.randomUUID(),faultId:'review:'+'0'.repeat(32)});
 assert.equal(wrong.status,409);
 assert.equal((await f.json(`sessions/${id}/review-override`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id})).id,id);
});

test('a file restored before the reader clicks recover is reused for free, without a redraw',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const {rm,writeFile,readFile}=await import('node:fs/promises');const path=await import('node:path');
 const file=path.join(f.dataDirectory,'media','reader',id,'2.png');
 const bytes=await readFile(file);
 const image=(await f.read(id)).story.pages[2].image;
 await rm(file);
 await f.json(`sessions/${id}/image-health`,'POST',{page:2,image});
 const fault=(await f.read(id)).faults.find(x=>x.stage==='redraw');
 assert.ok(fault);
 // 点击恢复之前，文件已被放回原处。
 await writeFile(file,bytes);
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(f.control.calls.length,0,'the restored file is reused, nothing is drawn or paid');
 assert.ok(!(await f.read(id)).faults?.length);
});

test('CLI: a saved revision waits for stories continue; run reports continue_required and never continues on its own',async t=>{
 const {executeHeadless}=await import('../server/headless-cli.ts');
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 await f.stop();
 const call=(args,input)=>executeHeadless(process.cwd(),[...args,'--data-dir',f.dataDirectory],{generation:f.generation,variables:{},input:input||{}});
 const revisions=await call(['stories','revisions',id]),plan=structuredClone(revisions.plan);
 plan.pages[2].caption='管仲与鲍叔牙分金时，鲍叔让管仲多拿一份。';
 const edited=await call(['stories','edit',id,'--request-id',crypto.randomUUID()],{token:revisions.token,changes:{plan}});
 const child=edited.session.id;
 assert.equal(edited.session.awaitingContinue,true);
 const blocked=await call(['run',child,'--until','reviewed','--timeout','20']);
 assert.equal(blocked.reason,'continue_required');
 assert.equal(f.control.reviews.length,0,'run did not start any work');
 await call(['stories','resume',child,'--request-id',crypto.randomUUID()]);
 assert.equal((await call(['run',child,'--until','reviewed','--timeout','20'])).reason,'continue_required','resume does not clear the wait');
 const continued=await call(['stories','continue',child,'--request-id',crypto.randomUUID()]);
 assert.equal(continued.session.awaitingContinue,undefined);
 assert.equal((await call(['run',child,'--until','completed','--timeout','30'])).reason,'completed');
});

test('the revision preview uses the same engine rules as saving and writes nothing',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const before=(await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM stories').first()).n;
 // 只改一幅配文：该幅画面描述与相邻审片需重做，图片不变（配文不是绘图输入）。
 const plan=structuredClone(snapshot.plan);plan.pages[2].caption='管仲与鲍叔牙分金时，鲍叔让管仲多拿一份。';
 const caption=await f.json(`sessions/${id}/revisions/preview`,'POST',{token:snapshot.token,changes:{plan}});
 assert.equal(caption.changed,true);assert.equal(caption.total,6);assert.equal(caption.redraw,0);assert.equal(caption.reused,6);
 assert.equal(caption.continues,true,'the review has to run again');
 // 换画风：全部画幅需重绘。
 const style=await f.json(`sessions/${id}/revisions/preview`,'POST',{token:snapshot.token,changes:{artStyle:'watercolor'}});
 assert.equal(style.redraw,6);assert.equal(style.reused,0);
 assert.ok(style.textWork.restyle>=1,'the descriptions are converted first');
 // 预览不创建新版，也不改动原版。
 assert.equal((await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM stories').first()).n,before);
 assert.equal((await f.request(`sessions/${id}/revisions/preview`,'POST',{token:'0'.repeat(64),changes:{}})).status,409);
 // 与保存一致：保存同一修改，新版需要「继续制作」且图片全部保留。
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});
 assert.equal((await f.read(child)).awaitingContinue,true);
});

test('a revision drops a fault whose inputs changed and keeps one whose inputs did not',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 // 提纲失败：读者改了制作要求后，旧故障不再适用，新提纲在「继续制作」后运行。
 let failing=true;
 f.control.beforeText=async name=>{if(name==='outline'&&failing){failing=false;throw Error('controlled outline failure');}};
 const id=await confirmedStory(f,4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.length>0,20000);
 await f.json(`sessions/${id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'pause'});
 const snapshot=await f.json(`sessions/${id}/revisions`),child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{productionPrompt:'写清选择与代价，突出人物的转变'}});
 const carried=(await f.app.services.database.prepare("SELECT node FROM reader_faults WHERE session_id=? AND state='pending'").bind(child).all()).results;
 assert.deepEqual(carried,[],'the outline fault is not carried: its inputs changed');
 await f.json(`sessions/${child}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed',30000);
 assert.equal(count(f.control.dagCalls,'outline'),2,'the failed outline plus the new one');
});

// ——— v0.14.0 对等：换画风并指定首幅原图 ———

test('a style revision saves the supplied first frame byte for byte and draws only the remaining pages (v0.14.0 parity)',async t=>{
 const {jpeg}=await import('./fixtures/images.mjs');
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 await f.json(`library/${id}/reference`,'POST',{page:0,starred:true}).catch(()=>{});
 const snapshot=await f.json(`sessions/${id}/revisions`),image=new Blob([Uint8Array.from(jpeg)],{type:'image/jpeg'});
 const requestId=crypto.randomUUID(),revision={requestId,token:snapshot.token,changes:{artStyle:'watercolor'}};
 const send=cover=>{
  const form=new FormData();form.set('revision',JSON.stringify(revision));form.set('cover',cover,'first.jpg');
  return f.app.handle(new Request(`http://shiqu.local/api/reader/sessions/${id}/revisions`,{method:'POST',body:form}));
 };
 assert.equal((await send(new Blob(['broken']))).status,400,'an unreadable file is refused');
 const response=await send(image);assert.equal(response.status,201);
 const child=await response.json();
 // 与 v0.14.0 的差别：旧画风的其余画幅在重绘前仍可见（不再清空），所以这里不断言 ready===1。
 assert.ok(child.story.pages[0].image,'the supplied first frame is shown at once');
 assert.deepEqual(await (await f.request(child.story.pages[0].image.replace('/api/reader/',''))).arrayBuffer(),await image.arrayBuffer(),'the bytes are kept as supplied');
 assert.equal((await send(image)).status,201,'a replay reuses the same version');
 assert.equal((await send(new Blob(['different']))).status,409,'the request id cannot carry another image');
 const before=f.control.calls.length;
 await f.json(`sessions/${child.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'continue'});
 await until(async()=>(await f.read(child.id)).state==='completed',30000);
 const calls=f.control.calls.slice(before);
 assert.deepEqual(calls.map(call=>call.page).sort((a,b)=>a-b),[1,2,3,4,5],'only the remaining frames are drawn');
 const reference=Buffer.from(await image.arrayBuffer()).toString('base64');
 assert.ok(calls.every(call=>call.reference===reference),'every later frame uses the supplied image as its reference, not the starred book reference');
 assert.equal((await saved(f,child.id)).dag.cover,undefined,'the cover is recorded as the first frame image');
});

test('preview and save share one calculation: review notes count, hand edits are protected, and neither starts a model call',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 // 先手改一幅配文并继续到完成，使其成为受保护的手改。
 const edit=await revise(f,id,snapshot=>{const plan=structuredClone(snapshot.plan);plan.pages[1].caption='鲍叔牙在集市上替管仲付了账。';return {plan};});
 const base=await f.json(`sessions/${edit.child}/revisions`);
 const text=()=>f.control.reviews.length+f.control.calls.length+f.control.dagCalls.length;
 const calls=text();
 // 审核意见的变化会重新审片：预估必须计入。
 const notes=await f.json(`sessions/${edit.child}/revisions/preview`,'POST',{token:base.token,changes:{reviewNotes:'请复核第 2 幅的人物关系'}});
 assert.equal(notes.continues,true);assert.ok(notes.textWork.review>=1||Object.keys(notes.textWork).length>0,'the review notes make the review run again');
 // 制作要求改变会重新编排并丢弃该手改：预估列为冲突，保存被拒绝且不留下新版。
 const prompt=await f.json(`sessions/${edit.child}/revisions/preview`,'POST',{token:base.token,changes:{productionPrompt:'写清选择与代价，突出转变'}});
 assert.ok(prompt.conflicts.length>0,'the hand edit conflicts with a re-plan');
 const stories=(await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM stories').first()).n;
 const refused=await f.request(`sessions/${edit.child}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{productionPrompt:'写清选择与代价，突出转变'}});
 assert.equal(refused.status,409);const message=(await refused.json()).error;assert.match(message,/第 \d+ 幅的配文/,'names the frame, not an internal id');assert.doesNotMatch(message,/\bn\d+\b/);
 assert.equal((await f.app.services.database.prepare('SELECT COUNT(*) AS n FROM stories').first()).n,stories,'nothing is saved when it would drop a hand edit');
 // 画风改变只需以手改为基础转换：不弹窗、不拒绝。
 const style=await f.json(`sessions/${edit.child}/revisions/preview`,'POST',{token:base.token,changes:{artStyle:'watercolor'}});
 assert.deepEqual(style.conflicts,[]);
 assert.equal(text(),calls,'preview and a refused save started no model call');
});

// ——— 阶段 3：正确性缺口 ———

test('ready does not count a lost image; the review history and acceptance results come from the engine',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const {rm}=await import('node:fs/promises');const path=await import('node:path');
 const before=await f.read(id);assert.equal(before.ready,6);
 const image=before.story.pages[2].image;
 await rm(path.join(f.dataDirectory,'media','reader',id,'2.png'));
 await f.json(`sessions/${id}/image-health`,'POST',{page:2,image});
 assert.equal((await f.read(id)).ready,5,'the lost image is not ready');
 const history=await f.json(`sessions/${id}/review-history`);
 assert.equal(history.status,'passed');
 assert.ok(history.entries.some(e=>e.kind==='review'&&e.outcome==='passed'),'the current review verdicts are listed');
 const prompts=await f.json(`sessions/${id}/prompts`);
 assert.ok(Array.isArray(prompts.results));
});

test('a revision cannot change the source reference, and a shortened story keeps the reading position inside it',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const invented=await f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:snapshot.token,changes:{plan:{...snapshot.plan,sourceReference:'虚构的出处'}}});
 assert.equal(invented.status,400);
 await f.app.services.database.prepare('UPDATE stories SET page=5 WHERE id=?').bind(id).run();
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{removedFrames:[5,6],plan:{...snapshot.plan,pages:snapshot.plan.pages.slice(0,4)}}});
 assert.ok((await f.read(child)).page<=3,'the reading position stays inside the shortened story');
});

test('a landscape file that is no longer readable shows as failed and is redrawn on retry',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 let status=await f.json(`sessions/${id}/landscape`);
 await f.json(`sessions/${id}/landscape`,'POST',{startToken:status.startToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
 status=await f.json(`sessions/${id}/landscape`);
 await f.media.put(referenceImageKey(id,status.images[2]),new TextEncoder().encode('not an image'),{contentType:'image/png'});
 status=await f.json(`sessions/${id}/landscape`);
 assert.deepEqual(status.failed,[3]);assert.equal(status.state,'partial');
 const before=f.control.calls.filter(c=>c.landscape).length;
 await f.json(`sessions/${id}/landscape`,'POST',{retryToken:status.retryToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
 assert.equal(f.control.calls.filter(c=>c.landscape).length-before,1,'only the damaged landscape is redrawn');
});

// ——— 审查意见：快照停滞、画风预设与横图比例 ———

test('a story with a saved snapshot keeps running when the current global provider is unavailable',async t=>{
 const f=await snapshotFixture(t,{current:()=>snapshotA,provider:()=>f.generation});
 f.generation.capture=()=>undefined;
 const id=await confirmedStory(f,4,{dag:{...emptyDag(),modelSnapshot:snapshotA}});
 for(let i=0;i<5;i++){f.app.services.production.wake();await turn();}
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(f.control.calls.length,4,'all four drawings ran on the saved provider');
});

test('a preset change without a new custom prompt drops the old custom art instructions',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 await f.app.services.database.prepare("UPDATE stories SET selection=json_set(selection,'$.artStyle','ink-pencil','$.artStylePrompt','自定义铅笔：粗线条、灰调') WHERE id=?").bind(id).run();
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{artStyle:'watercolor'}});
 const row=await f.app.services.database.prepare('SELECT selection FROM stories WHERE id=?').bind(child).first();
 const next=JSON.parse(row.selection);
 assert.equal(next.artStyle,'watercolor');
 assert.ok(!next.artStylePrompt,'the pencil prompt must not follow the watercolor preset');
 // 同时给出新的自定义说明时按给出的保存。
 const again=crypto.randomUUID(),fresh=await f.json(`sessions/${child}/revisions`);
 await f.json(`sessions/${child}/revisions`,'POST',{requestId:again,token:fresh.token,changes:{artStyle:'ink-pencil',artStylePrompt:'新的铅笔说明'}});
 assert.equal(JSON.parse((await f.app.services.database.prepare('SELECT selection FROM stories WHERE id=?').bind(again).first()).selection).artStylePrompt,'新的铅笔说明');
});

test('a square replacement is not accepted as part of a complete 3:2 landscape set',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id}=await completedStory(f);
 let status=await f.json(`sessions/${id}/landscape`);
 await f.json(`sessions/${id}/landscape`,'POST',{startToken:status.startToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
 status=await f.json(`sessions/${id}/landscape`);
 const {createCanvas}=await import('@napi-rs/canvas');
 await f.media.put(referenceImageKey(id,status.images[1]),createCanvas(64,64).toBuffer('image/png'),{contentType:'image/png'});
 status=await f.json(`sessions/${id}/landscape`);
 assert.deepEqual(status.failed,[2]);assert.equal(status.state,'partial');
});

test('saving an edited character setting or ending keeps the edit and redraws only what depends on it',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id,dag:before}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(snapshot.plan);
 const lines=plan.characters.split('\n');
 const [name]=lines[0].split('：');
 lines[0]=`${name}：改动后的人物设定，披着深色长袍。`;
 plan.characters=lines.join('\n');
 plan.reflection='改动后的余味。';
 plan.title='改动后的标题';
 const preview=await f.json(`sessions/${id}/revisions/preview`,'POST',{token:snapshot.token,changes:{plan}});
 assert.ok(preview.redraw>0,'the character edit redraws the frames that show that character');
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});
 const doc=await saved(f,child);
 assert.ok(doc.dag.characters[0].text.includes('深色长袍'));
 assert.equal(doc.plan.characters.split('\n')[0],lines[0]);
 assert.equal(doc.plan.reflection,'改动后的余味。');
 assert.equal(doc.plan.title,'改动后的标题');
 assert.equal(doc.dag.ending.confirmed.ending,'改动后的余味。');
 // 只有画过被改人物的画幅换了图片输入。
 assert.equal(doc.dag.continuation?.reason,'revision-saved','the dependent drawings and reviews wait for 继续制作');
 // 无法逐行对应的人物设定被拒绝，而不是静默丢弃。
 const bad=structuredClone(snapshot.plan);bad.characters='随便一行';
 const refused=await f.request(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:snapshot.token,changes:{plan:bad}});
 assert.equal(refused.status,400);
});

test('a transient read error while checking a paid image is not treated as a lost file, so it is never drawn twice',async t=>{
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 const {id,dag}=await completedStory(f);
 const url=dag.frames[dag.order[0]].image,job={session_id:id},dagProduction=f.app.services.production.dag;
 assert.equal(await dagProduction.paidFileLost(job,url),false,'a readable file is kept');
 const media=f.app.services.media,original=media.get.bind(media);
 media.get=async()=>{throw Error('controlled transient read error');};
 await assert.rejects(()=>dagProduction.paidFileLost(job,url),error=>error.status===503,'verification is retried later');
 media.get=async()=>null;
 assert.equal(await dagProduction.paidFileLost(job,url),true,'a file that is really gone is redrawn');
 media.get=original;
 assert.equal(f.control.calls.length,0,'nothing was drawn while checking');
});

test('landscape jobs that fail because the saved provider is unavailable show as failed with a retry, not as running',async t=>{
 let available=false;
 const f=await snapshotFixture(t,{current:()=>snapshotA,provider:()=>available?f.generation:null});
 const {id}=await completedStory(f);
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.dag.modelSnapshot',json(?)) WHERE id=?").bind(JSON.stringify(snapshotA),id).run();
 let status=await f.json(`sessions/${id}/landscape`);
 await f.json(`sessions/${id}/landscape`,'POST',{startToken:status.startToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state!=='running',20000);
 status=await f.json(`sessions/${id}/landscape`);
 assert.equal(status.state,'partial');
 assert.equal(status.failed.length,6,'every frame is listed as failed');
 assert.match(status.error,/快照服务不可用/);
 assert.ok(status.retryToken,'the reader can retry');
 assert.equal(f.control.calls.length,0,'nothing was drawn');
 // 服务恢复后重试，全部画完。
 available=true;
 await f.json(`sessions/${id}/landscape`,'POST',{retryToken:status.retryToken});
 await until(async()=>(await f.json(`sessions/${id}/landscape`)).state==='completed',20000);
 assert.equal(f.control.calls.filter(c=>c.landscape).length,6);
});

test('read-only mode starts no generation even when the story has a usable model snapshot',async t=>{
 // 当前设置为只读时快照服务没有当前快照；故事保存的快照仍可构造提供方，但任务不得派发。
 const f=await snapshotFixture(t,{current:()=>undefined,provider:()=>f.generation});
 const id=await confirmedStory(f,4,{dag:{...emptyDag(),modelSnapshot:snapshotA}});
 for(let i=0;i<15;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.dagCalls.length+f.control.calls.length,0,'no paid call was made');
 assert.notEqual((await f.read(id)).state,'completed');
});
