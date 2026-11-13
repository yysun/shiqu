// Verify title changes through the production command/queue, including old work that ignores cancellation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,selection} from './fixtures/production.mjs';
import {libraryFixture} from './fixtures/story-library.mjs';
import {withLocalBooks} from '../server/local-generation.ts';

test('changing the extraction title fences a late old result and persists the new query exactly once',async t=>{
 const f=await productionFixture(t),calls=[];let release;
 const gate=new Promise(resolve=>{release=resolve;});
 f.generation.suggestions=async current=>{
  calls.push(current);
  if(calls.length===1)await gate;
  return {stories:[{title:current.discovery?.mode==='title'?current.discovery.title:'旧自动故事',description:'原文中的完整事件。'}],note:''};
 };
 const id=crypto.randomUUID();await f.json('sessions','POST',{requestId:id,intake:true,selection:{...selection,storyTitle:undefined,discovery:{mode:'auto'},length:'auto'}});await f.startDiscovery(id);await f.demand(id);
 try{
 await until(()=>calls.length===1);
 const before=await f.read(id),command={requestId:crypto.randomUUID(),generation:before.intake.generation,action:'search',title:'指定的新故事'};
 const changed=await f.json(`sessions/${id}/setup`,'POST',command);
 assert.deepEqual(changed.selection.discovery,{mode:'title',title:'指定的新故事'});assert.equal(changed.selection.theme,selection.theme);
 assert.equal(changed.intake.generation,before.intake.generation+1);assert.deepEqual(changed.intake.batches,[]);
 assert.equal((await f.json(`sessions/${id}/setup`,'POST',command)).intake.generation,changed.intake.generation);
 release();await until(async()=>(await f.read(id)).intake.search.state==='idle');
 let saved=await f.read(id);assert.deepEqual(saved.intake.batches.flatMap(batch=>batch.stories.map(story=>story.title)),['指定的新故事']);assert.equal(calls.length,2);
 await f.restart();saved=await f.read(id);assert.deepEqual(saved.selection.discovery,{mode:'title',title:'指定的新故事'});
 assert.equal((await f.request(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:before.intake.generation,action:'choose',batch:0,index:0})).status,409);
 const automatic=await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'search',title:'   '});
 assert.deepEqual(automatic.selection.discovery,{mode:'auto'});assert.equal(automatic.selection.theme,selection.theme);
 assert.deepEqual((await f.json(`sessions/${id}/setup`,'POST',command)).selection.discovery,{mode:'auto'});
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 }finally{release();}
});

test('query changes preserve canonical source scope, theme and paused control without buying work',async t=>{
 const f=await productionFixture(t),library=libraryFixture(),scope={edition:library.book.edition,sectionId:'s1',firstUnit:'u1',lastUnit:'u2'};
 f.generation.suggestions=library.provider.suggestions;f.generation.matchStories=library.provider.matchStories;
 f.options.generation=withLocalBooks(f.generation,library.books,f.media);await f.restart();f.app.services.localBooks=library.books;
 const created=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,theme:'知恩图报',discovery:{mode:'auto',themeInput:'custom'},discoverySources:[scope]}});
 await f.json(`sessions/${created.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'pause'});
 const changed=await f.json(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:created.intake.generation,action:'search',title:'乌龟报恩'});
 assert.equal(changed.generationControl,'paused');assert.equal(changed.selection.theme,'知恩图报');assert.deepEqual(changed.selection.discoverySources,[scope]);
 await f.app.services.production.tick();assert.equal(library.calls.catalog.length,0);
 await f.json(`sessions/${created.id}/production-control`,'POST',{requestId:crypto.randomUUID(),action:'resume'});await f.demand(created.id);
 await until(async()=>(await f.read(created.id)).intake.search.state==='idle');
 assert.equal((await f.read(created.id)).intake.batches[0].stories[0].title,'乌龟报恩');
});

test('selected, preparing and confirmed stories reject a direct title reset',async t=>{
 const f=await productionFixture(t);f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦与醒的故事。'}],note:''});
 const created=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined}});await f.startDiscovery(created.id);await f.demand(created.id);
 await until(async()=>(await f.read(created.id)).intake.phase==='choosing');let saved=await f.read(created.id);
 await f.json(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'choose',batch:0,index:0});
 saved=await f.read(created.id);
 assert.equal((await f.request(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'search',title:'另一个故事'})).status,409);
 await until(async()=>(await f.read(created.id)).intake.phase==='confirming');saved=await f.read(created.id);
 assert.equal((await f.request(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'search',title:''})).status,409);
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.intake.phase','confirmed') WHERE id=?").bind(created.id).run();
 assert.equal((await f.request(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'search',title:'别篇'})).status,409);
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('reselection drafts share title search and cancellation leaves the original version unchanged',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await f.create(2);await until(async()=>(await f.read(id)).state==='completed');
 const before=await f.read(id);let received;
 f.generation.suggestions=async current=>{received=current;return {stories:[{title:current.discovery?.mode==='title'?current.discovery.title:'自动候选',description:'原文中的完整故事。'}],note:''};};
 const draft=await f.json(`sessions/${id}/reselection`,'POST',{requestId:crypto.randomUUID()});
 const changed=await f.json(`sessions/${draft.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:draft.intake.generation,action:'search',title:'庄子的大葫芦'});
 assert.ok(changed.reselection);await f.demand(draft.id);await until(async()=>(await f.read(draft.id)).intake.search.state==='idle');
 assert.equal(received.discovery.title,'庄子的大葫芦');assert.equal((await f.read(draft.id)).intake.batches[0].stories[0].title,'庄子的大葫芦');
 assert.deepEqual((await f.read(id)).story,before.story);assert.deepEqual((await f.read(id)).selection,before.selection);
 const cancelled=await f.json(`sessions/${id}/reselection/${draft.id}`,'DELETE');assert.equal(cancelled.id,id);assert.deepEqual(cancelled.story,before.story);
 assert.equal((await f.json('sessions')).length,1);
});

test('title search rejects malformed titles and unsupported source books without mutating the query',async t=>{
 const f=await productionFixture(t),created=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,bookId:'other',customBook:'非本地测试书'}});
 for(const title of ['a\nb','字'.repeat(101),'目标故事'])assert.equal((await f.request(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:created.intake.generation,action:'search',title})).status,400);
 assert.equal((await f.read(created.id)).intake.generation,created.intake.generation);
 const auto=await f.json(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:created.intake.generation,action:'search',title:''});assert.deepEqual(auto.selection.discovery,{mode:'auto'});
});
