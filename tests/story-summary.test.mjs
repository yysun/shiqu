// Exercise a real pre-summary library upgrade, paid image receipts, file retries and read contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,rm,readFile,writeFile,symlink,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../server/database.ts';
import {createApplication} from '../server/app.ts';
import {storySummaryMigration} from '../server/story-summary-migration.ts';
import {inputVersion,productionJobId} from '../server/production-queue.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {makePlan,selection,encoded,until} from './fixtures/production.mjs';
import {makeStory} from './fixtures/story.mjs';
import {transform} from 'esbuild';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const owner='docker-local-owner';
const legacyPlan=()=>{const {summary,...plan}=makePlan(2);return {...plan,hook:summary};};
const original={title:'《庄子·齐物论》庄周梦蝶',text:'庄周梦为胡蝶，醒来后思考梦与醒的变化。',url:'https://example.org/original',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01'};
async function fixture(t,document){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu summary ')),directory=path.join(root,'library'),oldRoot=path.join(root,'old');
 t.after(()=>rm(root,{recursive:true,force:true}));await cp('drizzle',path.join(oldRoot,'drizzle'),{recursive:true});await rm(path.join(oldRoot,'drizzle',storySummaryMigration));
 await mkdir(path.join(oldRoot,'docker'));await cp('docker/seed.sql',path.join(oldRoot,'docker/seed.sql'));
 const local=openDatabase(directory,oldRoot),id=crypto.randomUUID(),chosen=selectionSchema.parse(selection);
 local.sqlite.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at,page,saved) VALUES(?,?,?,?,'background','paused','idle','created','updated',1,1)")
  .run(id,owner,JSON.stringify(chosen),JSON.stringify(document));
 return {root,directory,oldRoot,id,chosen,local};
}
const version=(chosen,plan)=>inputVersion({scriptVersion:inputVersion({selection:chosen}),plan,style:chosen.artStyle,prompt:chosen.productionPrompt});
function job(sqlite,id,sessionId,kind,version,dependencies,payload,result,state='succeeded'){
 sqlite.prepare("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,attempts,created_at,updated_at) VALUES(?,?,?,? ,?,?,?, ?,?,?,2,1,2)")
  .run(id,sessionId,owner,kind,kind==='image'?'image':kind==='image-publish'?'local':'text',version,JSON.stringify(dependencies),JSON.stringify(payload),JSON.stringify(result),state);
}

