// Exercise real desktop settings, first-run choices and shared ownership without a user's data or AI calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import {cliConfiguration,askLibraryDirectory} from '../server/cli-options.ts';
import {desktopLibraryPaths} from '../server/library-directory.ts';
import {ownDesktopData} from '../server/desktop-owner.ts';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

async function fixture(t){
 const home=await mkdtemp(path.join(os.tmpdir(),'shiqu CLI library '));
 t.after(()=>rm(home,{recursive:true,force:true}));
 return {home,cwd:home,platform:process.platform,variables:{},ask:async()=>{throw Error('Unexpected question');}};
}
async function desktopSettings(context, value){
 const filename=desktopLibraryPaths(context).settings;
 await mkdir(path.dirname(filename),{recursive:true});
 const db=new DatabaseSync(filename);
 db.exec('CREATE TABLE desktop_settings(id INTEGER PRIMARY KEY,value TEXT)');
 db.prepare('INSERT INTO desktop_settings VALUES(1,?)').run(value);db.close();
 return filename;
}

test('saved desktop directory wins without prompting even before it exists, with settings read-only',async t=>{
 const context=await fixture(t),directory=path.join(context.home,'saved shelf');
 const filename=await desktopSettings(context,JSON.stringify({dataDirectory:directory})),before=await readFile(filename);
 const result=await cliConfiguration({},context);
 assert.equal(result.SHIQU_DATA_DIR,directory);
 await assert.rejects(access(directory));
 assert.deepEqual(await readFile(filename),before);
 const release=await ownDesktopData(result.SHIQU_DATA_DIR);await release();
 await access(directory);
});
test('first-run confirmation is remembered, but desktop settings take priority later',async t=>{
 const context=await fixture(t),locations=desktopLibraryPaths(context);let questions=0;
 const result=await cliConfiguration({},{...context,ask:async suggestion=>{questions++;assert.equal(suggestion,locations.library);return 'my shelf';}});
 assert.equal(result.SHIQU_DATA_DIR,path.join(context.home,'my shelf'));assert.equal(questions,1);
 assert.deepEqual(JSON.parse(await readFile(locations.cliSelection,'utf8')),{dataDirectory:result.SHIQU_DATA_DIR});
 assert.equal((await cliConfiguration({},context)).SHIQU_DATA_DIR,result.SHIQU_DATA_DIR);
 await assert.rejects(access(locations.settings));
 const desktop=path.join(context.home,'desktop preferred');await desktopSettings(context,JSON.stringify({dataDirectory:desktop}));
 assert.equal((await cliConfiguration({},context)).SHIQU_DATA_DIR,desktop);
});
test('accepting suggested directory does not create a desktop credential database',async t=>{
 const context=await fixture(t),locations=desktopLibraryPaths(context);
 assert.equal((await cliConfiguration({},{...context,ask:async()=>''})).SHIQU_DATA_DIR,locations.library);
 await assert.rejects(access(locations.settings));await assert.rejects(access(locations.library));
});
test('an existing default desktop library is found without a question or CLI settings write',async t=>{
 const context=await fixture(t),locations=desktopLibraryPaths(context);
 await mkdir(locations.library,{recursive:true});const db=new DatabaseSync(path.join(locations.library,'shiqu.sqlite'));db.close();
 assert.equal((await cliConfiguration({},context)).SHIQU_DATA_DIR,locations.library);
 await assert.rejects(access(locations.cliSelection));
});
test('cancelled prompt and non-interactive first use have no library or configuration side effects',async t=>{
 const context=await fixture(t),locations=desktopLibraryPaths(context);
 await assert.rejects(cliConfiguration({},{...context,ask:async()=>{throw Error('cancelled');}}),/cancelled/);
 await assert.rejects(access(path.dirname(locations.cliSelection)));
 if(!process.stdin.isTTY||!process.stdout.isTTY)await assert.rejects(askLibraryDirectory(locations.library),/--data-dir/);
});
test('malformed saved configuration fails clearly; explicit CLI/env directory bypasses it',async t=>{
 const context=await fixture(t),locations=desktopLibraryPaths(context);
 await desktopSettings(context,'private-broken-settings');
 await assert.rejects(cliConfiguration({},context),error=>error.message.includes('--data-dir')&&!error.message.includes('private-broken'));
 assert.equal((await cliConfiguration({dataDirectory:'chosen'},context)).SHIQU_DATA_DIR,path.join(context.home,'chosen'));
 assert.equal((await cliConfiguration({},{...context,variables:{SHIQU_DATA_DIR:'env choice'}})).SHIQU_DATA_DIR,path.join(context.home,'env choice'));
 await rm(locations.settings);
 await writeFile(locations.cliSelection,'broken CLI selection');
 await assert.rejects(cliConfiguration({},context),/cli-library.json/);
});
test('legacy independent CLI shelf is retained rather than moved or silently selected',async t=>{
 const context=await fixture(t),legacy=path.join(context.home,'legacy CLI shelf');
 await mkdir(legacy);await writeFile(path.join(legacy,'keep.txt'),'original');
 assert.equal((await cliConfiguration({dataDirectory:legacy},context)).SHIQU_DATA_DIR,legacy);
 assert.equal(await readFile(path.join(legacy,'keep.txt'),'utf8'),'original');
});
test('new ownership lock serializes simultaneous stale-owner recovery and releases on process exit',async t=>{
 const context=await fixture(t),directory=path.join(context.home,'shared');await mkdir(directory);
 const dead=spawn(process.execPath,['-e','process.exit(0)']);await once(dead,'exit');
 await writeFile(path.join(directory,'.desktop-owner.json'),JSON.stringify({pid:dead.pid,id:'stale'}));
 const results=await Promise.allSettled([ownDesktopData(directory),ownDesktopData(directory)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.filter(result=>result.status==='rejected')[0].reason.message,'DATA_BUSY');
 await results.find(result=>result.status==='fulfilled').value();
 const release=await ownDesktopData(directory);await release();
 await assert.rejects(access(path.join(directory,'.desktop-owner.json')));
});

async function processFixture(t){
 const {cp}=await import('node:fs/promises');
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu CLI process '));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await cp('drizzle',path.join(root,'drizzle'),{recursive:true});
 await mkdir(path.join(root,'docker'));await cp('docker/seed.sql',path.join(root,'docker/seed.sql'));
 await mkdir(path.join(root,'dist/client'),{recursive:true});await writeFile(path.join(root,'dist/client/index.html'),'<html>shared reader</html>');
 return root;
}
async function freePort(){
 const {createServer}=await import('node:net'),server=createServer();
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));return port;
}
function cliProcess(root,args,home,variables={}){
 const source=new URL('../server/cli.ts',import.meta.url).href;
 const program=`import {runCli} from ${JSON.stringify(source)};try{await runCli(${JSON.stringify(root)},${JSON.stringify(args)});}catch(error){console.error(error.message);process.exitCode=1;}`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{cwd:root,env:{PATH:process.env.PATH,HOME:home,USERPROFILE:home,APPDATA:path.join(home,'roaming'),LOCALAPPDATA:path.join(home,'local'),SYSTEMROOT:process.env.SYSTEMROOT||'',SHIQU_AI_PROVIDER:'gemini',...variables},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
 return {child,logs:()=>logs};
}
async function ready(process){
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('CLI readiness timed out: '+process.logs())),10000);
  const check=()=>{if(process.logs().includes('拾趣: http://')){clearTimeout(timer);resolve();}};
  process.child.stdout.on('data',check);
  process.child.once('exit',code=>{clearTimeout(timer);reject(Error('CLI exited '+code+': '+process.logs()));});
  check();
 });
}
async function stopProcess(process){
 if(process.child.exitCode!==null||process.child.signalCode!==null)return;
 const stopped=once(process.child,'exit'),timer=setTimeout(()=>process.child.kill('SIGKILL'),8000);
 process.child.kill('SIGTERM');try{await stopped;}finally{clearTimeout(timer);}
}
test('CLI creates the saved desktop shelf, shares media/progress, rejects overlap, and releases failed startup', {timeout:30000},async t=>{
 const context=await fixture(t),root=await processFixture(t),directory=path.join(context.home,'saved stories');
 const variables=process.platform==='win32'?{APPDATA:path.join(context.home,'roaming')}:{},savedContext={...context,variables};
 await desktopSettings(savedContext,JSON.stringify({dataDirectory:directory}));
 const port=await freePort(),origin='http://127.0.0.1:'+port,args=['--port',String(port)];
 let current=cliProcess(root,args,context.home);t.after(()=>stopProcess(current));await ready(current);
 const request=(route,options={})=>fetch(origin+route,{signal:AbortSignal.timeout(5000),...options});
 assert.equal(current.logs().includes('请输入'),false);
 assert.deepEqual(await (await request('/api/stories')).json(),[]);
 await access(path.join(directory,'shiqu.sqlite'));
 const overlap=cliProcess(root,['--port',String(await freePort())],context.home);
 assert.equal((await once(overlap.child,'exit'))[0],1);assert.match(overlap.logs(),/DATA_BUSY/);
 const {startDesktop}=await import('../server/desktop.ts');
 const settings={nodePath:process.execPath,dataDirectory:directory,port:await freePort(),internetEnabled:false,cloudflaredPath:'',provider:'gemini',textModel:'test-text',imageModel:'test-image',codexPath:'',codexModel:'',codexHome:''};
 await assert.rejects(startDesktop(settings,'',root),/DATA_BUSY/);
 await stopProcess(current);
 const {openDatabase}=await import('../server/database.ts'),{FileMedia}=await import('../server/media.ts'),{insertStory}=await import('./fixtures/story.mjs');
 const database=openDatabase(directory,root);const story=await insertStory({services:{db:database.db}});database.close();
 const media=new FileMedia(path.join(directory,'media')),bytes=new Uint8Array([137,80,78,71]);
 await media.put('shared-test.png',bytes,{contentType:'image/png'});
 const desktop=await startDesktop(settings,'',root);
 try{
  assert.equal((await (await fetch(desktop.status.url+'/api/stories')).json())[0].id,story.id);
  await fetch(desktop.status.url+'/api/me/progress',{method:'POST',headers:{Origin:desktop.status.url,'Content-Type':'application/json'},body:JSON.stringify({storyId:story.id,page:2,saved:true})});
  const blocked=cliProcess(root,args,context.home);assert.equal((await once(blocked.child,'exit'))[0],1);assert.match(blocked.logs(),/DATA_BUSY/);
 }finally{await desktop.stop();}
 current=cliProcess(root,args,context.home);await ready(current);
 assert.equal((await (await request('/api/stories')).json())[0].id,story.id);
 assert.equal((await (await request('/api/me/progress')).json())[0].page,2);
 assert.deepEqual(new Uint8Array(await (await request('/api/media/shared-test.png')).arrayBuffer()),bytes);
 await stopProcess(current);
 const {createServer}=await import('node:net'),occupied=createServer();occupied.listen(port,'127.0.0.1');await once(occupied,'listening');
 try{const failed=cliProcess(root,args,context.home);assert.equal((await once(failed.child,'exit'))[0],1);assert.match(failed.logs(),/EADDRINUSE/);}
 finally{await new Promise(resolve=>occupied.close(resolve));}
 const release=await ownDesktopData(directory);await release();
 current=cliProcess(root,args,context.home);await ready(current);await stopProcess(current);
});
test('non-interactive fresh CLI fails without creating configuration or business data', {timeout:10000},async t=>{
 const context=await fixture(t),root=await processFixture(t),current=cliProcess(root,[],context.home);
 assert.equal((await once(current.child,'exit'))[0],1);assert.match(current.logs(),/--data-dir/);
 const locations=desktopLibraryPaths({...context,variables:process.platform==='win32'?{APPDATA:path.join(context.home,'roaming')}:{}});
 await assert.rejects(access(path.dirname(locations.cliSelection)));
 await assert.rejects(access(locations.library));
});

