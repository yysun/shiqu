// 覆盖导入书故事卡的生产窗口、取消、续跑与缓存清理责任。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {strToU8} from 'fflate';
import {ImportedBookCards} from '../server/imported-book-cards.ts';
import {LocalBooks} from '../server/local-books.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {StoryDiscoveryCache,discoveryHash} from '../server/story-discovery-cache.ts';
import {storyCardsSchema} from '../server/local-story-search.ts';

const bookText=`第一章 梦蝶\n庄周梦见自己成为蝴蝶，在天地间自在飞翔。醒来之后，他认真思考梦境与真实之间的关系。\n第二章 朋友\n朋友听闻庄周的经历，提出了关于梦醒的追问。庄周没有急着回答，而是继续探究万物的变化。\n第三章 回味\n庄周回想梦中自由的感受，意识到自己无法确定梦中身份。故事以这份思考自然结束。`;
const metadata={title:'本地故事卡测试',acceptRights:true,license:'允许本地改编'};
class MemoryMedia{
 constructor(){this.values=new Map();}
 async put(key,bytes){this.values.set(key,new Uint8Array(bytes));}
 async get(key){const bytes=this.values.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;}
 async delete(key){this.values.delete(key);}
}
async function fixture(t,holdFirst=false){
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu-imported-cards-'));t.after(()=>rm(directory,{recursive:true,force:true}));const books=new LocalBooks(process.cwd(),undefined,directory),draft=await books.imported.createDraft(metadata);
 await books.imported.appendSource(draft.id,{bytes:strToU8(bookText),name:'book.txt'});const imported=await books.imported.confirm(draft.id),book=await books.book({bookId:imported.id,theme:'原典故事'}),media=new MemoryMedia();let calls=0,startedResolve;
 const started=new Promise(resolve=>{startedResolve=resolve;});
 const base={status:async()=>({configured:true,provider:'codex',models:{text:'mock',image:'mock'}}),safeError:error=>error instanceof Error?error.message:'mock failure',suggestions:async(_selection,_excluded,input,reading)=>{
  calls++;assert.equal(input.purpose,'cards');reading?.signal.throwIfAborted();const visibleSections=book.sections.filter(section=>section.units.some(unit=>input.text.includes(`[${unit.id}]\n`)));
  assert.ok(visibleSections.length<=2,'a story-card window must contain the selected chapter and at most its neighbor');startedResolve();
  if(holdFirst&&calls===1)await new Promise((resolve,reject)=>{const signal=reading.signal,abort=()=>reject(signal.reason||new Error('aborted'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  reading?.signal.throwIfAborted();const section=visibleSections[0],unit=section.units.find(value=>input.text.includes(`[${value.id}]\n`)&&value.text.length>30);assert.ok(unit);
  reading?.onCall?.({durationMs:5,inputTokens:24,outputTokens:12});return {stories:[{title:`故事${section.title}`,description:'人物采取行动，经历变化，最后得到明确结果。',source:{sectionId:section.id,firstUnit:unit.id,lastUnit:unit.id,edition:book.edition}}],note:''};
 }};
 const provider=withLocalBooks(base,books,media),cache=new StoryDiscoveryCache(media),jobs=new ImportedBookCards(books,provider,cache);return {books,book,media,provider,cache,jobs,id:imported.id,get calls(){return calls;},started};
}

test('estimate and production card generation use bounded cards-purpose windows, persist source and resume without duplicate calls',async t=>{
 const f=await fixture(t),estimate=await f.jobs.estimate(f.id);assert.equal(estimate.estimated,true);assert.ok(estimate.calls>0);assert.equal(f.calls,0);
 const progress=await f.jobs.run(f.id,false);assert.equal(progress.status,'complete');assert.ok(progress.chapters.every(chapter=>chapter.status==='done'));assert.ok(f.calls>0);
 const saved=await f.books.imported.readCards(f.id),cards=storyCardsSchema.parse(saved.value);assert.equal(cards.edition,f.book.edition);assert.ok(cards.cards.length>0);
 for(const card of cards.cards){const source={...card.source,edition:cards.edition},original=f.books.resolve(f.book,source);assert.ok(original.text.length>30);assert.match(original.text,/[。！？]/);}
 const calls=f.calls;assert.equal((await f.jobs.run(f.id,false)).status,'complete');assert.equal(f.calls,calls);
});

test('cancel aborts and drains the active request, records paused progress, then resumes',async t=>{
 const f=await fixture(t,true),running=f.jobs.run(f.id,false);await f.started;assert.equal((await f.jobs.get(f.id)).status,'running');const cancelled=await f.jobs.cancel(f.id);assert.equal(cancelled.cancelled,true);
 const paused=await running;assert.equal(paused.status,'paused');assert.equal((await f.books.imported.readCards(f.id)),null);
 const resumed=await f.jobs.run(f.id,false);assert.equal(resumed.status,'complete');assert.ok(f.calls>1);
});

test('an interrupted running task reopens as paused for user-controlled resume',async t=>{
 const f=await fixture(t,true),running=f.jobs.run(f.id,false);await f.started;await f.jobs.cancel(f.id);const paused=await running;
 const file=path.join(f.books.imported.booksDirectory,f.id,'card-progress.json'),interrupted={...paused,status:'running'};await writeFile(file,JSON.stringify(interrupted));
 const restarted=new ImportedBookCards(f.books,f.provider,f.cache),recovered=await restarted.get(f.id);assert.equal(recovered.status,'paused');
});

test('card progress owns each cache key before dispatch so cancellation cleanup removes the record',async t=>{
 const f=await fixture(t,true),running=f.jobs.run(f.id,false);await f.started;
 const progress=JSON.parse(await readFile(path.join(f.books.imported.booksDirectory,f.id,'card-progress.json'),'utf8')),key=progress.chapters.find(chapter=>chapter.status==='running').cacheKeys[0];
 assert.ok(key);await f.cache.write(key,{stories:[]});assert.ok(await f.media.get(`reader-cache/${discoveryHash(key)}.json`));
 await f.jobs.cancel(f.id);await running;await f.cache.remove(key);assert.equal(await f.media.get(`reader-cache/${discoveryHash(key)}.json`),null);
});

test('cancelling during a cache write removes the incomplete window result',async t=>{
 const f=await fixture(t),originalWrite=f.cache.write.bind(f.cache);let finishWrite,enteredWrite;const entered=new Promise(resolve=>{enteredWrite=resolve;}),gate=new Promise(resolve=>{finishWrite=resolve;});
 f.cache.write=async(key,value)=>{if(/^[a-f0-9]{64}$/.test(key)){enteredWrite(key);await gate;}await originalWrite(key,value);};
 const running=f.jobs.run(f.id,false),key=await entered;assert.ok(f.jobs.active,'the generation task should remain active while its cache write is held');const cancelling=f.jobs.cancel(f.id);finishWrite();assert.equal((await cancelling).cancelled,true);const paused=await running;
 assert.equal(paused.status,'paused');assert.equal(await f.cache.read(key,z.unknown()),null);assert.equal(await f.books.imported.readCards(f.id),null);
});

test('reserves a card job before preflight and blocks it across book mutation',async t=>{
 const f=await fixture(t),originalStatus=f.provider.status.bind(f.provider);let releaseStatus,enteredResolve;const gate=new Promise(resolve=>{releaseStatus=resolve;}),entered=new Promise(resolve=>{enteredResolve=resolve;});
 f.provider.status=async()=>{enteredResolve();await gate;return originalStatus();};
 const running=f.jobs.run(f.id,false);await entered;assert.ok(f.jobs.active);await assert.rejects(f.jobs.run(f.id,false),/故事卡任务正在运行/);
 let mutationStarted=false;const mutation=f.jobs.withBookMutation(f.id,async()=>{mutationStarted=true;return 'done';});await Promise.resolve();assert.equal(mutationStarted,false);await assert.rejects(f.jobs.run(f.id,false),/正在执行删除或替换/);
 releaseStatus();assert.equal(await mutation,'done');assert.equal(mutationStarted,true);await assert.rejects(running,/用户取消/);assert.equal(f.calls,0);
 assert.equal((await f.jobs.run(f.id,false)).status,'complete');
});
