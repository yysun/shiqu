// Verify durable source-backed discovery across themes, restarts, concurrency and failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalBooks} from '../server/local-books.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {bookInputs} from '../server/local-book-inputs.ts';
import {StoryDiscoveryCache} from '../server/story-discovery-cache.ts';
import {discoveryNamespace,indexInputLimit,summaryInputLimit} from '../server/local-story-discovery.ts';
import {FileMedia} from '../server/media.ts';
import {createApplication} from '../server/app.ts';
import {localIndexJson,localChoicesJson} from '../lib/reader-local-contract.ts';
import {createReaderProvider} from '../server/generation.ts';

const selection={bookId:'zhuangzi',theme:'给我一个反转',artStyle:'ink-pencil',length:8,voice:false,productionPrompt:''};
const memory=()=>{const values=new Map();return {values,get:async key=>{const bytes=values.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},put:async(key,bytes)=>{values.set(key,new Uint8Array(bytes));}};};
function fixture(count=20,size=6000){
 const units=Array.from({length:count},(_,i)=>({id:`zhuangzi-01-${String(i+1).padStart(3,'0')}`,text:'人物终于认清了事情的来龙去脉。'+'字'.repeat(size-20),narrative:true}));
 const book={id:'zhuangzi',title:'庄子',edition:'a'.repeat(64),url:'https://example.org/public',provider:'公开测试原文',sections:[{id:'zhuangzi-01',title:'测试篇',units}],input:{title:'庄子',edition:'a'.repeat(64),text:units.map(u=>`[${u.id}]\n${u.text}`).join('\n\n')}};
 const books=new LocalBooks(process.cwd());books.book=async()=>book;
 const stories=units.map((unit,i)=>({title:`故事${i+1}`,description:'人物面临选择，经过冲突后认清了真相。',source:{edition:book.edition,sectionId:'zhuangzi-01',firstUnit:unit.id,lastUnit:unit.id}}));
 const calls=[];
 const provider={status:async()=>({configured:true,provider:'codex',models:{text:'mock-v1',image:'mock'},voiceEnabled:false}),safeError:()=> '安全错误',generator:()=>({}),suggestions:async(s,excluded,input)=>{
  calls.push({purpose:input.purpose,text:input.text,theme:s.theme,excluded});
  if(input.purpose==='story-index')return {stories:stories.filter(story=>input.text.includes(`[${story.source.firstUnit}]`)).slice(0,12),note:''};
  assert.equal(input.purpose,'candidate-summary');assert.ok(input.text.length<=summaryInputLimit);
  const candidates=JSON.parse(input.text);return {stories:s.theme==='人情冷暖'?candidates.slice(-5):candidates.slice(0,5),note:''};
 }};
 return {book,books,stories,provider,calls};
}
async function until(condition){for(let i=0;!condition();i++){assert.ok(i<1000,'operation did not settle');await new Promise(resolve=>setTimeout(resolve,1));}}

test('cold index is merged once; themes, batches and style changes reuse it; complete theme hits make no model calls',async()=>{
 const f=fixture(),store=memory(),wrapped=withLocalBooks(f.provider,f.books,store),events=[];
 const first=await wrapped.suggestions(selection,[],undefined,{signal:new AbortController().signal,onProgress:p=>events.push(p)});
 const reads=f.calls.filter(c=>c.purpose==='story-index').length;
 assert.equal(reads,bookInputs(f.book,indexInputLimit).length);assert.equal(first.stories.length,5);
 assert.ok(f.calls.filter(c=>c.purpose==='story-index').every(c=>c.theme==='故事索引'&&c.excluded.length===0));
 assert.equal(events.at(-1).completedChars,events.at(-1).totalChars);
 const count=f.calls.length;
 const repeat=await wrapped.suggestions({...selection,length:12,artStyle:'watercolor',productionPrompt:'另一种画风'},[]);
 assert.equal(f.calls.length,count);assert.deepEqual(repeat.stories,first.stories);assert.match(repeat.note,/主题故事缓存/);
 const next=await wrapped.suggestions(selection,first.stories.map(s=>s.title));
 assert.equal(next.stories.length,5);assert.ok(next.stories.every(s=>!first.stories.some(old=>old.source.firstUnit===s.source.firstUnit)));
 const other=await wrapped.suggestions({...selection,theme:'人情冷暖'},[]);
 assert.equal(other.stories.length,5);assert.equal(f.calls.filter(c=>c.purpose==='story-index').length,reads);
});

