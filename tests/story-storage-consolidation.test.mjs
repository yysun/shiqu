// 当前书库基线、版本拒绝、原地迁移及中断恢复均通过生产书库门锁验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync,cpSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {ensureLibraryReady,restoreAndUpgradeLibrary} from '../server/library-upgrade.ts';
import {inspectLibrary,withLibraryGate,libraryFormat} from '../server/library-schema.ts';
import {ownDesktopData} from '../server/desktop-owner.ts';
import {openDatabase} from '../server/database.ts';
import {createApplication} from '../server/app.ts';
import {createLibraryBackup,verifyLibraryBackup} from '../server/library-backup.ts';
import {nativeExportRuntime} from '../server/story-export.ts';
import {encoded} from './fixtures/images.mjs';

const root=process.cwd();
const baselineRoot=process.env.SHIQU_TEST_V017_ROOT;
const snapshot=directory=>{
 const db=new DatabaseSync(path.join(directory,'shiqu.sqlite'),{readOnly:true});
 try{return {
  schema:db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all(),
  receipts:db.prepare('SELECT name FROM app_migrations ORDER BY name').all(),
  books:db.prepare('SELECT * FROM books ORDER BY id').all(),
 };}
 finally{db.close();}
};
function fixture(t){
 const parent=mkdtempSync(path.join(os.tmpdir(),'shiqu-format4-'));
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 return {parent,directory:path.join(parent,'library')};
}
function files(directory){
 return Object.fromEntries(readdirSync(directory,{recursive:true,withFileTypes:true}).filter(item=>item.isFile()).map(item=>{
  const name=path.join(item.parentPath,item.name);
  return [path.relative(directory,name),createHash('sha256').update(readFileSync(name)).digest('hex')];
 }));
}

test('fresh initialization preserves the current schema, all receipts and guarded seeds',t=>{
 const {directory}=fixture(t);
 ensureLibraryReady(directory,root);
 const {schema,receipts,books}=snapshot(directory);
 const migrations=readdirSync(path.join(root,'drizzle')).filter(name=>/^\d{4}_.*\.sql$/.test(name)).sort();
 assert.deepEqual(receipts.map(row=>row.name),migrations);
 assert.equal(migrations.at(-1),libraryFormat.latestMigration);
 assert.ok(schema.find(row=>row.name==='story_rows'&&row.type==='view'));
 const saved=books.find(book=>book.id==='liaozhai');
 assert.deepEqual([saved.source_url,saved.excerpt],['','']);
 const first=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
 try{
  assert.throws(()=>first.exec("INSERT INTO books(id,title,author,era,source_url,excerpt,note) VALUES('liaozhai','聊斋志异','蒲松龄','清','https://example.org','种梨','演示') ON CONFLICT(id) DO NOTHING"),/BACKUP_APP_TOO_OLD/);
 }finally{first.close();}
 assert.equal(existsSync(directory+'-backups'),false);
});

for(const version of [0,1,2,3,999])test(`format ${version} refuses access without modifying files or creating a backup`,async t=>{
 const {directory}=fixture(t);
 mkdirSync(path.join(directory,'media'),{recursive:true});
 writeFileSync(path.join(directory,'media','keep'),'unchanged');
 const file=path.join(directory,'shiqu.sqlite');
 const db=new DatabaseSync(file);
 db.exec(`PRAGMA user_version=${version}; CREATE TABLE probe(value TEXT); PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE)`);
 if(version<4)db.exec("INSERT INTO probe VALUES('present in WAL')");
 else db.close();
 const before=files(directory);
 const error=version<4?/LIBRARY_EARLIER_FORMAT.*请先用 0\.17\.x/:/LIBRARY_NEWER_SCHEMA/;
 try{
  assert.throws(()=>ensureLibraryReady(directory,root),error);
  assert.throws(()=>ensureLibraryReady(directory,root,{readOnly:true}),error);
  await assert.rejects(ownDesktopData(directory),error);
  assert.deepEqual(files(directory),before);
  assert.equal(existsSync(directory+'-backups'),false);
 }finally{if(version<4)db.close();}
});

test('old or future pending journals are refused before any library write',t=>{
 const {directory}=fixture(t);
 mkdirSync(directory);
 const filename=path.join(directory,'.desktop-upgrade.json');
 for(const [version,message] of [[3,/LIBRARY_EARLIER_FORMAT/],[999,/LIBRARY_NEWER_UPGRADER/]]){
  writeFileSync(filename,JSON.stringify({version,work:'.desktop-upgrade-00000000-0000-0000-0000-000000000000',backup:null}));
  const before=files(directory);
  assert.throws(()=>ensureLibraryReady(directory,root),message);
  assert.deepEqual(files(directory),before);
 }
});

