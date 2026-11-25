// Exercise production maintenance with disposable real SQLite/media, including upgrade rollback and hostile archives.
import {historicalLibrary} from './fixtures/historical-library.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink,cp,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createLibraryBackup,verifyLibraryBackup,restoreLibraryBackup} from '../server/library-backup.ts';
import {openDatabase} from '../server/database.ts';
import {ownDesktopData} from '../server/desktop-owner.ts';
import {startupFixture,startFixtureCli} from './fixtures/startup.mjs';
import {productionFixture,until} from './fixtures/production.mjs';
import {createApplication} from '../server/app.ts';

async function simple(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-backup-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=path.join(root,'library'),backup=path.join(root,'backup'),restored=path.join(root,'restored');await mkdir(path.join(source,'media'),{recursive:true});
 const db=new DatabaseSync(path.join(source,'shiqu.sqlite'));db.exec("CREATE TABLE sentinel(value TEXT);INSERT INTO sentinel VALUES('preserved')");db.close();
 await writeFile(path.join(source,'media/image.webp'),Buffer.from([1,2,3,4]));return {root,source,backup,restored};
}
test('backup hashes complete SQLite/media and restore is exact without replacing any target',async t=>{
 const f=await simple(t);for(const name of ['.book-import-draft','.book-delete-my-0000000000000000','.book-replace-my-0000000000000000-00000000-0000-4000-8000-000000000001']){await mkdir(path.join(f.source,name),{recursive:true});await writeFile(path.join(f.source,name,'runtime'),'temporary');}
 const manifest=createLibraryBackup(f.source,f.backup,'0.6.6');assert.equal(manifest.files.length,2);verifyLibraryBackup(f.backup);
 restoreLibraryBackup(f.backup,f.restored);
 assert.deepEqual(await readFile(path.join(f.restored,'media/image.webp')),await readFile(path.join(f.source,'media/image.webp')));
 const db=new DatabaseSync(path.join(f.restored,'shiqu.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT value FROM sentinel').get().value,'preserved');db.close();
 assert.throws(()=>restoreLibraryBackup(f.backup,f.restored),/TARGET_EXISTS/);assert.throws(()=>createLibraryBackup(f.source,path.join(f.source,'nested')),/OVERLAPPING/);
 assert.throws(()=>restoreLibraryBackup(f.backup,f.root),/OVERLAPPING/);assert.throws(()=>createLibraryBackup(f.source,f.backup),/TARGET_EXISTS/);
 if(process.platform!=='win32')assert.equal((await stat(path.join(f.backup,'shiqu.sqlite'))).mode&0o777,0o600);
});
for(const kind of ['tampered','missing','extra','path','duplicate','symlink'])test('verification/restore reject '+kind+' without publishing a partial library',async t=>{
 const f=await simple(t);createLibraryBackup(f.source,f.backup);
 const image=path.join(f.backup,'media/image.webp'),filename=path.join(f.backup,'shiqu-backup.json');
 if(kind==='tampered')await writeFile(image,'bad');
 if(kind==='missing')await rm(image);
 if(kind==='extra')await writeFile(path.join(f.backup,'extra'),'extra');
 if(kind==='path'||kind==='duplicate'){const m=JSON.parse(await readFile(filename));if(kind==='path')m.files[1].path='../outside';else m.files.push(m.files[0]);await writeFile(filename,JSON.stringify(m));}
 if(kind==='symlink'){if(process.platform==='win32'){t.skip('Symlink creation requires platform privileges');return;}await rm(image);await symlink(path.join(f.source,'media/image.webp'),image);}
 assert.throws(()=>verifyLibraryBackup(f.backup));assert.throws(()=>restoreLibraryBackup(f.backup,f.restored));
 assert.ok(!(await readdir(f.root)).includes('restored'));assert.ok(!(await readdir(f.root)).some(n=>n.includes('.partial-')));
 assert.deepEqual(await readFile(path.join(f.source,'media/image.webp')),Buffer.from([1,2,3,4]));
});
test('pending migration creates verified old-schema backup once; failed snapshots do not change the source',async t=>{
 const f=await startupFixture(t),source=path.join(f.root,'library');historicalLibrary(source,f.root).close();let local;
 await writeFile(path.join(f.root,'drizzle/0017a_maintenance_probe.sql'),'CREATE TABLE maintenance_probe(value TEXT);');
 local=openDatabase(source,f.root);assert.ok(local.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='maintenance_probe'").get());local.close();
 const backups=path.join(f.root,'library-backups'),names=(await readdir(backups)).filter(name=>name.startsWith('pre-upgrade-'));assert.equal(names.length,1);const backup=path.join(backups,names[0]);verifyLibraryBackup(backup);
 restoreLibraryBackup(backup,path.join(f.root,'restored'));
 const old=new DatabaseSync(path.join(f.root,'restored/shiqu.sqlite'),{readOnly:true});assert.equal(old.prepare("SELECT name FROM sqlite_master WHERE name='maintenance_probe'").get(),undefined);old.close();
 local=openDatabase(source,f.root);local.close();assert.equal((await readdir(backups)).filter(name=>name.startsWith('pre-upgrade-')).length,1);
 // A real filesystem obstruction prevents even the next SQL migration from starting.
 const blocked=path.join(f.root,'blocked');historicalLibrary(blocked,f.root).close();await writeFile(path.join(f.root,'blocked-backups'),'obstruction');
 assert.throws(()=>openDatabase(blocked,f.root));const unchanged=new DatabaseSync(path.join(blocked,'shiqu.sqlite'),{readOnly:true});assert.equal(unchanged.prepare("SELECT name FROM sqlite_master WHERE name='must_not_appear'").get(),undefined);unchanged.close();
});
test('CLI maintenance refuses busy library and works without provider setup, preserving full production checkpoints',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create();await until(async()=>(await f.read(id)).state==='completed');
 const checkpoint=await f.json(`sessions/${id}/progress`,'POST',{page:3,saved:true});
 const before=f.app.services.database,row=await before.prepare('SELECT * FROM stories WHERE id=?').bind(id).first();
 await f.stop();
 const cli=await startupFixture(t),backup=path.join(cli.root,'backup'),restore=path.join(cli.root,'restored');
 const release=await ownDesktopData(f.dataDirectory);
 const busy=startFixtureCli(cli,['--data-dir',f.dataDirectory,'--backup',backup]);assert.notEqual(await busy.ended(),0);assert.match(busy.output(),/DATA_BUSY/);await release();
 const run=startFixtureCli(cli,['--data-dir',f.dataDirectory,'--backup',backup]);assert.equal(await run.ended(),0,run.output());
 const verify=startFixtureCli(cli,['--verify-backup',backup]);assert.equal(await verify.ended(),0,verify.output());
 const missingDestination=startFixtureCli(cli,['--restore',backup]);assert.notEqual(await missingDestination.ended(),0);
 const recovery=startFixtureCli(cli,['--restore',backup,'--data-dir',restore]);assert.equal(await recovery.ended(),0,recovery.output());
 const app=createApplication({root:f.root,dataDirectory:restore,variables:{SHIQU_AI_PROVIDER:'readonly'}});t.after(()=>app.close());
 assert.deepEqual(await app.services.database.prepare('SELECT * FROM stories WHERE id=?').bind(id).first(),row);
 const mediaKey=checkpoint.story.pages[0].image.replace('/api/reader/media/','reader/');assert.deepEqual(await readFile(path.join(restore,'media',mediaKey)),await readFile(path.join(f.dataDirectory,'media',mediaKey)));
 assert.equal(app.services.production.busy,false);
});
