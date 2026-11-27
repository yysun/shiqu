// 用桌面私有维护协议和隔离书库验证备份生命周期、删除保护及格式 V1 的恢复。
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chmodSync,existsSync,mkdirSync,readFileSync,renameSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startupFixture,startFixtureCli} from './fixtures/startup.mjs';
import {historicalLibrary} from './fixtures/historical-library.mjs';
import {makePlan,selection} from './fixtures/production-data.mjs';
import {png} from './fixtures/images.mjs';
import {decodeDocument} from '../lib/production-dag/document.ts';
import {ownDesktopDataSync} from '../server/desktop-owner.ts';
import {canonicalPath,verifyLibraryBackup,withBackupAccess} from '../server/library-backup.ts';

const entry=fileURLToPath(new URL('../server/desktop.ts',import.meta.url));

async function fixture(t,through='0028_production_spec.sql'){
 const f=await startupFixture(t),library=path.join(f.root,'library');
 const sqlite=historicalLibrary(library,f.root,through);
 const invoke=(operation,fields={})=>{
  const child=spawnSync(process.execPath,['--no-warnings',entry,'--library-maintenance'],{
   cwd:f.root,env:f.env,input:JSON.stringify({operation,library,...fields})+'\n',encoding:'utf8',timeout:15000,
  });
  assert.equal(child.status,0,child.stderr||child.error?.message);
  if(operation!=='restore')assert.equal(child.stderr,'');
  return JSON.parse(child.stdout);
 };
 const run=(operation,fields)=>{
  const response=invoke(operation,fields);
  assert.ok(response.result,response.error);
  return response.result;
 };
 return {...f,library,sqlite,invoke,run};
}

