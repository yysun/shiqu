// Share HTTP lifecycle; CLI owns the desktop-compatible library until generation and DB shutdown finish.
import {createApplication} from './app.ts';
import {createHttpServer} from './http.ts';
import {serverConfig} from './config.ts';
import {phoneUrls,printPhoneAccess} from './phone-access.ts';
import {developmentAccess} from './development-access.ts';
import {desktopAccess} from './desktop-access.ts';
import {stopCodexProcesses} from './codex-runner.ts';
import {ownDesktopData} from './desktop-owner.ts';

export async function startServer({root,variables=process.env,localAccess=false}:{root:string;variables?:NodeJS.ProcessEnv;localAccess?:boolean}){
 const config=serverConfig(variables);
 const release=localAccess?await ownDesktopData(config.dataDirectory):async()=>{};
 let app:ReturnType<typeof createApplication>;
 try{app=createApplication({root,dataDirectory:config.dataDirectory,variables});}
 catch(error){await release();throw error;}
 const urls=phoneUrls(config.host,config.port);
 const handle=localAccess?desktopAccess(app.handle,{hosts:[`localhost:${config.port}`,`127.0.0.1:${config.port}`,`[::1]:${config.port}`,...urls.map(url=>new URL(url).host)]}).handle:developmentAccess(app.handle,variables,config.port);
 const server=createHttpServer(handle);
 let closing:Promise<void>|undefined,stopping=false;
 function closeApplication(){
  return closing??=(async()=>{
   app.stopGeneration();
   try{await stopCodexProcesses();await app.close();}
   finally{await release();}
  })();
 }
 function stop(){
  if(stopping)return;stopping=true;
  app.stopGeneration();
  const closed=new Promise<void>(resolve=>server.close(()=>resolve()));
  server.closeIdleConnections();
  void closed.then(closeApplication).then(()=>process.exit(0));
 }
 try{
  await new Promise<void>((resolve,reject)=>{
   server.once('error',reject);
   server.listen(config.port,config.host,()=>{server.off('error',reject);resolve();});
  });
 }catch(error){await closeApplication();throw error;}
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,stop);
 server.on('error',error=>{
  console.error('Server failed:',error.message);
  process.off('SIGINT',stop);process.off('SIGTERM',stop);
  void closeApplication().then(()=>{process.exitCode=1;server.close();});
 });
 const browserHost=config.host==='0.0.0.0'?'127.0.0.1':config.host==='::'?'::1':config.host;
 const host=browserHost.includes(':')?`[${browserHost}]`:browserHost;
 console.log(`拾趣: http://${host}:${config.port} — data: ${config.dataDirectory}`);
 printPhoneAccess(urls);
 return server;
}
