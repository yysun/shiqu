// 通过正式本地提取入口检查双路召回、真实出处、范围和降级。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {executeHeadless} from '../server/headless-cli.ts';
import {DatabaseSync} from 'node:sqlite';
import {LocalStorySearch,storyEmbeddingModel,storySearchKey} from '../server/local-story-search.ts';
import {groundedStoryEvents} from '../server/local-story-events.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {createReaderProvider} from '../server/generation.ts';
import {bookContents,selectedChapterScope} from '../server/local-book-contents.ts';
import {LocalBooks} from '../server/local-books.ts';
import {FileMedia} from '../server/media.ts';
import {sourceParts} from '../server/local-source-ranges.ts';
import {verifyThemeCandidates} from '../server/story-theme-matching.ts';
import {libraryFixture,selection} from './fixtures/story-library.mjs';

const done={blockComplete:true,pendingEvents:[],resolvedEventIds:[]};
const vector=(...values)=>new Uint8Array(Float32Array.from(values).buffer);
const signal=new AbortController().signal;
async function setup(t,{offline=false,wrongEdition=false}={}){
 const f=libraryFixture(),directory=await mkdtemp(join(tmpdir(),'shiqu-story-search-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=join(directory,'story-search.sqlite'),db=new DatabaseSync(file);
 try{
  db.exec(`CREATE TABLE metadata(key TEXT,value TEXT);
   CREATE TABLE entries(id TEXT,source TEXT,text TEXT,title TEXT,raw_vector BLOB,vector BLOB,blocked TEXT);
   CREATE TABLE passages(story_id TEXT,source_range TEXT,vector BLOB);
   CREATE TABLE query_vectors(key TEXT,model_digest TEXT,vector BLOB);`);
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('identity',JSON.stringify({edition:wrongEdition?'b'.repeat(64):f.book.edition,digests:{[storyEmbeddingModel]:'local-fixture'}}));
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('indexed_book',f.book.id);
  const insert=db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,NULL)');
  insert.run('u1',JSON.stringify(f.stories[0].source),'漁夫與烏龜','龜報恩',null,null);
  insert.run('u2',JSON.stringify(f.stories[1].source),'山中猛虎','勇士護民',vector(1,0),null);
  db.prepare('INSERT INTO passages VALUES (?,?,?)').run('u2',JSON.stringify(f.stories[1].source),vector(0,1));
  const reference=db.prepare('INSERT INTO query_vectors VALUES (?,?,?)');
  for(const query of ['爱情','挺身救人','找乌龟','乌龟'])reference.run(storySearchKey(query),offline?'obsolete':'local-fixture',vector(0,1));
 }finally{db.close();}
 const search=new LocalStorySearch(file);
 const wrapped=withLocalBooks(f.provider,f.books,f.store,f.cache,search);
 const suggest=(theme,extra={},excluded=[],seen=[])=>wrapped.suggestions({...selection,theme,discovery:{mode:'auto'},...extra},excluded,undefined,undefined,seen);
 return {...f,file,search,suggest};
}

test('参考向量版本不符时繁简短词仍可召回未向量化故事',async t=>{
 const f=await setup(t,{offline:true}),before=await readFile(f.file),inputs=[];
 f.provider.suggestions=async(s,_excluded,input)=>{
  inputs.push(input);assert.equal(input.purpose,'scan');assert.equal(s.theme,'乌龟');
  assert.match(input.text,/将搁浅的乌龟送回水中/);assert.doesNotMatch(input.text,/\[u2\]|漁夫與烏龜/);
  return {stories:[f.stories[0]],note:'',scan:done};
 };
 const routes=[];
 await f.search.lookupHits(f.book,'乌龟',signal,false,42,route=>routes.push(route));
 assert.deepEqual(routes,['no-query-vector']);
 const result=await f.suggest('乌龟');
 assert.equal(inputs.length,1);
 assert.equal(result.stories[0].title,'乌龟报恩');
 assert.deepEqual(result.stories[0].source,f.stories[0].source);
 assert.deepEqual(await readFile(f.file),before);
});

test('轻量卡梗概可离线召回，应用只把命中的原文交给提取模型',async t=>{
 const f=await setup(t,{offline:true}),inputs=[];
 const db=new DatabaseSync(f.file);
 try{
  db.exec('ALTER TABLE entries ADD COLUMN summary TEXT');
  db.prepare('UPDATE entries SET summary=? WHERE id=?').run('有人遭野兽袭击，勇士为陌生人挡住危险。','u2');
 }finally{db.close();}
 const query='为陌生人挡住危险';
 f.provider.suggestions=async(_selection,_excluded,input)=>{
  inputs.push(input);
  assert.equal(input.purpose,'scan');
  assert.match(input.text,/击退猛虎/);
  assert.doesNotMatch(input.text,/陌生人挡住危险|\[u1\]/);
  return {stories:[f.stories[1]],note:'',scan:done};
 };
 const before=await readFile(f.file);
 assert.equal((await f.search.lookupHits(f.book,query,signal))[0].summary,'有人遭野兽袭击，勇士为陌生人挡住危险。');
 const command=await executeHeadless(process.cwd(),['books','search',query,'zhuangzi','--data-dir',dirname(f.file)],{localBooks:f.books,variables:{}});
 assert.deepEqual(command.results.map(row=>row.source),[f.stories[1].source]);
 assert.deepEqual((await f.suggest(query)).stories.map(row=>row.source),[f.stories[1].source]);
 assert.equal(inputs.length,1);
 const restricted={...f.book,sections:[{...f.book.sections[0],units:f.book.sections[0].units.slice(0,1)}]};
 assert.deepEqual(await f.search.candidates(restricted,query,signal),[]);
 assert.deepEqual(await readFile(f.file),before);
});

test('两个选题页收到同一组有效回执，晚加入补核的选题页不重复调用模型',async()=>{
 const f=libraryFixture(),status=await f.provider.status();
 const originals=story=>[f.books.resolve(f.book,story.source).text];
 const {promise:retryStarted,resolve:started}=Promise.withResolvers();
 const {promise:retryFinished,resolve:finish}=Promise.withResolvers();
 const {promise:lateReceipt,resolve:received}=Promise.withResolvers();
 let calls=0;
 f.provider.verifyThemeStories=async(_theme,stories)=>{
  calls++;
  if(calls>1){started();await retryFinished;return {matches:[]};}
  const [story]=stories;
  return {matches:[{id:story.id,verdict:'direct',reason:'原文的行动与结果支持本次选题。',evidence:[story.text.slice(0,12)]}]};
 };
 const observe={signal,onProgress:()=>{}};
 const run=notify=>verifyThemeCandidates(f.provider,f.cache,'报恩',f.stories,originals,16000,status,observe,notify);
 const first=run(async()=>{});
 await retryStarted;
 const second=run(async decisions=>{assert.equal(decisions.length,1);received();});
 try{await lateReceipt;}
 finally{finish();}
 assert.deepEqual((await Promise.all([first,second])).map(result=>result.checked),[1,1]);
 assert.equal(calls,2);
});

test('双词预设优先召回两侧都命中的候选，再按原文核对两侧的关系',async t=>{
 const f=await setup(t),section=f.book.sections[0],theme='欲望与代价';
 const texts=[
  '少年想独占金壶，主人答应送给他。后来城里失火，邻人的屋子烧了。',
  '商人想独占金矿，遂卖屋凑钱。矿脉断绝，一无所获。',
  '邻人欲得田地，尽出家资购之。地不可耕，遂无以为生。',
  '他讲述愿望与交友，此篇只议交友。',
 ];
 section.units.splice(0,2,...texts.map((text,index)=>({id:'u'+(index+1),text,narrative:true})));
 f.book.input.text=section.units.map(unit=>'['+unit.id+']\n'+unit.text).join('\n\n');
 const db=new DatabaseSync(f.file);
 try{
  db.exec('ALTER TABLE entries ADD COLUMN summary TEXT; DELETE FROM passages; DELETE FROM entries; DELETE FROM query_vectors;');
  db.prepare('INSERT INTO query_vectors VALUES (?,?,?)').run(storySearchKey(theme),'local-fixture',vector(1,0));
  const insert=db.prepare('INSERT INTO entries (id,source,text,title,summary,raw_vector) VALUES (?,?,?,?,?,?)');
  const cards=[
   ['少年谈欲望','少年希望得到金壶。',null],
   ['商人的代价','商人因欲望卖屋。',null],
   ['邻人购地','邻人购得荒地，从此难以为生。',vector(1,0)],
   ['闲谈','随笔。',null],
  ];
  for(const [index,unit] of section.units.entries()){
   insert.run(unit.id,JSON.stringify({...f.stories[0].source,firstUnit:unit.id,lastUnit:unit.id}),unit.text,...cards[index]);
  }
 }finally{db.close();}
 const runner={status:async()=>({configured:true,model:'mock'}),run:async job=>{
  assert.match(job.instructions,/同一故事的原文必须支持两侧及其在情节中的联系/);
  const input=JSON.parse(job.prompt);
  assert.equal(input.theme,theme);
  assert.deepEqual(input.stories.map(story=>story.title),['商人的代价','邻人购地','少年谈欲望']);
  return {text:JSON.stringify({matches:input.stories.map(({id,text})=>({
   id,verdict:id<=2?'direct':'no',reason:id<=2?'为求财产而花光家资。':'原文缺少两侧之间的联系。',
   evidence:id<=2?[text.split('。')[0]]:[],
  }))}),model:'mock',requestId:'test',usage:null};
 }};
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'codex'},f.store,fetch,runner);
 const wrapped=withLocalBooks(provider,f.books,f.store,f.cache,f.search);
 const result=await wrapped.suggestions({...selection,theme,discovery:{mode:'auto'}},[]);
 assert.deepEqual(result.stories.map(story=>story.title),['商人的代价','邻人购地']);
});

