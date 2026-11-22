// 使用隔离夹具验证真实生产流程：各任务的推理强度随 DAG 调用记入用量。
import test from 'node:test';

import assert from 'node:assert/strict';

import {productionFixture,until} from './fixtures/production.mjs';

test('Gemini task effort survives the real DAG review call alongside existing usage',async t=>{
 const f=await productionFixture(t,'gemini');
 f.control.hold=false;
 const id=await f.create(4);
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const row=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first();
 const doc=JSON.parse(row.document),review=doc.usage.find(entry=>entry.step==='dag:review');
 assert.equal(review.reasoningEffort,'high');assert.deepEqual(review.usage,{calls:1});
});
