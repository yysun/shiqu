// Verify the forty licensed Wiki volumes, nine-act finale, exact glyphs and immutable receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {readFile,mkdtemp,cp,rm,writeFile,unlink,symlink,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LocalBooks} from '../server/local-books.ts';
import {readWikiBody} from '../server/local-book-html.ts';
import {bookInputs} from '../server/local-book-inputs.ts';
const selection={bookId:'二刻拍案惊奇',theme:'聪明与糊涂',length:8},library=new LocalBooks(process.cwd()),catalog=JSON.parse(await readFile('data/library/catalog.json','utf8')),entry=catalog.books.find(b=>b.id===selection.bookId),directory=path.join('data/library',entry.originalFile);
const reference=(book,section,first,last=first)=>({edition:book.edition,sectionId:section.id,firstUnit:section.units[first].id,lastUnit:section.units[last].id});

test('forty Wiki volumes retain every parsed body glyph and the complete nine-act finale',async()=>{
 const book=await library.book(selection),parts=bookInputs(book),seen=new Set(parts.flatMap(part=>[...part.visible]));assert.equal(book.sections.length,40);assert.equal(entry.originalFiles.length,41);assert.deepEqual(entry.supplements,[]);
 const bodies=[];
 for(const [index,item] of entry.originalFiles.slice(0,40).entries()){
  const raw=await readFile(path.join(directory,item.file));assert.equal(createHash('sha256').update(raw).digest('hex'),item.sha256);
  const body=readWikiBody(raw.toString()).blocks.map(b=>b.text).join('').replace(/\s/g,'');bodies.push(body);
  const section=book.sections[index];assert.equal(section.id,`erke-${String(index+1).padStart(3,'0')}`);assert.equal(section.units.map(u=>u.text).join('').replace(/\s/g,''),body);assert.ok(body.length>5000,item.file);
  for(const unit of section.units)assert.ok(seen.has(unit.id),unit.id);
  assert.equal(section.url,item.sourceUrl);assert.equal(new URL(section.url).searchParams.get('title'),`二刻拍案驚奇/${String(index+1).padStart(2,'0')}`);
 }
 assert.equal(new Set(bodies).size,40);
 const play=book.sections.at(-1);assert.match(play.title,/宋公明.*雜劇.*杂剧/);assert.deepEqual([...bodies.at(-1).matchAll(/第([一二三四五六七八九]+)折/g)].map(m=>m[0]),['第一折','第二折','第三折','第四折','第五折','第六折','第七折','第八折','第九折']);assert.ok(bodies.at(-1).endsWith('合編成妝點《鬧元宵》。'));assert.ok(parts.at(-1).visible.has(play.units.at(-1).id));
 await assert.rejects(access('data/library/originals/21-二刻拍案惊奇-汉川草庐'));await assert.rejects(access('data/library/supplements/二刻拍案惊奇-40.html'));
});

test('final-play receipts resolve exact Wiki glyphs and reject old editions or invalid ranges',async()=>{
 const book=await library.book(selection),section=book.sections.at(-1),index=section.units.findIndex(u=>u.narrative&&u.text.length>=20),ref=reference(book,section,index),source=library.resolve(book,ref);
 assert.equal(source.text,section.units[index].text);assert.equal(source.url,section.url);assert.match(source.title,/宋公明.*杂剧/);
 const old='c1c842e57c6c54d5281570d16faf0f7d23e4fb2c9e98740e133a284deb126997';
 for(const bad of [{...ref,edition:old},{...ref,firstUnit:'erke-039-001'},{...ref,firstUnit:'missing'},reference(book,section,index+1,index)])assert.throws(()=>library.resolve(book,bad),e=>e.status===400);
});

test('missing, damaged, reordered or escaped original collections fail closed',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-erke-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp('data/library',path.join(root,'data/library'),{recursive:true});const file=path.join(root,directory,'040.html'),bytes=await readFile(file);
 await writeFile(file,'broken');await assert.rejects(new LocalBooks(root).book(selection),e=>e.status===503);
 await unlink(file);await assert.rejects(new LocalBooks(root).book(selection),e=>e.status===503);
 const outside=path.join(root,'outside.html');await writeFile(outside,bytes);await symlink(outside,file);await assert.rejects(new LocalBooks(root).book(selection),e=>e.status===503);await unlink(file);await writeFile(file,bytes);
 const metadata=path.join(root,'data/library/catalog.json'),data=structuredClone(catalog),changed=data.books.find(b=>b.id===entry.id);changed.originalFiles.reverse();await writeFile(metadata,JSON.stringify(data));await assert.rejects(new LocalBooks(root).book(selection),e=>e.status===503);
});
