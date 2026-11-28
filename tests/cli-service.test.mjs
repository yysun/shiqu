// 通过真实 CLI 进程和回环服务验证书库占用、身份、调用上下文及制作边界。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {access,mkdir,readFile,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {callCliService,startCliService} from '../server/cli-service.ts';
import {desktopOwner,ownDesktopDataSync,publishDesktopOwner} from '../server/desktop-owner.ts';
import {startupFixture,startFixtureCli,freeStartupPort} from './fixtures/startup.mjs';
import {productionFixture,selection} from './fixtures/production.mjs';
import {libraryFixture} from './fixtures/story-library.mjs';
import {withLocalBooks} from '../server/local-generation.ts';
import {emptyPublication} from '../lib/story-publication.ts';
import {createApplication} from '../server/app.ts';
import {runDesktopBackupCommand} from '../server/desktop-backups.ts';
import {executeHeadless} from '../server/headless-cli.ts';

const cli=new URL('../server/cli.ts',import.meta.url).href;
const entry=`const {runCli}=await import(${JSON.stringify(cli)});try{await runCli(process.argv[1],process.argv.slice(2))}catch(error){console.error(error.message);process.exitCode=1}`;
function command(f,directory,args,{cwd=f.root,environment={},input}={}){
 const child=spawn(process.execPath,['--input-type=module','-e',entry,f.root,...args,'--data-dir',directory],
  {cwd,env:{...f.env,SHIQU_AI_PROVIDER:'readonly',...environment},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 child.stdin.end(input===undefined?undefined:JSON.stringify(input));
 const result=once(child,'close').then(([code,signal])=>({code,signal,stdout,stderr,body:stdout.startsWith('{')?JSON.parse(stdout):null}));
 f.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await result.catch(()=>{});});
 return {child,result};
}
async function ok(command){
 const completed=await command.result;
 assert.equal(completed.code,0,completed.stderr+completed.stdout);
 if(completed.body)assert.equal(completed.body.ok,true);
 return completed.body?.data;
}
async function until(check,ms=6000){
 const deadline=Date.now()+ms;
 while(Date.now()<deadline){const value=await check();if(value)return value;await delay(15);}
 throw Error('condition timed out');
}
async function fakeService(t){
 const paths=[];
 const server=createServer((req,res)=>{paths.push([req.method,req.url,req.headers.authorization]);res.end('someone else');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return {url:'http://127.0.0.1:'+server.address().port,paths};
}

test('simultaneous cold callers reuse an auto-started lock owner and maintenance takes over afterward', {timeout:18000},async t=>{
 const f=await startupFixture(t),directory=path.join(f.root,'shared library');
 const both=[command(f,directory,['stories','list']),command(f,directory,['stories','list'])];
 const owners=new Set();
 const observe=setInterval(()=>{const owner=desktopOwner(directory);if(owner?.service)owners.add(owner.id);},5);
 try{assert.deepEqual(await Promise.all(both.map(ok)),[[],[]]);}
 finally{clearInterval(observe);}
 const owner=desktopOwner(directory);
 assert.ok(owner?.managed);assert.match(owner.service.url,/^http:\/\/127\.0\.0\.1:\d+$/);
 owners.add(owner.id);assert.equal(owners.size,1);
 const backup=path.join(f.root,'first backup');
 assert.equal((await ok(command(f,directory,['backup',backup]))).verified,true);
 const copy=JSON.parse(await readFile(path.join(backup,'shiqu-backup.json'),'utf8'));
 assert.ok(copy.files.every(file=>!file.path.includes('.desktop')));
 await ok(command(f,directory,['stories','list']));
 await ok(command(f,directory,['--backup',path.join(f.root,'second backup')]));
 await until(()=>desktopOwner(directory)===undefined);
});

test('the live browser app and CLI see the same story title and retain their authorization boundaries', {timeout:20000},async t=>{
 const f=await startupFixture(t),directory=path.join(f.root,'shelf');
 const {session}=await ok(command(f,directory,['stories','create','--input','-'],{input:{bookId:'zhuangzi',theme:'原典故事'}}));
 const port=await freeStartupPort(),run=startFixtureCli(f,['--data-dir',directory,'--port',String(port),'--host','127.0.0.1'],{SHIQU_AI_PROVIDER:'readonly',SHIQU_SKILL_AUTO_INSTALL:'off'});
 await run.ready();
 const owner=desktopOwner(directory);
 assert.notEqual(owner?.managed,true);
 const url='http://127.0.0.1:'+port+'/api/reader/sessions/'+session.id;
 const title='同一本书库的新标题';
 const listed=await ok(command(f,directory,['stories','list']));assert.equal(listed[0].id,session.id);
 await writeFile(path.join(f.root,'online.txt'),'第一章 旧院\n主人来到旧院门前。\n\n第二章 新路\n主人走向了新路。');
 const imported=await ok(command(f,directory,['books','import','online.txt','--title','在线导入','--accept-rights','--encoding','utf-8']));
 assert.match(imported.id,/^my-/);
 await ok(command(f,directory,['stories','rename',session.id,'--input','-'],{input:{title}}));
 assert.equal((await ok(command(f,directory,['stories','get',session.id]))).selection.displayTitle,title);
 assert.equal((await (await fetch(url)).json()).selection.displayTitle,title);
 assert.equal(desktopOwner(directory).id,owner.id);
 const unconfigured=await command(f,directory,['run',session.id]).result;
 assert.equal(unconfigured.body.error.code,'PROVIDER_UNAVAILABLE');
 const denied=await fetch(owner.service.url+'/command',{method:'POST',headers:{Origin:owner.service.url,Authorization:'Bearer '+owner.id},body:'{}'});
 assert.equal(denied.status,404);
 assert.equal((await fetch(owner.service.url+'/command',{method:'POST',body:'{}'})).status,404);
});

test('a stranger at the recorded port cannot receive a command or the owner token', {timeout:16000},async t=>{
 const f=await startupFixture(t),directory=path.join(f.root,'shelf');
 const fake=await fakeService(t),release=ownDesktopDataSync(directory);t.after(release);
 publishDesktopOwner(directory,{protocol:1,url:fake.url});
 const stale=desktopOwner(directory);
 const current=command(f,directory,['stories','list']);
 await until(()=>fake.paths.length);
 current.child.kill('SIGINT');
 const {body}=await current.result;
 assert.equal(body.error.code,'INTERRUPTED');
 assert.ok(fake.paths.every(([method,url,authorization])=>method==='GET'&&url.startsWith('/identity?')&&!authorization));
 release();
 const dead=spawn(process.execPath,['-e',''],{stdio:'ignore'});await once(dead,'exit');
 await writeFile(path.join(directory,'.desktop-owner.json'),JSON.stringify({...stale,pid:dead.pid}),{mode:0o600});
 const seen=fake.paths.length;
 await ok(command(f,directory,['stories','list']));
 assert.notEqual(desktopOwner(directory).id,stale.id);
 assert.equal(fake.paths.length,seen);
 await until(()=>!desktopOwner(directory));
 await writeFile(path.join(directory,'.desktop-owner.json'),JSON.stringify({...stale,pid:process.pid}),{mode:0o600});
 await ok(command(f,directory,['stories','list']));
 assert.notEqual(desktopOwner(directory).id,stale.id);
 assert.ok(fake.paths.slice(seen).every(([method])=>method==='GET'));
});

test('CLI preserves the library-directory symlink refusal before service discovery',async t=>{
 const f=await startupFixture(t),target=path.join(f.root,'real library'),alias=path.join(f.root,'alias');
 await mkdir(target);await symlink(target,alias,'junction');
 const result=await command(f,alias,['stories','list']).result;
 assert.equal(result.code,1);
 await assert.rejects(access(path.join(target,'shiqu.sqlite')),{code:'ENOENT'});
});

test('caller directory, stdin and inherited environment follow each invocation', {timeout:21000},async t=>{
 const f=await startupFixture(t),directory=path.join(f.root,'shelf');
 const first=path.join(f.root,'first'),second=path.join(f.root,'second');
 await Promise.all([mkdir(first),mkdir(second)]);
 const input={bookId:'zhuangzi',theme:'原典故事'};
 await writeFile(path.join(second,'selection.json'),JSON.stringify(input));
 await ok(command(f,directory,['stories','create','--input','-'],{cwd:first,input}));
 const {session}=await ok(command(f,directory,['stories','create','--input','selection.json'],{cwd:second}));
 await writeFile(path.join(second,'original.txt'),'第一章 旧院\n主人来到旧院门前。\n\n第二章 新路\n主人走向了新路。');
 const imported=await ok(command(f,directory,['books','import','original.txt','--title','本地原文','--accept-rights','--encoding','utf-8'],{cwd:second}));
 assert.match(imported.id,/^my-/);
 const previous=desktopOwner(directory);
 assert.ok(previous?.managed);
 const replacement={...f.env,SHIQU_AI_PROVIDER:'readonly',SHIQU_TEST_CALLER_PROFILE:'replacement'};
 await assert.rejects(callCliService(f.root,directory,['run',session.id,'--until','candidates','--timeout','2'],second,replacement),{code:'PROVIDER_UNAVAILABLE'});
 assert.notEqual(desktopOwner(directory).id,previous.id);
 assert.doesNotMatch(await readFile(path.join(directory,'.desktop-owner.json'),'utf8'),/replacement/);
});

test('the CLI service runs through the real scheduler and stops before paid drawing', {timeout:30000},async t=>{
 const f=await productionFixture(t);await f.stop();f.control.hold=false;
 const books=libraryFixture(),generation=withLocalBooks(f.generation,books.books,f.media);
 const release=ownDesktopDataSync(f.dataDirectory,true);
 let idle;const reaped=new Promise(resolve=>{idle=resolve;});
 const service=await startCliService(process.cwd(),f.dataDirectory,{managed:{onIdle:idle},localBooks:books.books,generation});
 t.after(async()=>{await service.close();release();});
 const run=(args,input,signal)=>callCliService(process.cwd(),f.dataDirectory,args,process.cwd(),process.env,input,signal);
 const story=books.stories[0];
 const {session}=await run(['stories','create','--no-intake'],{...selection,length:3,source:story.source,storyTitle:story.title});
 assert.equal(f.control.dagCalls.length,0);
 const result=await run(['run',session.id,'--until','reviewed','--timeout','12']);
 assert.equal(result.reason,'reviewed');
 assert.equal(result.session.lifecycle.review,'approved');
 assert.equal(f.control.calls.length,0);
 assert.equal(f.control.reviews.length,1);
 assert.equal((await run(['run',session.id,'--until','completed','--timeout','12'])).reason,'completed');
 assert.equal(f.control.calls.length,3);

 const second=await run(['stories','create','--no-intake'],{...selection,length:3,source:story.source,storyTitle:story.title});
 let opened,unblock;
 const entered=new Promise(resolve=>{opened=resolve;}),gate=new Promise(resolve=>{unblock=resolve;});
 t.after(unblock);
 f.control.beforeText=async()=>{
  opened();
  await gate;
 };
 const active=new AbortController(),queued=new AbortController();
 const activeResult=assert.rejects(run(['run',second.session.id,'--timeout','12'],undefined,active.signal),{code:'INTERRUPTED'});
 await entered;
 const cancelQueued=assert.rejects(run(['stories','create'],selection,queued.signal),{code:'INTERRUPTED'});
 const keepQueued=run(['stories','list']);
 await delay(120);
 queued.abort();await delay(100);
 active.abort();await delay(100);unblock();
 await Promise.all([activeResult,cancelQueued]);
 assert.equal((await keepQueued).length,2);
 assert.equal(f.control.calls.length,3);
 await reaped;
});

test('one online coordinator handles CLI production, browser authorization and committed saves', {timeout:40000},async t=>{
 const cleanup=[];
 const f=await productionFixture({after:fn=>cleanup.push(fn)});await f.stop();f.control.hold=false;
 const books=libraryFixture(),generation=withLocalBooks(f.generation,books.books,f.media);
 const directory=f.dataDirectory,root=process.cwd(),release=ownDesktopDataSync(directory);
 let app,service,model={provider:'codex',models:{image:'fixture-first'}};
 async function start(){
  app=createApplication({root,dataDirectory:directory,generation,production:{snapshots:{current:()=>model,provider:()=>generation}}});
  app.services.localBooks=books.books;
  service=await startCliService(root,directory,{application:app});
 }
 await start();
 let unblock=()=>{};
 t.after(async()=>{unblock();await service.close();await app.close();release();for(const close of cleanup.reverse())await close();});
 const command=(args,input,signal)=>callCliService(root,directory,args,root,process.env,input,signal);
 const browser=async(id,action,requestId=crypto.randomUUID(),status=200)=>{
  const response=await app.handle(new Request('http://localhost/api/reader/sessions/'+id+'/production-control',{
   method:'POST',body:JSON.stringify({requestId,action})}));
  assert.equal(response.status,status,await response.clone().text());
  return requestId;
 };
 const story=books.stories[0],source={...selection,length:3,source:story.source,storyTitle:story.title};
 const snap=app.services.production.snapshot.bind(app.services.production),requestId=crypto.randomUUID();
 let failedProjection=false;
 app.services.production.snapshot=(uid,id)=>{
  if(id===requestId&&!failedProjection){failedProjection=true;throw Error('controlled projection failure');}
  return snap(uid,id);
 };
 await assert.rejects(command(['stories','create','--no-intake','--request-id',requestId],source),error=>error.details.status===500);
 app.services.production.snapshot=snap;
 assert.equal((await command(['stories','get',requestId])).id,requestId);
 assert.equal((await command(['stories','create','--no-intake','--request-id',requestId],source)).session.id,requestId);
 await app.services.production.tick();
 assert.equal(f.control.dagCalls.length,0);

 let entered;
 const gated=new Promise(resolve=>{entered=resolve;}),dispatch=new Promise(resolve=>{unblock=resolve;});
 f.control.beforeText=async()=>{entered();await dispatch;};
 const reviewedPromise=command(['run',requestId,'--until','reviewed','--timeout','12']);
 await gated;
 assert.equal(service.pause(),undefined);
 const busyTarget=path.join(f.root,'blocked backup');
 await assert.rejects(command(['backup',busyTarget]),{code:'BACKUP_ACTIVE_TASKS'});
 await assert.rejects(runDesktopBackupCommand(root,'test',{operation:'create',library:directory,target:busyTarget}),{code:'BACKUP_ACTIVE_TASKS'});
 await assert.rejects(access(busyTarget),{code:'ENOENT'});
 await assert.rejects(command(['run',requestId,'--until','completed']),{code:'CONFLICT'});
 const secondId=(await command(['stories','create','--no-intake'],source)).session.id;
 const other=command(['run',secondId,'--until','reviewed','--timeout','12']);
 unblock();f.control.beforeText=null;
 assert.deepEqual((await Promise.all([reviewedPromise,other])).map(result=>result.reason),['reviewed','reviewed']);
 assert.equal(f.control.calls.length,0);
 assert.equal((await command(['run',requestId,'--until','reviewed'])).reason,'reviewed');
 await app.services.production.tick();
 assert.equal(f.control.calls.length,0);
 let preflightStarted;
 const originalSnapshot=app.services.production.snapshot.bind(app.services.production);
 const checking=new Promise(resolve=>{preflightStarted=resolve;}),waitForCheck=new Promise(resolve=>{unblock=resolve;});
 app.services.production.snapshot=async(uid,id)=>{if(id===requestId){preflightStarted();await waitForCheck;}return originalSnapshot(uid,id);};
 const invalid=assert.rejects(command(['run',requestId,'--until','candidates']),{code:'BOUNDARY_UNAVAILABLE'});
 await checking;
 await app.services.production.tick();assert.equal(f.control.calls.length,0);
 unblock();await invalid;
 app.services.production.snapshot=originalSnapshot;


 // 上次服务中断留下的过期绘图租约不会阻止查看已通过的审片。
 const sqlite=app.services.database;
 await sqlite.prepare(`UPDATE production_jobs SET state='running',lease_until=0 WHERE id=(
  SELECT id FROM production_jobs WHERE session_id=? AND pool='image' AND state='queued' LIMIT 1)`).bind(requestId).run();
 assert.equal((await command(['run',requestId,'--until','reviewed'])).reason,'reviewed');
 assert.equal(f.control.calls.length,0);
 const quiet=service.pause();assert.equal(typeof quiet,'function');
 assert.equal((await app.handle(new Request('http://localhost/api/reader/sessions'))).status,503);
 await assert.rejects(command(['stories','list']),{code:'SERVICE_BUSY'});
 await service.close();await app.close();
 await start();
 await app.services.production.tick();
 assert.equal(f.control.calls.length,0);
 assert.equal((await command(['run',requestId,'--until','reviewed'])).reason,'reviewed');
 model={provider:'codex',models:{image:'fixture-next'}};
 await browser(requestId,'apply-model');
 await app.services.production.tick();
 assert.equal(f.control.calls.length,0);

 // 新的浏览器授权只释放第一篇，第二篇继续保留审片停点。
 await browser(requestId,'pause');
 const currentSnapshot=app.services.production.snapshot.bind(app.services.production);
 let projections=0;
 app.services.production.snapshot=(uid,id)=>{
  if(id===requestId&&++projections===2)throw Error('controlled browser projection failure');
  return currentSnapshot(uid,id);
 };
 f.control.hold=true;
 const resumed=await browser(requestId,'resume',crypto.randomUUID(),500);
 app.services.production.snapshot=currentSnapshot;
 await until(()=>f.control.calls.some(call=>!call.done));
 await assert.rejects(command(['run',requestId,'--until','reviewed']),{code:'CONFLICT'});
 f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>(await command(['stories','get',requestId])).state==='completed');
 assert.equal(f.control.calls.length,3);
 await assert.rejects(command(['stories','edit',secondId],{token:'0'.repeat(64),changes:{productionPrompt:'无效令牌'}}),{code:'CONFLICT'});
 await app.services.production.tick();
 assert.equal(f.control.calls.length,3);
 const revision=await command(['stories','revisions',secondId]);
 const edited=await command(['stories','edit',secondId],{token:revision.token,changes:{acceptancePrompt:'保留原文关键行动'}});
 const newId=edited.session.id;
 assert.notEqual(newId,secondId);
 assert.equal((await command(['run',newId])).reason,'continue_required');
 await command(['stories','continue',newId]);
 let failed=false;f.control.beforeText=async()=>{if(!failed){failed=true;throw Error('controlled revision failure');}};
 const blocked=await command(['run',newId,'--until','reviewed','--timeout','12']);
 assert.equal(blocked.reason,'blocked');
 const fault=blocked.session.faults.find(fault=>fault.retryAllowed);
 assert.ok(fault);
 const retryId=crypto.randomUUID();
 const count=f.control.dagCalls.length;
 await command(['stories','retry',newId,'--request-id',retryId],{faultId:fault.id});
 await command(['stories','retry',newId,'--request-id',retryId],{faultId:fault.id});
 await app.services.production.tick();
 assert.equal(f.control.dagCalls.length,count);
 f.control.beforeText=null;
 assert.equal((await command(['run',newId,'--until','reviewed','--timeout','12'])).reason,'reviewed');
 await browser(requestId,'resume',resumed);
 assert.equal(f.control.calls.length,3);
 assert.equal((await command(['run',newId,'--until','completed','--timeout','12'])).reason,'completed');
 assert.equal(f.control.calls.length,6);
 const target=path.join(f.root,'online copy');
 const targetRelease=ownDesktopDataSync(target),targetApp=createApplication({root,dataDirectory:target,variables:{SHIQU_AI_PROVIDER:'readonly'}});
 const targetService=await startCliService(root,target,{application:targetApp});
 try{
  const copied=await callCliService(root,target,['stories','copy',newId,'--from-data-dir',directory,'--copy-images'],root,process.env);
  assert.equal(copied.session.ready,3);
  assert.equal(copied.session.story.title,(await command(['stories','get',newId])).story.title);
 }finally{await targetService.close();await targetApp.close();targetRelease();}
 const desktopBackup=await runDesktopBackupCommand(root,'test',{operation:'create',library:directory,target:path.join(f.root,'desktop online backup')});
 const cliBackup=await command(['backup',path.join(f.root,'cli online backup')]);
 assert.equal(cliBackup.verified,true);
 const verified=await executeHeadless(root,['verify-backup',desktopBackup.path]);
 assert.equal(verified.verified,true);
 const restored=await executeHeadless(root,['restore',desktopBackup.path,'--data-dir',path.join(f.root,'restored workspace')]);
 assert.equal(restored.restored,true);
 const sketch=await executeHeadless(root,['preview',newId,'--data-dir',directory,'--output',path.join(f.root,'preview.html')]);
 assert.match(await readFile(sketch.path,'utf8'),/data:image/);
 const portFile=desktopOwner(directory);
 assert.equal(portFile.service.url,service.url);
});

test('the desktop control channel declines an active index and acknowledges an idle stop', {timeout:18000},async t=>{
 const f=await startupFixture(t),directory=path.join(f.root,'desktop shelf'),port=await freeStartupPort();
 const source=new URL('../server/desktop.ts',import.meta.url).href;
 const modules=['local-books','local-story-search','story-card-embeddings'].map(name=>new URL('../server/'+name+'.ts',import.meta.url).href);
 const program=`
  const {runDesktopControl}=await import(${JSON.stringify(source)});
  const [{LocalBooks},{LocalStorySearch},{StoryCardEmbeddingStore}]=await Promise.all(${JSON.stringify(modules)}.map(path=>import(path)));
  LocalBooks.prototype.book=async()=>({id:'zhuangzi',edition:'controlled'});
  LocalStorySearch.prototype.indexableCards=async()=>[];
  StoryCardEmbeddingStore.prototype.build=async()=>{process.send('embedding-active');await new Promise(resolve=>process.once('message',resolve));return {completed:1,total:1};};
  await runDesktopControl(process.argv[1]);
 `;
 const child=spawn(process.execPath,['--input-type=module','-e',program,f.root],{cwd:f.root,env:f.env,stdio:['pipe','pipe','pipe','ipc']});
 const exit=once(child,'exit');
 let output='',errors='';
 child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
 f.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 const frames=()=>output.trimEnd().split('\n').map(line=>{try{return JSON.parse(line);}catch{return {};}});
 send({action:'start',settings:{nodePath:process.execPath,dataDirectory:directory,port,internetEnabled:false,cloudflaredPath:'',provider:'readonly',textModel:'test-text',imageModel:'test-image',codexPath:'',codexModel:'',codexHome:''}});
 const live=await until(()=>frames().find(frame=>frame.running===true));
 assert.equal(errors,'');
 const active=once(child,'message');
 const response=await fetch(live.url+'/api/reader/books/zhuangzi/embedding-index',{method:'POST',headers:{Origin:live.url}});
 assert.equal(response.status,200);
 assert.equal((await active)[0],'embedding-active');
 send({action:'stop',requestId:41});
 assert.deepEqual(await until(()=>frames().find(frame=>frame.stopReply===41)),{stopReply:41,accepted:false});
 const refused=await command(f,directory,['--backup',path.join(f.root,'busy backup')]).result;
 assert.equal(refused.code,1);
 assert.match(refused.stderr,/正在进行的任务/);
 assert.equal((await fetch(live.url+'/api/reader/sessions')).status,200);
 child.send('finish');
 assert.match(await response.text(),/"type":"complete"/);
 send({action:'stop',requestId:42});
 assert.deepEqual(await until(()=>frames().find(frame=>frame.stopReply===42)),{stopReply:42,accepted:true});
 assert.equal((await exit)[0],0);
 assert.equal(desktopOwner(directory),undefined);
});

test('Skill completes selection, confirmation and export without stopping the online service', {timeout:25000},async t=>{
 const cleanup=[];
 const f=await productionFixture({after:fn=>cleanup.push(fn)});await f.stop();f.control.autoLength=3;f.control.hold=false;
 const books=libraryFixture();
 f.control.beforeText=async(kind,payload)=>kind==='recommend'?{
  storySummary:books.stories.find(story=>payload.verifiedOriginal.text.includes(books.book.sections[0].units.find(unit=>unit.id===story.source.firstUnit).text))?.summary||books.stories[0].summary,
  storyMatchReason:'原文的行动和结果支持故事。'
 }:undefined;
 f.generation.suggestions=books.provider.suggestions;f.generation.matchStories=books.provider.matchStories;
 const directory=f.dataDirectory,root=process.cwd(),release=ownDesktopDataSync(directory);
 const generation=withLocalBooks(f.generation,books.books,f.media);
 const app=createApplication({root,dataDirectory:directory,generation});
 app.services.localBooks=books.books;
 const service=await startCliService(root,directory,{application:app});
 t.after(async()=>{await service.close();await app.close();release();for(const close of cleanup.reverse())await close();});
 const command=(args,input)=>callCliService(root,directory,args,root,process.env,input);
 const {session}=await command(['stories','create'],{bookId:'zhuangzi',theme:'原典故事'});
 await command(['stories','search',session.id],{generation:session.intake.generation});
 await app.services.production.tick();
 assert.equal(books.calls.catalog.length,0);
 const candidates=await command(['run',session.id,'--until','candidates','--timeout','10']);
 assert.equal(candidates.reason,'candidates');
 await command(['stories','choose',session.id],{generation:candidates.session.intake.generation,batch:0,index:0});
 const prepared=await command(['run',session.id,'--until','prepared','--timeout','10']);
 assert.equal(prepared.reason,'prepared');
 const {intake}=prepared.session,count=f.control.dagCalls.length;
 await command(['stories','confirm',session.id],{generation:intake.generation,draftToken:intake.draftToken,settings:intake.draft});
 await app.services.production.tick();
 assert.equal(f.control.dagCalls.length,count);
 assert.equal((await command(['run',session.id,'--until','reviewed','--timeout','10'])).reason,'reviewed');
 assert.equal(f.control.calls.length,0);
 assert.equal((await command(['run',session.id,'--until','completed','--timeout','10'])).reason,'completed');
 await command(['api','POST','reader/publication-defaults'],{publication:{...emptyPublication,author:'测试作者'},expected:null});
 const output=path.join(f.root,'work.zip');
 const result=await executeHeadless(root,['export',session.id,'--data-dir',directory,'--format','zip','--allow-unsigned','--output',output]);
 assert.ok(result.pages>=3);
 assert.equal(desktopOwner(directory).service.url,service.url);
});

test('interrupting a CLI with a stuck startup releases its pending child channel', {timeout:10000},async t=>{
 if(process.platform==='win32')return t.skip('POSIX terminal interruption');
 const f=await startupFixture(t),directory=path.join(f.root,'stuck shelf'),flag=path.join(f.root,'worker-ready');
 const preload=path.join(f.root,'wait-for-worker.mjs');
 await writeFile(preload,`import {writeFileSync} from 'node:fs';
  if(process.argv[1]?.endsWith('/cli-service.ts')){
   writeFileSync(${JSON.stringify(flag)},String(process.pid));
   await new Promise(()=>setInterval(()=>{},1000));
  }`);
 const request=command(f,directory,['stories','list'],{environment:{NODE_OPTIONS:'--import='+pathToFileURL(preload).href}});
 const pid=Number(await until(()=>readFile(flag,'utf8').catch(()=>null)));
 f.defer(()=>{try{process.kill(pid,'SIGKILL');}catch{/* 启动进程已退出。 */}});
 request.child.kill('SIGINT');
 const result=await request.result;
 assert.equal(result.code,130);
 assert.equal(result.body.error.code,'INTERRUPTED');
 assert.equal(desktopOwner(directory),undefined);
});
