// Verify release ordering and fail-closed gates with a fake runner and disposable tarball, never the registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {publishNpm} from '../scripts/publish-npm.mjs';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-publish-gate-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.2.3',publishConfig:{name:'@test-only/shiqu'}}));
 const tarball=path.join(root,'outputs/npm/test-only-shiqu-1.2.3.tgz');
 return {root,tarball,async build(){await mkdir(path.dirname(tarball),{recursive:true});await writeFile(tarball,'test-only-artifact');}};
}
for(const dryRun of [false,true])test(`release checks precede build, exact-artifact smoke and publish (dryRun=${dryRun})`,async t=>{
 const f=await fixture(t),calls=[];
 await publishNpm({root:f.root,dryRun,run:async(args,{cwd})=>{assert.equal(cwd,f.root);calls.push(args);if(args[1]==='build:npm')await f.build();}});
 assert.deepEqual(calls,[['run','npm:check'],['run','build:npm'],['run','npm:smoke',f.tarball],['publish',f.tarball,'--access','public',...(dryRun?['--dry-run']:[])]]);
});
for(const failed of ['npm:check','build:npm','npm:smoke'])test('release never publishes after failure at '+failed,async t=>{
 const f=await fixture(t),calls=[];
 await assert.rejects(publishNpm({root:f.root,run:async args=>{calls.push(args);if(args[1]===failed)throw Error('TEST_GATE_FAILED');if(args[1]==='build:npm')await f.build();}}),/TEST_GATE_FAILED/);
 assert.equal(calls.at(-1)[1],failed);assert.ok(calls.every(args=>args[0]!=='publish'));
});
test('release rejects a missing tarball before smoke or publication',async t=>{
 const f=await fixture(t),calls=[];
 await assert.rejects(publishNpm({root:f.root,run:async args=>{calls.push(args);}}),/ENOENT/);
 assert.deepEqual(calls,[['run','npm:check'],['run','build:npm']]);
});
