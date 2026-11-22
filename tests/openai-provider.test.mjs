// Exercise OpenAI wire contracts, complete shared story stages, reference images and safe failures using fake transport only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createReaderProvider} from '../server/generation.ts';
import {strictOpenAISchema,safeOpenAIError,OpenAIError} from '../server/openai-provider.ts';
import {FileMedia} from '../server/media.ts';
import {dagGenerator} from '../lib/production-dag/calls.ts';
import {makePlan,selection} from './fixtures/production.mjs';
import {encoded,png} from './fixtures/images.mjs';
import {testDesktopProvider,desktopSettings} from '../server/desktop.ts';

const original={title:'《庄子·齐物论》',text:'昔者庄周梦为胡蝶。',url:'https://example.org/original',provider:'local',kind:'passage',retrievedAt:'2026-10-31',localSource:{edition:'a'.repeat(64),sectionId:'chapter',firstUnit:'unit',lastUnit:'unit'}};
const art={artStyle:'ink-wash',reason:'留白适合梦与醒的边界。'};
function completed(value){return Response.json({status:'completed',id:'response-fixture',model:'mock-openai',usage:{input_tokens:12,output_tokens:34},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});}
async function fixture(t,handler){
 const directory=await mkdtemp(path.join(os.tmpdir(),'shiqu openai mock '));t.after(()=>rm(directory,{recursive:true,force:true}));
 const media=new FileMedia(directory),calls=[];
 const transport=async(url,options)=>{assert.match(String(url),/^https:\/\/api.openai.com\/v1\//);assert.equal(options.headers.Authorization,'Bearer test-only-key');assert.equal(options.redirect,'error');calls.push({url:String(url),options});return handler(String(url),options);};
 return {media,calls,provider:createReaderProvider({SHIQU_AI_PROVIDER:'openai',OPENAI_API_KEY:'test-only-key',SHIQU_REASONING_REVIEW:'xhigh'},media,transport)};
}

test('OpenAI covers suggestions, artwork advice, counts and DAG text calls (outline, scenes, review)',async t=>{
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'openai'},{});
 assert.equal(provider.generationTimeoutMs('plan'),300000);assert.equal(provider.generationTimeoutMs('image'),300000);assert.equal(provider.generationTimeoutMs('source'),null);
 const contextualOriginal={...original,chapterContext:{title:'《庄子·齐物论》',text:'完整章节包含梦蝶的起因、经过与醒来后的思考。',source:original.localSource}};
 const f=await fixture(t,(_url,options)=>{
  const body=JSON.parse(options.body),schema=body.text.format.schema,payload=JSON.parse(body.input[0].content),plan=makePlan(payload.exactPageCount||8);
  assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);assert.equal(schema.additionalProperties,false);assert.ok(body.reasoning.effort);assert.ok(options.signal instanceof AbortSignal);
  if(payload.verifiedOriginal&&!schema.properties.artStyle){assert.deepEqual(payload.editorialContext,{mode:'theme',theme:selection.theme});assert.equal(payload.productionPrompt,selection.productionPrompt);assert.deepEqual(payload.verifiedOriginal.chapterContext,contextualOriginal.chapterContext);assert.match(body.instructions,/片段首末不是硬边界/);assert.match(body.instructions,/不能单独证明后续必须纳入/);assert.match(body.instructions,/回应谁刚才的哪句或哪个动作/);assert.doesNotMatch(body.instructions,/同一次会面、连续对话或未完行动的后续应纳入/);}
  if(schema.properties.stories)assert.equal(payload.theme,selection.theme);
  if(schema.properties.stories)return completed({stories:[{title:'庄周梦蝶',description:'梦与醒的边界。',artRecommendation:art,...(payload.localBook?{source:{sectionId:'chapter',firstUnit:'unit',lastUnit:'unit',continuations:[]}}:{})}],note:'',...(schema.properties.scan?{scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}}:{})});
  if(schema.properties.artStyle)return completed(art);
  if(schema.properties.count)return completed({count:8,reason:'保留故事的完整因果。'});
  if(schema.properties.issues){assert.equal(body.reasoning.effort,'xhigh');return completed({issues:[],titleReview:{title:payload.plan.title,reason:'标题准确对应当前故事。'}});}
  if(schema.properties.beats)return completed({title:'庄周梦蝶',summary:'梗概',sourceReference:'庄子',adaptationNote:'按原文',beats:Array.from({length:payload.exactPageCount||8},(_,i)=>'第'+i+'幅的关键动作。')});
  return completed({ok:true});
 });
 assert.equal((await f.provider.status()).provider,'openai');assert.equal(f.calls.length,0);
 assert.equal((await f.provider.suggestions(selection,[])).stories[0].title,'庄周梦蝶');
 const local={title:'庄子',edition:'a'.repeat(64),text:'[unit] 昔者庄周梦为胡蝶。'};
 assert.equal((await f.provider.suggestions(selection,[],local)).stories[0].source.edition,local.edition);
 assert.equal((await f.provider.suggestions(selection,[],{...local,purpose:'scan'})).scan.blockComplete,true);
 assert.deepEqual(await f.provider.recommendArt(selection,original),art);
 const generator=f.provider.generator();assert.equal((await generator.recommend(selection,'test',contextualOriginal)).value.count,8);
 const dag=dagGenerator(generator.textCall),source={original:contextualOriginal,book:'庄子',theme:selection.theme,variationSeed:'s'},settings={narrativeDetail:'balanced',length:8};
 const outline=await dag.outline({source,productionPrompt:selection.productionPrompt,settings});assert.equal(outline.value.beats.length,8);assert.equal(outline.requestId,'response-fixture');
 const generic=await generator.textCall('plan','指令',{},{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},4096);assert.deepEqual(generic.value,{ok:true});
 const review=await generator.textCall('review','指令',{plan:{title:'庄周梦蝶'}},{type:'object',properties:{issues:{type:'array',items:{type:'string'}},titleReview:{type:'object',properties:{title:{type:'string'},reason:{type:'string'}},required:['title','reason'],additionalProperties:false}},required:['issues','titleReview'],additionalProperties:false},4096);assert.deepEqual(review.value.issues,[]);
});
test('image generation saves validated bytes and later frames send the saved anchor as multipart edits',async t=>{
 const f=await fixture(t,(url,options)=>{
  if(url.endsWith('/generations')){const body=JSON.parse(options.body);assert.equal(body.size,'864x1536');assert.equal(body.output_format,'png');}
  else{assert.ok(url.endsWith('/edits'));assert.ok(options.body instanceof FormData);assert.equal(options.headers['Content-Type'],undefined);assert.equal(options.body.get('image[]').type,'image/png');assert.equal(options.body.get('size'),'864x1536');}
  return Response.json({data:[{b64_json:encoded}],usage:{images:1}},{headers:{'x-request-id':'image-fixture'}});
 });
 const generator=f.provider.generator(),plan=makePlan(8),first=await generator.image(plan,0,'test','');
 const next=await generator.image(plan,1,'test',first.value);assert.ok(next.value.includes('/1.'));assert.equal(next.requestId,'image-fixture');assert.equal(f.calls.length,2);
 const reference=f.calls[1].options.body.get('image[]');assert.deepEqual(new Uint8Array(await reference.arrayBuffer()),png);
 await assert.rejects(generator.image(plan,1,'test','https://untrusted.example/image.png'),/INVALID_ANCHOR/);assert.equal(f.calls.length,2);
});
test('landscape sends the corresponding portrait as a fixed 1536x1024 edit',async t=>{
 const landscape=createCanvas(1536,1024).toBuffer('image/png');
 const f=await fixture(t,async(url,options)=>{
  if(url.endsWith('/generations'))return Response.json({data:[{b64_json:encoded}]});
  assert.ok(url.endsWith('/edits'));
  const form=options.body;
  assert.equal(form.get('size'),'1536x1024');
  assert.match(form.get('prompt'),/3:2 landscape/);
  assert.deepEqual(new Uint8Array(await form.get('image[]').arrayBuffer()),png);
  return Response.json({data:[{b64_json:landscape.toString('base64')}]});
 });
 const generator=f.provider.generator(),plan=makePlan(8),page=2,artifact='a'.repeat(64);
 const {value:reference}=await generator.image(plan,page,'test','');
 const result=await generator.image(plan,page,'test',reference,undefined,'',artifact,'landscape');
 assert.equal(result.promptRecord.reference,reference);
 assert.deepEqual(Buffer.from(await (await f.media.get(`reader/test/artifacts/${page}-${artifact}.png`)).arrayBuffer()),landscape);
 assert.deepEqual(new Uint8Array(await (await f.media.get(`reader/test/${page}.png`)).arrayBuffer()),png);
});
test('refusals, incomplete or malformed outputs and invalid image bytes fail without fallback or remote image fetching',async t=>{
 for(const value of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'private text'}]}]},{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not JSON'}]}]}]){
  const f=await fixture(t,()=>Response.json(value));await assert.rejects(f.provider.suggestions(selection,[]));assert.equal(f.calls.length,1);
 }
 const f=await fixture(t,()=>Response.json({data:[{url:'https://untrusted.example/image.png',b64_json:Buffer.from('not an image').toString('base64')}]}));
 await assert.rejects(f.provider.generator().image(makePlan(8),0,'test',''),/INVALID_IMAGE/);assert.equal(f.calls.length,1);
});
test('API errors never expose response bodies, credentials or prompts',async t=>{
 const output=[],old=console.error;console.error=(...args)=>output.push(args.join(' '));
 try{
  for(const status of [401,403,404,429,500]){
   const f=await fixture(t,()=>Response.json({error:{message:'private provider text test-only-key'}},{status}));let caught;
   try{await f.provider.suggestions(selection,[]);}catch(error){caught=error;}
   assert.ok(caught instanceof OpenAIError);assert.equal(caught.status,status);assert.ok(!safeOpenAIError(caught).includes('test-only-key'));assert.equal(f.calls.length,1);
  }
  for(const failure of [Error('private network text test-only-key'),new DOMException('private timeout text test-only-key','TimeoutError')]){
   const f=await fixture(t,()=>{throw failure;});
   await assert.rejects(f.provider.suggestions(selection,[]),error=>{const safe=safeOpenAIError(error);assert.ok(!safe.includes('test-only-key'));if(error.name==='TimeoutError')assert.match(safe,/超时/);return true;});
   assert.equal(f.calls.length,1);
  }
  assert.ok(!output.join('\n').includes('test-only-key'));assert.ok(!output.join('\n').includes('private provider'));
 }finally{console.error=old;}
});
test('OpenAI metadata-only connection check checks selected models with no generation or key disclosure',async()=>{
 const settings=desktopSettings.parse({dataDirectory:path.join(os.tmpdir(),'library'),provider:'openai'}),calls=[];
 const result=await testDesktopProvider(settings,'test-only-key','/unused',async(url,options)=>{calls.push(String(url));assert.equal(options.headers.Authorization,'Bearer test-only-key');assert.ok(!options.body);return Response.json({id:'mock'});});
 assert.equal(result.ok,true);assert.equal(calls.length,2);assert.ok(calls.every(url=>url.startsWith('https://api.openai.com/v1/models/')));assert.ok(!JSON.stringify(result).includes('test-only-key'));
});
test('strict schemas preserve optional-property nullability instead of requiring invented field values',()=>{
 const schema=strictOpenAISchema({type:'object',properties:{required:{type:'string'},optional:{type:'array',items:{type:'object',properties:{value:{type:'string'}},required:['value']}}},required:['required']});
 assert.deepEqual(schema.required,['required','optional']);assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.optional.anyOf[1].type,'null');assert.equal(schema.properties.optional.anyOf[0].items.additionalProperties,false);
});

