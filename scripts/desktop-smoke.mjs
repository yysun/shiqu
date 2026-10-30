// Exercise empty relocated Standard/Lite libraries, then create temporary API fixtures without paid calls.
import assert from 'node:assert/strict';
import {cp,lstat,mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {makeStory} from '../tests/fixtures/story.mjs';
import {png} from '../tests/fixtures/images.mjs';

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
async function createFixtureStory(origin){
 async function json(route,method,body,status=200){
  const response=await request(origin+route,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
 }
 const form=new FormData();form.append('file',new File([png],'smoke.png',{type:'image/png'}));
 const uploaded=await request(origin+'/api/admin/upload',{method:'POST',headers:{Origin:origin},body:form});assert.equal(uploaded.status,200);
 const {url}=await uploaded.json(),fixture=makeStory(4);fixture.pages=fixture.pages.map(page=>({...page,image:url}));
 let story=await json('/api/admin/stories','POST',fixture,201);
 const route='/api/admin/stories/'+story.id;
 story=await json(route,'PUT',{...fixture,revision:story.revision});
 // Editing content clears review checks; approve the unchanged fixture before publishing.
 story=await json(route,'PUT',{...story,checks:fixture.checks});
 return json(route,'POST',{action:'publish',revision:story.revision});
}

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
 const settings={nodePath:bundled?'/shiqu-system-node-must-not-be-used':process.execPath,dataDirectory:path.join(temporary,'library'),port:await port(),internetEnabled:false,cloudflaredPath:'',provider:'gemini',textModel:'gemini-3.8-flash',imageModel:'gemini-nano-banana-2.1',codexPath:'',codexModel:'',codexHome:''};
 const first=await start(settings),origin=new URL(first.url).origin;
 assert.equal(first.url,origin);assert.equal(first.publicUrl,'');
 const headers={};
 assert.equal((await request(origin+'/api/stories')).status,200);
 assert.deepEqual(await (await request(origin+'/api/stories',{headers})).json(),[],'Fresh libraries must contain no stories');
 assert.deepEqual(await (await request(origin+'/api/me/progress',{headers})).json(),[]);
 const fixture=await createFixtureStory(origin);
 const stories=await (await request(origin+'/api/stories',{headers})).json();assert.equal(stories.length,1);assert.equal(stories[0].id,fixture.id);
 const image=await request(origin+stories[0].pages[0].image,{headers});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),png);
 assert.equal((await request(origin+'/desktop/settings',{headers})).status,404);
 const provider=await (await request(origin+'/api/reader/status',{headers})).json();assert.equal(provider.configured,false);
 const saved=await request(origin+'/api/me/progress',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({storyId:stories[0].id,page:2,saved:true})});assert.equal(saved.status,200);
 let lanAccessible=false;
 for(const link of first.phoneUrls){
  try{assert.equal(link,new URL(link).origin);const response=await request(link+'/api/stories',{signal:AbortSignal.timeout(3000)});if(response.ok){lanAccessible=true;break;}}catch{/* Another interface may be a VPN or unavailable to this host. */}
 }
 if(first.phoneUrls.length)assert.ok(lanAccessible,'At least one advertised LAN address must be accessible from the host');
 await stop();await assert.rejects(request(origin+'/api/stories'));
 const second=await start(settings);assert.equal(second.url,origin);assert.equal((await request(origin+'/api/stories')).status,200);
 assert.deepEqual(await (await request(origin+'/api/stories')).json(),stories);
 const progress=await (await request(origin+'/api/me/progress')).json();assert.equal(progress.length,1);assert.equal(progress[0].storyId,fixture.id);assert.equal(progress[0].page,2);assert.equal(progress[0].saved,1);
 await stop();
 console.log(JSON.stringify({edition:payload.edition,node:process.version,relocated:true,nodeBundled:bundled,systemNodeOnPath:!bundled,books:catalog.books.length,initiallyEmpty:true,fixtureStories:stories.length,directAccess:true,lanAccessible,persistence:true,shutdown:true,paidCalls:0}));
}finally{await stop();await rm(temporary,{recursive:true,force:true});}
