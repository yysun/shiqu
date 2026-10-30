// Verify that a lost image file is redrawn only on explicit retry, and that an open story's
// first image, current page and read-ahead are drawn first. Controlled providers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readdirSync} from 'node:fs';
import {rm,writeFile} from 'node:fs/promises';
import {productionFixture,until} from './fixtures/production.mjs';
const owner='docker-local-owner';
const production=f=>f.app.services.production;
const database=f=>f.app.services.database;
const jobs=(f,id)=>production(f).queue.jobs(id,owner);
const control=(f,id,action)=>f.json(`sessions/${id}/production-control`,'POST',{action});
const completed=(f,id)=>until(async()=>(await f.read(id)).state==='completed',15000);
const failed=(f,id)=>until(async()=>(await f.read(id)).state==='failed',15000);
const retry=(f,id)=>f.demand(id,crypto.randomUUID(),0,true);
const document=async(f,id)=>JSON.parse((await database(f).prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id).first()).document);
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
 const rows=(await database(f).prepare("SELECT session_id,payload FROM production_jobs WHERE kind='image' AND state='running'").all()).results;
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

for(const [name,outcome] of Object.entries(unreadable))test(`a ${name} file at publication asks first, then redraws only on explicit retry`,async t=>{
 const f=await productionFixture(t),id=await f.create(2);await until(()=>f.control.calls.length===1);
 loseFirstFile(f,0,outcome);
 f.control.hold=false;f.control.calls[0].resolve();await failed(f,id);
 const saved=await f.read(id);
 assert.match(saved.error,/重新绘制/);assert.equal(saved.retryMayCharge,true);assert.equal(saved.retryStage,'redraw');
 await settled(f);await f.demand(id,crypto.randomUUID(),0,false);await settled(f);
 assert.equal(f.control.calls.length,1,'Polling, ticks and a non-retry request never redraw');
 assert.equal((await f.read(id)).state,'failed');
 await retry(f,id);await completed(f,id);
 assert.equal(pageCalls(f,0),2);assert.equal(pageCalls(f,1),1);
 assert.equal((await document(f,id)).usage.filter(row=>row.step==='image:0').length,1);
});

for(const damage of ['missing','corrupt'])test(`a ${damage} first image fails the next page before paying, and retry redraws only it`,async t=>{
 const f=await singleWorker(t),id=await f.create(4);await until(()=>f.control.calls.length===1);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===2);
 const before=await document(f,id);
 const file=await artifact(f,id,0);
 if(damage==='missing')await rm(file);else await writeFile(file,'not an image');
 f.control.calls[1].resolve();await failed(f,id);
 const saved=await f.read(id);
 assert.equal(f.control.calls.length,2,'The later page fails before any provider call');
 assert.match(saved.error,/重新绘制/);assert.equal(saved.retryMayCharge,true);assert.equal(saved.retryStage,'redraw');
 f.control.hold=false;await retry(f,id);await completed(f,id);
 assert.deepEqual([0,1,2,3].map(page=>pageCalls(f,page)),[2,1,1,1],'Only the first image is redrawn');
 const after=await document(f,id);
 assert.notEqual(after.images[0],before.images[0]);assert.ok(after.images.every(Boolean));
});

test('a file that comes back before the retry is published without paying again',async t=>{
 const f=await productionFixture(t),id=await f.create(2);await until(()=>f.control.calls.length===1);
 const lost=loseFirstFile(f,0,unreadable.missing);
 f.control.hold=false;f.control.calls[0].resolve();await failed(f,id);
 lost.restore();await retry(f,id);await completed(f,id);
 assert.equal(pageCalls(f,0),1);
});

test('a read that throws stays transient: no charge warning and no redraw, even at retry',async t=>{
 const f=await productionFixture(t),id=await f.create(2),store=f.app.services.media,get=store.get.bind(store);
 await until(()=>f.control.calls.length===1);
 let mode='throw';
 store.get=async key=>{if(key.includes('/artifacts/0-')){if(mode==='throw')throw Error('controlled disk read failure');if(mode==='lost')return null;}return get(key);};
 f.control.hold=false;f.control.calls[0].resolve();await failed(f,id);
 const saved=await f.read(id);
 assert.equal(saved.retryMayCharge,false);assert.equal(saved.retryStage,'publication');
 // A marked job whose file can't be read at the retry must not pay either.
 mode='lost';await retry(f,id);await failed(f,id);assert.equal((await f.read(id)).retryStage,'redraw');
 mode='throw';await retry(f,id);await failed(f,id);assert.equal(pageCalls(f,0),1);
 mode='none';await retry(f,id);await completed(f,id);assert.equal(pageCalls(f,0),1);
});

test('mixed lost and transient failures warn about the charge',async t=>{
 const f=await productionFixture(t),id=await f.create(4),store=f.app.services.media,get=store.get.bind(store);
 await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 store.get=async key=>{if(key.includes('/artifacts/1-'))throw Error('controlled disk read failure');if(key.includes('/artifacts/2-'))return null;return get(key);};
 for(const call of f.control.calls.slice(1))call.resolve();await failed(f,id);
 await until(async()=>(await jobs(f,id)).filter(job=>job.state==='failed').length>=2);
 const saved=await f.read(id);
 assert.match(saved.error,/重新绘制/);assert.equal(saved.retryMayCharge,true);assert.equal(saved.retryStage,'redraw');
});

