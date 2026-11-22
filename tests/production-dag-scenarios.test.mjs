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
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.reviews.length,0);

 await f.restart();
 await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed',15000);

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
async function confirmedStory(f,length=4){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const doc={plan:null,images:[],audio:[],usage:[],original:zhuangzi,dag:emptyDag()};
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
 assert.equal(f.control.frameReviews.length,1,'one frame-count check');
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
 assert.equal(f.control.frameReviews.length,1,'the frame-count check re-runs because the order changed');
 assert.equal(f.control.reviews.length,1);
 // 标题与结语候选绑定画幅身份序列，顺序改变后重新拟定；其余文字调用为零。
 assert.equal(f.control.reflections.length,1);
 assert.equal(textCalls(f.control)-f.control.frameReviews.length-f.control.reflections.length,0);
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
 await until(async()=>(await f.read(id)).faults?.length>0&&f.control.reflections.length===1&&f.control.frameReviews.length===1,20000);
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
