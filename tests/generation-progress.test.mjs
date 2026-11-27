// Progress must reflect saved work and current attempt timing, never fabricated model percentages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionStageDurations,productionTimingScope} from '../lib/production-timing.ts';
import {generationDuration,generationProgress} from '../lib/generation-progress.ts';

const planning={id:'story',state:'running',productionState:'running',error:null,stage:'正在编排故事',selection:{length:32},ready:0,story:null,frameRecommendation:{count:32},generationProgress:{sourceReady:true,frameCountConfirmed:true,frameCount:32,phase:'plan',startedAt:10000,attempt:2}};
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
 assert.equal(generationDuration(9),'0分 09秒');assert.equal(generationDuration(65),'1分 05秒');
 assert.equal(generationProgress(planning,5000).elapsed,0);
});
test('review and repair are distinct saved stages and drawing only becomes current after approval',()=>{
 const session={...planning,story:{pages:Array(8).fill({})},generationProgress:{...planning.generationProgress,frameCount:8,phase:'review',reviewStatus:'pending',reviewRound:0}};
 const review=generationProgress(session,20000);assert.equal(review.measured,false);assert.equal(review.steps[3].label,'全篇审片');assert.deepEqual(review.steps.map(s=>s.state),['done','done','done','current','pending','pending','pending']);
 const repair=generationProgress({...session,generationProgress:{...session.generationProgress,phase:'repair',reviewStatus:'repair',repairCompleted:1,repairTotal:2}},20000);assert.equal(repair.steps[4].detail,'已修订 1 / 2 项');
 const failed=generationProgress({...session,state:'failed',error:'仍有问题',generationProgress:{...session.generationProgress,reviewStatus:'blocked',repairTotal:2}},20000);assert.equal(failed.steps[5].state,'failed');assert.equal(failed.steps[6].state,'pending');assert.equal(failed.steps[5].detail,'仍有 2 项待修订，绘图已阻止');
 const images=generationProgress({...session,generationProgress:{...session.generationProgress,phase:'image',reviewStatus:'passed'}},20000);assert.equal(images.measured,true);assert.equal(images.steps[3].state,'done');assert.equal(images.steps[6].state,'current');
});

test('repair batches and retry limits do not change the displayed full audit number',()=>{
 const meta={...planning.generationProgress,frameCount:8,reviewPhase:'full',reviewAudits:3,reviewRound:9,repairPasses:1,repairBatches:15,repairTotal:2};
 const steps=progress=>generationProgress({...planning,story:{pages:Array(8).fill({})},generationProgress:{...meta,...progress}},20000).steps;
 assert.equal(steps({phase:'repair',reviewStatus:'repair'})[4].detail,'按第 3 次全篇审核修订 · 已修订 0 / 2 项');
 assert.equal(steps({phase:'repair',reviewStatus:'repair',reviewPhase:'frames'})[4].detail,'按画幅数审核修订 · 已修订 0 / 2 项');
 const recheck=steps({phase:'review',reviewStatus:'pending'});
 assert.equal(recheck[4].detail,'已完成 15 批定向修订');
 assert.equal(recheck[5].detail,'正在第 4 次全篇审核');
});

test('step clocks survive reopening and count down to the saved deadline',()=>{
 const session={...planning,generationProgress:{...planning.generationProgress,timeoutAt:310000}};
 assert.equal(generationProgress(session,75000).remaining,235);
 assert.equal(generationProgress(structuredClone(session),76001).elapsed,66);
 assert.equal(generationProgress(session,76001).remaining,234);
 assert.equal(generationProgress(session,309999).remaining,1);
 assert.equal(generationProgress(session,310000).remaining,0);
 assert.equal(generationProgress(session,320000).remaining,0);
 assert.equal(generationProgress(planning,75000).remaining,null);
 for(const productionState of ['paused','queued'])assert.equal(generationProgress({...session,productionState},75000).remaining,null);
 const next={...session,generationProgress:{...session.generationProgress,startedAt:76000,timeoutAt:376000}};
 assert.equal(generationProgress(next,77000).elapsed,1);assert.equal(generationProgress(next,77000).remaining,299);
});

test('restyling keeps the saved storyboard complete and shows conversion before drawing',()=>{
 const session={...planning,story:{pages:Array(4).fill({})},generationProgress:{...planning.generationProgress,phase:'restyle',reviewStatus:'passed',frameCount:4}};
 const progress=generationProgress(session,20000);
 const restyle=steps=>steps.find(step=>step.id==='restyle');
 assert.deepEqual(progress.steps.map(step=>step.state),['done','done','done','done','skipped','skipped','current','pending']);
 assert.equal(progress.steps[2].detail,'4 幅分镜已保存');
 assert.match(restyle(progress.steps).detail,/转换画面提示词.*开始出图/);
 assert.equal(progress.steps[7].label,'绘图');
 assert.equal(progress.measured,false);
 assert.equal(restyle(generationProgress({...session,state:'failed',error:'超时'},20000).steps).state,'failed');
 assert.equal(restyle(generationProgress({...session,generationControl:'paused'},20000).steps).state,'paused');
 const drawing=generationProgress({...session,ready:1,generationProgress:{...session.generationProgress,phase:'image'}},20000);
 assert.equal(drawing.steps[6].detail,'1 / 4 幅画面已保存');
});

test('completed durations merge parallel work, accumulate batches and exclude waiting gaps',()=>{
 const selection={bookId:'zhuangzi',storyTitle:'庄周梦蝶'},scope=productionTimingScope(selection);
 const job=(stage,timings,timingScope=scope)=>({kind:'script',payload:JSON.stringify({timingStage:stage,timingScope,timings:timings.map(([startedAt,finishedAt])=>({startedAt,finishedAt}))})});
 const jobs=[job('plan',[[1000,4000],[10000,15000]]),job('image',[[20000,30000]]),job('image',[[25000,35000]]),job('image',[[40000,43000]]),job('review',[[4000,6000]]),job('plan',[[0,99000]],'different selected story'),{kind:'script',payload:'{}'}];
 assert.deepEqual(productionStageDurations(jobs,selection),{plan:8,image:18,review:2});
 assert.deepEqual(productionStageDurations(jobs,{...selection,displayTitle:'新显示标题'}),{plan:8,image:18,review:2});
 assert.deepEqual(productionStageDurations(jobs,{...selection,storyTitle:'另一篇故事'}),{});
});

test('saved style conversion time counts toward drawing even when tagged as planning',()=>{
 const selection={bookId:'zhuangzi',storyTitle:'尾生抱柱'};
 const job={kind:'script',payload:JSON.stringify({stepKey:'restyle:0',timingStage:'plan',timingScope:productionTimingScope(selection),timings:[{startedAt:1000,finishedAt:30000}]})};
 assert.deepEqual(productionStageDurations([job],selection),{image:29});
});
