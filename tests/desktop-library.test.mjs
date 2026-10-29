// Desktop summaries and reversible deletions must preserve shared stories, owners, and paid checkpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readLibrarySummary,setLibraryStoryDeleted,desktopPreview} from '../desktop/library-preview.ts';

test('desktop summaries include pending stories, counts and saved state, excluding deleted stories and foreign jobs',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'shiqu-summary-'));
 try{
  const database=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())database.exec(readFileSync(path.join('drizzle',file),'utf8'));
  const insert=database.prepare(`INSERT INTO reader_sessions(id,user_id,selection,document,state,page,saved,created_at,updated_at) VALUES(?,?,?,?,?,0,1,?,?)`);
  const selection=JSON.stringify({bookId:'book',theme:'回味',artStyle:'watercolor',storyTitle:'还没展开'}),document=JSON.stringify({plan:{title:'真实故事',pages:[{},{}]},images:['/image.png',''],audio:[]}),now='2026-10-29T10:00:00Z';
  insert.run('visible','owner',selection,document,'running',now,now);
  insert.run('pending','owner',selection,JSON.stringify({plan:null,images:[],audio:[]}), 'idle',now,now);
  insert.run('deleted','owner',selection,document,'completed',now,now);
  database.prepare('INSERT INTO library_deletions VALUES(?,?,?,?)').run('owner','deleted','generated',now);
  const job=database.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,created_at,updated_at) VALUES(?,?,?,'image','image','v','[]','{}',?,1,1)`);
  job.run('1','visible','owner','succeeded');job.run('2','visible','owner','running');job.run('3','visible','owner','queued');job.run('4','visible','owner','failed');job.run('5','visible','other','succeeded');
  database.close();
  const before=readFileSync(path.join(directory,'shiqu.sqlite'));
  const {stories}=readLibrarySummary(directory);
  assert.equal(stories.length,2);
  const story=stories.find(story=>story.id==='visible');
  assert.equal(story.title,'真实故事');assert.equal(story.ready,1);assert.equal(story.total,2);assert.equal(story.saved,1);
  assert.equal(story.theme,'回味');assert.equal(story.artStyle,'watercolor');
  assert.deepEqual([story.jobs,story.queued,story.running,story.failed,story.succeeded],[4,1,1,1,1]);
  const pending=stories.find(story=>story.id==='pending');assert.equal(pending.title,'还没展开');assert.equal(pending.total,0);assert.equal(pending.jobs,0);
  assert.deepEqual(readFileSync(path.join(directory,'shiqu.sqlite')),before);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('a missing library stays empty and is not created',()=>{
 const directory=path.join(tmpdir(),'shiqu-nonexistent-'+crypto.randomUUID());
 assert.deepEqual(readLibrarySummary(directory),{stories:[]});
 assert.throws(()=>setLibraryStoryDeleted(directory,'missing',true));
});

test('desktop deletion hides the same story as the reader and undo restores it without changing checkpoints',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'shiqu-delete-'));
 try{
  const database=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())database.exec(readFileSync(path.join('drizzle',file),'utf8'));
  database.prepare(`INSERT INTO reader_sessions(id,user_id,selection,document,state,page,saved,created_at,updated_at) VALUES('one','owner','{"bookId":"book","theme":"人情冷暖"}','{"plan":{"title":"可恢复的故事","pages":[{}]},"images":["/kept.png"]}','completed',0,0,'2026-10-29','2026-10-29')`).run();
  database.prepare('INSERT INTO library_deletions VALUES(?,?,?,?)').run('other-owner','one','generated','2026-10-28');
  const before=database.prepare('SELECT * FROM reader_sessions').all();
  setLibraryStoryDeleted(directory,'one',true);
  assert.deepEqual(readLibrarySummary(directory),{stories:[]});
  const tombstone=database.prepare("SELECT * FROM library_deletions WHERE user_id='owner'").get();
  assert.equal(tombstone.kind,'generated');assert.ok(!Number.isNaN(Date.parse(tombstone.deleted_at)));
  setLibraryStoryDeleted(directory,'one',true);
  assert.deepEqual(database.prepare("SELECT * FROM library_deletions WHERE user_id='owner'").get(),tombstone);
  setLibraryStoryDeleted(directory,'one',false);setLibraryStoryDeleted(directory,'one',false);
  assert.equal(readLibrarySummary(directory).stories[0].title,'可恢复的故事');
  assert.deepEqual(database.prepare('SELECT * FROM reader_sessions').all(),before);
  assert.equal(database.prepare('SELECT count(*) AS count FROM library_deletions').get().count,1);
  assert.throws(()=>setLibraryStoryDeleted(directory,"' OR 1=1 --",true));
  assert.deepEqual(database.prepare('SELECT * FROM reader_sessions').all(),before);
  database.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('preview refuses foreign-origin and originless mutations before opening the library',()=>{
 let handle;
 desktopPreview().configureServer({middlewares:{use(path,callback){assert.equal(path,'/__desktop/library');handle=callback;}}});
 for(const request of [
  {method:'DELETE',url:'/one',headers:{host:'127.0.0.1:1420'}},
  {method:'DELETE',url:'/one',headers:{host:'127.0.0.1:1420',origin:'https://foreign.example'}},
  {method:'PUT',url:'/one',headers:{host:'127.0.0.1:1420',origin:'http://127.0.0.1:1420','sec-fetch-site':'cross-site'}},
 ]){
  const response={statusCode:200,end(){this.ended=true;}};
  handle(request,response);assert.equal(response.statusCode,403);assert.equal(response.ended,true);
 }
});