for(const step of ['journal','staged','database-published','cleanup'])test(`new library recovers after interruption at ${step}`,async t=>{
 const {directory}=fixture(t);
 const script="import {ensureLibraryReady} from './server/library-upgrade.ts'; ensureLibraryReady(process.argv[1],process.cwd(),{onStep(step){if(step===process.argv[2])process.kill(process.pid,'SIGKILL')}});";
 const child=spawn(process.execPath,['--input-type=module','-e',script,directory,step],{cwd:root,stdio:'ignore'});
 assert.deepEqual(await once(child,'exit'),[null,'SIGKILL']);
 assert.equal(inspectLibrary(directory),'pending');
 ensureLibraryReady(directory,root);
 assert.equal(inspectLibrary(directory),'current');
 assert.equal(existsSync(directory+'-backups'),false);
 assert.equal(existsSync(path.join(directory,'.desktop-upgrade.json')),false);
});

test('separate processes cannot pass an exclusive library gate',t=>{
 const {directory}=fixture(t);
 ensureLibraryReady(directory,root);
 withLibraryGate(directory,()=>{
  const script="import {withLibraryGate} from './server/library-schema.ts';try{withLibraryGate(process.argv[1],()=>{});process.exit(2)}catch(error){process.exit(error.message.startsWith('DATA_BUSY')?0:3)}";
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,directory],{cwd:root,stdio:'ignore'});
  assert.equal(child.status,0);
 });
});

test('a later migration preserves story rows and creates a verified whole-library backup',t=>{
 const {directory,parent}=fixture(t);
 ensureLibraryReady(directory,root);
 const before=snapshot(directory);
 const next=path.join(parent,'next');
 cpSync(path.join(root,'drizzle'),path.join(next,'drizzle'),{recursive:true});
 cpSync(path.join(root,'docker'),path.join(next,'docker'),{recursive:true});
 cpSync(path.join(root,'package.json'),path.join(next,'package.json'));
 writeFileSync(path.join(next,'drizzle/9999_later_change.sql'),'CREATE TABLE later_change(id TEXT PRIMARY KEY)');
 const result=ensureLibraryReady(directory,next);
 assert.deepEqual(result.migrations,['9999_later_change.sql']);
 verifyLibraryBackup(result.backup);
 assert.deepEqual(snapshot(result.backup),before);
 const local=openDatabase(directory,next);
 try{assert.ok(local.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='later_change'").get());}
 finally{local.close();}
 assert.equal(ensureLibraryReady(directory,next),undefined);
});

test('restored current libraries still serve old image addresses and the Node exporter can read them',async t=>{
 const {directory,parent}=fixture(t);
 ensureLibraryReady(directory,root);
 const media=path.join(directory,'media/legacy-art');mkdirSync(media,{recursive:true});
 const bytes=Buffer.from(encoded,'base64');
 writeFileSync(path.join(media,'pear-1.png'),bytes);
 writeFileSync(path.join(media,'pear-2.png'),bytes);
 const db=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
 try{db.prepare("INSERT INTO stories(id,user_id,selection,document,created_at,updated_at) VALUES('story','docker-local-owner','{}',?,'c','u')")
  .run(JSON.stringify({images:['/art/pear-1.png'],audio:[]}));}
 finally{db.close();}
 const backup=path.join(parent,'backup'),target=path.join(parent,'restored');
 createLibraryBackup(directory,backup);
 restoreAndUpgradeLibrary(backup,target,root);
 const app=createApplication({root,dataDirectory:target,variables:{SHIQU_AI_PROVIDER:'readonly'},production:{autoStart:false}});
 try{
  const response=await app.handle(new Request('http://shiqu.local/art/pear-1.png'));
  assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.equal((await app.handle(new Request('http://shiqu.local/art/pear-2.png'))).status,404);
  const image=await nativeExportRuntime(root,app).read('/art/pear-1.png',0);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
 }finally{await app.close();}
});

test('0.17 and current initialization agree and format 1–3 open after 0.17 upgrades', {skip:!baselineRoot}, async t=>{
 const {directory,parent}=fixture(t);
 const old=await import(pathToFileURL(path.join(baselineRoot,'server/library-upgrade.ts')).href);
 const oldMigrations=await import(pathToFileURL(path.join(baselineRoot,'server/database-migrations.ts')).href);
 const reference=path.join(parent,'reference');
 old.ensureLibraryReady(reference,baselineRoot);
 ensureLibraryReady(directory,root);
 assert.deepEqual(snapshot(directory),snapshot(reference));
 for(const [version,through] of [[1,'0024_prompt_records.sql'],[2,'0025_production_dag.sql'],[3,'0027_revision_fault_targets.sql']]){
  const legacy=path.join(parent,`format-${version}`);
  mkdirSync(legacy);
  const db=new DatabaseSync(path.join(legacy,'shiqu.sqlite'));
  try{
   oldMigrations.migrate(db,baselineRoot,legacy,through);
   db.exec(readFileSync(path.join(baselineRoot,'docker/seed.sql'),'utf8'));
  }finally{db.close();}
  assert.throws(()=>ensureLibraryReady(legacy,root),/LIBRARY_EARLIER_FORMAT/);
  const upgrade=old.ensureLibraryReady(legacy,baselineRoot);
  verifyLibraryBackup(upgrade.backup);
  assert.equal(ensureLibraryReady(legacy,root),undefined);
  assert.deepEqual(snapshot(legacy),snapshot(reference));
 }
});
