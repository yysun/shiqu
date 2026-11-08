// Run the production app behind the real development proxy with controlled inference and retained SQLite.
// UI tests mutate only through browser controls; helpers expose read-only state and model completion gates.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {createHttpServer} from '../../server/http.ts';
import {developmentAccess} from '../../server/development-access.ts';
import {developmentServerOptions,protectDevelopmentLibrary} from '../../scripts/development-server.mjs';
import {withLocalBooks} from '../../server/local-generation.ts';
import {productionFixture,until} from './production.mjs';
import {libraryFixture} from './story-library.mjs';
export const runId=process.env.SHIQU_E2E_RUN_ID||new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
export const runDirectory=path.resolve('.data/e2e',runId);
async function reservePort(){const server=createHttpServer(async()=>new Response('reserved'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
// contextOptions 供不同视口覆盖浏览器上下文设置。默认 767×1000：手机界面中最宽的一档，与重设计前桌面窗口里
// 的手机卡片最接近；这些流程用例验证手机面板流程，桌面布局由 desktop-responsive-layout E2E 覆盖。
export async function storyBrowser(t,caseId,contextOptions={}){
 const directory=path.join(runDirectory,caseId);await mkdir(directory,{recursive:true});
 const f=await productionFixture(undefined,'codex',{}, {parentDirectory:directory,retain:true}),library=libraryFixture();
 let api,vite,browser,capture;
 t.after(async()=>{try{await capture?.();}finally{await browser?.close();await vite?.close();if(api)await new Promise(resolve=>{api.closeAllConnections();api.close(resolve);});await f.stop();}});
 f.control.autoLength=3;f.control.hold=false;
 f.control.beforeText=async(kind,payload)=>{
  if(kind==='recommend')return {storySummary:library.stories.find(story=>payload.verifiedOriginal.text.includes(library.book.sections[0].units.find(unit=>unit.id===story.source.firstUnit).text))?.summary||library.stories[0].summary,storyMatchReason:'原文中的完整行动和结果支持本次故事。'};
  if(kind==='review')return {issues:[],...(payload.acceptancePrompt?{acceptanceResults:payload.acceptancePrompt.split('\n').filter(line=>line.trim()).map((_,i)=>({criterion:i+1,status:'passed',pages:[1],evidence:'受控回执：第一幅包含该动作。'}))}:{})};
 };
 f.generation.suggestions=async(...args)=>{
  const result=await library.provider.suggestions(...args),target=args[2].scan?.targetStoryTitle;
  return target?{...result,stories:library.stories.filter(story=>story.title===target&&args[2].text.includes('['+story.source.firstUnit+']')).map(({summary,...story})=>{void summary;return story;}),scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}}:result;
 };
 f.generation.matchStories=library.provider.matchStories;
 f.options.generation=withLocalBooks(f.generation,library.books,f.media);await f.restart();f.app.services.localBooks=library.books;
 const port=await reservePort();api=createHttpServer(developmentAccess(request=>f.app.handle(request),{SHIQU_DEV_FRONTEND_PORT:String(port)},0));
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 // 关闭开发文件监听，避免共享工作区的改动打断正在验证的浏览器交互。
 vite=await createServer({envFile:false,cacheDir:path.join(f.root,'vite-cache'),logLevel:'error',plugins:[protectDevelopmentLibrary(f.dataDirectory)],server:{...developmentServerOptions({port,apiPort:api.address().port,library:f.dataDirectory}),watch:null}});
 await vite.listen();browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:767,height:1000},...contextOptions});await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 await context.addInitScript(()=>localStorage.setItem('shiqu-last-tab','shelf'));
 const page=await context.newPage(),url=`http://127.0.0.1:${port}`,errors=[],transitions=[],commands=[];let result='PASS',failure,closed=false;
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',async response=>{
  if(response.request().method()==='GET'||!response.url().includes('/api/reader/'))return;
  try{commands.push({path:new URL(response.url()).pathname,method:response.request().method(),body:response.request().postDataJSON(),status:response.status()});}catch{}
 });
 const seen=new Map();let reading=false;
 async function sample(){if(reading||closed)return;reading=true;try{
  const {results}=await f.app.services.database.prepare('SELECT id,state,generation_control,document FROM stories').all();
  for(const row of results){const doc=JSON.parse(row.document),value={id:row.id,state:row.state,control:row.generation_control,intake:doc.intake?.phase,search:doc.intake?.search.state,review:doc.visualReview?.status,reviewPhase:doc.visualReview?.phase,ready:doc.images?.filter(Boolean).length||0,planned:doc.plan?.pages.length||doc.draft?.pages?.length||0};const key=JSON.stringify(value);if(seen.get(row.id)!==key){seen.set(row.id,key);transitions.push({at:new Date().toISOString(),...value});}}
 }finally{reading=false;}}
 const timer=setInterval(()=>void sample(),30);
 capture=async()=>{await sample();closed=true;clearInterval(timer);await page.screenshot({path:path.join(directory,'final.png'),fullPage:true}).catch(()=>{});await context.tracing.stop({path:path.join(directory,'trace.zip')});
  await writeFile(path.join(directory,'result.json'),JSON.stringify({caseId,result,failure,build:process.env.SHIQU_E2E_BUILD_ID||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()+'+development',database:path.join(f.dataDirectory,'shiqu.sqlite'),url,errors,commands,transitions,calls:{catalog:library.calls.catalog.length,plans:f.control.plans.length,images:f.control.calls.length,reviews:f.control.reviews.length}},null,2));
 };
 async function execute(body){try{await body();assert.deepEqual(errors,[],'No uncaught browser errors');}catch(error){result='FAIL';failure=error.stack;throw error;}}
 async function screenshot(name){await page.screenshot({path:path.join(directory,name+'.png'),fullPage:true});}
 async function create({title,theme,prepare=true}={}){
  await page.goto(url);await page.getByRole('button',{name:'新建故事',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'这一篇，想怎样读？'});
  await sheet.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'庄子',exact:true}).click();
  if(theme){await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其他',exact:true}).click();await sheet.getByLabel('写下想看的主题').fill(theme);}
  if(title){await sheet.getByRole('button',{name:'输入标题',exact:true}).click();await sheet.getByLabel('故事标题',{exact:true}).fill(title);}
  const creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reader/sessions'&&response.request().method()==='POST');
  await sheet.getByRole('button',{name:title?'按标题提取':'开始提取',exact:true}).click();const created=await creation;
  assert.equal(created.status(),201);const saved=await created.json();
  assert.equal(saved.intake.search.state,'searching');
  await page.getByRole('dialog',{name:'故事设置',exact:true}).getByRole('region',{name:'选择故事',exact:true}).waitFor();
  if(!prepare)return saved;
  return extract(saved,title);
 }
 async function extract(saved,title){
  const picker=page.getByRole('dialog',{name:'故事设置',exact:true});
  await picker.getByRole('button',{name:'选择 '+(title||'乌龟报恩'),exact:true}).click();
  await until(async()=>(await f.read(saved.id)).intake.phase==='confirming',15000);await page.getByRole('link',{name:'开始制作',exact:true}).waitFor();return f.read(saved.id);
 }
 async function confirm(){await page.getByRole('link',{name:'开始制作',exact:true}).click();}
 async function completed(id){await until(async()=>(await f.read(id)).state==='completed',20000);}
 async function reader(id){await page.goto(url+'/?id='+id);await page.getByRole('button',{name:'故事设置',exact:true}).waitFor();}
 async function workflow(){return settings();}
 async function settings(){await page.getByRole('button',{name:'故事设置',exact:true}).click();return page.getByRole('dialog',{name:'故事设置',exact:true});}
 return {f,library,page,context,url,directory,execute,screenshot,create,extract,confirm,completed,reader,settings,workflow,commands,transitions};
}
