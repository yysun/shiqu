// 制作调度的加固保证（隔离 SQLite、受控提供方，走正式协调器与制作 DAG）：
// 旧版本的各个开工入口一律拒绝；孤立任务只记录一次并不影响其他任务；暂停、失败、被取代、已删除的故事不派发；
// 节拍的 SQL 语句数有上限且无变化时不重复写入；清理只作废上一世代的准备任务并只清过期的读者需求；
// 删除故事后未开始的制作不再付费；书架精简不改变打开的故事。
// 旧流水线的发布步骤、步骤键、检查点回执与旧版修订分叉规则已随旧流程删除，其覆盖由 production-dag-* 测试承担。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,makePlan,selection,until,turn} from './fixtures/production.mjs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {shelfView} from '../lib/reader-api.ts';
import {emptyDag} from '../lib/production-dag/document.ts';
const original={title:'庄周梦蝶',text:'庄周梦为胡蝶。',url:'https://example.com',kind:'passage',provider:'fixture',retrievedAt:new Date().toISOString()};
async function seeded(t,plan=makePlan(8)){
 const f=await productionFixture(t);f.app.stopGeneration();await f.app.services.production.close();
 const repo=new ReaderRepository(f.app.services.database),id=crypto.randomUUID();
 await repo.create(id,f.app.services.ownerId,selection);
 await repo.db.prepare("UPDATE stories SET document=?,generation_control='paused' WHERE id=?").bind(JSON.stringify({plan,original,images:[],audio:[],usage:[]}),id).run();
 return {f,repo,id,owner:f.app.services.ownerId};
}
/** 新的协调器：关闭定时节拍，由测试逐拍驱动。 */
async function coordinatorFor(f,repo,pump=false){
 const {ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});
 if(pump)coordinator.queue.pump=async()=>{};
 f.coordinators.push(coordinator);return coordinator;
}
/** 给故事发布一个更新版本（子版本），使其成为旧版本。 */
async function supersede(repo,id,owner){
 const child=crypto.randomUUID();await repo.create(child,owner,selection);
 await repo.db.prepare('UPDATE stories SET document=? WHERE id=?').bind(JSON.stringify({revision:{rootId:id,number:2}}),child).run();
 return child;
}
const dagJob=(sessionId,owner,id,kind='dag')=>({id,sessionId,ownerId:owner,kind,pool:kind==='dag'?'text':'image',version:'dag',dependencies:[],payload:{work:{call:kind==='dag'?'brief':'drawFrame',instances:[]},page:0},priority:0});

test('derived eligibility includes deleted children and ignores corrupt unrelated rows',async t=>{
 const {repo,id,owner}=await seeded(t);
 const child=crypto.randomUUID();await repo.create(child,owner,selection);
 await repo.db.prepare("UPDATE stories SET document=?,generation_control='active' WHERE id=?").bind(JSON.stringify({revision:{rootId:id,number:2}}),child).run();
 await repo.db.prepare("UPDATE stories SET generation_control='active' WHERE id=?").bind(id).run();
 const corrupt=crypto.randomUUID();await repo.create(corrupt,owner,selection);
 await repo.db.prepare("UPDATE stories SET document='invalid' WHERE id=?").bind(corrupt).run();
 assert.equal(await repo.superseded(id,owner),true);
 assert.equal(await repo.acquire(await repo.get(id,owner),{key:'plan'}),null);
 await repo.remove(child,owner);
 assert.equal(await repo.superseded(id,owner),true);
 await assert.rejects(repo.control(id,owner,'resume'),error=>error.status===409);
 assert.equal((await repo.list(owner)).some(row=>row.id===id),false);
});

for(const action of ['resume','background'])test(`${action} control on an old version is refused and changes nothing`,async t=>{
 const {f,repo,id,owner}=await seeded(t);
 f.app.services.production=await coordinatorFor(f,repo,true);
 await supersede(repo,id,owner);
 const before=await repo.get(id,owner);
 const response=await f.request(`sessions/${id}/production-control`,'POST',{action});
 assert.equal(response.status,409);
 assert.match((await response.json()).error,/最新版本|版本已更新/);
 assert.deepEqual(await repo.get(id,owner),before);
 assert.equal(f.control.calls.length+f.control.dagCalls.length,0);
});

