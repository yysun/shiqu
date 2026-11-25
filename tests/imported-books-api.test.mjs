import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {strToU8} from 'fflate';
import {createApplication} from '../server/app.ts';
import {discoveryHash} from '../server/story-discovery-cache.ts';

test('API rejects cross-site writes and oversize uploads, then streams persisted card progress',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu-import-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));let calls=0;
 const generation={status:async()=>({configured:true,provider:'codex',models:{text:'mock',image:'mock'}}),safeError:error=>error instanceof Error?error.message:'mock failure',suggestions:async(_selection,_excluded,input,reading)=>{
  calls++;assert.equal(input.purpose,'cards');const candidate=[...input.text.matchAll(/\[([^\]]+)\]\n([^\n]+)/g)].find(([,unitId,text])=>text.length>30&&/[。！？]/.test(text)),unitId=candidate?.[1];assert.ok(unitId);const sectionId=unitId.replace(/-\d{4}$/,'');reading?.onCall?.({durationMs:7,inputTokens:15,outputTokens:8});return {stories:[{title:`故事${sectionId}`,description:'人物采取行动，经历变化并得到清楚结果。',source:{sectionId,firstUnit:unitId,lastUnit:unitId,edition:input.edition}}],note:''};
 }};
 const app=createApplication({root:process.cwd(),dataDirectory:directory,variables:{SHIQU_AI_PROVIDER:'readonly'},generation,commandOnly:true,production:{autoStart:false}});t.after(async()=>app.close());
 const request=(method,route,input,headers={})=>app.handle(new Request(`http://shiqu.local/api/reader/${route}`,{method,headers:{'Content-Type':'application/json',...headers},...(input===undefined?{}:{body:JSON.stringify(input)})}));
 const metadata={title:'API 测试书',acceptRights:true,license:'本地改编'};
 const crossSite=await request('POST','books/imports',metadata,{Origin:'https://attacker.example'});assert.equal(crossSite.status,403);
 const createdResponse=await request('POST','books/imports',metadata),created=await createdResponse.json();assert.equal(createdResponse.status,201);
 const privateImport=await request('POST','books/imports',{...metadata,title:'私网拒绝测试',urls:['http://127.0.0.1/novel.txt?secret=value'],encoding:'big5'}),privateError=await privateImport.json();assert.equal(privateImport.status,400);assert.match(privateError.error,/127\.0\.0\.1\/novel\.txt/);assert.doesNotMatch(privateError.error,/secret/);assert.equal((await (await request('GET','books/imported')).json()).books.length,0);
 const encodedDraftResponse=await request('POST','books/imports',{...metadata,title:'Big5 编码测试',encoding:'big5'}),encodedDraft=await encodedDraftResponse.json();assert.equal(encodedDraftResponse.status,201,JSON.stringify(encodedDraft));
 const encodedUpload=await app.handle(new Request(`http://shiqu.local/api/reader/books/imports/${encodedDraft.draft.id}/files`,{method:'POST',headers:{'Content-Type':'text/plain','X-File-Name':'big5.txt','X-Text-Encoding':'big5'},body:new Uint8Array([0xa4,0xa4,0xa4,0xe5])}));assert.equal(encodedUpload.status,200);assert.equal((await encodedUpload.json()).manifest.sources[0].encoding,'big5');
 await request('DELETE',`books/imports/${encodedDraft.draft.id}`);
 const tooLarge=await app.handle(new Request(`http://shiqu.local/api/reader/books/imports/${created.draft.id}/files`,{method:'POST',headers:{'Content-Type':'text/plain','X-File-Name':'large.txt'},body:new Uint8Array(12*1024*1024+1)}));assert.equal(tooLarge.status,413);
 const original='第一章 梦蝶\n庄周梦见蝴蝶，在天地间自由飞翔。醒来后，他认真思考梦境与真实的区别。\n第二章 追问\n朋友继续追问，庄周没有急于回答，而是回到自己的生活中寻找答案。';
 const uploaded=await app.handle(new Request(`http://shiqu.local/api/reader/books/imports/${created.draft.id}/files`,{method:'POST',headers:{'Content-Type':'text/plain','X-File-Name':'book.txt'},body:strToU8(original)}));assert.equal(uploaded.status,200);
 const confirmed=await request('POST',`books/imported/${created.draft.id}/confirm`,{});assert.equal(confirmed.status,200);const ready=await confirmed.json();
 const estimate=await request('GET',`books/imported/${ready.id}/cards/estimate`);assert.equal(estimate.status,200);assert.ok((await estimate.json()).calls>0);
 const response=await request('POST',`books/imported/${ready.id}/cards`,{retryFailed:false});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/x-ndjson/);
 const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));assert.ok(events.some(event=>event.type==='progress'));assert.ok(events.some(event=>event.type==='call'));assert.equal(events.at(-1).type,'complete');
 const cards=await request('GET',`books/imported/${ready.id}/cards`),saved=await cards.json();assert.equal(saved.progress.status,'complete');assert.ok(saved.cards.value.cards.length>0);assert.ok(calls>0);
});

