// 用桌面私有维护协议和隔离书库验证备份生命周期、删除保护及格式 V1 的恢复。
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {chmodSync,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startupFixture} from './fixtures/startup.mjs';
import {historicalLibrary} from './fixtures/historical-library.mjs';
import {makePlan,selection} from './fixtures/production-data.mjs';
import {png} from './fixtures/images.mjs';
import {ownDesktopDataSync} from '../server/desktop-owner.ts';
import {verifyLibraryBackup,withBackupAccess} from '../server/library-backup.ts';

const entry=fileURLToPath(new URL('../server/desktop.ts',import.meta.url));

async function fixture(t,through='0025_production_dag.sql'){
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
 assert.match(f.invoke('delete',{backup:external,createdAt:saved.createdAt}).error,/无法确认/);
 const request={backup:saved.path,createdAt:saved.createdAt};
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
 assert.match(f.invoke('delete',{...request,createdAt:'2000-01-01T00:00:00.000Z'}).error,/备份已变更/);
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
 const expectedStatus={version:1,state:'migration',migrations:['0025_production_dag.sql']};
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
 writeFileSync(migration,sql);
 assert.deepEqual(f.run('restore',{backup,target}),{path:target});
 assert.deepEqual(f.run('inspect',{backup}).compatibility,expectedStatus);
 assert.deepEqual(readFileSync(path.join(backup,'shiqu-backup.json')),originalManifest);
 assert.deepEqual(verifyLibraryBackup(backup),manifest);
 assert.deepEqual(readFileSync(path.join(target,media)),Buffer.from(png));
 const newDb=new DatabaseSync(path.join(target,'shiqu.sqlite'),{readOnly:true});
 try{
  assert.equal(newDb.prepare('PRAGMA user_version').get().user_version,2);
  assert.ok(newDb.prepare("SELECT 1 FROM app_migrations WHERE name='0025_production_dag.sql'").get());
  const converted=JSON.parse(newDb.prepare('SELECT document FROM stories WHERE id=?').get(story).document);
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
 assert.match(f.invoke('delete',{backup:original.path,createdAt:original.createdAt}).error,/仍需要此备份/);

 // 同格式的较旧应用看不见新迁移，仍必须保留正在使用的回退点。
 rmSync(latest);
 assert.throws(()=>ensureLibraryReady(library,f.root),/LIBRARY_NEWER_UPGRADER/);
 assert.equal(f.run('list').entries[0].deletion,'protected');

 writeFileSync(latest,'CREATE TABLE backup_test (value TEXT)');
 assert.equal(ensureLibraryReady(library,f.root).backup,original.path);
 const [completed]=f.run('list').entries;
 assert.equal(completed.path,original.path);
 assert.equal(completed.deletion,null);
 f.run('delete',{backup:completed.path,createdAt:completed.createdAt});
 assert.equal(existsSync(completed.path),false);
});

test('unattributed old upgrade backups are kept even when listed under another library',async t=>{
 const f=await fixture(t);
 f.sqlite.close();
 const oldPath=path.join(f.library+'-backups','pre-upgrade-old');
 const saved=f.run('create',{target:oldPath});
 writeFileSync(path.join(f.library,'.desktop-upgrade-result.json'),JSON.stringify({backup:oldPath}));
 assert.equal(f.run('list').entries[0].deletion,'uncertain');
 assert.match(f.invoke('delete',{backup:oldPath,createdAt:saved.createdAt}).error,/无法确认/);
 assert.ok(verifyLibraryBackup(oldPath));
});
