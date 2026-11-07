// 用最小真实 Node 子进程验证模式隔离、文件唯一执行、失败退出与工作区影响读取。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {executePlan,inputScope} from '../scripts/test-pr.mjs';
import {createPlan,changeScope} from '../scripts/test-plan.mjs';
import {loadMetadata} from '../scripts/test-metadata.mjs';

test('PR executor isolates browser files, preserves fast/full flags and records a failing batch',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-plan-run-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'tests'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 const names=['fast','full','browser-a','browser-b','failed'];
 for(const name of names)await writeFile(path.join(root,'tests',name+'.test.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';import {appendFileSync,mkdirSync,rmdirSync} from 'node:fs';test('${name}',async()=>{${name.startsWith('browser')?"mkdirSync('browser-active');await new Promise(resolve=>setTimeout(resolve,150));rmdirSync('browser-active');":''}appendFileSync('receipts',JSON.stringify({name:'${name}',tier:process.env.SHIQU_TEST_TIER,books:process.env.SHIQU_TEST_BOOKS,run:process.env.SHIQU_E2E_RUN_ID,build:process.env.SHIQU_E2E_BUILD_ID})+'\\n');assert.equal(process.env.SHIQU_TEST_TIER,${name==='fast'?'undefined':"'full'"});assert.equal(process.env.SHIQU_TEST_BOOKS,undefined);${name==='failed'?"throw Error('CONTROLLED_PLAN_FAILURE');":''}});`);
 git('add','.');git('commit','-m','Fixture');
 const plan={version:1,platform:process.platform,scope:changeScope(['server/claude-runner.ts']),native:false,excluded:['unsupported'],tests:names.map(name=>({file:'tests/'+name+'.test.mjs',mode:name==='fast'?'fast':'full',level:name.startsWith('browser')||name==='failed'?'browser-e2e':'contract'}))};
 const saved={tier:process.env.SHIQU_TEST_TIER,books:process.env.SHIQU_TEST_BOOKS};process.env.SHIQU_TEST_TIER='full';process.env.SHIQU_TEST_BOOKS='1';
 try{assert.equal(await executePlan(plan,{root}),1);}finally{for(const [key,value] of [['SHIQU_TEST_TIER',saved.tier],['SHIQU_TEST_BOOKS',saved.books]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 const receipts=(await readFile(path.join(root,'receipts'),'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(receipts.map(row=>row.name),names);assert.equal(receipts.length,5);
 const directory=path.join(root,'.data/test-plans'),runs=await readdir(directory);assert.equal(runs.length,1);
 const report=JSON.parse(await readFile(path.join(directory,runs[0],'run.json'),'utf8'));assert.equal(report.exitCode,1);assert.deepEqual(report.tests,plan.tests);assert.deepEqual(report.excluded,['unsupported']);assert.deepEqual(report.batches.map(({mode,runtime,concurrency})=>({mode,runtime,concurrency})),[{mode:'fast',runtime:'source',concurrency:2},{mode:'full',runtime:'source',concurrency:2},{mode:'full',runtime:'browser',concurrency:1}]);assert.ok(receipts.every(row=>row.run===report.runId&&row.build===report.build));
});
test('local changed mode includes staged, unstaged, untracked and both rename paths',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-plan-diff-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'tests'));await mkdir(path.join(root,'server'));const metadata=loadMetadata();
 await writeFile(path.join(root,'tests/book-integrity-smoke.test.mjs'),'');
 await writeFile(path.join(root,'tests/manifest.json'),JSON.stringify({...metadata,tests:metadata.tests.filter(entry=>entry.file==='tests/book-integrity-smoke.test.mjs')}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 await writeFile(path.join(root,'server/claude-runner.ts'),'old');await writeFile(path.join(root,'README.md'),'old');git('add','.');git('commit','-m','Fixture');
 git('mv','server/claude-runner.ts','renamed.md');await writeFile(path.join(root,'README.md'),'new');await writeFile(path.join(root,'server/system-settings.ts'),'new');
 const entry=fileURLToPath(new URL('../scripts/test-pr.mjs',import.meta.url)),result=spawnSync(process.execPath,[entry,'--changed','--json'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const plan=JSON.parse(result.stdout);assert.equal(plan.scope.full,false);assert.ok(plan.scope.groups.includes('providers'));assert.ok(plan.scope.groups.includes('startup'));assert.ok(plan.native);
});
test('CI fallback keeps full source coverage and only explicit full qualification includes Playwright',()=>{
 assert.ok(inputScope(['--changed','--full'],{}).full);
 assert.ok(createPlan(inputScope([],{SHIQU_TEST_SCOPE:'{bad'})).scope.full);
 assert.ok(createPlan(inputScope([],{SHIQU_TEST_SCOPE:'{}'})).scope.full);
 const scoped=changeScope(['client/ui/Reader.css']);assert.deepEqual(inputScope([],{SHIQU_TEST_SCOPE:JSON.stringify(scoped)}),scoped);
 const entry=fileURLToPath(new URL('../scripts/test-pr.mjs',import.meta.url)),metadata=loadMetadata();
 const plan=(args,env={})=>JSON.parse(execFileSync(process.execPath,[entry,'--json',...args],{encoding:'utf8',env:{...process.env,BASE:'',HEAD:'',SHIQU_TEST_SCOPE:'',...env}}));
 const available=metadata.tests.filter(entry=>entry.level!=='native'&&entry.platforms.includes(process.platform));
 const fallback=plan([],{SHIQU_TEST_SCOPE:'{}'});
 assert.ok(fallback.scope.full);
 assert.deepEqual(fallback.tests.map(test=>test.file),available.filter(test=>test.level!=='browser-e2e').map(test=>test.file));
 assert.deepEqual(fallback.deferredBrowser,available.filter(test=>test.level==='browser-e2e').map(test=>test.file));
 const full=plan(['--full']);assert.deepEqual(full.tests.map(test=>test.file),available.map(test=>test.file));assert.ok(full.tests.every(test=>test.mode==='full'));assert.deepEqual(full.deferredBrowser,[]);
});

test('source identity changes for migrations, books, assets, lockfiles and unknown inputs',async t=>{
 const {sourceIdentity}=await import('../scripts/test-source.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-plan-identity-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 await writeFile(path.join(root,'pnpm-lock.yaml'),'old');await writeFile(path.join(root,'.gitignore'),'.data/\n');git('add','.');git('commit','-m','Fixture');
 const initial=await sourceIdentity(root);
 for(const file of ['pnpm-lock.yaml','.nvmrc','drizzle/0020.sql','db/library-format.json','data/library/original.md','public/icon.svg','unknown-runtime.ts']){
  await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),'changed');const changed=await sourceIdentity(root);assert.notEqual(changed.build,initial.build,file);assert.equal(changed.commit,initial.commit);
  if(file==='pnpm-lock.yaml')await writeFile(path.join(root,file),'old');else await rm(path.join(root,file));
  assert.deepEqual(await sourceIdentity(root),initial);
 }
 await mkdir(path.join(root,'.data'));await writeFile(path.join(root,'.data/private.sqlite'),'private');assert.deepEqual(await sourceIdentity(root),initial);
});