test('delete and replace use the durable cache index and stop when cleanup is unsafe',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu-import-cache-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const generation={status:async()=>({configured:true,provider:'codex',models:{text:'mock',image:'mock'}}),safeError:error=>error instanceof Error?error.message:'mock failure',suggestions:async()=>({stories:[],note:''})};
 const app=createApplication({root:process.cwd(),dataDirectory:directory,variables:{SHIQU_AI_PROVIDER:'readonly'},generation,commandOnly:true,production:{autoStart:false}});t.after(async()=>app.close());
 const request=(method,route,input)=>app.handle(new Request(`http://shiqu.local/api/reader/${route}`,{method,headers:{'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})}));
 const imported=app.services.localBooks.imported,metadata={title:'清理测试书',acceptRights:true,license:'本地改编'},source='第一章 开始\n人物遇到问题并采取行动，随后找到解决办法，事情终于有了清楚的结果。\n第二章 结束\n人物继续行动并完成目标，经过变化之后回到平静生活。';
 const readyBook=async title=>{const draft=await imported.createDraft({...metadata,title});await imported.appendSource(draft.id,{bytes:strToU8(source),name:'book.txt'});return imported.confirm(draft.id);};
 const cacheFor=async id=>{const key=discoveryHash(['test-cache',id]);await imported.registerCardCacheKey(id,key);const storageKey=`reader-cache/${discoveryHash(key)}.json`;await app.services.media.put(storageKey,new TextEncoder().encode(JSON.stringify({version:1,key,value:{}})),{contentType:'application/json'});return {key,storageKey};};

 const progressBook=await readyBook('进度损坏'),progressCache=await cacheFor(progressBook.id),progressFile=path.join(directory,'books',progressBook.id,'card-progress.json');await writeFile(progressFile,'{');
 const progressDelete=await request('DELETE',`books/imported/${progressBook.id}`);assert.equal(progressDelete.status,200);assert.equal(await app.services.media.get(progressCache.storageKey),null);

 const deleteBook=await readyBook('删除清理失败'),deleteCache=await cacheFor(deleteBook.id),deleteOriginal=app.services.media.delete.bind(app.services.media);app.services.media.delete=async()=>{throw new Error('controlled cache delete failure');};
 const failedDelete=await request('DELETE',`books/imported/${deleteBook.id}`);assert.equal(failedDelete.status,503);assert.equal((await imported.manifestFor(deleteBook.id)).status,'ready');assert.deepEqual(await imported.cardCacheKeysForCleanup(deleteBook.id),[deleteCache.key]);app.services.media.delete=deleteOriginal;

 const replaceBook=await readyBook('替换清理失败'),replaceCache=await cacheFor(replaceBook.id),replacement=await imported.createDraft({...metadata,title:'新版本'});await imported.appendSource(replacement.id,{bytes:strToU8(source+'\n补充一段内容。'),name:'book.txt'});
 const before=await imported.manifestFor(replaceBook.id),replaceOriginal=app.services.media.delete.bind(app.services.media);app.services.media.delete=async()=>{throw new Error('controlled cache delete failure');};
 const failedReplace=await request('POST',`books/imported/${replaceBook.id}/replace`,{draftId:replacement.id});assert.equal(failedReplace.status,503);assert.equal((await imported.manifestFor(replaceBook.id)).edition,before.edition);assert.deepEqual(await imported.cardCacheKeysForCleanup(replaceBook.id),[replaceCache.key]);await stat(path.join(directory,`.book-import-${replacement.id}`));app.services.media.delete=replaceOriginal;

 const corrupt=await readyBook('索引损坏'),registry=path.join(directory,'books',corrupt.id,'card-cache-keys.json');await writeFile(registry,'{');
 const failedRegistryDelete=await request('DELETE',`books/imported/${corrupt.id}`);assert.equal(failedRegistryDelete.status,503);assert.equal((await imported.manifestFor(corrupt.id)).status,'ready');
 const corruptReplace=await readyBook('替换索引损坏'),corruptReplacement=await imported.createDraft({...metadata,title:'不应替换'});await imported.appendSource(corruptReplacement.id,{bytes:strToU8(source+'\n新段落。'),name:'book.txt'});const corruptBefore=await imported.manifestFor(corruptReplace.id);
 await writeFile(path.join(directory,'books',corruptReplace.id,'card-cache-keys.json'),'{}');const failedCorruptReplace=await request('POST',`books/imported/${corruptReplace.id}/replace`,{draftId:corruptReplacement.id});assert.equal(failedCorruptReplace.status,503);assert.equal((await imported.manifestFor(corruptReplace.id)).edition,corruptBefore.edition);await stat(path.join(directory,`.book-import-${corruptReplacement.id}`));
});
