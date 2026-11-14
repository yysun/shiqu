// Continuations keep only valid system text and provenance; previous approval never bypasses a new audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {continueEvaluationDocument,openEvaluationHistory,evaluationHistoryTotals} from '../scripts/storyboard-evaluation.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {makePlan,selection} from './fixtures/production-data.mjs';
import {newReview} from '../lib/reader-review.ts';
const input={id:'story',selection:{...selection,length:'auto'},original:{title:'原文',text:'甲赠物，乙未接。'}};
const parent={plan:makePlan(4),original:input.original,images:['old-image'],audio:[],usage:[{step:'repair:1',requestId:'saved-receipt'}],visualReview:{...newReview(),status:'passed',round:5,repairs:3,history:[{round:1,requested:[2],changes:[]}],reports:[{issues:[]}]}};
test('legal system drafts retain text, usage, history and repair count but lose old approval',()=>{
 const next=continueEvaluationDocument(input,input,parent);assert.deepEqual(next.plan,parent.plan);assert.equal(next.visualReview.status,'pending');assert.equal(next.visualReview.repairs,3);assert.equal(next.visualReview.round,5);assert.deepEqual(next.visualReview.history,parent.visualReview.history);assert.deepEqual(next.visualReview.reports,[]);assert.deepEqual(next.visualReview.issues,[]);assert.deepEqual(next.usage,parent.usage);assert.notEqual(next.plan,parent.plan);assert.equal(parent.visualReview.status,'passed');
});
test('changed source/settings or illegal frame output cannot seed a continuation',()=>{
 assert.throws(()=>continueEvaluationDocument({...input,original:{...input.original,text:'另一个原文'}},input,parent),/PARENT_MISMATCH/);
 assert.throws(()=>continueEvaluationDocument({...input,selection:{...input.selection,narrativeDetail:'detailed'}},input,parent),/PARENT_MISMATCH/);
 assert.throws(()=>continueEvaluationDocument(input,input,{...parent,plan:{...parent.plan,pages:[{caption:'短',prompt:'invalid'}]}}));
});
test('a version change never resets the twenty-repair ceiling',()=>{
 const exhausted={...parent,visualReview:{...parent.visualReview,repairs:20,status:'blocked',stopReason:'limit'}};
 assert.equal(continueEvaluationDocument(input,input,exhausted).visualReview.repairs,20);
 assert.throws(()=>continueEvaluationDocument(input,input,{...exhausted,visualReview:{...exhausted.visualReview,repairs:21}}),/PARENT_REVIEW/);
});
test('restart without new inference retains receipts and failures for the next continuation',async t=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'evaluation-history-'));t.after(()=>rm(tmp,{recursive:true,force:true}));
 await writeFile(path.join(tmp,'result.json'),JSON.stringify({calls:[{requestId:'paid-one',hash:'job-one',cached:false}],failures:[{step:'review:1',error:'saved failure'}]}));
 let history=openEvaluationHistory(tmp);history.receipt({requestId:'paid-one',hash:'job-one',cached:true});
 history=openEvaluationHistory(tmp);assert.equal(history.calls.length,2);assert.equal(history.failures.length,1);
 const restoredResult={...parent,calls:history.calls,failures:history.failures},totals=evaluationHistoryTotals(restoredResult);
 assert.equal(totals.textReceipts,1,'Cached use of the same receipt is not another inference');assert.equal(totals.failures,1);
 const next=continueEvaluationDocument(input,input,parent);assert.equal(next.visualReview.status,'pending');
 const inherited={lineage:{previousReceiptIds:totals.receiptIds,previousFailures:totals.failures},calls:[{requestId:'paid-one',cached:true},{requestId:'paid-two',cached:false}],failures:[]};
 assert.equal(evaluationHistoryTotals(inherited).textReceipts,2);assert.equal(evaluationHistoryTotals(inherited).failures,1);
});
