// Exercise real persistence and HTTP contracts without provider billing or a Cloudflare runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,symlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createApplication} from '../server/app.ts';
import {createHttpServer} from '../server/http.ts';
import {openDatabase} from '../server/database.ts';
import {FileMedia} from '../server/media.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {importLegacy} from '../server/import-legacy.ts';
import {stories} from '../db/schema.ts';
import {eq} from 'drizzle-orm';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu node test '));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp('drizzle',path.join(root,'drizzle'),{recursive:true});await mkdir(path.join(root,'docker'));
 await cp('docker/seed.sql',path.join(root,'docker/seed.sql'));await mkdir(path.join(root,'dist/client/assets'),{recursive:true});
 await writeFile(path.join(root,'dist/client/index.html'),'<html lang="zh-CN"><div id="root">reader shell</div></html>');
 await writeFile(path.join(root,'dist/client/assets/test.js'),'console.log("public")');
 return {root,dataDirectory:path.join(root,'mounted data')};
}
function request(app,url,method='GET',value,headers={}){
 return app.handle(new Request('http://localhost'+url,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...headers},body:value?JSON.stringify(value):undefined}));
}
test('SQLite initialization and seed are idempotent and preserve edited rows and raw SQL checkpoints',async t=>{
 const options=await fixture(t);let app=createApplication(options);
 let sample=(await (await request(app,'/api/stories')).json())[0];assert.equal(sample.pages.length,10);
 await app.services.db.update(stories).set({title:'preserved title'}).where(eq(stories.id,sample.id));
 await request(app,'/api/me/progress','POST',{storyId:sample.id,page:4,saved:true},{'oai-authenticated-user-id':'spoofed'});
 const repo=new ReaderRepository(app.services.database);const id=crypto.randomUUID();
 await repo.create(id,'docker-local-owner',{bookId:'zhuangzi',theme:'放下执念',length:8,voice:false});
 await app.services.media.put(`reader/${id}/source.json`,new TextEncoder().encode('{"title":"saved"}'),{contentType:'application/json'});
 app.close();app=createApplication(options);
 try{
  sample=(await (await request(app,'/api/stories')).json())[0];assert.equal(sample.title,'preserved title');
  const progress=await (await request(app,'/api/me/progress')).json();assert.equal(progress[0].page,4);assert.equal(progress[0].userId,'docker-local-owner');
  assert.equal((await request(app,'/api/reader/sessions/'+id)).status,200);
  assert.equal(new TextDecoder().decode((await app.services.media.get(`reader/${id}/source.json`)).body),'{"title":"saved"}');
  assert.equal((await (await request(app,'/api/reader/status')).json()).configured,false);
  await request(app,'/api/reader/library/'+sample.id,'DELETE');assert.equal((await (await request(app,'/api/stories')).json()).length,0);
  await request(app,'/api/reader/library/'+sample.id+'/restore','POST',{});assert.equal((await (await request(app,'/api/stories')).json()).length,1);
 }finally{app.close();}
});
test('failed migrations roll back DDL and can retry after the migration is corrected',async t=>{
 const {root,dataDirectory}=await fixture(t);await writeFile(path.join(root,'drizzle/0003_test.sql'),'CREATE TABLE retry_probe(id TEXT); INVALID SQL;');
 assert.throws(()=>openDatabase(dataDirectory,root));
 const database=new DatabaseSync(path.join(dataDirectory,'shiqu.sqlite'));
 assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name='retry_probe'").get(),undefined);database.close();
 await writeFile(path.join(root,'drizzle/0003_test.sql'),'CREATE TABLE retry_probe(id TEXT);');
 const local=openDatabase(dataDirectory,root);assert.equal(local.sqlite.prepare('SELECT COUNT(*) AS n FROM app_migrations').get().n,4);local.close();
});
test('HTTP serves SPA deep links and binary uploads, blocks origin writes, and never serves private data',async t=>{
 const options=await fixture(t),app=createApplication(options),server=createHttpServer(app.handle);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));app.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 assert.match(await (await fetch(origin+'/read?id=sample')).text(),/reader shell/);
 for(const url of ['/missing.js','/assets/missing.js','/.env','/data/shiqu.sqlite','/api/missing','/api/reader/missing'])assert.equal((await fetch(origin+url)).status,404,url);
 assert.equal((await fetch(origin+'/api/reader/library/sample',{method:'DELETE',headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(origin+'/api/me/progress',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'})).status,403);
 const form=new FormData(),bytes=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);form.append('file',new File([bytes],'test.png',{type:'image/png'}));
 const uploaded=await fetch(origin+'/api/admin/upload',{method:'POST',body:form});assert.equal(uploaded.status,200);
 const {url}=await uploaded.json(),media=await fetch(origin+url);assert.equal(media.headers.get('content-type'),'image/png');assert.deepEqual(new Uint8Array(await media.arrayBuffer()),bytes);
 const oversized=await fetch(origin+'/api/admin/upload',{method:'POST',body:new Uint8Array(14*1024*1024)});assert.equal(oversized.status,413);
 assert.equal((await fetch(origin+'/api/stories',{method:'HEAD'})).headers.get('content-type')?.includes('json'),true);
});
test('media validates keys, MIME and symlinks; replacing files is atomic and leaves no temporary file',async t=>{
 const {root}=await fixture(t),store=new FileMedia(path.join(root,'media'));
 for(const key of ['../secret','/secret','reader/../../secret','reader//file','reader/./file'])await assert.rejects(store.put(key,new Uint8Array([1]),{contentType:'image/png'}));
 await assert.rejects(store.put('reader/a.png',new Uint8Array([1]),{contentType:'text/html'}));
 await store.put('reader/a.png',new Uint8Array([1,2]),{contentType:'image/png'});await store.put('reader/a.png',new Uint8Array([3,4]),{contentType:'image/png'});
 assert.deepEqual((await store.get('reader/a.png')).body,new Uint8Array([3,4]));assert.equal(await store.get('reader/missing.png'),null);
 await writeFile(path.join(root,'private.png'),'private');await symlink(path.join(root,'private.png'),path.join(root,'media/reader/link.png'));
 await assert.rejects(store.get('reader/link.png'));await symlink(root,path.join(root,'media/outside'));await assert.rejects(store.get('outside/private.png'));
 assert.ok((await readdir(path.join(root,'media/reader'))).every(name=>!name.endsWith('.tmp')));
});
test('real SQLite locks prevent duplicate paid requests through concurrent REST advances and survive restart',async t=>{
 const options=await fixture(t);let calls=0,release;const hold=new Promise(resolve=>release=resolve);
 const plan={title:'庄周梦蝶',hook:'梦醒之后',sourceReference:'《庄子·齐物论》庄周梦蝶',adaptationNote:'现代改编',reflection:'谁在梦中？',characters:'An adult Chinese philosopher in a plain linen robe in ancient China.',pages:Array.from({length:8},()=>({caption:'庄周梦见自己成为一只蝴蝶，自由自在地飞来飞去。',prompt:'An adult philosopher dreams of becoming a butterfly in an ancient garden.'}))};
 options.variables={GEMINI_API_KEY:'mock-only'};options.transport=async()=>{calls++;await hold;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(plan)}]}}]});};
 let app=createApplication(options);const id=crypto.randomUUID();
 await request(app,'/api/reader/sessions','POST',{requestId:id,selection:{bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'放下执念',length:8,voice:false}});
 const first=request(app,`/api/reader/sessions/${id}/advance`,'POST',{throughPage:0});
 while(!calls)await new Promise(resolve=>setImmediate(resolve));
 const duplicate=await request(app,`/api/reader/sessions/${id}/advance`,'POST',{throughPage:0});assert.equal(duplicate.status,202);assert.equal(calls,1);
 release();assert.equal((await first).status,200);assert.equal(calls,1);app.close();app=createApplication(options);
 try{const row=await (await request(app,'/api/reader/sessions/'+id)).json();assert.equal(row.state,'idle');assert.ok(row.story.sourceText);assert.equal(row.story.pages[0].image,'');assert.equal(calls,1);}
 finally{app.close();}
});
async function legacyFixture(t){
 const options=await fixture(t),source=path.join(options.root,'legacy'),v3=path.join(source,'v3');
 await mkdir(path.join(v3,'d1/miniflare-D1DatabaseObject'),{recursive:true});await mkdir(path.join(v3,'r2/miniflare-R2BucketObject'),{recursive:true});await mkdir(path.join(v3,'r2/shiqu-media/blobs'),{recursive:true});
 const initial=openDatabase(options.dataDirectory,options.root);initial.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');initial.close();
 const databaseFile=path.join(v3,'d1/miniflare-D1DatabaseObject/database.sqlite');await cp(path.join(options.dataDirectory,'shiqu.sqlite'),databaseFile);
 const database=new DatabaseSync(databaseFile);database.exec("DROP TABLE app_migrations; CREATE TABLE d1_migrations(name TEXT);");for(const name of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')))database.prepare('INSERT INTO d1_migrations VALUES(?)').run(name);
 database.exec("UPDATE stories SET title='imported story'; INSERT INTO progress VALUES('docker-local-owner:test','docker-local-owner','test',3,1,'2026-10-27')");database.close();
 const metadataFile=path.join(v3,'r2/miniflare-R2BucketObject/bucket.sqlite'),metadata=new DatabaseSync(metadataFile);metadata.exec('CREATE TABLE _mf_objects(key TEXT,blob_id TEXT,size INTEGER,http_metadata TEXT)');
 const bytes=new Uint8Array([137,80,78,71]);metadata.prepare('INSERT INTO _mf_objects VALUES(?,?,?,?)').run('reader/story/0.png','blob-id',bytes.length,'{"contentType":"image/png"}');metadata.close();await writeFile(path.join(v3,'r2/shiqu-media/blobs/blob-id'),bytes);
 return {...options,source,databaseFile,metadataFile,bytes,target:path.join(options.root,'new data')};
}
test('offline importer preserves records, identities, media keys and source bytes and prevents migration replay',async t=>{
 const fixture=await legacyFixture(t),before=await readFile(fixture.databaseFile),metadataBefore=await readFile(fixture.metadataFile);
 const result=await importLegacy(fixture.source,fixture.target,fixture.root);assert.equal(result.mediaObjects,1);
 assert.deepEqual(await readFile(fixture.databaseFile),before);assert.deepEqual(await readFile(fixture.metadataFile),metadataBefore);
 const app=createApplication({root:fixture.root,dataDirectory:fixture.target});
 try{assert.equal((await (await request(app,'/api/stories')).json())[0].title,'imported story');assert.equal((await (await request(app,'/api/me/progress')).json())[0].userId,'docker-local-owner');assert.deepEqual((await app.services.media.get('reader/story/0.png')).body,fixture.bytes);}
 finally{app.close();}
 await assert.rejects(importLegacy(fixture.source,fixture.target,fixture.root),/empty/);
});
test('import failure keeps destination absent and rejects live WAL, missing blobs and unsupported multipart objects',async t=>{
 for(const mode of ['wal','blob','multipart']){
  const f=await legacyFixture(t);
  if(mode==='wal')await writeFile(f.databaseFile+'-wal','uncheckpointed');
  if(mode==='blob')await rm(path.join(f.source,'v3/r2/shiqu-media/blobs/blob-id'));
  if(mode==='multipart'){const db=new DatabaseSync(f.metadataFile);db.exec('UPDATE _mf_objects SET blob_id=NULL');db.close();}
  await assert.rejects(importLegacy(f.source,f.target,f.root));
  assert.equal((await readdir(f.root)).some(name=>name.startsWith('new data')),false);
 }
});
