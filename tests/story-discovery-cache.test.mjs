// Exercise on-demand reading, durable boundaries, cross-chapter evidence, and shared cancellation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalBooks} from '../server/local-books.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {StoryDiscoveryCache} from '../server/story-discovery-cache.ts';
import {discoverLocalStories,discoveryNamespace} from '../server/local-story-discovery.ts';
import {readingPlan,buildReadingPlan,hydrateReadingPlan} from '../server/story-reading-inputs.ts';
import {FileMedia} from '../server/media.ts';
import {createApplication} from '../server/app.ts';
import {localSourceKey} from '../lib/reader-local-contract.ts';

const selection={bookId:'zhuangzi',theme:'给我一个反转',artStyle:'ink-pencil',length:8,voice:false,productionPrompt:''};
const memory=()=>{const values=new Map();return {values,get:async key=>{const bytes=values.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},put:async(key,bytes)=>{values.set(key,new Uint8Array(bytes));}};};
const limits={whole:5000,chapter:1500};
const state=(complete=true,pendingEvents=[],resolvedEventIds=[])=>({blockComplete:complete,pendingEvents,resolvedEventIds});
function fixture(chapters=2,units=10,size=80){
 const sections=Array.from({length:chapters},(_,i)=>({id:'chapter-'+i,title:'第'+(i+1)+'回',units:Array.from({length:units},(_,j)=>({id:'unit-'+i+'-'+String(j).padStart(3,'0'),text:'人物经历变故之后，才终于得知真相。'+'字'.repeat(size),narrative:true}))}));
 const book={id:'zhuangzi',title:'测试书',edition:'a'.repeat(64),url:'https://example.org/original',provider:'测试原文',sections,input:{title:'测试书',edition:'a'.repeat(64),text:sections.map(s=>'篇章 '+s.id+'：'+s.title+'\n'+s.units.map(u=>'['+u.id+']\n'+u.text).join('\n\n')).join('\n\n')}};
 const books=new LocalBooks(process.cwd());books.book=async()=>book;
 const stories=sections.flatMap(s=>s.units.map((u,i)=>({title:s.id+'故事'+i,description:'一次变故，让人物重新认识事情的真相。',summary:'人物经历事件、作出行动，事情得到完整结果。',source:{edition:book.edition,sectionId:s.id,firstUnit:u.id,lastUnit:u.id}})));
 const calls=[];
 const provider={status:async()=>({configured:true,provider:'codex',models:{text:'mock',image:'mock'},voiceEnabled:false}),matchStories:async(_theme,stories)=>({matches:stories.map(story=>({id:story.id,verdict:'yes'}))}),safeError:()=> '模拟错误',generator:()=>({}),suggestions:async(s,excluded,input)=>{
  calls.push({selection:s,excluded,input});
  const known=new Set(input.scan.excludedSources.map(localSourceKey));
  const available=stories.filter(story=>input.text.includes('['+story.source.firstUnit+']')&&!known.has(localSourceKey(story.source)));
  return {stories:available.slice(0,input.scan.maxStories),note:'',scan:state(available.length<input.scan.maxStories)};
 }};
 return {book,books,stories,calls,provider};
}
async function until(condition){for(let i=0;!condition();i++){assert.ok(i<1000,'operation did not settle');await new Promise(resolve=>setTimeout(resolve,1));}}
function run(f,cache,excluded=[],observer,seen=[],budget){return discoverLocalStories(f.provider,f.books,cache,f.book,selection,excluded,observer,seen,budget);}
test('continuous discovery returns one cached story at a time and then scans only one new story',async()=>{
 const f=fixture(),store=memory(),cache=new StoryDiscoveryCache(store),first=await run(f,cache);
 const seed=await run(f,cache,[],undefined,first.stories.map(s=>s.source));assert.equal(seed.stories.length,5);
 const observer={signal:new AbortController().signal,maxStories:1,onProgress:()=>{}},seen=first.stories.map(s=>s.source);
 for(const expected of seed.stories){
  const batch=await run(f,new StoryDiscoveryCache(store),[],observer,seen);
  assert.equal(batch.stories.length,1);assert.equal(batch.stories[0].title,expected.title);seen.push(batch.stories[0].source);
 }
 assert.equal(f.calls.length,2,'A five-story cache is consumed without new inference');
 const next=await run(f,cache,[],observer,seen);assert.equal(next.stories.length,1);assert.equal(f.calls.length,3);assert.equal(f.calls.at(-1).input.scan.maxStories,1);
});
test('suggestion effort isolates cached progress and unrelated review effort preserves cache hits',async()=>{
 const f=fixture(),cache=new StoryDiscoveryCache(memory()),base=f.provider.status;
 let suggest='medium',review='high';
 f.provider.status=async()=>({...await base(),taskReasoningEfforts:{suggest,review}});
 await run(f,cache);assert.equal(f.calls.length,1);
 review='xhigh';await run(f,cache);assert.equal(f.calls.length,1);
 suggest='high';await run(f,cache);assert.equal(f.calls.length,2);
 suggest='medium';await run(f,cache);assert.equal(f.calls.length,2);
});
test('old caches without effort are not migrated into a newly configured effort namespace',async()=>{
 const f=fixture(),cache=new StoryDiscoveryCache(memory()),base=f.provider.status;
 await run(f,cache);assert.equal(f.calls.length,1);
 f.provider.status=async()=>({...await base(),taskReasoningEfforts:{suggest:'medium'}});
 await run(f,cache);assert.equal(f.calls.length,2);
});
test('whole book first selects one, then five on demand; hot hits and a new cache instance make no model calls',async()=>{
 const f=fixture(),store=memory(),cache=new StoryDiscoveryCache(store);
 const first=await run(f,cache);assert.equal(first.stories.length,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].input.scan.maxStories,1);
 assert.equal(f.calls[0].input.purpose,'catalog');assert.equal(f.calls[0].selection.theme,'');assert.equal(f.calls[0].input.text,f.book.input.text);
 assert.match((await run(f,new StoryDiscoveryCache(store))).note,/缓存/);assert.equal(f.calls.length,1);
 const next=await run(f,cache,first.stories.map(s=>s.title),undefined,first.stories.map(s=>s.source));
 assert.equal(next.stories.length,5);assert.equal(f.calls.length,2);
 assert.ok(next.stories.every(s=>!first.stories.some(old=>localSourceKey(old.source)===localSourceKey(s.source))));
});
test('chapter mode returns one first and resumes the same block before advancing',async()=>{
 const f=fixture(8,12,80),cache=new StoryDiscoveryCache(memory()),events=[];
 const first=await run(f,cache,[],{signal:new AbortController().signal,onProgress:p=>events.push(p)},[],limits);
 assert.equal(first.stories.length,1);assert.equal(f.calls.length,1);const firstText=f.calls[0].input.text;
 assert.equal(events.at(-1).completedChars,0);assert.equal(events[0].currentChapters.length,1);assert.ok(events.some(event=>event.stage==='checking'));
 const next=await run(f,cache,first.stories.map(s=>s.title),undefined,first.stories.map(s=>s.source),limits);
 assert.equal(next.stories.length,5);assert.equal(f.calls.length,2);assert.equal(f.calls[1].input.text,firstText);
});
test('a partial chapter batch returns immediately, survives restart, and continues only after its sources are excluded',async()=>{
 const f=fixture(8,4,200),store=memory(),cache=new StoryDiscoveryCache(store);
 const first=await run(f,cache,[],undefined,[],limits);
 assert.equal(first.stories.length,1);assert.equal(f.calls.length,1);
 const repeat=await run(f,new StoryDiscoveryCache(store),[],undefined,[],limits);
 assert.deepEqual(repeat.stories,first.stories);assert.match(repeat.note,/缓存/);assert.equal(f.calls.length,1);
 const next=await run(f,cache,[],undefined,first.stories.map(story=>story.source),limits);
 assert.equal(next.stories.length,3);assert.equal(f.calls.length,2);
 assert.equal(f.calls[0].input.text,f.calls[1].input.text);
 assert.ok(next.stories.every(story=>!first.stories.some(old=>localSourceKey(old.source)===localSourceKey(story.source))));
});
test('a single story ends scanning without marking an unfinished block exhausted',async()=>{
 const f=fixture(8,4,200),store=memory(),cache=new StoryDiscoveryCache(store),raw=f.provider.suggestions;
 f.provider.suggestions=async(...args)=>({...await raw(...args),stories:[f.stories[0]],scan:state(false)});
 const first=await run(f,cache,[],undefined,[],limits);
 assert.equal(first.stories.length,1);assert.equal(f.calls.length,1);
 const saved=[...store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes))).find(d=>d.value.pendingEvents).value;
 assert.equal(saved.cursor,0);assert.equal(saved.exhausted,false);
 f.provider.suggestions=raw;
 const next=await run(f,cache,[],undefined,first.stories.map(story=>story.source),limits);
 assert.equal(next.stories.length,3);assert.equal(f.calls.length,2);assert.equal(f.calls[0].input.text,f.calls[1].input.text);
});
test('reading manifests contain references only, persist across themes and reject corrupt coverage',async()=>{
 const f=fixture(8,12,80),store=memory(),cache=new StoryDiscoveryCache(store);
 const plan=await readingPlan(f.book,'codex',cache,limits);assert.ok(plan.blocks.length>1);
 const saved=JSON.parse(new TextDecoder().decode([...store.values.values()][0]));
 assert.equal(saved.value.blocks[0].text,undefined);assert.ok(saved.value.blocks[0].tokens>0);
 assert.deepEqual((await readingPlan(f.book,'codex',new StoryDiscoveryCache(store),limits)).manifest,plan.manifest);
 const broken=structuredClone(plan.manifest);broken.blocks.pop();assert.throws(()=>hydrateReadingPlan(f.book,broken));
 saved.value=broken;store.values.set([...store.values.keys()][0],new TextEncoder().encode(JSON.stringify(saved)));
 assert.deepEqual((await readingPlan(f.book,'codex',cache,limits)).manifest,plan.manifest);
 const all=new Set(plan.blocks.flatMap(b=>[...b.visible]));assert.equal(all.size,f.book.sections.flatMap(s=>s.units).length);
 const long=fixture(1,100,100);const manifest=buildReadingPlan(long.book,'codex',limits);assert.ok(manifest.blocks.length>1);assert.equal(hydrateReadingPlan(long.book,manifest).flatMap(b=>[...b.visible]).length,100);
});
test('cross-chapter pending survives omission, accumulates evidence, and only a covering complete story consumes it',async()=>{
 const f=fixture(8,4,200),store=memory(),cache=new StoryDiscoveryCache(store);let eventId;
 const first=f.stories[0].source,second=f.stories[4].source,third=f.stories[12].source;
 const combined={...first,continuations:[{sectionId:second.sectionId,firstUnit:second.firstUnit,lastUnit:second.lastUnit},{sectionId:third.sectionId,firstUnit:third.firstUnit,lastUnit:third.lastUnit}]};
 f.provider.suggestions=async(s,e,input)=>{
  f.calls.push(input);
  if(f.calls.length===1)return {stories:[],note:'',scan:state(true,[{id:'',title:'未完事件',summary:'人物出发，尚未揭晓结果。',source:first}])};
  if(f.calls.length===2){eventId=input.scan.pendingEvents[0].id;assert.ok(input.scan.contextText.includes('['+first.firstUnit+']'));return {stories:[],note:'',scan:state(true,[{id:eventId,title:'未完事件',summary:'人物继续前行，仍未得知结果。',source:second}])};}
  if(f.calls.length===3)return {stories:[],note:'',scan:state(true)};
  if(f.calls.length>=5)return {stories:[],note:'',scan:state(false)};
  assert.equal(input.scan.pendingEvents[0].id,eventId);
  assert.equal(input.scan.pendingEvents[0].source.continuations[0].sectionId,second.sectionId);
  assert.ok(input.scan.contextText.includes('['+second.firstUnit+']'));
  assert.ok(input.scan.contextText.includes('['+first.firstUnit+']'));
  return {stories:[{title:'跨章完整事件',description:'出发之后，一次相逢改变了他的选择。',summary:'人物经历事件、作出行动，事情得到完整结果。',source:combined}],note:'',scan:state(false,[],[eventId])};
 };
 const batch=await run(f,cache,[],undefined,[],limits);
 assert.equal(batch.stories[0].source.continuations[1].sectionId,third.sectionId);
 assert.equal(f.calls.length,4); // Return the completed story without scanning another chapter to fill the page.
 const original=f.books.resolve(f.book,batch.stories[0].source);
 assert.ok(original.text.includes('第1回')&&original.text.includes('第4回'));
 const documents=[...store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes)));
 const saved=documents.find(d=>d.value.pendingEvents);assert.deepEqual(saved.value.pendingEvents,[]);
});
test('a zero-result explicitly complete block advances; an unfinished no-progress response fails without skipping',async()=>{
 const f=fixture(8,4,200),store=memory(),cache=new StoryDiscoveryCache(store);
 f.provider.suggestions=async(s,e,input)=>{f.calls.push(input);return {stories:[],note:'',scan:state(f.calls.length===1)};};
 await assert.rejects(run(f,cache,[],undefined,[],limits),/保留进度/);assert.equal(f.calls.length,2);
 const documents=[...store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes)));
 const saved=documents.find(d=>d.value.pendingEvents);assert.equal(saved.value.cursor,1);
 await assert.rejects(run(f,cache,[],undefined,[],limits),/保留进度/);assert.equal(f.calls[1].text,f.calls[2].text);
});
test('fake event consumption and merged pending overflow keep the previous cursor and events',async()=>{
 for(const mode of ['consume','overflow']){
  const f=mode==='overflow'?fixture(40,20,20):fixture(8,4,200),store=memory(),cache=new StoryDiscoveryCache(store),first=f.stories[0].source;
  const initial=mode==='overflow'?f.stories.slice(0,15).map((story,i)=>({id:'',title:'未完'+i,summary:'人物尚未回来。',source:story.source})):[{id:'',title:'未完',summary:'人物尚未回来。',source:first}];
  f.provider.suggestions=async(s,e,input)=>{f.calls.push(input);if(f.calls.length===1)return {stories:[],note:'',scan:state(true,initial)};
   if(mode==='consume')return {stories:[f.stories[4]],note:'',scan:state(true,[],[input.scan.pendingEvents[0].id])};
   return {stories:[],note:'',scan:state(true,f.stories.slice(20,22).map((story,i)=>({id:'',title:'新事件'+i,summary:'事件仍在进行。',source:story.source})))};
  };
  await assert.rejects(run(f,cache,[],undefined,[],mode==='overflow'?{whole:15000,chapter:1500}:limits));
  const documents=[...store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes)));
  const saved=documents.find(d=>d.value.pendingEvents);assert.equal(saved.value.cursor,1);assert.equal(saved.value.pendingEvents.length,initial.length);
 }
});
test('another theme reuses the neutral library while presentation changes reuse its matching cache',async()=>{
 const f=fixture(),store=memory(),wrapped=withLocalBooks(f.provider,f.books,store);
 const first=await wrapped.suggestions(selection,[]);await wrapped.suggestions({...selection,artStyle:'watercolor',length:12},[]);assert.equal(f.calls.length,1);
 await wrapped.suggestions({...selection,theme:'人情冷暖'},[]);assert.equal(f.calls.length,1);assert.ok(f.calls.every(c=>c.input.purpose==='catalog'&&c.selection.theme===''));
 const changed={...f.book,edition:'b'.repeat(64)};assert.notEqual(discoveryNamespace(changed,'codex','mock'),discoveryNamespace(f.book,'codex','mock'));
 assert.notEqual(discoveryNamespace(f.book,'codex','mock2'),discoveryNamespace(f.book,'codex','mock'));
 assert.equal(first.stories.length,1);
});
test('a consumed event cannot be resurrected by returning the same source as a new empty-id pending',async()=>{
 const f=fixture(8,4,200),store=memory(),cache=new StoryDiscoveryCache(store),first=f.stories[0].source;let calls=0;
 f.provider.suggestions=async(s,e,input)=>{calls++;if(calls===1)return {stories:[],note:'',scan:state(true,[{id:'',title:'未完事件',summary:'事情还未结束。',source:first}])};
  const later=f.stories[4].source,complete={...first,continuations:[{sectionId:later.sectionId,firstUnit:later.firstUnit,lastUnit:later.lastUnit}]};
  return {stories:[{title:'完整故事',description:'人物终于看到了结果。',summary:'人物经历事件、作出行动，事情得到完整结果。',source:complete}],note:'',scan:state(true,[{id:'',title:'未完事件',summary:'仍未结束。',source:first}],[input.scan.pendingEvents[0].id])};
 };
 await assert.rejects(run(f,cache,[],undefined,[],limits));
 const documents=[...store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes))),saved=documents.find(d=>d.value.pendingEvents);
 assert.equal(saved.value.cursor,1);assert.equal(saved.value.pendingEvents.length,1);assert.equal(saved.value.stories.length,0);
});
test('concurrent requests share one expansion; one reader cancelling does not cancel the other',async()=>{
 const f=fixture(),cache=new StoryDiscoveryCache(memory()),raw=f.provider.suggestions;let release;
 const gate=new Promise(resolve=>{release=resolve;});f.provider.suggestions=async(...args)=>{await gate;return raw(...args);};
 const one=new AbortController(),two=new AbortController();
 const a=run(f,cache,[],{signal:one.signal,onProgress:()=>{}}),b=run(f,cache,[],{signal:two.signal,onProgress:()=>{}});
 await new Promise(resolve=>setTimeout(resolve,10));one.abort();await assert.rejects(a);release();assert.equal((await b).stories.length,1);assert.equal(f.calls.length,1);
});
test('all readers cancelling still saves the finished call and does not dispatch another block',async()=>{
 const f=fixture(8,4,200),store=memory(),cache=new StoryDiscoveryCache(store),raw=f.provider.suggestions;let release,started=false;
 const gate=new Promise(resolve=>{release=resolve;});f.provider.suggestions=async(...args)=>{started=true;await gate;return raw(...args);};
 const abort=new AbortController(),request=run(f,cache,[],{signal:abort.signal,onProgress:()=>{}},[],limits);
 await until(()=>started);abort.abort();await assert.rejects(request);release();await until(()=>f.calls.length===1);await new Promise(resolve=>setTimeout(resolve,10));
 const again=await run(f,new StoryDiscoveryCache(store),[],undefined,[],limits);assert.equal(again.stories.length,1);assert.equal(f.calls.length,1);assert.ok(again.stories.every(story=>story.source.sectionId==='chapter-0'));
});
test('a second reader gets unseen stories from a shared expansion without waiting to fill five',async()=>{
 const f=fixture(),cache=new StoryDiscoveryCache(memory()),raw=f.provider.suggestions;let release,started=false;
 const seed=await run(f,cache),seen=seed.stories.map(story=>story.source);
 const gate=new Promise(resolve=>{release=resolve;});f.provider.suggestions=async(...args)=>{if(!started){started=true;await gate;}return raw(...args);};
 const first=run(f,cache,[],undefined,seen);await until(()=>started);
 const second=run(f,cache,[],undefined,f.stories.slice(0,4).map(story=>story.source));release();
 const early=await first;assert.ok(early.stories.length>=1&&early.stories.length<=5);assert.ok(early.stories.every(story=>!seen.some(old=>localSourceKey(old)===localSourceKey(story.source))));const batch=await second;
 assert.equal(batch.stories.length,2);assert.equal(f.calls.length,2);
 assert.ok(batch.stories.every(story=>!f.stories.slice(0,3).some(old=>localSourceKey(old.source)===localSourceKey(story.source))));
});
test('a waiting reader whose exclusions cover the shared batch continues scanning',async()=>{
 const f=fixture(),cache=new StoryDiscoveryCache(memory()),raw=f.provider.suggestions;let release,started=false;
 const seed=await run(f,cache),seen=seed.stories.map(story=>story.source);
 const gate=new Promise(resolve=>{release=resolve;});f.provider.suggestions=async(...args)=>{if(!started){started=true;await gate;}return raw(...args);};
 const first=run(f,cache,[],undefined,seen);await until(()=>started);
 const second=run(f,cache,[],undefined,f.stories.slice(0,6).map(story=>story.source));release();
 assert.equal((await first).stories.length,5);const batch=await second;
 assert.equal(batch.stories.length,5);assert.equal(f.calls.length,3);
 assert.ok(batch.stories.every(story=>!f.stories.slice(0,5).some(old=>localSourceKey(old.source)===localSourceKey(story.source))));
});
test('a partial cached batch does not wait behind another readers model call',async()=>{
 const f=fixture(8,4,200),cache=new StoryDiscoveryCache(memory());
 const first=await run(f,cache,[],undefined,[],limits),raw=f.provider.suggestions;let release,started=false;
 const gate=new Promise(resolve=>{release=resolve;});f.provider.suggestions=async(...args)=>{started=true;await gate;return raw(...args);};
 const next=run(f,cache,[],undefined,first.stories.map(story=>story.source),limits);await until(()=>started);
 const cached=await run(f,cache,[],undefined,[],limits);assert.deepEqual(cached.stories,first.stories);assert.equal(cached.stories.length,1);assert.equal(f.calls.length,1);
 release();assert.equal((await next).stories.length,3);
});
test('a complete cached page does not wait behind another readers model call',async()=>{
 const f=fixture(),cache=new StoryDiscoveryCache(memory());const seed=await run(f,cache);const first=await run(f,cache,[],undefined,seed.stories.map(story=>story.source)),raw=f.provider.suggestions;let release,started=false;
 const gate=new Promise(resolve=>{release=resolve;});f.provider.suggestions=async(...args)=>{started=true;await gate;return raw(...args);};
 const next=run(f,cache,[],undefined,[...seed.stories,...first.stories].map(story=>story.source));await until(()=>started);
 const cached=await run(f,cache);assert.equal(cached.stories.length,5);assert.equal(f.calls.length,2);
 release();assert.equal((await next).stories.length,5);
});
test('cache write errors and malformed model state do not pretend success',async()=>{
 const f=fixture();await assert.rejects(run(f,new StoryDiscoveryCache({get:async()=>null,put:async()=>{throw Error('disk full');}})),/缓存.*保存/);assert.equal(f.calls.length,0);
 f.provider.suggestions=async()=>({stories:[],note:''});await assert.rejects(run(f,new StoryDiscoveryCache(memory())),/保留进度/);
});
test('distinct sources sharing a display title remain available when excluding by source',async()=>{
 const f=fixture(),cache=new StoryDiscoveryCache(memory());f.stories.forEach(story=>{story.title='相同展示名';});
 const first=await run(f,cache);assert.equal(first.stories.length,1);
 const next=await run(f,cache,['相同展示名'],undefined,first.stories.map(story=>story.source));
 assert.equal(next.stories.length,5);assert.ok(next.stories.every(story=>!first.stories.some(old=>localSourceKey(old.source)===localSourceKey(story.source))));
});
test('invalid and overlapping receipts are removed and cannot advance the current block',async()=>{
 const f=fixture(),store=memory(),cache=new StoryDiscoveryCache(store),seed=await run(f,cache);
 f.provider.suggestions=async()=>({stories:[f.stories[1],{...f.stories[1],title:'换名重复'},{...f.stories[2],source:{...f.stories[2].source,firstUnit:'missing'}}],note:'',scan:state(true)});
 const batch=await run(f,cache,[],undefined,seed.stories.map(story=>story.source));assert.equal(batch.stories.length,1);assert.match(batch.note,/未能完整核对/);
 const docs=[...store.values.values()].map(bytes=>JSON.parse(new TextDecoder().decode(bytes)));assert.equal(docs.find(d=>d.value.pendingEvents).value.cursor,0);
});
test('FileMedia restart and authenticated JSON/streaming routes preserve partial batches and per-reader exclusions',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'shiqu-direct-reading-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const f=fixture(),media=new FileMedia(path.join(dir,'media'));
 const raw=f.provider.suggestions;f.provider.suggestions=async(...args)=>{const result=await raw(...args);return {...result,stories:result.stories.slice(0,3)};};
 let app=createApplication({root:process.cwd(),dataDirectory:dir,generation:withLocalBooks(f.provider,f.books,media)});
 const request=(body,stream=false)=>app.handle(new Request('http://localhost/api/reader/suggestions',{method:'POST',headers:{'Content-Type':'application/json',...(stream?{Accept:'application/x-ndjson'}:{})},body:JSON.stringify({...selection,...body})}));
 const first=await (await request({})).json();assert.equal(first.stories.length,1);assert.equal(f.calls.length,1);app.close();
 app=createApplication({root:process.cwd(),dataDirectory:dir,generation:withLocalBooks(f.provider,f.books,new FileMedia(path.join(dir,'media')))});t.after(()=>app.close());
 const repeat=await (await request({})).json();assert.deepEqual(repeat.stories,first.stories);assert.equal(f.calls.length,1);
 const response=await request({excludeSources:first.stories.map(s=>s.source)},true);assert.match(response.headers.get('content-type'),/ndjson/);
 const events=(await response.text()).trim().split('\n').map(JSON.parse),next=events.find(e=>e.type==='result').batch;
 assert.equal(next.stories.length,3);assert.equal(f.calls.length,2);assert.ok(next.stories.every(s=>!first.stories.some(old=>localSourceKey(old.source)===localSourceKey(s.source))));
});

