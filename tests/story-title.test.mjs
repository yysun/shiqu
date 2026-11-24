// Exercise independent naming through REST, SQLite and a generation checkpoint saved after the rename.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {DatabaseSync} from 'node:sqlite';
import {createApplication} from '../server/app.ts';
import {createLibraryBackup,restoreLibraryBackup,verifyLibraryBackup} from '../server/library-backup.ts';
import {ensureLibraryReady} from '../server/library-upgrade.ts';
import {productionFixture,until} from './fixtures/production.mjs';

const owner='docker-local-owner';
const row=(f,id)=>f.app.services.database.prepare('SELECT * FROM stories WHERE id=?').bind(id).first();
const rename=(f,id,title)=>f.json(`sessions/${id}/title`,'POST',{title});
const coverRoute=id=>`sessions/${id}/shelf-cover`;
const asset=(f,url)=>f.request(url.slice('/api/reader/'.length));
const shelfCard=async(f,id)=>(await f.json('library/shelf')).find(session=>session.id===id).story;
function upload(f,id,bytes,expected=null){
 const body=new FormData();
 body.append('cover',new Blob([bytes],{type:'image/png'}),'cover.png');
 body.append('expected',expected??'');
 return f.app.handle(new Request(`http://localhost/api/reader/${coverRoute(id)}`,{method:'POST',body}));
}

test('renaming persists across restart without changing source, script, media, progress, versions or jobs; no provider required',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 const id=await f.create();await until(async()=>(await f.read(id)).state==='completed');
 await f.json(`sessions/${id}/progress`,'POST',{page:3,saved:true});
 const before=await row(f,id),jobs=await f.app.services.database.prepare('SELECT * FROM production_jobs').all();
 const calls=[f.control.calls.length,f.control.plans.length,f.control.reviews.length];
 f.generation.status=async()=>({configured:false});
 const saved=await rename(f,id,'  梦蝶新名  '),after=await row(f,id);
 assert.equal(saved.id,id);assert.equal(saved.story.title,'梦蝶新名');assert.equal(saved.page,3);assert.equal(saved.saved,true);
 assert.equal(after.document,before.document);assert.equal(after.state,before.state);assert.equal(after.step_key,before.step_key);
 assert.equal(after.last_read_at,before.last_read_at);assert.equal(after.generation_control,before.generation_control);
 assert.deepEqual(JSON.parse(after.selection),{...JSON.parse(before.selection),displayTitle:'梦蝶新名'});
 assert.equal((await f.json('sessions')).find(s=>s.id===id).story.title,'梦蝶新名');

 assert.deepEqual(await f.app.services.database.prepare('SELECT * FROM production_jobs').all(),jobs);
 assert.deepEqual([f.control.calls.length,f.control.plans.length,f.control.reviews.length],calls);
 await f.json(`library/${id}`,'DELETE');
 assert.equal((await f.json('deletions')).find(s=>s.storyId===id).title,'梦蝶新名');
 assert.equal((await f.request(`sessions/${id}/title`,'POST',{title:'隐藏故事'})).status,404);
 await f.json(`library/${id}/restore`,'POST',{});
 await f.restart();assert.equal((await f.read(id)).story.title,'梦蝶新名');
 assert.equal((await f.json('sessions')).length,1);
});

test('invalid, cross-origin and other-owner renames leave stored data intact',async t=>{
 const f=await productionFixture(t);f.control.hold=false;
 const id=await f.create();await until(async()=>(await f.read(id)).state==='completed');
 const before=await row(f,id);
 for(const title of ['', '   ', '名'.repeat(41), '第一行\n第二行', 123, null]){
  assert.equal((await f.request(`sessions/${id}/title`,'POST',{title})).status,400);
 }
 assert.equal((await f.request(`sessions/${id}/title`,'POST',{title:'跨站改名'},{origin:'http://other.example'})).status,403);
 assert.deepEqual(await row(f,id),before);
 await f.app.services.database.prepare('UPDATE stories SET user_id=? WHERE id=?').bind('someone-else',id).run();
 assert.equal((await f.request(`sessions/${id}/title`,'POST',{title:'不能改'})).status,404);
 await f.app.services.database.prepare('UPDATE stories SET user_id=? WHERE id=?').bind(owner,id).run();
 assert.deepEqual(await row(f,id),before);
});

