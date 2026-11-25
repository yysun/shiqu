// Service E2E: real REST handlers, durable queue, SQLite and files with citation-valid controlled inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {libraryFixture,selection} from './fixtures/story-library.mjs';
import {withLocalBooks} from '../server/local-generation.ts';
import {LocalBooks} from '../server/local-books.ts';
import {bookContents} from '../server/local-book-contents.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {StoryDiscoveryCache,discoveryHash} from '../server/story-discovery-cache.ts';
import {legacySummaryDiscoveryNamespace,discoveryNamespace} from '../server/local-story-discovery.ts';
import {previousReadingPlanKey} from '../server/story-discovery-legacy.ts';

async function fixture(t){
 const f=await productionFixture(t),library=libraryFixture();f.control.hold=false;
 f.generation.suggestions=(...args)=>library.provider.suggestions(...args);
 f.generation.matchStories=(...args)=>library.provider.matchStories(...args);
 f.control.beforeText=async(kind,payload)=>{if(kind==='recommend'){const story=library.stories.find(story=>payload.verifiedOriginal.text.includes(library.book.sections[0].units.find(unit=>unit.id===story.source.firstUnit).text));if(story)return {storySummary:story.summary,storyMatchReason:payload.storyBrief.matchReason};}};
 async function restart(){f.options.generation=withLocalBooks(f.generation,library.books,f.media);await f.restart();f.app.services.localBooks=library.books;}
 await restart();return {f,library,restart};
}
async function create(f,theme){
 const saved=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,theme,narrativeDetail:'balanced'}});
 await f.startDiscovery(saved.id);await f.demand(saved.id,crypto.randomUUID());await until(async()=>(await f.read(saved.id)).intake.phase==='choosing');return f.read(saved.id);
}

test('cold theme discovery retains rejected stories; restart and new themes reuse them; production receives originals',async t=>{
 const {f,library,restart}=await fixture(t),first=await create(f,'勇气');
 assert.deepEqual(first.intake.batches[0].stories.map(story=>story.title),['勇士护民']);assert.equal(library.calls.catalog.length,2);
 assert.ok(first.intake.batches[0].stories[0].matchReason);assert.equal(first.intake.batches[0].stories[0].storyBrief,undefined);assert.equal(first.intake.batches[0].stories[0].summary,undefined);assert.equal(f.control.recommendations.length,0);
 for(const call of library.calls.matches)for(const story of call.stories){assert.ok(story.text);assert.equal(story.summary,undefined);}
 assert.ok(library.calls.catalog.every(call=>call.selection.theme===''&&call.input.purpose==='catalog'));
 const chosen=await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:first.intake.generation,action:'choose',batch:0,index:0});assert.equal(chosen.intake.search.state,'idle');
 await until(async()=>(await f.read(first.id)).intake.phase==='confirming');
 const prepared=await f.read(first.id),original=(await f.json(`sessions/${first.id}/source`)).source;
 assert.equal(original.storyBrief.verified,true);assert.equal(original.storyBrief.summary,library.stories[1].summary);
 assert.equal(original.localSource.firstUnit,'u2');assert.match(original.text,/勇士面对山中的猛虎/);assert.ok(original.chapterContext.text.includes(library.book.sections[0].units[1].text));
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 const advice=f.control.recommendations[0].verifiedOriginal;assert.equal(advice.text,original.text);assert.notEqual(advice.text,library.stories[1].summary);assert.equal(advice.summary,undefined);
 await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:prepared.intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:'保留明确行动。',narrativeDetail:'balanced',length:2}});
 await until(async()=>(await f.read(first.id)).state==='completed');assert.equal(f.control.calls.length,2);
 for(const payload of f.control.plans){assert.equal(payload.verifiedOriginal.text,original.text);assert.equal(payload.verifiedOriginal.summary,undefined);assert.ok(payload.verifiedOriginal.chapterContext);assert.equal(payload.storyBrief,undefined);assert.deepEqual(payload.editorialContext,{mode:'theme',theme:'勇气'});}
 const extracted=library.calls.catalog.length;await restart();
 const other=await create(f,'知恩图报');assert.equal(other.intake.batches[0].stories[0].title,'乌龟报恩');assert.equal(library.calls.catalog.length,extracted);
 const matched=library.calls.matches.length;await restart();const again=await create(f,'知恩图报');assert.equal(again.intake.batches[0].stories[0].title,'乌龟报恩');assert.equal(library.calls.matches.length,matched);assert.equal(library.calls.catalog.length,extracted);
});

