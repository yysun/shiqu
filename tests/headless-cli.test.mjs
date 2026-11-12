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
for(const status of ['pending','repair'])test(`explicit draft copy preserves ${status} review, source text and provenance without inference`,{timeout:30000},async t=>{
 const source=await fixture(t),target=await fixture(t);
 source.f.control.beforeText=async kind=>{
  if(kind==='review'){if(status==='pending')throw Error('controlled service stop');return {issues:[{page:2,category:'action',problem:'动作不明确。',instruction:'明确人物拿起物件的动作。'}]};}
  if(kind==='repair')throw Error('controlled repair stop');
 };
 const created=await source.call(['stories','create','--no-intake'],{...selection,length:3,source:source.library.stories[0].source,storyTitle:source.library.stories[0].title});
 const sourceId=created.session.id,id=crypto.randomUUID(),args=['stories','copy',sourceId,'--from-data-dir',source.f.dataDirectory,'--request-id',id];
 assert.equal((await source.call(['run',sourceId,'--until','reviewed','--timeout','10'])).reason,'blocked');
 const sourceDb=source.inspect(),before=sourceDb.prepare('SELECT * FROM stories WHERE id=?').get(sourceId),saved=JSON.parse(before.document);sourceDb.close();
 assert.equal(saved.visualReview.status,status);await assert.rejects(target.call(args),/只能复制/);
 const copied=await target.call([...args,'--draft']);assert.equal(copied.session.generationControl,'paused');assert.equal(copied.session.generationProgress.reviewStatus,status);assert.equal(copied.session.generationProgress.reviewOverridden,false);assert.equal(copied.session.ready,0);assert.equal(copied.session.story.pages.length,3);assert.deepEqual(copied.session.faults||[],[]);
 const db=target.inspect(),doc=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(id).document);assert.equal(db.prepare('SELECT count(*) AS n FROM production_jobs WHERE session_id=?').get(id).n,0);db.close();
 assert.deepEqual(doc.plan,saved.plan);assert.deepEqual(doc.original,saved.original);assert.deepEqual(doc.visualReview,saved.visualReview);assert.deepEqual(doc.storyboard,saved.storyboard);assert.deepEqual(doc.usage,saved.usage.map(call=>({...call,originId:call.originId||sourceId})));assert.equal(doc.copiedFrom.draft,true);assert.deepEqual(doc.images,[]);assert.equal(doc.revision,undefined);
 assert.deepEqual((await target.call(['stories','review-history',id])).entries,(await source.call(['stories','review-history',sourceId])).entries);
 assert.equal((await target.call(args,{draft:true})).session.id,id);assert.equal((await target.call(['stories','list'])).length,1);
 await assert.rejects(target.call([...args,'--draft'],{draft:false}),error=>error.code==='INVALID_INPUT');
 await assert.rejects(target.call([...args,'--draft','--copy-images']),error=>error.code==='COPY_FAILED');
 await assert.rejects(target.call(['stories','copy-images',id,'--from-data-dir',source.f.dataDirectory],{sourceId}),/只能复制/);
 assert.equal((await target.call(['run',id,'--until','reviewed','--timeout','10'])).reason,'paused');assert.equal(target.f.control.calls.length,0);assert.equal(target.f.control.reviews.length,0);assert.equal(target.f.control.plans.length,0);
 const afterDb=source.inspect();assert.deepEqual(afterDb.prepare('SELECT * FROM stories WHERE id=?').get(sourceId),before);afterDb.close();
});

