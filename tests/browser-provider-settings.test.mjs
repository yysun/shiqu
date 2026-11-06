// 验证正式设置处理器、原始网络来源及共享持久化边界，不调用推理。
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {get} from 'node:http';
import {networkInterfaces} from 'node:os';
import {privateNetworkAddress,providerSettingsNetworkAccess} from '../server/provider-settings-access.ts';
import {existsSync} from 'node:fs';
import {browserProviderSettings} from '../server/browser-provider-settings.ts';
import {createHttpServer} from '../server/http.ts';
import {effectiveProviderVariables} from '../server/cli-setup.ts';
import {createApplication} from '../server/app.ts';
import {startDesktop} from '../server/desktop.ts';
import {defaultSystemSettings} from '../lib/system-settings.ts';
import {protectLocalProviderSettings} from '../scripts/development-server.mjs';
import {providerSettingsPath,providerSettingsProofHeader,loopbackAddress,imageKeyDraftForProviderChange} from '../lib/provider-settings.ts';
import {startupFixture,startFixtureCli,freeStartupPort,savedStartupState} from './fixtures/startup.mjs';

const origin='http://127.0.0.1:3456',peer={remoteAddress:'127.0.0.1'};
const googleKey='test-only-google-private-key',openaiKey='test-only-openai-private-key';
async function fixture(t,overrides={}){
 const f=await startupFixture(t),store=f.store();
 store.save({provider:'gemini',providerConfigured:true,libraryConfigured:true,textModel:'saved-google-text',imageModel:'saved-google-image'},{provider:'gemini',value:googleKey});
 store.save({provider:'openai',openaiTextModel:'saved-openai-text',openaiImageModel:'saved-openai-image'},{provider:'openai',value:openaiKey});store.save({provider:'gemini'});
 const variables=effectiveProviderVariables(store,overrides);
 const handler=browserProviderSettings({variables,overrides,ports:[3456,3457],locations:f.locations});
 const read=(headers={},remote=peer,url=origin+providerSettingsPath)=>handler(new Request(url,{headers}),remote);
 const save=(body,headers={},remote=peer)=>handler(new Request(origin+providerSettingsPath,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),remote);
 const view=async()=>{const response=await read();assert.equal(response.status,200);return response.json();};
 return {...f,settingsStore:store,variables,handler,read,save,view};
}
const body=(view,settings=view.settings,extra={})=>({settings,expectedRevision:view.revision,keyAction:'keep',...extra});
async function safeJson(response){const result=await response.json(),serialized=JSON.stringify(result);assert.ok(!serialized.includes(googleKey));assert.ok(!serialized.includes(openaiKey));assert.ok(!serialized.includes('replacement-secret'));return result;}

test('local view and revision-checked save preserve unrelated shared settings and immutable running models',async t=>{
 const f=await fixture(t),before=f.settingsStore.settings(),current=await f.view();
 assert.equal(current.settings.provider,'gemini');assert.equal(current.runtime.provider,'gemini');assert.equal(current.runtime.models.text,'saved-google-text');assert.equal(current.restartRequired,false);assert.equal(current.keyPresent.openai,true);assert.equal(current.settings.dataDirectory,undefined);await safeJson(await f.read());
 const settings={...current.settings,textModel:'updated-google-text',taskReasoningEfforts:{...current.settings.taskReasoningEfforts,plan:'medium'}};
 const response=await f.save(body(current,settings));assert.equal(response.status,200);const saved=await safeJson(response);
 assert.equal(saved.settings.textModel,'updated-google-text');assert.equal(saved.runtime.models.text,'saved-google-text');assert.equal(saved.restartRequired,true);assert.equal(saved.revision,current.revision+1);
 assert.equal(f.settingsStore.settings().dataDirectory,before.dataDirectory);assert.equal(f.settingsStore.settings().port,before.port);assert.equal(f.settingsStore.settings().internetEnabled,before.internetEnabled);assert.equal(f.settingsStore.key('gemini'),googleKey);
 const snapshot=f.settingsStore.snapshot();assert.equal(snapshot.revision,saved.revision);assert.equal(snapshot.settings.textModel,saved.settings.textModel);assert.ok(!JSON.stringify(snapshot).includes(googleKey));
});