test('REST preserves obsolete review as unknown and retries after exhaustive discovery without rescanning',async t=>{
 const {f,library}=await fixture(t);library.control.decide=()=> 'review';
 const response=await f.request('suggestions','POST',{...selection,theme:'需要核对'});assert.equal(response.status,200);const empty=await response.json();assert.deepEqual(empty.stories,[]);assert.match(empty.note,/未能判断/);
 const extracted=library.calls.catalog.length;assert.equal(extracted,2);const before=library.calls.matches.length;
 library.control.decide=(_theme,story)=>{assert.ok(story.text);return 'yes';};
 const result=await f.json('suggestions','POST',{...selection,theme:'需要核对'});assert.equal(result.stories[0].title,'乌龟报恩');assert.ok(library.calls.matches.length>before);assert.equal(library.calls.catalog.length,extracted);
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

for(const [theme,length] of [['勇气',2],['原典故事',21]])test(`${theme}: synopsis is created only after selection and an unsupported reason is corrected before ${length}-frame production and survive restart`,async t=>{
 const {f,library,restart}=await fixture(t),match=library.provider.matchStories;
 library.provider.matchStories=async(...args)=>{const result=await match(...args);return {matches:result.matches.map(item=>item.verdict==='yes'?{...item,reason:'人物因复仇杀死对手。'}:item)};};
 const first=await create(f,theme),candidate=first.intake.batches[0].stories[0],complete=library.stories.find(story=>story.title===candidate.title).summary;
 const reason='原文中的行动和实际结果支持本次选题，没有复仇杀人的事实。';
 const planInputs=[],batches=[];
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='outline'||kind==='sceneBatch')planInputs.push(payload);
  if(kind==='sceneBatch')batches.push(payload.batch);
  if(kind==='recommend'){assert.equal(candidate.storyBrief,undefined);assert.equal(payload.storyBrief.summary,'尚未准备完整摘要，请依据已核原文生成。');assert.equal(payload.storyBrief.matchReason,candidate.matchReason);assert.ok(payload.verifiedOriginal.text);return {storySummary:complete,storyMatchReason:reason};}
 };
 await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:first.intake.generation,action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(first.id)).intake.phase==='confirming');
 let saved=await f.read(first.id);const source=(await f.json(`sessions/${first.id}/source`)).source;
 assert.deepEqual(source.storyBrief,{summary:complete,matchReason:reason,verified:true});assert.equal(saved.frameRecommendation.storySummary,complete);assert.equal(f.control.plans.length,0);
 await restart();saved=await f.read(first.id);assert.deepEqual((await f.json(`sessions/${first.id}/source`)).source.storyBrief,source.storyBrief);
 await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:saved.selection.productionPrompt,narrativeDetail:'balanced',length}});
 await until(async()=>(await f.read(first.id)).state==='completed');
 const context=theme==='原典故事'?{mode:'source'}:{mode:'theme',theme};
 for(const payload of [...planInputs,...f.control.reviews]){assert.deepEqual(payload.storyBrief,f.control.reviews.includes(payload)?{summary:complete,matchReason:reason}:undefined);if(payload.outline&&!f.control.reviews.includes(payload))assert.equal(payload.outline.summary,undefined);assert.deepEqual(payload.editorialContext,context);assert.equal(payload.verifiedOriginal.text,source.text);assert.equal(payload.verifiedOriginal.storyBrief,undefined);}
 assert.equal(f.control.dagCalls.filter(name=>name==='outline').length,1);
 assert.equal(f.control.dagCalls.filter(name=>name==='brief').length,0);
 if(length>20)assert.deepEqual(batches,[{first:1,last:20},{first:21,last:21}]);
 assert.equal(f.control.recommendations.length,1,'Synopsis verification reuses the existing advice call');
});

