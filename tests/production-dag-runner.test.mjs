// 制作 DAG 执行层：用替身生成器驱动 work → inputsFor → apply，核对调用数、修订、结构修订、迟到结果与复用。
import test from 'node:test';
import assert from 'node:assert/strict';
import {settle,work,inputsFor,apply,attention,finished,stateOf} from '../lib/production-dag/runner.ts';
import {emptyDag} from '../lib/production-dag/document.ts';
import {evaluate} from '../lib/production-dag/engine.ts';

const original={title:'管晏列传',text:'管仲夷吾者，颍上人也。少时常与鲍叔牙游，鲍叔知其贤。',url:'https://example.test/guanyan',kind:'passage',provider:'local',retrievedAt:'2026-01-01'};
const selection=(over={})=>({bookId:'shiji',theme:'友情',storyTitle:'管鲍之交',artStyle:'ink-pencil',productionPrompt:'写清选择与后果',acceptancePrompt:'',narrativeDetail:'balanced',length:12,...over});
let ids=0;
const people=[{id:'c1',name:'管仲',aliases:['夷吾'],text:'齐国人，青年时清贫。'},{id:'c2',name:'鲍叔牙',aliases:['鲍叔'],text:'管仲好友，宽厚。'}];

function story(over={}){
 ids=0;
 return {id:'s1',doc:{plan:null,images:[],audio:[],usage:[],original},selection:selection(over),dag:emptyDag(),confirmed:true,faults:[],refSource:'/api/reader/media/book/ref.png'};
}

/** 替身生成器：按方法返回合法结果；review 可按 verdict 身份给出失败。 */
function replies({fail=()=>null,frameCheck=()=>'keep',repairSame=false}={}){
 return (method,args)=>{
  switch(method){
   case 'prepareBrief':return '管仲与鲍叔牙少时相知。';
   case 'characters':return people;
   case 'outline':return {title:'管鲍之交',summary:'梗概',sourceReference:'史记',adaptationNote:'按原文',beats:Array.from({length:args.settings.length},(_,i)=>`节点${i+1}`)};
   case 'sceneBatch':return Array.from({length:args.count},(_,i)=>({caption:`第${args.first+i}幅配文。`,candidates:['c1','c2']}));
   case 'sceneRepair':return args.frames.map(f=>({caption:repairSame?f.caption:`修订后的第${f.index+1}幅配文。`,candidates:['c1']}));
   case 'visual':case 'restyle':return args.frames.map(f=>({prompt:`第${f.index+1}幅画面，${args.style.artStyle}。`,drawn:['c1']}));
   case 'visualRepair':return args.frames.map(f=>({prompt:repairSame?f.prompt:`修订后的第${f.index+1}幅画面。`,drawn:['c1']}));
   case 'ending':return {title:'管鲍之交',candidates:['知己难得。','知人善任。','贫富不移。']};
   case 'endingRepair':return '知己之交，贵在相知。';
   case 'frameCheck':{
    const decision=frameCheck(args.captions.length);
    return decision==='keep'?{frameCountReview:{decision,proposedCount:args.captions.length,reason:'合适'},requirements:[],issues:[],coverage:[]}
     :{frameCountReview:{decision,proposedCount:args.captions.length+1,reason:'缺一段'},requirements:[{page:2}],issues:[{page:2,category:'progression',problem:'缺少分金一段',instruction:'在第 2 幅后补一幅分金',requiresReplan:true}],coverage:[]};
   }
   case 'structureRepair':return [{from:3,to:2,scenes:[{caption:'新增的分金一幅配文。',candidates:['c1','c2']}]}];
   case 'registerItems':return args.items.map(i=>({id:i.id,scope:'story',evidence:['scenes']}));
   case 'review':{
    const judgements=[],issues=[];
    for(const page of args.allowed.pages){
     const id=`frameVerdict:${args.frames[page-1].id}`,failure=fail(id);
     judgements.push({id,outcome:failure?'fail':'pass',...(failure?{detail:failure.problem}:{})});
     if(failure)issues.push({page,...failure});
    }
    if(args.allowed.narrative)judgements.push({id:'narrativeVerdict:',outcome:'pass'});
    for(const n of args.allowed.criteria)judgements.push({id:`itemVerdict:${args.itemIds[n]}`,outcome:'pass'});
    return {judgements,suggestions:[],...(args.allowed.narrative&&!args.chosenEnding?{endingChoice:args.candidates[0]}:{}),issues};
   }
   default:throw Error('unexpected '+method);
  }
 };
}

const newId=()=>`n${++ids}`;
/** 驱动到没有工作；返回每次调用的记录。draw 与 drawLandscape 返回按画幅与轮次区分的图片地址。 */
function drive(s,reply,{max=80,between}={}){
 const log=[];
 for(let round=0;round<max;round++){
  s.dag=settle(s);
  const items=work(s);
  if(!items.length)return log;
  for(const item of items){
   const value=item.call==='draw'?`/api/reader/media/s1/${item.instances[0].key}-${round}.png`:(()=>{const {method,args}=inputsFor(s,item);return reply(method,args,item);})();
   between?.(s,item);
   const next=apply(s,item,value,{newId});
   log.push({call:item.call,ids:item.instances.map(i=>i.key),applied:!!next});
   if(next)s.dag=next;
  }
 }
 throw Error('runner did not settle');
}
const calls=(log,name)=>log.filter(l=>l.call===name&&l.applied).length;

test('a confirmed 12-frame story runs to completion with batched text calls',()=>{
 const s=story({acceptancePrompt:'每幅都有动作'});
 const log=drive(s,replies());
 assert.ok(finished(s));
 for(const [name,n] of [['characters',1],['outline',1],['sceneBatch',1],['visual',1],['ending',1],['frameCheck',1],['registerItems',1],['review',1],['prepareBrief',1],['draw',12]])assert.equal(calls(log,name),n,name);
 assert.equal(s.dag.order.length,12);
 assert.equal(s.dag.ending.chosen,'知己难得。');
 assert.ok(s.dag.order.every(id=>s.dag.frames[id].image));
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

test('a frame-count expansion inserts a new frame with a new identity and rechecks',()=>{
 const s=story();
 let first=true;
 const log=drive(s,replies({frameCheck:()=>first?(first=false,'expand'):'keep'}));
 assert.ok(finished(s));
 assert.equal(calls(log,'structureRepair'),1);
 assert.equal(s.dag.order.length,13);
 assert.equal(s.dag.frames[s.dag.order[2]].scene,'新增的分金一幅配文。');
 assert.equal(calls(log,'frameCheck'),2);
 assert.deepEqual(log.filter(l=>l.call==='visual'&&l.applied).map(l=>l.ids.length),[12,1]);
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
