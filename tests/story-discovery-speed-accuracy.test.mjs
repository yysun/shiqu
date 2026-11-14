// 通过小型合成原著验证缓存、匹配和恢复逻辑，真实原著的容量与迁移检查单独运行。
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {libraryFixture} from './fixtures/story-library.mjs';
import {discoveryNamespace} from '../server/local-story-discovery.ts';
const key=f=>discoveryNamespace(f.book,'codex','mock',undefined,'medium')+'/library';
const state=f=>({stories:f.stories,cursor:1,readThrough:1,pendingEvents:[],exhausted:true,rejected:false});
const read=async f=>f.cache.read(key(f),z.any());
test('a bad cached story or pending does not clear good stories or completed coverage',async()=>{
 const f=libraryFixture();await f.cache.write(key(f),{...state(f),stories:[f.stories[0],{...f.stories[1],source:{...f.stories[1].source,firstUnit:'missing'}}],pendingEvents:[{id:'bad',title:'失效',source:{...f.stories[0].source,firstUnit:'missing'}}]});
 const result=await f.run('知恩图报');assert.equal(result.stories[0].title,f.stories[0].title);assert.equal(f.calls.catalog.length,0);
 const saved=await read(f);assert.equal(saved.stories.length,1);assert.equal(saved.exhausted,true);assert.deepEqual(saved.pendingEvents,[]);
});
test('partial pending failure retains independent story and corrected receipt closes from cached evidence',async()=>{
 const f=libraryFixture(),event={id:'old',title:'旧事件',source:f.stories[0].source};
 await f.cache.write(key(f),{...state(f),stories:[],cursor:0,readThrough:0,exhausted:false,pendingEvents:[event]});let count=0;
 f.provider.suggestions=async()=>{count++;return {stories:count===1?[f.stories[0]]:[],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:count===1?['unknown']:['old']}};};
 const first=await f.run('知恩图报');assert.equal(first.stories.length,1);assert.equal((await read(f)).pendingEvents.length,1);assert.equal((await read(f)).cursor,0);
 await f.run('知恩图报',[f.stories[0].source]);const saved=await read(f);assert.equal(saved.pendingEvents.length,0);assert.equal(saved.stories.length,1);assert.equal(saved.exhausted,true);assert.equal(count,2);
});
test('all queued cache updates execute and merge latest state',async()=>{
 const f=libraryFixture(),schema=z.object({ids:z.array(z.number())});
 await Promise.all(Array.from({length:8},(_,id)=>f.cache.update('atomic',schema,()=>({ids:[]}),value=>({ids:[...value.ids,id]}))));
 assert.deepEqual((await f.cache.read('atomic',schema)).ids,[0,1,2,3,4,5,6,7]);
});

