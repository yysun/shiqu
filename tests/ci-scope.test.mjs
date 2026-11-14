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
test('documentation stays test-free; domain changes run only affected automatic suites',()=>{
 const docs=createPlan(changeScope(['README.md','.docs/reqs/example.md','LICENSE']));
 assert.deepEqual(files(docs),[]);assert.equal(docs.native,false);
 const ui=createPlan(changeScope(['client/ui/Reader.css']));
 assert.ok(!files(ui).includes('tests/book-integrity-smoke.test.mjs'));
 assert.ok(files(ui).includes('tests/reader-interaction.test.mjs'));
 // 客户端样式改动保留阅读业务契约，不再运行已退役的界面或浏览器套件。
 for(const file of ['local-server','production-queue','deepseek-provider','gemini-stage-schema','separate-providers','task-reasoning','cli-library','startup-cli-flow','desktop-internet','local-books'])assert.ok(!files(ui).includes(`tests/${file}.test.mjs`),file);
 assert.ok(!ui.native);assert.deepEqual(ui.deferredBrowser,[]);assert.ok(ui.tests.every(test=>test.level!=='browser-e2e'));
});
test('affected areas keep source flows automatic and model E2Es on demand',()=>{
 for(const file of ['server/local-story-discovery.ts','lib/reader-review.ts','server/production-queue.ts','server/generation.ts','server/book-image-reference.ts']){
  const plan=createPlan(changeScope([file]));
  for(const e2e of extended){assert.ok(!files(plan).includes(e2e),file+' must not auto-run '+e2e);assert.ok(plan.manualOnly.includes(e2e),file+' should list '+e2e+' as on demand');}
  assert.equal(plan.tests.length,new Set(files(plan)).size);
 }
 const provider=createPlan(changeScope(['server/claude-runner.ts']));
 assert.ok(provider.manualOnly.includes('tests/claude-provider-flow.test.mjs'));
 assert.ok(provider.manualOnly.includes('tests/deepseek-provider.test.mjs'));
 assert.ok(!files(provider).some(file=>loadMetadata().tests.find(entry=>entry.file===file)?.modelRelated));
 // 供应商改动不再顺带运行其他责任域的本地服务测试。
 assert.ok(!files(provider).includes('tests/local-server.test.mjs'));
 const books=createPlan(changeScope(['data/library/originals/book.md']));assert.ok(!files(books).includes('tests/local-books.test.mjs'));assert.ok(books.manualOnly.includes('tests/local-books.test.mjs'));
});
test('known sources and scripts map to their domains instead of the unknown-file fallback',()=>{
 for(const [file,group] of [['server/local-story-search.ts','discovery'],['server/story-card-embeddings.ts','discovery'],['lib/reader-shelf.ts','reader'],['lib/desktop-view.ts','reader'],['server/agent-cli.ts','tooling'],['scripts/dev.mjs','tooling'],['scripts/prepare-reading-blocks.mjs','books']]){
  const scope=changeScope([file]);assert.ok(scope.groups.includes(group),file+' -> '+group);
  assert.ok(!scope.groups.includes('safety')&&!scope.native,file+' should not fall back');
 }
 assert.equal(changeScope(['server/local-story-search.ts']).native,false);
 assert.ok(changeScope(['server/provider-settings-access.ts']).native);
});
test('native, shared schemas and uncertain changes retain scoped safeguards',()=>{
 for(const file of ['src-tauri/src/runtime.rs','server/system-settings.ts','lib/system-settings.ts'])assert.ok(changeScope([file]).native,file);
 for(const file of ['package.json','pnpm-lock.yaml','.nvmrc','.npmrc','tsconfig.json','.github/workflows/main-ci.yml','.github/workflows/desktop-release.yml','server/new-feature.ts','tests/fixtures/startup_pty.py','tests/fixtures/story-discovery-preview.mjs','tests/unregistered.test.mjs']){
  const scope=changeScope([file]);assert.ok(scope.native&&!scope.full,file);
  for(const group of ['safety','startup','tooling'])assert.ok(scope.groups.includes(group),file+' -> '+group);
 }
 for(const file of ['lib/reader-model.ts','lib/reader-generation-contract.ts','db/library-format.json','drizzle/0020.sql']){
  const scope=changeScope([file]);assert.ok(scope.native&&!scope.full&&scope.groups.includes('storage'),file);
 }
 for(const scope of [changeScope([]),createPlan(undefined).scope,createPlan({code:false}).scope])assert.ok(scope.native&&!scope.full);
 assert.ok(changeScope(['server/new-feature.ts','lib/reader-review.ts']).groups.includes('review'));
 assert.equal(validScope({...fullScope(),books:false}),false);
 assert.equal(validScope({code:true,books:false,native:false,full:false,groups:[]}),false);
});
test('editorial prompt changes run registered consumers without native checks',()=>{
 const input='lib/reader-prompts.ts',legacy='lib/reader-legacy-prompts.ts';
 const plan=createPlan(changeScope([input]));
 assert.equal(plan.scope.full,false);
 assert.equal(plan.native,false);
 assert.deepEqual(plan.scope.groups,[]);
 assert.deepEqual(new Set([...files(plan),...plan.manualOnly]),new Set(plan.scope.directTests));
 for(const consumer of ['prompt-contracts','story-reflection','story-reflection-candidates','storyboard-batches','continuous-story-discovery']){
  assert.ok(plan.manualOnly.includes(`tests/${consumer}.test.mjs`),consumer+' remains available on demand');
 }
 const legacyPlan=createPlan(changeScope([legacy]));assert.deepEqual(files(legacyPlan),[]);assert.ok(legacyPlan.manualOnly.includes('tests/prompt-contracts.test.mjs'));
 assert.equal(changeScope([input,'src-tauri/src/runtime.rs']).native,true);
 assert.ok(changeScope([input,'lib/reader-model.ts']).groups.includes('storage'));
 assert.equal(changeScope([input,'lib/reader-model.ts']).native,true);
});
test('client assets use reader contracts; loopback service suites stay on demand',()=>{
 const service='tests/story-generation-state-machine.e2e.mjs',css='client/ui/production-timeline.css';
 const styleScope=changeScope([css]),stylePlan=createPlan(styleScope);
 assert.ok(styleScope.groups.includes('reader'));assert.ok(files(stylePlan).includes('tests/reader-interaction.test.mjs'));assert.deepEqual(stylePlan.deferredBrowser,[]);
 const serviceScope=changeScope([service]),servicePlan=createPlan(serviceScope);
 assert.deepEqual(serviceScope.directTests,[service]);assert.deepEqual(files(servicePlan),[]);assert.deepEqual(servicePlan.manualOnly,[service]);assert.deepEqual(servicePlan.deferredBrowser,[]);
 const mixed=createPlan(changeScope([css,service]));assert.ok(!files(mixed).includes(service));assert.deepEqual(mixed.deferredBrowser,[]);assert.deepEqual(new Set(mixed.manualOnly),new Set(['tests/reader-source-runtime.test.mjs','tests/shelf-favorites.test.mjs','tests/shelf-generation.test.mjs',service]));
 const registry=createPlan(changeScope(['scripts/test-plan.mjs','tests/manifest.json']));
 assert.deepEqual(new Set(files(registry)),new Set(['tests/test-assurance.test.mjs']));
 for(const manual of ['tests/ci-scope.test.mjs','tests/test-pr.test.mjs','tests/test-tiers.test.mjs'])assert.ok(registry.manualOnly.includes(manual));
 const settings=createPlan(changeScope(['server/system-settings.ts']));assert.ok(settings.native);
 const invalid=createPlan({...styleScope,directTests:['tests/missing.test.mjs']});
 assert.ok(invalid.native&&!invalid.scope.full);
});
test('mixed changes are a union and supported platforms are explicit',()=>{
 const plan=createPlan(changeScope(['client/ui/Reader.tsx','server/claude-runner.ts']));
 const union=new Set([...files(createPlan(changeScope(['client/ui/Reader.tsx']))),...files(createPlan(changeScope(['server/claude-runner.ts'])))]);
 assert.deepEqual(new Set(files(plan)),union);
 const owner=createPlan(changeScope(['tests/startup-cli-flow.test.mjs']));assert.deepEqual(files(owner),[]);assert.deepEqual(owner.manualOnly,['tests/startup-cli-flow.test.mjs']);
 const windows=createPlan(fullScope(),undefined,{platform:'win32'});assert.ok(windows.excluded.includes('tests/startup-pty.test.mjs'));assert.ok(windows.excluded.includes('tests/claude-provider.test.mjs'));
 assert.ok(!files(windows).includes('tests/startup-pty.test.mjs'));
});
test('real merge-base diffs retain deleted rename paths and output a reusable plan input',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-ci-scope-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init');git('config','user.name','Test');git('config','user.email','test@example.org');
 await writeFile(path.join(root,'runtime.js'),'export const value=1;');git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');
 git('mv','runtime.js','README.md');git('commit','-m','rename');const head=git('rev-parse','HEAD');
 for(const [left,right] of [[base,head],[base,base],[base,'missing-ref'],['',head]]){
  const scope=detectScope(left,right,root);assert.ok(scope.native&&!scope.full);
  assert.ok(scope.groups.includes('safety'));
 }
 git('checkout','--detach',base);
 await mkdir(path.join(root,'src-tauri/src'),{recursive:true});
 await writeFile(path.join(root,'src-tauri/src/runtime.rs'),'fn old_runtime() {}');
 git('add','.');git('commit','-m','old tip');const oldTip=git('rev-parse','HEAD');
 assert.equal(detectScope(oldTip,head,root).groups.includes('desktop'),false);
 assert.equal(detectScope(oldTip,head,root,{mergeBase:false}).groups.includes('desktop'),true);
 await mkdir(path.join(root,'tests'));await writeFile(path.join(root,'tests/book-integrity-smoke.test.mjs'),'');
 const metadata=loadMetadata();await writeFile(path.join(root,'tests/manifest.json'),JSON.stringify({...metadata,tests:metadata.tests.filter(entry=>entry.file==='tests/book-integrity-smoke.test.mjs')}));
 const output=path.join(root,'output'),entry=fileURLToPath(new URL('../scripts/ci-scope.mjs',import.meta.url));
 execFileSync(process.execPath,[entry],{cwd:root,env:{...process.env,BASE:base,HEAD:head,GITHUB_OUTPUT:output}});
 const values=Object.fromEntries((await readFile(output,'utf8')).trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
 assert.equal(values.code,'true');assert.equal(values.native,'true');assert.equal(values.books,'false');assert.equal(values.browser,'false');assert.equal(JSON.parse(values.scope).full,false);
});

