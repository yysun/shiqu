// Exercise story criteria through real persistence, queued review gates and immutable revisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn,makePlan,selection} from './fixtures/production.mjs';
import {confirmedStory,revise} from './fixtures/production-dag-story.mjs';
const count=(list,name)=>list.filter(n=>n===name).length;
import {acceptanceCriteria,acceptancePromptSchema} from '../lib/reader-acceptance.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {reviewReportSchema} from '../lib/reader-review.ts';
import {checkedRevision,revisionImpact} from '../lib/reader-revision.ts';
const criteria='关键反应落实到画面。\n保留对白的条件。';
const results=status=>[{criterion:1,status,pages:status==='unknown'?[]:[2],evidence:status==='unknown'?'无法从文字分镜判断生成图中的手指数量。':'第二幅的手部反应与配文提供依据。'},{criterion:2,status:'passed',pages:[1],evidence:'第一幅配文保留了条件。'}];
const titleReview={title:'庄周梦蝶',reason:'标题符合原文。'};
test('criteria are bounded and legacy stories remain unmodified; acceptance-only revisions preserve images and script',()=>{
 assert.deepEqual(acceptanceCriteria('  一条\n\n 第二条\r\n'),['一条','第二条']);
 assert.equal(acceptancePromptSchema.safeParse(Array(21).fill('一条').join('\n')).success,false);
 assert.equal('acceptancePrompt' in selectionSchema.parse(selection),false);
 const base={selection,plan:makePlan(3),images:['a','b','c']},impact=revisionImpact(base,{acceptancePrompt:criteria});
 assert.equal(impact.replan,false);assert.equal(impact.redraw,0);assert.equal(impact.review,true);
 const checked=checkedRevision(base,{acceptancePrompt:criteria});assert.deepEqual(checked.plan,base.plan);assert.equal(checked.selection.acceptancePrompt,criteria);
});
test('missing, duplicate, out-of-range and unactionable failed criterion results cannot pass review validation',()=>{
 const schema=reviewReportSchema(3,undefined,criteria),report={titleReview,issues:[],acceptanceResults:results('passed')};
 assert.equal(schema.safeParse(report).success,true);
 for(const acceptanceResults of [undefined,[],[results('passed')[0],results('passed')[0]],[{...results('passed')[0],criterion:3},results('passed')[1]],results('failed'),[{...results('passed')[0],pages:[4]},results('passed')[1]]])assert.equal(schema.safeParse({...report,acceptanceResults}).success,false);
 assert.equal(schema.safeParse({...report,acceptanceResults:results('unknown')}).success,true);
});
const itemResults=(...status)=>criteria.split('\n').map((_,index)=>({criterion:index+1,status:status[index]??'passed',pages:status[index]==='unknown'?[]:[2],evidence:status[index]==='unknown'?'无法从文字分镜判断生成图中的手指数量。':'第二幅的手部反应与配文提供依据。'}));
const itemVerdicts=doc=>Object.entries(doc.dag.products).filter(([key])=>key.startsWith('itemVerdict:')).map(([,product])=>product);
const saved=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);

