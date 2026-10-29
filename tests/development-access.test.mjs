// A real LAN-capable Vite server must pair APIs and deny private direct/raw/@fs requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {createServer} from 'vite';
import {createHttpServer} from '../server/http.ts';
import {developmentAccess} from '../server/development-access.ts';
import {developmentServerOptions,protectDevelopmentLibrary} from '../scripts/development-server.mjs';

test('development LAN proxy requires pairing and protects preserved/private workspace stores',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu paired-development ')),library=path.join(root,'private-shelf[1]');
 t.after(()=>rm(root,{recursive:true,force:true}));
 const privatePaths=['.data/dev/shiqu.sqlite','.data/dev/old-original.json','backups/private.json','media/reader/story/0.png','.env', 'private-shelf[1]/private.json'];
 for(const name of privatePaths){const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'private-library-content');}
 await mkdir(path.join(root,'public'));await writeFile(path.join(root,'public/visible.txt'),'public-asset');
 await writeFile(path.join(root,'index.html'),'<html><body>development reader<script type="module" src="/main.js"></script></body></html>');await writeFile(path.join(root,'main.js'),'export const visible=true;');
 let protectedApi=async()=>new Response('not ready',{status:503});
 const backend=createHttpServer(request=>protectedApi(request));backend.listen(0,'127.0.0.1');await once(backend,'listening');
 t.after(()=>new Promise(resolve=>backend.close(resolve)));
 const apiPort=backend.address().port;
 const frontend=await createServer({configFile:false,root,logLevel:'silent',plugins:[protectDevelopmentLibrary(library)],server:developmentServerOptions({port:0,apiPort,library})});await frontend.listen();
 t.after(()=>frontend.close());
 const port=frontend.httpServer.address().port,origin=`http://127.0.0.1:${port}`,token='b'.repeat(64);
 protectedApi=developmentAccess(async()=>Response.json({privateStory:true}),{SHIQU_DEV_PAIRING_TOKEN:token,SHIQU_DEV_FRONTEND_PORT:String(port)},apiPort);
 assert.equal(frontend.httpServer.address().address,'0.0.0.0');
 assert.equal((await fetch(origin+'/api/reader/sessions')).status,401);
 assert.equal((await fetch(origin+'/desktop/pair')).status,200);
 const paired=await fetch(origin+'/desktop/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(paired.status,200);
 const cookie=paired.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(origin+'/api/reader/sessions',{headers:{Cookie:cookie}})).status,200);
 assert.equal((await fetch(origin+'/api/reader/sessions',{method:'POST',headers:{Cookie:cookie,Origin:'http://other-device'}})).status,403);
 assert.equal((await fetch(origin+'/visible.txt')).status,200);assert.equal((await fetch(origin+'/@vite/client')).status,200);assert.equal((await fetch(origin+'/main.js')).status,200);
 for(const file of privatePaths)for(const raw of ['', '?raw'])for(const route of ['/'+file,'/@fs/'+path.join(root,file)]){
  const response=await fetch(origin+encodeURI(route)+raw);assert.ok([403,404].includes(response.status),`${route}${raw}:${response.status}`);assert.ok(!(await response.text()).includes('private-library-content'));
 }
});

test('Vite refuses libraries and private aliases inside its public directory',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu public-store '));t.after(()=>rm(root,{recursive:true,force:true}));
 const library=path.join(root,'private-shelf'),nested=path.join(root,'public','private-shelf');
 async function attempt(shelf){return createServer({configFile:false,root,logLevel:'silent',plugins:[protectDevelopmentLibrary(shelf)],server:developmentServerOptions({port:0,apiPort:3002,library:shelf})});}
 await assert.rejects(attempt(nested),/outside Vite publicDir/);
 await mkdir(library,{recursive:true});await mkdir(nested,{recursive:true});
 await assert.rejects(attempt(nested),/outside Vite publicDir/);
 await rm(nested,{recursive:true});await symlink(library,path.join(root,'public','alias'),'junction');await assert.rejects(attempt(library),/story-library alias/);
 await rm(path.join(root,'public','alias'));await writeFile(path.join(root,'public','shiqu.sqlite'),'private-library');await assert.rejects(attempt(library),/private runtime file/);
});
