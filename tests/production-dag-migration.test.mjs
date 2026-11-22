// 迁移 0025：在临时书库上从 0024 升级，核对文档 v2 转换、旧绘图结果采用、故障归属、旧任务作废、触发器与格式版本。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {historicalLibrary} from './fixtures/historical-library.mjs';
import {migrate} from '../server/database-migrations.ts';
import {selection,makePlan} from './fixtures/production-data.mjs';

const owner='owner',story='11111111-1111-4111-8111-111111111111';
const url=page=>`/api/reader/media/${story}/${page}.png`;

function library(t){
 const directory=mkdtempSync(path.join(os.tmpdir(),'shiqu dag migration '));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const sqlite=historicalLibrary(directory,process.cwd(),'0024_prompt_records.sql');
 t.after(()=>sqlite.close());
 return {directory,sqlite};
}
function seed({directory,sqlite},doc){
 sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,state,created_at,updated_at) VALUES(?,?,?,?,'idle','c','u')").run(story,owner,JSON.stringify({...selection,length:3}),JSON.stringify(doc));
 mkdirSync(path.join(directory,'media','reader',story),{recursive:true});
 for(const page of [0,1])writeFileSync(path.join(directory,'media','reader',story,`${page}.png`),'png');
}
const legacyVersion=async(doc)=>{
 const {createHash}=await import('node:crypto');
 const v=input=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
 const {displayTitle:_,...generationSelection}={...selection,length:3,artStyle:selection.artStyle,artStylePrompt:undefined,productionPrompt:selection.productionPrompt};void _;
 return v({scriptVersion:v({selection:generationSelection}),plan:doc.plan,style:selection.artStyle,prompt:selection.productionPrompt});
};

test('0025 converts stories, adopts a paid image, maps faults and clears old jobs',async t=>{
 const lib=library(t),plan=makePlan(3);
 const doc={plan,images:[url(0),'',''],audio:[],usage:[],original:{title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'local',retrievedAt:'2026-01-01'},visualReview:{history:[],status:'passed',round:1,repairs:0,issues:[],repaired:[],reports:[]},revision:{handoff:true,number:2,parentId:'p',rootId:'p',baseToken:'b',requestHash:'h',base:{}}};
 seed(lib,doc);
 const {sqlite,directory}=lib;
 const version=await legacyVersion(doc);
 const job=sqlite.prepare("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'[]',?,?,?,1,1)");
 job.run('paid',story,owner,'image','image',version,JSON.stringify({page:1}),JSON.stringify({value:url(1)}),'succeeded');
 job.run('stale',story,owner,'image','image','old-version',JSON.stringify({page:2}),JSON.stringify({value:url(2)}),'succeeded');
 job.run('search',story,owner,'discover','search','r',JSON.stringify({searchRound:1}),null,'queued');
 const fault=sqlite.prepare("INSERT INTO reader_faults(id,session_id,owner_id,job_id,kind,page,version,message,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,1)");
 fault.run('lost',story,owner,null,'image-loss',2,'v','这幅图片的文件已丢失或损坏。','pending');
 fault.run('text',story,owner,'paid','job',null,'v','制作未完成','recovering');
 sqlite.prepare("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,status,created_at,updated_at) VALUES('cmd',?,?,'recover','f','{}','text','queued',1,1)").run(owner,story);

 migrate(sqlite,process.cwd(),directory);

 const saved=JSON.parse(sqlite.prepare('SELECT document FROM stories WHERE id=?').get(story).document);
 assert.deepEqual(saved.dag.order,['legacy-1','legacy-2','legacy-3']);
 assert.equal(saved.dag.frames['legacy-2'].image,url(1),'the paid image for an unchanged plan is adopted');
 assert.equal(saved.dag.frames['legacy-3'].image,undefined,'a result for older inputs is not adopted');
 assert.deepEqual(saved.images,[url(0),url(1),'']);
 assert.equal(saved.revision.handoff,undefined);
 assert.deepEqual(saved.dag.continuation,{revision:2,reason:'revision-saved'});
 const faults=Object.fromEntries(sqlite.prepare('SELECT id,node,node_key,state,job_id FROM reader_faults').all().map(f=>[f.id,f]));
 assert.deepEqual([faults.lost.node,faults.lost.node_key,faults.lost.state],['frameImage','legacy-3','pending']);
 assert.equal(faults.text.state,'pending','a recovering fault returns to pending');
 assert.ok(faults.text.node,'a page-less fault is attached to the next runnable node');
 assert.equal(faults.text.job_id,null);
 assert.deepEqual(sqlite.prepare('SELECT id FROM production_jobs').all().map(r=>r.id),['search']);
 assert.equal(sqlite.prepare("SELECT status FROM reader_commands WHERE request_id='cmd'").get().status,'failed');
 assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version,2);
 const triggers=sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name").all().map(r=>r.name);
 assert.deepEqual(triggers,['book_image_reference_on_delete','books_refuse_pre_consolidation_seed','production_disarm_deleted','reader_command_id_guard','reader_session_id_guard','story_content_revision','story_content_revision_insert']);
 assert.ok(sqlite.prepare("SELECT 1 FROM pragma_table_info('production_jobs') WHERE name='error_code'").get());
 assert.ok(!sqlite.prepare("SELECT 1 FROM pragma_table_info('reader_faults') WHERE name='page'").get());
});

test('an unreadable story is left as it is and does not stop the upgrade',t=>{
 const lib=library(t);
 lib.sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,state,created_at,updated_at) VALUES('bad',?,'{}','not json','idle','c','u')").run(owner);
 seed(lib,{plan:makePlan(3),images:['','',''],audio:[],usage:[]});
 migrate(lib.sqlite,process.cwd(),lib.directory);
 assert.equal(lib.sqlite.prepare("SELECT document FROM stories WHERE id='bad'").get().document,'not json');
 assert.ok(JSON.parse(lib.sqlite.prepare('SELECT document FROM stories WHERE id=?').get(story).document).dag);
});
