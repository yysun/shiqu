// 适配器与配置契约使用受控输入；真实启动和制作流程由独立文件覆盖。
import {PaidDispatchDenied,withPaidDispatch} from '../server/paid-dispatch.ts';
import test from 'node:test';

import assert from 'node:assert/strict';

import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';

import path from 'node:path';

import os from 'node:os';

import {createClaudeRunner,ClaudeError,claudeEnvironment,stopClaudeProcesses} from '../server/claude-runner.ts';

import {createReaderProvider,safeClaudeError} from '../server/generation.ts';

import {effectiveProviderVariables,providerReady} from '../server/cli-setup.ts';

import {defaultSystemSettings} from '../lib/system-settings.ts';

import {until} from './fixtures/production.mjs';

import {installDiagnostics,diagnosticReport,safeErrorCode} from '../server/diagnostics.ts';

async function fakeCli(t,mode='success'){
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu claude test ')),binary=path.join(directory,'claude'),log=path.join(directory,'calls.jsonl');
 t.after(async()=>{await stopClaudeProcesses();await rm(directory,{recursive:true,force:true});});
 const code=`#!${process.execPath}
import {appendFileSync,readFileSync} from 'node:fs';
const args=process.argv.slice(2),at=key=>args[args.indexOf(key)+1],mode=${JSON.stringify(mode)};
let input='';for await(const chunk of process.stdin)input+=chunk;
appendFileSync(${JSON.stringify(log)},JSON.stringify({args,input,pid:process.pid,cwd:process.cwd(),instructions:args.includes('--system-prompt-file')?readFileSync(at('--system-prompt-file'),'utf8'):null,envNames:Object.keys(process.env)})+'\\n');
if(args.includes('auth')){console.log(JSON.stringify({loggedIn:mode!=='signed-out',authMethod:mode==='api'?'api_key':'claude.ai',apiProvider:'firstParty'}));process.exit(mode==='signed-out'?1:0);}
const emit=value=>console.log(JSON.stringify(value));
emit({type:'system',subtype:'init',tools:mode==='unsafe'?['Bash']:[],mcp_servers:[],model:'claude-test'});
if(mode==='hang'){setInterval(()=>{},1000);}
else if(mode==='oversize'){console.log('x'.repeat(33*1024*1024));}
else if(mode==='malformed'){console.log('private raw error and key');}
else{
 emit({type:'assistant',...(mode==='rate-limit'?{error:'rate_limit'}:{}),message:{model:mode==='rate-limit'?'<synthetic>':mode==='wrong-model'?'claude-other':'claude-test',content:mode==='tool'?[{type:'tool_use',name:'Bash',input:{}}]:[{type:'text',text:'hello'}]}});
 emit({type:'result',subtype:mode==='error'?'error_during_execution':'success',is_error:mode==='error',session_id:'fixture-request',usage:{input_tokens:10,output_tokens:5},modelUsage:{'claude-test':{inputTokens:10,outputTokens:5}},...(mode==='missing-output'?{}:{structured_output:{answer:'ok'}}),result:'hello',total_cost_usd:0.01,duration_ms:10,num_turns:1});
 if(mode==='nonzero')process.exitCode=2;
}
`;
 await writeFile(binary,code,{mode:0o700});
 const calls=async()=>{try{return (await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 return {binary,calls};
}

const job={instructions:'Production instructions',prompt:'Private source text',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false},reasoningEffort:'high'};

test('Claude failures survive production diagnostic export without raw data or arbitrary error codes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu claude diagnostics '));t.after(()=>rm(directory,{recursive:true,force:true}));
 const original=console.error;console.error=()=>{};const restore=installDiagnostics(directory);
 try{safeClaudeError(new ClaudeError('CLAUDE_LOGIN_REQUIRED'));safeClaudeError(new ClaudeError('INVALID_PROTOCOL'));assert.match(safeClaudeError(new ClaudeError('RATE_LIMITED')),/额度/);console.error('claude_generation_error',JSON.stringify({code:'private-key /Users/private 原文',stderr:'private-key',prompt:'原文'}));}
 finally{restore();console.error=original;}
 const report=diagnosticReport(directory,'0.8.5');assert.deepEqual(report.events.map(event=>event.code),['CLAUDE_LOGIN_REQUIRED','INVALID_PROTOCOL','RATE_LIMITED','UNKNOWN']);assert.equal(safeErrorCode(new ClaudeError('INVALID_PROTOCOL')),'ClaudeError');
 const filename=path.join(directory,'.diagnostics/events.jsonl');assert.doesNotMatch(await readFile(filename,'utf8'),/private-key|Users|原文/);
 await writeFile(filename,JSON.stringify({...report.events[0],code:'private-key',stderr:'private-key',prompt:'原文'})+'\n');assert.doesNotMatch(JSON.stringify(diagnosticReport(directory,'0.8.5')),/private-key|Users|原文/);
});

