// 修订的故障规则由事务保证（server/dag-revisions.ts）：新版与其图片丢失故障同事务写入，暂停的修订须先恢复再重绘。
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
import {completedStory,saved} from './fixtures/production-dag-story.mjs';

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
 assert.deepEqual(result.migrations,['0020_blocked_revision_faults.sql','0021_landscape_job_isolation.sql','0022_story_content_revisions.sql','0023_story_scan_indexes.sql','0024_prompt_records.sql','0025_production_dag.sql','0026_production_lifecycle.sql','0027_revision_fault_targets.sql','0028_shelf_cover.sql']);verifyLibraryBackup(result.backup);
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

/** 删除已完成故事的一幅成图文件，使保存修订时该幅记为图片丢失故障。 */
async function loseImage(f,id,page){
 const {rm}=await import('node:fs/promises');
 await rm(path.join(f.dataDirectory,'media','reader',id,`${page}.png`));
}

test('a fault storage failure rolls back the blocked child instead of publishing an unrecoverable revision',async t=>{
 const f=await productionFixture(t,'codex');
 const {id}=await completedStory(f);
 await loseImage(f,id,4);
 const base=await f.json(`sessions/${id}/revisions`),child=crypto.randomUUID();
 await f.app.services.database.prepare("CREATE TRIGGER reject_child_fault BEFORE INSERT ON reader_faults WHEN NEW.session_id='"+child+"' BEGIN SELECT RAISE(ABORT,'injected fault write failure'); END").run();
 const response=await f.request(`sessions/${id}/revisions`,'POST',{requestId:child,token:base.token,changes:{artStyle:'paper-cut'}});
 assert.equal(response.ok,false);
 assert.equal(await f.app.services.database.prepare('SELECT id FROM stories WHERE id=?').bind(child).first(),null);
 assert.ok(!(await f.read(id)).superseded);
 // 去掉注入后，同一请求可重放成功：新版与故障一起出现。
 await f.app.services.database.prepare('DROP TRIGGER reject_child_fault').run();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:base.token,changes:{artStyle:'paper-cut'}});
 assert.equal((await f.read(child)).faults.filter(x=>x.stage==='redraw'&&x.state==='pending').length,1);
});

test('a paused revision with a lost image requires resume before an explicit retry redraws and completes it once',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 const {id}=await completedStory(f);
 await loseImage(f,id,4);
 const base=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(base.plan);plan.pages[0].caption='庄周在柳树下打盹，梦里化作蝴蝶。';
 const child=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan},paused:true});
 const fault=child.faults.find(x=>x.stage==='redraw'&&x.state==='pending');assert.ok(fault?.retryAllowed);
 const command={requestId:crypto.randomUUID(),faultId:fault.id};
 assert.equal((await f.request(`sessions/${child.id}/recover`,'POST',command)).status,409);
 await f.app.services.production.tick();
 assert.equal(f.control.calls.length,0);
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'resume'});
 await f.json(`sessions/${child.id}/production-control`,'POST',{action:'continue'});
 await f.json(`sessions/${child.id}/recover`,'POST',command);
 await until(async()=>(await f.read(child.id)).state==='completed',20000);
 assert.deepEqual(f.control.calls.map(c=>c.page),[4],'only the lost image is drawn');
 assert.ok(!(await f.read(child.id)).faults?.length);
 const counts=[f.control.reviews.length,f.control.calls.length];
 await f.json(`sessions/${child.id}/recover`,'POST',command);
 await f.app.services.production.tick();await f.app.services.production.queue.settle();
 assert.deepEqual([f.control.reviews.length,f.control.calls.length],counts);
 assert.equal((await saved(f,child.id)).dag.continuation,undefined);
});
