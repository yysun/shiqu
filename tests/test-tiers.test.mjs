// 显式归属、注册表完整性与平台约束不能依赖测试源码中的夹具名称；
// 测试经由 tests/ 导入边可达的夹具必须登记为 covers，夹具改动才能只选消费者。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {tierTests,automaticRegressionTests} from '../scripts/test-tiers.mjs';
import {createRequire} from 'node:module';
import {createPlan,changeScope} from '../scripts/test-plan.mjs';
import {loadMetadata,supported} from '../scripts/test-metadata.mjs';

test('metadata partitions automatic regressions and assigns assurance suites to on-demand runners',async()=>{
 const metadata=loadMetadata(),unit=await tierTests('unit'),flows=await tierTests('flows'),books=await tierTests('books');
 const automatic=await automaticRegressionTests();
 const all=(await readdir('tests')).filter(name=>name.endsWith('.test.mjs')).map(name=>'tests/'+name).filter(file=>supported(metadata.tests.find(entry=>entry.file===file)));
 const manualAssurance=metadata.tests.filter(entry=>entry.file.endsWith('.test.mjs')&&entry.level!=='native'&&entry.manualOnly&&entry.suite!=='books').map(entry=>entry.file);
 const partition=[...unit,...flows,...books,...manualAssurance];
 assert.equal(partition.length,new Set(partition).size);
 assert.deepEqual(new Set(partition),new Set(all));
 assert.ok(metadata.tests.filter(entry=>entry.groups.some(group=>['safety','startup'].includes(group))).every(entry=>entry.manualOnly));
 assert.ok(metadata.tests.filter(entry=>entry.requiresLoopback).every(entry=>entry.manualOnly));
 assert.ok(metadata.tests.filter(entry=>entry.modelRelated).every(entry=>entry.manualOnly),'model-related tests stay on demand');
 assert.ok(manualAssurance.includes('tests/local-server.test.mjs'));
 for(const stem of ['claude-provider','deepseek-provider','gemini-stage-schema','separate-providers','task-reasoning']){
  const file=`tests/${stem}.test.mjs`;
  if(stem==='claude-provider'&&process.platform==='win32')continue;
  assert.ok(!unit.includes(file),file+' is on demand');
  assert.ok(manualAssurance.includes(file),file+' remains available on demand');
 }
 for(const stem of ['claude-provider','deepseek-provider','gemini-stage-schema','separate-providers','task-reasoning']){
  const file=`tests/${stem}-flow.test.mjs`;assert.ok(!flows.includes(file),file+' is on demand');assert.ok(manualAssurance.includes(file),file+' remains available on demand');
 }
 assert.ok(!flows.includes('tests/startup-cli-flow.test.mjs'));
 assert.ok(metadata.tests.find(entry=>entry.file==='tests/startup-cli-flow.test.mjs').manualOnly);
 assert.equal(books.length,10);
 assert.ok(metadata.tests.filter(entry=>entry.suite==='books').every(entry=>entry.manualOnly),'book corpus checks stay selectable only through the explicit books command');
 assert.deepEqual(new Set(automatic),new Set([...unit,...flows].filter(file=>!metadata.tests.find(entry=>entry.file===file)?.manualOnly)),'the aggregate runner excludes manual-only suites');
 for(const retired of [
  'tests/desktop-responsive-layout.playwright.e2e.mjs','tests/phone-navigation.playwright.e2e.mjs','tests/phone-readability.playwright.e2e.mjs','tests/phone-readability-css.test.mjs',
  'tests/desktop-css-scope.test.mjs','tests/desktop-library-ui.test.mjs','tests/desktop-release-notice.playwright.e2e.mjs','tests/desktop-service-console.playwright.e2e.mjs','tests/desktop-view.test.mjs',
  'tests/history-dirty-ui.test.mjs','tests/history-steps.test.mjs','tests/recent-stories-ui.test.mjs','tests/reader-startup.e2e.mjs','tests/retained-state-ui.test.mjs','tests/review-history-ui.test.mjs',
  'tests/release-smoke.playwright.e2e.mjs','tests/shelf-art-style.test.mjs','tests/shelf-browser.test.mjs','tests/shelf-layout-ui.test.mjs','tests/shelf-retry-ui.test.mjs',
  'tests/story-chapter-picker-ui.test.mjs','tests/story-discovery-modes.e2e.mjs','tests/story-lifecycle.playwright.e2e.mjs','tests/story-publication-ui.test.mjs','tests/story-requirements-ui.test.mjs',
  'tests/story-stage-feedback.test.mjs','tests/story-storage-consolidation.e2e.mjs','tests/story-title-ui.test.mjs','tests/story-workspace-ui.test.mjs','tests/storyboard-ui.test.mjs','tests/unified-story-setup-ui.test.mjs',
 ])assert.ok(!metadata.tests.some(entry=>entry.file===retired),retired+' has been retired');
 assert.equal(metadata.tests.filter(entry=>entry.level==='native').length,4);
 for(const file of (await readdir('tests')).filter(name=>name.endsWith('.e2e.mjs')))assert.ok(metadata.tests.find(entry=>entry.file==='tests/'+file).gates.length);
});