test('desktop lists and locates existing snapshots, verifies external copies, and protects deletion',async t=>{
 const f=await fixture(t);
 f.sqlite.close();
 assert.deepEqual(f.run('list').entries,[]);
 const release=ownDesktopDataSync(f.library);
 try{assert.match(f.invoke('create').error,/请先停止/);}finally{release();}
 const saved=f.run('create');
 const {directory,entries}=f.run('list');
 assert.equal(entries.length,1);
 assert.equal(entries[0].deletion,null);
 assert.equal(entries[0].kind,'manual');
 assert.equal(entries[0].createdAt,saved.createdAt);
 assert.ok(entries[0].bytes>0);
 assert.ok(entries[0].deleteToken);
 assert.equal(f.run('reveal',{backup:saved.path}).path,saved.path);
 const external=path.join(f.root,'portable','my-copy');
 f.run('create',{target:external});
 assert.ok(f.run('verify',{backup:external}).verifiedAt);
 if(process.platform!=='win32'&&process.getuid?.()!==0){
  const gate=path.join(path.dirname(external),'.shiqu-backup-lock.sqlite');
  chmodSync(gate,0o400);
  try{assert.ok(f.run('verify',{backup:external}).verifiedAt);}finally{chmodSync(gate,0o600);}
 }
 assert.equal(f.run('list').entries.length,1);
 assert.match(f.invoke('delete',{backup:external,deleteToken:entries[0].deleteToken}).error,/无法确认/);
 const request={backup:saved.path,deleteToken:entries[0].deleteToken};
 withBackupAccess(saved.path,()=>{
  assert.match(f.invoke('delete',request).error,/备份正在使用/);
  assert.match(f.invoke('restore',{backup:saved.path,target:path.join(f.root,'other')}).error,/备份正在使用/);
 });
 withBackupAccess(saved.path,()=>{
  assert.match(f.invoke('delete',request).error,/备份正在使用/);
  assert.ok(f.run('verify',{backup:saved.path}).verifiedAt);
 },true);
 const journal=path.join(f.library,'.desktop-upgrade.json');
 writeFileSync(journal,JSON.stringify({version:2,work:'.desktop-upgrade-12345678-1234-1234-1234-123456789012',backup:saved.path}));
 assert.equal(f.run('list').entries[0].deletion,'protected');
 assert.match(f.invoke('delete',request).error,/仍需要此备份/);
 writeFileSync(journal,'invalid JSON');
 assert.match(f.invoke('delete',request).error,/检查/);
 assert.ok(verifyLibraryBackup(saved.path));
 rmSync(journal);
 const displaced=f.library+'-unavailable';
 renameSync(f.library,displaced);
 try{assert.match(f.invoke('delete',request).error,/无法确认/);assert.ok(!existsSync(f.library));}
 finally{renameSync(displaced,f.library);}
 assert.match(f.invoke('delete',{...request,deleteToken:'0'.repeat(64)}).error,/备份已变更/);
 const unrelated=path.join(directory,'unrelated');
 mkdirSync(unrelated);
 writeFileSync(path.join(unrelated,'notes.txt'),'keep');
 assert.equal(f.run('delete',request).path,saved.path);
 assert.deepEqual(f.run('list').entries,[]);
 assert.equal(existsSync(saved.path),false);
 assert.ok(existsSync(unrelated)&&existsSync(external));
 writeFileSync(path.join(external,'unexpected.txt'),'damaged');
 assert.match(f.invoke('verify',{backup:external}).error,/多余文件/);
 assert.match(f.invoke('restore',{backup:external,target:path.join(f.root,'broken')}).error,/多余文件/);
 assert.equal(existsSync(path.join(f.root,'broken')),false);
 const manifestPath=path.join(external,'shiqu-backup.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 writeFileSync(manifestPath,'corrupt manifest');
 assert.match(f.invoke('verify',{backup:external}).error,/备份清单损坏/);
 rmSync(path.join(external,'unexpected.txt'));
 const corrupt=Buffer.from('not a SQLite database');
 writeFileSync(path.join(external,'shiqu.sqlite'),corrupt);
 Object.assign(manifest.files.find(file=>file.path==='shiqu.sqlite'),{size:corrupt.length,sha256:createHash('sha256').update(corrupt).digest('hex')});
 writeFileSync(manifestPath,JSON.stringify(manifest));
 assert.match(f.invoke('verify',{backup:external}).error,/书库数据库损坏/);
});

test('desktop can delete damaged snapshots and requires a fresh confirmation after changes',async t=>{
 const f=await fixture(t);
 f.sqlite.close();
 const damaged=f.run('create');
 rmSync(path.join(damaged.path,'shiqu.sqlite'));
 assert.match(f.invoke('verify',{backup:damaged.path}).error,/缺失/);
 const [listed]=f.run('list').entries;
 assert.ok(listed.deleteToken);
 assert.equal(f.run('delete',{backup:listed.path,deleteToken:listed.deleteToken}).path,damaged.path);
 assert.equal(existsSync(damaged.path),false);

 const unreadable=f.run('create');
 const [before]=f.run('list').entries;
 writeFileSync(path.join(unreadable.path,'shiqu-backup.json'),'corrupt manifest');
 assert.match(f.invoke('delete',{backup:before.path,deleteToken:before.deleteToken}).error,/备份已变更/);
 const [after]=f.run('list').entries;
 assert.match(after.error,/备份清单损坏/);
 assert.equal(after.deletion,null);
 assert.ok(after.deleteToken);
 assert.equal(f.run('delete',{backup:after.path,deleteToken:after.deleteToken}).path,unreadable.path);
 assert.equal(existsSync(unreadable.path),false);
});

test('desktop protects a backup directory opened as a live library',async t=>{
 const f=await fixture(t);
 f.sqlite.close();
 const saved=f.run('create');
 const [before]=f.run('list').entries;
 const release=ownDesktopDataSync(saved.path);
 try{
  const [opened]=f.run('list').entries;
  assert.equal(opened.deletion,'uncertain');
  assert.equal(opened.deleteToken,undefined);
  assert.match(f.invoke('delete',{backup:saved.path,deleteToken:before.deleteToken}).error,/无法确认/);
  assert.ok(existsSync(path.join(saved.path,'shiqu.sqlite')));
 }finally{release();}
});

test('desktop and current CLI can verify and restore each other’s backups',async t=>{
 const f=await fixture(t);
 f.sqlite.close();
 async function cli(args){
  const command=startFixtureCli(f,args);
  assert.equal(await command.ended(),0,command.output());
 }
 const cliBackup=path.join(f.root,'cli-backup'),desktopRestore=path.join(f.root,'desktop-restore');
 await cli(['backup',cliBackup,'--data-dir',f.library]);
 assert.equal(f.run('verify',{backup:cliBackup}).compatibility.version,4);
 assert.equal(f.run('restore',{backup:cliBackup,target:desktopRestore}).path,desktopRestore);
 const desktopBackup=f.run('create').path,cliRestore=path.join(f.root,'cli-restore');
 await cli(['verify-backup',desktopBackup]);
 await cli(['restore',desktopBackup,'--data-dir',cliRestore]);
 const db=new DatabaseSync(path.join(cliRestore,'shiqu.sqlite'),{readOnly:true});
 try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,4);}
 finally{db.close();}
});