test('every old-version start point refuses without changing attempts or documents',async t=>{
 const {f,repo,id,owner}=await seeded(t);
 await repo.db.prepare("UPDATE stories SET generation_control='active' WHERE id=?").bind(id).run();
 await supersede(repo,id,owner);
 const coordinator=f.app.services.production=await coordinatorFor(f,repo);
 for(const [kind,pool] of [['prepare','text'],['dag','text'],['dag-draw','image']]){
  const job={session_id:id,owner_id:owner,kind,pool,payload:JSON.stringify({work:{call:'brief',instances:[]},page:0}),attempts:0};
  assert.equal(await coordinator.canRun(job),false,kind);
  assert.equal(await coordinator.resumeInterrupted(job),false,kind);
 }
 const snap=await coordinator.request(owner,id,'viewer',0,true);
 assert.equal(snap.superseded,true);assert.equal(snap.productionState,'paused');
 assert.equal(await repo.db.prepare('SELECT * FROM production_demand WHERE session_id=?').bind(id).first(),null);
 assert.deepEqual(await coordinator.demands(id),[]);
 await assert.rejects(coordinator.overrideReview(owner,id,{requestId:crypto.randomUUID(),faultId:'none'}),error=>error.status===409);
 assert.equal((await f.request(`sessions/${id}/advance`,'POST',{throughPage:0})).status,200);
 assert.equal(f.control.dagCalls.length+f.control.calls.length,0);
});

test('ready orphaned jobs in all four pools are contained and logged once while a valid job runs',async t=>{
 const {f,repo,id,owner}=await seeded(t),coordinator=await coordinatorFor(f,repo);
 const logged=[],error=console.error;console.error=(...args)=>logged.push(args);t.after(()=>{console.error=error;});
 let valid=0;coordinator.queue.options.handlers.prepare.run=async()=>{valid++;return {};};
 for(const [kind,pool] of [['prepare','text'],['discover','search'],['dag','text'],['dag-draw','image']]){
  await coordinator.queue.enqueue({id:`orphan-${kind}`,sessionId:'missing',ownerId:owner,kind,pool,version:'v',dependencies:[],payload:{work:{call:'brief',instances:[]}},priority:-100});
 }
 await repo.db.prepare("UPDATE stories SET generation_control='active',generation_mode='background' WHERE id=?").bind(id).run();
 await coordinator.queue.enqueue({id:'valid',sessionId:id,ownerId:owner,kind:'prepare',pool:'text',version:'v',dependencies:[],payload:{},priority:100});
 await coordinator.queue.pump();await coordinator.queue.settle();await coordinator.queue.pump();
 assert.equal(valid,1);assert.equal(logged.filter(args=>args[0]==='production_job_unreadable').length,4);
 for(const kind of ['prepare','discover','dag','dag-draw'])assert.equal((await coordinator.queue.job(`orphan-${kind}`)).attempts,0);
});

test('SQL candidates exclude paused, superseded and deleted work; a failed story still runs its DAG jobs, not preparation',async t=>{
 const {f,repo,id,owner}=await seeded(t),coordinator=await coordinatorFor(f,repo);
 coordinator.pruneSuperseded=async()=>{};coordinator.graph=async()=>{};
 const ids=[id];
 for(let i=0;i<3;i++){const other=crypto.randomUUID();await repo.create(other,owner,selection);ids.push(other);}
 await repo.db.prepare("UPDATE stories SET generation_mode='reader',generation_control='active' WHERE id=?").bind(ids[1]).run();
 await repo.remove(ids[1],owner);
 await repo.db.prepare("UPDATE stories SET state='failed' WHERE id=?").bind(ids[2]).run();
 await supersede(repo,ids[3],owner);
 const calls=[];coordinator.queue.options.canRun=async job=>{calls.push(job.id);return false;};
 const kinds=[['prepare','text'],['dag','text'],['dag-draw','image'],['discover','search']];
 for(const sessionId of [...ids,'orphan'])for(const [kind,pool] of kinds)await coordinator.queue.enqueue({id:`${sessionId}-${kind}`,sessionId,ownerId:owner,kind,pool,version:'v',dependencies:[],payload:{},priority:0});
 await coordinator.tick();
 for(const sessionId of [ids[0],ids[1],ids[3]])for(const [kind] of kinds)assert.equal(calls.includes(`${sessionId}-${kind}`),false,`${sessionId}-${kind}`);
 assert.equal(calls.includes(`${ids[2]}-prepare`),false,'a failed story waits for recovery before preparing again');
 for(const kind of ['dag','dag-draw'])assert.ok(calls.includes(`${ids[2]}-${kind}`),'DAG faults block only dependants, not the queue');
 assert.ok(calls.includes('orphan-prepare'));assert.equal(f.control.calls.length+f.control.dagCalls.length,0);
 assert.ok((await coordinator.queue.jobs(ids[1],owner)).every(job=>job.attempts===0));
});

