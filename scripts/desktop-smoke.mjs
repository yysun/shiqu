// Exercise empty relocated desktop libraries and runtime lifecycle without generating content.
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
let child,binary=process.execPath;
const request=(url,options={})=>fetch(url,{signal:AbortSignal.timeout(5000),...options});
async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
async function inspect(directory){for(const name of await readdir(directory)){const file=path.join(directory,name),info=await lstat(file);assert.ok(!info.isSymbolicLink(),'Payload must not depend on checkout symlinks');assert.ok(!['.env','.data','shiqu.sqlite','settings.json','desktop.sqlite','desktop.sqlite-journal','desktop.sqlite-wal','desktop.sqlite-shm'].includes(name),'Unexpected private file: '+name);if(info.isDirectory())await inspect(file);else assert.ok(!['node','node.exe','pnpm','pnpm.exe'].includes(name),'Unexpected bundled runtime: '+name);}}
async function start(settings){
 child=spawn(binary,['--no-warnings',path.join(root,'dist/server/desktop.js')],{cwd:root,env:{PATH:'/shiqu-no-system-node',HOME:os.homedir(),SYSTEMROOT:process.env.SYSTEMROOT||''},stdio:['pipe','pipe','pipe']});
 child.stderr.resume();const lines=createInterface({input:child.stdout});
 const timeout=setTimeout(()=>child.kill('SIGTERM'),15000);
 const result=Promise.race([once(lines,'line').then(([line])=>JSON.parse(line)),once(child,'exit').then(()=>{throw Error('Packaged runtime exited before readiness');})]);
 child.stdin.write(JSON.stringify({action:'start',settings,key:''})+'\n');
 try{const ready=await result;assert.equal(ready.running,true,ready.error);return ready;}finally{clearTimeout(timeout);}
}
async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),10000);try{await exited;}finally{clearTimeout(timer);}}}

try{
 await inspect(source);await cp(source,root,{recursive:true});
 const payload=JSON.parse(await readFile(path.join(root,'payload.json'),'utf8'));assert.equal(payload.nodeBundled,true,'Desktop must bundle Node');
 const nativeDirectory=path.join(path.dirname(source),'node');
 {
  await cp(nativeDirectory,path.join(temporary,'node'),{recursive:true});
  const manifest=JSON.parse(await readFile(path.join(temporary,'node/manifest.json'),'utf8'));
  assert.equal(manifest.version,'24.22.1');assert.equal(manifest.platform,process.platform);assert.equal(manifest.arch,process.arch);
  assert.equal(manifest.binary,process.platform==='win32'?'node.exe':'node');
  binary=path.join(temporary,'node',manifest.binary);
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),manifest.sha256);
  assert.equal(createHash('sha256').update(await readFile(path.join(temporary,'node/LICENSE'))).digest('hex'),manifest.licenseSha256);
 }
 const catalog=JSON.parse(await readFile(path.join(root,'data/library/catalog.json'),'utf8'));assert.equal(catalog.books.length,24);
 const settings={nodePath:'/shiqu-system-node-must-not-be-used',dataDirectory:path.join(temporary,'library'),port:await port(),internetEnabled:false,cloudflaredPath:'',provider:'gemini',textModel:'gemini-3.8-flash',imageModel:'gemini-nano-banana-2.1',codexPath:'',codexModel:'',codexHome:''};
 const first=await start(settings),origin=new URL(first.url).origin;
 assert.equal(first.url,origin);assert.equal(first.publicUrl,'');
 const headers={};
 const page=await request(origin);assert.equal(page.status,200);assert.ok(page.headers.get('content-type')?.startsWith('text/html'));await page.body?.cancel();
 assert.equal((await request(origin+'/api/stories')).status,200);
 assert.deepEqual(await (await request(origin+'/api/stories',{headers})).json(),[],'Fresh libraries must contain no stories');
 assert.deepEqual(await (await request(origin+'/api/me/progress',{headers})).json(),[]);
 assert.equal((await request(origin+'/desktop/settings',{headers})).status,404);
 const provider=await (await request(origin+'/api/reader/status',{headers})).json();assert.equal(provider.configured,false);
 let lanAccessible=false;
 for(const link of first.phoneUrls){
  try{assert.equal(link,new URL(link).origin);const response=await request(link+'/api/stories',{signal:AbortSignal.timeout(3000)});if(response.ok){lanAccessible=true;break;}}catch{/* Another interface may be a VPN or unavailable to this host. */}
 }
 if(first.phoneUrls.length)assert.ok(lanAccessible,'At least one advertised LAN address must be accessible from the host');
 await stop();await assert.rejects(request(origin+'/api/stories'));
 const second=await start(settings);assert.equal(second.url,origin);assert.equal((await request(origin+'/api/stories')).status,200);
 assert.deepEqual(await (await request(origin+'/api/stories')).json(),[]);
 assert.deepEqual(await (await request(origin+'/api/me/progress')).json(),[]);
 await stop();
 console.log(JSON.stringify({edition:payload.edition,node:process.version,relocated:true,nodeBundled:true,systemNodeOnPath:false,books:catalog.books.length,emptyLibrary:true,directAccess:true,lanAccessible,restart:true,shutdown:true,paidCalls:0}));
}finally{await stop();await rm(temporary,{recursive:true,force:true});}
