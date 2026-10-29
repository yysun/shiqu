// Exercise public authentication and helper lifecycle with disposable libraries and no AI requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm,access,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {build} from 'esbuild';
import {desktopRemote} from '../server/desktop-remote.ts';
import {startDesktopTunnel} from '../server/desktop-tunnel.ts';
import {desktopSettings,startDesktop,desktopFailure} from '../server/desktop.ts';

const publicOrigin='https://test-reader-session.trycloudflare.com';
function request(gate,route='/',options={}){return gate.handle(new Request(publicOrigin+route,options));}
async function cookie(gate,link){
 const response=await request(gate,'/connect',{method:'POST',headers:{Origin:publicOrigin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(link).hash.slice(1)})});
 assert.equal(response.status,200);return response.headers.get('set-cookie');
}
test('public URLs gate every reader route; private fragment pairs into a distinct secure session',async()=>{
 const seen=[],gate=desktopRemote(async req=>{seen.push(req);return new Response('private reader',{headers:{'Cache-Control':'public, max-age=31536000, immutable'}});});
 const link=gate.activate(publicOrigin),token=new URL(link).hash.slice(1);
 assert.match(token,/^[\w-]{43}$/);
 const bootstrap=await request(gate,'/connect');assert.equal(bootstrap.status,200);
 assert.match(bootstrap.headers.get('content-security-policy'),/default-src 'none'/);
 const html=await bootstrap.text();assert.ok(!html.includes(token));assert.match(html,/history.replaceState/);
 for(const route of ['/','/api/stories','/api/reader/library','/api/reader/media/private.png','/assets/app.js','/sw.js']){
  const response=await request(gate,route);assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'private, no-store');
 }
 assert.equal(seen.length,0);
 for(const body of ['not json',JSON.stringify({token:'wrong'}),JSON.stringify({token:42}),JSON.stringify({token:'x'.repeat(1000)})])assert.equal((await request(gate,'/connect',{method:'POST',headers:{Origin:publicOrigin},body})).status,401);
 const session=await cookie(gate,link);assert.match(session,/; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=/);assert.ok(!session.includes(token));
 const Cookie=session.split(';')[0];
 for(const route of ['/','/api/stories','/api/reader/media/private.png','/assets/app.js']){
  const response=await request(gate,route,{headers:{Cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 }
 assert.equal((await request(gate,'/api/test',{method:'POST',headers:{Cookie,Origin:publicOrigin},body:'{}'})).status,200);
 assert.equal(await seen.at(-1).text(),'{}');assert.equal(new URL(seen.at(-1).url).origin,publicOrigin);
 assert.equal((await request(gate,'/api/test',{method:'POST',headers:{Cookie}})).status,403);
 for(const method of ['GET','POST'])assert.equal((await request(gate,'/api/test',{method,headers:{Cookie,Origin:'https://evil.example'}})).status,403);
 assert.equal((await request(gate,'/api/test',{headers:{Cookie,'x-forwarded-host':'evil.example','x-forwarded-proto':'http'}})).status,200);
 assert.equal(seen.at(-1).headers.get('x-forwarded-host'),null);
 assert.equal((await gate.handle(new Request('http://evil.example/',{headers:{Cookie,'x-forwarded-host':new URL(publicOrigin).host}}))).status,403);
 for(const route of ['/desktop','/desktop/settings'])assert.equal((await request(gate,route,{headers:{Cookie}})).status,404);
 gate.revoke();assert.equal((await request(gate,'/',{headers:{Cookie}})).status,403);
 const fresh=desktopRemote(async()=>Response.json({ok:true}));fresh.activate(publicOrigin);
 assert.equal((await request(fresh,'/',{headers:{Cookie}})).status,401);
 assert.equal((await request(fresh,'/connect',{method:'POST',headers:{Origin:publicOrigin},body:JSON.stringify({token})})).status,401);
});
test('pairing and remote sessions expire after twelve hours',async t=>{
 const gate=desktopRemote(async()=>Response.json({ok:true})),link=gate.activate(publicOrigin),Cookie=(await cookie(gate,link)).split(';')[0];
 const now=Date.now();t.mock.method(Date,'now',()=>now+13*60*60*1000);
 assert.equal((await request(gate,'/',{headers:{Cookie}})).status,401);
 assert.equal((await request(gate,'/connect',{method:'POST',headers:{Origin:publicOrigin},body:JSON.stringify({token:new URL(link).hash.slice(1)})})).status,401);
});
test('paired NDJSON responses preserve incremental reader output',async()=>{
 let send;
 const stream=new ReadableStream({start(controller){send=controller;}});
 const gate=desktopRemote(async()=>new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}})),link=gate.activate(publicOrigin);
 const Cookie=(await cookie(gate,link)).split(';')[0];
 const response=await request(gate,'/api/reader/suggestions',{method:'POST',headers:{Origin:publicOrigin,Cookie},body:'{}'});
 assert.equal(response.headers.get('content-type'),'application/x-ndjson');const reader=response.body.getReader();
 send.enqueue(new TextEncoder().encode('{"type":"progress"}\n'));assert.equal(new TextDecoder().decode((await reader.read()).value),'{"type":"progress"}\n');
 send.enqueue(new TextEncoder().encode('{"type":"result"}\n'));send.close();assert.equal(new TextDecoder().decode((await reader.read()).value),'{"type":"result"}\n');assert.equal((await reader.read()).done,true);
});
test('legacy LAN settings never silently enable Internet access',()=>{
 for(const lanEnabled of [true,false]){
  const settings=desktopSettings.parse({dataDirectory:'/tmp/library',port:3000,lanEnabled,provider:'gemini',textModel:'test',imageModel:'test',codexPath:'',codexModel:'',codexHome:''});
  assert.equal(settings.internetEnabled,false);assert.equal(settings.cloudflaredPath,'');
 }
});

