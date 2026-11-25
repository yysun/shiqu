// Verify source qualification across all local books, real audited leaks and persisted pre-plan checkpoints.
import test from'node:test';import assert from'node:assert/strict';import {readFile} from 'node:fs/promises';import path from'node:path';import os from'node:os';
import {books} from './fixtures/test-tier.mjs';
import {productionFixture,until} from './fixtures/production.mjs';
import {owner} from './fixtures/book-reference.mjs';
import {emptyDag} from '../lib/production-dag/document.ts';
import{hasSourceAnomaly}from'../server/local-source-quality.ts';import{LocalBooks}from'../server/local-books.ts';import{withLocalBooks}from'../server/local-generation.ts';const library=new LocalBooks(process.cwd()),select=bookId=>({bookId,theme:'信任与担当',artStyle:'ink-pencil',length:8,voice:false}),reference=(b,s,u)=>({edition:b.edition,sectionId:s.id,firstUnit:u.id,lastUnit:u.id});
const plan={title:'可读原文的故事',summary:'他会如何选择？',sourceReference:'不可由模型猜写的出处',adaptationNote:'现代简体旁白，保留原文事实。',reflection:'信任从何而来？',characters:'An adult Chinese scholar wearing plain robes.',pages:Array.from({length:8},()=>({caption:'他仔细观察眼前的事情，终于明白朋友的用心。',prompt:'An adult Chinese scholar carefully observes his friend.'}))};
const provider=onPlan=>({matchStories:async(_theme,stories)=>({matches:stories.map(story=>({id:story.id,verdict:'yes',reason:'原文事件与结果支持本次选题。'}))}),status:async()=>({configured:true,provider:'codex',voiceEnabled:false,models:{text:'mock',image:'mock'}}),safeError:()=> '模拟错误',suggestions:async()=>({stories:[],note:''}),generator:()=>({recommend:async(...args)=>{await onPlan?.(...args);return {value:{count:8,reason:'按原文主线展开。',storySummary:plan.summary,storyMatchReason:'真实行动与结果支持本篇。',storyTitle:'可读原文的故事',artRecommendation:{artStyle:'ink-pencil',reason:'与原文人物和叙事相符。'}},model:'mock',requestId:'mock',usage:null};},original:async()=>assert.fail('No public source lookup'),image:async()=>assert.fail('No image generation'),audio:async()=>assert.fail('No audio'),safeError:()=> '模拟错误'})});

test('known unresolved source encodings and explicit omissions are rejected without normalizing text',()=>{
 const cases=['\ue000','\uf8ff',String.fromCodePoint(0xf0000),String.fromCodePoint(0x10fffd),'\ufffd','\ud800','\udfff','□','&KR0899;','&amp;KR2445;','&amp;amp;kr0001;','&CDP-8BF5;','⿰日月','Ё','Φ','プ','ぁ','【上鹿下旨】','【字形左“扌”右“闭”】','【上左“齿”右“可”，下“女”】','(下有/脱文)','下有脫文。','（编者按：原缺。）'];
 for(const value of cases)assert.equal(hasSourceAnomaly('这段原文保留了一个异常位置：'+value+'，需要核对其真实原字。'),true,value);
 assert.equal(hasSourceAnomaly('原文。下有脱文'),true);
 for(const value of ['𠮷𫠦𰻝𤣥䧿爲','【周日用曰：日当中向热者，炎气直下也。】','【净上，戴随上】【同下】','【上善若水下学上达】','【〈郭璞注：山南为阳，山北为阴。〉】','未知何人? 汉字与ASCII问号均保留。','者上天符命豈闕文乎','表略曰：此为原文中的奏表摘要。','A・B，+−，？！（原注）'])assert.equal(hasSourceAnomaly(value),false,value);
});
test('saved cross-chapter evidence applies reviewed exceptions to its own chapter and rejects tampered parts',async()=>{
 const book=await library.book(select('红楼梦')),start=book.sections[0],end=book.sections.find(s=>s.id==='honglou-058');
 const first=start.units.find(u=>{try{library.resolve(book,reference(book,start,u));return true;}catch{return false;}}),last=end.units.find(u=>u.text.includes('⿰烏刂樹'));
 assert.ok(first&&last);
 const source={...reference(book,start,first),continuations:[{sectionId:end.id,firstUnit:last.id,lastUnit:last.id}]},original=library.resolve(book,source);
 assert.equal(original.localParts.length,2);assert.ok(original.text.includes('⿰烏刂樹'));
 let calls=0;const generator=withLocalBooks(provider(()=>{calls++;}),library,{put:async()=>{},get:async()=>null}).generator(),selection={...select('红楼梦'),source};
 generator.verifyOriginal(selection,original);
 const damaged=structuredClone(original);damaged.localParts[1].sectionId=start.id;assert.throws(()=>generator.verifyOriginal(selection,damaged));
 const missing=structuredClone(original);delete missing.localParts;assert.throws(()=>generator.verifyOriginal(selection,missing));
});