import {matchLibraryStories,hasUnknownJudgments} from '../server/story-theme-matching.ts';
import {DiscoveryFailure,discoveryCall} from '../lib/reader-discovery-call.ts';
import {until} from './fixtures/production-data.mjs';
import {StoryDiscoveryCache,discoveryHash} from '../server/story-discovery-cache.ts';
function many(count=16){const f=libraryFixture();f.stories.splice(0);f.book.sections[0].units.splice(0);for(let i=0;i<count;i++){const unit={id:'u'+i,text:'人物'+i+'面对困境，作出选择，经过行动终于解决问题并平安归来。',narrative:true};f.book.sections[0].units.push(unit);f.stories.push({title:'故事'+i,description:'一场有起因、行动和结果的事件。',source:{edition:f.book.edition,sectionId:'s1',firstUnit:unit.id,lastUnit:unit.id}});}f.book.input.text='篇章 s1：第一章\n'+f.book.sections[0].units.map(u=>'['+u.id+']\n'+u.text).join('\n\n');return f;}
const observe=cycleId=>({cycleId,signal:new AbortController().signal,onProgress:()=>{},drain:true});
const matching=(f,observer,cache=f.cache)=>matchLibraryStories(f.provider,cache,'isolated','主题',f.stories,s=>f.books.resolve(f.book,s.source).text,50000,'codex',observer,{bookId:f.book.id,retryUnknown:true});
test('one persistent story failure is isolated once and later matching stories remain reachable',async()=>{
 const f=many(16),calls=[];f.provider.matchStories=async(_theme,input)=>{calls.push(input.map(s=>s.title));if(input.some(s=>s.title==='故事0'))throw new DiscoveryFailure('refused');return {matches:input.map(s=>({id:s.id,verdict:s.title==='故事15'?'yes':'no',reason:'受控原文依据。'}))};};
 const result=await matching(f,observe('failure-once'));assert.equal(result[0].title,'故事15');await until(()=>calls.filter(c=>c.length===1).length>=1);
 assert.ok(calls.filter(c=>c.length===1).length<=4);assert.equal(calls.filter(c=>c.length===1&&c[0]==='故事0').length,1);
 assert.equal(await hasUnknownJudgments(f.provider,f.cache,f.book.id,'主题',f.stories,'codex'),true);
});
test('isolation budget survives repeated requests and cache recreation in the same cycle',async()=>{
 const f=many(40);let calls=0,singles=0;f.provider.matchStories=async(_theme,input,context)=>{calls++;if(context?.isolation)singles++;throw new DiscoveryFailure('refused');};
 assert.deepEqual(await matching(f,observe('budget-cycle')),[]);assert.equal(singles,8);const before=calls;
 assert.deepEqual(await matching(f,observe('budget-cycle'),new StoryDiscoveryCache(f.store)),[]);assert.equal(calls,before);
 assert.deepEqual(await matching(f,observe('fresh-cycle')),[]);assert.equal(singles,16);
});
test('a later matching batch returns before two pending batches, then both pending receipts save',async()=>{
 const f=many(16),gates=[];f.provider.matchStories=async(_theme,input)=>{await new Promise(resolve=>gates.push({input,resolve}));return {matches:input.map(s=>({id:s.id,verdict:s.title==='故事8'?'yes':'no',reason:'受控依据。'}))};};
 const pending=matching(f,observe('parallel'));await until(()=>gates.length===3);gates[2].resolve();const result=await pending;assert.equal(result[0].title,'故事8');assert.equal(gates.length,3);
 gates[0].resolve();gates[1].resolve();await until(()=>[...f.store.values.values()].some(bytes=>{const doc=JSON.parse(new TextDecoder().decode(bytes));return doc.value.decisions&&Object.keys(doc.value.decisions).length===12;}));assert.equal(gates.length,3);
});
test('service failures stop dispatch instead of being isolated or cached as no',async()=>{
 const f=many(40);let calls=0;f.provider.matchStories=async()=>{calls++;throw new TypeError('private network details');};
 await assert.rejects(matching(f,observe('outage')),/private network/);await new Promise(resolve=>setImmediate(resolve));assert.ok(calls<=3);
 assert.equal(await hasUnknownJudgments(f.provider,f.cache,f.book.id,'主题',f.stories,'codex'),false);
});
test('matching cache is shared across scope and extraction identity but checks original content',async()=>{
 const f=many(4);let calls=0;f.provider.matchStories=async(_theme,input)=>{calls++;return {matches:input.map(s=>({id:s.id,verdict:'yes',reason:'原文依据。'}))};};
 await matching(f,observe('scope-a'));const before=calls;await matchLibraryStories(f.provider,f.cache,'other-extractor','主题',f.stories,s=>f.books.resolve(f.book,s.source).text,50000,'codex',observe('scope-b'),{bookId:f.book.id});assert.equal(calls,before);
 f.book.sections[0].units[0].text+='原文内容已经改变。';await matching(f,observe('changed-original'));assert.equal(calls,before,'other cached positive stories can return without judging the changed one');
 await matchLibraryStories(f.provider,f.cache,'another','主题',[f.stories[0]],s=>f.books.resolve(f.book,s.source).text,50000,'codex',observe('changed-only'),{bookId:f.book.id});assert.equal(calls,before+1);
});

import {previousReadingPlanKey,previousDiscoveryNamespace} from '../server/story-discovery-legacy.ts';
import {legacyThemeDecisionKey,legacyThemeStoryId} from '../server/story-theme-matching.ts';

