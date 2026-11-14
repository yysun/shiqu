// Isolated evaluation data exercises the production engine and durable checkpoints directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../server/database.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {advanceStory} from '../lib/reader-engine.ts';
import {nextStep,selectionSchema} from '../lib/reader-model.ts';
import {newReview} from '../lib/reader-review.ts';
import {acquireEvaluationRun,continueEvaluationDocument} from '../scripts/storyboard-evaluation.mjs';
import {makePlan,selection as legacy} from './fixtures/production-data.mjs';
test('old script expands, rechecks count, then completes the original audit with zero media calls',async t=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'frame-count-evaluation-')),db=openDatabase(tmp,process.cwd());let lease;t.after(async()=>{await lease?.release();db.close();await rm(tmp,{recursive:true,force:true});});
 const repo=new ReaderRepository(db.database),selection=selectionSchema.parse({...legacy,length:'auto'}),id='offline-v1',owner='offline',plan=makePlan(3),original={title:'原文',text:'甲赠物，乙未接，后来二人和解。',url:'https://example.org',kind:'passage',provider:'fixture',retrievedAt:'2026-11-02'};
 lease=await acquireEvaluationRun(tmp);await assert.rejects(()=>acquireEvaluationRun(tmp),/ACTIVE/);
 await repo.create(id,owner,selection);await db.database.prepare("UPDATE stories SET document=?,generation_mode='reader',generation_control='active',state='idle' WHERE id=?").bind(JSON.stringify({plan,original,images:[],audio:[],usage:[],frameCountConfirmed:true,visualReview:newReview()}),id).run();
 const calls=[];const gen=value=>({value,model:'controlled',requestId:null,usage:null});
 const base={reviewFrameCount:async(_s,p)=>{calls.push('frames');return gen({frameCountReview:{decision:p.pages.length===3?'expand':'keep',proposedCount:4,reason:'回应独立'},requirements:p.pages.length===3?[{page:2,quote:'乙未接',task:'拒绝',captionEvidence:'摘要',visualEvidence:'赠物者',loss:'回应缺失',instruction:'补听者没有伸手'}]:[]});},restructure:async()=>{calls.push('structure');return gen({edits:[{from:2,to:1,pages:[{caption:'听者没有伸手接取，只在原地停了一会儿。',prompt:'The listener pauses beside the gift with both hands at his sides.'}]}]});},review:async(_s,p)=>{calls.push('full');return gen({titleReview:{title:p.title,reason:'原文支持'},issues:[],coverage:[{quote:'后来二人和解',task:'收束',pages:[4],assessment:'adequate',reason:'已呈现',issuePage:0}]});},image:async()=>assert.fail('No images'),audio:async()=>assert.fail('No audio'),safeError:e=>e.message};
 for(let i=0;i<6;i++){
  const doc=JSON.parse((await repo.get(id,owner)).document),step=nextStep(doc,selection,79);
  if(['image','audio'].includes(step?.kind))break;
  await advanceStory(repo,base,owner,id,79);
  if(i===0){
   // A completed production checkpoint survives a new process reclaiming its abandoned lock.
   await db.database.prepare("UPDATE stories SET state='running',lock_token='old-process',lock_until=? WHERE id=?").bind(Date.now()+180000,id).run();
   await lease.recover(db.database,owner);
  }
 }
 const row=await repo.get(id,owner),doc=JSON.parse(row.document);assert.equal(row.state,'idle');assert.equal(doc.plan.pages.length,4);assert.equal(doc.visualReview.status,'passed');assert.deepEqual(calls,['frames','structure','frames','full']);assert.equal(doc.usage.length,4);assert.equal(doc.visualReview.frameCountReports.length,2,'Count-keep is a persisted production call');
});
test('two restarting processes cannot both reclaim a dead evaluation owner',async t=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'frame-count-owner-'));const children=[];
 t.after(async()=>{for(const child of children)if(child.exitCode===null)child.kill();await rm(tmp,{recursive:true,force:true});});
 const dead=spawn(process.execPath,['-e','process.exit(0)']);await once(dead,'exit');
 await writeFile(path.join(tmp,'.desktop-owner.json'),JSON.stringify({pid:dead.pid,id:'old-evaluation'}));
 const code=`import {acquireEvaluationRun} from ${JSON.stringify(new URL('../scripts/storyboard-evaluation.mjs',import.meta.url).href)};try{const lease=await acquireEvaluationRun(process.argv[1]);console.log('owned');await new Promise(r=>{process.stdin.once('end',r);process.stdin.resume();});await lease.release();}catch(error){console.log(error.message);}`;
 const start=()=>{const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code,tmp]);children.push(child);const exited=once(child,'exit');const output=new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('No owner result')),10000);child.stdout.on('data',data=>{text+=data;if(text.includes('\n')){clearTimeout(timer);resolve(text.trim());}});child.on('error',reject);});return {child,output,exited};};
 const contenders=[start(),start()],outcomes=await Promise.all(contenders.map(c=>c.output));
 assert.deepEqual(outcomes.sort(),['EVALUATION_RUN_ACTIVE','owned']);
 for(const c of contenders)c.child.stdin.end();await Promise.all(contenders.map(c=>c.exited));
});
test('a rejected new binding or concurrent process leaves frozen provenance untouched',async t=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'frame-count-binding-'));let lease;
 t.after(async()=>{await lease?.release();await rm(tmp,{recursive:true,force:true});});
 lease=await acquireEvaluationRun(tmp);await lease.bind('original',{model:'model-a',codeHash:'code-a'});
 await writeFile(path.join(tmp,'inputs.json'),'original input');
 const original=await readFile(path.join(tmp,'source-manifest.json'),'utf8');
 await assert.rejects(()=>acquireEvaluationRun(tmp),/ACTIVE/);assert.equal(await readFile(path.join(tmp,'source-manifest.json'),'utf8'),original);
 await lease.release();lease=await acquireEvaluationRun(tmp);
 await assert.rejects(()=>lease.bind('changed',{model:'model-b',codeHash:'code-b'}),/BINDING/);
 assert.equal(await readFile(path.join(tmp,'source-manifest.json'),'utf8'),original);assert.equal(await readFile(path.join(tmp,'inputs.json'),'utf8'),'original input');
 await lease.bind('original',{model:'ignored',codeHash:'ignored'});assert.equal(await readFile(path.join(tmp,'source-manifest.json'),'utf8'),original);
});
test('an inherited exhausted repair budget blocks before restructuring or media',async t=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'frame-count-limit-')),db=openDatabase(tmp,process.cwd());t.after(async()=>{db.close();await rm(tmp,{recursive:true,force:true});});
 const repo=new ReaderRepository(db.database),selection=selectionSchema.parse({...legacy,length:'auto'}),id='continued-limit',owner='offline';
 const original={title:'原文',text:'甲赠物，乙未接。'},input={id,selection,original};
 const doc=continueEvaluationDocument(input,input,{plan:makePlan(3),original,images:[],usage:[],visualReview:{...newReview(),repairs:20,status:'blocked',stopReason:'limit'}});
 await repo.create(id,owner,selection);await db.database.prepare("UPDATE stories SET document=?,generation_mode='reader',generation_control='active',state='idle' WHERE id=?").bind(JSON.stringify(doc),id).run();
 const calls=[];const generator={reviewFrameCount:async()=>{calls.push('frames');return {value:{frameCountReview:{decision:'expand',proposedCount:4,reason:'补回应'},requirements:[{page:2,quote:'乙未接',task:'回应',captionEvidence:'概述',visualEvidence:'赠物',loss:'回应缺失',instruction:'补听者回应'}]},model:'controlled',usage:null};},review:async()=>assert.fail('Do not pass count gate'),restructure:async()=>assert.fail('No reset repair allowance'),image:async()=>assert.fail('No images'),audio:async()=>assert.fail('No audio'),safeError:e=>e.message};
 await advanceStory(repo,generator,owner,id,79);const saved=await repo.get(id,owner),after=JSON.parse(saved.document);
 assert.equal(saved.state,'failed');assert.equal(after.visualReview.repairs,20);assert.equal(after.visualReview.stopReason,'limit');assert.deepEqual(calls,['frames']);
});