test('retained historical source leaks and current omissions fail closed',async()=>{
 for(const[bookId,sectionId,unitId]of [['太平广记','taiping-003','taiping-003-059'],['红楼梦','honglou-003','honglou-003-018']]){
  const book=await library.book(select(bookId)),section=book.sections.find(s=>s.id===sectionId),unit=section.units.find(u=>u.id===unitId),before=unit.text,source=reference(book,section,unit);if(bookId==='红楼梦')source.edition='fdbf7963910834f5932dc491f44b83cee92f847f6ffc387c47bdaebb6b22bf04';assert.throws(()=>library.resolve(book,source),e=>e.status===400);assert.equal(unit.text,before);
 }
 const b=await library.book(select('太平广记')),s=b.sections[312],start=s.units.findIndex(u=>u.text.includes('下有/脱文'));assert.ok(start>0);assert.throws(()=>library.resolve(b,{edition:b.edition,sectionId:s.id,firstUnit:s.units[start-1].id,lastUnit:s.units[start].id}),e=>e.status===400);
});

test('every shipped book applies the same text and chapter-title rules, preserving rare real glyphs',books,async()=>{
 const catalog=JSON.parse(await readFile('data/library/catalog.json'));
 for(const entry of catalog.books){const b=await library.book(select(entry.id)),s=b.sections[0],u=s.units[0],clean='𫠦𤣥䧿是真实汉字。原文中的人物经过思考，终于明白朋友的用意。';
  const fixture=value=>({...b,sections:[{...s,title:'可读篇题',units:[{...u,text:value,narrative:true,unreadable:false}]}]});
  assert.equal(library.resolve(fixture(clean),reference(b,s,u)).text,clean);
  for(const value of ['&KR0899;','プ','Φ','【字形左“扌”右“闭”】'])assert.throws(()=>library.resolve(fixture(clean+value),reference(b,s,u)),e=>e.status===400,entry.id+value);
  const badTitle=fixture(clean);badTitle.sections[0].title='篇题含&KR0899;';assert.throws(()=>library.resolve(badTitle,reference(b,s,u)),e=>e.status===400);
 }
});

