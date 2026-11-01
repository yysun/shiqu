// Verify canonical scan scopes, real wrapped discovery and paid confirmation gates with controlled generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalBooks} from '../server/local-books.ts';
import {bookContents,indexBookContents,selectedChapterScope} from '../server/local-book-contents.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {productionFixture,until,selection} from './fixtures/production.mjs';
const books=new LocalBooks(process.cwd()),base=selectionSchema.parse({...selection,bookId:'三国演义',theme:'忠于原文',storyTitle:undefined,length:'auto',narrativeDetail:'balanced'});
async function prepared(t){
 const f=await productionFixture(t);f.control.hold=false;
 const book=await books.book(base),chapters=(await bookContents(books,base,'黄忠 定军山')).entries;
 const sources=chapters.map(entry=>entry.source),chosen=book.sections.find(section=>section.id===sources[1].sectionId);
 const source={edition:book.edition,sectionId:chosen.id,firstUnit:chosen.units[0].id,lastUnit:chosen.units[3].id};
 const inputs=[];let outside=false;
 f.generation.suggestions=async(_s,_excluded,input)=>{inputs.push(input);return {stories:_excluded.includes('黄忠取定军山')?[]:[{title:'黄忠取定军山',description:'老将与法正筹划进取。',source:outside?{...source,sectionId:book.sections[0].id,firstUnit:book.sections[0].units[0].id,lastUnit:book.sections[0].units[3].id}:source}],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}};};
 f.options.generation=withLocalBooks(f.generation,books,f.media);await f.restart();f.app.services.localBooks=books;
 const create=(references=sources,id=crypto.randomUUID())=>f.json('sessions','POST',{requestId:id,intake:true,selection:{...base,discoverySources:references}});
 return {...f,get app(){return f.app;},book,sources,source,inputs,create,setOutside(value){outside=value;}};
}

test('multiple selected chapters extract scoped stories before preparation, replay canonically and survive restart',async t=>{
 const f=await prepared(t),id=crypto.randomUUID();await f.create([...f.sources].reverse(),id);
 await until(async()=>(await f.read(id)).intake.phase==='choosing');
 let saved=await f.read(id);assert.deepEqual(saved.selection.discoverySources,f.sources);assert.equal(saved.selection.source,undefined);assert.equal(saved.frameRecommendation,null);
 assert.equal(f.inputs.length,1);const input=f.inputs[0];assert.equal(input.edition,f.book.edition);
 assert.match(input.text,new RegExp(f.sources[0].sectionId));assert.match(input.text,new RegExp(f.sources[1].sectionId));assert.doesNotMatch(input.text,new RegExp(f.book.sections[0].units[0].id));
 assert.ok(input.text.indexOf(f.sources[0].sectionId)<input.text.indexOf(f.sources[1].sectionId));
 assert.equal(f.control.recommendations.length,0);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 assert.equal((await f.create(f.sources,id)).id,id);assert.equal((await f.json('sessions')).length,1);
 await f.restart();f.app.services.localBooks=books;saved=await f.read(id);assert.deepEqual(saved.selection.discoverySources,f.sources);
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(id)).intake.phase==='confirming');
 saved=await f.read(id);assert.deepEqual(saved.selection.source,f.source);assert.deepEqual(saved.selection.discoverySources,f.sources);assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'more'});
 await until(async()=>(await f.read(id)).intake.search.state==='idle');assert.deepEqual((await f.read(id)).selection.discoverySources,f.sources);
});

