// Run subscription-authenticated Claude Code as an isolated text transport for production jobs.
// Never inherit API billing, tools or project customizations; retain only validated protocol receipts.
import {beforePaidSend,PaidDispatchDenied,recordPaidResponse} from './paid-dispatch.ts';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import type {CodexJob,CodexResult,CodexRunner} from './codex-runner.ts';
import {codexGenerationTimeoutMs,codexReasoningEffortSchema} from '../lib/codex-settings.ts';

export class ClaudeError extends Error{inferenceStarted=false;usage?:unknown;constructor(code:string){super(code);this.name='ClaudeError';}}
const children=new Set<ReturnType<typeof spawn>>();
function kill(child:ReturnType<typeof spawn>){if(!child.pid)return;try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{/* Already stopped. */}}
export async function stopClaudeProcesses(){await Promise.all([...children].map(child=>new Promise<void>(resolve=>{child.once('close',()=>resolve());kill(child);})));}
export function claudeEnvironment(source:NodeJS.ProcessEnv=process.env){
 const names=['PATH','HOME','USER','LOGNAME','SHELL','USERPROFILE','APPDATA','LOCALAPPDATA','TMPDIR','TEMP','TMP','LANG','SSL_CERT_FILE','NODE_EXTRA_CA_CERTS','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','CLAUDE_CONFIG_DIR'];
 return {...Object.fromEntries(names.filter(name=>source[name]).map(name=>[name,source[name]])),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
}
const isolation=['--safe-mode','--setting-sources','','--settings',JSON.stringify({forceLoginMethod:'claudeai',disableAllHooks:true})];
export function createClaudeRunner(variables:Record<string,string|undefined>,options:{environment?:NodeJS.ProcessEnv;timeoutMs?:number}={}):CodexRunner{
 const binary=variables.CLAUDE_BIN?.trim()||'claude',model=variables.CLAUDE_MODEL?.trim()||'opus';
 if(!/^[\w.-]{1,100}$/.test(model))throw new ClaudeError('INVALID_MODEL');
 const env=claudeEnvironment({...options.environment||process.env,...(variables.CLAUDE_CONFIG_DIR?{CLAUDE_CONFIG_DIR:variables.CLAUDE_CONFIG_DIR}:{})});
 let resolvedModel:string|undefined;
 async function execute(args:string[],directory:string,input:string,timeoutMs:number,onLine?:(line:string)=>void){
  return new Promise<{code:number|null;text:string}>((resolve,reject)=>{
   if(onLine)beforePaidSend();
   const child=spawn(binary,args,{cwd:directory,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
   children.add(child);let text='',bytes=0,failure:Error|undefined;
   const fail=(error:Error)=>{failure??=error;kill(child);};
   const timer=setTimeout(()=>fail(new ClaudeError('TIMEOUT')),timeoutMs);
   const budget=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>32*1024*1024)fail(new ClaudeError('OUTPUT_LIMIT'));};
   const lines=onLine?createInterface({input:child.stdout!}):undefined;
   lines?.on('line',line=>{if(failure)return;try{onLine!(line);}catch(error){fail(error instanceof ClaudeError?error:new ClaudeError('INVALID_PROTOCOL'));}});
   child.stdout!.on('data',(chunk:Buffer)=>{budget(chunk);if(!onLine&&!failure)text+=chunk.toString('utf8');});
   // stderr may contain source text or credentials. Bound and discard it.
   child.stderr!.on('data',budget);child.once('error',()=>fail(new ClaudeError('CLI_UNAVAILABLE')));
   child.stdin!.on('error',()=>fail(new ClaudeError('PROCESS_EXIT')));
   child.once('close',code=>{clearTimeout(timer);lines?.close();children.delete(child);if(failure)reject(failure);else resolve({code,text});});
   child.stdin!.end(input);
  });
 }
 async function auth(directory:string){
  const result=await execute([...isolation,'auth','status'],directory,'',Math.min(options.timeoutMs||10000,10000));
  let status:any;try{status=JSON.parse(result.text);}catch{throw new ClaudeError('INVALID_PROTOCOL');}
  if(!status.loggedIn)throw new ClaudeError('CLAUDE_LOGIN_REQUIRED');
  if(result.code!==0||status.authMethod!=='claude.ai'||status.apiProvider!=='firstParty')throw new ClaudeError('SUBSCRIPTION_REQUIRED');
 }
 return {
  async status(){
   const directory=await mkdtemp(path.join(tmpdir(),'shiqu-claude-status-'));
   try{await auth(directory);return {configured:true,model:resolvedModel||model};}
   catch(error){return {configured:false,reason:error instanceof ClaudeError?error.message:'CLI_UNAVAILABLE'};}
   finally{await rm(directory,{recursive:true,force:true});}
  },
  async run(job:CodexJob):Promise<CodexResult>{
   if(job.generateImage||job.image)throw new ClaudeError('TEXT_ONLY');
   const requested=job.model||model,effort=codexReasoningEffortSchema.safeParse(job.reasoningEffort??'');
   if(!/^[\w.-]{1,100}$/.test(requested))throw new ClaudeError('INVALID_MODEL');
   if(!effort.success)throw new ClaudeError('INVALID_REASONING_EFFORT');
   const directory=await mkdtemp(path.join(tmpdir(),'shiqu-claude-'));let started=false,usage:unknown;
   try{
    await auth(directory);
    const instructions=path.join(directory,'instructions.txt');await writeFile(instructions,job.instructions,{mode:0o600});
    const args=[...isolation,'--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--print','--output-format','stream-json','--verbose','--tools','','--disable-slash-commands','--no-session-persistence','--no-chrome','--permission-mode','dontAsk','--model',requested,'--system-prompt-file',instructions];
    if(effort.data)args.push('--effort',effort.data);
    if(job.schema)args.push('--json-schema',JSON.stringify(job.schema));
    let initialized=false,actualModel='',result:any,answer='';
    const output=await execute(args,directory,job.prompt,Math.min(options.timeoutMs||codexGenerationTimeoutMs,job.timeoutMs||codexGenerationTimeoutMs),line=>{
     const message=JSON.parse(line);
     if(message.type==='system'&&message.subtype==='init'){
      if(initialized||(message.tools||[]).some((tool:string)=>tool!=='StructuredOutput')||(message.mcp_servers||[]).length)throw new ClaudeError('UNSAFE_CONFIGURATION');
      initialized=true;started=true;
     }
     if(message.type==='assistant'){
      // CLI service failures use a synthetic assistant with no model receipt.
      if(message.error)throw new ClaudeError(message.error==='rate_limit'?'RATE_LIMITED':message.error==='authentication_failed'?'CLAUDE_LOGIN_REQUIRED':'GENERATION_FAILED');
      const value=message.message;
      if(typeof value?.model!=='string'||!/^[\w.-]{1,100}$/.test(value.model))throw new ClaudeError('INVALID_PROTOCOL');
      if(actualModel&&actualModel!==value.model)throw new ClaudeError('MODEL_UNAVAILABLE');
      actualModel=value.model;
      for(const block of value.content||[]){
       if(block.type==='tool_use'&&!(job.schema&&block.name==='StructuredOutput'))throw new ClaudeError('UNEXPECTED_TOOL');
       if(block.type==='text')answer+=block.text;
      }
     }
     if(message.type==='result'){if(result)throw new ClaudeError('INVALID_PROTOCOL');result=message;usage=message.usage;}
    });
    if(result)recordPaidResponse({requestId:result.session_id,usage});
    if(output.code!==0||!initialized||!result||result.is_error||result.subtype!=='success')throw new ClaudeError('GENERATION_FAILED');
    if(!actualModel||requested.startsWith('claude-')&&actualModel!==requested)throw new ClaudeError('MODEL_UNAVAILABLE');
    if(!result.modelUsage||!Object.hasOwn(result.modelUsage,actualModel)||typeof result.session_id!=='string'||!result.session_id)throw new ClaudeError('INVALID_PROTOCOL');
    const text=job.schema?JSON.stringify(result.structured_output):result.result||answer;
    if(!text||typeof text!=='string')throw new ClaudeError('INVALID_OUTPUT');
    // Effort is the CLI request value, not a provider-confirmed thinking budget.
    resolvedModel=actualModel;
    return {text,image:null,model:actualModel,requestId:result.session_id,usage:{...result.usage,modelUsage:result.modelUsage,totalCostUsd:result.total_cost_usd,durationMs:result.duration_ms,numTurns:result.num_turns},...(effort.data?{reasoningEffort:effort.data}:{})};
   }catch(error){if(error instanceof PaidDispatchDenied)throw error;const safe=error instanceof ClaudeError?error:new ClaudeError('INVALID_OUTPUT');safe.inferenceStarted=started;safe.usage=usage;throw safe;}
   finally{await rm(directory,{recursive:true,force:true});}
  },
 };
}
