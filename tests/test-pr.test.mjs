// 用最小真实 Node 子进程验证模式隔离、文件唯一执行、失败退出与工作区影响读取；
// 并在临时仓库验证 test:related 的直接导入者、路径字面量、covers 并集与 Node 版本提示。
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
test('automatic plans never enable the shipped-book corpus from book scope',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-book-scope-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'tests'));
 await writeFile(path.join(root,'tests/probe.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';test('book scope',()=>{assert.equal(process.env.SHIQU_TEST_TIER,'full');assert.equal(process.env.SHIQU_TEST_BOOKS,undefined);});");
 const plan={version:1,platform:process.platform,scope:{books:true},native:false,tests:[{file:'tests/probe.test.mjs',mode:'full',level:'contract'}]};
 assert.equal(await executePlan(plan,{root,evidence:false}),0);
});
test('provider full tier does not enable the shipped-book corpus without its explicit flag',()=>{
 const fixture=new URL('./fixtures/test-tier.mjs',import.meta.url).href,probe=`import {books} from ${JSON.stringify(fixture)};console.log(JSON.stringify(books));`;
 const booksFor=enabled=>{const env={...process.env,SHIQU_TEST_TIER:'full'};if(enabled)env.SHIQU_TEST_BOOKS='1';else delete env.SHIQU_TEST_BOOKS;return JSON.parse(execFileSync(process.execPath,['--input-type=module','--eval',probe],{encoding:'utf8',env}));};
 assert.deepEqual(booksFor(false),{skip:'shipped book contents: run pnpm test:books'});assert.deepEqual(booksFor(true),{});
});
test('automatic plan output points to the manual book corpus command',()=>{
 const entry=fileURLToPath(new URL('../scripts/test-pr.mjs',import.meta.url)),result=spawnSync(process.execPath,[entry,'--json','--files','server/local-books.ts'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stderr,/pnpm test:books/);
 assert.ok(JSON.parse(result.stdout).manualOnly.includes('tests/local-books.test.mjs'));
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
test('CI fallback runs baseline checks and only explicit full qualification includes Playwright',()=>{
 assert.ok(inputScope(['--changed','--full'],{}).full);
 assert.equal(createPlan(inputScope([],{SHIQU_TEST_SCOPE:'{bad'})).scope.full,false);
 assert.equal(createPlan(inputScope([],{SHIQU_TEST_SCOPE:'{}'})).scope.full,false);
 const scoped=changeScope(['client/ui/Reader.css']);assert.deepEqual(inputScope([],{SHIQU_TEST_SCOPE:JSON.stringify(scoped)}),scoped);
 const bookScope=changeScope(['server/local-books.ts']);assert.deepEqual(bookScope.groups,['books','discovery']);assert.ok(bookScope.directTests.includes('tests/local-books.test.mjs'));assert.equal(bookScope.books,true);
 const generationScope=changeScope(['server/generation.ts']);assert.ok(generationScope.directTests.includes('tests/local-books.test.mjs'));assert.ok(!generationScope.groups.includes('books'),'consumer groups stay out of mapped domains');
 const entry=fileURLToPath(new URL('../scripts/test-pr.mjs',import.meta.url)),metadata=loadMetadata();
 const plan=(args,env={})=>JSON.parse(execFileSync(process.execPath,[entry,'--json',...args],{encoding:'utf8',env:{...process.env,BASE:'',HEAD:'',SHIQU_TEST_SCOPE:'',...env}}));
 const available=metadata.tests.filter(entry=>entry.level!=='native'&&entry.platforms.includes(process.platform));
 const fallback=plan([],{SHIQU_TEST_SCOPE:'{}'});
 assert.ok(fallback.native&&!fallback.scope.full);
 assert.deepEqual(fallback.scope.groups,['safety','startup','tooling']);
 assert.ok(!fallback.tests.some(test=>test.file==='tests/book-integrity-smoke.test.mjs'));
 assert.ok(fallback.manualOnly.includes('tests/book-integrity-smoke.test.mjs'));
 assert.ok(fallback.tests.length<available.filter(test=>test.level!=='browser-e2e').length);
 assert.ok(fallback.tests.every(test=>test.level!=='browser-e2e'));
 const full=plan(['--full']);assert.deepEqual(full.tests.map(test=>test.file),available.filter(entry=>!entry.manualOnly).map(test=>test.file));assert.ok(full.tests.every(test=>test.mode==='full'));assert.deepEqual(full.deferredBrowser,[]);
 assert.deepEqual(new Set(full.manualOnly),new Set(metadata.tests.filter(entry=>entry.manualOnly&&entry.platforms.includes(process.platform)).map(entry=>entry.file)));
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

test('related mode unions direct importers, path literals and covers with fast flags and never treats failures as empty',async t=>{
 const {relatedTests}=await import('../scripts/test-graph.mjs');
 const {createRelatedPlan}=await import('../scripts/test-plan.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-related-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const original=loadMetadata(),smoke=original.tests.find(entry=>entry.file==='tests/book-integrity-smoke.test.mjs');
 const entry=(file,extra={})=>({...structuredClone(smoke),file,pr:'affected',manualOnly:false,covers:[],...extra});
 const sources={
  'tests/book-integrity-smoke.test.mjs':"import test from 'node:test';test('smoke',()=>{});",
  'tests/graph.test.mjs':"import test from 'node:test';import {value} from '../lib/a.ts';test('graph',()=>{if(value!==1)throw Error();});",
  'tests/css.test.mjs':"import test from 'node:test';import {readFileSync} from 'node:fs';test('css',()=>readFileSync('client/x.css','utf8'));",
  'tests/spawn.test.mjs':"import test from 'node:test';import {entry} from './fixtures/spawn.mjs';test('spawn',()=>{});",
  'tests/fixture-user.test.mjs':"import test from 'node:test';import {made} from './fixtures/outer.mjs';test('fixture',()=>{});",
  'tests/fixtures/outer.mjs':"export {made} from './inner.mjs';",'tests/fixtures/inner.mjs':"export {made} from '../../lib/c.ts';",'lib/c.ts':"export const made=true;",
  'tests/owned.test.mjs':"import test from 'node:test';test('owned',()=>{});",
  'tests/manual-books.test.mjs':"import test from 'node:test';test('manual books',()=>{const plannerInput='server/spawned.ts';if(!plannerInput)throw Error();});",
  'tests/standard.test.mjs':"import test from 'node:test';test('standard',()=>{});",
  'tests/heavy.test.mjs':"import test from 'node:test';test('heavy',()=>{});",
  'tests/reads.test.mjs':"import test from 'node:test';test('reads',()=>new URL('./fixtures/data.json',import.meta.url));",'tests/fixtures/data.json':'{}',
  'tests/journey.e2e.mjs':"import test from 'node:test';test('journey',()=>'client/x.css');",
  'tests/fixtures/spawn.mjs':"export const entry='server/cli.ts';",
  'tests/component.test.mjs':"import test from 'node:test';import {view} from '../client/view.mjs';test('component',()=>{});",
  'client/view.mjs':"export {view} from './shared.mjs';",'client/shared.mjs':"export {view} from '../lib/d.ts';",'lib/d.ts':"export const view=1;",
  'lib/a.ts':"export {value} from './b.ts';",'lib/b.ts':"export const value:number=1;",'client/x.css':'a{}','server/cli.ts':'','server/spawned.ts':'',
 };
 for(const [file,source] of Object.entries(sources)){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),source);}
 const metadata={...original,tests:[smoke,entry('tests/graph.test.mjs'),entry('tests/css.test.mjs'),entry('tests/spawn.test.mjs'),entry('tests/fixture-user.test.mjs'),entry('tests/component.test.mjs'),entry('tests/owned.test.mjs',{covers:['server/spawned.ts']}),entry('tests/standard.test.mjs',{cost:'standard',covers:['server/spawned.ts']}),entry('tests/heavy.test.mjs',{cost:'heavy',covers:['server/spawned.ts']}),entry('tests/manual-books.test.mjs',{suite:'books',manualOnly:true,relatedPathLiterals:false}),entry('tests/reads.test.mjs'),entry('tests/journey.e2e.mjs',{level:'browser-e2e',suite:'e2e',gates:['user-flows']})]};
 await writeFile(path.join(root,'tests/manifest.json'),JSON.stringify(metadata));
 const related=async files=>createRelatedPlan(files,await relatedTests(files,{root}),loadMetadata(root));
 const files=plan=>plan.tests.map(test=>test.file);
 // 测试直接导入的源码相关；只经源码中间模块传递的不再选中。
 assert.deepEqual(files(await related(['lib/a.ts'])),['tests/graph.test.mjs']);
 assert.deepEqual(files(await related(['lib/b.ts'])),[]);
 // 经由 tests/ 夹具链直接导入的源码与夹具本身都相关。
 assert.deepEqual(files(await related(['lib/c.ts'])),['tests/fixture-user.test.mjs']);
 assert.deepEqual(files(await related(['tests/fixtures/inner.mjs'])),['tests/fixture-user.test.mjs']);
 // 经由前端组件可达的共享组件及其直接导入相关，但不再沿 lib/ 继续传递。
 assert.deepEqual(files(await related(['client/shared.mjs'])),['tests/component.test.mjs']);
 assert.deepEqual(files(await related(['lib/d.ts'])),['tests/component.test.mjs']);
 const css=await related(['client/x.css']);assert.deepEqual(files(css),['tests/css.test.mjs']);assert.deepEqual(css.deferredBrowser,['tests/journey.e2e.mjs']);assert.match(css.hints.join('\n'),/pnpm test:e2e --files tests\/journey\.e2e\.mjs/);
 assert.deepEqual(files(await related(['server/cli.ts'])),['tests/spawn.test.mjs']);
 const owned=await related(['server/spawned.ts']);assert.deepEqual(files(owned),['tests/owned.test.mjs']);assert.deepEqual(new Set(owned.deferredByCost),new Set(['tests/standard.test.mjs','tests/heavy.test.mjs']));assert.match(owned.hints.join('\n'),/标准或重型消费者已延后/);
 const plannerLiteral=await related(['server/spawned.ts']);assert.ok(!plannerLiteral.manualOnly.includes('tests/manual-books.test.mjs'),'planner sample paths can opt out of literal consumer matching');
 const changedHeavy=await related(['tests/heavy.test.mjs']);assert.deepEqual(files(changedHeavy),['tests/heavy.test.mjs']);assert.equal(changedHeavy.tests[0].mode,'full');
 // 相对源码自身的 ./ 写法同样识别。
 assert.deepEqual(files(await related(['tests/fixtures/data.json'])),['tests/reads.test.mjs']);
 assert.deepEqual(files(await related(['tests/owned.test.mjs'])),['tests/owned.test.mjs']);
 const manual=await related(['tests/manual-books.test.mjs']);assert.deepEqual(files(manual),[]);assert.deepEqual(manual.manualOnly,['tests/manual-books.test.mjs']);
 assert.ok((await related(['lib/a.ts','client/x.css'])).tests.every(test=>test.mode==='fast'));
 const empty=await related(['README.md','src-tauri/src/runtime.rs']);assert.deepEqual(empty.tests,[]);assert.ok(empty.native);assert.match(empty.hints.join('\n'),/desktop:test[\s\S]*不代表通过[\s\S]*test:changed/);
 // 删除被导入的模块会让构建失败，受影响入口仍须选中而不是得到空集。
 await rm(path.join(root,'lib/b.ts'));assert.deepEqual(files(await related(['lib/b.ts'])),['tests/graph.test.mjs']);
 await writeFile(path.join(root,'lib/b.ts'),sources['lib/b.ts']);
 const cli=fileURLToPath(new URL('../scripts/test-pr.mjs',import.meta.url)),run=args=>spawnSync(process.execPath,[cli,'--related',...args],{cwd:root,encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:''}});
 const passed=run(['--files','lib/a.ts']);assert.equal(passed.status,0,passed.stderr);assert.match(passed.stdout,/Related tests: 1 files/);
 assert.ok(!(await readdir(root)).includes('.data'),'related runs write no evidence');
 assert.equal(run(['--files','README.md']).status,0);
 assert.match(run(['--plan','--files','./client\\x.css']).stdout,/tests\/css\.test\.mjs/);
 assert.notEqual(spawnSync(process.execPath,[cli,'--related','--full'],{cwd:root,encoding:'utf8'}).status,0);
 await writeFile(path.join(root,'tests/new.test.mjs'),'');assert.notEqual(run(['--files','lib/a.ts']).status,0);
});

test('node version warning compares the engines major version',async t=>{
 const {nodeVersionWarning}=await import('../scripts/node-version.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-node-version-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'package.json'),JSON.stringify({engines:{node:'>=24 <25'}}));
 assert.match(nodeVersionWarning(root,'22.23.4'),/22\.23\.4.*>=24 <25.*nvm use/);
 assert.equal(nodeVersionWarning(root,'24.0.1'),'');
 assert.equal(nodeVersionWarning(path.join(root,'missing'),'22.0.0'),'');
});
