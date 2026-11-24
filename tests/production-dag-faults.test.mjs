// 正式匹配器在硬输入逐幅确定时匹配来源，并保留已解除记录用于去重。
import test from 'node:test';
import assert from 'node:assert/strict';
import {hardInputHash} from '../lib/production-dag/engine.ts';
import {matchImageLoss} from '../lib/production-dag/faults.ts';
import {story,run,handEdit,clone,root} from './fixtures/production-dag.mjs';

test('an unresolved source waits for unknown inputs and matches each frame independently',()=>{
 const state=story({frames:8});run(state);
 const source={id:'source',node:'frameImage',key:'',state:'awaiting-match',inputHash:hardInputHash(state,'frameImage','f2')};
 const waiting=clone(state);waiting.products['productionReq:']=root('改写主线');
 assert.deepEqual(matchImageLoss(waiting,[source],[]),{close:[],additions:[],finished:[]});
 const next=clone(state);
 assert.notEqual(hardInputHash(next,'frameImage','f1'),source.inputHash);
 for(const key of ['f2','f3']){
  next.products[`frameImage:${key}`].readable=false;
  next.products[`visual:${key}`].hash=state.products['visual:f2'].hash;
 }
 const hash=hardInputHash(next,'frameImage','f3');
 assert.equal(hash,source.inputHash);
 const recovered={...source,id:'first-instance',origin:source.id,key:'f2',state:'resolved'};
 const duplicate={...source,id:'equivalent-source'};
 const {additions,finished}=matchImageLoss(next,[source,duplicate],[recovered]);
 assert.deepEqual(additions.map(item=>item.key),['f3']);
 assert.deepEqual(finished,[{id:source.id,state:'resolved'},{id:duplicate.id,state:'resolved'}]);
 handEdit(next,'visual','f3');
 assert.deepEqual(matchImageLoss(next,[],[{...recovered,id:'other-instance',key:'f3',state:'pending'}]).close,[{id:'other-instance',state:'replaced'}]);
});
