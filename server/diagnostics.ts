// Persist only projected application metadata, never arbitrary stderr, prompts, credentials or paths.
// Logging is best-effort and bounded; diagnostic exports are re-projected even if local files were edited.
import {DatabaseSync} from 'node:sqlite';
import {constants,existsSync,mkdirSync,lstatSync,openSync,writeSync,closeSync,renameSync,rmSync,readFileSync,chmodSync,fchmodSync} from 'node:fs';
import path from 'node:path';
import {geminiResponseDiagnostic} from '../lib/reader-gemini-diagnostics.ts';
import {responsesDiagnostic} from '../lib/reader-responses-diagnostics.ts';

export const diagnosticLimit=128*1024;
const names=new Set(['service_started','service_stopped','service_start_failed','service_uncaught','request_failed','codex_generation_error','claude_generation_error','reader_generation_error','gemini_request_rejected','gemini_response','deepseek_response','deepseek_request_failed','production_job_unreadable','production_job_unsaved','production_story_unreadable','production_tick_failed','story_discovery_search']);
const claudeCodes=new Set(['CLAUDE_LOGIN_REQUIRED','SUBSCRIPTION_REQUIRED','CLI_UNAVAILABLE','RATE_LIMITED','INVALID_MODEL','INVALID_REASONING_EFFORT','INVALID_PROTOCOL','UNSAFE_CONFIGURATION','UNEXPECTED_TOOL','GENERATION_FAILED','PROCESS_EXIT','OUTPUT_LIMIT','TEXT_ONLY']);
const geminiCodes=new Set(['INVALID_OUTPUT','PROVIDER_ERROR','SCHEMA_TOO_COMPLEX','UNSUPPORTED_FIELD','UNSUPPORTED_REASONING_EFFORT','SOURCE_UNAVAILABLE','INVALID_SOURCE','CONTENT_BLOCKED','INVALID_MODEL','INCOMPLETE_RESPONSE','INVALID_TEXT','INVALID_JSON']);
const responsesCodes=new Set(['KEY_REQUIRED','INVALID_MODEL','INCOMPLETE_RESPONSE','INVALID_OUTPUT','REFUSED','MODEL_UNAVAILABLE','PROVIDER_ERROR','TIMEOUT','EDITORIAL_SOURCE_QUOTE','EDITORIAL_COVERAGE_REQUIRED','FRAME_COUNT_REVIEW_SCOPE']);
const providerStatuses=new Set(['INVALID_ARGUMENT','FAILED_PRECONDITION','OUT_OF_RANGE','UNAUTHENTICATED','PERMISSION_DENIED','NOT_FOUND','RESOURCE_EXHAUSTED','CANCELLED','INTERNAL','UNKNOWN','UNAVAILABLE','DEADLINE_EXCEEDED']);
const rejectionReasons=new Set(['SCHEMA_TOO_COMPLEX','UNSUPPORTED_FIELD']);
const codes=new Set(['UNKNOWN','Error','TypeError','RangeError','SyntaxError','AbortError','ReaderError','CodexError','ClaudeError','ZodError','ENOENT','EACCES','EPERM','EIO','ENOSPC','EMFILE','EROFS','EBUSY','EADDRINUSE','DATA_BUSY','INVALID_OUTPUT','TIMEOUT','MODEL_UNAVAILABLE','REASONING_EFFORT_UNAVAILABLE','INTERRUPTED','SQLITE_BUSY','SQLITE_ERROR','SQLITE_CORRUPT','ERR_SQLITE_ERROR']);
type Event={time:string;event:string;code?:string;id?:string;[key:string]:string|number|undefined};
function project(event:string,value:unknown={},time=new Date().toISOString()):Event|undefined{
 if(!names.has(event)||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(time))return;
 const raw=value&&typeof value==='object'?value as Record<string,unknown>:{code:value},out:Event={time,event};
 if(event==='gemini_response')Object.assign(out,geminiResponseDiagnostic(raw));
 if(event==='deepseek_response')Object.assign(out,responsesDiagnostic(raw));
 if(raw.code!==undefined)out.code=typeof raw.code==='string'&&(codes.has(raw.code)||event==='claude_generation_error'&&claudeCodes.has(raw.code)||event==='reader_generation_error'&&geminiCodes.has(raw.code)||event==='deepseek_request_failed'&&responsesCodes.has(raw.code))?raw.code:'UNKNOWN';
 if(['reader_generation_error','deepseek_request_failed'].includes(event)&&typeof raw.status==='number'&&Number.isInteger(raw.status)&&raw.status>=100&&raw.status<=599)out.status=raw.status;
 if(event==='gemini_request_rejected'){
  if(typeof raw.httpStatus==='number'&&Number.isInteger(raw.httpStatus)&&raw.httpStatus>=100&&raw.httpStatus<=599)out.httpStatus=raw.httpStatus;
  if(typeof raw.status==='string'&&providerStatuses.has(raw.status))out.status=raw.status;
  if(typeof raw.reason==='string'&&rejectionReasons.has(raw.reason))out.reason=raw.reason;
  if(typeof raw.task==='string'&&['suggest','art','frames','outline','plan','review','repair','image'].includes(raw.task))out.task=raw.task;
 }
 if(typeof raw.id==='string'&&/^(?:[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(raw.id))out.id=raw.id;
 if(event!=='deepseek_response')for(const name of ['calls','isolationCalls','inputTokens','outputTokens','unknownUsage','firstStoredMs','firstMatchMs'])if(typeof raw[name]==='number'&&Number.isFinite(raw[name])&&raw[name]>=0)out[name]=raw[name];
 return out;
}
function folder(directory:string){
 const result=path.join(directory,'.diagnostics');mkdirSync(result,{recursive:true,mode:0o700});
 const info=lstatSync(result);if(!info.isDirectory()||info.isSymbolicLink())throw Error('DIAGNOSTICS_UNSAFE');if(process.platform!=='win32')chmodSync(result,0o700);return result;
}
function regular(filename:string){try{const info=lstatSync(filename);if(!info.isFile()||info.isSymbolicLink())throw Error('DIAGNOSTICS_UNSAFE');return info;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
export function recordDiagnostic(directory:string,event:string,value:unknown={}){
 const entry=project(event,value);if(!entry)return false;
 try{
  const directoryName=folder(directory),file=path.join(directoryName,'events.jsonl'),previous=file+'.1',line=JSON.stringify(entry)+'\n';
  const info=regular(file);regular(previous);
  if(info&&info.size+Buffer.byteLength(line)>diagnosticLimit){rmSync(previous,{force:true});renameSync(file,previous);}
  const fd=openSync(file,constants.O_APPEND|constants.O_CREAT|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{if(process.platform!=='win32')fchmodSync(fd,0o600);writeSync(fd,line);}finally{closeSync(fd);}return true;
 }catch{return false;}
}
export function safeErrorCode(error:unknown){const value=error as {code?:unknown;name?:unknown};return typeof value?.code==='string'&&codes.has(value.code)?value.code:typeof value?.name==='string'&&codes.has(value.name)?value.name:'UNKNOWN';}
export function installDiagnostics(directory:string){
 const originals={error:console.error,warn:console.warn,info:console.info};
 const wrappers={} as typeof originals;
 for(const level of ['error','warn','info'] as const){
  const wrapper=(...args:unknown[])=>{
   if(typeof args[0]==='string'&&names.has(args[0])){
    let value:unknown=args[1];try{if(typeof value==='string'&&value.length<=16384&&value.startsWith('{'))value=JSON.parse(value);}catch{value={};}
    recordDiagnostic(directory,args[0],typeof value==='string'?{code:value}:value);
   }
   originals[level](...args);
  };
  wrappers[level]=wrapper;console[level]=wrapper;
 }
 const uncaught=(error:unknown)=>{recordDiagnostic(directory,'service_uncaught',{code:safeErrorCode(error)});};
 process.on('uncaughtExceptionMonitor',uncaught);
 return ()=>{for(const level of ['error','warn','info'] as const)if(console[level]===wrappers[level])console[level]=originals[level];process.off('uncaughtExceptionMonitor',uncaught);};
}
export function diagnosticReport(directory:string,appVersion:string){
 const events:Event[]=[];let logsAvailable=true;
 try{
  const logDirectory=path.join(directory,'.diagnostics');const info=lstatSync(logDirectory);if(!info.isDirectory()||info.isSymbolicLink())throw Error();
  for(const name of ['events.jsonl.1','events.jsonl']){
   const filename=path.join(logDirectory,name),info=regular(filename);if(!info)continue;if(info.size>diagnosticLimit)throw Error();
   const fd=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{for(const line of readFileSync(fd,'utf8').split('\n')){try{const raw=JSON.parse(line),entry=project(raw.event,raw,raw.time);if(entry)events.push(entry);}catch{/* Ignore torn or unrecognized records. */}}}finally{closeSync(fd);}
  }
 }catch{logsAvailable=false;}
 const database:{status:string;code?:string;sessions?:number;jobs?:number;failedJobs?:number;pendingFaults?:number}={status:'missing'};
 const filename=path.join(directory,'shiqu.sqlite');let db:DatabaseSync|undefined;
 try{
  if(existsSync(filename)){
   const info=lstatSync(filename);if(!info.isFile()||info.isSymbolicLink())throw Error();db=new DatabaseSync(filename,{readOnly:true});db.exec('PRAGMA busy_timeout=1000');
   database.status=db.prepare('PRAGMA quick_check').all().every(row=>row.quick_check==='ok')?'ok':'corrupt';
   const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
   if(tables.has('stories'))database.sessions=Number(db.prepare('SELECT count(*) AS n FROM stories').get()!.n);
   if(tables.has('production_jobs')){database.jobs=Number(db.prepare('SELECT count(*) AS n FROM production_jobs').get()!.n);database.failedJobs=Number(db.prepare("SELECT count(*) AS n FROM production_jobs WHERE state='failed'").get()!.n);}
   if(tables.has('production_faults'))database.pendingFaults=Number(db.prepare("SELECT count(*) AS n FROM production_faults WHERE state='pending'").get()!.n);
  }
 }catch(error){database.status='unreadable';database.code=safeErrorCode(error);}finally{db?.close();}
 return {format:'shiqu-diagnostics',version:1,createdAt:new Date().toISOString(),appVersion:/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(appVersion)?appVersion:'unknown',runtime:{node:process.versions.node,platform:process.platform,arch:process.arch},database,logsAvailable,events:events.slice(-500)};
}
