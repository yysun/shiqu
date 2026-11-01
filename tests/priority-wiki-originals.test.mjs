// Verify the two adopted editions, exact original glyphs, reviewed exceptions and source-integrity failures.
import test from'node:test';import assert from'node:assert/strict';import{readFile,writeFile,readdir,mkdtemp,cp,rm,symlink}from'node:fs/promises';import path from'node:path';import os from'node:os';import{createHash}from'node:crypto';
import{LocalBooks}from'../server/local-books.ts';import{parseWikiStories}from'../server/local-book-wiki-stories.ts';import{readWikiBody}from'../server/local-book-html.ts';import{hasSourceAnomaly,hasBlockingSourceAnomaly}from'../server/local-source-quality.ts';import{bookInputs}from'../server/local-book-inputs.ts';import{withLocalBooks}from'../server/local-generation.ts';
import{localReadingPrompt}from'../lib/reader-local-contract.ts';
const catalog=JSON.parse(await readFile('data/library/catalog.json')),library=new LocalBooks(process.cwd()),ids=['红楼梦','喻世明言'],selection=bookId=>({bookId,theme:'理解与体谅',length:8,voice:false,artStyle:'ink-pencil'}),entry=id=>catalog.books.find(b=>b.id===id),squash=s=>s.replace(/\s/g,''),parts=async id=>Promise.all(entry(id).originalFiles.map(async item=>({item,raw:await readFile(path.join('data/library',entry(id).originalFile,item.file),'utf8')})));
const receipt=(b,s,u)=>({edition:b.edition,sectionId:s.id,firstUnit:u.id,lastUnit:u.id});

test('legacy numeric chapter labels still locate the pinned original, and every reading path carries the same exception policy',async()=>{
 const b=await library.book(selection('红楼梦'));
 for(const [number,labels]of [[100,['第一零零回','第一○○回','第一百回']],[101,['第一零一回','第一○一回','第一百零一回']],[110,['第一一零回','第一一○回','第一百一十回']],[120,['第一二零回','第一二○回','第一百二十回']]])for(const label of labels){const original=await library.legacy(selection('红楼梦'),{sourceReference:`《红楼梦·${label}》`});assert.equal(original.localSource.sectionId,`honglou-${number}`);assert.equal(original.text,b.sections[number-1].units.map(u=>u.text).join('\n\n'));}
 for(const purpose of [undefined,'scan']){const prompt=localReadingPrompt({title:'红楼梦',edition:b.edition,text:'原文',purpose});assert.match(prompt,/红楼第58回/);assert.match(prompt,/喻世第37卷/);assert.match(prompt,/缺少完整上下文时仍不选/);}
});

test('all 120/40 chapters preserve every reading glyph, source heading and final verse from pinned originals',async()=>{
 for(const id of ids){const e=entry(id),b=await library.book(selection(id)),raw=await parts(id),honglou=id==='红楼梦';assert.equal(b.sections.length,honglou?120:40);assert.equal(raw.length,honglou?13:41);assert.equal(b.edition,e.source.sha256);
  assert.deepEqual(await readdir(path.join('data/library',e.originalFile)),e.originalFiles.map(f=>f.file));
  for(const p of raw)assert.equal(createHash('sha256').update(await readFile(path.join('data/library',e.originalFile,p.item.file))).digest('hex'),p.item.sha256);
  for(const [index,p]of raw.slice(0,-1).entries()){
   const sections=b.sections.slice(honglou?index*10:index,honglou?index*10+10:index+1),actual=sections.map(s=>(honglou?s.title:'')+s.units.map(u=>u.text).join('')).join(''),expected=readWikiBody(p.raw).blocks.map(b=>b.text).join('');assert.equal(squash(actual),squash(expected),id+p.item.file);
   for(const s of sections){assert.equal(s.url,p.item.sourceUrl);assert.ok(s.units.reduce((n,u)=>n+u.text.length,0)>3500);}
  }
  assert.doesNotMatch(b.input.text,/window\._ROUTER_DATA|姊妹计划|返回頂部|Public domain|\.mw-parser-output/);
  const inputs=bookInputs(b),seen=new Set(inputs.flatMap(p=>[...p.visible]));for(const s of b.sections)for(const u of s.units)assert.ok(seen.has(u.id),u.id);assert.ok(inputs.every(p=>p.input.text.length<=100000));assert.ok(inputs.at(-1).visible.has(b.sections.at(-1).units.at(-1).id));
 }
 const h=await library.book(selection(ids[0])),y=await library.book(selection(ids[1]));assert.match(h.sections[79].title,/第八十回/);assert.match(h.sections[80].title,/第八十一回/);assert.match(h.sections[99].title,/第一○○回/);assert.match(h.sections.at(-1).units.at(-1).text,/由來同一夢，休笑世人痴/);assert.match(y.sections.at(-1).units.at(-1).text,/皇天果報自昭彰/);
});

