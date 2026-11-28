// CLI 经回环接口委托持有书库锁的进程。在认证过的同一连接发送命令。
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';
import {lstatSync,readFileSync} from 'node:fs';
import {Agent,request as httpRequest} from 'node:http';
import type {IncomingMessage} from 'node:http';
import type {Socket} from 'node:net';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {createHttpServer} from './http.ts';
import type {HttpPeer} from './http.ts';
import {desktopOwner,ownerProcessExists,ownDesktopDataSync,publishDesktopOwner} from './desktop-owner.ts';
import {canonicalPath} from './library-backup.ts';
import {canDispatchCliCommand,cliFailure,CliCommandError,executeHeadless,serviceStopReason} from './headless-cli.ts';
import type {createApplication} from './app.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {LocalBooks} from './local-books.ts';

const protocol=1,localHost='127.0.0.1',idleMs=750,startupMs=15000;
const instanceId=z.string().uuid();
const commandRequest=z.object({id:instanceId,args:z.array(z.string()).min(1).max(500),cwd:z.string().refine(value=>path.isAbsolute(value)&&!value.includes('\0')),input:z.unknown().optional()}).strict();
type Command=z.infer<typeof commandRequest>;
type Owner=NonNullable<ReturnType<typeof desktopOwner>>;
type Application=ReturnType<typeof createApplication>;
type Drain={idle:boolean;settled:Promise<void>};
type DesktopRequest={action:'attach'|'promote'|'status'|'stop'|'force';version:string;start?:unknown};
type DesktopControl=(request:DesktopRequest,peer:HttpPeer)=>Promise<object>|object;
type Runtime={application?:Application;managed?:{onIdle:()=>void};desktop?:DesktopControl;generation?:ReaderProvider;localBooks?:LocalBooks};
type Failure=ReturnType<typeof cliFailure>;
type Event={progress:string}|{data:unknown}|{failure:Failure};
const headers={'Cache-Control':'no-store','Content-Type':'application/x-ndjson'};
const encoder=new TextEncoder();
const encode=(value:Event)=>encoder.encode(JSON.stringify(value)+'\n');
const signature=(key:string,challenge:string)=>createHmac('sha256',key).update(challenge).digest('hex');
export function serviceVersion(root:string):string{
 try{return JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version||'';}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return '';throw error;}
}
const desktopRequest=z.object({action:z.enum(['attach','promote','status','stop','force']),version:z.string().max(64),start:z.unknown().optional()}).strict();

// 桌面控制同样经持锁实例认证；确认已发出之后才允许关闭控制连接。
export function desktopServiceControl(root:string,status:()=>object|undefined,drain:()=>Drain,stop:()=>void,promote?:(input:unknown,signal?:AbortSignal)=>Promise<object>):DesktopControl{
 const version=serviceVersion(root);
 return async(request,peer)=>{
  if(!version||request.version!==version)return {error:'书库服务版本不同，请先通过原入口停止服务。'};
  const snapshot=status();
  if(request.action==='attach')return snapshot??(promote?{promote:true}:{error:'书库服务尚未就绪。'});
  if(request.action==='promote')return !snapshot&&promote?await promote(request.start,peer.signal):{error:'此服务无需启用桌面阅读器。'};
  if(!snapshot)return {error:'书库服务尚未就绪。'};
  if(request.action==='status')return snapshot;
  if(request.action==='force'){peer.afterReply?.(stop);return {accepted:true,draining:false};}
  const waiting=drain();
  peer.afterReply?.(()=>{void waiting.settled.then(stop);});
  return {accepted:true,draining:!waiting.idle};
 };
}
function matches(a:string,b:string){
 const lhs=Buffer.from(a),rhs=Buffer.from(b);
 return lhs.length===rhs.length&&timingSafeEqual(lhs,rhs);
}
function affinity(root:string,environment:NodeJS.ProcessEnv){
 // macOS 可以向子进程补上此系统编码变量，它与 CLI 的模型及书库设置无关。
 const entries=Object.entries(environment).filter(([name])=>name!=='__CF_USER_TEXT_ENCODING').sort();
 return createHash('sha256').update(JSON.stringify([root,entries])).digest('hex');
}

