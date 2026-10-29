// Verify direct desktop reader access, private configuration, ownership, and real process cleanup without AI billing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm,symlink,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {build} from 'esbuild';
import {desktopAccess} from '../server/desktop-access.ts';
import {desktopSettings,desktopVariables,testDesktopProvider,startDesktop} from '../server/desktop.ts';
import {ownDesktopData} from '../server/desktop-owner.ts';

const settings=directory=>({nodePath:process.execPath,dataDirectory:directory,port:3000,internetEnabled:false,cloudflaredPath:'',provider:'gemini',textModel:'test-text',imageModel:'test-image',codexPath:'',codexModel:'',codexHome:''});
async function port(){const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const value=socket.address().port;await new Promise(resolve=>socket.close(resolve));return value;}
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu desktop test '));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp('drizzle',path.join(root,'drizzle'),{recursive:true});await mkdir(path.join(root,'docker'));await cp('docker/seed.sql',path.join(root,'docker/seed.sql'));
 await mkdir(path.join(root,'dist/client'),{recursive:true});await writeFile(path.join(root,'dist/client/index.html'),'<html>desktop reader</html>');
 return {root,settings:{...settings(path.join(root,'personal library')),port:await port()}};
}
test('direct access needs no cookies and rejects foreign origins/hosts and native routes',async()=>{
 let calls=0;const gate=desktopAccess(async()=>{calls++;return Response.json({ok:true});},{hosts:['127.0.0.1:3000']});
 const request=(url,options={})=>gate.handle(new Request(url,options)),origin='http://127.0.0.1:3000';
 for(const route of ['/','/api/stories','/api/reader/media/private/0.png','/sw.js']){
  const response=await request(origin+route);assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
 }
 assert.equal(calls,4);
 assert.equal((await request(origin+'/api/me/progress',{method:'POST',headers:{Origin:origin}})).status,200);
 assert.equal((await request('http://evil.example:3000/api/stories')).status,403);
 for(const method of ['GET','POST'])assert.equal((await request(origin+'/api/stories',{method,headers:{Origin:'http://evil.example'}})).status,403);
 assert.equal((await request(origin+'/api/stories',{method:'POST'})).status,403);
 for(const route of ['/desktop','/desktop/settings','/desktop/pair','/desktop/session'])assert.equal((await request(origin+route)).status,404);
 const restarted=desktopAccess(async()=>Response.json({ok:true}),{hosts:['127.0.0.1:3000']});
 assert.equal((await restarted.handle(new Request(origin+'/api/stories'))).status,200);
});
test('desktop settings reject unknown secrets/invalid models and isolate environment variables',()=>{
 const valid=settings('/tmp/library');desktopSettings.parse(valid);
 assert.throws(()=>desktopSettings.parse({...valid,key:'should-not-be-a-setting'}));
 assert.throws(()=>desktopSettings.parse({...valid,textModel:'../model'}));
 const vars=desktopVariables(valid,'private-only');assert.equal(vars.GEMINI_API_KEY,'private-only');assert.equal(vars.OPENAI_API_KEY,undefined);assert.equal(vars.SHIQU_DATA_DIR,undefined);
});
test('desktop effort defaults for old settings and maps explicit choices to the runner environment',()=>{
 const legacy=settings('/tmp/library');
 assert.equal(desktopSettings.parse(legacy).codexReasoningEffort,'');
 for(const effort of ['','low','medium','high','xhigh','max']){
  const parsed=desktopSettings.parse({...legacy,codexReasoningEffort:effort});
  assert.equal(desktopVariables(parsed,'').CODEX_REASONING_EFFORT,effort);
 }
 for(const effort of ['light','LOW',null,'none'])assert.throws(()=>desktopSettings.parse({...legacy,codexReasoningEffort:effort}));
});
test('connection test uses only model metadata, does not echo credentials, and no-key checks never make requests',async()=>{
 const config=settings('/tmp/library');let calls=0;
 const none=await testDesktopProvider(config,'','/tmp',async()=>{calls++;throw Error();});assert.equal(none.ok,false);assert.equal(calls,0);
 const result=await testDesktopProvider(config,'private-test-key','/tmp',async(url,options)=>{
  calls++;assert.match(url,/\/models\/test-(text|image)$/);assert.equal(options.headers['x-goog-api-key'],'private-test-key');assert.equal(options.method,undefined);return Response.json({name:'model'});
 });assert.equal(result.ok,true);assert.equal(calls,2);assert.ok(!JSON.stringify(result).includes('private-test-key'));
 const failure=await testDesktopProvider(config,'private-test-key','/tmp',async()=>Response.json({error:'private-test-key'},{status:403}));assert.equal(failure.ok,false);assert.ok(!failure.message.includes('private-test-key'));
});
test('desktop lifecycle preserves progress and direct access across restarts, detects busy data, and recovers after port conflicts',async t=>{
 const f=await fixture(t);let running=await startDesktop(f.settings,'',f.root);t.after(()=>running.stop());
 const url=new URL(running.status.url),origin=url.origin;
 assert.equal(running.status.url,origin);assert.equal(url.hash,'');assert.equal(url.pathname,'/');
 assert.equal((await fetch(origin)).status,200);
 assert.equal(running.status.publicUrl,'');
 assert.equal(running.server.address().address,'0.0.0.0');
 let lan=false;for(const link of running.status.phoneUrls){try{if((await fetch(link+'/api/stories',{signal:AbortSignal.timeout(1000)})).ok){lan=true;break;}}catch{}}
 if(running.status.phoneUrls.length)assert.equal(lan,true);
 const stories=await (await fetch(origin+'/api/stories')).json();assert.ok(stories.length);
 await fetch(origin+'/api/me/progress',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({storyId:stories[0].id,page:3,saved:true})});
 await assert.rejects(startDesktop({...f.settings,port:await port()},'',f.root),/DATA_BUSY/);
 await running.stop();await assert.rejects(fetch(origin+'/api/stories'));
 running=await startDesktop(f.settings,'',f.root);assert.equal(running.status.url,origin);assert.equal((await fetch(origin+'/api/stories')).status,200);
 const progress=await (await fetch(origin+'/api/me/progress')).json();assert.equal(progress[0].page,3);assert.equal(progress[0].saved,1);
 await running.stop();
 for(const host of ['127.0.0.1','0.0.0.0']){
  const occupied=createServer();occupied.listen(f.settings.port,host);await once(occupied,'listening');
  try{await assert.rejects(startDesktop(f.settings,'',f.root),{code:'EADDRINUSE'});}finally{await new Promise(resolve=>occupied.close(resolve));}
 }
 running=await startDesktop(f.settings,'',f.root);assert.equal(running.status.running,true);
});
test('data ownership rejects a live Node owner and reclaims a demonstrably dead owner',async t=>{
 const f=await fixture(t),directory=f.settings.dataDirectory;const release=await ownDesktopData(directory);
 await assert.rejects(ownDesktopData(directory),/DATA_BUSY/);await release();
 const child=spawn(process.execPath,['-e','process.exit(0)']);await once(child,'exit');
 await writeFile(path.join(directory,'.desktop-owner.json'),JSON.stringify({pid:child.pid,id:'dead-owner'}));
 const replacement=await ownDesktopData(directory);await replacement();await assert.rejects(access(path.join(directory,'.desktop-owner.json')));
});