test('only the two reviewed edition/chapter/context combinations authorize unchanged anomalous source text',async()=>{
 for(const id of ids){const b=await library.book(selection(id)),bad=b.sections.flatMap(s=>s.units.filter(u=>hasSourceAnomaly(u.text)).map(u=>({s,u})));assert.equal(bad.length,1);
  const {s,u}=bad[0],ref=receipt(b,s,u),original=library.resolve(b,ref);assert.equal(original.text,u.text);assert.equal(hasBlockingSourceAnomaly(u.text,ref),false);assert.ok(original.text.includes(id==='红楼梦'?'⿰烏刂':'\ue853'));
  for(const [text,source]of [[u.text+'□',ref],[u.text,{...ref,edition:'a'.repeat(64)}],[u.text,{...ref,sectionId:'other-001'}],[u.text.slice(u.text.indexOf(id==='红楼梦'?'⿰':'\ue853')),ref],[u.text.replace(id==='红楼梦'?'也有修竹的':'范道受記了','前文不同'),ref]])assert.equal(hasBlockingSourceAnomaly(text,source),true);
  const altered={...b,sections:[{...s,title:'篇题□'}]};assert.throws(()=>library.resolve(altered,ref),e=>e.status===400);
  let calls=0,writes=0,received;const provider={generator:()=>({plan:async(_s,_id,o)=>{calls++;received=o;return{value:{},model:'mock',requestId:'mock'};}})},wrapped=withLocalBooks(provider,library,{put:async(_k,bytes)=>{writes++;assert.equal(JSON.parse(Buffer.from(bytes).toString()).text,u.text);}}).generator();
  const selected={...selection(id),source:ref},saved=await wrapped.prepareOriginal(selected,'test');await wrapped.plan(selected,'test',saved);assert.equal(writes,1);assert.equal(calls,1);assert.equal(received.text,u.text);
  await assert.rejects(wrapped.plan(selected,'test',{...saved,text:saved.text+'□'}),e=>e.status===400);assert.equal(calls,1);assert.equal(saved.text,u.text);
 }
});

test('page identities, chapter sequence, index order and pinned revision cannot drift',async()=>{
 for(const id of ids){const source=await parts(id);assert.ok(parseWikiStories(id,source));for(const change of [{revision:'1'},{pageTitle:'另一卷'},{requestedTitle:'另一卷'},{sourceUrl:'https://example.com/changed'}])assert.throws(()=>parseWikiStories(id,source.map((p,i)=>i? p:{...p,item:{...p.item,...change}})),/identity/);
  assert.throws(()=>parseWikiStories(id,[source[1],source[0],...source.slice(2)]),/identity/);
 }
 const h=await parts(ids[0]);assert.throws(()=>parseWikiStories(ids[0],h.map((p,i)=>i?p:{...p,raw:p.raw.replace(/第一回/g,'第三回')})),/sequence|identity/);
 const y=await parts(ids[1]);assert.throws(()=>parseWikiStories(ids[1],y.map((p,i)=>i===40?{...p,raw:p.raw.replace(/第一卷/g,'第二卷')}:p)),/sequence/);
 for(const id of ids){const b=await library.book(selection(id)),s=b.sections[0],u=s.units.find(u=>u.narrative),ref=receipt(b,s,u);assert.throws(()=>library.resolve(b,{...ref,edition:id==='红楼梦'?'fdbf7963910834f5932dc491f44b83cee92f847f6ffc387c47bdaebb6b22bf04':'f032b1a830b34aa82a2ffe9558a797039a0ac45fdb050da6cc1b1418abc975b7'}),e=>e.status===400);}
});

test('missing, altered, extra and escaped original members fail before a book is exposed',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-priority-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=path.join(root,'data/library');await cp('data/library',directory,{recursive:true});
 for(const id of ids){const e=entry(id),folder=path.join(directory,e.originalFile),target=path.join(folder,'001.html'),bytes=await readFile(target);await writeFile(target,'tampered');await assert.rejects(new LocalBooks(root).book(selection(id)),e=>e.status===503);await writeFile(target,bytes);
  const index=path.join(folder,'index.html'),indexBytes=await readFile(index);await rm(index);await assert.rejects(new LocalBooks(root).book(selection(id)),e=>e.status===503);await writeFile(index,indexBytes);
  await writeFile(path.join(folder,'extra.txt'),'extra');await assert.rejects(new LocalBooks(root).book(selection(id)),e=>e.status===503);await rm(path.join(folder,'extra.txt'));
  await rm(target);await writeFile(path.join(root,'outside.html'),bytes);await symlink(path.join(root,'outside.html'),target);await assert.rejects(new LocalBooks(root).book(selection(id)),e=>e.status===503);await rm(target);await writeFile(target,bytes);assert.ok(await new LocalBooks(root).book(selection(id)));
 }
});
