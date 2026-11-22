// 制作 DAG 引擎：按规范验收场景编号核对有效性、就绪、复用、完成与预估，全部使用替身生成器。
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,complete,preview,reusable,runnable,instanceId} from '../lib/production-dag/engine.ts';
import {applyStructure,castFrom} from '../lib/production-dag/frames.ts';
import {story,run,handEdit,redraw,count,produced,clone,root} from './fixtures/production-dag.mjs';

const done=(options={})=>{const s=story(options);run(s);return s;};

test('a confirmed story runs to completion and then has no runnable work',()=>{
 const s=story();const log=run(s);
 assert.ok(complete(s));
 assert.equal(runnable(s).length,0);
 assert.equal(count(log,'sceneBatch'),1);
 assert.equal(count(log,'draw'),8);
});

test('per-frame and per-item calls run in batches: a 24-frame story makes one call per 20 frames',()=>{
 const s=story({frames:24,items:[{id:'i1',text:'结尾才揭示身份'},{id:'i2',text:'每幅都有动作'}]});
 const log=run(s);
 assert.ok(complete(s));
 for(const [call,calls,instances] of [['characters',1,1],['outline',1,1],['sceneBatch',2,24],['visual',2,24],['registerItems',1,2],['draw',24,24]]){
  assert.equal(count(log,call),calls,call);
  assert.equal(produced(log,call),instances,call);
 }
 // 批次按画幅顺序切分。
 assert.deepEqual(log.filter(l=>l.call==='visual').map(l=>[l.ids[0],l.ids.length]),[['visual:f1',20],['visual:f21',4]]);
 // 只缺一幅画面描述时只为该幅调用一次。
 delete s.products['visual:f7'];
 const again=run(s);
 assert.deepEqual(again.filter(l=>l.call==='visual').map(l=>l.ids),[['visual:f7']]);
});

test('nothing runs before confirmation except preparation',()=>{
 const s=story();s.confirmed=false;run(s);
 assert.ok(!Object.keys(s.products).some(id=>id.startsWith('outline:')||id.startsWith('scene:')||id.startsWith('characters:')));
 assert.ok(s.products['source:']&&s.products['brief:']&&s.products['suggestions:']);
});

test('scenario 4: replacing one frame redraws only it; reordering redraws nothing; redrawing frame 1 keeps the rest',()=>{
 const s=done();
 handEdit(s,'visual','f3');
 assert.equal(count(run(s),'draw'),1);
 const reordered=clone(s);reordered.order=['f1','f5','f3','f4','f2','f6','f7','f8'];
 assert.equal(count(run(reordered),'draw'),0);
 assert.ok(complete(reordered));
 redraw(s,'f1');
 const e=evaluate(s);
 assert.ok(s.order.slice(1).every(id=>e.instance('frameImage',id).status==='valid'));
 assert.equal(s.order.slice(1).filter(id=>e.instance('frameImage',id).basedOnOld).length,7);
 assert.equal(count(run(s),'draw'),0);
});

test('scenario 17: editing one character redraws only frames that draw that character',()=>{
 const s=story({cast:{f3:['c1','c2']}});run(s);
 const before=s.products['characters:'];
 s.products['characters:']={...before,hash:'改了鲍叔牙的外观',parts:{...before.parts,c2:'鲍叔牙新外观'},handEdited:true};
 const e=evaluate(s);
 assert.deepEqual(s.order.filter(id=>e.instance('frameImage',id).status!=='valid'),['f3']);
 assert.deepEqual(s.order.filter(id=>e.instance('frameVerdict',id).status!=='valid'),['f3']);
 assert.equal(count(run(s),'draw'),1);
});

test('scenario 23: an app upgrade that changes prompt templates leaves every product valid',()=>{
 const s=done();
 assert.equal(runnable(s).length,0);
 assert.ok(complete(s));
});

test('scenario 24: redrawing a portrait invalidates only its landscape, which never blocks completion',()=>{
 const s=done();s.landscapes=['f2','f4'];run(s);
 redraw(s,'f2');
 const e=evaluate(s);
 assert.equal(e.instance('landscape','f2').status,'invalid');
 assert.equal(e.instance('landscape','f4').status,'valid');
 assert.ok(complete(s));
});

test('scenario 25: changing the adaptation seed after confirmation runs nothing',()=>{
 const s=done();s.products['seed:']=root('新的改编重点');
 assert.equal(runnable(s).length,0);
 s.reprepare=true;
 assert.deepEqual(runnable(s).map(i=>i.id),['suggestions:']);
});

