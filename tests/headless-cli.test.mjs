// Run the real command dispatcher with production API/queue/SQLite and controlled adapters, without HTTP or DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,mkdir,symlink,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {unzipSync,strFromU8} from 'fflate';
import {PDFDocument} from 'pdf-lib';
import {loadImage} from '@napi-rs/canvas';
import {executeHeadless,CliCommandError} from '../server/headless-cli.ts';
import {productionFixture,selection} from './fixtures/production.mjs';
import {startupFixture} from './fixtures/startup.mjs';
import {libraryFixture} from './fixtures/story-library.mjs';
import {withLocalBooks} from '../server/local-generation.ts';
import {emptyPublication} from '../lib/story-publication.ts';
import {assertStoryWebp} from '../lib/story-webp-metadata.ts';
import {zipMetadataStory} from '../lib/reader-zip-content.ts';
import {DatabaseSync} from 'node:sqlite';
import {createApplication} from '../server/app.ts';
import {heavy} from './fixtures/test-tier.mjs';
import {migratePromptRecords} from '../server/prompt-record-migration.ts';

async function fixture(t){
 const f=await productionFixture(t);await f.stop();
 const library=libraryFixture();f.control.autoLength=3;f.control.hold=false;
 f.control.beforeText=async(kind,payload)=>kind==='recommend'?{storySummary:library.stories.find(s=>payload.verifiedOriginal.text.includes(library.book.sections[0].units.find(u=>u.id===s.source.firstUnit).text))?.summary||library.stories[0].summary,storyMatchReason:'原文的行动和结果支持故事。'}:undefined;
 f.generation.suggestions=library.provider.suggestions;f.generation.matchStories=library.provider.matchStories;
 const generation=withLocalBooks(f.generation,library.books,f.media),context={generation,localBooks:library.books,variables:{}};
 const call=(args,input)=>executeHeadless(process.cwd(),[...args,'--data-dir',f.dataDirectory],{...context,input:input||{}});
 const inspect=()=>new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'),{readOnly:true});
 return {f,library,call,context,inspect};
}
async function copySource(t){
 const source=await fixture(t),target=await fixture(t);
 const {session}=await source.call(['stories','create','--no-intake'],{...selection,length:3,source:source.library.stories[0].source,storyTitle:source.library.stories[0].title});
 assert.equal((await source.call(['run',session.id,'--timeout','10'])).reason,'completed');
 return {source,target,sourceId:session.id,args:['stories','copy',session.id,'--from-data-dir',source.f.dataDirectory,'--request-id',crypto.randomUUID()]};
}

