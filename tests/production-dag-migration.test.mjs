// 迁移 0025：在临时书库上从 0024 升级，核对文档 v2 转换、旧绘图结果采用、故障归属、旧任务作废、触发器与格式版本。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createCanvas} from '@napi-rs/canvas';
import {historicalLibrary} from './fixtures/historical-library.mjs';
import {migrate} from '../server/database-migrations.ts';
import {ensureLibraryReady} from '../server/library-upgrade.ts';
import {restoreLibraryBackup,verifyLibraryBackup} from '../server/library-backup.ts';
import {selection,makePlan} from './fixtures/production-data.mjs';
import {selectionSchema} from '../lib/reader-model.ts';
import {decodeDocument} from '../lib/production-dag/document.ts';
import {png} from './fixtures/images.mjs';

const localOwner='docker-local-owner';
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
 for(const page of [0,1])writeFileSync(path.join(directory,'media','reader',story,`${page}.png`),png);
}
const fingerprint=input=>digest(JSON.stringify(input));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const legacyVersion=doc=>{
 // 与 0.14 协调器相同：按解析后的选择（含默认值）计算。
 const parsed=selectionSchema.parse({...selection,length:3});
 const {displayTitle:_,...generationSelection}=parsed;void _;
 return fingerprint({scriptVersion:fingerprint({selection:generationSelection}),plan:doc.plan,style:parsed.artStyle,prompt:parsed.productionPrompt});
};