test('an open story draws its first image, current page and read-ahead ahead of other work',async t=>{
 const f=await singleWorker(t),other=await f.create(10);await until(()=>f.control.calls.length===1);
 const viewed=await f.create(10);await until(async()=>(await jobs(f,viewed)).some(job=>job.kind==='image'));
 await f.demand(viewed,crypto.randomUUID(),3);
 const order=await drawOrder(f,{[other]:'o',[viewed]:'v'},9);
 assert.deepEqual(order,['o0','v0','v3','v4','v5','v6','v7','v8','v9']);
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
 const viewed=await f.create(8);await until(async()=>(await jobs(f,viewed)).some(job=>job.kind==='image'));
 const viewer=crypto.randomUUID();await f.demand(viewed,viewer,5);
 const order=await drawOrder(f,{[other]:'o',[viewed]:'v'},4,async label=>{if(label==='v5'){await f.leave(viewed,viewer);await production(f).tick();}});
 assert.deepEqual(order.slice(0,3),['o0','v0','v5']);
 assert.equal(order[3].slice(1),'1','After closing, the lowest page number comes next');
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await completed(f,other);await completed(f,viewed);
});

test('without a reader, order stays by page across stories',async t=>{
 const f=await singleWorker(t),older=await f.create(5);await until(()=>f.control.calls.length===1);
 const newer=await f.create(5);await until(async()=>(await jobs(f,newer)).some(job=>job.kind==='image'));
 const order=await drawOrder(f,{[older]:'o',[newer]:'n'},3);
 assert.deepEqual(order.slice(0,2),['o0','n0'],"A new story's first page comes before an older story's second");
 assert.equal(order[2].slice(1),'1');
});

for(const state of ['failed','paused','stopped'])test(`a non-retry request against a ${state} story starts nothing`,async t=>{
 const f=await productionFixture(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 if(state==='failed'){f.control.calls[0].reject(Error('provider failure'));await failed(f,id);}
 else{await control(f,id,state==='paused'?'pause':'stop');f.control.calls[0].resolve();await until(()=>f.control.calls[0].done);}
 await settled(f);const before=f.control.calls.length;
 const session=await f.demand(id,crypto.randomUUID(),1,false);await settled(f);
 assert.equal(f.control.calls.length,before);
 if(state==='failed')assert.equal(session.state,'failed');else assert.equal(session.generationControl,state==='paused'?'paused':'stopped');
});

// Hold a viewed story's publication open with the other story waiting on a free worker.
async function heldPublication(t){
 const f=await productionFixture(t),other=await f.create(8);await until(()=>f.control.calls.length===1);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 const viewed=await f.create(8);await until(async()=>(await jobs(f,viewed)).some(job=>job.kind==='image'));
 const viewer=crypto.randomUUID();await f.demand(viewed,viewer,0);await production(f).tick();
 const store=f.app.services.media,get=store.get.bind(store);let release,entered=false;const gate=new Promise(resolve=>release=resolve);
 t.after(()=>release());
 store.get=async key=>{if(key.startsWith(`reader/${viewed}/artifacts/0-`)&&!entered){entered=true;await gate;}return get(key);};
 f.control.calls[1].resolve();await until(()=>f.control.calls.length===5);
 assert.deepEqual((await drawn(f,{[other]:'o',[viewed]:'v'})).includes('v0'),true,'The viewed story takes the first free worker');
 f.control.calls[4].resolve();await until(()=>entered);
 await production(f).tick();await production(f).tick();
 // A claim shows in the job row at once; its provider call only appears after asynchronous file reads.
 assert.equal((await drawn(f,{[other]:'o',[viewed]:'v'})).length,2,'Other work waits while the publication frees the next slot');
 return {f,other,viewed,viewer,release};
}
for(const [name,act] of [
 ['the reader leaving',({f,viewed,viewer})=>f.leave(viewed,viewer)],
 ['a pause',({f,viewed})=>control(f,viewed,'pause')],
 ['a failed job',({f,viewed})=>database(f).prepare("UPDATE production_jobs SET state='failed',error='failed' WHERE session_id=? AND kind='image' AND state='queued' AND json_extract(payload,'$.page')=7").bind(viewed).run()],
 ['a stuck publication ageing out',({f,viewed})=>database(f).prepare("UPDATE production_jobs SET updated_at=? WHERE session_id=? AND kind='image-publish' AND state='running'").bind(Date.now()-20000,viewed).run()],
])test(`${name} ends the hold on other stories`,async t=>{
 const held=await heldPublication(t);await act(held);
 await until(()=>held.f.control.calls.length===6,8000);
 assert.ok((await drawn(held.f,{[held.other]:'o',[held.viewed]:'v'})).some(label=>label.startsWith('o')));
 held.release();
});

test('a viewed first image still drawing leaves spare workers free for other stories',async t=>{
 const f=await productionFixture(t),other=await f.create(8);await until(()=>f.control.calls.length===1);
 f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 const viewed=await f.create(8);await until(async()=>(await jobs(f,viewed)).some(job=>job.kind==='image'));
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
