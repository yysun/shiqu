// 制作阶段在浏览器共享同一份状态映射，保留审片与修订语义。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionSteps} from '../lib/production-stages.ts';
const base={sourceReady:true,frameCountConfirmed:true,planReady:true,total:45,ready:0,reviewStatus:'pending',reviewRound:0};
const states=input=>productionSteps({...base,...input}).map(s=>s.state);
test('preparation and confirmation share one step while preserving source and work timing',()=>{
 for(const [intakeSource,label] of [['direct','已选原文'],['combined','整理所选原文'],['candidates','提取故事']]){
  const source={...base,intakeSource,selectedSourceLabel:'已核对的出处',intakeSelected:true,candidateBatches:1,preparedSummary:true,estimatedFrames:34};
  const steps=(intakePhase,activeState)=>productionSteps({...source,intakePhase,activeState}).slice(0,3);
  const preparing=steps('preparing'),before=steps('confirming'),after=steps('confirmed');
  assert.deepEqual(preparing.map(step=>step.label),[label,'准备故事','分批分镜']);
  assert.deepEqual(before.map(step=>step.label),[label,'制作确认','分批分镜']);
  assert.deepEqual(after[0],before[0]);
  for(const timeline of [preparing,before,after])assert.equal(timeline[1].id,'count');
  assert.equal(preparing[1].state,'current');
  assert.equal(steps('preparing','paused')[1].state,'paused');
  assert.equal(steps('preparing','failed')[1].state,'failed');
  assert.equal(before[1].state,'current');
  assert.equal(before[1].detail,'预计 34 幅 · 最终幅数由编排与审核确定');
  assert.equal(productionSteps({...source,intakePhase:'confirming',estimatedFrames:undefined})[1].detail,'原文与梗概已核对');
  assert.equal(after[1].state,'done');
  assert.equal(after[1].detail,'原文与梗概已核对 · 制作内容已确认');
  assert.equal(after[1].durationLabel,'准备耗时');
  if(intakeSource!=='candidates')assert.equal(after[0].detail,'已核对的出处');
 }
});
test('saved candidates waiting for a choice keep extraction as the current step',()=>{
 const waiting=productionSteps({...base,planReady:false,reviewStatus:null,phase:'story-choice',intakePhase:'choosing',intakeSource:'candidates',candidateBatches:10});
 assert.deepEqual(waiting.slice(0,3).map(step=>step.state),['current','pending','pending']);
 assert.deepEqual(waiting.slice(0,3).map(step=>step.id),['source','count','plan']);
 assert.equal(waiting[0].detail,'已保存 10 批候选 · 待选择故事');
 const idle=productionSteps({...base,planReady:false,reviewStatus:null,intakePhase:'choosing',intakeSource:'candidates',candidateBatches:0});
 assert.equal(idle[0].detail,'待开始提取');
 const chosen=productionSteps({...base,planReady:false,reviewStatus:null,intakePhase:'choosing',intakeSource:'candidates',intakeSelected:true,candidateBatches:2});
 assert.equal(chosen[0].state,'done');
});
test('seven steps distinguish initial review, targeted repair, recheck, skipped work and legacy stories',()=>{
 assert.deepEqual(productionSteps(base).map(s=>s.label),['确认原文','叙事详略与篇幅','分批分镜','全篇审片','定向修订','复核','绘图']);
 assert.deepEqual(states({phase:'source',planReady:false,sourceReady:false,frameCountConfirmed:false,reviewStatus:null}),['current','pending','pending','pending','pending','pending','pending']);
 assert.deepEqual(states({phase:'plan',planReady:false,reviewStatus:null}),['done','done','current','pending','pending','pending','pending']);
 assert.deepEqual(states({phase:'review'}),['done','done','done','current','pending','pending','pending']);
 assert.deepEqual(states({phase:'repair',reviewStatus:'repair',reviewRound:1}),['done','done','done','done','current','pending','pending']);
 assert.deepEqual(states({phase:'review',reviewRound:1}),['done','done','done','done','done','current','pending']);
 assert.deepEqual(states({phase:'image',reviewStatus:'passed',reviewRound:2}),['done','done','done','done','done','done','current']);
 assert.deepEqual(states({phase:'image',reviewStatus:'passed',reviewRound:1}),['done','done','done','done','skipped','skipped','current']);
 assert.deepEqual(states({phase:'image',reviewStatus:null}),['done','done','done','unavailable','unavailable','unavailable','current']);
 assert.equal(states({phase:'review',activeState:'paused'})[3],'paused');
 assert.equal(states({phase:'repair',reviewStatus:'repair',activeState:'failed'})[4],'failed');
 const blocked=productionSteps({...base,phase:'review',reviewStatus:'blocked',reviewRound:2,repairTotal:2,activeState:'failed'});
 assert.equal(blocked[5].state,'failed');assert.match(blocked[5].detail,/仍有 2 项待修订，绘图已阻止/);assert.equal(blocked[6].state,'pending');
 const replan=productionSteps({...base,phase:'review',reviewStatus:'blocked',reviewStopReason:'replan',reviewRound:1,repairTotal:1});
 assert.deepEqual(replan.map(s=>s.state),['done','done','done','failed','skipped','pending','pending']);
 assert.match(replan[4].detail,/未执行局部修补/);assert.match(replan[6].detail,/等待重新编排/);
 const criteria=productionSteps({...base,phase:'review',reviewStatus:'blocked',reviewStopReason:'requirements',reviewRound:1,repairTotal:0});
 assert.deepEqual(criteria.map(s=>s.state),['done','done','done','failed','skipped','pending','pending']);assert.match(criteria[3].detail,/验收要求存在冲突或无法判断/);assert.match(criteria[4].detail,/未执行自动修订/);assert.doesNotMatch(criteria[5].detail,/0 项待修订/);
 assert.equal(states({phase:'image',reviewStatus:'blocked',ready:45})[6],'pending');
 assert.equal(states({phase:'image',reviewStatus:'passed',reviewRound:2,ready:45})[6],'done');
});
test('acceptance blockers mark the audit that produced them without erasing completed repairs',()=>{
 const blocked={...base,phase:'review',reviewStatus:'blocked',reviewStopReason:'requirements',repairTotal:0};
 const initial=productionSteps({...blocked,reviewRound:5,reviewAudits:1,repairPasses:2});
 assert.equal(initial[3].state,'failed');assert.equal(initial[4].state,'done');assert.equal(initial[5].state,'pending');
 const recheck=productionSteps({...blocked,reviewRound:2,reviewAudits:2,repairPasses:1,repairBatches:1});
 assert.deepEqual(recheck.slice(3).map(s=>s.state),['done','done','failed','pending']);assert.match(recheck[4].detail,/已完成 1 批/);assert.match(recheck[5].detail,/验收要求存在冲突或无法判断/);
 const noRepair=productionSteps({...blocked,reviewRound:2,reviewAudits:2,repairPasses:0});assert.equal(noRepair[4].state,'skipped');assert.match(noRepair[4].detail,/未执行自动修订/);
});

