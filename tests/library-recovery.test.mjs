// Recovery lists only owner-visible titles and restores checkpoints without creating production demand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {productionFixture} from './fixtures/production.mjs';
import {insertStory} from './fixtures/story.mjs';

test('deleted generated stories retain titles, favorite flags and exact checkpoints through passive restoration',async t=>{
 const f=await productionFixture(t),id=await f.create();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));t.after(()=>db.close());
 db.prepare(`UPDATE reader_sessions SET saved=1,page=3,last_read_at='2026-10-28T10:00:00Z',document=json_set(document,'$.plan',json(?),'$.images',json(?)) WHERE id=?`).run(JSON.stringify({title:'恢复原来的故事',pages:[{},{},{},{}]}),JSON.stringify(['/0.png','/1.png','/2.png','/3.png']),id);
 const before=db.prepare('SELECT * FROM reader_sessions WHERE id=?').get(id);
 await f.json(`library/${id}`,'DELETE');
 const rows=await f.json('deletions');assert.equal(rows.length,1);
 assert.deepEqual({id:rows[0].storyId,title:rows[0].title,kind:rows[0].kind},{id,title:'恢复原来的故事',kind:'generated'});
 assert.ok(!Number.isNaN(Date.parse(rows[0].deletedAt)));
 assert.equal((await f.request(`sessions/${id}`)).status,404);
 assert.equal((await f.request(`library/${id}/restore`,'POST',{}, {Origin:'https://foreign.example'})).status,403);
 assert.equal((await f.json('deletions')).length,1);
 assert.deepEqual(await f.json(`library/${id}/restore`,'POST'),{storyId:id,restored:true});
 assert.deepEqual(await f.json(`library/${id}/restore`,'POST'),{storyId:id,restored:false});
 assert.equal((await f.request(`sessions/${id}`)).status,200);
 assert.deepEqual({...db.prepare('SELECT * FROM reader_sessions WHERE id=?').get(id)},{...before,generation_control:'stopped'});
 assert.deepEqual(await f.json('deletions'),[]);
 assert.equal(db.prepare('SELECT count(*) AS n FROM production_jobs').get().n,0);
 assert.deepEqual([f.control.calls.length,f.control.plans.length,f.control.recommendations.length],[0,0,0]);
});

test('recovery metadata does not expose foreign generated titles and supports published and unfinished stories',async t=>{
 const f=await productionFixture(t),pending=await f.create(),foreign=await f.create();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));t.after(()=>db.close());
 const owner=db.prepare('SELECT user_id FROM reader_sessions WHERE id=?').get(pending).user_id;
 db.prepare(`UPDATE reader_sessions SET user_id='someone-else',selection=json_set(selection,'$.storyTitle','私有故事') WHERE id=?`).run(foreign);
 assert.equal((await f.request(`library/${foreign}/restore`,'POST')).status,404);
 await f.json(`library/${pending}`,'DELETE');
 assert.equal((await f.json('deletions'))[0].title,'庄周梦蝶');
 await insertStory(f.app);
 const stories=await (await f.app.handle(new Request('http://localhost/api/stories'))).json(),sample=stories[0];
 await f.json(`library/${sample.id}`,'DELETE');
 let rows=await f.json('deletions');assert.equal(rows.find(row=>row.storyId===sample.id).title,sample.title);assert.equal(rows.find(row=>row.storyId===sample.id).kind,'published');
 db.prepare(`INSERT INTO library_deletions(user_id,story_id,kind,deleted_at) VALUES(?,?,'generated','2026-10-29')`).run(owner,foreign);
 rows=await f.json('deletions');assert.equal(rows.find(row=>row.storyId===foreign).title,'未命名故事');
 assert.equal(JSON.stringify(rows).includes('私有故事'),false);
 await f.json(`library/${sample.id}/restore`,'POST');
 assert.equal((await f.json('deletions')).some(row=>row.storyId===sample.id),false);
 assert.equal((await f.request('library/missing/restore','POST')).status,404);
});

test('an older restored story is passively readable even when absent from the capped session list',async t=>{
 const f=await productionFixture(t),id=await f.create();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));t.after(()=>db.close());
 db.prepare(`UPDATE reader_sessions SET created_at='1990-01-01',updated_at='1990-01-01' WHERE id=?`).run(id);
 const insert=db.prepare(`INSERT INTO reader_sessions(id,user_id,selection,document,state,page,saved,created_at,updated_at)
  SELECT ?,user_id,selection,document,state,page,saved,'2000-01-01','2000-01-01' FROM reader_sessions WHERE id=?`);
 for(let n=0;n<81;n++)insert.run(crypto.randomUUID(),id);
 await f.json(`library/${id}`,'DELETE');await f.json(`library/${id}/restore`,'POST');
 const rows=await f.json('sessions');assert.equal(rows.length,80);assert.equal(rows.some(row=>row.id===id),false);
 assert.equal((await f.json(`sessions/${id}`)).id,id);
 assert.equal(db.prepare('SELECT count(*) AS n FROM production_jobs').get().n,0);
 assert.deepEqual([f.control.calls.length,f.control.plans.length,f.control.recommendations.length],[0,0,0]);
});
