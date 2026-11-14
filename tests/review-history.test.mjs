// Historical views must distinguish model results from inputs and never infer missing evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {storyReviewHistory} from '../lib/reader-review-history.ts';
import {newReview} from '../lib/reader-review.ts';
import {makePlan,selection} from './fixtures/production-data.mjs';
const page=(caption,prompt='An ancient listener pauses beside a table.')=>({caption,prompt});
const original=page('旧配文说明听者没有接取。'),revised=page('新配文澄清听者没有伸手接取。');
const issue={page:1,category:'caption',problem:'指代不清。',instruction:'说清听者。',requiresReplan:false};
const full=(round,extra={})=>({round,issues:[],titleReview:{previousTitle:'原题',title:'原题',reason:'准确'},...extra});
const call=(step,input,extra={})=>({step,model:'fixture',requestId:'private-request',usage:{secret:'PRIVATE_USAGE'},promptRecord:{instructions:'PRIVATE_INSTRUCTIONS',input:JSON.stringify(input)},...extra});
function row(review,usage=[],extra={}){return {id:'current',user_id:'owner',selection:JSON.stringify({...selection,acceptancePrompt:'当前条目'}),document:JSON.stringify({plan:makePlan(2),original:{text:'PRIVATE_ORIGINAL'},images:[],audio:[],usage,visualReview:review,...extra}),error:null};}
test('mixed count/full/repair order uses only this version and preserves unknown verdict',()=>{
 const review={...newReview(),status:'blocked',frameCountReports:[{frameCountReview:{decision:'reduce',proposedCount:1,reason:'重复'},requirements:[],issues:[issue],coverage:[]}],reports:[full(0,{acceptanceResults:[{criterion:1,status:'unknown',pages:[1],evidence:'没有旧稿。'}]})],history:[{round:0,requested:[1],changes:[{page:1,...revised}],step:'repair:frames:0:1:1'}]};
 const usage=[call('review:full:0:1',{}, {originId:'parent'}),call('review:frames:0:0',{}),call('repair:frames:0:1:1',{plan:{pages:[original]},requestedPages:[1]}),call('review:full:0:1',{acceptanceCriteria:['本次实际条目']})];
 const result=storyReviewHistory(row(review,usage));assert.deepEqual(result.entries.map(e=>e.kind),['count','repair','review']);assert.deepEqual(result.entries.map(e=>e.position),[1,2,3]);assert.deepEqual(result.entries[1].repair.pages[0].before,original);assert.equal(result.entries[2].outcome,'unknown');assert.equal(result.entries[2].acceptance[0].text,'本次实际条目');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_USAGE|PRIVATE_INSTRUCTIONS|PRIVATE_ORIGINAL|private-request/);
});
test('stored before wins, absent before stays absent, and ambiguous calls are not assigned a position',()=>{
 const h={round:1,requested:[1],changes:[{page:1,...revised}]};
 const report={...newReview(),history:[h]};
 let result=storyReviewHistory(row(report));assert.equal(result.entries[0].repair.pages[0].before,null);assert.equal(result.entries[0].position,null);
 result=storyReviewHistory(row({...report,history:[{...h,before:[{page:1,...original}]}]},[call('repair:1:1',{plan:{pages:[revised]}})]));assert.deepEqual(result.entries[0].repair.pages[0].before,original);
 result=storyReviewHistory(row(report,[call('repair:1:1',{plan:{pages:[original]}}),call('repair:1:1',{plan:{pages:[revised]}})]));assert.equal(result.entries[0].position,null);assert.equal(result.entries[0].repair.pages[0].before,null);
});
test('old structure calls with equal full round are matched by saved original ranges and requested issues',()=>{
 const a=page('原第二幅是一个完整的反应。'),b=page('原第三幅交代后续动作。');
 const structure=(requested,from,old)=>({round:1,requested,changes:[],structure:{before:3,after:2,edits:[{from,to:from,pages:[]}],sourcePages:[0,2],removed:[{page:from,...old}]}});
 const review={...newReview(),history:[structure([2],2,a),structure([3],3,b)]};
 const usage=[call('repair:full:1:1:structure',{plan:{pages:[original,a,b]},issues:[{page:2,requiresReplan:true}]}),call('repair:frames:1:2:structure',{plan:{pages:[original,a,b]},issues:[{page:3,requiresReplan:true}]})];
 const result=storyReviewHistory(row(review,usage));assert.deepEqual(result.entries.map(e=>e.position),[0,1]);assert.equal(result.entries[1].repair.structure.edits[0].before[0].caption,b.caption);
});
test('structure insertion/deletion numbers refer to the historical drafts, not the current plan',()=>{
 const inserted=page('插入的画幅有自己的叙事任务。');
 const h={round:1,requested:[1],changes:[],structure:{before:3,after:3,edits:[{from:1,to:0,pages:[inserted]},{from:2,to:2,pages:[]}],removed:[{page:2,...original}],sourcePages:[null,0,2]}};
 const event=storyReviewHistory(row({...newReview(),history:[h]})).entries[0];assert.equal(event.outcome,'changed');assert.equal(event.repair.structure.edits[0].newFrom,1);assert.equal(event.repair.structure.edits[1].newFrom,3);assert.deepEqual(event.repair.structure.edits[1].before,[{page:2,...original}]);
});
test('first full report is an audit even after manual continuation; prior reports become rechecks',()=>{
 const result=storyReviewHistory(row({...newReview(),reports:[full(3),full(5)]},[call('review:full:3:1',{}),call('review:full:5:1',{})]));assert.equal(result.entries[0].title,'第1次全篇审核');assert.equal(result.entries[1].title,'第2次全篇复核');
});
test('reflection/global character changes and no-op attempts retain their actual evidence',()=>{
 const review={...newReview(),overridden:true,history:[{round:1,requested:[0],changes:[],reflection:'新的结语。',previousReflection:'旧的结语。',changed:true},{round:2,requested:[1],changes:[],changed:false},{round:3,requested:[1],changes:[],structure:{before:2,after:2,edits:[],removed:[],sourcePages:[0,1],characters:'Correct recurring character details.',previousCharacters:'Old recurring character details.'}}]};
 const result=storyReviewHistory(row(review));assert.equal(result.overridden,true);assert.equal(result.entries.length,3);assert.deepEqual(result.entries[0].repair.reflection,{before:'旧的结语。',after:'新的结语。'});assert.equal(result.entries[1].outcome,'unchanged');assert.equal(result.entries[2].outcome,'changed');assert.match(result.entries[2].repair.characters.before,/Old/);
});
test('empty legacy documents return no invented events or times',()=>{
 const r=row(undefined,[]),doc=JSON.parse(r.document);delete doc.usage;r.document=JSON.stringify(doc);const result=storyReviewHistory(r);assert.deepEqual(result.entries,[]);assert.equal(result.status,null);
});
test('legacy character-only repairs without prior text do not claim no change',()=>{
 const result=storyReviewHistory(row({...newReview(),history:[{round:1,requested:[],changes:[],structure:{before:2,after:2,edits:[],characters:'Saved recurring character details.'}}]}));
 assert.equal(result.entries[0].outcome,'unknown');assert.equal(result.entries[0].repair.characters.before,null);
});
