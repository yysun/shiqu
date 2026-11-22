// Keep incomplete DeepSeek status and usage observable without retaining arbitrary response content.
import test from'node:test';import assert from'node:assert/strict';
import{mkdtemp,readFile,writeFile,rm}from'node:fs/promises';import path from'node:path';import os from'node:os';
import{createReaderProvider}from'../server/generation.ts';
import{installDiagnostics,diagnosticReport}from'../server/diagnostics.ts';
import{responsesDiagnostic}from'../lib/reader-responses-diagnostics.ts';

test('DeepSeek records incomplete reason and thinking usage before rejecting an answer, then reprojects hostile logs',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu-deepseek-response-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const originals={info:console.info,error:console.error};console.info=()=>{};console.error=()=>{};const restore=installDiagnostics(directory),secret='private-key /Users/private 原文';
 try{
  const provider=createReaderProvider({SHIQU_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:secret},{},async()=>Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:48000,output_tokens:32768,output_tokens_details:{reasoning_tokens:32768},input_tokens_details:{cached_tokens:0}},output:[{text:secret}],model:secret}));
  await assert.rejects(provider.generator().textCall('outline','指令',{},{type:'object',properties:{},additionalProperties:false},8192),error=>{provider.safeError(error);return error.message==='INCOMPLETE_RESPONSE';});
 }finally{restore();Object.assign(console,originals);}
 const report=diagnosticReport(directory,'0.8.5'),event=report.events.find(e=>e.event==='deepseek_response');
 assert.equal(event.status,'incomplete');assert.equal(event.incompleteReason,'max_output_tokens');assert.equal(event.outputTokens,32768);assert.equal(event.reasoningTokens,32768);assert.equal(event.maxOutputTokens,32768);assert.equal(event.reasoningEffort,'high');assert.equal(event.cachedInputTokens,0);
 assert.equal(report.events.find(e=>e.event==='deepseek_request_failed').code,'INCOMPLETE_RESPONSE');
 const file=path.join(directory,'.diagnostics/events.jsonl');assert.doesNotMatch(await readFile(file,'utf8'),/private-key|Users|原文/);
 await writeFile(file,JSON.stringify({...event,status:secret,incompleteReason:secret,reasoningEffort:secret,outputTokens:0.5,reasoningTokens:0.5,model:secret,output:secret})+'\n');
 const hostile=diagnosticReport(directory,'0.8.5').events[0];assert.equal(hostile.status,'UNKNOWN');assert.equal(hostile.incompleteReason,'UNKNOWN');assert.equal(hostile.outputTokens,undefined);assert.equal(hostile.reasoningTokens,undefined);assert.doesNotMatch(JSON.stringify(hostile),/private-key|Users|原文/);
});
test('Responses diagnostics preserve zero counts and ignore arbitrary fields',()=>{
 assert.deepEqual(responsesDiagnostic({status:'completed',inputTokens:0,outputTokens:0,reasoningTokens:NaN,model:'private',text:'private'}),{status:'completed',inputTokens:0,outputTokens:0});
});
