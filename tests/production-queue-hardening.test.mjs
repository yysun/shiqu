// Pin newest-version dispatch, atomic forks, checkpoint reuse and isolated scheduling costs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,makePlan,selection} from './fixtures/production.mjs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {revisionSnapshot,forkRevision} from '../server/reader-revisions.ts';
import {revisionImpact} from '../lib/reader-revision.ts';
import {nextStep} from '../lib/reader-model.ts';
import {shelfView} from '../lib/reader-api.ts';
const original={title:'庄周梦蝶',text:'庄周梦为胡蝶。',url:'https://example.com',kind:'passage',provider:'fixture',retrievedAt:new Date().toISOString()};
async function seeded(t,plan=makePlan(8)){
 const f=await productionFixture(t);f.app.stopGeneration();await f.app.services.production.close();
 const repo=new ReaderRepository(f.app.services.database),id=crypto.randomUUID();
 await repo.create(id,f.app.services.ownerId,selection);
 await repo.db.prepare("UPDATE reader_sessions SET document=?,generation_control='paused' WHERE id=?").bind(JSON.stringify({plan,original,images:[],audio:[],usage:[]}),id).run();
 return {f,repo,id,owner:f.app.services.ownerId};
}
test('derived eligibility includes deleted children and ignores corrupt unrelated rows',async t=>{
 const {repo,id,owner}=await seeded(t);
 const child=crypto.randomUUID();await repo.create(child,owner,selection);
 await repo.db.prepare("UPDATE reader_sessions SET document=?,generation_control='active' WHERE id=?").bind(JSON.stringify({revision:{rootId:id,number:2}}),child).run();
 await repo.db.prepare("UPDATE reader_sessions SET generation_control='active' WHERE id=?").bind(id).run();
 const corrupt=crypto.randomUUID();await repo.create(corrupt,owner,selection);
 await repo.db.prepare("UPDATE reader_sessions SET document='invalid' WHERE id=?").bind(corrupt).run();
 assert.equal(await repo.superseded(id,owner),true);
 assert.equal(await repo.acquire(await repo.get(id,owner),{key:'plan'}),null);
 await repo.remove(child,owner);
 assert.equal(await repo.superseded(id,owner),true);
 await assert.rejects(repo.control(id,owner,'resume'),error=>error.status===409);
 assert.equal((await repo.list(owner)).some(row=>row.id===id),false);
});
test('every old-version start point refuses without changing attempts or documents',async t=>{
 const {f,repo,id,owner}=await seeded(t);
 const child=crypto.randomUUID();await repo.create(child,owner,selection);
 await repo.db.prepare('UPDATE reader_sessions SET document=? WHERE id=?').bind(JSON.stringify({revision:{rootId:id,number:2}}),child).run();
 await repo.db.prepare("UPDATE reader_sessions SET generation_control='active' WHERE id=?").bind(id).run();
 const {ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});f.coordinators.push(coordinator);
 const job={session_id:id,owner_id:owner,kind:'script',pool:'text',payload:'{}',attempts:0};
 assert.equal(await coordinator.canRun(job),false);
 assert.equal(await coordinator.resumeInterrupted(job),false);
 const snap=await coordinator.request(owner,id,'viewer',0,true);
 assert.equal(snap.superseded,true);assert.equal(snap.productionState,'paused');
 assert.equal(await repo.db.prepare('SELECT * FROM production_demand WHERE session_id=?').bind(id).first(),null);
 await assert.rejects(coordinator.overrideReview(owner,id),error=>error.status===409);
 await repo.db.prepare("UPDATE reader_sessions SET document=json_remove(document,'$.original') WHERE id=?").bind(id).run();
 assert.equal((await f.request(`sessions/${id}/source`,'POST',{})).status,409);
 assert.equal((await f.request(`sessions/${id}/advance`,'POST',{throughPage:0})).status,200);
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});
test('image start rechecks newest version after its first dispatch check',async t=>{
 const {f,repo,id,owner}=await seeded(t);
 const {ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});f.coordinators.push(coordinator);
 const row=await repo.get(id,owner),job={session_id:id,owner_id:owner,kind:'image',payload:'{"page":0}',version:coordinator.imageInputs(row).version};
 const child=crypto.randomUUID();await repo.create(child,owner,selection);
 await repo.db.prepare('UPDATE reader_sessions SET document=? WHERE id=?').bind(JSON.stringify({revision:{rootId:id,number:2}}),child).run();
 await assert.rejects(coordinator.image(job),error=>error.constructor.name==='JobYield');
 assert.equal(f.control.calls.length,0);
});
for(const paused of [true,false])test(`atomic fork publishes ${paused?'paused':'active'} child without parent writes; replay preserves later control`,async t=>{
 const {f,repo,id,owner}=await seeded(t),base=await revisionSnapshot(repo,id,owner),child=crypto.randomUUID(),changes={artStyle:'paper-cut'};
 await repo.db.prepare("UPDATE reader_sessions SET generation_control='active' WHERE id=?").bind(id).run();
 const row=await forkRevision(repo,f.media,owner,id,child,base.token,changes,paused);
 assert.equal(row.generation_control,paused?'paused':'active');
 assert.equal(JSON.parse(row.document).revision.handoff,undefined);
 assert.equal((await repo.get(id,owner)).generation_control,'active');
 assert.equal(await repo.superseded(id,owner),true);
 await repo.control(child,owner,paused?'resume':'pause');
 const replay=await forkRevision(repo,f.media,owner,id,child,base.token,changes,paused);
 assert.equal(replay.generation_control,paused?'active':'paused');
});
test('seeded legacy paused handoff still resumes and clears its flag without touching parent',async t=>{
 const {f,repo,id,owner}=await seeded(t),base=await revisionSnapshot(repo,id,owner),child=crypto.randomUUID();
 await forkRevision(repo,f.media,owner,id,child,base.token,{artStyle:'paper-cut'},true);
 await repo.db.prepare("UPDATE reader_sessions SET document=json_set(document,'$.revision.handoff',json('true')) WHERE id=?").bind(child).run();
 const resumed=await repo.control(child,owner,'resume',true);
 assert.equal(resumed.generation_control,'active');assert.equal(JSON.parse(resumed.document).revision.handoff,undefined);
});
for(const kind of ['storyboard','draft'])test(`style-only pre-plan edit preserves ${kind}; requirements and counts discard it`,async t=>{
 const {f,repo,id,owner}=await seeded(t,null),count=kind==='storyboard'?60:8,plan=makePlan(count),{pages,...metadata}=plan;
 const saved=kind==='storyboard'?{storyboard:{outline:{...metadata,beats:pages.map((_,i)=>`第${i+1}幅关键动作`)},pages:pages.slice(0,40)}}:{draft:{...metadata,pages}};
 await repo.db.prepare('UPDATE reader_sessions SET selection=?,document=? WHERE id=?').bind(JSON.stringify({...selection,length:count}),JSON.stringify({plan:null,original,images:[],audio:[],usage:[],...saved}),id).run();
 const base=await revisionSnapshot(repo,id,owner);
 assert.equal(base.savedFrameCount,count);assert.equal(revisionImpact(base,{artStyle:'paper-cut'}).preserveScript,true);
 const child=await forkRevision(repo,f.media,owner,id,crypto.randomUUID(),base.token,{artStyle:'paper-cut'},true),doc=JSON.parse(child.document);
 assert.deepEqual(doc[kind],saved[kind]);
 assert.equal(nextStep(doc,JSON.parse(child.selection),0).key,kind==='storyboard'?'plan:40':'reflection');
 for(const changes of [{productionPrompt:'new direction'},{length:count+1}]){
  const current=await revisionSnapshot(repo,child.id,owner);
  assert.equal(revisionImpact(current,changes).preserveScript,false);
  const replanned=await forkRevision(repo,f.media,owner,child.id,crypto.randomUUID(),current.token,changes,true),fresh=JSON.parse(replanned.document);
  assert.equal(fresh.draft,undefined);assert.equal(fresh.storyboard,undefined);
 }
 assert.equal(f.control.plans.length,0);assert.equal(f.control.outlines.length,0);
});
test('ready orphaned jobs in all four pools are contained and logged once while a valid job runs',async t=>{
 const {f,repo,id,owner}=await seeded(t),{ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});f.coordinators.push(coordinator);
 const logged=[],error=console.error;console.error=(...args)=>logged.push(args);t.after(()=>{console.error=error;});
 let valid=0;coordinator.queue.options.handlers.script.run=async()=>{valid++;return {};};
 for(const [kind,pool] of [['script','text'],['discover','search'],['image','image'],['image-publish','local']]){
  await coordinator.queue.enqueue({id:`orphan-${kind}`,sessionId:'missing',ownerId:owner,kind,pool,version:'v',dependencies:[],payload:{},priority:-100});
 }
 await repo.db.prepare("UPDATE reader_sessions SET generation_control='active' WHERE id=?").bind(id).run();
 await coordinator.queue.enqueue({id:'valid',sessionId:id,ownerId:owner,kind:'script',pool:'text',version:'v',dependencies:[],payload:{},priority:100});
 await coordinator.queue.pump();await coordinator.queue.settle();await coordinator.queue.pump();
 assert.equal(valid,1);assert.equal(logged.filter(args=>args[0]==='production_job_unreadable').length,4);
 for(const kind of ['script','discover','image','image-publish'])assert.equal((await coordinator.queue.job(`orphan-${kind}`)).attempts,0);
});
for(const fails of [false,true])test(`delete during script ${fails?'failure stays retryable':'checkpoint yields and restore does not replay'}`,async t=>{
 const {f,repo,id,owner}=await seeded(t,null),{ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});coordinator.queue.pump=async()=>{};f.coordinators.push(coordinator);
 f.control.beforeText=async kind=>{if(kind==='plan'){await repo.remove(id,owner);if(fails)throw Error('controlled plan failure');}};
 await repo.db.prepare("UPDATE reader_sessions SET generation_control='active' WHERE id=?").bind(id).run();
 const job={session_id:id,owner_id:owner,kind:'script',pool:'text',payload:'{}',version:'v'};
 await assert.rejects(coordinator.script(job),error=>fails?error instanceof Error&&error.constructor.name!=='JobYield':error.constructor.name==='JobYield');
 await repo.restore(id,owner);const row=await repo.get(id,owner);
 assert.equal(row.state,fails?'failed':'idle');
 if(!fails){
  assert.ok(JSON.parse(row.document).draft);await repo.control(id,owner,'resume');
  await coordinator.script(job);assert.equal(f.control.plans.length,1);
 }else assert.ok(row.error);
});
test('SQL candidates exclude paused, failed, superseded and active reader-mode deleted jobs, but retain publication and orphans',async t=>{
 const {f,repo,id,owner}=await seeded(t),{ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});f.coordinators.push(coordinator);
 coordinator.pruneSuperseded=async()=>{};coordinator.graph=async()=>{};
 const ids=[id];
 for(let i=0;i<3;i++){const other=crypto.randomUUID();await repo.create(other,owner,selection);ids.push(other);}
 await repo.db.prepare("UPDATE reader_sessions SET generation_mode='reader',generation_control='active' WHERE id=?").bind(ids[1]).run();
 await repo.remove(ids[1],owner);
 await repo.db.prepare("UPDATE reader_sessions SET state='failed' WHERE id=?").bind(ids[2]).run();
 const child=crypto.randomUUID();await repo.create(child,owner,selection);
 await repo.db.prepare('UPDATE reader_sessions SET document=? WHERE id=?').bind(JSON.stringify({revision:{rootId:ids[3],number:2}}),child).run();
 const calls=[];coordinator.queue.options.canRun=async job=>{calls.push(job.id);return false;};
 for(const sessionId of [...ids,'orphan']){
  for(const [kind,pool] of [['script','text'],['image','image'],['discover','search'],['image-publish','local']]){
   await coordinator.queue.enqueue({id:`${sessionId}-${kind}`,sessionId,ownerId:owner,kind,pool,version:'v',dependencies:[],payload:{},priority:0});
  }
 }
 await coordinator.tick();
 for(const sessionId of [ids[0],ids[1],ids[3]])for(const kind of ['script','image','discover'])assert.equal(calls.includes(`${sessionId}-${kind}`),false);
 for(const kind of ['script','image'])assert.equal(calls.includes(`${ids[2]}-${kind}`),false);
 for(const sessionId of [...ids,'orphan'])assert.ok(calls.includes(`${sessionId}-image-publish`));
 assert.ok(calls.includes('orphan-script'));assert.equal(f.control.calls.length,0);
 const jobs=await coordinator.queue.jobs(ids[1],owner);assert.ok(jobs.every(job=>job.attempts===0));
});
test('warm paused pass uses at most 60 statements; unchanged active state and viewer renewals perform no upserts',async t=>{
 const {f,repo,id,owner}=await seeded(t),{ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});coordinator.queue.pump=async()=>{};f.coordinators.push(coordinator);
 const prepare=repo.db.prepare.bind(repo.db);let statements=0,upserts=0;
 repo.db.prepare=sql=>{statements++;if(sql.includes('INSERT INTO production_jobs'))upserts++;return prepare(sql);};
 const ids=[id];
 for(let i=1;i<20;i++){const next=crypto.randomUUID();await repo.create(next,owner,{...selection,length:80});ids.push(next);}
 for(const next of ids){
  await repo.db.prepare("UPDATE reader_sessions SET document=?,selection=?,generation_control='active' WHERE id=?").bind(JSON.stringify({plan:makePlan(80),original,images:Array(80).fill(''),audio:[],usage:[]}),JSON.stringify({...selection,length:80}),next).run();
  await coordinator.graph(await repo.get(next,owner));
  await repo.db.prepare("UPDATE reader_sessions SET generation_control='paused' WHERE id=?").bind(next).run();
 }
 await coordinator.tick();statements=0;await coordinator.tick();assert.ok(statements<=60,`${statements} statements`);
 await repo.db.prepare("UPDATE reader_sessions SET generation_control='active'").run();
 await coordinator.tick();upserts=0;await coordinator.tick();assert.equal(upserts,0);
 await coordinator.request(owner,id,'viewer',0);await coordinator.tick();upserts=0;
 await repo.db.prepare("UPDATE production_demand SET expires_at=expires_at+1000 WHERE viewer_id='viewer'").run();
 await coordinator.tick();assert.equal(upserts,0);
});
test('pruning catches a job failing after the earlier changed-story pass, and expires only expired viewers',async t=>{
 const {f,repo,id,owner}=await seeded(t),{ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});coordinator.queue.pump=async()=>{};f.coordinators.push(coordinator);
 await coordinator.queue.enqueue({id:'stale-image',sessionId:id,ownerId:owner,kind:'image',pool:'image',version:'stale',dependencies:[],payload:{page:0},priority:0});
 await repo.db.prepare("UPDATE production_jobs SET state='running' WHERE id='stale-image'").run();
 await coordinator.tick();
 await repo.db.prepare("UPDATE production_jobs SET state='failed' WHERE id='stale-image'").run();
 await coordinator.tick();assert.equal(await coordinator.queue.job('stale-image'),null);
 for(const [viewer,expiry] of [['expired',0],['live',Date.now()+60000]])await repo.db.prepare('INSERT INTO production_demand VALUES(?,?,?,?,?,?,?)').bind(id,owner,viewer,0,6,expiry,'other-runtime').run();
 await coordinator.tick();
 assert.equal(await repo.db.prepare("SELECT * FROM production_demand WHERE viewer_id='expired'").first(),null);
 assert.ok(await repo.db.prepare("SELECT * FROM production_demand WHERE viewer_id='live'").first());
});
test('shelf trimming keeps recovery metadata and never changes the opened session source',async t=>{
 const {f,id}=await seeded(t),opened=await f.read(id),shelf=shelfView(opened);
 assert.ok(opened.story.original);assert.ok(opened.story.sourceText);
 assert.equal(shelf.story.original,undefined);assert.equal(shelf.story.sourceText,'');
 assert.equal(shelf.generationProgress.sourceReady,true);
 assert.deepEqual(await f.json('sessions'),[shelf]);
 assert.ok((await f.read(id)).story.original);
});
test('already-paid image publishes to a deleted active reader-mode story without another draw',async t=>{
 const {f,repo,id,owner}=await seeded(t),{ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});f.coordinators.push(coordinator);f.control.hold=false;
 const row=await repo.get(id,owner),version=coordinator.imageInputs(row).version;
 const result=await f.generation.generator().image(makePlan(8),0,id,'',selection.artStyle,selection.productionPrompt,'a'.repeat(64));
 await coordinator.queue.enqueue({id:'paid-image',sessionId:id,ownerId:owner,kind:'image',pool:'image',version,dependencies:[],payload:{page:0},priority:0},result);
 await coordinator.queue.enqueue({id:'paid-publication',sessionId:id,ownerId:owner,kind:'image-publish',pool:'local',version,dependencies:['paid-image'],payload:{page:0},priority:-5});
 await repo.db.prepare("UPDATE reader_sessions SET generation_mode='reader',generation_control='active' WHERE id=?").bind(id).run();await repo.remove(id,owner);
 await coordinator.queue.pump();await coordinator.queue.settle();
 assert.equal((await coordinator.queue.job('paid-publication')).state,'succeeded');
 const stored=await coordinator.raw(id,owner);assert.equal(JSON.parse(stored.document).images[0],result.value);
 assert.equal(stored.generation_control,'active');assert.equal(f.control.calls.length,1);
});
test('an old viewer cannot hold back another story after a newer version is published',async t=>{
 const {f,repo,id,owner}=await seeded(t),{ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});coordinator.queue.pump=async()=>{};f.coordinators.push(coordinator);
 await repo.db.prepare("UPDATE reader_sessions SET generation_control='active' WHERE id=?").bind(id).run();
 await repo.db.prepare('INSERT INTO production_demand VALUES(?,?,?,?,?,?,?)').bind(id,owner,'old-viewer',0,6,Date.now()+30000,coordinator.runtimeId).run();
 for(const [kind,pool,dependencies,priority] of [['image-publish','local',['old-image'],0],['image','image',[],0]])await coordinator.queue.enqueue({id:`old-${kind}`,sessionId:id,ownerId:owner,kind,pool,version:'v',dependencies,payload:{page:1},priority});
 await repo.db.prepare("UPDATE production_jobs SET state='running',updated_at=? WHERE id='old-image-publish'").bind(Date.now()).run();
 const child=crypto.randomUUID();await repo.create(child,owner,selection);
 await repo.db.prepare('UPDATE reader_sessions SET document=? WHERE id=?').bind(JSON.stringify({revision:{rootId:id,number:2}}),child).run();
 assert.equal(await coordinator.viewedPublicationPending(),false);
 assert.deepEqual(await coordinator.demands(id),[]);
});
test('two blocked manual corrections leave only newest eligible; stale retry/skip and old paid lock stay isolated',async t=>{
 const {f,repo,id,owner}=await seeded(t),{ReaderProductionCoordinator}=await import('../server/reader-production.ts');
 const coordinator=new ReaderProductionCoordinator(repo.db,f.generation,f.media,{tickMs:3600000});coordinator.queue.pump=async()=>{};f.coordinators.push(coordinator);
 const token=crypto.randomUUID(),before=await repo.get(id,owner),saved=JSON.parse(before.document);
 await repo.db.prepare("UPDATE reader_sessions SET state='running',lock_token=?,generation_control='paused' WHERE id=?").bind(token,id).run();
 let parent=id;
 for(let i=0;i<2;i++){
  const base=await revisionSnapshot(repo,parent,owner),plan=structuredClone(base.plan);plan.pages[1].caption=`庄周醒来之后，仍然记得梦里的蝴蝶，第${i+1}次修订。`;
  const child=await forkRevision(repo,f.media,owner,parent,crypto.randomUUID(),base.token,{plan});
  await repo.db.prepare("UPDATE reader_sessions SET state='failed',document=json_set(document,'$.visualReview.status','blocked') WHERE id=?").bind(child.id).run();
  parent=child.id;
 }
 const returned=await repo.save(before,token,saved,false);
 assert.equal(returned.id,id);assert.equal(JSON.parse((await repo.get(parent,owner)).document).plan.pages[1].caption.endsWith('第2次修订。'),true);
 assert.equal(await repo.superseded(id,owner),true);
 await assert.rejects(coordinator.overrideReview(owner,id),error=>error.status===409);
 assert.equal((await coordinator.request(owner,id,'stale',0,true)).superseded,true);
 assert.equal((await repo.list(owner)).filter(row=>row.id!==id).length,1);
 assert.equal(f.control.calls.length,0);
});
