// Verify subscription routing, native image validation and subprocess isolation without live inference.
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm,access,readdir,cp,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCodexRunner,CodexError,codexEnvironment} from '../server/codex-runner.ts';
import {createReaderProvider,safeCodexError} from '../server/generation.ts';
import {createApplication} from '../server/app.ts';
import {planSchema,selectionSchema} from '../lib/reader-model.ts';

const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const selection=selectionSchema.parse({bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'放下执念',length:8,voice:false});
const plan={title:'庄周梦蝶',hook:'梦醒之后',sourceReference:'《庄子·齐物论》庄周梦蝶',adaptationNote:'现代改编',reflection:'谁在梦中？',characters:'An adult Chinese philosopher in a plain linen robe in ancient China.',pages:Array.from({length:8},()=>({caption:'庄周梦见自己成为一只蝴蝶，自由自在地飞来飞去。',prompt:'An adult philosopher dreams of becoming a butterfly in an ancient garden.'}))};
function assets(){const values=new Map();return {values,async get(key){const item=values.get(key);return item?{body:item.bytes,contentType:item.contentType,async arrayBuffer(){return item.bytes.slice().buffer;}}:null;},async put(key,value,{contentType}){values.set(key,{bytes:new Uint8Array(value),contentType});}};}
async function fakeCli(t,mode='text'){
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu fake codex '));t.after(()=>rm(root,{recursive:true,force:true}));
 const binary=path.join(root,'codex fake.mjs'),capture=path.join(root,'capture.jsonl');
 const script=`#!${process.execPath}
import {createInterface} from 'node:readline';import fs from 'node:fs';
const mode=${JSON.stringify(mode)},capture=${JSON.stringify(capture)};
function log(data){fs.appendFileSync(capture,JSON.stringify(data)+'\\n');}function send(data){process.stdout.write(JSON.stringify(data)+'\\n');}
log({args:process.argv.slice(2),cwd:process.cwd(),pid:process.pid,credentials:{OPENAI_API_KEY:!!process.env.OPENAI_API_KEY,CODEX_API_KEY:!!process.env.CODEX_API_KEY,GEMINI_API_KEY:!!process.env.GEMINI_API_KEY,CODEX_ACCESS_TOKEN:!!process.env.CODEX_ACCESS_TOKEN},home:process.env.CODEX_HOME});
for await(const line of createInterface({input:process.stdin})){
 const m=JSON.parse(line);log(m);if(!m.id)continue;
 let result={};
 if(m.method==='account/read')result={account:mode==='signed-out'?null:{type:mode==='api-key'?'apiKey':'chatgpt'}};
 if(m.method==='config/read')result={config:{...(mode==='configured-model'?{model:'configured-text-model'}:{}),features:Object.fromEntries(process.argv.flatMap((arg,i)=>arg==='--disable'?[[process.argv[i+1],false]]:[])),mcp_servers:{'inherited-private-server':{enabled:true}}}};
 if(m.method==='thread/start')result={thread:{id:'fake-thread'},model:'test-codex-model',modelProvider:'openai'};
 if(m.method==='mcpServerStatus/list')result={data:mode==='unsafe'?[{tools:{read_secret:{}}}]:[{name:'inherited-private-server',tools:{}}],nextCursor:null};
 send({id:m.id,result});
 if(m.method==='turn/start'){
  if(mode==='hang')continue;
  if(mode==='large'){process.stdout.write('x'.repeat(33*1024*1024));continue;}
  if(mode==='exit'){process.exit(3);}
  if(mode==='tool'){send({method:'item/started',params:{threadId:'fake-thread',item:{type:'commandExecution'}}});continue;}
  const item=mode==='image'||mode==='path-only'?{type:'imageGeneration',status:'completed',failure:null,savedPath:'/private/secret.png',...(mode==='image'?{result:${JSON.stringify(Buffer.from(png).toString('base64'))}}:{})}:{type:'agentMessage',text:'{"ok":true}'};
  send({method:'item/completed',params:{threadId:'fake-thread',item}});send({method:'turn/completed',params:{threadId:'fake-thread',turn:{id:'fake-turn',status:'completed'}}});
 }
}
`;
 await writeFile(binary,script);await chmod(binary,0o700);
 return {binary,capture,async log(){return (await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);}};
}
test('runner uses ChatGPT auth, isolated stdin jobs, effective tool restrictions and dynamically disabled MCP',async t=>{
 const fake=await fakeCli(t),runner=createCodexRunner({CODEX_BIN:fake.binary,SHIQU_CODEX_HOME:os.tmpdir()},{environment:{PATH:process.env.PATH,HOME:os.homedir(),OPENAI_API_KEY:'must-not-inherit',CODEX_API_KEY:'must-not-inherit',GEMINI_API_KEY:'must-not-inherit',CODEX_ACCESS_TOKEN:'must-not-inherit'}});
 assert.equal((await runner.status()).configured,true);
 const result=await runner.run({instructions:'Return JSON only',prompt:'private story; $(do-not-execute)',schema:{type:'object'}});assert.equal(result.text,'{"ok":true}');assert.equal(result.model,'test-codex-model');
 const logs=await fake.log(),processes=logs.filter(item=>item.args);
 for(const process of processes){assert.ok(process.args.includes('shell_tool'));assert.ok(process.args.includes('view_image'));assert.ok(process.args.includes('plugins'));assert.ok(process.args.includes('code_mode'));assert.ok(process.args.includes('features.code_mode_host=true'));assert.ok(!process.args.some(arg=>arg.includes('private story')));assert.deepEqual(Object.values(process.credentials),[false,false,false,false]);await assert.rejects(access(process.cwd));}
 const start=logs.find(item=>item.method==='thread/start');assert.equal(start.params.config.mcp_servers['inherited-private-server'].enabled,false);assert.equal(start.params.config.forced_login_method,'chatgpt');assert.equal(start.params.approvalPolicy,'never');assert.equal(start.params.ephemeral,true);
 assert.equal(logs.find(item=>item.method==='turn/start').params.input[0].text,'private story; $(do-not-execute)');
});
test('signed-out and API-key Codex logins never start inference or fall back to an API key',async t=>{
 for(const mode of ['signed-out','api-key']){
  const fake=await fakeCli(t,mode),runner=createCodexRunner({CODEX_BIN:fake.binary});assert.deepEqual(await runner.status(),{configured:false,reason:'CHATGPT_LOGIN_REQUIRED'});
  await assert.rejects(runner.run({instructions:'test',prompt:'test'}),error=>error.message==='CHATGPT_LOGIN_REQUIRED');assert.ok(!(await fake.log()).some(row=>row.method==='turn/start'));
 }
 const missing=createCodexRunner({CODEX_BIN:'/missing/codex'});assert.equal((await missing.status()).reason,'CLI_UNAVAILABLE');
});

