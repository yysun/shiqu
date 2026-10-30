// Explicit live, review-only comparison. Keep original input and successful receipts; never open the live shelf or draw.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCodexRunner} from '../server/codex-runner.ts';
import {createReaderProvider} from '../server/generation.ts';
import {planSchema,selectionSchema} from '../lib/reader-model.ts';

const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
for(const name of ['--input','--out','--model','--effort'])assert.ok(args.includes(name)&&arg(name)&&!arg(name).startsWith('--'),`Required: ${name}`);
const input=path.resolve(arg('--input')),out=path.resolve(arg('--out')),model=arg('--model'),effort=arg('--effort');
assert.ok(['medium','high','xhigh'].includes(effort));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const row=JSON.parse(await readFile(input,'utf8')),doc=JSON.parse(row.document),selection=selectionSchema.parse(JSON.parse(row.selection));
const plan=planSchema.parse(doc.plan);assert.ok(doc.original?.text);await mkdir(out,{recursive:true});
const fixed={selection,plan,original:doc.original,outline:doc.storyboard?.outline??null};
const inputSha256=hash(fixed),snapshot=path.join(out,'input.json');
try{assert.deepEqual(JSON.parse(await readFile(snapshot,'utf8')),fixed);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(snapshot,JSON.stringify(fixed,null,2)+'\n',{flag:'wx',mode:0o600});}
const rubric={primary:'跨幅机械转述：有上下文证据并给出可执行修法，不能删除必要的说法归属。',observations:['第4幅“无处容纳”是否表达清楚；允许合理判断差异。','第14幅“有了新用处”是否解释充分；属于可选清晰度改进，不强制列为漏检。'],falsePositives:'核对每条问题的原文/分镜依据；不奖励凑问题，不按issues数量排名。',limits:'同一故事每档一次，不能推断普遍优劣；rubric不传入模型。'};
const rubricFile=path.join(out,'rubric.json');try{assert.deepEqual(JSON.parse(await readFile(rubricFile,'utf8')),rubric);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(rubricFile,JSON.stringify(rubric,null,2)+'\n',{flag:'wx',mode:0o600});}
const resultFile=path.join(out,effort+'.json');
let saved;
try{saved=JSON.parse(await readFile(resultFile,'utf8'));assert.equal(saved.inputSha256,inputSha256);assert.equal(saved.requestedModel,model);assert.equal(saved.effort,effort);assert.equal(saved.status,'succeeded');}catch(error){if(error.code!=='ENOENT')throw error;}
const variables={...process.env,SHIQU_AI_PROVIDER:'codex',CODEX_MODEL:model,SHIQU_REASONING_REVIEW:effort};
const real=createCodexRunner(variables);let requestSha256,actual;
const runner={status:()=>real.status(),async run(job){
 assert.equal(job.generateImage,undefined);assert.equal(job.reasoningEffort,effort);
 const request={instructions:job.instructions,prompt:job.prompt,schema:job.schema};requestSha256=hash(request);
 const requestFile=path.join(out,'request.json');try{assert.deepEqual(JSON.parse(await readFile(requestFile,'utf8')),request);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(requestFile,JSON.stringify(request,null,2)+'\n',{flag:'wx',mode:0o600});}
 if(saved){assert.equal(saved.requestSha256,requestSha256);actual={text:JSON.stringify(saved.report),image:null,model:saved.actualModel,reasoningEffort:saved.actualEffort,requestId:saved.requestId,usage:saved.usage};assert.equal(actual.model,model);assert.equal(actual.reasoningEffort,effort);return actual;}
 actual=await real.run(job);assert.equal(actual.model,model);assert.equal(actual.reasoningEffort,effort);return actual;
}};
const media={get(){throw Error('NO_MEDIA_IN_REVIEW');},put(){throw Error('NO_MEDIA_IN_REVIEW');}};
const provider=createReaderProvider(variables,media,fetch,runner),startedAt=new Date().toISOString(),start=performance.now();
if(!saved)console.log(JSON.stringify({effort,status:'started',model,inputSha256}));
try{
 const result=await provider.generator().review(selection,plan,doc.original,doc.storyboard?.outline);
 if(saved){console.log(JSON.stringify({effort,reused:true,elapsedMs:saved.elapsedMs,issues:result.value.issues.length}));process.exit(0);}
 const receipt={status:'succeeded',effort,actualEffort:actual.reasoningEffort,requestedModel:model,actualModel:actual.model,inputSha256,requestSha256,startedAt,finishedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-start),requestId:result.requestId,usage:result.usage,report:result.value};
 await writeFile(resultFile,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({effort,status:'succeeded',elapsedMs:receipt.elapsedMs,issues:receipt.report.issues.length,resultFile}));
}catch(error){
 const receipt={status:'failed',effort,requestedModel:model,inputSha256,requestSha256,startedAt,finishedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-start),error:error.name==='CodexError'?error.message:error.name};
 await writeFile(path.join(out,effort+'-failure-'+Date.now()+'.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.error(JSON.stringify(receipt));process.exitCode=1;
}
