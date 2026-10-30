// Progress must reflect saved work and current attempt timing, never fabricated model percentages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generationDuration,generationProgress} from '../lib/generation-progress.ts';

const planning={id:'story',state:'running',productionState:'running',error:null,stage:'正在编排故事',selection:{length:32},ready:0,story:null,awaitingFrameCount:false,frameRecommendation:{count:32},generationProgress:{sourceReady:true,frameCountConfirmed:true,frameCount:32,phase:'plan',startedAt:10000,attempt:2}};
test('planning reports saved source, chosen count and elapsed attempt time without a percentage',()=>{
 const progress=generationProgress(planning,75000);
 assert.equal(progress.measured,false);assert.equal(progress.elapsed,65);assert.equal(progress.attempt,2);
 assert.deepEqual(progress.steps.map(step=>step.state),['done','done','current','pending','pending','pending','pending']);
 assert.equal(progress.steps[1].detail,'32 幅');assert.equal(progress.steps[2].detail,'等待完整分镜返回');
 assert.match(progress.note,/每批最多 20 幅/);assert.equal(progress.slow,false);
 assert.equal(generationProgress(planning,100000).slow,true);
 assert.equal(generationProgress({...planning,generationProgress:{...planning.generationProgress,startedAt:70000}},75000).elapsed,5);
});
test('drawing progress counts saved images and completed steps',()=>{
 const session={...planning,ready:3,story:{pages:Array(8).fill({})},generationProgress:{...planning.generationProgress,phase:'image',frameCount:8}};
 const progress=generationProgress(session,20000);
 assert.equal(progress.measured,true);assert.equal(progress.total,8);assert.equal(progress.ready,3);
 assert.deepEqual(progress.steps.map(step=>step.state),['done','done','done','unavailable','unavailable','unavailable','current']);
 assert.equal(progress.steps[6].detail,'3 / 8 幅画面已保存');
 assert.equal(generationProgress({...session,ready:8,state:'completed'},20000).steps[6].state,'done');
});
test('failure, pause and queueing do not keep a running elapsed clock',()=>{
 for(const fields of [{state:'failed',error:'超时'},{productionState:'paused'},{productionState:'queued'}]){
  const progress=generationProgress({...planning,...fields},100000);
  assert.equal(progress.running,false);assert.equal(progress.elapsed,null);assert.equal(progress.slow,false);
 }
 assert.equal(generationProgress({...planning,state:'failed',error:'超时'},100000).steps[2].state,'failed');
 assert.equal(generationProgress({...planning,productionState:'paused'},100000).steps[2].state,'paused');
});
test('unknown counts and timestamps stay unknown and durations include minutes',()=>{
 const progress=generationProgress({...planning,selection:{length:'auto'},frameRecommendation:null,generationProgress:{...planning.generationProgress,frameCount:null,frameCountConfirmed:false,startedAt:null,phase:'recommend'}},75000);
 assert.equal(progress.total,null);assert.equal(progress.elapsed,null);assert.equal(progress.measured,false);
 assert.equal(progress.steps[1].detail,'待确定');
 assert.equal(generationDuration(9),'9 秒');assert.equal(generationDuration(65),'1 分 05 秒');
 assert.equal(generationProgress(planning,5000).elapsed,0);
});
test('review and repair are distinct saved stages and drawing only becomes current after approval',()=>{
 const session={...planning,story:{pages:Array(8).fill({})},generationProgress:{...planning.generationProgress,frameCount:8,phase:'review',reviewStatus:'pending',reviewRound:0}};
 const review=generationProgress(session,20000);assert.equal(review.measured,false);assert.equal(review.steps[3].label,'全篇审片');assert.deepEqual(review.steps.map(s=>s.state),['done','done','done','current','pending','pending','pending']);
 const repair=generationProgress({...session,generationProgress:{...session.generationProgress,phase:'repair',reviewStatus:'repair',repairCompleted:1,repairTotal:2}},20000);assert.equal(repair.steps[4].detail,'第 1 轮 · 已修订 1 / 2 幅');
 const failed=generationProgress({...session,state:'failed',error:'仍有问题',generationProgress:{...session.generationProgress,reviewStatus:'blocked',repairTotal:2}},20000);assert.equal(failed.steps[5].state,'failed');assert.equal(failed.steps[6].state,'pending');assert.equal(failed.steps[5].detail,'仍有 2 幅待修订，绘图已阻止');
 const images=generationProgress({...session,generationProgress:{...session.generationProgress,phase:'image',reviewStatus:'passed'}},20000);assert.equal(images.measured,true);assert.equal(images.steps[3].state,'done');assert.equal(images.steps[6].state,'current');
});
