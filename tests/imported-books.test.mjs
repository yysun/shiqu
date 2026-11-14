// 验证导入书快照、结构质量预览、版次与替换生命周期。
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,rename,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {strToU8} from 'fflate';
import {ImportedBooks} from '../server/imported-books.ts';
import {storyCardsSchema} from '../server/local-story-search.ts';
import {localSourceSchema} from '../lib/reader-local-contract.ts';

const metadata={title:'测试书',author:'作者',sourceNote:'原始网页',license:'允许本地改编',acceptRights:true};
const body=(ending='庄周醒来后，回想梦中化蝶的自由，心中仍不能分辨自己与蝴蝶。')=>[
 '第一章 梦蝶',
 '庄周梦见自己成为蝴蝶，在天地之间自在飞翔。朋友听完以后，认真追问梦醒之后他如何看待这段经历。',
 '第二章 醒来',
 ending+'庄周没有急着下结论，而是继续思考人与万物之间的变化。',
].join('\n');

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-imported-books-'));t.after(()=>rm(root,{recursive:true,force:true}));return new ImportedBooks(root);}
async function importText(books,text,title=metadata.title){const draft=await books.createDraft({...metadata,title});await books.appendSource(draft.id,{bytes:strToU8(text),name:'book.txt'});return draft;}

test('source originals are immutable, confirmed books materialize locally and corruption fails closed',async t=>{
 const books=await fixture(t),draft=await importText(books,body());const result=await books.confirm(draft.id),book=await books.readBook(result.id),manifest=await books.manifestFor(result.id);
 assert.equal(result.status,'ready');assert.equal(book.sections.length,2);assert.equal(book.importedSourceDisclosure.license,metadata.license);assert.equal(manifest.sources[0].originalName,'book.txt');
 assert.deepEqual(await books.cardCacheKeysForCleanup(result.id),[]);
 const original=path.join(books.booksDirectory,result.id,manifest.sources[0].file);await writeFile(original,'changed after import');
 await assert.rejects(books.readBook(result.id),/校验失败/);
});

test('draft preview reports quality counts and exposes each affected original passage before confirmation',async t=>{
 const books=await fixture(t),text=body().replace('朋友听完以后','朋友听完以后□。\n未解析实体&KR0899;。\n拆字【上鹿下旨】。\n编者记为（原缺）。'),draft=await importText(books,text),preview=await books.preview(draft.id),chapter=preview.chapters[0],flags=chapter.flaggedUnits.flatMap(unit=>unit.flags);
 assert.ok(preview.manifest.quality.unreadableUnits>=4);assert.ok(preview.manifest.quality.missingMarkers>=2);assert.ok(chapter.quality.unreadableUnits>=4);assert.ok(chapter.flaggedUnits.length>=4);
 for(const flag of ['unreadable-glyph','missing-marker','unresolved-entity','component-layout','editorial-omission'])assert.ok(flags.includes(flag),flag);
 for(const text of ['□','&KR0899;','【上鹿下旨】','（原缺）'])assert.ok(chapter.flaggedUnits.some(unit=>unit.text.includes(text)),text);
});

test('replacement rebinds only a unique unchanged chapter card and resets changed chapter progress',async t=>{
 const books=await fixture(t),draft=await importText(books,body()),result=await books.confirm(draft.id),oldBook=await books.readBook(result.id),[same]=oldBook.sections;
 const oldCard={id:'same-card',title:'梦蝶',summary:'庄周梦蝶，醒后继续思考。',source:{sectionId:same.id,firstUnit:same.units[0].id,lastUnit:same.units.at(-1).id}};
 await writeFile(path.join(books.booksDirectory,result.id,'cards.json'),JSON.stringify(storyCardsSchema.parse({version:1,bookId:result.id,edition:oldBook.edition,cards:[oldCard]})));
 const oldProgress={version:1,bookId:result.id,edition:oldBook.edition,status:'complete',updatedAt:new Date().toISOString(),provider:'codex',model:'mock',chapters:oldBook.sections.map(section=>({sectionId:section.id,title:section.title,status:'done',attempts:1,completedWindows:1,totalWindows:1,cacheKeys:['old-cache']})),calls:2,inputTokens:20,outputTokens:10,unknownUsage:0,durations:[40]};
 await writeFile(path.join(books.booksDirectory,result.id,'card-progress.json'),JSON.stringify(oldProgress));
 const replacement=await importText(books,body('结尾发生变化。朋友听到消息后提出新的问题，庄周决定再寻找事情的缘由。'));
 const next=await books.replace(result.id,replacement.id),newBook=await books.readBook(result.id),saved=await books.readCards(result.id),cards=storyCardsSchema.parse(saved.value),progress=JSON.parse(await readFile(path.join(books.booksDirectory,result.id,'card-progress.json'),'utf8'));
 assert.notEqual(next.edition,oldBook.edition);assert.equal(cards.edition,newBook.edition);assert.equal(cards.cards.length,1);
 const rebound=localSourceSchema.parse({...cards.cards[0].source,edition:newBook.edition});assert.equal(rebound.sectionId,newBook.sections[0].id);assert.equal(rebound.firstUnit,newBook.sections[0].units[0].id);assert.equal(rebound.lastUnit,newBook.sections[0].units.at(-1).id);
 assert.equal(progress.chapters.find(chapter=>chapter.sectionId===newBook.sections[0].id).status,'done');assert.equal(progress.chapters.find(chapter=>chapter.sectionId===newBook.sections[1].id).status,'pending');assert.deepEqual(progress.chapters[0].cacheKeys,[]);
});