test('FileMedia cache survives a new application and preserves the JSON/streaming HTTP contracts',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu-discovery-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const f=fixture(10,100),media=new FileMedia(path.join(directory,'media'));
 const make=()=>createApplication({root:process.cwd(),dataDirectory:directory,generation:withLocalBooks(f.provider,f.books,media)});
 let app=make();
 const request=(accept='application/json')=>app.handle(new Request('http://localhost/api/reader/suggestions',{method:'POST',headers:{'Content-Type':'application/json',Accept:accept},body:JSON.stringify(selection)}));
 const first=await (await request()).json(),calls=f.calls.length;assert.equal(first.stories.length,5);app.close();
 app=make();t.after(()=>app.close());
 const repeated=await (await request()).json();assert.deepEqual(repeated.stories,first.stories);assert.equal(f.calls.length,calls);
 const stream=await request('application/x-ndjson'),text=await stream.text();assert.match(text,/"type":"result"/);assert.match(text,/主题故事缓存/);assert.equal(f.calls.length,calls);
});

test('source/parsed content/model/rule identity changes isolate old cache, and invalid saved receipts rebuild safely',async()=>{
 const f=fixture(10,100),store=memory();let wrapped=withLocalBooks(f.provider,f.books,store);
 await wrapped.suggestions(selection,[]);let before=f.calls.filter(c=>c.purpose==='story-index').length;
 for(const [key,bytes] of store.values){const doc=JSON.parse(new TextDecoder().decode(bytes));if(doc.value.stories?.length)doc.value.stories[0].source.firstUnit='fabricated';store.values.set(key,new TextEncoder().encode(JSON.stringify(doc)));}
 wrapped=withLocalBooks(f.provider,f.books,store);const result=await wrapped.suggestions(selection,[]);
 assert.ok(result.stories.every(s=>s.source.firstUnit!=='fabricated'));assert.ok(f.calls.filter(c=>c.purpose==='story-index').length>before);
 before=f.calls.filter(c=>c.purpose==='story-index').length;
 f.provider.status=async()=>({configured:true,provider:'codex',models:{text:'mock-v2',image:'mock'},voiceEnabled:false});
 await wrapped.suggestions(selection,[]);assert.ok(f.calls.filter(c=>c.purpose==='story-index').length>before);
 const original=discoveryNamespace(f.book,'codex','mock-v2');
 assert.notEqual(discoveryNamespace({...f.book,edition:'b'.repeat(64)},'codex','mock-v2'),original);
 assert.notEqual(discoveryNamespace({...f.book,input:{...f.book.input,text:f.book.input.text+'新版正文'}},'codex','mock-v2'),original);
 const previous=localIndexJson.properties.stories.maxItems;
 try{localIndexJson.properties.stories.maxItems=11;assert.notEqual(discoveryNamespace(f.book,'codex','mock-v2'),original);}
 finally{localIndexJson.properties.stories.maxItems=previous;}
});

test('concurrent callers share index and theme expansion but receive their own exclusion views',async()=>{
 const f=fixture(20,100),wrapped=withLocalBooks(f.provider,f.books,memory());
 const [first,second]=await Promise.all([wrapped.suggestions(selection,[]),wrapped.suggestions(selection,f.stories.slice(0,5).map(s=>s.title))]);
 assert.equal(f.calls.filter(c=>c.purpose==='story-index').length,1);
 assert.equal(first.stories.length,5);assert.equal(second.stories.length,5);
 assert.ok(second.stories.every(s=>!first.stories.some(old=>old.source.firstUnit===s.source.firstUnit)));
});

