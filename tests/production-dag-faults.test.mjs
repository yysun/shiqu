// 故障随修订延续：硬输入相同则延续，不同则放弃，尚未确定则待匹配；场景 51 与 42 的引擎部分。
import test from 'node:test';
import assert from 'node:assert/strict';
import {hardInputHash,runnable} from '../lib/production-dag/engine.ts';
import {carryFaults,settleAwaiting} from '../lib/production-dag/faults.ts';
import {story,run,handEdit,clone,root} from './fixtures/production-dag.mjs';

const lost=s=>{
 s.products['frameImage:f2']={...s.products['frameImage:f2'],readable:false};
 return {id:'F1',node:'frameImage',key:'f2',state:'pending',inputHash:hardInputHash(s,'frameImage','f2')};
};
let n=0;const id=()=>`N${++n}`;

test('scenario 42: an unrelated edit carries the lost-image fault into the new revision and never redraws it',()=>{
 const s=story({frames:20});run(s);
 const fault=lost(s);
 const next=clone(s);handEdit(next,'visual','f20');
 const {carried,dropped,awaiting}=carryFaults([fault],next,id);
 assert.equal(carried.length,1);
 assert.equal(carried[0].origin,'F1');
 assert.notEqual(carried[0].id,'F1');
 assert.deepEqual([dropped.length,awaiting.length],[0,0]);
 next.faults=carried;
 run(next);
 assert.ok(!runnable(next).some(i=>i.id==='frameImage:f2'));
 assert.equal(next.products['frameImage:f2'].readable,false);
});

test('scenario 42: if the faulted frame\'s own inputs changed, the old fault no longer applies',()=>{
 const s=story({frames:20});run(s);
 const fault=lost(s);
 const next=clone(s);handEdit(next,'visual','f2');
 assert.equal(carryFaults([fault],next,id).dropped.length,1);
});

test('scenario 51: during re-planning the fault waits for matching, then carries or drops',()=>{
 const s=story({frames:8});run(s);
 const fault=lost(s);
 const next=clone(s);next.products['productionReq:']=root('改写主线');
 const {awaiting}=carryFaults([fault],next,id);
 assert.equal(awaiting.length,1);
 next.faults=awaiting;
 run(next);
 // 待匹配期间该幅不绘制
 assert.equal(next.products['frameImage:f2'].readable,false);
 // 新编排的画面描述不同：放弃
 assert.deepEqual(settleAwaiting(next).drop.map(f=>f.key),['f2']);
 // 新编排的画面描述与旧版相同：延续为待重绘
 const same=clone(next);
 same.products['visual:f2']={...same.products['visual:f2'],hash:s.products['visual:f2'].hash};
 assert.deepEqual(settleAwaiting(same).carry.map(f=>[f.key,f.state]),[['f2','pending']]);
});
