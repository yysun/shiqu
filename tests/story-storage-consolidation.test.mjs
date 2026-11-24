// Exercise the production coordinator, including killed-process recovery, without opening a user library.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync,cpSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {historicalLibrary,insertStudio} from './fixtures/historical-library.mjs';
import {ensureLibraryReady,restoreAndUpgradeLibrary} from '../server/library-upgrade.ts';
import {inspectLibrary,withLibraryGate} from '../server/library-schema.ts';
import {ownDesktopData} from '../server/desktop-owner.ts';
import {openDatabase} from '../server/database.ts';
import {createApplication} from '../server/app.ts';
import {createLibraryBackup,verifyLibraryBackup} from '../server/library-backup.ts';
import {nativeExportRuntime} from '../server/story-export.ts';
import {encoded} from './fixtures/images.mjs';
const root=process.cwd();
function fixture(t,mixed=true){
 const parent=mkdtempSync(path.join(os.tmpdir(),'shiqu-consolidation-')),directory=path.join(parent,'library');t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const db=historicalLibrary(directory);
 const rows=[['zhongli','owner','completed','stopped',{}],['revision','owner','idle','paused',{revision:{rootId:'zhongli',number:2}}],['trash','owner','failed','paused',{}],['other','other-owner','idle','stopped',{}],['reselection','owner','idle','stopped',{reselection:{rootId:'revision'}}]];
 for(const [id,owner,state,control,extra]of rows)db.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,state,generation_control,page,saved,created_at,updated_at) VALUES(?,?,?,?,?,?,2,1,'created','updated')").run(id,owner,JSON.stringify({bookId:'zhongshanlang',storyTitle:'current '+id}),JSON.stringify({plan:null,images:['/art/pear-1.png','/api/media/shared.png'],audio:[],...extra}),state,control);
 db.exec("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,attempts,created_at,updated_at) VALUES('paid','trash','owner','image','image','v','[]','{}','{\"value\":\"/art/pear-3.png\",\"requestId\":\"paid-receipt\"}','succeeded',2,1,2)");
 db.exec("INSERT INTO events VALUES('kept','visitor','s','zhongli','page',1,'manual','internal','date'); INSERT INTO events VALUES('old','visitor','s','old','page',1,'manual','internal','date')");
 db.exec("INSERT INTO library_deletions VALUES('owner','trash','generated','date'); INSERT INTO library_deletions VALUES('owner','old','published','date')");
 if(mixed){const story=insertStudio(db);db.prepare('UPDATE stories SET pages=? WHERE id=?').run(JSON.stringify([{image:'/api/media/retired.png'},{image:'/api/media/shared.png'}]),story.id);}
 db.exec("INSERT INTO book_image_references VALUES('owner','book:demo','zhongli',0,'token','book-reference/demo.png','date'); INSERT INTO book_image_references VALUES('other','book:old','old',0,'token','book-reference/old.png','date')");
 db.exec("INSERT INTO books VALUES('zhongshanlang','中山狼传','author','era','demo-url','demo-excerpt','demo-note'); UPDATE books SET excerpt='demo',note='demo' WHERE id='liaozhai'");
 const before=db.prepare('SELECT * FROM reader_sessions ORDER BY id').all();db.close();
 const files=['legacy-art/pear-1.png','legacy-art/pear-2.png','legacy-art/pear-3.png','legacy-art/dongguo-30.png','shared.png','retired.png','unknown.png','book-reference/demo.png','book-reference/old.png','reader/trash/source.json'];
 for(const name of files){mkdirSync(path.dirname(path.join(directory,'media',name)),{recursive:true});writeFileSync(path.join(directory,'media',name),name.endsWith('.json')?'{}':Buffer.from(encoded,'base64'));}
 return {directory,parent,before,files};
}
function rawRows(directory,table){const db=new DatabaseSync(path.join(directory,'shiqu.sqlite'),{readOnly:true});try{return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();}finally{db.close();}}
function fileManifest(f){return Object.fromEntries(f.files.map(key=>[key,readFileSync(path.join(f.directory,'media',key)).toString('hex')]));}
function assertOriginal(f,manifest){assert.deepEqual(rawRows(f.directory,'reader_sessions'),f.before);for(const [key,bytes]of Object.entries(manifest))assert.equal(readFileSync(path.join(f.directory,'media',key)).toString('hex'),bytes);}
test('fresh and mixed upgrades converge; all owners/revisions/states and current/shared/unknown bytes survive',t=>{
 const f=fixture(t),manifest=fileManifest(f),result=ensureLibraryReady(f.directory,root);
 assert.ok(result.shared.includes('legacy-art/pear-1.png'));assert.ok(result.shared.includes('shared.png'));assert.ok(result.uncertain.includes('unknown.png'));
 assert.deepEqual(JSON.parse(readFileSync(path.join(f.directory,'.desktop-upgrade-result.json'),'utf8')).uncertain,result.uncertain);
 assert.equal(inspectLibrary(f.directory),'current');assert.deepEqual(rawRows(f.directory,'stories'),f.before);verifyLibraryBackup(result.backup);
 const local=openDatabase(f.directory,root);
 try{
  for(const table of ['reader_sessions','jobs','progress'])assert.equal(local.sqlite.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(table),undefined);
  assert.equal(local.sqlite.prepare('SELECT count(*) n FROM book_image_references').get().n,0);
  assert.deepEqual(local.sqlite.prepare('SELECT id FROM events').all().map(row=>row.id),['kept']);
  assert.equal(JSON.parse(local.sqlite.prepare("SELECT result FROM production_jobs WHERE id='paid'").get().result).requestId,'paid-receipt');
  assert.equal(local.sqlite.prepare("SELECT excerpt FROM books WHERE id='liaozhai'").get().excerpt,'');
  assert.equal(local.sqlite.prepare("SELECT note FROM books WHERE id='liaozhai'").get().note,'待录入选定篇目的原文与来源。');
  assert.equal(local.sqlite.prepare("SELECT title FROM books WHERE id='zhongshanlang'").get().title,'中山狼传');
  assert.equal(local.sqlite.prepare("SELECT count(*) n FROM library_deletions WHERE kind='generated'").get().n,1);
 }finally{local.close();}
 for(const key of ['legacy-art/pear-1.png','legacy-art/pear-3.png','shared.png','unknown.png','reader/trash/source.json'])assert.equal(readFileSync(path.join(f.directory,'media',key)).toString('hex'),manifest[key]);
 for(const key of ['legacy-art/pear-2.png','legacy-art/dongguo-30.png','retired.png','book-reference/demo.png','book-reference/old.png'])assert.equal(existsSync(path.join(f.directory,'media',key)),false,key);
 const backupCount=readdirSync(path.dirname(result.backup)).length;ensureLibraryReady(f.directory,root);assert.equal(readdirSync(path.dirname(result.backup)).length,backupCount);
 const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
 const current=new DatabaseSync(path.join(f.directory,'shiqu.sqlite'));const upgradedSchema=schema(current);current.close();
 const fresh=path.join(f.parent,'fresh');ensureLibraryReady(fresh,root);const db=new DatabaseSync(path.join(fresh,'shiqu.sqlite'));
 assert.equal(db.prepare('SELECT count(*) n FROM stories').get().n,0);assert.deepEqual(schema(db),upgradedSchema);
 const books=database=>database.prepare('SELECT * FROM books ORDER BY id').all(),upgraded=new DatabaseSync(path.join(f.directory,'shiqu.sqlite'),{readOnly:true});
 assert.deepEqual(books(db).filter(row=>row.id!=='zhongshanlang'),books(upgraded).filter(row=>row.id!=='zhongshanlang'));upgraded.close();db.close();
});
for(const point of ['journal','staged','quarantined','database-retired','database-published','files-published','cleanup'])test('exception at '+point+' restores original DB and media, then retries once',t=>{
 const f=fixture(t),manifest=fileManifest(f);assert.throws(()=>ensureLibraryReady(f.directory,root,{onStep(step){if(step===point)throw Error('injected');}}),/restored original library; backup:/);
 assertOriginal(f,manifest);assert.equal(existsSync(path.join(f.directory,'.desktop-upgrade.json')),false);
 ensureLibraryReady(f.directory,root);assert.deepEqual(rawRows(f.directory,'stories'),f.before);
});
for(const point of ['journal','quarantined','database-retired','database-published','cleanup'])test('process death at '+point+' recovers before access, including missing live DB',async t=>{
 const f=fixture(t),manifest=fileManifest(f);
 const script=`import {ensureLibraryReady} from './server/library-upgrade.ts';ensureLibraryReady(process.argv[1],process.cwd(),{onStep(step){if(step===process.argv[2])process.kill(process.pid,'SIGKILL')}});`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,f.directory,point],{cwd:root,stdio:'ignore'});const [code,signal]=await once(child,'exit');assert.equal(code,null);assert.equal(signal,'SIGKILL');
 if(point==='database-published')writeFileSync(path.join(f.directory,'shiqu.sqlite'),'damaged publication');
 assert.equal(inspectLibrary(f.directory),'pending');
 // Fail immediately after recovery creates the next journal, proving original state was recovered first.
 assert.throws(()=>ensureLibraryReady(f.directory,root,{onStep(step){if(step==='journal')throw Error('retry stop');}}));assertOriginal(f,manifest);
 ensureLibraryReady(f.directory,root);assert.deepEqual(rawRows(f.directory,'stories'),f.before);
});
test('future schema and recovery formats refuse before runtime files or backups are written',async t=>{
 const f=fixture(t);let db=new DatabaseSync(path.join(f.directory,'shiqu.sqlite'));db.exec('PRAGMA user_version=4');db.close();const before=readdirSync(f.directory);
 assert.throws(()=>ensureLibraryReady(f.directory,root),/NEWER_SCHEMA/);await assert.rejects(ownDesktopData(f.directory),/NEWER_SCHEMA/);assert.deepEqual(readdirSync(f.directory),before);
 writeFileSync(path.join(f.directory,'.desktop-upgrade.json'),JSON.stringify({version:4}));assert.throws(()=>ensureLibraryReady(f.directory,root),/NEWER_UPGRADER/);
});
test('a separate process cannot enter the brief gate during publication',async t=>{
 const f=fixture(t);ensureLibraryReady(f.directory,root);
 withLibraryGate(f.directory,()=>{
  const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import {withLibraryGate} from './server/library-schema.ts';try{withLibraryGate(process.argv[1],()=>{});process.exit(2)}catch(error){process.exit(error.message.startsWith('DATA_BUSY')?0:3)}`,f.directory],{cwd:root,stdio:'ignore'});
  assert.equal(child.status,0);
 });
});
test('normal restore upgrades before publication and current-use legacy art reads through HTTP and Node export',async t=>{
 const f=fixture(t),backup=path.join(f.parent,'saved');createLibraryBackup(f.directory,backup);
 const target=path.join(f.parent,'restored');restoreAndUpgradeLibrary(backup,target,root);assert.equal(inspectLibrary(target),'current');assert.deepEqual(rawRows(target,'stories'),f.before);
 // The verified source is the reported rollback point; no staging snapshot is left beside the target.
 assert.equal(JSON.parse(readFileSync(path.join(target,'.desktop-upgrade-result.json'),'utf8')).backup,backup);
 assert.deepEqual(readdirSync(f.parent).filter(name=>name.includes('.restore-')),[]);
 const app=createApplication({root,dataDirectory:target,variables:{SHIQU_AI_PROVIDER:'readonly'},production:{autoStart:false}});
 try{
  const bytes=readFileSync(path.join(target,'media/legacy-art/pear-1.png'));
  for(const method of ['GET','HEAD']){const response=await app.handle(new Request('http://shiqu.local/art/pear-1.png',{method}));assert.equal(response.status,200);if(method==='GET')assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);else assert.equal((await response.arrayBuffer()).byteLength,0);}
  assert.equal((await app.handle(new Request('http://shiqu.local/art/pear-2.png'))).status,404);
  const blob=await nativeExportRuntime(root,app).read('/art/pear-1.png',0);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);
  const envelope=await(await app.handle(new Request('http://shiqu.local/api/reader/deletions?inventory=1'))).json();assert.equal(envelope.complete,true);
 }finally{await app.close();}
});

test('a library containing only current stories preserves all raw row values and creates one verified backup',t=>{
 const f=fixture(t,false),db=new DatabaseSync(path.join(f.directory,'shiqu.sqlite'));assert.equal(db.prepare('SELECT count(*) n FROM stories').get().n,0);db.close();
 const result=ensureLibraryReady(f.directory,root);assert.deepEqual(rawRows(f.directory,'stories'),f.before);verifyLibraryBackup(result.backup);
});

for(const mode of ['missing image','missing receipt','corrupt original','corrupt revision'])test(mode+' blocks purge and restores original state with a backup path',t=>{
 const f=fixture(t);
 if(mode.startsWith('missing')){const key=mode==='missing image'?'shared.png':'legacy-art/pear-3.png';rmSync(path.join(f.directory,'media',key));f.files=f.files.filter(file=>file!==key);}
 else{const key=mode==='corrupt original'?'reader/trash/source.json':'reader/revision/base.json';mkdirSync(path.dirname(path.join(f.directory,'media',key)),{recursive:true});writeFileSync(path.join(f.directory,'media',key),'{unreadable');if(!f.files.includes(key))f.files.push(key);}
 const manifest=fileManifest(f);assert.throws(()=>ensureLibraryReady(f.directory,root),error=>error.message.includes('backup: ')&&error.message.includes(mode.startsWith('missing')?'PROTECTED_MEDIA_MISSING':'PROTECTED_JSON_INVALID'));
 assertOriginal(f,manifest);assert.equal(inspectLibrary(f.directory),'legacy');assert.ok(existsSync(path.join(f.directory,'media/legacy-art/pear-2.png')));
});
test('a current saved original follows absolute library media references and protects their bytes',t=>{
 const f=fixture(t),file=path.join(f.directory,'media/reader/trash/source.json');writeFileSync(file,JSON.stringify({image:path.join(f.directory,'media/legacy-art/pear-2.png')}));
 const result=ensureLibraryReady(f.directory,root);assert.ok(result.shared.includes('legacy-art/pear-2.png'));assert.ok(existsSync(path.join(f.directory,'media/legacy-art/pear-2.png')));
});

test('titles, prompts and original prose that look like filenames do not become missing-media requirements',t=>{
 const f=fixture(t),db=new DatabaseSync(path.join(f.directory,'shiqu.sqlite'));
 db.exec("UPDATE reader_sessions SET selection=json_set(selection,'$.storyTitle','notes.json','$.displayTitle','cover.png','$.productionPrompt','instructions.json'),document=json_set(document,'$.original',json('{\"title\":\"notes.json\",\"text\":\"cover.png\"}'))");
 f.before=db.prepare('SELECT * FROM reader_sessions ORDER BY id').all();db.close();
 ensureLibraryReady(f.directory,root);assert.deepEqual(rawRows(f.directory,'stories'),f.before);
});
test('relocated restore protects absolute saved-original references without consulting the original path',t=>{
 const f=fixture(t),file=path.join(f.directory,'media/reader/trash/source.json');writeFileSync(file,JSON.stringify({image:path.join(f.directory,'media/legacy-art/pear-2.png')}));
 const backup=path.join(f.parent,'absolute-backup');createLibraryBackup(f.directory,backup);
 rmSync(f.directory,{recursive:true});const target=path.join(f.parent,'relocated');restoreAndUpgradeLibrary(backup,target,root);
 assert.ok(existsSync(path.join(target,'media/legacy-art/pear-2.png')));assert.equal(JSON.parse(readFileSync(path.join(target,'media/reader/trash/source.json'),'utf8')).image,JSON.parse(readFileSync(path.join(backup,'media/reader/trash/source.json'),'utf8')).image);
});

test('the format declaration names the newest bundled migration for native readers',()=>{
 const names=readdirSync(path.join(root,'drizzle')).filter(name=>name.endsWith('.sql')).sort();
 assert.equal(JSON.parse(readFileSync(path.join(root,'db/library-format.json'),'utf8')).latestMigration,names.at(-1));
});
test('a consolidated library applies a later migration in place after a verified backup',t=>{
 const f=fixture(t);ensureLibraryReady(f.directory,root);
 // A copied application root stands in for the next release; the user's library is never touched.
 const next=path.join(f.parent,'next');for(const item of ['drizzle','docker','package.json'])cpSync(path.join(root,item),path.join(next,item),{recursive:true});
 writeFileSync(path.join(next,'drizzle/9999_later_change.sql'),'CREATE TABLE later_change(id TEXT PRIMARY KEY);');
 const result=ensureLibraryReady(f.directory,next);
 assert.deepEqual(result.migrations,['9999_later_change.sql']);verifyLibraryBackup(result.backup);
 assert.equal(JSON.parse(readFileSync(path.join(result.backup,'shiqu-backup.json'),'utf8')).appVersion,JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version);
 const local=openDatabase(f.directory,next);
 try{assert.ok(local.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='later_change'").get());assert.deepEqual(local.sqlite.prepare('SELECT * FROM stories ORDER BY id').all(),f.before);}
 finally{local.close();}
 assert.equal(ensureLibraryReady(f.directory,next),undefined);
});
test('a failed restore publishes nothing and leaves no staging snapshot',t=>{
 const f=fixture(t),key='shared.png';rmSync(path.join(f.directory,'media',key));
 const backup=path.join(f.parent,'saved');createLibraryBackup(f.directory,backup);const target=path.join(f.parent,'restored');
 assert.throws(()=>restoreAndUpgradeLibrary(backup,target,root),error=>error.message.startsWith('LIBRARY_RESTORE_FAILED')&&error.message.includes(backup));
 assert.equal(existsSync(target),false);assert.deepEqual(readdirSync(f.parent).filter(name=>name.includes('.restore-')),[]);
});
// Released 0.2-0.7 seeds start with this liaozhai row on every open; the consolidated schema must refuse it.
const releasedSeed="INSERT INTO books (id,title,author,era,source_url,excerpt,note) VALUES ('liaozhai','聊斋志异','蒲松龄','清','https://zh.wikisource.org/wiki/聊齋志異/卷一','种梨','演示') ON CONFLICT(id) DO NOTHING;";
function assertRefusesReleasedSeed(directory){
 const db=new DatabaseSync(path.join(directory,'shiqu.sqlite')),row=()=>db.prepare("SELECT * FROM books WHERE id='liaozhai'").get();
 try{const before=row();assert.throws(()=>db.exec(releasedSeed),/BACKUP_APP_TOO_OLD: this library requires Shiqu 0\.8\.0 or later/);assert.deepEqual(row(),before);}
 finally{db.close();}
}
test('fresh and upgraded libraries refuse pre-0.8 seeding while current opens keep seeding',t=>{
 const f=fixture(t);ensureLibraryReady(f.directory,root);assertRefusesReleasedSeed(f.directory);
 const fresh=path.join(f.parent,'fresh');ensureLibraryReady(fresh,root);assertRefusesReleasedSeed(fresh);
 for(let n=0;n<2;n++){const local=openDatabase(fresh,root);assert.equal(local.sqlite.prepare("SELECT note FROM books WHERE id='liaozhai'").get().note,'待录入选定篇目的原文与来源。');local.close();}
});
test('a library consolidated before the refusal guard receives it in place',t=>{
 const f=fixture(t),previous=path.join(f.parent,'previous');
 for(const item of ['docker','package.json'])cpSync(path.join(root,item),path.join(previous,item),{recursive:true});
 cpSync(path.join(root,'drizzle'),path.join(previous,'drizzle'),{recursive:true,filter:source=>!/^\d{4}_.*\.sql$/.test(path.basename(source))||path.basename(source)<'0019_'});
 ensureLibraryReady(f.directory,previous);
 const db=new DatabaseSync(path.join(f.directory,'shiqu.sqlite'));db.exec(releasedSeed);db.close();
 const result=ensureLibraryReady(f.directory,root);assert.deepEqual(result.migrations,['0019_refuse_pre_consolidation_apps.sql','0020_blocked_revision_faults.sql','0021_landscape_job_isolation.sql','0022_story_content_revisions.sql','0023_story_scan_indexes.sql','0024_prompt_records.sql','0025_production_dag.sql','0026_production_lifecycle.sql']);verifyLibraryBackup(result.backup);
 assertRefusesReleasedSeed(f.directory);assert.deepEqual(rawRows(f.directory,'stories'),f.before);
});
