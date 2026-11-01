// Verify neutral discovery, durable independent verdicts, strict matching receipts and shared cancellation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryFixture,selection} from './fixtures/story-library.mjs';
import {StoryDiscoveryCache} from '../server/story-discovery-cache.ts';
import {discoverLocalStories,discoveryNamespace} from '../server/local-story-discovery.ts';
import {matchLibraryStories,themeStoryId,themeDecisionKey} from '../server/story-theme-matching.ts';
import {localSuggestionPayload} from '../lib/reader-local-contract.ts';
import {until} from './fixtures/production.mjs';
const observer=controller=>({signal:controller.signal,maxStories:1,drain:true,onProgress:()=>{}});
const documents=f=>[...f.store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes)));
const library=f=>documents(f).find(doc=>doc.key.endsWith('/library')).value;

test('an irrelevant story is retained and another theme reuses it without extracting the original again',async()=>{
 const f=libraryFixture(),first=await f.run('勇气');
 assert.deepEqual(first.stories.map(s=>s.title),['勇士护民']);assert.equal(f.calls.catalog.length,2);assert.equal(library(f).stories.length,2);
 for(const call of f.calls.catalog){assert.equal(call.selection.theme,'');assert.equal(call.selection.productionPrompt,'');assert.equal(call.input.purpose,'catalog');assert.equal(localSuggestionPayload(f.book.title,'LEAK',[],call.input).theme,undefined);}
 const second=await f.run('知恩图报');assert.deepEqual(second.stories.map(s=>s.title),['乌龟报恩']);assert.equal(f.calls.catalog.length,2);
 const matches=f.calls.matches.length;await f.run(' 知恩图报 ');assert.equal(f.calls.matches.length,matches);
 assert.ok(documents(f).filter(doc=>doc.key.includes('/themes/')).some(doc=>Object.values(doc.value.decisions).some(decision=>decision.verdict==='no')));
 assert.equal(second.stories[0].summary,undefined,'Full summaries stay internal');
});

test('new cache/provider wrappers reuse both neutral records and positive/negative theme decisions',async()=>{
 const f=libraryFixture();await f.run('勇气');await f.run('知恩图报');const before=structuredClone(f.calls);
 const result=await discoverLocalStories(f.provider,f.books,new StoryDiscoveryCache(f.store),f.book,{...selection,theme:'知恩图报'},[]);
 assert.equal(result.stories[0].title,'乌龟报恩');assert.deepEqual(f.calls,before);
});

test('newly extracted stories receive incremental verdicts without judging old negatives again',async()=>{
 const f=libraryFixture();await f.run('勇气');
 const judged=f.calls.matches.flatMap(call=>call.stories.map(story=>story.id));assert.equal(new Set(judged).size,judged.length);
 assert.equal(f.calls.matches[0].stories[0].text,undefined);assert.equal(f.calls.matches[0].stories[0].summary,f.stories[0].summary);
});

test('review reads the exact cited original and caches its final verdict',async()=>{
 const f=libraryFixture();f.control.decide=(_theme,story)=>story.text?'yes':'review';
 const result=await f.run('需要核对');assert.equal(result.stories[0].title,'乌龟报恩');assert.equal(f.calls.matches.length,2);
 assert.equal(f.calls.matches[1].stories[0].text,f.books.resolve(f.book,f.stories[0].source).text);
 const before=f.calls.matches.length;await f.run('需要核对');assert.equal(f.calls.matches.length,before);
});

test('an unresolved original review is retryable and never cached as no or rejudged from its summary',async()=>{
 const f=libraryFixture();f.control.decide=()=> 'review';await assert.rejects(f.run('不确定'),/仍无法确认主题/);
 assert.equal(library(f).stories.length,1);assert.equal(f.calls.matches.length,2);
 f.control.decide=(_theme,story)=>{assert.ok(story.text);return 'yes';};
 assert.equal((await f.run('不确定')).stories[0].title,'乌龟报恩');assert.equal(f.calls.matches.length,3);assert.equal(f.calls.catalog.length,1);
});