test('0025 converts stories, adopts a paid image, maps faults and clears old jobs',async t=>{
 const lib=library(t),plan=makePlan(3);
 const doc={plan,images:[url(0),'',''],audio:[],usage:[],original:{title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'local',retrievedAt:'2026-01-01'},visualReview:{history:[],status:'passed',round:1,repairs:0,issues:[],repaired:[],reports:[]},revision:{handoff:true,number:2,parentId:'p',rootId:'p',baseToken:'b',requestHash:'h',base:{}}};
 seed(lib,doc);
 const {sqlite,directory}=lib;
 const version=legacyVersion(doc);
 const job=sqlite.prepare("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'[]',?,?,?,1,1)");
 job.run('paid',story,owner,'image','image',version,JSON.stringify({page:1}),JSON.stringify({value:url(1)}),'succeeded');
 job.run('stale',story,owner,'image','image','old-version',JSON.stringify({page:2}),JSON.stringify({value:url(2)}),'succeeded');
 job.run('search',story,owner,'discover','search','r',JSON.stringify({searchRound:1}),null,'queued');
 job.run('old-review',story,owner,'script','text','r',JSON.stringify({stepKey:'review:0'}),null,'queued');
 const fault=sqlite.prepare("INSERT INTO reader_faults(id,session_id,owner_id,job_id,kind,page,version,message,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,1)");
 fault.run('lost',story,owner,null,'image-loss',2,'v','这幅图片的文件已丢失或损坏。','pending');
 fault.run('text',story,owner,'paid','job',null,'v','制作未完成','recovering');
 sqlite.prepare("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,status,created_at,updated_at) VALUES('cmd',?,?,'recover','f','{}','text','queued',1,1)").run(owner,story);

 migrate(sqlite,process.cwd(),directory,'0025_production_dag.sql');

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

test('an unreadable story is preserved and logged without stopping the upgrade',t=>{
 const diagnostics=t.mock.method(console,'error',()=>{});
 const lib=library(t);
 lib.sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,state,created_at,updated_at) VALUES('bad',?,'{}','not json','idle','c','u')").run(owner);
 seed(lib,{plan:makePlan(3),images:['','',''],audio:[],usage:[]});
 migrate(lib.sqlite,process.cwd(),lib.directory);
 assert.equal(lib.sqlite.prepare("SELECT document FROM stories WHERE id='bad'").get().document,'not json');
 assert.ok(diagnostics.mock.calls.some(({arguments:[event,detail]})=>event==='production_dag_conversion_skipped'&&JSON.parse(detail).id==='bad'));
 assert.ok(JSON.parse(lib.sqlite.prepare('SELECT document FROM stories WHERE id=?').get(story).document).dag);
});

// 仍在准备阶段（未确认制作）的故事：升级后保持原样，准备任务与查找任务保留，运行时接管。
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
 migrate(sqlite,process.cwd(),directory);
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
 if(created.intake.search.state==='idle'&&!created.intake.batches.length)await f.startDiscovery(created.id);
 await f.demand(created.id);
 await until(async()=>(await f.read(created.id)).intake.phase==='choosing',20000);
 await f.json(`sessions/${created.id}/production-control`,'POST',{action:'pause'});
 await f.json(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(created.id)).intake.generation,action:'choose',batch:0,index:0});
 // 模拟旧版升级为已选定、尚未准备的故事写入空转换 dag。
 const {convertDocument}=await import('../server/migrations/production-v2.ts');
 const row=await f.app.services.database.prepare('SELECT document,selection FROM stories WHERE id=?').bind(created.id).first();
 const historical=JSON.parse(row.document);
 const dag=convertDocument(historical,selectionSchema.parse(JSON.parse(row.selection)),{confirmed:false});
 const {directory,sqlite}=library(t);
 migrate(sqlite,process.cwd(),directory,'0027_revision_fault_targets.sql');
 sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,state,generation_control,created_at,updated_at) VALUES(?,?,?,?,'idle','paused','c','u')")
  .run(created.id,localOwner,row.selection,JSON.stringify({...historical,plan:null,images:[],dag}));
 migrate(sqlite,process.cwd(),directory);
 const migrated=sqlite.prepare('SELECT document FROM stories WHERE id=?').get(created.id).document;
 assert.equal(JSON.parse(migrated).dag,undefined);
 await f.app.services.database.prepare("UPDATE stories SET document=? WHERE id=?").bind(migrated,created.id).run();
 await f.json(`sessions/${created.id}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(created.id)).intake.phase==='confirming',20000);
 const saved=decodeDocument(await f.app.services.database.prepare('SELECT * FROM story_rows WHERE id=?').bind(created.id).first());
 assert.equal(saved.dag.legacy,undefined);
 assert.deepEqual(saved.dag.order,[]);
 assert.ok(saved.dag.products['source:']);
 assert.ok(saved.dag.products['suggestions:']);
 assert.equal(f.control.recommendations.length,1);
 await f.json(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'confirm',settings:{artStyle:'paper-cut',productionPrompt:'',narrativeDetail:'balanced',length:2}});
 await until(async()=>(await f.read(created.id)).state==='completed',15000);
 assert.deepEqual(f.control.calls.map(call=>call.page).sort(),[0,1]);
});


test('0025 keeps the pending slots of a partial storyboard and adopts only readable images and current landscapes',async t=>{
 const lib=library(t),{sqlite,directory}=lib,plan=makePlan(20);
 // 24 个提纲节点只保存了 20 幅：另外 4 个幅位仍须待生成。
 const beats=Array.from({length:24},(_,i)=>`节点${i+1}`);
 const doc={plan:null,storyboard:{outline:{title:'庄周梦蝶',summary:'梗概',sourceReference:'庄子',adaptationNote:'按原文',characters:plan.characters,beats},pages:plan.pages},images:[],audio:[],usage:[],original:{title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'local',retrievedAt:'2026-01-01'}};
 seed(lib,doc);
 migrate(sqlite,process.cwd(),directory);
 const saved=decodeDocument(sqlite.prepare('SELECT * FROM story_rows WHERE id=?').get(story));
 assert.equal(saved.dag.order.length,24);
 assert.equal(saved.dag.brief,doc.storyboard.outline.summary);
 assert.equal(saved.dag.characters[0].text,plan.characters);
 assert.equal(saved.dag.frames['legacy-20'].scene,plan.pages[19].caption);
 assert.equal(saved.dag.frames['legacy-21'].scene,'','an unsaved slot waits for its scene');
 assert.equal(saved.dag.products['scene:legacy-21'],undefined);
});

test('0025 does not adopt an image that is not a real picture, nor a landscape for other inputs',async t=>{
 const lib=library(t),{sqlite,directory}=lib,plan=makePlan(3);
 const doc={plan,images:[url(0),'',''],audio:[],usage:[],original:{title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'local',retrievedAt:'2026-01-01'}};
 seed(lib,doc);
 // 第 2 幅文件内容不是图片。
 writeFileSync(path.join(directory,'media','reader',story,'1.png'),'png');
 const version=legacyVersion(doc);
 const job=sqlite.prepare("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'[]',?,?,'succeeded',1,1)");
 job.run('paid-bad',story,owner,'image','image',version,JSON.stringify({page:1}),JSON.stringify({value:url(1)}));
 job.run('land',story,owner,'landscape-image','image','some-other-inputs',JSON.stringify({page:0}),JSON.stringify({value:url(0)}));
 migrate(sqlite,process.cwd(),directory);
 const saved=JSON.parse(sqlite.prepare('SELECT document FROM stories WHERE id=?').get(story).document);
 assert.equal(saved.dag.frames['legacy-1'].landscape,undefined,'a landscape for other inputs is not adopted');
 assert.equal(saved.dag.frames['legacy-2'].image,undefined,'a paid result whose file is not a picture is not adopted');
});

test('0025 retains the current authorized unfinished landscape work before clearing the old queue',t=>{
 const {directory,sqlite}=library(t);
 const plan=makePlan(4),images=plan.pages.map((_,page)=>url(page));
 const doc={plan,images,audio:[],usage:[],original:{title:'庄子',text:'庄周梦蝶。',kind:'passage',provider:'local',retrievedAt:'2026-01-01'}};
 seed({directory,sqlite},doc);
 const folder=path.join(directory,'media','reader',story);
 for(const page of [2,3])writeFileSync(path.join(folder,`${page}.png`),png);
 const filename=`0-${'a'.repeat(64)}.png`;
 const landscape=`/api/reader/media/${story}/artifacts/${filename}`;
 const landscapeBytes=createCanvas(96,64).toBuffer('image/png');
 mkdirSync(path.join(folder,'artifacts'));
 writeFileSync(path.join(folder,'artifacts',filename),landscapeBytes);
 const selected=selectionSchema.parse({...selection,length:3});
 const version=fingerprint(['landscape-image',plan.characters,plan.pages,images,selected.artStyle,selected.productionPrompt]);
 const job=sqlite.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,created_at,updated_at)
  VALUES(?,?,?,'landscape-image','image',?,'[]',?,?,?,1,1)`);
 job.run('paid',story,owner,version,JSON.stringify({page:0}),JSON.stringify({value:landscape}),'succeeded');
 job.run('in-flight',story,owner,version,JSON.stringify({page:1}),null,'running');
 job.run('queued',story,owner,version,JSON.stringify({page:2}),null,'queued');
 job.run('failed',story,owner,version,JSON.stringify({page:3}),null,'failed');
 job.run('obsolete',story,owner,'old-input',JSON.stringify({page:2}),null,'queued');
 job.run('bad-page',story,owner,version,JSON.stringify({page:4}),null,'queued');
 sqlite.exec(`CREATE TRIGGER interrupt_landscape_migration BEFORE INSERT ON app_migrations
  WHEN NEW.name='0025_production_dag.sql' BEGIN SELECT RAISE(ABORT,'controlled interruption'); END`);
 assert.throws(()=>migrate(sqlite,process.cwd(),directory),/controlled interruption/);
 assert.equal(sqlite.prepare("SELECT count(*) AS total FROM production_jobs").get().total,6);
 assert.equal(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='migration_landscape_jobs'").get(),undefined);
 sqlite.exec('DROP TRIGGER interrupt_landscape_migration');
 migrate(sqlite,process.cwd(),directory,'0025_production_dag.sql');
 const saved=JSON.parse(sqlite.prepare('SELECT document FROM stories WHERE id=?').get(story).document);
 assert.equal(saved.dag.frames['legacy-1'].landscape,landscape);
 assert.deepEqual(readFileSync(path.join(folder,'artifacts',filename)),landscapeBytes);
 assert.equal(sqlite.prepare("SELECT count(*) AS total FROM production_jobs WHERE kind='landscape-image'").get().total,0);
 const retained=sqlite.prepare("SELECT job_id,page,state,json_extract(paid_result,'$.value') AS paid_image FROM migration_landscape_jobs WHERE session_id=? AND owner_id=? AND input_version=? ORDER BY page").all(story,owner,version);
 assert.deepEqual(retained.map(row=>[row.job_id,row.page,row.state,row.paid_image]),[
  ['paid',0,'succeeded',landscape],['in-flight',1,'running',null],['queued',2,'queued',null],['failed',3,'failed',null],
 ]);
 migrate(sqlite,process.cwd(),directory);
 const upgraded=JSON.parse(sqlite.prepare('SELECT document FROM stories WHERE id=?').get(story).document);
 assert.equal(upgraded.dag.frames['legacy-1'].landscape,undefined);
 const [print]=upgraded.landscapePrints;
 assert.equal(print.control,'paused');
 const dedicated=sqlite.prepare(`SELECT state,json_extract(result,'$.image') AS image FROM production_jobs
  WHERE kind='landscape-print' AND version=? ORDER BY priority`).all(print.id);
 assert.deepEqual(dedicated.map(row=>[row.state,row.image]),[['succeeded',landscape],['queued',null],['queued',null],['queued',null]]);
 assert.deepEqual(readFileSync(path.join(folder,'artifacts',filename)),landscapeBytes);
});