test('a pending review names the style conversion it depends on',()=>{
 const steps=productionSteps({...base,phase:'restyle',activity:'按新画风转换画面描述'});
 assert.equal(steps.find(step=>step.id==='review').detail,'等待画风转换完成');
 assert.equal(steps.find(step=>step.id==='image').label,'绘图');
});

test('style conversion gets its own row where it runs',()=>{
 const ids=steps=>steps.map(step=>step.id);
 // 转换后需要重审：画风转换排在审片之前，绘图行保留并等待审片。
 const rereview=productionSteps({...base,phase:'restyle',reviewStatus:'pending',activity:'按新画风转换画面描述（第 1–6 幅）',activeState:'paused'});
 assert.deepEqual(ids(rereview),['source','count','plan','restyle','review','repair','recheck','image']);
 const restyle=rereview.find(step=>step.id==='restyle');
 assert.equal(restyle.label,'画风转换');assert.equal(restyle.state,'paused');
 assert.equal(restyle.detail,'按新画风转换画面描述（第 1–6 幅），完成后重新审片');
 const drawing=rereview.find(step=>step.id==='image');
 assert.equal(drawing.label,'绘图');assert.equal(drawing.state,'pending');assert.equal(drawing.detail,'等待审片通过');
 // 审片已通过时直接转换后绘图：画风转换排在绘图之前。
 const direct=productionSteps({...base,phase:'restyle',reviewStatus:'passed'});
 assert.deepEqual(ids(direct),['source','count','plan','review','repair','recheck','restyle','image']);
 assert.match(direct.find(step=>step.id==='restyle').detail,/完成后开始出图/);
 assert.equal(direct.find(step=>step.id==='image').detail,'等待画风转换完成');
 // 不在转换时不出现画风转换行。
 assert.ok(!ids(productionSteps({...base,phase:'image',reviewStatus:'passed'})).includes('restyle'));
});
