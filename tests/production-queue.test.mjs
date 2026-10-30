// Exercise generic dependency/pool/recovery contracts, including future voice and video work.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {ProductionQueue,inputVersion,productionJobId} from '../server/production-queue.ts';
import {until,turn} from './fixtures/production.mjs';
function database(t){
 const db=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+name,'utf8'));t.after(()=>db.close());
 return {db,adapter:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}}};
}
const spec=(kind,pool,dependencies=[],version='v1',key='')=>({id:productionJobId('story',kind,version,key),sessionId:'story',ownerId:'owner',kind,pool,version,dependencies,payload:{key},priority:0});
test('voice/images branch after script; motion/processing feed video; assembly retry reuses every artifact',async t=>{
 const {adapter}=database(t),calls=[],gates=new Map();let failVideo=true;
 const run=kind=>async(job,{outputs})=>{calls.push(kind);assert.equal(Object.keys(outputs).length,JSON.parse(job.dependencies).length);if(gates.has(kind))await gates.get(kind).promise;if(kind==='video'&&failVideo)throw Error('controlled export failure');return {asset:`${kind}.asset`};};
 for(const kind of ['image','voice']){let resolve;const promise=new Promise(r=>resolve=r);gates.set(kind,{promise,resolve});}
 const queue=new ProductionQueue(adapter,{limits:{text:1,image:1,voice:1,local:2,video:1},handlers:{script:{pool:'text',run:run('script')},image:{pool:'image',run:run('image')},voice:{pool:'voice',run:run('voice')},processing:{pool:'local',run:run('processing')},motion:{pool:'video',run:run('motion')},video:{pool:'video',run:run('video')}}});
 const script=spec('script','text'),image=spec('image','image',[script.id]),voice=spec('voice','voice',[script.id]),processing=spec('processing','local',[image.id]),motion=spec('motion','video',[processing.id]),video=spec('video','video',[motion.id,voice.id]);
 for(const job of [video,motion,processing,voice,image,script])await queue.enqueue(job);
 await queue.pump();await queue.settle();assert.deepEqual(calls,['script']);
 await queue.pump();await until(()=>calls.includes('image')&&calls.includes('voice'));assert.equal(calls.includes('video'),false);
 gates.get('image').resolve();await until(async()=>(await queue.job(image.id)).state==='succeeded');await queue.pump();
 await until(async()=>(await queue.job(processing.id)).state==='succeeded');await queue.pump();await until(async()=>(await queue.job(motion.id)).state==='succeeded');assert.equal(calls.includes('video'),false);
 gates.get('voice').resolve();await queue.settle();await queue.pump();await queue.settle();assert.equal((await queue.job(video.id)).state,'failed');
 failVideo=false;await queue.retry('story','owner');await queue.pump();await queue.settle();assert.equal((await queue.job(video.id)).state,'succeeded');
 assert.deepEqual(calls.filter(k=>k!=='video').sort(),['image','motion','processing','script','voice']);assert.equal(calls.filter(k=>k==='video').length,2);
 assert.equal(productionJobId('story','image','v1'),productionJobId('story','image','v1'));assert.notEqual(productionJobId('story','image','v1'),productionJobId('story','image','v2'));assert.notEqual(inputVersion({caption:'a'}),inputVersion({caption:'b'}));
});
test('two schedulers share the SQL pool cap and never claim the same paid job',async t=>{
 const {adapter}=database(t),calls=[],releases=[];
 const options={limits:{image:2},handlers:{image:{pool:'image',run:async job=>{calls.push(job.id);await new Promise(resolve=>releases.push(resolve));return {image:job.id};}}}};
 const a=new ProductionQueue(adapter,options),b=new ProductionQueue(adapter,options);
 for(let i=0;i<6;i++)await a.enqueue(spec('image','image',[],'v1',String(i)));
 await Promise.all([a.pump(),b.pump()]);await until(()=>calls.length===2);await turn();assert.equal(calls.length,2);assert.equal(new Set(calls).size,2);
 releases.splice(0).forEach(resolve=>resolve());await Promise.all([a.settle(),b.settle()]);await Promise.all([a.pump(),b.pump()]);await until(()=>calls.length===4);
 a.stop();b.stop();releases.splice(0).forEach(resolve=>resolve());await Promise.all([a.settle(),b.settle()]);assert.equal(new Set(calls).size,4);
});
test('leases renew only their own token; stale completion cannot overwrite a replacement result',async t=>{
 const {adapter,db}=database(t);let now=100,release;const hold=new Promise(resolve=>release=resolve);
 const job=spec('image','image'),queue=new ProductionQueue(adapter,{limits:{image:1},now:()=>now,leaseMs:100,handlers:{image:{pool:'image',run:async()=>{await hold;return {asset:'stale'};}}}});
 await queue.enqueue(job);await queue.pump();await turn();now=150;await queue.renew();assert.equal((await queue.job(job.id)).lease_until,250);
 db.prepare("UPDATE production_jobs SET lease_token='replacement',lease_until=240 WHERE id=?").run(job.id);now=160;await queue.renew();assert.equal((await queue.job(job.id)).lease_until,240);
 db.prepare("UPDATE production_jobs SET state='succeeded',result='\"new\"' WHERE id=?").run(job.id);release();await queue.settle();assert.equal((await queue.job(job.id)).result,'"new"');
});
test('expired work fails explicitly; enqueue and pump never silently replay it; retry is owner scoped',async t=>{
 const {adapter,db}=database(t);let calls=0;
 const queue=new ProductionQueue(adapter,{limits:{image:1},handlers:{image:{pool:'image',run:async()=>{calls++;return 'saved';}}}}),job=spec('image','image');
 await queue.enqueue(job);db.prepare("UPDATE production_jobs SET state='running',lease_token='dead',lease_until=1 WHERE id=?").run(job.id);
 await queue.recoverExpired();await queue.enqueue(job);await queue.pump();assert.equal(calls,0);assert.equal((await queue.job(job.id)).state,'failed');
 await queue.retry('story','someone-else');await queue.pump();assert.equal(calls,0);await queue.retry('story','owner');await queue.pump();await queue.settle();assert.equal(calls,1);
});

