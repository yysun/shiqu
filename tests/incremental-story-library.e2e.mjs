// Service E2E: real REST handlers, durable queue, SQLite and files with citation-valid controlled inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {libraryFixture,selection} from './fixtures/story-library.mjs';
import {withLocalBooks} from '../server/local-generation.ts';
import {LocalBooks} from '../server/local-books.ts';
import {bookContents} from '../server/local-book-contents.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import {makePlan} from './fixtures/production.mjs';

async function fixture(t){
 const f=await productionFixture(t),library=libraryFixture();f.control.hold=false;
 f.generation.suggestions=(...args)=>library.provider.suggestions(...args);
 f.generation.matchStories=(...args)=>library.provider.matchStories(...args);
 async function restart(){f.options.generation=withLocalBooks(f.generation,library.books,f.media);await f.restart();f.app.services.localBooks=library.books;}
 await restart();return {f,library,restart};
}
async function create(f,theme){
 const saved=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,theme,narrativeDetail:'balanced'}});
 await f.demand(saved.id,crypto.randomUUID());await until(async()=>(await f.read(saved.id)).intake.phase==='choosing');return f.read(saved.id);
}

test('cold theme discovery retains rejected stories; restart and new themes reuse them; production receives originals',async t=>{
 const {f,library,restart}=await fixture(t),first=await create(f,'勇气');
 assert.deepEqual(first.intake.batches[0].stories.map(story=>story.title),['勇士护民']);assert.equal(library.calls.catalog.length,2);
 assert.ok(first.intake.batches[0].stories[0].storyBrief.matchReason);assert.equal(first.intake.batches[0].stories[0].storyBrief.summary,library.stories[1].summary);
 assert.ok(library.calls.catalog.every(call=>call.selection.theme===''&&call.input.purpose==='catalog'));
 const chosen=await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:0,action:'choose',batch:0,index:0});assert.equal(chosen.intake.search.state,'idle');
 await until(async()=>(await f.read(first.id)).intake.phase==='confirming');
 const prepared=await f.read(first.id),original=(await f.json(`sessions/${first.id}/source`)).source;
 assert.equal(original.storyBrief.verified,true);assert.equal(original.storyBrief.summary,library.stories[1].summary);
 assert.equal(original.localSource.firstUnit,'u2');assert.match(original.text,/勇士面对山中的猛虎/);assert.ok(original.chapterContext.text.includes(library.book.sections[0].units[1].text));
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 const advice=f.control.recommendations[0].verifiedOriginal;assert.equal(advice.text,original.text);assert.notEqual(advice.text,library.stories[1].summary);assert.equal(advice.summary,undefined);
 await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:prepared.intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:'保留明确行动。',narrativeDetail:'balanced',length:2}});
 await until(async()=>(await f.read(first.id)).state==='completed');assert.equal(f.control.calls.length,2);
 for(const payload of f.control.plans){assert.equal(payload.verifiedOriginal.text,original.text);assert.equal(payload.verifiedOriginal.summary,undefined);assert.ok(payload.verifiedOriginal.chapterContext);assert.equal(payload.storyBrief.summary,library.stories[1].summary);assert.deepEqual(payload.editorialContext,{mode:'theme',theme:'勇气'});}
 const extracted=library.calls.catalog.length;await restart();
 const other=await create(f,'知恩图报');assert.equal(other.intake.batches[0].stories[0].title,'乌龟报恩');assert.equal(library.calls.catalog.length,extracted);
 const matched=library.calls.matches.length;await restart();const again=await create(f,'知恩图报');assert.equal(again.intake.batches[0].stories[0].title,'乌龟报恩');assert.equal(library.calls.matches.length,matched);assert.equal(library.calls.catalog.length,extracted);
});

test('REST uncertainty retains the neutral library and retries only the original review',async t=>{
 const {f,library}=await fixture(t);library.control.decide=()=> 'review';
 const failed=await f.request('suggestions','POST',{...selection,theme:'需要核对'});assert.equal(failed.status,502);assert.match((await failed.json()).error,/仍无法确认主题/);
 assert.equal(library.calls.catalog.length,1);assert.equal(library.calls.matches.length,2);assert.ok(library.calls.matches[1].stories[0].text.includes('渔夫'));
 library.control.decide=(_theme,story)=>{assert.ok(story.text);return 'yes';};
 const result=await f.json('suggestions','POST',{...selection,theme:'需要核对'});assert.equal(result.stories[0].title,'乌龟报恩');assert.equal(library.calls.matches.length,3);assert.equal(library.calls.catalog.length,1);
});

