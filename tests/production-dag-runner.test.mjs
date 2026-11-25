// 制作 DAG 执行层：用替身生成器驱动 work → requestFor → apply，核对调用数、修订、结构修订、迟到结果与复用。
import test from 'node:test';
import assert from 'node:assert/strict';
import {apply,attention,finished,stateOf,work} from '../lib/production-dag/runner.ts';
import {story,replies,drive,calls,newId} from './fixtures/production-dag-runner.mjs';
import {evaluate} from '../lib/production-dag/engine.ts';

test('a confirmed 12-frame story runs to completion with batched text calls',()=>{
 const s=story({acceptancePrompt:'每幅都有动作'});
 const log=drive(s,replies());
 assert.ok(finished(s));
 for(const [name,n] of [['characters',1],['outline',1],['sceneBatch',1],['visual',1],['ending',1],['frameCheck',0],['review',1],['prepareBrief',1],['draw',12]])assert.equal(calls(log,name),n,name);
 assert.equal(s.dag.order.length,12);
 assert.equal(s.dag.ending.chosen,'知己难得。');
 assert.ok(s.dag.order.every(id=>s.dag.frames[id].image));
});

test('fixed and adaptive frame counts complete across storyboard batch boundaries',()=>{
 for(const [length,frames] of [[1,1],[20,20],[21,21],[80,80],['auto',21]]){
  const s=story({length}),reply=replies();
  const log=drive(s,(method,args)=>{
   const value=reply(method,args);
   return method==='outline'&&length==='auto'?{...value,beats:Array.from({length:frames},(_,index)=>`第 ${index+1} 幅叙事节点`)}:value;
  });
  const batchSizes=Array.from({length:Math.ceil(frames/20)},(_,index)=>Math.min(20,frames-index*20));
  for(const name of ['sceneBatch','visual'])assert.deepEqual(log.filter(job=>job.call===name).map(job=>job.ids.length),batchSizes,`${length}: ${name}`);
  assert.equal(calls(log,'frameCheck'),length==='auto'?1:0);
  assert.equal(calls(log,'draw'),frames);
  assert.deepEqual(work(s),[]);
  assert.ok(finished(s));
 }
});

test('a style change converts image descriptions in batches of 6 and redraws, without replanning',()=>{
 const s=story();drive(s,replies());
 s.selection={...s.selection,artStyle:'watercolor'};
 const log=drive(s,replies());
 assert.equal(calls(log,'restyle'),2);
 assert.equal(calls(log,'outline')+calls(log,'sceneBatch')+calls(log,'visual'),0);
 assert.equal(calls(log,'draw'),12);
 assert.ok(finished(s));
 assert.match(s.dag.frames[s.dag.order[0]].visual,/watercolor/);
});

test('a failing frame verdict repairs only that frame, spends one repair and re-reviews',()=>{
 const s=story();
 let failures=1;
 const log=drive(s,replies({fail:id=>id.endsWith(':n3')&&failures-->0?{category:'composition',problem:'动作不清',instruction:'补足动作',requiresReplan:false}:null}));
 assert.ok(finished(s));
 assert.deepEqual(log.filter(l=>l.call==='visualRepair').map(l=>l.ids),[['n3']]);
 assert.equal(s.dag.repairs.used,1);
 assert.equal(calls(log,'review'),2);
 assert.equal(calls(log,'draw'),12);
});

test('a repair that changes nothing stops for the reader instead of looping',()=>{
 const s=story();
 const log=drive(s,replies({repairSame:true,fail:id=>id.endsWith(':n3')?{category:'composition',problem:'动作不清',instruction:'补足动作',requiresReplan:false}:null}));
 assert.ok(!finished(s));
 assert.equal(calls(log,'draw'),0);
 assert.deepEqual(attention(s).map(a=>a.reason),['unchanged']);
});

test('a hand-edited image description is never repaired automatically',()=>{
 const s=story();
 drive(s,replies({fail:()=>null}));
 const id=s.dag.order[2],inst=evaluate(stateOf(s)).instance('visual',id);
 s.dag.frames[id].visual='读者手改的画面描述，人物站在庭院中。';
 s.dag.products[inst.id]={...s.dag.products[inst.id],hash:'hand',handEdited:true};
 const log=drive(s,replies({fail:v=>v===`frameVerdict:${id}`?{category:'composition',problem:'构图拥挤',instruction:'拉远景别',requiresReplan:false}:null}));
 assert.equal(calls(log,'visualRepair'),0);
 assert.deepEqual(attention(s).map(a=>a.reason),['hand-edited']);
});