test('arbitrary old theme receipts migrate from frozen keys without repeating paid judgments',async()=>{
 const f=libraryFixture(),old=previousDiscoveryNamespace(f.book,'codex','mock',undefined,'medium'),theme='fixture之外的任意主题';
 await f.cache.write(previousReadingPlanKey(f.book,'codex')+'/blocks',{mode:'whole',blocks:[{ranges:[{sectionId:'s1',firstUnit:'u1',lastUnit:'u2'}],tokens:100}]});await f.cache.write(old+'/library',state(f));
 const decisions=Object.fromEntries(f.stories.map(s=>[legacyThemeStoryId(s),{id:legacyThemeStoryId(s),verdict:'yes',reason:'旧原文判断。'}]));await f.cache.write(legacyThemeDecisionKey(old,theme,{model:'mock-match',reasoningEffort:'low'}),{decisions});const before=[...f.store.values.values()].map(bytes=>bytes.slice());
 assert.equal((await f.run(theme)).stories.length,2);assert.equal(f.calls.catalog.length,0);assert.equal(f.calls.matches.length,0);assert.ok(before.every(bytes=>[...f.store.values.values()].some(current=>Buffer.compare(bytes,current)===0)));
});
test('invalid extraction ranges never advance even when a model claims block completion',async()=>{
 const f=libraryFixture();f.provider.suggestions=async()=>({stories:[{...f.stories[0],source:{...f.stories[0].source,firstUnit:'unknown'}}],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}});await assert.rejects(f.run('原典'),/原文范围/);assert.equal((await read(f)).cursor,0);
});
test('high overlap is diagnostic; a distinct complete event with new evidence remains usable',async()=>{
 const f=many(12),first={...f.stories[0],source:{...f.stories[0].source,lastUnit:'u9'}},second={...f.stories[1],source:{...f.stories[1].source,firstUnit:'u1',lastUnit:'u10'}};await f.cache.write(key(f),{...state(f),stories:[first],cursor:0,readThrough:0,exhausted:false});
 f.provider.matchStories=async(_theme,entries)=>({matches:entries.map(s=>({id:s.id,verdict:s.title===second.title?'yes':'no',reason:'独立完整事件。'}))});f.provider.suggestions=async()=>({stories:[second],note:'',scan:{blockComplete:false,pendingEvents:[],resolvedEventIds:[]}});
 const result=await f.run('主题');assert.equal(result.stories[0].title,second.title);assert.equal((await read(f)).overlapDiagnostics[0].ratio,.9);
});

test('nine stories need two actual extraction calls; a full receipt cannot falsely complete its block',async()=>{
 const f=many(9);f.control.decide=()=> 'no';await f.run('完整检查');assert.equal(f.calls.catalog.length,2);assert.equal((await read(f)).stories.length,9);
 const g=many(33),original=g.provider.suggestions;g.control.decide=()=> 'no';g.provider.suggestions=async(...args)=>{const result=await original(...args);if(args[2].scan.maxStories>1)result.scan.blockComplete=true;return result;};await g.run('完整检查');assert.equal(g.calls.catalog.length,3);assert.equal((await read(g)).stories.length,33);
});

test('an isolation service failure prevents queued batches from starting',async()=>{
 const f=many(24),held=[],calls=[];f.provider.matchStories=async(_theme,input,context)=>{calls.push(input[0].title);if(context?.isolation)throw new TypeError('service down');if(input[0].title==='故事0')return {matches:[]};await new Promise(resolve=>held.push(resolve));return {matches:input.map(s=>({id:s.id,verdict:'no',reason:'受控依据。'}))};};
 await assert.rejects(matching(f,observe('isolation-outage')),/service down/);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls.sort(),['故事0','故事0','故事4','故事8'].sort());held.forEach(resolve=>resolve());await f.cache.settle();
});
test('changed matching identity cannot reuse an isolation budget charge in the same cycle',async()=>{
 const f=many(8);let singles=0;f.provider.matchStories=async(_theme,_input,context)=>{if(context?.isolation)singles++;throw new DiscoveryFailure('refused');};await matching(f,observe('identity-budget'));assert.equal(singles,8);
 const oldStatus=f.provider.status;f.provider.status=async()=>({...await oldStatus(),themeMatching:{model:'different-model',reasoningEffort:'low'}});await matching(f,observe('identity-budget'));assert.equal(singles,8);
});
test('invalid pending syntax retains independent stories and the prior cursor and pending event',async()=>{
 const f=libraryFixture(),event={id:'old',title:'旧事件',source:f.stories[0].source};await f.cache.write(key(f),{...state(f),stories:[],cursor:0,readThrough:0,exhausted:false,pendingEvents:[event]});
 f.provider.suggestions=async()=>({stories:[f.stories[1]],note:'',scan:{blockComplete:false,pendingEvents:[],resolvedEventIds:[],invalid:true}});const result=await f.run('勇气');assert.equal(result.stories.length,1);const saved=await read(f);assert.equal(saved.cursor,0);assert.deepEqual(saved.pendingEvents,[event]);assert.equal(saved.stories[0].title,f.stories[1].title);
});
test('a known service outage closes other active queries using the same matching service',async()=>{
 const f=many(4);const rejects=[];let started=0;f.provider.matchStories=async()=>{started++;return new Promise((_resolve,reject)=>{rejects.push(reject);});};
 const first=matching(f,observe('service-reader-a'));await until(()=>started===1);
 const second=matchLibraryStories(f.provider,f.cache,'isolated','另一主题',f.stories,s=>f.books.resolve(f.book,s.source).text,50000,'codex',observe('service-reader-b'),{bookId:f.book.id});await until(()=>started===2);
 // Both already-started calls may settle; the service error closes both active queries.
 rejects[1](new TypeError('service cohort down'));await Promise.all([assert.rejects(first,/service cohort/),assert.rejects(second,/service cohort/)]);rejects[0](new TypeError('service cohort down'));await new Promise(resolve=>setImmediate(resolve));
});

