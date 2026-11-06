// 真实开发服务共用正式设置流程；仅使用合成密钥与隔离书库验证局域网及持久化边界。
import test from 'node:test';
import assert from 'node:assert/strict';
import {get} from 'node:http';
import {networkInterfaces} from 'node:os';
import {readlink,readFile} from 'node:fs/promises';
import path from 'node:path';
import {checkoutFixture,startDevelopment,assertStopped,saveGoogle} from './fixtures/development.mjs';
import {savedStartupState} from './fixtures/startup.mjs';
import {providerSettingsPath} from '../lib/provider-settings.ts';
import {privateNetworkAddress} from '../server/provider-settings-access.ts';

test('browser settings save through actual Vite/backend, preserve overrides and apply saved changes to new jobs without restart',{timeout:60000},async t=>{
 const dependencyLink=await readlink('node_modules/recharts'),f=await checkoutFixture(t);saveGoogle(f);
 const variables={GEMINI_IMAGE_MODEL:'shell-image-model',GEMINI_API_KEY:'fake-shell-key'};
 let server=await startDevelopment(t,f,{variables});
 const owner=JSON.parse(await readFile(path.join(f.locations.library,'.desktop-owner.json'),'utf8'));
 const load=async()=>{const response=await fetch(server.origin+providerSettingsPath);assert.equal(response.status,200);return response.json();};
 const save=async view=>fetch(server.origin+providerSettingsPath,{method:'POST',headers:{Origin:server.origin,'Content-Type':'application/json'},body:JSON.stringify(view)});
 let current=await load();assert.equal(current.settings.provider,'gemini');assert.equal(current.runtime.models.image,'shell-image-model');assert.equal(current.restartRequired,false);assert.ok(current.overrides.includes('GEMINI_API_KEY'));assert.ok(!JSON.stringify(current).includes('fake-shell-key'));
 let response=await save({settings:{...current.settings,textModel:'browser-saved-text',taskReasoningEfforts:{...current.settings.taskReasoningEfforts,plan:'low'}},expectedRevision:current.revision,keyAction:'replace',key:'fake-browser-key'});
 assert.equal(response.status,200);current=await response.json();assert.equal(current.restartRequired,false);assert.equal(current.appliesToNewJobs,true);assert.equal(current.runtime.models.text,'browser-saved-text');assert.ok(!JSON.stringify(current).includes('fake-browser-key'));
 let persisted=await savedStartupState(f);assert.equal(persisted.settings.textModel,'browser-saved-text');assert.equal(persisted.settings.taskReasoningEfforts.plan,'low');assert.equal(persisted.gemini,'fake-browser-key');
 const running=await (await fetch(server.origin+'/api/reader/status')).json();assert.equal(running.models.text,'browser-saved-text');assert.deepEqual(JSON.parse(await readFile(path.join(f.locations.library,'.desktop-owner.json'),'utf8')),owner);
 const conflict=await save({settings:{...current.settings,textModel:'must-not-save'},expectedRevision:current.revision-1,keyAction:'keep'});assert.equal(conflict.status,409);assert.equal((await savedStartupState(f)).settings.textModel,'browser-saved-text');
 assert.equal((await fetch(server.origin+providerSettingsPath,{headers:{Origin:'https://foreign.example'}})).status,403);assert.equal((await fetch(server.origin+providerSettingsPath,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 const direct=await fetch(`http://127.0.0.1:${server.apiPort}`+providerSettingsPath);assert.equal(direct.status,403,'Internal dev port requires proof from the guarded frontend');
 const lan=Object.values(networkInterfaces()).flat().find(address=>address?.family==='IPv4'&&!address.internal&&privateNetworkAddress(address.address))?.address;
 if(lan){
  const lanOrigin=`http://${lan}:${server.port}`;
  let lanResponse=await fetch(lanOrigin+providerSettingsPath);assert.equal(lanResponse.status,200);const lanView=await lanResponse.json();assert.equal(lanView.revision,current.revision);
  lanResponse=await fetch(lanOrigin+providerSettingsPath,{method:'POST',headers:{Origin:lanOrigin,'Content-Type':'application/json'},body:JSON.stringify({settings:{openaiTextModel:'lan-saved-openai-text'},expectedRevision:lanView.revision,keyAction:'keep'})});
  assert.equal(lanResponse.status,200);current=await lanResponse.json();assert.equal(current.settings.openaiTextModel,'lan-saved-openai-text');assert.equal((await savedStartupState(f)).settings.openaiTextModel,'lan-saved-openai-text');
  assert.equal((await fetch(lanOrigin+providerSettingsPath,{headers:{Origin:'https://foreign.example'}})).status,403);
  for(const route of [providerSettingsPath,'/api/x/%2e%2e/local/provider-settings','/art/../api/local/provider-settings']){
   const status=await new Promise((resolve,reject)=>get({hostname:lan,port:server.port,path:route,headers:{Host:`127.0.0.1:${server.port}`,'X-Forwarded-For':'127.0.0.1',Origin:server.origin}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject));assert.equal(status,403,route);
  }
 }else t.diagnostic('No private IPv4 interface; actual LAN scenario unavailable on this host.');
 await assertStopped(server);server=await startDevelopment(t,f,{variables});current=await load();assert.equal(current.runtime.models.text,'browser-saved-text');assert.equal(current.runtime.models.image,'shell-image-model');assert.equal(current.runtime.taskReasoningEfforts.plan,'low');assert.equal(current.restartRequired,false);
 response=await save({settings:{...current.settings,provider:'openai',openaiTextModel:'browser-openai-text',openaiImageModel:'browser-openai-image'},expectedRevision:current.revision,keyAction:'replace',key:'fake-openai-browser-key'});assert.equal(response.status,200);current=await response.json();assert.equal(current.runtime.provider,'openai');assert.equal(current.restartRequired,false);assert.equal((await(await fetch(server.origin+'/api/reader/status')).json()).provider,'openai');
 persisted=await savedStartupState(f);assert.equal(persisted.settings.provider,'openai');assert.equal(persisted.gemini,'fake-browser-key');assert.equal(persisted.openai,'fake-openai-browser-key');assert.ok(!server.output().includes('fake-browser-key'));assert.ok(!server.output().includes('fake-openai-browser-key'));
 await assertStopped(server);
 assert.equal(await readlink('node_modules/recharts'),dependencyLink,'Disposable dev processes must preserve the live dependency links');
});