test('Claude subprocess preserves structured result, actual model and usage with no inherited billing or tools',async t=>{
 const fake=await fakeCli(t),environment={...process.env,ANTHROPIC_API_KEY:'never-forward',ANTHROPIC_BASE_URL:'https://invalid',CLAUDE_CODE_USE_BEDROCK:'1',CLAUDE_CODE_OAUTH_TOKEN:'never-forward',CLAUDE_CODE_SIMPLE:'1',CLAUDE_CONFIG_DIR:'/explicit-claude-config'};
 const runner=createClaudeRunner({CLAUDE_BIN:fake.binary,CLAUDE_MODEL:'claude-test'},{environment});
 assert.deepEqual(await runner.status(),{configured:true,model:'claude-test'});
 const receipt=await runner.run(job);assert.deepEqual(JSON.parse(receipt.text),{answer:'ok'});assert.equal(receipt.model,'claude-test');assert.equal(receipt.reasoningEffort,'high');assert.equal(receipt.requestId,'fixture-request');assert.equal(receipt.usage.input_tokens,10);assert.equal(receipt.image,null);
 const calls=await fake.calls(),inference=calls.filter(call=>!call.args.includes('auth'));assert.equal(inference.length,1);const call=inference[0],at=key=>call.args[call.args.indexOf(key)+1];
 assert.equal(call.input,job.prompt);assert.equal(call.instructions,job.instructions);assert.equal(at('--tools'),'');assert.equal(at('--effort'),'high');assert.equal(at('--setting-sources'),'');assert.equal(at('--permission-mode'),'dontAsk');assert.deepEqual(JSON.parse(at('--mcp-config')),{mcpServers:{}});assert.equal(JSON.parse(at('--settings')).forceLoginMethod,'claudeai');assert.equal(JSON.parse(at('--settings')).disableAllHooks,true);
 for(const flag of ['--safe-mode','--strict-mcp-config','--no-session-persistence','--disable-slash-commands','--no-chrome'])assert.ok(call.args.includes(flag));
 assert.ok(!call.args.includes('--bare'));assert.ok(!call.args.includes(job.prompt));assert.ok(!call.args.includes(job.instructions));assert.deepEqual(call.envNames.filter(name=>/^(ANTHROPIC|CLAUDE_CODE_(?:USE|OAUTH|SIMPLE))/.test(name)),[]);
 assert.equal(claudeEnvironment(environment).CLAUDE_CONFIG_DIR,'/explicit-claude-config');await assert.rejects(readFile(path.join(call.cwd,'instructions.txt')),error=>error.code==='ENOENT');
});

test('Claude auth rejects missing subscription or API credentials before inference',async t=>{
 for(const [mode,reason] of [['signed-out','CLAUDE_LOGIN_REQUIRED'],['api','SUBSCRIPTION_REQUIRED']]){
  const fake=await fakeCli(t,mode),runner=createClaudeRunner({CLAUDE_BIN:fake.binary});assert.deepEqual(await runner.status(),{configured:false,reason});
  await assert.rejects(runner.run(job),error=>error.message===reason);assert.ok((await fake.calls()).every(call=>call.args.includes('auth')));
 }
 assert.equal((await createClaudeRunner({CLAUDE_BIN:'/does-not-exist'}).status()).reason,'CLI_UNAVAILABLE');
});

