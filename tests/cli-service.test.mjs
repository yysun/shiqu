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
function desktopBridge(f,directory,port){
 const desktop=new URL('../server/desktop.ts',import.meta.url).href;
 const program=`const {runDesktopControl}=await import(${JSON.stringify(desktop)});await runDesktopControl(process.argv[1]);`;
 const child=spawn(process.execPath,['--input-type=module','-e',program,f.root],{cwd:f.root,env:f.env,stdio:['pipe','pipe','pipe']});
 const exit=once(child,'exit');
 let output='',errors='';
 child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
 f.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 send({action:'start',settings:{nodePath:process.execPath,dataDirectory:directory,port,internetEnabled:false,cloudflaredPath:'',provider:'readonly',textModel:'test-text',imageModel:'test-image',codexPath:'',codexModel:'',codexHome:''}});
 const frames=()=>output.trimEnd().split('\n').map(line=>{try{return JSON.parse(line);}catch{return {};}});
 const wait=async predicate=>{try{return await until(()=>frames().find(predicate));}catch(error){throw Error(output+errors,{cause:error});}};
 return {child,exit,send,wait};
}

test('desktop attaches to the same browser CLI service and detaches or stops it through stdin', {timeout:40000},async t=>{
 const f=await startupFixture(t),directory=path.join(f.root,'shared-browser'),port=await freeStartupPort();
 const browser=startFixtureCli(f,['--port',String(port),'--host','127.0.0.1','--data-dir',directory],{SHIQU_AI_PROVIDER:'readonly'});
 const url='http://127.0.0.1:'+port;
 await until(()=>browser.output().includes('拾趣: '+url));
 const owner=desktopOwner(directory);
 const mismatched=await startupFixture(t);
 await writeFile(path.join(mismatched.root,'package.json'),JSON.stringify({version:'wrong-version'}));
 const rejected=desktopBridge(mismatched,directory,await freeStartupPort());
 assert.match((await rejected.wait(frame=>frame.error)).error,/版本不同/);
 assert.equal(desktopOwner(directory).id,owner.id);
 const bridge=desktopBridge(f,directory,await freeStartupPort());
 const first=await bridge.wait(frame=>frame.running||frame.error);
 assert.equal(first.error,undefined);
 assert.equal(first.pid,browser.child.pid);assert.equal(first.url,url);assert.equal(first.attached,true);
 assert.equal(desktopOwner(directory).id,owner.id);
 // 已接入的控制通道在初始启动期限后仍可管理原服务。
 await delay(10200);
 assert.equal(bridge.child.exitCode,null);
 bridge.child.stdin.end();
 assert.equal((await bridge.exit)[0],0);
 assert.equal((await fetch(url+'/api/reader/sessions')).status,200);
 assert.deepEqual(await ok(command(f,directory,['stories','list'])),[]);
 const {session}=await ok(command(f,directory,['stories','create','--no-intake','--input','-'],{input:selection}));
 const shelf=await (await fetch(url+'/api/reader/sessions')).json();
 assert.equal(shelf[0].id,session.id);
 const next=desktopBridge(f,directory,await freeStartupPort());
 assert.equal((await next.wait(frame=>frame.running)).pid,owner.pid);
 next.send({action:'stop',requestId:23});
 assert.deepEqual(await next.wait(frame=>frame.stopReply===23),{stopReply:23,accepted:true,draining:false});
 next.child.stdin.end();
 assert.equal((await next.exit)[0],0);
 assert.equal(desktopOwner(directory),undefined);
 const restarted=desktopBridge(f,directory,await freeStartupPort());
 const live=await restarted.wait(frame=>frame.running);
 assert.notEqual(live.pid,owner.pid);
 assert.equal((await fetch(live.url+'/api/reader/sessions')).status,200);
 restarted.send({action:'shutdown'});
 assert.equal((await restarted.exit)[0],0);
});