test('a live attempt survives a clock jump; a second scheduler that recovers it fences the late result',async t=>{
 const {adapter}=database(t);let now=100,release;const hold=new Promise(resolve=>release=resolve),job=spec('image','image');
 const run=async()=>{await hold;return {asset:'late'};},options={limits:{image:1},now:()=>now,leaseMs:100,resumeInterrupted:async()=>true,handlers:{image:{pool:'image',run}}};
 const live=new ProductionQueue(adapter,options),other=new ProductionQueue(adapter,options);
 await live.enqueue(job);await live.pump();await turn();const {lease_token:token}=await live.job(job.id);
 now=10000;await live.recoverExpired();assert.equal((await live.job(job.id)).state,'running','This process still owns its attempt');
 await live.renew();assert.equal((await live.job(job.id)).lease_until,10100);assert.equal((await live.job(job.id)).lease_token,token);
 now=20000;await other.recoverExpired();assert.equal((await live.job(job.id)).state,'queued','Another service cannot tell a sleeper from a dead one');
 await live.renew();assert.equal((await live.job(job.id)).lease_until,0,'A recovered claim cannot be renewed');
 release();await live.settle();const late=await live.job(job.id);assert.equal(late.state,'queued');assert.equal(late.result,null,'The late result is fenced out');
});
test('a stop-time failure is an interruption unless the handler says it is terminal or it drains',async t=>{
 const {adapter}=database(t);const fail={};
 const handler=pool=>({pool,run:async()=>{await new Promise(resolve=>fail[pool]=resolve);throw Error(pool);}});
 const queue=new ProductionQueue(adapter,{limits:{a:1,b:1,c:1},terminal:error=>error.message==='b',handlers:{a:handler('a'),b:handler('b'),c:{...handler('c'),drain:true}}});
 const jobs=['a','b','c'].map(kind=>spec(kind,kind));for(const job of jobs)await queue.enqueue(job);await queue.pump();await until(()=>fail.a&&fail.b&&fail.c);
 queue.stop();Object.values(fail).forEach(resolve=>resolve());await queue.settle();
 assert.deepEqual(await Promise.all(jobs.map(async job=>(await queue.job(job.id)).interrupted)),[1,0,0]);
 assert.deepEqual(await Promise.all(jobs.map(async job=>(await queue.job(job.id)).state)),['failed','failed','failed']);
});
test('a claim released before its handler starts does not count as an attempt',async t=>{
 const {adapter}=database(t);let allowed=[true,false],calls=0;const job=spec('image','image');
 const queue=new ProductionQueue(adapter,{limits:{image:1},canRun:async()=>allowed.length?allowed.shift():true,handlers:{image:{pool:'image',run:async()=>{calls++;return 'saved';}}}});
 await queue.enqueue(job);await queue.pump();await queue.settle();
 const released=await queue.job(job.id);assert.equal(released.state,'queued');assert.equal(released.attempts,0);assert.equal(calls,0);
 await queue.pump();await queue.settle();const done=await queue.job(job.id);assert.equal(done.state,'succeeded');assert.equal(done.attempts,1);assert.equal(calls,1);
});