test('draft copies reject images and invalid checkpoints and retain explicit mode in replay identity',{timeout:30000},async t=>{
 const source=await fixture(t),target=await fixture(t);
 const created=await source.call(['stories','create','--no-intake'],{...selection,length:3,source:source.library.stories[0].source,storyTitle:source.library.stories[0].title});
 const sourceId=created.session.id,id=crypto.randomUUID(),args=['stories','copy',sourceId,'--from-data-dir',source.f.dataDirectory,'--request-id',id];
 assert.equal((await source.call(['run',sourceId,'--until','reviewed','--timeout','10'])).reason,'reviewed');
 const db=new DatabaseSync(path.join(source.f.dataDirectory,'shiqu.sqlite')),row=db.prepare('SELECT * FROM stories WHERE id=?').get(sourceId),saved=JSON.parse(row.document);
 try{
  for(const [state,doc] of [['running',saved],['idle',{...saved,plan:null}],['idle',{...saved,original:undefined}],['idle',{...saved,visualReview:undefined}],['idle',{...saved,plan:{...saved.plan,pages:[]}}]]){
   db.prepare('UPDATE stories SET state=?,document=? WHERE id=?').run(state,JSON.stringify(doc),sourceId);await assert.rejects(target.call([...args,'--draft']));assert.equal((await target.call(['stories','list'])).length,0);
  }
 }finally{db.prepare('UPDATE stories SET state=?,document=? WHERE id=?').run(row.state,row.document,sourceId);db.close();}
 await assert.rejects(target.call([...args,'--draft','--copy-images']),error=>error.code==='COPY_FAILED');
 await target.call([...args,'--draft']);await assert.rejects(target.call(args),/此创建编号/);
 await assert.rejects(target.call(['stories','copy-images',id,'--from-data-dir',source.f.dataDirectory],{sourceId}),/草稿副本/);
 assert.equal(target.f.control.calls.length,0);assert.equal(target.f.control.reviews.length,0);
});

test('copy preserves a passed storyboard and evidence; only images run in the destination', {timeout:30000},async t=>{
 const source=await fixture(t),target=await fixture(t);
 const created=await source.call(['stories','create','--no-intake'],{...selection,length:3,source:source.library.stories[0].source,storyTitle:source.library.stories[0].title});
 const sourceId=created.session.id,id=crypto.randomUUID(),args=['stories','copy',sourceId,'--from-data-dir',source.f.dataDirectory,'--request-id',id];
 await assert.rejects(target.call(args),/只能复制/);
 assert.equal((await source.call(['run',sourceId,'--until','reviewed','--timeout','10'])).reason,'reviewed');
 const sourceDb=source.inspect(),saved=JSON.parse(sourceDb.prepare('SELECT document FROM stories WHERE id=?').get(sourceId).document);sourceDb.close();
 const copyInput={artStyle:'clay'};
 const copied=await target.call(args,copyInput);assert.equal(copied.session.id,id);assert.equal(copied.session.generationControl,'paused');
 assert.equal(copied.session.selection.artStyle,'clay');
 assert.equal(copied.session.generationProgress.reviewStatus,'passed');assert.equal(copied.session.generationProgress.reviewOverridden,false);
 assert.equal((await target.call(args,copyInput)).session.id,id);
 await assert.rejects(target.call(args,{artStyle:'watercolor'}),/此创建编号/);
 let db=target.inspect(),doc=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(id).document);db.close();
 assert.deepEqual(doc.plan,saved.plan);assert.deepEqual(doc.original,saved.original);assert.deepEqual(doc.visualReview,saved.visualReview);
 assert.equal(doc.revision,undefined);assert.equal(doc.copiedFrom.storyId,sourceId);assert.ok(doc.usage.every(call=>call.originId===sourceId));
 const history=await target.call(['stories','review-history',id]);assert.ok(history.entries.length);assert.ok(history.entries.some(entry=>entry.model));
 await target.call(['stories','resume',id]);assert.equal((await target.call(['run',id,'--timeout','10'])).reason,'completed');
 assert.equal(target.f.control.calls.length,3);assert.equal(target.f.control.plans.length,0);assert.equal(target.f.control.reviews.length,0);assert.equal(target.f.control.frameReviews.length,0);assert.equal(target.f.control.recommendations.length,0);
 db=target.inspect();doc=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(id).document);db.close();assert.deepEqual(doc.plan,saved.plan);assert.deepEqual(doc.visualReview,saved.visualReview);
 await assert.rejects(target.call(['stories','copy',id,'--from-data-dir',target.f.dataDirectory]),/另一个/);
 await source.call(['stories','rename',sourceId,'--title','另一个来源版本']);
 await assert.rejects(target.call(args),/此创建编号/);
 const sourceAgain=await source.call(['stories','get',sourceId]);assert.equal(sourceAgain.ready,0);
});
async function copySource(t){
 const source=await fixture(t),target=await fixture(t);
 const {session}=await source.call(['stories','create','--no-intake'],{...selection,length:3,source:source.library.stories[0].source,storyTitle:source.library.stories[0].title});
 assert.equal((await source.call(['run',session.id,'--timeout','10'])).reason,'completed');
 return {source,target,sourceId:session.id,args:['stories','copy',session.id,'--from-data-dir',source.f.dataDirectory,'--request-id',crypto.randomUUID()]};
}

