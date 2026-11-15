// 制作阶段在浏览器共享同一份状态映射，保留审片与修订语义。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionSteps} from '../lib/production-stages.ts';
const base={sourceReady:true,frameCountConfirmed:true,planReady:true,total:45,ready:0,reviewStatus:'pending',reviewRound:0};
const states=input=>productionSteps({...base,...input}).map(s=>s.state);
test('intake retains its source and preparation milestones across confirmation',()=>{
 for(const [intakeSource,label] of [['direct','已选原文'],['combined','整理所选原文'],['candidates','提取故事']]){
  const source={...base,intakeSource,selectedSourceLabel:'已核对的出处',intakeSelected:true,candidateBatches:1,preparedSummary:true};
  const before=productionSteps({...source,intakePhase:'confirming'}).slice(0,3);
  const after=productionSteps({...source,intakePhase:'confirmed'}).slice(0,3);
  assert.deepEqual(before.map(step=>step.label),[label,'准备故事','制作确认']);
  assert.deepEqual(after.slice(0,2),before.slice(0,2));
  assert.equal(before[2].state,'current');
  assert.equal(after[2].state,'done');
  if(intakeSource!=='candidates')assert.equal(after[0].detail,'已核对的出处');
 }
});
test('seven steps distinguish initial review, targeted repair, recheck, skipped work and legacy stories',()=>{
 assert.deepEqual(productionSteps(base).map(s=>s.label),['确认原文','叙事详略与篇幅','分批分镜','全篇审片','定向修订','复核','绘图']);
 assert.deepEqual(states({phase:'source',planReady:false,sourceReady:false,frameCountConfirmed:false,reviewStatus:null}),['current','pending','pending','pending','pending','pending','pending']);
 assert.deepEqual(states({phase:'frame-count',planReady:false,frameCountConfirmed:false,reviewStatus:null}),['done','current','pending','pending','pending','pending','pending']);
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
