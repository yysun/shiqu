// 回归入口使用注册表并开启完整提供方及重型用例；显式文件参数保留原有用法。
import {spawn} from 'node:child_process';
import {loadMetadata,supported} from './test-metadata.mjs';
import {warnNodeVersion} from './node-version.mjs';
warnNodeVersion();
const env={...process.env,SHIQU_TEST_TIER:'full'};
// 嵌套执行时清除 Node 测试上下文。
delete env.NODE_TEST_CONTEXT;
// 未指定文件时执行注册表中的全部 JS 回归。
const files=process.argv.slice(2);
const child=spawn(process.execPath,['--experimental-strip-types','--test',...(files.length?files:loadMetadata().tests.filter(entry=>['unit','flows','books'].includes(entry.suite)&&supported(entry)).map(entry=>entry.file))],{env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