test('desktop restore applies 0025 to a new library and leaves every V1 backup byte intact',async t=>{
 const f=await fixture(t,'0024_prompt_records.sql'),story='11111111-1111-4111-8111-111111111111';
 const plan=makePlan(3),owner='docker-local-owner';
 const image=`/api/reader/media/${story}/0.png`;
 const original={title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'local',retrievedAt:'2026-01-01'};
 const doc={plan,original,images:[image,'',''],audio:[],usage:[]};
 const media=path.join('media','reader',story,'0.png');
 f.sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,state,created_at,updated_at) VALUES(?,?,?,?,'idle','c','u')").run(story,owner,JSON.stringify({...selection,length:3}),JSON.stringify(doc));
 f.sqlite.close();
 mkdirSync(path.dirname(path.join(f.library,media)),{recursive:true});
 writeFileSync(path.join(f.library,media),png);
 const backup=f.run('create').path;
 const originalManifest=readFileSync(path.join(backup,'shiqu-backup.json'));
 const manifest=verifyLibraryBackup(backup);
 const expectedStatus={version:1,state:'migration',migrations:['0025_production_dag.sql','0026_production_lifecycle.sql','0027_revision_fault_targets.sql','0028_production_spec.sql']};
 assert.deepEqual(f.run('verify',{backup}).compatibility,expectedStatus);
 const target=path.join(f.root,'restored');
 assert.match(f.invoke('restore',{backup,target:f.library}).error,/重叠/);
 const existing=path.join(f.root,'already-exists');
 mkdirSync(existing);
 assert.match(f.invoke('restore',{backup,target:existing}).error,/目录已存在/);
 const migration=path.join(f.root,'drizzle','0025_production_dag.sql'),sql=readFileSync(migration);
 writeFileSync(migration,'NOT VALID SQL');
 assert.match(f.invoke('restore',{backup,target}).error,/恢复或迁移未完成/);
 assert.equal(existsSync(target),false);
 writeFileSync(migration,sql.toString()+
  '\nPRAGMA max_page_count=5; CREATE TABLE overflow_test(value BLOB); INSERT INTO overflow_test VALUES(randomblob(2097152));');
 assert.match(f.invoke('restore',{backup,target}).error,/存储空间不足/);
 assert.equal(existsSync(target),false);
 writeFileSync(migration,sql.toString()+`
CREATE TABLE overflow_test(value BLOB);
CREATE TRIGGER overflow_story AFTER UPDATE OF document ON stories BEGIN
 INSERT INTO overflow_test VALUES(randomblob(2097152));
END;
PRAGMA max_page_count=5;`);
 assert.match(f.invoke('restore',{backup,target}).error,/存储空间不足/);
 assert.equal(existsSync(target),false);
 writeFileSync(migration,sql);
 assert.deepEqual(f.run('restore',{backup,target}),{path:target});
 assert.deepEqual(f.run('inspect',{backup}).compatibility,expectedStatus);
 assert.deepEqual(readFileSync(path.join(backup,'shiqu-backup.json')),originalManifest);
 assert.deepEqual(verifyLibraryBackup(backup),manifest);
 assert.deepEqual(readFileSync(path.join(target,media)),Buffer.from(png));
 const newDb=new DatabaseSync(path.join(target,'shiqu.sqlite'),{readOnly:true});
 try{
  assert.equal(newDb.prepare('PRAGMA user_version').get().user_version,4);
  assert.ok(newDb.prepare("SELECT 1 FROM app_migrations WHERE name='0025_production_dag.sql'").get());
  const converted=decodeDocument(newDb.prepare('SELECT * FROM story_rows WHERE id=?').get(story));
  assert.deepEqual(converted.original,original);
  assert.equal(converted.dag.frames['legacy-1'].scene,plan.pages[0].caption);
 }finally{newDb.close();}
 const oldDb=new DatabaseSync(path.join(backup,'shiqu.sqlite'),{readOnly:true});
 try{assert.equal(oldDb.prepare('PRAGMA user_version').get().user_version,1);}
 finally{oldDb.close();}
 await t.test('matching v0.14.0 restores the original for rollback', {skip:!process.env.SHIQU_TEST_V014_ROOT},()=>{
  const oldRoot=process.env.SHIQU_TEST_V014_ROOT,rollback=path.join(f.root,'rollback');
  const oldCli=pathToFileURL(path.join(oldRoot,'server/cli.ts')).href;
  assert.equal(JSON.parse(readFileSync(path.join(oldRoot,'package.json'),'utf8')).version,'0.14.0');
  const script=`const {runCli}=await import(${JSON.stringify(oldCli)});await runCli(process.argv[1],process.argv.slice(2));`;
  execFileSync(process.execPath,['--no-warnings','--input-type=module','-e',script,oldRoot,'--restore',backup,'--data-dir',rollback],{cwd:f.root,env:f.env});
  const db=new DatabaseSync(path.join(rollback,'shiqu.sqlite'),{readOnly:true});
  try{
   assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
   assert.deepEqual(JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(story).document),doc);
  }finally{db.close();}
  assert.deepEqual(readFileSync(path.join(rollback,media)),Buffer.from(png));
 });
});