async function until(check,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out waiting for process evidence');}
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
test('parent EOF kills active detached Codex groups before releasing the data directory', {skip:process.platform==='win32',timeout:20000},async t=>{
 const f=await fixture(t);const file=path.join(f.root,'dist/server/desktop.js');
 await build({entryPoints:['server/desktop.ts'],outfile:file,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
 await symlink(path.resolve('node_modules'),path.join(f.root,'node_modules'),'junction');
 const pidFile=path.join(f.root,'fake-codex-pids.json'),fake=path.join(f.root,'fake codex');
 await writeFile(fake,`#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({parent:process.pid,descendant:descendant.pid}));setInterval(()=>{},1000);`,{mode:0o755});
 await writeFile(path.join(f.root,'package.json'),'{"type":"module"}');
 const child=spawn(process.execPath,['--no-warnings',file],{cwd:f.root,env:{PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,HOME:os.homedir()},stdio:['pipe','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});
 const lines=createInterface({input:child.stdout});let diagnostics='';child.stderr.on('data',chunk=>diagnostics+=chunk);
 const ready=Promise.race([once(lines,'line'),once(child,'exit').then(([code])=>{throw Error('Desktop fixture exited '+code+': '+diagnostics.slice(0,1000));})]);child.stdin.write(JSON.stringify({action:'start',settings:{...f.settings,provider:'codex',codexPath:fake},key:''})+'\n');
 const [line]=await ready;const status=JSON.parse(line);assert.equal(status.running,true);
 const url=new URL(status.url);assert.equal(status.url,url.origin);
 const request=fetch(url.origin+'/api/reader/status').catch(()=>null);
 const pids=await until(async()=>{try{return JSON.parse(await readFile(pidFile,'utf8'));}catch{return null;}});
 assert.ok(alive(pids.parent));assert.ok(alive(pids.descendant));
 child.stdin.end();await Promise.race([once(child,'exit'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('EOF did not terminate Node')),10000);timer.unref();})]);await request;
 await until(()=>!alive(pids.parent)&&!alive(pids.descendant));
 await assert.rejects(fetch(url.origin+'/api/stories'));
 const release=await ownDesktopData(f.settings.dataDirectory);await release();
 assert.ok(!line.includes('GEMINI_API_KEY'));
});
