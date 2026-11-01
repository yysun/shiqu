// Exercise real local texts, provider payloads and source-before-plan checkpoint boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LocalBooks} from '../server/local-books.ts';
import {bookInputs} from '../server/local-book-inputs.ts';
import {buildReadingPlan,hydrateReadingPlan} from '../server/story-reading-inputs.ts';
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
function fake(){return {status:async()=>({configured:true,provider:'gemini',voiceEnabled:false,models:{text:'mock',image:'mock'}}),safeError:()=> '模拟分镜失败',suggestions:async()=>({stories:[],note:''}),generator:()=>({reflection:async()=>({value:plan.reflection,model:'mock',requestId:'mock',usage:null}),reflectionCandidates:async()=>({value:[plan.reflection,'醒来之后，梦中的自在仍值得回味。','梦与醒的分界，也未必是心境的分界。'],model:'mock',requestId:'mock',usage:null}),review:async(_s,_p,_o,_outline,candidates)=>({value:{issues:[],...(candidates?{reflectionChoice:{index:1,reason:'保留原文支持的认识。'}}:{})},model:'mock',requestId:'mock',usage:null}),plan:async()=>({value:structuredClone(plan),model:'mock',requestId:'mock',usage:null}),original:async()=>assert.fail('No public source lookup'),image:async(p,page,id)=>({value:`/api/reader/media/${id}/${page}.png`,model:'mock',requestId:'mock',usage:null}),audio:async()=>assert.fail('No audio'),safeError:()=> '模拟分镜失败'})};}
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
 for(const [id,sections,count,start,end] of [['zhuangzi',33,1769,'北冥有魚','是窮響以聲'],['shishuo',36,1129,'陳仲舉言','不忍見行此事']]){
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
 assert.match(library.resolve(book,reference).text,/莊周夢/);
 for(const bad of [{...reference,edition:'0'.repeat(64)},{...reference,sectionId:'shishuo-02'},{...reference,firstUnit:book.sections[0].units[0].id},{...reference,firstUnit:'missing'},{...reference,firstUnit:reference.lastUnit,lastUnit:book.sections[1].units[0].id}])assert.throws(()=>library.resolve(book,bad),e=>e.status===400);
 const shishuo=await library.book({...selected,bookId:'shishuo'});assert.throws(()=>library.resolve(shishuo,ref(shishuo,shishuo.sections[0],0,1)),e=>e.status===400);
 const section=shishuo.sections.find(s=>s.units.some(u=>/[\uE000-\uF8FF]/.test(u.text))),i=section.units.findIndex(u=>/[\uE000-\uF8FF]/.test(u.text));assert.throws(()=>library.resolve(shishuo,ref(shishuo,section,i)),e=>e.status===400);
 const legacy=await library.legacy({...selected,bookId:'shishuo'},{sourceReference:'《世说新语·术解》',pages:[]});assert.match(legacy.title,/術解/);assert.ok(legacy.text.includes('術')||legacy.text.includes('之'));
 const missing=new LocalBooks(await directory(t));await assert.rejects(missing.book(selected),e=>e.status===503);
});
test('direct whole-book choices preserve labels and reject duplicate and invalid receipts',async()=>{
 const book=await library.book(selected),reference=ref(book),base=fake();
 base.suggestions=async(_selection,excluded,input)=>{
  if(input.scan.maxStories===1)return {stories:[{title:'先读一篇',description:'首章中的故事',source:ref(book,book.sections[0],0)}],note:'',scan:{blockComplete:false,pendingEvents:[],resolvedEventIds:[]}};
  return {stories:input.text.includes('['+reference.firstUnit+']')?[{title:'庄周梦蝶',description:'醒来后的疑问',source:reference},{title:'另名',description:'重复原文',source:reference},{title:'错误',description:'不存在',source:{...reference,firstUnit:'missing'}}]:[],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}};
 };
 const provider=withLocalBooks(base,library,memory());await provider.suggestions(selected,[]);
 const batch=await provider.suggestions(selected,['先读一篇']);
 assert.equal(batch.stories.length,1);assert.match(batch.stories[0].sourceLabel,/庄子·齊物論/);assert.match(batch.note,/未能完整核对/);
});
test('both providers directly select from the full original and only verified passages reach planning',async()=>{
 for(const name of ['gemini','codex']){
  const book=await library.book(selected),reference=ref(book),jobs=[],store=memory();
  const result=job=>{jobs.push(job);return JSON.stringify(job.schema.properties.stories?{stories:JSON.parse(job.prompt).localBook.text.includes('['+reference.firstUnit+']')?[{title:'庄周梦蝶',description:'醒来后的疑问',source:{sectionId:reference.sectionId,firstUnit:reference.firstUnit,lastUnit:reference.lastUnit,continuations:[]}}]:[],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}}:plan);};
  const runner={status:async()=>({configured:true}),run:async job=>({text:result(job),model:'mock',requestId:'mock',usage:null})};
  const transport=async(url,init)=>{const request=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:result({prompt:request.contents[0].parts[0].text,schema:request.generationConfig.responseFormat.text.schema,instructions:request.systemInstruction.parts[0].text})}]}}]});};
  const provider=withLocalBooks(createReaderProvider({SHIQU_AI_PROVIDER:name,GEMINI_API_KEY:'mock-only'},store,transport,runner),library,store);
  const batch=await provider.suggestions(selected,[]),selection={...selected,source:batch.stories[0].source},generator=provider.generator();
  const original=await generator.prepareOriginal(selection,'test');await generator.plan(selection,'test',original);
  const readings=jobs.filter(job=>JSON.parse(job.prompt).localBook),planned=JSON.parse(jobs.at(-1).prompt);
  const blocks=hydrateReadingPlan(book,buildReadingPlan(book,name)),chosenBlock=blocks.findIndex(block=>block.visible.has(reference.firstUnit));assert.equal(readings.length,chosenBlock+1);for(const [index,reading] of readings.entries()){assert.equal(JSON.parse(reading.prompt).localBook.purpose,'scan');assert.equal(JSON.parse(reading.prompt).localBook.scan.maxStories,1);assert.equal(JSON.parse(reading.prompt).localBook.text,blocks[index].text);}assert.ok(blocks[chosenBlock].visible.has(reference.firstUnit));
  assert.equal(planned.verifiedOriginal.text,original.text);assert.equal(planned.localBook,undefined);assert.ok(store.values.has('reader/test/source.json'));
 }
});
test('token-based chapter manifests cover all shipped units without splitting small chapters',async()=>{
 for(const bookId of ['聊斋志异','太平广记','红楼梦']){
  const book=await library.book({...selected,bookId}),manifest=buildReadingPlan(book,'codex'),blocks=hydrateReadingPlan(book,manifest);
  assert.equal(blocks.flatMap(b=>[...b.visible]).length,book.sections.flatMap(s=>s.units).length);
  assert.ok(manifest.blocks.every(b=>b.tokens<=12000));assert.ok(blocks.every(b=>b.chapters.length<=2));assert.equal(manifest.mode,'chapters');
 }
});
test('cross-chapter references preserve both original ranges, reject tampering, and allow complete long stories',async()=>{
 const book=await library.book(selected),first=ref(book,book.sections[0],0,0),last=ref(book,book.sections[1],0,0);
 const source={...first,continuations:[{sectionId:last.sectionId,firstUnit:last.firstUnit,lastUnit:last.lastUnit}]};
 const original=library.resolve(book,source);assert.ok(original.text.includes(book.sections[0].units[0].text));assert.ok(original.text.includes(book.sections[1].units[0].text));
 for(const bad of [{...source,continuations:[{...source.continuations[0],lastUnit:'missing'}]},{...first,continuations:[{sectionId:first.sectionId,firstUnit:first.firstUnit,lastUnit:first.lastUnit}]}])assert.throws(()=>library.resolve(book,bad));
 const jingshi=await library.book({...selected,bookId:'警世通言'}),chapter=jingshi.sections.find(s=>s.units.reduce((n,u)=>n+u.text.length,0)>12000);
 const full=library.resolve(jingshi,ref(jingshi,chapter,0,chapter.units.length-1));assert.ok(full.text.length>12000);
});
test('verified original reaches SQLite and media before a paid plan, and survives plan failure/retry',async t=>{
 const root=await directory(t),db=openDatabase(root,process.cwd());t.after(()=>db.close());const repo=new ReaderRepository(db.database),store=new FileMedia(path.join(root,'media')),book=await library.book(selected),selection={...selected,source:ref(book)};
 let calls=0;const base=fake();base.generator=()=>({...fake().generator(),async plan(s,id,original){calls++;const row=await repo.get(id,'test'),doc=JSON.parse(row.document);assert.equal(doc.original.text,original.text);assert.ok(await store.get(`reader/${id}/source.json`));if(calls===1)throw Error('mock plan failure');return {value:structuredClone(plan),model:'mock',requestId:'mock',usage:null};}});
 const generator=withLocalBooks(base,library,store).generator(),id=crypto.randomUUID();await repo.create(id,'test',selection);
 const failed=await advanceStory(repo,generator,'test',id,0);assert.equal(failed.state,'failed');assert.equal(failed.story,null);assert.ok(JSON.parse((await repo.get(id,'test')).document).original);
 const draft=await advanceStory(repo,generator,'test',id,0,true);assert.equal(draft.story,null);
 const retried=await advanceStory(repo,generator,'test',id,0);assert.equal(calls,2);assert.match(retried.story.sourceText,/莊周夢/);assert.match(retried.story.sourceReference,/庄子·齊物論/);assert.deepEqual(retried.story.original.localSource,selection.source);
});
test('storage failures or missing local receipts cannot issue paid storyboard requests',async t=>{
 for(const mode of ['storage','missing']){
  const root=await directory(t),db=openDatabase(root,process.cwd());t.after(()=>db.close());const repo=new ReaderRepository(db.database),book=await library.book(selected);let calls=0;
  const base=fake();base.generator=()=>({...fake().generator(),plan:async()=>{calls++;throw Error('must not run');}});
  const media=mode==='storage'?{put:async()=>{throw Error('disk full');}}:memory(),selection={...selected,...(mode==='storage'?{source:ref(book)}:{})};
  const id=crypto.randomUUID();await repo.create(id,'test',selection);const row=await advanceStory(repo,withLocalBooks(base,library,media).generator(),'test',id,0);assert.equal(row.state,'failed');assert.equal(calls,0);assert.equal(row.story,null);
 }
});
test('storyboard directory and batch calls both verify local source receipts before inference',async()=>{
 const book=await library.book(selected),selection={...selected,length:45,source:ref(book)},media=memory();let outlines=0,batches=0;
 const base=fake();base.generator=()=>({...fake().generator(),async outline(){outlines++;return {value:{...plan,beats:Array(45).fill('梦醒之后，人物继续追问。')},model:'mock',requestId:null,usage:null};},async planBatch(){batches++;return {value:plan.pages,model:'mock',requestId:null,usage:null};}});
 const g=withLocalBooks(base,library,media).generator(),original=await g.prepareOriginal(selection,'receipt-test');
 const result=await g.outline(selection,'receipt-test',original),draft={outline:result.value,pages:[]};assert.equal(result.value.sourceReference,original.chapterContext.title);
 await g.planBatch(selection,'receipt-test',draft,original);
 for(const bad of [undefined,{...original,text:original.text+'□'},{...original,localSource:{...original.localSource,edition:'0'.repeat(64)}}]){
  await assert.rejects(g.outline(selection,'receipt-test',bad),e=>e.status===400);
  await assert.rejects(g.planBatch(selection,'receipt-test',draft,bad),e=>e.status===400);
 }
 assert.equal(outlines,1);assert.equal(batches,1);
});
test('ending, review and repair require the same verified local original as planning',async()=>{
 const book=await library.book(selected),selection={...selected,source:ref(book)};let calls=0;
 const base=fake();base.generator=()=>({...fake().generator(),async reflectionCandidates(){calls++;return {value:[plan.reflection,'醒来之后，梦中的自在仍值得回味。','梦与醒的分界，也未必是心境的分界。'],model:'mock',requestId:null,usage:null};},async reflection(){calls++;return {value:plan.reflection,model:'mock',requestId:null,usage:null};},async review(){calls++;return {value:{issues:[]},model:'mock',requestId:null,usage:null};},async repair(){calls++;return {value:[],model:'mock',requestId:null,usage:null};}});
 const g=withLocalBooks(base,library,memory()).generator(),original=await g.prepareOriginal(selection,'review-receipt');
 await g.reflectionCandidates(selection,plan,original);await g.reflection(selection,plan,original);await g.review(selection,plan,original);await g.repair(selection,plan,original,[]);
 for(const bad of [undefined,{...original,text:original.text+'□'},{...original,localSource:{...original.localSource,edition:'0'.repeat(64)}}]){
  await assert.rejects(g.reflectionCandidates(selection,plan,bad),e=>e.status===400);await assert.rejects(g.reflection(selection,plan,bad),e=>e.status===400);await assert.rejects(g.review(selection,plan,bad),e=>e.status===400);await assert.rejects(g.repair(selection,plan,bad,[]),e=>e.status===400);
 }
 assert.equal(calls,4);
});
test('explicit legacy backfill uses a local chapter and does not plan, draw, or fetch a public source',async t=>{
 const root=await directory(t),media=new FileMedia(path.join(root,'media')),provider=withLocalBooks(fake(),library,media),app=createApplication({root:process.cwd(),dataDirectory:root,generation:provider});t.after(()=>app.close());
 const repo=new ReaderRepository(app.services.database),id=crypto.randomUUID();await repo.create(id,'docker-local-owner',selected);
 const row=await repo.get(id,'docker-local-owner');await app.services.database.prepare("UPDATE reader_sessions SET document=?,generation_control='paused' WHERE id=?").bind(JSON.stringify({plan:{...plan,sourceReference:'《庄子·齐物论》'},images:[],audio:[],usage:[]}),id).run();
 const response=await app.handle(new Request(`http://localhost/api/reader/sessions/${id}/source`,{method:'POST'}));assert.equal(response.status,200);const body=await response.json();assert.equal(body.source.kind,'chapter');assert.match(body.source.provider,/本地书库/);assert.match(body.source.text,/北冥|南郭|庄周/);assert.equal(body.searchUrl,'');assert.equal((await repo.get(id,'docker-local-owner')).page,row.page);
});