export async function startCliService(root:string,directory:string,runtime:Runtime){
 const owner=desktopOwner(directory);
 if(!owner||owner.pid!==process.pid)throw Error('DATA_BUSY');
 const active=new Map<string,{controller:AbortController;finished:Promise<void>}>();
 let queue=Promise.resolve(),idle:ReturnType<typeof setTimeout>|undefined,closing:Promise<void>|undefined,url='',accepting=true,promoting=false;
 const busyBackup=()=>new CliCommandError('BACKUP_ACTIVE_TASKS','书库有正在进行的任务，请等当前步骤保存后再备份。');
 const pause=(except?:string)=>{
  if(!accepting)return;
  accepting=false;
  const hasCommands=()=>active.size>(except&&active.has(except)?1:0);
  const resume=runtime.application?runtime.application.pauseMaintenance(hasCommands):hasCommands()?undefined:()=>{};
  if(!resume){accepting=true;return;}
  return ()=>{resume();accepting=true;};
 };
 // 停服等候：停收命令并中断执行中的 CLI 命令（run 留下等待并返回中断），再等应用里已接收的工作结束。
 let drained:{idle:boolean;settled:Promise<void>}|undefined;
 const drain=()=>{
  if(drained)return {idle:false,settled:drained.settled};
  accepting=false;
  for(const {controller} of active.values())controller.abort(serviceStopReason);
  const hasCommands=()=>active.size>0;
  drained=runtime.application?runtime.application.drainForStop(hasCommands)
   :{idle:!hasCommands(),settled:(async()=>{while(hasCommands())await delay(100);})()};
  return drained;
 };
 const refreshIdle=()=>{
  if(idle)clearTimeout(idle);
  if(runtime.managed&&!closing&&!promoting&&!active.size)idle=setTimeout(runtime.managed.onIdle,idleMs);
 };
 const server=createHttpServer(async(req,peer)=>{
  const address=new URL(req.url);
  if(peer.remoteAddress!==localHost||address.origin!==url||req.headers.has('origin'))return new Response(null,{status:404});
  if(peer.rawPath==='/identity'&&req.method==='GET'){
   const challenge=instanceId.safeParse(address.searchParams.get('challenge'));
   if(!challenge.success||!matches(address.searchParams.get('proof')||'',signature(owner.id,'client:'+challenge.data)))return new Response(null,{status:404});
   refreshIdle();
   return new Response(signature(owner.id,'server:'+challenge.data),{headers:{'Cache-Control':'no-store'}});
  }
  if(!matches(req.headers.get('authorization')||'','Bearer '+owner.id))return new Response(null,{status:404});
  if(peer.rawPath==='/desktop'&&req.method==='POST'&&runtime.desktop){
   const raw=await req.text(),parsed=desktopRequest.safeParse(raw.length<=20000?JSON.parse(raw):null);
   if(!parsed.success)return new Response(null,{status:400});
   return Response.json(await runtime.desktop(parsed.data,peer),{headers:{'Cache-Control':'no-store'}});
  }
  if(peer.rawPath!=='/command')return new Response(null,{status:404});
  if(req.method==='DELETE'){
   active.get(address.searchParams.get('id')||'')?.controller.abort();
   return new Response(null,{status:204});
  }
  if(req.method!=='POST')return new Response(null,{status:405});
  const command=commandRequest.safeParse(await req.json().catch(()=>null));
  if(!command.success||active.has(command.data.id))return new Response(null,{status:400});
  if(closing||!accepting)return new Response(encode({failure:cliFailure(new CliCommandError('SERVICE_BUSY','书库服务正在维护，请稍候重试。'))}),{headers});
  if(command.data.args[0]==='backup'&&(active.size>0))return new Response(encode({failure:cliFailure(busyBackup())}),{headers});
  const {id,cwd,args,input}=command.data,controller=new AbortController();
  const stream=new ReadableStream<Uint8Array>({
   start(output){
    let disconnected=false;
    const send=(event:Event)=>{if(!disconnected)try{output.enqueue(encode(event));}catch{disconnected=true;}};
    const execute=async()=>{
     try{
      if(controller.signal.aborted)throw interrupted();
      if(!canDispatchCliCommand(args,input))throw new CliCommandError('INVALID_INPUT','Command is unavailable on the local service.');
      const pauseForBackup=()=>{
       const resume=pause(id);if(!resume)throw busyBackup();return resume;
      };
      const data=await executeHeadless(root,args,{cwd,input,host:{directory,application:runtime.application,pauseForBackup},signal:controller.signal,
       progress:line=>send({progress:line}),generation:runtime.generation,localBooks:runtime.localBooks});
      send({data});
     }catch(error){send({failure:cliFailure(error)});}
     finally{
      active.delete(id);
      if(!disconnected)output.close();
      refreshIdle();
     }
    };
    // 自动服务按条持有应用及模型调用；桌面服务的业务操作由原应用处理。
    const finished=runtime.managed?queue.then(execute):Promise.resolve().then(execute);
    if(runtime.managed)queue=finished;
    active.set(id,{controller,finished});
    refreshIdle();
   },
   cancel(){controller.abort();},
  });
  return new Response(stream,{headers});
 });
 const close=()=>closing??=(async()=>{
  accepting=false;
  if(idle)clearTimeout(idle);
  const ended=new Promise<void>(resolve=>server.close(()=>resolve()));
  for(const {controller} of active.values())controller.abort(serviceStopReason);
  server.closeAllConnections();
  await Promise.allSettled([...active.values()].map(item=>item.finished));
  await ended;
 })();
 // 启用阅读器前等自动服务已接收的命令收尾；失败恢复原进程及空闲计时。
 async function promote(start:(signal:AbortSignal)=>Promise<{application:Application}>,signal?:AbortSignal){
  if(!runtime.managed||!accepting||closing)throw Error('DATA_BUSY');
  promoting=true;accepting=false;refreshIdle();
  const cancel=signal??new AbortController().signal;
  try{
   while(active.size)await delay(50,undefined,{signal:cancel});
   cancel.throwIfAborted();
   const handoff=await start(cancel);
   cancel.throwIfAborted();
   publishDesktopOwner(directory,{protocol,url},true);
   runtime.application=handoff.application;runtime.managed=undefined;
  }finally{promoting=false;accepting=!closing;refreshIdle();}
 }
 try{
  server.listen(0,localHost);await once(server,'listening');
  const address=server.address();
  if(!address||typeof address==='string')throw Error('CLI_SERVICE_LISTENER');
  url='http://'+localHost+':'+address.port;
  publishDesktopOwner(directory,{protocol,url,...(runtime.managed?{affinity:affinity(root,process.env)}:{})});
  refreshIdle();
  return {close,url,pause,drain,promote};
 }catch(error){await close();throw error;}
}

