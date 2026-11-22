// Drive production REST, SQLite, queue and media with controlled providers and disposable stories.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {productionFixture,until,turn} from './fixtures/production.mjs';

const recover=(f,id,fault,requestId=crypto.randomUUID())=>f.json(`sessions/${id}/recover`,'POST',{requestId,faultId:fault.id});
async function lose(f,id,page){
 const image=(await f.read(id)).story.pages[page].image;
 await rm(path.join(f.dataDirectory,'media','reader',id,image.split(`/media/${id}/`)[1]));
 return f.json(`sessions/${id}/image-health`,'POST',{page,image});
}
test('renaming a running image preserves task identity and does not buy a duplicate anchor',async t=>{
 const f=await productionFixture(t),id=await f.create();await until(()=>f.control.calls.length===1);
 await f.json(`sessions/${id}/title`,'POST',{title:'只修改显示名'});
 f.control.hold=false;f.control.calls[0].resolve();await until(async()=>(await f.read(id)).state==='completed');
 assert.equal(f.control.calls.length,8);assert.equal(f.control.calls.filter(call=>call.page===0).length,1);
});
test('real failed work needs a current fault authorization; replay after another failure never spends again',async t=>{
 const f=await productionFixture(t),id=await f.create(3);await until(()=>f.control.calls.length===1);
 f.control.calls[0].reject(Error('controlled first failure'));await until(async()=>(await f.read(id)).state==='failed');
 const first=(await f.read(id)).faults[0],requestId=crypto.randomUUID();
 await f.json(`sessions/${id}/title`,'POST',{title:'失败后只改名'});await turn();assert.equal(f.control.calls.length,1);
 assert.equal((await f.request(`sessions/${id}/production`,'POST',{viewerId:crypto.randomUUID(),page:0,retry:true})).status,400);
 await recover(f,id,first,requestId);await until(()=>f.control.calls.length===2);
 f.control.calls[1].reject(Error('controlled second failure'));await until(async()=>(await f.read(id)).state==='failed');
 const second=(await f.read(id)).faults[0];assert.notEqual(second.id,first.id);
 const replay=await recover(f,id,first,requestId);assert.equal(replay.recoveryReceipt.status,'failed');await turn();assert.equal(f.control.calls.length,2);
 f.control.hold=false;await recover(f,id,second);await until(async()=>(await f.read(id)).state==='completed');
 assert.equal(f.control.calls.length,5);assert.deepEqual((await f.read(id)).faults,undefined);
});
test('two images lost after completion can recover separately without clearing or blocking the other fault',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(4);await until(async()=>(await f.read(id)).state==='completed');
 await lose(f,id,1);let session=await lose(f,id,2);
 assert.equal(session.state,'failed');assert.equal(session.faults.length,2);assert.equal(f.control.calls.length,4);
 const second=session.faults.find(fault=>fault.page===1);await recover(f,id,second);
 await until(async()=>{const s=await f.read(id);return s.state==='failed'&&s.faults?.length===1&&s.faults[0].page===2&&f.control.calls.length===5;});
 session=await f.read(id);
 await recover(f,id,session.faults[0]);await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,6);
});

