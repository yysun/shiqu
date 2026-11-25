// v1 → v2 转换：完成、部分完成、缺审核、旧放行、阻断、重复转换与投影一致；场景 38、44、45、46 的转换部分。
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStoryDocument,mapLegacyFaults,legacyFrameId} from '../server/migrations/production-v4.ts';
import {versionState,rootProducts,projectDocument} from '../lib/production-dag/document.ts';
import {evaluate,complete,runnable} from '../lib/production-dag/engine.ts';
import {convertDocument as convertHistorical,rootProducts as historicalRoots,versionState as historicalVersion} from '../server/migrations/production-v2.ts';
import {handEdit,run} from './fixtures/production-dag.mjs';

function v1({frames=8,images=frames,review='passed',overridden=false,issues=[],acceptance='结尾才揭示身份',handoff=false,redrawNotes}={}){
 const pages=Array.from({length:frames},(_,i)=>({caption:`第${i+1}幅配文`,prompt:`第${i+1}幅画面描述`}));
 const doc={
  plan:{title:'管鲍之交',summary:'管仲与鲍叔牙相知的经过',sourceReference:'史记·管晏列传',adaptationNote:'按原文顺序',reflection:'结语一',characters:'管仲：齐国相。鲍叔牙：管仲好友。',pages},
  reflectionCandidates:['结语一','结语二','结语三'],
  original:{title:'管晏列传',text:'管仲夷吾者，颍上人也。',url:'https://example.test/guanyan',kind:'passage',provider:'local',retrievedAt:'2026-01-01'},
  ...(review?{visualReview:{status:review,round:1,repairs:0,issues,repaired:[],reports:[],...(overridden?{overridden:true}:{})}}:{}),
  images:pages.map((_,i)=>i<images?`/api/reader/media/s/${i}.webp`:''),audio:[],usage:[],
  ...(handoff||redrawNotes?{revision:{parentId:'p',rootId:'r',number:3,baseToken:'t',requestHash:'h',base:{},...(handoff?{handoff:true}:{}),...(redrawNotes?{redrawNotes}:{})}}:{}),
 };
 const selection={bookId:'shiji',artStyle:'ink-pencil',productionPrompt:'写清选择与后果',acceptancePrompt:acceptance,length:frames};
 return {doc,selection};
}
const historicalState=({doc,selection})=>{const dag=convertHistorical(doc,selection,{confirmed:true});return historicalVersion(dag,historicalRoots(selection,dag),{confirmed:true,skipFrameCheck:true});};
const convert=input=>normalizeStoryDocument('fixture',input.doc,input.selection);
const stateOf=(input,dag,faults=[])=>versionState(dag,rootProducts(input.selection,dag),{confirmed:true,faults,skipFrameCheck:typeof input.selection.length==='number'});

test('a completed reviewed story stays complete with no work and legacy records',()=>{
 const input=v1(),dag=convert(input),state=stateOf(input,dag);
 assert.ok(complete(state));
 assert.equal(runnable(state).length,0);
 assert.ok(Object.values(dag.products).every(p=>!p.legacy));
 assert.deepEqual(dag.order,Array.from({length:8},(_,i)=>legacyFrameId(i)));
});

test('the projection reproduces the v1 plan pages and images exactly',()=>{
 const input=v1({images:5}),dag=convert(input);
 const projected=projectDocument(dag,input.doc.plan);
 assert.deepEqual(projected.plan,input.doc.plan);
 assert.deepEqual(projected.images,input.doc.images);
});

test('scenario 46: converting twice gives the same result',()=>{
 const input=v1({images:5});
 assert.deepEqual(convert(input),convert(input));
});

test('scenario 38: a partly drawn story resumes only the missing frames',()=>{
 const input=v1({images:5}),dag=convert(input),state=stateOf(input,dag);
 assert.deepEqual(runnable(state).map(i=>i.id),[6,7,8].map(n=>`frameImage:legacy-${n}`));
 const log=run(state);
 assert.deepEqual(log.map(l=>l.call),['draw','draw','draw']);
 assert.ok(complete(state));
});

test('scenario 38: after conversion an edit is judged by the new rules; the whole-story conclusion is rechecked',()=>{
 const input=v1(),dag=convert(input),state=stateOf(input,dag);
 handEdit(state,'visual','legacy-3');
 const e=evaluate(state);
 assert.equal(e.instance('narrativeVerdict').status,'invalid');
 assert.deepEqual(['legacy-2','legacy-3','legacy-4'].map(k=>e.instance('frameVerdict',k).status),['invalid','invalid','invalid']);
 assert.equal(e.instance('frameVerdict','legacy-6').status,'valid');
});