test('metadata ignores fixture-looking source text and rejects missing, duplicate and invalid ownership',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-metadata-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'tests'));
 const original=JSON.parse(await readFile('tests/manifest.json','utf8'));
 const entries=['book-integrity-smoke','test-assurance'].map(stem=>structuredClone(original.tests.find(entry=>entry.file===`tests/${stem}.test.mjs`)));
 const metadata={...original,tests:entries},save=()=>writeFile(path.join(root,'tests/manifest.json'),JSON.stringify(metadata));
 for(const entry of entries)await writeFile(path.join(root,entry.file),'productionFixture(); import {books} from "anything";');
 await save();assert.deepEqual(await tierTests('unit',root),['tests/test-assurance.test.mjs']);assert.equal((await tierTests('flows',root)).length,0);
 await writeFile(path.join(root,'tests/new.test.mjs'),'');assert.throws(()=>loadMetadata(root),/Unregistered/);await rm(path.join(root,'tests/new.test.mjs'));
 for(const [field,value,pattern] of [['groups',['typo'],/groups/],['platforms',['macos'],/platforms/],['level','guessed',/Invalid metadata/],['gates',['typo'],/gates/],['covers',['../private'],/source ownership/],['covers',['lib/a.ts','lib/a.ts'],/source ownership/],['relatedPathLiterals','sometimes',/related path-literal/],['modelRelated','sometimes',/model-related/]]){
  const saved=entries[1][field];entries[1][field]=value;await save();assert.throws(()=>loadMetadata(root),pattern);entries[1][field]=saved;
 }
 metadata.tests.push(entries[0]);await save();assert.throws(()=>loadMetadata(root),/duplicate/);metadata.tests.pop();
 entries[1].file='tests/missing.test.mjs';await save();assert.throws(()=>loadMetadata(root),/Missing registered/);
 await assert.rejects(tierTests('invalid',root),/unit, flows or books/);
});


test('explicit ownership retains production imports and known fixture consumers with full flags',async()=>{
 const ts=createRequire(import.meta.url)('typescript'),metadata=loadMetadata();
 const knownFixtures=new Set(metadata.tests.flatMap(entry=>entry.covers).filter(file=>file.startsWith('tests/fixtures/')));
 for(const entry of metadata.tests){
  if(entry.level==='native')continue;
  const source=await readFile(entry.file,'utf8'),ast=ts.createSourceFile(entry.file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),imports=new Set();
  function add(spec){if(!spec?.startsWith('.'))return;const file=path.posix.normalize(path.posix.join(path.posix.dirname(entry.file),spec));if(/^(?:server|lib|scripts|client|data)\//.test(file)||knownFixtures.has(file))imports.add(file);}
  function visit(node){if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier))add(node.moduleSpecifier.text);if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0]))add(node.arguments[0].text);ts.forEachChild(node,visit);}visit(ast);
  for(const file of imports){
   assert.ok(entry.covers.includes(file),entry.file+' must declare '+file);
   const plan=createPlan(changeScope([file],metadata),metadata,{includeBrowser:true});if(!supported(entry))continue;
   const selected=plan.tests.find(test=>test.file===entry.file);
   if(entry.manualOnly)assert.ok(plan.manualOnly.includes(entry.file),entry.file+' is a manual-only consumer of '+file);
   else{assert.ok(selected,entry.file+' is a consumer of '+file);assert.equal(selected.mode,'full');}
  }
 }
 for(const entry of metadata.tests.filter(entry=>entry.level==='native'))for(const source of entry.covers)assert.ok(changeScope([source],metadata).native,source+' requires '+entry.file);
});

test('every fixture reached through a test file or its fixtures is declared, so fixture edits select consumers',async()=>{
 const {testImports}=await import('../scripts/test-graph.mjs'),metadata=loadMetadata();
 const graph=await testImports(metadata.tests.filter(entry=>entry.level!=='native').map(entry=>entry.file));
 for(const entry of metadata.tests.filter(entry=>entry.level!=='native')){
  const found=graph.get(entry.file);assert.ok(found,entry.file+' must build');
  for(const fixture of [...found.local].filter(file=>file.startsWith('tests/fixtures/')))assert.ok(entry.covers.includes(fixture),entry.file+' must declare '+fixture);
 }
 const consumers=createPlan(changeScope(['tests/fixtures/production-data.mjs'],metadata),metadata);
 assert.equal(consumers.scope.full,false);assert.ok(consumers.manualOnly.includes('tests/adaptive-storyboard-review.test.mjs'));
});
