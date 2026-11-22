// 制作 DAG 的版本隔离：并发完成的各幅结果都保存且不重复记账（绘图进行中输入改变的隔离由 DAG 的 stale 核对承担，见 production-dag-* 测试）。
// 旧流水线的发布步骤、发布回执与过期任务清理随旧流程删除。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';

const document=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);

test('draws finishing together are all saved, each recorded once',async t=>{
 const f=await productionFixture(t),id=await f.create(3);
 await until(()=>f.control.calls.length===1);f.control.calls[0].resolve();await until(()=>f.control.calls.length===3);
 f.control.hold=false;for(const call of f.control.calls.slice(1))call.resolve();
 await until(async()=>(await f.read(id)).state==='completed',15000);
 const saved=await document(f,id);
 assert.equal(saved.images.filter(Boolean).length,3);assert.equal(saved.usage.filter(u=>/draw/i.test(u.step)).length,3);
 assert.equal(f.control.calls.length,3);
});
