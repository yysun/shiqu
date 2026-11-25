// 在临时书库中验证格式 4 开发预览的结构及付费回执修复。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {historicalLibrary} from './fixtures/historical-library.mjs';
import {finalizeProductionSpec} from '../server/migrations/production-v4.ts';
import {ensureLibraryReady} from '../server/library-upgrade.ts';
import {verifyLibraryBackup} from '../server/library-backup.ts';
import {selection,makePlan} from './fixtures/production-data.mjs';
import {selectionSchema} from '../lib/reader-model.ts';
import {decodeDocument} from '../lib/production-dag/document.ts';
import {png} from './fixtures/images.mjs';

const localOwner='docker-local-owner';

function previewShape(db){
 db.exec(`CREATE TABLE production_migration_diagnostics(session_id TEXT NOT NULL,owner_id TEXT NOT NULL,code TEXT NOT NULL,
  PRIMARY KEY(session_id,owner_id)); PRAGMA user_version=4;
  INSERT INTO app_migrations VALUES('0028_production_spec.sql','preview');`);
}

test('0029 repairs the preview format 4 receipt and the production scheduler resumes after a verified backup',async t=>{
 const {productionFixture}=await import('./fixtures/production.mjs');
 const {normalizeStoryDocument}=await import('../server/migrations/production-v4.ts');
 const id=crypto.randomUUID(),legacy=crypto.randomUUID(),plan=makePlan(3);
 const selected=selectionSchema.parse({...selection,length:3});
 const doc={plan,images:[],audio:[],usage:[]};
 const dag=normalizeStoryDocument(id,doc,selected);
 const report=[];
 const f=await productionFixture(t,'codex',{}, {initialize(directory,root){
  const db=historicalLibrary(directory,root,'0027_revision_fault_targets.sql');
  try{
   previewShape(db);
   db.exec(`ALTER TABLE stories ADD COLUMN shelf_cover TEXT;
    INSERT INTO app_migrations VALUES('0028_shelf_cover.sql','parallel');`);
   const insert=db.prepare(`INSERT INTO stories(id,user_id,selection,document,state,generation_control,shelf_cover,created_at,updated_at)
    VALUES(?,?,?,?,'idle','paused','saved-cover','c','u')`);
   insert.run(id,localOwner,JSON.stringify(selected),JSON.stringify({audio:[],usage:[],dag}));
   insert.run(legacy,localOwner,JSON.stringify(selected),JSON.stringify(doc));
  }finally{db.close();}
  report.push(ensureLibraryReady(directory,root));
 }});
 const [upgrade]=report;
 assert.deepEqual(upgrade.migrations,['0029_finalize_production_spec.sql','0030_rebind_production_receipts.sql']);
 verifyLibraryBackup(upgrade.backup);
 const backup=new DatabaseSync(path.join(upgrade.backup,'shiqu.sqlite'),{readOnly:true});
 try{
  assert.equal(backup.prepare('PRAGMA user_version').get().user_version,4);
  assert.equal(backup.prepare("SELECT name FROM sqlite_schema WHERE name='story_rows'").get(),undefined);
 }finally{backup.close();}
 await f.demand(id);
 await f.app.services.production.tick();
 for(const storyId of [id,legacy]){
  const row=await f.app.services.database.prepare('SELECT * FROM story_rows WHERE id=?').bind(storyId).first();
  assert.equal(row.shelf_cover,'saved-cover');
  assert.equal(row.generation_control,'paused');
  assert.equal(Object.hasOwn(JSON.parse(row.document),'images'),false);
  assert.deepEqual((await f.read(storyId)).story.pages.map(page=>page.caption),plan.pages.map(page=>page.caption));
 }
 const db=f.app.services.database;
 assert.equal((await db.prepare("SELECT applied_at FROM app_migrations WHERE name='0028_production_spec.sql'").first()).applied_at,'preview');
 assert.equal((await db.prepare("SELECT applied_at FROM app_migrations WHERE name='0028_shelf_cover.sql'").first()).applied_at,'parallel');
 assert.deepEqual(decodeDocument(await db.prepare('SELECT * FROM story_rows WHERE id=?').bind(id).first()).dag.products,dag.products);
 assert.equal(f.control.calls.length+f.control.dagCalls.length,0);
 assert.equal(ensureLibraryReady(f.dataDirectory,f.root),undefined);
});