test('read-only mode never starts queued work and rejects historical generation even with API environment credentials',async t=>{
 const {createApplication}=await import('../server/app.ts'),{cp,mkdir,writeFile}=await import('node:fs/promises');
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu readonly '));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp('drizzle',path.join(root,'drizzle'),{recursive:true});await mkdir(path.join(root,'docker'));await cp('docker/seed.sql',path.join(root,'docker/seed.sql'));await mkdir(path.join(root,'dist/client'),{recursive:true});await writeFile(path.join(root,'dist/client/index.html'),'<html>readonly</html>');
 const transport=async()=>assert.fail('Read-only must never call an external provider');
 const options={root,dataDirectory:path.join(root,'library'),variables:{SHIQU_AI_PROVIDER:'readonly',OPENAI_API_KEY:'test-only-unused',TEXT_API_KEY:'test-only-unused',TEXT_API_BASE_URL:'https://api.openai.com/v1'},transport};
 let app=createApplication(options);t.after(()=>app.close());
 const id=crypto.randomUUID(),ownerId='docker-local-owner',jobId=crypto.randomUUID();
 await app.services.production.repository.create(id,ownerId,selection);
 await app.services.production.queue.enqueue({id:jobId,sessionId:id,ownerId,kind:'script',pool:'text',version:'saved-before-restart',dependencies:[],payload:{},priority:0});
 await app.close();app=createApplication(options);
 await app.services.production.tick();await app.services.production.queue.settle();
 const saved=await app.services.production.queue.job(jobId);assert.equal(saved.state,'queued');assert.equal(saved.attempts,0);
 assert.equal((await app.services.generation.status()).configured,false);
 await assert.rejects(app.services.generation.suggestions(selection,[]));
 const response=await app.handle(new Request('http://localhost/api/admin/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:'unused',kind:'text',requestId:crypto.randomUUID()})}));assert.equal(response.status,404);
 assert.equal((await app.services.database.prepare('SELECT COUNT(*) AS n FROM production_jobs WHERE attempts>0').first()).n,0);
});
