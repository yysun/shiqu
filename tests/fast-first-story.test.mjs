// Verify cold-request size, old-cache frontiers, and selected-source art work without live inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalBooks} from '../server/local-books.ts';
import {buildReadingPlan,hydrateReadingPlan,readingPlanKey,legacyReadingPlanKey} from '../server/story-reading-inputs.ts';
import {discoverLocalStories,discoveryNamespace,legacyDiscoveryNamespace} from '../server/local-story-discovery.ts';
import {StoryDiscoveryCache,discoveryHash} from '../server/story-discovery-cache.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {createReaderProvider} from '../server/generation.ts';
import {createApplication} from '../server/app.ts';
import {artRecommendationSchema,isSelectedStory} from '../lib/reader-art-recommendation.ts';
import {suggestionProgressSchema} from '../lib/reader-suggestions.ts';

const selection={bookId:'zhuangzi',storyTitle:'选择之后',theme:'命运与选择',artStyle:'ink-pencil',length:'auto',voice:false,productionPrompt:''};
const recommendation={artStyle:'woodblock',reason:'鲜明的刀刻线条契合人物果断的选择。'};
const memory=()=>{const values=new Map();return {values,get:async key=>{const bytes=values.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},put:async(key,bytes)=>{values.set(key,new Uint8Array(bytes));}};};
function fixture(){
 const sections=Array.from({length:6},(_,i)=>({id:'s'+i,title:'第'+(i+1)+'回',units:Array.from({length:2},(_,j)=>({id:'u'+i+'-'+j,text:'人物终于明白真相，作出自己的选择。'+'字'.repeat(80),narrative:true}))}));
 const book={id:'zhuangzi',title:'测试书',edition:'a'.repeat(64),url:'https://example.org/source',provider:'测试来源',sections,input:{title:'测试书',edition:'a'.repeat(64),text:sections.map(s=>'篇章 '+s.id+'：'+s.title+'\n'+s.units.map(u=>'['+u.id+']\n'+u.text).join('\n\n')).join('\n\n')}};
 const books=new LocalBooks(process.cwd());books.book=async()=>book;
 const stories=sections.flatMap(s=>s.units.map(u=>({title:u.id,description:'一次变故促成了新的选择。',summary:'人物经历事件、作出行动，事情得到完整结果。',source:{edition:book.edition,sectionId:s.id,firstUnit:u.id,lastUnit:u.id}})));
 const provider={status:async()=>({configured:true,provider:'codex',models:{text:'mock',image:'mock'},voiceEnabled:false}),matchStories:async(_theme,stories)=>({matches:stories.map(story=>({id:story.id,verdict:'yes'}))}),safeError:()=> '模拟服务失败',generator:()=>({}),suggestions:async()=>assert.fail('No discovery model call expected'),recommendArt:async()=>recommendation};
 return {book,books,stories,provider};
}

test('small reading plans cap chapters and preserve every unit, even when a whole book fits the old budget',async()=>{
 const library=new LocalBooks(process.cwd());
 for(const bookId of ['zhuangzi','红楼梦']){
  const book=await library.book({bookId}),manifest=buildReadingPlan(book,'codex'),blocks=hydrateReadingPlan(book,manifest);
  assert.equal(manifest.mode,'chapters');assert.ok(manifest.blocks.every(block=>block.tokens<=12000));
  assert.ok(blocks.every(block=>block.chapters.length<=2));
  assert.deepEqual(blocks.flatMap(block=>[...block.visible]),book.sections.flatMap(s=>s.units.map(u=>u.id)));
  if(bookId==='红楼梦'){assert.equal(blocks[0].chapters.length,1);assert.ok(manifest.blocks[0].tokens<10000);assert.equal(legacyDiscoveryNamespace(book,'codex','gpt-6.1-sol'),'39814af4422a40fb156b5fb7ca0ec26aefb605cad89c2b0544e36884fc025c61');}
 }
 const f=fixture();f.book.sections[0].units[0].text='字'.repeat(13000);
 assert.throws(()=>buildReadingPlan(f.book,'codex'),/Single source unit/);
});

