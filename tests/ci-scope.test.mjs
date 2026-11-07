// 以行为表验证影响域、并集、保守回退和真实 Git 改名；仅使用临时仓库。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {changeScope,detectScope} from '../scripts/ci-scope.mjs';
import {createPlan,fullScope,validScope} from '../scripts/test-plan.mjs';
import {loadMetadata} from '../scripts/test-metadata.mjs';

const files=plan=>plan.tests.map(test=>test.file);
const extended=loadMetadata().tests.filter(entry=>entry.gates.includes('extended')).map(entry=>entry.file);
test('documentation keeps smoke; domain changes keep contracts and local-server boundaries',()=>{
 const docs=createPlan(changeScope(['README.md','.docs/reqs/example.md','LICENSE']));
 assert.deepEqual(files(docs),['tests/book-integrity-smoke.test.mjs']);assert.equal(docs.native,false);
 const ui=createPlan(changeScope(['client/ui/Reader.css']));
 for(const file of ['local-server','production-queue','story-generation-state-machine-commands','deepseek-provider','gemini-stage-schema','separate-providers','task-reasoning'])assert.ok(files(ui).includes(`tests/${file}.test.mjs`));
 for(const file of ['cli-library','startup-cli-flow','desktop-internet','local-books'])assert.ok(!files(ui).includes(`tests/${file}.test.mjs`));
 assert.ok(!ui.native);assert.ok(ui.deferredBrowser.length);assert.ok(ui.tests.every(test=>test.level!=='browser-e2e'));
});
test('affected areas include their flows, heavy flags and all six service E2Es for core changes',()=>{
 for(const file of ['server/local-story-discovery.ts','lib/reader-review.ts','server/production-queue.ts','server/generation.ts','server/book-image-reference.ts']){
  const plan=createPlan(changeScope([file]));
  for(const e2e of extended)assert.ok(files(plan).includes(e2e),file+' -> '+e2e);
  assert.equal(plan.tests.length,new Set(files(plan)).size);
  for(const selected of plan.tests.filter(entry=>extended.includes(entry.file)))assert.equal(selected.mode,'full');
 }
 const provider=createPlan(changeScope(['server/claude-runner.ts']));
 assert.ok(files(provider).includes('tests/claude-provider-flow.test.mjs'));
 assert.equal(provider.tests.find(entry=>entry.file==='tests/deepseek-provider.test.mjs').mode,'full');
 assert.equal(provider.tests.find(entry=>entry.file==='tests/local-server.test.mjs').mode,'fast');
 const books=createPlan(changeScope(['data/library/originals/book.md']));assert.ok(files(books).includes('tests/local-books.test.mjs'));
});
test('native and shared settings request native checks; unknown/schema/toolchain changes fail closed',()=>{
 for(const file of ['src-tauri/src/runtime.rs','server/system-settings.ts','lib/system-settings.ts'])assert.ok(changeScope([file]).native,file);
 for(const file of ['package.json','pnpm-lock.yaml','.nvmrc','.npmrc','tsconfig.json','.github/workflows/desktop-macos.yml','lib/reader-model.ts','lib/reader-prompts.ts','db/library-format.json','drizzle/0020.sql','server/new-feature.ts','tests/fixtures/production.mjs','tests/unregistered.test.mjs'])assert.ok(changeScope([file]).full,file);
 assert.ok(changeScope([]).full);assert.ok(createPlan(undefined).scope.full);assert.ok(createPlan({code:false}).scope.full);
 assert.equal(validScope({...fullScope(),books:false}),false);
 assert.equal(validScope({code:true,books:false,native:false,full:false,groups:[]}),false);
});
test('known layout inputs and registered tests select only direct coverage plus smoke',()=>{
 const smoke='tests/book-integrity-smoke.test.mjs',desktop='tests/desktop-responsive-layout.playwright.e2e.mjs',phone='tests/phone-readability.playwright.e2e.mjs';
 const fixture='tests/fixtures/phone-audit.mjs',css='client/ui/production-timeline.css';
 for(const [inputs,expected] of [[[fixture],[desktop,phone]],[[phone],[phone]],[[css,fixture,phone],[desktop,phone,'tests/desktop-css-scope.test.mjs','tests/phone-readability-css.test.mjs']], [['scripts/test-plan.mjs','tests/manifest.json'],['tests/ci-scope.test.mjs','tests/test-pr.test.mjs','tests/test-tiers.test.mjs']]]){
  const scope=changeScope(inputs),plan=createPlan(JSON.parse(JSON.stringify(scope)));
  const browser=expected.filter(file=>file===desktop||file===phone);
  assert.deepEqual(new Set(files(plan)),new Set([smoke,...expected.filter(file=>!browser.includes(file))]),inputs.join(', '));
  assert.deepEqual(new Set(plan.deferredBrowser),new Set(browser));
  assert.ok(scope.code);assert.ok(!scope.full&&!plan.native);
  assert.ok(plan.tests.filter(entry=>expected.includes(entry.file)).every(entry=>entry.mode==='full'));
 }
 const mixed=createPlan(changeScope([fixture,'server/system-settings.ts']));
 const settings=createPlan(changeScope(['server/system-settings.ts']));
 assert.deepEqual(new Set(files(mixed)),new Set(files(settings)));
 assert.deepEqual(new Set(mixed.deferredBrowser),new Set([desktop,phone,...settings.deferredBrowser]));
 assert.ok(mixed.native);
 assert.ok(createPlan({...changeScope([fixture]),directTests:['tests/missing.test.mjs']}).scope.full);
});
test('mixed changes are a union and supported platforms are explicit',()=>{
 const plan=createPlan(changeScope(['client/ui/Reader.tsx','server/claude-runner.ts']));
 const union=new Set([...files(createPlan(changeScope(['client/ui/Reader.tsx']))),...files(createPlan(changeScope(['server/claude-runner.ts'])))]);
 assert.deepEqual(new Set(files(plan)),union);
 const owner=createPlan(changeScope(['tests/startup-cli-flow.test.mjs']));assert.deepEqual(files(owner),['tests/book-integrity-smoke.test.mjs','tests/startup-cli-flow.test.mjs']);
 const windows=createPlan(fullScope(),undefined,{platform:'win32'});assert.ok(windows.excluded.includes('tests/startup-pty.test.mjs'));assert.ok(windows.excluded.includes('tests/claude-provider.test.mjs'));
 assert.ok(!files(windows).includes('tests/startup-pty.test.mjs'));
});
test('real merge-base diffs retain deleted rename paths and output a reusable plan input',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-ci-scope-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init');git('config','user.name','Test');git('config','user.email','test@example.org');
 await writeFile(path.join(root,'runtime.js'),'export const value=1;');git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');
 git('mv','runtime.js','README.md');git('commit','-m','rename');const head=git('rev-parse','HEAD');
 for(const [left,right] of [[base,head],[base,base],[base,'missing-ref'],['',head]])assert.ok(detectScope(left,right,root).full);
 await mkdir(path.join(root,'tests'));await writeFile(path.join(root,'tests/book-integrity-smoke.test.mjs'),'');
 const metadata=loadMetadata();await writeFile(path.join(root,'tests/manifest.json'),JSON.stringify({...metadata,tests:metadata.tests.filter(entry=>entry.file==='tests/book-integrity-smoke.test.mjs')}));
 const output=path.join(root,'output'),entry=fileURLToPath(new URL('../scripts/ci-scope.mjs',import.meta.url));
 execFileSync(process.execPath,[entry],{cwd:root,env:{...process.env,BASE:base,HEAD:head,GITHUB_OUTPUT:output}});
 const values=Object.fromEntries((await readFile(output,'utf8')).trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
 assert.equal(values.code,'true');assert.equal(values.native,'true');assert.equal(values.books,'true');assert.equal(values.browser,'false');assert.ok(JSON.parse(values.scope).full);
});