test('status exposes the configured text model for cache identity without starting inference',async t=>{
 const fake=await fakeCli(t,'configured-model'),runner=createCodexRunner({CODEX_BIN:fake.binary});
 assert.equal((await runner.status()).model,'configured-text-model');
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'codex'},assets(),fetch,runner);
 assert.equal((await provider.status()).models.text,'configured-text-model');
 assert.ok(!(await fake.log()).some(row=>row.method==='turn/start'));
 const explicit=createCodexRunner({CODEX_BIN:fake.binary,CODEX_MODEL:'explicit-text-model'});
 assert.equal((await explicit.status()).model,'explicit-text-model');
});

test('the runner honors longer index deadlines while an explicit shorter test limit still wins',async t=>{
 const fake=await fakeCli(t),original=setTimeout,delays=[];
 globalThis.setTimeout=(callback,delay,...args)=>{delays.push(delay);return original(callback,delay,...args);};
 try{
  await createCodexRunner({CODEX_BIN:fake.binary}).run({instructions:'JSON',prompt:'index fixture',timeoutMs:180000});
  assert.ok(delays.includes(180000));delays.length=0;
  await createCodexRunner({CODEX_BIN:fake.binary},{timeoutMs:2000}).run({instructions:'JSON',prompt:'index fixture',timeoutMs:180000});
  assert.ok(delays.includes(2000));assert.ok(!delays.includes(180000));
 }finally{globalThis.setTimeout=original;}
});
test('runner rejects unsafe tools, oversized output, process failure, missing image bytes and timeout, then removes jobs',async t=>{
 for(const [mode,code] of [['unsafe','UNSAFE_CONFIGURATION'],['tool','UNEXPECTED_TOOL'],['large','OUTPUT_LIMIT'],['exit','PROCESS_EXIT'],['path-only','IMAGE_UNAVAILABLE'],['hang','TIMEOUT']]){
  const fake=await fakeCli(t,mode),runner=createCodexRunner({CODEX_BIN:fake.binary},{timeoutMs:mode==='hang'?2000:5000});
  await assert.rejects(runner.run({instructions:'test',prompt:'test',generateImage:true}),error=>error.message===code,mode);
  const spawned=(await fake.log()).find(row=>row.cwd);await assert.rejects(access(spawned.cwd));
 }
});
test('runner accepts native image bytes and attaches the first scene without reading returned paths',async t=>{
 const fake=await fakeCli(t,'image'),runner=createCodexRunner({CODEX_BIN:fake.binary});
 const result=await runner.run({instructions:'image only',prompt:'scene',image:{bytes:png,contentType:'image/png'},generateImage:true});assert.deepEqual(Buffer.from(result.image,'base64'),Buffer.from(png));
 const turn=(await fake.log()).find(row=>row.method==='turn/start');assert.equal(turn.params.input[1].type,'image');assert.match(turn.params.input[1].url,/^data:image\/png;base64,/);
});
test('provider defaults to Gemini, rejects invalid config and uses Codex for all generation with no Gemini calls',async()=>{
 const store=assets();assert.equal((await createReaderProvider({},store,fetch).status()).provider,'gemini');assert.equal((await createReaderProvider({},store,fetch).status()).configured,false);
 assert.throws(()=>createReaderProvider({SHIQU_AI_PROVIDER:'invalid'},store,fetch),/SHIQU_AI_PROVIDER/);
 const jobs=[];const runner={async status(){return {configured:true};},async run(job){jobs.push(job);return {text:JSON.stringify(job.schema?.properties?.stories?{stories:[{title:'庄周梦蝶',description:'梦醒后的疑问'}],note:''}:plan),image:job.generateImage?Buffer.from(png).toString('base64'):null,model:'actual-codex',requestId:'turn',usage:{totalTokens:10}};}};
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:'codex',GEMINI_API_KEY:'do-not-use'},store,async()=>{assert.fail('No Gemini request');},runner);
 assert.equal((await provider.status()).configured,true);assert.equal((await provider.suggestions(selection,[])).stories.length,1);
 const generator=provider.generator(),generated=await generator.plan(selection,'story');assert.equal(generated.model,'actual-codex');
 await generator.image(generated.value,0,'story','',selection.artStyle,'quiet narration');await generator.image(generated.value,1,'story','/api/reader/media/story/0.png',selection.artStyle,'quiet narration');
 assert.ok(store.values.has('reader/story/1.png'));assert.equal(jobs.at(-1).image.contentType,'image/png');assert.match(jobs.at(-1).prompt,/quiet narration/);assert.match(jobs.at(-1).prompt,/Art direction/);
 await assert.rejects(provider.suggestions({...selection,bookId:'other',customBook:'http://127.0.0.1/private'},[]),error=>error.status===400);
 await assert.rejects(generator.image(plan,1,'story','/api/reader/media/other/not-anchor.png'),/INVALID_ANCHOR/);
 const before=jobs.length;assert.equal((await provider.suggestions(selection,['庄周梦蝶'])).stories.length,0);assert.equal(jobs.length,before+1);
});
test('invalid Codex JSON, wrong page count and non-image results never reach storage or another provider',async()=>{
 for(const mode of ['json','pages','image']){
  const store=assets(),runner={async status(){return {configured:true};},async run(){return {text:mode==='json'?'invalid':JSON.stringify({...plan,pages:plan.pages.slice(0,7)}),image:'dGV4dA==',model:'test',requestId:'test',usage:null};}};
  const provider=createReaderProvider({SHIQU_AI_PROVIDER:'codex'},store,async()=>assert.fail('No fallback'),runner),generator=provider.generator();
  if(mode==='image')await assert.rejects(generator.image(plan,0,'story',''),/INVALID_IMAGE/);else await assert.rejects(generator.plan(selection,'story'));
  assert.equal(store.values.size,0);
 }
 assert.doesNotMatch(safeCodexError(new Error('secret-token-and-prompt')),/secret-token|prompt/);
});
test('REST reports Codex readiness without a Gemini key and routes checkpoints through the selected provider',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu provider rest '));t.after(()=>rm(root,{recursive:true,force:true}));await cp('drizzle',path.join(root,'drizzle'),{recursive:true});await mkdir(path.join(root,'docker'));await cp('docker/seed.sql',path.join(root,'docker/seed.sql'));
 const store=assets();let calls=0;const runner={async status(){return {configured:true};},async run(job){calls++;return {text:JSON.stringify(plan),image:job.generateImage?Buffer.from(png).toString('base64'):null,model:'codex-test',requestId:'turn',usage:null};}};
 const generation=createReaderProvider({SHIQU_AI_PROVIDER:'codex'},store,fetch,runner),app=createApplication({root,dataDirectory:path.join(root,'data'),generation});t.after(()=>app.close());
 const request=(pathname,method='GET',value)=>app.handle(new Request('http://localhost/api/reader/'+pathname,{method,headers:{'Content-Type':'application/json'},body:value?JSON.stringify(value):undefined}));
 const status=await(await request('status')).json();assert.equal(status.provider,'codex');assert.equal(status.configured,true);
 const id=crypto.randomUUID();assert.equal((await request('sessions','POST',{requestId:id,selection})).status,201);
 const result=await request(`sessions/${id}/advance`,'POST',{throughPage:0});assert.equal(result.status,200);const row=await result.json();assert.ok(row.story.sourceText);assert.equal(calls,1);
});