test('CLI signal stops a hanging Codex request before draining HTTP and releasing the library', {skip:process.platform==='win32',timeout:15000},async t=>{
 const context=await fixture(t),root=await processFixture(t),directory=path.join(context.home,'shelf'),marker=path.join(root,'provider-pids.json'),fake=path.join(root,'fake codex');
 await writeFile(fake,`#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(marker)},JSON.stringify({parent:process.pid,descendant:descendant.pid}));setInterval(()=>{},1000);`,{mode:0o755});
 const port=await freePort(),current=cliProcess(root,['--port',String(port),'--data-dir',directory],context.home,{SHIQU_AI_PROVIDER:'codex',CODEX_BIN:fake});
 t.after(()=>stopProcess(current));await ready(current);
 const pending=fetch('http://127.0.0.1:'+port+'/api/reader/status',{signal:AbortSignal.timeout(10000)}).catch(()=>null);
 let pids;
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){try{pids=JSON.parse(await readFile(marker,'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
 assert.ok(pids,'Hanging provider process must be running before shutdown');
 const stopped=once(current.child,'exit');current.child.kill('SIGTERM');
 const timer=setTimeout(()=>current.child.kill('SIGKILL'),3000);
 try{const [code,signal]=await stopped;assert.equal(code,0,'CLI must finish graceful shutdown rather than wait for provider timeout');assert.equal(signal,null);}
 finally{clearTimeout(timer);}
 await pending;
 for(const pid of [pids.parent,pids.descendant])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 const release=await ownDesktopData(directory);await release();
});
