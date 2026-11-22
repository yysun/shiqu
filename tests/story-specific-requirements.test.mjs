// Exercise production preparation, durable drafts and requirement routing without live inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,selection,makeRequirements} from './fixtures/production.mjs';
import {storyRequirementsSchema} from '../lib/reader-requirements.ts';
import {defaultProductionPrompt,defaultProductionDirection,normalizeProductionPrompt} from '../lib/reader-prompts.ts';
import {draftInstructions} from '../lib/reader-generation-contract.ts';
import {flowProviders} from './fixtures/test-tier.mjs';

const action=async(f,id,command)=>f.json(`sessions/${id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(id)).intake.generation,...command});
async function create(f){
 const generator=f.generation.generator.bind(f.generation);
 f.generation.generator=()=>({...generator(),prepareOriginal:async s=>({title:s.storyTitle,text:s.storyTitle==='大葫芦'?'惠子说大葫芦无用，庄子指出可以把它系在身上浮游江湖。':'庄周梦见自己成为蝴蝶，醒来发现自己是庄周，思考梦与醒的区别。',url:'https://example.test/original',kind:'passage',provider:'controlled',retrievedAt:'2026-11-04'})});
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦与醒的追问。',artRecommendation:{artStyle:'paper-cut',reason:'梦境的层次。'}},{title:'大葫芦',description:'关于用途的交锋。'}],note:''});
 const s=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced',productionPrompt:''}});
 await f.startDiscovery(s.id);await f.demand(s.id);await until(async()=>(await f.read(s.id)).intake.phase==='choosing');return s.id;
}
async function prepared(f){const id=await create(f);await action(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');return id;}

test('generic defaults are system rules; blank and historical automatic fields remain empty',()=>{
 assert.equal(defaultProductionPrompt(),'');assert.equal(normalizeProductionPrompt('','原典故事'),'');
 assert.equal(normalizeProductionPrompt(defaultProductionDirection,'原典故事'),'');
 assert.ok(draftInstructions().includes(defaultProductionDirection));
 assert.equal(normalizeProductionPrompt('保留庄周醒来的停顿。','原典故事'),'保留庄周醒来的停顿。');
 const pair=makeRequirements('庄周梦蝶');assert.ok(storyRequirementsSchema.safeParse(pair).success);
 for(const changed of [{...pair,productionPrompt:''},{...pair,productionPrompt:'长'.repeat(1201)},{...pair,acceptancePrompt:'只有一条'},{...pair,acceptancePrompt:'一\n二\n三\n四\n五'}])assert.equal(storyRequirementsSchema.safeParse(changed).success,false);
});

for(const provider of flowProviders(['codex','gemini']))test(`${provider}: source-specific setup suggestions survive restart, edits and confirmation, then route to their own stages`,async t=>{
 const f=await productionFixture(t,provider);f.control.hold=false;const id=await prepared(f),before=await f.read(id),pair=makeRequirements('庄周梦蝶');
 assert.equal(before.selection.productionPrompt,'');assert.equal(before.intake.draft.productionPrompt,pair.productionPrompt);assert.equal(before.intake.draft.acceptancePrompt,pair.acceptancePrompt);assert.equal(before.intake.draft.artStyle,'paper-cut');
 assert.equal(f.control.recommendations.length,1);assert.equal(f.control.recommendations[0].prepareRequirements,true);assert.equal(f.control.dagCalls.length,0);assert.equal(f.control.calls.length,0);
 await f.restart();assert.deepEqual((await f.read(id)).intake.draft,before.intake.draft);
 const settings={...before.intake.draft,productionPrompt:'重点呈现庄周醒来后的停顿。',acceptancePrompt:'配文交代庄周已从梦中醒来。\n醒后的反应有对应画面描述。'};
 const seen=[];f.control.beforeText=async(name,payload)=>{if(name!=='recommend')seen.push({name,payload});};
 await action(f,id,{action:'draft',settings});await action(f,id,{action:'confirm',settings});await until(async()=>(await f.read(id)).state==='completed',20000);
 assert.equal((await f.read(id)).selection.productionPrompt,settings.productionPrompt);
 // 验收要求只进入审片；制作要求进入文字制作的各调用，不进入任何其他阶段的验收字段。
 assert.ok(seen.some(item=>item.name==='review'));
 for(const {name,payload} of seen){
  if(name==='review'){assert.equal(payload.acceptancePrompt,settings.acceptancePrompt);assert.deepEqual(payload.acceptanceCriteria,settings.acceptancePrompt.split('\n'));}
  else{assert.equal(payload.acceptancePrompt,undefined,name);assert.equal(payload.acceptanceCriteria,undefined,name);}
 }
 assert.ok(seen.filter(item=>item.name==='outline').every(item=>item.payload.productionPrompt===settings.productionPrompt));
 assert.equal(f.control.calls.length,(await f.read(id)).story.pages.length);
});

test('a paused draft saved during inference wins through progress and final checkpoints, including intentional blanks',async t=>{
 const f=await productionFixture(t);let release,entered;
 const ready=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 f.control.beforeText=async kind=>{if(kind==='recommend'){entered();await hold;}};
 const id=await create(f);await action(f,id,{action:'choose',batch:0,index:0});await ready;
 const settings={artStyle:'watercolor',narrativeDetail:'brief',length:'auto',productionPrompt:'',acceptancePrompt:''};
 try{
  await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
  await action(f,id,{action:'draft',settings});
  const inFlight=await f.read(id);
  assert.equal(inFlight.state,'running');
  assert.deepEqual(inFlight.intake.draft,settings);
 }finally{release();}
 await until(async()=>(await f.read(id)).intake.phase==='confirming');assert.deepEqual((await f.read(id)).intake.draft,settings);
 await f.restart();assert.deepEqual((await f.read(id)).intake.draft,settings);
 await action(f,id,{action:'recommend',settings});await f.json(`sessions/${id}/production-control`,'POST',{action:'resume'});
 await until(async()=>(await f.read(id)).intake.phase==='confirming');assert.deepEqual((await f.read(id)).intake.draft,settings);
 assert.equal(f.control.recommendations.at(-1).prepareRequirements,undefined,'Repreparing the same story preserves edited requirements');
});

test('reselection replaces unchanged automatic guidance and preserves authored draft fields even without settings',async t=>{
 const f=await productionFixture(t),id=await prepared(f),first=(await f.read(id)).intake.draft;
 await action(f,id,{action:'choose',batch:0,index:1});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const second=(await f.read(id)).intake.draft;assert.equal(second.productionPrompt,makeRequirements('大葫芦').productionPrompt);assert.equal(second.acceptancePrompt,makeRequirements('大葫芦').acceptancePrompt);assert.notEqual(second.productionPrompt,first.productionPrompt);
 const custom={...second,productionPrompt:'保留原文中的关键对白。',acceptancePrompt:'关键对白有明确说话对象。'};
 await action(f,id,{action:'draft',settings:custom});await action(f,id,{action:'choose',batch:0,index:0});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const last=(await f.read(id)).intake.draft;assert.equal(last.productionPrompt,custom.productionPrompt);assert.equal(last.acceptancePrompt,custom.acceptancePrompt);
 await action(f,id,{action:'draft',settings:{...last,productionPrompt:'',acceptancePrompt:''}});await action(f,id,{action:'choose',batch:0,index:1});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 assert.equal((await f.read(id)).intake.draft.productionPrompt,'');assert.equal((await f.read(id)).intake.draft.acceptancePrompt,'');
});

async function stageReplacement(f,id){
 const draft=await f.json(`sessions/${id}/reselection`,'POST',{requestId:crypto.randomUUID()});
 await f.startDiscovery(draft.id);await f.demand(draft.id);
 await until(async()=>(await f.read(draft.id)).intake.batches.length>0);
 const ready=await f.read(draft.id);
 return {route:`sessions/${id}/reselection/${draft.id}`,choice:{requestId:crypto.randomUUID(),batch:0,index:1,generation:ready.intake.generation}};
}

for(const custom of [false,true])test(`replacing before production preserves ${custom?'authored requirements and an explicit blank':'fresh guidance for the replacement'}`,async t=>{
 const f=await productionFixture(t),id=await prepared(f),first=(await f.read(id)).intake.draft;
 const edited={productionPrompt:'保留原文中的关键对白。',acceptancePrompt:''};
 if(custom)await action(f,id,{action:'draft',settings:{...first,...edited}});
 const {route,choice}=await stageReplacement(f,id),next=await f.json(route,'POST',choice);
 await until(async()=>(await f.read(next.id)).intake.phase==='confirming');
 const requirements=custom?edited:makeRequirements('大葫芦'),saved=(await f.read(next.id)).intake.draft;
 assert.equal(saved.productionPrompt,requirements.productionPrompt);
 assert.equal(saved.acceptancePrompt,requirements.acceptancePrompt);
});

test('a pending replacement cannot silently inherit outdated authored requirements',async t=>{
 const f=await productionFixture(t),id=await prepared(f);
 const {route,choice}=await stageReplacement(f,id),before=await f.read(id);
 await action(f,id,{action:'draft',settings:{...before.intake.draft,acceptancePrompt:''}});
 const stale=await f.request(route,'POST',choice);
 assert.equal(stale.status,409);assert.match((await stale.json()).error,/制作或验收要求已更新/);
 assert.equal((await f.json(`sessions/${id}/current`)).id,id);
});

test('saved requirements can be recovered after re-preparation and confirmation with empty fields',async t=>{
 const f=await productionFixture(t),id=await prepared(f),before=await f.read(id);
 const settings={...before.intake.draft,productionPrompt:'',acceptancePrompt:''};
 await action(f,id,{action:'recommend',settings});await until(async()=>(await f.read(id)).intake.phase==='confirming');
 const saved=await action(f,id,{action:'confirm',settings});
 await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});
 assert.equal(saved.frameRecommendation.requirements,undefined);
 assert.equal(saved.selection.productionPrompt,'');assert.equal(saved.selection.acceptancePrompt,'');
 const prompts=await f.json(`sessions/${id}/prompts`);
 assert.deepEqual(prompts.suggestedRequirements,makeRequirements('庄周梦蝶'));
 assert.equal((await f.read(id)).generationControl,'paused');
});

test('ordinary revisions retain provenance so a new selection version clears inherited automatic requirements',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await prepared(f),settings=(await f.read(id)).intake.draft;
 await action(f,id,{action:'confirm',settings});await until(async()=>(await f.read(id)).state==='completed');
 const base=await f.json(`sessions/${id}/revisions`);base.plan.pages[0].caption+='梦醒之后，庄周仍有疑问。';
 const revised=await f.json(`sessions/${id}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{plan:base.plan},paused:true});
 const parentId=revised.id;
 const draft=await f.json(`sessions/${parentId}/reselection`,'POST',{requestId:crypto.randomUUID()});
 assert.equal(draft.selection.productionPrompt,'');assert.equal(draft.selection.acceptancePrompt,'');
 await f.startDiscovery(draft.id);await f.demand(draft.id);await until(async()=>(await f.read(draft.id)).intake.batches.length>0);
 const replacement=await f.json(`sessions/${parentId}/reselection/${draft.id}`,'POST',{requestId:crypto.randomUUID(),batch:0,index:1,settings});
 await f.json(`sessions/${replacement.id}/production-control`,'POST',{action:'resume'});await until(async()=>(await f.read(replacement.id)).intake.phase==='confirming');
 assert.equal((await f.read(replacement.id)).intake.draft.productionPrompt,makeRequirements('大葫芦').productionPrompt);
 assert.equal((await f.read(replacement.id)).intake.draft.acceptancePrompt,makeRequirements('大葫芦').acceptancePrompt);
});


