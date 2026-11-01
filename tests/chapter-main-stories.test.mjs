// Verify main-story-first chapter discovery through real provider adapters and nested source filtering.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalBooks} from '../server/local-books.ts';
import {selectedChapterScope} from '../server/local-book-contents.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {createReaderProvider} from '../server/generation.ts';
import {StoryDiscoveryCache,discoveryHash} from '../server/story-discovery-cache.ts';
import {discoverLocalStories,discoveryNamespace} from '../server/local-story-discovery.ts';
import {buildReadingPlan,hydrateReadingPlan} from '../server/story-reading-inputs.ts';
import {localSourceKey} from '../lib/reader-local-contract.ts';
import {selectionSchema} from '../lib/reader-model.ts';

const library=new LocalBooks(process.cwd());
const selection=selectionSchema.parse({bookId:'三国演义',theme:'忠于原文',length:'auto'});
const scan=(blockComplete=false,pendingEvents=[],resolvedEventIds=[])=>({blockComplete,pendingEvents,resolvedEventIds});
function memory(){const values=new Map();return {values,async get(key){const bytes=values.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},async put(key,bytes){values.set(key,new Uint8Array(bytes));}};}
function ref(book,section,first,last=first){return {edition:book.edition,sectionId:section.id,firstUnit:section.units[first].id,lastUnit:section.units[last].id};}
function story(title,source){return {title,description:'围绕粮草危机展开的谋划与交锋。',source};}

for(const name of ['codex','gemini'])test(`${name}: chapter thirty offers Guandu before Xuyou and Wuchao, retaining both after restart`,async()=>{
 const book=await library.book(selection),section=book.sections[29],scope=ref(book,section,0,section.units.length-1);
 const main=story('官渡之战',ref(book,section,0,32)),episodes=[story('许攸献计',ref(book,section,13,19)),story('火烧乌巢',ref(book,section,20,27))];
 const selected={...selection,discoverySources:[scope]},jobs=[],store=memory();
 const scoped=selectedChapterScope(library,book,[scope]).book,blocks=hydrateReadingPlan(scoped,buildReadingPlan(scoped,name));
 const result=job=>{
  const payload=JSON.parse(job.prompt),input=payload.localBook;jobs.push({instructions:job.instructions,...payload});
  assert.match(job.instructions,/chapterStoryLevel=main 时只返回一个/);assert.match(job.instructions,/chapterStoryLevel=episodes 时/);assert.match(job.instructions,/不能只缩短范围再推荐同一故事/);
  assert.ok(blocks.some(block=>block.text===input.text));
  assert.doesNotMatch(input.text,/\[sanguo-029-|\[sanguo-031-/);
  if(input.scan.chapterStoryLevel==='main'&&!input.text.includes(`[${main.source.lastUnit}]`)){
   const ids=[...input.text.matchAll(/\[(sanguo-030-\d+)\]/g)].map(match=>match[1]);
   return JSON.stringify({stories:[],note:'',scan:scan(true,[{id:input.scan.pendingEvents[0]?.id||'',title:main.title,summary:'两军相持，主事件尚未收束。',source:{sectionId:section.id,firstUnit:ids[0],lastUnit:ids.at(-1),continuations:[]}}])});
  }
  const stories=input.scan.chapterStoryLevel==='main'?[main]:episodes;
  return JSON.stringify({stories:stories.map(({source,...s})=>{const {edition,...range}=source;assert.equal(edition,book.edition);return {...s,source:{...range,continuations:[]}};}),note:'',scan:scan(false,[],input.scan.pendingEvents.map(event=>event.id))});
 };
 const runner={status:async()=>({configured:true}),run:async job=>({text:result(job),model:'mock',requestId:'mock',usage:null})};
 const transport=async(_url,init)=>{const request=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:result({instructions:request.systemInstruction.parts[0].text,prompt:request.contents[0].parts[0].text})}]}}]});};
 const base=createReaderProvider({SHIQU_AI_PROVIDER:name,GEMINI_API_KEY:'mock-only'},store,transport,runner);
 let wrapped=withLocalBooks(base,library,store);
 const first=await wrapped.suggestions(selected,[]);
 assert.deepEqual(first.stories.map(s=>s.title),['官渡之战']);const mainCalls=jobs.length;
 assert.ok(jobs.every(job=>job.localBook.scan.chapterStoryLevel==='main'&&job.localBook.scan.maxStories===1));
 assert.match(first.note,/先总故事、后小故事/);
 wrapped=withLocalBooks(base,library,store);
 assert.deepEqual((await wrapped.suggestions(selected,[])).stories,first.stories);assert.equal(jobs.length,mainCalls);
 const next=await wrapped.suggestions(selected,[main.title],undefined,undefined,[main.source]);
 assert.deepEqual(next.stories.map(s=>s.title),episodes.map(s=>s.title));assert.equal(jobs.length,mainCalls+1);
 assert.equal(jobs.at(-1).localBook.scan.chapterStoryLevel,'episodes');assert.equal(jobs.at(-1).localBook.scan.maxStories,5);
 assert.deepEqual(jobs.at(-1).localBook.scan.excludedSources,[main.source]);assert.deepEqual(jobs.at(-1).excludeTitles,[main.title]);
 const both=await withLocalBooks(base,library,store).suggestions(selected,[]);
 assert.deepEqual(both.stories.map(s=>s.title),[main.title,...episodes.map(s=>s.title)]);assert.equal(jobs.length,mainCalls+1);
 assert.deepEqual((await wrapped.suggestions(selected,[main.title])).stories,next.stories);
 for(const choice of [first.stories[0],...next.stories]){
  const original=await wrapped.generator().prepareOriginal({...selected,source:choice.source,storyTitle:choice.title},choice.title);
  assert.deepEqual(original.localSource,choice.source);assert.match(original.chapterContext.text,/未若楚、漢/);
 }
});