test('theme-filtered legacy coverage never skips uncatalogued original, and old files remain intact',async()=>{
 const f=fixture(),store=memory(),cache=new StoryDiscoveryCache(store),theme=discoveryHash(selection.theme);
 const oldBlocks=[f.book.sections.slice(0,3),f.book.sections.slice(3)].map(sections=>({ranges:sections.map(s=>({sectionId:s.id,firstUnit:s.units[0].id,lastUnit:s.units.at(-1).id})),tokens:1000}));
 await cache.write(legacyReadingPlanKey(f.book,'codex')+'/blocks',{mode:'chapters',blocks:oldBlocks});
 const oldKey=legacyDiscoveryNamespace(f.book,'codex','mock')+'/theme/'+theme;
 await cache.write(oldKey,{stories:[f.stories[4]],cursor:1,readThrough:2,pendingEvents:[],exhausted:false,rejected:false});
 const oldBytes=store.values.get('reader-cache/'+discoveryHash(oldKey)+'.json').slice();let calls=0;
 f.provider.suggestions=async(s,_excluded,input)=>{calls++;assert.equal(s.theme,'');assert.equal(input.purpose,'catalog');assert.match(input.text,/\[u0-0\]/);return {stories:[f.stories[0]],note:'',scan:{blockComplete:false,pendingEvents:[],resolvedEventIds:[]}};};
 const batch=await discoverLocalStories(f.provider,f.books,cache,f.book,selection,[]);
 assert.equal(calls,1);assert.deepEqual(batch.stories.map(story=>story.title),[f.stories[0].title]);
 const key=discoveryNamespace(f.book,'codex','mock')+'/library';
 const saved=JSON.parse(new TextDecoder().decode(store.values.get('reader-cache/'+discoveryHash(key)+'.json'))).value;
 assert.equal(saved.cursor,0);assert.equal(saved.stories.length,1);assert.deepEqual(saved.pendingEvents,[]);
 assert.deepEqual(store.values.get('reader-cache/'+discoveryHash(oldKey)+'.json'),oldBytes);
 assert.notEqual(readingPlanKey(f.book,'codex'),legacyReadingPlanKey(f.book,'codex'));
 assert.notEqual(discoveryNamespace(f.book,'codex','other-model'),discoveryNamespace(f.book,'codex','mock'));
});

test('a legacy cache without manifest cannot supply the neutral catalog cursor or records',async()=>{
 const f=fixture(),store=memory(),cache=new StoryDiscoveryCache(store);
 await cache.write(legacyDiscoveryNamespace(f.book,'codex','mock')+'/theme/'+discoveryHash(selection.theme),{stories:[f.stories[5]],cursor:50,readThrough:50,pendingEvents:[],exhausted:false,rejected:false});
 f.provider.suggestions=async()=>({stories:[f.stories[0]],note:'',scan:{blockComplete:false,pendingEvents:[],resolvedEventIds:[]}});
 const batch=await discoverLocalStories(f.provider,f.books,cache,f.book,selection,[]);assert.equal(batch.stories[0].title,f.stories[0].title);
 const key=discoveryNamespace(f.book,'codex','mock')+'/library';
 const saved=JSON.parse(new TextDecoder().decode(store.values.get('reader-cache/'+discoveryHash(key)+'.json'))).value;
 assert.equal(saved.cursor,0);assert.equal(saved.exhausted,false);assert.equal(saved.stories.length,1);
});

test('a delayed library cache miss cannot overwrite newly catalogued stories or progress',async()=>{
 const f=fixture(),store=memory(),cache=new StoryDiscoveryCache(store);
 f.provider.suggestions=async()=>({stories:[f.stories[0]],note:'',scan:{blockComplete:false,pendingEvents:[],resolvedEventIds:[]}});
 const key=discoveryNamespace(f.book,'codex','mock')+'/library',filename='reader-cache/'+discoveryHash(key)+'.json';
 let release,held=false;const gate=new Promise(resolve=>{release=resolve;}),get=store.get;
 store.get=async key=>{const result=await get(key);if(key===filename&&!held){held=true;await gate;}return result;};
 const slow=discoverLocalStories(f.provider,f.books,cache,f.book,selection,[]);
 while(!held)await new Promise(resolve=>setTimeout(resolve,1));
 const first=await discoverLocalStories(f.provider,f.books,cache,f.book,selection,[]);assert.equal(first.stories.length,1);
 f.provider.suggestions=async()=>({stories:[f.stories[1]],note:'',scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}});
 await discoverLocalStories(f.provider,f.books,cache,f.book,selection,[],undefined,first.stories.map(s=>s.source));
 const before=JSON.parse(new TextDecoder().decode(store.values.get(filename))).value;assert.equal(before.cursor,1);assert.equal(before.stories.length,2);
 release();assert.equal((await slow).stories.length,2);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(store.values.get(filename))).value,before);
});