test('completed stories retain deliberately blank requirements through open and committed reselection',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await prepared(f),settings={...(await f.read(id)).intake.draft,productionPrompt:'',acceptancePrompt:''};
 await action(f,id,{action:'confirm',settings});await until(async()=>(await f.read(id)).state==='completed');
 const draft=await f.json(`sessions/${id}/reselection`,'POST',{requestId:crypto.randomUUID()});await f.startDiscovery(draft.id);await f.demand(draft.id);await until(async()=>(await f.read(draft.id)).intake.batches.length>0);
 const replacement=await f.json(`sessions/${id}/reselection/${draft.id}`,'POST',{requestId:crypto.randomUUID(),batch:0,index:1});await until(async()=>(await f.read(replacement.id)).intake.phase==='confirming');
 assert.equal((await f.read(replacement.id)).intake.draft.productionPrompt,'');assert.equal((await f.read(replacement.id)).intake.draft.acceptancePrompt,'');
});

test('edits after failed replacement preparation supersede inherited authored overrides',async t=>{
 const f=await productionFixture(t);f.control.hold=false;const id=await prepared(f),settings={...(await f.read(id)).intake.draft,productionPrompt:'保留主角的原话。',acceptancePrompt:'主角的原话明确标示说话对象。'};
 await action(f,id,{action:'confirm',settings});await until(async()=>(await f.read(id)).state==='completed');
 const draft=await f.json(`sessions/${id}/reselection`,'POST',{requestId:crypto.randomUUID()});await f.startDiscovery(draft.id);await f.demand(draft.id);await until(async()=>(await f.read(draft.id)).intake.batches.length>0);
 let reject=true;f.control.beforeText=async kind=>{if(kind==='recommend'&&reject){reject=false;throw Error('controlled preparation failure');}};
 const replacement=await f.json(`sessions/${id}/reselection/${draft.id}`,'POST',{requestId:crypto.randomUUID(),batch:0,index:1});await until(async()=>(await f.read(replacement.id)).state==='failed');
 await f.json(`sessions/${replacement.id}/production-control`,'POST',{action:'pause'});
 const edited={...settings,productionPrompt:'新要求：保留梦醒后的疑问。',acceptancePrompt:''};
 await action(f,replacement.id,{action:'draft',settings:edited});await action(f,replacement.id,{action:'choose',batch:0,index:0});await f.json(`sessions/${replacement.id}/production-control`,'POST',{action:'resume'});await until(async()=>(await f.read(replacement.id)).intake.phase==='confirming');
 assert.equal((await f.read(replacement.id)).intake.draft.productionPrompt,edited.productionPrompt);assert.equal((await f.read(replacement.id)).intake.draft.acceptancePrompt,'');
});