test('forged, duplicate, empty, excessive, nonchapter and mixed scopes fail before insertion',async t=>{
 const f=await prepared(t),named=(await bookContents(books,selectionSchema.parse({...base,bookId:'liaozhai'}))).entries.find(e=>e.source);
 const invalid=[[],[...f.sources,...f.sources],[{...f.sources[0],edition:'0'.repeat(64)}],[{...f.sources[0],lastUnit:f.sources[0].firstUnit}],Array.from({length:25},()=>f.sources[0]),[named.source]];
 for(const discoverySources of invalid){const response=await f.request('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...base,discoverySources}});assert.equal(response.status,400);}
 assert.equal((await f.request('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...base,source:f.source,discoverySources:f.sources}})).status,400);
 for(const intake of [undefined,false])assert.equal((await f.request('sessions','POST',{requestId:crypto.randomUUID(),...(intake===undefined?{}:{intake}),selection:{...base,discoverySources:f.sources}})).status,400);
 assert.equal((await f.json('sessions')).length,0);assert.equal(f.inputs.length,0);
});

test('out-of-scope model receipts fail closed; changing selected scope never reuses another scope cache',async t=>{
 const f=await prepared(t);f.setOutside(true);const created=await f.create([f.sources[0]]);
 await until(async()=>(await f.read(created.id)).intake.search.state==='failed');assert.equal((await f.read(created.id)).intake.batches.length,0);assert.equal(f.control.recommendations.length,0);
 f.setOutside(false);const second=await f.create([f.sources[1]]);await until(async()=>(await f.read(second.id)).intake.phase==='choosing');assert.equal((await f.read(second.id)).intake.batches[0].stories.length,1);
 const calls=f.inputs.length;const third=await f.create(f.sources);await until(async()=>(await f.read(third.id)).intake.phase==='choosing');assert.ok(f.inputs.length>calls);
});

test('chapter scopes retain canonical ranges even when the chapter contains an isolated unreadable unit',async()=>{
 const book=await books.book(base),section=book.sections[0],modified={...book,sections:[{...section,units:[{...section.units[0],text:'缺字□仍可扫描其余内容。'},...section.units.slice(1)]}]};
 const entry=indexBookContents(books,modified).entries[0];
 assert.equal(entry.kind,'chapter');assert.ok(entry.source);assert.equal(selectedChapterScope(books,modified,[entry.source]).book.sections.length,1);
 assert.throws(()=>books.resolve(modified,entry.source),e=>e.status===400);
});

test('a story may span selected neighboring chapters and prepares their original parts intact',async t=>{
 const f=await prepared(t),a=f.book.sections.find(s=>s.id===f.sources[0].sectionId),b=f.book.sections.find(s=>s.id===f.sources[1].sectionId);
 const source={edition:f.book.edition,sectionId:a.id,firstUnit:a.units.at(-3).id,lastUnit:a.units.at(-1).id,continuations:[{sectionId:b.id,firstUnit:b.units[0].id,lastUnit:b.units[3].id}]};
 f.generation.suggestions=async()=>({stories:[{title:'跨章的定军山之战',description:'前后两回连贯的事件。',source}],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}});
 const created=await f.create();await until(async()=>(await f.read(created.id)).intake.phase==='choosing');const saved=await f.read(created.id);
 await f.json(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:saved.intake.generation,action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(created.id)).intake.phase==='confirming');
 const original=(await f.json(`sessions/${created.id}/source`)).source;assert.equal(original.localParts.length,2);assert.deepEqual(original.localSource,source);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('an explicit all-chapter scope has a distinct cache from whole-book discovery',async()=>{
 const s=selectionSchema.parse({...base,bookId:'列子'}),book=await books.book(s),refs=(await bookContents(books,s)).entries.map(e=>e.source);
 const selected=selectedChapterScope(books,book,refs);assert.equal(selected.book.input.text,book.input.text);
 const section=book.sections[0],source={edition:book.edition,sectionId:section.id,firstUnit:section.units[0].id,lastUnit:section.units[3].id};let calls=0;
 const values=new Map(),media={async put(key,bytes){values.set(key,new Uint8Array(bytes));},async get(key){const bytes=values.get(key);return bytes?{async arrayBuffer(){return bytes.slice().buffer;}}:null;}};
 const provider=withLocalBooks({status:async()=>({configured:true,provider:'codex',models:{text:'scope-test',image:'mock'}}),safeError:()=> 'controlled',generator:()=>({}),suggestions:async()=>{calls++;return {stories:[{title:'首篇故事',description:'原文中的完整事件。',source}],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}};}},books,media);
 await provider.suggestions(s,[]);assert.equal(calls,1);
 await provider.suggestions({...s,discoverySources:refs},[]);assert.equal(calls,2);
 await provider.suggestions({...s,discoverySources:[...refs].reverse()},[]);assert.equal(calls,2);
 await provider.suggestions(s,[]);assert.equal(calls,2);
});

test('a fresh task and fresh discovery wrapper reuse persisted stories for the same chapter set without LLM calls',async t=>{
 const f=await prepared(t),first=await f.create();await until(async()=>(await f.read(first.id)).intake.phase==='choosing');const calls=f.inputs.length,stories=(await f.read(first.id)).intake.batches[0].stories;
 f.options.generation=withLocalBooks(f.generation,books,f.media);await f.restart();f.app.services.localBooks=books;
 const second=await f.create([...f.sources].reverse());await until(async()=>(await f.read(second.id)).intake.phase==='choosing');
 assert.notEqual(first.id,second.id);assert.equal(f.inputs.length,calls);assert.deepEqual((await f.read(second.id)).intake.batches[0].stories,stories);assert.match((await f.read(second.id)).intake.batches[0].note,/缓存/);assert.equal(f.control.recommendations.length,0);
});
