// 原生控制台通过私有 stdin 传入设置库位置与启动覆盖，保存的生成设置用于下一任务。
// 先完成书库升级再启动服务；退出撤销远程访问并在释放所有权前停止生成。
import path from 'node:path';
import {ensureAgentSkill} from './agent-skill.ts';
import type {AgentSkillStatus} from './agent-skill.ts';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {z} from 'zod';
import {realpathSync} from 'node:fs';
import {createApplication} from './app.ts';
import {createHttpServer} from './http.ts';
import {desktopAccess} from './desktop-access.ts';
import {ensureLibraryReady,libraryUpgradeBackup} from './library-upgrade.ts';
import {ownDesktopData} from './desktop-owner.ts';
import {phoneUrls} from './phone-access.ts';
import {desktopRemote} from './desktop-remote.ts';
import {startDesktopTunnel,TunnelError} from './desktop-tunnel.ts';
import {createReaderProvider} from './generation.ts';
import {stopCodexProcesses} from './codex-runner.ts';
import {stopClaudeProcesses} from './claude-runner.ts';
import {FileMedia} from './media.ts';
import {systemSettingsSchema,settingsVariables} from '../lib/system-settings.ts';
import {SystemSettingsStore} from './system-settings.ts';
import {effectiveProviderVariables,providerReady} from './cli-setup.ts';
import {browserProviderSettings} from './browser-provider-settings.ts';
import {providerSettingsPath} from '../lib/provider-settings.ts';
import {checkProviderVariables,runtimeConfiguration} from './provider-runtime.ts';
import {installDiagnostics,recordDiagnostic,safeErrorCode} from './diagnostics.ts';

