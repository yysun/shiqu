// 验证 Ollama 身份兼容、故事卡构建原子性、实时查询和书库备份恢复。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {StoryCardEmbeddingStore,validateOllamaUrl} from '../server/story-card-embeddings.ts';
import {createLibraryBackup,restoreLibraryBackup,verifyLibraryBackup} from '../server/library-backup.ts';
import {createApplication} from '../server/app.ts';

function ollama(){
 const state={digest:'model-digest-a',modified:'v1',dimension:3,delay:false,calls:[]};
 const fetcher=async(url,init={})=>{
  if(init.signal?.aborted)throw init.signal.reason;
  if(url.endsWith('/api/tags'))return Response.json({models:[{name:'embed-a',digest:state.digest,modified_at:state.modified},{name:'text-model',digest:'text',modified_at:'v1'}]});
  if(url.endsWith('/api/show'))return Response.json({capabilities:init.body.includes('embed-a')?['embedding']:['completion'],model_info:{'general.embedding_length':state.dimension}});
  if(url.endsWith('/api/embed')){
   const {input}=JSON.parse(init.body),inputs=Array.isArray(input)?input:[input];state.calls.push(...inputs);
   if(state.delay)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,100);init.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(init.signal.reason);},{once:true});});
   const embeddings=inputs.map(text=>text.includes('雨')||text.includes('祷雨')?[0,1,0]:text.includes('测试连接')?[0,0,1]:[1,0,0]);
   return Response.json({embeddings});
  }
  return new Response('missing',{status:404});
 };
 return {state,fetcher};
}
function fixtureCards(edition='a'.repeat(64)){
 return [
  {id:'card-rain',title:'祷雨',summary:'百姓求雨，解除旱灾。',source:{edition,sectionId:'book-01',firstUnit:'book-01-001',lastUnit:'book-01-001'}},
  {id:'card-pear',title:'种梨',summary:'道士当街种出梨树。',source:{edition,sectionId:'book-01',firstUnit:'book-01-002',lastUnit:'book-01-002'}},
 ];
}
async function setup(t){const directory=await mkdtemp(path.join(tmpdir(),'shiqu-card-embeddings-'));t.after(()=>rm(directory,{recursive:true,force:true}));const oll=ollama(),store=new StoryCardEmbeddingStore(directory,oll.fetcher);return {directory,...oll,store};}

test('本地地址验证限制 SSRF 范围，并让用户预览可用模型',async t=>{
 const {store,state}=await setup(t);assert.equal(validateOllamaUrl('http://127.0.0.1:11434'),'http://127.0.0.1:11434');assert.equal(validateOllamaUrl('http://host.docker.internal:11434'),'http://host.docker.internal:11434');
 for(const value of ['https://localhost','http://example.com','http://127.0.0.1.evil','http://localhost/path','http://user@localhost'])assert.throws(()=>validateOllamaUrl(value));
 const result=await store.test({baseUrl:'http://127.0.0.1:11434',model:'embed-a',enabled:false});assert.equal(result.dimensions,3);assert.deepEqual(result.models,['embed-a']);assert.equal(state.calls.length,1);
});

test('每本书原子存一条卡片向量，实时输入只返回匹配模型和当前卡片的相似度',async t=>{
 const {store,state}=await setup(t),book={id:'soushen',edition:'a'.repeat(64)},cards=fixtureCards();
 store.saveSettings({baseUrl:'http://127.0.0.1:11434',model:'embed-a',enabled:true});
 assert.equal((await store.build(book,cards,new AbortController().signal,()=>{})).indexed,2);
 assert.equal((await store.build(book,cards,new AbortController().signal,()=>{})).indexed,2);
 const status=await store.status([{book,cards}]);assert.equal(status.available,true);assert.equal(status.books[0].ready,true);assert.equal(status.books[0].indexedCount,2);
 const scores=await store.scores(book,cards,'求下雨',new AbortController().signal);assert.ok(scores.get(JSON.stringify([book.edition,['book-01','book-01-001','book-01-001']]))>0.99);
 const changed=fixtureCards();changed[0].summary='村民设法让雨水降下来。';const stale=await store.scores(book,changed,'求下雨',new AbortController().signal);assert.equal(stale.size,1);
 state.digest='model-digest-b';state.modified='v2';const incompatible=await store.scores(book,cards,'求下雨',new AbortController().signal);assert.equal(incompatible,null);
 assert.equal((await store.status([{book,cards}])).books[0].ready,false);
});