test('active chapters and checking stages validate without pretending an unfinished block is complete',()=>{
 const progress={completed:0,total:3,completedChars:0,totalChars:1000,stage:'checking',mode:'chapters',currentChapters:['第一回','第二回']};
 assert.deepEqual(suggestionProgressSchema.parse(progress),progress);
 assert.throws(()=>suggestionProgressSchema.parse({...progress,currentChapters:['一','二','三']}));
 const f=fixture();assert.equal(isSelectedStory({...selection,storyTitle:f.stories[0].title,source:f.stories[0].source},f.stories[0]),true);
 assert.equal(isSelectedStory({...selection,storyTitle:f.stories[0].title,source:f.stories[1].source},f.stories[0]),false);
});

test('selected-source recommendations validate before inference and share durable results independently of manual style',async()=>{
 const f=fixture(),store=memory();let calls=0;
 f.provider.recommendArt=async(s,original)=>{calls++;assert.ok(original.text.includes(f.book.sections[0].units[0].text));assert.deepEqual(original.localSource,s.source);return recommendation;};
 const provider=withLocalBooks(f.provider,f.books,store),chosen={...selection,source:f.stories[0].source};
 const results=await Promise.all([provider.recommendArt(chosen),provider.recommendArt({...chosen,artStyle:'cinematic'})]);
 assert.deepEqual(results,[recommendation,recommendation]);assert.equal(calls,1);
 assert.deepEqual(await provider.generator().recommendArt(chosen),recommendation);assert.equal(calls,1,'Preparation uses the same durable selected-source art cache');
 assert.deepEqual(await withLocalBooks(f.provider,f.books,store).recommendArt(chosen),recommendation);assert.equal(calls,1);
 for(const bad of [{...chosen,source:undefined},{...chosen,source:{...chosen.source,edition:'b'.repeat(64)}},{...chosen,source:{...chosen.source,sectionId:'foreign-book'}}])await assert.rejects(provider.recommendArt(bad));
 assert.equal(calls,1);
 f.provider.recommendArt=async()=>({...recommendation,artStyle:'invented'});
 await assert.rejects(provider.recommendArt({...chosen,storyTitle:'different'}));
});

test('both providers recommend from the selected verified excerpt with no discovery or image call',async()=>{
 for(const name of ['codex','gemini']){
  let calls=0;const original={title:'第一回',text:'人物终于得知真相。',localSource:fixture().stories[0].source};
  const check=(data,schema)=>{calls++;assert.deepEqual(data.verifiedOriginal,{title:original.title,text:original.text});assert.equal(data.localBook,undefined);assert.deepEqual(schema.required,['artStyle','reason']);return recommendation;};
  const runner={status:async()=>({configured:true}),run:async job=>({text:JSON.stringify(check(JSON.parse(job.prompt),job.schema)),model:'mock',requestId:'mock',usage:null})};
  const transport=async(_url,init)=>{const body=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(check(JSON.parse(body.contents[0].parts[0].text),body.generationConfig.responseFormat.text.schema))}]}}]});};
  const provider=createReaderProvider({SHIQU_AI_PROVIDER:name,GEMINI_API_KEY:'mock-only'}, {},transport,runner);
  await assert.rejects(provider.recommendArt(selection));assert.equal(calls,0);
  assert.deepEqual(await provider.recommendArt(selection,original),recommendation);assert.equal(calls,1);
 }
});

test('art endpoint validates selection/origin, rejects stale receipts and safely isolates recommendation failure',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'shiqu-selected-art-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const f=fixture(),provider=withLocalBooks(f.provider,f.books,memory()),app=createApplication({root:process.cwd(),dataDirectory:dir,generation:provider});t.after(()=>app.close());
 const send=(body,headers={})=>app.handle(new Request('http://localhost/api/reader/art-recommendation',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
 const chosen={...selection,source:f.stories[0].source};
 const success=await send(chosen);assert.equal(success.status,200);assert.deepEqual(artRecommendationSchema.parse(await success.json()),recommendation);
 assert.equal((await send(selection)).status,400);assert.equal((await send(chosen,{Origin:'https://foreign.example'})).status,403);
 assert.equal((await send({...chosen,source:{...chosen.source,edition:'b'.repeat(64)}})).status,400);
 f.provider.recommendArt=async()=>{throw Error('private provider failure');};
 const failure=await send({...chosen,storyTitle:'new'});assert.equal(failure.status,502);assert.deepEqual(await failure.json(),{error:'模拟服务失败'});
});