test('CLI image-only edit redraws selected pages after explicit resume/run and preserves text, review and other images', {timeout:30000},async t=>{
 const {f,library,call,inspect}=await fixture(t);
 const created=await call(['stories','create','--no-intake'],{...selection,length:3,source:library.stories[0].source,storyTitle:library.stories[0].title}),id=created.session.id;
 assert.equal((await call(['run',id,'--timeout','10'])).reason,'completed');
 const original=await call(['stories','get',id]),base=await call(['stories','revisions',id]);
 const readDoc=storyId=>{const db=inspect();try{return JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(storyId).document);}finally{db.close();}};
 const saved=readDoc(id),before={images:f.control.calls.length,reviews:f.control.reviews.length,plans:f.control.plans.length,frameReviews:f.control.frameReviews.length};
 const help=await call(['help','--json']),requestId=crypto.randomUUID(),note=help.inputs.redraw.input.changes.redrawNotes[2];
 const input={...help.inputs.redraw.input,token:base.token,changes:{redrawPages:[1,3],redrawNotes:{3:note}}};
 for(const changes of [{redrawPages:[0]},{redrawPages:[4]},{redrawPages:[1,1]},{redrawPages:[1],artStyle:'clay'},{redrawNotes:{1:note}},{redrawPages:[1],redrawNotes:{2:note}},{redrawPages:[1],redrawNotes:{1:' '.repeat(4)}}]){
  await assert.rejects(call(['stories','edit',id],{token:base.token,changes}),error=>error.code==='INVALID_REQUEST');
 }
 assert.equal((await call(['stories','list'])).length,1);
 const args=['stories','edit',id,'--request-id',requestId],edited=await call(args,input),next=edited.session.id;
 assert.notEqual(next,id);assert.equal(edited.session.generationControl,'paused');assert.equal(edited.session.ready,1);
 assert.equal((await call(['run',next,'--timeout','10'])).reason,'paused');assert.equal(f.control.calls.length,before.images);
 await call(['stories','resume',next]);assert.equal(f.control.calls.length,before.images);
 const done=await call(['run',next,'--timeout','10']);assert.equal(done.reason,'completed');assert.equal(done.session.ready,3);
 assert.deepEqual(f.control.calls.slice(before.images).map(call=>call.page).sort((a,b)=>a-b),[0,2]);
 assert.deepEqual(f.control.calls.slice(before.images).filter(call=>call.prompt.includes(note)).map(call=>call.page),[2]);
 assert.equal(f.control.reviews.length,before.reviews);assert.equal(f.control.plans.length,before.plans);assert.equal(f.control.frameReviews.length,before.frameReviews);
 const doc=readDoc(next);assert.deepEqual(doc.plan,saved.plan);assert.deepEqual(doc.original,saved.original);assert.deepEqual(doc.visualReview,saved.visualReview);
 const bytes=page=>readFile(path.join(f.dataDirectory,'media',page.image.replace('/api/reader/media/','reader/')));
 assert.deepEqual(await bytes(done.session.story.pages[1]),await bytes(original.story.pages[1]));
 assert.deepEqual((await call(['stories','get',id])).story,original.story);
 assert.equal((await call(['stories','current',id])).id,next);
 assert.equal((await call(args,input)).session.id,next);assert.equal(f.control.calls.length,before.images+2);
 await assert.rejects(call(args,{...input,changes:{redrawPages:[2]}}),error=>error.code==='CONFLICT');
});