for(const omitted of ['storySummary','storyMatchReason'])test(`missing ${omitted} fails preparation, blocks confirmation, and retries with the same original`,async t=>{
 const {f,library}=await fixture(t),saved=await create(f,'勇气');let invalid=true;
 f.control.beforeText=async kind=>kind==='recommend'&&invalid?{[omitted]:undefined}:undefined;
 await f.json(`sessions/${saved.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'choose',batch:0,index:0});await until(async()=>(await f.read(saved.id)).state==='failed');
 const before=(await f.json(`sessions/${saved.id}/source`)).source;assert.equal(before.storyBrief.verified,false);assert.equal(f.control.plans.length,0);
 const current=await f.read(saved.id),confirm={requestId:crypto.randomUUID(),generation:current.intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:'',narrativeDetail:'balanced',length:2}};
 assert.equal((await f.request(`sessions/${saved.id}/setup`,'POST',confirm)).status,409);
 // A stale count receipt cannot bypass the new source-bound synopsis gate either.
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.intake.phase','confirming','$.frameRecommendation',json(?)),production_complete=0 WHERE id=?").bind(JSON.stringify({count:2,reason:'旧建议'}),saved.id).run();
 assert.equal((await f.request(`sessions/${saved.id}/setup`,'POST',{...confirm,requestId:crypto.randomUUID()})).status,409);
 await f.app.services.database.prepare("UPDATE stories SET document=json_remove(json_set(document,'$.intake.phase','preparing'),'$.frameRecommendation'),production_complete=0 WHERE id=?").bind(saved.id).run();
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
 f.control.beforeText=async(kind,payload)=>{if(kind==='recommend'){assert.deepEqual(payload.editorialContext,{mode:'source'});assert.equal(payload.storyBrief.summary,'尚未准备完整摘要，请依据已核原文生成。');assert.match(payload.verifiedOriginal.text,/欲先看之/);return {storySummary:complete,storyMatchReason:'按原典保存到任先问贤士及其回应，不额外套主题。'};}};
 const saved=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{bookId:'shishuo',theme:'原典故事',source:entry.source,length:'auto',narrativeDetail:'balanced',artStyle:'ink-pencil',voice:false}});
 await until(async()=>(await f.read(saved.id)).intake.phase==='confirming');const ready=await f.read(saved.id),original=(await f.json(`sessions/${saved.id}/source`)).source;
 assert.equal(original.storyBrief.verified,true);assert.equal(original.storyBrief.summary,complete);assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);
 await f.json(`sessions/${saved.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:ready.intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:'',narrativeDetail:'balanced',length:2}});
 await until(async()=>(await f.read(saved.id)).state==='completed');
 for(const payload of [...f.control.plans,...f.control.reviews]){assert.deepEqual(payload.editorialContext,{mode:'source'});assert.deepEqual(payload.storyBrief,f.control.reviews.includes(payload)?{summary:complete,matchReason:original.storyBrief.matchReason}:undefined);assert.equal(payload.verifiedOriginal.text,original.text);}
});

test('historical direct selections without a synopsis prepare one before any new storyboard',async t=>{
 const f=await productionFixture(t),books=new LocalBooks(process.cwd());f.options.generation=withLocalBooks(f.generation,books,f.media);await f.restart();f.app.services.localBooks=books;
 f.app.services.production.stop();const entry=(await bookContents(books,{bookId:'shishuo',theme:'原典故事'})).entries[0];
 const saved=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{bookId:'shishuo',theme:'原典故事',source:entry.source,length:'auto',narrativeDetail:'balanced',artStyle:'ink-pencil',voice:false}});
 await f.app.services.database.prepare("UPDATE stories SET document=json_remove(document,'$.intake.briefRequired') WHERE id=?").bind(saved.id).run();
 await f.restart();f.app.services.localBooks=books;await until(async()=>(await f.read(saved.id)).intake.phase==='confirming');
 assert.equal((await f.json(`sessions/${saved.id}/source`)).source.storyBrief.verified,true);assert.ok(f.control.recommendations[0].storyBrief.summary);assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);
});