for(const prepared of [true,false])test(`an upgraded story with ${prepared?'saved':'interrupted'} recommendations converts paused with its saved frame count and starts nothing`,async t=>{
 const {productionFixture,until}=await import('./fixtures/production.mjs');
 const id=crypto.randomUUID();
 const original={title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'local',retrievedAt:'2026-01-01'};
 const doc={plan:null,images:[],audio:[],usage:[],original,...(prepared?{frameRecommendation:{count:3,reason:'保留完整因果。'}}:{})};
 const f=await productionFixture(t,'codex',{}, {initialize(directory,root){
  const sqlite=historicalLibrary(directory,root,'0024_prompt_records.sql');
  try{
   sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,generation_mode,state,created_at,updated_at) VALUES(?,?,?,?,'background','idle','c','u')")
    .run(id,localOwner,JSON.stringify({...selection,length:3,narrativeDetail:'balanced'}),JSON.stringify(doc));
   if(!prepared){
    sqlite.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,attempts,error,interrupted,failure_id,created_at,updated_at)
     VALUES('old-prepare',?,?,'prepare','text','legacy','[]','{}','failed',2,'已中断',1,'old-fault',1,1)`).run(id,localOwner);
    sqlite.prepare(`INSERT INTO reader_faults(id,session_id,owner_id,job_id,kind,version,message,created_at,updated_at)
     VALUES('old-fault',?,?,'old-prepare','interrupted','legacy','已中断',1,1)`).run(id,localOwner);
   }
  }finally{sqlite.close();}
 }});
 f.control.hold=false;
 await f.demand(id);
 await f.app.services.production.tick();
 const saved=async()=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);
 // 升级不替读者确认：转换为制作 DAG，保持暂停，不发起任何付费调用，也没有旧的幅数确认入口。
 await until(async()=>!!(await saved()).dag);
 assert.equal((await f.read(id)).generationControl,'paused');
 assert.equal((await f.request(`sessions/${id}/frame-count`,'POST',{count:2})).status,404,'the frame-count entry no longer exists');
 for(let i=0;i<10;i++)await f.app.services.production.tick();
 assert.deepEqual(f.control.calls,[]);
 assert.deepEqual(f.control.dagCalls,[]);
 // 读者点「恢复生成」后按已保存的幅数制作。
 await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});
 // 升级前被中断的准备留下的故障仍待处理，读者需明确重试。
 if(!prepared){const fault=(await f.read(id)).faults?.find(x=>x.state==='pending');assert.ok(fault,'the interrupted preparation fault is carried over');await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});}
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal((await saved()).dag.order.length,3);
 assert.deepEqual(f.control.calls.map(call=>call.page).sort(),[0,1,2]);


});


// 由正式应用启动执行迁移，复用同一批合成旧故事的备份验证重试和旧版回滚。
test('the production upgrade preserves saved text and media, and resumes only unfinished drawing',async t=>{
 const {productionFixture,until}=await import('./fixtures/production.mjs');
 const ids=Object.fromEntries(['complete','partial','storyboard','draft','revision','paid','lost','pixel-corrupt','broken'].map(name=>[name,crypto.randomUUID()]));
 const plan=makePlan(3);
 plan.summary='读者手改并保存的梗概。';
 plan.characters='读者手改并保存的人物说明。';
 plan.reflection='读者手改并保存的结语。';
 plan.pages[0].caption='读者手改并保存的首幅配文。';
 const original={title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'local',retrievedAt:'2026-01-01'};
 const savedMedia=new Map(),documents=new Map();
 const landscapeFile=`artifacts/0-${'a'.repeat(64)}.png`;
 const image=(directory,id,name,bytes)=>{
  const key=path.join('media','reader',id,name);
  mkdirSync(path.dirname(path.join(directory,key)),{recursive:true});
  writeFileSync(path.join(directory,key),bytes);
  savedMedia.set(key,digest(bytes));
  return `/api/reader/media/${id}/${name}`;
 };
 const documentsIn=sqlite=>new Map(sqlite.prepare('SELECT id,document FROM stories').all().map(({id,document})=>[id,document]));
 const assertMedia=directory=>{
  for(const [key,expected] of savedMedia)assert.equal(digest(readFileSync(path.join(directory,key))),expected,key);
 };
 let backup;
 const f=await productionFixture(t,'codex',{}, {initialize(directory,root){
  const sqlite=historicalLibrary(directory,root,'0024_prompt_records.sql');
  try{
   const insert=sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,saved,created_at,updated_at) VALUES(?,?,?,?,'background',?,?,1,'c','u')");
   const job=sqlite.prepare("INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,result,state,created_at,updated_at) VALUES(?,?,?,?,'image',?,'[]',?,?,'succeeded',1,1)");
   for(const [name,id] of Object.entries(ids)){
    if(name==='broken'){
     insert.run(id,localOwner,'{}','not json','paused','idle');
     documents.set(id,'not json');continue;
    }
    if(name==='storyboard'){
     const {pages,reflection:_,...metadata}=makePlan(24);
     const storyboard={outline:{...metadata,beats:pages.map((_,page)=>`第 ${page+1} 幅的已保存提纲。`)},pages:pages.slice(0,20)};
     const doc=JSON.stringify({plan:null,original,storyboard,images:[],audio:[],usage:[]});
     documents.set(id,doc);
     insert.run(id,localOwner,JSON.stringify({...selection,length:24}),doc,'paused','idle');
     continue;
    }
    if(name==='draft'){
     const {reflection:_,...draft}=plan;
     const doc=JSON.stringify({plan:null,original,draft,images:[],audio:[],usage:[]});
     documents.set(id,doc);
     insert.run(id,localOwner,JSON.stringify({...selection,length:3}),doc,'paused','idle');
     continue;
    }
    const images=plan.pages.map((_,page)=>page===0||name==='complete'?image(directory,id,`${page}.png`,png):'');
    if(name==='lost'){
     images[0]=image(directory,id,'0.png',Buffer.from('损坏的合成图片'));
     images[2]=image(directory,id,'2.png',png);
    }
    if(name==='pixel-corrupt'){
     // 保持 PNG 块结构和尺寸，破坏 IDAT 内压缩数据。
     const damaged=Buffer.from(png);
     damaged[damaged.indexOf(Buffer.from('IDAT'))+5]^=255;
     images[0]=image(directory,id,'0.png',damaged);
     images[2]=image(directory,id,'2.png',png);
    }
    const doc={plan,original,images,audio:[],usage:[],visualReview:{history:[],status:'passed',round:1,repairs:0,issues:[],repaired:[],reports:[]},
     ...(name==='revision'?{revision:{handoff:true,number:2,parentId:crypto.randomUUID(),rootId:id,baseToken:'base',requestHash:'revision',base:{}}}:{})};
    const serialized=JSON.stringify(doc);
    documents.set(id,serialized);
    insert.run(id,localOwner,JSON.stringify({...selection,length:3}),serialized,'paused',name==='complete'?'completed':'idle');
    if(name==='paid'){
     const value=image(directory,id,'1.png',png);
     job.run('paid-result',id,localOwner,'image',legacyVersion(doc),JSON.stringify({page:1}),JSON.stringify({value}));
    }
    if(name==='complete'){
     const landscape=image(directory,id,landscapeFile,createCanvas(96,64).toBuffer('image/png'));
     const version=fingerprint(['landscape-image',plan.characters,plan.pages,images,selection.artStyle,selection.productionPrompt]);
     job.run('landscape-result',id,localOwner,'landscape-image',version,JSON.stringify({page:0}),JSON.stringify({value:landscape}));
    }
   }
   // 在文档转换和 PRAGMA 更新之后、中途写迁移回执时失败，验证该事务整体回滚。
   sqlite.exec(`CREATE TRIGGER simulate_interruption BEFORE INSERT ON app_migrations
    WHEN NEW.name='0025_production_dag.sql' BEGIN SELECT RAISE(ABORT,'simulated interruption'); END`);
  }finally{sqlite.close();}
  assert.throws(()=>ensureLibraryReady(directory,root),/LIBRARY_MIGRATION_FAILED.*simulated interruption/);
  const interrupted=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
  try{
   assert.equal(interrupted.prepare('PRAGMA user_version').get().user_version,1);
   assert.deepEqual(documentsIn(interrupted),documents);
   assertMedia(directory);
   interrupted.exec('DROP TRIGGER simulate_interruption');
  }finally{interrupted.close();}
  ({backup}=ensureLibraryReady(directory,root));
 }});
 f.control.hold=false;
 const upgraded=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'),{readOnly:true});
 let converted;
 try{
  assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version,4);
  assert.ok(upgraded.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='production_attempt_reset'").get());
  converted=new Map(upgraded.prepare('SELECT * FROM story_rows').all().map(row=>[row.id,row]));
 }finally{upgraded.close();}
 assertMedia(f.dataDirectory);
 for(const [id,old] of documents){
  if(id===ids.broken){assert.equal(converted.get(id).document,old);continue;}
  const {plan:oldPlan,original:oldOriginal,images,storyboard,draft}=JSON.parse(old);
  const row=converted.get(id),raw=row.document,doc=decodeDocument(row);
  assert.equal(Object.hasOwn(JSON.parse(raw),'plan'),false);
  assert.equal(Object.hasOwn(JSON.parse(raw),'images'),false);
  assert.deepEqual(doc.plan,oldPlan);
  assert.deepEqual(doc.original,oldOriginal);
  assert.deepEqual(doc.images.filter((_,page)=>images[page]),images.filter(Boolean));
  if(storyboard){
   assert.equal(doc.storyboard,undefined);
   assert.equal(doc.dag.order.length,24);
   assert.equal(doc.dag.characters[0].text,storyboard.outline.characters);
   continue;
  }
  if(draft){
   assert.equal(doc.draft,undefined);
   assert.deepEqual(doc.dag.outline.beats,draft.pages.map(page=>page.caption));
   assert.equal(doc.dag.ending,undefined);
   continue;
  }
  assert.equal(doc.dag.frames['legacy-1'].scene,oldPlan.pages[0].caption);
  assert.equal(doc.dag.products['scene:legacy-1'].handEdited,undefined,'the legacy edit survives without a hand-edit marker');
 }
 const [legacyPrint]=JSON.parse(converted.get(ids.complete).document).landscapePrints;
 const savedLandscape=await f.app.services.database.prepare("SELECT result FROM production_jobs WHERE kind='landscape-print' AND version=? AND state='succeeded'").bind(legacyPrint.id).first();
 assert.equal(JSON.parse(savedLandscape.result).image,`/api/reader/media/${ids.complete}/${landscapeFile}`);
 assert.equal(decodeDocument(converted.get(ids.paid)).dag.frames['legacy-2'].image,`/api/reader/media/${ids.paid}/1.png`);
 const lost=await f.read(ids.lost);
 assert.equal(lost.ready,1);
 const loss=lost.faults.find(fault=>fault.page===0&&fault.state==='pending');
 assert.ok(loss,'an unreadable saved reference needs a recovery receipt before paying');
 assert.equal((await f.read(ids.complete)).state,'completed');
 assert.equal((await f.read(ids.revision)).awaitingContinue,true);
 assert.equal((await f.read(ids.revision)).generationControl,'paused');
 assert.deepEqual(f.control.calls,[]);
 assert.deepEqual([...f.control.textVia],[]);

 verifyLibraryBackup(backup);
 const replay=path.join(f.root,'upgrade-replay');
 restoreLibraryBackup(backup,replay);
 // 重试保留首次回退点，其中仍有测试注入的故障触发器；只从隔离重放副本移除。
 const replayBefore=new DatabaseSync(path.join(replay,'shiqu.sqlite'));
 try{replayBefore.exec('DROP TRIGGER simulate_interruption');}finally{replayBefore.close();}
 ensureLibraryReady(replay,f.root);
 const replayDb=new DatabaseSync(path.join(replay,'shiqu.sqlite'),{readOnly:true});
 try{assert.deepEqual(documentsIn(replayDb),new Map([...converted].map(([id,row])=>[id,row.document])),'the same backup produces identical converted documents');}
 finally{replayDb.close();}
 assertMedia(replay);

 const baseline=process.env.SHIQU_TEST_V014_ROOT;
 await t.test('v0.14.0 opens the restored format 1 backup and refuses format 2',{skip:!baseline&&'Set SHIQU_TEST_V014_ROOT to the v0.14.0 checkout'},async()=>{
  assert.equal(JSON.parse(readFileSync(path.join(baseline,'package.json'),'utf8')).version,'0.14.0');
  const {createApplication}=await import(pathToFileURL(path.join(baseline,'server/app.ts')).href);
  const dataDirectory=path.join(f.root,'rollback-v014');
  restoreLibraryBackup(backup,dataDirectory);
  const options={root:baseline,variables:{SHIQU_AI_PROVIDER:'readonly'},transport:async()=>assert.fail('rollback attempted a network request')};
  const app=createApplication({...options,dataDirectory});
  try{
   const sqlite=new DatabaseSync(path.join(dataDirectory,'shiqu.sqlite'),{readOnly:true});
   try{
    assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version,1);
    assert.deepEqual(documentsIn(sqlite),documents);
   }finally{sqlite.close();}
   for(const id of Object.values(ids).filter(id=>id!==ids.broken)){
    const response=await app.handle(new Request(`http://localhost/api/reader/sessions/${id}`));
    assert.equal(response.status,200);
    assert.equal((await response.json()).id,id);
   }
   assertMedia(dataDirectory);
   const {exportLocalStory}=await import('../server/story-export.ts'),{unzipSync}=await import('fflate');
   const before=await (await app.handle(new Request('http://localhost/api/reader/sessions/'+ids.complete))).json();
   const after=await f.read(ids.complete),archive=async(name,service,session)=>{
    const output=path.join(f.root,name+'.zip');
    await exportLocalStory(process.cwd(),service,session,{format:'zip',output,allowUnsigned:true});
    return unzipSync(readFileSync(output));
   };
   const oldZip=await archive('before-upgrade',app,before),newZip=await archive('after-upgrade',f.app,after);
   const filenames=Object.keys(oldZip).sort();
   assert.deepEqual(Object.keys(newZip).sort(),filenames);
   assert.ok(filenames.includes('故事.json')&&filenames.includes('分镜.md')&&filenames.filter(name=>name.endsWith('.webp')).length===before.story.pages.length);
   for(const name of filenames)assert.deepEqual(newZip[name],oldZip[name],name);
   assert.throws(()=>createApplication({...options,dataDirectory:replay}),/LIBRARY_NEWER_SCHEMA.*use a newer Shiqu app/);
  }finally{await app.close();}
 });

 for(const [name,action,expected] of [['partial','resume',[1,2]],['revision','continue',[1,2]],['paid','resume',[2]]]){
  const start=f.control.calls.length;
  await f.json(`sessions/${ids[name]}/production-control`,'POST',{action});
  await until(async()=>(await f.read(ids[name])).state==='completed',15000);
  assert.deepEqual(f.control.calls.slice(start).map(call=>call.page).sort(),expected,name);
 }
 assert.deepEqual([...f.control.textVia],[],'legacy reviewed text does not incur another call');

 const beforeRecovery=f.control.calls.length;
 await f.json(`sessions/${ids.lost}/production-control`,'POST',{action:'resume'});
 await f.app.services.production.tick();
 assert.equal(f.control.calls.length,beforeRecovery);
 await f.json(`sessions/${ids.lost}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:loss.id});
 await until(async()=>(await f.read(ids.lost)).state==='completed',15000);
 assert.deepEqual(f.control.calls.slice(beforeRecovery).map(call=>call.page),[0,1]);
 const beforePixelCheck=f.control.calls.length;
 await f.json(`sessions/${ids['pixel-corrupt']}/production-control`,'POST',{action:'resume'});
 const pixelFault=async()=>(await f.read(ids['pixel-corrupt'])).faults?.find(fault=>fault.page===0&&fault.state==='pending');
 await until(pixelFault,15000);
 assert.equal(f.control.calls.length,beforePixelCheck,'a damaged pixel stream cannot reach the drawing provider');
 await f.json(`sessions/${ids['pixel-corrupt']}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:(await pixelFault()).id});
 await until(async()=>(await f.read(ids['pixel-corrupt'])).state==='completed',15000);
 assert.deepEqual(f.control.calls.slice(beforePixelCheck).map(call=>call.page),[0,1]);
 const storyboard=JSON.parse(documents.get(ids.storyboard)).storyboard,batches=[];
 f.control.beforeText=(name,payload)=>{if(name==='storyboard')batches.push(payload.batch);};
 const start=f.control.calls.length;
 await f.json(`sessions/${ids.storyboard}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(ids.storyboard)).state==='completed',25000);
 const completed=await f.read(ids.storyboard);
 assert.equal(completed.story.summary,storyboard.outline.summary);
 assert.deepEqual(completed.story.pages.slice(0,20).map(page=>page.caption),storyboard.pages.map(page=>page.caption));
 assert.deepEqual(batches,[{first:21,last:24}]);
 for(const name of ['brief','outline','characters'])assert.ok(!f.control.dagCalls.includes(name),name);
 assert.deepEqual(f.control.calls.slice(start).map(call=>call.page).sort((a,b)=>a-b),Array.from({length:24},(_,page)=>page));
 const draft=JSON.parse(documents.get(ids.draft)).draft;
 const beforeDraft=f.control.dagCalls.length,endingCalls=f.control.reflections.length,reviewCalls=f.control.reviews.length;
 await f.json(`sessions/${ids.draft}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(ids.draft)).state==='completed',15000);
 const draftDoc=decodeDocument(await f.app.services.database.prepare('SELECT * FROM story_rows WHERE id=?').bind(ids.draft).first());
 assert.deepEqual(draftDoc.plan.pages,draft.pages);
 assert.deepEqual(f.control.dagCalls.slice(beforeDraft),[],'saved text checkpoints are reused');
 assert.equal(f.control.reflections.length-endingCalls,1);
 assert.equal(f.control.reviews.length-reviewCalls,1);
 assertMedia(f.dataDirectory);
});

