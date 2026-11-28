// 原生控制台通过私有 stdin 传入设置库位置与启动覆盖，保存的生成设置用于下一任务。
// 先完成书库升级再启动服务；退出撤销远程访问并在释放所有权前停止生成。
import path from 'node:path';
import {ensureAgentSkill} from './agent-skill.ts';
import type {AgentSkillStatus} from './agent-skill.ts';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {isIP} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {createApplication} from './app.ts';
import {createHttpServer} from './http.ts';
import {desktopAccess} from './desktop-access.ts';
import {ensureLibraryReady,libraryUpgradeBackup} from './library-upgrade.ts';
import {desktopOwner,ownerProcessExists,ownDesktopData} from './desktop-owner.ts';
import {desktopServiceControl,requestDesktopService,serviceVersion,startCliService} from './cli-service.ts';
import {canonicalPath} from './library-backup.ts';
export {runCliServiceProcess} from './cli-service.ts';
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
import {desktopBackupError,runDesktopBackupCommand} from './desktop-backups.ts';

export const desktopSettings=systemSettingsSchema;
export type DesktopSettings=z.infer<typeof desktopSettings>;
export const desktopStartRequest=z.object({action:z.enum(['start','test','upgrade']),settings:desktopSettings,key:z.string().max(4096).default(''),imageKey:z.string().max(4096).default(''),settingsFile:z.string().optional(),overrides:z.record(z.string()).default({})}).strict();
type DesktopStart=z.infer<typeof desktopStartRequest>;
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
export async function startDesktop(settings:DesktopSettings,key:string,root:string,options:{signal?:AbortSignal;onStatus?:(status:unknown)=>void;imageKey?:string;settingsFile?:string;overrides?:Record<string,string|undefined>;transport?:typeof fetch;installAgentSkill?:boolean;existingCli?:Awaited<ReturnType<typeof startCliService>>}={}){
 options.onStatus?.({running:false,phoneUrls:[],state:'upgrading'});
 const upgrade=ensureLibraryReady(settings.dataDirectory,root);
 const backup=upgrade?.backup||libraryUpgradeBackup(settings.dataDirectory);
 options.onStatus?.({running:false,phoneUrls:[],state:'starting',backup});
 const configuration=desktopProviderConfiguration(settings,key,options.imageKey||'',options.settingsFile,options.overrides);
 const release=options.existingCli?()=>{}:await ownDesktopData(settings.dataDirectory);
 const removeDiagnostics=installDiagnostics(settings.dataDirectory);
 let app:ReturnType<typeof createApplication>|undefined,server:ReturnType<typeof createHttpServer>|undefined,remoteServer:ReturnType<typeof createHttpServer>|undefined,tunnel:Awaited<ReturnType<typeof startDesktopTunnel>>|undefined;
 let cli=options.existingCli;
 let stopped:Promise<void>|undefined,monitor:ReturnType<typeof setInterval>|undefined;
 const remote=desktopRemote(request=>app!.handle(request));
 async function close(listener:typeof server){if(!listener)return;await new Promise<void>(resolve=>{listener.close(()=>resolve());listener.closeAllConnections();});}
 function stop(closeCli=!options.existingCli){return stopped??=(async()=>{try{clearInterval(monitor);remote.revoke();app?.interruptWork();await Promise.all([tunnel?.stop(),stopCodexProcesses(),stopClaudeProcesses()]);await Promise.all([closeCli?cli?.close():undefined,close(remoteServer),close(server)]);await app?.close();}finally{recordDiagnostic(settings.dataDirectory,'service_stopped');removeDiagnostics();await release();}})();}
 try{
  options.signal?.throwIfAborted();
  const providerSettings=configuration.locations?browserProviderSettings({variables:configuration.variables,overrides:options.overrides||{},live:true,ports:[settings.port],locations:configuration.locations,existingOnly:true,transport:options.transport}):undefined;
  app=createApplication({root,dataDirectory:settings.dataDirectory,variables:configuration.variables,providerVariables:providerSettings?()=>providerSettings.variables():undefined,snapshotVariables:providerSettings?snapshot=>providerSettings.variablesForSnapshot(snapshot):undefined,production:{autoStart:!!providerSettings||providerReady(configuration.variables)},transport:options.transport});
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
  // 停止请求：空闲时立即停止；有进行中的工作时进入等候，状态为 stopping。
  const prepareStop=()=>{const drain=cli!.drain();if(!drain.idle)status.state='stopping';return drain;};
  if(!cli)cli=await startCliService(root,settings.dataDirectory,{application:app,desktop:desktopServiceControl(root,snapshot,prepareStop,()=>{void stop();})});
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
  return {server,application:app,get status(){return snapshot();},stop,prepareStop};
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

// 控制台沿用 stdin；对已有服务只转发认证控制，断流不终止它。
async function attachDesktop(root:string,input:DesktopStart,signal:AbortSignal){
 try{if(lstatSync(input.settings.dataDirectory).isSymbolicLink())throw Error('LIBRARY_UNSAFE_DIRECTORY');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const directory=canonicalPath(input.settings.dataDirectory),version=serviceVersion(root),owner=desktopOwner(directory);
 if(!owner?.service||!ownerProcessExists(owner.pid))return;
 const request=(action:'attach'|'promote'|'status'|'stop'|'force',options:AbortSignal=AbortSignal.timeout(2000))=>
  requestDesktopService(owner,{action,version,...(action==='promote'?{start:input}:{})},options);
 const attach=await request('attach',AbortSignal.any([signal,AbortSignal.timeout(2000)])).catch(()=>undefined);
 if(!attach)return;
 if(typeof attach.error==='string')return {error:attach.error};
 const status=attach.promote===true?await request('promote',signal):attach;
 if(typeof status?.error==='string')return {error:status.error};
 if(!status||status.running!==true||status.pid!==owner.pid||typeof status.url!=='string')throw Error('DATA_BUSY');
 const url=new URL(status.url);
 if(url.protocol!=='http:'||!isIP(url.hostname.replace(/^\[|\]$/g,''))||url.pathname!=='/'||url.href!==url.origin+'/')throw Error('DATA_BUSY');
 return {owner,directory,request,status:{...status,attached:true}};
}

export async function runDesktopControl(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')){
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 const abort=new AbortController();
 type Attached=Exclude<Awaited<ReturnType<typeof attachDesktop>>,undefined|{error:string}>;
 let runtime:Awaited<ReturnType<typeof startDesktop>>|undefined,attached:Attached|undefined,starting=false,closing=false,inputClosed=false;
 let monitor:ReturnType<typeof setInterval>|undefined,polling=false,stopRequests=0,stopAccepted=false,missed=0;
 let attachedSkill:AgentSkillStatus|undefined;
 const send=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
 // 正常停止以 0 退出；异常或停止失败以非零码退出，桌面据此区分等候中的崩溃。
 async function stop(code=0){
  if(code)process.exitCode=code;
  if(closing)return;closing=true;
  clearInterval(monitor);
  try{if(runtime)await runtime.stop();else await Promise.all([stopCodexProcesses(),stopClaudeProcesses()]);}catch{process.exitCode=1;}
  process.exit(Number(process.exitCode??0));
 }
 lines.on('close',()=>{inputClosed=true;abort.abort();if(!starting&&!stopRequests&&!stopAccepted)void stop();});
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{abort.abort();if(!starting)void stop();});
 process.on('exit',()=>{void stopCodexProcesses();void stopClaudeProcesses();});
 // 丢弃原始异常及提供方输出，父进程只接收安全状态。
 process.on('uncaughtException',()=>{send({error:'服务意外退出，请重新启动。'});void stop(1);});
 async function pollAttached(){
  if(!attached||closing||polling||stopRequests)return;
  polling=true;
  try{
   const owner=desktopOwner(attached.directory);
   if(!owner||owner.id!==attached.owner.id||!ownerProcessExists(owner.pid)){
    if(stopAccepted&&!owner){await stop();return;}
    send({error:'书库服务已断开，请重新启动。'});await stop(1);return;
   }
   const status=await attached.request('status').catch(()=>undefined);
   if(status?.running===true&&status.pid===attached.owner.pid){missed=0;send({...status,attached:true,agentSkill:attachedSkill});}
   else if(!stopAccepted&&++missed>=3){send({error:'书库服务已断开，请重新启动。'});await stop(1);}
  }finally{polling=false;}
 }
 lines.on('line',line=>{
  if(line.length>20000){void stop();return;}
  if(attached){
   let command;try{command=JSON.parse(line);}catch{void stop(1);return;}
   if(command.action!=='stop'&&command.action!=='shutdown')return;
   stopRequests++;
   void attached.request(command.action==='shutdown'?'force':'stop').catch(()=>undefined).then(reply=>{
    const accepted=reply?.accepted===true;
    stopAccepted||=accepted;stopRequests--;
    if(command.action==='stop')send({stopReply:command.requestId,accepted,draining:reply?.draining===true});
    if(stopAccepted)void pollAttached();
    else if(inputClosed||command.action==='shutdown'){send({error:'无法确认书库服务已停止。'});void stop(1);}
   });
   return;
  }
  if(runtime){
   try{
    const command=JSON.parse(line);
    if(command.action==='stop'&&Number.isSafeInteger(command.requestId)&&command.requestId>0){
     const {idle,settled}=runtime.prepareStop();
     send({stopReply:command.requestId,accepted:true,draining:!idle});
     if(idle)void stop();else void settled.then(()=>stop());
    }else if(command.action==='shutdown')void stop();
   }catch{void stop();}
   return;
  }
  if(starting||closing)return;starting=true;
  void(async()=>{
   try{
    const input=desktopStartRequest.parse(JSON.parse(line));
    if(input.action==='upgrade'){ensureLibraryReady(input.settings.dataDirectory,root);send({upgraded:true,started:false,backup:libraryUpgradeBackup(input.settings.dataDirectory)});await stop();return;}
    if(input.action==='test'){send(await testDesktopProvider(input.settings,input.key,root,fetch,input.imageKey));await stop();return;}
    const heartbeat=setInterval(()=>send({running:false,state:'starting',phoneUrls:[]}),1000);
    let existing:Awaited<ReturnType<typeof attachDesktop>>;
    try{existing=await attachDesktop(root,input,abort.signal);}finally{clearInterval(heartbeat);}
    if(existing&&'error' in existing){send({running:false,state:'failed',phoneUrls:[],error:existing.error});starting=false;await stop();return;}
    if(existing){
     attached=existing;
     attachedSkill=await ensureAgentSkill(root,{runtime:{node:process.execPath,cli:path.join(root,'dist/server/agent-cli.js')}});
     starting=false;
     if(inputClosed){await stop();return;}
     send({...attached.status,agentSkill:attachedSkill});
     monitor=setInterval(()=>void pollAttached(),300);
     return;
    }
    runtime=await startDesktop(input.settings,input.key,root,{signal:abort.signal,onStatus:send,imageKey:input.imageKey,settingsFile:input.settingsFile,overrides:input.overrides,installAgentSkill:true});starting=false;
    if(inputClosed){await stop();return;}
    send(runtime.status);
   }catch(error){send({running:false,state:'failed',phoneUrls:[],error:desktopFailure(error)});starting=false;await stop();}
  })();
 });
 const timer=setTimeout(()=>{if(!runtime&&!starting)void stop();},10000);timer.unref();
}
async function backupMain(){
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of lines){
  try{
   if(line.length>40000)throw Error('BACKUP_INVALID');
   const root=process.cwd();
   const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
   const result=await runDesktopBackupCommand(root,version,JSON.parse(line));
   process.stdout.write(JSON.stringify({result})+'\n');
  }catch(error){process.stdout.write(JSON.stringify({error:desktopBackupError(error)})+'\n');}
  finally{lines.close();}
  return;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 if(process.argv[2]==='--library-maintenance')void backupMain();else void runDesktopControl();
}
