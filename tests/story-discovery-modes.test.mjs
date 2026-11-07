// Exercise inferred title/automatic intent in production discovery, exact scopes and durable intake.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalBooks} from '../server/local-books.ts';
import {bookContents,selectedChapterScope} from '../server/local-book-contents.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {createReaderProvider} from '../server/generation.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {localSourceKey} from '../lib/reader-local-contract.ts';
import {libraryFixture,memory} from './fixtures/story-library.mjs';
import {productionFixture,until,selection} from './fixtures/production.mjs';

const library=new LocalBooks(process.cwd());
const scan=(pendingEvents=[])=>({blockComplete:true,pendingEvents,resolvedEventIds:[]});
for(const name of ['codex','gemini'])test(`${name}: title queries keep full scope, ignore theme filtering and never fall back to episodes`,async()=>{
 const selected=selectionSchema.parse({bookId:'水浒传',theme:'欲望与代价',discovery:{mode:'title',title:'宋公明三败高俅'}}),book=await library.book(selected),sections=book.sections.slice(77,80);
 const refs=sections.map(s=>({edition:book.edition,sectionId:s.id,firstUnit:s.units[0].id,lastUnit:s.units.at(-1).id}));selected.discoverySources=refs;
 const full={...refs[0],continuations:refs.slice(1).map(({edition,...range})=>range)},calls=[],store=memory();
 const result=job=>{
  const payload=JSON.parse(job.prompt);
  if(payload.stories){assert.equal(payload.theme,'原典故事');return JSON.stringify({matches:payload.stories.map(story=>({id:story.id,verdict:'yes',reason:'原文支持完整事件。'}))});}
  const input=payload.localBook;calls.push(input);assert.equal(input.scan.chapterStoryLevel,undefined);
  const target=input.scan.targetStoryTitle;
  if(target)assert.match(job.instructions,/不能只取第一次胜负/);
  let source=refs[0],title='宋公明一败高俅';
  if(target==='不存在的故事')return JSON.stringify({stories:[],note:'原文没有这个故事。',scan:scan()});
  if(target==='宋公明三败高俅'){
   if(!input.text.includes(`[${refs[2].lastUnit}]`)){
    const {edition,...range}=source;
    return JSON.stringify({stories:[],note:'后两败的原文不足。',scan:scan([{id:'',title:target,source:{...range,continuations:[]}}])});
   }
   source=full;title=target;
  }
  const {edition,...range}=source;
  return JSON.stringify({stories:[{title,description:'人物在战事中采取行动。',source:{continuations:[],...range}}],note:'',scan:scan()});
 };
 const runner={status:async()=>({configured:true}),run:async job=>({text:result(job),model:'mock',requestId:'mock',usage:null})};
 const transport=async(_url,init)=>{const request=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:result({instructions:request.systemInstruction.parts[0].text,prompt:request.contents[0].parts[0].text})}]}}]});};
 const base=createReaderProvider({SHIQU_AI_PROVIDER:name,GEMINI_API_KEY:'mock-only'},store,transport,runner);
 const wrapped=withLocalBooks(base,library,store),first=await wrapped.suggestions(selected,[]);
 assert.equal(first.stories[0].title,selected.discovery.title);assert.deepEqual(first.stories[0].source,full);assert.equal(calls.length,1);
 assert.equal((await wrapped.suggestions({...selected,theme:'爱情与错过'},[])).stories[0].title,first.stories[0].title);assert.equal(calls.length,1);
 assert.equal((await wrapped.suggestions(selected,[first.stories[0].title],undefined,undefined,[full])).stories.length,0);assert.equal(calls.length,1);
 const missing=await wrapped.suggestions({...selected,discoverySources:refs.slice(0,1)},[]);
 assert.equal(missing.stories.length,0);assert.match(missing.note,/补选/);
 const absent=await wrapped.suggestions({...selected,discovery:{mode:'title',title:'不存在的故事'}},[]);
 assert.equal(absent.stories.length,0);assert.match(absent.note,/核对标题/);
 const one=await wrapped.suggestions({...selected,discovery:{mode:'title',title:'宋公明一败高俅'}},[]);
 assert.equal(one.stories[0].title,'宋公明一败高俅');
 const automatic=await wrapped.suggestions({...selected,discovery:{mode:'auto'},theme:'原典故事'},[]);
 assert.equal(automatic.stories[0].title,'宋公明一败高俅');assert.equal(calls.at(-1).scan.targetStoryTitle,undefined);
 assert.deepEqual((await withLocalBooks(base,library,store).suggestions(selected,[])).stories,first.stories);
});

test('automatic discovery with a chapter scope keeps extraction neutral and applies the selected theme',async()=>{
 const f=libraryFixture(),wrapped=withLocalBooks(f.provider,f.books,f.store),section=f.book.sections[0];
 const scope={edition:f.book.edition,sectionId:section.id,firstUnit:section.units[0].id,lastUnit:section.units.at(-1).id};
 const selected=selectionSchema.parse({...selection,bookId:'zhuangzi',theme:'勇气',discovery:{mode:'auto'},discoverySources:[scope]});
 const result=await wrapped.suggestions(selected,[]);
 assert.deepEqual(result.stories.map(story=>story.title),['勇士护民']);
 assert.ok(f.calls.catalog.every(call=>call.selection.theme===''&&!call.input.scan.chapterStoryLevel&&!call.input.scan.targetStoryTitle));
 assert.ok(f.calls.matches.every(call=>call.theme==='勇气'));
 const prior=f.calls.catalog.length,other=await wrapped.suggestions({...selected,theme:'知恩图报'},[]);
 assert.deepEqual(other.stories.map(story=>story.title),['乌龟报恩']);assert.equal(f.calls.catalog.length,prior);
});