test('desktop attachment opens an existing IPv6 loopback reader', {timeout:16000},async t=>{
 const socket=createServer();
 try{socket.listen(0,'::1');await once(socket,'listening');}
 catch(error){if(['EADDRNOTAVAIL','EAFNOSUPPORT'].includes(error.code))return t.skip('IPv6 loopback unavailable');throw error;}
 const port=socket.address().port;
 await new Promise(resolve=>socket.close(resolve));
 const f=await startupFixture(t),directory=path.join(f.root,'ipv6');
 const browser=startFixtureCli(f,['--port',String(port),'--host','::1','--data-dir',directory],{SHIQU_AI_PROVIDER:'readonly'});
 await browser.ready();
 const bridge=desktopBridge(f,directory,await freeStartupPort());
 const status=await bridge.wait(frame=>frame.running||frame.error);
 assert.equal(status.error,undefined);
 assert.equal(status.url,'http://[::1]:'+port);
 assert.equal((await fetch(status.url+'/api/reader/sessions')).status,200);
 bridge.send({action:'shutdown'});
 assert.equal((await bridge.exit)[0],0);
 assert.equal((await browser.exit)[0],0);
});

test('attached desktop drains an active model request and distinguishes force stop from failure', {timeout:35000},async t=>{
 for(const crash of [false,true]){
 const f=await startupFixture(t),directory=path.join(f.root,'active-browser'),port=await freeStartupPort();
 const source=name=>JSON.stringify(new URL('../'+name,import.meta.url).href);
 const program=`
  const {LocalBooks}=await import(${source('server/local-books.ts')});
  const {libraryFixture}=await import(${source('tests/fixtures/story-library.mjs')});
  const {startServer}=await import(${source('server/start.ts')});
  LocalBooks.prototype.book=async()=>libraryFixture().book;
  globalThis.fetch=async (url,init)=>new Promise((resolve,reject)=>{
   process.send('model-active');
   init.signal.addEventListener('abort',()=>{process.send('model-cancelled');reject(init.signal.reason);},{once:true});
  });
  const [root,directory,port,crash]=process.argv.slice(1);
  const server=await startServer({root,localAccess:true,variables:{PORT:port,SHIQU_BIND_IP:'127.0.0.1',SHIQU_DATA_DIR:directory,SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'controlled-test'}});
  if(crash==='true')process.once('message',()=>server.emit('error',Error('controlled failure')));
 `;
 const browser=spawn(process.execPath,['--input-type=module','-e',program,f.root,directory,String(port),String(crash)],{cwd:f.root,env:f.env,stdio:['ignore','ignore','pipe','ipc']});
 const browserExit=once(browser,'exit'),events=[];
 browser.on('message',message=>events.push(message));
 f.defer(async()=>{if(browser.exitCode===null&&browser.signalCode===null)browser.kill('SIGKILL');await browserExit;});
 await until(()=>desktopOwner(directory)?.service);
 const bridge=desktopBridge(f,directory,await freeStartupPort());
 assert.equal((await bridge.wait(frame=>frame.running)).pid,browser.pid);
 const story=libraryFixture().stories[0];
 const {session}=await ok(command(f,directory,['stories','create','--no-intake','--input','-'],{input:{...selection,length:3,source:story.source,storyTitle:story.title}}));
 const run=command(f,directory,['run',session.id,'--until','completed','--timeout','20']).result;
 await until(()=>events.includes('model-active'));
 bridge.send({action:'stop',requestId:41});
 assert.deepEqual(await bridge.wait(frame=>frame.stopReply===41),{stopReply:41,accepted:true,draining:true});
 assert.equal((await run).body.error.details.resumesAfterRestart,true);
 assert.equal(browser.exitCode,null);
 assert.equal(events.includes('model-cancelled'),false);
 if(crash)browser.send('fail');else bridge.send({action:'shutdown'});
 assert.equal((await bridge.exit)[0],crash?1:0);
 assert.equal((await browserExit)[0],crash?1:0);
 if(crash)assert.match((await bridge.wait(frame=>frame.error)).error,/断开/);
 else assert.equal(events.includes('model-cancelled'),true);
 assert.equal(desktopOwner(directory),undefined);
 }
});

