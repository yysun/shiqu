// Verify publication source boundaries, historical edition rejection, attribution and unchanged retained books.
import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';
import {readFile,writeFile,mkdtemp,cp,rm,access} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {LocalBooks} from '../server/local-books.ts';import {licensedBookSpecs,loadLicensedCollection,parseKanripoChapter} from '../server/local-book-licensed.ts';
import {hasSourceAnomaly} from '../server/local-source-quality.ts';import {pearSource,sourceUrl} from '../lib/content.ts';import {verifiedPassage} from '../lib/reader-source.ts';
const catalog=JSON.parse(await readFile('data/library/catalog.json','utf8')),baseline=JSON.parse(await readFile('tests/fixtures/publication-source-baseline.json','utf8')),library=new LocalBooks(process.cwd()),choose=bookId=>({bookId,theme:'人情冷暖',length:8,voice:false});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('all17 uncertain editions are replaced and seven retained collections keep original bytes with explicit errata versions',async()=>{
 assert.equal(catalog.books.length,24);assert.equal(Object.keys(licensedBookSpecs).length,17);let replaced=0,retained=0;
 for(const e of catalog.books){const old=baseline[e.id],b=await library.book(choose(e.id));
  if(e.source.url.includes('/kanripo/'))assert.match(e.source.attribution,/Kanripo/);else if(new URL(e.source.url).hostname==='zh.wikisource.org')assert.match(e.source.attribution,/维基文库/);
  if(!old.replaced){retained++;assert.equal(e.originalFile,old.originalFile);if(e.id==='shishuo'){assert.equal(hash(await readFile(path.join('data/library',e.originalFile))),old.sha256);assert.notEqual(b.edition,old.sha256);}else assert.equal(b.edition,old.sha256);continue;}
  replaced++;assert.notEqual(e.originalFile,old.originalFile);assert.notEqual(b.edition,old.sha256);await assert.rejects(access(path.join('data/library',old.originalFile)));
  assert.equal(e.source.license,'CC-BY-SA-4.0');assert.match(e.source.attribution,/贡献者/);assert.match(b.provider,/CC BY-SA 4.0/);assert.equal(b.sections.length,licensedBookSpecs[e.id].count);
  const s=b.sections.find(s=>s.units.some(u=>{try{library.resolve(b,{edition:b.edition,sectionId:s.id,firstUnit:u.id,lastUnit:u.id});return true;}catch{return false;}}));assert.ok(s,e.id);
  const u=s.units.find(u=>{try{library.resolve(b,{edition:b.edition,sectionId:s.id,firstUnit:u.id,lastUnit:u.id});return true;}catch{return false;}}),ref={edition:b.edition,sectionId:s.id,firstUnit:u.id,lastUnit:u.id};
  assert.equal(library.resolve(b,ref).text,u.text);assert.throws(()=>library.resolve(b,{...ref,edition:old.sha256}),e=>e.status===400);
  for(const section of b.sections)for(const unit of section.units)if(hasSourceAnomaly(unit.text))assert.throws(()=>library.resolve(b,{edition:b.edition,sectionId:section.id,firstUnit:unit.id,lastUnit:unit.id}),e=>e.status===400);
 }
 assert.equal(replaced,17);assert.equal(retained,7);
});

