// 通过临时 Git 仓库与受控测试文件验证发布门禁、扩展 E2E 的执行范围及失败传播。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,copyFile,chmod,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadMetadata} from '../scripts/test-metadata.mjs';
import {userFlowTests,extendedFlowTests,selectTests} from '../scripts/test-story-e2e.mjs';

const fullOnly='tests/local-image-batches.test.mjs';

test('the tag gate runs full qualification and the npm gate retains the production-backed lifecycle smoke',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.match(manifest.scripts['release:check'],/^pnpm typecheck && pnpm lint && pnpm test:pr --full && cargo fmt\b/);
 assert.match(manifest.scripts['npm:check'],/^pnpm typecheck && pnpm lint && pnpm test:e2e --gate=npm$/);
 for(const name of ['release:check','npm:check']){
  assert.equal((manifest.scripts[name].match(/pnpm (?:run )?test\b/g)||[]).length,1,'one combined test invocation per gate');
 }
 assert.match(manifest.scripts['test:e2e'],/scripts\/test-story-e2e\.mjs/);
 for(const gate of ['release','npm']){
  const selected=await selectTests(gate);
  for(const filename of ['tests/release-smoke.playwright.e2e.mjs','tests/story-generation-state-machine.e2e.mjs','tests/headless-cli.test.mjs','tests/npm-cli.test.mjs','tests/system-settings.test.mjs','tests/settings-faults.test.mjs','tests/npm-publish.test.mjs'])assert.ok(selected.includes(filename),filename+' must gate '+gate);
 }
});

test('smoke gates stay focused while the explicit full selection preserves all regression coverage',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const unitTests=(await readdir(new URL('./',import.meta.url))).filter(name=>name.endsWith('.test.mjs')).map(name=>'tests/'+name);
 assert.match(manifest.scripts['test:full'],/test:e2e --gate=full$/);
 const full=await selectTests('full');
 assert.equal(full.length,new Set(full).size);assert.deepEqual(new Set(full),new Set(loadMetadata().tests.filter(entry=>entry.level!=='native'&&entry.platforms.includes(process.platform)).map(entry=>entry.file)));
 assert.ok(full.includes(fullOnly));assert.ok(!(await selectTests('release')).includes(fullOnly));
 for(const gate of ['release','npm']){
  const selected=await selectTests(gate);
  assert.equal(selected.length,new Set(selected).size);
  assert.ok(selected.length<=8,'release gates must stay small');
  for(const filename of ['tests/startup-matrix.test.mjs','tests/startup-pty.test.mjs','tests/frame-count-gate.test.mjs','tests/local-library-all-books.test.mjs','tests/story-lifecycle.playwright.e2e.mjs']){
   assert.ok(!selected.includes(filename),filename+' belongs to the full suite');assert.ok(full.includes(filename));
  }
 }
 assert.ok((await selectTests('release')).includes('tests/release-pre-push.test.mjs'));
 assert.deepEqual(await selectTests(),userFlowTests,'standalone E2E keeps its existing scope');
 await assert.rejects(selectTests('typo'),/Usage:/);
});

test('all E2E files have an aggregate runner and the six extended service files have a dedicated command',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.match(manifest.scripts['test:e2e:extended'],/^pnpm test:e2e --gate=extended$/);
 const extended=await selectTests('extended'),full=await selectTests('full');
 assert.deepEqual(new Set(extended),new Set([
  'tests/adaptive-storyboard-review.e2e.mjs','tests/book-reference-star.e2e.mjs',
  'tests/character-continuity-edits.e2e.mjs','tests/frame-count-gate.e2e.mjs',
  'tests/incremental-story-library.e2e.mjs','tests/story-discovery-speed-accuracy.e2e.mjs',
 ]));
 assert.equal(extended.length,new Set(extended).size);
 for(const filename of extended){assert.ok(full.includes(filename));assert.ok(!userFlowTests.includes(filename));}
 const owned=new Set([...full,...await selectTests('release'),...await selectTests('npm')]);
 for(const name of (await readdir(new URL('./',import.meta.url))).filter(name=>name.endsWith('.e2e.mjs')))assert.ok(owned.has('tests/'+name),name+' needs an aggregate runner');
});