test('warm paused pass uses at most 60 statements; unchanged active state and viewer renewals perform no upserts',async t=>{
 const {f,repo,id,owner}=await seeded(t),coordinator=await coordinatorFor(f,repo,true);
 const prepare=repo.db.prepare.bind(repo.db);let statements=0,upserts=0;
 repo.db.prepare=sql=>{statements++;if(sql.includes('INSERT INTO production_jobs'))upserts++;return prepare(sql);};
 t.after(()=>{repo.db.prepare=prepare;});
 const ids=[id];
 for(let i=1;i<20;i++){const next=crypto.randomUUID();await repo.create(next,owner,{...selection,length:80});ids.push(next);}
 // 已确认、尚未制作的 DAG 故事：节拍先采用并安排工作，之后状态不变时不再写入。
 for(const next of ids)await repo.db.prepare("UPDATE stories SET document=?,selection=?,generation_mode='background',generation_control='paused' WHERE id=?")
  .bind(JSON.stringify({plan:null,original,images:[],audio:[],usage:[],dag:emptyDag()}),JSON.stringify({...selection,length:80}),next).run();
 await coordinator.tick();statements=0;await coordinator.tick();assert.ok(statements<=60,`${statements} statements`);
 await repo.db.prepare("UPDATE stories SET generation_control='active'").run();
 for(let i=0;i<4;i++)await coordinator.tick();
 upserts=0;await coordinator.tick();assert.equal(upserts,0,'unchanged active stories are not rescheduled');
 await coordinator.request(owner,id,'viewer',0);await coordinator.tick();upserts=0;
 await repo.db.prepare("UPDATE production_demand SET expires_at=expires_at+1000 WHERE viewer_id='viewer'").run();
 await coordinator.tick();assert.equal(upserts,0,'renewing a viewer does not reschedule');
});

test('pruning removes a preparation job left from an earlier setup generation, and expires only expired viewers',async t=>{
 const {f,repo,id,owner}=await seeded(t),coordinator=await coordinatorFor(f,repo,true);
 await repo.db.prepare('UPDATE stories SET document=? WHERE id=?').bind(JSON.stringify({plan:null,original,images:[],audio:[],usage:[],intake:{phase:'preparing',generation:2}}),id).run();
 const stale=(key,generation)=>coordinator.queue.enqueue({id:key,sessionId:id,ownerId:owner,kind:'prepare',pool:'text',version:key,dependencies:[],payload:{setupGeneration:generation},priority:0});
 await stale('current',2);await stale('old',1);
 await repo.db.prepare("UPDATE production_jobs SET state='running',lease_until=? WHERE id='old'").bind(Date.now()+600000).run();
 await coordinator.tick();
 assert.ok(await coordinator.queue.job('old'),'a running job is never deleted by pruning');
 await repo.db.prepare("UPDATE production_jobs SET state='failed' WHERE id='old'").run();
 await coordinator.tick();
 assert.equal(await coordinator.queue.job('old'),null,'the failed old-generation job is pruned after the earlier pass');
 assert.ok(await coordinator.queue.job('current'));
 for(const [viewer,expiry] of [['expired',0],['live',Date.now()+60000]])await repo.db.prepare('INSERT INTO production_demand VALUES(?,?,?,?,?,?,?)').bind(id,owner,viewer,0,6,expiry,'other-runtime').run();
 await coordinator.tick();
 assert.equal(await repo.db.prepare("SELECT * FROM production_demand WHERE viewer_id='expired'").first(),null);
 assert.ok(await repo.db.prepare("SELECT * FROM production_demand WHERE viewer_id='live'").first());
});

test('deleting a story disarms its DAG work: nothing is paid, and restoring it waits for an explicit Resume',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 const repo=new ReaderRepository(f.app.services.database),owner=f.app.services.ownerId,id=crypto.randomUUID(),now=new Date().toISOString();
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at) VALUES(?,?,?,?,'background','active','idle',?,?)")
  .bind(id,owner,JSON.stringify({...selection,length:4}),JSON.stringify({plan:null,images:[],audio:[],usage:[],original,dag:emptyDag()}),now,now).run();
 await repo.remove(id,owner);
 assert.equal((await f.app.services.database.prepare('SELECT generation_control AS c FROM stories WHERE id=?').bind(id).first()).c,'stopped');
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.dagCalls.length+f.control.calls.length,0,'no paid call for a deleted story');
 await repo.restore(id,owner);
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.dagCalls.length+f.control.calls.length,0,'a restored story does not restart by itself');
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(id)).state==='completed',20000);
});

test('shelf trimming keeps recovery metadata and never changes the opened session source',async t=>{
 const {f,id}=await seeded(t),opened=await f.read(id),shelf=shelfView(opened);
 assert.ok(opened.story.original);assert.ok(opened.story.sourceText);
 assert.equal(shelf.story.original,undefined);assert.equal(shelf.story.sourceText,'');
 assert.equal(shelf.generationProgress.sourceReady,true);
 assert.deepEqual(await f.json('sessions'),[shelf]);
 assert.ok((await f.read(id)).story.original);
});
