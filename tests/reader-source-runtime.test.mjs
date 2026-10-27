// Probe the production Node fetch implementation; only the remote HTTP endpoint is simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {lookupOriginal} from '../lib/reader-source.ts';
const selection={bookId:'西游记',storyTitle:'高老庄',theme:'幽默与讽刺',length:10,voice:false};
const plan={sourceReference:'《西游记》第十八回 观音院唐僧脱难 高老庄大圣除魔',pages:[]};
async function upstream(handler,run){
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 try{await run(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(resolve=>server.close(resolve));}
}
test('uncached lookup uses native Node fetch and reads the selected chapter',async()=>{
 await upstream((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({parse:{title:'西遊記/第018回',text:'<p>却说那高老庄上有一高太公，他因女儿婚事忧愁，请来大圣识破妖怪，还这庄上一片安宁。</p>'}}));},async origin=>{
  let calls=0;
  const transport=(url,init)=>{calls++;const parsed=new URL(url);assert.equal(parsed.origin,'https://zh.wikisource.org');assert.equal(parsed.searchParams.get('page'),'西遊記/第018回');return fetch(origin+parsed.pathname+parsed.search,init);};
  const result=await lookupOriginal(selection,plan,transport);assert.equal(result.source.kind,'chapter');assert.match(result.source.text,/高太公/);assert.equal(calls,1);
 });
});
test('native fetch does not follow upstream redirects to another endpoint',async()=>{
 let calls=0;
 await upstream((req,res)=>{calls++;res.writeHead(302,{Location:'/private'});res.end();},async origin=>{
  const result=await lookupOriginal(selection,plan,(url,init)=>fetch(origin,init));
  assert.equal(result.source,null);assert.deepEqual(result.failure,{code:'SOURCE_HTTP_ERROR',status:302});assert.equal(calls,1);
 });
});
