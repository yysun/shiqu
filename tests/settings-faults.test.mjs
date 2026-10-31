// Inject storage failures only into disposable databases; exercise SQLite rollback, timeout and hot-journal recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile,readFile,chmod,access} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {SystemSettingsStore} from '../server/system-settings.ts';
import {defaultSystemSettings} from '../lib/system-settings.ts';
import {startupFixture,savedStartupState} from './fixtures/startup.mjs';

test('settings lock timeouts preserve state and allow subsequent save/reset/open',{timeout:20000},async t=>{
 const f=await startupFixture(t),store=f.store();t.after(()=>store.close());
 store.save({provider:'openai',providerConfigured:true},{provider:'openai',value:'test-only-lock-key'});
 const before=await savedStartupState(f),bytes=await readFile(f.locations.settings),lock=new DatabaseSync(f.locations.settings);f.defer(()=>lock.close());
 lock.exec('BEGIN IMMEDIATE');
 try{
  for(const action of [()=>new SystemSettingsStore(f.locations.settings,f.locations.library),()=>store.save({port:3456}),()=>store.resetProviders()]){
   const started=Date.now();assert.throws(action);assert.ok(Date.now()-started<10000,'locked settings must fail within the configured timeout');
   assert.deepEqual(await readFile(f.locations.settings),bytes);
  }
 }finally{lock.exec('ROLLBACK');}
 assert.deepEqual(await savedStartupState(f),before);store.save({port:3456});assert.equal(store.settings().port,3456);
 store.resetProviders();assert.equal(store.key('openai'),'');assert.equal(store.settings().port,3456);
 const reopened=f.store();assert.equal(reopened.settings().port,3456);reopened.close();
});

test('a failed settings write rolls back an already-written replacement key',async t=>{
 const f=await startupFixture(t),store=f.store();t.after(()=>store.close());
 store.save({provider:'openai',providerConfigured:true},{provider:'openai',value:'test-only-original-key'});
 const before=await savedStartupState(f),db=new DatabaseSync(f.locations.settings);
 db.exec("CREATE TRIGGER fail_settings BEFORE UPDATE ON desktop_settings BEGIN SELECT RAISE(ABORT,'test-only-storage-failure'); END;");
 assert.throws(()=>store.save({port:3456},{provider:'openai',value:'test-only-replacement-key'}));
 assert.deepEqual(await savedStartupState(f),before);
 db.exec('DROP TRIGGER fail_settings');db.close();store.save({port:3456},{provider:'openai',value:'test-only-replacement-key'});
 assert.equal(store.key('openai'),'test-only-replacement-key');assert.equal(store.settings().port,3456);
});

test('unwritable settings parent is rejected without changing sibling data',{
 skip:process.platform==='win32'||process.getuid?.()===0?'requires POSIX permissions and a non-root user':false,
},async t=>{
 const f=await startupFixture(t),sealed=path.join(f.root,'sealed'),sentinel=path.join(sealed,'preserved.txt');
 await mkdir(sealed);await writeFile(sentinel,'test-only-preserved-data');await chmod(sealed,0o500);
 try{
  assert.throws(()=>new SystemSettingsStore(path.join(sealed,'missing','desktop.sqlite'),f.locations.library));
  assert.equal(await readFile(sentinel,'utf8'),'test-only-preserved-data');await assert.rejects(access(path.join(sealed,'missing')));
 }finally{await chmod(sealed,0o700);}
});

test('a file blocking the settings directory fails without overwriting it on every platform',async t=>{
 const f=await startupFixture(t),blocked=path.join(f.root,'blocked');await writeFile(blocked,'test-only-preserve-this-file');
 assert.throws(()=>new SystemSettingsStore(path.join(blocked,'desktop.sqlite'),f.locations.library));
 assert.equal(await readFile(blocked,'utf8'),'test-only-preserve-this-file');
});

async function oldDatabase(f){
 await mkdir(path.dirname(f.locations.settings),{recursive:true});const db=new DatabaseSync(f.locations.settings);
 const settings=defaultSystemSettings(f.locations.library);delete settings.libraryConfigured;delete settings.providerConfigured;delete settings.openaiTextModel;delete settings.openaiImageModel;settings.port=3457;
 db.exec("CREATE TABLE desktop_settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE desktop_credentials(name TEXT PRIMARY KEY CHECK(name='gemini'),value TEXT NOT NULL); PRAGMA user_version=1;");
 db.prepare('INSERT INTO desktop_settings VALUES(1,?)').run(JSON.stringify(settings));db.prepare("INSERT INTO desktop_credentials VALUES('gemini',?)").run('test-only-migration-key');db.close();return settings;
}
function inspectOld(f,settings){
 const db=new DatabaseSync(f.locations.settings);try{
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM desktop_settings').get().value),settings);
  assert.deepEqual(db.prepare('PRAGMA table_info(desktop_settings)').all().map(row=>row.name),['id','value']);
  assert.equal(db.prepare("SELECT value FROM desktop_credentials WHERE name='gemini'").get().value,'test-only-migration-key');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='old_credentials'").get().n,0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
}
test('late migration failure rolls back DDL, settings, credentials and schema version',async t=>{
 const f=await startupFixture(t),settings=await oldDatabase(f),db=new DatabaseSync(f.locations.settings);
 db.exec("CREATE TRIGGER fail_migration BEFORE UPDATE ON desktop_settings BEGIN SELECT RAISE(ABORT,'test-only-migration-failure'); END;");db.close();
 assert.throws(()=>f.store());inspectOld(f,settings);
 const cleanup=new DatabaseSync(f.locations.settings);cleanup.exec('DROP TRIGGER fail_migration');cleanup.close();
 const recovered=f.store();assert.equal(recovered.settings().port,3457);assert.equal(recovered.key('gemini'),'test-only-migration-key');recovered.close();
});

test('killing migration after real DDL recovers the original v1 database and permits a clean upgrade',{timeout:20000},async t=>{
 const f=await startupFixture(t),settings=await oldDatabase(f),source=new URL('../server/system-settings.ts',import.meta.url).href;
 // Stall after actual v2 DDL but before COMMIT; no production failpoints or real application paths.
 const program=`import {DatabaseSync} from 'node:sqlite';const original=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql);if(sql.includes('ALTER TABLE desktop_settings ADD COLUMN revision')){process.stdout.write('MIGRATION_DDL_UNCOMMITTED\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)}return result};const {SystemSettingsStore}=await import(${JSON.stringify(source)});new SystemSettingsStore(process.argv[1],process.argv[2]);`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',program,f.locations.settings,f.locations.library],{env:f.env,cwd:f.root,stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');f.defer(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const deadline=Date.now()+10000;
 while(!output.includes('MIGRATION_DDL_UNCOMMITTED')){assert.ok(child.exitCode===null&&child.signalCode===null,'migration child exited early');assert.ok(Date.now()<deadline,'migration did not reach the uncommitted DDL boundary');await new Promise(resolve=>setTimeout(resolve,10));}
 child.kill('SIGKILL');await exited;inspectOld(f,settings);
 const recovered=f.store();assert.equal(recovered.settings().port,3457);assert.equal(recovered.settings().providerConfigured,true);assert.equal(recovered.key('gemini'),'test-only-migration-key');recovered.close();
 const check=new DatabaseSync(f.locations.settings);assert.equal(check.prepare('PRAGMA user_version').get().user_version,2);assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check.close();
});