test('a frame-count expansion inserts a new frame with a new identity and rechecks (automatic frame count only)',()=>{
 const s=story({length:'auto'});
 let first=true;
 const log=drive(s,replies({frameCheck:()=>first?(first=false,'expand'):'keep'}));
 assert.ok(finished(s));
 assert.equal(calls(log,'structureRepair'),1);
 assert.equal(s.dag.order.length,13);
 assert.equal(s.dag.frames[s.dag.order[2]].scene,'新增的分金一幅配文。');
 assert.equal(calls(log,'frameCheck'),2);
 assert.deepEqual(log.filter(l=>l.call==='visual'&&l.applied).map(l=>l.ids.length),[12,1]);
});

test('scenario 34: production structure repair keeps untouched identities and reuses matching retired images',()=>{
 const s=story();
 drive(s,replies());
 const before=[...s.dag.order],image=s.dag.frames[before[8]].image,retired=[before[2],before[3],before[6],before[8]];
 for(const key of [before[0],before[2],before[3],before[6]])s.dag.frames[key].redrawNote=`保留画幅 ${key} 的光线。`;
 const hand=`visual:${before[9]}`;
 s.dag.products[hand].handEdited=true;
 const scene=key=>({caption:s.dag.frames[key].scene});
 const instance=evaluate(stateOf(s)).instance('narrativeVerdict');
 s.dag=apply(s,{call:'structureRepair',instances:[instance]},[
  {from:3,to:4,scenes:[scene(before[2])]},
  {from:7,to:7,scenes:[scene(before[6]),{caption:'拆分后独立的配文。'}]},
  {from:9,to:10,scenes:[{caption:'第九幅明确改写后的配文。'},scene(before[9])]},
 ],{newId});
 assert.deepEqual(s.dag.order.filter(key=>before.includes(key)),before.filter(key=>!retired.includes(key)));
 assert.equal(s.dag.order.length,before.length);
 assert.equal(s.dag.frames[before[0]].redrawNote,`保留画幅 ${before[0]} 的光线。`);
 assert.ok(s.dag.products[hand].handEdited);
 for(const key of retired){
  assert.equal(s.dag.frames[key].redrawNote,undefined);
  assert.equal(s.dag.products[`scene:${key}`],undefined);
 }
 const rewritten=s.dag.order[8];
 const log=drive(s,replies());
 assert.equal(s.dag.frames[rewritten].image,image);
 assert.ok(!log.some(entry=>entry.call==='draw'&&entry.ids.includes(rewritten)));
});

test('production structure repair reports reader attention and leaves protected frames intact',()=>{
 const s=story();
 drive(s,replies());
 const [first,second]=s.dag.order,before=s.dag.frames[first];
 s.dag.products[`visual:${first}`].handEdited=true;
 const instance=evaluate(stateOf(s)).instance('narrativeVerdict');
 s.dag.products[instance.id].outcome='fail';
 s.dag.issues=[{target:instance.id,page:1,category:'progression',problem:'叙事重复',instruction:'合并首两幅',requiresReplan:true}];
 const repair=work(s).find(item=>item.call==='structureRepair');
 s.dag=apply(s,repair,[{from:1,to:2,scenes:[{caption:before.scene}]}],{newId});
 assert.deepEqual(s.dag.order.slice(0,2),[first,second]);
 assert.deepEqual(s.dag.frames[first],before);
 assert.deepEqual(attention(s),[{target:instance.id,reason:'hand-edited'}]);
 assert.ok(!work(s).some(item=>item.call==='structureRepair'));
});

test('a result whose inputs changed after dispatch is discarded and redone',()=>{
 const s=story();
 let changed=false;
 const log=drive(s,replies(),{between:(st,item)=>{if(item.call==='visual'&&!changed){changed=true;st.selection={...st.selection,productionPrompt:'改为写清代价'};}}});
 assert.ok(finished(s));
 assert.ok(log.some(l=>l.call==='visual'&&!l.applied));
});

test('an image whose drawing inputs match an existing image is reused without a call',()=>{
 const s=story();drive(s,replies());
 const [a,b]=s.dag.order;
 const ev=evaluate(stateOf(s));
 s.dag.frames[b]={...s.dag.frames[b],visual:s.dag.frames[a].visual,drawn:s.dag.frames[a].drawn};
 s.dag.products[`visual:${b}`]={...s.dag.products[`visual:${a}`],inputs:ev.instance('visual',b).hard,checks:ev.instance('visual',b).check,handEdited:true};
 const log=drive(s,replies());
 assert.equal(calls(log,'draw'),0);
 assert.equal(s.dag.frames[b].image,s.dag.frames[a].image);
 assert.ok(finished(s));
});
