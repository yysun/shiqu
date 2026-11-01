// Reproduce a premature Honglou anchor and verify full chapters reach every generation adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalBooks} from '../server/local-books.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {selectionSchema,view} from '../lib/reader-model.ts';
import {sourceRanges} from '../lib/reader-local-contract.ts';
import {productionFixture,makePlan} from './fixtures/production.mjs';

const library=new LocalBooks(process.cwd());
async function honglou(){
 const base=selectionSchema.parse({bookId:'红楼梦',storyTitle:'宝玉探病识金锁',theme:'忠于原文',length:21});
 const book=await library.book(base),section=book.sections[7];
 return {book,section,selection:{...base,source:{edition:book.edition,sectionId:section.id,firstUnit:section.units[1].id,lastUnit:section.units[14].id}}};
}

test('the short gold-lock anchor retains its citation and saves all of chapter eight, including the departure',async()=>{
 const {book,section,selection}=await honglou(),original=await library.storyOriginal(selection);
 assert.deepEqual(original.localSource,selection.source);
 assert.equal(original.text,library.resolve(book,selection.source).text);
 assert.doesNotMatch(original.text,/林姑娘來了|好了，披上斗篷罷/);
 assert.deepEqual(original.chapterContext.source,{edition:book.edition,sectionId:section.id,firstUnit:section.units[0].id,lastUnit:section.units.at(-1).id});
 assert.equal(original.chapterContext.text,`篇章 ${section.id}：${section.title}\n`+section.units.map(u=>`[${u.id}]\n${u.text}`).join('\n\n'));
 assert.match(original.chapterContext.text,/林姑娘來了/);assert.match(original.chapterContext.text,/好了，披上斗篷罷/);
 assert.doesNotMatch(original.chapterContext.text,/\[honglou-007-|\[honglou-009-/);
});

test('discontinuous and cross-chapter anchors expand each involved chapter once in book order',async()=>{
 const {book,selection}=await honglou(),a=book.sections[7],b=book.sections[8];
 const source={...selection.source,lastUnit:a.units[3].id,continuations:[{sectionId:a.id,firstUnit:a.units[10].id,lastUnit:a.units[14].id},{sectionId:b.id,firstUnit:b.units[0].id,lastUnit:b.units[0].id}]};
 const original=await library.storyOriginal({...selection,source});
 assert.deepEqual(sourceRanges(original.chapterContext.source).map(r=>r.sectionId),[a.id,b.id]);
 for(const section of [a,b])for(const unit of section.units)assert.equal(original.chapterContext.text.split(`[${unit.id}]\n`).length,2);
 assert.ok(original.chapterContext.text.indexOf(`[${a.units[0].id}]`)<original.chapterContext.text.indexOf(`[${b.units[0].id}]`));
 assert.doesNotMatch(original.chapterContext.text,/\[honglou-010-/);
});

test('the reader exposes saved full chapters and citations while historical passage-only stories stay readable',async()=>{
 const {selection}=await honglou(),original=await library.storyOriginal(selection);
 const row={id:'chapter-context',selection:JSON.stringify(selection),document:JSON.stringify({plan:makePlan(8),original,images:[],audio:[],usage:[]}),state:'idle',page:0,saved:0,created_at:'2026-11-01',updated_at:'2026-11-01'};
 let story=view(row).story;
 assert.equal(story.sourceText,original.chapterContext.text);assert.equal(story.sourceReference,original.chapterContext.title);
 assert.match(story.sourceText,/好了，披上斗篷罷/);
 const legacy=structuredClone(original);delete legacy.chapterContext;
 row.document=JSON.stringify({plan:makePlan(8),original:legacy,images:[],audio:[],usage:[]});story=view(row).story;
 assert.equal(story.sourceText,legacy.text);assert.equal(story.sourceReference,legacy.title);
});

test('isolated Liaozhai and Shishuo stories keep their exact source without neighboring stories',async()=>{
 for(const bookId of ['liaozhai','shishuo']){
  const {indexBookContents}=await import('../server/local-book-contents.ts');
  const selection=selectionSchema.parse({bookId,theme:'忠于原文'}),book=await library.book(selection);
  const entry=indexBookContents(library,book).entries.find(e=>e.source);
  const original=await library.storyOriginal({...selection,source:entry.source});
  assert.equal(original.chapterContext,undefined);assert.equal(original.text,library.resolve(book,entry.source).text);
 }
});

for(const provider of ['codex','gemini'])test(`${provider}: complete chapters survive persistence and reach pacing, outline, scenes, ending, review and repair`,async t=>{
 const f=await productionFixture(t,provider),{selection}=await honglou();
 const g=withLocalBooks(f.generation,library,f.media).generator(),original=await g.prepareOriginal(selection,'chapter-context');
 const saved=JSON.parse(Buffer.from(await(await f.media.get('reader/chapter-context/source.json')).arrayBuffer()).toString());
 assert.deepEqual(saved,original);
 await g.recommend(selection,'chapter-context',saved);
 const outline=await g.outline(selection,'chapter-context',saved);
 assert.equal(outline.value.sourceReference,saved.chapterContext.title);
 await g.planBatch(selection,'chapter-context',{outline:outline.value,pages:[]},saved);
 const short={...selection,length:8},plan=(await g.plan(short,'chapter-context',saved)).value;
 assert.equal(plan.sourceReference,saved.chapterContext.title);
 const candidates=(await g.reflectionCandidates(short,plan,saved)).value.candidates;
 await g.reflection(short,plan,saved);
 await g.review(short,plan,saved,undefined,candidates);
 await g.repair(short,plan,saved,[{page:8,category:'progression',problem:'结尾缺少告辞。',instruction:'依据完整章节核对探病的自然收束。'}]);
 const inputs=[...f.control.recommendations,...f.control.outlines,...f.control.plans,...f.control.reflections,...f.control.reviews,...f.control.repairs];
 assert.equal(inputs.length,8);
 for(const input of inputs){assert.deepEqual(input.verifiedOriginal.chapterContext,saved.chapterContext);assert.equal(input.verifiedOriginal.text,saved.text);assert.match(input.verifiedOriginal.chapterContext.text,/好了，披上斗篷罷/);}
 assert.equal(f.control.calls.length,0);
 // Saved context is the retry checkpoint even when the installed library has since changed.
 const changedLibrary=new LocalBooks(process.cwd());changedLibrary.book=async()=>assert.fail('Retry must use saved chapters');
 await withLocalBooks(f.generation,changedLibrary,f.media).generator().plan(short,'chapter-context',saved);
 assert.deepEqual(f.control.plans.at(-1).verifiedOriginal.chapterContext,saved.chapterContext);
 for(const tamper of [o=>o.chapterContext.source.edition='0'.repeat(64),o=>o.chapterContext.source.sectionId='honglou-009',o=>o.chapterContext.text='缺少原文章节编号。']){
  const bad=structuredClone(saved);tamper(bad);const before=f.control.plans.length;
  await assert.rejects(g.plan(short,'chapter-context',bad),e=>e.status===400);assert.equal(f.control.plans.length,before);
 }
});

test('full context preserves unreadable markers outside the qualified story and rejects an oversized chapter without truncation',async()=>{
 const books=new LocalBooks(process.cwd()),{book,selection}=await honglou(),section=book.sections[7];
 const units=section.units.map((u,i)=>i===section.units.length-1?{...u,text:'另一故事有缺字□，不得猜补。'}:u);
 books.book=async()=>({...book,sections:[{...section,units}]});
 const original=await books.storyOriginal(selection);assert.match(original.chapterContext.text,/缺字□/);assert.doesNotMatch(original.text,/□/);
 units.at(-1).text='原文'.repeat(1000001);
 await assert.rejects(books.storyOriginal(selection),e=>e.status===400&&/原文不会截断/.test(e.message));
});
