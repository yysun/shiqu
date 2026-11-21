// Resolve development mode before opening any shelf; local must ignore shared data directory settings.
// 后端未监听时，代理路径先等待后端，超时返回 503 说明；后端可连后放行，代理连接被拒后重新探测。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,access,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {developmentArguments,backendStartupGate,backendStartingMessage,developmentServerOptions} from '../scripts/development-server.mjs';
test('local mode selects only the checkout development shelf and preserves ordinary dev defaults',()=>{
 const cwd=path.resolve('checkout');
 assert.deepEqual(developmentArguments(['local','--port','4000'],{SHIQU_DATA_DIR:'/private/shared',SHIQU_API_PORT:'4002'},cwd),{local:true,port:4000,apiPort:4002,library:path.join(cwd,'.data/dev-local')});
 assert.deepEqual(developmentArguments([],{SHIQU_DATA_DIR:'/private/shared'},cwd),{local:false,port:3000,apiPort:3002});
 for(const args of [['typo'],['--port'],['local','--port','0'],['local','--port','NaN'],['local','--port','3002']])assert.throws(()=>developmentArguments(args,{},cwd));
});
test('setup leaves provider configuration in the shared store and preserves an existing standalone env file',async t=>{
 const cwd=await mkdtemp(path.join(os.tmpdir(),'shiqu-setup-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const setup=fileURLToPath(new URL('../scripts/setup.mjs',import.meta.url));
 const run=()=>spawnSync(process.execPath,[setup],{cwd,encoding:'utf8'});
 const first=run();assert.equal(first.status,0,first.stderr);await assert.rejects(access(path.join(cwd,'.env')));
 const content='PORT=3100\n';await writeFile(path.join(cwd,'.env'),content);
 const second=run();assert.equal(second.status,0,second.stderr);assert.equal(await readFile(path.join(cwd,'.env'),'utf8'),content);
});

function gateHarness(options){
 let middleware,clock=0;
 const gate=backendStartupGate({apiPort:3002,now:()=>clock,sleep:async ms=>{clock+=ms;},...options});
 gate.plugin.configureServer({middlewares:{use:handler=>{middleware=handler;}}});
 async function send(url){
  const response={headers:{},statusCode:200,body:null,setHeader(name,value){this.headers[name]=value;},end(body){this.body=body;}};
  let passed=false;await middleware({url},response,()=>{passed=true;});
  return {passed,response,waited:clock};
 }
 return {gate,send,reset:()=>{clock=0;}};
}

test('proxy paths wait for a starting backend and answer 503 only after the hold expires',async()=>{
 let listening=false,probes=0;
 const {gate,send,reset}=gateHarness({holdMs:3000,intervalMs:500,probe:async port=>{assert.equal(port,3002);probes++;return listening;}});
 assert.equal((await send('/src/main.tsx')).passed,true);assert.equal(probes,0,'非代理路径不探测后端');
 for(const url of ['/api/local/provider-settings','/art/x.png','/desktop/session']){
  reset();const {passed,response,waited}=await send(url);
  assert.equal(passed,false);assert.equal(waited,3000,'等满保留时间才返回');assert.equal(response.statusCode,503);assert.equal(response.headers['Retry-After'],'2');
  assert.deepEqual(JSON.parse(response.body),{error:backendStartingMessage});
 }
 listening=true;assert.equal((await send('/api/reader/sessions')).passed,true);
 const before=probes;assert.equal((await send('/api/reader/sessions')).passed,true);assert.equal(probes,before,'确认可连后不再探测');
 // 后端重启导致代理连接被拒后，恢复探测。
 const listeners=[];gate.configureProxy({on:(event,listener)=>{assert.equal(event,'error');listeners.push(listener);}});
 listeners[0](Object.assign(Error('refused'),{code:'ECONNREFUSED'}));listening=false;
 reset();assert.equal((await send('/api/reader/sessions')).response.statusCode,503);
 const options=developmentServerOptions({port:3000,apiPort:3002,library:'/tmp/shelf',configureProxy:gate.configureProxy});
 assert.deepEqual(Object.keys(options.proxy),['/art','/api','/desktop']);
 for(const entry of Object.values(options.proxy)){assert.equal(entry.target,'http://127.0.0.1:3002');assert.equal(entry.configure,gate.configureProxy);}
});

test('a held request passes through as soon as the backend starts listening',async()=>{
 let probes=0;
 const {send}=gateHarness({holdMs:30000,intervalMs:500,probe:async()=>++probes>=4});
 const {passed,waited}=await send('/api/reader/sessions');
 assert.equal(passed,true);assert.equal(waited,1500,'第四次探测成功即放行');
});
