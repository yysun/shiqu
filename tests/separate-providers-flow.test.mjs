// 使用隔离夹具验证真实生产流程，保持适配器契约可独立快速运行。
import test from 'node:test';

import assert from 'node:assert/strict';

import {productionFixture,until} from './fixtures/production.mjs';
import {liveReaderProvider} from '../server/app.ts';
import {ReaderProductionCoordinator} from '../server/reader-production.ts';

test('production queue draws every frame through the separate image provider and keeps text on the text provider',async t=>{
 const f=await productionFixture(t,'codex',{},{imageProvider:'gemini'}),id=await f.createLegacyReader();
 f.control.hold=false;await f.demand(id);await until(async()=>(await f.read(id)).ready===7);
 assert.equal(f.control.calls.length,7);assert.ok(f.control.calls.every(call=>call.via==='gemini'));
 assert.deepEqual([...f.control.textVia],['codex']);assert.equal(f.control.plans.length,1);
});


test('saved provider snapshots keep an in-flight image and its timeout while new jobs wait through readonly',async t=>{
 const f=await productionFixture(t,'codex');f.app.stopGeneration();await f.app.services.production.close();
 let variables={SHIQU_AI_PROVIDER:'codex',CODEX_MODEL:'old-model'};const models=[];
 const live=liveReaderProvider(variables,()=>variables,values=>{
  const model=values.CODEX_MODEL,base=f.generation;
  return {...base,generationTimeoutMs:()=>model==='old-model'?111000:222000,safeError:error=>model+': '+base.safeError(error),generator(){const generator=base.generator();return {...generator,async image(...args){models.push(model);return generator.image(...args);}};}};
 });
 const coordinator=new ReaderProductionCoordinator(f.app.services.database,live,f.media,{tickMs:1});f.coordinators.push(coordinator);f.app.services.production=coordinator;
 const id=await f.createLegacyReader();await f.demand(id);await until(()=>f.control.calls.length===1);
 const pending=await f.read(id);assert.equal(pending.generationProgress.timeoutAt-pending.generationProgress.startedAt,111000);
 variables={SHIQU_AI_PROVIDER:'readonly',CODEX_MODEL:'new-model'};
 const changed=await f.read(id);assert.equal(changed.generationProgress.timeoutAt-changed.generationProgress.startedAt,111000);
 f.control.calls[0].resolve();await until(async()=>(await f.read(id)).ready===1);
 const jobs=await coordinator.queue.jobs(id,f.app.services.ownerId);assert.ok(jobs.filter(job=>job.kind==='image'&&job.state==='queued').every(job=>job.attempts===0));assert.deepEqual(models,['old-model']);
 variables={SHIQU_AI_PROVIDER:'codex',CODEX_MODEL:'new-model'};f.control.hold=false;
 await until(async()=>(await f.read(id)).ready===7);
 assert.equal(models[0],'old-model');assert.ok(models.slice(1).every(model=>model==='new-model'));assert.equal(models.length,7);
});


test('an image error uses its captured provider after defaults change',async t=>{
 const f=await productionFixture(t,'codex');f.app.stopGeneration();await f.app.services.production.close();let model='old-model';
 const live=liveReaderProvider({SHIQU_AI_PROVIDER:'codex',CODEX_MODEL:model},()=>({SHIQU_AI_PROVIDER:'codex',CODEX_MODEL:model}),values=>({...f.generation,safeError:()=>values.CODEX_MODEL+' failure'}));
 const coordinator=new ReaderProductionCoordinator(f.app.services.database,live,f.media,{tickMs:1});f.coordinators.push(coordinator);f.app.services.production=coordinator;
 const id=await f.createLegacyReader();await f.demand(id);await until(()=>f.control.calls.length===1);model='new-model';await live.status();
 f.control.calls[0].reject(Error('controlled old-image failure'));await until(async()=>(await coordinator.queue.jobs(id,f.app.services.ownerId)).some(job=>job.kind==='image'&&job.state==='failed'));
 const failed=(await coordinator.queue.jobs(id,f.app.services.ownerId)).find(job=>job.kind==='image'&&job.state==='failed');assert.equal(failed.error,'old-model failure');
 await coordinator.queue.settle();assert.equal(coordinator.jobProviders.size,0);
});