test('cross-library copy stores prompt records in the target; a text copy made before migration can still attach images',async t=>{
 const {source,target,sourceId,args}=await copySource(t),id=args.at(-1),file=path.join(source.f.dataDirectory,'shiqu.sqlite');
 // 把来源文档还原为旧版内嵌形式，模拟升级前创建文字副本。
 let db=new DatabaseSync(file);const load=db.prepare('SELECT record FROM prompt_records WHERE id=?');
 const doc=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(sourceId).document);
 doc.usage=doc.usage.map(call=>Object.fromEntries(Object.entries(call).map(([key,value])=>key==='promptRecordId'?['promptRecord',JSON.parse(load.get(value).record)]:[key,value])));
 assert.ok(doc.usage.some(call=>call.promptRecord));
 db.prepare('UPDATE stories SET document=? WHERE id=?').run(JSON.stringify(doc),sourceId);db.close();
 assert.equal((await target.call([...args,'--no-copy-images'])).session.ready,0);
 db=new DatabaseSync(file);db.exec('BEGIN IMMEDIATE');migratePromptRecords(db,'');db.exec('COMMIT');
 assert.ok(JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(sourceId).document).usage.every(call=>!call.promptRecord));db.close();
 assert.equal((await target.call(['stories','copy-images',id,'--from-data-dir',source.f.dataDirectory],{sourceId})).session.ready,3);
 const sourcePrompts=await source.call(['stories','prompts',sourceId]),targetPrompts=await target.call(['stories','prompts',id]);
 assert.ok(targetPrompts.records.length>0);assert.deepEqual(targetPrompts.records.map(item=>item.record),sourcePrompts.records.map(item=>item.record));
 assert.deepEqual(targetPrompts.missingRecords.length,sourcePrompts.missingRecords.length);
 const check=target.inspect(),copied=JSON.parse(check.prepare('SELECT document FROM stories WHERE id=?').get(id).document);
 const references=[...new Set(copied.usage.flatMap(call=>call.promptRecordId?[call.promptRecordId]:[]))];
 assert.ok(copied.usage.every(call=>!call.promptRecord));assert.ok(references.length);
 assert.equal(check.prepare('SELECT COUNT(*) AS n FROM prompt_records WHERE id IN (SELECT value FROM json_each(?))').get(JSON.stringify(references)).n,references.length);check.close();
});
test('copy defaults to text only and accepts explicit image choices without reusing another art style',async t=>{
 const {source,target,sourceId,args}=await copySource(t),next=flags=>[...args.slice(0,-1),crypto.randomUUID(),...flags];
 for(const flags of [[],['--no-copy-images'],['--json'],['--input','-']])assert.equal((await target.call(next(flags))).session.ready,0);
 assert.equal((await target.call(next(['--copy-images']))).session.ready,3);
 assert.equal((await target.call(next([]),{copyImages:true})).session.ready,3);
 const changed=await target.call(next([]),{artStyle:'clay'});assert.equal(changed.session.ready,0);
 await assert.rejects(target.call(next(['--copy-images']),{artStyle:'clay'}),/更改画风/);
 await assert.rejects(target.call(['stories','copy-images',changed.session.id,'--from-data-dir',source.f.dataDirectory],{sourceId}),/更改画风/);
 await assert.rejects(target.call(next(['--copy-images']),{copyImages:false}),error=>error.code==='INVALID_INPUT');
 await assert.rejects(target.call(next([]),{copyImages:'yes'}),error=>error.code==='INVALID_INPUT');
 await assert.rejects(target.call(['stories','copy-images',crypto.randomUUID(),'--from-data-dir',source.f.dataDirectory],{sourceId}),error=>error.code==='NOT_FOUND');
 assert.equal(target.f.control.calls.length,0);assert.equal(target.f.control.reviews.length,0);
});

for(const failure of ['missing','corrupt'])test(`${failure} copy image keeps saved text and decision; retry finishes the same story without another question`,async t=>{
 const {source,target,sourceId,args}=await copySource(t),id=args.at(-1),saved=await source.call(['stories','get',sourceId]);
 await target.call(args);
 const imageArgs=['stories','copy-images',id,'--from-data-dir',source.f.dataDirectory],input={sourceId};
 const key=saved.story.pages[1].image.replace('/api/reader/media/','reader/'),filename=path.join(source.f.dataDirectory,'media',key),bytes=await readFile(filename);
 if(failure==='missing')await rm(filename);else await writeFile(filename,'corrupt image');
 await assert.rejects(target.call(imageArgs,input),error=>error.code==='COPY_FAILED'&&error.details.storyId===id&&/文本及审核记录已保留/.test(error.message));
 const text=await target.call(['stories','get',id]);assert.equal(text.ready,0);assert.equal(text.generationProgress.reviewStatus,'passed');assert.equal(text.story.pages.length,3);
 await writeFile(filename,bytes);
 const copied=await target.call(imageArgs,input);assert.equal(copied.session.id,id);assert.equal(copied.session.ready,3);
 assert.equal((await target.call(['stories','list'])).length,1);assert.equal(target.f.control.calls.length,0);assert.equal(target.f.control.reviews.length,0);
});

