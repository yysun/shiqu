// Verify owner/book uniqueness, immutable local snapshots and actual first-frame provider attachments.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,rm} from 'node:fs/promises';import path from 'node:path';
import {productionFixture,makePlan} from './fixtures/production.mjs';
import {savedStory,star,unstar,owner} from './fixtures/book-reference.mjs';
import {png,jpeg,encoded} from './fixtures/images.mjs';
import {BookImageReferences,withBookReference} from '../server/book-image-reference.ts';
import {createReaderProvider} from '../server/generation.ts';
import {transform} from 'esbuild';import {createRequire} from 'node:module';

test('stars replace across stories, cancel with tokens, survive restart, and never alter story checkpoints',async t=>{
 const f=await productionFixture(t),a=await savedStory(f),b=await savedStory(f,{page:1,bytes:jpeg}),other=await savedStory(f,{bookId:'三国演义'});
 const before=(await f.app.services.database.prepare('SELECT * FROM stories ORDER BY id').all()).results;
 assert.equal((await f.json(`library/${a.id}/reference`)).reference,null);
 const first=(await star(f,a.id)).reference;assert.equal((await f.json(`library/${b.id}/reference`)).reference.token,first.token);assert.equal((await f.json(`library/${other.id}/reference`)).reference,null);
 await star(f,b.id,1);const third=(await star(f,a.id)).reference;assert.notEqual(third.token,first.token);
 assert.equal((await unstar(f,a.id,first)).reference.token,third.token,'ABA stale cancellation preserves the new selection');
 await f.restart();assert.equal((await f.json(`library/${b.id}/reference`)).reference.token,third.token);
 assert.equal((await unstar(f,a.id,third)).reference,null);
 assert.deepEqual((await f.app.services.database.prepare('SELECT * FROM stories ORDER BY id').all()).results,before);assert.equal(f.control.calls.length,0);
});

test('concurrent selection stays unique and source deletion clears it without restore resurrection',async t=>{
 const f=await productionFixture(t),a=await savedStory(f),b=await savedStory(f);
 await Promise.all([star(f,a.id),star(f,b.id)]);assert.equal((await f.app.services.database.prepare('SELECT count(*) n FROM book_image_references').first()).n,1);
 const selected=(await f.json(`library/${a.id}/reference`)).reference;
 await f.json(`library/${selected.storyId}`,'DELETE');assert.equal((await f.json(`library/${selected.storyId===a.id?b.id:a.id}/reference`)).reference,null);
 await f.json(`library/${selected.storyId}/restore`,'POST',{});assert.equal((await f.json(`library/${a.id}/reference`)).reference,null);
});

test('strict local-media and owner validation leaves an existing star unchanged',async t=>{
 const f=await productionFixture(t),a=await savedStory(f),selected=(await star(f,a.id)).reference;
 const foreign=await savedStory(f,{ownerId:'other-owner'}),remote=await savedStory(f,{image:'https://example.org/image.png'}),bad=await savedStory(f,{bytes:new Uint8Array([1,2,3])});
 for(const [id,data,status] of [[a.id,{page:-1,starred:true},400],[a.id,{page:2,starred:true},400],[a.id,{page:1,starred:true},400],[a.id,{page:0,starred:false},400],[foreign.id,{page:0,starred:true},404],[remote.id,{page:0,starred:true},400],[bad.id,{page:0,starred:true},400],[a.id,{page:0,starred:true,image:a.url},400]])assert.equal((await f.request(`library/${id}/reference`,'POST',data)).status,status);
 assert.equal((await f.request(`library/${a.id}/reference`,'POST',{page:0,starred:true},{Origin:'https://elsewhere.invalid'})).status,403);
 assert.equal((await f.json(`library/${a.id}/reference`)).reference.token,selected.token);
});

test('a deletion during media loading cannot resurrect a source selection',async t=>{
 const f=await productionFixture(t),a=await savedStory(f),get=f.app.services.media.get.bind(f.app.services.media);let release,started=false;
 f.app.services.media.get=async key=>{const object=await get(key);if(key===`reader/${a.id}/0.png`){started=true;await new Promise(resolve=>release=resolve);}return object;};
 const setting=f.request(`library/${a.id}/reference`,'POST',{page:0,starred:true});while(!started)await new Promise(resolve=>setImmediate(resolve));
 await f.json(`library/${a.id}`,'DELETE');release();assert.equal((await setting).status,409);assert.equal((await f.app.services.database.prepare('SELECT count(*) n FROM book_image_references').first()).n,0);
});

test('snapshots stay immutable, normalize known custom book names, and fail before paid use if lost',async t=>{
 const f=await productionFixture(t),a=await savedStory(f),b=await savedStory(f,{bookId:'other',customBook:' 红楼梦 '});
 const selected=(await star(f,a.id)).reference;assert.equal((await f.json(`library/${b.id}/reference`)).reference.token,selected.token);
 await f.app.services.media.put(`reader/${a.id}/0.png`,new Uint8Array(await readFile(new URL('./fixtures/images/gemini.png',import.meta.url))),{contentType:'image/png'});
 const refs=new BookImageReferences(f.app.services.database,f.app.services.media,owner),url=await refs.resolve(b.id,'');
 assert.deepEqual((await f.app.services.media.get('reader/'+b.id+'/'+url.split('/'+b.id+'/')[1])).body,png);
 const row=await f.app.services.database.prepare('SELECT asset_key FROM book_image_references').first();await rm(path.join(f.dataDirectory,'media',row.asset_key));
 let calls=0;const generator=withBookReference({image:async()=>{calls++;}},refs);await assert.rejects(generator.image(makePlan(2),0,b.id,''),/参考图不可用/);assert.equal(calls,0);
 await unstar(f,a.id,selected);assert.equal(await refs.resolve(b.id,'saved-first'),'saved-first');
});

