// Compare all shipped HTML/SSR source glyphs and table cells, and exercise identity/edition failures.
import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';
import{readFile,writeFile,mkdtemp,cp,rm,symlink}from'node:fs/promises';import{createHash}from'node:crypto';import{parseDocument}from'htmlparser2';
import{LocalBooks}from'../server/local-books.ts';import{readWikiBody,parseWikiOriginal,parseShidianOriginal,readShidianData}from'../server/local-book-html.ts';import{bookInputs}from'../server/local-book-inputs.ts';
const root=process.cwd(),catalog=JSON.parse(await readFile('data/library/catalog.json','utf8')),ids=['山海经','酉阳杂俎','史记'],library=new LocalBooks(root),choose=bookId=>({bookId,theme:'机智',length:8,artStyle:'ink-pencil',voice:false});
const entry=id=>catalog.books.find(e=>e.id===id),file=(e,item)=>path.join(root,'data/library',e.originalFile,item.file),squash=s=>s.replace(/\s/g,''),stripMeta=s=>s.replace(/〔(?:表格版式：[\s\S]*?|列\d+[^〕]*|版式：小字|小字止|原件字形图：\d+)〕/g,'');
const all=n=>[n,...(n.children||[]).flatMap(all)],text=n=>n.type==='text'?n.data:(n.children||[]).map(text).join('');
const receipt=(b,s,u)=>({edition:b.edition,sectionId:s.id,firstUnit:u.id,lastUnit:u.id});

test('three collections pin every original byte and cover all sections and tail units without old font codes',async()=>{
 for(const [id,count,files]of [['山海经',18,20],['酉阳杂俎',30,65],['史记',130,131]]){
  const e=entry(id),b=await library.book(choose(id));assert.equal(e.originalFiles.length,files);assert.equal(b.sections.length,count);assert.equal(b.edition,e.source.sha256);
  for(const item of e.originalFiles)assert.equal(createHash('sha256').update(await readFile(file(e,item))).digest('hex'),item.sha256);
  assert.doesNotMatch(b.input.text,/[\uE000-\uF8FF\uFFFD\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]|&KR[\w-]+;|[⿰-⿿]/u);
  assert.doesNotMatch(b.input.text,/姊妹计划|返回頂部|Public domain|\.mw-parser-output|window\._ROUTER_DATA|文章還沒有/);
  const inputs=bookInputs(b),seen=new Set(inputs.flatMap(p=>[...p.visible]));assert.ok(inputs.every(p=>p.input.text.length<=100000));for(const s of b.sections)for(const u of s.units)assert.ok(seen.has(u.id));assert.ok(inputs.at(-1).visible.has(b.sections.at(-1).units.at(-1).id));
  const s=b.sections[0],u=s.units.find(u=>u.narrative&&!u.unreadable);assert.throws(()=>library.resolve(b,{...receipt(b,s,u),edition:'0'.repeat(64)}),e=>e.status===400);assert.equal(new URL(library.resolve(b,receipt(b,s,u)).url).hostname,id==='酉阳杂俎'?'www.shidianguji.com':'zh.wikisource.org');
 }
 const b=await library.book(choose('山海经'));assert.match(b.input.text,/䧿山|猨翼/);assert.match(b.input.text,/【〈/);const s=b.sections[12],u=s.units.find(u=>u.narrative&&u.text.includes('【〈'));assert.ok(library.resolve(b,receipt(b,s,u)),'Real annotation brackets are readable');
});

test('all Wiki reading glyphs and small annotations survive packaging in source order',async()=>{
 const furniture=new Set(['licenseContainer','noprint','ws-noexport','ws-header','header','ws-footer','mw-editsection','printfooter','reflist','references','mw-references-wrap','reference','thumb']);
 const flatten=node=>{
  if(['style','script','nav','footer','figure'].includes(node.name)||['headerContainer','toc','textquality'].includes(node.attribs?.id)||(node.attribs?.class||'').split(/\s+/).some(c=>furniture.has(c)))return '';
  if(node.type==='text')return node.data;
  return (node.children||[]).map(flatten).join('');
 };
 for(const id of ['山海经','史记']){
  const e=entry(id),b=await library.book(choose(id));
  for(const [index,section]of b.sections.entries()){
   const item=e.originalFiles.find(f=>f.file===`${String(index+1).padStart(3,'0')}.html`),raw=await readFile(file(e,item),'utf8'),doc=parseDocument(raw);
   const body=all(doc).filter(n=>(n.attribs?.class||'').split(/\s+/).includes('mw-parser-output')).sort((a,b)=>text(b).length-text(a).length)[0];
   assert.equal(squash(stripMeta(section.units.map(u=>u.text).join(''))),squash(flatten(body)),`${id} ${item.file}`);
  }
 }
});

