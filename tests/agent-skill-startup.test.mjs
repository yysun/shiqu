// 用临时home、真实启动与搬迁CLI验证自动安装；不修改用户技能、宿主配置或生产书库。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,realpath,symlink,cp} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {ensureAgentSkill,agentSkillPreference} from '../server/agent-skill.ts';
import {checkSkill} from '../server/cli-skill.ts';
import {executeHeadless} from '../server/headless-cli.ts';
import {buildDesktopEntries} from '../scripts/desktop-resources.mjs';
import {copyRuntimePackage,copyRuntimeAssets,desktopRuntimeAssets} from '../scripts/desktop-runtime-packages.mjs';
import {startupFixture,freeStartupPort,startFixtureCli} from './fixtures/startup.mjs';
import {defaultSystemSettings} from '../lib/system-settings.ts';
const source=process.cwd();
async function fixture(t){
 const base=await mkdtemp(path.join(os.tmpdir(),'shiqu-agent-skill-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const home=path.join(base,'home'),root=path.join(base,'app');await mkdir(home);await mkdir(path.join(root,'skills/shiqu'),{recursive:true});
 await writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.9.0'}));await writeFile(path.join(root,'skills/shiqu/SKILL.md'),await readFile(path.join(source,'skills/shiqu/SKILL.md')));
 return {base,home,root,context:{home,variables:{}},skill:path.join(home,'.agents/skills/shiqu/SKILL.md')};
}
async function until(work){const end=Date.now()+10000;while(!await work()){assert.ok(Date.now()<end,'startup integration did not settle');await new Promise(resolve=>setTimeout(resolve,20));}}
async function exists(filename){try{await readFile(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function config(home,text){await mkdir(path.join(home,'.codex'),{recursive:true});await writeFile(path.join(home,'.codex/config.toml'),text);}

test('startup installs the bundled skill once without enabling automatic updates',async t=>{
 const f=await fixture(t);assert.equal((await ensureAgentSkill(f.root,f.context)).status,'installed');
 assert.equal(await readFile(f.skill,'utf8'),await readFile(path.join(f.root,'skills/shiqu/SKILL.md'),'utf8'));
 const state=path.join(path.dirname(f.skill),'.shiqu-skill.json'),before=await readFile(state,'utf8');assert.equal(JSON.parse(before).autoUpdate,false);
 assert.equal((await ensureAgentSkill(f.root,f.context)).status,'unchanged');assert.equal(await readFile(state,'utf8'),before);
 assert.deepEqual((await readdir(f.home)).sort(),['.agents']);
});
test('persistent and launch-only preferences are independent of skill updates and do not install',async t=>{
 const f=await fixture(t);assert.equal((await executeHeadless(f.root,['skill','auto-install','off'],f.context)).autoInstall,false);
 assert.equal((await ensureAgentSkill(f.root,f.context)).status,'auto_install_disabled');assert.equal(await exists(f.skill),false);
 await executeHeadless(f.root,['skill','auto-install','on'],f.context);
 assert.equal((await ensureAgentSkill(f.root,{...f.context,variables:{SHIQU_SKILL_AUTO_INSTALL:'off'}})).status,'auto_install_disabled');
 assert.equal((await agentSkillPreference(undefined,f.context)).autoInstall,true);
 assert.equal((await ensureAgentSkill(f.root,f.context)).status,'installed');
 await assert.rejects(executeHeadless(f.root,['skill','auto-install','bad'],f.context));
 await assert.rejects(executeHeadless(f.root,['skill','auto-install','off','--scope','project'],f.context));
});
test('host path/name disabling and plugin choices survive startup without agent configuration writes',async t=>{
 const f=await fixture(t);
 for(const text of [`[[skills.config]]\npath=${JSON.stringify(f.skill)}\nenabled=false\n`,'[[skills.config]]\nname="shiqu"\nenabled=false\n','[plugins."shiqu@personal"]\nenabled=true\n']){
  await config(f.home,text);const result=await ensureAgentSkill(f.root,f.context);assert.ok(['skill_disabled','plugin_managed'].includes(result.status));assert.equal(await exists(f.skill),false);assert.equal(await readFile(path.join(f.home,'.codex/config.toml'),'utf8'),text);
 }
 await config(f.home,'[[skills.config]]\nname="shiqu"\nenabled=false\n[[skills.config]]\npath='+JSON.stringify(f.skill)+'\nenabled=true\n[plugins."shiqu@personal"]\nenabled=false\n');
 assert.equal((await ensureAgentSkill(f.root,f.context)).status,'installed');
});
test('edited, unmanaged and newer skills are preserved; old managed copies honor auto-update consent',async t=>{
 const f=await fixture(t);await ensureAgentSkill(f.root,f.context);const saved=await readFile(f.skill,'utf8');await writeFile(f.skill,'user instructions');
 assert.equal((await ensureAgentSkill(f.root,f.context)).status,'modified');assert.equal(await readFile(f.skill,'utf8'),'user instructions');await writeFile(f.skill,saved);
 await writeFile(path.join(f.root,'package.json'),'{"version":"0.9.1"}');await writeFile(path.join(f.root,'skills/shiqu/SKILL.md'),saved+'\n新版约束。\n');
 assert.equal((await ensureAgentSkill(f.root,f.context)).status,'update_available');assert.equal(await readFile(f.skill,'utf8'),saved);
 await checkSkill(f.root,'global',{autoUpdate:true},{...f.context,transport:async()=>new Response('{"name":"@apprun/shiqu","version":"0.9.1"}')});
 assert.equal((await ensureAgentSkill(f.root,f.context)).status,'updated');assert.match(await readFile(f.skill,'utf8'),/新版约束/);
 await writeFile(path.join(f.root,'package.json'),'{"version":"0.9.0"}');assert.equal((await ensureAgentSkill(f.root,f.context)).status,'newer');
 await rm(path.join(path.dirname(f.skill),'.shiqu-skill.json'));assert.equal((await ensureAgentSkill(f.root,f.context)).status,'unmanaged');
});
test('invalid host preferences, symlinks and locks return bounded failure without replacing files',async t=>{
 const f=await fixture(t);await config(f.home,'private_token = "DO_NOT_LOG"\ninvalid = [');const result=await ensureAgentSkill(f.root,f.context);assert.equal(result.status,'unavailable');assert.ok(!JSON.stringify(result).includes('DO_NOT_LOG'));assert.equal(await exists(f.skill),false);
 await rm(path.join(f.home,'.codex/config.toml'));const pref=await agentSkillPreference(false,f.context);await writeFile(pref.path,'private custom preference');await assert.rejects(agentSkillPreference(undefined,f.context),error=>!error.message.includes('private custom preference'));assert.equal((await ensureAgentSkill(f.root,f.context)).status,'unavailable');assert.equal(await readFile(pref.path,'utf8'),'private custom preference');await rm(pref.path);
 await mkdir(path.join(f.home,'.agents/skills'),{recursive:true});const outside=path.join(f.base,'external');await mkdir(outside);await symlink(outside,path.dirname(f.skill),'dir');assert.equal((await ensureAgentSkill(f.root,f.context)).status,'unavailable');assert.deepEqual(await readdir(outside),[]);await rm(path.dirname(f.skill));await mkdir(path.dirname(f.skill));await mkdir(path.join(path.dirname(f.skill),'.update-lock'));const busy=await ensureAgentSkill(f.root,f.context);assert.equal(busy.status,'unavailable');assert.equal(busy.code,'SKILL_BUSY');
});
test('desktop runtime records use absolute production commands and retain hash protection',async t=>{
 const f=await fixture(t),cli=path.join(f.root,'agent-cli.js');await writeFile(cli,'// 测试入口\n');const runtime={node:await realpath(process.execPath),cli};
 assert.equal((await ensureAgentSkill(f.root,{...f.context,runtime})).status,'installed');const filename=path.join(path.dirname(f.skill),'.shiqu-runtime.json'),data=JSON.parse(await readFile(filename,'utf8'));assert.deepEqual(data.command,[runtime.node,await realpath(cli)]);assert.equal(data.appVersion,'0.9.0');
 await writeFile(filename,'user runtime record');assert.equal((await ensureAgentSkill(f.root,{...f.context,runtime})).status,'unavailable');assert.equal(await readFile(filename,'utf8'),'user runtime record');
});
test('a newer install winning before the runtime lock keeps its version and command',async t=>{
 const f=await fixture(t),cli=path.join(f.root,'agent-cli.js');await writeFile(cli,'// 测试入口\n');const runtime={node:await realpath(process.execPath),cli};await ensureAgentSkill(f.root,{...f.context,runtime});
 const directory=path.dirname(f.skill),record=path.join(directory,'.shiqu-runtime.json'),stateFile=path.join(directory,'.shiqu-skill.json');
 const newer=JSON.stringify({schemaVersion:1,source:'@apprun/shiqu/desktop',appVersion:'0.9.1',command:[runtime.node,path.join(f.root,'newer-cli.js')]})+'\n';
 const original=fsPromises.mkdir;let replaced=false;
 t.mock.method(fsPromises,'mkdir',async(filename,...args)=>{if(filename===path.join(directory,'.update-lock')&&!replaced){replaced=true;const state=JSON.parse(await readFile(stateFile,'utf8'));state.version='0.9.1';state.runtimeSha256=createHash('sha256').update(newer).digest('hex');await writeFile(record,newer);await writeFile(stateFile,JSON.stringify(state));}return original(filename,...args);});syncBuiltinESMExports();
 try{const result=await ensureAgentSkill(f.root,{...f.context,runtime});assert.equal(result.status,'unavailable');assert.equal(result.code,'SKILL_RUNTIME_CHANGED');assert.equal(await readFile(record,'utf8'),newer);assert.equal(JSON.parse(await readFile(stateFile,'utf8')).version,'0.9.1');}
 finally{t.mock.restoreAll();syncBuiltinESMExports();}
});
test('a missing desktop executable is nonblocking and does not publish an unusable skill',async t=>{
 const f=await fixture(t);assert.equal((await ensureAgentSkill(f.root,{...f.context,runtime:{node:path.join(f.root,'missing-node'),cli:path.join(f.root,'missing-cli')}})).status,'unavailable');assert.equal(await exists(f.skill),false);
});
test('headless help/catalog and preference queries do not implicitly install skills',async t=>{
 const f=await fixture(t);await executeHeadless(f.root,['help','--json'],f.context);await executeHeadless(f.root,['catalog'],f.context);await executeHeadless(f.root,['skill','auto-install'],f.context);assert.deepEqual(await readdir(f.home),[]);
});
for(const broken of [false,true])test(`real CLI startup installs safely without blocking the reader (invalid host config=${broken})`,async t=>{
 const f=await startupFixture(t),port=await freeStartupPort();await mkdir(path.join(f.root,'skills/shiqu'),{recursive:true});await writeFile(path.join(f.root,'package.json'),'{"version":"0.9.0"}');await writeFile(path.join(f.root,'skills/shiqu/SKILL.md'),await readFile(path.join(source,'skills/shiqu/SKILL.md')));
 if(broken)await config(f.home,'secret="DO_NOT_LOG"\ninvalid=[');
 const run=startFixtureCli(f,['--port',String(port),'--host','127.0.0.1','--data-dir',path.join(f.root,'library')],{SHIQU_AI_PROVIDER:'readonly'});await run.ready();await until(()=>run.output().includes('拾趣技能：'));
 assert.equal((await fetch('http://127.0.0.1:'+port)).status,200);const skill=path.join(f.home,'.agents/skills/shiqu/SKILL.md');assert.equal(await exists(skill),!broken);assert.ok(!run.output().includes('DO_NOT_LOG'));await run.stop();
});

test('CLI startup reuses saved update consent and respects the launch-only opt-out',async t=>{
 const f=await startupFixture(t),port=await freeStartupPort();
 await mkdir(path.join(f.root,'skills/shiqu'),{recursive:true});await writeFile(path.join(f.root,'package.json'),'{"version":"0.9.0"}');await writeFile(path.join(f.root,'skills/shiqu/SKILL.md'),'old bundled skill');
 const args=['--port',String(port),'--host','127.0.0.1','--data-dir',path.join(f.root,'library')],context={home:f.home,variables:f.env};
 let run=startFixtureCli(f,args,{SHIQU_AI_PROVIDER:'readonly'});await run.ready();await until(()=>run.output().includes('拾趣技能：'));await run.stop();
 const skill=path.join(f.home,'.agents/skills/shiqu/SKILL.md');assert.equal(await readFile(skill,'utf8'),'old bundled skill');
 await writeFile(path.join(f.root,'package.json'),'{"version":"0.9.1"}');await writeFile(path.join(f.root,'skills/shiqu/SKILL.md'),'new bundled skill');
 run=startFixtureCli(f,args,{SHIQU_AI_PROVIDER:'readonly'});await run.ready();await until(()=>run.output().includes('拾趣技能：'));await run.stop();assert.equal(await readFile(skill,'utf8'),'old bundled skill');
 await checkSkill(f.root,'global',{autoUpdate:true},{...context,transport:async()=>new Response('{"name":"@apprun/shiqu","version":"0.9.1"}')});
 run=startFixtureCli(f,args,{SHIQU_AI_PROVIDER:'readonly',SHIQU_SKILL_AUTO_INSTALL:'off'});await run.ready();await until(()=>run.output().includes('拾趣技能：'));await run.stop();assert.equal(await readFile(skill,'utf8'),'old bundled skill');
 run=startFixtureCli(f,args,{SHIQU_AI_PROVIDER:'readonly'});await run.ready();await until(()=>run.output().includes('拾趣技能：'));await run.stop();assert.equal(await readFile(skill,'utf8'),'new bundled skill');
 assert.equal(JSON.parse(await readFile(path.join(path.dirname(skill),'.shiqu-skill.json'),'utf8')).autoUpdate,true);
});

test('failed CLI startup and non-start commands do not install a user skill',async t=>{
 const f=await startupFixture(t);
 for(const args of [['--help'],['--version'],['help','--json'],['catalog'],['--configure']]){
  const run=startFixtureCli(f,args);await run.ended();assert.equal(await exists(path.join(f.home,'.agents/skills/shiqu/SKILL.md')),false);
 }
 const failed=startFixtureCli(f,['--port',String(await freeStartupPort()),'--data-dir',path.join(f.root,'library')],{SHIQU_AI_PROVIDER:'invalid'});assert.equal(await failed.ended(),1);assert.equal(await exists(path.join(f.home,'.agents/skills/shiqu/SKILL.md')),false);
});

test('relocated desktop starts and invokes its bundled CLI without system npm', {timeout:60000},async t=>{
 const f=await startupFixture(t),root=path.join(f.root,'relocated application'),assets=path.join(f.root,'assets');
 await mkdir(root);await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module',version:'0.9.0'}));
 for(const [name]of desktopRuntimeAssets){const target=path.join(assets,name);await mkdir(path.dirname(target),{recursive:true});if(name==='dist/client'){await mkdir(target);await writeFile(path.join(target,'index.html'),'<html>relocated reader</html>');}else await cp(path.join(source,name),target,{recursive:true});}
 await copyRuntimeAssets(assets,root);
 const dependencies=await buildDesktopEntries(source,root);for(const dependency of dependencies)await copyRuntimePackage(dependency,source,root);
 const binary=path.join(f.root,'bundled node',path.basename(process.execPath));await mkdir(path.dirname(binary));await cp(await realpath(process.execPath),binary);
 const env={...f.env,PATH:path.join(f.root,'no-system-npm')},cli=path.join(root,'dist/server/agent-cli.js');
 const command=(args,executable=binary,entry=cli)=>spawnSync(executable,[entry,...args],{cwd:root,env,encoding:'utf8',timeout:15000});
 const help=command(['help','--json']);assert.equal(help.status,0,help.stderr);assert.equal(JSON.parse(help.stdout).data.appVersion,'0.9.0');
 const shown=command(['skill','show','--json']);assert.equal(shown.status,0,shown.stderr);assert.equal(JSON.parse(shown.stdout).data.text,await readFile(path.join(source,'skills/shiqu/SKILL.md'),'utf8'));
 const port=await freeStartupPort(),library=path.join(f.root,'library'),settings={...defaultSystemSettings(library),port,provider:'readonly',providerConfigured:true},desktop=path.join(root,'dist/server/desktop.js');
 async function start(action){
  const child=spawn(binary,[desktop],{cwd:root,env,stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);const exit=once(child,'exit');
  async function stop(){if(child.exitCode===null&&child.signalCode===null){child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await exit;}finally{clearTimeout(timer);}}}
  f.defer(stop);child.stdin.write(JSON.stringify({action,settings,key:''})+'\n');
  return {child,exit,stop,output:()=>output,errors:()=>errors};
 }
 const skill=path.join(f.home,'.agents/skills/shiqu/SKILL.md');
 for(const action of ['test','upgrade']){const run=await start(action);await run.exit;assert.equal(run.child.exitCode,0,run.errors());assert.equal(await exists(skill),false);}
 let run=await start('start');await until(()=>run.output().includes('"agentSkill"')||run.child.exitCode!==null);assert.equal(run.child.exitCode,null,run.output()+run.errors());
 const status=run.output().trim().split('\n').map(line=>JSON.parse(line)).find(value=>value.agentSkill);assert.equal(status.agentSkill.status,'installed');assert.equal((await fetch(status.url)).status,200);
 const filename=path.join(path.dirname(skill),'.shiqu-runtime.json'),record=JSON.parse(await readFile(filename,'utf8')),state=JSON.parse(await readFile(path.join(path.dirname(skill),'.shiqu-skill.json'),'utf8'));
 assert.deepEqual(record.command,[await realpath(binary),await realpath(cli)]);assert.equal(createHash('sha256').update(await readFile(filename)).digest('hex'),state.runtimeSha256);
 const busy=command(['stories','list','--data-dir',library],...record.command);assert.equal(JSON.parse(busy.stdout).error.code,'LIBRARY_BUSY');
 await run.stop();
 for(const args of [['catalog'],['stories','list','--data-dir',library]]){const result=command(args,...record.command);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);}
 const metadata=await readFile(filename,'utf8');run=await start('start');await until(()=>run.output().includes('"agentSkill"')||run.child.exitCode!==null);assert.equal(run.child.exitCode,null,run.errors());assert.equal(await readFile(filename,'utf8'),metadata);await run.stop();
});
