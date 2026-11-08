// PR 执行同一份影响计划；快层与全层分进程隔离开关，记录实际文件、平台排除及失败结果。
// --related 为开发内循环：按直接导入者、路径字面量与 covers 反查相关测试，全部快速开关且不写证据。
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {createPlan,createRelatedPlan,changeScope,fallbackScope,fullScope} from './test-plan.mjs';
import {detectScope} from './ci-scope.mjs';
import {sourceIdentity} from './test-source.mjs';
import {warnNodeVersion} from './node-version.mjs';
import {loadMetadata} from './test-metadata.mjs';

// 工作区改动：已暂存、未暂存及未跟踪文件，改名按删除与新增两端处理。
export function workingTreeFiles(root=process.cwd()){
 const options={cwd:root,encoding:'utf8',maxBuffer:16*1024*1024};
 const changed=execFileSync('git',['diff','HEAD','--no-renames','--name-only','-z'],options);
 const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','-z'],options);
 return [...new Set((changed+untracked).split('\0').filter(Boolean))];
}
export function inputScope(args,env=process.env){
 if(args.includes('--full'))return fullScope('explicit full qualification');
 if(args.includes('--changed')){
  try{return changeScope(workingTreeFiles());}catch{return fallbackScope('working-tree comparison failed');}
 }
 const filesAt=args.indexOf('--files');
 if(filesAt!==-1)return changeScope(args.slice(filesAt+1));
 if(env.SHIQU_TEST_SCOPE){try{return JSON.parse(env.SHIQU_TEST_SCOPE);}catch{return fallbackScope('malformed CI scope');}}
 return detectScope(env.BASE,env.HEAD);
}
export async function executePlan(plan,{root=process.cwd(),evidence=true}={}){
 const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),directory=path.join(root,'.data/test-plans',runId);
 if(evidence)await mkdir(directory,{recursive:true});
 const {commit,build}=evidence?await sourceIdentity(root):{commit:'',build:'related'},startedAt=new Date().toISOString(),batches=[];
 const log=evidence?createWriteStream(path.join(directory,'test.log')):null;
 let exitCode=0;
 console.log(evidence?`PR test plan: ${plan.tests.length} files; evidence ${directory}`:`Related tests: ${plan.tests.length} files (fast flags)`);
 batchesLoop:for(const mode of ['fast','full'])for(const runtime of ['source','browser']){
  const files=plan.tests.filter(test=>test.mode===mode&&(test.level==='browser-e2e')===(runtime==='browser')).map(test=>test.file);if(!files.length)continue;
  // 浏览器文件独占执行，源码文件最多并行两个，避免 Vite/Chromium 挤占受控队列的等待预算。
  const concurrency=runtime==='browser'?1:2;
  const env={...process.env,SHIQU_E2E_RUN_ID:runId,SHIQU_E2E_BUILD_ID:build};
  delete env.NODE_TEST_CONTEXT;delete env.SHIQU_TEST_TIER;delete env.SHIQU_TEST_BOOKS;
  if(mode==='full')env.SHIQU_TEST_TIER='full';
  const start=performance.now(),child=spawn(process.execPath,['--experimental-strip-types','--test',`--test-concurrency=${concurrency}`,...files],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  for(const [stream,target] of [[child.stdout,process.stdout],[child.stderr,process.stderr]])stream.on('data',chunk=>{target.write(chunk);log?.write(chunk);});
  const stop=signal=>child.kill(signal),onInt=()=>stop('SIGINT'),onTerm=()=>stop('SIGTERM');
  process.once('SIGINT',onInt);process.once('SIGTERM',onTerm);
  const code=await new Promise(resolve=>{child.once('error',error=>{log?.write(String(error));resolve(1);});child.once('exit',code=>resolve(code??1));});
  process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);
  batches.push({mode,runtime,concurrency,files,exitCode:code,durationMs:Math.round(performance.now()-start)});
  if(code){exitCode=code;break batchesLoop;}
 }
 if(!evidence)return exitCode;
 await new Promise(resolve=>log.end(resolve));
 await writeFile(path.join(directory,'run.json'),JSON.stringify({...plan,runId,build,commit,startedAt,finishedAt:new Date().toISOString(),batches,exitCode},null,2));
 return exitCode;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 warnNodeVersion();
 const args=process.argv.slice(2),filesAt=args.indexOf('--files');
 const flags=args.slice(0,filesAt===-1?args.length:filesAt);
 if(flags.some(arg=>!['--json','--plan','--full','--changed','--related'].includes(arg))||flags.includes('--related')&&flags.some(arg=>['--full','--changed'].includes(arg)))throw Error('Usage: test-pr.mjs [--plan|--json] [--full|--changed|--related] [--files paths...]');
 if(flags.includes('--related')){
  // 规范化 ./ 前缀与 Windows 分隔符，使路径与 manifest 中的仓库相对路径一致。
  const files=(filesAt===-1?workingTreeFiles():args.slice(filesAt+1)).map(file=>path.posix.normalize(file.replaceAll('\\','/')).replace(/^\.\//,''));
  const metadata=loadMetadata();
  // 只在内循环加载 esbuild 导入图，PR/CI 入口的导入面保持不变。
  const {relatedTests}=await import('./test-graph.mjs');
  const plan=createRelatedPlan(files,await relatedTests(files,{metadata}),metadata);
  if(args.includes('--json'))console.log(JSON.stringify(plan,null,2));
  else if(args.includes('--plan')){console.log(JSON.stringify({files:plan.files,tests:plan.tests.length,deferredBrowser:plan.deferredBrowser,native:plan.native},null,2));for(const test of plan.tests)console.log(`${test.mode.padEnd(4)} ${test.level.padEnd(12)} ${test.file}`);}
  else if(plan.tests.length)process.exitCode=await executePlan(plan,{evidence:false});
  for(const hint of plan.hints)console.error(hint);
 }
 else{
  const plan=createPlan(inputScope(args),undefined,{includeBrowser:args.includes('--full')});
  if(args.includes('--json'))console.log(JSON.stringify(plan,null,2));
  else if(args.includes('--plan')){console.log(JSON.stringify({scope:plan.scope,native:plan.native,files:plan.tests.length,deferredBrowser:plan.deferredBrowser,excluded:plan.excluded},null,2));for(const test of plan.tests)console.log(`${test.mode.padEnd(4)} ${test.level.padEnd(12)} ${test.file}`);}
  else process.exitCode=await executePlan(plan);
 }
}