export async function runCliServiceProcess(root:string,directory:string){
 if(process.send&&!process.connected)return;
 const reply=(message:string|Failure)=>{if(process.connected)process.send?.(message,()=>{});};
 let release:()=>void;
 try{release=ownDesktopDataSync(directory,true);}
 catch(error){reply(cliFailure(error));return;}
 let abandoned=false;
 const disconnected=()=>{abandoned=true;};
 process.once('disconnect',disconnected);
 const onSignal=()=>{void stop();};
 let service:Awaited<ReturnType<typeof startCliService>>|undefined,stopping:Promise<void>|undefined;
 type Desktop=Awaited<ReturnType<typeof import('./desktop.ts').startDesktop>>;
 let desktop:Desktop|undefined;
 const shutdown=new AbortController();
 const stop=()=>stopping??=(async()=>{
  shutdown.abort();
  try{await desktop?.stop(true);await service?.close();}finally{release();process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);if(process.connected)process.disconnect?.();}
 })();
 try{
  const control=desktopServiceControl(root,()=>desktop?.status,()=>desktop!.prepareStop(),onSignal,async(input,signal)=>{
   let next:Desktop|undefined;
   try{
    await service!.promote(async cancel=>{
     const {startDesktop,desktopStartRequest}=await import('./desktop.ts');
     const request=desktopStartRequest.parse(input);
     if(request.action!=='start'||canonicalPath(request.settings.dataDirectory)!==canonicalPath(directory))throw Error('DATA_BUSY');
     next=await startDesktop({...request.settings,dataDirectory:directory},request.key,root,{signal:cancel,imageKey:request.imageKey,settingsFile:request.settingsFile,overrides:request.overrides,existingCli:service});
     return next;
    },signal?AbortSignal.any([signal,shutdown.signal]):shutdown.signal);
    desktop=next!;
    return desktop.status;
   }catch(error){await next?.stop();const {desktopFailure}=await import('./desktop.ts');return {error:desktopFailure(error)};}
  });
  service=await startCliService(root,directory,{managed:{onIdle:onSignal},desktop:control});
  process.off('disconnect',disconnected);
  if(abandoned){await stop();return;}
  process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  reply('ready');
 }catch(error){
  process.off('disconnect',disconnected);reply(cliFailure(error));
  await stop();
 }
}