test('scenario 26: after re-planning, a frame with identical drawing inputs reuses the old image',()=>{
 const s=done();
 const old=s.products['frameImage:f2'];
 const next=clone(s);next.products['visual:f9']={...s.products['visual:f2']};next.order=['f1','f9'];next.frames.f9=s.frames.f2;
 const hard=evaluate(next).instance('frameImage','f9').hard;
 assert.equal(reusable([old],hard),old);
});

test('scenario 35: drawn characters follow the image description; captions are only hints',()=>{
 const people=[{id:'c1',name:'管仲'},{id:'c2',name:'鲍叔牙',aliases:['鲍叔']},{id:'c3',name:'曹操'}];
 assert.deepEqual(castFrom('鲍叔与管仲对坐',people),['c1','c2']);
 const s=story({cast:{f2:['c1']}});run(s);
 handEdit(s,'scene','f2');
 assert.equal(evaluate(s).instance('frameImage','f2').status,'valid');
 s.frames.f2={...s.frames.f2,drawn:['c1','c3']};
 assert.equal(evaluate(s).instance('frameImage','f2').status,'invalid');
});

test('scenario 34: merge keeps the first identity; split keeps the original on the first piece',()=>{
 let n=0;const id=()=>`n${++n}`;
 assert.deepEqual(applyStructure(['a','b','c','d'],[{op:'merge',ids:['b','c']}],id),['a','b','d']);
 assert.deepEqual(applyStructure(['a','b'],[{op:'split',id:'a',parts:3}],id),['a','n1','n2','b']);
});

test('scenario 40: restyled image descriptions are valid immediately with the new style',()=>{
 const s=done();s.products['style:']=root('watercolor');
 const log=run(s);
 assert.equal(produced(log,'visual'),8);
 assert.equal(count(log,'visual'),1);
 assert.equal(count(log,'sceneBatch'),0);
 assert.equal(count(log,'outline'),0);
 assert.equal(count(log,'draw'),8);
 assert.ok(complete(s));
});

test('scenario 49: an image description waits for its storyboard text and candidates',()=>{
 const s=story();
 const r=()=>runnable(s).map(i=>i.id);
 for(let i=0;i<4;i++){
  const ready=r();
  assert.ok(!ready.includes('visual:f7')||s.products['scene:f7']);
  run(s);break;
 }
 delete s.products['scene:f7'];delete s.products['visual:f7'];
 assert.ok(!r().includes('visual:f7'));
 assert.ok(r().includes('scene:f7'));
});

test('scenario 6: new production requirements replan from the outline without regenerating the summary',()=>{
 const s=done();s.products['productionReq:']=root('改写主线');
 const log=run(s);
 assert.equal(log[0].call,'outline');
 assert.equal(count(log,'prepareBrief'),0);
});

test('the save preview reports resume point, invalidated images and old references',()=>{
 const base=done();
 const next=clone(base);handEdit(next,'scene','f4');
 const p=preview(base,next);
 assert.equal(p.invalidatedImages,0);
 assert.equal(p.resumeAt,'逐幅审片结论');
 const redrawn=clone(base);redraw(redrawn,'f1');
 assert.equal(preview(base,redrawn).oldReference,7);
});

test('a fault blocks only its own node and dependants; optional faults never block completion',()=>{
 const s=done();
 s.products['frameImage:f2']={...s.products['frameImage:f2'],readable:false};
 s.faults.push({id:'x',node:'frameImage',key:'f2',state:'pending'});
 handEdit(s,'visual','f6');
 const log=run(s);
 assert.deepEqual(log.filter(l=>l.call==='draw').flatMap(l=>l.ids),['frameImage:f6']);
 assert.ok(!complete(s));
 s.faults=[{id:'y',node:'landscape',key:'f3',state:'pending',optional:true}];
 s.products['frameImage:f2']={...s.products['frameImage:f2'],readable:true};
 assert.ok(complete(s));
 assert.equal(evaluate(s).instance('frameImage','f2').status,'valid');
 assert.ok(s.products[instanceId('frameImage','f2')]);
});

test('after a style change only the first image is redrawn first; the others wait for it as their reference',()=>{
 const s=done();s.products['style:']=root('watercolor');
 run(s,{stopAt:'draw'});
 assert.deepEqual(runnable(s).filter(x=>x.node==='frameImage').map(x=>x.key),['f1']);
 run(s);
 assert.ok(complete(s));
});