function synthetic(){
 const sections=Array.from({length:4},(_,i)=>({id:`chapter-${i}`,title:`第${i+1}回`,units:Array.from({length:8},(_,j)=>({id:`unit-${i}-${j}`,text:'人物面对危机，谋划之后展开行动，终于得到结果。'+'字'.repeat(100),narrative:true}))}));
 const book={id:'sanguo',title:'测试书',edition:'a'.repeat(64),url:'https://example.org/original',provider:'原文',sections,input:{title:'测试书',edition:'a'.repeat(64),text:sections.map(s=>`篇章 ${s.id}：${s.title}\n`+s.units.map(u=>`[${u.id}]\n${u.text}`).join('\n\n')).join('\n\n')}};
 const sources=sections.map(s=>ref(book,s,0,7)),selected={...selection,discoverySources:sources},calls=[];
 const provider={status:async()=>({configured:true,provider:'codex',models:{text:'mock',image:'mock'}}),safeError:()=>'',generator:()=>({}),suggestions:async()=>assert.fail('Set the controlled response')};
 const cache=new StoryDiscoveryCache(memory()),limits={whole:20000,chapter:1600};
 const run=(excludedSources=[],excluded=[])=>discoverLocalStories(provider,library,cache,book,selected,excluded,undefined,excludedSources,limits);
 return {book,selected,provider,cache,limits,calls,run};
}

test('nested episodes pass while renamed exact ranges and partial intersections remain rejected',async()=>{
 const f=synthetic(),section=f.book.sections[0],main=story('主故事',ref(f.book,section,1,6)),child=story('子故事',ref(f.book,section,2,3));
 f.provider.suggestions=async()=>({stories:[main],note:'',scan:scan()});await f.run();
 f.provider.suggestions=async()=>({stories:[{...main,title:'换名主故事'},child,story('交叉片段',ref(f.book,section,3,4)),story('重叠另名',ref(f.book,section,0,2))],note:'',scan:scan(true)});
 const next=await f.run([main.source]);assert.deepEqual(next.stories.map(s=>s.title),['子故事']);assert.match(next.note,/未能完整核对/);
 assert.deepEqual((await f.run()).stories.map(s=>s.title),['主故事','子故事']);
});

test('a main event spanning reading blocks keeps its earlier original available for episodes',async()=>{
 const f=synthetic(),[a,b]=f.book.sections,first=ref(f.book,a,0,7),main=story('跨章主故事',{...first,continuations:[{sectionId:b.id,firstUnit:b.units[0].id,lastUnit:b.units[7].id}]}),child=story('前章子故事',ref(f.book,a,2,4));
 f.provider.suggestions=async(_selection,_excluded,input)=>{
  f.calls.push(input);
  if(f.calls.length===1){assert.equal(input.scan.chapterStoryLevel,'main');return {stories:[],note:'',scan:scan(true,[{id:'',title:main.title,summary:'主事件尚未结束。',source:first}])};}
  if(f.calls.length===2){assert.equal(input.scan.chapterStoryLevel,'main');assert.match(input.scan.contextText,/\[unit-0-0\]/);return {stories:[main],note:'',scan:scan(false,[],[input.scan.pendingEvents[0].id])};}
  assert.equal(input.scan.chapterStoryLevel,'episodes');assert.match(input.scan.contextText,/\[unit-0-2\]/);assert.deepEqual(input.scan.excludedSources,[main.source]);
  return {stories:[child],note:'',scan:scan()};
 };
 assert.equal((await f.run()).stories[0].title,main.title);assert.equal(f.calls.length,2);
 assert.equal((await f.run([main.source])).stories[0].title,child.title);assert.equal(f.calls.length,3);
});

test('chapter scopes do not reuse the old flat-story cache',async()=>{
 const f=synthetic(),old=story('旧局部故事',ref(f.book,f.book.sections[0],1,2));
 const oldKey=discoveryNamespace(f.book,'codex','mock',f.limits)+'/scope/'+discoveryHash(f.selected.discoverySources.map(localSourceKey))+'/theme/'+discoveryHash(f.selected.theme);
 await f.cache.write(oldKey,{stories:[old],cursor:0,readThrough:0,pendingEvents:[],exhausted:false,rejected:false});
 let calls=0;f.provider.suggestions=async()=>{calls++;return {stories:[story('新总故事',ref(f.book,f.book.sections[0],0,7))],note:'',scan:scan()};};
 assert.equal((await f.run()).stories[0].title,'新总故事');assert.equal(calls,1);
});