test('upgrade removes old fields from stories, drafts, outlines, revision bases and media without changing content',async t=>{
 const plan=legacyPlan(),doc={plan,draft:{...plan,summary:'已有完整摘要优先。'},storyboard:{outline:{...plan,beats:['行动','结果']},pages:plan.pages},revision:{base:{plan}},original,images:['saved.png'],audio:[],usage:[]};
 const f=await fixture(t,doc),saved=makeStory(4);
 f.local.sqlite.prepare('INSERT INTO stories(id,title,hook,book_id,theme,status,pages,reflection,source_text,source_url,adaptation_note,checks,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(saved.id,saved.title,'旧文字原样保留。',saved.bookId,saved.theme,saved.status,JSON.stringify(saved.pages),saved.reflection,saved.sourceText,saved.sourceUrl,saved.adaptationNote,JSON.stringify(saved.checks),saved.createdAt,saved.updatedAt);
 f.local.close();const file=path.join(f.directory,'media/reader/test/comparison-result.json');await mkdir(path.dirname(file),{recursive:true});
 await writeFile(file,JSON.stringify({value:{hook:'旧引子。',summary:'已有摘要。',text:'原文中出现 "hook" 文字，不改写。'}}));
 const cache=path.join(f.directory,'media/reader-cache/library.json');await mkdir(path.dirname(cache),{recursive:true});await writeFile(cache,JSON.stringify({stories:[{summary:'已有通用摘要。'}]}));const cacheBefore=await readFile(cache);
 let local=openDatabase(f.directory,process.cwd());
 const row=local.sqlite.prepare('SELECT * FROM reader_sessions WHERE id=?').get(f.id),actual=JSON.parse(row.document);
 assert.equal(actual.plan.summary,plan.hook);assert.equal(actual.draft.summary,'已有完整摘要优先。');assert.equal(actual.storyboard.outline.summary,plan.hook);assert.equal(actual.revision.base.plan.summary,plan.hook);
 for(const value of [actual.plan,actual.draft,actual.storyboard.outline,actual.revision.base.plan])assert.equal(Object.hasOwn(value,'hook'),false);
 assert.deepEqual(actual.original,original);assert.deepEqual(actual.images,doc.images);assert.equal(actual.original.storyBrief,undefined);assert.equal(row.page,1);assert.equal(row.saved,1);assert.equal(row.generation_control,'paused');assert.equal(row.updated_at,'updated');
 assert.equal(local.sqlite.prepare('SELECT summary FROM stories WHERE id=?').get(saved.id).summary,'旧文字原样保留。');assert.ok(!local.sqlite.prepare('PRAGMA table_info(stories)').all().some(col=>col.name==='hook'));
 const media=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(media.value,{summary:'已有摘要。',text:'原文中出现 "hook" 文字，不改写。'});assert.deepEqual(await readFile(cache),cacheBefore);
 const after=row.document,mtime=(await stat(file)).mtimeMs;local.close();local=openDatabase(f.directory,process.cwd());assert.equal(local.sqlite.prepare('SELECT document FROM reader_sessions WHERE id=?').get(f.id).document,after);local.close();assert.equal((await stat(file)).mtimeMs,mtime);
 const app=createApplication({root:process.cwd(),dataDirectory:f.directory,variables:{SHIQU_AI_PROVIDER:'readonly'}});t.after(()=>app.close());
 const response=await app.handle(new Request('http://localhost/api/stories/'+saved.id));const body=await response.json();assert.equal(response.status,200);assert.equal(body.summary,'旧文字原样保留。');assert.equal(body.hook,undefined);
});

test('a media migration failure rolls SQL back and a partially converted file retries safely',async t=>{
 const f=await fixture(t,{plan:legacyPlan(),images:[],audio:[],usage:[]});f.local.close();const folder=path.join(f.directory,'media/reader/test');await mkdir(folder,{recursive:true});
 const first=path.join(folder,'a.json'),outside=path.join(f.root,'outside.json'),link=path.join(folder,'z.json');await writeFile(first,'{"hook":"旧内容。"}');await writeFile(outside,'{"hook":"不得触碰。"}');await symlink(outside,link);
 assert.throws(()=>openDatabase(f.directory,process.cwd()),/symlink/);
 const db=new DatabaseSync(path.join(f.directory,'shiqu.sqlite'));assert.ok(db.prepare('PRAGMA table_info(stories)').all().some(col=>col.name==='hook'));assert.equal(db.prepare('SELECT name FROM app_migrations WHERE name=?').get(storySummaryMigration),undefined);db.close();
 assert.deepEqual(JSON.parse(await readFile(first,'utf8')),{summary:'旧内容。'});assert.equal(await readFile(outside,'utf8'),'{"hook":"不得触碰。"}');await rm(link);
 const local=openDatabase(f.directory,process.cwd());assert.ok(local.sqlite.prepare('PRAGMA table_info(stories)').all().some(col=>col.name==='summary'));local.close();
});

test('derived image IDs and anchors migrate and a paid unpublished image is published without another image request',async t=>{
 const plan=legacyPlan(),doc={plan,original,images:[],audio:[],usage:[],visualReview:{status:'passed',round:1,repairs:0,issues:[],repaired:[],reports:[]}},f=await fixture(t,doc);
 const oldVersion=version(f.chosen,plan),scriptVersion=inputVersion({selection:f.chosen}),script=productionJobId(f.id,'script',scriptVersion,'approved');
 const ids=[];
 job(f.local.sqlite,script,f.id,'script',scriptVersion,[],{stepKey:'approved'},{pages:2});
 for(let page=0;page<2;page++){
  const image=productionJobId(f.id,'image',oldVersion,String(page)),publication=productionJobId(f.id,'image-publish',oldVersion,String(page)),value=`/api/reader/media/${f.id}/${page}.png`;
  const folder=path.join(f.directory,'media/reader',f.id);await mkdir(folder,{recursive:true});await writeFile(path.join(folder,page+'.png'),Buffer.from(encoded,'base64'));
  job(f.local.sqlite,image,f.id,'image',oldVersion,page?[script,ids[0].publication]:[script],{page},{value,model:'already-paid',requestId:'paid',usage:{paid:true}});
  job(f.local.sqlite,publication,f.id,'image-publish',oldVersion,[image],{page},null,'queued');ids.push({image,publication});
 }
 const before=f.local.sqlite.prepare("SELECT * FROM production_jobs WHERE kind='image' ORDER BY payload").all();f.local.close();const local=openDatabase(f.directory,process.cwd());
 const migrated=JSON.parse(local.sqlite.prepare('SELECT document FROM reader_sessions WHERE id=?').get(f.id).document),nextVersion=version(f.chosen,migrated.plan);
 for(const [index,old] of before.entries()){
  const id=productionJobId(f.id,'image',nextVersion,String(index)),next=local.sqlite.prepare('SELECT * FROM production_jobs WHERE id=?').get(id);assert.ok(next);assert.deepEqual({...next,id:old.id,version:old.version,dependencies:old.dependencies},{...old});
  if(index)assert.ok(JSON.parse(next.dependencies).includes(productionJobId(f.id,'image-publish',nextVersion,'0')));
 }
 local.close();let images=0;const generation={status:async()=>({configured:true,provider:'codex',models:{text:'controlled',image:'controlled'},voiceEnabled:false}),generator:()=>({image:async()=>{images++;assert.fail('Paid image receipt must be reused');},safeError:()=> 'controlled failure'}),safeError:()=> 'controlled failure'};
 const app=createApplication({root:process.cwd(),dataDirectory:f.directory,generation});t.after(()=>app.close());
 const response=await app.handle(new Request(`http://localhost/api/reader/sessions/${f.id}/production-control`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resume'})}));assert.equal(response.status,200);
 await until(async()=>{const row=await app.services.database.prepare('SELECT state FROM reader_sessions WHERE id=?').bind(f.id).first();return row.state==='completed';});assert.equal(images,0);
});

test('target job identity collisions abort the upgrade without discarding either receipt',async t=>{
 const plan=legacyPlan(),f=await fixture(t,{plan,original,images:[],audio:[],usage:[]}),oldVersion=version(f.chosen,plan);
 const {hook,...rest}=plan,migrated={...rest,summary:hook},nextVersion=version(f.chosen,migrated),old=productionJobId(f.id,'image',oldVersion,'0'),next=productionJobId(f.id,'image',nextVersion,'0');
 job(f.local.sqlite,old,f.id,'image',oldVersion,[],{page:0},{value:'paid-old'});job(f.local.sqlite,next,f.id,'image',nextVersion,[],{page:0},{value:'paid-new'});f.local.close();
 assert.throws(()=>openDatabase(f.directory,process.cwd()),/collision/);const db=new DatabaseSync(path.join(f.directory,'shiqu.sqlite'));assert.equal(db.prepare('SELECT count(*) AS n FROM production_jobs').get().n,2);assert.ok(db.prepare('PRAGMA table_info(stories)').all().some(col=>col.name==='hook'));db.close();
});

test('script disclosure renders the summary with the existing storyboard',async()=>{
 const file='client/ui/StoryScript.tsx',compiled=await transform(await readFile(file,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}),compiledModule={exports:{}};
 new Function('require','module','exports',compiled.code)(createRequire(import.meta.url),compiledModule,compiledModule.exports);
 const html=renderToStaticMarkup(createElement(compiledModule.exports.default,{story:makeStory(),standalone:true}));assert.match(html,/测试人物经历变故/);assert.match(html,/第 1 幅/);assert.doesNotMatch(html,/测试引子/);
});
