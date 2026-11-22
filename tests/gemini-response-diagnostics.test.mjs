// Capture real adapter finish metadata before output rejection, with a re-projected private log.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createReaderProvider} from '../server/generation.ts';
import {installDiagnostics,diagnosticReport} from '../server/diagnostics.ts';
import {geminiResponseDiagnostic} from '../lib/reader-gemini-diagnostics.ts';

test('MAX_TOKENS retains finish reason and thinking/output usage before rejecting the paid result',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu-gemini-response-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const originals={info:console.info,error:console.error};console.info=()=>{};console.error=()=>{};const restore=installDiagnostics(directory);
 const secret='sk-private-secret /Users/private 原文敏感';
 try{
  const provider=createReaderProvider({SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:secret},{},async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:secret}]}}],usageMetadata:{promptTokenCount:48000,thoughtsTokenCount:23990,candidatesTokenCount:10,totalTokenCount:72000,cachedContentTokenCount:0,secret}}));
  await assert.rejects(provider.generator().textCall('review','指令',{},{type:'object',properties:{},additionalProperties:false},24000),error=>{provider.safeError(error);return error.message==='INCOMPLETE_RESPONSE';});
 }finally{restore();Object.assign(console,originals);}
 const report=diagnosticReport(directory,'0.8.0'),event=report.events.find(event=>event.event==='gemini_response');
 assert.equal(event.finishReason,'MAX_TOKENS');assert.equal(event.task,'review');assert.equal(event.maxOutputTokens,24000);assert.equal(event.thinkingLevel,'HIGH');
 assert.equal(event.promptTokenCount,48000);assert.equal(event.thoughtsTokenCount,23990);assert.equal(event.candidatesTokenCount,10);assert.equal(event.totalTokenCount,72000);assert.equal(event.cachedContentTokenCount,0);assert.ok(event.elapsedMs>=0);
 const filename=path.join(directory,'.diagnostics/events.jsonl');assert.doesNotMatch(await readFile(filename,'utf8'),/sk-private|Users|原文|敏感/);
 await writeFile(filename,JSON.stringify({...event,finishReason:secret,promptTokenCount:secret,candidatesTokenCount:-1,thoughtsTokenCount:1.5,task:secret,thinkingLevel:secret,text:secret})+'\n');
 const hostile=diagnosticReport(directory,'0.8.0').events[0];assert.equal(hostile.finishReason,'UNKNOWN');assert.equal(hostile.promptTokenCount,undefined);assert.equal(hostile.thoughtsTokenCount,undefined);assert.doesNotMatch(JSON.stringify(hostile),/sk-private|Users|原文|敏感/);
});
test('response metadata keeps zero counters and distinguishes absent candidates without storing arbitrary fields',()=>{
 assert.deepEqual(geminiResponseDiagnostic({finishReason:'NO_CANDIDATE',promptTokenCount:0,candidatesTokenCount:0,thoughtsTokenCount:NaN,totalTokenCount:Infinity,toolUsePromptTokenCount:2,message:'private'}),{finishReason:'NO_CANDIDATE',promptTokenCount:0,candidatesTokenCount:0,toolUsePromptTokenCount:2});
 for(const finishReason of ['STOP','MALFORMED_RESPONSE','ESCALATION'])assert.equal(geminiResponseDiagnostic({finishReason}).finishReason,finishReason);
});