test('image continuation rejects a changed source after the Skill checkpoint and preserves the text copy',async t=>{
 const {source,target,sourceId,args}=await copySource(t),text=await target.call(args);
 await source.call(['stories','rename',sourceId,'--title','来源在确认期间发生变化']);
 await assert.rejects(target.call(['stories','copy-images',text.session.id,'--from-data-dir',source.f.dataDirectory],{sourceId}),error=>error.code==='CONFLICT');
 const saved=await target.call(['stories','get',text.session.id]);assert.deepEqual(saved.story,text.session.story);assert.equal(saved.ready,0);
 assert.equal((await target.call(['stories','list'])).length,1);assert.equal(target.f.control.calls.length,0);assert.equal(target.f.control.reviews.length,0);
});

test('copy retains partial image positions and later production draws only the missing page without review',async t=>{
 const {source,target,sourceId,args}=await copySource(t),db=new DatabaseSync(path.join(source.f.dataDirectory,'shiqu.sqlite'));
 try{
  const doc=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(sourceId).document);
  db.prepare('DELETE FROM production_product_refs WHERE session_id=? AND target=?').run(sourceId,`frameImage:${doc.dag.order[1]}`);
  db.prepare("UPDATE stories SET production_complete=0,generation_control='paused' WHERE id=?").run(sourceId);
 }finally{db.close();}
 const copied=await target.call([...args,'--copy-images']);assert.equal(copied.session.ready,2);assert.equal(copied.session.story.pages[1].image,'');
 await target.call(['stories','resume',copied.session.id]);assert.equal((await target.call(['run',copied.session.id,'--timeout','10'])).reason,'completed');
 assert.deepEqual(target.f.control.calls.map(call=>call.page),[1]);assert.equal(target.f.control.dagCalls.length,0);assert.equal(target.f.control.reviews.length,0);
});

