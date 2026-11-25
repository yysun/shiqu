// 手改的有效性、换画风转换与精确结构损失。
import test from 'node:test';
import assert from 'node:assert/strict';
import {structuralLoss} from '../lib/production-dag/hand-edits.ts';
import {evaluate} from '../lib/production-dag/engine.ts';
import {stateOf,work} from '../lib/production-dag/runner.ts';
import {story,drive,replies} from './fixtures/production-dag-runner.mjs';

function edited(){
 const saved=story({length:16});
 drive(saved,replies());
 const second=saved.dag.order[1];
 saved.dag.products[`scene:${second}`].handEdited=true;
 saved.dag.products[`visual:${second}`].handEdited=true;
 return {saved,second};
}
test('changing style converts a protected visual without invalidating its caption',()=>{
 const {saved,second}=edited();
 saved.selection.artStyle='watercolor';
 const ev=evaluate(stateOf(saved));
 assert.equal(ev.instance('scene',second).status,'valid');
 assert.equal(ev.instance('visual',second).status,'invalid');
 assert.ok(work(saved).some(group=>group.call==='restyle'&&group.instances.some(i=>i.key===second)));
});
test('structural loss reports the protected content with the original page number',()=>{
 const {saved,second}=edited(),frame=saved.dag.frames[second];
 assert.deepEqual(structuralLoss(saved.dag,[saved.dag.order[0],second]),[{page:2,caption:frame.scene,prompt:frame.visual}]);
 assert.deepEqual(structuralLoss(saved.dag,[saved.dag.order[0]]),[]);
});