test('local recommendation persists the exact original before inference and rejects tampered receipts or source anomalies',async t=>{
 const root=await directory(t),db=openDatabase(root,process.cwd());t.after(()=>db.close());
 const repo=new ReaderRepository(db.database),store=new FileMedia(path.join(root,'media')),book=await library.book(selected),selection={...selected,length:'auto',narrativeDetail:'balanced',source:ref(book)};
 let calls=0;const base=fake();base.generator=()=>({...fake().generator(),async recommend(s,id,original){
  calls++;assert.equal(JSON.parse((await repo.get(id,'test')).document).original.text,original.text);assert.ok(await store.get(`reader/${id}/source.json`));
  return {value:{count:8,reason:'按这篇寓言的因果与转折完整叙述。'},model:'mock',requestId:'mock',usage:null};
 }});
 const generator=withLocalBooks(base,library,store).generator(),id=crypto.randomUUID();await repo.create(id,'test',selection);
 const current=await advanceStory(repo,generator,'test',id,0);assert.equal(current.awaitingFrameCount,true);assert.equal(calls,1);assert.equal(current.story,null);
 const original=JSON.parse((await repo.get(id,'test')).document).original;
 await assert.rejects(generator.recommend({...selection,source:{...selection.source,edition:'0'.repeat(64)}},id,original),e=>e.status===400);
 await assert.rejects(generator.recommend(selection,id,{...original,text:original.text+'□'}),e=>e.status===400);assert.equal(calls,1);
});