test('workflow event gates qualify main/tags and aggregate selected JS/native failures',async()=>{
 const workflow=await readFile('.github/workflows/desktop-macos.yml','utf8');
 function job(name){return workflow.split('\n  '+name+':\n')[1].split(/\n {2}[a-z]+:\n/)[0];}
 function enabled(name,github,needs={}){const condition=job(name).match(/^ {4}if: (.+)$/m)[1].replace(/^\$\{\{ | \}\}$/g,'');return new Function('github','needs','cancelled','startsWith',`return (${condition});`)(github,needs,()=>false,(value,prefix)=>value.startsWith(prefix));}
 const needs={scope:{outputs:{native:'false'}},checks:{result:'success'},build:{result:'success'}};
 for(const [event,ref,native,build,release] of [['pull_request','refs/pull/1/merge',false,false,false],['push','refs/heads/main',false,false,false],['push','refs/tags/v1.0.0',false,true,true],['workflow_dispatch','refs/heads/main',false,true,false]]){
  const github={event_name:event,ref};assert.equal(enabled('javascript',github,needs),true);assert.equal(enabled('native',github,needs),native);assert.equal(enabled('checks',github,needs),true);assert.equal(enabled('build',github,needs),build);assert.equal(enabled('release',github,needs),release);
 }
 assert.ok(enabled('native',{event_name:'pull_request'}, {...needs,scope:{outputs:{}}}),'scope failure requests native coverage');
 assert.ok(enabled('native',{event_name:'pull_request'}, {...needs,scope:{outputs:{native:'true'}}}));
 const shell=job('checks').split('        run: |\n')[1].split('\n').map(line=>line.replace(/^ {10}/,'')).join('\n');
 for(const [js,native,required,success] of [['success','skipped','false',true],['success','success','true',true],['success','failure','true',false],['success','skipped','true',false],['failure','success','true',false],['cancelled','skipped','false',false]]){
  const result=spawnSync('bash',['-e','-c',shell],{env:{...process.env,JS_RESULT:js,NATIVE_RESULT:native,NATIVE_REQUIRED:required},stdio:'pipe'});assert.equal(result.status===0,success,`${js}/${native}/${required}`);
 }
 assert.match(job('javascript'),/pnpm test:pr --full/);assert.match(job('javascript'),/pnpm exec playwright install chromium/);
 assert.match(job('native'),/"resources":\[\]/);assert.match(job('native'),/"frontendDist":\["\.\.\/desktop\/index\.html"\]/);assert.doesNotMatch(job('native'),/desktop:prepare|desktop:build|scripts\/desktop-node/);
 assert.match(job('build'),/pnpm run desktop:test/);assert.match(job('build'),/toolchain: 1.93.0/);assert.match(job('native'),/toolchain: 1.93.0/);
});

test('generation client helpers retain direct integration consumers and core service E2Es',()=>{
 for(const file of ['lib/reader-production-client.ts','lib/shelf-generation.ts']){
  const plan=createPlan(changeScope([file]));
  for(const consumer of ['story-flow-control','continuous-story-discovery','manual-extraction-start','reader-intake'])assert.ok(files(plan).includes(`tests/${consumer}.test.mjs`),file+' -> '+consumer);
  for(const e2e of extended)assert.ok(files(plan).includes(e2e));
 }
 assert.ok(changeScope(['server/local-generation.ts']).books);
});
