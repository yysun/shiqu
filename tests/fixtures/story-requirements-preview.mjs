// Disposable reader preview using real UI, REST and SQLite with controlled model responses only.
import {createServer} from 'vite';
import {writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {productionFixture,until,selection} from './production.mjs';
import {createHttpServer} from '../../server/http.ts';
import {developmentServerOptions,protectDevelopmentLibrary} from '../../scripts/development-server.mjs';
const port=Number(process.env.SHIQU_REQUIREMENTS_PREVIEW_PORT||3140),apiPort=port+2;
const f=await productionFixture(),criteria='关键反应落实到画面。\n结语不复述情节。';f.control.hold=false;
f.control.beforeText=async kind=>kind==='review'?{issues:[],acceptanceResults:[{criterion:1,status:'passed',pages:[2],evidence:'第二幅以手部与目光的可见反应承接对白。'},{criterion:2,status:'passed',pages:[0],evidence:'结语提炼认识，没有复述梦醒过程。'}]}:undefined;
const completeId=await f.create(3,{acceptancePrompt:criteria});await until(async()=>(await f.read(completeId)).state==='completed');
await f.json(`sessions/${completeId}/title`,'POST',{title:'验收演示：已完成'});
const historicalId=await f.create(3,{acceptancePrompt:criteria});await until(async()=>(await f.read(historicalId)).state==='completed');
await f.json(`sessions/${historicalId}/title`,'POST',{title:'验收演示：未留存'});
await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.usage',json('[]')) WHERE id=?").bind(historicalId).run();
f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦与醒之间的追问。',artRecommendation:{artStyle:'ink-pencil',reason:'适合动作与反应。'}}],note:''});
const setup=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced',productionPrompt:''}}),setupId=setup.id;await f.startDiscovery(setupId);
await f.demand(setupId);await until(async()=>(await f.read(setupId)).intake.phase==='choosing');
await f.json(`sessions/${setupId}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(setupId)).intake.generation,action:'choose',batch:0,index:0});await until(async()=>(await f.read(setupId)).intake.phase==='confirming');
const pausedId=await f.create(3,{acceptancePrompt:criteria});await f.json(`sessions/${pausedId}/production-control`,'POST',{action:'pause'});
const server=createHttpServer(request=>f.app.handle(request));await new Promise(resolve=>server.listen(apiPort,'127.0.0.1',resolve));
const options=developmentServerOptions({port,apiPort,library:f.dataDirectory});options.host='127.0.0.1';
const frontend=await createServer({envFile:false,cacheDir:path.join(f.root,'vite-cache'),plugins:[protectDevelopmentLibrary(f.dataDirectory)],server:options});await frontend.listen();
await writeFile(process.env.SHIQU_REQUIREMENTS_PREVIEW_METADATA||'/tmp/shiqu-requirements-preview.json',JSON.stringify({dataDirectory:f.dataDirectory,completeId,historicalId,setupId,pausedId,url:`http://127.0.0.1:${port}/`}));
console.log(`Controlled requirements preview: http://127.0.0.1:${port}/`);
let stopping=false;async function stop(){if(stopping)return;stopping=true;await frontend.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await f.stop();await rm(f.root,{recursive:true,force:true});}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop().then(()=>process.exit(0)));
