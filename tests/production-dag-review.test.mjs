// 审片规则：逐幅与全篇结论各自失效、两阶段调用、允许清单、建议、放行与修订额度，按规范场景编号核对。
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,complete,runnable} from '../lib/production-dag/engine.ts';
import {reviewBatches,splitJudgements,liveSuggestions,override,newRepairBudget,canRepair,grantRepairs} from '../lib/production-dag/review.ts';
import {story,run,handEdit,count,clone,root} from './fixtures/production-dag.mjs';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';

const reg=map=>key=>map[key];
const invalid=(s,node)=>s.order.filter(id=>evaluate(s).instance(node,id).status!=='valid');

test('scenario 16: a caption edit reviews in one call, or two when an ending-dependent item is affected; no redraw',()=>{
 const a=story({items:[{id:'i1',text:'全篇不用现代词'}]});const ra=reg({i1:{scope:'story',evidence:['scenes']}});run(a,{register:ra});
 handEdit(a,'scene','f4');
 const la=run(a,{register:ra});
 assert.equal(count(la,'review'),1);
 assert.equal(count(la,'visual'),0);
 assert.equal(count(la,'draw'),0);
 const b=story({items:[{id:'i1',text:'结语呼应开篇'}]});const rb=reg({i1:{scope:'story',evidence:['scenes','ending']}});run(b,{register:rb});
 handEdit(b,'scene','f1');
 const lb=run(b,{register:rb});
 assert.deepEqual(lb.filter(l=>l.call.startsWith('review')).map(l=>l.call),['review#1','review#2']);
 assert.equal(count(lb,'draw'),0);
 const c=story({items:[{id:'i1',text:'结语呼应开篇'}]});run(c,{register:rb});
 handEdit(c,'scene','f8');
 const lc=run(c,{register:rb,ending:()=>'结语二'});
 assert.equal(count(lc,'review'),2);
 assert.ok(complete(c));
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

test('scenarios 30 and 52: only allowed verdicts are replaced; other judgements become suggestions',()=>{
 const batch={stage:1,allowed:['frameVerdict:f9','frameVerdict:f10','frameVerdict:f11'],shape:'frames'};
 const {replace,suggestions}=splitJudgements(batch,[{id:'frameVerdict:f10',outcome:'pass'},{id:'frameVerdict:f30',outcome:'fail',detail:'服饰不一致'}]);
 assert.deepEqual(replace.map(j=>j.id),['frameVerdict:f10']);
 assert.deepEqual(suggestions.map(j=>j.id),['frameVerdict:f30']);
});

test('scenarios 31 and 36: call shape follows the one-third and three-frame threshold but never changes what is replaced',()=>{
 const s=story({frames:6});run(s);
 for(const id of ['f1','f2','f3','f4'])handEdit(s,'visual',id);
 const frames=reviewBatches(s,1),whole=reviewBatches(s,4);
 assert.equal(frames[0].shape,'frames');
 assert.equal(whole[0].shape,'whole');
 assert.deepEqual(frames.map(b=>b.allowed),whole.map(b=>b.allowed));
 const big=story({frames:40});run(big);
 assert.equal(reviewBatches(big,15).length,0);
 for(let i=1;i<=15;i++)handEdit(big,'visual',`f${i}`);
 assert.equal(reviewBatches(big,15)[0].shape,'whole');
 assert.ok(!reviewBatches(big,15)[0].allowed.includes('frameVerdict:f30'));
});

test('scenario 32: each story-wide item is re-checked only when its registered evidence changes',()=>{
 const items=[{id:'i1',text:'全篇不用现代词'},{id:'i2',text:'主角服饰始终一致'},{id:'i3',text:'每幅都有动作'}];
 const r=reg({i1:{scope:'story',evidence:['scenes']},i2:{scope:'story',evidence:['visuals']},i3:{scope:'frame'}});
 const s=story({items});run(s,{register:r});
 const brief=clone(s);handEdit(brief,'brief','');
 const e1=evaluate(brief);
 assert.equal(e1.instance('narrativeVerdict').status,'invalid');
 assert.equal(e1.instance('itemVerdict','i1').status,'valid');
 assert.equal(e1.instance('itemVerdict','i2').status,'valid');
 assert.deepEqual(invalid(brief,'frameVerdict'),[]);
 const caption=clone(s);handEdit(caption,'scene','f4');
 const e2=evaluate(caption);
 assert.equal(e2.instance('itemVerdict','i1').status,'invalid');
 assert.equal(e2.instance('itemVerdict','i2').status,'valid');
 const visual=clone(s);handEdit(visual,'visual','f4');
 const e3=evaluate(visual);
 assert.equal(e3.instance('itemVerdict','i1').status,'valid');
 assert.equal(e3.instance('itemVerdict','i2').status,'invalid');
 assert.ok(!evaluate(s).all().some(i=>i.id==='itemVerdict:i3'));
});

test('scenario 37: each saved revision has 20 automatic repairs; continuing grants another 20',()=>{
 let b=newRepairBudget();
 b={...b,used:20};
 assert.ok(!canRepair(b));
 b=grantRepairs(b);
 assert.ok(canRepair(b));
 assert.equal(b.limit-b.used,20);
});

test('scenario 39: a suggestion disappears once its target verdict is produced again',()=>{
 const s=story({frames:40});run(s);
 const suggestion={target:'frameVerdict:f30',targetHash:s.products['frameVerdict:f30'].hash,detail:'服饰不一致'};
 assert.equal(liveSuggestions(s,[suggestion]).length,1);
 handEdit(s,'visual','f30');run(s);
 assert.equal(liveSuggestions(s,[suggestion]).length,0);
});

test('scenario 47: reordering re-checks order-dependent items without redrawing',()=>{
 const s=story({items:[{id:'i1',text:'结尾才揭示身份'}]});const r=reg({i1:{scope:'story',evidence:['scenes','order']}});run(s,{register:r});
 s.order=['f8',...s.order.slice(0,7)];
 assert.equal(evaluate(s).instance('itemVerdict','i1').status,'invalid');
 const log=run(s,{register:r});
 assert.equal(count(log,'draw'),0);
});

test('scenario 48: a reader-confirmed ending re-checks the narrative verdict and ending items only',()=>{
 const s=story({items:[{id:'i1',text:'结语呼应开篇'}]});const r=reg({i1:{scope:'story',evidence:['ending']}});run(s,{register:r});
 s.products['endingConfirmed:']=root('读者改写的结语');
 const e=evaluate(s);
 assert.equal(e.instance('narrativeVerdict').status,'invalid');
 assert.equal(e.instance('itemVerdict','i1').status,'invalid');
 assert.deepEqual(invalid(s,'frameVerdict'),[]);
 const log=run(s,{register:r,ending:()=>'不应采用'});
 assert.equal(count(log,'review'),2);
 assert.equal(evaluate(s).resolve('endingChoice','').hash,s.products['endingConfirmed:'].hash);
});

test('scenarios 53 and 54: items are registered before review; ending items wait for the chosen ending',()=>{
 const s=story({items:[{id:'i1',text:'结语呼应开篇'}]});const r=reg({i1:{scope:'story',evidence:['ending']},i2:{scope:'story',evidence:['scenes']}});
 const log=run(s,{register:r});
 const calls=log.map(l=>l.call);
 assert.ok(calls.indexOf('registerItems')<calls.indexOf('review#1'));
 const second=log.find(l=>l.call==='review#2');
 assert.deepEqual(second.ids,['itemVerdict:i1']);
 assert.ok(!log.find(l=>l.call==='review#1').ids.includes('itemVerdict:i1'));
 const registrationBefore=s.products['itemRegistration:i1'].hash;
 s.items=['i1','i2'];
 s.products['acceptanceReq:']=root(['结语呼应开篇','全篇不用现代词'],{...s.products['acceptanceReq:'].parts,i2:fingerprint('全篇不用现代词')});
 const ready=runnable(s).map(i=>i.id);
 assert.ok(ready.includes('itemRegistration:i2'));
 assert.ok(!ready.includes('itemVerdict:i2'));
 run(s,{register:r});
 assert.equal(s.products['itemRegistration:i1'].hash,registrationBefore);
 assert.ok(complete(s));
});

test('scenario 58: overriding a verdict while first choosing the ending still waits for ending items',()=>{
 const fail=id=>id==='frameVerdict:f5'?'fail':'pass';
 const s=story({items:[{id:'i1',text:'结语呼应开篇'}]});const r=reg({i1:{scope:'story',evidence:['ending']}});run(s,{register:r,review:fail});
 s.products['frameVerdict:f5']=override(s.products['frameVerdict:f5']);
 s.products['endingConfirmed:']=root('读者在放行时选定的结语');
 assert.ok(!evaluate(s).approved());
 assert.equal(s.products['frameVerdict:f5'].overridden,true);
 run(s,{register:r,review:fail});
 assert.ok(complete(s));
});
