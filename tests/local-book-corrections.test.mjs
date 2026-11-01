// Prove the two evidenced insertions, stable derived receipts and unchanged historical checkpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LocalBooks,parseLocalSections,originalBody} from '../server/local-books.ts';
import {correctShishuo,shishuoOriginalEdition,shishuoCorrectionUrl} from '../server/local-book-corrections.ts';
import {withLocalBooks} from '../server/local-generation.ts';

const selection={bookId:'shishuo',storyTitle:'绝妙好辞（杨修解曹操碑字）',theme:'给我一个反转',length:12};
test('only two missing characters change, with unit-level provenance and a stable derived edition',async()=>{
 const raw=await readFile('data/library/originals/03-世说新语.txt');
 assert.equal(createHash('sha256').update(raw).digest('hex'),shishuoOriginalEdition);
 const before=parseLocalSections('shishuo',originalBody(raw.toString('utf8'),'Project Gutenberg'));
 const books=new LocalBooks(process.cwd()),book=await books.book(selection),again=await new LocalBooks(process.cwd()).book(selection);
 assert.notEqual(book.edition,shishuoOriginalEdition);assert.equal(book.edition,again.edition);
 const after=book.sections.flatMap(section=>section.units),old=before.flatMap(section=>section.units);
 assert.equal(after.length,1129);assert.equal(after.length,old.length);
 for(let i=0;i<after.length;i++){
  assert.equal(after[i].id,old[i].id);
  if(after[i].id!=='shishuo-11-003'){assert.deepEqual(after[i],old[i]);continue;}
  assert.equal(after[i].text,old[i].text.replace('外孫臼」八字','外孫齏臼」八字').replace('臼，受辛也','齏臼，受辛也'));
  assert.equal(after[i].text.length,old[i].text.length+2);assert.equal(after[i].url,shishuoCorrectionUrl);
  assert.ok(book.input.text.includes(after[i].text));
 }
 const ref={edition:book.edition,sectionId:'shishuo-11',firstUnit:'shishuo-11-003',lastUnit:'shishuo-11-003'};
 const source=await books.storyOriginal({...selection,source:ref});
 assert.equal(source.url,shishuoCorrectionUrl);assert.match(source.provider,/Project Gutenberg.*仅校补两处/);
 assert.match(source.text,/外孫齏臼/);assert.match(source.text,/齏臼，受辛也/);
 assert.equal(books.resolve(book,{...ref,firstUnit:'shishuo-11-002',lastUnit:'shishuo-11-002'}).url,book.url);
 assert.throws(()=>correctShishuo('shishuo','0'.repeat(64),before),/Unreviewed/);
 assert.throws(()=>correctShishuo('shishuo',shishuoOriginalEdition,book.sections),/context changed/);
});
test('corrected and historical matching originals pass the production gate, mismatched ones fail',async()=>{
 const books=new LocalBooks(process.cwd()),book=await books.book(selection);
 const source={edition:book.edition,sectionId:'shishuo-11',firstUnit:'shishuo-11-003',lastUnit:'shishuo-11-003'};
 const chosen={...selection,source},original=await books.storyOriginal(chosen);let calls=0;
 const generator=withLocalBooks({generator:()=>({plan:async()=>{calls++;return {value:{},model:'stub'};}})},books,{}).generator();
 await generator.plan(chosen,'check',original);
 const historical={...source,edition:shishuoOriginalEdition};
 await generator.plan({...chosen,source:historical},'check',{...original,localSource:historical,text:original.text.replaceAll('齏','')});
 await assert.rejects(generator.plan(chosen,'check',{...original,localSource:historical}),/原文尚未在本地核对/);
 await assert.rejects(generator.plan({...chosen,source:undefined},'check',original),/原文尚未在本地核对/);
 assert.equal(calls,2);
});