test('a bookshelf cover is editable offline and stays separate from production across revisions',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 const id=await f.create(2);
 await until(async()=>(await f.read(id)).state==='completed');
 const original=await f.read(id),before=await row(f,id),database=f.app.services.database,configured=f.generation.status;
 const jobs=await database.prepare('SELECT * FROM production_jobs WHERE session_id=? ORDER BY id').bind(id).all();
 const calls=f.control.calls.length;
 f.generation.status=async()=>({configured:false});
 assert.equal((await shelfCard(f,id)).cover,original.story.pages[0].image);
 const {cover}=await f.json(coverRoute(id),'POST',{expected:null,frame:{page:1,image:original.story.pages[1].image}});
 const displayed=await shelfCard(f,id);
 assert.equal(displayed.cover,cover);
 assert.equal(displayed.resumeImage,original.story.pages[0].image);
 assert.deepEqual((await f.read(id)).story.pages,original.story.pages);
 assert.deepEqual({...await row(f,id)},{...before,shelf_cover:cover.split('/').at(-1)});
 assert.deepEqual(await database.prepare('SELECT * FROM production_jobs WHERE session_id=? ORDER BY id').bind(id).all(),jobs);
 assert.equal(f.control.calls.length,calls);
 assert.deepEqual(await (await asset(f,cover)).arrayBuffer(),await (await asset(f,original.story.pages[1].image)).arrayBuffer());
 assert.equal((await f.request(coverRoute(id),'POST',{expected:null})).status,409);
 f.generation.status=configured;
 const {token}=await f.json(`sessions/${id}/revisions`),child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token,changes:{artStyle:'watercolor'}});
 const revised=await f.read(child);
 assert.equal((await shelfCard(f,child)).cover,revised.story?.pages[0]?.image?cover:'');
 await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed');
 assert.equal((await shelfCard(f,child)).cover,cover);
 assert.equal((await f.request(coverRoute(id),'POST',{expected:cover})).status,409);
 await f.json(`library/${id}`,'DELETE');
 assert.equal((await asset(f,cover)).status,200,'the visible descendant still owns the family cover');
 await f.restart();
 assert.equal((await f.read(child)).shelfCover,cover);
 assert.deepEqual(await f.json(coverRoute(child),'POST',{expected:cover}),{cover:null});
 assert.equal((await shelfCard(f,child)).cover,(await f.read(child)).story.pages[0].image);
 assert.equal((await asset(f,cover)).status,404);
});

test('uploaded bookshelf cover survives a verified backup and stays private after deletion',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 const id=await f.create(2);
 await until(async()=>(await f.read(id)).state==='completed');
 const bytes=createCanvas(36,48).toBuffer('image/png');
 assert.equal((await upload(f,id,Buffer.from('not a picture'))).status,400);
 const saved=await upload(f,id,bytes);
 assert.equal(saved.status,200);const {cover}=await saved.json(),media=await asset(f,cover);
 assert.equal(media.headers.get('content-type'),'image/png');
 assert.equal(media.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(Buffer.from(await media.arrayBuffer()),bytes);
 assert.equal((await f.request(coverRoute(id),'POST',{expected:cover},{origin:'http://other.example'})).status,403);
 const database=f.app.services.database;
 await database.prepare('UPDATE stories SET user_id=? WHERE id=?').bind('someone-else',id).run();
 assert.equal((await asset(f,cover)).status,404);
 assert.equal((await f.request(coverRoute(id),'POST',{expected:cover})).status,404);
 await database.prepare('UPDATE stories SET user_id=? WHERE id=?').bind(owner,id).run();
 const backup=path.join(f.root,'snapshot'),restored=path.join(f.root,'restored');
 createLibraryBackup(f.dataDirectory,backup);
 assert.ok(verifyLibraryBackup(backup).files.some(file=>file.path.includes('/shelf-covers/')));
 restoreLibraryBackup(backup,restored);
 const app=createApplication({...f.options,dataDirectory:restored,production:{autoStart:false}});
 try{
  const response=await app.handle(new Request('http://localhost'+cover));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const shelf=await app.handle(new Request('http://localhost/api/reader/library/shelf'));
  assert.equal((await shelf.json()).find(session=>session.id===id).story.cover,cover);
 }finally{await app.close();}
 await f.json(`library/${id}`,'DELETE');
 assert.equal((await asset(f,cover)).status,404);
 await f.json(`library/${id}/restore`,'POST',{});
 assert.equal((await asset(f,cover)).status,200);
});

test('upgrading a pre-cover library backs it up and retains its page-one shelf cover',async t=>{
 const f=await productionFixture(t);
 f.control.hold=false;
 const id=await f.create(2);
 await until(async()=>(await f.read(id)).state==='completed');
 const original=await shelfCard(f,id);
 await f.stop();
 const database=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 try{
  database.exec("ALTER TABLE stories DROP COLUMN shelf_cover; DELETE FROM app_migrations WHERE name='0028_shelf_cover.sql'");
 }finally{database.close();}
 const upgraded=ensureLibraryReady(f.dataDirectory,f.root);
 assert.deepEqual(upgraded.migrations,['0028_shelf_cover.sql']);
 assert.ok(verifyLibraryBackup(upgraded.backup).files.some(file=>file.path==='shiqu.sqlite'));
 await f.restart();
 assert.deepEqual(await shelfCard(f,id),original);
 const previousArtwork='/art/legacy-cover.png',bytes=createCanvas(36,48).toBuffer('image/png');
 await f.app.services.media.put('legacy-art/legacy-cover.png',bytes,{contentType:'image/png'});
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.images[1]',?) WHERE id=?").bind(previousArtwork,id).run();
 const {cover}=await f.json(coverRoute(id),'POST',{expected:null,frame:{page:1,image:previousArtwork}});
 assert.deepEqual(Buffer.from(await (await asset(f,cover)).arrayBuffer()),bytes);
 const nested=original.resumeImage.replace('/api/reader/media/','/api/media/reader/');
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.images[1]',?) WHERE id=?").bind(nested,id).run();
 assert.equal((await f.request(coverRoute(id),'POST',{expected:cover,frame:{page:1,image:nested}})).status,409);
});