test('two streaming theme requests share extraction; one reader can leave while another receives its story',async t=>{
 const {f,library}=await fixture(t),base=library.provider.suggestions;let release,started=false;
 library.provider.suggestions=async(...args)=>{started=true;await new Promise(resolve=>release=resolve);return base(...args);};
 const first=new AbortController(),second=new AbortController();
 const send=(theme,signal)=>f.app.handle(new Request('http://localhost/api/reader/suggestions',{method:'POST',signal,headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({...selection,theme})}));
 const a=await send('主题甲',first.signal),b=await send('主题乙',second.signal),reader=a.body.getReader(),two=b.text();
 await until(()=>started&&release);await reader.cancel();release();
 const events=(await two).trim().split('\n').map(JSON.parse),result=events.find(event=>event.type==='result');
 assert.equal(result.batch.stories[0].title,'乌龟报恩');assert.equal(library.calls.catalog.length,1);assert.equal(library.calls.matches.filter(call=>call.theme==='主题甲').length,0);assert.equal(library.calls.matches.filter(call=>call.theme==='主题乙').length,1);
});

for(const [theme,length] of [['勇气',2],['原典故事',21]])test(`${theme}: an opening-only synopsis and unsupported reason are corrected before ${length}-frame production and survive restart`,async t=>{
 const {f,library,restart}=await fixture(t),match=library.provider.matchStories;
 library.provider.matchStories=async(...args)=>{const result=await match(...args);return {matches:result.matches.map(item=>item.verdict==='yes'?{...item,summary:'人物准备采取行动，打算改变处境。',reason:'人物因复仇杀死对手。'}:item)};};
 const first=await create(f,theme),candidate=first.intake.batches[0].stories[0],complete=library.stories.find(story=>story.title===candidate.title).summary;
 const reason='原文中的行动和实际结果支持本次选题，没有复仇杀人的事实。';
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='recommend'){assert.equal(payload.storyBrief.summary,candidate.storyBrief.summary);assert.equal(payload.storyBrief.matchReason,candidate.storyBrief.matchReason);assert.ok(payload.verifiedOriginal.text);return {storySummary:complete,storyMatchReason:reason};}
 };
 await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:0,action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(first.id)).intake.phase==='confirming');
 let saved=await f.read(first.id);const source=(await f.json(`sessions/${first.id}/source`)).source;
 assert.deepEqual(source.storyBrief,{summary:complete,matchReason:reason,verified:true});assert.equal(saved.frameRecommendation.storySummary,complete);assert.equal(f.control.plans.length,0);
 await restart();saved=await f.read(first.id);assert.deepEqual((await f.json(`sessions/${first.id}/source`)).source.storyBrief,source.storyBrief);
 await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:'保留明确行动。',narrativeDetail:'balanced',length}});
 await until(async()=>(await f.read(first.id)).state==='completed');
 const context=theme==='原典故事'?{mode:'source'}:{mode:'theme',theme};
 for(const payload of [...f.control.outlines,...f.control.plans,...f.control.reviews]){assert.deepEqual(payload.storyBrief,{summary:complete,matchReason:reason});assert.deepEqual(payload.editorialContext,context);assert.equal(payload.verifiedOriginal.text,source.text);assert.equal(payload.verifiedOriginal.storyBrief,undefined);}
 if(length>20){assert.equal(f.control.outlines.length,1);assert.equal(f.control.batches.length,2);}
 assert.equal(f.control.recommendations.length,1,'Synopsis verification reuses the existing advice call');
});

