// Recovery lists only owner-visible titles and restores checkpoints without creating production demand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {productionFixture} from './fixtures/production.mjs';


test('deleted generated stories retain titles, favorite flags and exact checkpoints through passive restoration',async t=>{
 const f=await productionFixture(t),id=await f.create();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));t.after(()=>db.close());
 db.prepare(`UPDATE stories SET saved=1,page=3,last_read_at='2026-10-28T10:00:00Z',document=json_set(document,'$.plan',json(?),'$.images',json(?)) WHERE id=?`).run(JSON.stringify({title:'恢复原来的故事',pages:[{},{},{},{}]}),JSON.stringify(['/0.png','/1.png','/2.png','/3.png']),id);
 const before=db.prepare('SELECT * FROM stories WHERE id=?').get(id);
 await f.json(`library/${id}`,'DELETE');
 const rows=await f.json('deletions');assert.equal(rows.length,1);
 assert.deepEqual({id:rows[0].storyId,title:rows[0].title,kind:rows[0].kind},{id,title:'恢复原来的故事',kind:'generated'});
 assert.ok(!Number.isNaN(Date.parse(rows[0].deletedAt)));
 assert.equal(rows[0].canRestore,true);
 assert.equal((await f.request(`sessions/${id}`)).status,404);
 assert.equal((await f.request(`library/${id}/restore`,'POST',{}, {Origin:'https://foreign.example'})).status,403);
 assert.equal((await f.json('deletions')).length,1);
 assert.deepEqual(await f.json(`library/${id}/restore`,'POST'),{storyId:id,restored:true});
 assert.deepEqual(await f.json(`library/${id}/restore`,'POST'),{storyId:id,restored:false});
 assert.equal((await f.request(`sessions/${id}`)).status,200);
 assert.deepEqual({...db.prepare('SELECT * FROM stories WHERE id=?').get(id)},{...before,generation_control:'stopped'});
 assert.deepEqual(await f.json('deletions'),[]);
 assert.equal(db.prepare('SELECT count(*) AS n FROM production_jobs').get().n,0);
 assert.deepEqual([f.control.calls.length,f.control.plans.length,f.control.recommendations.length],[0,0,0]);
});

test('recovery metadata does not expose foreign generated titles and supports unfinished stories while excluding retired studio records',async t=>{
 const f=await productionFixture(t),pending=await f.create(),foreign=await f.create();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));t.after(()=>db.close());
 const owner=db.prepare('SELECT user_id FROM stories WHERE id=?').get(pending).user_id;
 db.prepare(`UPDATE stories SET user_id='someone-else',selection=json_set(selection,'$.storyTitle','私有故事') WHERE id=?`).run(foreign);
 assert.equal((await f.request(`library/${foreign}/restore`,'POST')).status,404);
 await f.json(`library/${pending}`,'DELETE');
 assert.equal((await f.json('deletions'))[0].title,'庄周梦蝶');
 const sample={id:'retired-studio'};
 assert.equal((await f.request(`library/${sample.id}`,'DELETE')).status,404);
 db.prepare("INSERT INTO library_deletions(user_id,story_id,kind,deleted_at) VALUES(?,?,'published','2026-10-29')").run(owner,sample.id);
 let rows=await f.json('deletions');assert.equal(rows.some(row=>row.storyId===sample.id),false);
 db.prepare(`INSERT INTO library_deletions(user_id,story_id,kind,deleted_at) VALUES(?,?,'generated','2026-10-29')`).run(owner,foreign);
 rows=await f.json('deletions');assert.equal(rows.find(row=>row.storyId===foreign).title,'未命名故事');
 assert.equal(rows.find(row=>row.storyId===foreign).canRestore,false);
 assert.equal(JSON.stringify(rows).includes('私有故事'),false);
 assert.equal((await f.request(`library/${sample.id}/restore`,'POST')).status,404);
 assert.equal((await f.json('deletions')).some(row=>row.storyId===sample.id),false);
 assert.equal((await f.request('library/missing/restore','POST')).status,404);
});

test('an older restored story remains listed beyond 80 entries without starting production',async t=>{
 const f=await productionFixture(t),id=await f.create();
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));t.after(()=>db.close());
 db.prepare(`UPDATE stories SET generation_control='stopped',created_at='1990-01-01',updated_at='1990-01-01' WHERE id=?`).run(id);
 const insert=db.prepare(`INSERT INTO stories(id,user_id,selection,document,generation_control,page,saved,created_at,updated_at)
  SELECT ?,user_id,selection,document,generation_control,page,saved,'2000-01-01','2000-01-01' FROM stories WHERE id=?`);
 for(let n=0;n<81;n++)insert.run(crypto.randomUUID(),id);
 await f.json(`library/${id}`,'DELETE');await f.json(`library/${id}/restore`,'POST');
 const rows=await f.json('sessions');assert.equal(rows.length,82);assert.equal(rows.some(row=>row.id===id),true);
 assert.equal((await f.json(`sessions/${id}`)).id,id);
 assert.equal(db.prepare('SELECT count(*) AS n FROM production_jobs').get().n,0);
 assert.deepEqual([f.control.calls.length,f.control.plans.length,f.control.recommendations.length],[0,0,0]);
});