const savedDocument=async(f,id)=>JSON.parse((await new ReaderRepository(f.app.services.database).get(id,'docker-local-owner')).document);
const recover=async(f,id)=>{
 const {faults}=await f.read(id),fault=faults.find(item=>item.retryAllowed);
 assert.ok(fault,'the reader can recover the saved production fault');
 await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
};
const preparedSummary='庄周梦见自己成为蝴蝶，自在飞舞；醒来后发现自己仍是庄周，由此思考梦醒与蝴蝶的区别。';

for(const length of [2,21])test(`missing synopsis is saved before a ${length}-frame plan and a planning retry does not regenerate it`,async t=>{
 const f=await productionFixture(t),id=await f.create(length);f.control.hold=false;
 let fail=true;
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='brief'){assert.ok(payload.verifiedOriginal.text);return {summary:preparedSummary};}
  if(kind==='outline'){
   const doc=await savedDocument(f,id);
   assert.equal(doc.dag.brief,preparedSummary);
   assert.equal(doc.usage.filter(item=>item.step==='dag:prepareBrief').length,1);
   if(fail)throw Error('controlled planning outage');
  }
 };
 await until(async()=>(await f.read(id)).state==='failed',15000);
 assert.equal(f.control.calls.length,0);
 const source=(await savedDocument(f,id)).original;
 await f.restart();fail=false;
 await recover(f,id);
 await until(async()=>(await f.read(id)).state==='completed',25000);
 const doc=await savedDocument(f,id);
 assert.equal(doc.plan.summary,preparedSummary);
 assert.deepEqual(doc.original,source);
 assert.equal(doc.plan.pages.length,length);
 assert.equal(f.control.dagCalls.filter(name=>name==='brief').length,1);
 assert.equal(f.control.dagCalls.filter(name=>name==='outline').length,2);
});

test('invalid missing-summary preparation blocks planning and retries with the saved original',async t=>{
 const f=await productionFixture(t),id=await f.create(2);f.control.hold=false;
 let invalid=true;
 f.control.beforeText=async kind=>kind==='brief'?(invalid?{}:{summary:preparedSummary}):undefined;
 await until(async()=>(await f.read(id)).state==='failed',15000);
 const pending=await savedDocument(f,id);
 assert.ok(pending.original.text);
 assert.equal(pending.dag.brief,undefined);
 assert.equal(f.control.dagCalls.includes('outline'),false);
 assert.equal(f.control.calls.length,0);
 invalid=false;await recover(f,id);
 await until(async()=>(await f.read(id)).state==='completed',15000);
 const ready=await savedDocument(f,id);
 assert.deepEqual(ready.original,pending.original);
 assert.equal(ready.plan.summary,preparedSummary);
 assert.equal(f.control.dagCalls.filter(name=>name==='brief').length,2);
 assert.equal(f.control.dagCalls.filter(name=>name==='outline').length,1);
});

test('a confirmed legacy intake stays confirmed and keeps its selected frame count while a missing synopsis is prepared',async t=>{
 const f=await productionFixture(t),id=await f.create(2),doc=await savedDocument(f,id);f.control.hold=false;
 doc.frameCountConfirmed=true;doc.intake={phase:'confirmed',generation:0,creationHash:'legacy',selected:{batch:0,index:0},batches:[{stories:[{title:'庄周梦蝶',description:'梦醒之后的追问。'}],note:''}],search:{round:0,state:'idle'}};
 await f.app.services.database.prepare('UPDATE stories SET document=? WHERE id=?').bind(JSON.stringify(doc),id).run();
 f.control.beforeText=async kind=>kind==='brief'?{summary:preparedSummary}:undefined;
 await until(async()=>(await f.read(id)).state==='completed',15000);
 const saved=await savedDocument(f,id);
 assert.equal(saved.intake.phase,'confirmed');
 assert.equal(saved.plan.summary,preparedSummary);
 assert.equal(saved.plan.pages.length,2);
 assert.equal((await f.read(id)).selection.length,2);
 assert.equal(saved.frameCountConfirmed,true);
});