export const desktopSettings=systemSettingsSchema;
export type DesktopSettings=z.infer<typeof desktopSettings>;
export function desktopVariables(settings:DesktopSettings,key:string,imageKey=''){return settingsVariables(systemSettingsSchema.parse(settings),key,imageKey);}
// 兼容现有原生测试入口；连接检查复用浏览器的元数据检查实现。
export async function testDesktopProvider(settings:DesktopSettings,key:string,_root:string,transport:typeof fetch=fetch,imageKey=''){
 return checkProviderVariables(desktopVariables(settings,key,imageKey),transport);
}
export function desktopProviderConfiguration(settings:DesktopSettings,key:string,imageKey:string,settingsFile?:string,overrides:Record<string,string|undefined>={}){
 if(!settingsFile)return {variables:desktopVariables(settings,key,imageKey)};
 if(!path.isAbsolute(settingsFile))throw Error('SETTINGS_STORE_UNAVAILABLE');
 const store=new SystemSettingsStore(settingsFile,settings.dataDirectory,{existingOnly:true});
 try{return {variables:effectiveProviderVariables(store,overrides),locations:{settings:settingsFile,library:settings.dataDirectory}};}finally{store.close();}
}
export async function startDesktop(settings:DesktopSettings,key:string,root:string,options:{signal?:AbortSignal;onStatus?:(status:unknown)=>void;imageKey?:string;settingsFile?:string;overrides?:Record<string,string|undefined>;transport?:typeof fetch;installAgentSkill?:boolean}={}){
 options.onStatus?.({running:false,phoneUrls:[],state:'upgrading'});
 const upgrade=ensureLibraryReady(settings.dataDirectory,root);
 const backup=upgrade?.backup||libraryUpgradeBackup(settings.dataDirectory);
 options.onStatus?.({running:false,phoneUrls:[],state:'starting',backup});
 const configuration=desktopProviderConfiguration(settings,key,options.imageKey||'',options.settingsFile,options.overrides);
 const release=await ownDesktopData(settings.dataDirectory);
 const removeDiagnostics=installDiagnostics(settings.dataDirectory);
 let app:ReturnType<typeof createApplication>|undefined,server:ReturnType<typeof createHttpServer>|undefined,remoteServer:ReturnType<typeof createHttpServer>|undefined,tunnel:Awaited<ReturnType<typeof startDesktopTunnel>>|undefined;
 let stopped:Promise<void>|undefined,monitor:ReturnType<typeof setInterval>|undefined;
 const remote=desktopRemote(request=>app!.handle(request));
 async function close(listener:typeof server){if(!listener)return;await new Promise<void>(resolve=>{listener.close(()=>resolve());listener.closeAllConnections();});}
 function stop(){return stopped??=(async()=>{try{clearInterval(monitor);remote.revoke();await tunnel?.stop();app?.stopGeneration();await Promise.all([stopCodexProcesses(),stopClaudeProcesses()]);await Promise.all([close(remoteServer),close(server)]);await app?.close();}finally{recordDiagnostic(settings.dataDirectory,'service_stopped');removeDiagnostics();await release();}})();}
 try{
  options.signal?.throwIfAborted();
  const providerSettings=configuration.locations?browserProviderSettings({variables:configuration.variables,overrides:options.overrides||{},live:true,ports:[settings.port],locations:configuration.locations,existingOnly:true,transport:options.transport}):undefined;
  app=createApplication({root,dataDirectory:settings.dataDirectory,variables:configuration.variables,providerVariables:providerSettings?()=>providerSettings.variables():undefined,production:{autoStart:!!providerSettings||providerReady(configuration.variables)},transport:options.transport});
  const local=`http://127.0.0.1:${settings.port}`,phones=phoneUrls('0.0.0.0',settings.port);
  const access=desktopAccess(app.handle,{hosts:[new URL(local).host,`localhost:${settings.port}`,...phones.map(url=>new URL(url).host)]});
  const localHandle:Parameters<typeof createHttpServer>[0]=(request,peer)=>new URL(request.url).pathname===providerSettingsPath&&providerSettings?providerSettings(request,peer):access.handle(request);
  // macOS 允许通配绑定与已占用回环端口共存，先探测本机地址，防止打开其他服务。
  server=createHttpServer(localHandle);server.listen(settings.port,'127.0.0.1');await once(server,'listening');await close(server);
  server=createHttpServer(localHandle);server.listen(settings.port,'0.0.0.0');await once(server,'listening');
  const status:{running:boolean;state:string;pid:number;url:string;phoneUrls:string[];publicUrl:string;internetError:string;backup:typeof backup;agentSkill?:AgentSkillStatus}={running:true,state:'running',pid:process.pid,url:local,phoneUrls:phones,publicUrl:'',internetError:'',backup};
  function snapshot(){
   let provider;try{provider=providerSettings?.snapshot();}catch{return {...status,provider:runtimeConfiguration(configuration.variables),generating:app!.generating,settingsError:'无法读取共享生成设置，请检查本机配置后重试。'};}
   return {...status,provider:runtimeConfiguration(configuration.variables),generating:app!.generating,...(provider?{provider:provider.runtime,restartRequired:provider.restartRequired,overrides:provider.overrides}:{})};
  }
  if(settings.internetEnabled){
   try{
    remoteServer=createHttpServer(remote.handle);remoteServer.listen(0,'127.0.0.1');await once(remoteServer,'listening');
    const address=remoteServer.address();if(!address||typeof address==='string')throw Error('TUNNEL_LISTENER');
    tunnel=await startDesktopTunnel(`http://127.0.0.1:${address.port}`,settings.cloudflaredPath,{signal:options.signal});
    options.signal?.throwIfAborted();status.publicUrl=remote.activate(tunnel.origin);
    void tunnel.closed.then(async()=>{
     remote.revoke();status.publicUrl='';
     if(!stopped){status.internetError='公网隧道已断开，本机和局域网仍可使用。停止并重新启动服务以重试。';options.onStatus?.(snapshot());}
     await close(remoteServer);await tunnel?.stop();
    });
   }catch(error){
    // 公网可选，失败只清理隧道；父进程关闭仍交由外层释放完整运行时。
    if(options.signal?.aborted)throw error;
    remote.revoke();await tunnel?.stop();await close(remoteServer);remoteServer=undefined;
    status.internetError=(error instanceof TunnelError?error.message:'公网隧道启动失败。')+' 本机和局域网仍可使用，无需配对 ID。';
   }
  }
  options.signal?.throwIfAborted();recordDiagnostic(settings.dataDirectory,'service_started');
  if(options.installAgentSkill)status.agentSkill=await ensureAgentSkill(root,{runtime:{node:process.execPath,cli:path.join(root,'dist/server/agent-cli.js')}});
  monitor=setInterval(()=>options.onStatus?.(snapshot()),1000);monitor.unref();
  return {server,get status(){return snapshot();},stop};
 }catch(error){recordDiagnostic(settings.dataDirectory,'service_start_failed',{code:safeErrorCode(error)});await stop();throw error;}
}
export function desktopFailure(error:unknown){
 if(error instanceof TunnelError)return error.message;
 const failure=error as (NodeJS.ErrnoException&{port?:number})|undefined;
 const code=failure?.code,message=failure?.message;
 if(code==='EADDRINUSE')return '端口已被占用，请更换端口或停止其他实例。';
 if(message&&/^(LIBRARY_|BACKUP_|DATA_BUSY:)/.test(message)){
  const code=message.split(/[;: ]/)[0],backup=message.match(/(?:^|; )backup: ([^;]+)/)?.[1];
  return `${code}：书库暂时无法升级或打开，请保留现有书库并检查备份。${backup?' 备份：'+backup:''}`;
 }
 if(message==='SETTINGS_STORE_UNAVAILABLE')return '无法读取共享生成设置，请检查本机配置后重试。';
 if(message==='DATA_BUSY')return '此数据目录仍由另一个 CLI 或桌面服务使用，请等待它退出或选择其他目录。';
 if(code==='EACCES'||code==='EPERM'){
  if(failure?.syscall==='listen'){
   const port=failure.port;
   const label=typeof port==='number'&&Number.isInteger(port)&&port>=1&&port<=65535?`端口 ${port}`:'服务端口';
   return `无法监听${label}，该端口可能被系统保留或被其他程序独占。请在「本机与存储」中更换服务端口后重试。`;
  }
  return '无法访问所选文件或数据目录，请检查权限。';
 }
 return '服务启动失败。请确认 Node 24、应用资源和数据目录可用。';
}
async function main(){
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 const abort=new AbortController();
 let runtime:Awaited<ReturnType<typeof startDesktop>>|undefined,starting=false,closing=false,inputClosed=false;
 const send=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
 async function stop(){if(closing)return;closing=true;if(runtime)await runtime.stop();else await Promise.all([stopCodexProcesses(),stopClaudeProcesses()]);process.exit(0);}
 lines.on('close',()=>{inputClosed=true;abort.abort();if(!starting)void stop();});
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{abort.abort();if(!starting)void stop();});
 process.on('exit',()=>{void stopCodexProcesses();void stopClaudeProcesses();});
 // 丢弃原始异常及提供方输出，父进程只接收安全状态。
 process.on('uncaughtException',()=>{send({error:'服务意外退出，请重新启动。'});void stop();});
 lines.on('line',line=>{
  if(line.length>20000){void stop();return;}
  if(runtime){try{if(JSON.parse(line).action==='stop')void stop();}catch{void stop();}return;}
  if(starting||closing)return;starting=true;
  void(async()=>{
   try{
    const input=z.object({action:z.enum(['start','test','upgrade']),settings:desktopSettings,key:z.string().max(4096).default(''),imageKey:z.string().max(4096).default(''),settingsFile:z.string().optional(),overrides:z.record(z.string()).default({})}).strict().parse(JSON.parse(line));
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    if(input.action==='upgrade'){ensureLibraryReady(input.settings.dataDirectory,root);send({upgraded:true,started:false,backup:libraryUpgradeBackup(input.settings.dataDirectory)});await stop();return;}
    if(input.action==='test'){send(await testDesktopProvider(input.settings,input.key,root,fetch,input.imageKey));await stop();return;}
    runtime=await startDesktop(input.settings,input.key,root,{signal:abort.signal,onStatus:send,imageKey:input.imageKey,settingsFile:input.settingsFile,overrides:input.overrides,installAgentSkill:true});starting=false;
    if(inputClosed){await stop();return;}
    send(runtime.status);
   }catch(error){send({running:false,state:'failed',phoneUrls:[],error:desktopFailure(error)});starting=false;await stop();}
  })();
 });
 const timer=setTimeout(()=>{if(!runtime&&!starting)void stop();},10000);timer.unref();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)void main();
