// 共用 HTTP 生命周期；CLI 在生成与数据库关闭前持有书库，提供方配置只影响新任务。
import {createApplication} from './app.ts';
import {createHttpServer} from './http.ts';
import {serverConfig} from './config.ts';
import {phoneUrls,printPhoneAccess} from './phone-access.ts';
import {developmentAccess} from './development-access.ts';
import {desktopAccess} from './desktop-access.ts';
import {stopCodexProcesses} from './codex-runner.ts';
import {stopClaudeProcesses} from './claude-runner.ts';
import {ownDesktopData} from './desktop-owner.ts';
import {startCliService} from './cli-service.ts';
import {installDiagnostics,recordDiagnostic,safeErrorCode} from './diagnostics.ts';
import {browserProviderSettings} from './browser-provider-settings.ts';
import {providerSettingsPath} from '../lib/provider-settings.ts';

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
 const handle=localAccess?desktopAccess(app.handle,{hosts:[`localhost:${config.port}`,`127.0.0.1:${config.port}`,`[::1]:${config.port}`,...urls.map(url=>new URL(url).host)]}).handle:developmentAccess(app.handle,variables,config.port);
 const server=createHttpServer((request,peer)=>providerSettings&&new URL(request.url).pathname===providerSettingsPath?providerSettings(request,peer):handle(request));
 let cli:Awaited<ReturnType<typeof startCliService>>|undefined;
 let closing:Promise<void>|undefined,stopping=false;
 function closeApplication(){
  return closing??=(async()=>{
   app.stopGeneration();
   try{await cli?.close();await Promise.all([stopCodexProcesses(),stopClaudeProcesses()]);await app.close();}
   finally{recordDiagnostic(config.dataDirectory,'service_stopped');removeDiagnostics();await release();}
  })();
 }
 function listen(host:string){
  return new Promise<void>((resolve,reject)=>{
   server.once('error',reject);
   server.listen(config.port,host,()=>{server.off('error',reject);resolve();});
  });
 }
 // 第一次 Ctrl-C 等已领取的步骤保存后停止；等候中再次 Ctrl-C 或 SIGTERM 立即停止。
 let draining=false;
 function stop(force:boolean){
  if(stopping)return;
  if(!force&&!draining&&cli){
   const {idle,settled}=cli.drain();
   if(!idle){
    draining=true;
    console.error('正在等待当前步骤保存后停止服务；再按一次 Ctrl-C 立即停止。');
    void settled.then(()=>stop(true));
    return;
   }
  }
  stopping=true;
  app.stopGeneration();
  const closed=new Promise<void>(resolve=>server.close(()=>resolve()));
  server.closeAllConnections();
  // Cancel provider requests before waiting for their HTTP connections to drain.
  void Promise.all([closed,stopCodexProcesses(),stopClaudeProcesses()]).then(closeApplication).then(()=>process.exit(0));
 }
 try{
  // macOS permits wildcard and loopback binds to coexist; keep the printed local URL on this service.
  if(config.host==='0.0.0.0'){
   await listen('127.0.0.1');
   await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
  await listen(config.host);
  cli=await startCliService(root,config.dataDirectory,{application:app});
 }catch(error){if(server.listening)server.close();recordDiagnostic(config.dataDirectory,'service_start_failed',{code:safeErrorCode(error)});await closeApplication();throw error;}
 const onInterrupt=()=>stop(false),onTerminate=()=>stop(true);
 process.on('SIGINT',onInterrupt);process.on('SIGTERM',onTerminate);
 server.on('error',error=>{
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