function launch(root:string,directory:string,environment:NodeJS.ProcessEnv){
 const child=spawn(process.execPath,['--input-type=module','-e',
  'const [entry,root,directory]=process.argv.slice(1);process.argv.length=1;const {runCliServiceProcess}=await import(entry);await runCliServiceProcess(root,directory);',
  import.meta.url,root,directory],{detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:environment});
 let failure:Failure|undefined,finished=false;
 child.once('error',()=>{failure=cliFailure(Error('CLI_SERVICE_STARTUP'));finished=true;});
 child.once('exit',code=>{
  if(!finished&&code!==0)failure=cliFailure(Error('CLI_SERVICE_STARTUP'));
  finished=true;
 });
 child.once('message',message=>{
  if(message!=='ready')failure=message as Failure;
  finished=true;
  if(child.connected)child.disconnect();
 });
 child.unref();child.channel?.unref();
 return {
  get failure(){return failure;},get pending(){return !finished;},
  disconnect(){if(child.connected)child.disconnect();},
 };
}

function serviceUrl(owner:Owner){
 const value=owner.service?.url;
 if(owner.service?.protocol===protocol&&typeof value==='string'&&/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value)){
  try{return new URL(value);}catch{/* 无效端口。 */}
 }
}
function sendHttp(url:URL,route:string,method:string,agent:Agent,signal:AbortSignal,options:{body?:string;key?:string;socket?:Socket}={}):Promise<IncomingMessage>{
 const {body,key,socket}=options;
 const req=httpRequest(new URL(route,url),{method,agent,signal,headers:{
  ...(key?{Authorization:'Bearer '+key}:{}),...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})
 }});
 req.once('socket',actual=>{
  if(socket&&actual!==socket)req.destroy(Error('CLI_SERVICE_CHANGED'));
  else req.end(body);
 });
 return once(req,'response').then(([response])=>response as IncomingMessage);
}
async function readText(response:IncomingMessage){
 let value='';
 for await(const chunk of response){
  if(value.length+chunk.length>128)throw Error('CLI_SERVICE_IDENTITY');
  value+=chunk;
 }
 return value;
}
async function identify(owner:Owner,agent:Agent,signal:AbortSignal){
 const url=serviceUrl(owner);if(!url)return;
 const challenge=randomUUID();
 const response=await sendHttp(url,'/identity?challenge='+challenge+'&proof='+signature(owner.id,'client:'+challenge),'GET',agent,AbortSignal.any([signal,AbortSignal.timeout(400)]));
 const socket=response.socket;
 if(response.statusCode===200&&matches(await readText(response),signature(owner.id,'server:'+challenge)))return {url,socket};
 response.destroy();
}
export async function requestDesktopService(owner:Owner,request:DesktopRequest,signal:AbortSignal){
 const agent=new Agent({keepAlive:true,maxSockets:1});
 try{
  const service=await identify(owner,agent,signal);
  if(!service)return;
  const response=await sendHttp(service.url,'/desktop','POST',agent,signal,{key:owner.id,socket:service.socket,body:JSON.stringify(request)});
  if(response.statusCode!==200){response.destroy();return;}
  let value='';
  response.setEncoding('utf8');
  for await(const chunk of response){
   value+=chunk;if(value.length>16384)throw Error('CLI_SERVICE_RESPONSE');
  }
  return JSON.parse(value) as Record<string,unknown>;
 }finally{agent.destroy();}
}
function asError({code,message,exitCode,details}:Failure){return new CliCommandError(code,message,exitCode,details);}
function interrupted(){return new CliCommandError('INTERRUPTED','Command interrupted; reopen the story to check saved progress.',130);}
async function collect(response:IncomingMessage){
 if(response.statusCode!==200){response.destroy();throw Error('CLI_SERVICE_REJECTED');}
 response.setEncoding('utf8');
 let pending='';
 for await(const chunk of response){
  pending+=chunk;
  let newline:number;
  while((newline=pending.indexOf('\n'))>=0){
   const event=JSON.parse(pending.slice(0,newline)) as Event;
   pending=pending.slice(newline+1);
   if('progress' in event)process.stderr.write(event.progress);
   else if('failure' in event)throw asError(event.failure);
   else return event.data;
  }
 }
 throw Error('CLI_SERVICE_DISCONNECTED');
}
async function cancel(owner:Owner,id:string){
 const agent=new Agent({keepAlive:true,maxSockets:1});
 try{
  const signal=AbortSignal.timeout(1000),service=await identify(owner,agent,signal);
  if(service){
   const response=await sendHttp(service.url,'/command?id='+id,'DELETE',agent,signal,{key:owner.id,socket:service.socket});
   await readText(response);
   return response.statusCode===204;
  }
  return false;
 }finally{agent.destroy();}
}

