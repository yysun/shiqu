// Probe the actual migration/queue/receipt path with isolated SQLite and controlled work.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {transaction} from '../server/database.ts';
import {ProductionQueue} from '../server/production-queue.ts';
import {authorizeRecovery,sessionFaults,commandReceipt} from '../server/reader-commands.ts';

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+name,'utf8'));t.after(()=>sqlite.close());
 const db={prepare(sql){const q=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return q.get(...args)||null;},async all(){return {results:q.all(...args)};},async run(){return {meta:{changes:Number(q.run(...args).changes)}};}};},transaction(body){return transaction(sqlite,body);}};
 let fail=true,calls=0;
 const queue=new ProductionQueue(db,{limits:{image:1},handlers:{image:{pool:'image',async run(){calls++;if(fail)throw Error('controlled failure');return {value:'image'};}}}});
 const spec={id:'work',sessionId:'story',ownerId:'owner',kind:'image',pool:'image',version:'v1',dependencies:[],payload:{page:2},priority:0};
 return {sqlite,db,queue,spec,get calls(){return calls;},succeed(){fail=false;}};
}
test('one durable recovery command cannot pay again after its response is lost and work fails again',async t=>{
 const f=fixture(t);await f.queue.enqueue(f.spec);await f.queue.pump();await f.queue.settle();
 const first=(await sessionFaults(f.db,'story','owner'))[0];assert.equal(first.state,'pending');assert.equal(f.calls,1);
 const command={ownerId:'owner',sessionId:'story',requestId:crypto.randomUUID(),faultId:first.id,jobs:['work'],resolutionJob:'work'};
 const accepted=await authorizeRecovery(f.db,command);assert.equal(accepted.status,'queued');
 assert.equal((await f.queue.job('work')).attempts,0);assert.equal((await sessionFaults(f.db,'story','owner'))[0].state,'recovering');
 await f.queue.pump();await f.queue.settle();assert.equal(f.calls,2);
 const second=(await sessionFaults(f.db,'story','owner'))[0];assert.notEqual(second.id,first.id);assert.equal(second.state,'pending');
 assert.equal((await authorizeRecovery(f.db,command)).status,'failed');
 await f.queue.pump();await f.queue.settle();assert.equal(f.calls,2);assert.equal((await f.queue.job('work')).state,'failed');
 f.succeed();await authorizeRecovery(f.db,{...command,requestId:crypto.randomUUID(),faultId:second.id});
 await f.queue.pump();await f.queue.settle();assert.equal(f.calls,3);assert.deepEqual(await sessionFaults(f.db,'story','owner'),[]);
 assert.equal((await commandReceipt(f.db,'owner',command.requestId)).status,'failed');
});
test('two different commands cannot claim the same failure, and mismatched replay is rejected',async t=>{
 const f=fixture(t);await f.queue.enqueue(f.spec);await f.queue.pump();await f.queue.settle();
 const fault=(await sessionFaults(f.db,'story','owner'))[0],body={ownerId:'owner',sessionId:'story',faultId:fault.id,jobs:['work'],resolutionJob:'work'};
 const ids=[crypto.randomUUID(),crypto.randomUUID()];
 const result=await Promise.allSettled(ids.map(requestId=>authorizeRecovery(f.db,{...body,requestId})));
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await f.queue.job('work')).attempts,0);
 const used=result.findIndex(r=>r.status==='fulfilled');
 await assert.rejects(authorizeRecovery(f.db,{...body,requestId:ids[used],redraw:true}),error=>error.status===409);
});

test('restarting an accepted recovery shares its three interrupted attempts; replay cannot reset the cap',async t=>{
 const f=fixture(t);await f.queue.enqueue(f.spec);await f.queue.pump();await f.queue.settle();const fault=(await sessionFaults(f.db,'story','owner'))[0];
 const command={ownerId:'owner',sessionId:'story',requestId:crypto.randomUUID(),faultId:fault.id,jobs:['work'],resolutionJob:'work'};await authorizeRecovery(f.db,command);
 const restarted=new ProductionQueue(f.db,{limits:{image:1},handlers:{image:{pool:'image',run:async()=>assert.fail('No new remote call in recovery audit')}},resumeInterrupted:async job=>job.attempts<3});
 for(let attempt=1;attempt<=3;attempt++){
  f.sqlite.prepare("UPDATE production_jobs SET state='running',attempts=?,lease_token='dead-runtime',lease_until=1 WHERE id='work'").run(attempt);
  await restarted.recoverExpired();const job=await restarted.job('work');assert.equal(job.attempts,attempt);assert.equal(job.state,attempt<3?'queued':'failed');
  await authorizeRecovery(f.db,command);assert.equal((await restarted.job('work')).attempts,attempt);
 }
 assert.equal((await commandReceipt(f.db,'owner',command.requestId)).status,'failed');assert.equal(f.calls,1);
});

test('cross-table request ID guards close the race after two connections have both read no receipt',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu-command-race-')),a=new DatabaseSync(path.join(directory,'test.sqlite'));
 for(const name of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())a.exec(readFileSync('drizzle/'+name,'utf8'));
 const b=new DatabaseSync(path.join(directory,'test.sqlite'));t.after(async()=>{a.close();b.close();await rm(directory,{recursive:true,force:true});});
 const requestId=crypto.randomUUID();assert.equal(a.prepare('SELECT 1 FROM reader_commands WHERE owner_id=? AND request_id=?').get('owner',requestId),undefined);assert.equal(b.prepare('SELECT 1 FROM stories WHERE user_id=? AND id=?').get('owner',requestId),undefined);
 a.prepare("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,created_at,updated_at) VALUES(?,'owner','story','control','fingerprint','{\"action\":\"pause\"}',1,1)").run(requestId);
 const insert=b.prepare("INSERT INTO stories(id,user_id,selection,document,state,created_at,updated_at) VALUES(?,'owner','{}','{}','idle','created','updated')");assert.throws(()=>insert.run(requestId),/reader_request_id_conflict/);
 const second=crypto.randomUUID();insert.run(second);assert.throws(()=>a.prepare("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,created_at,updated_at) VALUES(?,'owner','story','control','f','{}',1,1)").run(second),/reader_request_id_conflict/);
});