test('candidates, direct preparation and legacy backfill share qualification and never persist a rejected source',async()=>{
 const base=await library.book(select('zhuangzi')),s=base.sections[0],good={id:s.id+'-good',text:'一个人认真倾听朋友的话，终于明白了事情的来龙去脉。',narrative:true},bad={id:s.id+'-bad',text:'这个人看见一本古书，其中写着&KR0899;，但那个字究竟是什么无人知道。',narrative:true},section={...s,title:'测试篇',units:[good,bad]},b={...base,sections:[section],input:{...base.input,text:[good,bad].map(u=>`[${u.id}]\n${u.text}`).join('\n\n')}};
 const books=new LocalBooks(process.cwd());books.book=async()=>b;let writes=0;const values=new Map(),media={get:async key=>{const bytes=values.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},put:async(key,bytes)=>{if(key.startsWith('reader/'))writes++;values.set(key,new Uint8Array(bytes));}},raw=provider();raw.suggestions=async(_selection,excluded,input)=>{const stories=excluded.includes('可读故事')?[{title:'异常故事',description:'不能猜字。',summary:'原文中的人物经历变故并采取行动，事件得到明确结果。',source:reference(b,section,bad)}]:[{title:'可读故事',description:'有完整原文。',summary:'原文中的人物经历变故并采取行动，事件得到明确结果。',source:reference(b,section,good)}];assert.ok(stories.length<=input.scan.maxStories);return {stories,note:'',scan:{blockComplete:false,pendingEvents:[],resolvedEventIds:[]}};};
 const wrapped=withLocalBooks(raw,books,media),batch=await wrapped.suggestions(select('zhuangzi'),[]);assert.deepEqual(batch.stories.map(s=>s.title),['可读故事']);await assert.rejects(wrapped.suggestions(select('zhuangzi'),['可读故事']),e=>e.status===502&&/原文范围无法核对/.test(e.message));
 await assert.rejects(wrapped.generator().prepareOriginal({...select('zhuangzi'),source:reference(b,section,bad)},'bad'),e=>e.status===400);
 await assert.rejects(wrapped.generator().original(select('zhuangzi'),{...plan,sourceReference:'《庄子·测试篇》'},'legacy'),e=>e.status===400);assert.equal(writes,0);
});

test('damaged saved originals reach no model call; readable historical receipts proceed without reloading new editions',async t=>{
 const source={edition:'a'.repeat(64),sectionId:'zhuangzi-old',firstUnit:'zhuangzi-old-001',lastUnit:'zhuangzi-old-001'};
 const books=new LocalBooks(process.cwd());books.book=async()=>assert.fail('Saved readable checkpoints must not load the current edition');
 for(const mode of ['bad-body','bad-title','good-old-version']){
  const f=await productionFixture(t,'codex');f.control.hold=false;
  f.options.generation=withLocalBooks(f.generation,books,f.media);await f.restart();
  const id=crypto.randomUUID(),selection={...select('zhuangzi'),length:4,narrativeDetail:'balanced',source};
  const original={title:mode==='bad-title'?'《庄子·篇题&KR0899;》':'《庄子·可读旧版》',text:mode==='bad-body'?'已存原文中的プ不能被当作正确汉字，也不能靠模型补全。':'旧版原文中，朋友一直信任彼此，终于携手渡过困难。',url:'https://example.test/old',kind:'passage',provider:'本地书库',retrievedAt:'2026-10-26T00:00:00Z',localSource:source};
  const now=new Date().toISOString(),document={plan:null,images:[],audio:[],usage:[],original,dag:emptyDag()};
  await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_control,production_complete,created_at,updated_at) VALUES(?,?,?,?,'active',0,?,?)").bind(id,owner,JSON.stringify(selection),JSON.stringify(document),now,now).run();
  await f.media.put(`reader/${id}/source.json`,new TextEncoder().encode(JSON.stringify(original)),{contentType:'application/json'});
  f.app.services.production.wake();
  if(mode==='good-old-version')await until(()=>f.control.dagCalls.length>0,20000);
  else{
   await until(async()=>{const view=await f.read(id);return view.state==='failed'||view.faults?.length>0;},20000);
   assert.equal(f.control.dagCalls.length,0,mode+': no model call for a damaged original');
  }
  const stored=JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document).original;
  assert.equal(stored.text,original.text);assert.equal(stored.title,original.title);
  assert.deepEqual(JSON.parse(Buffer.from(await(await f.media.get(`reader/${id}/source.json`)).arrayBuffer()).toString()),original);
 }
});