test('a draining reader waits for the call it ended, surfaces its failure, and leaves shared readers alone',async()=>{
 const f=fixture(),cache=new StoryDiscoveryCache(memory()),abort=new AbortController(),provider=f.provider.suggestions;
 let release,settled=false;
 f.provider.suggestions=async(...args)=>{await new Promise(resolve=>release=resolve);const result=await provider(...args);settled=true;return result;};
 const leaving=run(f,cache,[],{signal:abort.signal,drain:true,onProgress:()=>{}},[],limits);let left=false;void leaving.catch(()=>{left=true;});
 await until(()=>release);abort.abort();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(left,false,'The call is still using its worker slot');
 release();await assert.rejects(leaving);assert.equal(settled,true);assert.equal(f.calls.length,1,'No further call after the stop');
 // A failing call is not a clean stop: a killed call must count against the replay allowance.
 const failing=fixture(),failed=new StoryDiscoveryCache(memory()),stop=new AbortController();let reject;
 failing.provider.suggestions=()=>new Promise((_,no)=>reject=no);
 const killed=run(failing,failed,[],{signal:stop.signal,drain:true,onProgress:()=>{}},[],limits);await until(()=>reject);stop.abort();reject(Error('PROCESS_EXIT'));
 await assert.rejects(killed,/PROCESS_EXIT/);
 // Another reader keeps the flight alive, so leaving does not wait for or end it.
 const shared=fixture(),cacheShared=new StoryDiscoveryCache(memory()),one=new AbortController();let open;
 const base=shared.provider.suggestions;shared.provider.suggestions=async(...args)=>{await new Promise(resolve=>open=resolve);return base(...args);};
 const a=run(shared,cacheShared,[],{signal:one.signal,drain:true,onProgress:()=>{}},[],limits),b=run(shared,cacheShared,[],{signal:new AbortController().signal,onProgress:()=>{}},[],limits);
 await until(()=>open);one.abort();await assert.rejects(a);open();assert.ok((await b).stories.length>0);assert.equal(shared.calls.length,1);
});

test('stopping and resuming a search reads on from its saved position',async()=>{
 const f=fixture(),cache=new StoryDiscoveryCache(memory()),abort=new AbortController(),provider=f.provider.suggestions;
 // An empty first block forces a second call, so a stop can land between the two.
 let first=true;
 f.provider.suggestions=async(s,e,input)=>{f.calls.push({input});if(first){first=false;abort.abort();return {stories:[],note:'',scan:state(true)};}f.calls.pop();return provider(s,e,input);};
 await assert.rejects(run(f,cache,[],{signal:abort.signal,drain:true,onProgress:()=>{}},[],limits));
 const before=f.calls.length,firstText=f.calls[0].input.text;assert.equal(before,1,'Only the call already started ran');
 const result=await run(f,cache,[],{signal:new AbortController().signal,onProgress:()=>{}},[],limits);
 assert.ok(result.stories.length>0);assert.notEqual(f.calls[1].input.text,firstText,'The finished block is not read again');
});
