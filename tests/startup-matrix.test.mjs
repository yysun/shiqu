// Exercise configuration precedence through real isolated CLI processes and explicit provider/library tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {cliConfiguration} from '../server/cli-options.ts';
import {cliProviderConfiguration} from '../server/cli-setup.ts';
import {startupFixture,freeStartupPort,startFixtureCli,savedStartupState,fixtureBytes} from './fixtures/startup.mjs';

const providers=process.platform==='win32'?['gemini','openai','readonly']:['gemini','openai','codex','readonly'];
for(const saved of providers)for(const override of [undefined,...providers])for(const keySource of ['saved','explicit','empty','unrelated']){
 test(`provider matrix: saved=${saved}, override=${override||'none'}, key=${keySource}`,async t=>{
  const f=await startupFixture(t),store=f.store();t.after(()=>store.close());
  store.save({provider:'gemini',providerConfigured:true},{provider:'gemini',value:'test-only-saved-gemini'});
  store.save({provider:'openai'},{provider:'openai',value:'test-only-saved-openai'});store.save({provider:saved});
  const active=override||saved,isApi=['gemini','openai'].includes(active),keyName=active==='openai'?'OPENAI_API_KEY':'GEMINI_API_KEY';
  const variables={...(override?{SHIQU_AI_PROVIDER:override}:{}),...(keySource==='explicit'?{[keyName]:'test-only-explicit'}:keySource==='empty'?{[keyName]:''}:keySource==='unrelated'?{[active==='openai'?'GEMINI_API_KEY':'OPENAI_API_KEY']:'test-only-wrong-provider'}:{})};
  const before={settings:store.settings(),revision:store.revision(),gemini:store.key('gemini'),openai:store.key('openai')};
  let questions=0;const prompt={text:async()=>{questions++;throw Error('SETUP_REQUIRED');},secret:async()=>assert.fail('unexpected secret input')};
  if(isApi&&keySource==='empty')await assert.rejects(cliProviderConfiguration(store,variables,prompt),/SETUP_REQUIRED/);
  else{const effective=await cliProviderConfiguration(store,variables,prompt);assert.equal(effective.SHIQU_AI_PROVIDER,active);if(isApi)assert.equal(effective[keyName],keySource==='explicit'?'test-only-explicit':'test-only-saved-'+active);}
  assert.equal(questions,isApi&&keySource==='empty'?1:0);
  assert.deepEqual({settings:store.settings(),revision:store.revision(),gemini:store.key('gemini'),openai:store.key('openai')},before);
 });
}