test('restored files are reused by the image health check without inference, and a restored file never buys a redraw',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(3);await until(async()=>(await f.read(id)).state==='completed');
 const image=(await f.read(id)).story.pages[1].image,key=`reader/${id}/${image.split(`/media/${id}/`)[1]}`,asset=await f.media.get(key),bytes=new Uint8Array(await asset.arrayBuffer());
 let session=await lose(f,id,1);assert.equal(session.faults[0].page,1);assert.notEqual(session.state,'completed');
 await f.media.put(key,bytes,{contentType:asset.contentType});session=await f.json(`sessions/${id}/image-health`,'POST',{page:1,image});
 assert.equal(session.state,'completed');assert.equal(session.faults,undefined);assert.equal(f.control.calls.length,3);
 await lose(f,id,1);await f.media.put(key,bytes,{contentType:asset.contentType});await f.json(`sessions/${id}/image-health`,'POST',{page:1,image});await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,3);
 for(let i=0;i<10;i++){f.app.services.production.wake();await turn();}assert.equal(f.control.calls.length,3);
});
test('temporary storage errors and stale image reports cannot create redraw permission; truncated images do',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(2);await until(async()=>(await f.read(id)).state==='completed');
 const image=(await f.read(id)).story.pages[1].image,get=f.app.services.media.get.bind(f.app.services.media);f.app.services.media.get=async()=>{throw Error('temporary storage outage');};
 assert.equal((await f.request(`sessions/${id}/image-health`,'POST',{page:1,image})).status,503);assert.equal((await f.read(id)).state,'completed');f.app.services.media.get=get;
 assert.equal((await f.request(`sessions/${id}/image-health`,'POST',{page:1,image:image+'stale'})).status,409);
 const key=`reader/${id}/${image.split(`/media/${id}/`)[1]}`,asset=await get(key),bytes=new Uint8Array(await asset.arrayBuffer());await f.media.put(key,bytes.slice(0,24),{contentType:'image/png'});
 const session=await f.json(`sessions/${id}/image-health`,'POST',{page:1,image});assert.equal(session.state,'failed');assert.equal(session.faults[0].page,1);assert.equal(f.control.calls.length,2);
});
test('first-image loss preserves in-flight work, blocks new dependent calls and survives pause/restart',async t=>{
 const f=await productionFixture(t),id=await f.create(8);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 let s=await lose(f,id,0);assert.ok(s.faults.some(fault=>fault.page===0));
 for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).state==='failed');assert.equal(f.control.calls.length,4);
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});await f.restart();s=await f.read(id);assert.equal(s.generationControl,'paused');assert.equal(s.faults[0].page,0);
 assert.equal((await f.request(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:s.faults[0].id})).status,409);
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});await f.app.services.production.tick();assert.equal(f.control.calls.length,4);
 await recover(f,id,(await f.read(id)).faults[0]);await until(async()=>f.control.calls.length>=5);f.control.hold=false;for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).state==='completed',20000);assert.equal(f.control.calls.length,9);
});
test('independent recoveries can run together; first-image loss holds nonfirst redraws until the first is redrawn',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(4);await until(async()=>(await f.read(id)).state==='completed');
 await lose(f,id,1);let s=await lose(f,id,2);f.control.hold=true;const a=s.faults.find(f=>f.page===1),b=s.faults.find(f=>f.page===2);
 await Promise.all([recover(f,id,a),recover(f,id,b)]);await until(()=>f.control.calls.length===6);s=await f.read(id);assert.equal(s.state,'running');assert.equal(s.faults,undefined);
 f.control.hold=false;for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).state==='completed');
 await lose(f,id,0);s=await lose(f,id,1);const before=f.control.calls.length;
 await recover(f,id,s.faults.find(f=>f.page===1));for(let i=0;i<10;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.calls.length,before,'the second redraw waits for the first image');
 await recover(f,id,(await f.read(id)).faults.find(f=>f.page===0));await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,before+2);
});
test('control request replay cannot undo a later pause; concurrent fault grants spend only once across restart',async t=>{
 const f=await productionFixture(t),id=await f.create(2);await until(()=>f.control.calls.length===1);f.control.calls[0].reject(Error('controlled failure'));await until(async()=>(await f.read(id)).state==='failed');
 const requestId=crypto.randomUUID();await f.json(`sessions/${id}/production-control`,'POST',{requestId,action:'resume'});await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 await f.json(`sessions/${id}/production-control`,'POST',{requestId,action:'resume'});assert.equal((await f.read(id)).generationControl,'paused');assert.equal(f.control.calls.length,1);
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});const fault=(await f.read(id)).faults[0],grant=crypto.randomUUID();
 const results=await Promise.all([f.request(`sessions/${id}/recover`,'POST',{requestId:grant,faultId:fault.id}),f.request(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id})]);assert.deepEqual(results.map(r=>r.status).sort(),[202,409]);
 f.control.hold=false;await until(async()=>(await f.read(id)).state==='completed');await f.restart();const before=f.control.calls.length;
 if(results[0].ok)await recover(f,id,fault,grant);await f.app.services.production.tick();assert.equal(f.control.calls.length,before);
 await assert.rejects(f.app.services.production.recover('foreign',id,{requestId:grant,faultId:fault.id}),error=>error.status===404);
});

test('checking a restored anchor lets the held dependants proceed without a retry',async t=>{
 const f=await productionFixture(t),id=await f.create(8);await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 const image=(await f.read(id)).story.pages[0].image,key=`reader/${id}/${image.split(`/media/${id}/`)[1]}`,asset=await f.media.get(key),bytes=new Uint8Array(await asset.arrayBuffer());
 await lose(f,id,0);for(const call of f.control.calls)call.resolve();await until(async()=>(await f.read(id)).state==='failed');assert.equal(f.control.calls.length,4,'nothing new is drawn from a lost anchor');
 await f.media.put(key,bytes,{contentType:asset.contentType});f.control.hold=false;const checked=await f.json(`sessions/${id}/image-health`,'POST',{page:0,image});assert.equal(checked.faults,undefined);
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(f.control.calls.length,8,'the anchor is reused: only the remaining frames are drawn');assert.deepEqual((await f.app.services.production.queue.jobs(id,'docker-local-owner')).filter(j=>j.state==='failed'),[]);
});
test('restoring a file after a new ordinary redraw failure preserves its fault until an explicit free reuse',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(2);await until(async()=>(await f.read(id)).state==='completed');
 const image=(await f.read(id)).story.pages[1].image,key=`reader/${id}/${image.split(`/media/${id}/`)[1]}`,asset=await f.media.get(key),bytes=new Uint8Array(await asset.arrayBuffer());let s=await lose(f,id,1);f.control.hold=true;await recover(f,id,s.faults[0]);await until(()=>f.control.calls.length===3);f.control.calls[2].reject(Error('new ordinary redraw failure'));await until(async()=>(await f.read(id)).state==='failed');
 s=await f.read(id);assert.equal(s.faults.length,1);assert.equal(s.faults[0].page,1);
 await f.media.put(key,bytes,{contentType:asset.contentType});s=await f.json(`sessions/${id}/image-health`,'POST',{page:1,image});assert.equal(s.faults.length,1,'Checking a file does not acknowledge an ordinary model failure');const fault=s.faults[0];
 f.control.hold=false;await recover(f,id,fault);await until(async()=>(await f.read(id)).state==='completed');// 恢复后的显式重试沿用该幅现有记录，是否复用已恢复的文件见报告；这里只证明故障保持到读者确认、之后完成。
});

