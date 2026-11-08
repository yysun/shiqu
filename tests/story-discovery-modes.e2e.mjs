// 验证八种提取条件组合、已保存任务的条件修改与替换选题。
// Browser/data are disposable; inference is controlled and no production shelf or credentials are loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {createHttpServer} from '../server/http.ts';
import {withLocalBooks} from '../server/local-generation.ts';
import {LocalBooks} from '../server/local-books.ts';
import {libraryFixture} from './fixtures/story-library.mjs';
import {productionFixture,until} from './fixtures/production.mjs';

const evidenceDirectory=process.env.SHIQU_E2E_RUN_ID?path.resolve('.data/e2e',process.env.SHIQU_E2E_RUN_ID,'optional-conditions'):'/tmp/shiqu-editable-title';

test('title, theme and original scope are independently optional in the creation UI', {timeout:120000},async t=>{
 const f=await productionFixture(t),library=libraryFixture();
 f.generation.suggestions=async(selection,excluded,input)=>{
  const result=await library.provider.suggestions(selection,excluded,input);
  if(input.scan?.targetStoryTitle)return {...result,stories:library.stories.filter(story=>story.title===input.scan.targetStoryTitle&&input.text.includes('['+story.source.firstUnit+']')),scan:{blockComplete:true,pendingEvents:[],resolvedEventIds:[]}};
  return result;
 };
 f.generation.matchStories=library.provider.matchStories;
 f.options.generation=withLocalBooks(f.generation,library.books,f.media);await f.restart();f.app.services.localBooks=library.books;
 const api=createHttpServer(request=>f.app.handle(request));await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{api.closeAllConnections();api.close(resolve);}));
 const target=`http://127.0.0.1:${api.address().port}`;
 // Vite treats port 0 as its default port; reserve an ephemeral port to coexist with other suites.
 const reservation=createHttpServer(async()=>new Response('reserved'));
 await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const uiPort=reservation.address().port;
 await new Promise(resolve=>reservation.close(resolve));
 const vite=await createServer({envFile:false,cacheDir:path.join(f.root,'vite-cache'),logLevel:'error',server:{host:'127.0.0.1',port:uiPort,strictPort:true,watch:null,proxy:{'/api':{target},'/art':{target}}}});
 await vite.listen();t.after(()=>vite.close());
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 // 验证手机新建面板；桌面新建页由 desktop-responsive-layout E2E 覆盖
 const context=await browser.newContext({viewport:{width:767,height:900}}),page=await context.newPage();
 await context.addInitScript(()=>{if(location.origin!=='null')localStorage.setItem('shiqu-last-tab','shelf');});
 const url=`http://127.0.0.1:${vite.httpServer.address().port}`;
 async function open(){
  await page.goto(url);
  await page.getByRole('button',{name:'新建故事',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'这一篇，想怎样读？'});
  await sheet.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'庄子',exact:true}).click();
  return sheet;
 }
 for(let flags=0;flags<8;flags++){
  const title=!!(flags&1),theme=!!(flags&2),scope=!!(flags&4),sheet=await open();
  assert.equal(await sheet.getByLabel('故事标题',{exact:true}).count(),0);
  assert.equal(await sheet.getByRole('group',{name:'原文范围'}).getByRole('button',{name:'全书',exact:true}).count(),1);
  const scopePosition=await sheet.getByRole('group',{name:'原文范围'}).boundingBox(),themePosition=await sheet.getByRole('group',{name:'故事主题'}).boundingBox();
  assert.ok(scopePosition.y<themePosition.y,'Original scope should appear before theme');
  if(theme){await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其他',exact:true}).click();await sheet.getByLabel('写下想看的主题').fill('知恩图报');}
  if(scope){
   await sheet.getByRole('group',{name:'原文范围'}).getByRole('button',{name:'选择章节'}).click();await sheet.getByRole('checkbox',{name:'第一章',exact:true}).check();
   await sheet.getByLabel('关键词筛选').fill('不存在的章节');
   await sheet.getByText('没有匹配的章节。',{exact:false}).waitFor();
   await sheet.getByLabel('关键词筛选').fill('');
   assert.equal(await sheet.getByRole('checkbox',{name:'第一章',exact:true}).isChecked(),true);
  }
  const submit=sheet.getByRole('button',{name:title?'按标题提取':'开始提取',exact:true});
  if(title){
   await sheet.getByRole('button',{name:'输入标题',exact:true}).click();
   assert.equal(await submit.isDisabled(),true);
   await sheet.getByLabel('故事标题',{exact:true}).fill('乌龟报恩');
  }
  const gap=await submit.evaluate(button=>button.getBoundingClientRect().top-button.previousElementSibling.getBoundingClientRect().bottom);
  assert.ok(gap>=23.5,`discovery button gap: ${gap}`);
  if(flags===0){
   await mkdir(evidenceDirectory,{recursive:true});
   await submit.scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(evidenceDirectory,'source-button-gap.png')});
   assert.equal(library.calls.catalog.length,0);
  }
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reader/sessions'&&response.request().method()==='POST');
  await submit.click();
  const created=await response;assert.equal(created.status(),201);
  const payload=created.request().postDataJSON().selection,saved=await created.json();
  assert.deepEqual(payload.discovery,title?{mode:'title',title:'乌龟报恩'}:{mode:'auto'});
  assert.equal(payload.theme,theme?'知恩图报':'原典故事');
  assert.equal(payload.discoverySources?.length,scope?1:undefined);
  assert.deepEqual(saved.selection.discovery,payload.discovery);assert.equal(saved.selection.theme,payload.theme);
  assert.equal(saved.selection.source,undefined);
  assert.equal(saved.intake.search.state,'searching');assert.deepEqual(saved.intake.batches,[]);
  const extraction=page.getByRole('dialog',{name:'故事设置',exact:true});
  const context=extraction.getByRole('region',{name:'提取条件'});
  await context.waitFor();
  if(scope){
   await context.getByText('查看已选原文',{exact:true}).click();
   await context.getByText('第一章',{exact:true}).waitFor();
  }else assert.ok((await context.textContent()).includes('全书'));
  assert.ok((await context.textContent()).includes(theme?'知恩图报':'不限定主题'));
  assert.ok((await context.textContent()).includes(title?'指定标题：乌龟报恩':'自动标题'));
  const candidates=extraction.getByRole('list',{name:'候选故事',exact:true});
  await candidates.getByRole('button',{name:'选择 乌龟报恩',exact:true}).waitFor();
  assert.ok((await context.boundingBox()).y<(await candidates.boundingBox()).y,'Extraction conditions precede candidates');
  if(flags>=6){
   await page.setViewportSize({width:390,height:844});
   await context.scrollIntoViewIfNeeded();
   assert.equal(await extraction.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
   await page.screenshot({path:path.join(evidenceDirectory,title?'extraction-mobile.png':'extraction-auto-mobile.png')});
   await page.setViewportSize({width:767,height:900});
  }
 }
 // Selecting a book is a preference immediately, even when creation is cancelled before submission.
 let preference=await open();
 await preference.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'水浒传',exact:true}).click();
 await preference.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'新建故事',exact:true}).click();
 preference=page.getByRole('dialog',{name:'这一篇，想怎样读？'});
 assert.equal(await preference.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'水浒传',exact:true}).getAttribute('aria-pressed'),'true');
 await preference.getByRole('button',{name:'关闭',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'新建故事',exact:true}).click();
 preference=page.getByRole('dialog',{name:'这一篇，想怎样读？'});
 assert.equal(await preference.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'水浒传',exact:true}).getAttribute('aria-pressed'),'true');
 await preference.getByRole('button',{name:'关闭',exact:true}).click();
 // 切换关键词时保留已勾选的章节，按标题提取时也保留这些范围。
 const real=new LocalBooks(process.cwd());library.books.book=selection=>real.book(selection);
 let sheet=await open();
 await sheet.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'聊斋志异',exact:true}).click();
 await sheet.getByRole('group',{name:'原文范围'}).getByRole('button',{name:'选择章节'}).click();
 await sheet.getByLabel('关键词筛选').fill('种梨');
 await sheet.getByRole('checkbox',{name:'第一卷',exact:true}).check();
 await sheet.getByLabel('关键词筛选').fill('第二卷');
 await sheet.getByRole('checkbox',{name:'第二卷',exact:true}).check();
 await sheet.getByLabel('关键词筛选').fill('种梨');
 assert.equal(await sheet.getByRole('checkbox',{name:'第一卷',exact:true}).isChecked(),true);
 await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'欲望与代价',exact:true}).click();
 await sheet.getByRole('button',{name:'输入标题',exact:true}).click();
 await sheet.getByLabel('故事标题',{exact:true}).fill('种梨');
 const request=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reader/sessions'&&response.request().method()==='POST');
 await sheet.getByRole('button',{name:'按标题提取',exact:true}).click();
 const submitted=await request;assert.equal(submitted.status(),201);const selected=submitted.request().postDataJSON().selection;
 assert.deepEqual(selected.discovery,{mode:'title',title:'种梨'});assert.equal(selected.theme,'欲望与代价');assert.equal(selected.discoverySources.length,2);assert.equal(selected.source,undefined);
 const created=await submitted.json(),extraction=page.getByRole('dialog',{name:'故事设置',exact:true});
 const selectedContext=extraction.getByRole('region',{name:'提取条件'});
 await selectedContext.getByText('查看已选原文',{exact:true}).click();
 for(const title of ['第一卷','第二卷'])await selectedContext.getByText(title,{exact:true}).waitFor();
 assert.deepEqual(created.selection.discoverySources,selected.discoverySources);
 assert.equal(created.intake.search.state,'searching');
 sheet=await open();await sheet.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'其他',exact:true}).click();
 assert.equal(await sheet.getByLabel('故事标题',{exact:true}).count(),0);
 assert.equal(f.control.calls.length,0);assert.equal(f.control.plans.length,0);
 // The actual three selected Water Margin chapters are listed, rather than just a range count.
 sheet=await open();
 await sheet.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'水浒传',exact:true}).click();
 await sheet.getByRole('group',{name:'原文范围'}).getByRole('button',{name:'选择章节'}).click();
 await sheet.getByLabel('关键词筛选').fill('高太尉');
 for(const chapter of ['第七十八回','第七十九回','第八十回'])await sheet.getByRole('checkbox',{name:new RegExp('^'+chapter+' ')}).check();
 await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'欲望与代价',exact:true}).click();
 await sheet.getByRole('button',{name:'输入标题',exact:true}).click();
 await sheet.getByLabel('故事标题',{exact:true}).fill('宋公明三败高俅');
 await sheet.getByRole('button',{name:'按标题提取',exact:true}).click();
 const margin=page.getByRole('dialog',{name:'故事设置',exact:true}),chosen=margin.getByRole('region',{name:'提取条件'});
 await chosen.getByText('查看已选原文',{exact:true}).click();
 for(const chapter of ['第七十八回','第七十九回','第八十回'])await chosen.getByText(new RegExp('^'+chapter+' ')).waitFor();
 assert.ok((await chosen.textContent()).includes('欲望与代价'));
 assert.ok((await chosen.textContent()).includes('指定标题：宋公明三败高俅'));
 await page.setViewportSize({width:390,height:844});
 assert.equal(await margin.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
 await margin.locator('.yu-sheet').evaluate(element=>{element.scrollTop=0;});
 await page.screenshot({path:path.join(evidenceDirectory,'three-chapter-context-mobile.png')});
 // 修改提取条件保留当前任务，并恢复目录首页以外的原文和标题。
 const marginId=new URL(page.url()).searchParams.get('id'),shelfSize=(await f.json('sessions')).length;
 const editConditions=()=>margin.getByRole('link',{name:'修改提取条件',exact:true}).click();
 await editConditions();
 const returned=page.getByRole('dialog',{name:'这一篇，想怎样读？'});
 assert.equal(await returned.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'水浒传',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await returned.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'欲望与代价',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await returned.getByLabel('故事标题',{exact:true}).inputValue(),'宋公明三败高俅');
 await returned.getByLabel('关键词筛选').fill('高太尉');
 for(const chapter of ['第七十八回','第七十九回','第八十回'])assert.equal(await returned.getByRole('checkbox',{name:new RegExp('^'+chapter+' ')}).isChecked(),true);
 await returned.getByRole('checkbox',{name:/^第七十九回 /}).uncheck();
 await returned.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其他',exact:true}).click();
 await returned.getByLabel('写下想看的主题').fill('江湖中的进退');
 await returned.getByLabel('故事标题',{exact:true}).fill('高太尉出征');
 await page.screenshot({path:path.join(evidenceDirectory,'three-chapter-input-mobile.png')});
 const conditionsResponse=()=>page.waitForResponse(response=>response.url().endsWith(`/api/reader/sessions/${marginId}/setup`)&&response.request().method()==='POST'&&response.request().postDataJSON().action==='conditions');
 const update=conditionsResponse();
 await returned.getByRole('button',{name:'按标题提取',exact:true}).click();
 const updated=await update;assert.equal(updated.status(),200);const changed=await updated.json();assert.equal(changed.id,marginId);
 assert.deepEqual(changed.selection.discovery,{mode:'title',title:'高太尉出征'});assert.equal(changed.intake.search.state,'searching');
 assert.equal(new URL(page.url()).searchParams.get('id'),marginId);assert.equal((await f.json('sessions')).length,shelfSize);
 const revised=page.getByRole('dialog',{name:'故事设置',exact:true});
 const revisedContext=revised.getByRole('region',{name:'提取条件'});
 const details=revisedContext.locator('details');
 if(await details.getAttribute('open')===null)await revisedContext.getByText('查看已选原文',{exact:true}).click();
 await revisedContext.getByText(/^第八十回 /).waitFor();await revisedContext.getByText(/^第七十八回 /).waitFor();
 assert.equal(await revisedContext.locator('li').count(),2);
 assert.ok((await revisedContext.textContent()).includes('江湖中的进退'));
 assert.equal(await revised.locator('.yu-sheet').evaluate(element=>getComputedStyle(element).scrollbarWidth==='thin'||getComputedStyle(element,'::-webkit-scrollbar').width==='6px'),true);
 await editConditions();
 assert.equal(await returned.getByLabel('写下想看的主题').inputValue(),'江湖中的进退');
 await returned.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'庄子',exact:true}).click();
 await returned.getByRole('button',{name:'自动标题',exact:true}).click();
 const reset=conditionsResponse();
 await returned.getByRole('button',{name:'开始提取',exact:true}).click();
 const resetResponse=await reset;assert.equal(resetResponse.status(),200);assert.deepEqual((await resetResponse.json()).selection.discovery,{mode:'auto'});
 await revisedContext.getByText('《庄子》',{exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('id'),marginId);assert.equal((await f.json('sessions')).length,shelfSize);
 assert.equal((await f.read(marginId)).selection.discoverySources,undefined);
 await revised.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'书架',exact:true}).click();
 await page.reload();
 assert.equal((await f.json('sessions')).filter(session=>session.id===marginId).length,1);
 await page.setViewportSize({width:767,height:900});
 // The same editor is available inside a separate replacement draft; cancelling retains the parent.
 f.options.generation=f.generation;f.control.hold=false;
 f.generation.suggestions=async selection=>({stories:[{title:selection.discovery?.mode==='title'?selection.discovery.title:'重选候选',description:'可独立讲述的完整事件。'}],note:''});
 await f.restart();f.app.services.localBooks=real;
 const parentId=await f.create(2);await until(async()=>(await f.read(parentId)).state==='completed');const parent=await f.read(parentId);
 await page.goto(url+'/read?id='+parentId);
 await page.getByRole('button',{name:'故事设置',exact:true}).click();
 await page.getByRole('link',{name:'替换选题',exact:true}).click();
 const replacement=page.getByRole('dialog',{name:'替换选题',exact:true});
 await replacement.getByRole('button',{name:'自动标题',exact:true}).click();
 await replacement.getByRole('button',{name:'开始提取',exact:true}).waitFor();
 assert.equal(await replacement.locator('.yu-extraction-help').textContent(),'按所选原文和主题寻找故事，并自动拟题。');
 await replacement.getByRole('button',{name:'输入标题',exact:true}).click();
 await replacement.getByLabel('故事标题',{exact:true}).fill('庄子的大葫芦');
 const query=page.waitForResponse(response=>/\/api\/reader\/sessions\/[^/]+\/setup$/.test(new URL(response.url()).pathname)&&response.request().method()==='POST'&&response.request().postDataJSON().action==='search');
 await replacement.getByRole('button',{name:'按标题提取',exact:true}).click();
 const replacementQuery=await query;assert.equal(replacementQuery.status(),200);const draft=await replacementQuery.json();
 assert.equal(draft.selection.discovery.title,'庄子的大葫芦');assert.equal(draft.reselection.parentId,parentId);
 assert.deepEqual((await f.read(parentId)).story,parent.story);
 await replacement.getByRole('button',{name:'取消替换',exact:true}).click();
 assert.deepEqual((await f.read(parentId)).story,parent.story);
});
