// 隔离配置与书库，通过正式桌面启动器和 HTTP 验证首次启动、共享设置及访问边界；不调用推理。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {rm,writeFile} from 'node:fs/promises';
import {get} from 'node:http';
import {startupFixture,freeStartupPort} from './fixtures/startup.mjs';
import {historicalLibrary} from './fixtures/historical-library.mjs';
import {SystemSettingsStore} from '../server/system-settings.ts';
import {startDesktop,desktopFailure} from '../server/desktop.ts';
import {browserProviderSettings} from '../server/browser-provider-settings.ts';
import {effectiveProviderVariables} from '../server/cli-setup.ts';
import {verifyLibraryBackup} from '../server/library-backup.ts';
import {desktopRemote} from '../server/desktop-remote.ts';
import {openDatabase} from '../server/database.ts';
import {checkProviderVariables} from '../server/provider-runtime.ts';
import {providerSettingsPath as route} from '../lib/provider-settings.ts';
import {privateNetworkAddress} from '../server/provider-settings-access.ts';
const failNetwork=async()=>{throw Error('禁止测试外网请求');};
async function fixture(t,patch={},overrides={}){
 const f=await startupFixture(t),file=path.join(f.root,'native-config','desktop.sqlite'),library=path.join(f.root,'console-library');
 const store=new SystemSettingsStore(file,library),settings=store.save({port:await freeStartupPort(),...patch});store.close();
 const events=[],runtime=await startDesktop(settings,'',f.root,{settingsFile:file,overrides,onStatus:value=>events.push(value),transport:failNetwork});f.defer(()=>runtime.stop());
 const base=runtime.status.url,read=()=>fetch(base+route),save=body=>fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {...f,file,library,settings,events,runtime,base,read,save,store:()=>new SystemSettingsStore(file,library,{existingOnly:true})};
}
const edit=(view,settings,extra={})=>({settings,expectedRevision:view.revision,keyAction:'keep',...extra});
test('fresh desktop starts without generation setup; reader works and generation cannot create a partial production',async t=>{
 const f=await fixture(t),view=await(await f.read()).json();
 assert.equal(f.runtime.status.running,true);assert.deepEqual(f.events.slice(0,2).map(s=>s.state),['upgrading','starting']);assert.equal(view.runtime.configured,false);assert.equal(f.runtime.status.provider.configured,false);
 assert.equal((await fetch(f.base)).status,200);assert.deepEqual(await(await fetch(f.base+'/api/reader/sessions')).json(),[]);
 const response=await fetch(f.base+'/api/reader/sessions',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),intake:true,selection:{bookId:'liaozhai',theme:'原典故事',artStyle:'ink-pencil',length:'auto',voice:false}})});
 assert.equal(response.status,503);assert.match((await response.json()).error,/配置生成服务/);assert.deepEqual(await(await fetch(f.base+'/api/reader/sessions')).json(),[]);
 for(const route of ['/__desktop/library','/desktop/settings','/api/local/start','/api/local/quit'])assert.equal((await fetch(f.base+route)).status,404);
});
test('desktop uses the exact native store and invocation overrides; new-job configuration and supervisor summary agree',async t=>{
 const f=await fixture(t,{provider:'gemini',providerConfigured:true,textModel:'saved-text'}, {GEMINI_API_KEY:'synthetic-override-key',GEMINI_TEXT_MODEL:'runtime-text',SHIQU_REASONING_PLAN:'medium'});
 let view=await(await f.read()).json();assert.equal(view.runtime.models.text,'runtime-text');assert.equal(view.runtime.taskReasoningEfforts.plan,'medium');assert.equal(view.restartRequired,false);assert.deepEqual(view.overrides,['GEMINI_API_KEY','GEMINI_TEXT_MODEL','SHIQU_REASONING_PLAN']);
 let response=await f.save(edit(view,{textModel:'new-saved-text'},{keyAction:'replace',key:'synthetic-saved-key'}));assert.equal(response.status,200);view=await response.json();assert.equal(view.restartRequired,false);assert.equal(f.runtime.status.restartRequired,false);
 response=await f.save(edit(view,{imageModel:'changed-image'}));view=await response.json();assert.equal(view.restartRequired,false);assert.equal(f.runtime.status.restartRequired,false);assert.equal(view.runtime.models.image,'changed-image');assert.equal(f.runtime.status.provider.models.text,'runtime-text');
 const store=f.store();assert.equal(store.settings().textModel,'new-saved-text');assert.equal(store.key('gemini'),'synthetic-saved-key');assert.equal(store.settings().port,f.settings.port);store.close();
 assert.equal(existsSync(f.locations.settings),false,'platform-derived settings store is never created');assert.doesNotMatch(JSON.stringify(view)+JSON.stringify(f.runtime.status),/synthetic-override-key|synthetic-saved-key/);
});
test('missing/corrupt desktop store fails safely for read/save/check/reset without replacement',async t=>{
 const f=await fixture(t),view=await(await f.read()).json();await rm(f.file);
 for(const operation of [()=>f.read(),()=>f.save(edit(view,{})),()=>f.save({action:'check',expectedRevision:view.revision}),()=>f.save({action:'reset',expectedRevision:view.revision})]){
  const response=await operation();assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/synthetic|native-config/);assert.equal(existsSync(f.file),false);
 }
 assert.match(f.runtime.status.settingsError,/共享生成设置/);
 await writeFile(f.file,'private-corrupt-bytes');assert.equal((await f.read()).status,503);assert.equal(readFileSync(f.file,'utf8'),'private-corrupt-bytes');assert.equal(existsSync(f.locations.settings),false);
});
test('saved connection check ignores drafts, checks metadata only; reset preserves native fields and rejects stale revisions',async t=>{
 const f=await startupFixture(t),store=f.store();store.save({provider:'gemini',providerConfigured:true,codexPath:'/native/codex',codexHome:'/native/login',internetEnabled:true,cloudflaredPath:'/native/cloudflared',port:3456},{provider:'gemini',value:'synthetic-private-key'});
 const overrides={GEMINI_TEXT_MODEL:'overridden-text'},variables=effectiveProviderVariables(store,overrides),calls=[];
 const handler=browserProviderSettings({variables,overrides,ports:[3456],locations:f.locations,existingOnly:true,transport:async(url,options)=>{calls.push({url,options});return Response.json({});}});
 const base='http://127.0.0.1:3456',send=body=>handler(new Request(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)}),{remoteAddress:'127.0.0.1'});
 const before=store.snapshot();let response=await send({action:'check',expectedRevision:before.revision});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.equal(calls.length,2);assert.ok(calls.some(c=>c.url.endsWith('/overridden-text')));assert.ok(calls.every(c=>c.options.body===undefined&&c.options.method===undefined));
 response=await send({action:'check',expectedRevision:before.revision,settings:{textModel:'unsaved'}});assert.equal(response.status,400);assert.equal(calls.length,2);
 store.save({port:3457});assert.equal((await send({action:'reset',expectedRevision:before.revision})).status,409);
 response=await send({action:'reset',expectedRevision:store.revision()});assert.equal(response.status,200);const view=await response.json(),after=store.settings();assert.equal(after.providerConfigured,false);assert.equal(after.codexPath,'/native/codex');assert.equal(after.codexHome,'/native/login');assert.equal(after.internetEnabled,true);assert.equal(after.cloudflaredPath,'/native/cloudflared');assert.equal(after.port,3457);assert.equal(after.dataDirectory,before.settings.dataDirectory);assert.equal(store.key('gemini'),'');assert.equal(view.runtime.models.text,'overridden-text');assert.equal(view.restartRequired,true);
});
test('real desktop HTTP allows private LAN hosts and denies foreign origins, normalized paths and native-only fields',async t=>{
 const f=await fixture(t),view=await(await f.read()).json();
 for(const headers of [{Origin:'https://foreign.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await fetch(f.base+route,{headers})).status,403);
 const foreignHost=await new Promise((resolve,reject)=>get(f.base,{path:route,headers:{Host:'192.0.2.1:'+f.settings.port,'X-Forwarded-For':'127.0.0.1'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject));assert.equal(foreignHost,403);
 for(const link of f.runtime.status.phoneUrls)assert.equal((await fetch(link+route,{headers:{'X-Forwarded-For':'127.0.0.1'}})).status,privateNetworkAddress(new URL(link).hostname)?200:403);
 for(const rawPath of ['/art/../api/local/provider-settings','/api/x/%2e%2e/local/provider-settings']){
  const code=await new Promise((resolve,reject)=>get(f.base,{path:rawPath},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject));assert.equal(code,403,rawPath);
 }
 for(const settings of [{codexPath:'/bad'},{codexHome:'/bad'},{dataDirectory:'/bad'},{port:9000},{internetEnabled:true},{nodePath:'/bad'},{cloudflaredPath:'/bad'}])assert.equal((await f.save(edit(view,settings))).status,400);
 assert.equal((await f.save(edit(view,{provider:'readonly'}))).status,200);assert.equal((await f.save(edit(view,{provider:'readonly'}))).status,409);
});
test('desktop LAN saves providers, keys and task settings while local stale saves conflict',async t=>{
 const f=await fixture(t),link=f.runtime.status.phoneUrls.find(url=>privateNetworkAddress(new URL(url).hostname));
 if(!link){t.skip('No private LAN interface');return;}
 const local=await(await f.read()).json(),send=(view,settings)=>fetch(link+route,{method:'POST',headers:{Origin:link,'Content-Type':'application/json'},body:JSON.stringify(edit(view,settings,{keyAction:'replace',key:'synthetic-lan-key'}))});
 let response=await send(local,{provider:'openai',openaiTextModel:'lan-text',openaiImageModel:'lan-image',taskReasoningEfforts:{plan:'low'}});assert.equal(response.status,200);const saved=await response.json();
 assert.equal(saved.settings.provider,'openai');assert.equal(saved.settings.taskReasoningEfforts.plan,'low');assert.equal(saved.runtime.provider,'openai');assert.equal(saved.restartRequired,false);assert.equal(saved.appliesToNewJobs,true);
 assert.equal(f.runtime.status.provider.provider,'openai');assert.equal((await(await fetch(link+'/api/reader/status')).json()).models.text,'lan-text');assert.doesNotMatch(JSON.stringify(saved),/synthetic-lan-key|codexPath|dataDirectory/);
 const store=f.store();assert.equal(store.key('openai'),'synthetic-lan-key');assert.equal(store.settings().openaiTextModel,'lan-text');store.close();
 assert.equal((await f.save(edit(local,{provider:'readonly'}))).status,409);
 assert.equal((await fetch(link+route,{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify(edit(saved,{provider:'readonly'}))})).status,403);
});
test('tunnel refuses generation settings before forwarding even with a loopback-looking request',async()=>{
 let calls=0;const remote=desktopRemote(async()=>{calls++;return Response.json({});});remote.activate('https://isolated-test.trycloudflare.com');
 for(const path of [route,'/art/../api/local/provider-settings','/api/x/%2e%2e/local/provider-settings'])assert.equal((await remote.handle(new Request('https://isolated-test.trycloudflare.com'+path,{headers:{Host:'127.0.0.1','X-Forwarded-For':'127.0.0.1'}}))).status,403);
 assert.equal(calls,0);
});
test('desktop startup upgrades an isolated legacy library before serving and reports its verified backup',async t=>{
 const f=await startupFixture(t),library=path.join(f.root,'legacy-library');historicalLibrary(library,f.root).close();const file=path.join(f.root,'native','desktop.sqlite'),store=new SystemSettingsStore(file,library),settings=store.save({port:await freeStartupPort()});store.close();const events=[];
 const runtime=await startDesktop(settings,'',f.root,{settingsFile:file,onStatus:status=>events.push(status),transport:failNetwork});f.defer(()=>runtime.stop());
 assert.equal(events[0].state,'upgrading');assert.ok(events.find(s=>s.state==='starting').backup);assert.ok(runtime.status.backup);assert.ok(verifyLibraryBackup(runtime.status.backup));assert.equal((await fetch(runtime.status.url+'/api/reader/sessions')).status,200);assert.equal(existsSync(path.join(library,'.desktop-upgrade.json')),false);
 const message=desktopFailure(Error('LIBRARY_RECOVERY_FAILED; backup: '+runtime.status.backup+'; private internals'));assert.ok(message.includes(runtime.status.backup));assert.doesNotMatch(message,/private internals/);
});

test('failed pending-journal recovery reports its backup safely before any service listener opens',async t=>{
 const f=await startupFixture(t),library=path.join(f.root,'recovery-library');historicalLibrary(library,f.root).close();
 const backup=path.join(f.root,'recovery-library-backups','unavailable-backup');
 await writeFile(path.join(library,'.desktop-upgrade.json'),JSON.stringify({version:1,work:'.desktop-upgrade-00000000-0000-0000-0000-000000000000',backup}));
 const store=new SystemSettingsStore(path.join(f.root,'config/desktop.sqlite'),library),settings=store.save({port:await freeStartupPort()});store.close();const events=[];
 await assert.rejects(startDesktop(settings,'',f.root,{onStatus:value=>events.push(value)}),error=>{const safe=desktopFailure(error);assert.match(safe,/LIBRARY_RECOVERY_FAILED/);assert.ok(safe.includes(backup));return true;});
 assert.deepEqual(events.map(s=>s.state),['upgrading']);await assert.rejects(fetch('http://127.0.0.1:'+settings.port));
});

test('in-place migration reports its new verified backup rather than an older consolidation report',async t=>{
 const f=await startupFixture(t),library=path.join(f.root,'current-library'),database=openDatabase(library,f.root);
 database.sqlite.exec("DROP TRIGGER stories_blocked_revision_fault; DELETE FROM app_migrations WHERE name='0020_blocked_revision_faults.sql'");database.close();
 const previous=path.join(f.root,'previous-consolidation-backup');await writeFile(path.join(library,'.desktop-upgrade-result.json'),JSON.stringify({backup:previous}));
 const store=new SystemSettingsStore(path.join(f.root,'native/desktop.sqlite'),library),settings=store.save({port:await freeStartupPort()});store.close();const events=[];
 const runtime=await startDesktop(settings,'',f.root,{onStatus:status=>events.push(status)});f.defer(()=>runtime.stop());
 assert.notEqual(runtime.status.backup,previous);assert.ok(runtime.status.backup);verifyLibraryBackup(runtime.status.backup);assert.equal(events.find(s=>s.state==='starting').backup,runtime.status.backup);
});

test('metadata check uses the model-list route for a DeepSeek invocation override without generation',async()=>{
 const calls=[],result=await checkProviderVariables({SHIQU_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'synthetic-key'},async(url,options)=>{calls.push({url,options});return Response.json({data:[]});});
 assert.equal(result.ok,true);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.deepseek.com/models');assert.equal(calls[0].options.body,undefined);
});