export async function callCliService(root:string,directory:string,args:string[],cwd:string,environment:NodeJS.ProcessEnv,input?:unknown,signal?:AbortSignal){
 // 先保留原本拒绝书库目录符号链接的规则，再归一化父目录用于查找服务。
 try{if(lstatSync(directory).isSymbolicLink())throw Error('LIBRARY_UNSAFE_DIRECTORY');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 directory=canonicalPath(directory);
 const deadline=Date.now()+startupMs,controller=new AbortController();
 const command:Command={id:randomUUID(),args,cwd,input};
 const key=affinity(root,environment);
 let child:ReturnType<typeof launch>|undefined,activeOwner:Owner|undefined,nextLaunch=0;
 const stop=()=>{
  if(activeOwner)void cancel(activeOwner,command.id).then(accepted=>{if(!accepted)controller.abort();},()=>controller.abort());
  else controller.abort();
 };
 process.once('SIGINT',stop);process.once('SIGTERM',stop);signal?.addEventListener('abort',stop,{once:true});
 if(signal?.aborted)stop();
 try{
  while(Date.now()<deadline&&!controller.signal.aborted){
   const owner=desktopOwner(directory);
   const alive=owner&&ownerProcessExists(owner.pid);
   // 不兼容的自动服务可以自然空闲退出；探测它的身份会延长寿命。
   const compatible=!owner?.managed||owner.service?.affinity===key;
   let unavailable=Boolean(alive&&owner.service?.protocol===protocol&&!compatible);
   if(alive&&owner.service?.protocol===protocol&&compatible){
    const agent=new Agent({keepAlive:true,maxSockets:1});
    try{
     const service=await identify(owner,agent,controller.signal).catch(()=>undefined);
     unavailable=!service;
     if(service){
      const response=await sendHttp(service.url,'/command','POST',agent,controller.signal,{socket:service.socket,key:owner.id,body:JSON.stringify(command)});
      activeOwner=owner;
      return await collect(response);
     }
    }catch(error){
     if(error instanceof CliCommandError)throw error;
     if(controller.signal.aborted)throw interrupted();
     // 提交后状态可能已保存。由调用者核对，避免自动重放。
     throw new CliCommandError('SERVICE_DISCONNECTED','Local service disconnected; check saved state before retrying.',1);
    }finally{agent.destroy();}
   }
   if(child?.failure&&child.failure.code!=='LIBRARY_BUSY')throw asError(child.failure);
   if((!alive||unavailable)&&!child?.pending&&Date.now()>=nextLaunch){
    child=launch(root,directory,environment);nextLaunch=Date.now()+750;
   }
   if(alive&&!owner.managed&&!owner.service&&Date.now()>deadline-startupMs+2000)throw asError(cliFailure(Error('DATA_BUSY')));
   await delay(40,undefined,{signal:controller.signal}).catch(()=>{});
  }
  if(controller.signal.aborted)throw interrupted();
  throw new CliCommandError('LIBRARY_BUSY','The local library service did not become available. Check the service and retry.',1);
 }finally{child?.disconnect();process.off('SIGINT',stop);process.off('SIGTERM',stop);signal?.removeEventListener('abort',stop);}
}
