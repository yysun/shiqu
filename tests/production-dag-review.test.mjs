// 审片规则：逐幅与全篇结论各自失效、单次调用、允许清单、放行与修订额度，按规范场景编号核对。
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,complete,runnable} from '../lib/production-dag/engine.ts';
import {callGroups} from '../lib/production-dag/schedule.ts';
import {override,newRepairBudget,canRepair,grantRepairs} from '../lib/production-dag/review.ts';
import {story,run,handEdit,count,clone,root} from './fixtures/production-dag.mjs';

const invalid=(s,node)=>s.order.filter(id=>evaluate(s).instance(node,id).status!=='valid');

test('scenario 16: a caption and ending-dependent requirements are reviewed in one call; no redraw',()=>{
 const s=story({items:[{id:'i1',text:'结语呼应开篇'}]});
 run(s);
 handEdit(s,'scene','f4');
 const log=run(s);
 assert.equal(count(log,'review'),1);
 assert.ok(log.find(entry=>entry.call==='review').ids.includes('narrativeVerdict:'));
 assert.equal(count(log,'visual'),0);
 assert.equal(count(log,'draw'),0);
 assert.ok(complete(s));
});

test('scenario 18: an override covers only its verdict and lapses when that verdict\'s inputs change',()=>{
 const fail=id=>id==='frameVerdict:f5'?'fail':'pass';
 const s=story({frames:20});run(s,{review:fail});
 assert.ok(!evaluate(s).approved());
 s.products['frameVerdict:f5']=override(s.products['frameVerdict:f5']);
 assert.ok(evaluate(s).approved());
 run(s,{review:fail});
 assert.ok(complete(s));
 handEdit(s,'visual','f20');run(s,{review:fail});
 assert.equal(s.products['frameVerdict:f5'].overridden,true);
 assert.ok(complete(s));
 handEdit(s,'visual','f5');run(s,{review:fail});
 assert.notEqual(s.products['frameVerdict:f5'].overridden,true);
 assert.ok(!evaluate(s).approved());
});

test('scenarios 31 and 36: one review call per round, planned by the same grouping the scheduler uses',()=>{
 const s=story({frames:6});run(s);
 for(const id of ['f1','f2','f3','f4'])handEdit(s,'visual',id);
 const plan=callGroups(evaluate(s)).filter(g=>g.call==='review');
 assert.equal(plan.length,1);
 assert.deepEqual(plan[0].instances.map(i=>i.id).sort(),['frameVerdict:f1','frameVerdict:f2','frameVerdict:f3','frameVerdict:f4','frameVerdict:f5','narrativeVerdict:'].sort(),'image-description edits also invalidate the whole-story verdict');
 const log=run(s);
 assert.deepEqual(log.filter(l=>l.call.startsWith('review')).map(l=>l.ids.sort()),[plan[0].instances.map(i=>i.id).sort()]);
 const big=story({frames:40});run(big);
 for(let i=1;i<=15;i++)handEdit(big,'visual',`f${i}`);
 const bigPlan=callGroups(evaluate(big)).filter(g=>g.call==='review');
 assert.equal(bigPlan.length,1);
 assert.ok(bigPlan[0].instances.some(i=>i.id==='narrativeVerdict:'));
 assert.ok(!bigPlan[0].instances.some(i=>i.id==='frameVerdict:f30'));
});

test('scenario 32: acceptance requirements, brief, captions and visuals all bind the whole-story verdict',()=>{
 const s=story();
 run(s);
 for(const [node,key] of [['brief',''],['scene','f4'],['visual','f4']]){
  const changed=clone(s);handEdit(changed,node,key);
  assert.equal(evaluate(changed).instance('narrativeVerdict').status,'invalid',node);
 }
 s.products['acceptanceReq:']=root('保留原文结语');
 const review=callGroups(evaluate(s)).find(item=>item.call==='review');
 assert.deepEqual(review.instances.map(i=>i.id),['narrativeVerdict:']);
 assert.deepEqual(invalid(s,'frameVerdict'),[]);
});

test('scenario 37: each saved revision has 20 automatic repairs; continuing grants another 20',()=>{
 let b=newRepairBudget();
 b={...b,used:20};
 assert.ok(!canRepair(b));
 b=grantRepairs(b);
 assert.ok(canRepair(b));
 assert.equal(b.limit-b.used,20);
});

test('scenario 47: reordering rechecks the whole-story verdict without redrawing',()=>{
 const s=story();run(s);
 s.order=['f8',...s.order.slice(0,7)];
 assert.notEqual(evaluate(s).instance('narrativeVerdict').status,'valid');
 const log=run(s);
 assert.equal(count(log,'review'),1);
 assert.equal(count(log,'draw'),0);
});

test('scenario 48: a reader-confirmed ending only rechecks the whole-story verdict',()=>{
 const s=story();run(s);
 s.products['endingConfirmed:']=root('读者改写的结语');
 assert.equal(evaluate(s).instance('narrativeVerdict').status,'invalid');
 assert.deepEqual(invalid(s,'frameVerdict'),[]);
 assert.equal(count(run(s),'review'),1);
});

test('scenarios 53 and 54: all acceptance criteria are reviewed together with the selected ending',()=>{
 const s=story({items:[{id:'i1',text:'结语呼应开篇'}]});
 assert.equal(count(run(s),'review'),1);
 s.products['acceptanceReq:']=root(['结语呼应开篇','全篇不用现代词']);
 assert.deepEqual(runnable(s).map(i=>i.id),['narrativeVerdict:']);
 assert.equal(count(run(s),'review'),1);
 assert.ok(complete(s));
});

test('scenario 58: choosing an ending rebinds the whole-story verdict but leaves a frame override in place',()=>{
 const fail=id=>id==='frameVerdict:f5'?'fail':'pass';
 const s=story();run(s,{review:fail});
 s.products['frameVerdict:f5']=override(s.products['frameVerdict:f5']);
 s.products['endingConfirmed:']=root('读者在放行时选定的结语');
 assert.ok(!evaluate(s).approved());
 assert.equal(s.products['frameVerdict:f5'].overridden,true);
 run(s,{review:fail});
 assert.ok(complete(s));
});
