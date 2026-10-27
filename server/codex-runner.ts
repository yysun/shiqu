// Drive the official Codex stdio protocol with subscription auth and no file/command tools.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {codexEnvironment} from '../scripts/codex-env.mjs';
export {codexEnvironment} from '../scripts/codex-env.mjs';

export class CodexError extends Error {constructor(code:string){super(code);this.name='CodexError';}}
export type CodexJob={prompt:string;instructions:string;schema?:unknown;image?:{bytes:Uint8Array;contentType:string};generateImage?:boolean;timeoutMs?:number};
export type CodexResult={text:string;image:string|null;model:string;requestId:string;usage:unknown};
export interface CodexRunner {status():Promise<{configured:boolean;reason?:string}>;run(job:CodexJob):Promise<CodexResult>}
const disabled=['shell_tool','unified_exec','view_image','browser_use','computer_use','plugins','remote_plugin','apps','hooks','multi_agent','code_mode','code_mode_only','code_mode_tool_search','tool_suggest'];
export function codexArguments(directory:string){
 const args=['app-server','--listen','stdio://','-c','web_search="disabled"','-c','features.skip_host_skill_discovery=true','-c','features.code_mode_host=true','-c','features.image_generation=true','-c','default_permissions="shiqu-generation"','-c',`permissions.shiqu-generation.filesystem={ ":root" = "deny", ${JSON.stringify(directory)} = "read" }`];
 for(const feature of disabled)args.push('--disable',feature);
 return args;
}
type Message=Record<string,unknown>;
export function createCodexRunner(variables:Record<string,string|undefined>,options:{environment?:NodeJS.ProcessEnv;timeoutMs?:number}={}):CodexRunner{
 const binary=variables.CODEX_BIN?.trim()||'codex',model=variables.CODEX_MODEL?.trim();
 if(model&&!/^[a-zA-Z0-9._-]{1,100}$/.test(model))throw new CodexError('INVALID_MODEL');
 async function execute(job?:CodexJob):Promise<CodexResult|null>{
  const directory=await mkdtemp(path.join(tmpdir(),'shiqu-codex-'));
  let child:ReturnType<typeof spawn>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  let failure:(error:Error)=>void=()=>{},sequence=0,closed=false,bytes=0;
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  const env=codexEnvironment(variables.SHIQU_CODEX_HOME,options.environment);
  function kill(){if(!child?.pid)return;try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{/* Process already exited. */}}
  function fail(error:Error){if(closed)return;closed=true;failure(error);for(const p of pending.values())p.reject(error);pending.clear();kill();}
  let lines:ReturnType<typeof createInterface>|undefined,exited:Promise<void>|undefined;
  if(process.platform==='win32'){await rm(directory,{recursive:true,force:true});throw new CodexError('UNSUPPORTED_PLATFORM');}
  try{
   const completion=new Promise<CodexResult>((resolve,reject)=>{failure=reject;
    child=spawn(binary,codexArguments(directory),{cwd:directory,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
    exited=new Promise(resolve=>child!.once('close',()=>resolve()));
    timer=setTimeout(()=>fail(new CodexError('TIMEOUT')),Math.min(options.timeoutMs||120000,job?.timeoutMs||(job?120000:10000)));
    child.once('error',()=>fail(new CodexError('CLI_UNAVAILABLE')));
    child.once('exit',()=>{if(!closed)fail(new CodexError('PROCESS_EXIT'));});
    // Raw output can contain prompts or authentication details: discard stderr and cap both streams.
    const budget=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>32*1024*1024)fail(new CodexError('OUTPUT_LIMIT'));};
    child.stdout!.on('data',budget);child.stderr!.on('data',budget);
    child.stdin!.on('error',()=>fail(new CodexError('PROCESS_EXIT')));
    let text='',image:string|null=null,threadId='',actualModel='',usage:unknown=null;
    lines=createInterface({input:child.stdout!});
    lines.on('line',line=>{
     if(closed)return;let message:any;try{message=JSON.parse(line);}catch{fail(new CodexError('INVALID_PROTOCOL'));return;}
     if(message.id!==undefined){
      const response=pending.get(message.id);
      if(response){pending.delete(message.id);if(message.error)response.reject(new CodexError('PROTOCOL_ERROR'));else response.resolve(message.result);}
      else send({id:message.id,error:{code:-32601,message:'Interactive requests are disabled'}});
      return;
     }
     if(message.params?.threadId&&message.params.threadId!==threadId)return;
     if(message.method==='thread/tokenUsage/updated')usage=message.params.tokenUsage?.last;
     if(message.method==='item/started'||message.method==='item/completed'){
      const item=message.params.item;
      if(['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','imageView','collabAgentToolCall'].includes(item?.type)){fail(new CodexError('UNEXPECTED_TOOL'));return;}
      if(message.method==='item/completed'){
       if(item?.type==='agentMessage')text=item.text||'';
       if(item?.type==='imageGeneration'){
        if(!job?.generateImage||item.status!=='completed'||item.failure||typeof item.result!=='string'||image!==null){fail(new CodexError('IMAGE_UNAVAILABLE'));return;}
        if(item.result.length>17*1024*1024||!item.result.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.result)){fail(new CodexError('INVALID_IMAGE'));return;}
        image=item.result; // Native bytes only. Never read item.savedPath or any model-provided path.
       }
      }
     }
     if(message.method==='turn/completed'){
      if(message.params.turn.status!=='completed'){fail(new CodexError('GENERATION_FAILED'));return;}
      closed=true;resolve({text,image,model:actualModel,requestId:message.params.turn.id,usage});
     }
    });
    void (async()=>{
     try{
      await call('initialize',{clientInfo:{name:'shiqu_local',version:'0.1.0'}});send({method:'initialized',params:{}});
      const account=await call('account/read',{refreshToken:false});
      if(account.account?.type!=='chatgpt')throw new CodexError('CHATGPT_LOGIN_REQUIRED');
      const config=await call('config/read',{});
      if(disabled.some(feature=>config.config?.features?.[feature]!==false)||config.config?.features?.code_mode_host===false||config.config?.features?.image_generation===false)throw new CodexError('UNSAFE_CONFIGURATION');
      if(!job){closed=true;resolve({text:'',image:null,model:'',requestId:'',usage:null});return;}
      const servers=config.config?.mcp_servers||{};
      const thread=await call('thread/start',{cwd:directory,ephemeral:true,approvalPolicy:'never',modelProvider:'openai',...(model?{model}:{}),config:{forced_login_method:'chatgpt',mcp_servers:Object.fromEntries(Object.keys(servers).map(name=>[name,{enabled:false}]))},developerInstructions:job.instructions});
      if(thread.modelProvider!=='openai')throw new CodexError('UNSAFE_CONFIGURATION');
      threadId=thread.thread.id;actualModel=thread.model;
      const scoped=await call('mcpServerStatus/list',{threadId});
      if(scoped.nextCursor||scoped.data?.some((server:any)=>Object.keys(server.tools||{}).length||server.resources?.length||server.resourceTemplates?.length))throw new CodexError('UNSAFE_CONFIGURATION');
      const input:any[]=[{type:'text',text:job.prompt,text_elements:[]}];
      if(job.image)input.push({type:'image',url:`data:${job.image.contentType};base64,${Buffer.from(job.image.bytes).toString('base64')}`});
      await call('turn/start',{threadId,input,...(job.schema?{outputSchema:job.schema}:{})});
     }catch(error){fail(error instanceof CodexError?error:new CodexError('PROTOCOL_ERROR'));}
    })();
   });
   function send(message:Message){if(!closed)child?.stdin?.write(JSON.stringify(message)+'\n');}
   function call(method:string,params:Message={}){return new Promise<any>((resolve,reject)=>{
    if(closed){reject(new CodexError('PROCESS_EXIT'));return;}
    const id=++sequence;pending.set(id,{resolve,reject});send({id,method,params});
   });}
   return await completion;
  }finally{closed=true;if(timer)clearTimeout(timer);kill();lines?.close();
   if(exited){let cleanupTimer:ReturnType<typeof setTimeout>|undefined;await Promise.race([exited,new Promise<void>(resolve=>{cleanupTimer=setTimeout(resolve,1000);})]);if(cleanupTimer)clearTimeout(cleanupTimer);}
   await rm(directory,{recursive:true,force:true});
  }
 }
 return {
  async status(){try{await execute();return {configured:true};}catch(error){return {configured:false,reason:error instanceof CodexError?error.message:'CLI_UNAVAILABLE'};}},
  async run(job){return (await execute(job))!;},
 };
}