test('saved per-story requirements reach the review, survive restart, and an acceptance-only revision redraws nothing',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 const id=await confirmedStory(f,3,{},{acceptancePrompt:criteria});
 f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 const before=await f.read(id),doc=await saved(f,id),captures=await f.json(`sessions/${id}/prompts`);
 assert.equal(before.selection.acceptancePrompt,criteria);
 assert.deepEqual(doc.dag.items.map(i=>i.text),criteria.split('\n'));
 assert.equal(itemVerdicts(doc).length,2,'one verdict per requirement');
 assert.deepEqual(captures.criteria,criteria.split('\n'));
 assert.equal(captures.productionPrompt,before.selection.productionPrompt);assert.equal(captures.acceptancePrompt,criteria);assert.deepEqual(captures.missingRecords,[]);
 assert.deepEqual(f.control.reviews[0].acceptanceCriteria,criteria.split('\n'),'the review sees the saved requirements');
 assert.equal('records' in before,false);assert.equal('usage' in before,false);
 const drawn=f.control.calls.length,reviews=f.control.reviews.length,textBefore=f.control.dagCalls.filter(n=>n!=='registerItems').length;
 await f.restart();
 const extended=criteria+'\n结语不复述情节。';
 const {child,doc:next}=await revise(f,id,{acceptancePrompt:extended});
 assert.equal(f.control.calls.length,drawn,'no image is drawn again');
 assert.equal(f.control.reviews.length,reviews+1);
 assert.equal(f.control.dagCalls.filter(n=>n!=='registerItems').length,textBefore+0,'no planning or repair call');
 assert.equal(next.dag.items.length,3);assert.equal(itemVerdicts(next).length,3);
 assert.deepEqual(next.images.length,3);
 assert.equal((await f.json(`sessions/${child}/prompts`)).acceptancePrompt,extended);
 assert.equal((await f.read(id)).selection.acceptancePrompt,criteria);
 await f.app.services.database.prepare('UPDATE stories SET user_id=? WHERE id=?').bind('other-owner',id).run();assert.equal((await f.request(`sessions/${id}/prompts`)).status,404);
});
test('failed criteria enter the targeted repair and must pass a fresh review before drawing',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 f.control.beforeText=async name=>name==='review'?(f.control.reviews.length===1?{issues:[{page:2,category:'caption',problem:'缺少可见反应。',instruction:'第二幅保留原事件，配文增加可见的手部回应。',requiresReplan:false}],acceptanceResults:itemResults('failed')}:{issues:[],acceptanceResults:itemResults()}):undefined;
 const id=await confirmedStory(f,3,{},{acceptancePrompt:criteria});f.app.services.production.wake();
 await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal(count(f.control.dagCalls,'sceneRepair'),1);assert.equal(f.control.reviews.length,2);
 assert.ok(itemVerdicts(await saved(f,id)).every(product=>product));
 assert.equal(f.control.calls.length,3,'drawing only after the review approved');
});
test('unknown criteria stop for the reader with their evidence: no fabricated repair or drawing',async t=>{
 const f=await productionFixture(t,'codex');f.control.hold=false;
 f.control.beforeText=async name=>name==='review'?{issues:[],acceptanceResults:itemResults('unknown')}:undefined;
 const id=await confirmedStory(f,3,{},{acceptancePrompt:criteria});f.app.services.production.wake();
 await until(async()=>(await f.read(id)).faults?.length>0,20000);
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 const view=await f.read(id);
 assert.notEqual(view.state,'completed');
 assert.match(JSON.stringify(view.faults),/无法从文字分镜判断/);
 assert.equal(count(f.control.dagCalls,'sceneRepair'),0);assert.equal(f.control.calls.length,0);assert.equal(f.control.reviews.length,1);
});
test('historical rows have no invented capture history, and previews do not commission inference',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(3);f.app.stopGeneration();
 await f.app.services.database.prepare("UPDATE stories SET document=json_remove(document,'$.usage') WHERE id=?").bind(id).run();
 const initial=await f.json(`sessions/${id}/prompts`);assert.deepEqual(initial.records,[]);assert.deepEqual(initial.results,[]);assert.ok(initial.previews.production.instructions.includes('默认制作标准'));assert.equal(f.control.plans.length,0);
 assert.deepEqual(initial.missingRecords,[]);assert.equal(initial.productionPrompt,selection.productionPrompt);assert.equal(initial.acceptancePrompt,'');
});

test('prompt export metadata identifies partially retained and inherited calls without leaking raw receipts',async t=>{
 const f=await productionFixture(t),id=await f.createLegacyReader(3);f.app.stopGeneration();
 const record={instructions:'Saved historical rules',input:'Saved historical input',schema:{type:'object'},reference:'/api/media/old-reference.webp'};
 const usage=[
  {step:'plan',model:'old-text',originId:'parent-version',requestId:'private-request-id',usage:{private:'private-usage'},promptRecord:record},
  {step:'image:0',model:'old-image',originId:'parent-version',requestId:'private-image-id',usage:null},
  {step:'review:0',model:'new-review',requestId:null,usage:null,promptRecord:record},
 ];
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.usage',json(?)) WHERE id=?").bind(JSON.stringify(usage),id).run();
 const history=await f.json(`sessions/${id}/prompts`);
 assert.deepEqual(history.records,[{step:'plan',model:'old-text',originId:'parent-version',index:0,record},{step:'review:0',model:'new-review',originId:id,index:2,record}]);
 assert.deepEqual(history.missingRecords,[{step:'image:0',model:'old-image',originId:'parent-version',index:1}]);
 assert.ok(!JSON.stringify(history).includes('private-'));
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
});

test('confirmation drafts retain both requirements through restart and apply them only on explicit confirmation',async t=>{
 const f=await productionFixture(t);f.control.hold=false;f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦与醒的经历。'}],note:''});
 const created=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}}),id=created.id;await f.startDiscovery(id);await f.demand(id);
 await until(async()=>(await f.read(id)).intake.phase==='choosing');
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const settings={artStyle:'ink-pencil',productionPrompt:'保留关键对白，画面尽量复用。',acceptancePrompt:criteria,narrativeDetail:'balanced',length:'auto'};
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,action:'draft',settings});await f.restart();
 const resumed=await f.read(id);assert.deepEqual(resumed.intake.draft,settings);assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
 await f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:resumed.intake.generation,action:'confirm',settings});await until(async()=>(await f.read(id)).state==='completed',20000);
 const done=await f.read(id);assert.equal(done.selection.productionPrompt,settings.productionPrompt);assert.equal(done.selection.acceptancePrompt,criteria);
 assert.deepEqual(f.control.reviews[0].acceptanceCriteria,criteria.split('\n'));
});
