// Exercise every shipped book through exhaustive reading and source-before-plan HTTP checkpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {readFile,mkdtemp,rm,writeFile,cp} from 'node:fs/promises';
import {LocalBooks} from '../server/local-books.ts';
import {bookInputs} from '../server/local-book-inputs.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {createApplication} from '../server/app.ts';
import {FileMedia} from '../server/media.ts';
const root=process.cwd(),library=new LocalBooks(root),catalog=JSON.parse(await readFile('data/library/catalog.json','utf8'));
const counts=[12,33,36,100,120,120,120,56,18,8,20,25,24,30,500,10,40,40,40,40,40,130,33,4];
const select=bookId=>({bookId,theme:'聪明与糊涂',artStyle:'ink-pencil',length:8,voice:false});
const plan={title:'经过核对的故事',hook:'他会怎样选择？',sourceReference:'模型不能决定的出处',adaptationNote:'现代简体旁白改编',reflection:'你会如何选择？',characters:'An adult Chinese scholar in plain robes.',pages:Array.from({length:8},()=>({caption:'他停下脚步仔细观察，发现事情还有另一种解释。',prompt:'An adult scholar carefully observes a scene.'}))};
function candidate(book,visible,offset=0){
 const valid=[];
 for(const section of book.sections)for(let i=0;i<section.units.length;i++){
  const unit=section.units[i];
  try{const last=section.units[book.id==='太平广记'?Math.min(i+1,section.units.length-1):i];const source={sectionId:section.id,firstUnit:unit.id,lastUnit:last.id,edition:book.edition};if(visible&&(!visible.has(unit.id)||!visible.has(last.id)))continue;library.resolve(book,source);valid.push({title:`故事${unit.id}`,description:'依据本地原文的故事',source});if(valid.length===offset+5)return valid.slice(offset);}catch{}
 }
 return valid.slice(offset,offset+5);
}
function fake(onPlan=async()=>{}){return {status:async()=>({configured:true,provider:'gemini',voiceEnabled:false,models:{text:'mock',image:'mock'}}),safeError:()=> '模拟错误',async suggestions(s,excluded,input){assert.ok(input);if(input.purpose==='candidate-summary'){const all=JSON.parse(input.text);return {stories:all.slice(-5),note:''};}const book=await library.book(s),visible=new Set([...input.text.matchAll(/\[([a-z]+-\d+-\d+)\]/g)].map(m=>m[1]));return {stories:candidate(book,visible),note:''};},generator:()=>({async plan(s,id,original){await onPlan(s,id,original);return {value:structuredClone(plan),model:'mock',requestId:'mock',usage:null};},original:async()=>assert.fail('No public book API'),image:async()=>assert.fail('No images'),audio:async()=>assert.fail('No audio'),safeError:()=> '模拟错误'})};}
async function temp(t){const d=await mkdtemp(path.join(os.tmpdir(),'shiqu-library-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}

test('all 24 catalogs load verified originals with complete chapters and exhaustive bounded inputs',async()=>{
 for(const [index,entry] of catalog.books.entries()){
  assert.equal(entry.localGeneration,true);const book=await library.book(select(entry.id));assert.ok(book,entry.id);assert.equal(book.sections.length,counts[index],entry.id);
  const inputs=bookInputs(book),seen=new Set();
  for(const {input,visible} of inputs){assert.ok(input.text.length<=100000,entry.id);for(const id of visible)seen.add(id);}
  for(const section of book.sections)for(const unit of section.units){assert.ok(seen.has(unit.id),unit.id);assert.ok(inputs.some(p=>p.input.text.includes(`[${unit.id}]\n${unit.text}`)),unit.id);}
  assert.equal((await library.book({...select('other'),customBook:entry.title})).edition,book.edition);
  assert.doesNotMatch(book.input.text,/Produced by|End of Project Gutenberg|START OF THE PROJECT GUTENBERG|本書完/);
 }
 const zhuang=await library.book(select('zhuangzi')),shishuo=await library.book(select('shishuo'));
 assert.equal(zhuang.sections[0].units[0].id,'zhuangzi-01-001');assert.equal(shishuo.edition,catalog.books[2].source.sha256);assert.match(shishuo.input.text,/陳仲舉言/);
 const shiji=await library.book(select('史记'));
 for(const [index,title,opening] of [[8,'呂太后本紀','呂太后者'],[17,'高祖功臣侯者年表','太史公曰'],[42,'趙世家','趙氏之先'],[43,'魏世家','魏之先'],[47,'陳涉世家','陳勝者']]){assert.ok(shiji.sections[index].title.endsWith(title));assert.ok(shiji.sections[index].units.some(unit=>unit.text.includes(opening)),title);}
 assert.equal(shiji.edition,catalog.books.find(b=>b.id==='史记').source.sha256);
 const legacy=await library.legacy(select('史记'),{...plan,sourceReference:'《史记·陈涉世家》'});assert.match(legacy.text,/陳勝者/);assert.match(legacy.title,/陳涉世家/);assert.equal(legacy.kind,'chapter');
 const honglou=await library.book(select('红楼梦'));assert.match(honglou.sections[79].title,/第八十回/);assert.match(honglou.sections[80].title,/第八十一回/);assert.match(honglou.provider,/程乙本/);assert.match(catalog.books.find(b=>b.id==='红楼梦').scope,/前80回与后40回/);
 assert.doesNotMatch((await library.book(select('浮生六记'))).input.text,/卷五|卷六|\(佚\)/);
});

test('all catalogs use originals without cross-source supplements; Erke final play has a local TXT source',async()=>{
 assert.ok(catalog.books.every(entry=>entry.supplements.length===0));
 const erke=await library.book(select('二刻拍案惊奇')),section=erke.sections.at(-1),story=candidate({...erke,sections:[section]})[0],original=library.resolve(erke,story.source);
 assert.match(section.title,/杂剧/);assert.match(section.units.map(u=>u.text).join(''),/宋公明|宋三郎/);assert.match(original.url,/hanchuancaolu\/blob\/889b8873e34419ce9d519f50482f60d913a4ac20/);assert.ok(original.url.endsWith('.txt'));assert.match(original.provider,/漢川草廬/);
});

test('original corruption and unreadable source ranges fail closed',async t=>{
 const folder=await temp(t);await cp('data/library',path.join(folder,'data/library'),{recursive:true});const erkeEntry=catalog.books.find(entry=>entry.id==='二刻拍案惊奇');await writeFile(path.join(folder,'data/library',erkeEntry.originalFile,erkeEntry.originalFiles.at(-1).file),'broken');await assert.rejects(new LocalBooks(folder).book(select('二刻拍案惊奇')),e=>e.status===503);
 const shanhai=await library.book(select('山海经'));const section=shanhai.sections[0],unit=section.units.find(unit=>unit.narrative);const corrupted={...shanhai,sections:[{...section,units:[{...unit,text:'有獸焉，其狀如【上鹿下旨】，讀不出其原字，不可猜補。'}]}]};assert.throws(()=>library.resolve(corrupted,{edition:shanhai.edition,sectionId:section.id,firstUnit:unit.id,lastUnit:unit.id}),e=>e.status===400);
});

test('all batches including the final batch participate in summary; foreign-batch or fabricated receipts are rejected',async()=>{
 const book=await library.book(select('太平广记')),parts=bookInputs(book);assert.ok(parts.length>5);let scanned=0,summarySeen=0;
 const base=fake();base.suggestions=async(s,excluded,input)=>{if(input.purpose==='candidate-summary'){const all=JSON.parse(input.text);summarySeen=all.length;return {stories:[all.at(-1)],note:''};}scanned++;return {stories:candidate(book,new Set([...input.text.matchAll(/\[([a-z]+-\d+-\d+)\]/g)].map(m=>m[1]))),note:''};};
 const provider=withLocalBooks(base,library,{put:async()=>{}}),batch=await provider.suggestions(select('太平广记'),[]);assert.equal(scanned,parts.length);assert.ok(summarySeen>5);assert.ok(parts.at(-1).visible.has(batch.stories[0].source.firstUnit));
 base.suggestions=async(s,excluded,input)=>{if(input.purpose==='candidate-summary')return {stories:[{...candidate(book)[0],source:{...candidate(book)[0].source,firstUnit:'fabricated'}}],note:''};return {stories:candidate(book,new Set([...input.text.matchAll(/\[([a-z]+-\d+-\d+)\]/g)].map(m=>m[1]))),note:''};};
 await assert.rejects(provider.suggestions(select('太平广记'),[]),e=>e.status===502);
 // Every part returning a valid range from the last part must not leak it through earlier parts.
 const last=candidate(book,parts.at(-1).visible)[0];let foreignCalls=0;base.suggestions=async()=>{foreignCalls++;return {stories:[last],note:''};};const foreign=await provider.suggestions(select('太平广记'),[]);assert.equal(foreignCalls,parts.length);assert.equal(foreign.stories.length,1);assert.match(foreign.note,/部分候选/);
});

test('a failed reading batch stops later dispatch and cannot return partial whole-book success',async()=>{
 const base=fake();let calls=0;base.suggestions=async()=>{calls++;throw Error('batch failed');};const provider=withLocalBooks(base,library,{put:async()=>{}});await assert.rejects(provider.suggestions(select('太平广记'),[]),/batch failed/);assert.ok(calls<=2);
});

test('all 24 books complete HTTP selection and persist original glyphs before storyboard generation',async t=>{
 const data=await temp(t),media=new FileMedia(path.join(data,'media'));let app,plans=0;
 const base=fake(async(s,id,original)=>{plans++;assert.ok(original.localSource);const row=app.services.database.prepare('SELECT document FROM reader_sessions WHERE id=?').bind(id);const stored=await row.first();assert.equal(JSON.parse(stored.document).original.text,original.text);assert.ok(await media.get(`reader/${id}/source.json`));});
 app=createApplication({root,dataDirectory:data,generation:withLocalBooks(base,library,media)});t.after(()=>app.close());
 const request=async(route,body)=>{const r=await app.handle(new Request('http://localhost/api/reader/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
 for(const entry of catalog.books){const selection=select(entry.id),batch=await request('suggestions',{...selection,excludeTitles:[]}),story=batch.stories[0];assert.ok(story,entry.id);const requestId=crypto.randomUUID();await request('sessions',{requestId,selection:{...selection,storyTitle:story.title,source:story.source}});const result=await request(`sessions/${requestId}/advance`,{throughPage:0});assert.notEqual(result.state,'failed',JSON.stringify(result));assert.equal(result.story.pages.length,8);assert.equal(result.story.original.text,library.resolve(await library.book(selection),story.source).text);assert.equal(result.story.original.localSource.edition,story.source.edition);assert.ok(result.story.pages.every(p=>!p.image));
  // Age this isolated fixture out of the existing daily quota before testing the next book.
  await app.services.database.prepare('UPDATE reader_sessions SET created_at=? WHERE id=?').bind('2020-01-01T00:00:00.000Z',requestId).run();}
 assert.equal(plans,24);
});
