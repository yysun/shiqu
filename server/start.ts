// 共用 HTTP 生命周期；CLI 在生成与数据库关闭前持有书库，提供方配置只影响新任务。
import {createApplication} from './app.ts';
import {createHttpServer} from './http.ts';
import {serverConfig} from './config.ts';
import {phoneUrls,printPhoneAccess} from './phone-access.ts';
import {developmentAccess} from './development-access.ts';
import {desktopAccess} from './desktop-access.ts';
import {stopCodexProcesses} from './codex-runner.ts';
import {stopClaudeProcesses} from './claude-runner.ts';
import {expectDesktopStop,ownDesktopData,recordDesktopStop} from './desktop-owner.ts';
import {desktopServiceControl,startCliService} from './cli-service.ts';
import {installDiagnostics,recordDiagnostic,safeErrorCode} from './diagnostics.ts';
import {browserProviderSettings,withBrowserProviderSettings} from './browser-provider-settings.ts';
import {runtimeConfiguration} from './provider-runtime.ts';

export async function startServer({root,variables=process.env,localAccess=false,settingsOverrides,settingsProxyToken,explicitSettingsBypass=false}:{root:string;variables?:NodeJS.ProcessEnv;localAccess?:boolean;settingsOverrides?:Record<string,string|undefined>;settingsProxyToken?:string;explicitSettingsBypass?:boolean}){
 const config=serverConfig(variables);
 const release=await ownDesktopData(config.dataDirectory);
 const removeDiagnostics=installDiagnostics(config.dataDirectory);
 const providerSettings=settingsOverrides?browserProviderSettings({variables,overrides:settingsOverrides,proxyToken:settingsProxyToken,live:true,ports:[config.port,...(variables.SHIQU_DEV_FRONTEND_PORT?[Number(variables.SHIQU_DEV_FRONTEND_PORT)]:[])]}):undefined;
 const providerVariables=providerSettings?()=>{try{return providerSettings.variables();}catch(error){if(explicitSettingsBypass)return variables;throw error;}}:undefined;
 let app:ReturnType<typeof createApplication>;
 try{app=createApplication({root,dataDirectory:config.dataDirectory,variables,providerVariables,snapshotVariables:providerSettings?snapshot=>{try{return providerSettings.variablesForSnapshot(snapshot);}catch(error){if(explicitSettingsBypass)return variables;throw error;}}:undefined});}
 catch(error){recordDiagnostic(config.dataDirectory,'service_start_failed',{code:safeErrorCode(error)});removeDiagnostics();await release();throw error;}
 const urls=phoneUrls(config.host,config.port);
 const accessHosts=[`localhost:${config.port}`,`127.0.0.1:${config.port}`,`[::1]:${config.port}`,...urls.map(url=>new URL(url).host)];
 let handle=localAccess?desktopAccess(app.handle,{hosts:accessHosts}).handle:developmentAccess(app.handle,variables,config.port);
 const server=createHttpServer(withBrowserProviderSettings(app,providerSettings,request=>handle(request)));
 let cli:Awaited<ReturnType<typeof startCliService>>|undefined;
 let closing:Promise<void>|undefined,stopping=false,failed=false;
 let desktopDraining=false;
 function closeApplication(){
  return closing??=(async()=>{
   app.stopGeneration();
   try{await cli?.close();await Promise.all([stopCodexProcesses(),stopClaudeProcesses()]);await app.close();if(stopping&&!failed)recordDesktopStop(config.dataDirectory);}
   finally{recordDiagnostic(config.dataDirectory,'service_stopped');removeDiagnostics();await release();}
  })();
 }
 function listen(host:string){
  return new Promise<void>((resolve,reject)=>{
   server.once('error',reject);
   server.listen(config.port,host,()=>{server.off('error',reject);resolve();});
  });
 }
 // npm 会转发同一次 Ctrl-C。仅在 npm 启动时先合并重复信号，再提示用户可立即强停。
 const npmSignalWindow=/[\\/]npm-cli\.js$/.test(process.env.npm_execpath||'')?200:0;
 let terminalDraining=false,forcePrompt:ReturnType<typeof setTimeout>|undefined;
 function stop(force:boolean){
  if(stopping)return;
  if(!force&&forcePrompt)return;
  if(!force&&!terminalDraining&&cli){
   const {idle,settled}=cli.drain();
   if(!idle){
    terminalDraining=true;
    const notify=()=>{forcePrompt=undefined;console.error('正在等待当前步骤保存后停止服务；再按一次 Ctrl-C 立即停止。');};
    if(npmSignalWindow)forcePrompt=setTimeout(notify,npmSignalWindow);else notify();
    void settled.then(()=>stop(true));
    return;
   }
  }
  stopping=true;
  clearTimeout(forcePrompt);
  if(localAccess)expectDesktopStop(config.dataDirectory);
  // 停止时中止进行中的模型请求；正常等候结束时已没有进行中的请求。
  app.interruptWork();
  const closed=new Promise<void>(resolve=>server.close(()=>resolve()));
  server.closeAllConnections();
  // Cancel provider requests before waiting for their HTTP connections to drain.
  void Promise.all([closed,stopCodexProcesses(),stopClaudeProcesses()]).then(closeApplication).then(()=>process.exit(failed?1:0),()=>process.exit(1));
 }
 try{
  // macOS permits wildcard and loopback binds to coexist; keep the printed local URL on this service.
  if(config.host==='0.0.0.0'){
   await listen('127.0.0.1');
   await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
  await listen(config.host);
  const bound=server.address();
  if(!bound||typeof bound==='string')throw Error('CLI_SERVICE_LISTENER');
  const address=bound.address==='0.0.0.0'?'127.0.0.1':bound.address==='::'?'::1':bound.address;
  const readerUrl='http://'+(address.includes(':')?'['+address+']':address)+':'+bound.port;
  if(localAccess)handle=desktopAccess(app.handle,{hosts:[...accessHosts,new URL(readerUrl).host]}).handle;
  const status=()=>{
   const state=desktopDraining||terminalDraining||stopping?'stopping':'running';
   const result={running:true,state,pid:process.pid,url:readerUrl,phoneUrls:urls,generating:app.generating,provider:runtimeConfiguration(variables)};
   try{const saved=providerSettings?.snapshot();return saved?{...result,provider:saved.runtime,restartRequired:saved.restartRequired}:result;}
   catch{return {...result,settingsError:'无法读取共享生成设置，请检查本机配置后重试。'};}
  };
  cli=await startCliService(root,config.dataDirectory,{application:app,...(localAccess?{desktop:desktopServiceControl(root,config.dataDirectory,status,()=>{desktopDraining=true;return cli!.drain();},()=>stop(true))}:{})});
 }catch(error){if(server.listening)server.close();recordDiagnostic(config.dataDirectory,'service_start_failed',{code:safeErrorCode(error)});await closeApplication();throw error;}
 const onInterrupt=()=>stop(false),onTerminate=()=>stop(true);
 process.on('SIGINT',onInterrupt);process.on('SIGTERM',onTerminate);
 server.on('error',error=>{
  failed=true;
  app.interruptWork();
  console.error('Server failed:',error.message);
  process.off('SIGINT',onInterrupt);process.off('SIGTERM',onTerminate);
  void closeApplication().then(()=>{process.exitCode=1;server.close();});
 });
 const browserHost=config.host==='0.0.0.0'?'127.0.0.1':config.host==='::'?'::1':config.host;
 const host=browserHost.includes(':')?`[${browserHost}]`:browserHost;
 console.log(`拾趣: http://${host}:${config.port} — data: ${config.dataDirectory}`);
 printPhoneAccess(urls);
 recordDiagnostic(config.dataDirectory,'service_started');
 return server;
}
