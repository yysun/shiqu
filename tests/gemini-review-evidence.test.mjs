// Verify exact Gemini source-reference citations, fail-closed decoding, and unchanged Codex contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderProvider} from '../server/generation.ts';
import {editorialCoverageJson,validateEditorialCoverage} from '../lib/reader-editorial.ts';
import {fullReviewRequest,frameCountReviewRequest} from '../lib/reader-review.ts';
import {geminiReviewEvidence} from '../lib/reader-gemini-evidence.ts';
import {makePlan} from './fixtures/production.mjs';

const plan=makePlan(12);
const original={title:'测试原文',text:'甲贈物，乙沉默未接，然後轉身告辭。',url:'https://example.org/source',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01'};
const coverage={task:'未接受赠物的回应',pages:[2],assessment:'adequate',reason:'有独立回应',issuePage:0};
// 审片调用经 textCall 发出：载荷含已核原文，输出结构取自 DAG 审片共用的请求定义。
const full=fullReviewRequest(12,true,undefined,undefined),frames=frameCountReviewRequest(12);
const review=(gen)=>gen.textCall('review',full.instructions,{book:'测试',verifiedOriginal:original,plan:{}},full.schema,24000,original);
const countReview=(gen)=>gen.textCall('review',frames.instructions,{book:'测试',verifiedOriginal:original,plan:{}},frames.schema,24000,original);
const report=quoteId=>({titleReview:{title:plan.title,reason:'原文支持'},issues:[],coverage:[{...coverage,quoteId}]});
function generator(answer,inspect=()=>{}){
 return createReaderProvider({SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'controlled'},{},async(_url,init)=>{
  const body=JSON.parse(init.body),payload=JSON.parse(body.contents[0].parts[0].text);inspect(body,payload);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(answer(payload))}]}}]});
 }).generator();
}
test('Gemini full reviews cite exact saved excerpts and retain canonical validated reports',async()=>{
 let wire;
 const result=await review(generator(payload=>report(payload.reviewQuoteSources.find(source=>source.quote.includes('乙沉默未接')).id),(body,payload)=>{
  wire=body.generationConfig.responseFormat.text.schema;
  assert.equal(wire.properties.coverage.items.properties.quote,undefined);
  assert.equal(wire.properties.coverage.items.properties.quoteId.type,'integer');
  assert.match(body.systemInstruction.parts[0].text,/仅返回该整数/);
  assert.equal(payload.verifiedOriginal.text,original.text);
 }));
 assert.equal(result.value.coverage[0].quote,'乙沉默未接，');
 assert.equal(result.value.coverage[0].quoteId,undefined);
 validateEditorialCoverage(result.value.coverage,original);
 assert.deepEqual(result.promptRecord.schema,wire);
 assert.ok(JSON.parse(result.promptRecord.input).reviewQuoteSources.length);
});
test('Gemini frame-count requirements use the same exact-source reference path',async()=>{
 const result=await countReview(generator(payload=>({frameCountReview:{decision:'redistribute',proposedCount:12,reason:'需要展开关键回应。'},requirements:[{page:2,quoteId:payload.reviewQuoteSources.find(source=>source.quote.includes('乙沉默未接')).id,task:'拒绝回应',captionEvidence:'仅交代结果',visualEvidence:'缺少回应',loss:'关键回应缺失',instruction:'展开拒绝回应。'}]})));
 assert.equal(result.value.requirements[0].quote,'乙沉默未接，');
});
test('Gemini never falls back to authored quotes or accepts invalid reference IDs',async()=>{
 for(const id of [0,-1,1.5,99999,'1',null,undefined])await assert.rejects(review(generator(()=>report(id))),error=>error.name==='ZodError');
 await assert.rejects(review(generator(payload=>{const value=report(payload.reviewQuoteSources[0].id);value.coverage[0].quote='伪造原文';return value;})),error=>error.name==='ZodError');
});
test('source excerpts cover long Unicode text and chapter-only evidence without changing the source',()=>{
 const text='甲乙'+('𧈢甲'.repeat(100))+'丙丁。',saved={text:'本篇原文。',chapterContext:{text}};
 const schema={type:'object',properties:{coverage:editorialCoverageJson(12)}};
 const before=structuredClone({saved,schema}),prepared=geminiReviewEvidence({verifiedOriginal:saved},schema),sources=prepared.payload.reviewQuoteSources;
 for(const source of sources){assert.ok(source.quote.length>=2&&source.quote.length<=120);assert.ok((saved.text+'\n'+text).includes(source.quote));assert.doesNotMatch(source.quote,/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);}
 assert.equal(sources.filter(source=>text.includes(source.quote)).map(source=>source.quote).join(''),text);
 const value=prepared.resolve({coverage:[{...coverage,quoteId:sources.at(-1).id}]});validateEditorialCoverage(value.coverage,saved);
 assert.deepEqual({saved,schema},before);
});
test('Codex retains its prompts, canonical quote schemas and local validation',async()=>{
 const seen=[],runner={status:async()=>({configured:true}),run:async job=>{
  seen.push(job);const payload=JSON.parse(job.prompt);assert.equal(payload.reviewQuoteSources,undefined);assert.doesNotMatch(job.instructions,/本次原文引用格式/);
  const value=job.schema.properties.requirements?{frameCountReview:{decision:'keep',proposedCount:12,reason:'已有空间。'},requirements:[]}:{...report(1),coverage:[{...coverage,quote:'乙沉默未接'}]};
  return {text:JSON.stringify(value),model:'controlled',requestId:'fixture',usage:null,image:null};
 }};
 const gen=createReaderProvider({SHIQU_AI_PROVIDER:'codex'},{},async()=>assert.fail('Codex must not call Gemini'),runner).generator();
 await review(gen);await countReview(gen);
 assert.deepEqual(seen[0].schema.properties.coverage,editorialCoverageJson(12));
 assert.equal(seen[1].schema.properties.requirements.items.properties.quote.maxLength,120);
});