test('0026 auto-migrates format 2 after a verified backup and can retry a rolled back migration',t=>{
 const root=process.cwd(),parent=mkdtempSync(path.join(os.tmpdir(),'shiqu lifecycle migration ')),directory=path.join(parent,'library');
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 let sqlite=historicalLibrary(directory,root,'0025_production_dag.sql');
 sqlite.exec(`CREATE TRIGGER interrupt_lifecycle BEFORE INSERT ON app_migrations WHEN NEW.name='0026_production_lifecycle.sql'
  BEGIN SELECT RAISE(ABORT,'controlled lifecycle interruption'); END`);
 sqlite.close();
 assert.throws(()=>ensureLibraryReady(directory,root),/LIBRARY_MIGRATION_FAILED.*controlled lifecycle interruption/);
 sqlite=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
 assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version,2);
 assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='reader_faults_origin_frame'").get(),undefined);
 sqlite.exec('DROP TRIGGER interrupt_lifecycle');
 sqlite.close();
 const result=ensureLibraryReady(directory,root);
 assert.deepEqual(result.migrations,['0026_production_lifecycle.sql','0027_revision_fault_targets.sql','0028_production_spec.sql']);
 verifyLibraryBackup(result.backup);
 const original=new DatabaseSync(path.join(result.backup,'shiqu.sqlite'),{readOnly:true});
 try{assert.equal(original.prepare('PRAGMA user_version').get().user_version,2);}finally{original.close();}
 const upgraded=new DatabaseSync(path.join(directory,'shiqu.sqlite'),{readOnly:true});
 try{
  assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version,4);
  assert.equal(upgraded.prepare("SELECT type FROM sqlite_master WHERE name='production_faults'").get().type,'view');
  assert.ok(upgraded.prepare("SELECT name FROM app_migrations WHERE name='0026_production_lifecycle.sql'").get());
 }finally{upgraded.close();}
 assert.equal(ensureLibraryReady(directory,root),undefined);
});