const launches=[
 {name:'saved profile and saved port',expected:'gemini',port:'saved'},
 {name:'config file overrides saved provider/models/library/port',file:true,expected:'openai',port:'file',library:'file'},
 {name:'shell overrides config file provider/models/library/port',file:true,shell:true,expected:'gemini',port:'shell',library:'shell'},
 {name:'flags override shell and config file port/library',file:true,shell:true,flags:true,expected:'gemini',port:'flag',library:'flag'},
 {name:'unselected .env is ignored',dotenv:true,expected:'gemini',port:'saved'},
 {name:'no saved profile with complete config-file override',fresh:true,file:true,expected:'openai',port:'file',library:'file'},
 {name:'no saved profile with complete environment override',fresh:true,shell:true,expected:'gemini',port:'shell',library:'shell'},
 {name:'explicit empty shell key beats file and saved key',file:true,emptyKey:true,error:/交互终端/},
 {name:'invalid explicit provider fails without mutation',invalidProvider:true,error:/SHIQU_AI_PROVIDER/},
 {name:'missing provider credentials fail noninteractively',missingKeys:true,error:/交互终端/},
 {name:'incomplete explicit provider never borrows another provider key',onlyGemini:true,openaiOverride:true,error:/交互终端/},
 {name:'fully explicit read-only startup bypasses corrupt saved settings',corrupt:true,explicit:true,expected:'readonly',port:'flag',library:'flag'},
];
for(const row of launches)test('CLI startup matrix: '+row.name,{timeout:30000},async t=>{
 const f=await startupFixture(t),ports={};for(const source of ['saved','file','shell','flag'])ports[source]=await freeStartupPort();
 const directories=Object.fromEntries(['saved','file','shell','flag'].map(source=>[source,path.join(f.root,source+' shelf')]));
 if(!row.fresh&&!row.corrupt){
  const store=f.store();
  if(!row.missingKeys){store.save({provider:'gemini'},{provider:'gemini',value:'test-only-db-gemini'});if(!row.onlyGemini)store.save({provider:'openai'},{provider:'openai',value:'test-only-db-openai'});}
  store.save({provider:'gemini',providerConfigured:!row.missingKeys,libraryConfigured:true,dataDirectory:directories.saved,port:ports.saved});store.close();
 }
 if(row.corrupt){await mkdir(path.dirname(f.locations.settings),{recursive:true});await writeFile(f.locations.settings,'test-only-corrupt-database');}
 const beforeBytes=await fixtureBytes(f.locations.settings),before=beforeBytes&&!row.corrupt?await savedStartupState(f):null;
 const config=path.join(f.root,'selected.env'),content=`SHIQU_AI_PROVIDER=openai\nOPENAI_API_KEY=test-only-file-key\nOPENAI_TEXT_MODEL=test-file-model\nPORT=${ports.file}\nSHIQU_DATA_DIR="${directories.file.replaceAll('\\','/')}"\n`;
 await writeFile(row.dotenv?path.join(f.root,'.env'):config,content);
 const args=row.file?['--config',config]:[],variables={};
 if(row.shell)Object.assign(variables,{SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'test-only-shell-key',GEMINI_TEXT_MODEL:'test-shell-model',PORT:String(ports.shell),SHIQU_DATA_DIR:directories.shell});
 if(row.flags||row.explicit)args.push('--port',String(ports.flag),'--data-dir',directories.flag);
 if(row.explicit)variables.SHIQU_AI_PROVIDER='readonly';
 if(row.emptyKey)Object.assign(variables,{SHIQU_AI_PROVIDER:'openai',OPENAI_API_KEY:''});
 if(row.invalidProvider)variables.SHIQU_AI_PROVIDER='unknown';
 if(row.openaiOverride)variables.SHIQU_AI_PROVIDER='openai';
 const run=startFixtureCli(f,args,variables);t.after(()=>run.stop());
 if(row.error){assert.equal(await run.ended(),1);assert.match(run.output(),row.error);}
 else{
  const output=await run.ready(),port=ports[row.port];assert.ok(output.includes(`http://127.0.0.1:${port}`));assert.ok(output.includes('data: '+directories[row.library||'saved']));
  const status=await(await fetch(`http://127.0.0.1:${port}/api/reader/status`,{signal:AbortSignal.timeout(5000)})).json();assert.equal(status.provider,row.expected);
  assert.equal(status.configured,row.expected!=='readonly');
  if(row.file&&!row.shell)assert.equal(status.models.text,'test-file-model');
  if(row.shell)assert.equal(status.models.text,'test-shell-model');
  assert.doesNotMatch(output,/test-only-(?:db|file|shell)-/);await run.stop();
 }
 if(before)assert.deepEqual(await savedStartupState(f),before,'runtime overrides must not rewrite settings or keys');
 else assert.deepEqual(await fixtureBytes(f.locations.settings),beforeBytes,'explicit invocation must not initialize or replace settings');
});

for(const source of ['saved','legacy','default','prompt','unconfirmed'])test('library discovery matrix: '+source,async t=>{
 const f=await startupFixture(t),legacy=path.join(f.root,'legacy shelf'),saved=path.join(f.root,'saved shelf');let questions=0;
 if(source==='saved'||source==='unconfirmed'){const store=f.store();store.save({dataDirectory:saved,libraryConfigured:source==='saved'});store.close();}
 if(source==='saved'||source==='legacy'){await mkdir(path.dirname(f.locations.cliSelection),{recursive:true});await writeFile(f.locations.cliSelection,JSON.stringify({dataDirectory:legacy}));}
 if(source==='default'){await mkdir(f.locations.library,{recursive:true});const db=new DatabaseSync(path.join(f.locations.library,'shiqu.sqlite'));db.close();}
 const legacyBefore=await fixtureBytes(f.locations.cliSelection);
 const result=await cliConfiguration({},{home:f.home,variables:f.env,cwd:f.root,ask:async()=>{questions++;return 'chosen shelf';}});
 assert.equal(result.SHIQU_DATA_DIR,source==='saved'?saved:source==='legacy'?legacy:source==='default'?f.locations.library:path.join(f.root,'chosen shelf'));
 assert.equal(questions,['prompt','unconfirmed'].includes(source)?1:0);
 if(source==='legacy'){const state=await savedStartupState(f);assert.equal(state.settings.dataDirectory,legacy);assert.equal(state.settings.libraryConfigured,true);assert.equal(state.gemini,'');assert.equal(state.openai,'');}
 assert.deepEqual(await fixtureBytes(f.locations.cliSelection),legacyBefore,'legacy directory file must remain untouched');
 if(source==='saved'||source==='legacy')await assert.rejects(access(result.SHIQU_DATA_DIR));
});
