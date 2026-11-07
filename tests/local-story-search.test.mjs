// 通过正式本地提取入口检查双路召回、真实出处、范围和降级。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LocalStorySearch,storyEmbeddingModel,storySearchKey} from '../server/local-story-search.ts';
import {withLocalBooks} from '../server/local-generation.ts';
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
 const result=await f.suggest('乌龟');
 assert.equal(inputs.length,1);
 assert.equal(result.stories[0].title,'乌龟报恩');
 assert.deepEqual(result.stories[0].source,f.stories[0].source);
 assert.deepEqual(await readFile(f.file),before);
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