test('completed yes/no receipts survive a later failing original review in the same batch',async()=>{
 const f=libraryFixture();await f.run('收录');await f.run('收录',[f.stories[0].source]);
 f.control.decide=(_theme,story)=>story.title==='乌龟报恩'?'yes':'review';
 const first=await f.run('分批核对');assert.equal(first.stories[0].title,'乌龟报恩');const before=f.calls.matches.length;
 await assert.rejects(f.run('分批核对',[f.stories[0].source]),/仍无法确认主题/);assert.equal(f.calls.matches.length,before+1);
 await f.run('分批核对');assert.equal(f.calls.matches.length,before+1,'The known yes receipt needs no repeat call');
});

for(const kind of ['unknown','duplicate','missing'])test(`invalid ${kind} matching IDs cannot commit decisions or destroy the catalog`,async()=>{
 const f=libraryFixture();await f.run('收录');await f.run('收录',[f.stories[0].source]);
 f.provider.matchStories=async(_theme,stories)=>({matches:kind==='unknown'?stories.map(story=>({id:'b'.repeat(64),verdict:'yes',reason:'符合',summary:story.summary})):kind==='duplicate'?stories.map(()=>({id:stories[0].id,verdict:'yes',reason:'符合',summary:stories[0].summary})):[{id:stories[0].id,verdict:'yes',reason:'符合',summary:stories[0].summary}]});
 await assert.rejects(f.run('坏结果'),/逐篇核对/);assert.equal(library(f).stories.length,2);
 assert.ok(!documents(f).some(doc=>doc.key===themeDecisionKey(discoveryNamespace(f.book,'codex','mock',undefined,'medium'),'坏结果')));
});

test('a missing complete summary cannot enter the neutral library or advance its cursor',async()=>{
 const f=libraryFixture(),base=f.provider.suggestions;
 f.provider.suggestions=async(...args)=>{const result=await base(...args);return {...result,stories:result.stories.map(({summary,...story})=>{void summary;return story;})};};
 await assert.rejects(f.run(),/保留进度/);assert.equal(library(f).stories.length,0);assert.equal(library(f).cursor,0);assert.equal(f.calls.matches.length,0);
});

test('different themes share extraction and persist separate matching results',async()=>{
 const f=libraryFixture(),base=f.provider.suggestions;let release;
 f.provider.suggestions=async(...args)=>{await new Promise(resolve=>release=resolve);return base(...args);};
 const a=f.run('主题甲'),b=f.run('主题乙');await until(()=>release);release();
 const results=await Promise.all([a,b]);assert.ok(results.every(result=>result.stories[0].title==='乌龟报恩'));assert.equal(f.calls.catalog.length,1);
 assert.deepEqual(f.calls.matches.map(call=>call.theme).sort(),['主题乙','主题甲'].sort());
});

test('joining a matching flight for other IDs rechecks its own missing stories without dropping them',async()=>{
 const f=libraryFixture(),base=f.provider.matchStories;let release;
 f.provider.matchStories=async(...args)=>{if(!release)await new Promise(resolve=>release=resolve);return base(...args);};
 const run=stories=>matchLibraryStories(f.provider,f.cache,'shared-match','共同主题',stories,story=>f.books.resolve(f.book,story.source).text,50000,'codex');
 const a=run([f.stories[0]]);await until(()=>release);const b=run([f.stories[1]]);release();
 assert.deepEqual((await a).map(story=>story.title),['乌龟报恩']);assert.deepEqual((await b).map(story=>story.title),['勇士护民']);assert.equal(f.calls.matches.length,2);
 assert.equal(new Set(f.calls.matches.flatMap(call=>call.stories.map(themeStoryId=>themeStoryId.id))).size,2);
});

test('a completed summary receipt survives cancellation and no original review starts until a new request',async()=>{
 const f=libraryFixture(),controller=new AbortController();
 f.provider.matchStories=async(theme,stories)=>{f.calls.matches.push({theme,stories});controller.abort();return {matches:stories.map(story=>({id:story.id,verdict:'review',reason:'摘要不足，需核对原文。',summary:''}))};};
 await assert.rejects(f.run('核对主题',[],observer(controller)));assert.equal(f.calls.matches.length,1);assert.equal(f.calls.catalog.length,1);
 assert.ok(documents(f).some(doc=>doc.value.decisions?.[themeStoryId(f.stories[0])]?.verdict==='review'));
 f.provider.matchStories=async(theme,stories)=>{f.calls.matches.push({theme,stories});assert.ok(stories[0].text);return {matches:stories.map(story=>({id:story.id,verdict:'yes',reason:'原文事件与结果支持本次选题。',summary:story.summary}))};};
 assert.equal((await f.run('核对主题')).stories[0].title,'乌龟报恩');assert.equal(f.calls.matches.length,2);
});