for(const provider of ['codex','gemini','openai'])test(`${provider}: first and later frames attach the resolved reference and reject another story namespace`,async()=>{
 const attached=[],media={get:async()=>({arrayBuffer:async()=>jpeg.slice().buffer}),put:async()=>{}},runner={status:async()=>({configured:true}),run:async job=>{attached.push(job.image?.bytes);return {image:encoded,model:'controlled',requestId:'test',usage:null};}};
 const transport=async(_url,init)=>{
  if(provider==='openai'){assert.ok(init.body instanceof FormData);attached.push(new Uint8Array(await init.body.get('image[]').arrayBuffer()));return Response.json({data:[{b64_json:encoded}]});}
  const body=JSON.parse(init.body);attached.push(new Uint8Array(Buffer.from(body.contents[0].parts.find(part=>part.inlineData).inlineData.data,'base64')));return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:encoded}}]}}]});
 };
 const p=createReaderProvider({SHIQU_AI_PROVIDER:provider,GEMINI_API_KEY:'controlled',OPENAI_API_KEY:'controlled'},media,transport,runner),g=p.generator();
 for(const page of [0,1])await g.image(makePlan(2),page,'target','/api/reader/media/target/0.png','cartoon');
 assert.equal(attached.length,2);for(const bytes of attached)assert.deepEqual(bytes,jpeg);
 await assert.rejects(g.image(makePlan(2),0,'target','/api/reader/media/other/0.png','cartoon'));assert.equal(attached.length,2);
});

test('page changes ignore late reads/saves and keep the write lock until authoritative reload',async()=>{
 const compiled=await transform(await readFile('client/useBookReference.ts','utf8'),{loader:'ts',format:'cjs'}),requests=[],messages=[],hooks=[];
 let cursor=0,pending=[],props=['A',0,'/a.png',text=>messages.push(text)],result,scheduled=false,alive=true;
 const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
 function schedule(){if(scheduled||!alive)return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(alive)render();});}
 const react={
  useState(initial){const at=cursor++;hooks[at]??={value:initial};return [hooks[at].value,value=>{const next=typeof value==='function'?value(hooks[at].value):value;if(!Object.is(next,hooks[at].value)){hooks[at].value=next;schedule();}}];},
  useRef(value){const at=cursor++;hooks[at]??={current:value};return hooks[at];},
  useEffect(effect,deps){const at=cursor++,old=hooks[at];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){hooks[at]={deps,cleanup:old?.cleanup};pending.push(()=>{old?.cleanup?.();hooks[at].cleanup=effect();});}},
 };
 const m={exports:{}};new Function('require','module','exports',compiled.code)(name=>{if(name==='react')return react;if(name==='@/lib/reader-request')return {request:(url,method='GET',body)=>{const d=defer();requests.push({url,method,body,...d});return d.promise;}};throw Error(name);},m,m.exports);
 function render(){cursor=0;pending=[];result=m.exports.useBookReference(...props);for(const effect of pending)effect();}
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 render();props=['B',1,'/b.png',props[3]];render();requests[0].resolve({reference:{storyId:'A',page:0,token:'old'}});await flush();assert.equal(result.selected,false);assert.equal(result.disabled,true);
 requests[1].resolve({reference:{storyId:'B',page:1,token:'B-token'}});await flush();assert.equal(result.selected,true);
 const saving=result.toggle();assert.equal(requests[2].body.token,'B-token');props=['C',0,'/c.png',props[3]];render();requests[3].resolve({reference:null});await flush();assert.equal(result.busy,true);await result.toggle();assert.equal(requests.length,4);
 requests[2].resolve({reference:null});await saving;await flush();assert.match(requests[4].url,/library\/C\/reference/);assert.equal(messages.length,0);
 requests[4].resolve({reference:{storyId:'C',page:0,token:'C-token'}});await flush();assert.equal(result.selected,true);
 const failing=result.toggle();requests[5].reject(Error('保存失败'));await failing;await flush();assert.equal(messages.at(-1),'保存失败');requests[6].resolve({reference:{storyId:'C',page:0,token:'C-token'}});await flush();assert.equal(result.selected,true);assert.equal(result.busy,false);
 const staleCancel=result.toggle();requests[7].resolve({reference:{storyId:'other',page:0,token:'new-token'}});await staleCancel;await flush();requests[8].resolve({reference:{storyId:'other',page:0,token:'new-token'}});await flush();assert.equal(result.selected,false);assert.equal(messages.at(-1),'本书参考图已更换，已同步最新星标。');
 props=[undefined,0,undefined,props[3]];render();assert.equal(result.selected,false);assert.equal(result.disabled,true);
 alive=false;for(const hook of hooks)hook.cleanup?.();
});
