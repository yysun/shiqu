// Review stages must agree across reader metadata and read-only native/preview summaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {productionSteps} from '../lib/production-stages.ts';
import {readLibrarySummary} from '../desktop/library-preview.ts';
import {view} from '../lib/reader-model.ts';
import {generationProgress} from '../lib/generation-progress.ts';
const base={sourceReady:true,frameCountConfirmed:true,planReady:true,total:45,ready:0,reviewStatus:'pending',reviewRound:0};
const states=input=>productionSteps({...base,...input}).map(s=>s.state);
test('seven steps distinguish initial review, targeted repair, recheck, skipped work and legacy stories',()=>{
 assert.deepEqual(productionSteps(base).map(s=>s.label),['确认原文','确定画幅数','分批分镜','全篇审片','定向修订','复核','绘图']);
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
 assert.equal(states({phase:'image',reviewStatus:'blocked',ready:45})[6],'pending');
 assert.equal(states({phase:'image',reviewStatus:'passed',reviewRound:2,ready:45})[6],'done');
});
test('native/preview SQL and reader show the same saved stages without exporting private content',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'shiqu-stages-'));
 try{
  const database=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())database.exec(readFileSync(path.join('drizzle',file),'utf8'));
  const original={title:'原文',text:'private-original',url:'https://example.org'},plan={title:'测试故事',pages:Array.from({length:45},()=>({caption:'测试',prompt:'private-image-prompt'}))};
  const selection={bookId:'liaozhai',storyTitle:'测试故事',theme:'人情冷暖',artStyle:'ink-pencil',length:45,narrativeDetail:'balanced',voice:false,productionPrompt:'private-production-prompt'};
  const review=(status,round,extra={})=>({status,round,repairs:round?1:0,issues:[],repaired:[],reports:[],...extra});
  const fixtures=[
   {name:'source',doc:{storyboard:{outline:{beats:Array(45).fill('beat')},pages:[]},frameCountConfirmed:true}},
   {name:'count',doc:{original,frameRecommendation:{count:45}}},
   {name:'batches',doc:{original,frameCountConfirmed:true,storyboard:{outline:{beats:Array(45).fill('beat')},pages:Array(20).fill({})}}},
   {name:'review',doc:{original,plan,visualReview:review('pending',0)}},
   {name:'repair',doc:{original,plan,visualReview:review('repair',1,{issues:[{page:2},{page:21}],repaired:[2]})}},
   {name:'recheck',doc:{original,plan,visualReview:review('pending',1,{issues:[{page:2}],repaired:[2]})}},
   {name:'blocked',state:'failed',doc:{original,plan,visualReview:review('blocked',2,{issues:[{page:2}]})}},
   {name:'first-pass',doc:{original,plan,visualReview:review('passed',1)}},
   {name:'rechecked-pass',doc:{original,plan,visualReview:review('passed',2)}},
   {name:'legacy',doc:{original,plan}},
  ];
  const insert=database.prepare('INSERT INTO reader_sessions(id,user_id,selection,document,state,page,saved,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?)');
  for(const f of fixtures)insert.run(f.name,'owner',JSON.stringify(selection),JSON.stringify({plan:null,images:[],audio:[],usage:[],...f.doc}),f.state||'running','2026-10-29','2026-10-29');
  const before=readFileSync(path.join(directory,'shiqu.sqlite'));
  const summary=readLibrarySummary(directory);
  for(const item of summary.stories){
   const row=database.prepare('SELECT * FROM reader_sessions WHERE id=?').get(item.id);
   const reader=generationProgress(view(row),0).steps;
   const desktop=productionSteps({...item.production,total:item.total||null,ready:item.ready,activeState:item.state==='failed'?'failed':'current'});
   assert.deepEqual(desktop.map(s=>[s.id,s.state]),reader.map(s=>[s.id,s.state]),item.id);
  }
  assert.match(JSON.stringify(summary.stories.find(s=>s.id==='batches').production),/20/);
  assert.doesNotMatch(JSON.stringify(summary),/private-original|private-image-prompt|private-production-prompt/);
  assert.deepEqual(readFileSync(path.join(directory,'shiqu.sqlite')),before);
  database.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