test('Claude validates models, efforts and text-only jobs before spawning',async()=>{
 assert.throws(()=>createClaudeRunner({CLAUDE_MODEL:'bad model'}),/INVALID_MODEL/);
 const runner=createClaudeRunner({CLAUDE_BIN:'/must-not-spawn'});
 for(const input of [{...job,model:'bad model'},{...job,reasoningEffort:'invalid'}])await assert.rejects(runner.run(input),/INVALID_/);
 for(const input of [{...job,generateImage:true},{...job,image:{bytes:new Uint8Array(),contentType:'image/png'}}])await assert.rejects(runner.run(input),/TEXT_ONLY/);
});

test('Claude rejects invalid protocol, unsafe tools, model changes and failed results',async t=>{
 for(const [mode,code] of [['malformed','INVALID_PROTOCOL'],['unsafe','UNSAFE_CONFIGURATION'],['tool','UNEXPECTED_TOOL'],['wrong-model','MODEL_UNAVAILABLE'],['rate-limit','RATE_LIMITED'],['error','GENERATION_FAILED'],['nonzero','GENERATION_FAILED'],['missing-output','INVALID_OUTPUT'],['oversize','OUTPUT_LIMIT']]){
  const fake=await fakeCli(t,mode),runner=createClaudeRunner({CLAUDE_BIN:fake.binary,CLAUDE_MODEL:'claude-test'});
  await assert.rejects(runner.run(job),error=>error instanceof ClaudeError&&error.message===code,mode);
 }
});

test('Claude timeout and explicit shutdown kill outstanding children and preserve safe inference state',async t=>{
 const fake=await fakeCli(t,'hang'),runner=createClaudeRunner({CLAUDE_BIN:fake.binary},{timeoutMs:1000});
 await assert.rejects(runner.run(job),error=>error.message==='TIMEOUT'&&error.inferenceStarted);
 const pending=createClaudeRunner({CLAUDE_BIN:fake.binary}).run(job),rejected=assert.rejects(pending,/GENERATION_FAILED/);
 await until(async()=>(await fake.calls()).filter(call=>!call.args.includes('auth')).length===2);
 await stopClaudeProcesses();await rejected;
 for(const call of (await fake.calls()).filter(call=>!call.args.includes('auth')))assert.throws(()=>process.kill(call.pid,0),error=>error.code==='ESRCH');
});

test('Claude invocation-only configuration preserves desktop profile and matches using its own model',async()=>{
 const saved=defaultSystemSettings('/isolated'),store={settings:()=>saved,key:()=>assert.fail('Claude must not load a saved API key')};
 const effective=effectiveProviderVariables(store,{SHIQU_AI_PROVIDER:'claude',CLAUDE_MODEL:'claude-test'});assert.equal(effective.SHIQU_AI_PROVIDER,'claude');assert.equal(providerReady(effective),true);assert.equal(saved.provider,'gemini');
 let seen;const runner={status:async()=>({configured:true,model:'claude-test'}),run:async input=>{seen=input;return {text:JSON.stringify({matches:[{id:1,verdict:'yes',reason:'原文支持。'}]}),model:'claude-test',requestId:'fixture',usage:{}};}};
 const provider=createReaderProvider(effective,{},fetch,runner),status=await provider.status();assert.equal(status.provider,'claude');assert.equal(status.models.image,'');assert.equal(status.themeMatching.model,'claude-test');
 await provider.matchStories('主题',[{id:'a'.repeat(64),title:'故事',text:'原文'}]);assert.equal(seen.model,'claude-test');
 await assert.rejects(provider.generator().image({},0,'id'),/TEXT_ONLY/);
 assert.match(safeClaudeError(new ClaudeError('CLAUDE_LOGIN_REQUIRED')),/claude auth login/);
});

for(const decision of ['yield','obsolete'])test(`Claude fences the ${decision} prompted process after the free login check`,async t=>{
 const fake=await fakeCli(t),runner=createClaudeRunner({CLAUDE_BIN:fake.binary});
 const deny=new PaidDispatchDenied(decision);
 await assert.rejects(withPaidDispatch({authorize:()=>{throw deny;},receipt:()=>assert.fail('no paid receipt')},
  ()=>runner.run(job)),error=>error===deny);
 const calls=await fake.calls();
 assert.equal(calls.length,1);
 assert.ok(calls[0].args.includes('auth'));
});
