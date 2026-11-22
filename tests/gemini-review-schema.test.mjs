// Exercise full-review wire grammar through Gemini while retaining local evidence validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderProvider} from '../server/generation.ts';
import {editorialCoverageJson} from '../lib/reader-editorial.ts';
import {acceptanceResultsJson} from '../lib/reader-acceptance.ts';
import {makePlan} from './fixtures/production.mjs';
import {geminiEvidenceAnswer} from './fixtures/gemini-evidence.mjs';
import {reviewReportSchema,fullReviewRequest} from '../lib/reader-review.ts';
import {validateEditorialCoverage} from '../lib/reader-editorial.ts';

const acceptancePrompt='保留关键回应。',plan=makePlan(12);
// 审片调用经 textCall 发出，输出结构取自 DAG 审片共用的请求定义，结果再按共用的审片结构本地校验。
const review=async(gen,count=12)=>{const req=fullReviewRequest(count,true,undefined,acceptancePrompt),result=await gen.textCall('review',req.instructions,{book:'测试',verifiedOriginal:original,plan:makePlan(count)},req.schema,24000,original);const value=reviewReportSchema(count,undefined,acceptancePrompt).parse(result.value);validateEditorialCoverage(value.coverage,original);return {...result,value};};
const original={title:'测试原文',text:'甲贈物，乙沉默未接，然後轉身告辭。',url:'https://example.org/source',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01'};
const coverage={quote:'乙沉默未接',task:'未接受赠物的回应',pages:[2],assessment:'adequate',reason:'有独立回应',issuePage:0};
const receipt=()=>({titleReview:{title:plan.title,reason:'原文支持'},issues:[],coverage:[structuredClone(coverage)],acceptanceResults:[{criterion:1,status:'passed',pages:[2],evidence:'保留回应。'}]});
function generator(answer,inspect=()=>{},model='gemini-3.8-flash'){
 const gen=createReaderProvider({SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'controlled',GEMINI_TEXT_MODEL:model},{},async(_url,init)=>{
  const body=JSON.parse(init.body),schema=body.generationConfig.responseFormat.text.schema,payload=JSON.parse(body.contents[0].parts[0].text);inspect(schema);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(geminiEvidenceAnswer(answer,payload,schema))}]}}]});
 }).generator();
 return {review:count=>review(gen,count)};
}
test('Gemini full review flattens nested array counts and records the actual wire schema',async()=>{
 const shared=JSON.stringify([editorialCoverageJson(12),acceptanceResultsJson]);let sent;
 const result=await generator(receipt(),schema=>{
  sent=schema;
  for(const [name,outer,inner] of [['coverage',32,12],['acceptanceResults',20,80]]){
   const list=schema.properties[name],pages=list.items.properties.pages;
   assert.equal(list.maxItems,undefined);assert.match(list.description,new RegExp(`At most ${outer} items`));assert.equal(pages.maxItems,undefined);
   assert.match(pages.description,new RegExp(`At most ${inner} items`));
  }
  assert.equal(schema.properties.coverage.minItems,undefined);assert.match(schema.properties.coverage.description,/At least 1 items/);
  assert.deepEqual(schema.properties.coverage.items.properties.pages.items,{type:'integer',description:'Minimum value: 1. Maximum value: 12.'});
  assert.equal(schema.properties.issues.maxItems,undefined);assert.match(schema.properties.issues.description,/At most 13 items/);
 }).review();
 assert.equal(result.value.coverage.length,1);assert.deepEqual(result.promptRecord.schema,sent);
 assert.equal(JSON.stringify([editorialCoverageJson(12),acceptanceResultsJson]),shared);
});
for(const model of ['gemini-3.8-flash','gemini-4-argon'])test(`${model}: 41-scene issue grammar stays compact and the 42-issue local limit remains strict`,async()=>{
 const answer=receipt();
 const inspect=schema=>{assert.equal(schema.properties.issues.maxItems,undefined);assert.match(schema.properties.issues.description,/At most 42 items/);};
 assert.equal((await generator(answer,inspect,model).review(41)).value.issues.length,0);
 answer.issues=Array(43).fill({page:2,category:'caption',problem:'配文缺少回应。',instruction:'保留未接赠物的回应。',requiresReplan:false});
 await assert.rejects(generator(answer,inspect,model).review(41),error=>error.name==='ZodError'&&error.issues.some(issue=>issue.code==='too_big'&&issue.path[0]==='issues'));
});
test('Gemini review still validates coverage counts, page references, source quotes and acceptance evidence locally',async()=>{
 const cases=[
  value=>{value.coverage=Array(33).fill(coverage);},
  value=>{value.coverage[0].pages=Array.from({length:81},(_,i)=>i+1);},
  value=>{value.coverage[0].pages=[13];},
  value=>{value.coverage[0].pages=[2,2];},
  value=>{value.coverage[0].quote='乙欣然接受了礼物';},
  value=>{value.acceptanceResults[0].pages=Array(81).fill(2);},
  value=>{value.acceptanceResults=Array(21).fill(value.acceptanceResults[0]);},
  value=>{value.acceptanceResults[0].status='failed';},
  value=>{value.acceptanceResults=[];},
 ];
 for(const change of cases){
  const answer=receipt();change(answer);
  await assert.rejects(generator(answer).review());
 }
 const longQuote=receipt();longQuote.coverage[0].quote='甲'.repeat(121);
 assert.equal(reviewReportSchema(12,undefined,acceptancePrompt).safeParse(longQuote).success,false);
 await assert.rejects(generator(longQuote).review());
});