test('REST resumes an old summary catalog from real media without rescanning and persists new binary receipts across restart',async t=>{
 const {f,library,restart}=await fixture(t),cache=new StoryDiscoveryCache(f.media),status=await f.generation.status();
 const previous=legacySummaryDiscoveryNamespace(library.book,status.provider,status.models.text,undefined,status.taskReasoningEfforts.suggest),current=discoveryNamespace(library.book,status.provider,status.models.text,undefined,status.taskReasoningEfforts.suggest);
 const state={stories:library.stories,cursor:1,readThrough:1,pendingEvents:[],exhausted:true,rejected:false};await cache.write(previousReadingPlanKey(library.book,status.provider)+'/blocks',{mode:'whole',blocks:[{ranges:[{sectionId:'s1',firstUnit:'u1',lastUnit:'u2'}],tokens:100}]});await cache.write(previous+'/library',state);await cache.write(previous+'/themes/obsolete',{decisions:{old:'yes'}});
 const request=()=>f.json('suggestions','POST',{...selection,theme:'勇气'});const result=await request();assert.equal(result.stories[0].title,'勇士护民');assert.equal(result.stories[0].storyBrief,undefined);assert.equal(result.stories[0].summary,undefined);assert.ok(result.stories[0].matchReason);
 assert.equal(library.calls.catalog.length,0);assert.equal(library.calls.matches.length,1);assert.equal(library.calls.matches[0].stories.length,2);assert.ok(library.calls.matches[0].stories.every(story=>story.text&&!('summary' in story)));
 const envelope=async key=>JSON.parse(new TextDecoder().decode(await (await f.media.get('reader-cache/'+discoveryHash(key)+'.json')).arrayBuffer()));
 assert.deepEqual((await envelope(previous+'/library')).value,state);const migrated=(await envelope(current+'/library')).value;assert.equal(migrated.cursor,1);assert.ok(migrated.stories.every(story=>!('summary' in story)));
 await restart();assert.deepEqual((await request()).stories,result.stories);assert.equal(library.calls.catalog.length,0);assert.equal(library.calls.matches.length,1);assert.equal(f.control.recommendations.length,0);
});

test('REST accepts a captured pending completion with shared old evidence and preserves it across restart',async t=>{
 const {readFile}=await import('node:fs/promises'),{localChoices}=await import('../lib/reader-local-contract.ts');
 const receipt=JSON.parse(await readFile(new URL('./fixtures/pending-overlap.json',import.meta.url),'utf8'));
 const f=await productionFixture(t),books=new LocalBooks(process.cwd()),selection={bookId:receipt.bookId,theme:'爱情与错过',artStyle:'ink-pencil',length:'auto',voice:false,productionPrompt:''};
 const book=await books.book(selection),status=await f.generation.status(),cache=new StoryDiscoveryCache(f.media),key=discoveryNamespace(book,status.provider,status.models.text,undefined,status.taskReasoningEfforts.suggest)+'/library';let catalogs=0,matches=0;
 await cache.write(key,receipt.catalog);
 f.generation.suggestions=async(_s,_e,input)=>{assert.equal(++catalogs,1);return localChoices(receipt.receipt,input);};
 f.generation.matchStories=async(theme,stories)=>{matches++;return {matches:stories.map(story=>({id:story.id,verdict:theme==='everything'||story.title===receipt.receipt.stories[0].title?'yes':'no',reason:'受控核对跨章完整故事可参与主题匹配。'}))};};
 const restart=async()=>{f.options.generation=withLocalBooks(f.generation,books,f.media);await f.restart();f.app.services.localBooks=books;};await restart();
 const saved=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection});await f.startDiscovery(saved.id);await f.demand(saved.id,crypto.randomUUID());await until(async()=>(await f.read(saved.id)).intake.phase==='choosing');
 const ready=await f.read(saved.id),candidate=ready.intake.batches[0].stories[0];assert.equal(candidate.title,receipt.receipt.stories[0].title);assert.equal(candidate.continuedFrom,undefined);assert.equal(candidate.storyBrief,undefined);assert.equal(ready.intake.search.state,'idle');assert.equal(catalogs,1);assert.equal(f.control.recommendations.length,0);assert.equal(f.control.calls.length,0);
 await restart();assert.equal((await f.read(saved.id)).intake.batches[0].stories[0].title,candidate.title);
 const before=matches,again=await f.json('suggestions','POST',selection);assert.equal(again.stories[0].title,candidate.title);assert.equal(matches,before);assert.equal(catalogs,1);
 const other=await f.json('suggestions','POST',{...selection,theme:'everything',excludeSources:[candidate.source]});assert.ok(other.stories.some(story=>story.title===receipt.catalog.stories[2].title));assert.equal(catalogs,1);
});

