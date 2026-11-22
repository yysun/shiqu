// 手改保护：保存时的处理选项与自动结构修订的损失检查，按规范场景编号核对。
import test from 'node:test';
import assert from 'node:assert/strict';
import {handEditChoices,structuralLoss} from '../lib/production-dag/hand-edits.ts';
import {story,run,handEdit,clone,root} from './fixtures/production-dag.mjs';

const done=()=>{const s=story({frames:16});run(s);return s;};

test('scenario 28: restyling a hand-edited image description offers keeping it as the base or discarding it',()=>{
 const base=done();handEdit(base,'visual','f2');
 const next=clone(base);next.products['style:']=root('watercolor');
 assert.deepEqual(handEditChoices(base,next),[{id:'visual:f2',options:['use-as-base','discard']}]);
});

test('scenario 33: re-planning over a hand-edited caption offers only discarding it or cancelling the save',()=>{
 const base=done();handEdit(base,'scene','f2');
 const next=clone(base);next.products['productionReq:']=root('改写主线');
 assert.deepEqual(handEditChoices(base,next),[{id:'scene:f2',options:['discard','cancel']}]);
});

test('an unrelated edit leaves hand edits alone',()=>{
 const base=done();handEdit(base,'scene','f2');
 const next=clone(base);handEdit(next,'visual','f9');
 assert.deepEqual(handEditChoices(base,next),[]);
});

test('scenarios 19 and 43: automatic structural repair that touches a hand-edited frame must stop for the reader',()=>{
 const s=done();handEdit(s,'scene','f12');
 assert.deepEqual(structuralLoss(s,{merged:[['f12','f13']]}),['f12']);
 assert.deepEqual(structuralLoss(s,{rewritten:['f12']}),['f12']);
 assert.deepEqual(structuralLoss(s,{deleted:['f3'],split:['f7']}),[]);
});