test('interrupted in-place migration keeps its original rollback dependency across retries',async t=>{
 const f=await fixture(t),library=f.library;
 f.sqlite.close();
 const latest=path.join(f.root,'drizzle','0026_backup_test.sql');
 writeFileSync(latest,'NOT VALID SQL');
 const {ensureLibraryReady}=await import('../server/library-upgrade.ts');
 assert.throws(()=>ensureLibraryReady(library,f.root),/LIBRARY_MIGRATION_FAILED/);
 const [original]=f.run('list').entries;
 assert.equal(original.deletion,'protected');
 assert.equal(original.deleteToken,undefined);
 assert.match(f.invoke('delete',{backup:original.path}).error,/仍需要此备份/);

 // 同格式的较旧应用看不见新迁移，仍必须保留正在使用的回退点。
 rmSync(latest);
 assert.throws(()=>ensureLibraryReady(library,f.root),/LIBRARY_NEWER_UPGRADER/);
 assert.equal(f.run('list').entries[0].deletion,'protected');

 writeFileSync(latest,'CREATE TABLE backup_test (value TEXT)');
 assert.equal(ensureLibraryReady(library,f.root).backup,original.path);
 const [completed]=f.run('list').entries;
 assert.equal(completed.path,original.path);
 assert.equal(completed.deletion,null);
 f.run('delete',{backup:completed.path,deleteToken:completed.deleteToken});
 assert.equal(existsSync(completed.path),false);
});

test('unattributed old upgrade backups are kept even when listed under another library',async t=>{
 const f=await fixture(t);
 f.sqlite.close();
 const oldPath=path.join(f.library+'-backups','pre-upgrade-old');
 f.run('create',{target:oldPath});
 writeFileSync(path.join(f.library,'.desktop-upgrade-result.json'),JSON.stringify({backup:oldPath}));
 const [old]=f.run('list').entries;
 assert.equal(old.deletion,'uncertain');
 assert.equal(old.deleteToken,undefined);
 assert.match(f.invoke('delete',{backup:oldPath}).error,/无法确认/);
 assert.ok(verifyLibraryBackup(oldPath));
});