test('creation binds immutable parameters and request IDs cannot be reused across actions',async t=>{
 const f=await productionFixture(t),id=await f.create(2);const changed=await f.request('sessions','POST',{requestId:id,selection:{bookId:'zhuangzi',theme:'different',length:2}});assert.equal(changed.status,409);
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});assert.equal((await f.request(`sessions/${id}/production-control`,'POST',{requestId:id,action:'resume'})).status,409);
 const requestId=crypto.randomUUID();await f.json(`sessions/${id}/production-control`,'POST',{requestId,action:'pause'});
 assert.equal((await f.request('sessions','POST',{requestId,selection:{bookId:'zhuangzi',theme:'different',length:2}})).status,409);assert.equal((await f.json('sessions')).length,1);
});

for(const action of ['pause','stop','reader'])test(`healthy restored files complete locally with ${action} and no viewers`,async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(2);await until(async()=>(await f.read(id)).state==='completed');
 const image=(await f.read(id)).story.pages[1].image,key=`reader/${id}/${image.split(`/media/${id}/`)[1]}`,asset=await f.media.get(key),bytes=new Uint8Array(await asset.arrayBuffer());await lose(f,id,1);
 await f.json(`sessions/${id}/production-control`,'POST',{action});await f.media.put(key,bytes,{contentType:asset.contentType});const checked=await f.json(`sessions/${id}/image-health`,'POST',{page:1,image});assert.equal(checked.state,'completed');assert.equal(checked.generationControl,action==='pause'?'paused':action==='stop'?'stopped':'active');assert.equal(f.control.calls.length,2);
 const raw=await f.app.services.database.prepare('SELECT state FROM stories WHERE id=?').bind(id).first();assert.equal(raw.state,'completed');

 await f.restart();for(let i=0;i<10;i++){f.app.services.production.wake();await turn();}assert.equal((await f.read(id)).state,'completed');assert.equal(f.control.calls.length,2);
});
test('a display-title change while a drawing is saved cannot fail the already-paid image',async t=>{
 const f=await productionFixture(t),id=await f.create(2),database=f.app.services.database,prepare=database.prepare.bind(database);let renamed=false;
 database.prepare=sql=>{const statement=prepare(sql);if(!renamed&&sql.startsWith('UPDATE stories SET document=?,state=CASE')&&f.control.calls.length){const run=statement.run.bind(statement);statement.run=async()=>{renamed=true;await prepare("UPDATE stories SET selection=json_set(selection,'$.displayTitle','保存时改名') WHERE id=?").bind(id).run();return run();};}return statement;};
 f.control.hold=false;await until(async()=>(await f.read(id)).state==='completed');assert.equal(renamed,true);assert.equal(f.control.calls.length,2);assert.equal((await f.read(id)).story.title,'保存时改名');assert.equal((await f.read(id)).faults,undefined);
});

test('an uncertain reference read cannot reach a provider that has a separately readable media handle',async t=>{
 const f=await productionFixture(t),id=await f.create(8);await until(()=>f.control.calls.length===1);
 const get=f.media.get.bind(f.media);let blocked=true;
 f.media.get=async value=>{if(blocked&&value.startsWith(`reader/${id}/`)&&/\.(png|webp|jpe?g)$/.test(value))throw Error('temporarily cannot verify reference');return get(value);};
 f.control.calls[0].resolve();await until(async()=>(await f.read(id)).state==='failed');const s=await f.read(id);assert.equal(s.retryStage,'generation');assert.equal(f.control.calls.length,1,'Unknown upstream readability must stop before inference');
 blocked=false;f.media.get=get;f.control.hold=false;for(const fault of s.faults.filter(x=>x.state==='pending'))await recover(f,id,fault);await until(async()=>(await f.read(id)).state==='completed',20000);assert.equal(f.control.calls.length,8);
});
