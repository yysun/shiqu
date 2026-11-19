// Upgrade disposable pre-fix libraries through the real backup gate and verify
// child-owned authorization, unaffected checkpoints and transactional fault writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {ensureLibraryReady} from '../server/library-upgrade.ts';
import {verifyLibraryBackup} from '../server/library-backup.ts';
import {productionFixture,until} from './fixtures/production.mjs';

test('upgrade backs up and repairs stranded blocked revisions without replacing authorizations or healthy checkpoints',t=>{
 const root=process.cwd(),temporary=mkdtempSync(path.join(os.tmpdir(),'shiqu-blocked-revision-'));
 t.after(()=>rmSync(temporary,{recursive:true,force:true}));
 const previous=path.join(temporary,'previous'),directory=path.join(temporary,'library');
 for(const item of ['docker','package.json'])cpSync(path.join(root,item),path.join(previous,item),{recursive:true});
 cpSync(path.join(root,'drizzle'),path.join(previous,'drizzle'),{recursive:true,filter:source=>!/^\d{4}_.*\.sql$/.test(path.basename(source))||path.basename(source)<'0020_'});
 ensureLibraryReady(directory,previous);
 let db=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
 const insert=db.prepare("INSERT INTO stories(id,user_id,selection,document,state,error,created_at,updated_at) VALUES(?,?,'{}',?,?,'审核未通过','created','updated')");
 for(const [id,state,status,overridden,parent] of [
  ['stranded','failed','blocked',false,true],['other-owner','failed','blocked',false,true],
  ['pending','failed','blocked',false,true],['recovering','failed','blocked',false,true],
  ['healthy','idle','passed',false,true],['overridden','failed','blocked',true,true],
  ['original','failed','blocked',false,false],['unfinished','failed','repair',false,true],
 ])insert.run(id,id==='other-owner'?'other-owner':'owner',JSON.stringify({plan:null,images:[],audio:[],usage:[],...(parent?{revision:{parentId:'parent',rootId:'parent',number:2}}:{}),visualReview:{status,...(overridden?{overridden:true}:{})}}),state);
 for(const state of ['pending','recovering'])db.prepare("INSERT INTO reader_faults(id,session_id,owner_id,kind,version,message,state,created_at,updated_at) VALUES(?,?,'owner','job','legacy','saved',?,1,1)").run(state+'-fault',state,state);
 const before=db.prepare('SELECT * FROM stories ORDER BY id').all();db.close();
 const result=ensureLibraryReady(directory,root);
 assert.deepEqual(result.migrations,['0020_blocked_revision_faults.sql','0021_landscape_job_isolation.sql','0022_story_content_revisions.sql','0023_story_scan_indexes.sql','0024_prompt_records.sql']);verifyLibraryBackup(result.backup);
 const backup=new DatabaseSync(path.join(result.backup,'shiqu.sqlite'),{readOnly:true});
 assert.equal(backup.prepare("SELECT count(*) n FROM reader_faults WHERE session_id='stranded'").get().n,0);backup.close();
 db=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
 try{
  assert.deepEqual(db.prepare('SELECT * FROM stories ORDER BY id').all(),before);
  const faults=db.prepare('SELECT id,session_id,owner_id,state FROM reader_faults ORDER BY session_id').all();
  assert.deepEqual(faults.map(fault=>[fault.session_id,fault.owner_id,fault.state]),[['other-owner','other-owner','pending'],['pending','owner','pending'],['recovering','owner','recovering'],['stranded','owner','pending']]);
  assert.equal(faults.find(fault=>fault.session_id==='pending').id,'pending-fault');
  assert.equal(faults.find(fault=>fault.session_id==='recovering').id,'recovering-fault');
  assert.equal(ensureLibraryReady(directory,root),undefined);
  assert.deepEqual(db.prepare('SELECT id,session_id,owner_id,state FROM reader_faults ORDER BY session_id').all(),faults);
 }finally{db.close();}
});

test('a fault storage failure rolls back the blocked child instead of publishing an unrecoverable revision',async t=>{
 const f=await productionFixture(t);
 f.control.beforeText=async(kind,payload)=>kind==='review'?{issues:[{page:2,category:'caption',problem:'配文含混。',instruction:'明确动作。'}]}:kind==='repair'?{pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1]}))}:undefined;
 const id=await f.create(3);await until(async()=>(await f.read(id)).state==='failed');
 const base=await f.json(`sessions/${id}/revisions`),child=crypto.randomUUID();
 await f.app.services.database.prepare("CREATE TRIGGER reject_child_fault BEFORE INSERT ON reader_faults WHEN NEW.session_id='"+child+"' BEGIN SELECT RAISE(ABORT,'injected fault write failure'); END").run();
 const response=await f.request(`sessions/${id}/revisions`,'POST',{requestId:child,token:base.token,changes:{artStyle:'paper-cut'}});
 assert.equal(response.ok,false);
 assert.equal(await f.app.services.database.prepare('SELECT id FROM stories WHERE id=?').bind(child).first(),null);
 assert.ok(!(await f.read(id)).superseded);
});

test('a paused blocked revision requires resume before an explicit retry repairs and completes it once',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 f.control.beforeText=async(kind,payload)=>kind==='review'?{issues:[{page:2,category:'caption',problem:'配文含混。',instruction:'明确动作。'}]}:kind==='repair'?{pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1]}))}:undefined;
 const id=await f.create(3);await until(async()=>(await f.read(id)).state==='failed');
 const base=await f.json(`sessions/${id}/revisions`),reviews=f.control.reviews.length,repairs=f.control.repairs.length;
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{artStyle:'paper-cut'},paused:true});
 const fault=child.faults.find(fault=>fault.stage==='review'&&fault.state==='pending');assert.ok(fault?.retryAllowed);
 const command={requestId:crypto.randomUUID(),faultId:fault.id};
 assert.equal((await f.request(`sessions/${child.id}/recover`,'POST',command)).status,409);
 assert.equal(f.control.calls.length,0);assert.equal(f.control.repairs.length,repairs);
 f.control.beforeText=undefined;
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'resume'});
 await f.json(`sessions/${child.id}/recover`,'POST',command);
 await until(async()=>(await f.read(child.id)).state==='completed');
 const completed=await f.read(child.id);
 assert.equal(completed.generationProgress.reviewStatus,'passed');assert.equal(completed.generationProgress.reviewOverridden,false);
 assert.ok(f.control.reviews.length>reviews);assert.ok(f.control.repairs.length>repairs);assert.equal(f.control.calls.length,3);
 const counts=[f.control.reviews.length,f.control.repairs.length];
 await f.json(`sessions/${child.id}/recover`,'POST',command);
 await f.app.services.production.tick();await f.app.services.production.queue.settle();
 assert.deepEqual([f.control.reviews.length,f.control.repairs.length],counts);assert.equal(f.control.calls.length,3);
});