test('one departing matching reader leaves another active and neither repeats the paid judgment',async()=>{
 const f=libraryFixture();await f.run('先收录');const base=f.provider.matchStories;let release;
 f.provider.matchStories=async(...args)=>{await new Promise(resolve=>release=resolve);return base(...args);};
 const one=new AbortController(),two=new AbortController(),a=f.run('共同主题',[],observer(one)),b=f.run('共同主题',[],observer(two));
 await until(()=>release);one.abort();await assert.rejects(a);release();assert.equal((await b).stories[0].title,'乌龟报恩');assert.equal(f.calls.matches.filter(call=>call.theme==='共同主题').length,1);
});

test('matching budget rejects paid work before dispatch and leaves already catalogued stories intact',async()=>{
 const f=libraryFixture();await f.run('先收录');const before=f.calls.matches.length;
 await assert.rejects(matchLibraryStories(f.provider,f.cache,'small-budget','主题',f.stories,story=>f.books.resolve(f.book,story.source).text,1,'codex'),/超过本次预算/);
 assert.equal(f.calls.matches.length,before);assert.equal(library(f).stories.length,1);
});

test('original review exceeding budget retains review state without truncating or dispatching its paid call',async()=>{
 const f=libraryFixture();f.control.decide=()=> 'review';
 await assert.rejects(matchLibraryStories(f.provider,f.cache,'review-budget','主题',[f.stories[0]],()=> '字'.repeat(16000),10000,'codex'),/超过本次预算/);
 assert.equal(f.calls.matches.length,1);assert.equal(f.calls.matches[0].stories[0].text,undefined);
 assert.ok(documents(f).some(doc=>doc.value.decisions?.[themeStoryId(f.stories[0])]?.verdict==='review'));
});

test('an all-negative theme stops at exhausted coverage, caches its negatives, and leaves stories for later themes',async()=>{
 const f=libraryFixture();f.control.decide=()=> 'no';assert.equal((await f.run('没有匹配')).stories.length,0);
 assert.equal(library(f).exhausted,true);assert.equal(library(f).stories.length,2);const scans=f.calls.catalog.length,matches=f.calls.matches.length;
 assert.equal((await f.run('没有匹配')).stories.length,0);assert.equal(f.calls.catalog.length,scans);assert.equal(f.calls.matches.length,matches);
 f.control.decide=()=> 'yes';assert.equal((await f.run('新主题')).stories.length,2);assert.equal(f.calls.catalog.length,scans);
});

test('a corrupt theme cache is rejudged without extracting the original again',async()=>{
 const f=libraryFixture();await f.run('主题');const doc=documents(f).find(item=>item.key.includes('/themes/'));
 await f.cache.write(doc.key,{decisions:{[themeStoryId(f.stories[0])]:'invented'}});const before=f.calls.matches.length;
 await f.run('主题');assert.equal(f.calls.catalog.length,1);assert.equal(f.calls.matches.length,before+1);
});

test('a failed verdict write surfaces failure, preserving the catalog for an explicit retry',async()=>{
 const f=libraryFixture(),write=f.cache.write.bind(f.cache);let fail=true;
 f.cache.write=async(key,value)=>{if(key.includes('/themes/')&&fail)throw Error('controlled verdict disk failure');return write(key,value);};
 await assert.rejects(f.run('主题'),/verdict disk/);assert.equal(library(f).stories.length,1);fail=false;
 assert.equal((await f.run('主题')).stories[0].title,'乌龟报恩');assert.equal(f.calls.catalog.length,1);
});

test('a changed extraction model or effort starts an isolated library while themes alone do not',async()=>{
 const f=libraryFixture();await f.run('主题甲');await f.run('主题乙');assert.equal(f.calls.catalog.length,1);
 f.control.model='other-model';await f.run('主题甲');assert.equal(f.calls.catalog.length,2);
 f.control.effort='high';await f.run('主题甲');assert.equal(f.calls.catalog.length,3);
 const changed={...f.book,edition:'b'.repeat(64)};assert.notEqual(discoveryNamespace(changed,'codex','mock'),discoveryNamespace(f.book,'codex','mock'));
});