test('语义片段参与召回，指定标题进入模型并保持独立于制作主题',async t=>{
 const f=await setup(t),inputs=[];
 f.provider.suggestions=async(s,_excluded,input)=>{
  inputs.push(input);assert.equal(input.purpose,'catalog');assert.equal(input.scan.targetStoryTitle,'挺身救人');
  assert.equal(s.theme,'');assert.match(input.text,/击退猛虎/);assert.doesNotMatch(input.text,/\[u1\]/);
  return {stories:[f.stories[1]],note:'',scan:done};
 };
 const extra={discovery:{mode:'title',title:'挺身救人'}};
 const result=await f.suggest('爱情与错过',extra);
 assert.deepEqual((await f.suggest('人心与善意',extra)).stories,result.stories);
 assert.equal(inputs.length,1);
 assert.deepEqual(result.stories[0].source,f.stories[1].source);
 assert.deepEqual((await f.search.candidates(f.book,'列一下爱情的故事',signal)).map(range=>range.firstUnit),['u2']);
 assert.deepEqual(await f.search.candidates(f.book,'爱情和复仇',signal),[]);
});

test('候选越界和未完事件被拒绝，顺序提取从完整范围续读',async t=>{
 const f=await setup(t),original=f.provider.suggestions,inputs=[];
 f.provider.suggestions=async(...args)=>{
  const input=args[2];inputs.push(input);
  if(input.purpose==='scan')return {stories:[f.stories[0],f.stories[1]],note:'',scan:{...done,pendingEvents:[{id:'',title:'未收束',source:f.stories[1].source}]}};
  return original(...args);
 };
 const result=await f.suggest('挺身救人');
 assert.deepEqual(inputs.map(input=>input.purpose),['scan','catalog']);
 assert.doesNotMatch(inputs[0].text,/\[u1\]/);
 assert.match(inputs[1].text,/\[u1\]/);
 assert.ok(result.stories.length);
});

