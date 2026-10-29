// Exercise relocated Standard/Lite payloads, including bundled Node without system PATH or paid calls.
import assert from 'node:assert/strict';
import {cp,lstat,mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

assert.equal(process.versions.node.split('.')[0],'24','Run smoke checks using Node 24');
const source=path.resolve(process.argv.slice(2).find(value=>value!=='--')||'desktop/resources/runtime');
const temporary=await mkdtemp(path.join(os.tmpdir(),'shiqu relocated desktop ')),root=path.join(temporary,'runtime');
let child,binary=process.execPath,bundled=false;
const request=(url,options={})=>fetch(url,{signal:AbortSignal.timeout(5000),...options});
async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
async function inspect(directory){for(const name of await readdir(directory)){const file=path.join(directory,name),info=await lstat(file);assert.ok(!info.isSymbolicLink(),'Payload must not depend on checkout symlinks');assert.ok(!['.env','.data','shiqu.sqlite','settings.json','desktop.sqlite','desktop.sqlite-journal','desktop.sqlite-wal','desktop.sqlite-shm'].includes(name),'Unexpected private file: '+name);if(info.isDirectory())await inspect(file);else assert.ok(!['node','node.exe','pnpm','pnpm.exe'].includes(name),'Unexpected bundled runtime: '+name);}}
async function start(settings){
 child=spawn(binary,['--no-warnings',path.join(root,'dist/server/desktop.js')],{cwd:root,env:{PATH:bundled?'/shiqu-no-system-node':path.dirname(process.execPath)+path.delimiter+(process.env.PATH||''),HOME:os.homedir(),SYSTEMROOT:process.env.SYSTEMROOT||''},stdio:['pipe','pipe','pipe']});
 child.stderr.resume();const lines=createInterface({input:child.stdout});
 const timeout=setTimeout(()=>child.kill('SIGTERM'),15000);
 const result=Promise.race([once(lines,'line').then(([line])=>JSON.parse(line)),once(child,'exit').then(()=>{throw Error('Packaged runtime exited before readiness');})]);
 child.stdin.write(JSON.stringify({action:'start',settings,key:''})+'\n');
 try{const ready=await result;assert.equal(ready.running,true,ready.error);return ready;}finally{clearTimeout(timeout);}
}
async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),10000);try{await exited;}finally{clearTimeout(timer);}}}
async function pair(link){const url=new URL(link),response=await request(url.origin+'/desktop/session',{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify({token:url.hash.slice(1)})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}
try{
 await inspect(source);await cp(source,root,{recursive:true});
 const payload=JSON.parse(await readFile(path.join(root,'payload.json'),'utf8'));bundled=payload.nodeBundled;
 const nativeDirectory=path.join(path.dirname(source),'node');
 if(bundled){
  await cp(nativeDirectory,path.join(temporary,'node'),{recursive:true});
  const manifest=JSON.parse(await readFile(path.join(temporary,'node/manifest.json'),'utf8'));
  assert.equal(manifest.version,'24.22.1');assert.equal(manifest.platform,process.platform);assert.equal(manifest.arch,process.arch);
  assert.equal(manifest.binary,process.platform==='win32'?'node.exe':'node');
  binary=path.join(temporary,'node',manifest.binary);
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),manifest.sha256);
  assert.equal(createHash('sha256').update(await readFile(path.join(temporary,'node/LICENSE'))).digest('hex'),manifest.licenseSha256);
 }else{await assert.rejects(lstat(nativeDirectory),{code:'ENOENT'});}
 const catalog=JSON.parse(await readFile(path.join(root,'data/library/catalog.json'),'utf8'));assert.equal(catalog.books.length,24);
 const settings={nodePath:bundled?'/shiqu-system-node-must-not-be-used':process.execPath,dataDirectory:path.join(temporary,'library'),port:await port(),lanEnabled:true,provider:'gemini',textModel:'gemini-3.8-flash',imageModel:'gemini-nano-banana-2.1',codexPath:'',codexModel:'',codexHome:''};
 const first=await start(settings),origin=new URL(first.url).origin;
 assert.equal((await request(origin+'/api/stories')).status,401);
 const cookie=await pair(first.url),headers={Cookie:cookie};
 const stories=await (await request(origin+'/api/stories',{headers})).json();assert.ok(stories.length);
 assert.equal((await request(origin+stories[0].pages[0].image,{headers})).status,200);
 assert.equal((await request(origin+'/desktop/settings',{headers})).status,404);
 const provider=await (await request(origin+'/api/reader/status',{headers})).json();assert.equal(provider.configured,false);
 const saved=await request(origin+'/api/me/progress',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({storyId:stories[0].id,page:2,saved:true})});assert.equal(saved.status,200);
 let lanPaired=false;
 for(const link of first.phoneUrls){
  try{const lanCookie=await pair(link);const response=await request(new URL(link).origin+'/api/stories',{headers:{Cookie:lanCookie},signal:AbortSignal.timeout(3000)});if(response.ok){lanPaired=true;break;}}catch{/* Another interface may be a VPN or unavailable to this host. */}
 }
 if(first.phoneUrls.length)assert.ok(lanPaired,'At least one advertised LAN address must pair from the host');
 await stop();await assert.rejects(request(origin+'/api/stories'));
 const second=await start(settings);assert.equal((await request(origin+'/api/stories',{headers})).status,401);
 const replacement=await pair(second.url),progress=await (await request(origin+'/api/me/progress',{headers:{Cookie:replacement}})).json();assert.equal(progress[0].page,2);
 await stop();
 console.log(JSON.stringify({edition:payload.edition,node:process.version,relocated:true,nodeBundled:bundled,systemNodeOnPath:!bundled,books:catalog.books.length,stories:stories.length,pairing:true,lanPaired,persistence:true,shutdown:true,paidCalls:0}));
}finally{await stop();await rm(temporary,{recursive:true,force:true});}