test('Kanripo edition and chapter identities reject mismatches, and first/final chapters keep actual prose',async()=>{
 for(const[id,spec]of Object.entries(licensedBookSpecs).filter(([,s])=>s.repo)){
  const e=catalog.books.find(b=>b.id===id),b=await library.book(choose(id));assert.equal(b.sections.length,spec.count);
  for(let n=1;n<=spec.count;n++){
   const item=e.originalFiles.find(f=>f.file===`${spec.repo}_${String(n).padStart(3,'0')}.txt`),raw=await readFile(path.join('data/library',e.originalFile,item.file),'utf8');let body;
   if(spec.edition==='WYG'){const heads=[...raw.matchAll(/^[ \t\u3000]*(?:搜神記|博物志)[卷巻][一二三四五六七八九十]+[^\r\n]*$/gm)];assert.equal(heads.length,2);body=raw.slice(heads[0].index+heads[0][0].length,heads[1].index);}
   else{const heading=raw.match(/^\*\* \d+ [^\n]+\n/m);assert.ok(heading);body=raw.slice(heading.index+heading[0].length);}
   const expected=body.split('\n').filter(line=>!line.startsWith('#')).join('').replace(/<pb:[^>]+>|¶/g,'').replace(/\s/g,'');assert.equal(b.sections[n-1].units.map(u=>u.text).join('').replace(/\s/g,''),expected,`${id} ${n}: every original body glyph`);
  }
  for(const n of [1,spec.count]){const item=e.originalFiles.find(f=>f.file===`${spec.repo}_${String(n).padStart(3,'0')}.txt`),raw=await readFile(path.join('data/library',e.originalFile,item.file),'utf8'),s=b.sections[n-1];assert.ok(s.units.some(u=>u.narrative));assert.equal(s.url,item.sourceUrl);assert.throws(()=>parseKanripoChapter(id,n,raw.replaceAll(spec.repo,'WRONG'),''),/edition/);assert.throws(()=>parseKanripoChapter(id,n===1?2:1,raw,''));}
 }
 const z=await library.book(choose('zhuangzi'));assert.match(z.sections[0].units[0].text,/北冥有魚/);assert.match(z.sections[1].units.at(-1).text,/昔者莊周夢為胡蝶/);assert.match(z.sections.at(-1).units.at(-1).text,/是窮響以聲/);
 const w=await library.book(choose('战国策'));assert.match(w.sections[0].title,/秦興師臨周/);assert.match(w.sections.at(-1).title,/昭王既息民繕兵/);assert.doesNotMatch(w.input.text,/# src:|<pb:|¶|#\+PROPERTY/);
});

test('same-source narrative appendices preserve coverage and numbered chapter identities',async()=>{
 const xy=await library.book(choose('西游记'));assert.equal(xy.sections.length,101);assert.match(xy.sections[0].title,/第一回.*靈根育孕源流出/);assert.equal(xy.sections[7].id,'xiyou-008');assert.equal(xy.sections[8].id,'xiyou-000');assert.match(xy.sections[8].units.map(u=>u.text).join(''),/陳光蕊/);assert.equal(xy.sections[9].id,'xiyou-009');assert.equal(xy.sections.at(-1).id,'xiyou-100');
 const yw=await library.book(choose('阅微草堂笔记'));assert.equal(yw.sections.length,25);assert.match(yw.sections.at(-1).units.map(u=>u.text).join(''),/亡兒汝佶/);
});

test('replacement collections reject changed identities, extra files and a truncated final play even with refreshed manifest hashes',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'shiqu-license-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 for(const id of ['二刻拍案惊奇','zhuangzi']){const e=structuredClone(catalog.books.find(b=>b.id===id)),target=path.join(folder,id);await cp(path.join('data/library',e.originalFile),target,{recursive:true});const real=await import('node:fs/promises').then(fs=>fs.realpath(target));
  await writeFile(path.join(target,'unexpected.txt'),'extra');await assert.rejects(loadLicensedCollection(real,e),/manifest/);await rm(path.join(target,'unexpected.txt'));
  if(id==='二刻拍案惊奇'){
   const item=e.originalFiles.find(f=>f.file==='040.html'),file=path.join(target,item.file),bytes=await readFile(file,'utf8');await writeFile(file,bytes.replaceAll('第九折','第八折'));item.sha256=hash(await readFile(file));e.source.sha256=hash(e.originalFiles.map(f=>`${f.file}\t${f.sha256}`).join('\n'));await assert.rejects(loadLicensedCollection(real,e),/final play/);
   await writeFile(file,bytes);item.sha256=hash(bytes);e.source.sha256=hash(e.originalFiles.map(f=>`${f.file}\t${f.sha256}`).join('\n'));item.revision='1';await assert.rejects(loadLicensedCollection(real,e),/identity/);
  }
 }
});

test('the independently licensed historical Zhongli fallback remains available after changing demos',async()=>{
 const book=await library.book(choose('liaozhai')),s=book.sections[0],n=s.units.findIndex(u=>u.text==='種梨');assert.ok(n>=0);assert.equal(pearSource,s.units.slice(n+1,n+4).map(u=>u.text).join('\n\n'));assert.doesNotMatch(pearSource,/異史氏曰/);assert.equal(new URL(sourceUrl).searchParams.get('oldid'),'7908703');assert.ok(sourceUrl.endsWith('#種梨'));
 const known=verifiedPassage(choose('liaozhai'),{sourceReference:'《聊斋志异·种梨》',pages:[]});assert.equal(known.text,pearSource);assert.match(known.provider,/CC BY-SA 4.0/);
});