test('同次输入合并文字与语义候选，选定原文或过期索引优先走现有校验',async t=>{
 const f=await setup(t),ranges=await f.search.candidates(f.book,'乌龟',signal);
 assert.deepEqual(ranges.map(range=>range.firstUnit),['u1','u2']);
 const scoped={...f.book,sections:[{...f.book.sections[0],units:f.book.sections[0].units.slice(0,1)}]};
 assert.deepEqual((await f.search.candidates(scoped,'乌龟',signal)).map(range=>range.firstUnit),['u1']);
 const stale=await setup(t,{wrongEdition:true});
 await stale.suggest('勇气');
 assert.ok(stale.calls.catalog.length&&stale.calls.catalog.every(call=>call.input.purpose==='catalog'));
});


test('指定标题存在不相交的未完线索时仍继续核对原文',async t=>{
 const f=await setup(t),inputs=[];
 f.provider.suggestions=async(_selection,_excluded,input)=>{
  inputs.push(input);assert.equal(input.scan.targetStoryTitle,'找乌龟');
  const pendingEvents=inputs.length===1?[{id:'',title:'未读完的同一目标',source:f.stories[1].source}]:[];
  return {stories:[inputs.length===1?f.stories[0]:f.stories[1]],note:'',scan:{...done,pendingEvents}};
 };
 const result=await f.suggest('主题',{discovery:{mode:'title',title:'找乌龟'}});
 assert.equal(inputs.length,2);
 assert.deepEqual((await f.search.candidates(f.book,'找乌龟',signal,true)).map(range=>range.firstUnit),['u2','u1']);
 assert.deepEqual(result.stories[0].source,f.stories[1].source);
});