test('scenario 44: completed and partially drawn stories with prior drawing permission keep a bound override',()=>{
 const done=v1({review:null}),dag=convert(done),state=stateOf(done,dag);
 assert.ok(complete(state));
 assert.equal(runnable(state).length,0);
 assert.ok(evaluate(state).approved());
 const partial=v1({review:null,images:5}),pdag=convert(partial),pstate=stateOf(partial,pdag);
 assert.ok(evaluate(pstate).approved(),'an unfinished unreviewed plan already had permission to draw in v0.14.0');
 assert.ok(pdag.products['narrativeVerdict:'].overridden);
 assert.deepEqual(run(pstate).map(l=>l.call),['draw','draw','draw']);
});

test('scenario 45: a legacy override converts to overrides that lapse only for the edited verdict',()=>{
 const input=v1({overridden:true}),dag=convert(input),state=stateOf(input,dag);
 assert.ok(Object.entries(dag.products).filter(([id])=>id.startsWith('frameVerdict')).every(([,p])=>p.overridden));
 assert.ok(complete(state));
 handEdit(state,'visual','legacy-6');
 run(state);
 assert.equal(state.products['frameVerdict:legacy-2'].overridden,true);
 assert.notEqual(state.products['frameVerdict:legacy-6'].overridden,true);
});

test('a blocked review converts to failing verdicts on the blocked pages only',()=>{
 const input=v1({review:'blocked',issues:[{page:3,problem:'动作不清'}]}),dag=convert(input),state=stateOf(input,dag);
 assert.equal(dag.products['frameVerdict:legacy-3'].outcome,'fail');
 assert.equal(dag.products['frameVerdict:legacy-4'].outcome,'pass');
 assert.ok(!evaluate(state).approved());
});

test('pending save-wait and redraw notes carry over',()=>{
 const input=v1({handoff:true,redrawNotes:{2:'调暗背景'}}),dag=convert(input);
 assert.deepEqual(dag.continuation,{revision:3,reason:'revision-saved'});
 assert.equal(dag.frames['legacy-2'].redrawNote,'调暗背景');
 assert.ok(complete(stateOf(input,dag)));
});

test('open legacy faults map to frame identities; a text-step fault attaches to the step that runs next',()=>{
 const input=v1({images:5}),state=historicalState(input);
 const mapped=mapLegacyFaults([
  {id:'a',kind:'image-loss',page:1,state:'pending'},
  {id:'b',kind:'landscape-image',page:2,state:'pending'},
  {id:'c',kind:'generation',page:null,state:'pending'},
  {id:'d',kind:'image-loss',page:0,state:'resolved'},
 ],state);
 assert.deepEqual(mapped.map(f=>[f.id,f.node,f.key,!!f.optional]),[['a','frameImage','legacy-2',false],['b','landscape','legacy-3',true],['c','frameImage','legacy-6',false]]);
 assert.ok(mapped.every(f=>f.version==='legacy'));
});

// 转换后的故事经执行层继续：提纲与梗概可读；验收要求不变时旧条目及其结论保留，不重复登记与审片。
import {settle,work,requestFor} from '../lib/production-dag/runner.ts';
const story=(input,dag)=>({id:'s',doc:input.doc,selection:input.selection,dag,confirmed:true,faults:[]});

test('a partly drawn converted story draws its remaining frames without registering or reviewing again',()=>{
 const input=v1({images:5}),s=story(input,convert(input));
 s.dag=settle(s);
 const items=work(s);
 assert.ok(items.length&&items.every(i=>i.call==='draw'),items.map(i=>i.call).join());
 assert.deepEqual(items.map(i=>i.instances[0].key),['legacy-6','legacy-7','legacy-8']);
});

test('changed acceptance requirements are reviewed together before drawing',()=>{
 const input=v1({images:5}),s=story(input,convert(input));
 s.selection={...s.selection,acceptancePrompt:'结尾才揭示身份\n每幅都有动作'};
 s.dag=settle(s);
 const calls=work(s).map(i=>i.call);
 assert.ok(calls.includes('review'));
 assert.ok(!calls.includes('draw'),'nothing is drawn before the new items are judged');
});

test('calls that read the outline or summary work on a converted story',()=>{
 const input=v1(),s=story(input,convert(input));
 assert.equal(s.dag.outline.beats.length,8);
 assert.equal(s.dag.brief,input.doc.plan.summary);
 const ev=evaluate(stateOf(input,s.dag));
 for(const [call,node] of [['ending','ending'],['frameCheck','frameCheck']])assert.doesNotThrow(()=>requestFor(s,{call,instances:[ev.instance(node)]}),call);
 const repair={call:'sceneRepair',instances:[ev.instance('scene','legacy-2')],issues:[{page:2,category:'caption',problem:'缺少动作',instruction:'补足动作',target:'frameVerdict:legacy-2'}]};
 assert.equal(requestFor(s,repair).args.outline.title,'管鲍之交');
});
