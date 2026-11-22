// 调用请求只由声明的输入构建：读取未声明的输入抛错；审片只发送本次允许结论绑定的输入与全篇上下文。
import test from 'node:test';
import assert from 'node:assert/strict';
import {work,requestFor,settle,stateOf} from '../lib/production-dag/runner.ts';
import {reader,declaredInputs} from '../lib/production-dag/requests.ts';
import {dagGenerator} from '../lib/production-dag/calls.ts';
import {evaluate} from '../lib/production-dag/engine.ts';
import {calls as registry} from '../lib/production-dag/registry.ts';
import {story,replies,drive} from './fixtures/production-dag-runner.mjs';

function finished(){const s=story({acceptancePrompt:'每幅都有动作'});drive(s,replies());return s;}
/** 手改一项产物：新内容、当前输入、标为手改。 */
function handEdit(s,node,key,apply){
 apply(s.dag);
 const inst=evaluate(stateOf(s)).instance(node,key);
 s.dag.products[inst.id]={hash:`hand-${node}-${key}`,inputs:inst.hard,...(inst.check?{checks:inst.check}:{}),handEdited:true};
}
/** 用记录的 textCall 发出请求，返回发送的载荷文字。 */
async function sent(s,item){
 const payloads=[];
 const call=async(task,instructions,payload)=>{payloads.push(JSON.stringify(payload));throw Error('stop');};
 const {method,args}=requestFor(s,item);
 await dagGenerator(call)[method](args).catch(()=>{});
 return payloads[0];
}

test('every text call in a full production reads only its declared inputs',()=>{
 // drive() 对每项工作调用 requestFor；读取未声明的输入会抛错，整篇因此无法完成。
 const s=finished();
 assert.ok(s.dag.order.every(id=>s.dag.frames[id].image));
});

test('reading an undeclared input fails',()=>{
 const s=finished();
 const item={call:'visual',instances:[evaluate(stateOf(s)).instance('visual',s.dag.order[0])]};
 const read=reader(s,item);
 assert.throws(()=>read.get('source'),/DAG_UNDECLARED_INPUT/);
 assert.throws(()=>read.get('scene@self',s.dag.order[5]),/DAG_UNDECLARED_INPUT/,'another frame is outside this work');
 assert.equal(read.get('scene@self',s.dag.order[0]),s.dag.frames[s.dag.order[0]].scene);
});

test('a narrative-only review sends no art direction, cast or image-description inputs beyond the shared context',async()=>{
 const s=finished();
 handEdit(s,'brief','',dag=>{dag.brief='读者改写的梗概。';});
 s.dag=settle(s);
 const review=work(s).find(i=>i.call==='review');
 assert.deepEqual(review.instances.map(i=>i.id),['narrativeVerdict:']);
 const declared=declaredInputs(s,review);
 assert.ok(!declared.has('style')&&!declared.has('characters@drawn')&&!declared.has('characters'));
 const {args}=requestFor(s,review);
 assert.equal(args.style,undefined);
 assert.equal(args.characters,undefined);
 assert.equal(args.brief,'读者改写的梗概。');
 const payload=await sent(s,review);
 assert.ok(!payload.includes('artDirection'));
 assert.ok(!payload.includes('齐国人，青年时清贫。'),'character settings are not sent');
});

test('a frame-only review sends the drawn cast and style but no outline, brief or ending',async()=>{
 const s=finished();
 const id=s.dag.order[4];
 handEdit(s,'visual',id,dag=>{dag.frames[id].visual='读者手改：管仲独坐灯下，中景。';});
 s.dag=settle(s);
 const review=work(s).find(i=>i.call==='review');
 assert.ok(review.instances.every(i=>i.node==='frameVerdict'));
 const {args}=requestFor(s,review);
 assert.deepEqual(args.characters.map(c=>c.id),['c1']);
 assert.ok(args.style);
 assert.equal(args.outline,undefined);
 assert.equal(args.brief,undefined);
 assert.equal(args.title,undefined);
 const payload=await sent(s,review);
 assert.ok(payload.includes('artDirection'));
 assert.ok(!payload.includes('"outline"'));
});

test('every call with a request builder is declared in the registry',()=>{
 const s=finished();
 for(const call of ['characters','outline','ending','frameCheck','prepareBrief']){
  const node=Object.entries({characters:'characters',outline:'outline',ending:'ending',frameCheck:'frameCheck',prepareBrief:'brief'}).find(([c])=>c===call)[1];
  const item={call,instances:[evaluate(stateOf(s)).instance(node)]};
  assert.ok(registry[call]);
  assert.doesNotThrow(()=>requestFor(s,item),call);
 }
});
