// Exercise real local texts, provider payloads and source-before-plan checkpoint boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LocalBooks} from '../server/local-books.ts';
import {bookInputs} from '../server/local-book-inputs.ts';
import {indexInputLimit} from '../server/local-story-discovery.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {createReaderProvider} from '../server/generation.ts';
import {createApplication} from '../server/app.ts';
import {FileMedia} from '../server/media.ts';
import {openDatabase} from '../server/database.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {suggestionBatchSchema} from '../lib/reader-suggestions.ts';

const library=new LocalBooks(process.cwd());
const selected=selectionSchema.parse({bookId:'zhuangzi',theme:'放下执念',storyTitle:'庄周梦蝶',length:8});
const plan={title:'梦醒之后',hook:'谁在梦中？',sourceReference:'模型不可信的出处',adaptationNote:'现代旁白改编',reflection:'梦与醒之间呢？',characters:'An adult Chinese philosopher in plain robes.',pages:Array.from({length:8},()=>({caption:'庄周梦见自己成为蝴蝶，在天地间自在飞翔。',prompt:'An adult philosopher dreams of a butterfly.'}))};
function ref(book,section=book.sections[1],first=section.units.length-1,last=first){return {edition:book.edition,sectionId:section.id,firstUnit:section.units[first].id,lastUnit:section.units[last].id};}
function memory(){const values=new Map();return {values,async put(key,bytes){values.set(key,new Uint8Array(bytes));},async get(key){const bytes=values.get(key);return bytes?{async arrayBuffer(){return bytes.slice().buffer;}}:null;}};}
function fake(){return {status:async()=>({configured:true,provider:'gemini',voiceEnabled:false,models:{text:'mock',image:'mock'}}),safeError:()=> '模拟分镜失败',suggestions:async()=>({stories:[],note:''}),generator:()=>({plan:async()=>({value:structuredClone(plan),model:'mock',requestId:'mock',usage:null}),original:async()=>assert.fail('No public source lookup'),image:async(p,page,id)=>({value:`/api/reader/media/${id}/${page}.png`,model:'mock',requestId:'mock',usage:null}),audio:async()=>assert.fail('No audio'),safeError:()=> '模拟分镜失败'})};}
async function directory(t){const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-local-books-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('only original downloads are versioned, preserve their bytes and have matching receipts',async()=>{
 const catalog=JSON.parse(await readFile('data/library/catalog.json','utf8'));assert.equal(catalog.books.length,24);
 for(const book of catalog.books){
  let hash;
  if(book.originalFiles){for(const item of book.originalFiles)assert.equal(createHash('sha256').update(await readFile(path.join('data/library',book.originalFile,item.file))).digest('hex'),item.sha256,item.file);hash=createHash('sha256').update(book.originalFiles.map(item=>`${item.file}\t${item.sha256}`).join('\n')).digest('hex');}
  else hash=createHash('sha256').update(await readFile(path.join('data/library',book.originalFile))).digest('hex');
  assert.equal(hash,book.source.sha256,book.title);assert.equal(book.textFile,undefined);
 }

 await assert.rejects(access('data/library/texts'));
 assert.match(await readFile('.gitattributes','utf8'),/data\/library\/\*\* -text/);
 assert.match(await readFile('Dockerfile','utf8'),/COPY --from=build.*\/app\/data\/library/);
});
test('the two whole-book inputs contain every parsed body unit, including the final passages',async()=>{
 for(const [id,sections,count,start,end] of [['zhuangzi',33,268,'北冥有鱼','是穷响以声'],['shishuo',36,1129,'陳仲舉言','不忍見行此事']]){
  const book=await library.book({...selected,bookId:id});assert.equal(book.sections.length,sections);assert.equal(book.sections.flatMap(s=>s.units).length,count);
  assert.match(book.input.text,new RegExp(start));assert.match(book.input.text,new RegExp(end));
  for(const section of book.sections)for(const unit of section.units){assert.ok(book.input.text.includes(`[${unit.id}]\n${unit.text}`));}
  assert.doesNotMatch(book.input.text,/Produced by|世[說说][舊旧][題题]一首[舊旧]跋二首|世[說说]新[語语]序目/);
  assert.equal((await library.book({...selected,bookId:'other',customBook:book.title})).edition,book.edition);
  const metadata=JSON.parse(await readFile('data/library/catalog.json','utf8')).books.find(b=>b.id===id);assert.equal(book.edition,metadata.source.sha256);
  if(id==='shishuo'){assert.ok(book.input.text.includes('陳仲舉言'));assert.ok(!book.input.text.includes('陈仲举言'));}
 }
});
test('range verification rejects stale, cross-book, reversed, multi-anecdote and unreadable refs',async t=>{
 const book=await library.book(selected),reference=ref(book);
 assert.match(library.resolve(book,reference).text,/庄周梦/);
 for(const bad of [{...reference,edition:'0'.repeat(64)},{...reference,sectionId:'shishuo-02'},{...reference,firstUnit:book.sections[0].units[0].id},{...reference,firstUnit:'missing'},{...reference,firstUnit:reference.lastUnit,lastUnit:book.sections[1].units[0].id}])assert.throws(()=>library.resolve(book,bad),e=>e.status===400);
 const shishuo=await library.book({...selected,bookId:'shishuo'});assert.throws(()=>library.resolve(shishuo,ref(shishuo,shishuo.sections[0],0,1)),e=>e.status===400);
 const section=shishuo.sections.find(s=>s.units.some(u=>/[\uE000-\uF8FF]/.test(u.text))),i=section.units.findIndex(u=>/[\uE000-\uF8FF]/.test(u.text));assert.throws(()=>library.resolve(shishuo,ref(shishuo,section,i)),e=>e.status===400);
 const legacy=await library.legacy({...selected,bookId:'shishuo'},{sourceReference:'《世说新语·术解》',pages:[]});assert.match(legacy.title,/術解/);assert.ok(legacy.text.includes('術')||legacy.text.includes('之'));
 const missing=new LocalBooks(await directory(t));await assert.rejects(missing.book(selected),e=>e.status===503);
});
test('whole-book candidates carry verified labels and invalid or duplicate source ranges are removed',async()=>{
 const book=await library.book(selected),reference=ref(book),base=fake();
 base.suggestions=async(selection,excluded,whole)=>{if(whole.purpose==='candidate-summary')return {stories:JSON.parse(whole.text).slice(0,5),note:''};assert.equal(whole.purpose,'story-index');if(!whole.text.includes(`[${reference.firstUnit}]`))return {stories:[],note:''};return {stories:[{title:'庄周梦蝶',description:'醒来后的疑问',source:reference},{title:'另起名字',description:'重复原文',source:reference},{title:'不存在的故事',description:'错误',source:{...reference,firstUnit:'missing'}}],note:''};};
 const provider=withLocalBooks(base,library,memory()),batch=await provider.suggestions(selected,[]);
 assert.equal(batch.stories.length,1);assert.match(batch.stories[0].sourceLabel,/庄子·齐物论/);assert.deepEqual(suggestionBatchSchema.parse(batch).stories[0].source,reference);assert.match(batch.note,/移除/);
});
test('Gemini and Codex index every bounded book part and send only the verified passage to planning',async()=>{
 for(const name of ['gemini','codex']){
  const book=await library.book(selected),reference=ref(book),jobs=[],store=memory();
  const result=job=>{jobs.push(job);return JSON.stringify(job.schema.properties.stories?{stories:[{title:'庄周梦蝶',description:'醒来后的疑问',source:{sectionId:reference.sectionId,firstUnit:reference.firstUnit,lastUnit:reference.lastUnit}}],note:''}:plan);};
  const runner={status:async()=>({configured:true}),run:async job=>({text:result(job),model:'mock',requestId:'mock',usage:null})};
  const transport=async(url,init)=>{assert.match(String(url),/^https:\/\/generativelanguage.googleapis.com/);const request=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:result({prompt:request.contents[0].parts[0].text,schema:request.generationConfig.responseFormat.text.schema,instructions:request.systemInstruction.parts[0].text})}]}}]});};
  const provider=withLocalBooks(createReaderProvider({SHIQU_AI_PROVIDER:name,GEMINI_API_KEY:'mock-only'},store,transport,runner),library,store);
  const batch=await provider.suggestions(selected,[]),selection={...selected,source:batch.stories[0].source},generator=provider.generator();
  const original=await generator.prepareOriginal(selection,'test');await generator.plan(selection,'test',original);
  const indexJobs=jobs.filter(job=>JSON.parse(job.prompt).localBook?.purpose==='story-index'),planned=JSON.parse(jobs.at(-1).prompt);
  assert.equal(indexJobs.length,bookInputs(book,indexInputLimit).length);for(const section of book.sections)for(const unit of section.units)assert.ok(indexJobs.some(job=>JSON.parse(job.prompt).localBook.text.includes(`[${unit.id}]\n${unit.text}`)));assert.equal(planned.verifiedOriginal.text,original.text);assert.equal(planned.localBook,undefined);assert.ok(jobs.at(-1).prompt.length<book.input.text.length/5);assert.match(jobs.at(-1).instructions,/唯一情节依据/);assert.ok(store.values.has('reader/test/source.json'));
 }
});