async function gatedWorker(f,directory){
 const module=name=>new URL('../'+name,import.meta.url).href;
 const root=f.root,environment={...f.env,SHIQU_AI_PROVIDER:'readonly'};
 const gate=path.join(root,'release-worker'),entered=path.join(root,'worker-active');
 const program=`
  import {access,writeFile} from 'node:fs/promises';
  import {setTimeout as delay} from 'node:timers/promises';
  const {LocalBooks}=await import(${JSON.stringify(module('server/local-books.ts'))});
  const {libraryFixture}=await import(${JSON.stringify(module('tests/fixtures/story-library.mjs'))});
  const {runCliServiceProcess}=await import(${JSON.stringify(module('server/cli-service.ts'))});
  const [root,directory,entered,gate]=process.argv.slice(1),{book}=libraryFixture();
  LocalBooks.prototype.book=async()=>{await writeFile(entered,'');while(!await access(gate).then(()=>true,()=>false))await delay(20);return book;};
  await runCliServiceProcess(root,directory);
 `;
 const worker=spawn(process.execPath,['--input-type=module','-e',program,root,directory,entered,gate],{cwd:root,env:environment,stdio:['ignore','ignore','pipe']});
 const workerExit=once(worker,'exit');
 f.defer(async()=>{if(worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');await workerExit;});
 const owner=await until(()=>{const record=desktopOwner(directory);return record?.service&&record;});
 const call=args=>callCliService(root,directory,args,root,environment);
 const accepted=call(['books','contents','zhuangzi']);void accepted.catch(()=>{});
 await until(()=>access(entered).then(()=>true,()=>false));
 async function waitForFence(){
  let busy=false;
  const competing=setInterval(()=>{void call(['stories','list']).catch(error=>{busy||=error.code==='SERVICE_BUSY';});},100);
  try{await until(()=>busy);}finally{clearInterval(competing);}
 }
 return {owner,worker,workerExit,accepted,call,waitForFence,release:()=>writeFile(gate,'')};
}

test('desktop enables the reader in the same CLI worker after accepted work finishes', {timeout:25000},async t=>{
 const f=await startupFixture(t),directory=path.join(f.root,'shared-worker'),port=await freeStartupPort();
 const {owner,worker,workerExit,accepted,waitForFence,release}=await gatedWorker(f,directory);
 const bridge=desktopBridge(f,directory,port);
 try{await waitForFence();}finally{await release();}
 assert.ok(await accepted);
 const live=await bridge.wait(frame=>frame.running||frame.error);
 assert.equal(live.error,undefined);
 assert.equal(live.pid,worker.pid);assert.equal(live.attached,true);
 assert.equal(desktopOwner(directory).id,owner.id);
 assert.equal(desktopOwner(directory).service.url,owner.service.url);
 assert.equal(desktopOwner(directory).service.affinity,undefined);
 assert.equal(desktopOwner(directory).managed,undefined);
 await delay(820);
 assert.equal((await fetch(live.url+'/api/reader/sessions')).status,200);
 assert.deepEqual(await ok(command(f,directory,['stories','list'],{environment:{TEST_OTHER_CALLER:'different'}})),[]);
 bridge.send({action:'shutdown'});
 assert.equal((await bridge.exit)[0],0);
 assert.equal((await workerExit)[0],0);
 assert.equal(desktopOwner(directory),undefined);
});

test('cancelled or failed desktop attachment restores the original worker', {timeout:25000},async t=>{
 for(const abort of [true,false]){
  const f=await startupFixture(t),directory=path.join(f.root,'shared-worker');
  const occupied=createServer();
  occupied.listen(0,'127.0.0.1');await once(occupied,'listening');
  try{
   const {owner,workerExit,accepted,waitForFence,release,call}=await gatedWorker(f,directory);
   const bridge=desktopBridge(f,directory,occupied.address().port);
   try{
    await waitForFence();
    if(abort){bridge.child.stdin.end();assert.equal((await bridge.exit)[0],0);}
   }finally{await release();}
   assert.ok(await accepted);
   if(!abort)assert.match((await bridge.wait(frame=>frame.error)).error,/端口已被占用/);
   assert.deepEqual(await until(()=>call(['stories','list']).catch(error=>error.code==='SERVICE_BUSY'?false:Promise.reject(error))),[]);
   assert.equal(desktopOwner(directory).id,owner.id);
   assert.deepEqual(desktopOwner(directory).service,owner.service);
   assert.equal((await workerExit)[0],0);
   assert.equal(desktopOwner(directory),undefined);
  }finally{await new Promise(resolve=>occupied.close(resolve));}
 }
});
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
 const bridge=desktopBridge(f,directory,await freeStartupPort());
 assert.match((await bridge.wait(frame=>frame.error)).error,/另一个 CLI 或桌面服务/);
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

test('the desktop control channel waits for active work, then stops itself or stops at once', {timeout:30000},async t=>{
 const f=await startupFixture(t),directory=path.join(f.root,'desktop shelf'),port=await freeStartupPort();
 const source=new URL('../server/desktop.ts',import.meta.url).href;
 const modules=['local-books','local-story-search','story-card-embeddings'].map(name=>new URL('../server/'+name+'.ts',import.meta.url).href);
 const program=`
  const {runDesktopControl}=await import(${JSON.stringify(source)});
  const [{LocalBooks},{LocalStorySearch},{StoryCardEmbeddingStore}]=await Promise.all(${JSON.stringify(modules)}.map(path=>import(path)));
  LocalBooks.prototype.book=async()=>({id:'zhuangzi',edition:'controlled'});
  LocalStorySearch.prototype.indexableCards=async()=>[];
  StoryCardEmbeddingStore.prototype.build=async()=>{process.send('embedding-active');await new Promise(resolve=>process.once('message',message=>{if(message==='crash')setTimeout(()=>{throw Error('controlled crash');});else resolve();}));return {completed:1,total:1};};
  await runDesktopControl(process.argv[1]);
 `;
 const child=spawn(process.execPath,['--input-type=module','-e',program,f.root],{cwd:f.root,env:f.env,stdio:['pipe','pipe','pipe','ipc']});
 const exit=once(child,'exit');
 let output='',errors='';
 child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
 f.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 const frames=()=>output.trimEnd().split('\n').map(line=>{try{return JSON.parse(line);}catch{return {};}});
 const start=async()=>{
  send({action:'start',settings:{nodePath:process.execPath,dataDirectory:directory,port,internetEnabled:false,cloudflaredPath:'',provider:'readonly',textModel:'test-text',imageModel:'test-image',codexPath:'',codexModel:'',codexHome:''}});
  return until(()=>frames().find(frame=>frame.running===true));
 };
 const live=await start();
 assert.equal(errors,'');
 const active=once(child,'message');
 const response=await fetch(live.url+'/api/reader/books/zhuangzi/embedding-index',{method:'POST',headers:{Origin:live.url}});
 assert.equal(response.status,200);
 const body=response.text().catch(()=>'');
 assert.equal((await active)[0],'embedding-active');
 // 有进行中的工作：回复等候，状态为 stopping，不再接收新请求，书库仍由该服务持有。
 send({action:'stop',requestId:41});
 assert.deepEqual(await until(()=>frames().find(frame=>frame.stopReply===41)),{stopReply:41,accepted:true,draining:true});
 await until(()=>frames().find(frame=>frame.state==='stopping'),4000);
 const refused=await command(f,directory,['--backup',path.join(f.root,'busy backup')]).result;
 assert.equal(refused.code,1);
 assert.match(refused.stderr,/维护/);
 await assert.rejects(access(path.join(f.root,'busy backup')),{code:'ENOENT'});
 assert.equal((await fetch(live.url+'/api/reader/sessions')).status,503);
 assert.equal(child.exitCode,null);
 // 工作结束后自行退出并释放书库。
 child.send('finish');
 assert.equal((await exit)[0],0);
 await body;
 assert.equal(desktopOwner(directory),undefined);

 // 等候中发送 shutdown：立即停止，不等进行中的工作。
 const second=spawn(process.execPath,['--input-type=module','-e',program,f.root],{cwd:f.root,env:f.env,stdio:['pipe','pipe','pipe','ipc']});
 const secondExit=once(second,'exit');
 let secondOutput='';
 second.stdout.on('data',chunk=>{secondOutput+=chunk;});
 f.defer(async()=>{if(second.exitCode===null&&second.signalCode===null)second.kill('SIGKILL');await secondExit;});
 const secondFrames=()=>secondOutput.trimEnd().split('\n').map(line=>{try{return JSON.parse(line);}catch{return {};}});
 second.stdin.write(JSON.stringify({action:'start',settings:{nodePath:process.execPath,dataDirectory:directory,port,internetEnabled:false,cloudflaredPath:'',provider:'readonly',textModel:'test-text',imageModel:'test-image',codexPath:'',codexModel:'',codexHome:''}})+'\n');
 const relaunched=await until(()=>secondFrames().find(frame=>frame.running===true));
 const busy=once(second,'message');
 const pending=await fetch(relaunched.url+'/api/reader/books/zhuangzi/embedding-index',{method:'POST',headers:{Origin:relaunched.url}});
 void pending.text().catch(()=>'');
 await busy;
 second.stdin.write(JSON.stringify({action:'stop',requestId:7})+'\n');
 assert.deepEqual(await until(()=>secondFrames().find(frame=>frame.stopReply===7)),{stopReply:7,accepted:true,draining:true});
 second.stdin.write(JSON.stringify({action:'shutdown'})+'\n');
 assert.equal((await secondExit)[0],0);
 assert.equal(desktopOwner(directory),undefined);

 // 等候中服务异常退出：以非零码退出，桌面据此显示失败而不是正常停止。
 const third=spawn(process.execPath,['--input-type=module','-e',program,f.root],{cwd:f.root,env:f.env,stdio:['pipe','pipe','pipe','ipc']});
 const thirdExit=once(third,'exit');
 let thirdOutput='';
 third.stdout.on('data',chunk=>{thirdOutput+=chunk;});
 f.defer(async()=>{if(third.exitCode===null&&third.signalCode===null)third.kill('SIGKILL');await thirdExit;});
 const thirdFrames=()=>thirdOutput.trimEnd().split('\n').map(line=>{try{return JSON.parse(line);}catch{return {};}});
 third.stdin.write(JSON.stringify({action:'start',settings:{nodePath:process.execPath,dataDirectory:directory,port,internetEnabled:false,cloudflaredPath:'',provider:'readonly',textModel:'test-text',imageModel:'test-image',codexPath:'',codexModel:'',codexHome:''}})+'\n');
 const crashing=await until(()=>thirdFrames().find(frame=>frame.running===true));
 const crashBusy=once(third,'message');
 const crashPending=await fetch(crashing.url+'/api/reader/books/zhuangzi/embedding-index',{method:'POST',headers:{Origin:crashing.url}});
 void crashPending.text().catch(()=>'');
 await crashBusy;
 third.stdin.write(JSON.stringify({action:'stop',requestId:9})+'\n');
 await until(()=>thirdFrames().find(frame=>frame.stopReply===9&&frame.draining===true));
 third.send('crash');
 assert.notEqual((await thirdExit)[0],0);
});

test('the browser service waits on Ctrl-C, ignores npm forwarding the same signal, and stops at a later second Ctrl-C', {timeout:40000},async t=>{
 if(process.platform==='win32')return t.skip('POSIX signals');
 const cliSource=new URL('../server/cli.ts',import.meta.url).href;
 const modules=['local-books','local-story-search','story-card-embeddings'].map(name=>new URL('../server/'+name+'.ts',import.meta.url).href);
 const program=`const [{LocalBooks},{LocalStorySearch},{StoryCardEmbeddingStore}]=await Promise.all(${JSON.stringify(modules)}.map(path=>import(path)));
  LocalBooks.prototype.book=async()=>({id:'zhuangzi',edition:'controlled'});
  LocalStorySearch.prototype.indexableCards=async()=>[];
  StoryCardEmbeddingStore.prototype.build=async()=>{console.error('index-active');await new Promise(resolve=>setTimeout(resolve,Number(process.env.HOLD_MS)));return {completed:1,total:1};};
  const {runCli}=await import(${JSON.stringify(cliSource)});await runCli(process.argv[1],process.argv.slice(2));`;
 const f=await startupFixture(t);
 async function launch(hold){
  const port=await freeStartupPort(),directory=path.join(f.root,'browser library '+port);
  const child=spawn(process.execPath,['--input-type=module','-e',program,f.root,'--port',String(port),'--data-dir',directory],
   {cwd:f.root,env:{...f.env,SHIQU_AI_PROVIDER:'readonly',HOLD_MS:String(hold)},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
  const exit=once(child,'exit');
  f.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;});
  const url=(await until(()=>output.match(/拾趣: (http:\/\/[^\s/]+)/),15000))[1];
  const response=await fetch(url+'/api/reader/books/zhuangzi/embedding-index',{method:'POST',headers:{Origin:url}});
  void response.text().catch(()=>'');
  await until(()=>output.includes('index-active'));
  return {child,exit,url,output:()=>output};
 }
 // 第一次 Ctrl-C：等进行中的工作结束后自行退出，期间拒绝新请求。npm 紧接着转发的同一信号不算第二次。
 const waiting=await launch(2500),started=Date.now();
 waiting.child.kill('SIGINT');waiting.child.kill('SIGINT');
 await until(()=>waiting.output().includes('正在等待当前步骤保存后停止服务'));
 await delay(300);
 assert.equal(waiting.child.exitCode,null);
 assert.equal((await fetch(waiting.url+'/api/reader/sessions')).status,503);
 assert.equal((await waiting.exit)[0],0);
 assert.ok(Date.now()-started>=2000);
 // 等候中稍后再按一次 Ctrl-C：立即停止。
 const forced=await launch(60000),begun=Date.now();
 forced.child.kill('SIGINT');
 await until(()=>forced.output().includes('正在等待当前步骤保存后停止服务'));
 await delay(1700);
 assert.equal(forced.child.exitCode,null);
 forced.child.kill('SIGINT');
 assert.equal((await forced.exit)[0],0);
 assert.ok(Date.now()-begun<15000);
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
 const reader=async id=>(await app.handle(new Request('http://localhost/api/reader/sessions/'+id))).json();
 // 选题检索等观看者，不因 CLI 等待显示「等待继续」。
 assert.equal((await reader(session.id)).cliHold,undefined);
 const candidates=await command(['run',session.id,'--until','candidates','--timeout','10']);
 assert.equal(candidates.reason,'candidates');
 await command(['stories','choose',session.id],{generation:candidates.session.intake.generation,batch:0,index:0});
 const prepared=await command(['run',session.id,'--until','prepared','--timeout','10']);
 assert.equal(prepared.reason,'prepared');
 const {intake}=prepared.session,count=f.control.dagCalls.length;
 await command(['stories','confirm',session.id],{generation:intake.generation,draftToken:intake.draftToken,settings:intake.draft});
 await app.services.production.tick();
 assert.equal(f.control.dagCalls.length,count);
 // 确认后：阅读器显示「已保存，等待继续」并提供继续，CLI 读取原状态。
 // 排队任务由调度节拍建立，阅读器在其被等待阻止后显示。
 const held=await until(async()=>{await app.services.production.tick();const view=await reader(session.id);return view.cliHold&&view;},5000);
 assert.equal(f.control.dagCalls.length,count);
 assert.equal(held.awaitingContinue,true);assert.equal(held.cliHold,true);
 assert.ok(held.lifecycle.actions.some(action=>action.event==='continue'));
 assert.ok((await (await app.handle(new Request('http://localhost/api/reader/sessions'))).json()).find(item=>item.id===session.id).cliHold);
 const viaCli=await command(['stories','get',session.id]);
 assert.equal(viaCli.awaitingContinue,undefined);assert.equal(viaCli.lifecycle.continuation,false);
 assert.equal((await command(['run',session.id,'--until','reviewed','--timeout','10'])).reason,'reviewed');
 assert.equal(f.control.calls.length,0);
 assert.equal((await reader(session.id)).cliHold,true);
 // 浏览器「继续制作」解除等待，后台完成制作；重放同一编号不改变结果。
 const continueId=crypto.randomUUID();
 const proceed=()=>app.handle(new Request('http://localhost/api/reader/sessions/'+session.id+'/production-control',{method:'POST',body:JSON.stringify({requestId:continueId,action:'continue'})}));
 assert.equal((await proceed()).status,200);
 assert.equal((await reader(session.id)).cliHold,undefined);
 await until(async()=>{await app.services.production.tick();return (await command(['stories','get',session.id])).state==='completed';},15000);
 assert.equal((await proceed()).status,200);
 assert.equal((await command(['run',session.id,'--until','completed','--timeout','10'])).reason,'completed');
 await command(['api','POST','reader/publication-defaults'],{publication:{...emptyPublication,author:'测试作者'},expected:null});
 const output=path.join(f.root,'work.zip');
 const result=await executeHeadless(root,['export',session.id,'--data-dir',directory,'--format','zip','--allow-unsigned','--output',output]);
 assert.ok(result.pages>=3);
 assert.equal(desktopOwner(directory).service.url,service.url);
});

test('reader keeps retry for faulted CLI holds; stopping resumes full CLI runs after restart and keeps limited stops', {timeout:40000},async t=>{
 const cleanup=[];
 const f=await productionFixture({after:fn=>cleanup.push(fn)});await f.stop();f.control.hold=false;
 const books=libraryFixture(),generation=withLocalBooks(f.generation,books.books,f.media);
 const directory=f.dataDirectory,root=process.cwd(),release=ownDesktopDataSync(directory);
 let app,service;
 async function start(){
  app=createApplication({root,dataDirectory:directory,generation});
  app.services.localBooks=books.books;
  service=await startCliService(root,directory,{application:app});
 }
 await start();
 let unblock=()=>{};
 t.after(async()=>{unblock();await service.close();await app.close();release();for(const close of cleanup.reverse())await close();});
 const command=(args,input)=>callCliService(root,directory,args,root,process.env,input);
 const reader=async id=>(await app.handle(new Request('http://localhost/api/reader/sessions/'+id))).json();
 const control=(id,action)=>app.handle(new Request('http://localhost/api/reader/sessions/'+id+'/production-control',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),action})}));
 const story=books.stories[0],source={...selection,length:3,source:story.source,storyTitle:story.title};
 // 有限运行以故障结束：阅读器显示故障与重试，不显示「等待继续」。
 const faulted=(await command(['stories','create','--no-intake'],source)).session.id;
 let failed=false;f.control.beforeText=async()=>{if(!failed){failed=true;throw Error('controlled text failure');}};
 assert.equal((await command(['run',faulted,'--until','reviewed','--timeout','12'])).reason,'blocked');
 const view=await reader(faulted);
 assert.equal(view.cliHold,undefined);
 assert.ok(view.lifecycle.actions.some(action=>action.event==='retry'));
 // 已停在审片的故事：全量运行在校验读取中被停服中断，不得释放等待。
 f.control.beforeText=null;
 const validating=(await command(['stories','create','--no-intake'],source)).session.id;
 assert.equal((await command(['run',validating,'--until','reviewed','--timeout','12'])).reason,'reviewed');
 const snapshot=app.services.production.snapshot.bind(app.services.production);
 let blockValidation=true,validationEntered,releaseValidation;
 const inValidation=new Promise(resolve=>{validationEntered=resolve;}),validationGate=new Promise(resolve=>{releaseValidation=resolve;});
 app.services.production.snapshot=async(uid,id,audience)=>{
  if(id===validating&&blockValidation){blockValidation=false;validationEntered();await validationGate;}
  return snapshot(uid,id,audience);
 };
 const validationRun=command(['run',validating,'--until','completed','--timeout','20']),validationSettled=validationRun.then(()=>null,error=>error);
 await inValidation;
 // CLI 正在处理该故事时，浏览器继续返回冲突。
 const running=(await command(['stories','create','--no-intake'],source)).session.id;
 let entered;const gated=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{unblock=resolve;});
 f.control.beforeText=async()=>{entered();await gate;};
 const run=command(['run',running,'--until','completed','--timeout','20']),runSettled=run.then(()=>null,error=>error);
 await gated;
 assert.equal((await control(running,'continue')).status,409);
 // 浏览器已授权的故事在校验中被停服中断后，仍能按原授权继续。
 const browserStory=await (await app.handle(new Request('http://localhost/api/reader/sessions',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),intake:false,selection:source})}))).json();
 const browserValidation=Promise.withResolvers();
 app.services.production.snapshot=async(uid,id,audience)=>{
  if(id===browserStory.id&&audience==='cli'){browserValidation.resolve();await validationGate;}
  return snapshot(uid,id,audience);
 };
 const browserRun=command(['run',browserStory.id,'--until','completed','--timeout','20']).then(()=>null,error=>error);
 await browserValidation.promise;
 const limited=(await command(['stories','create','--no-intake'],source)).session.id;
 const limitedRun=command(['run',limited,'--until','reviewed','--timeout','20']),limitedSettled=limitedRun.then(()=>null,error=>error);
 await delay(150);
 // 停服等候：中断两条 CLI run，停收新请求，等已领取的文字任务结束。
 const drain=service.drain();
 assert.equal(drain.idle,false);
 releaseValidation();
 const outcome=async settled=>{const error=await settled;assert.equal(error?.code,'INTERRUPTED');return error.details.resumesAfterRestart;};
 assert.equal(await outcome(validationSettled),false);
 assert.equal(await outcome(browserRun),false);
 app.services.production.snapshot=snapshot;
 assert.equal(await outcome(runSettled),true);
 assert.equal(await outcome(limitedSettled),false);
 await assert.rejects(command(['stories','list']),{code:'SERVICE_BUSY'});
 assert.equal((await app.handle(new Request('http://localhost/api/reader/sessions'))).status,503);
 // 等候开始后才登记的可取消任务立即取消。
 let cancelled=false,finishLate=()=>{};
 void app.services.trackWork(new Promise(resolve=>{finishLate=resolve;}),()=>{cancelled=true;finishLate();});
 await delay(20);
 assert.equal(cancelled,true);
 let settled=false;void drain.settled.then(()=>{settled=true;});
 await delay(250);
 assert.equal(settled,false);
 f.control.beforeText=null;unblock();
 await drain.settled;
 const holds=async id=>!!await app.services.database.prepare("SELECT 1 FROM reader_commands WHERE action='cli-hold' AND session_id=?").bind(id).first();
 assert.equal(await holds(running),false);
 assert.equal(await holds(limited),true);
 assert.equal(await holds(validating),true);
 assert.equal(await holds(browserStory.id),false);
 // 重开同一书库：全量运行不经人工操作完成，有限运行仍在审片停点等待继续。
 await service.close();await app.close();
 await start();
 await until(async()=>{await app.services.production.tick();return (await command(['stories','get',running])).state==='completed';},15000);
 await until(async()=>{await app.services.production.tick();return (await reader(browserStory.id)).state==='completed';},15000);
 await app.services.production.tick();
 assert.equal(await holds(limited),true);
 assert.notEqual((await command(['stories','get',limited])).state,'completed');
 // 校验前被中断的故事重开后不发图，仍等待继续。
 assert.equal(await holds(validating),true);
 const drawn=await app.services.database.prepare("SELECT COUNT(*) AS n FROM production_jobs WHERE session_id=? AND pool='image' AND state!='queued'").bind(validating).first();
 assert.equal(drawn.n,0);
 assert.equal((await reader(validating)).cliHold,true);
});

test('stopping at once aborts in-flight provider requests through the application transport', {timeout:10000},async t=>{
 const f=await startupFixture(t),directory=path.join(f.root,'abort library');
 let started;const sent=new Promise(resolve=>{started=resolve;});
 const transport=(url,init)=>new Promise((resolve,reject)=>{started();init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
 const release=ownDesktopDataSync(directory);
 const app=createApplication({root:process.cwd(),dataDirectory:directory,variables:{SHIQU_AI_PROVIDER:'readonly'},transport,production:{autoStart:false}});
 t.after(async()=>{await app.close();release();});
 const request=app.services.transport('https://provider.invalid/v1/generate',{method:'POST'});
 await sent;
 app.interruptWork();
 await assert.rejects(request,error=>error.name==='AbortError');
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