for(const omitted of ['storySummary','storyMatchReason'])test(`missing ${omitted} fails preparation, blocks confirmation, and retries with the same original`,async t=>{
 const {f,library}=await fixture(t),saved=await create(f,'勇气');let invalid=true;
 f.control.beforeText=async kind=>kind==='recommend'&&invalid?{[omitted]:undefined}:undefined;
 await f.json(`sessions/${saved.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:0,action:'choose',batch:0,index:0});await until(async()=>(await f.read(saved.id)).state==='failed');
 const before=(await f.json(`sessions/${saved.id}/source`)).source;assert.equal(before.storyBrief.verified,false);assert.equal(f.control.plans.length,0);
 const current=await f.read(saved.id),confirm={requestId:crypto.randomUUID(),generation:current.intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:'',narrativeDetail:'balanced',length:2}};
 assert.equal((await f.request(`sessions/${saved.id}/setup`,'POST',confirm)).status,409);
 // A stale count receipt cannot bypass the new source-bound synopsis gate either.
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_set(document,'$.intake.phase','confirming','$.frameRecommendation',json(?)),state='idle' WHERE id=?").bind(JSON.stringify({count:2,reason:'旧建议'}),saved.id).run();
 assert.equal((await f.request(`sessions/${saved.id}/setup`,'POST',{...confirm,requestId:crypto.randomUUID()})).status,409);
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_remove(json_set(document,'$.intake.phase','preparing'),'$.frameRecommendation'),state='failed' WHERE id=?").bind(saved.id).run();
 invalid=false;const scans=library.calls.catalog.length;await f.demand(saved.id,crypto.randomUUID(),0,true);await until(async()=>(await f.read(saved.id)).intake.phase==='confirming');
 const after=(await f.json(`sessions/${saved.id}/source`)).source;assert.equal(after.text,before.text);assert.equal(after.storyBrief.verified,true);assert.equal(library.calls.catalog.length,scans);assert.equal(f.control.recommendations.length,2);
});

test('reselection binds a new synopsis to its new original, and clients cannot inject a replacement brief',async t=>{
 const {f,library}=await fixture(t),saved=await create(f,'原典故事');
 const setup=async action=>f.json(`sessions/${saved.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(saved.id)).intake.generation,...action});
 const forged=await f.request(`sessions/${saved.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:0,action:'choose',batch:0,index:0,storyBrief:{summary:'伪造事实。',matchReason:'伪造理由。'}});assert.equal(forged.status,400);
 await setup({action:'choose',batch:0,index:0});await until(async()=>(await f.read(saved.id)).intake.phase==='confirming');
 const first=(await f.json(`sessions/${saved.id}/source`)).source;assert.equal(first.localSource.firstUnit,'u1');
 await setup({action:'more'});await until(async()=>(await f.read(saved.id)).intake.search.state==='idle');
 await setup({action:'choose',batch:1,index:0});await until(async()=>(await f.read(saved.id)).intake.phase==='confirming');
 const second=(await f.json(`sessions/${saved.id}/source`)).source;assert.equal(second.localSource.firstUnit,'u2');assert.equal(second.storyBrief.summary,library.stories[1].summary);assert.notEqual(second.storyBrief.summary,first.storyBrief.summary);
});

test('direct original selection skips matching but still prepares a complete source-mode synopsis',async t=>{
 const f=await productionFixture(t),books=new LocalBooks(process.cwd());f.control.hold=false;
 f.generation.suggestions=async()=>assert.fail('Direct source selection must not discover stories');f.generation.matchStories=async()=>assert.fail('Direct source selection must not match themes');
 f.options.generation=withLocalBooks(f.generation,books,f.media);await f.restart();f.app.services.localBooks=books;
 const entry=(await bookContents(books,{bookId:'shishuo',theme:'原典故事'})).entries[0];
 const complete='陈仲举到任豫章太守后想先拜访徐孺子。主簿劝他先入官署，他援引武王礼贤的先例，说明自己礼贤并无不可。';
 f.control.beforeText=async(kind,payload)=>{if(kind==='recommend'){assert.deepEqual(payload.editorialContext,{mode:'source'});assert.equal(payload.storyBrief.summary,entry.excerpt);assert.match(payload.verifiedOriginal.text,/欲先看之/);return {storySummary:complete,storyMatchReason:'按原典保存到任先问贤士及其回应，不额外套主题。'};}};
 const saved=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{bookId:'shishuo',theme:'原典故事',source:entry.source,length:'auto',narrativeDetail:'balanced',artStyle:'ink-pencil',voice:false}});
 await until(async()=>(await f.read(saved.id)).intake.phase==='confirming');const ready=await f.read(saved.id),original=(await f.json(`sessions/${saved.id}/source`)).source;
 assert.equal(original.storyBrief.verified,true);assert.equal(original.storyBrief.summary,complete);assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);
 await f.json(`sessions/${saved.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:ready.intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:'',narrativeDetail:'balanced',length:2}});
 await until(async()=>(await f.read(saved.id)).state==='completed');
 for(const payload of [...f.control.plans,...f.control.reviews]){assert.deepEqual(payload.editorialContext,{mode:'source'});assert.equal(payload.storyBrief.summary,complete);assert.equal(payload.verifiedOriginal.text,original.text);}
});

