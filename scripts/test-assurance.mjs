// 按需从注册表选取安全、启动、loopback 或模型相关 JS 测试；原生检查由 package 脚本单独串接。
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMetadata,supported} from './test-metadata.mjs';
import {warnNodeVersion} from './node-version.mjs';

const groups=['safety','startup','loopback'];
const selectableGroups=[...groups,'models'];

export function selectAssuranceTests(requested=groups,metadata=loadMetadata(),platform=process.platform){
 if(!Array.isArray(requested)||!requested.length||requested.some(group=>!selectableGroups.includes(group)))throw Error('Usage: node scripts/test-assurance.mjs [safety] [startup] [loopback] [models]');
 const selected=new Set(requested);
 return metadata.tests.filter(entry=>entry.manualOnly&&entry.level!=='native'&&supported(entry,platform)&&((entry.modelRelated&&selected.has('models'))||entry.requiresLoopback&&selected.has('loopback')||entry.groups.some(group=>selected.has(group)))).map(entry=>entry.file);
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 warnNodeVersion();
 const requested=process.argv.slice(2),files=selectAssuranceTests(requested.length?requested:groups);
 if(!files.length)throw Error('No on-demand assurance tests are registered for the selected group.');
 const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
 console.log(`On-demand suites: ${files.length} files (${requested.length?requested.join(', '):groups.join(', ')}); run ${runId}`);
 const env={...process.env,SHIQU_TEST_TIER:'full',SHIQU_E2E_RUN_ID:runId,SHIQU_E2E_BUILD_ID:'on-demand'};
 delete env.NODE_TEST_CONTEXT;
 delete env.SHIQU_TEST_BOOKS;
 const child=spawn(process.execPath,['--experimental-strip-types','--test','--test-concurrency=2',...files],{env,stdio:'inherit'});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
 child.once('error',error=>{console.error(error);process.exitCode=1;});
 child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
}
