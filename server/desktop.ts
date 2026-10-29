// Run the existing reader under a native supervisor, accepting secrets only through private stdin.
// EOF and explicit stop revoke access and terminate generation before releasing data ownership.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {z} from 'zod';
import {realpathSync} from 'node:fs';
import {createApplication} from './app.ts';
import {createHttpServer} from './http.ts';
import {desktopAccess} from './desktop-access.ts';
import {ownDesktopData} from './desktop-owner.ts';
import {phoneUrls} from './phone-access.ts';
import {createReaderProvider} from './generation.ts';
import {stopCodexProcesses} from './codex-runner.ts';
import {FileMedia} from './media.ts';
import {codexReasoningEffortSchema} from '../lib/codex-settings.ts';

export const desktopSettings=z.object({
 nodePath:z.string().max(4096).default(''),dataDirectory:z.string().min(1).max(4096),port:z.number().int().min(1024).max(65535),lanEnabled:z.boolean(),
 provider:z.enum(['gemini','codex']),textModel:z.string().regex(/^[\w.-]{1,100}$/),imageModel:z.string().regex(/^[\w.-]{1,100}$/),
 codexPath:z.string().max(4096),codexModel:z.string().regex(/^[\w.-]{0,100}$/),codexHome:z.string().max(4096),codexReasoningEffort:codexReasoningEffortSchema,
}).strict();
export type DesktopSettings=z.infer<typeof desktopSettings>;
export function desktopVariables(settings:DesktopSettings,key:string){
 return {SHIQU_AI_PROVIDER:settings.provider,GEMINI_API_KEY:key,GEMINI_TEXT_MODEL:settings.textModel,GEMINI_IMAGE_MODEL:settings.imageModel,CODEX_BIN:settings.codexPath||'codex',CODEX_MODEL:settings.codexModel,SHIQU_CODEX_HOME:settings.codexHome,CODEX_REASONING_EFFORT:settings.codexReasoningEffort};
}
export async function testDesktopProvider(settings:DesktopSettings,key:string,root:string,transport:typeof fetch=fetch){
 if(settings.provider==='codex'){
  const provider=createReaderProvider(desktopVariables(settings,key),new FileMedia(path.join(root,'unused')),transport);
  const status=await provider.status();return {ok:status.configured,message:status.configured?'Codex 已登录；此检查未生成内容。':status.message||'Codex 尚未连接。'};
 }
 if(!key)return {ok:false,message:'请先填写或保存 Gemini API 密钥。'};
 try{
  // Metadata only: no generation endpoint, prompt, or paid output.
  for(const model of new Set([settings.textModel,settings.imageModel])){
   const response=await transport(`https://generativelanguage.googleapis.com/v1beta/models/${model}`,{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(10000),redirect:'error'});
   if(!response.ok)return {ok:false,message:`模型访问检查失败（HTTP ${response.status}）。请检查密钥及模型权限。`};
   await response.body?.cancel();
  }
  return {ok:true,message:'密钥和模型元数据可访问；未生成内容，不代表生成额度充足。'};
 }catch{return {ok:false,message:'连接超时或网络不可用；未生成内容。'};}
}
export async function startDesktop(settings:DesktopSettings,key:string,root:string){
 const release=await ownDesktopData(settings.dataDirectory);
 let app:ReturnType<typeof createApplication>|undefined,server:ReturnType<typeof createHttpServer>|undefined;
 try{
  app=createApplication({root,dataDirectory:settings.dataDirectory,variables:desktopVariables(settings,key)});
  const local=`http://127.0.0.1:${settings.port}`,phones=settings.lanEnabled?phoneUrls('0.0.0.0',settings.port):[];
  const access=desktopAccess(app.handle,{hosts:[new URL(local).host,...phones.map(url=>new URL(url).host)],port:settings.port});
  server=createHttpServer(access.handle);server.listen(settings.port,settings.lanEnabled?'0.0.0.0':'127.0.0.1');await once(server,'listening');
  let stopped:Promise<void>|undefined;
  return {server,status:{running:true,pid:process.pid,url:`${local}/desktop/pair#${access.pairing}`,phoneUrls:phones.map(url=>`${url}/desktop/pair#${access.pairing}`)},stop(){
   return stopped??=(async()=>{await stopCodexProcesses();await new Promise<void>(resolve=>{server!.close(()=>resolve());server!.closeAllConnections();});app!.close();await release();})();
  }};
 }catch(error){server?.close();app?.close();await release();throw error;}
}
export function desktopFailure(error:unknown){
 const code=(error as NodeJS.ErrnoException)?.code,message=(error as Error)?.message;
 if(code==='EADDRINUSE')return '端口已被占用，请更换端口或停止其他实例。';
 if(message==='DATA_BUSY')return '此数据目录仍由另一个桌面服务使用，请等待它退出或选择其他目录。';
 if(code==='EACCES'||code==='EPERM')return '无法访问所选文件或数据目录，请检查权限。';
 return '服务启动失败。请确认 Node 24、应用资源和数据目录可用。';
}
async function main(){
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 let runtime:Awaited<ReturnType<typeof startDesktop>>|undefined,starting=false,closing=false,inputClosed=false;
 const send=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
 async function stop(){if(closing)return;closing=true;await stopCodexProcesses();await runtime?.stop();process.exit(0);}
 lines.on('close',()=>{inputClosed=true;if(!starting)void stop();});
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void stop();});
 process.on('exit',()=>stopCodexProcesses());
 // Discard raw exception/provider output: the parent receives only safe status messages.
 process.on('uncaughtException',()=>{send({error:'服务意外退出，请重新启动。'});void stop();});
 lines.on('line',line=>{
  if(line.length>20000){void stop();return;}
  if(runtime){try{if(JSON.parse(line).action==='stop')void stop();}catch{void stop();}return;}
  if(starting||closing)return;starting=true;
  void(async()=>{
   try{
    const input=z.object({action:z.enum(['start','test']),settings:desktopSettings,key:z.string().max(4096).default('')}).strict().parse(JSON.parse(line));
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    if(input.action==='test'){send(await testDesktopProvider(input.settings,input.key,root));await stop();return;}
    runtime=await startDesktop(input.settings,input.key,root);starting=false;
    if(inputClosed){await stop();return;}
    send(runtime.status);
   }catch(error){send({error:desktopFailure(error)});starting=false;await stop();}
  })();
 });
 const timer=setTimeout(()=>{if(!runtime&&!starting)void stop();},10000);timer.unref();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)void main();