test('all Shidian paragraphs retain every line type, original variants and 51 glyph-image positions',async()=>{
 const e=entry('酉阳杂俎'),b=await library.book(choose(e.id));let paragraphs=0,occurrences=0;const glyphs=new Set();
 for(const [index,item]of e.originalFiles.filter(f=>f.file.endsWith('.html')).entries()){
  const raw=await readFile(file(e,item),'utf8'),d=readShidianData(raw),section=b.sections[index];paragraphs+=d.paragraphList.length;
  const expected=d.paragraphList.map(p=>JSON.parse(p.content).lines.map(l=>{if(l.charPic){occurrences++;glyphs.add(l.charPic.charPicId);return `□`;}return l.content;}).join('')).join('');
  assert.equal(squash(stripMeta(section.units.map(u=>u.text).join(''))),squash(expected),item.file);
  for(const u of section.units.filter(u=>u.unreadable))assert.throws(()=>library.resolve(b,receipt(b,section,u)),e=>e.status===400);
 }
 assert.equal(paragraphs,1390);assert.equal(occurrences,51);assert.equal(glyphs.size,35);assert.equal((b.input.text.match(/□/g)||[]).length,53);assert.match(b.input.text,/大羮/);assert.match(b.input.text,/〔版式：小字〕成式〔小字止〕/);assert.match(b.input.text,/眞龍/);assert.doesNotMatch(b.input.text,/亻囘|莖力/);
 const first=e.originalFiles[0],raw=await readFile(file(e,first),'utf8');assert.notEqual(squash(text(all(parseDocument(raw)).find(n=>n.name==='article'))),squash(b.sections[0].units.map(u=>u.text).join('')),'Display article must not overwrite SSR glyphs');
 for(const field of [{bookVersion:1},{chapterId:'wrong'},{paragraphCount:1}])assert.throws(()=>parseShidianOriginal(1,raw,{...first,...field}),/identity/);
 const parsed=readShidianData(raw);parsed.paragraphList[0].content=JSON.stringify({lines:[{lineType:9,content:'unknown'}]});const altered=raw.replace(/window\._ROUTER_DATA\s*=\s*[\s\S]*?<\/script>/,`window._ROUTER_DATA = ${JSON.stringify({loaderData:{'__session/(lang$)/book/$':parsed}})};</script>`);assert.throws(()=>parseShidianOriginal(1,altered,first),/Unknown source line/);
});

