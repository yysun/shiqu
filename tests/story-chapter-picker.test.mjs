// Exercise real contents receipts and durable preparation without discovery or paid providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalBooks} from '../server/local-books.ts';
import {bookContents,indexBookContents} from '../server/local-book-contents.ts';
import {matchingBookContents} from '../lib/reader-contents.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {productionFixture,until,selection} from './fixtures/production.mjs';
const books=new LocalBooks(process.cwd());
const choose=bookId=>selectionSchema.parse({...selection,bookId});

test('contents preserve named stories, single anecdotes and chapter receipts with quality gates',async()=>{
 const liaozhai=await bookContents(books,choose('liaozhai'));
 const story=liaozhai.entries.find(entry=>entry.title==='種梨');assert.ok(story?.source);assert.equal(story.chapter,'第一卷');
 const original=await books.selected({...choose('liaozhai'),source:story.source});assert.match(original.text,/種梨/);assert.doesNotMatch(original.text,/勞山道士/);
 const shishuo=await bookContents(books,choose('shishuo'));assert.equal(shishuo.entries.length,1129);
 for(const entry of shishuo.entries.filter(entry=>entry.source))assert.equal(entry.source.firstUnit,entry.source.lastUnit);
 const chapter=await bookContents(books,choose('西游记'));assert.match(chapter.entries[0].title,/第一回/);assert.ok(chapter.entries[0].source);
 const book=await books.book(choose('zhuangzi')),section=book.sections[0];
 const blocked=indexBookContents(books,{...book,id:'shishuo',sections:[{...section,units:[{...section.units[0],text:'這段原文有□缺字，不能依據它編造故事。'}]}]});
 assert.equal(blocked.entries[0].source,undefined);assert.match(blocked.entries[0].unavailable,/缺字/);
 await assert.rejects(bookContents(books,choose('unknown')),e=>e.status===400);
});

test('metadata browsing needs no configured provider; direct intake derives title and keeps production gated across replay/restart',async t=>{
 const f=await productionFixture(t);f.app.services.localBooks=books;f.control.hold=false;
 let discoveries=0;f.generation.suggestions=async()=>{discoveries++;throw Error('Direct choice must skip discovery');};
 const status=f.generation.status;f.generation.status=async()=>({configured:false});
 const contents=await f.json('books/liaozhai/contents');f.generation.status=status;
 const entry=contents.entries.find(entry=>entry.title==='種梨'),requestId=crypto.randomUUID();
 const body={requestId,intake:true,selection:{...selection,bookId:'liaozhai',storyTitle:'forged title',source:entry.source}};
 const created=await f.json('sessions','POST',body);assert.equal(created.selection.storyTitle,entry.title);assert.deepEqual(created.intake.selected,{batch:0,index:0});
 await until(async()=>(await f.read(requestId)).intake.phase==='confirming');
 const prepared=await f.read(requestId),original=await f.json(`sessions/${requestId}/source`);
 assert.match(original.source.text,/種梨/);assert.deepEqual(original.source.localSource,entry.source);
 assert.equal(prepared.frameRecommendation.count,7);assert.equal(prepared.intake.search.state,'idle');assert.equal(discoveries,0);assert.equal(f.control.recommendations.length,1);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 assert.equal((await f.json('sessions','POST',body)).id,requestId);assert.equal((await f.json('sessions')).length,1);
 const other=contents.entries.find(entry=>entry.source&&entry.id!==contents.entries.find(e=>e.title==='種梨').id);
 assert.equal((await f.request('sessions','POST',{...body,selection:{...body.selection,source:other.source}})).status,409);
 await f.restart();f.app.services.localBooks=books;assert.equal((await f.read(requestId)).intake.phase,'confirming');assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('forged, stale, cross-book and non-catalog ranges fail before a task is saved',async t=>{
 const f=await productionFixture(t);f.app.services.localBooks=books;
 const contents=await f.json('books/西游记/contents'),entry=contents.entries.find(e=>e.source),source=entry.source;
 for(const [bookId,ref]of [['西游记',{...source,edition:'0'.repeat(64)}],['zhuangzi',source],['other',source],['西游记',{...source,lastUnit:source.firstUnit}]]){
  const result=await f.request('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,bookId,source:ref}});assert.equal(result.status,400);
 }
 assert.equal((await f.json('sessions')).length,0);assert.equal(f.control.recommendations.length,0);
});

test('contents search matches traditional text and full-width chapter punctuation',()=>{
 const entries=[{id:'a',title:'卷一（文淵閣本）',chapter:'卷一',excerpt:'種梨的故事。'}];
 for(const query of ['种梨','卷一（','卷一(','文渊阁','  種梨  ',''])assert.equal(matchingBookContents(entries,query).length,1,query);
 assert.equal(matchingBookContents(entries,'不存在').length,0);
});

test('multiword search matches every normalized term in any order across fields',()=>{
 const entries=[{id:'hit',title:'黃忠破敵',chapter:'定軍山',excerpt:'原文。'},{id:'miss',title:'黃忠破敵',chapter:'長沙',excerpt:'原文。'}];
 for(const query of ['黄忠 定军山','定軍山 黃忠','黃忠　定军山','  黄忠\t定軍山  '])assert.deepEqual(matchingBookContents(entries,query).map(e=>e.id),['hit'],query);
 assert.equal(matchingBookContents(entries,'黄忠 不存在').length,0);
});

test('Three Kingdoms search finds Huang Zhong at Dingjun Mountain beyond the preview without exposing full chapters',async t=>{
 const f=await productionFixture(t);f.app.services.localBooks=books;
 const query=async value=>f.json('books/'+encodeURIComponent('三国演义')+'/contents?q='+encodeURIComponent(value));
 const simplified=await query('黄忠 定军山'),traditional=await query('黃忠 定軍山'),reversed=await query('定軍山　黄忠');
 const ids=result=>result.entries.map(entry=>entry.id);
 assert.ok(simplified.entries.some(entry=>entry.title.startsWith('第七十一回')));
 assert.deepEqual(ids(simplified),ids(traditional));assert.deepEqual(ids(simplified),ids(reversed));
 const chapter=simplified.entries.find(entry=>entry.title.startsWith('第七十一回'));
 assert.doesNotMatch(chapter.excerpt,/定軍山|定军山/);assert.ok(chapter.source);
 for(const entry of simplified.entries){assert.ok(entry.excerpt.length<=100);assert.deepEqual(Object.keys(entry).sort(),['chapter','excerpt','id','kind','source','title']);}
 assert.equal((await query('黄忠 不存在的山名')).entries.length,0);
 assert.equal((await f.request('books/'+encodeURIComponent('三国演义')+'/contents?q='+encodeURIComponent('字'.repeat(201)))).status,400);
 const titles=await query('第七十一回');assert.ok(titles.entries.some(entry=>entry.id===chapter.id));
 assert.equal((await f.json('sessions')).length,0);assert.equal(f.control.recommendations.length,0);assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});
