// Shelf favorites change only owner-scoped flags, including stories with no images or storyboard yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {productionFixture} from './fixtures/production.mjs';
import {insertStory} from './fixtures/story.mjs';

function withoutSaved({saved,...row}){return row;}
test('pending and readable generated stories can be favorited without changing progress or starting generation',async t=>{
 const f=await productionFixture(t),id=await f.create();
 const database=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));t.after(()=>database.close());
 const before=database.prepare('SELECT * FROM reader_sessions WHERE id=?').get(id);
 for(const saved of [true,true,false]){
  const response=await f.request(`library/${id}/favorite`,'POST',{saved});assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.saved,saved?1:0);assert.equal(result.page,before.page);
  assert.equal(result.updatedAt,before.created_at);
  assert.deepEqual(withoutSaved(database.prepare('SELECT * FROM reader_sessions WHERE id=?').get(id)),withoutSaved(before));
 }
 database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.plan',json(?),'$.images',json(?)),page=3,last_read_at=? WHERE id=?").run(JSON.stringify({title:'已读故事',pages:[{},{},{},{}]}),JSON.stringify(['/0.png','/1.png','/2.png','/3.png']),'2026-10-28T10:00:00Z',id);
 const readable=database.prepare('SELECT * FROM reader_sessions WHERE id=?').get(id);
 const result=await f.json(`library/${id}/favorite`,'POST',{saved:true});
 assert.equal(result.page,3);assert.equal(result.updatedAt,readable.last_read_at);
 assert.deepEqual(withoutSaved(database.prepare('SELECT * FROM reader_sessions WHERE id=?').get(id)),withoutSaved(readable));
 assert.equal(f.control.calls.length,0);assert.equal(f.control.plans.length,0);assert.equal(f.control.recommendations.length,0);
 const foreign=await f.create();database.prepare('UPDATE reader_sessions SET user_id=? WHERE id=?').run('someone-else',foreign);
 assert.equal((await f.request(`library/${foreign}/favorite`,'POST',{saved:true})).status,404);
 assert.equal(database.prepare('SELECT saved FROM reader_sessions WHERE id=?').get(foreign).saved,0);
 await f.json(`library/${id}`,'DELETE');
 assert.equal((await f.request(`library/${id}/favorite`,'POST',{saved:false})).status,404);
 assert.equal(database.prepare('SELECT saved FROM reader_sessions WHERE id=?').get(id).saved,1);
});

test('published favorites preserve existing reading progress and reject cross-origin, deleted and malformed requests',async t=>{
 const f=await productionFixture(t);
 const database=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));t.after(()=>database.close());
 await insertStory(f.app);
 const stories=await (await f.app.handle(new Request('http://localhost/api/stories'))).json(),id=stories[0].id;
 const favorite=(saved,headers={})=>f.request(`library/${id}/favorite`,'POST',{saved},headers);
 assert.equal((await favorite(true)).status,200);
 database.prepare('UPDATE progress SET page=4,updated_at=? WHERE story_id=?').run('2026-10-28T10:00:00Z',id);
 const before=database.prepare('SELECT * FROM progress WHERE story_id=?').get(id);
 assert.equal((await favorite(false)).status,200);
 const after=database.prepare('SELECT * FROM progress WHERE story_id=?').get(id);
 assert.equal(after.saved,0);assert.deepEqual(withoutSaved(after),withoutSaved(before));
 assert.equal((await favorite(true,{Origin:'https://foreign.example'})).status,403);
 assert.equal((await favorite('true')).status,400);
 assert.equal(database.prepare('SELECT saved FROM progress WHERE story_id=?').get(id).saved,0);
 await f.json(`library/${id}`,'DELETE');
 assert.equal((await favorite(true)).status,404);
 assert.equal((await f.request('library/missing/favorite','POST',{saved:true})).status,404);
});
