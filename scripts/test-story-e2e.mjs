// 发布门禁运行关键冒烟；扩展服务 E2E 与完整回归通过独立入口选择，共用执行与证据记录。
// 同一文件只运行一次；默认 test:e2e 保留现有用户流程范围。
import path from 'node:path';
import {loadMetadata,supported} from './test-metadata.mjs';
import {sourceIdentity} from './test-source.mjs';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const gateFiles=(gate,root=process.cwd())=>loadMetadata(root).tests.filter(entry=>(!entry.manualOnly||gate==='extended')&&entry.level!=='native'&&supported(entry)&&(gate==='full'||entry.gates.includes(gate))).map(entry=>entry.file);
export const userFlowTests=gateFiles('user-flows');
export const extendedFlowTests=gateFiles('extended');
export async function selectTests(gate,root=process.cwd()){
 if(gate!==undefined&&!['release','npm','extended','full'].includes(gate))throw Error('Usage: pnpm test:e2e [--gate=release|--gate=npm|--gate=extended|--gate=full]');
 return gateFiles(gate??'user-flows',root);
}
export async function selectFiles(files,root=process.cwd()){
 const usage='Usage: pnpm test:e2e --files tests/<registered-service-or-browser-e2e>.e2e.mjs [...]';
 if(!Array.isArray(files)||!files.length||files.some(file=>typeof file!=='string'||!file))throw Error(usage);
 const metadata=loadMetadata(root),requested=[...new Set(files)],entries=requested.map(file=>metadata.tests.find(entry=>entry.file===file&&entry.suite==='e2e'&&['service-e2e','browser-e2e'].includes(entry.level)&&supported(entry)));
 if(entries.some(entry=>!entry))throw Error(`${usage}\nFiles must name supported registered service or browser E2E tests.`);
 return entries.map(entry=>entry.file);
}

async function runUserFlows(gate,files){
 const tests=files?await selectFiles(files):await selectTests(gate),metadata=loadMetadata();
 const browser=tests.some(file=>metadata.tests.find(entry=>entry.file===file)?.level==='browser-e2e'),concurrency=2;
 const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),directory=path.resolve('.data/e2e',runId);
 await mkdir(directory,{recursive:true});
 const {commit,build}=await sourceIdentity(),startedAt=new Date().toISOString(),log=createWriteStream(path.join(directory,'test.log'));
 console.log(`Story E2E: ${runId}\nBuild: ${build}\nTests: ${tests.length}\nEvidence: ${directory}`);
 // 门禁使用完整开关，保留所有提供方和重型用例。
 const env={...process.env,SHIQU_E2E_RUN_ID:runId,SHIQU_E2E_BUILD_ID:build,SHIQU_TEST_TIER:'full'};
 delete env.SHIQU_TEST_BOOKS;
 // 嵌套执行时仍作为顶层测试运行，避免 Node 跳过递归测试。
 delete env.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,['--experimental-strip-types','--test',`--test-concurrency=${concurrency}`,...tests],{env,stdio:['ignore','pipe','pipe']});
 for(const [stream,target] of [[child.stdout,process.stdout],[child.stderr,process.stderr]])stream.on('data',chunk=>{target.write(chunk);log.write(chunk);});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
 await new Promise(resolve=>log.end(resolve));
 await writeFile(path.join(directory,'run.json'),JSON.stringify({runId,gate:files?'files':gate??'user-flows',build,commit,startedAt,finishedAt:new Date().toISOString(),exitCode,tests,concurrency,model:'controlled production adapters; no live inference',databasePolicy:'isolated .data/e2e browser stores; disposable CLI/configuration/recovery libraries and homes; dev local startup uses a disposable checkout',browser:browser?'independent Playwright Chromium':'none (service/engine E2E)'},null,2));
 console.log(`Story E2E ${exitCode===0?'PASS':'FAIL'} — ${directory}`);process.exitCode=exitCode;
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const args=process.argv.slice(2);
 if(args[0]==='--files'){
  if(args.length<2)throw Error('Usage: pnpm test:e2e --files tests/<registered-service-or-browser-e2e>.e2e.mjs [...]');
  await runUserFlows(undefined,args.slice(1));
 }else{
  if(args.length>1||(args.length&&!['--gate=release','--gate=npm','--gate=extended','--gate=full'].includes(args[0])))throw Error('Usage: pnpm test:e2e [--gate=release|--gate=npm|--gate=extended|--gate=full] | pnpm test:e2e --files tests/<registered-service-or-browser-e2e>.e2e.mjs [...]');
  await runUserFlows(args[0]?.slice('--gate='.length));
 }
}