test('historical direct selections without a synopsis prepare one before any new storyboard',async t=>{
 const f=await productionFixture(t),books=new LocalBooks(process.cwd());f.options.generation=withLocalBooks(f.generation,books,f.media);await f.restart();f.app.services.localBooks=books;
 f.app.services.production.stop();const entry=(await bookContents(books,{bookId:'shishuo',theme:'原典故事'})).entries[0];
 const saved=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{bookId:'shishuo',theme:'原典故事',source:entry.source,length:'auto',narrativeDetail:'balanced',artStyle:'ink-pencil',voice:false}});
 await f.app.services.database.prepare("UPDATE reader_sessions SET document=json_remove(document,'$.intake.briefRequired') WHERE id=?").bind(saved.id).run();
 await f.restart();f.app.services.localBooks=books;await until(async()=>(await f.read(saved.id)).intake.phase==='confirming');
 assert.equal((await f.json(`sessions/${saved.id}/source`)).source.storyBrief.verified,true);assert.ok(f.control.recommendations[0].storyBrief.summary);assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);
});

for(const length of [2,21])test(`missing synopsis is saved before a ${length}-frame plan and a planning retry does not regenerate it`,async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(length),repo=new ReaderRepository(f.app.services.database),generator=f.generation.generator();
 let fail=true;const summary='庄周梦见自己成为蝴蝶，自在飞舞；醒来后发现自己仍是庄周，由此思考梦与醒、庄周与蝴蝶的区别和变化。';
 f.control.beforeText=async(kind,payload)=>{
  const doc=JSON.parse((await repo.get(id,'docker-local-owner')).document);
  if(kind==='recommend'){assert.ok(doc.original.text);assert.equal(doc.original.storyBrief.verified,false);assert.equal(doc.plan,null);return {storySummary:summary,storyMatchReason:'原文支持梦醒后的追问。'};}
  if(kind==='plan'||kind==='outline'){
   assert.equal(doc.original.storyBrief.summary,summary);assert.equal(doc.original.storyBrief.verified,true);assert.equal(doc.usage.filter(item=>item.step==='summary').length,1);
   if(fail)throw Error('controlled planning outage');
   const value=makePlan(length);return kind==='plan'?{...value,summary:'不应另写的引子。'}:{...value,summary:'不应另写的引子。',beats:value.pages.map((_,i)=>`第${i+1}幅的动作和回应。`)};
  }
 };
 const failed=await advanceStory(repo,generator,'docker-local-owner',id,0);assert.equal(failed.state,'failed');assert.equal(f.control.calls.length,0);assert.equal(f.control.recommendations.length,1);
 fail=false;await advanceStory(repo,generator,'docker-local-owner',id,0,true);const doc=JSON.parse((await repo.get(id,'docker-local-owner')).document);
 assert.equal((doc.draft||doc.storyboard.outline).summary,summary);assert.equal(Object.hasOwn(doc.draft||doc.storyboard.outline,'hook'),false);assert.equal(f.control.recommendations.length,1);assert.equal(doc.frameCountConfirmed,undefined);
 await f.restart();assert.equal(f.control.recommendations.length,1);assert.equal((await f.read(id)).selection.length,length);
});

