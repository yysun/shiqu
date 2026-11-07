// 运行显式分层：默认快速契约，flows 为受控制作与启动集成。
import {spawn} from 'node:child_process';
import {tierTests} from './test-tiers.mjs';
import {warnNodeVersion} from './node-version.mjs';
warnNodeVersion();
const files=await tierTests(process.argv[2]||'unit');
const env={...process.env};
// 嵌套执行时清除 Node 测试上下文。
delete env.NODE_TEST_CONTEXT;
const child=spawn(process.execPath,['--experimental-strip-types','--test',...files],{env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