test('one cancelled subscriber leaves shared work alive for another; all-cancelled work saves checkpoints before resuming',async()=>{
 const f=fixture(),store=memory(),gate=[],raw=f.provider.suggestions;
 f.provider.suggestions=async(...args)=>{if(args[2].purpose==='story-index')await new Promise(resolve=>gate.push(resolve));return raw(...args);};
 const wrapped=withLocalBooks(f.provider,f.books,store),a=new AbortController(),b=new AbortController();
 const first=wrapped.suggestions(selection,[],undefined,{signal:a.signal,onProgress:()=>{}}),second=wrapped.suggestions(selection,[],undefined,{signal:b.signal,onProgress:()=>{}});
 const rejected=assert.rejects(first,e=>e.name==='AbortError');await until(()=>gate.length===2);a.abort();await rejected;
 // A second live subscriber still needs every reading batch.
 let released=0;
 while(released<bookInputs(f.book,indexInputLimit).length){await until(()=>gate.length>released);gate[released++]();}
 assert.equal((await second).stories.length,5);
 const g=fixture(),partial=memory(),jobs=[],base=g.provider.suggestions;
 g.provider.suggestions=async(...args)=>{if(args[2].purpose==='story-index')await new Promise(resolve=>jobs.push(resolve));return base(...args);};
 const abort=new AbortController(),leaving=withLocalBooks(g.provider,g.books,partial).suggestions(selection,[],undefined,{signal:abort.signal,onProgress:()=>{}});
 const stopped=assert.rejects(leaving,e=>e.name==='AbortError');await until(()=>jobs.length===2);abort.abort();await stopped;jobs.forEach(resolve=>resolve());
 await until(()=>partial.values.size===2);assert.equal(jobs.length,2);
 g.provider.suggestions=base;const events=[],resumed=withLocalBooks(g.provider,g.books,partial);
 await resumed.suggestions(selection,[],undefined,{signal:new AbortController().signal,onProgress:p=>events.push(p)});
 assert.equal(g.calls.filter(c=>c.purpose==='story-index').length,bookInputs(g.book,indexInputLimit).length);
 assert.ok(events[0].completedChars>0);
});

test('huge merged indexes stay bounded at every selection level and include the final candidate',async()=>{
 const f=fixture(240,100),store=memory(),cache=new StoryDiscoveryCache(store);
 f.stories.forEach(s=>{s.description='这个人物经历复杂冲突并在结尾认清真相。'.repeat(8).slice(0,180);});
 const namespace=discoveryNamespace(f.book,'codex','mock-v1');await cache.write(`${namespace}/index`,{stories:f.stories,rejected:false});
 const wrapped=withLocalBooks(f.provider,f.books,store,cache),batch=await wrapped.suggestions({...selection,theme:'人情冷暖'},[]);
 assert.ok(f.calls.length>1);assert.ok(f.calls.every(c=>c.purpose==='candidate-summary'&&c.text.length<=summaryInputLimit));
 assert.equal(batch.stories.at(-1).source.firstUnit,f.stories.at(-1).source.firstUnit);
});

test('storage and provider failures cannot become successful or exhausted cache entries',async()=>{
 const f=fixture(10,100);
 await assert.rejects(withLocalBooks(f.provider,f.books,{get:async()=>{throw Error('private path');},put:async()=>{}}).suggestions(selection,[]),e=>e.status===503&&!e.message.includes('private'));
 const store=memory();f.provider.suggestions=async()=>{throw Error('provider failed');};
 await assert.rejects(withLocalBooks(f.provider,f.books,store).suggestions(selection,[]),/provider failed/);assert.equal(store.values.size,0);
 const g=fixture(10,100);await assert.rejects(withLocalBooks(g.provider,g.books,{get:async()=>null,put:async()=>{throw Error('private path');}}).suggestions(selection,[]),e=>e.status===503&&!e.message.includes('private'));
});

test('valid exhaustion is cached, while theme matching still runs for a short book',async()=>{
 const f=fixture(4,100),store=memory(),wrapped=withLocalBooks(f.provider,f.books,store);
 const first=await wrapped.suggestions(selection,[]);assert.equal(first.stories.length,4);
 assert.deepEqual(f.calls.map(c=>c.purpose),['story-index','candidate-summary']);
 const calls=f.calls.length,empty=await wrapped.suggestions(selection,first.stories.map(s=>s.title));
 assert.equal(empty.stories.length,0);assert.equal(f.calls.length,calls);assert.match(empty.note,/不足/);
});

test('overlap cannot overflow a smaller index budget or drop large source units',()=>{
 const f=fixture(4,30000),parts=bookInputs(f.book,indexInputLimit),seen=new Set(parts.flatMap(p=>Array.from(p.visible)));
 assert.ok(parts.every(p=>p.input.text.length<=indexInputLimit));assert.equal(seen.size,4);
});