test('provider profiles and explicit key keep/replace/remove never return credentials',async t=>{
 const f=await fixture(t);let current=await f.view();
 let response=await f.save(body(current,{...current.settings,provider:'openai'}));assert.equal(response.status,200);current=await safeJson(response);assert.equal(f.settingsStore.key('openai'),openaiKey);assert.equal(current.settings.textModel,'saved-google-text');
 response=await f.save(body(current,current.settings,{keyAction:'replace',key:'replacement-secret'}));assert.equal(response.status,200);current=await safeJson(response);assert.equal(f.settingsStore.key('openai'),'replacement-secret');assert.equal(f.settingsStore.key('gemini'),googleKey);
 response=await f.save(body(current,current.settings,{keyAction:'remove'}));assert.equal(response.status,200);current=await safeJson(response);assert.equal(current.keyPresent.openai,false);assert.equal(f.settingsStore.key('openai'),'');
 response=await f.save(body(current));assert.equal(response.status,400);await safeJson(response);
 response=await f.save(body(current,{...current.settings,provider:'codex'}));assert.equal(response.status,200);current=await safeJson(response);assert.equal(current.settings.openaiTextModel,'saved-openai-text');
 response=await f.save(body(current,{...current.settings,provider:'readonly'}));assert.equal(response.status,200);current=await safeJson(response);
 response=await f.save(body(current,{...current.settings,provider:'gemini'}));assert.equal(response.status,200);assert.equal(f.settingsStore.key('gemini'),googleKey);await safeJson(response);
});

test('partial provider, model, per-task and key updates preserve omitted custom profiles and reasoning',async t=>{
 const f=await fixture(t);f.settingsStore.save({codexModel:'custom-codex-model',taskReasoningEfforts:{...f.settingsStore.settings().taskReasoningEfforts,art:'high',outline:'low',plan:'low'}});
 let current=await f.view();const original=f.settingsStore.settings();
 let response=await f.save({settings:{provider:'openai'},expectedRevision:current.revision,keyAction:'keep'});assert.equal(response.status,200);current=await safeJson(response);
 assert.deepEqual(f.settingsStore.settings(),{...original,provider:'openai'});
 response=await f.save({settings:{textModel:'new-inactive-google-model'},expectedRevision:current.revision,keyAction:'keep'});assert.equal(response.status,200);current=await safeJson(response);
 assert.deepEqual(f.settingsStore.settings(),{...original,provider:'openai',textModel:'new-inactive-google-model'});
 response=await f.save({settings:{taskReasoningEfforts:{review:'medium'}},expectedRevision:current.revision,keyAction:'keep'});assert.equal(response.status,200);current=await safeJson(response);
 assert.deepEqual(f.settingsStore.settings().taskReasoningEfforts,{...original.taskReasoningEfforts,review:'medium'});assert.equal(f.settingsStore.settings().codexModel,'custom-codex-model');
 const before=f.settingsStore.settings();response=await f.save({settings:{},expectedRevision:current.revision,keyAction:'replace',key:'replacement-secret'});assert.equal(response.status,200);await safeJson(response);
 assert.deepEqual(f.settingsStore.settings(),before);assert.equal(f.settingsStore.key('openai'),'replacement-secret');assert.equal(f.settingsStore.key('gemini'),googleKey);
});

test('invocation overrides report names only and drift follows the effective active provider',async t=>{
 const f=await fixture(t,{GEMINI_API_KEY:'override-private-key',GEMINI_TEXT_MODEL:'override-text'}),current=await f.view();
 assert.equal(current.runtime.models.text,'override-text');assert.equal(current.restartRequired,false);assert.deepEqual(current.overrides,['GEMINI_API_KEY','GEMINI_TEXT_MODEL']);assert.ok(!JSON.stringify(current).includes('override-private-key'));
 let response=await f.save(body(current,{...current.settings,textModel:'saved-under-override'},{keyAction:'replace',key:'replacement-secret'}));assert.equal(response.status,200);let next=await safeJson(response);assert.equal(next.restartRequired,false);assert.equal(next.runtime.models.text,'override-text');
 response=await f.save(body(next,{...next.settings,openaiTextModel:'inactive-change'}));assert.equal(response.status,200);next=await safeJson(response);assert.equal(next.restartRequired,false);
 response=await f.save(body(next,{...next.settings,imageModel:'effective-image-change'}));assert.equal(response.status,200);next=await safeJson(response);assert.equal(next.restartRequired,true);
});

