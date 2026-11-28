// CLI 经回环接口委托持有书库锁的进程。在认证过的同一连接发送命令。
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';
import {lstatSync} from 'node:fs';
import {Agent,request as httpRequest} from 'node:http';
import type {IncomingMessage} from 'node:http';
import type {Socket} from 'node:net';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {createHttpServer} from './http.ts';
import {desktopOwner,ownerProcessExists,ownDesktopDataSync,publishDesktopOwner} from './desktop-owner.ts';
import {canonicalPath} from './library-backup.ts';
import {canDispatchCliCommand,cliFailure,CliCommandError,executeHeadless} from './headless-cli.ts';
import type {createApplication} from './app.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {LocalBooks} from './local-books.ts';

const protocol=1,localHost='127.0.0.1',idleMs=750,startupMs=15000;
const instanceId=z.string().uuid();
const commandRequest=z.object({id:instanceId,args:z.array(z.string()).min(1).max(500),cwd:z.string().refine(value=>path.isAbsolute(value)&&!value.includes('\0')),input:z.unknown().optional()}).strict();
type Command=z.infer<typeof commandRequest>;
type Owner=NonNullable<ReturnType<typeof desktopOwner>>;
type Application=ReturnType<typeof createApplication>;
type Runtime={application?:Application;managed?:{onIdle:()=>void};generation?:ReaderProvider;localBooks?:LocalBooks};
type Failure=ReturnType<typeof cliFailure>;
type Event={progress:string}|{data:unknown}|{failure:Failure};
const headers={'Cache-Control':'no-store','Content-Type':'application/x-ndjson'};
const encoder=new TextEncoder();
const encode=(value:Event)=>encoder.encode(JSON.stringify(value)+'\n');
const signature=(key:string,challenge:string)=>createHmac('sha256',key).update(challenge).digest('hex');
function matches(a:string,b:string){
 const lhs=Buffer.from(a),rhs=Buffer.from(b);
 return lhs.length===rhs.length&&timingSafeEqual(lhs,rhs);
}
function affinity(root:string,environment:NodeJS.ProcessEnv){
 return createHash('sha256').update(JSON.stringify([root,Object.entries(environment).sort(([a],[b])=>a.localeCompare(b))])).digest('hex');
}

export async function startCliService(root:string,directory:string,runtime:Runtime){
 const owner=desktopOwner(directory);
 if(!owner||owner.pid!==process.pid)throw Error('DATA_BUSY');
 const active=new Map<string,{controller:AbortController;finished:Promise<void>}>();
 let queue=Promise.resolve(),idle:ReturnType<typeof setTimeout>|undefined,closing:Promise<void>|undefined,url='',accepting=true;
 const busyBackup=()=>new CliCommandError('BACKUP_ACTIVE_TASKS','书库有正在进行的任务，请等当前步骤保存后再备份。');
 const pause=(except?:string)=>{
  if(!accepting)return;
  accepting=false;
  const hasCommands=()=>active.size>(except&&active.has(except)?1:0);
  const resume=runtime.application?runtime.application.pauseMaintenance(hasCommands):hasCommands()?undefined:()=>{};
  if(!resume){accepting=true;return;}
  return ()=>{resume();accepting=true;};
 };
 const refreshIdle=()=>{
  if(idle)clearTimeout(idle);
  if(runtime.managed&&!closing&&!active.size)idle=setTimeout(runtime.managed.onIdle,idleMs);
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
  if(peer.rawPath!=='/command'||!matches(req.headers.get('authorization')||'','Bearer '+owner.id))return new Response(null,{status:404});
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
  for(const {controller} of active.values())controller.abort();
  server.closeAllConnections();
  await Promise.allSettled([...active.values()].map(item=>item.finished));
  await ended;
 })();
 try{
  server.listen(0,localHost);await once(server,'listening');
  const address=server.address();
  if(!address||typeof address==='string')throw Error('CLI_SERVICE_LISTENER');
  url='http://'+localHost+':'+address.port;
  publishDesktopOwner(directory,{protocol,url,...(runtime.managed?{affinity:affinity(root,process.env)}:{})});
  refreshIdle();
  return {close,url,pause};
 }catch(error){await close();throw error;}
}

export async function runCliServiceProcess(root:string,directory:string){
 let release:()=>void;
 try{release=ownDesktopDataSync(directory,true);}
 catch(error){process.send?.(cliFailure(error));return;}
 const onSignal=()=>{void stop();};
 let service:Awaited<ReturnType<typeof startCliService>>|undefined,stopping:Promise<void>|undefined;
 const stop=()=>stopping??=(async()=>{
  try{await service?.close();}finally{release();process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);if(process.connected)process.disconnect?.();}
 })();
 try{
  service=await startCliService(root,directory,{managed:{onIdle:onSignal}});
  process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  process.send?.('ready');
 }catch(error){
  process.send?.(cliFailure(error));
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
 child.unref();
 return {get failure(){return failure;},get pending(){return !finished;}};
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
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);signal?.removeEventListener('abort',stop);}
}
