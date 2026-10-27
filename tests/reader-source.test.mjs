import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupOriginal,sourceQuery,originalBlocks,verifiedPassage} from '../lib/reader-source.ts';
import {saveStoryOriginal} from '../lib/reader-source-storage.ts';
const selection={bookId:'shishuo',storyTitle:'曹娥碑',theme:'聪明与糊涂',length:10,voice:false};
const plan={sourceReference:'《世说新语·捷悟》第1则（曹娥碑条）',pages:[{caption:'曹操与杨修一同走到曹娥碑前。'}]};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('generation persists source text and future calls reuse the story cache without external retrieval',async()=>{
 const stored=new Map();let writes=0;
 const assets={async get(key){const bytes=stored.get(key);return bytes?{async arrayBuffer(){return bytes.slice().buffer;}}:null;},async put(key,bytes){writes++;stored.set(key,bytes);}};
 const noNetwork=async()=>{throw Error('must not make external requests');};
 const first=await saveStoryOriginal(assets,selection,plan,'existing-story',noNetwork);
 assert.equal(writes,1);assert.ok(stored.has('reader/existing-story/source.json'));
 const second=await saveStoryOriginal(assets,selection,{...plan,pages:[]},'existing-story',noNetwork);
 assert.deepEqual(second.source,first.source);assert.equal(writes,1);
});
test('existing generated Cao E story gains verified original without regenerating or relying on the inaccurate item number',async()=>{
 const result=await lookupOriginal(selection,plan,async()=>{throw Error('must not call provider');});
 assert.match(result.source.text,/魏武尝过曹娥碑下/);assert.match(result.source.text,/乃觉三十里/);
 assert.equal(result.source.kind,'passage');assert.equal(result.source.title.includes('第1则'),false);
 assert.match(result.source.url,/wikisource/);assert.equal(result.message,'');
 assert.equal(verifiedPassage({...selection,bookId:'三国演义'},plan),null);
 assert.equal(verifiedPassage(selection,{...plan,sourceReference:'《世说新语·捷悟》',pages:[{caption:'杨修看见门上的活字。'}]}).text.includes('曹娥碑'),true); // chosen title still identifies this story
 assert.equal(verifiedPassage({...selection,storyTitle:'门中活字'},{sourceReference:'《世说新语·捷悟》',pages:[{caption:'杨修看见门上的活字。'}]}),null);
});
test('original chapter is retrieved as text from a matching book and traditional titles are recognized',async()=>{
 const selected={...selection,bookId:'zhuangzi',storyTitle:'齐物论节选'},p={sourceReference:'《庄子·齐物论》',pages:[]};const calls=[];
 const result=await lookupOriginal(selected,p,async(url)=>{calls.push(url);return json({parse:{title:'莊子/齊物論',text:'<div><table><tr><td>目录广告</td></tr></table><p>昔者莊周夢為胡蝶，栩栩然胡蝶也，自喻適志與！不知周也。俄然覺，則蘧蘧然周也。</p><script>untrusted()</script></div>'}});});
 assert.equal(calls.length,1);assert.equal(new URL(calls[0]).hostname,'zh.wikisource.org');
 assert.equal(new URL(calls[0]).searchParams.get('page'),'莊子/齊物論');
 assert.match(result.source.text,/庄周梦为胡蝶/);assert.doesNotMatch(result.source.text,/目录|untrusted/);assert.equal(result.source.kind,'chapter');
});
test('all existing story topics can read checked excerpts even while the remote API is unavailable',async()=>{
 const topics=[['zhuangzi','《庄子·达生》','佝偻承蜩','仲尼适楚'],['zhuangzi','《庄子·齐物论》','庄周梦蝶','昔者庄周'],['西游记','《西游记》第三十七回至第三十九回','乌鸡国辨怪','改号乌鸡国'],['儒林外史','《儒林外史》第三回','范进中举，胡屠户','原来新贵人欢喜疯了'],['红楼梦','《红楼梦》第六十六回','尤三姐与柳湘莲','是我没福消受']];
 for(const [bookId,sourceReference,storyTitle,text] of topics){
  const result=await lookupOriginal({...selection,bookId,storyTitle},{sourceReference,pages:[]},async()=>{throw Error('source service unavailable');});
  assert.ok(result.source,storyTitle);assert.ok(result.source.text.includes(text));assert.equal(result.source.kind,'passage');assert.ok(result.source.url.startsWith('https://zh.wikisource.org/'));
 }
});
test('search fallback requires the same book and a matching chapter heading',async()=>{
 const selected={...selection,bookId:'liaozhai',storyTitle:'画皮'},p={sourceReference:'《聊斋志异·画皮》',pages:[]};let n=0;
 const result=await lookupOriginal(selected,p,async()=>json(++n===1?{error:{code:'missingtitle'}}:n===2?{query:{search:[{title:'阅微草堂笔记/画皮',pageid:1},{title:'聊齋志異/卷一',pageid:2}]}}:{parse:{title:'聊齋志異/卷一',text:'<h2>別篇</h2><p>这是别篇，不能作为画皮原文显示。</p><h2>畫皮</h2><p>太原王生，早行，遇一女郎，抱襆獨奔，甚艱於步。急走趁之，乃二八姝麗。</p><h2>下一篇</h2><p>下一篇不能混入显示。</p>'}}));
 assert.equal(n,3);assert.match(result.source.text,/太原王生/);assert.doesNotMatch(result.source.text,/别篇|下一篇/);
});
test('unavailable or mismatched source stays explicit and never becomes invented original text',async()=>{
 const selected={...selection,bookId:'zhuangzi'},p={sourceReference:'《庄子·齐物论》',pages:[]};
 const wrong=await lookupOriginal(selected,p,async(url)=>json(new URL(url).searchParams.get('action')==='parse'?{parse:{title:'三国演义/齐物论',text:'<p>这是一段错误的书籍内容，绝对不能作为所选书籍的原文展示给读者。</p>'}}:{query:{search:[]}}));
 assert.equal(wrong.source,null);assert.match(wrong.message,/暂未找到/);
 let count=0;const limited=await lookupOriginal(selected,p,async()=>{count++;return new Response('',{status:429});});
 assert.equal(count,1);assert.equal(limited.source,null);assert.match(limited.message,/无法连接/);
});
test('custom URLs cannot turn original lookup into arbitrary server-side fetches',async()=>{
 assert.deepEqual(sourceQuery({...selection,bookId:'other',customBook:'https://127.0.0.1/private'},{sourceReference:'《世说新语·捷悟》',pages:[]}),{book:'世说新语',chapter:'捷悟'});
 const result=await lookupOriginal({...selection,bookId:'other',customBook:'https://127.0.0.1/private'},{sourceReference:'没有可确认的书籍',pages:[]},async()=>{throw Error('must not fetch');});
 assert.equal(result.source,null);
 assert.deepEqual(originalBlocks('<p>原文正文<span class="noprint">不能显示</span>&amp;字句</p>'),[{tag:'p',text:'原文正文&字句'}]);
});
