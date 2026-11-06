// 管理随包技能的版本、哈希和定制保护；启动安装与显式更新复用同一生命周期。
// 检查不执行发布包，桌面运行时记录也保留受管哈希保护。
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,lstat,mkdir,writeFile,rename,rm,rmdir} from 'node:fs/promises';

const stateName='.shiqu-skill.json',day=86400000;
type State={schemaVersion:1;source:'@apprun/shiqu';version:string;sha256:string;autoUpdate:boolean;runtimeSha256?:string};
type Cache={status:'ok'|'unavailable';checkedAt:number;latestVersion?:string};
export type SkillContext={cwd?:string;home?:string;variables?:Record<string,string|undefined>;transport?:typeof fetch;now?:()=>number};
type Location={base:string;scope:'project'|'global';directory:string};
function fail(code:string,message:string):never{throw Object.assign(new Error(`${code}: ${message}`),{code});}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const version=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(v);
function compare(a:string,b:string){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;}
async function info(filename:string){try{return await lstat(filename);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
async function safeFile(filename:string){const entry=await info(filename);if(entry&&(entry.isSymbolicLink()||!entry.isFile()))fail('SKILL_UNSAFE_PATH','Expected a regular file.');return entry;}
async function directories(base:string,parts:string[],create=false){
 let directory=path.resolve(base);
 for(const part of parts){
  directory=path.join(directory,part);
  if(create)try{await mkdir(directory,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const entry=await info(directory);if(!entry)return null;
  if(entry.isSymbolicLink()||!entry.isDirectory())fail('SKILL_UNSAFE_PATH','Expected a real directory.');
 }
 return directory;
}
async function location(base:string,scope:Location['scope'],create=false):Promise<Location|null>{const directory=await directories(base,['.agents','skills','shiqu'],create);return directory?{base:path.resolve(base),scope,directory}:null;}
async function locate(scope:string|undefined,context:SkillContext){
 const cwd=path.resolve(context.cwd||process.cwd()),home=path.resolve(context.home||os.homedir());
 if(scope)return location(scope==='global'?home:cwd,scope as Location['scope']);
 let base=cwd;
 while(true){const found=await location(base,'project');if(found&&await safeFile(path.join(found.directory,'SKILL.md')))return found;if(await info(path.join(base,'.git'))||path.dirname(base)===base)break;base=path.dirname(base);}
 return location(home,'global');
}
async function locked<T>(directory:string,work:()=>Promise<T>){
 const lock=path.join(directory,'.update-lock');
 try{await mkdir(lock,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')fail('SKILL_BUSY','Another skill operation is active; retry later. Remove .update-lock only after confirming no operation is running.');throw error;}
 try{return await work();}finally{await rmdir(lock);}
}
async function atomic(filename:string,text:string){
 const temporary=path.join(path.dirname(filename),`.shiqu-${randomUUID()}.tmp`);
 try{await writeFile(temporary,text,{flag:'wx',mode:0o600});await safeFile(filename);await rename(temporary,filename);}finally{await rm(temporary,{force:true});}
}
async function stateAt(directory:string):Promise<State|null>{
 const filename=path.join(directory,stateName);if(!await safeFile(filename))return null;
 let s:State;try{s=JSON.parse(await readFile(filename,'utf8'));}catch{fail('SKILL_STATE_INVALID','Installation state is not valid JSON.');}
 if(!s||s.schemaVersion!==1||s.source!=='@apprun/shiqu'||!version(s.version)||typeof s.autoUpdate!=='boolean'||typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256))fail('SKILL_STATE_INVALID','Unsupported installation state; preserve it and inspect before updating.');
 if(s.runtimeSha256!==undefined&&(typeof s.runtimeSha256!=='string'||!/^[a-f0-9]{64}$/.test(s.runtimeSha256)))fail('SKILL_STATE_INVALID','Invalid runtime installation hash.');
 return {schemaVersion:1,source:s.source,version:s.version,sha256:s.sha256,autoUpdate:s.autoUpdate,...(s.runtimeSha256?{runtimeSha256:s.runtimeSha256}:{})};
}
async function saveState(directory:string,state:State){await atomic(path.join(directory,stateName),JSON.stringify(state,null,2)+'\n');}
export async function bundledSkill(root:string){return readFile(path.join(root,'skills/shiqu/SKILL.md'),'utf8');}
async function bundle(root:string){const text=await bundledSkill(root),v=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;if(!version(v))fail('SKILL_VERSION_INVALID','A stable package version is required.');return {text,version:v,sha256:digest(text)};}
export async function installSkill(root:string,base=process.cwd()){
 const bundled=await bundle(root),found=(await location(base,'project',true))!;
 return locked(found.directory,async()=>{
  const filename=path.join(found.directory,'SKILL.md'),existing=await safeFile(filename),state=await stateAt(found.directory);
  if(existing&&await readFile(filename,'utf8')!==bundled.text)fail('SKILL_EXISTS','Existing instructions differ; review or use skill update for a managed, unchanged copy.');
  if(state&&(compare(bundled.version,state.version)<0||state.sha256!==bundled.sha256))fail('SKILL_MODIFIED','Installation state differs; use its matching CLI or inspect local changes.');
  if(!existing&&state)fail('SKILL_STATE_INVALID','Instructions are missing from a managed installation.');
  if(!existing)await writeFile(filename,bundled.text,{flag:'wx',mode:0o600});
  if(!state)await saveState(found.directory,{schemaVersion:1,source:'@apprun/shiqu',version:bundled.version,sha256:bundled.sha256,autoUpdate:false});
  return {path:filename,installed:!existing,unchanged:!!existing};
 });
}
async function latest(context:SkillContext,refresh:boolean){
 const now=(context.now||Date.now)(),home=path.resolve(context.home||os.homedir());
 const base=context.variables?.XDG_CACHE_HOME?path.resolve(context.variables.XDG_CACHE_HOME):home;
 const parts=context.variables?.XDG_CACHE_HOME?['shiqu']:['.cache','shiqu'];
 let directory:string|null=null,cache:Cache|undefined;
 try{
  directory=await directories(base,parts);const filename=directory&&path.join(directory,'skill-version.json');
  if(filename&&await safeFile(filename)){
   const c=JSON.parse(await readFile(filename,'utf8'));
   if(c&&Number.isFinite(c.checkedAt)&&c.checkedAt<=now){
    if(c.status==='ok'&&version(c.latestVersion))cache={status:'ok',checkedAt:c.checkedAt,latestVersion:c.latestVersion};
    else if(c.status==='unavailable')cache={status:'unavailable',checkedAt:c.checkedAt};
   }
  }
 }catch{/* A cache cannot grant update authority; unreadable caches are simply ignored. */}
 if(!refresh&&cache&&now-cache.checkedAt<(cache.status==='ok'?day:300000))return {...cache,cached:true};
 let fresh:Cache;
 try{
  const response=await (context.transport||fetch)('https://registry.npmjs.org/@apprun%2fshiqu/latest',{signal:AbortSignal.timeout(5000),redirect:'error',headers:{Accept:'application/json'}});
  if(!response.ok||!response.body)throw Error('registry unavailable');
  const reader=response.body.getReader();let text='',size=0;const decoder=new TextDecoder();
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('registry response too large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}
  const release=JSON.parse(text);if(release.name!=='@apprun/shiqu'||!version(release.version))throw Error('invalid release');
  fresh={status:'ok',checkedAt:now,latestVersion:release.version};
 }catch{fresh={status:'unavailable',checkedAt:now};}
 try{if(context.variables?.XDG_CACHE_HOME)await mkdir(base,{recursive:true,mode:0o700});directory=await directories(base,parts,true);await atomic(path.join(directory!,'skill-version.json'),JSON.stringify(fresh)+'\n');}catch{/* Offline/read-only homes must not block the user's story task. */}
 return {...fresh,cached:false};
}
export async function checkSkill(root:string,scope:string|undefined,options:{autoUpdate?:boolean;refresh?:boolean},context:SkillContext={}){
 const found=await locate(scope,context),bundled=await bundle(root);
 if(!found||!await safeFile(path.join(found.directory,'SKILL.md')))return {status:'not_installed',appVersion:bundled.version,autoUpdateReady:false};
 const local=await locked(found.directory,async()=>{
  const filename=path.join(found.directory,'SKILL.md');await safeFile(filename);const text=await readFile(filename,'utf8'),state=await stateAt(found.directory);
  if(options.autoUpdate!==undefined){if(!state)fail('SKILL_UNMANAGED','Run matching-version skill install to record an unchanged legacy copy first.');state.autoUpdate=options.autoUpdate;await saveState(found.directory,state);}
  return {state,modified:!!state&&state.sha256!==digest(text)};
 });
 const registry=await latest(context,!!options.refresh),installedVersion=local.state?.version||null;
 const targetVersion=registry.status==='ok'&&version(registry.latestVersion)?registry.latestVersion:undefined;
 const updateAvailable=!!(installedVersion&&targetVersion&&compare(targetVersion,installedVersion)>0);
 const allowed=!!local.state&&!local.modified,updateCommand=allowed&&updateAvailable?['npx','--yes',`@apprun/shiqu@${targetVersion}`,'skill','update','--scope',found.scope,...(local.state?.autoUpdate?['--automatic']:[])]:null;
 return {status:local.state?(local.modified?'modified':'managed'):'unmanaged',path:path.join(found.directory,'SKILL.md'),scope:found.scope,appVersion:bundled.version,installedVersion,autoUpdate:local.state?.autoUpdate||false,modified:local.modified,registry,updateAvailable,updateCommand,updateCwd:found.base,autoUpdateReady:!!(updateCommand&&local.state?.autoUpdate)};
}
export async function updateSkill(root:string,scope:string,context:SkillContext={},automatic=false){
 const found=await locate(scope,context);if(!found)fail('SKILL_NOT_INSTALLED','Install the skill in this scope first.');const bundled=await bundle(root);
 return locked(found.directory,async()=>{
  const filename=path.join(found.directory,'SKILL.md');if(!await safeFile(filename))fail('SKILL_NOT_INSTALLED','Install the skill in this scope first.');
  const text=await readFile(filename,'utf8');let state=await stateAt(found.directory);
  if(automatic&&!state?.autoUpdate)fail('SKILL_AUTO_UPDATE_DISABLED','Automatic update permission is not enabled.');
  if(!state){if(text!==bundled.text)fail('SKILL_UNMANAGED','Unknown or edited instructions must be reviewed and merged manually.');state={schemaVersion:1,source:'@apprun/shiqu',version:bundled.version,sha256:bundled.sha256,autoUpdate:false};}
  if(digest(text)!==state.sha256)fail('SKILL_MODIFIED','Local instructions changed; preserve and merge them manually.');
  if(compare(bundled.version,state.version)<0)fail('SKILL_DOWNGRADE','Use the installed version or a newer stable CLI.');
  if(await readFile(filename,'utf8')!==text)fail('SKILL_MODIFIED','Instructions changed during update.');
  if(text!==bundled.text)await atomic(filename,bundled.text);
  await saveState(found.directory,{...state,version:bundled.version,sha256:bundled.sha256});
  return {path:filename,scope,version:bundled.version,previousVersion:state.version,updated:text!==bundled.text||state.version!==bundled.version,autoUpdate:state.autoUpdate};
 });
}

// 启动只补齐缺失副本；正文变更仍遵循已保存的自动更新授权。
export type StartupSkillRuntime={node:string;cli:string};
export async function syncStartupSkill(root:string,home:string,runtime?:StartupSkillRuntime){
 const bundled=await bundle(root);let found=await location(home,'global'),status='unchanged';
 if(!found||!await safeFile(path.join(found.directory,'SKILL.md'))){await installSkill(root,home);found=(await location(home,'global'))!;status='installed';}
 else{
  const state=await stateAt(found.directory),text=await readFile(path.join(found.directory,'SKILL.md'),'utf8');
  const result={path:path.join(found.directory,'SKILL.md'),version:state?.version};
  if(!state)return {...result,status:'unmanaged'};
  if(digest(text)!==state.sha256)return {...result,status:'modified'};
  if(compare(state.version,bundled.version)>0)return {...result,status:'newer'};
  if(state.version!==bundled.version||state.sha256!==bundled.sha256){
   if(!state.autoUpdate)return {...result,status:'update_available'};
   await updateSkill(root,'global',{home},true);status='updated';
  }
 }
 if(runtime)await locked(found.directory,async()=>{
  if(!path.isAbsolute(runtime.node)||!path.isAbsolute(runtime.cli))fail('SKILL_RUNTIME_INVALID','Runtime paths must be absolute.');
  await safeFile(runtime.node);await safeFile(runtime.cli);
  if(!await info(runtime.node)||!await info(runtime.cli))fail('SKILL_RUNTIME_INVALID','Runtime entry is missing.');
  const state=(await stateAt(found!.directory))!,text=await readFile(path.join(found!.directory,'SKILL.md'),'utf8');
  if(state.version!==bundled.version)fail('SKILL_RUNTIME_CHANGED','A different skill version was installed; preserve its runtime.');
  if(state.sha256!==digest(text)||state.sha256!==bundled.sha256)fail('SKILL_MODIFIED','Instructions changed during runtime registration.');
  const filename=path.join(found!.directory,'.shiqu-runtime.json'),existing=await safeFile(filename);
  if(existing&&(!state.runtimeSha256||digest(await readFile(filename,'utf8'))!==state.runtimeSha256)||!existing&&state.runtimeSha256)fail('SKILL_RUNTIME_MODIFIED','Preserve the changed runtime record.');
  const saved=JSON.stringify({schemaVersion:1,source:'@apprun/shiqu/desktop',appVersion:bundled.version,command:[runtime.node,runtime.cli]},null,2)+'\n';
  if(!existing||digest(saved)!==state.runtimeSha256){await atomic(filename,saved);await saveState(found!.directory,{...state,runtimeSha256:digest(saved)});}
 });
 return {status,path:path.join(found.directory,'SKILL.md'),version:bundled.version};
}
