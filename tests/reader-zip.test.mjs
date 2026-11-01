// Verify complete WebP ZIP exports, preserved dimensions and fail-closed retrieval/encoding.
import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {makeStory} from './fixtures/story.mjs';
import {assertZipReady,createStoryZip,zipFilename} from '../lib/reader-zip.ts';
import {view} from '../lib/reader-model.ts';

function browserImages(t){
 const previous={Image:globalThis.Image,document:globalThis.document},urls=new Map(),canvases=[],revoked=[];
 const controls={failure:null,canvases,revoked};
 globalThis.Image=class{
  naturalWidth=941;naturalHeight=1672;src='';
  async decode(){if(controls.failure==='decode')throw Error('invalid image');this.bytes=new Uint8Array(await urls.get(this.src).arrayBuffer());}
 };
 globalThis.document={createElement(tag){
  assert.equal(tag,'canvas');
  const canvas={width:0,height:0,getContext(){return controls.failure==='context'?null:{drawImage(image,x,y){assert.equal(x,0);assert.equal(y,0);canvas.image=image;}};},toBlob(callback,type,quality){
   assert.equal(type,'image/webp');assert.equal(quality,.85);
   canvas.encodedSize=[canvas.width,canvas.height];
   callback(controls.failure==='empty'?null:new Blob([Uint8Array.of(99,...canvas.image.bytes)],{type:controls.failure==='format'?'image/png':'image/webp'}));
  }};
  canvases.push(canvas);return canvas;
 }};
 t.mock.method(URL,'createObjectURL',blob=>{const url='blob:test-'+urls.size;urls.set(url,blob);return url;});
 t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 return controls;
}

test('ZIP requires every image and sanitizes the archive filename',()=>{
 const story=makeStory();
 assert.throws(()=>assertZipReady({...story,pages:[]}),/所有画面/);
 assert.throws(()=>assertZipReady({...story,pages:[{...story.pages[0],image:''}]}),/所有画面/);
 assert.equal(zipFilename('故事/名字?'),'故事名字.zip');
});

test('ZIP converts PNG/JPEG at original dimensions, preserves WebP and matches scene metadata',async t=>{
 const browser=browserImages(t);
 globalThis.location={origin:'http://localhost:3000'};
 t.after(()=>{delete globalThis.location;});
 const formats=['png','jpeg','webp'],bodies=Array.from({length:12},(_,i)=>new Uint8Array([i,4,8,15,16,23,42]));
 const fetched=[];
 t.mock.method(globalThis,'fetch',async (url,options)=>{
  const i=fetched.length;fetched.push(url);
  assert.equal(options.credentials,'same-origin');
  return new Response(bodies[i],{headers:{'Content-Type':`image/${formats[i%3]}`}});
 });
 const saved=makeStory(12),usage=[{step:'plan',model:'test-text',requestId:'private-request',usage:{private:'metadata'}},{step:'image:0',model:'test-image',requestId:null,usage:null}];
 const story=view({id:saved.id,selection:JSON.stringify({bookId:saved.bookId,theme:saved.theme,length:12,artStyle:'paper-cut',productionPrompt:'保留故事的转折。'}),document:JSON.stringify({plan:{...saved,sourceReference:'庄子·逍遥游'},images:saved.pages.map(page=>page.image),audio:[],usage}),state:'completed',page:0,saved:1,step_attempts:0,created_at:saved.createdAt,updated_at:saved.updatedAt}).story;
 const progress=[],blob=await createStoryZip(story,value=>progress.push(value));
 assert.equal(blob.type,'application/zip');
 const files=unzipSync(new Uint8Array(await blob.arrayBuffer()));
 assert.equal(Object.keys(files).length,14);
 const script=strFromU8(files['分镜.md']);
 const json=JSON.parse(strFromU8(files['故事.json']));
 assert.deepEqual(json.generationModels,[{step:'plan',model:'test-text'},{step:'image:0',model:'test-image'}]);
 assert.ok(!strFromU8(files['故事.json']).includes('private'));
 for(const key of ['title','hook','bookId','theme','sourceText','sourceUrl','reflection','adaptationNote','revision','createdAt','updatedAt','artStyleLabel','productionPrompt'])assert.deepEqual(json[key],story[key]);
 assert.equal(json.sourceReference,story.sourceReference);
 assert.equal(json.pages.length,12);
 for(let i=0;i<12;i++){
  const filename=`图片/${String(i+1).padStart(2,'0')}.webp`;
  assert.deepEqual(files[filename],i%3===2?bodies[i]:Uint8Array.of(99,...bodies[i]));
  assert.deepEqual(json.pages[i],{caption:story.pages[i].caption,prompt:story.pages[i].prompt,image:filename});
  assert.ok(script.includes(`图片：${filename}`));
  assert.ok(script.includes(story.pages[i].caption));
  assert.ok(script.includes(story.pages[i].prompt));
  assert.equal(fetched[i],`http://localhost:3000${story.pages[i].image}`);
 }
 assert.ok(script.indexOf('## 第 2 幅')<script.indexOf('## 第 10 幅'));
 for(const text of [story.title,story.hook,story.reflection,story.adaptationNote,story.sourceReference,story.productionPrompt,story.artStyleLabel])assert.ok(script.includes(text));
 assert.ok(progress.includes('正在打包第 12 / 12 幅'));
 assert.equal(browser.canvases.length,8);
 assert.equal(browser.revoked.length,8);
 for(const canvas of browser.canvases){assert.deepEqual(canvas.encodedSize,[941,1672]);assert.equal(canvas.width,0);assert.equal(canvas.height,0);}
});

test('ZIP exports stories without generation metadata with an empty model list',async t=>{
 browserImages(t);
 globalThis.location={origin:'http://localhost:3000'};
 t.after(()=>{delete globalThis.location;});
 t.mock.method(globalThis,'fetch',async()=>new Response('image',{headers:{'Content-Type':'image/png'}}));
 const story=makeStory(1),blob=await createStoryZip(story),files=unzipSync(new Uint8Array(await blob.arrayBuffer()));
 const json=JSON.parse(strFromU8(files['故事.json']));
 assert.equal(json.title,story.title);
 assert.deepEqual(json.generationModels,[]);
 assert.equal(json.pages[0].image,'图片/01.webp');
});

test('ZIP rejects failed decoding, missing canvas, empty encoding and PNG fallbacks',async t=>{
 const browser=browserImages(t);
 globalThis.location={origin:'http://localhost:3000'};
 t.after(()=>{delete globalThis.location;});
 t.mock.method(globalThis,'fetch',async()=>new Response('image',{headers:{'Content-Type':'image/png'}}));
 for(const failure of ['decode','context','empty','format']){
  browser.failure=failure;
  await assert.rejects(createStoryZip(makeStory(1)),/第 1 幅.*WebP/);
 }
 assert.equal(browser.revoked.length,4);
 assert.ok(browser.canvases.every(canvas=>canvas.width===0&&canvas.height===0));
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