test('one-card intake fills four after a cold miss and shows the remaining batch without extraction',async t=>{
 const {f,library}=await fixture(t);
 for(let i=3;i<=5;i++){const unit={id:'u'+i,text:'勇士'+i+'面对猛虎仍然向前，保护村民并驱走猛虎，最后平安归来。',narrative:true};library.book.sections[0].units.push(unit);library.stories.push({title:'护民故事'+i,description:'人物面对危险作出选择。',source:{...library.stories[1].source,firstUnit:unit.id,lastUnit:unit.id}});}
 library.book.input.text='篇章 s1：第一章\n'+library.book.sections[0].units.map(unit=>'['+unit.id+']\n'+unit.text).join('\n\n');
 const first=await create(f,'勇气');assert.equal(first.intake.batches[0].stories.length,1);assert.deepEqual(library.calls.catalog.map(call=>call.input.scan.maxStories),[1,32]);assert.deepEqual(library.calls.matches.map(call=>call.stories.length),[1,4]);
 for(let i=0;i<3;i++){const saved=await f.read(first.id);await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'more'});await f.demand(first.id,crypto.randomUUID());await until(async()=>(await f.read(first.id)).intake.batches.length===i+2);}
 const saved=await f.read(first.id);assert.equal(new Set(saved.intake.batches.flatMap(batch=>batch.stories.map(story=>story.source.firstUnit))).size,4);assert.equal(library.calls.catalog.length,2);assert.equal(library.calls.matches.length,2);assert.equal(f.control.recommendations.length,0);assert.equal(f.control.calls.length,0);
});

test('REST reports a source-specific extraction failure and clears its private diagnostic after retry',async t=>{
 const {f,library}=await fixture(t),base=library.provider.suggestions;
 library.provider.suggestions=async()=>({stories:[{...library.stories[0],source:{...library.stories[0].source,firstUnit:'missing'}}],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}});
 const response=await f.request('suggestions','POST',{...selection,theme:'勇气'});assert.equal(response.status,502);const error=(await response.json()).error;assert.match(error,/原文范围无法核对/);assert.doesNotMatch(error,/换个主题|missing/);
 const status=await f.generation.status(),key=discoveryNamespace(library.book,status.provider,status.models.text,undefined,status.taskReasoningEfforts.suggest)+'/library';
 const read=async()=>JSON.parse(new TextDecoder().decode(await (await f.media.get('reader-cache/'+discoveryHash(key)+'.json')).arrayBuffer())).value;
 assert.equal((await read()).lastRejection.code,'invalid-source');assert.equal((await read()).cursor,0);assert.deepEqual((await read()).stories,[]);
 library.provider.suggestions=base;const result=await f.json('suggestions','POST',{...selection,theme:'勇气'});assert.equal(result.stories[0].title,'勇士护民');assert.equal((await read()).lastRejection,undefined);
});
