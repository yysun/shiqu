// Verify complete, ordered ZIP exports and fail-closed image retrieval.
import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {makeStory} from './fixtures/story.mjs';
import {assertZipReady,createStoryZip,zipFilename} from '../lib/reader-zip.ts';

test('ZIP requires every image and sanitizes the archive filename',()=>{
 const story=makeStory();
 assert.throws(()=>assertZipReady({...story,pages:[]}),/所有画面/);
 assert.throws(()=>assertZipReady({...story,pages:[{...story.pages[0],image:''}]}),/所有画面/);
 assert.equal(zipFilename('故事/名字?'),'故事名字-拾趣-分镜与图片.zip');
});

test('ZIP preserves original image bytes, matching scene order, captions and prompts',async t=>{
 globalThis.location={origin:'http://localhost:3000'};
 t.after(()=>{delete globalThis.location;});
 const formats=['png','jpeg','webp'],bodies=Array.from({length:12},(_,i)=>new Uint8Array([i,4,8,15,16,23,42]));
 const fetched=[];
 t.mock.method(globalThis,'fetch',async (url,options)=>{
  const i=fetched.length;fetched.push(url);
  assert.equal(options.credentials,'same-origin');
  return new Response(bodies[i],{headers:{'Content-Type':`image/${formats[i%3]}`}});
 });
 const story={...makeStory(12),generated:true,sourceReference:'庄子·逍遥游',artStyleLabel:'剪纸艺术',productionPrompt:'保留故事的转折。'};
 const progress=[],blob=await createStoryZip(story,value=>progress.push(value));
 assert.equal(blob.type,'application/zip');
 const files=unzipSync(new Uint8Array(await blob.arrayBuffer()));
 assert.equal(Object.keys(files).length,13);
 const script=strFromU8(files['分镜.md']);
 for(let i=0;i<12;i++){
  const filename=`图片/${String(i+1).padStart(2,'0')}.${['png','jpg','webp'][i%3]}`;
  assert.deepEqual(files[filename],bodies[i]);
  assert.ok(script.includes(`图片：${filename}`));
  assert.ok(script.includes(story.pages[i].caption));
  assert.ok(script.includes(story.pages[i].prompt));
  assert.equal(fetched[i],`http://localhost:3000${story.pages[i].image}`);
 }
 assert.ok(script.indexOf('## 第 2 幅')<script.indexOf('## 第 10 幅'));
 for(const text of [story.title,story.hook,story.reflection,story.adaptationNote,story.sourceReference,story.productionPrompt,story.artStyleLabel])assert.ok(script.includes(text));
 assert.ok(progress.includes('正在打包第 12 / 12 幅'));
});

test('ZIP rejects incomplete, foreign, failed, empty and non-image responses',async t=>{
 globalThis.location={origin:'http://localhost:3000'};
 t.after(()=>{delete globalThis.location;});
 const story=makeStory(2);
 const fetch=t.mock.method(globalThis,'fetch',async()=>new Response('image',{headers:{'Content-Type':'image/png'}}));
 await assert.rejects(createStoryZip({...story,pages:[{...story.pages[0],image:''}]}),/所有画面/);
 await assert.rejects(createStoryZip({...story,pages:[{...story.pages[0],image:'https://other.example/image.png'}]}),/来源不可用/);
 assert.equal(fetch.mock.callCount(),0);
 for(const response of [new Response('missing',{status:404}),new Response('html',{headers:{'Content-Type':'text/html'}}),new Response('',{headers:{'Content-Type':'image/png'}})]){
  fetch.mock.mockImplementation(async()=>response);
  await assert.rejects(createStoryZip(story),/第 1 幅/);
 }
 fetch.mock.mockImplementation(async()=>{throw Error('network offline');});
 await assert.rejects(createStoryZip(story),/network offline/);
});