test('Shiji ten tables retain every empty cell and its source text, all row/column anchors and span relationships',async()=>{
 const e=entry('史记'),b=await library.book(choose(e.id));let cells=0,rows=0,empty=0;
 for(let number=13;number<=22;number++){
  const item=e.originalFiles[number-1],raw=await readFile(file(e,item),'utf8'),parsed=readWikiBody(raw);assert.ok(parsed.tables.length);
  const sectionText=squash(stripMeta(b.sections[number-1].units.map(u=>u.text).join('')));
  const source=all(parseDocument(raw)).filter(n=>n.name==='table'&&/\b(?:wikitable|MsoTableGrid)\b/.test(n.attribs.class||''));assert.equal(parsed.tables.length,source.length);
  for(const [tableIndex,t]of source.entries()){
   const sourceRows=all(t).filter(n=>n.name==='tr'),actual=parsed.tables[tableIndex].rows;assert.equal(actual.length,sourceRows.length);rows+=actual.length;
   for(const [r,tr]of sourceRows.entries()){
    const sourceCells=(tr.children||[]).filter(n=>['td','th'].includes(n.name));assert.equal(actual[r].length,sourceCells.length);cells+=sourceCells.length;
    for(const [c,cell]of sourceCells.entries()){
     const strip=n=>n.type==='text'?n.data:['style','script'].includes(n.name)||/\b(reference|noprint)\b/.test(n.attribs?.class||'')?'':(n.children||[]).map(strip).join('');
     assert.equal(squash(actual[r][c].text),squash(strip(cell)));assert.equal(actual[r][c].rowspan,Number(cell.attribs.rowspan||1));assert.equal(actual[r][c].colspan,Number(cell.attribs.colspan||1));if(!actual[r][c].text)empty++;
     assert.ok(sectionText.includes(squash(actual[r][c].text)));
    }
   }
  }
 }
 assert.equal(rows,1581);assert.equal(cells,18555);assert.equal(empty,4203);assert.equal((b.input.text.match(/□/g)||[]).length,5);assert.match(b.input.text,/集解/);assert.match(b.input.text,/索隱/);assert.match(b.input.text,/正義/);assert.doesNotMatch(b.input.text,/連囂之□三/,'Modern editorial footnote excluded');
 const filler='古文敘事不可用程式標記代替，所有實際原字均應保留。'.repeat(12),html=`<div class="mw-parser-output"><p>${filler}</p><table><tr><th rowspan="2">甲</th><th colspan="2">乙</th></tr><tr><td></td><td>丙。</td></tr></table></div>`;
 const t=readWikiBody(html).tables[0];assert.deepEqual(t.rows.map(r=>r.map(c=>[c.column,c.rowspan,c.colspan,c.text])),[[[1,2,1,'甲'],[2,1,2,'乙']],[[2,1,1,''],[3,1,1,'丙。']]]);
 assert.throws(()=>readWikiBody(`<div class="mw-parser-output"><p>${filler}<img alt="未知字" src="glyph.png"></p></div>`),/image/);
 for(const n of [18,19]){const item=e.originalFiles[n-1],raw=await readFile(file(e,item),'utf8');assert.ok(parseWikiOriginal(e.id,n,raw,item));assert.throws(()=>parseWikiOriginal(e.id,n,raw.replace(/"wgRedirectedFrom":"[^"]+"/,'"wgRedirectedFrom":"史記三家註/卷099"'),item),/identity/);}
 const section=b.sections[0],u=section.units.find(u=>!u.narrative);assert.throws(()=>library.resolve(b,receipt(b,section,u)),e=>e.status===400);
});

test('table layout labels and empty rows cannot independently authorize a storyboard',async()=>{
 const b=await library.book(choose('史记'));
 for(const section of b.sections)for(const unit of section.units.filter(u=>u.text.startsWith('〔表格版式：'))){assert.equal(unit.narrative,false);assert.throws(()=>library.resolve(b,receipt(b,section,unit)),e=>e.status===400);}
 const raw=`<div class="mw-parser-output"><p>${'原文正文內容必須與版式分開，不能以版式代替古文。'.repeat(12)}</p><table><tr><th>年</th><th>事</th></tr><tr><td></td><td></td></tr></table></div>`,blocks=readWikiBody(raw).blocks;
 assert.ok(blocks.filter(b=>b.text.startsWith('〔表格版式：')).every(b=>b.narrative===false));assert.ok(blocks.filter(b=>b.text.startsWith('〔列')).every(b=>b.narrative===false));
});

test('Shidian volume, attribution and category headings cannot combine into a narrative receipt',async()=>{
 const b=await library.book(choose('酉阳杂俎'));
 const first=b.sections[0];assert.ok(first.units.slice(1,50).every(u=>u.narrative===false));assert.throws(()=>library.resolve(b,{edition:b.edition,sectionId:first.id,firstUnit:first.units[1].id,lastUnit:first.units[49].id}),e=>e.status===400);
 for(let n=2;n<=30;n++){
  const s=b.sections[n-1],count=n===27?4:[4,28].includes(n)?2:3;
  assert.ok(s.units.slice(0,count).every(u=>u.narrative===false),s.title);
  assert.throws(()=>library.resolve(b,{edition:b.edition,sectionId:s.id,firstUnit:s.units[0].id,lastUnit:s.units[count-1].id}),e=>e.status===400);
  assert.ok(s.units.slice(count).some(u=>u.narrative&&!u.unreadable),'Narrative body remains usable');
 }
});

test('missing, swapped, tampered or escaped originals and glyphs fail closed',async t=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'shiqu-clean-'));t.after(()=>rm(temp,{recursive:true,force:true}));const dir=path.join(temp,'data/library');await cp('data/library',dir,{recursive:true});
 for(const id of ids){const e=entry(id),target=path.join(dir,e.originalFile,e.originalFiles.find(x=>x.file==='001.html').file),bytes=await readFile(target);await writeFile(target,'broken');await assert.rejects(new LocalBooks(temp).book(choose(id)),e=>e.status===503);await writeFile(target,bytes);}
 const e=entry('酉阳杂俎'),glyph=e.originalFiles.find(x=>x.file.endsWith('.png')),target=path.join(dir,e.originalFile,glyph.file),bytes=await readFile(target);await rm(target);await assert.rejects(new LocalBooks(temp).book(choose(e.id)),e=>e.status===503);await writeFile(target,Buffer.from('bad PNG'));await assert.rejects(new LocalBooks(temp).book(choose(e.id)),e=>e.status===503);await rm(target);await writeFile(path.join(temp,'outside.png'),bytes);await symlink(path.join(temp,'outside.png'),target);await assert.rejects(new LocalBooks(temp).book(choose(e.id)),e=>e.status===503);await rm(target);await writeFile(target,bytes);
 const wiki=entry('史记'),one=path.join(dir,wiki.originalFile,'001.html'),two=path.join(dir,wiki.originalFile,'002.html'),original=await readFile(one);await writeFile(one,await readFile(two));await assert.rejects(new LocalBooks(temp).book(choose(wiki.id)),e=>e.status===503);await writeFile(one,original);
 const wrong=structuredClone(catalog),changed=wrong.books.find(x=>x.id==='史记');changed.originalFiles[0].revision='1';await writeFile(path.join(dir,'catalog.json'),JSON.stringify(wrong));await assert.rejects(new LocalBooks(temp).book(choose('史记')),e=>e.status===503);
});
