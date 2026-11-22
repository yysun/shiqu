// Verify that a lost image file is redrawn only on explicit retry, and that an open story's
// first image, current page and read-ahead are drawn first. Controlled providers only.
// 走制作 DAG：绘图任务为 dag-draw，保存前核对图片可读，丢失或损坏记为本幅的故障，读者明确恢复才重绘。
// 旧流水线的发布步骤（image-publish）、发布回执与「文件回来后免费发布」随旧流程删除，阅读优先的次序用 viewedPriority 推导。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readdirSync} from 'node:fs';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {productionFixture,until} from './fixtures/production.mjs';
import {runStoryGeneration} from '../lib/reader-generation.ts';
const owner='docker-local-owner';
const production=f=>f.app.services.production;
const database=f=>f.app.services.database;
const jobs=(f,id)=>production(f).queue.jobs(id,owner);
const control=(f,id,action)=>f.json(`sessions/${id}/production-control`,'POST',{action});
const completed=(f,id)=>until(async()=>(await f.read(id)).state==='completed',15000);
const failed=(f,id)=>until(async()=>(await f.read(id)).faults?.some(x=>x.state==='pending'),15000);
const fault=async(f,id)=>(await f.read(id)).faults.find(x=>x.state==='pending');
const retry=(f,id)=>f.demand(id,crypto.randomUUID(),0,true);
const document=async(f,id)=>JSON.parse((await database(f).prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);
const pageCalls=(f,page)=>f.control.calls.filter(call=>call.page===page).length;
const settled=async f=>{for(let n=0;n<3;n++){await production(f).tick();await production(f).queue.settle();}};
const artifact=async(f,id,page)=>path.join(f.dataDirectory,'media/reader',id,'artifacts',readdirSync(path.join(f.dataDirectory,'media/reader',id,'artifacts')).find(name=>name.startsWith(page+'-')));
const unreadable={missing:()=>null,corrupt:()=>({body:new Uint8Array([1,2,3]),contentType:'image/png',async arrayBuffer(){return new Uint8Array([1,2,3]).buffer;}})};
// Make the first file publication reads for a page look lost, while later attempts stay readable.
function loseFirstFile(f,page,outcome){
 const store=f.app.services.media,get=store.get.bind(store);let lost=null,active=true;
 store.get=async key=>{if(active&&key.includes(`/artifacts/${page}-`)&&(lost===null||lost===key)){lost=key;return outcome();}return get(key);};
 return {restore(){active=false;}};
}
const drawn=async(f,labels)=>{
 const rows=(await database(f).prepare("SELECT session_id,payload FROM production_jobs WHERE kind='dag-draw' AND state='running'").all()).results;
 return rows.map(row=>labels[row.session_id]+JSON.parse(row.payload).page).sort();
};
// With one worker, finish each draw and record what the queue chose next.
async function drawOrder(f,labels,count,afterEach=async()=>{}){
 const order=[];
 for(let n=0;n<count;n++){
  await until(()=>f.control.calls.filter(call=>!call.done).length===1);
  const [label]=await drawn(f,labels);order.push(label);
  await afterEach(label);
  const call=f.control.calls.find(call=>!call.done);call.resolve();await until(()=>call.done);
 }
 return order;
}
const singleWorker=t=>productionFixture(t,'codex',{SHIQU_IMAGE_WORKERS:'1'});


for(const [name,outcome] of Object.entries(unreadable))test(`a ${name} file after drawing asks first, then redraws only on explicit retry`,async t=>{
 const f=await productionFixture(t),id=await f.create(2);await until(()=>f.control.calls.length===1);
 const lost=loseFirstFile(f,0,outcome);
 f.control.hold=false;f.control.calls[0].resolve();await failed(f,id);lost.restore();
 const saved=await f.read(id);
 assert.notEqual(saved.state,'completed');assert.match((await fault(f,id)).message,/重试本幅/);
 await settled(f);await f.demand(id,crypto.randomUUID(),0,false);await settled(f);
 assert.equal(f.control.calls.length,1,'Polling, ticks and a non-retry request never redraw');
 await retry(f,id);await completed(f,id);
 assert.equal(pageCalls(f,0),2);assert.equal(pageCalls(f,1),1);
});

test('an invalid saved image address is treated as lost, and redraws only on explicit retry',async t=>{
 const f=await productionFixture(t),id=await f.create(2),real=f.generation.generator.bind(f.generation);
 let broken=true;
 f.generation.generator=()=>{const generator=real();return {...generator,async image(...args){const result=await generator.image(...args);if(!broken)return result;broken=false;return {...result,value:'/api/reader/media/elsewhere/0.png'};}};};
 await until(()=>f.control.calls.length===1);
 f.control.hold=false;f.control.calls[0].resolve();await failed(f,id);
 await settled(f);assert.equal(f.control.calls.length,1);
 await retry(f,id);await completed(f,id);assert.equal(pageCalls(f,0),2);
});

test('saving requires the bytes to match the file type; a reference only needs a usable image',async t=>{
 const jpeg=new Uint8Array(await readFile('tests/fixtures/images/portrait.jpg'));
 const f=await singleWorker(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 loseFirstFile(f,0,()=>({body:jpeg,contentType:'image/png',async arrayBuffer(){return jpeg.slice().buffer;}}));
 f.control.calls[0].resolve();await failed(f,id);
 const second=await f.create(3);await until(()=>f.control.calls.length===2);
 f.control.calls[1].resolve();await until(()=>f.control.calls.length===3);
 // A legacy reference whose extension doesn't match its bytes works with providers today.
 await writeFile(await artifact(f,second,0),jpeg);
 f.control.calls[2].resolve();await until(()=>f.control.calls.length===4);
 assert.ok(!(await f.read(second)).faults?.length);
});

test('an open story draws its first image, current page and read-ahead ahead of other work',async t=>{
 const f=await singleWorker(t),other=await f.create(10);await until(()=>f.control.calls.length===1);
 const viewed=await f.create(10);await until(async()=>(await jobs(f,viewed)).some(job=>job.kind==='dag-draw'));
 await f.demand(viewed,crypto.randomUUID(),3);
 const order=await drawOrder(f,{[other]:'o',[viewed]:'v'},6);
 assert.deepEqual(order.slice(0,4),['o0','v0','v3','v4']);
 assert.ok(order.slice(2).filter(label=>label[0]==='v').every(label=>Number(label.slice(1))>=3),'the viewed story draws from the current page on');
});

test("a viewed first image goes ahead of an older story's waiting first image",async t=>{
 const f=await singleWorker(t),busy=await f.create(3);await until(()=>f.control.calls.length===1);
 const older=await f.create(3);await until(async()=>(await jobs(f,older)).some(job=>job.kind==='dag-draw'));
 const viewed=await f.create(3);await until(async()=>(await jobs(f,viewed)).some(job=>job.kind==='dag-draw'));
 await f.demand(viewed,crypto.randomUUID(),1);
 assert.deepEqual(await drawOrder(f,{[busy]:'b',[older]:'o',[viewed]:'v'},2),['b0','v0']);
});

test('moving to another page changes what comes next without cancelling the running page',async t=>{
 const f=await singleWorker(t),id=await f.create(12);await until(()=>f.control.calls.length===1);
 const viewer=crypto.randomUUID();await f.demand(id,viewer,3);
 const order=await drawOrder(f,{[id]:'p'},4,async label=>{if(label==='p3'){await f.demand(id,viewer,8);await production(f).tick();}});
 assert.deepEqual(order,['p0','p3','p8','p9']);
 assert.equal(f.control.calls.filter(call=>call.done).length,4);
});

test('closing the story returns it to page order, and it keeps generating',async t=>{
 const f=await singleWorker(t),other=await f.create(8);await until(()=>f.control.calls.length===1);
 const viewed=await f.create(8);await until(async()=>(await jobs(f,viewed)).some(job=>job.kind==='dag-draw'));
 const viewer=crypto.randomUUID();await f.demand(viewed,viewer,5);
 const order=await drawOrder(f,{[other]:'o',[viewed]:'v'},4,async label=>{if(label==='v5'){await f.leave(viewed,viewer);await production(f).tick();}});
 assert.deepEqual(order.slice(0,3),['o0','v0','v5']);
 assert.equal(order[3].slice(1),'1','After closing, the lowest page number comes next');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await completed(f,other);await completed(f,viewed);
});

test('without a reader, order stays by page across stories',async t=>{
 const f=await singleWorker(t),older=await f.create(5);await until(()=>f.control.calls.length===1);
 const newer=await f.create(5);await until(async()=>(await jobs(f,newer)).some(job=>job.kind==='dag-draw'));
 const order=await drawOrder(f,{[older]:'o',[newer]:'n'},3);
 assert.deepEqual(order.slice(0,2),['o0','n0'],"A new story's first page comes before an older story's second");
 assert.equal(order[2].slice(1),'1');
});

test('the legacy client never retries a lost image automatically',async()=>{
 const lost={id:'story',state:'failed',retryStage:'redraw',retryAllowed:true,error:'这幅图片的文件已丢失或损坏。',stage:'drawing',ready:0,selection:{length:2},story:null};
 let posts=0;
 const result=await runStoryGeneration({sessionId:'story',throughPage:1,retries:new Map(),isActive:()=>true,onSession:()=>{},sleep:async()=>{},request:async(path,method)=>{if(method==='POST')posts++;return lost;}});
 assert.match(result,/已丢失/);assert.equal(posts,0);
});

for(const state of ['failed','paused','stopped'])test(`a non-retry request against a ${state} story starts nothing`,async t=>{
 const f=await productionFixture(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 if(state==='failed'){f.control.calls[0].reject(Error('provider failure'));await failed(f,id);}
 else{await control(f,id,state==='paused'?'pause':'stop');f.control.calls[0].resolve();await until(()=>f.control.calls[0].done);}
 await settled(f);const before=f.control.calls.length;
 const session=await f.demand(id,crypto.randomUUID(),1,false);await settled(f);
 assert.equal(f.control.calls.length,before);
 if(state==='failed')assert.ok(session.faults.some(x=>x.state==='pending'));else assert.equal(session.generationControl,state==='paused'?'paused':'stopped');
});

test('a viewed first image still drawing leaves spare workers free for other stories',async t=>{
 const f=await productionFixture(t),other=await f.create(8);await until(()=>f.control.calls.length===1);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 const viewed=await f.create(8);await until(async()=>(await jobs(f,viewed)).some(job=>job.kind==='dag-draw'));
 await f.demand(viewed,crypto.randomUUID(),0);await production(f).tick();
 f.control.calls[1].resolve();await until(()=>f.control.calls.length===5);
 f.control.calls[2].resolve();await until(()=>f.control.calls.length===6,8000);
 const labels=await drawn(f,{[other]:'o',[viewed]:'v'});
 assert.ok(labels.includes('v0'));assert.equal(labels.filter(label=>label.startsWith('o')).length,2);
});

test('two viewed stories both finish',async t=>{
 const f=await singleWorker(t),a=await f.create(4),b=await f.create(4);f.control.hold=false;
 await f.demand(a,crypto.randomUUID(),0);await f.demand(b,crypto.randomUUID(),0);
 await completed(f,a);await completed(f,b);assert.equal(f.control.calls.length,8);
});