for(const format of [2,3])test(`0028 merges format ${format} whole-story decisions in one backup-backed upgrade and pauses old reader work`,async t=>{
 const {sqlite,directory}=library(t);
 migrate(sqlite,process.cwd(),directory,format===2?'0025_production_dag.sql':'0027_revision_fault_targets.sql');
 const {convertDocument,rootProducts,versionState,evaluate,fingerprint:oldFingerprint}=await import('../server/migrations/production-v2.ts');
 const {stateOf,work}=await import('../lib/production-dag/runner.ts');
 const {evaluate:current}=await import('../lib/production-dag/engine.ts');
 const {selectionSchema}=await import('../lib/reader-model.ts');
 const original={title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'local',retrievedAt:'2026-01-01'};
 const selected=selectionSchema.parse({...selection,length:3,acceptancePrompt:'保留原文结局\n首尾呼应'});
 for(const mask of ['pass','override','blocked','deferred']){
  const id='old-review-'+mask,doc={plan:makePlan(3),images:[],audio:[],usage:[],original};
  const dag=convertDocument(doc,selected,{confirmed:true});
  dag.items=[{id:'a',text:'保留原文结局',scope:'story',evidence:['scenes']},{id:'b',text:'首尾呼应',scope:'story',evidence:['ending']}];
  delete dag.resumeUnreviewed;
  for(const product of Object.values(dag.products)){delete product.unreviewed;delete product.legacy;}
  const graph=()=>evaluate(versionState(dag,rootProducts(selected,dag),{confirmed:true,skipFrameCheck:true}));
  for(const item of dag.items){
   const inst=graph().instance('itemRegistration',item.id);
   dag.products[inst.id]={hash:oldFingerprint(item),inputs:inst.hard,scope:item.scope,evidence:item.evidence};
  }
  for(const item of dag.items){
   if(item.id==='b'&&mask==='deferred')continue;
   const inst=graph().instance('itemVerdict',item.id);
   const fail=item.id==='b'&&['override','blocked'].includes(mask);
   dag.products[inst.id]={hash:oldFingerprint(item.text),inputs:inst.hard,outcome:fail?'fail':'pass',...(fail&&mask==='override'?{overridden:true}:{})};
   (dag.verdicts??={})[inst.id]={outcome:fail?'fail':'pass',detail:'旧审片依据'};
  }
  dag.products['frameVerdict:legacy-2'].overridden=true;
  sqlite.prepare(`INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at)
   VALUES(?,?,?,?,'reader','active','idle','2026-11-01','2026-11-01')`).run(id,owner,JSON.stringify(selected),JSON.stringify({...doc,dag}));
 }
 if(format===3)sqlite.prepare(`INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,message,state,origin_fault_id,created_at,updated_at)
  VALUES('old-inherited','old-review-pass',?,'image-loss','frameImage','legacy-1','dag','已丢图','awaiting-match','parent-fault',1,1)`).run(owner);
 const report=ensureLibraryReady(directory,process.cwd());
 assert.deepEqual(report.migrations,[...(format===2?['0026_production_lifecycle.sql','0027_revision_fault_targets.sql']:[]),
  '0028_production_spec.sql']);
 verifyLibraryBackup(report.backup);
 if(format===3)assert.equal(sqlite.prepare("SELECT state FROM production_faults WHERE id='old-inherited'").get().state,'replaced');
 for(const mask of ['pass','override','blocked','deferred']){
  const id='old-review-'+mask,row=sqlite.prepare('SELECT * FROM story_rows WHERE id=?').get(id),doc=decodeDocument(row),dag=doc.dag;
  assert.equal(Object.hasOwn(row,'generation_mode'),false);assert.equal(row.generation_control,'paused');assert.equal(dag.items,undefined);
  assert.equal(dag.products['frameVerdict:legacy-2'].overridden,true);
  const story={id,doc,dag,selection:selected,confirmed:true,faults:[]};
  const verdict=dag.products['narrativeVerdict:'];
  if(mask==='deferred'){
   assert.equal(verdict,undefined);
   assert.deepEqual(work(story).filter(item=>item.call==='review').map(item=>item.instances.map(instance=>instance.id)),[['narrativeVerdict:']]);
   continue;
  }
  assert.equal(current(stateOf(story)).instance('narrativeVerdict').status,'valid');
  assert.equal(verdict.outcome,mask==='pass'?'pass':'fail');
  assert.equal(!!verdict.overridden,mask==='override');
  assert.equal(dag.verdicts['narrativeVerdict:'].acceptance[1].evidence,'旧审片依据');
 }
});

