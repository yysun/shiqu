// 显式归属、注册表完整性与平台约束不能依赖测试源码中的夹具名称。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {tierTests} from '../scripts/test-tiers.mjs';
import {createRequire} from 'node:module';
import {createPlan,changeScope} from '../scripts/test-plan.mjs';
import {loadMetadata,supported} from '../scripts/test-metadata.mjs';

test('metadata partitions all regressions, owns every E2E/native module and preserves safety checks',async()=>{
 const metadata=loadMetadata(),unit=await tierTests('unit'),flows=await tierTests('flows'),books=await tierTests('books');
 const all=(await readdir('tests')).filter(name=>name.endsWith('.test.mjs')).map(name=>'tests/'+name).filter(file=>supported(metadata.tests.find(entry=>entry.file===file)));
 assert.equal(unit.length+flows.length+books.length,new Set([...unit,...flows,...books]).size);
 assert.deepEqual(new Set([...unit,...flows,...books]),new Set(all));
 for(const stem of ['book-integrity-smoke','local-server','ci-scope','test-tiers','claude-provider','deepseek-provider','gemini-stage-schema','separate-providers','task-reasoning','startup-matrix']){
  if(stem==='claude-provider'&&process.platform==='win32')continue;
  assert.ok(unit.includes(`tests/${stem}.test.mjs`),stem);
 }
 for(const stem of ['claude-provider','deepseek-provider','gemini-stage-schema','separate-providers','task-reasoning'])assert.ok(flows.includes(`tests/${stem}-flow.test.mjs`));
 assert.ok(flows.includes('tests/startup-cli-flow.test.mjs'));
 assert.equal(books.length,10);
 assert.equal(metadata.tests.filter(entry=>entry.level==='native').length,4);
 for(const file of (await readdir('tests')).filter(name=>name.endsWith('.e2e.mjs')))assert.ok(metadata.tests.find(entry=>entry.file==='tests/'+file).gates.length);
});

test('metadata ignores fixture-looking source text and rejects missing, duplicate and invalid ownership',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-metadata-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'tests'));
 const original=JSON.parse(await readFile('tests/manifest.json','utf8'));
 const entries=['book-integrity-smoke','ci-scope'].map(stem=>structuredClone(original.tests.find(entry=>entry.file===`tests/${stem}.test.mjs`)));
 const metadata={...original,tests:entries},save=()=>writeFile(path.join(root,'tests/manifest.json'),JSON.stringify(metadata));
 for(const entry of entries)await writeFile(path.join(root,entry.file),'productionFixture(); import {books} from "anything";');
 await save();assert.equal((await tierTests('unit',root)).length,2);assert.equal((await tierTests('flows',root)).length,0);
 await writeFile(path.join(root,'tests/new.test.mjs'),'');assert.throws(()=>loadMetadata(root),/Unregistered/);await rm(path.join(root,'tests/new.test.mjs'));
 for(const [field,value,pattern] of [['groups',['typo'],/groups/],['platforms',['macos'],/platforms/],['level','guessed',/Invalid metadata/],['gates',['typo'],/gates/],['covers',['../private'],/source ownership/],['covers',['lib/a.ts','lib/a.ts'],/source ownership/]]){
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
   const selected=plan.tests.find(test=>test.file===entry.file);assert.ok(selected,entry.file+' is a consumer of '+file);assert.equal(selected.mode,'full');
  }
 }
 for(const entry of metadata.tests.filter(entry=>entry.level==='native'))for(const source of entry.covers)assert.ok(changeScope([source],metadata).native,source+' requires '+entry.file);
});