test('事件卡用原文核验，白话词和事件向量都能召回同一条出处',async t=>{
 const f=await setup(t),db=new DatabaseSync(f.file);
 const event={topic:'救援',actor:'勇士',action:'挺身救村',object:'村民',purpose:'保护村民',outcome:'击退猛虎',status:'成功',terms:['挺身救村'],evidence:['山中猛虎']};
 assert.deepEqual(groundedStoryEvents([{...event,evidence:[1]}],'山中猛虎',storySearchKey,['山中猛虎']),[event]);
 assert.equal(groundedStoryEvents([{...event,evidence:[2]}],'山中猛虎',storySearchKey,['山中猛虎']),undefined);
 try{
  db.exec('CREATE TABLE event_cards(story_id TEXT,source_range TEXT,events TEXT,vectors BLOB,dimensions INTEGER)');
  const insert=db.prepare('INSERT INTO event_cards VALUES (?,?,?,?,2)');
  insert.run('u1',JSON.stringify(f.stories[0].source),JSON.stringify([{...event,terms:['错误事件']}]),vector(1,0));
  insert.run('u2',JSON.stringify(f.stories[0].source),JSON.stringify([{...event,terms:['过期事件']}]),vector(0,1));
  insert.run('u2',JSON.stringify(f.stories[1].source),JSON.stringify([event]),vector(1,0));
  db.prepare('DELETE FROM passages').run();
  db.prepare('UPDATE entries SET raw_vector=NULL').run();
  db.prepare('INSERT INTO query_vectors VALUES (?,?,?)').run('见义勇为','local-fixture',vector(1,0));
 }finally{db.close();}
 assert.deepEqual((await f.search.candidates(f.book,'挺身救村',signal)).map(range=>range.firstUnit),['u2']);
 assert.deepEqual((await f.search.candidates(f.book,'见义勇为',signal)).map(range=>range.firstUnit),['u2']);
 assert.deepEqual(await f.search.candidates(f.book,'错误事件',signal),[]);
 assert.deepEqual(await f.search.candidates(f.book,'过期事件',signal),[]);
 const result=await f.suggest('挺身救村');
 assert.deepEqual(result.stories[0].source,f.stories[1].source);
 assert.match(f.calls.catalog[0].input.text,/最终击退猛虎/);
 assert.doesNotMatch(f.calls.catalog[0].input.text,/行动：|挺身救村/);
});

test('CLI 离线检索返回同一候选的原文，并区分索引缺失与无匹配',async t=>{
 const f=await setup(t),directory=dirname(f.file);
 const command=(args,dir=directory)=>executeHeadless(process.cwd(),['books','search',...args,'--data-dir',dir],{localBooks:f.books,variables:{}});
 const result=await command(['乌龟','--limit','1']);
 assert.deepEqual(await command(['乌龟','zhuangzi','--limit','1']),result);
 assert.equal(result.bookId,'zhuangzi');
 assert.equal(result.results.length,1);
 assert.equal(result.results[0].rank,1);
 assert.deepEqual(result.results[0].source,f.stories[0].source);
 assert.match(result.results[0].excerpt,/把落水的渔夫驮回岸边/);
 assert.deepEqual((await command(['毫不相关的词'])).results,[]);
 await assert.rejects(command(['乌龟','--limit','0']),error=>error.code==='INVALID_LIMIT');
 await assert.rejects(command(['乌龟'],join(directory,'absent')),error=>error.code==='SEARCH_INDEX_UNAVAILABLE');
 await assert.rejects(stat(join(directory,'shiqu.sqlite')),error=>error.code==='ENOENT');
 await assert.rejects(stat(join(directory,'absent')),error=>error.code==='ENOENT');
 const db=new DatabaseSync(f.file);
 try{db.prepare("DELETE FROM metadata WHERE key='indexed_book'").run();}finally{db.close();}
 await assert.rejects(command(['乌龟']),error=>error.code==='BOOK_ID_REQUIRED');
 assert.deepEqual(await command(['乌龟','zhuangzi','--limit','1']),result);
});