test('Skill can copy text, wait for a user decision, then attach independent images to the same story',async t=>{
 const {source,target,sourceId,args}=await copySource(t),id=args.at(-1);
 const textArgs=[...args,'--no-copy-images'],text=await target.call(textArgs);assert.equal(text.session.ready,0);assert.equal(text.session.generationControl,'paused');
 const db=target.inspect(),doc=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(id).document);db.close();
 assert.equal(doc.plan.pages.length,3);assert.equal(doc.visualReview.status,'passed');assert.deepEqual(doc.images,[]);
 assert.equal((await target.call(['stories','list'])).length,1);
 const imageArgs=['stories','copy-images',id,'--from-data-dir',source.f.dataDirectory],input={sourceId};
 const copied=await target.call(imageArgs,input);assert.equal(copied.session.id,id);assert.equal(copied.session.ready,3);
 const original=(await source.call(['stories','get',sourceId])).story.pages;
 for(let page=0;page<3;page++){
  const from=original[page].image.replace('/api/reader/media/','reader/'),to=copied.session.story.pages[page].image.replace('/api/reader/media/','reader/');
  assert.match(to,new RegExp(id));assert.deepEqual(await readFile(path.join(target.f.dataDirectory,'media',to)),await readFile(path.join(source.f.dataDirectory,'media',from)));
 }
 assert.equal((await target.call(imageArgs,input)).session.ready,3);assert.equal((await target.call(textArgs)).session.id,id);
 assert.equal((await target.call(['stories','list'])).length,1);
 await assert.rejects(target.call([...args,'--copy-images']),error=>error.code==='CONFLICT');
 await rm(path.join(source.f.dataDirectory,'media'),{recursive:true,force:true});
 for(const page of copied.session.story.pages)assert.ok(await target.f.media.get(page.image.replace('/api/reader/media/','reader/')));
 await target.call(['stories','resume',id]);assert.equal((await target.call(['run',id,'--timeout','10'])).reason,'completed');
 assert.equal(target.f.control.calls.length,0);assert.equal(target.f.control.reviews.length,0);assert.equal(target.f.control.frameReviews.length,0);assert.equal(target.f.control.plans.length,0);
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
  const doc=JSON.parse(db.prepare('SELECT document FROM stories WHERE id=?').get(sourceId).document);doc.images[1]='';
  db.prepare("UPDATE stories SET document=?,state='idle',generation_control='paused' WHERE id=?").run(JSON.stringify(doc),sourceId);
 }finally{db.close();}
 const copied=await target.call([...args,'--copy-images']);assert.equal(copied.session.ready,2);assert.equal(copied.session.story.pages[1].image,'');
 await target.call(['stories','resume',copied.session.id]);assert.equal((await target.call(['run',copied.session.id,'--timeout','10'])).reason,'completed');
 assert.deepEqual(target.f.control.calls.map(call=>call.page),[1]);assert.equal(target.f.control.plans.length,0);assert.equal(target.f.control.reviews.length,0);
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
 assert.equal(library.calls.catalog.length,0);assert.equal(f.control.plans.length,0);
 await assert.rejects(call(['stories','search',id]),error=>error.code==='GENERATION_REQUIRED');
 const searchId=crypto.randomUUID(),searchInput={generation:created.session.intake.generation};await call(['stories','search',id,'--request-id',searchId],searchInput);await call(['stories','search',id,'--request-id',searchId],searchInput);assert.equal(library.calls.catalog.length,0);
 const candidates=await call(['run',id,'--until','candidates','--timeout','10']);assert.equal(candidates.reason,'candidates');assert.ok(candidates.session.intake.batches[0].stories.length);
 const chooseId=crypto.randomUUID(),chooseInput={generation:candidates.session.intake.generation};await call(['stories','choose',id,'--request-id',chooseId],chooseInput);await call(['stories','choose',id,'--request-id',chooseId],chooseInput);assert.equal(f.control.recommendations.length,0);
 await assert.rejects(call(['stories','choose',id],chooseInput),error=>error.code==='CONFLICT');
 const prepared=await call(['run',id,'--until','prepared','--timeout','10']);assert.equal(prepared.reason,'prepared');assert.equal(f.control.plans.length,0);
 const confirmId=crypto.randomUUID(),confirmInput={generation:prepared.session.intake.generation};await call(['stories','confirm',id,'--request-id',confirmId],confirmInput);await call(['stories','confirm',id,'--request-id',confirmId],confirmInput);assert.equal((await call(['run',id,'--until','prepared','--timeout','1'])).reason,'already_prepared');assert.equal(f.control.plans.length,0);
 const pauseId=crypto.randomUUID();await call(['stories','pause',id,'--request-id',pauseId]);await call(['stories','pause',id,'--request-id',pauseId]);assert.equal((await call(['run',id,'--timeout','1'])).reason,'paused');assert.equal(f.control.plans.length,0);
 await call(['stories','resume',id]);const reviewed=await call(['run',id,'--until','reviewed','--timeout','10']);assert.equal(reviewed.reason,'reviewed');assert.equal(f.control.calls.length,0);
 const completed=await call(['run',id,'--timeout','10']);assert.equal(completed.reason,'completed');assert.equal(f.control.calls.length,3);
 const before=f.control.plans.length;
 await call(['stories','rename',id,'--title','离线故事']);assert.equal((await call(['stories','get',id])).story.title,'离线故事');
 const editId=crypto.randomUUID(),changes={token:(await call(['stories','revisions',id])).token,changes:{acceptancePrompt:'保留原文关键行动'}};
 const edited=await call(['stories','edit',id,'--request-id',editId],changes);assert.notEqual(edited.session.id,id);assert.equal(f.control.plans.length,before);
 const replay=await call(['stories','edit',id,'--request-id',editId],changes);assert.equal(replay.session.id,edited.session.id);
 await assert.rejects(call(['run',id,'--timeout','1']),error=>error.code==='SUPERSEDED_VERSION');
 const db=inspect();assert.equal(db.prepare('SELECT count(*) AS n FROM stories').get().n,2);db.close();
 const backup=path.join(f.root,'backup'),restored=path.join(f.root,'restored');await call(['backup',backup]);await call(['verify-backup',backup]);
 await executeHeadless(process.cwd(),['restore',backup,'--data-dir',restored],{variables:{}});
 const copied=await executeHeadless(process.cwd(),['stories','get',edited.session.id,'--data-dir',restored],{variables:{}});assert.equal(copied.id,edited.session.id);assert.equal(f.control.plans.length,before);
});
test('targeted run cannot dispatch another active story and direct-inference API routes never execute', {timeout:30000},async t=>{
 const {f,library,call,inspect}=await fixture(t);
 const localSelection={...selection,source:library.stories[0].source,storyTitle:library.stories[0].title};const first=await call(['stories','create','--no-intake'],localSelection),second=await call(['stories','create','--no-intake'],{...selection,theme:'善意与误解'});
 const dormant=createApplication({...f.options,production:{autoStart:false}});await dormant.services.production.request(dormant.services.ownerId,second.session.id,crypto.randomUUID(),0);await dormant.close();
 const beforeDb=inspect(),beforeJobs=beforeDb.prepare('SELECT * FROM production_jobs WHERE session_id=? ORDER BY id').all(second.session.id);beforeDb.close();assert.ok(beforeJobs.length);
 assert.equal(f.control.plans.length,0);const result=await call(['run',first.session.id,'--timeout','10']);assert.equal(result.reason,'completed',JSON.stringify(result.session));
 const db=inspect();assert.deepEqual(db.prepare('SELECT * FROM production_jobs WHERE session_id=? ORDER BY id').all(second.session.id),beforeJobs);db.close();
 await assert.rejects(call(['run',second.session.id,'--until','prepared']),error=>error.code==='BOUNDARY_UNAVAILABLE');
 const gate=await call(['stories','create','--no-intake'],{...localSelection,narrativeDetail:'balanced'});assert.equal((await call(['run',gate.session.id,'--until','prepared','--timeout','10'])).reason,'frame_count_required');
 const count=f.control.calls.length+f.control.plans.length;
 for(const [method,route]of [['POST','reader/suggestions'],['POST','reader/art-recommendation'],['POST',`reader/sessions/${first.session.id}/advance`],['POST','admin/generate'],['GET','reader/unknown']])await assert.rejects(call(['api',method,route]),error=>error.code==='EXECUTION_REQUIRED');
 assert.equal(f.control.calls.length+f.control.plans.length,count);
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
 const zipFile=path.join(f.root,'story.zip');await call(['export',id,'--format','zip','--output',zipFile]);
 const files=unzipSync(await readFile(zipFile)),saved=JSON.parse(strFromU8(files['故事.json']));assert.equal(saved.author,'测试作者');assert.equal(saved.pages.length,8);
 assert.deepEqual(Object.keys(files).filter(n=>!n.startsWith('图片/')).sort(),['分镜.md','故事.json','署名与转载.txt']);
 for(const [i,page]of saved.pages.entries())assertStoryWebp(files[page.image],zipMetadataStory(saved),i,page);
 assert.deepEqual(await readFile(path.join(f.dataDirectory,'media',source)),original);
 const pdfFile=path.join(f.root,'story.pdf'),pngFile=path.join(f.root,'story.png');await call(['export',id,'--format','pdf','--output',pdfFile]);await call(['export',id,'--format','png','--output',pngFile]);
 assert.ok((await PDFDocument.load(await readFile(pdfFile))).getPageCount()>=9);assert.ok((await loadImage(await readFile(pngFile))).height>1000);
 await call(['stories','rename',id,'--title','<script>alert(1)</script>']);const preview=path.join(f.root,'preview.html');await call(['preview',id,'--output',preview]);const html=await readFile(preview,'utf8');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('data:image/png;base64,'));
 await assert.rejects(call(['export',id,'--output',zipFile]),/EEXIST/);
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
