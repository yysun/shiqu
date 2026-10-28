// Verify forty pinned original volumes, final play completeness and exact local citation receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {readFile,mkdtemp,cp,rm,writeFile,unlink,symlink,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LocalBooks} from '../server/local-books.ts';
import {parseErkeVolume} from '../server/local-book-erke.ts';
import {bookInputs} from '../server/local-book-inputs.ts';
const selection={bookId:'二刻拍案惊奇',theme:'聪明与糊涂',length:8},library=new LocalBooks(process.cwd()),catalog=JSON.parse(await readFile('data/library/catalog.json','utf8')),entry=catalog.books.find(b=>b.id===selection.bookId),directory=path.join('data/library',entry.originalFile);
const reference=(book,section,first,last=first)=>({edition:book.edition,sectionId:section.id,firstUnit:section.units[first].id,lastUnit:section.units[last].id});

test('forty original volumes retain every body glyph; all units including nine-fold finale are read',async()=>{
 const book=await library.book(selection),parts=bookInputs(book),seen=new Set(parts.flatMap(part=>[...part.visible]));assert.equal(book.sections.length,40);assert.equal(entry.originalFiles.length,40);assert.deepEqual(entry.supplements,[]);assert.equal(parts.length,5);
 const bodies=[];
 for(const [index,item] of entry.originalFiles.entries()){
  const raw=await readFile(path.join(directory,item.file));assert.equal(createHash('sha256').update(raw).digest('hex'),item.sha256);
  const body=raw.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n').slice(1).map(s=>s.trim()).filter(Boolean).join('');bodies.push(body);
  const section=book.sections[index];assert.equal(section.id,`erke-${String(index+1).padStart(3,'0')}`);assert.equal(section.units.map(u=>u.text).join(''),body);assert.ok(body.length>7000);
  for(const unit of section.units)assert.ok(seen.has(unit.id),unit.id);
  assert.equal(section.url,entry.source.url.replace('/tree/','/blob/')+'/'+encodeURIComponent(item.file));
 }
 assert.equal(new Set(bodies).size,40);
 const play=book.sections.at(-1);assert.equal(play.title,'卷四十 宋公明闹元宵杂剧（杂剧）');assert.deepEqual([...bodies.at(-1).matchAll(/第([一二三四五六七八九]+)折/g)].map(m=>m[0]),['第一折','第二折','第三折','第四折','第五折','第六折','第七折','第八折','第九折']);assert.ok(bodies.at(-1).endsWith('合编成妆点《闹元宵》。'));assert.equal((bodies.at(-1).match(/\?/g)||[]).length,11,'原件问号不猜补');assert.ok(parts.at(-1).visible.has(play.units.at(-1).id));
 assert.match(entry.scope,/刊本未注明/);assert.match(entry.scope,/未收序/);
 await assert.rejects(access('data/library/originals/21-二刻拍案惊奇.md'));await assert.rejects(access('data/library/supplements/二刻拍案惊奇-40.html'));
});

test('new final-play references resolve exact TXT glyphs and reject old editions or invalid ranges',async()=>{
 const book=await library.book(selection),section=book.sections.at(-1),index=section.units.findIndex(u=>u.text.length>=20&&/[。！？!?，；：]/.test(u.text)),ref=reference(book,section,index),source=library.resolve(book,ref);
 assert.equal(source.text,section.units[index].text);assert.equal(source.url,section.url);assert.match(source.title,/卷四十.*杂剧/);
 const old=createHash('sha256').update('dd5ef529887b74ec16beeb32142dc638705a40b64b33ff76fd5db47b74fc3307\n862e038ba4982a90e3daf39b865858f9f15fc6329d0b4f4622af75c9a7ac1d47').digest('hex');
 for(const bad of [{...ref,edition:old},{...ref,firstUnit:'erke-039-001'},{...ref,firstUnit:'missing'},reference(book,section,index+1,index)])assert.throws(()=>library.resolve(book,bad),e=>e.status===400);
 const raw=await readFile(path.join(directory,entry.originalFiles.at(-1).file),'utf8');assert.throws(()=>parseErkeVolume(raw,39,''));assert.throws(()=>parseErkeVolume(raw.replace('第九折','第八折'),40,''));assert.throws(()=>parseErkeVolume(raw.replace('合编成妆点《闹元宵》。',''),40,''));
});

test('missing, damaged, reordered or escaped original collections fail closed',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-erke-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp('data/library',path.join(root,'data/library'),{recursive:true});const file=path.join(root,directory,entry.originalFiles.at(-1).file),bytes=await readFile(file);
 await writeFile(file,'broken');await assert.rejects(new LocalBooks(root).book(selection),e=>e.status===503);
 await unlink(file);await assert.rejects(new LocalBooks(root).book(selection),e=>e.status===503);
 const outside=path.join(root,'outside.txt');await writeFile(outside,bytes);await symlink(outside,file);await assert.rejects(new LocalBooks(root).book(selection),e=>e.status===503);await unlink(file);await writeFile(file,bytes);
 const metadata=path.join(root,'data/library/catalog.json'),data=structuredClone(catalog),changed=data.books.find(b=>b.id===entry.id);changed.originalFiles.reverse();await writeFile(metadata,JSON.stringify(data));await assert.rejects(new LocalBooks(root).book(selection),e=>e.status===503);
});
