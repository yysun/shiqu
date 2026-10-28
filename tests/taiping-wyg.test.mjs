// Verify a uniform original edition, layout-only parsing, and strict local citation receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,cp,writeFile,unlink,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {LocalBooks} from '../server/local-books.ts';
import {parseWygVolume} from '../server/local-book-wyg.ts';
import {bookInputs} from '../server/local-book-inputs.ts';
const selection={bookId:'太平广记',theme:'聪明与糊涂',artStyle:'ink-pencil',length:8,voice:false};
const root=process.cwd(),library=new LocalBooks(root),entry=JSON.parse(await readFile('data/library/catalog.json','utf8')).books.find(b=>b.id===selection.bookId),directory=path.join('data/library',entry.originalFile);
const reference=(book,section,first,last=first)=>({edition:book.edition,sectionId:section.id,firstUnit:section.units[first].id,lastUnit:section.units[last].id});

test('500 original WYG volumes preserve all narrative lines, glyphs and final volume in bounded reading',async()=>{
 const book=await library.book(selection);assert.equal(book.sections.length,500);assert.equal(entry.supplements.length,0);assert.equal(entry.originalFiles.length,502);
 assert.deepEqual((await readdir(directory)).sort(),entry.originalFiles.map(f=>f.file));
 for(const item of entry.originalFiles){const bytes=await readFile(path.join(directory,item.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);}
 const seen=new Set(),inputs=bookInputs(book);assert.equal(inputs.length,36);
 for(const {input,visible} of inputs){assert.ok(input.text.length<=100000);for(const id of visible)seen.add(id);}
 for(let number=1;number<=500;number++){
  const section=book.sections[number-1],raw=await readFile(path.join(directory,`KR3l0118_${String(number).padStart(3,'0')}.txt`),'utf8');
  const lines=raw.split('\n').filter(line=>!line.startsWith('#')&&!line.startsWith('<pb:')).map(line=>line.replace(/¶$/,''));const start=lines.findIndex(line=>/^\u3000{4}[^\s]/u.test(line)),end=lines.findLastIndex(line=>/^\u3000[太大]平廣記[卷巻]/u.test(line));
  assert.equal(section.units.map(u=>u.text).join('\n'),lines.slice(start,end).map(s=>s.trim()).filter(Boolean).join('\n'),`原字/行完整 ${number}`);
  for(const unit of section.units)assert.ok(seen.has(unit.id),unit.id);
  assert.doesNotMatch(section.units.map(u=>u.text).join('\n'),/\uFFFD|[\uE000-\uF8FF]|<pb:|¶|PROPERTY:|欽定四庫全書/);
 }
 assert.equal(book.sections[173].units[0].text,'陽玠');assert.match(book.sections[173].units[1].text,/隋京兆杜公瞻/);
 assert.equal(book.sections[298].units[0].text,'韋安道');assert.match(book.sections[298].units[1].text,/京兆韋安道/);
 assert.match(book.sections.at(-1).units.at(-1).text,/舉家大笑遂安寢/);assert.ok(inputs.at(-1).visible.has(book.sections.at(-1).units.at(-1).id));
 await assert.rejects(readFile('data/library/originals/15-太平广记.md'));
 assert.equal((await readdir('data/library/supplements').catch(error=>{if(error.code==='ENOENT')return [];throw error;})).filter(n=>n.startsWith('太平')).length,0);
});

test('unpunctuated originals resolve exactly; titles, stale editions and invalid ranges fail',async()=>{
 const book=await library.book(selection),section=book.sections[173];
 const ref=reference(book,section,1,2),source=library.resolve(book,ref);assert.equal(source.text,section.units.slice(1,3).map(u=>u.text).join('\n\n'));
 assert.doesNotMatch(source.text,/[。！？!?，；：]/);assert.match(source.text,/衛尉臺卿/);assert.match(source.url,/\/blob\/7990feeb9c302e37942661d1b29abc22818cc204\/KR3l0118_174.txt$/);assert.match(source.provider,/文渊阁/);
 for(const bad of [reference(book,section,0),{...ref,edition:'e19aaf6ea30c2b24e9448ba1ba8011cef4c58738192adcaaf02e90b72d1b41cb'},{...ref,firstUnit:'taiping-173-001'},reference(book,section,2,1)])assert.throws(()=>library.resolve(book,bad),e=>e.status===400);
 const heading={id:'head',title:'目录',units:[{id:'head-001',text:'東方朔 匡衡 邊文禮 荀慈明 曹植 諸葛恪 車浚 諸葛靚 蔡洪 范百年',narrative:false}]};assert.throws(()=>library.resolve({...book,sections:[heading]},reference(book,heading,0)),e=>e.status===400);
 const raw=await readFile(path.join(directory,'KR3l0118_174.txt'),'utf8');assert.throws(()=>parseWygVolume(raw,175,''));assert.throws(()=>parseWygVolume(raw.replace('太平廣記卷一百七十四','太平廣記卷一百七十三'),174,''));
});

test('missing, damaged, extra and escaped collection members cannot load',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'shiqu-wyg-'));t.after(()=>rm(folder,{recursive:true,force:true}));await cp('data/library',path.join(folder,'data/library'),{recursive:true});
 const file=path.join(folder,'data/library',entry.originalFile,'KR3l0118_174.txt'),bytes=await readFile(file);
 await writeFile(file,'broken');await assert.rejects(new LocalBooks(folder).book(selection),e=>e.status===503);
 await unlink(file);await assert.rejects(new LocalBooks(folder).book(selection),e=>e.status===503);
 await writeFile(file,bytes);const extra=path.join(path.dirname(file),'unexpected.txt');await writeFile(extra,'extra');await assert.rejects(new LocalBooks(folder).book(selection),e=>e.status===503);await unlink(extra);
 const catalogFile=path.join(folder,'data/library/catalog.json'),catalog=JSON.parse(await readFile(catalogFile,'utf8')),changed=catalog.books.find(b=>b.id===entry.id);changed.originalFiles[1].file='../outside.txt';await writeFile(catalogFile,JSON.stringify(catalog));await assert.rejects(new LocalBooks(folder).book(selection),e=>e.status===503);
});