test('recognizable legacy backups without origin can be deleted with explicit confirmation even if damaged',async t=>{
 const f=await fixture(t);
 f.sqlite.close();
 const name='pre-upgrade-2026-11-25T07-09-04-411Z-992b65fe';
 const backup=path.join(f.library+'-backups',name);
 f.run('create',{target:backup});
 const [listed]=f.run('list').entries;
 assert.equal(listed.deletion,'unattributed');
 assert.ok(listed.deleteToken);
 assert.match(f.invoke('delete',{backup,deleteToken:listed.deleteToken}).error,/重新确认/);
 assert.ok(existsSync(backup));

 const manifest=path.join(backup,'shiqu-backup.json');
 writeFileSync(manifest,'corrupt manifest');
 assert.match(f.invoke('delete',{backup,deleteToken:listed.deleteToken,confirmUnattributed:true}).error,/备份已变更/);
 const [damaged]=f.run('list').entries;
 assert.equal(damaged.deletion,'unattributed');
 assert.match(damaged.error,/备份清单损坏/);
 assert.ok(damaged.deleteToken);
 const {path:deleted}=f.run('delete',{backup,deleteToken:damaged.deleteToken,confirmUnattributed:true});
 assert.equal(deleted,backup);
 assert.equal(existsSync(backup),false);
 assert.ok(existsSync(path.join(f.library,'shiqu.sqlite')));
});

test('legacy confirmation protects rollback, shared roots, operation locks and origin changes',async t=>{
 const f=await fixture(t);
 f.sqlite.close();
 const name='pre-upgrade-2026-11-25T07-09-04-411Z-992b65fe';
 const root=f.library+'-backups',backup=path.join(root,name),origin=path.join(root,'.'+name+'.origin.json');
 f.run('create',{target:backup});
 const [missing]=f.run('list').entries;
 const request={backup,deleteToken:missing.deleteToken,confirmUnattributed:true};
 withBackupAccess(backup,()=>assert.match(f.invoke('delete',request).error,/备份正在使用/),true);

 const journal=path.join(f.library,'.desktop-upgrade.json');
 writeFileSync(journal,JSON.stringify({version:4,work:'.desktop-upgrade-12345678-1234-1234-1234-123456789012',backup}));
 assert.equal(f.run('list').entries[0].deletion,'protected');
 assert.match(f.invoke('delete',request).error,/仍需要此备份/);
 unlinkSync(journal);

 const migration=path.join(f.library,'.desktop-migration-backup.json');
 writeFileSync(migration,JSON.stringify({backup,migrations:['0028_production_spec.sql']}));
 assert.equal(f.run('list').entries[0].deletion,'protected');
 assert.match(f.invoke('delete',request).error,/仍需要此备份/);
 unlinkSync(migration);

 const report=path.join(f.library,'.desktop-upgrade-result.json');
 writeFileSync(report,JSON.stringify({backup}));
 assert.equal(f.run('list').entries[0].deletion,'protected');
 assert.match(f.invoke('delete',request).error,/仍需要此备份/);
 writeFileSync(report,'invalid JSON');
 assert.equal(f.run('list').entries[0].deletion,'uncertain');
 assert.match(f.invoke('delete',request).error,/无法确认/);
 unlinkSync(report);

 const alias=path.join(f.root,'another-library-backups');
 symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');
 assert.equal(f.run('list').entries[0].deletion,'uncertain');
 assert.match(f.invoke('delete',request).error,/无法确认/);
 unlinkSync(alias);

 writeFileSync(origin,JSON.stringify({library:path.join(f.root,'another-library')}));
 assert.equal(f.run('list').entries[0].deletion,'uncertain');
 assert.match(f.invoke('delete',request).error,/无法确认/);
 writeFileSync(origin,JSON.stringify({library:canonicalPath(f.library)}));
 const [matched]=f.run('list').entries;
 assert.equal(matched.deletion,null);
 assert.notEqual(matched.deleteToken,missing.deleteToken);
 assert.match(f.invoke('delete',request).error,/备份已变更/);
 unlinkSync(origin);
 assert.match(f.invoke('delete',{...request,deleteToken:matched.deleteToken}).error,/备份已变更/);
 assert.ok(verifyLibraryBackup(backup));

 const renamed=path.join(root,'retained-fixture');
 renameSync(backup,renamed);
 f.run('create',{target:backup});
 assert.match(f.invoke('delete',request).error,/备份已变更/);
 assert.ok(verifyLibraryBackup(renamed));
 assert.ok(verifyLibraryBackup(backup));
});
