// 图片故障只在原版本核对；只关闭可读或已经替换的绑定。
import test from 'node:test';
import assert from 'node:assert/strict';
import {hardInputHash} from '../lib/production-dag/engine.ts';
import {closedImageFaults} from '../lib/production-dag/faults.ts';
import {story,run,handEdit} from './fixtures/production-dag.mjs';

test('an image fault is closed only when its own frame becomes readable or changes input',()=>{
 const state=story({frames:8});run(state);
 const fault={id:'fault',node:'frameImage',key:'f2',state:'pending',inputHash:hardInputHash(state,'frameImage','f2')};
 assert.deepEqual(closedImageFaults(state,[fault]),[{id:fault.id,state:'resolved'}]);
 state.products['frameImage:f2'].readable=false;
 handEdit(state,'visual','f3');
 assert.deepEqual(closedImageFaults(state,[fault]),[]);
 handEdit(state,'visual','f2');
 assert.deepEqual(closedImageFaults(state,[fault]),[{id:fault.id,state:'replaced'}]);
});