test('replacement crash recovery restores old books, commits valid targets and isolates damaged backups',async t=>{
 const books=await fixture(t),first=await importText(books,body(),'旧版本'),original=await books.confirm(first.id),originalPath=path.join(books.booksDirectory,original.id),
  marker=(id,suffix='00000000-0000-4000-8000-000000000001')=>path.join(books.libraryDirectory,`.book-replace-${id}-${suffix}`);
 const unchanged=await books.readBook(original.id);assert.equal(unchanged.title,'旧版本');
 const beforeRename=await books.list();assert.equal(beforeRename.find(book=>book.id===original.id).status,'ready');
 const between=marker(original.id);await rename(originalPath,between);await books.cleanup();assert.equal((await books.readBook(original.id)).title,'旧版本');

 const oldSnapshot=path.join(books.libraryDirectory,'old-snapshot');await cp(originalPath,oldSnapshot,{recursive:true});
 const replacement=await importText(books,body('替换后的结尾。朋友思考之后找到新的答案。'),'新版本'),next=await books.replace(original.id,replacement.id),committedBackup=marker(original.id,'00000000-0000-4000-8000-000000000002');
 await rename(oldSnapshot,committedBackup);await books.cleanup();assert.equal((await books.readBook(original.id)).title,'新版本');await assert.rejects(readFile(committedBackup));

 const validBackup=marker(original.id,'00000000-0000-4000-8000-000000000003'),invalidTarget=path.join(books.booksDirectory,original.id);await rename(invalidTarget,validBackup);await mkdir(invalidTarget,{recursive:true});await writeFile(path.join(invalidTarget,'manifest.json'),'{}');
 await books.cleanup();assert.equal((await books.readBook(original.id)).title,'新版本');

 const damaged=await importText(books,body(),'损坏备份的书'),damagedReady=await books.confirm(damaged.id),other=await importText(books,body(),'仍可用的书'),otherReady=await books.confirm(other.id),damagedPath=path.join(books.booksDirectory,damagedReady.id),badBackup=marker(damagedReady.id,'00000000-0000-4000-8000-000000000004');
 await rename(damagedPath,badBackup);await writeFile(path.join(badBackup,'manifest.json'),'{}');
 const listed=await books.list();assert.equal(listed.find(book=>book.id===damagedReady.id).status,'unavailable');assert.equal(listed.find(book=>book.id===otherReady.id).status,'ready');
 await assert.rejects(books.readBook(damagedReady.id),/替换恢复失败/);assert.equal((await books.readBook(otherReady.id)).title,'仍可用的书');
});

test('cache keys are registered independently and a missing or corrupt registry fails closed',async t=>{
 const books=await fixture(t),draft=await importText(books,body()),ready=await books.confirm(draft.id),key='a'.repeat(64),registry=path.join(books.booksDirectory,ready.id,'card-cache-keys.json');
 await books.registerCardCacheKey(ready.id,key);assert.deepEqual(await books.cardCacheKeysForCleanup(ready.id),[key]);
 await writeFile(path.join(books.booksDirectory,ready.id,'card-progress.json'),'{');assert.deepEqual(await books.cardCacheKeysForCleanup(ready.id),[key]);
 await writeFile(registry,'{');await assert.rejects(books.cardCacheKeysForCleanup(ready.id),/缓存键索引缺失或损坏/);
 await rm(registry);await assert.rejects(books.cardCacheKeysForCleanup(ready.id),/缓存键索引缺失或损坏/);
});
