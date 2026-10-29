// Directory resolution must reuse native data without ever reading or creating a key store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {developmentLibraryDirectory} from '../server/library-directory.ts';
async function fixture(t){const home=await mkdtemp(path.join(os.tmpdir(),'shiqu shared-home '));t.after(()=>rm(home,{recursive:true,force:true}));return home;}
test('native platform defaults share the desktop app-data library',async t=>{
 const home=await fixture(t);
 assert.equal(developmentLibraryDirectory({home,platform:'darwin',variables:{}}),path.join(home,'Library/Application Support/com.shiqu.desktop/library'));
 assert.equal(developmentLibraryDirectory({home,platform:'linux',variables:{}}),path.join(home,'.local/share/com.shiqu.desktop/library'));
 assert.equal(developmentLibraryDirectory({home,platform:'linux',variables:{XDG_DATA_HOME:path.join(home,'custom-data')}}),path.join(home,'custom-data/com.shiqu.desktop/library'));
 assert.equal(developmentLibraryDirectory({home:'C:\\Users\\reader',platform:'win32',variables:{}}),'C:\\Users\\reader\\AppData\\Roaming\\com.shiqu.desktop\\library');
});
test('saved desktop library is read without a credentials table and an explicit override wins',async t=>{
 const home=await fixture(t),folder=path.join(home,'Library/Application Support/com.shiqu.desktop');await mkdir(folder,{recursive:true});
 const filename=path.join(folder,'desktop.sqlite'),db=new DatabaseSync(filename),library=path.join(home,'personal stories');
 db.exec('CREATE TABLE desktop_settings(id INTEGER PRIMARY KEY,value TEXT)');db.prepare('INSERT INTO desktop_settings VALUES(1,?)').run(JSON.stringify({dataDirectory:library}));db.close();
 assert.equal(developmentLibraryDirectory({home,platform:'darwin',variables:{}}),library);
 assert.equal(developmentLibraryDirectory({home,platform:'darwin',variables:{SHIQU_DATA_DIR:path.join(home,'explicit')}}),path.join(home,'explicit'));
 const check=new DatabaseSync(filename,{readOnly:true});assert.equal(check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n,1);check.close();
});
test('malformed saved settings fail without silently switching libraries or echoing private values',async t=>{
 const home=await fixture(t),folder=path.join(home,'.config/com.shiqu.desktop');await mkdir(folder,{recursive:true});const filename=path.join(folder,'desktop.sqlite');
 const db=new DatabaseSync(filename);db.exec('CREATE TABLE desktop_settings(id INTEGER PRIMARY KEY,value TEXT)');db.prepare('INSERT INTO desktop_settings VALUES(1,?)').run('private-invalid-json');
 assert.throws(()=>developmentLibraryDirectory({home,platform:'linux',variables:{}}),error=>error.message.includes('SHIQU_DATA_DIR')&&!error.message.includes('private-invalid-json'));
 db.prepare('UPDATE desktop_settings SET value=?').run(JSON.stringify({dataDirectory:'relative-library'}));db.close();
 assert.throws(()=>developmentLibraryDirectory({home,platform:'linux',variables:{}}));
 assert.equal(developmentLibraryDirectory({home,platform:'linux',variables:{SHIQU_DATA_DIR:path.join(home,'explicit')}}),path.join(home,'explicit'));
});