async function temporary(t){const root=await mkdtemp(path.join(os.tmpdir(),'shiqu internet test '));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
async function until(check){const end=Date.now()+5000;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out waiting for helper');}
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
async function fake(t,{ready=true}={}){
 const root=await temporary(t),binary=path.join(root,'fake cloudflared'),record=path.join(root,'helper.json');
 await writeFile(binary,`#!${process.execPath}\nimport {readFileSync,writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);writeFileSync(${JSON.stringify(record)},JSON.stringify({pid:process.pid,args,config:readFileSync(args[args.indexOf('--config')+1],'utf8'),environment:Object.keys(process.env)}));\n${ready?`process.stderr.write('https://test-reader-');setTimeout(()=>process.stderr.write('session.trycloudflare.com\\nRegistered tunnel connection\\n'),10);`:''}\nsetInterval(()=>{},1000);`,{mode:0o755});
 return {root,binary,async info(){return until(async()=>{try{return JSON.parse(await readFile(record,'utf8'));}catch{return null;}});}};
}
const nativeOnly={skip:process.platform==='win32'};
test('helper receives isolated config/environment, handles split output and stops without leaks',nativeOnly,async t=>{
 const f=await fake(t);const oldKey=process.env.GEMINI_API_KEY,oldToken=process.env.TUNNEL_TOKEN;
 process.env.GEMINI_API_KEY='must-never-reach-helper';process.env.TUNNEL_TOKEN='must-never-reach-helper';
 t.after(()=>{if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;if(oldToken===undefined)delete process.env.TUNNEL_TOKEN;else process.env.TUNNEL_TOKEN=oldToken;});
 const tunnel=await startDesktopTunnel('http://127.0.0.1:12345',f.binary);t.after(()=>tunnel.stop());
 assert.equal(tunnel.origin,publicOrigin);const info=await f.info();
 assert.ok(!info.environment.includes('GEMINI_API_KEY'));assert.ok(!info.environment.includes('TUNNEL_TOKEN'));assert.equal(info.config,'{}\n');
 assert.ok(info.args.includes('--no-autoupdate'));const config=info.args[info.args.indexOf('--config')+1];await access(config);
 await tunnel.stop();assert.equal(alive(info.pid),false);await assert.rejects(access(config));
});
test('helper missing, timeout and startup cancellation leave no process or config',nativeOnly,async t=>{
 await assert.rejects(startDesktopTunnel('http://127.0.0.1:12345','/missing/cloudflared'),/未找到 cloudflared/);
 const f=await fake(t,{ready:false});
 const timedOut=assert.rejects(startDesktopTunnel('http://127.0.0.1:12345',f.binary,{timeoutMs:5000}),/未能连接/);
 let info=await f.info();await timedOut;assert.equal(alive(info.pid),false);await assert.rejects(access(info.args[info.args.indexOf('--config')+1]));
 const second=await fake(t,{ready:false}),abort=new AbortController();
 const starting=startDesktopTunnel('http://127.0.0.1:12345',second.binary,{signal:abort.signal});const rejected=assert.rejects(starting,/取消/);
 info=await second.info();abort.abort();await rejected;assert.equal(alive(info.pid),false);
 await assert.rejects(access(info.args[info.args.indexOf('--config')+1]));
});
function tunnelRequest(url,options={}){
 return new Promise((resolve,reject)=>{
  const req=httpRequest(url,{method:options.method||'GET',headers:options.headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});
  req.on('error',reject);req.end(options.body);
 });
}
async function fixture(t){
 const root=await temporary(t);
 await cp('drizzle',path.join(root,'drizzle'),{recursive:true});await mkdir(path.join(root,'docker'));await cp('docker/seed.sql',path.join(root,'docker/seed.sql'));
 await mkdir(path.join(root,'dist/client'),{recursive:true});await writeFile(path.join(root,'dist/client/index.html'),'<html>temporary reader</html>');
 return {root,settings:desktopSettings.parse({dataDirectory:path.join(root,'library'),port:await port(),provider:'gemini',textModel:'test',imageModel:'test',codexPath:'',codexModel:'',codexHome:'',internetEnabled:true})};
}
test('tunnel entry pairs safely and helper exit clears public access while LAN survives',nativeOnly,async t=>{
 const f=await fixture(t),helper=await fake(t),updates=[];
 const runtime=await startDesktop({...f.settings,cloudflaredPath:helper.binary},'',f.root,{onStatus:status=>updates.push(status)});t.after(()=>runtime.stop());
 const info=await helper.info(),target=info.args[info.args.indexOf('--url')+1],headers={Host:new URL(publicOrigin).host,Origin:publicOrigin};
 assert.equal((await tunnelRequest(target+'/api/stories',{headers})).status,401);
 const token=new URL(runtime.status.publicUrl).hash.slice(1);
 const paired=await tunnelRequest(target+'/connect',{method:'POST',headers,body:JSON.stringify({token})});assert.equal(paired.status,200);
 const Cookie=paired.headers.get('set-cookie').split(';')[0];
 const stories=await (await tunnelRequest(target+'/api/stories',{headers:{...headers,Cookie}})).json();assert.ok(stories.length);
 const changed=await tunnelRequest(target+'/api/me/progress',{method:'POST',headers:{...headers,Cookie,'Content-Type':'application/json'},body:JSON.stringify({storyId:stories[0].id,page:2,saved:true})});assert.equal(changed.status,200);
 process.kill(info.pid,'SIGTERM');await until(()=>updates.length);
 assert.equal(runtime.status.publicUrl,'');assert.match(updates[0].internetError,/局域网仍可使用/);
 assert.equal((await fetch(runtime.status.url+'/api/stories')).status,200);
 await until(async()=>{try{await fetch(target);return false;}catch{return true;}});
 await runtime.stop();await assert.rejects(fetch(runtime.status.url));
});
test('missing helper leaves direct local/LAN access running without pairing',nativeOnly,async t=>{
 const f=await fixture(t);
 let runtime=await startDesktop({...f.settings,cloudflaredPath:'/missing/cloudflared'},'',f.root);t.after(()=>runtime.stop());
 assert.equal(runtime.status.running,true);assert.equal(runtime.status.publicUrl,'');assert.match(runtime.status.internetError,/未找到 cloudflared/);assert.match(runtime.status.internetError,/无需配对 ID/);
 assert.equal((await fetch(runtime.status.url)).status,200);assert.equal(runtime.server.address().address,'0.0.0.0');
 const stories=await (await fetch(runtime.status.url+'/api/stories')).json();assert.ok(stories.length);assert.equal(new URL(runtime.status.url).hash,'');
 let lan=false;
 for(const url of runtime.status.phoneUrls){
  assert.equal(new URL(url).hash,'');assert.equal(new URL(url).pathname,'/');
  try{const response=await fetch(url+'/api/stories',{signal:AbortSignal.timeout(1000)});if(response.ok){assert.equal(response.headers.get('set-cookie'),null);lan=true;break;}}catch{}
 }
 if(runtime.status.phoneUrls.length)assert.equal(lan,true);
 const origin=runtime.status.url;
 assert.equal((await fetch(origin+'/api/me/progress',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({storyId:stories[0].id,page:2,saved:true})})).status,200);
 await runtime.stop();await assert.rejects(fetch(origin));
 runtime=await startDesktop({...f.settings,internetEnabled:false},'',f.root);assert.equal((await fetch(runtime.status.url)).status,200);
 assert.match(desktopFailure(new Error('raw-private-data')),/服务启动失败/);
});
test('helper exiting before readiness closes only the remote entry and retains LAN',nativeOnly,async t=>{
 const f=await fixture(t),helper=await fake(t,{ready:false});
 await writeFile(helper.binary,(await readFile(helper.binary,'utf8')).replace('setInterval(()=>{},1000);','process.exit(1);'),{mode:0o755});
 const runtime=await startDesktop({...f.settings,cloudflaredPath:helper.binary},'',f.root);t.after(()=>runtime.stop());
 assert.equal(runtime.status.running,true);assert.equal(runtime.status.publicUrl,'');assert.match(runtime.status.internetError,/本机和局域网仍可使用/);
 const info=await helper.info();assert.equal(alive(info.pid),false);await assert.rejects(access(info.args[info.args.indexOf('--config')+1]));
 await assert.rejects(fetch(info.args[info.args.indexOf('--url')+1]));assert.equal((await fetch(runtime.status.url+'/api/stories')).status,200);
});
test('parent EOF during tunnel startup cancels helper before native forced-stop deadline', {...nativeOnly,timeout:15000},async t=>{
 const f=await fixture(t),helper=await fake(t,{ready:false}),entry=path.join(f.root,'dist/server/desktop.js');
 await build({entryPoints:['server/desktop.ts'],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
 await symlink(path.resolve('node_modules'),path.join(f.root,'node_modules'),'junction');
 await writeFile(path.join(f.root,'package.json'),'{"type":"module"}');
 const child=spawn(process.execPath,[entry],{cwd:f.root,stdio:['pipe','pipe','pipe']});child.stderr.resume();const lines=createInterface({input:child.stdout});const statuses=[];lines.on('line',line=>statuses.push(JSON.parse(line)));
 t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});
 child.stdin.write(JSON.stringify({action:'start',settings:{...f.settings,cloudflaredPath:helper.binary},key:''})+'\n');
 const info=await helper.info(),exited=once(child,'exit'),time=Date.now();child.stdin.end();await exited;
 assert.ok(Date.now()-time<7000);assert.equal(alive(info.pid),false);assert.ok(!statuses.some(status=>status.publicUrl));
 const runtime=await startDesktop({...f.settings,internetEnabled:false},'',f.root);await runtime.stop();
});
test('native JSON protocol reports tunnel disconnect and EOF stops the remaining LAN service', {...nativeOnly,timeout:15000},async t=>{
 const f=await fixture(t),helper=await fake(t),entry=path.join(f.root,'dist/server/desktop.js');
 await build({entryPoints:['server/desktop.ts'],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
 await symlink(path.resolve('node_modules'),path.join(f.root,'node_modules'),'junction');await writeFile(path.join(f.root,'package.json'),'{"type":"module"}');
 const child=spawn(process.execPath,[entry],{cwd:f.root,stdio:['pipe','pipe','pipe']});child.stderr.resume();
 t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});
 const lines=createInterface({input:child.stdout}),ready=once(lines,'line');child.stdin.write(JSON.stringify({action:'start',settings:{...f.settings,cloudflaredPath:helper.binary},key:''})+'\n');
 const initial=JSON.parse((await ready)[0]);assert.ok(initial.publicUrl.startsWith(publicOrigin+'/connect#'));
 const info=await helper.info(),changed=once(lines,'line');process.kill(info.pid,'SIGTERM');const status=JSON.parse((await changed)[0]);
 assert.equal(status.publicUrl,'');assert.equal(status.running,true);assert.equal(status.url,initial.url);assert.match(status.internetError,/局域网/);
 assert.equal((await fetch(status.url+'/api/stories')).status,200);
 const exited=once(child,'exit');child.stdin.end();await exited;assert.equal(alive(info.pid),false);await assert.rejects(fetch(status.url));
});
