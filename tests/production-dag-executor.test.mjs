// 服务端执行器：文字工作按契约方法经 textCall 发出，绘图用契约提示词与规定的参考图；投影由 dag 生成 plan。
import test from 'node:test';
import assert from 'node:assert/strict';
import {executeWork} from '../server/dag-executor.ts';
import {settle,work,apply} from '../lib/production-dag/runner.ts';
import {emptyDag,projectDocument} from '../lib/production-dag/document.ts';

const original={title:'管晏列传',text:'管仲夷吾者，颍上人也。少时常与鲍叔牙游，鲍叔知其贤。',url:'https://example.test/guanyan',kind:'passage',provider:'local',retrievedAt:'2026-01-01'};
const story=()=>({id:'s1',doc:{plan:null,images:[],audio:[],usage:[],original},selection:{bookId:'shiji',theme:'友情',storyTitle:'管鲍之交',artStyle:'ink-pencil',productionPrompt:'写清选择与后果',acceptancePrompt:'',narrativeDetail:'balanced',length:2},dag:emptyDag(),confirmed:true,faults:[],refSource:'/api/reader/media/book/ref.png'});

/** 替身提供方：textCall 按结构返回合法结果，image 记录参数。 */
function generator(){
 const text=[],images=[];
 const reply=(schema,payload)=>{
  const p=schema.properties;
  if(p.summary&&!p.beats)return {summary:'管仲与鲍叔牙少时相知。'};
  if(p.characters)return {characters:[{name:'管仲',aliases:['夷吾'],text:'齐国人，青年时清贫。'}]};
  if(p.beats)return {title:'管鲍之交',summary:'梗概',sourceReference:'史记',adaptationNote:'按原文',beats:['少时同游','鲍叔知贤']};
  if(p.pages)return {pages:[{caption:'管仲与鲍叔牙少时同游。',people:['管仲']},{caption:'鲍叔深知管仲之贤。',people:['管仲']}]};
  if(p.frames)return {frames:payload.frames.map(f=>({number:f.number,prompt:`第${f.number}幅：两位少年并肩走在乡间小路上，中景。`,drawn:['管仲']}))};
  throw Error('unexpected schema');
 };
 return {text,images,gen:{
  textCall:async(task,instructions,payload,schema)=>{text.push({task,payload});return {value:reply(schema,payload),model:'fake-text',requestId:'r',usage:{input:1}};},
  image:async(...args)=>{images.push(args);return {value:`/api/reader/media/s1/${args[1]}.png`,model:'fake-image',requestId:'i',usage:null};},
 }};
}

async function runUntil(s,g,stop){
 for(let round=0;round<20;round++){
  s.dag=settle(s);
  const items=work(s);
  const target=items.find(stop);if(target)return target;
  for(const item of items){const r=await executeWork(g.gen,s,item,'a'.repeat(64));const next=apply(s,item,r.value,{newId:(()=>{let n=0;return ()=>`f${++n}`;})()});if(next)s.dag=next;}
 }
 throw Error('not reached');
}

test('text work goes through the contract method and returns the parsed value with usage',async()=>{
 const s=story(),g=generator();
 const item=await runUntil(s,g,i=>i.call==='visual');
 const result=await executeWork(g.gen,s,item,'a'.repeat(64));
 assert.equal(result.model,'fake-text');
 assert.deepEqual(result.usage,{input:1});
 assert.equal(result.value.length,2);
 assert.ok(g.text.at(-1).payload.artDirection,'the image-description call carries the art direction');
});

test('drawing uses the contract prompt and the current book reference, falling back to the first image',async()=>{
 const s=story(),g=generator();
 await runUntil(s,g,i=>i.call==='visual');
 // 直接构造可绘图状态：跳过审片，只验证绘图参数。
 s.dag=settle(s);
 for(const item of work(s).filter(i=>i.call==='visual')){const r=await executeWork(g.gen,s,item,'x');s.dag=apply(s,item,r.value,{newId:()=>'z'});}
 const [first,second]=s.dag.order;
 const draw=key=>({call:'draw',instances:[{node:'frameImage',key,id:`frameImage:${key}`}]});
 await executeWork(g.gen,s,draw(first),'b'.repeat(64));
 s.dag.frames[first].image='/api/reader/media/s1/0.png';
 await executeWork(g.gen,s,draw(second),'c'.repeat(64));
 delete s.refSource;
 await executeWork(g.gen,s,draw(second),'d'.repeat(64));
 const [one,two,withoutStar]=g.images;
 assert.equal(one[3],'/api/reader/media/book/ref.png');
 assert.equal(two[3],'/api/reader/media/book/ref.png');
 assert.equal(withoutStar[3],'/api/reader/media/s1/0.png');
 assert.match(one[9],/第1幅/);
 assert.ok(!one[9].includes('写清选择与后果'),'the drawing prompt carries no production requirements');
 assert.equal(one[6],'b'.repeat(64));
});

test('the projection builds the reader plan once every frame has text and an ending exists',()=>{
 const dag={...emptyDag(),order:['a','b'],frames:{a:{scene:'第一幅配文。',visual:'第一幅画面。',image:'/x/0.png'},b:{scene:'第二幅配文。',visual:''}},characters:[{id:'c1',name:'管仲',text:'齐国人。'}],outline:{title:'提纲题',summary:'提纲梗概',sourceReference:'史记',adaptationNote:'按原文',beats:['1','2']},ending:{title:'管鲍之交',candidates:['知己难得。','二','三']}};
 assert.equal(projectDocument(dag).plan,null);
 dag.frames.b.visual='第二幅画面。';
 const {plan,images}=projectDocument(dag);
 assert.equal(plan.title,'管鲍之交');
 assert.equal(plan.reflection,'知己难得。');
 assert.equal(plan.characters,'管仲：齐国人。');
 assert.deepEqual(images,['/x/0.png','']);
});
