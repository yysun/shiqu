// Validate shared settings migration, transactional updates, secret isolation and terminal setup using temporary data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {SystemSettingsStore} from '../server/system-settings.ts';
import {defaultSystemSettings,settingsVariables} from '../lib/system-settings.ts';
import {configureProvider,cliProviderConfiguration,effectiveProviderVariables} from '../server/cli-setup.ts';

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'shiqu system settings '));t.after(()=>rm(root,{recursive:true,force:true}));return {root,file:path.join(root,'config','desktop.sqlite'),library:path.join(root,'library')};}
function prompts(answers,keys=[]){return {text:async()=>{assert.ok(answers.length,'unexpected text prompt');const answer=answers.shift();if(answer instanceof Error)throw answer;return answer;},secret:async()=>{assert.ok(keys.length,'unexpected secret prompt');const key=keys.shift();if(key instanceof Error)throw key;return key;}};}

test('v1 migrates atomically, preserves settings/key and supports independent API profiles',async t=>{
 const f=await fixture(t);await mkdir(path.dirname(f.file),{recursive:true});const db=new DatabaseSync(f.file);
 const old=defaultSystemSettings(f.library);delete old.providerConfigured;delete old.libraryConfigured;delete old.openaiTextModel;delete old.openaiImageModel;old.port=3100;
 db.exec("CREATE TABLE desktop_settings(id INTEGER PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE desktop_credentials(name TEXT PRIMARY KEY CHECK(name='gemini'),value TEXT NOT NULL); PRAGMA user_version=1;");
 db.prepare('INSERT INTO desktop_settings VALUES(1,?)').run(JSON.stringify(old));db.prepare("INSERT INTO desktop_credentials VALUES('gemini',?)").run('fixture-gemini-key');db.close();
 const store=new SystemSettingsStore(f.file,f.library);t.after(()=>store.close());
 assert.equal(store.settings().port,3100);assert.equal(store.settings().providerConfigured,true);assert.equal(store.settings().libraryConfigured,true);assert.equal(store.key('gemini'),'fixture-gemini-key');
 store.save({provider:'openai',providerConfigured:true},{provider:'openai',value:'fixture-openai-key'});
 assert.equal(store.key('openai'),'fixture-openai-key');assert.equal(store.key('gemini'),'fixture-gemini-key');
 assert.equal(store.settings().provider,'openai');assert.ok(!JSON.stringify(store.settings()).includes('fixture-'));
 if(process.platform!=='win32'){assert.equal((await stat(f.file)).mode&0o777,0o600);assert.equal((await stat(path.dirname(f.file))).mode&0o777,0o700);}
});
test('legacy JSON import retains the confirmed library without inventing API credentials',async t=>{
 const f=await fixture(t);await mkdir(path.dirname(f.file),{recursive:true});
 await writeFile(path.join(path.dirname(f.file),'settings.json'),JSON.stringify({...defaultSystemSettings(f.library),provider:'readonly',port:3200}));
 const store=new SystemSettingsStore(f.file,f.library);t.after(()=>store.close());
 assert.equal(store.settings().libraryConfigured,true);assert.equal(store.settings().providerConfigured,true);assert.equal(store.settings().port,3200);
 assert.equal(store.key('openai'),'');assert.equal(store.key('gemini'),'');
});
test('patches preserve concurrent unrelated updates, stale revisions and key failures roll back',async t=>{
 const f=await fixture(t),first=new SystemSettingsStore(f.file,f.library),second=new SystemSettingsStore(f.file,f.library);t.after(()=>first.close());t.after(()=>second.close());
 const revision=first.revision();second.save({port:3200});
 assert.throws(()=>first.save({port:3300},undefined,revision),/另一入口/);assert.equal(first.settings().port,3200);
 first.save({provider:'openai'},{provider:'openai',value:'test-only'});second.save({codexModel:'another-model'});
 assert.equal(first.settings().codexModel,'another-model');assert.equal(second.settings().provider,'openai');
 const before=first.settings();assert.throws(()=>first.save({port:3400},{provider:'openai',value:'bad\nkey'}));assert.deepEqual(first.settings(),before);assert.equal(first.key('openai'),'test-only');
});
test('configure prompts only required fields, retains keys on blank input, and cancels without partial saves',async t=>{
 const f=await fixture(t),store=new SystemSettingsStore(f.file,f.library);t.after(()=>store.close());
 await configureProvider(store,prompts(['openai','',''],['test-only-openai']));
 assert.equal(store.settings().provider,'openai');assert.equal(store.settings().providerConfigured,true);assert.equal(store.key('openai'),'test-only-openai');
 const effective=await cliProviderConfiguration(store,{});assert.equal(effective.OPENAI_API_KEY,'test-only-openai');
 await configureProvider(store,prompts(['openai','',''],['']));assert.equal(store.key('openai'),'test-only-openai');
 const before=store.settings(),revision=store.revision();
 await assert.rejects(configureProvider(store,prompts(['gemini',new Error('cancelled')],['new-test-only-key'])),/cancelled/);
 assert.deepEqual(store.settings(),before);assert.equal(store.revision(),revision);assert.equal(store.key('gemini'),'');
 await configureProvider(store,prompts(['readonly']));assert.equal(store.key('openai'),'test-only-openai');assert.equal(store.settings().provider,'readonly');
});
test('invocation overrides choose only the effective provider key and never save environment values',async t=>{
 const f=await fixture(t),store=new SystemSettingsStore(f.file,f.library);t.after(()=>store.close());
 store.save({provider:'gemini',providerConfigured:true},{provider:'gemini',value:'saved-gemini'});
 store.save({provider:'openai'},{provider:'openai',value:'saved-openai'});store.save({provider:'gemini'});
 const revision=store.revision();
 assert.equal(effectiveProviderVariables(store,{SHIQU_AI_PROVIDER:'openai'}).OPENAI_API_KEY,'saved-openai');
 const effective=await cliProviderConfiguration(store,{SHIQU_AI_PROVIDER:'openai',OPENAI_API_KEY:'env-only',OPENAI_TEXT_MODEL:'env-model'});
 assert.equal(effective.OPENAI_API_KEY,'env-only');assert.equal(effective.OPENAI_TEXT_MODEL,'env-model');assert.equal(store.key('openai'),'saved-openai');assert.equal(store.settings().provider,'gemini');assert.equal(store.revision(),revision);
 const mapped=settingsVariables({...store.settings(),provider:'codex'},'never-for-codex');assert.equal(mapped.OPENAI_API_KEY,undefined);assert.equal(mapped.GEMINI_API_KEY,undefined);
});
test('reset clears only provider settings, keeping library/network state and no API key in story data',async t=>{
 const f=await fixture(t),store=new SystemSettingsStore(f.file,f.library);t.after(()=>store.close());
 store.save({provider:'openai',providerConfigured:true,port:3400,internetEnabled:true,libraryConfigured:true},{provider:'openai',value:'test-only-key'});
 store.resetProviders();assert.equal(store.key('openai'),'');assert.equal(store.settings().providerConfigured,false);assert.equal(store.settings().port,3400);assert.equal(store.settings().internetEnabled,true);assert.equal(store.settings().dataDirectory,f.library);assert.equal(store.settings().libraryConfigured,true);
 await assert.rejects(stat(f.library));
});
test('unknown/corrupt/future databases and symlinks are not silently replaced',async t=>{
 const f=await fixture(t);await mkdir(path.dirname(f.file),{recursive:true});
 for(const kind of ['corrupt','future','unknown','malformed-v1']){
  await rm(f.file,{force:true});
  if(kind==='corrupt')await writeFile(f.file,'original corrupt database');
  else{const db=new DatabaseSync(f.file);db.exec(kind==='future'?'PRAGMA user_version=9':kind==='unknown'?'CREATE TABLE unexpected(x)':'PRAGMA user_version=1');db.close();}
  const before=await readFile(f.file);assert.throws(()=>new SystemSettingsStore(f.file,f.library));assert.deepEqual(await readFile(f.file),before);
 }
 if(process.platform!=='win32'){
  await rm(f.file);const target=path.join(f.root,'untouched');await writeFile(target,'untouched');await symlink(target,f.file);
  assert.throws(()=>new SystemSettingsStore(f.file,f.library));assert.equal(await readFile(target,'utf8'),'untouched');
 }
});