test('both providers build larger reusable indexes without theme, exclusions or production fields in the payload',async()=>{
 const book=await library.book(selected),reference=ref(book);
 for(const name of ['gemini','codex']){
  let sent,schema,budget;
  const stories=Array.from({length:12},(_,i)=>({title:`索引故事${i}`,description:'人物与事件的完整梗概。',source:{sectionId:reference.sectionId,firstUnit:reference.firstUnit,lastUnit:reference.lastUnit}}));
  const payload=JSON.stringify({stories,note:''});
  const runner={status:async()=>({configured:true}),run:async job=>{sent=JSON.parse(job.prompt);schema=job.schema;return {text:payload,model:'mock',requestId:'mock',usage:null};}};
  const transport=async(url,init)=>{const data=JSON.parse(init.body);sent=JSON.parse(data.contents[0].parts[0].text);schema=data.generationConfig.responseFormat.text.schema;budget=data.generationConfig.maxOutputTokens;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:payload}]}}]});};
  const provider=createReaderProvider({SHIQU_AI_PROVIDER:name,GEMINI_API_KEY:'mock-only'},memory(),transport,runner);
  const batch=await provider.suggestions({...selected,productionPrompt:'private production field'},['excluded title'],{...book.input,purpose:'story-index'});
  assert.deepEqual(Object.keys(sent).sort(),['book','localBook']);assert.equal(batch.stories.length,12);assert.equal(schema.properties.stories.maxItems,12);
  if(name==='gemini')assert.equal(budget,8000);
 }
});
test('verified original reaches SQLite and media before a paid plan, and survives plan failure/retry',async t=>{
 const root=await directory(t),db=openDatabase(root,process.cwd());t.after(()=>db.close());const repo=new ReaderRepository(db.database),store=new FileMedia(path.join(root,'media')),book=await library.book(selected),selection={...selected,source:ref(book)};
 let calls=0;const base=fake();base.generator=()=>({...fake().generator(),async plan(s,id,original){calls++;const row=await repo.get(id,'test'),doc=JSON.parse(row.document);assert.equal(doc.original.text,original.text);assert.ok(await store.get(`reader/${id}/source.json`));if(calls===1)throw Error('mock plan failure');return {value:structuredClone(plan),model:'mock',requestId:'mock',usage:null};}});
 const generator=withLocalBooks(base,library,store).generator(),id=crypto.randomUUID();await repo.create(id,'test',selection);
 const failed=await advanceStory(repo,generator,'test',id,0);assert.equal(failed.state,'failed');assert.equal(failed.story,null);assert.ok(JSON.parse((await repo.get(id,'test')).document).original);
 const retried=await advanceStory(repo,generator,'test',id,0,true);assert.equal(calls,2);assert.match(retried.story.sourceText,/庄周梦/);assert.match(retried.story.sourceReference,/庄子·齐物论/);assert.deepEqual(retried.story.original.localSource,selection.source);
});
test('storage failures or missing local receipts cannot issue paid storyboard requests',async t=>{
 for(const mode of ['storage','missing']){
  const root=await directory(t),db=openDatabase(root,process.cwd());t.after(()=>db.close());const repo=new ReaderRepository(db.database),book=await library.book(selected);let calls=0;
  const base=fake();base.generator=()=>({...fake().generator(),plan:async()=>{calls++;throw Error('must not run');}});
  const media=mode==='storage'?{put:async()=>{throw Error('disk full');}}:memory(),selection={...selected,...(mode==='storage'?{source:ref(book)}:{})};
  const id=crypto.randomUUID();await repo.create(id,'test',selection);const row=await advanceStory(repo,withLocalBooks(base,library,media).generator(),'test',id,0);assert.equal(row.state,'failed');assert.equal(calls,0);assert.equal(row.story,null);
 }
});
test('explicit legacy backfill uses a local chapter and does not plan, draw, or fetch a public source',async t=>{
 const root=await directory(t),media=new FileMedia(path.join(root,'media')),provider=withLocalBooks(fake(),library,media),app=createApplication({root:process.cwd(),dataDirectory:root,generation:provider});t.after(()=>app.close());
 const repo=new ReaderRepository(app.services.database),id=crypto.randomUUID();await repo.create(id,'docker-local-owner',selected);
 const row=await repo.get(id,'docker-local-owner');await app.services.database.prepare('UPDATE reader_sessions SET document=? WHERE id=?').bind(JSON.stringify({plan:{...plan,sourceReference:'《庄子·齐物论》'},images:[],audio:[],usage:[]}),id).run();
 const response=await app.handle(new Request(`http://localhost/api/reader/sessions/${id}/source`,{method:'POST'}));assert.equal(response.status,200);const body=await response.json();assert.equal(body.source.kind,'chapter');assert.match(body.source.provider,/本地书库/);assert.match(body.source.text,/北冥|南郭|庄周/);assert.equal(body.searchUrl,'');assert.equal((await repo.get(id,'docker-local-owner')).page,row.page);
});
