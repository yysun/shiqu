// Verify neutral discovery, durable independent verdicts, strict matching receipts and shared cancellation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryFixture,selection} from './fixtures/story-library.mjs';
import {StoryDiscoveryCache} from '../server/story-discovery-cache.ts';
import {discoverLocalStories,discoveryNamespace,legacySummaryDiscoveryNamespace} from '../server/local-story-discovery.ts';
import {matchLibraryStories,themeStoryId} from '../server/story-theme-matching.ts';
import {localSuggestionPayload} from '../lib/reader-local-contract.ts';
import {themeMatchPrompt,themeMatchJson,themeMatchPayload} from '../lib/reader-theme-match.ts';
import {readingTokens} from '../server/story-token-budget.ts';
import {previousReadingPlanKey} from '../server/story-discovery-legacy.ts';
import {until} from './fixtures/production-data.mjs';
const seedManifest=async f=>f.cache.write(previousReadingPlanKey(f.book,'codex')+'/blocks',{mode:'whole',blocks:[{ranges:f.book.sections.map(s=>({sectionId:s.id,firstUnit:s.units[0].id,lastUnit:s.units.at(-1).id})),tokens:100}]});
const observer=controller=>({signal:controller.signal,maxStories:1,drain:true,onProgress:()=>{}});
const documents=f=>[...f.store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes)));
const library=f=>documents(f).find(doc=>doc.key===discoveryNamespace(f.book,'codex',f.control.model,undefined,f.control.effort)+'/library').value;

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
 assert.equal(f.calls.matches[0].stories[0].text,f.books.resolve(f.book,f.stories[0].source).text);assert.equal(f.calls.matches[0].stories[0].summary,undefined);
});

test('every matching request reads the exact original on its first and only pass',async()=>{
 const f=libraryFixture();f.control.decide=(_theme,story)=>{assert.equal(story.text,f.books.resolve(f.book,f.stories[0].source).text);assert.equal(story.summary,undefined);return 'yes';};
 const result=await f.run('原文判断');assert.equal(result.stories[0].title,'乌龟报恩');assert.equal(f.calls.matches.length,1);
 assert.equal(result.stories[0].storyBrief,undefined);assert.ok(result.stories[0].matchReason);await f.run('原文判断');assert.equal(f.calls.matches.length,1);
});

test('obsolete review remains unknown, permits later originals, and can be retried manually after exhaustion',async()=>{
 const f=libraryFixture();f.control.decide=()=> 'review';const result=await f.run('不确定');
 assert.deepEqual(result.stories,[]);assert.match(result.note,/未能判断/);assert.equal(library(f).stories.length,2);
 const judgments=documents(f).filter(doc=>doc.value.decisions);assert.ok(judgments.every(doc=>Object.keys(doc.value.decisions).length===0));
 const before=f.calls.matches.length;f.control.decide=(_theme,story)=>{assert.ok(story.text);return 'yes';};
 assert.equal((await f.run('不确定')).stories[0].title,'乌龟报恩');assert.ok(f.calls.matches.length>before);assert.equal(f.calls.catalog.length,2);
});

test('a later provider failure preserves completed positive and negative receipts',async()=>{
 const f=libraryFixture();await f.run('收录');await f.run('收录',[f.stories[0].source]);const base=f.provider.matchStories;
 f.provider.matchStories=async(theme,stories)=>{if(stories.some(story=>story.title==='勇士护民'))throw Error('controlled match outage');return base(theme,stories);};
 const run=stories=>matchLibraryStories(f.provider,f.cache,'separate-batches','主题',stories,story=>f.books.resolve(f.book,story.source).text,50000,'codex');
 assert.equal((await run([f.stories[0]])).length,1);await assert.rejects(run([f.stories[1]]),/controlled match outage/);
 const before=f.calls.matches.length;assert.equal((await run([f.stories[0]])).length,1);assert.equal(f.calls.matches.length,before);
});

for(const kind of ['unknown','duplicate','missing'])test(`invalid ${kind} matching IDs preserve legal decisions and the catalog`,async()=>{
 const f=libraryFixture();await f.run('收录');await f.run('收录',[f.stories[0].source]);
 f.provider.matchStories=async(_theme,stories)=>({matches:kind==='unknown'?stories.map(story=>({id:'b'.repeat(64),verdict:'yes',reason:'符合'})):kind==='duplicate'?stories.flatMap(story=>[{id:story.id,verdict:'yes',reason:'符合'},{id:story.id,verdict:'no',reason:'冲突'}]):[{id:stories[0].id,verdict:'yes',reason:'符合'}]});
 const result=await f.run('坏结果');assert.equal(library(f).stories.length,2);
 if(kind==='missing')assert.equal(result.stories.length,1);else {assert.deepEqual(result.stories,[]);assert.match(result.note,/未能判断/);}
});