test('stale, malformed, invalid effort and unrelated-field writes fail without partial settings or key updates',async t=>{
 const f=await fixture(t),current=await f.view();f.settingsStore.save({port:4567});const before=await savedStartupState(f);
 let response=await f.save(body(current,{...current.settings,textModel:'stale'},{keyAction:'replace',key:'replacement-secret'}));assert.equal(response.status,409);await safeJson(response);assert.deepEqual(await savedStartupState(f),before);
 const fresh=await f.view();
 for(const input of [
  {...body(fresh),expectedRevision:undefined}, {...body(fresh),unexpected:true},body(fresh,{...fresh.settings,dataDirectory:'/forbidden'}),
  body(fresh,{...fresh.settings,textModel:'invalid/model'}),body(fresh,{...fresh.settings,taskReasoningEfforts:{...fresh.settings.taskReasoningEfforts,plan:'xhigh'}}),
  body(fresh,fresh.settings,{keyAction:'replace',key:'replacement-secret\ninvalid'}),body(fresh,fresh.settings,{keyAction:'keep',key:'replacement-secret'}),
  body(fresh,{...fresh.settings,provider:'codex'},{keyAction:'replace',key:'replacement-secret'}),
 ]){response=await f.save(input);assert.equal(response.status,400);await safeJson(response);assert.deepEqual(await savedStartupState(f),before);}
 response=await f.save(body(fresh),{'Content-Type':'text/plain'});assert.equal(response.status,415);
 response=await f.handler(new Request(origin+providerSettingsPath,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{replacement-secret'}),peer);assert.equal(response.status,400);await safeJson(response);
});

test('real peers, exact interface hosts, origins and fetch-site guard settings without trusting forwarded headers',async t=>{
 const f=await fixture(t),current=await f.view(),before=await savedStartupState(f);
 for(const remoteAddress of ['192.0.2.3','::ffff:192.0.2.3','10.1.2.3','::ffff:192.168.1.3',undefined]){
  assert.equal((await f.read({'X-Forwarded-For':'127.0.0.1'}, {remoteAddress})).status,403);
  assert.equal((await f.save(body(current),{'X-Forwarded-For':'127.0.0.1'}, {remoteAddress})).status,403);
 }
 for(const hostname of ['192.0.2.3:3456','evil.local:3456','localhost.evil:3456','127.0.0.1:9999'])assert.equal((await f.read({},peer,'http://'+hostname+providerSettingsPath)).status,403);
 assert.equal((await f.read({Origin:'https://evil.example'})).status,403);assert.equal((await f.read({'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await f.save(body(current),{Origin:'https://evil.example'})).status,403);
 const noOrigin=new Request(origin+providerSettingsPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body(current))});assert.equal((await f.handler(noOrigin,peer)).status,403);
 for(const remoteAddress of ['127.0.0.1','::1','::ffff:127.0.0.1'])assert.equal((await f.read({}, {remoteAddress})).status,200);
 assert.equal((await f.read({},peer,'http://localhost:3457'+providerSettingsPath)).status,200);assert.equal((await f.read({},peer,'http://[::1]:3456'+providerSettingsPath)).status,200);
 assert.equal(loopbackAddress('::ffff:127.0.0.1'),true);assert.deepEqual(await savedStartupState(f),before);
});

test('Vite guard rejects public and loopback-spoofing LAN peers through normalized proxy paths',()=>{
 let middleware;protectLocalProviderSettings('private-fixture-proof').configureServer({config:{server:{port:3456}},middlewares:{use(fn){middleware=fn;}}});
 for(const url of [providerSettingsPath,providerSettingsPath+'?x=1','/art/../api/local/provider-settings','/api/x/%2e%2e/local/provider-settings','/api/x/../../api/local/provider-settings']){
  for(const remoteAddress of ['192.0.2.3','10.1.2.3']){
  let next=false,ended=false;const response={statusCode:200,setHeader(){},end(){ended=true;}};
  middleware({url,socket:{remoteAddress},headers:{host:'127.0.0.1:3456','x-forwarded-for':'127.0.0.1',[providerSettingsProofHeader]:'private-fixture-proof'}},response,()=>{next=true;});assert.equal(response.statusCode,403,url);assert.equal(ended,true);assert.equal(next,false);
  }
 }
 const lan=Object.values(networkInterfaces()).flat().find(entry=>entry&&!entry.internal&&entry.family==='IPv4'&&privateNetworkAddress(entry.address))?.address;
 for(const [url,remoteAddress] of [[providerSettingsPath,'127.0.0.1'],['/api/reader/sessions','192.0.2.3'],...(lan?[[providerSettingsPath,lan]]:[])]){
  let next=false;const headers={host:`${remoteAddress===lan?lan:'127.0.0.1'}:3456`,[providerSettingsProofHeader]:'forged-client-proof'};middleware({url,socket:{remoteAddress},headers}, {setHeader(){},end(){assert.fail('Reader or actual local request must pass');}},()=>{next=true;});assert.equal(next,true);if(url===providerSettingsPath)assert.equal(headers[providerSettingsProofHeader],'private-fixture-proof');
 }
});

test('private network boundaries include mapped addresses and normalized IPv6 hosts only on actual interfaces',()=>{
 const interfaces={lan:[{address:'192.168.4.2',internal:false},{address:'fd00:0:0:0:0:0:0:2',internal:false},{address:'fe80::2%en0',internal:false},{address:'203.0.113.2',internal:false}]};
 const access=providerSettingsNetworkAccess([3456],interfaces);
 for(const address of ['10.0.0.1','172.16.0.1','172.31.255.254','192.168.4.8','169.254.1.2','fc00::1','fdff::1','fe80::1','febf::1','::ffff:192.168.4.8','::ffff:c0a8:408']){
  assert.equal(privateNetworkAddress(address),true,address);assert.equal(access(address,'192.168.4.2:3456'),true,address);assert.equal(access(address,'127.0.0.1:3456'),false,address);
 }
 for(const address of [undefined,'','172.15.255.255','172.32.0.1','8.8.8.8','192.168.4.999','203.0.113.8','::','fec0::1','2001:db8::1','::ffff:203.0.113.8']){assert.equal(privateNetworkAddress(address),false,address);assert.equal(access(address,'192.168.4.2:3456'),false,address);}
 assert.equal(access('fd00::8','[fd00::2]:3456'),true);assert.equal(access('::1','[fd00::2]:3456'),true);
 for(const host of ['192.168.4.3:3456','192.168.4.2:9999','203.0.113.2:3456','[fe80::2]:3456','[fd00:0:0:0:0:0:0:2]:3456','evil.local:3456'])assert.equal(access('192.168.4.8',host),false,host);
});

test('LAN changes share revisions, preserve running configuration and never return saved credentials',async t=>{
 const lan=Object.values(networkInterfaces()).flat().find(entry=>entry&&!entry.internal&&entry.family==='IPv4'&&privateNetworkAddress(entry.address))?.address;
 if(!lan){t.skip('No private IPv4 interface');return;}
 const f=await fixture(t),local=await f.view(),base=`http://${lan}:3456`,remote={remoteAddress:'10.45.1.2'};
 const send=(settings,expectedRevision=local.revision,headers={})=>f.handler(new Request(base+providerSettingsPath,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify({settings,expectedRevision,keyAction:'replace',key:'replacement-secret'})}),remote);
 let response=await f.handler(new Request(base+providerSettingsPath),remote);assert.equal(response.status,200);await safeJson(response);
 response=await send({textModel:'lan-text-model'});assert.equal(response.status,200);const saved=await safeJson(response);
 assert.equal(saved.runtime.models.text,'saved-google-text');assert.equal(saved.settings.textModel,'lan-text-model');assert.equal(saved.restartRequired,true);assert.equal(f.settingsStore.key('gemini'),'replacement-secret');
 assert.equal((await f.save(body(local,{textModel:'stale-local-model'}))).status,409);
 for(const headers of [{Origin:'https://evil.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await send({textModel:'must-not-save'},saved.revision,headers)).status,403);
 for(const remoteAddress of ['203.0.113.1',undefined])assert.equal((await f.handler(new Request(base+providerSettingsPath,{headers:{'X-Forwarded-For':lan}}),{remoteAddress})).status,403);
 assert.equal(f.settingsStore.settings().textModel,'lan-text-model');
});

test('development settings fail closed behind legacy proxies or missing proof, while CLI stays direct',async t=>{
 const f=await fixture(t);
 for(const proxyToken of ['', 'private-fixture-proof']){
  const handler=browserProviderSettings({variables:f.variables,overrides:{},ports:[3456,3457],locations:f.locations,proxyToken});
  for(const host of ['127.0.0.1:3456','127.0.0.1:3457'])for(const supplied of [undefined,'forged-client-proof']){
   const headers=supplied?{[providerSettingsProofHeader]:supplied}:{};assert.equal((await handler(new Request('http://'+host+providerSettingsPath,{headers}),peer)).status,403);
   assert.equal((await handler(new Request('http://'+host+providerSettingsPath,{method:'POST',headers:{...headers,Origin:'http://'+host,'Content-Type':'application/json'},body:'{}'}),peer)).status,403);
  }
  const request=new Request(origin+providerSettingsPath,{headers:{[providerSettingsProofHeader]:'private-fixture-proof'}}),response=await handler(request,peer);
  assert.equal(response.status,proxyToken?200:403);assert.ok(!(await response.text()).includes('private-fixture-proof'));
  assert.equal((await handler(request,{remoteAddress:'192.0.2.3'})).status,403);
 }
 assert.equal((await f.read()).status,200,'Non-proxied CLI remains protected by its actual loopback peer');
});

test('HTTP adapter supplies socket metadata; forwarded headers cannot change the actual peer',async t=>{
 const f=await fixture(t),observed=[];const server=createHttpServer(async(request,remote)=>{observed.push(remote.remoteAddress);return f.handler(request,remote);});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const port=server.address().port;
 const result=await new Promise((resolve,reject)=>get({host:'127.0.0.1',port,path:providerSettingsPath,headers:{Host:'127.0.0.1:3456','X-Forwarded-For':'192.0.2.3'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject));
 assert.equal(result,200);assert.deepEqual(observed,['127.0.0.1']);
});

test('browser CLI edits apply to new jobs without restarting the process',async t=>{
 const f=await startupFixture(t),store=f.store(),port=await freeStartupPort();store.save({provider:'gemini',providerConfigured:true,libraryConfigured:true,textModel:'cli-saved-text',imageModel:'cli-saved-image',port},{provider:'gemini',value:googleKey});store.close();
 const process=startFixtureCli(f);await process.ready();
 const lan=Object.values(networkInterfaces()).flat().find(entry=>entry&&!entry.internal&&entry.family==='IPv4'&&privateNetworkAddress(entry.address))?.address;
 const base=`http://${lan||'127.0.0.1'}:${port}`;if(!lan)t.diagnostic('No private IPv4 interface; CLI LAN scenario unavailable.');
 let response=await fetch(base+providerSettingsPath);assert.equal(response.status,200);let current=await safeJson(response);assert.equal(current.restartRequired,false);
 response=await fetch(base+providerSettingsPath,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body(current,{...current.settings,textModel:'cli-new-text'}))});assert.equal(response.status,200);current=await safeJson(response);assert.equal(current.restartRequired,false);assert.equal(current.appliesToNewJobs,true);assert.equal(current.runtime.models.text,'cli-new-text');
 const active=await(await fetch(base+'/api/reader/status')).json();assert.equal(active.models.text,'cli-new-text');
 await process.stop();const state=await savedStartupState(f);assert.equal(state.settings.textModel,'cli-new-text');assert.equal(state.gemini,googleKey);
 const restarted=startFixtureCli(f);await restarted.ready();current=await (await fetch(base+providerSettingsPath)).json();assert.equal(current.runtime.models.text,'cli-new-text');assert.equal(current.restartRequired,false);await restarted.stop();
});

test('Codex settings load and save without launching a slow or unavailable CLI readiness probe',{skip:process.platform==='win32'},async t=>{
 const f=await startupFixture(t),port=await freeStartupPort(),marker=path.join(f.root,'must-not-probe'),binary=path.join(f.root,'slow-codex.mjs');
 await writeFile(binary,'#!'+process.execPath+'\nimport {writeFileSync} from "node:fs";writeFileSync('+JSON.stringify(marker)+',"started");setInterval(()=>{},1000);\n',{mode:0o700});
 const store=f.store();store.save({provider:'codex',providerConfigured:true,libraryConfigured:true,codexPath:binary,codexModel:'configured-codex-model',port});store.close();
 const cli=startFixtureCli(f);await cli.ready();const base=`http://127.0.0.1:${port}`;
 let response=await fetch(base+providerSettingsPath,{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);let current=await response.json();
 assert.equal(current.runtime.provider,'codex');assert.equal(current.runtime.models.text,'configured-codex-model');assert.equal(current.runtime.configured,undefined);assert.equal(existsSync(marker),false);
 response=await fetch(base+providerSettingsPath,{method:'POST',signal:AbortSignal.timeout(2000),headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({settings:{codexModel:'next-codex-model'},expectedRevision:current.revision,keyAction:'keep'})});assert.equal(response.status,200);current=await response.json();
 assert.equal(current.settings.codexModel,'next-codex-model');assert.equal(current.runtime.models.text,'next-codex-model');assert.equal(current.restartRequired,false);assert.equal(existsSync(marker),false);await cli.stop();
});

test('fully explicit CLI startup survives a corrupt saved store; settings failures stay safe',async t=>{
 const f=await startupFixture(t);await mkdir(path.dirname(f.locations.settings),{recursive:true});await writeFile(f.locations.settings,'corrupt-private-store');
 const port=await freeStartupPort(),process=startFixtureCli(f,['--data-dir',path.join(f.root,'explicit-library'),'--port',String(port)],{SHIQU_AI_PROVIDER:'readonly'});await process.ready();
 const base=`http://127.0.0.1:${port}`,response=await fetch(base+providerSettingsPath);assert.equal(response.status,503);assert.ok(!(await response.text()).includes('corrupt-private-store'));assert.equal((await fetch(base+'/api/reader/status')).status,200);await process.stop();
});

test('generic reader and native desktop listeners do not expose browser credential settings',async t=>{
 const f=await startupFixture(t),app=createApplication({root:f.root,dataDirectory:path.join(f.root,'generic-library'),variables:{SHIQU_AI_PROVIDER:'readonly'}});f.defer(()=>app.close());
 assert.equal((await app.handle(new Request(origin+providerSettingsPath))).status,404);
 const port=await freeStartupPort(),desktop=await startDesktop({...defaultSystemSettings(path.join(f.root,'native-library')),provider:'readonly',port},'',f.root);f.defer(()=>desktop.stop());
 const base=`http://127.0.0.1:${port}`;assert.equal((await fetch(base+providerSettingsPath)).status,404);
 assert.equal((await fetch(base+providerSettingsPath,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,404);
});

test('separate image provider saves its own key, clears with null and reports both runtime sides',async t=>{
 const f=await fixture(t,{SHIQU_IMAGE_PROVIDER:'openai'});let current=await f.view();
 assert.equal(current.runtime.provider,'gemini');assert.equal(current.runtime.imageProvider,'openai');assert.equal(current.runtime.models.image,'saved-openai-image');assert.equal(current.runtime.models.text,'saved-google-text');assert.ok(current.overrides.includes('SHIQU_IMAGE_PROVIDER'));
 let response=await f.save(body(current,{...current.settings,provider:'codex',imageProvider:'openai'},{imageKeyAction:'replace',imageKey:'replacement-secret'}));assert.equal(response.status,200);current=await safeJson(response);
 assert.equal(current.settings.imageProvider,'openai');assert.equal(f.settingsStore.key('openai'),'replacement-secret');assert.equal(f.settingsStore.key('gemini'),googleKey);
 // A key action for an image provider that is not separate is refused without changes.
 const revision=current.revision;response=await f.save(body(current,{...current.settings,imageProvider:null},{imageKeyAction:'remove'}));assert.equal(response.status,400);await safeJson(response);assert.equal(f.settingsStore.revision(),revision);
 f.settingsStore.save({},{provider:'openai',value:null});
 response=await f.save(body(await f.view()));assert.equal(response.status,400);assert.match((await safeJson(response)).error,/图片服务/);
 current=await f.view();response=await f.save(body(current,{...current.settings,imageProvider:null}));assert.equal(response.status,200);current=await safeJson(response);
 assert.equal(current.settings.imageProvider,undefined);assert.ok(!JSON.stringify(f.settingsStore.settings()).includes('imageProvider'));assert.equal(f.settingsStore.settings().provider,'codex');
});

test('image key drafts survive only while the same separate API provider remains active',()=>{
 const selections=['gemini','openai','codex','readonly'].flatMap(provider=>[undefined,'gemini','openai','codex'].map(imageProvider=>({provider,imageProvider})));
 const owner=settings=>settings.provider!=='readonly'&&['gemini','openai'].includes(settings.imageProvider)&&settings.imageProvider!==settings.provider?settings.imageProvider:null;
 for(const current of selections)for(const next of selections)for(const action of ['keep','replace','remove']){
  const draft={imageKeyAction:action,imageKey:action==='replace'?'replacement-secret':''};
  const expected=owner(current)&&owner(current)===owner(next)?draft:{imageKeyAction:'keep',imageKey:''};
  assert.deepEqual(imageKeyDraftForProviderChange(current,next,draft),expected,JSON.stringify({current,next,action}));
 }
});

for(const image of ['gemini','openai'])for(const imageKeyAction of ['replace','remove']){
 test(`switching text to ${image} clears the hidden image ${imageKeyAction} draft and saves safely`,async t=>{
  const f=await fixture(t),other=image==='gemini'?'openai':'gemini';
  f.settingsStore.save({provider:other,imageProvider:image});
  const current=await f.view(),settings={...current.settings,provider:image,imageProvider:undefined};
  const draft={imageKeyAction,imageKey:imageKeyAction==='replace'?'replacement-secret':''};
  // 复现旧请求：图片服务未变但独立字段已隐藏，服务端拒绝残留操作且不修改配置。
  const before=await savedStartupState(f);
  let response=await f.save(body(current,{...settings,imageProvider:null},draft));
  assert.equal(response.status,400);assert.match((await safeJson(response)).error,/图片服务与文本服务相同/);assert.deepEqual(await savedStartupState(f),before);
  const cleared=imageKeyDraftForProviderChange(current.settings,settings,draft);
  assert.deepEqual(cleared,{imageKeyAction:'keep',imageKey:''});
  response=await f.save(body(current,{...settings,imageProvider:null},cleared));assert.equal(response.status,200);
  const saved=await safeJson(response);assert.equal(saved.settings.provider,image);assert.equal(saved.settings.imageProvider,undefined);
  assert.equal(saved.revision,current.revision+1);assert.equal(f.settingsStore.key('gemini'),googleKey);assert.equal(f.settingsStore.key('openai'),openaiKey);
  // 再切回独立服务也不能恢复已清空的替换或移除操作。
  assert.deepEqual(imageKeyDraftForProviderChange(settings,current.settings,cleared),cleared);
 });
 test(`switching text without changing separate ${image} preserves its pending ${imageKeyAction} action`,async t=>{
  const f=await fixture(t),other=image==='gemini'?'openai':'gemini';
  f.settingsStore.save({provider:'codex',imageProvider:image});
  const current=await f.view(),settings={...current.settings,provider:other};
  const draft={imageKeyAction,imageKey:imageKeyAction==='replace'?'replacement-secret':''};
  const retained=imageKeyDraftForProviderChange(current.settings,settings,draft);assert.deepEqual(retained,draft);
  const response=await f.save(body(current,settings,retained));assert.equal(response.status,200);await safeJson(response);
  assert.equal(f.settingsStore.key(image),imageKeyAction==='replace'?'replacement-secret':'');
  assert.equal(f.settingsStore.key(other),other==='gemini'?googleKey:openaiKey);
 });
}


test('startup Gemini key permits Codex text plus Gemini images without saving the key',async t=>{
 const f=await fixture(t,{GEMINI_API_KEY:'synthetic-startup-key'});f.settingsStore.save({},{provider:'gemini',value:null});
 const before=await f.view();assert.equal(before.keyPresent.gemini,false);assert.equal(before.keyOverrides.gemini,true);
 const response=await f.save(body(before,{provider:'codex',imageProvider:'gemini'}));assert.equal(response.status,200);
 const saved=await response.json();assert.equal(saved.settings.provider,'codex');assert.equal(saved.settings.imageProvider,'gemini');assert.equal(saved.keyPresent.gemini,false);assert.equal(saved.keyOverrides.gemini,true);assert.equal(f.settingsStore.key('gemini'),'');assert.equal(saved.runtime.provider,'gemini');assert.equal(saved.restartRequired,true);assert.ok(!JSON.stringify(saved).includes('synthetic-startup-key'));
 const without=browserProviderSettings({variables:f.variables,overrides:{},ports:[3456],locations:f.locations});
 const denied=await without(new Request(origin+providerSettingsPath,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body(saved,{provider:'codex',imageProvider:'gemini'}))}),peer);assert.equal(denied.status,400);assert.equal(f.settingsStore.key('gemini'),'');
});


for(const provider of ['gemini','openai'])test(`${provider} startup keys obey override precedence and stay out of storage`,async t=>{
 const keyName=provider==='gemini'?'GEMINI_API_KEY':'OPENAI_API_KEY',secret='synthetic-startup-only';
 const f=await fixture(t,{[keyName]:secret});f.settingsStore.save({provider},{provider,value:null});
 let view=await f.view();assert.equal(view.keyPresent[provider],false);assert.equal(view.keyOverrides[provider],true);
 for(const settings of [{provider},{provider:'codex',imageProvider:provider}]){const response=await f.save(body(view,settings));assert.equal(response.status,200);view=await response.json();assert.equal(f.settingsStore.key(provider),'');assert.ok(!JSON.stringify(view).includes(secret));}
 f.settingsStore.save({provider},{provider,value:'saved-key'});
 for(const value of ['', ' ', 'invalid\nkey']){
  const handler=browserProviderSettings({variables:f.variables,overrides:{[keyName]:value},ports:[3456],locations:f.locations,live:true});
  const before=f.settingsStore.snapshot();const response=await handler(new Request(origin+providerSettingsPath,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body(before,{provider}))}),peer);
  assert.equal(response.status,400);assert.match((await response.json()).error,/启动密钥/);assert.equal(f.settingsStore.revision(),before.revision);assert.equal(f.settingsStore.key(provider),'saved-key');
 }
});

test('live settings expose next-job variables but keep process paths and port fixed',async t=>{
 const f=await fixture(t);const handler=browserProviderSettings({variables:{...f.variables,CODEX_BIN:'/launched/codex',PORT:'3456'},overrides:{},ports:[3456],locations:f.locations,live:true});
 f.settingsStore.save({provider:'codex',imageProvider:'gemini',codexPath:'/next-launch/codex',port:4567,codexModel:'new-codex'});
 const view=await(await handler(new Request(origin+providerSettingsPath),peer)).json();assert.equal(view.appliesToNewJobs,true);assert.equal(view.restartRequired,false);assert.equal(view.runtime.provider,'codex');assert.equal(view.runtime.models.text,'new-codex');
 const variables=handler.variables();assert.equal(variables.CODEX_BIN,'/launched/codex');assert.equal(variables.PORT,'3456');assert.equal(variables.SHIQU_AI_PROVIDER,'codex');assert.equal(variables.GEMINI_API_KEY,googleKey);
});
