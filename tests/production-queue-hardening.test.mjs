// Pin newest-version dispatch, atomic forks, checkpoint reuse and isolated scheduling costs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,makePlan,selection} from './fixtures/production.mjs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {revisionSnapshot,forkRevision} from '../server/reader-revisions.ts';
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