async function fixture(t,{failedFlow}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu hook test '));t.after(()=>rm(root,{recursive:true,force:true}));
 const checkout=path.join(root,'checkout'),remote=path.join(root,'remote.git'),bin=path.join(root,'bin'),log=path.join(root,'checks.log');
 await mkdir(checkout);await mkdir(bin);await mkdir(path.join(checkout,'scripts'));await mkdir(path.join(checkout,'.githooks'));
 for(const file of ['scripts/pre-push.mjs','scripts/test-story-e2e.mjs','scripts/test-metadata.mjs','scripts/test-source.mjs','scripts/test-pr.mjs','scripts/test-plan.mjs','scripts/node-version.mjs','scripts/ci-scope.mjs','.githooks/pre-push'])await copyFile(new URL('../'+file,import.meta.url),path.join(checkout,file));
 // 发布与扩展执行器使用临时用例，验证失败传播时不递归运行真实套件。
 await mkdir(path.join(checkout,'tests'));
 const owned=new Set(['tests/book-integrity-smoke.test.mjs',fullOnly,...userFlowTests,...extendedFlowTests,...await selectTests('release')]);
 for(const file of owned)await writeFile(path.join(checkout,file),`import test from 'node:test';\ntest(${JSON.stringify('release flow probe: '+file)},()=>{${file===failedFlow?"throw Error('CONTROLLED_USER_FLOW_FAILURE');":''}});\n`);
 const metadata=loadMetadata();await writeFile(path.join(checkout,'tests/manifest.json'),JSON.stringify({...metadata,tests:metadata.tests.filter(entry=>owned.has(entry.file))}));
 await chmod(path.join(checkout,'.githooks/pre-push'),0o755);
 await writeFile(path.join(checkout,'.nvmrc'),process.versions.node);
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 await writeFile(path.join(checkout,'package.json'),JSON.stringify({packageManager:manifest.packageManager,scripts:{'release:check':manifest.scripts['release:check']}}));
 await writeFile(path.join(checkout,'marker'),'tagged content');
 await writeFile(path.join(bin,'pnpm'),`#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
const manifest=JSON.parse(fs.readFileSync('package.json','utf8'));
if(args[0]==='--version'){console.log(manifest.packageManager.slice(5));process.exit(0);}
fs.appendFileSync(process.env.PRE_PUSH_LOG,JSON.stringify({args,marker:fs.readFileSync('marker','utf8'),cwd:process.cwd(),gitDir:process.env.GIT_DIR})+'\\n');
if(args[0]==='run'&&process.env.PRE_PUSH_FAIL==='1')process.exit(1);
if(args[0]==='run'&&args[1]==='release:check'&&process.env.PRE_PUSH_REAL_FLOWS==='1'){
 const check=manifest.scripts['release:check'].split(' && ').find(command=>command.startsWith('pnpm test:pr '));
 if(!check)throw Error('Missing full release plan');
 const result=require('node:child_process').spawnSync(process.execPath,['scripts/test-pr.mjs',...check.split(' ').slice(2)],{env:process.env,stdio:'inherit'});
 process.exit(result.status??1);
}
`);
 await chmod(path.join(bin,'pnpm'),0o755);
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,PRE_PUSH_LOG:log};
 // A hook can inherit Git-local variables; fixture commands must target only their own repository.
 for(const name of spawnSync('git',['rev-parse','--local-env-vars'],{encoding:'utf8'}).stdout.trim().split('\n'))delete env[name];
 function git(args,extra={},success=true){
  const result=spawnSync('git',args,{cwd:checkout,env:{...env,...extra},encoding:'utf8'});
  if(success)assert.equal(result.status,0,result.stdout+result.stderr);
  return result;
 }
 git(['init','--initial-branch=main']);git(['config','user.name','Hook test']);git(['config','user.email','hook@example.invalid']);
 git(['config','core.hooksPath','.githooks']);git(['add','.']);git(['commit','-m','Fixture']);
 git(['init','--bare',remote]);git(['remote','add','origin',remote]);
 const receipts=async()=>{try{return (await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 return {checkout,git,receipts};
}

test('extended runner executes all six files under inherited test context and records a failing exit',async t=>{
 const f=await fixture(t,{failedFlow:extendedFlowTests[0]});
 const result=spawnSync(process.execPath,['scripts/test-story-e2e.mjs','--gate=extended'],{cwd:f.checkout,env:{...process.env,NODE_TEST_CONTEXT:'child-v8'},encoding:'utf8',timeout:15000});
 assert.equal(result.error,undefined);assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stdout+result.stderr,/CONTROLLED_USER_FLOW_FAILURE/);
 const directory=path.join(f.checkout,'.data/e2e'),runs=await readdir(directory);assert.equal(runs.length,1);
 const report=JSON.parse(await readFile(path.join(directory,runs[0],'run.json'),'utf8'));
 assert.deepEqual(report.tests,extendedFlowTests);assert.equal(report.gate,'extended');assert.equal(report.exitCode,1);assert.equal(report.browser,'none (service/engine E2E)');
 assert.match(await readFile(path.join(directory,runs[0],'test.log'),'utf8'),/pass 5/);
});

test('release pushes check the tagged snapshot once for lightweight and annotated tags; branches and deletions bypass', {skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);
 f.git(['push','origin','main']);assert.deepEqual(await f.receipts(),[]);
 f.git(['tag','notes']);f.git(['push','origin','notes']);assert.deepEqual(await f.receipts(),[]);
 f.git(['tag','v0.0.1']);f.git(['tag','-a','v0.0.2','-m','Annotated release']);
 await writeFile(path.join(f.checkout,'marker'),'uncommitted content');
 await writeFile(path.join(f.checkout,'untracked'),'keep this file');
 f.git(['push','origin','--tags']);
 const receipts=await f.receipts();assert.deepEqual(receipts.map(r=>r.args),[['install','--frozen-lockfile'],['run','release:check']]);
 assert.ok(receipts.every(r=>r.marker==='tagged content'&&r.cwd!==f.checkout&&!r.gitDir));
 assert.equal(await readFile(path.join(f.checkout,'marker'),'utf8'),'uncommitted content');
 assert.equal(await readFile(path.join(f.checkout,'untracked'),'utf8'),'keep this file');
 f.git(['push','origin',':refs/tags/v0.0.1']);assert.equal((await f.receipts()).length,2);
 assert.equal((f.git(['worktree','list','--porcelain']).stdout.match(/^worktree /gm)||[]).length,1);
});