test('手动选中同章多个索引故事时，提取读取所选段落并拒绝跨越漏选的原文',async t=>{
 const f=await setup(t),section=f.book.sections[0];
 section.units.splice(1,0,{id:'gap',text:'这是同章未被勾选的另一则原文。',narrative:true});
 const books=new LocalBooks(process.cwd(),f.search);books.book=async()=>f.book;
 const db=new DatabaseSync(f.file);
 try{
  db.exec('ALTER TABLE entries ADD COLUMN summary TEXT');
  db.prepare('UPDATE entries SET summary=?').run('这里记载王生经历的另一件事。');
 }finally{db.close();}
 assert.deepEqual((await bookContents(books,selection,'王生','chapters')).entries,[]);
 assert.deepEqual((await bookContents(books,selection,'','chapters')).entries.map(entry=>entry.kind),['chapter']);
 const found=(await bookContents(books,selection,'王生')).entries;
 assert.deepEqual(found.map(entry=>entry.kind),['story','story']);
 assert.deepEqual(found.map(entry=>entry.source),f.stories.map(story=>story.source));
 const sources=found.map(entry=>entry.source);
 const scoped=await selectedChapterScope(books,f.book,[...sources].reverse());
 assert.deepEqual(scoped.discoverySources,sources);
 assert.deepEqual(scoped.book.sections[0].units.map(unit=>unit.id),['u1','u2']);
 const crossed={...sources[0],lastUnit:sources[1].lastUnit};
 assert.throws(()=>sourceParts(scoped.book,crossed),error=>error.status===400);
 const chapters=(await bookContents(books,selection)).entries.filter(entry=>entry.kind==='chapter');
 const mixed=await selectedChapterScope(books,f.book,[...sources,chapters[0].source]);
 assert.deepEqual(mixed.book.sections[0].units.map(unit=>unit.id),['u1','gap','u2']);
 const suggest=f.provider.suggestions;
 f.provider.suggestions=async(...args)=>{
  const {text}=args[2];
  assert.match(text,/\[u1\]/);assert.match(text,/\[u2\]/);assert.doesNotMatch(text,/\[gap\]/);
  return suggest(...args);
 };
 const wrapped=withLocalBooks(f.provider,books,f.store,f.cache,f.search);
 const scopedSelection={...selection,theme:'原典故事',discovery:{mode:'auto'},discoverySources:sources};
 const first=await wrapped.suggestions(scopedSelection,[]);
 const second=await wrapped.suggestions(scopedSelection,[first.stories[0].title],undefined,undefined,[first.stories[0].source]);
 assert.deepEqual([...first.stories,...second.stories].map(story=>story.source),sources);
 const forged={...sources[0],lastUnit:'gap'};
 await assert.rejects(selectedChapterScope(books,f.book,[sources[1],forged]),error=>error.status===400);
});