test('a migrated paused landscape resumes through the standard endpoint with its returned ID',async t=>{
 const {productionFixture,until}=await import('./fixtures/production.mjs');
 const id=crypto.randomUUID(),plan=makePlan(3),images=plan.pages.map((_,index)=>`/api/reader/media/${id}/${index}.png`);
 const source={plan,images,audio:[],usage:[],original:{title:'庄子',text:'庄周梦蝶。',kind:'passage',provider:'local',retrievedAt:'2026-01-01'}};
 const f=await productionFixture(t,'codex',{}, {initialize(directory,root){
  const sqlite=historicalLibrary(directory,root,'0024_prompt_records.sql');
  try{
   const selected=selectionSchema.parse({...selection,length:3});
   sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,state,created_at,updated_at) VALUES(?,?,?,?,'completed','c','u')")
    .run(id,localOwner,JSON.stringify(selected),JSON.stringify(source));
   const folder=path.join(directory,'media','reader',id);
   mkdirSync(folder,{recursive:true});
   for(let page=0;page<images.length;page++)writeFileSync(path.join(folder,page+'.png'),png);
   const oldVersion=fingerprint(['landscape-image',plan.characters,plan.pages,images,selected.artStyle,selected.productionPrompt]);
   const queue=sqlite.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,created_at,updated_at)
    VALUES(?,?,?,'landscape-image','image',?,'[]',?,'queued',1,1)`);
   for(let page=0;page<images.length;page++)queue.run('print-'+page,id,localOwner,oldVersion,JSON.stringify({page}));
  }finally{sqlite.close();}
 }});
 const route=`sessions/${id}/landscape`,paused=await f.json(route);
 assert.equal(paused.control,'paused');assert.ok(paused.printId);
 assert.equal(f.control.calls.length,0);
 f.control.hold=false;
 await f.json(route,'POST',{control:'resume',printId:paused.printId});
 await until(async()=>(await f.json(route)).state==='completed');
 assert.deepEqual(f.control.calls.map(call=>[call.page,call.landscape]),[[0,true],[1,true],[2,true]]);
});

test('format three migrates recoverable residual documents and preserves unreadable ones with a shelf diagnostic',async t=>{
 const {productionFixture}=await import('./fixtures/production.mjs');
 const valid=crypto.randomUUID(),invalid=crypto.randomUUID(),plan=makePlan(3),raw='not a valid story document';
 const f=await productionFixture(t,'codex',{}, {initialize(directory,root){
  const sqlite=historicalLibrary(directory,root,'0027_revision_fault_targets.sql');
  try{
   const insert=sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,state,generation_control,created_at,updated_at) VALUES(?,?,?,?,'idle','paused','c','u')");
   insert.run(valid,localOwner,JSON.stringify({...selection,length:3}),JSON.stringify({plan,images:[],audio:[],usage:[]}));
   insert.run(invalid,localOwner,JSON.stringify({...selection,length:3}),raw);
  }finally{sqlite.close();}
 }});
 const row=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(invalid).first();
 assert.equal(row.document,raw);
 assert.equal((await f.read(valid)).story.pages[0].caption,plan.pages[0].caption);
 const shelf=await f.json('library/shelf'),diagnostic=shelf.find(item=>item.id===invalid);
 assert.match(diagnostic?.error??diagnostic?.stage??'',/转换|处理/);
 assert.equal(f.control.calls.length+f.control.reviews.length,0);
});

test('format four keeps all four setup requirement states from the effective historical draft',t=>{
 const {sqlite,directory}=library(t);migrate(sqlite,process.cwd(),directory,'0027_revision_fault_targets.sql');
 const settings={artStyle:'ink-pencil',narrativeDetail:'balanced',length:'auto'};
 const suggestions={productionPrompt:'保留主人公的回应。',acceptancePrompt:'结尾保留原文结果。'};
 const entries=[
  {id:'awaiting',draft:{...settings,productionPrompt:''},edited:{}},
  {id:'suggested',draft:{...settings,...suggestions},suggestions,edited:{}},
  {id:'written',draft:{...settings,...suggestions,productionPrompt:'以拒绝为核心场面。'},suggestions,edited:{productionPrompt:true}},
  {id:'blank',draft:{...settings,...suggestions,acceptancePrompt:''},suggestions,edited:{acceptancePrompt:true}},
 ];
 const insert=sqlite.prepare("INSERT INTO stories(id,user_id,selection,document,state,generation_control,created_at,updated_at) VALUES(?,?,?,?,'idle','paused','c','u')");
 for(const entry of entries)insert.run(entry.id,owner,JSON.stringify({...selection,productionPrompt:'',acceptancePrompt:'',length:'auto'}),
  JSON.stringify({plan:null,images:[],audio:[],usage:[],intake:{phase:'confirming',generation:1,batches:[],draft:entry.draft},
   ...(entry.suggestions?{setupRequirements:{suggestions:entry.suggestions}}:{})}));
 migrate(sqlite,process.cwd(),directory);
 for(const entry of entries){
  const doc=decodeDocument(sqlite.prepare('SELECT * FROM story_rows WHERE id=?').get(entry.id));
  assert.deepEqual(doc.intake.draft,entry.draft);
  assert.deepEqual(doc.setupRequirements.edited,entry.edited);
 }
});

for(const mode of ['active','reader-paused','recovery'])test(`an upgraded draft with a paid separate outline continues with one storyboard call (${mode})`,async t=>{
 const {productionFixture,until}=await import('./fixtures/production.mjs');
 const {apply,requestFor,settle,stateOf,work}=await import('../lib/production-dag/runner.ts');
 const {evaluate}=await import('../lib/production-dag/engine.ts');
 const {emptyDag}=await import('../lib/production-dag/document.ts');
 const {fingerprint:stableFingerprint}=await import('../lib/production-dag/fingerprint.ts');
 const id=crypto.randomUUID(),faultId=crypto.randomUUID(),requestId=crypto.randomUUID();
 const picked=selectionSchema.parse({...selection,length:3}),plan=makePlan(3);
 const doc={plan:null,images:[],audio:[],usage:[],original:{title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'fixture',retrievedAt:'2026-01-01'}};
 const basis={id,doc,selection:picked,dag:emptyDag(),confirmed:true,faults:[]};
 for(const [name,value] of [['prepareBrief',plan.summary],['characters',[{id:'c1',name:'庄周',aliases:['庄子'],text:plan.characters}]]]){
  basis.dag=settle(basis);
  // 旧版先单独完成人物设定；新版不再单独派发，这里按旧任务写入。
  const item=work(basis).find(entry=>entry.call===name)??{call:name,instances:[evaluate(stateOf(basis)).instance(name==='prepareBrief'?'brief':name)]};
  basis.dag=apply(basis,item,value,{newId:()=>crypto.randomUUID()});
 }
 // 旧版的独立提纲任务。新版不再派发它，未完成稿件改用合批分镜。
 const outline={call:'outline',instances:[evaluate(stateOf({...basis,dag:settle(basis)})).instance('outline')]};
 const request=requestFor(basis,outline),targets=outline.instances.map(item=>[item.id,item.hard??null]);
 const legacyId=stableFingerprint(['dag-job',id,null,'outline',0,targets,request]);
 const paidTitle='已经付费的提纲';
 const receipt=title=>({value:{title,summary:plan.summary,sourceReference:plan.sourceReference,adaptationNote:plan.adaptationNote,
  beats:plan.pages.map(page=>page.caption)},model:'paid-fixture',requestId:'original-paid-request',usage:{calls:1},
  entry:{step:'dag:outline',model:'paid-fixture',requestId:'original-paid-request',usage:{calls:1}}});
 const report=[];
 const recovering=mode==='recovery';
 const running=recovering;
 const f=await productionFixture(t,'codex',{}, {initialize(directory,root){
  const sqlite=historicalLibrary(directory,root,'0027_revision_fault_targets.sql');
  try{
   sqlite.prepare(`INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at)
    VALUES(?,?,?,?,?,'active','idle','c','u')`).run(id,localOwner,JSON.stringify(picked),JSON.stringify({...doc,dag:{...basis.dag,items:[]}}),
    mode==='reader-paused'?'reader':'background');
   sqlite.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,attempts,lease_token,lease_until,recovery_id,created_at,updated_at)
    VALUES(?,?,?,'dag','text','dag','[]',?,?,1,?,?,?,1,2)`).run(legacyId,id,localOwner,JSON.stringify({work:outline,paid:receipt(paidTitle)}),
    running?'running':'queued',running?'old-lease':null,running?1:0,recovering?requestId:null);
   if(recovering){
    sqlite.prepare(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,status,created_at,updated_at)
     VALUES(?,?,?,'recover','preserved-fingerprint',?,?,'running',1,2)`).run(requestId,localOwner,id,JSON.stringify({jobs:[legacyId],resolutionJob:legacyId}),faultId);
    sqlite.prepare(`INSERT INTO reader_faults(id,session_id,owner_id,job_id,kind,node,node_key,version,message,state,command_id,created_at,updated_at)
     VALUES(?,?,?,?,'job','outline','','dag','重复派发不应发生','recovering',?,1,2)`).run(faultId,id,localOwner,legacyId,requestId);
   }
  }finally{sqlite.close();}
  report.push(ensureLibraryReady(directory,root));
 }});
 assert.ok(report[0].migrations.includes('0028_production_spec.sql'));
 verifyLibraryBackup(report[0].backup);
 f.control.hold=false;
 if(mode==='reader-paused'){
  await f.app.services.production.tick();
  assert.equal((await f.read(id)).generationControl,'paused');
  assert.equal(f.control.dagCalls.length,0);
  await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});
 }
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',15000);
 const database=f.app.services.database;
 const saved=decodeDocument(await database.prepare('SELECT * FROM story_rows WHERE id=?').bind(id).first());
 assert.equal(f.control.dagCalls.filter(call=>call==='outline').length,0);
 assert.equal(f.control.dagCalls.filter(call=>call==='storyboard').length,1);
 assert.notEqual(saved.dag.outline.title,paidTitle);
 assert.equal(saved.usage.filter(call=>call.requestId==='original-paid-request').length,0);
});
