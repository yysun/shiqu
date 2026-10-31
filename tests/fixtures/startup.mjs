// Own disposable CLI homes and runtime roots. Never inherit user configuration or provider credentials.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {desktopLibraryPaths} from '../../server/library-directory.ts';
import {SystemSettingsStore} from '../../server/system-settings.ts';

export async function startupFixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-startup-test-')),home=path.join(root,'home');
 const cleanups=[];
 t.after(async()=>{try{for(const cleanup of cleanups.reverse())await cleanup();}finally{await rm(root,{recursive:true,force:true});}});
 await mkdir(home);await cp(new URL('../../drizzle/',import.meta.url),path.join(root,'drizzle'),{recursive:true});
 await mkdir(path.join(root,'docker'));await cp(new URL('../../docker/seed.sql',import.meta.url),path.join(root,'docker/seed.sql'));
 await mkdir(path.join(root,'dist/client'),{recursive:true});await writeFile(path.join(root,'dist/client/index.html'),'<html>isolated startup fixture</html>');
 await writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.0.0-test'}));
 const env={PATH:path.dirname(process.execPath),HOME:home,USERPROFILE:home,APPDATA:path.join(home,'roaming'),LOCALAPPDATA:path.join(home,'local'),XDG_CONFIG_HOME:path.join(home,'config'),XDG_DATA_HOME:path.join(home,'data'),LANG:'en_US.UTF-8'};
 for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TMPDIR','TMP','TEMP'])if(process.env[name])env[name]=process.env[name];
 const locations=desktopLibraryPaths({home,variables:env});
 for(const value of Object.values(locations))assert.ok(path.resolve(value).startsWith(root+path.sep),'all settings/library locations must be disposable');
 return {root,home,env,locations,defer(cleanup){cleanups.push(cleanup);},store(){
  const store=new SystemSettingsStore(locations.settings,locations.library),close=store.close.bind(store);let closed=false;
  store.close=()=>{if(!closed){closed=true;close();}};cleanups.push(()=>store.close());return store;
 }};
}
export async function freeStartupPort(){
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;
 await new Promise(resolve=>socket.close(resolve));return port;
}
export function startFixtureCli(f,args=[],variables={}){
 const source=new URL('../../server/cli.ts',import.meta.url).href;
 const program=`globalThis.fetch=async()=>{throw Error('TEST_EXTERNAL_NETWORK_DISABLED')};const {runCli}=await import(${JSON.stringify(source)});try{await runCli(process.argv[1],process.argv.slice(2))}catch(error){console.error(error.message);process.exitCode=1}`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',program,f.root,...args],{cwd:f.root,env:{...f.env,...variables},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const exit=once(child,'exit');
 async function stop(){if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await exit;}finally{clearTimeout(timer);}}
 async function ready(){
  const deadline=Date.now()+15000;
  while(!output.includes('拾趣: http://')){
   assert.ok(child.exitCode===null&&child.signalCode===null,'CLI exited before readiness: '+output);
   assert.ok(Date.now()<deadline,'CLI startup timed out: '+output);
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  return output;
 }
 async function ended(){const timer=setTimeout(()=>child.kill('SIGKILL'),15000);try{return (await exit)[0];}finally{clearTimeout(timer);}}
 f.defer(stop);
 return {child,exit,stop,ready,ended,output:()=>output};
}
export async function savedStartupState(f){
 const store=f.store();try{return {settings:store.settings(),revision:store.revision(),gemini:store.key('gemini'),openai:store.key('openai')};}finally{store.close();}
}
export async function fixtureBytes(filename){try{return await readFile(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