test('split CI and desktop release workflows keep their event gates and aggregate failures',async()=>{
 const ci=await readFile('.github/workflows/main-ci.yml','utf8');
 const releaseWorkflow=await readFile('.github/workflows/desktop-release.yml','utf8');
 function job(workflow,name){return workflow.split('\n  '+name+':\n')[1].split(/\n {2}[a-z]+:\n/)[0];}
 function enabled(workflow,name,github,needs={}){const match=job(workflow,name).match(/^ {4}if: (.+)$/m);if(!match)return true;const condition=match[1].replace(/^\$\{\{ | \}\}$/g,'');return new Function('github','needs','cancelled','startsWith',`return (${condition});`)(github,needs,()=>false,(value,prefix)=>value.startsWith(prefix));}
 const needs={scope:{outputs:{native:'false'}},checks:{result:'success'},build:{result:'success'}};
 assert.match(ci,/name: Main CI/);assert.match(ci,/branches: \[main\]/);assert.match(ci,/pull_request:/);assert.match(ci,/workflow_dispatch:/);assert.match(ci,/workflow_call:/);
 assert.match(releaseWorkflow,/name: Desktop release/);assert.match(releaseWorkflow,/tags: \['v\*'\]/);assert.match(releaseWorkflow,/workflow_dispatch:/);assert.doesNotMatch(releaseWorkflow,/pull_request:|branches: \[main\]/);
 assert.match(job(releaseWorkflow,'checks'),/uses: \.\/\.github\/workflows\/main-ci\.yml/);assert.match(job(releaseWorkflow,'build'),/needs: checks/);
 for(const [event,ref,native] of [['pull_request','refs/pull/1/merge',false],['push','refs/heads/main',false],['workflow_dispatch','refs/heads/main',false]]){
  const github={event_name:event,ref};
  assert.equal(enabled(ci,'scope',github,needs),true);assert.equal(enabled(ci,'javascript',github,needs),true);assert.equal(enabled(ci,'native',github,needs),native);assert.equal(enabled(ci,'checks',github,needs),true);
 }
 for(const [event,ref,build,release] of [['pull_request','refs/pull/1/merge',false,false],['push','refs/heads/main',false,false],['push','refs/tags/v1.0.0',true,true],['workflow_dispatch','refs/heads/main',true,false]]){
  const github={event_name:event,ref};
  const runNeeds=event==='push'&&ref.startsWith('refs/tags/v')?{...needs,checks:{result:'skipped'}}:needs;
  assert.equal(enabled(releaseWorkflow,'checks',github,runNeeds),event==='workflow_dispatch');assert.equal(enabled(releaseWorkflow,'build',github,runNeeds),build);assert.equal(enabled(releaseWorkflow,'release',github,runNeeds),release);
 }
 assert.ok(enabled(ci,'native',{event_name:'pull_request'}, {...needs,scope:{outputs:{}}}),'scope failure requests native coverage');
 assert.ok(enabled(ci,'native',{event_name:'pull_request'}, {...needs,scope:{outputs:{native:'true'}}}));
 const shell=job(ci,'checks').split('        run: |\n')[1].split('\n').map(line=>line.replace(/^ {10}/,'')).join('\n');
 for(const [js,native,required,success] of [['success','skipped','false',true],['success','success','true',true],['success','failure','true',false],['success','skipped','true',false],['failure','success','true',false],['cancelled','skipped','false',false]]){
  const result=spawnSync('bash',['-e','-c',shell],{env:{...process.env,JS_RESULT:js,NATIVE_RESULT:native,NATIVE_REQUIRED:required},stdio:'pipe'});assert.equal(result.status===0,success,`${js}/${native}/${required}`);
 }
 assert.match(job(ci,'scope'),/github\.event\.pull_request\.base\.sha \|\| github\.event\.before \|\| 'HEAD\^'/);
 assert.match(job(ci,'javascript'),/SHIQU_TEST_SCOPE:[^\n]+\n\s+run: pnpm test:pr\n/);
 assert.doesNotMatch(job(ci,'javascript'),/--full|playwright install/);
 assert.match(job(ci,'native'),/"resources":\[\]/);assert.match(job(ci,'native'),/"frontendDist":\["\.\.\/desktop\/index\.html"\]/);assert.doesNotMatch(job(ci,'native'),/desktop:prepare|desktop:build|scripts\/desktop-node/);
 assert.match(job(releaseWorkflow,'build'),/cargo test --manifest-path src-tauri\/Cargo\.toml --locked --lib -- --skip config::tests/);assert.match(job(releaseWorkflow,'build'),/toolchain: 1.93.0/);assert.match(job(ci,'native'),/toolchain: 1.93.0/);
});

test('generation client helpers retain direct integration consumers and defer model E2Es',()=>{
 for(const file of ['lib/reader-production-client.ts','lib/shelf-generation.ts']){
  const plan=createPlan(changeScope([file]));
  for(const consumer of ['story-flow-control','continuous-story-discovery','manual-extraction-start','reader-intake']){
   const name=`tests/${consumer}.test.mjs`,entry=loadMetadata().tests.find(test=>test.file===name);
   assert.ok((entry.modelRelated?plan.manualOnly:files(plan)).includes(name),file+' -> '+consumer);
  }
  for(const e2e of extended){assert.ok(!files(plan).includes(e2e));assert.ok(plan.manualOnly.includes(e2e));}
 }
 assert.ok(changeScope(['server/local-generation.ts']).books);
});