test('pnpm login helper shares the configured home, strips API keys and rejects API-key login flags',async t=>{
 const fake=await fakeCli(t),env={...process.env,CODEX_BIN:fake.binary,SHIQU_CODEX_HOME:os.tmpdir(),OPENAI_API_KEY:'do-not-pass',CODEX_API_KEY:'do-not-pass',GEMINI_API_KEY:'do-not-pass'};
 const status=spawnSync(process.execPath,['scripts/codex-login.mjs','status'],{env,encoding:'utf8'});assert.equal(status.status,0,status.stderr);
 const child=(await fake.log()).find(row=>row.args);assert.deepEqual(child.args,['login','status']);assert.equal(child.home,path.resolve(os.tmpdir()));assert.ok(Object.values(child.credentials).every(value=>value===false));
 const login=spawnSync(process.execPath,['scripts/codex-login.mjs','login','--','--device-auth'],{env,encoding:'utf8'});assert.equal(login.status,0,login.stderr);assert.deepEqual((await fake.log()).filter(row=>row.args).at(-1).args,['login','--device-auth']);
 const rejected=spawnSync(globalThis.process.execPath,['scripts/codex-login.mjs','login','--with-api-key'],{env,encoding:'utf8'});assert.equal(rejected.status,1);assert.match(rejected.stderr,/codex:login/);
});
