// 迁移 0025：在临时书库上从 0024 升级，核对文档 v2 转换、旧绘图结果采用、故障归属、旧任务作废、触发器与格式版本。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {historicalLibrary} from './fixtures/historical-library.mjs';
import {migrate} from '../server/database-migrations.ts';
import {selection,makePlan} from './fixtures/production-data.mjs';
import {selectionSchema} from '../lib/reader-model.ts';

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
 // 与 0.14 协调器相同：按解析后的选择（含默认值）计算。
 const parsed=selectionSchema.parse({...selection,length:3});
 const {displayTitle:_,...generationSelection}=parsed;void _;
 return v({scriptVersion:v({selection:generationSelection}),plan:doc.plan,style:parsed.artStyle,prompt:parsed.productionPrompt});
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

// 仍在准备阶段（未确认制作）的故事：升级后保持原样，准备任务与查找任务保留，确认时才建立 dag。
test('0025 leaves stories that are still in setup alone and keeps their preparation jobs',t=>{
 const lib=library(t),{sqlite,directory}=lib;
 const phases=['discovering','choosing','preparing','confirming'];
 const job=sqlite.prepare("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'[]',?,NULL,'queued',1,1)");
 const ids=phases.map((phase,i)=>{
  const id=`2222222${i}-2222-4222-8222-222222222222`;
  const intake={phase,generation:1,batches:[],search:{round:1,state:phase==='discovering'?'searching':'idle'}};
  sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,state,created_at,updated_at) VALUES(?,?,?,?,'idle','c','u')")
   .run(id,owner,JSON.stringify({...selection,length:3}),JSON.stringify({plan:null,images:[],audio:[],usage:[],intake}));
  job.run(`prep-${i}`,id,owner,phase==='discovering'?'discover':'prepare',phase==='discovering'?'search':'text','v',JSON.stringify({setupGeneration:1,searchRound:1}));
  return id;
 });
 migrate(sqlite,directory?process.cwd():process.cwd(),directory);
 for(const id of ids){
  const doc=JSON.parse(sqlite.prepare('SELECT document FROM stories WHERE id=?').get(id).document);
  assert.equal(doc.dag,undefined,doc.intake.phase+' gets no dag before confirmation');
 }
 assert.deepEqual(sqlite.prepare('SELECT id FROM production_jobs ORDER BY id').all().map(r=>r.id),['prep-0','prep-1','prep-2','prep-3'],'setup jobs survive');
});

test('a setup story that an earlier upgrade already gave an empty dag resumes its preparation',async t=>{
 const {productionFixture,until}=await import('./fixtures/production.mjs');
 const f=await productionFixture(t,'codex');
 f.control.hold=false;
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦醒后的庄周思考自己的经历。',artRecommendation:{artStyle:'paper-cut',reason:'层次适合梦境。'}}],note:''});
 const created=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}});
 // 模拟旧版升级写入的空转换 dag。
 const {convertDocument}=await import('../lib/production-dag/convert.ts');
 const row=await f.app.services.database.prepare('SELECT document,selection FROM stories WHERE id=?').bind(created.id).first();
 const dag=convertDocument(JSON.parse(row.document),selectionSchema.parse(JSON.parse(row.selection)),{confirmed:false});
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.dag',json(?)) WHERE id=?").bind(JSON.stringify(dag),created.id).run();
 if(created.intake.search.state==='idle'&&!created.intake.batches.length)await f.startDiscovery(created.id);
 await f.demand(created.id);
 await until(async()=>(await f.read(created.id)).intake.phase==='choosing',20000);
 await f.json(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(created.id)).intake.generation,action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(created.id)).intake.phase==='confirming',20000);
 const saved=JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(created.id).first()).document);
 assert.equal(saved.dag,undefined,'the empty dag is dropped and preparation ran');
});