test('取消构建不发布半成品；恢复书库后保留完整的用户向量库',async t=>{
 const {directory,store,state,fetcher}=await setup(t),book={id:'soushen',edition:'a'.repeat(64)},cards=fixtureCards();
 store.saveSettings({baseUrl:'http://127.0.0.1:11434',model:'embed-a',enabled:true});state.delay=true;
 const controller=new AbortController(),building=store.build(book,cards,controller.signal,()=>{});setTimeout(()=>controller.abort(),10);await assert.rejects(building);
 assert.equal(store.indexedBooks().length,0);state.delay=false;
 await store.build(book,cards,new AbortController().signal,()=>{});
 const library=path.join(directory,'library'),backup=path.join(directory,'backup'),restored=path.join(directory,'restored');await mkdir(library);
 const sqlite=new DatabaseSync(path.join(library,'shiqu.sqlite'));sqlite.exec('CREATE TABLE sample(value TEXT)');sqlite.close();
 await import('node:fs/promises').then(({copyFile})=>copyFile(store.file,path.join(library,'story-card-vectors.sqlite')));
 const manifest=createLibraryBackup(library,backup,'test');assert.ok(manifest.files.some(file=>file.path==='story-card-vectors.sqlite'));assert.equal(verifyLibraryBackup(backup).files.length,2);
 restoreLibraryBackup(backup,restored);const recovered=new StoryCardEmbeddingStore(restored,fetcher);assert.equal((await recovered.status([{book,cards}])).books[0].ready,true);
});

test('正式 reader API 提供设置、逐书建库、章节和精确故事检索',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'shiqu-card-api-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const embeddingInputs=[];
 const transport=async(url,init={})=>{
  if(url.endsWith('/api/tags'))return Response.json({models:[{name:'embed-a',digest:'api-digest',modified_at:'v1'}]});
  if(url.endsWith('/api/show'))return Response.json({capabilities:['embedding'],model_info:{'general.embedding_length':3}});
  if(url.endsWith('/api/embed')){const {input}=JSON.parse(init.body),items=Array.isArray(input)?input:[input];embeddingInputs.push(...items);return Response.json({embeddings:items.map(()=>[1,0,0])});}
  return new Response('missing',{status:404});
 };
 const app=createApplication({root:process.cwd(),dataDirectory:directory,variables:{SHIQU_AI_PROVIDER:'readonly'},transport});
 t.after(()=>app.close());
 const call=async(path,init)=>app.handle(new Request('http://shiqu.local/api/reader/'+path,init));
 assert.equal((await call('books/embedding-settings')).status,200);
 const settings={baseUrl:'http://127.0.0.1:11434',model:'embed-a',enabled:true};
 assert.equal((await call('books/embedding-settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({settings})})).status,200);
 assert.equal((await call('books/embedding-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({settings})})).status,200);
 const chapter=await call('books/liaozhai/contents?view=chapters');assert.equal(chapter.status,200);assert.ok((await chapter.json()).entries.length);
 const exact=await call('books/liaozhai/search?mode=story&q='+encodeURIComponent('種梨'));assert.equal(exact.status,200);assert.equal((await exact.json()).results[0].exact,true);
 const storySearch=app.services.localBooks.storySearch,originalIndexable=storySearch.indexableCards.bind(storySearch);
 storySearch.indexableCards=async book=>(await originalIndexable(book)).map(card=>card.title==='種梨'?{...card,aliases:['道士种梨']}:card);
 const alias=await call('books/liaozhai/search?mode=story&q='+encodeURIComponent('道士种梨'));assert.equal((await alias.json()).results[0].exact,true);
 const response=await call('books/liaozhai/embedding-index',{method:'POST'});assert.equal(response.status,200);
 const body=await response.text(),events=body.trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(events[0].type,'start');assert.equal(events.at(-1).type,'complete',body);
 const longBooks=[['三国演义',120],['西游记',96],['红楼梦',120],['水浒传',120],['儒林外史',56],['史记',127]];
 for(const [bookId,count] of longBooks){
  embeddingInputs.length=0;
  const longBook=await call('books/'+encodeURIComponent(bookId)+'/embedding-index',{method:'POST'});
  assert.equal(longBook.status,200);
  const events=(await longBook.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(events[0],{type:'start',total:count});
  assert.deepEqual(events.at(-1),{type:'complete',bookId,indexed:count});
  assert.equal(embeddingInputs.length,count);
  assert.ok(embeddingInputs.every(input=>/^故事标题：[^\n]+\n故事梗概：[^\n]+$/u.test(input)));
  if(bookId==='三国演义')assert.match(embeddingInputs[0],/^故事标题：第一回 [^\n]+\n故事梗概：[^\n]*桃园/u);
 }
 const settingsAfter=await (await call('books/embedding-settings')).json();
 assert.ok(settingsAfter.books.some(book=>book.id==='liaozhai'&&book.ready));
 for(const [bookId,count] of longBooks){
  assert.ok(settingsAfter.books.some(book=>book.id===bookId&&book.ready&&book.indexedCount===count));
 }
});