test('catalog and candidates contain no synopsis or production brief',async()=>{
 const f=libraryFixture(),result=await f.run();assert.equal(result.stories[0].summary,undefined);assert.equal(result.stories[0].storyBrief,undefined);
 assert.ok(library(f).stories.length);for(const story of library(f).stories){assert.equal(story.summary,undefined);assert.equal(story.storyBrief,undefined);}
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

test('a completed binary receipt survives cancellation and no next batch is dispatched',async()=>{
 const f=libraryFixture(),controller=new AbortController(),base=f.provider.matchStories;
 f.provider.matchStories=async(...args)=>{const result=await base(...args);controller.abort();return result;};
 await assert.rejects(f.run('核对主题',[],observer(controller)));assert.equal(f.calls.matches.length,1);assert.equal(f.calls.catalog.length,1);
 assert.ok(documents(f).some(doc=>doc.value.decisions?.[themeStoryId(f.stories[0])]?.verdict==='yes'));
 f.provider.matchStories=base;assert.equal((await f.run('核对主题')).stories[0].title,'乌龟报恩');assert.equal(f.calls.matches.length,1);
});

test('one departing matching reader leaves another active and neither repeats the paid judgment',async()=>{
 const f=libraryFixture();await f.run('先收录');const base=f.provider.matchStories;let release;
 f.provider.matchStories=async(...args)=>{await new Promise(resolve=>release=resolve);return base(...args);};
 const one=new AbortController(),two=new AbortController(),a=f.run('共同主题',[],observer(one)),b=f.run('共同主题',[],observer(two));
 await until(()=>release);one.abort();await assert.rejects(a);release();assert.equal((await b).stories[0].title,'乌龟报恩');assert.equal(f.calls.matches.filter(call=>call.theme==='共同主题').length,1);
});

test('matching budget rejects paid work before dispatch and leaves already catalogued stories intact',async()=>{
 const f=libraryFixture();await f.run('先收录');const before=f.calls.matches.length;
 assert.deepEqual(await matchLibraryStories(f.provider,f.cache,'small-budget','主题',f.stories,story=>f.books.resolve(f.book,story.source).text,1,'codex'),[]);
 assert.equal(f.calls.matches.length,before);assert.equal(library(f).stories.length,1);
});

test('a single oversized original fails before inference and never truncates or writes no',async()=>{
 const f=libraryFixture();assert.deepEqual(await matchLibraryStories(f.provider,f.cache,'raw-budget','主题',[f.stories[0]],()=> '字'.repeat(16000),10000,'codex'),[]);
 assert.equal(f.calls.matches.length,0);assert.ok(documents(f).filter(doc=>doc.value.decisions).every(doc=>Object.keys(doc.value.decisions).length===0));
});

test('input budget shrinks a batch while preserving every full original',async()=>{
 const f=libraryFixture();f.control.decide=(_theme,story)=>story.title==='勇士护民'?'yes':'no';
 const text=story=>f.books.resolve(f.book,story.source).text+'字'.repeat(100),input=f.stories.map(story=>({id:themeStoryId(story),title:story.title,text:text(story)}));
 const fixed=readingTokens(themeMatchPrompt)+readingTokens(JSON.stringify(themeMatchJson));
 const budget=Math.max(...input.map(story=>fixed+readingTokens(JSON.stringify(themeMatchPayload('主题',[story])))));
 const result=await matchLibraryStories(f.provider,f.cache,'sized-batch','主题',f.stories,text,budget,'codex');assert.equal(result[0].title,'勇士护民');
 assert.deepEqual(f.calls.matches.map(call=>call.stories.length),[1,1]);for(const call of f.calls.matches)assert.equal(call.stories[0].text,text(f.stories.find(story=>story.title===call.stories[0].title)));
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

test('old summary catalog resumes ranges and coverage without extraction or old theme verdicts',async()=>{
 const f=libraryFixture(),old=legacySummaryDiscoveryNamespace(f.book,'codex','mock',undefined,'medium');
 const state={stories:f.stories,cursor:1,readThrough:1,pendingEvents:[],exhausted:true,rejected:false};await seedManifest(f);await f.cache.write(old+'/library',state);
 const result=await f.run('勇气');assert.equal(result.stories[0].title,'勇士护民');assert.equal(f.calls.catalog.length,0);assert.equal(f.calls.matches.length,1);assert.equal(f.calls.matches[0].stories.length,2);
 assert.equal(library(f).cursor,1);assert.equal(library(f).exhausted,true);assert.ok(library(f).stories.every(story=>!('summary' in story)));
 const oldDocument=documents(f).find(doc=>doc.key===old+'/library');assert.deepEqual(oldDocument.value,state);
});

test('matching model and effort invalidate verdicts without invalidating extraction',async()=>{
 const f=libraryFixture();await f.run('同主题');const scans=f.calls.catalog.length,matches=f.calls.matches.length;
 f.control.matchModel='other-matcher';await f.run('同主题');assert.equal(f.calls.catalog.length,scans);assert.equal(f.calls.matches.length,matches+1);
 f.control.matchEffort='medium';await f.run('同主题');assert.equal(f.calls.catalog.length,scans);assert.equal(f.calls.matches.length,matches+2);
});

test('six originals are matched in bounded batches with reordered IDs and durable negative receipts',async()=>{
 const f=libraryFixture(),stories=Array.from({length:6},(_,i)=>({title:'故事'+i,source:{...f.stories[0].source,firstUnit:'u'+i,lastUnit:'u'+i}}));
 f.provider.matchStories=async(theme,input)=>{f.calls.matches.push({theme,stories:input});return {matches:[...input].reverse().map(story=>({id:story.id,verdict:'no',reason:'原文不支持主题。'}))};};
 const run=()=>matchLibraryStories(f.provider,f.cache,'six-binary','主题',stories,story=>'完整原文：'+story.title,50000,'codex');
 assert.deepEqual(await run(),[]);assert.deepEqual(f.calls.matches.map(call=>call.stories.length),[4,2]);
 assert.equal(new Set(f.calls.matches.flatMap(call=>call.stories.map(story=>story.id))).size,6);await run();assert.equal(f.calls.matches.length,2);
});

test('legacy pending ranges lose synopsis metadata and a failed upgrade write remains retryable',async()=>{
 const f=libraryFixture(),key=legacySummaryDiscoveryNamespace(f.book,'codex','mock',undefined,'medium')+'/library';
 const old={stories:[f.stories[0]],cursor:0,readThrough:0,pendingEvents:[{id:'pending',title:f.stories[1].title,summary:'尚未完结的旧摘要',source:f.stories[1].source}],exhausted:false,rejected:false};
 await seedManifest(f);await f.cache.write(key,old);const write=f.cache.write.bind(f.cache);let fail=true;
 f.cache.write=async(next,value)=>{if(next.endsWith('/library')&&next!==key&&fail)throw Error('controlled upgrade write');return write(next,value);};
 await assert.rejects(f.run('主题'),/controlled upgrade write/);assert.equal(f.calls.catalog.length,0);assert.equal(f.calls.matches.length,0);
 assert.deepEqual(documents(f).find(doc=>doc.key===key).value,old);fail=false;await f.run('主题');assert.equal(f.calls.catalog.length,0);
 assert.deepEqual(library(f).pendingEvents,[{id:'pending',title:f.stories[1].title,source:f.stories[1].source}]);
});

test('one-at-a-time presentation extracts a bounded larger batch after a cold miss and consumes the batch without re-reading',async()=>{
 const f=libraryFixture();
 for(let i=3;i<=5;i++){const unit={id:'u'+i,text:'勇士'+i+'面对猛虎仍然向前，保护村民并驱走猛虎，最后平安归来。',narrative:true};f.book.sections[0].units.push(unit);f.stories.push({title:'护民故事'+i,description:'人物面对危险作出选择。',source:{...f.stories[1].source,firstUnit:unit.id,lastUnit:unit.id}});}
 f.book.input.text='篇章 s1：第一章\n'+f.book.sections[0].units.map(unit=>'['+unit.id+']\n'+unit.text).join('\n\n');
 const control=new AbortController(),first=await f.run('勇气',[],observer(control));assert.equal(first.stories.length,1);assert.deepEqual(f.calls.catalog.map(call=>call.input.scan.maxStories),[1,32]);assert.deepEqual(f.calls.matches.map(call=>call.stories.length),[1,4]);
 const seen=[first.stories[0].source];for(let i=0;i<3;i++){const next=await f.run('勇气',seen,observer(control));assert.equal(next.stories.length,1);seen.push(next.stories[0].source);}
 assert.equal(f.calls.catalog.length,2);assert.equal(f.calls.matches.length,2);assert.equal(new Set(seen.map(source=>source.firstUnit)).size,4);
});