test('joined matching cycles each retain one receipt after the initiating reader leaves',async()=>{
 const f=many(4),a=[],b=[],controller=new AbortController();let release,started=false;
 f.provider.matchStories=(_theme,input,context)=>discoveryCall({stage:'matching',provider:'controlled',model:'fixture',effort:'none',requestedCount:input.length},context,async report=>{started=true;await new Promise(resolve=>{release=resolve;});report({acceptedCount:input.length,usage:{input_tokens:11,output_tokens:5}});return {matches:input.map(s=>({id:s.id,verdict:'no',reason:'受控依据。'}))};});
 const first=matching(f,{...observe('receipt-a'),signal:controller.signal,onCall:e=>a.push(e)});await until(()=>started);const second=matching(f,{...observe('receipt-b'),onCall:e=>b.push(e)});await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(first);release();await second;
 assert.equal(a.length,1);assert.equal(b.length,1);assert.equal(a[0].id,b[0].id);
});

test('a cycle starting with an unshown cached yes cannot retry old unknowns after that yes is shown',async()=>{
 const f=many(2);let calls=0;f.provider.matchStories=async(_theme,input)=>{calls++;return {matches:input.filter(s=>s.title==='故事1').map(s=>({id:s.id,verdict:'yes',reason:'受控依据。'}))};};
 await matching(f,observe('retry-a'));const before=calls;assert.equal((await matching(f,observe('retry-b')))[0].title,'故事1');assert.equal(calls,before);
 const request=cycle=>matchLibraryStories(f.provider,f.cache,'isolated','主题',[f.stories[0]],s=>f.books.resolve(f.book,s.source).text,50000,'codex',observe(cycle),{bookId:f.book.id,retryUnknown:true});await request('retry-b');assert.equal(calls,before);await request('retry-c');assert.equal(calls,before+2);
});

test('only cycles with reserved isolation credit receive a shared isolation cost receipt',async()=>{
 const f=many(4),funded=[],exhausted=[];let release,started=false;
 await f.cache.write('discovery-cycle/'+discoveryHash('no-credit'),{calls:Object.fromEntries(Array.from({length:8},(_,i)=>['spent-'+i,true])),retried:{},retryAllowed:true});
 f.provider.matchStories=(_theme,input,context)=>discoveryCall({stage:'matching',provider:'controlled',model:'fixture',effort:'none',requestedCount:input.length},context,async()=>{if(!context.isolation){started=true;await new Promise(resolve=>{release=resolve;});}throw new DiscoveryFailure('refused');});
 const first=matching(f,{...observe('has-credit'),onCall:e=>funded.push(e)});await until(()=>started);const second=matching(f,{...observe('no-credit'),onCall:e=>exhausted.push(e)});await new Promise(resolve=>setImmediate(resolve));release();await Promise.all([first,second]);assert.equal(funded.filter(e=>e.isolation).length,4);assert.equal(exhausted.filter(e=>e.isolation).length,0);assert.equal(exhausted.length,1);
});
test('valid old neutral records survive a missing manifest without claiming old coverage',async()=>{
 const f=libraryFixture(),old=previousDiscoveryNamespace(f.book,'codex','mock',undefined,'medium'),pending={id:'still-open',title:'未完旁线',source:f.stories[1].source};await f.cache.write(old+'/library',{...state(f),pendingEvents:[pending]});const bytes=[...f.store.values.values()][0].slice();
 const result=await f.run('知恩图报');assert.equal(result.stories[0].title,f.stories[0].title);assert.equal(f.calls.catalog.length,0);const saved=await read(f);assert.equal(saved.cursor,0);assert.equal(saved.exhausted,false);assert.equal(saved.stories.length,2);assert.deepEqual(saved.pendingEvents,[pending]);assert.ok([...f.store.values.values()].some(value=>Buffer.compare(value,bytes)===0));
});
