// 自动回归从注册表筛出非手动用例并开启完整开关；模型专用测试由 test:models 显式运行。
import {spawn} from 'node:child_process';
import {automaticRegressionTests} from './test-tiers.mjs';
import {warnNodeVersion} from './node-version.mjs';
warnNodeVersion();
const env={...process.env,SHIQU_TEST_TIER:'full'};
// 嵌套执行时清除 Node 测试上下文。
delete env.NODE_TEST_CONTEXT;
// 未指定文件时执行所有自动回归套件。
const files=process.argv.slice(2);
const selected=files.length?files:await automaticRegressionTests();
const child=spawn(process.execPath,['--experimental-strip-types','--test',...selected],{env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