test('real CLI copy never asks for terminal input, with or without JSON mode or image flags',{
 skip:process.platform==='win32'?'POSIX terminal test; command contracts run on every platform':false,timeout:30000,
},async t=>{
 const {source,target,sourceId}=await copySource(t);
 for(const [flags,ready] of [[[],0],[['--json'],0],[['--copy-images'],3]]){
  const child=spawn('python3',['-I',path.resolve('tests/fixtures/copy_pty.py'),process.cwd(),process.execPath,source.f.dataDirectory,target.f.dataDirectory,sourceId,crypto.randomUUID(),...flags],{env:{PATH:process.env.PATH,HOME:target.f.root,USERPROFILE:target.f.root,XDG_CONFIG_HOME:path.join(target.f.root,'config'),XDG_DATA_HOME:path.join(target.f.root,'home-data'),LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  const [code]=await once(child,'exit');assert.equal(code,0,errors||output);
  const {receipt}=JSON.parse(output);assert.equal(receipt.data.session.ready,ready);
 }
 assert.equal(target.f.control.calls.length,0);assert.equal(target.f.control.reviews.length,0);
});
test('in-process CLI saves intent without inference, runs bounded discovery/preparation/review and completes one story', {timeout:60000},async t=>{
 const {f,library,call,inspect}=await fixture(t),requestId=crypto.randomUUID();
 const created=await call(['stories','create','--request-id',requestId],{bookId:'zhuangzi',theme:'原典故事'}),id=created.session.id;
 assert.equal((await call(['stories','create','--request-id',requestId],{bookId:'zhuangzi',theme:'原典故事'})).session.id,id);
 assert.equal(library.calls.catalog.length,0);assert.equal(f.control.dagCalls.length,0);
 await assert.rejects(call(['stories','search',id]),error=>error.code==='GENERATION_REQUIRED');
 const searchId=crypto.randomUUID(),searchInput={generation:created.session.intake.generation};await call(['stories','search',id,'--request-id',searchId],searchInput);await call(['stories','search',id,'--request-id',searchId],searchInput);assert.equal(library.calls.catalog.length,0);
 const candidates=await call(['run',id,'--until','candidates','--timeout','10']);assert.equal(candidates.reason,'candidates');assert.ok(candidates.session.intake.batches[0].stories.length);
 const chooseId=crypto.randomUUID(),chooseInput={generation:candidates.session.intake.generation};await call(['stories','choose',id,'--request-id',chooseId],chooseInput);await call(['stories','choose',id,'--request-id',chooseId],chooseInput);assert.equal(f.control.recommendations.length,0);
 await assert.rejects(call(['stories','choose',id],chooseInput),error=>error.code==='CONFLICT');
 const prepared=await call(['run',id,'--until','prepared','--timeout','10']);assert.equal(prepared.reason,'prepared');assert.equal(f.control.dagCalls.length,0);
 const {intake}=prepared.session,{acceptancePrompt:_,...draftSettings}=intake.draft;
 const {session:{intake:savedDraft}}=await call(['stories','setup',id],{action:'draft',generation:intake.generation,draftToken:intake.draftToken,settings:draftSettings});
 assert.equal(savedDraft.draft.acceptancePrompt,intake.draft.acceptancePrompt);
 assert.notEqual(savedDraft.requirementsEdited.acceptancePrompt,true);
 const confirmId=crypto.randomUUID(),confirmInput={generation:savedDraft.generation,draftToken:savedDraft.draftToken};
 await call(['stories','confirm',id,'--request-id',confirmId],confirmInput);await call(['stories','confirm',id,'--request-id',confirmId],confirmInput);assert.equal((await call(['run',id,'--until','prepared','--timeout','1'])).reason,'already_prepared');assert.equal(f.control.dagCalls.length,0);
 const pauseId=crypto.randomUUID();await call(['stories','pause',id,'--request-id',pauseId]);await call(['stories','pause',id,'--request-id',pauseId]);assert.equal((await call(['run',id,'--timeout','1'])).reason,'paused');assert.equal(f.control.dagCalls.length,0);
 await call(['stories','resume',id]);const reviewed=await call(['run',id,'--until','reviewed','--timeout','10']);assert.equal(reviewed.reason,'reviewed');assert.equal(f.control.calls.length,0);
 const completed=await call(['run',id,'--timeout','10']);assert.equal(completed.reason,'completed');assert.equal(f.control.calls.length,3);
 const offline=await executeHeadless(process.cwd(),['run',id,'--data-dir',f.dataDirectory],{
  variables:{},generation:{...f.generation,status:async()=>({configured:false})},
 });
 assert.equal(offline.reason,'completed');
 const before=f.control.dagCalls.length;
 await call(['stories','rename',id,'--title','离线故事']);assert.equal((await call(['stories','get',id])).story.title,'离线故事');
 const editId=crypto.randomUUID(),changes={token:(await call(['stories','revisions',id])).token,changes:{acceptancePrompt:'保留原文关键行动'}};
 const edited=await call(['stories','edit',id,'--request-id',editId],changes);assert.notEqual(edited.session.id,id);assert.equal(f.control.dagCalls.length,before);
 const replay=await call(['stories','edit',id,'--request-id',editId],changes);assert.equal(replay.session.id,edited.session.id);
 const output=path.join(f.root,'latest.json');
 await call(['export',id,'--format','json','--allow-unsigned','--output',output]);
 assert.equal(JSON.parse(await readFile(output,'utf8')).id,edited.session.id);
 assert.equal(f.control.dagCalls.length,before);
 await assert.rejects(call(['run',id,'--timeout','1']),error=>error.code==='SUPERSEDED_VERSION');
 const db=inspect();assert.equal(db.prepare('SELECT count(*) AS n FROM stories').get().n,2);db.close();
 const backup=path.join(f.root,'backup'),restored=path.join(f.root,'restored');await call(['backup',backup]);await call(['verify-backup',backup]);
 await executeHeadless(process.cwd(),['restore',backup,'--data-dir',restored],{variables:{}});
 const copied=await executeHeadless(process.cwd(),['stories','get',edited.session.id,'--data-dir',restored],{variables:{}});assert.equal(copied.id,edited.session.id);assert.equal(f.control.dagCalls.length,before);
});
test('CLI extends the verified original as a new version of one shelf story', {timeout:30000},async t=>{
 const {f,library,call}=await fixture(t),card=library.stories[0];
 const {session:{id}}=await call(['stories','create','--no-intake'],{...selection,length:3,storyTitle:card.title,source:card.source});
 assert.equal((await call(['run',id,'--timeout','10'])).reason,'completed');
 const before=await call(['stories','get',id]);
 const recommendations=f.control.recommendations.length;
 const {session:draft}=await call(['stories','reselect',id]);
 const {edition:_,...continuation}=library.stories[1].source;
 const source={...card.source,continuations:[continuation]};
 const input={requestId:crypto.randomUUID(),generation:draft.intake.generation,action:'conditions',conditions:{
  bookId:selection.bookId,theme:selection.theme,source,sourceCard:{title:card.title,description:card.summary},productionPrompt:'交代故事后续。',
 }};
 const setup=['stories','setup',draft.id],replace=['stories','replace',id,draft.id];
 await assert.rejects(call(setup,{...input,conditions:{...input.conditions,source:{...source,edition:'b'.repeat(64)}}}),error=>error.code==='INVALID_REQUEST');
 const staged=await call(setup,input);
 assert.deepEqual(staged.session.intake.batches[0].stories[0].source,source);
 assert.equal((await call(setup,input)).session.intake.generation,staged.session.intake.generation);
 assert.deepEqual((await call(['stories','list'])).map(s=>s.id),[id]);
 const choice={requestId:crypto.randomUUID(),batch:0,index:0,generation:staged.session.intake.generation};
 const next=await call(replace,choice);
 assert.equal(next.revision.rootId,id);
 assert.equal((await call(replace,choice)).id,next.id);
 assert.deepEqual((await call(['stories','list'])).map(s=>s.id),[next.id]);
 assert.equal((await call(['stories','current',id])).id,next.id);
 assert.deepEqual((await call(['stories','get',id])).story,before.story);
 const saved=(await call(['stories','source',next.id])).source;
 assert.deepEqual(saved.localSource,source);
 assert.ok(saved.text.includes(library.book.sections[0].units[1].text));
 assert.equal(f.control.recommendations.length,recommendations);
 const prepared=await call(['run',next.id,'--until','prepared','--timeout','10']);
 assert.equal(prepared.reason,'prepared');
 assert.equal(prepared.session.intake.draft.productionPrompt,input.conditions.productionPrompt);
 assert.equal(f.control.calls.length,3);
});
test('replacement stages multiple selected originals and fences candidates from earlier conditions', {timeout:30000},async t=>{
 const {f,library,call}=await fixture(t),[first,second]=library.stories.map(story=>story.source);
 const {session:{id}}=await call(['stories','create','--no-intake'],{...selection,length:3,source:first});
 assert.equal((await call(['run',id,'--timeout','10'])).reason,'completed');
 const {session:draft}=await call(['stories','reselect',id]);
 const setup=['stories','setup',draft.id],replace=['stories','replace',id,draft.id];
 const {session:single}=await call(setup,{generation:draft.intake.generation,action:'conditions',conditions:{
  bookId:selection.bookId,theme:'原典故事',source:second,sourceCard:{title:library.stories[1].title,description:library.stories[1].summary},productionPrompt:'',
 }});
 const {session:combined}=await call(setup,{generation:single.intake.generation,action:'conditions',conditions:{
  bookId:selection.bookId,theme:'原典故事',discovery:{mode:'auto',combine:true},discoverySources:[first,second],productionPrompt:'',
 }});
 assert.deepEqual(combined.intake.selected,{batch:0,index:0});
 assert.equal(combined.intake.search.state,'idle');
 assert.deepEqual((await call(['stories','list'])).map(s=>s.id),[id]);
 await assert.rejects(call(replace,{batch:0,index:0,generation:single.intake.generation}),error=>error.code==='CONFLICT');
 const next=await call(replace,{...combined.intake.selected,generation:combined.intake.generation});
 const {source}=await call(['stories','source',next.id]);
 assert.deepEqual(source.localSource,combined.intake.batches[0].stories[0].source);
 assert.ok(library.book.sections[0].units.every(unit=>source.text.includes(unit.text)));
 assert.equal((await call(['run',next.id,'--until','prepared','--timeout','10'])).reason,'prepared');
 assert.equal(f.control.calls.length,3);
});
test('timeout and explicit fault recovery retain checkpoints and request identities', {timeout:30000},async t=>{
 const {f,library,call}=await fixture(t),local={...selection,source:library.stories[0].source,storyTitle:library.stories[0].title};
 const first=await call(['stories','create','--no-intake'],local),id=first.session.id;
 const original=f.control.beforeText;let slow=true;f.control.beforeText=async(...args)=>{if(slow){slow=false;await new Promise(r=>setTimeout(r,100));}return original(...args);};
 await assert.rejects(call(['run',id,'--timeout','0.01']),error=>error.code==='TIMEOUT');
 assert.equal((await call(['run',id,'--timeout','10'])).reason,'completed');
 const next=(await call(['stories','create','--no-intake'],local)).session.id;let failed=false;
 f.control.beforeText=async(...args)=>{if(!failed){failed=true;throw Error('controlled command failure');}return original(...args);};
 const blocked=await call(['run',next,'--timeout','10']);assert.equal(blocked.reason,'blocked');const fault=blocked.session.faults.find(f=>f.retryAllowed);assert.ok(fault);
 assert.equal((await call(['run',next])).reason,'blocked');
 await assert.rejects(call(['stories','retry',next],{faultId:crypto.randomUUID()}),error=>error.code==='CONFLICT');
 const request=crypto.randomUUID();await call(['stories','retry',next,'--request-id',request],{faultId:fault.id});
 await call(['stories','retry',next,'--request-id',request],{faultId:fault.id});
 const recovered=await call(['run',next,'--timeout','10']);assert.equal(recovered.reason,'completed',JSON.stringify(recovered.session));
});
test('same native/browser export core produces credited public ZIP, PDF, PNG and escaped offline preview', {timeout:60000},async t=>{
 const {f,library,call}=await fixture(t);const created=await call(['stories','create','--no-intake'],{...selection,source:library.stories[0].source,storyTitle:library.stories[0].title}),id=created.session.id;const produced=await call(['run',id,'--timeout','10']);assert.equal(produced.reason,'completed',JSON.stringify(produced.session));
 await assert.rejects(call(['export',id,'--format','zip','--output',path.join(f.root,'unsigned.zip')]),/EXPORT_UNSIGNED/);
 await call(['api','POST','reader/publication-defaults'],{publication:{...emptyPublication,author:'测试作者'},expected:null});
 const snapshot=await call(['stories','get',id]),source=snapshot.story.pages[0].image.replace('/api/reader/media/','reader/'),original=await readFile(path.join(f.dataDirectory,'media',source));
 await call(['stories','rename',id,'--title','<script>alert(1)</script>']);
 // 另一个进程持有真实桌面服务锁时，所有导出格式都可读取同一已保存作品。
 const ownerModule=new URL('../server/desktop-owner.ts',import.meta.url).href;
 const holder=spawn(process.execPath,['--input-type=module','-e',`import {ownDesktopDataSync} from ${JSON.stringify(ownerModule)};
  const release=ownDesktopDataSync(process.argv[1]);process.send('ready');process.on('disconnect',release);`,f.dataDirectory],{stdio:['ignore','ignore','inherit','ipc']});
 const exited=once(holder,'exit');
 t.after(async()=>{if(holder.connected)holder.disconnect();await exited;});
 assert.deepEqual(await Promise.race([once(holder,'message'),exited]),['ready',undefined]);
 const db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'),{readOnly:true});
 t.after(()=>db.close());
 const version=()=>db.prepare('PRAGMA data_version').get().data_version;
 const before=version(),calls=f.control.calls.length;
 for(const format of ['json','md']){
  const output=path.join(f.root,'export.'+format);
  await call(['export',id,'--format',format,'--output',output]);
  assert.ok((await readFile(output,'utf8')).includes('<script>alert(1)</script>'));
 }
 const zipFile=path.join(f.root,'story.zip');await call(['export',id,'--format','zip','--output',zipFile]);
 const files=unzipSync(await readFile(zipFile)),saved=JSON.parse(strFromU8(files['故事.json']));assert.equal(saved.author,'测试作者');assert.equal(saved.pages.length,8);
 assert.deepEqual(Object.keys(files).filter(n=>!n.startsWith('图片/')).sort(),['分镜.md','故事.json','署名与转载.txt']);
 for(const [i,page]of saved.pages.entries())assertStoryWebp(files[page.image],zipMetadataStory(saved),i,page);
 assert.deepEqual(await readFile(path.join(f.dataDirectory,'media',source)),original);
 const pdfFile=path.join(f.root,'story.pdf'),pngFile=path.join(f.root,'story.png');await call(['export',id,'--format','pdf','--output',pdfFile]);await call(['export',id,'--format','png','--output',pngFile]);
 assert.ok((await PDFDocument.load(await readFile(pdfFile))).getPageCount()>=9);assert.ok((await loadImage(await readFile(pngFile))).height>1000);
 const preview=path.join(f.root,'preview.html');await call(['preview',id,'--output',preview]);const html=await readFile(preview,'utf8');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('data:image/png;base64,'));
 await assert.rejects(call(['export',id,'--output',zipFile]),/EEXIST/);
 assert.equal(version(),before);assert.equal(f.control.calls.length,calls);
});
test('preview refuses a pending upgrade without migrating the library',async t=>{
 const {f,call}=await fixture(t),db=new DatabaseSync(path.join(f.dataDirectory,'shiqu.sqlite'));
 const latest=db.prepare('SELECT name FROM app_migrations ORDER BY name DESC LIMIT 1').get().name;
 db.prepare('DELETE FROM app_migrations WHERE name=?').run(latest);
 try{
  await assert.rejects(call(['preview',crypto.randomUUID(),'--output',path.join(f.root,'story.html')]),/LIBRARY_UPGRADE_REQUIRED/);
  assert.equal(db.prepare('SELECT name FROM app_migrations WHERE name=?').get(latest),undefined);
 }finally{db.close();}
});

test('real CLI subcommands initialize/inspect/export diagnostics with one JSON stdout and no network listener', {...heavy,timeout:30000},async t=>{
 const f=await startupFixture(t),source=new URL('../server/cli.ts',import.meta.url).href,directory=path.join(f.root,'headless-library');
 async function cli(args){
  const code=`import net from 'node:net';net.Server.prototype.listen=()=>{throw Error('LISTEN_FORBIDDEN')};globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN')};const {runCli}=await import(${JSON.stringify(source)});await runCli(process.argv[1],process.argv.slice(2));`;
  const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code,f.root,...args],{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);const [exit]=await once(child,'exit');return {exit,value:JSON.parse(output),errors};
 }
 for(const args of [['help','--json'],['catalog']]){const result=await cli(args);assert.equal(result.exit,0,result.errors);assert.equal(result.value.ok,true);}
 await assert.rejects(readFile(path.join(f.locations.library,'shiqu.sqlite')),{code:'ENOENT'});
 const chosen=path.join(f.root,'chosen database folder'),initialized=await cli(['init','--data-dir',chosen]);
 assert.equal(initialized.exit,0,initialized.errors);assert.equal(initialized.value.data.path,chosen);assert.equal(initialized.value.data.started,false);
 assert.equal((await readFile(path.join(chosen,'shiqu.sqlite'))).subarray(0,16).toString(),'SQLite format 3\0');
 await assert.rejects(readFile(path.join(f.locations.library,'shiqu.sqlite')),{code:'ENOENT'});
 const listed=await cli(['stories','list','--data-dir',directory]);assert.equal(listed.exit,0,listed.errors);assert.deepEqual(listed.value.data,[]);
 assert.equal((await readFile(path.join(directory,'shiqu.sqlite'))).subarray(0,16).toString(),'SQLite format 3\0');
 for(const args of [['init','--data-dir',directory],['status','--data-dir',directory],['diagnostics','--data-dir',directory,'--output',path.join(f.root,'diagnostic.json')]]){const result=await cli(args);assert.equal(result.exit,0,result.errors);assert.equal(result.value.ok,true);assert.equal(result.value.schemaVersion,1);}
 const failure=await cli(['api','POST','reader/suggestions','--data-dir',directory]);assert.notEqual(failure.exit,0);assert.equal(failure.value.error.code,'EXECUTION_REQUIRED');
 const fresh=path.join(f.root,'fresh-story'),input=path.join(f.root,'selection.json');await writeFile(input,JSON.stringify(selection));
 const created=await cli(['stories','create','--no-intake','--input',input,'--data-dir',fresh]);assert.equal(created.exit,0,created.errors);const id=created.value.data.session.id;
 assert.equal((await cli(['stories','get',id,'--data-dir',fresh])).value.data.id,id);
 await cli(['init','--data-dir',fresh]);assert.equal((await cli(['stories','list','--data-dir',fresh])).value.data[0].id,id);
 const defaultLibrary=await cli(['status']);assert.equal(defaultLibrary.exit,0,defaultLibrary.errors);await readFile(path.join(f.locations.library,'shiqu.sqlite'));
 const saved=path.join(f.root,'saved-library'),store=f.store();store.save({dataDirectory:saved,libraryConfigured:true});store.close();
 const automatic=await cli(['status']);assert.equal(automatic.exit,0,automatic.errors);assert.equal(automatic.value.ok,true);await readFile(path.join(saved,'shiqu.sqlite'));
 const missing=path.join(f.root,'missing-backup-source');const backup=await cli(['backup',path.join(f.root,'unused-backup'),'--data-dir',missing]);assert.notEqual(backup.exit,0);assert.equal(backup.value.error.code,'LIBRARY_NOT_FOUND');await assert.rejects(readFile(path.join(missing,'shiqu.sqlite')),{code:'ENOENT'});
 const corrupt=path.join(f.root,'corrupt');await mkdir(corrupt);const broken=Buffer.from('not a SQLite database');await writeFile(path.join(corrupt,'shiqu.sqlite'),broken);
 assert.notEqual((await cli(['stories','list','--data-dir',corrupt])).exit,0);assert.deepEqual(await readFile(path.join(corrupt,'shiqu.sqlite')),broken);
});

test('a portrait CLI run leaves queued landscape drawings for the independent landscape worker',async t=>{
 const {f,library,call}=await fixture(t);
 const {session:{id}}=await call(['stories','create','--no-intake'],{...selection,length:3,source:library.stories[0].source,storyTitle:library.stories[0].title});
 assert.equal((await call(['run',id])).reason,'completed');
 f.options.production={autoStart:false};await f.restart();
 const route=`sessions/${id}/landscape`;
 await f.json(route,'POST',{startToken:(await f.json(route)).startToken});
 await f.json(`sessions/${id}/production-control`,'POST',{action:'reprepare'});
 await f.stop();const count=f.control.calls.length;
 assert.equal((await call(['run',id,'--until','completed','--timeout','5'])).reason,'completed');
 assert.equal(f.control.calls.length,count);
 await f.restart();
 assert.equal((await f.json(route)).state,'running');
 const {n}=await f.app.services.database.prepare("SELECT count(*) AS n FROM production_jobs WHERE kind='landscape-print' AND state='queued' AND attempts=0 AND session_id=?").bind(id).first();
 assert.equal(n,3);
});