test('主题核对完整的 50 条索引候选，证据真实才按明确和暗示分页',async t=>{
 const f=await setup(t),section=f.book.sections[0],db=new DatabaseSync(f.file);
 try{
  db.exec('DELETE FROM entries; DELETE FROM passages; DELETE FROM query_vectors;');
  db.prepare('INSERT INTO query_vectors VALUES (?,?,?)').run(storySearchKey('复仇'),'local-fixture',vector(1,0));
  const insert=db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,NULL)');
  section.units=Array.from({length:53},(_,i)=>{
   const n=i+1,id='story-'+n,text='原文第'+n+'篇。此处保留足够长度，以核对人物行动、缘由及结果。';
   insert.run(id,JSON.stringify({edition:f.book.edition,sectionId:section.id,firstUnit:id,lastUnit:id}),text,'故事 '+n,vector(1,0),null);
   return {id,text,narrative:true};
  });
  f.book.input.text=section.units.map(unit=>'['+unit.id+']\n'+unit.text).join('\n\n');
 }finally{db.close();}
 const books=new LocalBooks(process.cwd(),f.search);books.book=async()=>f.book;
 const calls=[],runner={status:async()=>({configured:true,model:'configured-extraction-model'}),run:async job=>{
  assert.equal(job.model,undefined);
  assert.match(job.instructions,/情节支持但需要推断/);
  const {theme,stories}=JSON.parse(job.prompt);
  assert.equal(theme,'复仇');assert.ok(stories.length<=50);
  const ids=stories.map(story=>Number(story.title.slice(3)));
  calls.push(ids);
  const matches=stories.map(({id,text},index)=>{
   const n=ids[index],verdict=[11,24,50].includes(n)?'direct':n===1?'implicit':'no';
   if(n===2&&ids.length>1)return {id,verdict:'direct',reason:'错引其他故事。',evidence:['原文第11篇']};
   return {id,verdict,reason:'人物行动与原文情节吻合。',evidence:verdict==='no'?[]:[text.split('。')[0]]};
  });
  return {text:JSON.stringify({matches}),model:'configured-extraction-model',requestId:'test',usage:null};
 }};
 const cacheDirectory=join(dirname(f.file),'media');
 function open(){
  const media=new FileMedia(cacheDirectory);
  return withLocalBooks(createReaderProvider({SHIQU_AI_PROVIDER:'codex'},media,fetch,runner),books,media,undefined,f.search);
 }
 const provider=open();
 const query={...selection,theme:'复仇',discovery:{mode:'auto'}};
 const observed=[],observer={maxStories:1,signal,onProgress:p=>observed.push(p)};
 const first=await provider.suggestions(query,[],undefined,observer);
 assert.deepEqual(first.stories.map(row=>row.title),['故事 11']);
 assert.match(first.note,/50\/50/);
 assert.deepEqual(calls.map(batch=>batch.length),[50,1]);
 assert.equal(new Set(calls.flat()).size,50);
 assert.equal(observed.at(-1).completed,50);
 const reopened=open();
 const lookup=f.search.lookupHits;
 f.search.lookupHits=async()=>assert.fail('审核通过的候选已入库，无须查索引');
 const warm=await reopened.suggestions(query,[],undefined,observer);
 assert.deepEqual(warm.stories,first.stories);
 assert.match(warm.note,/已复用本地故事库及主题判断缓存/);
 assert.equal(calls.length,2);
 f.search.lookupHits=lookup;
 const second=await reopened.suggestions(query,[],undefined,undefined,first.stories.map(story=>story.source));
 assert.deepEqual(second.stories.map(row=>row.title),['故事 24','故事 50','故事 1']);
 assert.match(second.stories.at(-1).matchReason,/情节暗示/);
 assert.equal(calls.length,2);
 const scope=(await bookContents(books,query)).entries.filter(entry=>['故事 1','故事 2'].includes(entry.title)).map(entry=>entry.source);
 const scoped=await reopened.suggestions({...query,discoverySources:scope},[],undefined,observer);
 assert.deepEqual(scoped.stories.map(row=>row.title),['故事 1']);
 assert.deepEqual(calls.slice(2),[[1,2],[2]]);
});

test('多段原文的系统标签和跨段拼接都不能当作主题证据',async t=>{
 const f=await setup(t),source={...f.stories[0].source,continuations:[{sectionId:'s1',firstUnit:'u2',lastUnit:'u2'}]},db=new DatabaseSync(f.file);
 try{
  db.exec("DELETE FROM entries WHERE id='u2'; DELETE FROM passages;");
  db.prepare('UPDATE entries SET source=? WHERE id=?').run(JSON.stringify(source),'u1');
 }finally{db.close();}
 let calls=0;
 f.provider.verifyThemeStories=async(_theme,[story])=>{
  assert.doesNotMatch(story.text,/出处/);
  const evidence=[['【出处：第一章】'],['驮回岸边勇士面对'],['乌龟把落水的渔夫驮回岸边']][calls++];
  return {matches:[{id:story.id,verdict:'direct',reason:'乌龟救回曾经救它的渔夫。',evidence}]};
 };
 f.provider.suggestions=async()=>assert.fail('索引候选的核对结果不应退回无证据的旧提取');
 const query={...selection,theme:'乌龟',discovery:{mode:'auto'}};
 const wrapped=withLocalBooks(f.provider,f.books,f.store,f.cache,f.search);
 const incomplete=await wrapped.suggestions(query,[]);
 assert.deepEqual(incomplete.stories,[]);
 assert.match(incomplete.note,/0\/1.*还没有确认/);
 assert.equal(calls,2);
 const recovered=await wrapped.suggestions(query,[]);
 assert.equal(recovered.stories.length,1);
 assert.match(recovered.note,/1\/1/);
 assert.equal(calls,3);
});