test('invalid missing-summary preparation blocks planning and retries with the saved original',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(2),repo=new ReaderRepository(f.app.services.database),generator=f.generation.generator();let invalid=true;
 f.control.beforeText=async kind=>kind==='recommend'&&invalid?{storySummary:undefined}:undefined;
 await advanceStory(repo,generator,'docker-local-owner',id,0);const pending=JSON.parse((await repo.get(id,'docker-local-owner')).document);
 assert.equal(pending.original.storyBrief.verified,false);assert.equal(f.control.plans.length,0);assert.equal(f.control.outlines.length,0);assert.equal(f.control.calls.length,0);
 invalid=false;await advanceStory(repo,generator,'docker-local-owner',id,0,true);const ready=JSON.parse((await repo.get(id,'docker-local-owner')).document);
 assert.equal(ready.original.text,pending.original.text);assert.equal(ready.original.storyBrief.verified,true);assert.equal(f.control.plans.length,0);
 await advanceStory(repo,generator,'docker-local-owner',id,0);assert.equal(f.control.plans.length,1);assert.equal(f.control.recommendations.length,2);
});

test('a confirmed legacy intake stays confirmed and keeps its selected frame count while a missing synopsis is prepared',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(2),repo=new ReaderRepository(f.app.services.database),row=await repo.get(id,'docker-local-owner'),doc=JSON.parse(row.document);
 doc.frameCountConfirmed=true;doc.intake={phase:'confirmed',generation:0,creationHash:'legacy',selected:{batch:0,index:0},batches:[{stories:[{title:'庄周梦蝶',description:'梦醒之后的追问。'}],note:''}],search:{round:0,state:'idle'}};
 await f.app.services.database.prepare('UPDATE reader_sessions SET document=? WHERE id=?').bind(JSON.stringify(doc),id).run();
 await advanceStory(repo,f.generation.generator(),'docker-local-owner',id,0);const result=await repo.get(id,'docker-local-owner'),saved=JSON.parse(result.document);
 assert.equal(saved.intake.phase,'confirmed');assert.equal(saved.original.storyBrief.verified,true);assert.equal(saved.draft.pages.length,2);assert.equal(JSON.parse(result.selection).length,2);assert.equal(saved.frameCountConfirmed,true);
});

for(const unverified of [false,true])test(`saved outline batches resume after synopsis preparation without repeating the outline (${unverified?'unverified brief':'missing summary'})`,async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(21),repo=new ReaderRepository(f.app.services.database),generator=f.generation.generator(),row=await repo.get(id,'docker-local-owner'),doc=JSON.parse(row.document),plan=makePlan(21),chosen=JSON.parse(row.selection);
 const {pages,reflection,...metadata}=plan;void reflection;
 doc.original=(await generator.original(chosen,{sourceReference:plan.sourceReference},id)).source;
 if(unverified)doc.original.storyBrief={summary:'未经核对的摘要。',matchReason:'需要核对。',verified:false};
 doc.storyboard={outline:{...metadata,summary:unverified?'已有提纲摘要。':'',beats:pages.map((_,i)=>`第${i+1}幅的原有提纲。`)},pages:pages.slice(0,20)};
 await f.app.services.database.prepare('UPDATE reader_sessions SET document=? WHERE id=?').bind(JSON.stringify(doc),id).run();
 f.control.beforeText=async kind=>kind==='recommend'?{storySummary:plan.summary,storyMatchReason:'依据真实原文的完整主线。'}:undefined;
 await advanceStory(repo,generator,'docker-local-owner',id,0);if(unverified){assert.equal(f.control.batches.length,0);await advanceStory(repo,generator,'docker-local-owner',id,0);}
 const saved=JSON.parse((await repo.get(id,'docker-local-owner')).document);assert.equal(saved.draft.summary,plan.summary);assert.deepEqual(saved.storyboard.outline.beats,doc.storyboard.outline.beats);assert.deepEqual(saved.draft.pages.slice(0,20),pages.slice(0,20));
 assert.equal(f.control.recommendations.length,1);assert.equal(f.control.outlines.length,0);assert.equal(f.control.batches.length,1);assert.deepEqual(f.control.batches[0].batch,{first:21,last:21});
});
