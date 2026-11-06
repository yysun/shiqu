// 普通启动的用户级技能集成；只读识别宿主选择，偏好与书库/模型配置分开保存。
import path from 'node:path';
import os from 'node:os';
import {readFile,lstat,mkdir,writeFile,rename,rm,rmdir,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {parse} from 'smol-toml';
import {desktopLibraryPaths} from './library-directory.ts';
import {syncStartupSkill} from './cli-skill.ts';
import type {StartupSkillRuntime} from './cli-skill.ts';
type Context={home?:string;variables?:Record<string,string|undefined>};
export type AgentSkillStatus={status:string;path?:string;version?:string;code?:string;message?:string};
async function optional(filename:string){try{const s=await lstat(filename);if(!s.isFile()||s.isSymbolicLink()||s.size>1024*1024)throw Error('SKILL_INTEGRATION_INVALID');return await readFile(filename,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
function location(context:Context){return path.join(path.dirname(desktopLibraryPaths({home:context.home||os.homedir(),variables:context.variables||process.env}).settings),'agent-integration.json');}
async function preference(context:Context){const text=await optional(location(context));if(text===undefined)return true;let state;try{state=JSON.parse(text);}catch{throw Error('SKILL_INTEGRATION_INVALID');}if(state.schemaVersion!==1||typeof state.autoInstall!=='boolean'||Object.keys(state).some(k=>!['schemaVersion','autoInstall'].includes(k)))throw Error('SKILL_INTEGRATION_INVALID');return state.autoInstall as boolean;}
export async function agentSkillPreference(enabled:boolean|undefined,context:Context={}){
 const filename=location(context);
 if(enabled!==undefined){
  const directory=path.dirname(filename);await mkdir(directory,{recursive:true,mode:0o700});if((await lstat(directory)).isSymbolicLink())throw Error('SKILL_INTEGRATION_INVALID');
  const lock=path.join(directory,'.agent-skill-lock');await mkdir(lock,{mode:0o700});const temporary=path.join(directory,'.agent-skill-'+randomUUID()+'.tmp');
  try{await preference(context);await writeFile(temporary,JSON.stringify({schemaVersion:1,autoInstall:enabled},null,2)+'\n',{flag:'wx',mode:0o600});await optional(filename);await rename(temporary,filename);}
  finally{await rm(temporary,{force:true});await rmdir(lock);}
 }
 const autoInstall=await preference(context),override=(context.variables||process.env).SHIQU_SKILL_AUTO_INSTALL;
 if(override!==undefined&&!['on','off','1','0'].includes(override))throw Error('SKILL_INTEGRATION_INVALID');
 return {path:filename,autoInstall,effectiveAutoInstall:override===undefined?autoInstall:['on','1'].includes(override)};
}
async function hostChoice(home:string,variables:Record<string,string|undefined>){
 const text=await optional(path.join(variables.CODEX_HOME||path.join(home,'.codex'),'config.toml'));
 if(text===undefined)return undefined;
 const config=parse(text) as any;
 let enabled=true;
 const entries=config.skills?.config;
 if(entries!==undefined&&!Array.isArray(entries))throw Error('SKILL_INTEGRATION_INVALID');
 const target=path.join(home,'.agents/skills/shiqu/SKILL.md');
 for(const entry of entries||[]){
  if(entry.name==='shiqu'||typeof entry.path==='string'&&path.isAbsolute(entry.path)&&path.normalize(entry.path)===target){
   if(typeof entry.enabled!=='boolean')throw Error('SKILL_INTEGRATION_INVALID');enabled=entry.enabled;
  }
 }
 if(!enabled)return 'skill_disabled';
 if(config.plugins&&typeof config.plugins!=='object')throw Error('SKILL_INTEGRATION_INVALID');
 if(Object.entries(config.plugins||{}).some(([name,value])=>name.split('@')[0]==='shiqu'&&(value as any)?.enabled!==false))return 'plugin_managed';
 return undefined;
}
async function prepareAgentSkill(root:string,context:Context&{runtime?:StartupSkillRuntime}={}):Promise<AgentSkillStatus>{
 try{
  const variables=context.variables||process.env,home=context.home||os.homedir();
  if(!(await agentSkillPreference(undefined,{home,variables})).effectiveAutoInstall)return {status:'auto_install_disabled'};
  const choice=await hostChoice(home,variables);if(choice)return {status:choice};
  const runtime=context.runtime?{node:await realpath(context.runtime.node),cli:await realpath(context.runtime.cli)}:undefined;
  return await syncStartupSkill(root,home,runtime);
 }catch(error){const code=(error as NodeJS.ErrnoException).code;return {status:'unavailable',code:typeof code==='string'&&/^SKILL_[A-Z_]+$/.test(code)?code:'SKILL_STARTUP_UNAVAILABLE'};}
}
export async function ensureAgentSkill(root:string,context:Context&{runtime?:StartupSkillRuntime}={}):Promise<AgentSkillStatus>{const result=await prepareAgentSkill(root,context);return {...result,message:agentSkillMessage({...result,path:undefined})};}
export function agentSkillMessage(result:AgentSkillStatus){
 const messages:Record<string,string>={installed:'已安装，可在 AI 助手中使用 $shiqu',unchanged:'已就绪',updated:'已按自动更新偏好更新',update_available:'有配套更新，保留现有副本与更新偏好',newer:'保留较新的已安装版本',modified:'保留用户修改的技能',unmanaged:'保留来源未知的技能',skill_disabled:'已按助手配置停用，保持不变',plugin_managed:'由插件提供，跳过独立安装',auto_install_disabled:'自动安装已关闭',unavailable:'自动安装未完成；拾趣服务仍可使用'};
 return '拾趣技能：'+(messages[result.status]||'状态未知')+(result.path?' — '+result.path:'');
}