test('cached stories keep content-based art recommendations through selection and later hits',async()=>{
 const f=fixture(6,100),recommendation={artStyle:'ink-pencil',reason:'符合人物沉静的心境。'};
 f.stories.forEach(story=>{story.artRecommendation=recommendation;});
 const wrapped=withLocalBooks(f.provider,f.books,memory()),first=await wrapped.suggestions(selection,[]);
 assert.deepEqual(first.stories[0].artRecommendation,recommendation);
 const second=await wrapped.suggestions(selection,[]);assert.deepEqual(second.stories[0].artRecommendation,recommendation);
});

test('index outcomes stay internal while displayed and cached descriptions do not reveal the twist',async()=>{
 const f=fixture(8,100),raw=f.provider.suggestions;
 f.stories.forEach(story=>{story.description='最终人物识破了骗局并找到了失散的家人，这是内部结局梗概。';});
 f.provider.suggestions=async(...args)=>{const result=await raw(...args);return args[2].purpose==='candidate-summary'?{...result,stories:result.stories.map(story=>({...story,description:'一场偶遇，让他不得不重新审视身边的人。'}))}:result;};
 const wrapped=withLocalBooks(f.provider,f.books,memory()),first=await wrapped.suggestions(selection,[]),second=await wrapped.suggestions(selection,[]);
 assert.match(f.calls.find(c=>c.purpose==='candidate-summary').text,/内部结局梗概/);
 assert.ok(first.stories.every(s=>!s.description.includes('失散的家人')));assert.deepEqual(second.stories,first.stories);
});

test('different receipts with duplicate titles cannot prevent filling five distinct cached stories',async()=>{
 const f=fixture(8,100);f.stories[1].title=f.stories[0].title;
 const wrapped=withLocalBooks(f.provider,f.books,memory()),first=await wrapped.suggestions(selection,[]),calls=f.calls.length;
 assert.equal(first.stories.length,5);assert.equal(new Set(first.stories.map(s=>s.title)).size,5);
 assert.ok(f.calls.filter(c=>c.purpose==='candidate-summary').length>=2);
 assert.deepEqual((await wrapped.suggestions(selection,[])).stories,first.stories);assert.equal(f.calls.length,calls);
});

test('both real adapters preserve duplicate-title summary receipts so discovery can fill the cache',async()=>{
 for(const name of ['codex','gemini']){
  const f=fixture(8,100),store=memory();f.stories[1].title=f.stories[0].title;
  const generate=async prompt=>{const payload=JSON.parse(prompt);return JSON.stringify(await f.provider.suggestions({theme:payload.theme||'故事索引'},[],payload.localBook));};
  const runner={status:async()=>({configured:true,model:'mock-v1'}),run:async job=>({text:await generate(job.prompt),model:'mock-v1',requestId:'mock',usage:null})};
  const transport=async(url,init)=>{const body=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:await generate(body.contents[0].parts[0].text)}]}}]});};
  const provider=createReaderProvider({SHIQU_AI_PROVIDER:name,GEMINI_API_KEY:'mock-only'},store,transport,runner),wrapped=withLocalBooks(provider,f.books,store);
  const batch=await wrapped.suggestions(selection,[]);assert.equal(batch.stories.length,5,name);assert.equal(new Set(batch.stories.map(s=>s.title)).size,5,name);
  assert.ok(f.calls.filter(c=>c.purpose==='candidate-summary').length>=2,name);
 }
});

test('theme output-rule changes invalidate only theme results and reuse the expensive index',async()=>{
 const f=fixture(8,100),wrapped=withLocalBooks(f.provider,f.books,memory());await wrapped.suggestions(selection,[]);
 const reads=f.calls.filter(c=>c.purpose==='story-index').length,selected=f.calls.filter(c=>c.purpose==='candidate-summary').length;
 const previous=localChoicesJson.properties.note.maxLength;
 try{
  localChoicesJson.properties.note.maxLength=301;
  await wrapped.suggestions(selection,[]);
  assert.equal(f.calls.filter(c=>c.purpose==='story-index').length,reads);
  assert.equal(f.calls.filter(c=>c.purpose==='candidate-summary').length,selected+1);
 }finally{localChoicesJson.properties.note.maxLength=previous;}
});