for(const mode of ['active','reader-paused','preview-archive','preview-crash','recovery','recovery-collision','stale','canonical','canonical-retry','canonical-damaged'])test(`an outline receipt is migrated only for a matching request (${mode})`,async t=>{
 const {productionFixture,until}=await import('./fixtures/production.mjs');
 const {apply,requestFor,settle,work}=await import('../lib/production-dag/runner.ts');
 const {emptyDag}=await import('../lib/production-dag/document.ts');
 const {fingerprint:stableFingerprint}=await import('../lib/production-dag/fingerprint.ts');
 const id=crypto.randomUUID(),faultId=crypto.randomUUID(),requestId=crypto.randomUUID();
 const picked=selectionSchema.parse({...selection,length:3}),plan=makePlan(3);
 const doc={plan:null,images:[],audio:[],usage:[],original:{title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'fixture',retrievedAt:'2026-01-01'}};
 const basis={id,doc,selection:picked,dag:emptyDag(),confirmed:true,faults:[]};
 for(const [name,value] of [['prepareBrief',plan.summary],['characters',[{id:'c1',name:'庄周',aliases:['庄子'],text:plan.characters}]]]){
  basis.dag=settle(basis);
  basis.dag=apply(basis,work(basis).find(item=>item.call===name),value,{newId:()=>crypto.randomUUID()});
 }
 const outline=work(basis).find(item=>item.call==='outline');
 const request=requestFor(basis,outline),targets=outline.instances.map(item=>[item.id,item.hard??null]);
 const legacyId=stableFingerprint(['dag-job',id,null,'outline',0,targets,
  mode==='stale'?{...request,args:{...request.args,productionPrompt:'已经变更的请求。'}}:request]);
 const currentId=stableFingerprint(['dag-job',id,null,'outline',targets,request]);
 const paidTitle='已经付费的提纲',canonicalTitle='按正式身份保存的提纲';
 const receipt=title=>({value:{title,summary:plan.summary,sourceReference:plan.sourceReference,adaptationNote:plan.adaptationNote,
  beats:plan.pages.map(page=>page.caption)},model:'paid-fixture',requestId:'original-paid-request',usage:{calls:1},
  entry:{step:'dag:outline',model:'paid-fixture',requestId:'original-paid-request',usage:{calls:1}}});
 const report=[];
 const recovering=mode==='recovery'||mode==='recovery-collision';
 const running=recovering||mode==='preview-crash';
 const f=await productionFixture(t,'codex',{}, {initialize(directory,root){
  const sqlite=historicalLibrary(directory,root,'0027_revision_fault_targets.sql');
  try{
   previewShape(sqlite);
   sqlite.prepare(`INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at)
    VALUES(?,?,?,?,?,'active','idle','c','u')`).run(id,localOwner,JSON.stringify(picked),JSON.stringify({...doc,dag:{...basis.dag,items:[]}}),
    mode==='reader-paused'?'reader':'background');
   sqlite.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,attempts,lease_token,lease_until,recovery_id,created_at,updated_at)
    VALUES(?,?,?,'dag','text','dag','[]',?,?,1,?,?,?,1,2)`).run(legacyId,id,localOwner,JSON.stringify({work:outline,paid:receipt(paidTitle)}),
    running?'running':'queued',running?'old-lease':null,running?9999999999999:0,recovering?requestId:null);
   if(recovering){
    sqlite.prepare(`INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,fault_id,status,created_at,updated_at)
     VALUES(?,?,?,'recover','preserved-fingerprint',?,?,'running',1,2)`).run(requestId,localOwner,id,JSON.stringify({jobs:[legacyId],resolutionJob:legacyId}),faultId);
    sqlite.prepare(`INSERT INTO reader_faults(id,session_id,owner_id,job_id,kind,node,node_key,version,message,state,command_id,created_at,updated_at)
     VALUES(?,?,?,?,'job','outline','','dag','重复派发不应发生','recovering',?,1,2)`).run(faultId,id,localOwner,legacyId,requestId);
   }
   if(['preview-archive','preview-crash','canonical','canonical-retry','canonical-damaged','recovery-collision'].includes(mode)){
    sqlite.exec('BEGIN IMMEDIATE');
    finalizeProductionSpec(sqlite,()=>readFileSync(path.join(root,'drizzle/0028_production_spec.sql'),'utf8'),directory);
    sqlite.exec("INSERT INTO app_migrations VALUES('0029_finalize_production_spec.sql','fixture'); COMMIT");
    if(mode!=='recovery-collision')sqlite.prepare('DELETE FROM production_jobs WHERE id=?').run(legacyId);
    if(mode.startsWith('canonical'))sqlite.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,payload,state,attempts,created_at,updated_at)
     VALUES(?,?,?,'dag','text','dag',?,'queued',1,1,2)`).run(currentId,id,localOwner,
      mode==='canonical-damaged'?'not a valid job payload':JSON.stringify({work:outline,...(mode==='canonical'?{paid:receipt(canonicalTitle)}:{})}));
    if(mode==='recovery-collision')sqlite.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,payload,state,created_at,updated_at)
     VALUES(?,?,?,'dag','text','dag',?,'queued',1,2)`).run(currentId,id,localOwner,JSON.stringify({work:outline}));
   }
  }finally{sqlite.close();}
  report.push(ensureLibraryReady(directory,root));
 }});
 assert.ok(report[0].migrations.includes('0030_rebind_production_receipts.sql'));
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
 assert.equal(f.control.dagCalls.filter(call=>call==='outline').length,mode==='stale'?1:0);
 assert.equal(saved.dag.outline.title,mode==='stale'?plan.title:mode==='canonical'?canonicalTitle:paidTitle);
 assert.equal(saved.usage.filter(call=>call.requestId==='original-paid-request').length,mode==='stale'?0:1);
 if(recovering){
  const replay=await f.json(`sessions/${id}/recover`,'POST',{requestId,faultId});
  assert.equal(replay.recoveryReceipt.status,'succeeded');
  assert.equal((await database.prepare('SELECT state FROM production_faults WHERE id=?').bind(faultId).first()).state,'resolved');
 }
});

test('0030 rebinds a preview revision’s leaked portrait URLs and preserves print bindings',async t=>{
 const {productionFixture}=await import('./fixtures/production.mjs');
 const {transaction}=await import('../server/database.ts');
 const {writeStoryProducts}=await import('../server/production-products.ts');
 const {normalizeStoryDocument}=await import('../server/migrations/production-v4.ts');
 const {referenceImageKey}=await import('../lib/reader-image-assets.ts');
 const {makeStory}=await import('./fixtures/story.mjs');
 const parent=crypto.randomUUID(),id=crypto.randomUUID(),printId=crypto.randomUUID();
 const plan=makePlan(3),picked=selectionSchema.parse({...selection,length:3});
 const images=plan.pages.map((_,index)=>`/api/reader/media/${parent}/${index}.png`);
 const original={title:'庄子',text:'昔者庄周梦为胡蝶。',url:'https://example.test',kind:'passage',provider:'fixture',retrievedAt:'2026-01-01'};
 const report=[];
 const f=await productionFixture(t,'codex',{}, {initialize(directory,root){
  ensureLibraryReady(directory,root);
  const sqlite=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
  try{
   sqlite.exec("DELETE FROM app_migrations WHERE name='0030_rebind_production_receipts.sql'");
   const folder=path.join(directory,'media','reader',parent);
   mkdirSync(folder,{recursive:true});
   for(let index=0;index<images.length;index++)writeFileSync(path.join(folder,index+'.png'),png);
   const print={id:printId,story:{...makeStory(3),pages:plan.pages.map((page,index)=>({...page,image:images[index]}))},plan,control:'paused'};
   for(const key of [parent,id]){
    const doc={plan,images,audio:[],usage:[],original,...(key===id?{revision:{rootId:parent,parentId:parent,number:2},landscapePrints:[print,null]}:{})};
    doc.dag=normalizeStoryDocument(key,doc,picked);
    transaction(sqlite,db=>writeStoryProducts(db,key,localOwner,doc,stored=>db.run(`INSERT INTO stories(
     id,user_id,selection,document,generation_control,production_complete,created_at,updated_at)
     VALUES(?,?,?,?,'paused',1,'c','u')`,key,localOwner,JSON.stringify(picked),stored).changes));
   }
   sqlite.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,payload,state,created_at,updated_at)
    VALUES('print',?,?,'landscape-print','landscape',?,?,'queued',1,1)`)
    .run(id,localOwner,printId,JSON.stringify({input:{index:0,reference:images[0]}}));
  }finally{sqlite.close();}
  report.push(ensureLibraryReady(directory,root));
 }});
 const [upgrade]=report;
 assert.deepEqual(upgrade.migrations,['0030_rebind_production_receipts.sql']);
 verifyLibraryBackup(upgrade.backup);
 const database=f.app.services.database;
 const child=decodeDocument(await database.prepare('SELECT * FROM story_rows WHERE id=?').bind(id).first());
 assert.ok(child.images.every(image=>referenceImageKey(id,image)));
 assert.deepEqual(child.landscapePrints[0].story.pages.map(page=>page.image),child.images);
 assert.equal(child.landscapePrints[1],null);
 assert.equal(JSON.parse((await database.prepare("SELECT payload FROM production_jobs WHERE id='print'").first()).payload).input.reference,child.images[0]);
 await f.json(`library/${parent}`,'DELETE');
 for(const image of child.images){
  const response=await f.app.handle(new Request('http://localhost'+image));
  assert.equal(response.status,200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(png));
 }
 assert.equal(f.control.calls.length+f.control.dagCalls.length,0);
});
