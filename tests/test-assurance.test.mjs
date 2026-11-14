// 固定手动套件的选择边界，避免它们进入常规影响计划、CI 或发布门禁。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectAssuranceTests} from '../scripts/test-assurance.mjs';
import {automaticRegressionTests,tierTests} from '../scripts/test-tiers.mjs';
import {createPlan,changeScope} from '../scripts/test-plan.mjs';
import {loadMetadata} from '../scripts/test-metadata.mjs';
import {selectTests} from '../scripts/test-story-e2e.mjs';

test('safety, startup, and loopback assurance suites stay manual and retain dedicated runners',async()=>{
 const metadata=loadMetadata(),assurance=metadata.tests.filter(entry=>entry.groups.some(group=>['safety','startup'].includes(group))||entry.requiresLoopback);
 assert.ok(assurance.length>0);
 assert.ok(assurance.every(entry=>entry.manualOnly),assurance.filter(entry=>!entry.manualOnly).map(entry=>entry.file).join(', '));
 for(const group of ['safety','startup','loopback']){
  const expected=assurance.filter(entry=>(group==='loopback'?entry.requiresLoopback:entry.groups.includes(group))&&entry.level!=='native').map(entry=>entry.file);
  assert.deepEqual(selectAssuranceTests([group],metadata),expected);
 }
 const javascript=assurance.filter(entry=>entry.level!=='native').map(entry=>entry.file),automatic=await automaticRegressionTests(),unit=await tierTests('unit'),flows=await tierTests('flows');
 for(const file of javascript){
  assert.ok(!automatic.includes(file),file+' must stay out of the aggregate automatic suite');
  assert.ok(!unit.includes(file),file+' must stay out of the automatic contract suite');
  assert.ok(!flows.includes(file),file+' must stay out of the automatic flow suite');
  assert.ok(!(await selectTests()).includes(file),file+' must stay out of the default service gate');
  for(const gate of ['release','npm','full'])assert.ok(!(await selectTests(gate)).includes(file),file+' must stay out of '+gate);
 }
 for(const source of ['README.md','server/system-settings.ts','tests/book-integrity-smoke.test.mjs']){
  const plan=createPlan(changeScope([source]),metadata);
  assert.ok(plan.tests.every(entry=>!assurance.some(manual=>manual.file===entry.file)),source+' selected an on-demand suite');
 }
 const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.match(packageJson.scripts['test:safety'],/scripts\/test-assurance\.mjs safety/);
 assert.match(packageJson.scripts['test:startup'],/scripts\/test-assurance\.mjs startup/);
 assert.match(packageJson.scripts['test:loopback'],/scripts\/test-assurance\.mjs loopback/);
 assert.match(packageJson.scripts['test:assurance'],/scripts\/test-assurance\.mjs safety startup loopback.*desktop:test/);
 const workflow=await readFile(new URL('../.github/workflows/main-ci.yml',import.meta.url),'utf8');
 assert.match(workflow,/--skip config::tests/,'native startup settings tests stay out of automatic CI');
 assert.doesNotMatch(workflow,/tests\/desktop-service-console\.test\.mjs/,'loopback integration tests stay out of main CI');
 const releaseWorkflow=await readFile(new URL('../.github/workflows/desktop-release.yml',import.meta.url),'utf8');
 assert.doesNotMatch(releaseWorkflow,/tests\/desktop-service-console\.test\.mjs/,'loopback integration tests stay out of desktop release automation');
 assert.match(releaseWorkflow,/cargo test .*--skip config::tests/,'startup configuration tests stay manual during desktop release');
 assert.doesNotMatch(releaseWorkflow,/pnpm @\(['"]run['"], ['"]desktop:test['"]\)/,'desktop release must not rerun on-demand config tests');
});

test('model-dependent provider and generation suites are manual-only and retain explicit runners',async()=>{
 const metadata=loadMetadata(),models=metadata.tests.filter(entry=>entry.modelRelated);
 assert.ok(models.length>=70,'provider and controlled-generation tests remain registered');
 assert.ok(models.every(entry=>entry.manualOnly),models.filter(entry=>!entry.manualOnly).map(entry=>entry.file).join(', '));
 assert.deepEqual(selectAssuranceTests(['models'],metadata),models.filter(entry=>entry.level!=='native'&&entry.platforms.includes(process.platform)).map(entry=>entry.file));
 const automatic=await automaticRegressionTests(),unit=await tierTests('unit'),flows=await tierTests('flows'),full=await selectTests('full');
 for(const entry of models){
  assert.ok(!automatic.includes(entry.file),entry.file+' must stay out of automatic regression');
  assert.ok(!unit.includes(entry.file),entry.file+' must stay out of automatic unit tests');
  assert.ok(!flows.includes(entry.file),entry.file+' must stay out of automatic flows');
  assert.ok(!full.includes(entry.file),entry.file+' must stay out of the full automatic gate');
  for(const gate of ['release','npm'])assert.ok(!(await selectTests(gate)).includes(entry.file),entry.file+' must stay out of '+gate);
 }
 const extended=await selectTests('extended');
 for(const entry of models.filter(entry=>entry.suite==='e2e'&&entry.gates.includes('extended')))assert.ok(extended.includes(entry.file),entry.file+' remains available through the explicit extended E2E command');
 assert.ok(models.some(entry=>entry.file==='tests/local-image-batches.test.mjs'));
 const impact=createPlan(changeScope(['server/generation.ts']),metadata);
 assert.ok(models.every(entry=>!impact.tests.some(selected=>selected.file===entry.file)), 'generation source changes must not auto-run model-related tests');
 const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.match(packageJson.scripts['test:models'],/scripts\/test-assurance\.mjs models/);
});