test('verified title results and their cached replay never depend on an available theme matcher',async()=>{
 const f=libraryFixture(),selected=selectionSchema.parse({...selection,bookId:'zhuangzi',discovery:{mode:'title',title:'乌龟报恩'},theme:'爱情与错过'});
 f.provider.matchStories=async()=>assert.fail('A fixed title must not be rejected or hidden by a theme filter');
 const first=await withLocalBooks(f.provider,f.books,f.store).suggestions(selected,[]);
 assert.equal(first.stories[0].title,'乌龟报恩');assert.equal(f.calls.catalog.length,1);
 const restored=await withLocalBooks(f.provider,f.books,f.store).suggestions({...selected,theme:'给我一个反转'},[]);
 assert.deepEqual(restored.stories,first.stories);assert.equal(f.calls.catalog.length,1);
});

test('title plus a catalog story scopes inference to its exact passage and rejects forged excerpts',async()=>{
 const selected=selectionSchema.parse({...selection,bookId:'liaozhai',discovery:{mode:'title',title:'种梨'}}),book=await library.book(selected);
 const contents=await bookContents(library,selected),entry=contents.entries.find(entry=>entry.title==='種梨');
 const scoped=await selectedChapterScope(library,book,[entry.source]);
 assert.ok(scoped.book.input.text.includes('種梨'));assert.ok(!scoped.book.input.text.includes('勞山道士'));
 assert.equal(localSourceKey(scoped.discoverySources[0]),localSourceKey(entry.source));
 assert.equal(scoped.book.sections[0].units.map(unit=>unit.text).join('\n\n'),library.resolve(book,entry.source).text);
 await assert.rejects(selectedChapterScope(library,book,[{...entry.source,lastUnit:entry.source.firstUnit}]),error=>error.status===400);
 let calls=0;
 const provider={status:async()=>({configured:true,provider:'codex',models:{text:'mock',image:'mock'}}),generator:()=>({}),safeError:()=>'',matchStories:async(_theme,stories)=>({matches:stories.map(story=>({id:story.id,verdict:'yes',reason:'原文支持指定故事。'}))}),suggestions:async(_selection,_excluded,input)=>{calls++;assert.ok(!input.text.includes('勞山道士'));assert.equal(input.scan.targetStoryTitle,'种梨');return {stories:[{title:'种梨',description:'道士与卖梨人相遇。',source:entry.source}],note:'',scan:scan()};}};
 const result=await withLocalBooks(provider,library,memory()).suggestions({...selected,discoverySources:[entry.source]},[]);
 assert.equal(result.stories[0].title,'种梨');assert.equal(calls,1);
 assert.equal(result.stories[0].sourceLabel,library.resolve(book,entry.source).title.slice(0,150));
});

test('title intent, scope and theme survive creation, replay, restart and choosing in the production API',async t=>{
 const f=await productionFixture(t),s=selectionSchema.parse({...selection,bookId:'liaozhai',storyTitle:undefined,theme:'欲望与代价',discovery:{mode:'title',title:'种梨'}});
 const entries=(await bookContents(library,s)).entries;
 const entry=entries.find(entry=>entry.title==='種梨');
 s.discoverySources=entries.filter(entry=>['種梨','勞山道士'].includes(entry.title)).map(entry=>entry.source);
 assert.equal(s.discoverySources.length,2);
 f.generation.matchStories=async(_theme,stories)=>({matches:stories.map(story=>({id:story.id,verdict:'yes',reason:'完整原文依据。'}))});
 f.generation.suggestions=async()=>({stories:[{title:'种梨',description:'人物围绕梨树发生交往。',source:entry.source}],note:'',scan:scan()});
 f.options.generation=withLocalBooks(f.generation,library,f.media);await f.restart();f.app.services.localBooks=library;
 const id=crypto.randomUUID(),body={requestId:id,intake:true,selection:s};
 await f.json('sessions','POST',body);await f.startDiscovery(id);await f.demand(id);await until(async()=>(await f.read(id)).intake.phase==='choosing');
 assert.deepEqual((await f.read(id)).selection.discovery,s.discovery);assert.equal((await f.json('sessions','POST',body)).id,id);
 await f.restart();f.app.services.localBooks=library;let saved=await f.read(id);
 assert.deepEqual(saved.selection.discoverySources,s.discoverySources);assert.equal(saved.selection.theme,s.theme);
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(id)).intake.phase==='confirming');saved=await f.read(id);
 assert.deepEqual(saved.selection.discovery,s.discovery);assert.equal(saved.selection.storyTitle,'种梨');assert.equal(saved.selection.theme,s.theme);
 assert.deepEqual(saved.selection.source,entry.source);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('invalid title intents and unsupported books are rejected before saving a task',async t=>{
 const f=await productionFixture(t);f.app.services.localBooks=library;
 for(const discovery of [{mode:'title',title:''},{mode:'title',title:'   '},{mode:'title',title:'a\nb'},{mode:'invalid'}])assert.equal((await f.request('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,discovery}})).status,400);
 for(const extra of [{bookId:'other',customBook:'unknown book',intake:true},{intake:false}]){
  const {intake,...settings}=extra;
  assert.equal((await f.request('sessions','POST',{requestId:crypto.randomUUID(),intake,selection:{...selection,...settings,discovery:{mode:'title',title:'目标故事'}}})).status,400);
 }
 assert.equal((await f.json('sessions')).length,0);
});