test('逐书导入可读取 WAL 提交，支持纯文字索引，更新或失败不影响其他书',async t=>{
 const f=await setup(t),directory=join(dirname(f.file),'installed'),second=libraryFixture();
 second.book.id='shishuo';second.book.edition='b'.repeat(64);
 const secondFile=join(dirname(f.file),'second.sqlite'),db=new DatabaseSync(secondFile);
 t.after(()=>db.close());
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE entries(id TEXT,source TEXT,text TEXT,title TEXT,summary TEXT,blocked TEXT)');
 db.prepare('INSERT INTO metadata VALUES (?,?)').run('indexed_book',second.book.id);
 db.prepare('INSERT INTO metadata VALUES (?,?)').run('identity',JSON.stringify({edition:second.book.edition}));
 const source={...second.stories[0].source,edition:second.book.edition};
 db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,NULL)').run('u1',JSON.stringify(source),'漁夫與烏龜','烏龜報恩','洪水中获救');
 const search=new LocalStorySearch(join(directory,'story-search.sqlite'));
 const books=new LocalBooks(process.cwd(),search);books.book=async ({bookId})=>bookId===f.book.id?f.book:bookId===second.book.id?second.book:null;
 const cli=(...args)=>executeHeadless(process.cwd(),['books',...args,'--data-dir',directory],{localBooks:books,variables:{}});
 assert.deepEqual(await books.semanticIndexBooks(),[]);
 await cli('index-import',f.book.id,f.file);
 assert.deepEqual((await cli('search','乌龟','--limit','1')).results.map(row=>row.source),[f.stories[0].source]);
 await cli('index-import',second.book.id,secondFile);
 assert.deepEqual(await books.semanticIndexBooks(),[{id:f.book.id,cardCount:2}]);
 assert.equal(await search.semanticIndexCardCount({...f.book,edition:'c'.repeat(64)}),0);
 assert.deepEqual(await search.lookup(second.book,'洪水中获救',signal),[source]);
 assert.deepEqual(await search.lookup(f.book,'爱情',signal),[f.stories[1].source]);
 await assert.rejects(cli('search','乌龟'),error=>error.code==='BOOK_ID_REQUIRED');
 await assert.rejects(cli('index-import',second.book.id,f.file),error=>error.code==='INVALID_STORY_INDEX');
 assert.deepEqual(await search.lookup(second.book,'洪水中获救',signal),[source]);
 db.prepare('UPDATE entries SET summary=?').run('渔夫得救');
 await cli('index-import',second.book.id,secondFile);
 assert.deepEqual(await search.lookup(second.book,'渔夫得救',signal),[source]);
 assert.deepEqual(await search.lookup(f.book,'爱情',signal),[f.stories[1].source]);
 assert.equal(await search.lookup({...second.book,edition:'c'.repeat(64)},'渔夫得救',signal),null);
 await assert.rejects(stat(join(directory,'shiqu.sqlite')),error=>error.code==='ENOENT');
});

test('主题核对在缺索引或文字无候选时读取指定章节原文',async t=>{
 for(const missing of [false,true]){
  const f=await setup(t),query={...selection,theme:'知恩图报',discovery:{mode:'auto'}};
  const section=f.book.sections[0],scope={edition:f.book.edition,sectionId:section.id,firstUnit:section.units[0].id,lastUnit:section.units.at(-1).id};
  f.provider.verifyThemeStories=async()=>assert.fail('没有候选时直接读原文');
  const search=new LocalStorySearch(missing?join(dirname(f.file),'absent.sqlite'):f.file);
  const result=await withLocalBooks(f.provider,f.books,f.store,f.cache,search).suggestions({...query,discoverySources:[scope]},[]);
  assert.deepEqual(result.stories.map(story=>story.source),[f.stories[0].source]);
  assert.ok(f.calls.catalog.length);
  search.lookupHits=async()=>assert.fail('缓存已满足批次，无须查索引');
  f.provider.matchStories=async()=>assert.fail('已有主题判断，无须调用模型');
  const cached=await withLocalBooks(f.provider,f.books,f.store,f.cache,search).suggestions({...query,discoverySources:[scope]},[],undefined,{signal,maxStories:1,onProgress(){}});
  assert.deepEqual(cached.stories.map(story=>story.source),[f.stories[0].source]);
  assert.match(cached.note,/已复用本地故事库及主题判断缓存/);
 }
});