for(const failedFlow of ['tests/headless-cli.test.mjs','tests/release-smoke.playwright.e2e.mjs',fullOnly])test('full plan failure rejects a real v* tag push: '+failedFlow,{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{failedFlow});f.git(['tag','v0.0.4']);
 await writeFile(path.join(f.checkout,'marker'),'uncommitted content');
 const pushed=f.git(['push','origin','v0.0.4'],{PRE_PUSH_REAL_FLOWS:'1'},false);
 assert.notEqual(pushed.status,0,pushed.stdout+pushed.stderr);assert.match(pushed.stdout+pushed.stderr,/CONTROLLED_USER_FLOW_FAILURE/);
 assert.match(pushed.stderr,/Release pre-push check failed/);assert.equal(f.git(['ls-remote','--tags','origin']).stdout,'');
 assert.equal(await readFile(path.join(f.checkout,'marker'),'utf8'),'uncommitted content');
 assert.equal((f.git(['worktree','list','--porcelain']).stdout.match(/^worktree /gm)||[]).length,1);
});

test('passing full qualification executes under an inherited test environment before a v* tag is accepted',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);f.git(['tag','v0.0.5']);
 const pushed=f.git(['push','origin','v0.0.5'],{PRE_PUSH_REAL_FLOWS:'1'});
 assert.ok((pushed.stdout+pushed.stderr).includes('release flow probe: '+fullOnly));assert.match(pushed.stdout+pushed.stderr,/PR test plan:/);
 assert.match(f.git(['ls-remote','--tags','origin']).stdout,/refs\/tags\/v0\.0\.5/);
 assert.equal((f.git(['worktree','list','--porcelain']).stdout.match(/^worktree /gm)||[]).length,1);
});

test('failed checks reject the actual tag push and clean up the isolated worktree', {skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);f.git(['tag','v0.0.3']);
 const pushed=f.git(['push','origin','v0.0.3'],{PRE_PUSH_FAIL:'1'},false);
 assert.notEqual(pushed.status,0);assert.match(pushed.stderr,/Release pre-push check failed/);
 assert.equal(f.git(['ls-remote','--tags','origin']).stdout,'');
 assert.equal((f.git(['worktree','list','--porcelain']).stdout.match(/^worktree /gm)||[]).length,1);
});
