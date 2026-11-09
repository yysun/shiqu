// 不调用外部 AI，以隔离数据验证正式存储与 HTTP 契约；按需复制原著。
import {copyBookLibrary} from './fixtures/book-library.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,symlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createApplication,liveReaderProvider} from '../server/app.ts';
import {StoryDiscoveryCache} from '../server/story-discovery-cache.ts';
import {createHttpServer} from '../server/http.ts';
import {openDatabase} from '../server/database.ts';
import {FileMedia} from '../server/media.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {LocalBooks} from '../server/local-books.ts';
import {importLegacy} from '../server/import-legacy.ts';
import {historicalLibrary,insertStudio} from './fixtures/historical-library.mjs';
import {makeStory,insertReaderStory} from './fixtures/story.mjs';

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
test('SQLite reopen preserves current reader checkpoints, media, owner identity and recovery',async t=>{
 const options=await fixture(t);let app=createApplication(options);
 assert.deepEqual(await (await request(app,'/api/reader/sessions')).json(),[]);
 const sample=await insertReaderStory(app);
 await app.services.database.prepare("UPDATE stories SET selection=json_set(selection,'$.displayTitle','preserved title') WHERE id=?").bind(sample.id).run();
 assert.equal((await request(app,'/api/reader/sessions/'+sample.id+'/progress','POST',{page:4,saved:true},{'oai-authenticated-user-id':'spoofed'})).status,200);
 await app.services.media.put(`reader/${sample.id}/source.json`,new TextEncoder().encode('{"title":"saved"}'),{contentType:'application/json'});
 app.close();app=createApplication(options);
 try{
  const row=(await (await request(app,'/api/reader/sessions')).json())[0];assert.equal(row.story.title,'preserved title');assert.equal(row.page,4);assert.equal(row.saved,true);
  assert.equal((await app.services.database.prepare('SELECT user_id FROM stories WHERE id=?').bind(sample.id).first()).user_id,'docker-local-owner');
  assert.equal(new TextDecoder().decode((await app.services.media.get(`reader/${sample.id}/source.json`)).body),'{"title":"saved"}');
  assert.equal((await (await request(app,'/api/reader/status')).json()).configured,false);
  await request(app,'/api/reader/library/'+sample.id,'DELETE');assert.equal((await (await request(app,'/api/reader/sessions')).json()).length,0);
  await request(app,'/api/reader/library/'+sample.id+'/restore','POST',{});assert.equal((await (await request(app,'/api/reader/sessions')).json()).length,1);
 }finally{app.close();}
});
test('failed migrations roll back DDL and can retry after the migration is corrected',async t=>{
 const {root,dataDirectory}=await fixture(t);await writeFile(path.join(root,'drizzle/0003_test.sql'),'CREATE TABLE retry_probe(id TEXT); INVALID SQL;');
 assert.throws(()=>openDatabase(dataDirectory,root));
 assert.equal((await readdir(dataDirectory)).includes('shiqu.sqlite'),false);
 await writeFile(path.join(root,'drizzle/0003_test.sql'),'CREATE TABLE retry_probe(id TEXT);');
 const local=openDatabase(dataDirectory,root);assert.equal(local.sqlite.prepare('SELECT COUNT(*) AS n FROM app_migrations').get().n,(await readdir(path.join(root,'drizzle'))).filter(name=>name.endsWith('.sql')).length);local.close();
});
test('HTTP serves SPA deep links and binary uploads, blocks origin writes, and never serves private data',async t=>{
 const options=await fixture(t),app=createApplication(options),server=createHttpServer(app.handle);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));app.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 assert.match(await (await fetch(origin+'/read?id=sample')).text(),/reader shell/);
 for(const url of ['/missing.js','/assets/missing.js','/.env','/data/shiqu.sqlite','/api/missing','/api/reader/missing'])assert.equal((await fetch(origin+url)).status,404,url);
 assert.equal((await fetch(origin+'/api/reader/library/sample',{method:'DELETE',headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(origin+'/api/reader/sessions/'+crypto.randomUUID()+'/progress',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'})).status,403);
 const bytes=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
 await app.services.media.put('saved.png',bytes,{contentType:'image/png'});
 const media=await fetch(origin+'/api/media/saved.png');assert.equal(media.headers.get('content-type'),'image/png');assert.deepEqual(new Uint8Array(await media.arrayBuffer()),bytes);
 assert.equal((await fetch(origin+'/api/admin/upload',{method:'POST'})).status,404);

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
 const plan={title:'庄周梦蝶',summary:'梦醒之后',sourceReference:'《庄子·齐物论》庄周梦蝶',adaptationNote:'现代改编',reflection:'谁在梦中？',characters:'An adult Chinese philosopher in a plain linen robe in ancient China.',pages:Array.from({length:8},()=>({caption:'庄周梦见自己成为一只蝴蝶，自由自在地飞来飞去。',prompt:'An adult philosopher dreams of becoming a butterfly in an ancient garden.'}))};
 await copyBookLibrary(options.root,['zhuangzi']);
 const book=await new LocalBooks(options.root).book({bookId:'zhuangzi'}),section=book.sections[1],unit=section.units.at(-1);
 const source={edition:book.edition,sectionId:section.id,firstUnit:unit.id,lastUnit:unit.id};
 options.variables={GEMINI_API_KEY:'mock-only'};options.transport=async(_url,init)=>{calls++;await hold;const body=JSON.parse(init.body),schema=body.generationConfig.responseFormat.text.schema;if(schema.properties.candidates)await app.services.database.prepare("UPDATE stories SET generation_control='paused' WHERE id=?").bind(id).run();const result=schema.properties.count?{count:8,reason:'按完整故事编排。',storySummary:plan.summary,storyMatchReason:'按原文主线展开。'}:schema.properties.candidates?{title:plan.title,candidates:[plan.reflection,'醒来之后，梦中的自在仍值得回味。','梦与醒的分界，也未必是心境的分界。']}:plan;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]});};
 let app=createApplication(options);const id=crypto.randomUUID();
 await request(app,'/api/reader/sessions','POST',{requestId:id,selection:{bookId:'zhuangzi',storyTitle:'庄周梦蝶',source,theme:'放下执念',length:8,voice:false}});
 await app.services.database.prepare("UPDATE stories SET generation_mode='reader' WHERE id=?").bind(id).run();
 const first=request(app,`/api/reader/sessions/${id}/advance`,'POST',{throughPage:0});
 while(!calls)await new Promise(resolve=>setImmediate(resolve));
 const duplicate=await request(app,`/api/reader/sessions/${id}/advance`,'POST',{throughPage:0});assert.equal(duplicate.status,202);assert.equal(calls,1);
 release();assert.equal((await first).status,202);let ready;const deadline=Date.now()+10000;do{ready=await(await request(app,'/api/reader/sessions/'+id)).json();if(ready.story)break;assert.notEqual(ready.state,'failed',JSON.stringify(ready));assert.ok(Date.now()<deadline);await new Promise(resolve=>setImmediate(resolve));}while(!ready.story);assert.equal(calls,3);await app.close();app=createApplication(options);
 try{const row=await (await request(app,'/api/reader/sessions/'+id)).json();assert.equal(row.state,'idle');assert.ok(row.story.sourceText);assert.equal(row.generationProgress.phase,'review');assert.equal(calls,3);
 const finished=await(await request(app,`/api/reader/sessions/${id}/advance`,'POST',{throughPage:0})).json();assert.ok(finished.story.sourceText);assert.equal(finished.story.pages[0].image,'');assert.equal(calls,3);}
 finally{app.close();}
});
async function legacyFixture(t){
 const options=await fixture(t),source=path.join(options.root,'legacy'),v3=path.join(source,'v3');
 await mkdir(path.join(v3,'d1/miniflare-D1DatabaseObject'),{recursive:true});await mkdir(path.join(v3,'r2/miniflare-R2BucketObject'),{recursive:true});await mkdir(path.join(v3,'r2/shiqu-media/blobs'),{recursive:true});
 const initial=historicalLibrary(options.dataDirectory,options.root);const saved=makeStory();saved.pages=saved.pages.map(p=>({...p,image:''}));insertStudio(initial,saved);
 initial.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,created_at,updated_at) VALUES('current','docker-local-owner','{\"bookId\":\"zhuangzi\",\"theme\":\"test\",\"length\":8,\"voice\":false,\"artStyle\":\"ink-pencil\",\"productionPrompt\":\"\"}','{\"images\":[],\"audio\":[]}', 'date','date')").run();initial.close();
 const databaseFile=path.join(v3,'d1/miniflare-D1DatabaseObject/database.sqlite');await cp(path.join(options.dataDirectory,'shiqu.sqlite'),databaseFile);
 const database=new DatabaseSync(databaseFile);database.exec("DROP TABLE app_migrations; CREATE TABLE d1_migrations(name TEXT);");for(const name of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')&&!f.startsWith('0018_')))database.prepare('INSERT INTO d1_migrations VALUES(?)').run(name);
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
 try{assert.equal((await app.services.database.prepare('SELECT id FROM stories').first()).id,'current');assert.equal((await app.services.database.prepare("SELECT name FROM sqlite_schema WHERE name='progress'").first()),null);assert.deepEqual((await app.services.media.get('reader/story/0.png')).body,fixture.bytes);assert.equal((await (await request(app,'/api/reader/sessions')).json()).length,1);}
 finally{app.close();}
 await assert.rejects(importLegacy(fixture.source,fixture.target,fixture.root),/empty/);
});
test('offline importer upgrades a pre-summary legacy database without requiring the local-only migration',async t=>{
 const f=await legacyFixture(t),db=new DatabaseSync(f.databaseFile);
 db.exec("ALTER TABLE stories RENAME COLUMN summary TO hook; DROP TABLE book_image_references; DROP TRIGGER IF EXISTS book_image_reference_on_delete; DELETE FROM d1_migrations WHERE name IN('0009_story_summary.sql','0010_book_image_references.sql')");db.close();const before=await readFile(f.databaseFile);
 await importLegacy(f.source,f.target,f.root);assert.deepEqual(await readFile(f.databaseFile),before);
 const local=openDatabase(f.target,f.root);assert.ok(local.sqlite.prepare('PRAGMA table_info(stories)').all().some(column=>column.name==='document'));assert.equal(local.sqlite.prepare('SELECT id FROM stories').get().id,'current');assert.equal(local.sqlite.prepare('SELECT count(*) n FROM book_image_references').get().n,0);local.close();
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

test('retired studio rows are discarded before reopen and have no runtime API',async t=>{
 const options=await fixture(t),old=historicalLibrary(options.dataDirectory,options.root),initial=insertStudio(old);old.close();
 const app=createApplication(options);t.after(()=>app.close());
 for(const [route,method] of [['/api/stories','GET'],['/api/admin/stories/'+initial.id,'GET'],['/api/admin/stories/'+initial.id,'PUT'],['/api/admin/stories','POST'],['/api/admin/generate','POST']])assert.equal((await request(app,route,method,method==='GET'?undefined:{})).status,404);
 assert.deepEqual(await (await request(app,'/api/reader/sessions')).json(),[]);
 assert.equal(await app.services.database.prepare('SELECT * FROM stories WHERE id=?').bind(initial.id).first(),null);
});
test('single-owner shelf returns more than 80 stories and keeps hidden stories excluded',async t=>{
 const app=createApplication(await fixture(t));t.after(()=>app.close());const repo=new ReaderRepository(app.services.database),ids=[];
 for(let i=0;i<85;i++){
  const id=crypto.randomUUID();ids.push(id);
  await repo.create(id,app.services.ownerId,{bookId:'zhuangzi',theme:'test',length:8,voice:false});
 }
 await repo.remove(ids[0],app.services.ownerId);
 const response=await request(app,'/api/reader/sessions');assert.equal(response.status,200);const rows=await response.json();
 assert.equal(rows.length,84);assert.equal(rows.some(row=>row.id===ids[0]),false);
 await repo.restore(ids[0],app.services.ownerId);
 assert.equal((await (await request(app,'/api/reader/sessions')).json()).length,85);
});


test('live configuration failures do not break shelf reads and readonly services remain able to accept settings',async t=>{
 const options=await fixture(t);let fail=false,variables={...options.variables,SHIQU_AI_PROVIDER:'readonly'};
 const app=createApplication({...options,variables,providerVariables:()=>{if(fail)throw Error('private-settings-failure');return variables;}});t.after(()=>app.close());
 assert.equal((await(await request(app,'/api/reader/status')).json()).provider,'readonly');
 variables={...variables,SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'synthetic-key',GEMINI_TEXT_MODEL:'new-model'};
 assert.equal((await(await request(app,'/api/reader/status')).json()).models.text,'new-model');assert.equal(app.services.production.stopping,false);
 fail=true;assert.equal((await request(app,'/api/reader/status')).status,503);assert.equal((await request(app,'/api/reader/sessions')).status,200);
});

test('old discovery flights remain visible and settle without rereading broken live settings',async t=>{
 const options=await fixture(t),cache=new StoryDiscoveryCache(new FileMedia(path.join(options.dataDirectory,'media')));let variables={SHIQU_AI_PROVIDER:'codex',CODEX_MODEL:'old'},fail=false,release;
 const live=liveReaderProvider(variables,()=>{if(fail)throw Error('private-settings-failure');return variables;},values=>({status:async()=>({provider:'codex',models:{text:values.CODEX_MODEL,image:''}}),safeError:()=>values.CODEX_MODEL,discoveryBusy:()=>cache.busy,settleDiscovery:()=>cache.settle()}));
 const flight=cache.shared('old-flight',undefined,()=>new Promise(resolve=>{release=resolve;}));
 await new Promise(resolve=>setImmediate(resolve));variables={...variables,CODEX_MODEL:'new'};assert.equal((await live.status()).models.text,'new');assert.equal(live.discoveryBusy(),true);
 fail=true;assert.equal(live.safeError(Error('controlled')),'new');let settled=false;const drain=live.settleDiscovery().then(()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
 release('done');await Promise.all([drain,flight]);assert.equal(live.discoveryBusy(),false);assert.throws(()=>live.capture(),error=>error.status===503&&!error.message.includes('private-settings-failure'));
});


test('paid API calls reject a null captured provider without consulting the live facade',async t=>{
 const options=await fixture(t),app=createApplication({...options,production:{autoStart:false}});t.after(()=>app.close());let captured=0,status=0,calls=0;
 app.services.generation={capture(){captured++;return null;},status:async()=>{status++;return {configured:true,provider:'gemini',models:{text:'must-not-run',image:''}};},suggestions:async()=>{calls++;throw Error('must not call');},recommendArt:async()=>{calls++;throw Error('must not call');}};
 for(const route of ['suggestions','art-recommendation','sessions'])assert.equal((await request(app,'/api/reader/'+route,'POST',{})).status,503);
 assert.equal(captured,3);assert.equal(status,0);assert.equal(calls,0);
 assert.deepEqual(await(await request(app,'/api/reader/sessions')).json(),[]);
});

test('invalid live API-key overrides never dispatch direct suggestions or art requests',async t=>{
 const options=await fixture(t);let calls=0;const variables={SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'bad\nkey'};
 const app=createApplication({...options,variables,providerVariables:()=>variables,production:{autoStart:false},transport:async()=>{calls++;throw Error('must not send invalid credential');}});t.after(()=>app.close());
 const status=await(await request(app,'/api/reader/status')).json();assert.equal(status.configured,false);
 for(const route of ['suggestions','art-recommendation','sessions'])assert.equal((await request(app,'/api/reader/'+route,'POST',{})).status,503);
 assert.equal(calls,0);
});

test('shelf summarizes current editions and sends only changed cards or removals',async t=>{
 const app=createApplication({...await fixture(t),variables:{SHIQU_AI_PROVIDER:'readonly'},production:{autoStart:false}});
 t.after(()=>app.close());
 const db=app.services.database,path='/api/reader/library/shelf';
 const read=async(method='GET',body)=>{
  const response=await request(app,path,method,body);assert.equal(response.status,200);return response.json();
 };
 const root=await insertReaderStory(app),next=await insertReaderStory(app,{...makeStory(4),title:'第二版'});
 const draft=await insertReaderStory(app,{...makeStory(4),title:'制作中'});
 const foreign=await insertReaderStory(app);
 await db.prepare("UPDATE stories SET document=json_set(document,'$.revision',json(?)) WHERE id=?").bind(JSON.stringify({rootId:root.id,parentId:root.id,number:2}),next.id).run();
 await db.prepare("UPDATE stories SET user_id='other-owner' WHERE id=?").bind(foreign.id).run();
 await db.prepare("UPDATE stories SET state='idle',generation_control='paused' WHERE id=?").bind(draft.id).run();
 await request(app,'/api/reader/sessions/'+next.id+'/progress','POST',{page:2,saved:false});
 const cards=await read();
 assert.deepEqual(new Set(cards.map(row=>row.id)),new Set([next.id,draft.id]));
 const card=cards.find(row=>row.id===next.id);
 assert.equal(card.story.frameCount,4);assert.equal(card.story.resumeImage,next.pages[2].image);
 for(const key of ['pages','sourceText','original','productionPrompt'])assert.ok(!(key in card.story));
 assert.ok(!('generationProgress' in card));
 const detail=await(await request(app,'/api/reader/sessions/'+next.id)).json();
 assert.deepEqual(detail.story.pages,next.pages);assert.equal(detail.story.sourceText,next.sourceText);
 const known=cards.map(row=>[row.id,row.version]);
 assert.deepEqual(await read('POST',known),{changed:[],removed:[]});
 await request(app,'/api/reader/library/'+next.id+'/favorite','POST',{saved:true});
 const favorite=await read('POST',known);
 assert.deepEqual(favorite.changed.map(row=>[row.id,row.saved]),[[next.id,true]]);assert.deepEqual(favorite.removed,[]);
 await db.prepare("UPDATE stories SET generation_control='stopped' WHERE id=?").bind(draft.id).run();
 const changed=await read('POST',[[next.id,favorite.changed[0].version],known.find(([id])=>id===draft.id)]);
 assert.deepEqual(changed.changed.map(row=>[row.id,row.generationControl]),[[draft.id,'stopped']]);
 await request(app,'/api/reader/library/'+next.id,'DELETE');
 const deleted=await read('POST',[[next.id,favorite.changed[0].version],[draft.id,changed.changed[0].version]]);
 assert.deepEqual(deleted,{changed:[],removed:[next.id]});
 await request(app,'/api/reader/library/'+next.id+'/restore','POST',{});
 const restored=await read('POST',[[draft.id,changed.changed[0].version]]);
 assert.deepEqual(restored.changed.map(row=>row.id),[next.id]);
});
