// Verify all optional-condition combinations with title editing in the shared extraction window.
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
 const vite=await createServer({envFile:false,cacheDir:path.join(f.root,'vite-cache'),logLevel:'error',server:{host:'127.0.0.1',port:uiPort,strictPort:true,proxy:{'/api':{target},'/art':{target}}}});
 await vite.listen();t.after(()=>vite.close());
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 // 验证手机新建面板；桌面新建页由 desktop-responsive-layout E2E 覆盖
 const context=await browser.newContext({viewport:{width:767,height:900}}),page=await context.newPage();
 await context.addInitScript(()=>localStorage.setItem('shiqu-last-tab','shelf'));
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
  assert.equal(await sheet.getByRole('group',{name:'原文范围'}).getByRole('button',{name:'自动',exact:true}).count(),1);
  const scopePosition=await sheet.getByRole('group',{name:'原文范围'}).boundingBox(),themePosition=await sheet.getByRole('group',{name:'故事主题'}).boundingBox();
  assert.ok(scopePosition.y<themePosition.y,'Original scope should appear before theme');
  if(theme){await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其他',exact:true}).click();await sheet.getByLabel('写下想看的主题').fill('知恩图报');}
  if(scope){
   await sheet.getByRole('group',{name:'原文范围'}).getByRole('button',{name:'选择章节或已有故事段落'}).click();await sheet.getByRole('checkbox',{name:'第一章',exact:true}).check();
   await sheet.getByRole('button',{name:'完成原文选择',exact:true}).click();
   assert.equal(await sheet.getByLabel('搜索故事或章节').isVisible(),false);
   await sheet.locator('.yu-scope-selection>summary').click();
   assert.equal(await sheet.getByRole('checkbox',{name:'第一章',exact:true}).isChecked(),true);
   await sheet.getByRole('button',{name:'完成原文选择',exact:true}).click();
  }
  const gap=await sheet.getByRole('button',{name:'进入故事提取',exact:true}).evaluate(button=>button.getBoundingClientRect().top-button.previousElementSibling.getBoundingClientRect().bottom);
  assert.ok(gap>=23.5,`discovery button gap: ${gap}`);
  if(flags===0){
   await mkdir(evidenceDirectory,{recursive:true});
   await sheet.getByRole('button',{name:'进入故事提取',exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(evidenceDirectory,'source-button-gap.png')});
  }
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reader/sessions'&&response.request().method()==='POST');
  await sheet.getByRole('button',{name:'进入故事提取',exact:true}).click();
  const created=await response;assert.equal(created.status(),201);
  const payload=created.request().postDataJSON().selection,saved=await created.json();
  assert.deepEqual(payload.discovery,{mode:'auto'});
  assert.equal(payload.theme,theme?'知恩图报':'原典故事');
  assert.equal(payload.discoverySources?.length,scope?1:undefined);
  assert.deepEqual(saved.selection.discovery,payload.discovery);assert.equal(saved.selection.theme,payload.theme);
  assert.equal(saved.selection.source,undefined);
  assert.equal(saved.intake.search.state,'idle');assert.deepEqual(saved.intake.batches,[]);
  const extraction=page.getByRole('dialog',{name:'故事设置',exact:true});
  await extraction.getByRole('group',{name:'标题方式'}).waitFor();
  assert.equal(await extraction.getByRole('button',{name:'自动标题',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await extraction.getByLabel('故事标题',{exact:true}).count(),0);
  const context=extraction.getByRole('region',{name:'已选原文与主题'});
  if(scope)await context.getByText('第一章',{exact:true}).waitFor();
  else assert.ok((await context.textContent()).includes('自动（未限定章节或段落）'));
  assert.ok((await context.textContent()).includes(theme?'知恩图报':'不限定主题'));
  const contextPosition=await context.boundingBox(),modePosition=await extraction.getByRole('group',{name:'标题方式'}).boundingBox();
  assert.ok(contextPosition.y<modePosition.y,'Selected originals and theme should precede title mode');
  assert.equal((await f.app.services.production.queue.jobs(saved.id,'docker-local-owner')).filter(job=>job.kind==='discover').length,0);
  assert.equal(await extraction.locator('.yu-extraction-help').count(),1);
  assert.equal(await extraction.locator('.yu-extraction-help').textContent(),'按所选原文和主题寻找故事，并自动拟题。');
  if(flags===0)assert.equal(library.calls.catalog.length,0);
  if(title){
   await extraction.getByRole('button',{name:'输入标题',exact:true}).click();
   assert.equal(await extraction.locator('.yu-extraction-help').textContent(),'按标题寻找完整故事，主题用于讲述重点。');
   assert.equal(await extraction.getByRole('button',{name:'按标题提取',exact:true}).isDisabled(),true);
   await extraction.getByLabel('故事标题',{exact:true}).fill('乌龟报恩');
   const search=page.waitForResponse(response=>response.url().endsWith(`/api/reader/sessions/${saved.id}/setup`)&&response.request().method()==='POST'&&response.request().postDataJSON().action==='search');
   await extraction.getByRole('button',{name:'按标题提取',exact:true}).click();
   const searched=await search;assert.equal(searched.status(),200);const changed=await searched.json();
   assert.deepEqual(changed.selection.discovery,{mode:'title',title:'乌龟报恩'});
   assert.equal(changed.selection.theme,payload.theme);assert.deepEqual(changed.selection.discoverySources,payload.discoverySources);
  }else{
   const search=page.waitForResponse(response=>response.url().endsWith(`/api/reader/sessions/${saved.id}/setup`)&&response.request().method()==='POST'&&response.request().postDataJSON().action==='search');
   await extraction.getByRole('button',{name:'开始提取',exact:true}).click();
   const started=await search;assert.equal(started.status(),200);assert.deepEqual((await started.json()).selection.discovery,{mode:'auto'});
  }
  await extraction.getByRole('button').filter({has:page.getByText('乌龟报恩',{exact:true})}).waitFor();
  assert.equal(await extraction.locator('.yu-extraction-help').textContent(),'重新提取会替换当前候选。');
  if(flags===6){
   await page.setViewportSize({width:390,height:844});
   await extraction.getByRole('region',{name:'已选原文与主题'}).scrollIntoViewIfNeeded();
   assert.equal(await extraction.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
   await page.screenshot({path:path.join(evidenceDirectory,'extraction-auto-mobile.png')});
   await page.setViewportSize({width:767,height:900});
  }
  if(flags===7){
   await page.setViewportSize({width:390,height:844});
   assert.equal(await extraction.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
   await page.screenshot({path:path.join(evidenceDirectory,'extraction-mobile.png')});
   // Editing and clearing a target is an explicit new extraction, without returning to the first window.
   await extraction.getByLabel('故事标题',{exact:true}).fill('勇士护民');
   let response=page.waitForResponse(response=>response.url().endsWith(`/api/reader/sessions/${saved.id}/setup`)&&response.request().method()==='POST'&&response.request().postDataJSON().action==='search');
   await extraction.getByRole('button',{name:'按标题提取',exact:true}).click();
   assert.equal((await(await response).json()).selection.discovery.title,'勇士护民');
   await extraction.getByRole('button',{name:'自动标题',exact:true}).click();
   assert.equal(await extraction.getByLabel('故事标题',{exact:true}).count(),0);
   response=page.waitForResponse(response=>response.url().endsWith(`/api/reader/sessions/${saved.id}/setup`)&&response.request().method()==='POST'&&response.request().postDataJSON().action==='search');
   await extraction.getByRole('button',{name:'开始提取',exact:true}).click();
   assert.deepEqual((await(await response).json()).selection.discovery,{mode:'auto'});
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
 // A single catalog story can be a title-query scope, and clearing the title preserves that choice.
 const real=new LocalBooks(process.cwd());library.books.book=selection=>real.book(selection);
 let sheet=await open();
 await sheet.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'聊斋志异',exact:true}).click();
 await sheet.getByRole('group',{name:'原文范围'}).getByRole('button',{name:'选择章节或已有故事段落'}).click();
 await sheet.getByLabel('搜索故事或章节').fill('种梨');
 await sheet.getByRole('button').filter({has:page.getByText('種梨',{exact:true})}).click();
 await sheet.getByRole('button',{name:'完成原文选择',exact:true}).click();
 await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'欲望与代价',exact:true}).click();
 const request=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reader/sessions'&&response.request().method()==='POST');
 await sheet.getByRole('button',{name:'进入故事提取',exact:true}).click();
 const submitted=await request;assert.equal(submitted.status(),201);const selected=submitted.request().postDataJSON().selection;
 assert.deepEqual(selected.discovery,{mode:'auto'});assert.equal(selected.theme,'欲望与代价');assert.equal(selected.discoverySources.length,1);assert.equal(selected.source,undefined);
 const created=await submitted.json(),extraction=page.getByRole('dialog',{name:'故事设置',exact:true});
 await extraction.getByRole('region',{name:'已选原文与主题'}).getByText('種梨',{exact:true}).waitFor();
 await extraction.getByRole('button',{name:'输入标题',exact:true}).click();
 await extraction.getByLabel('故事标题',{exact:true}).fill('种梨');
 const search=page.waitForResponse(response=>response.url().endsWith(`/api/reader/sessions/${created.id}/setup`)&&response.request().method()==='POST'&&response.request().postDataJSON().action==='search');
 await extraction.getByRole('button',{name:'按标题提取',exact:true}).click();
 const changed=await(await search).json();assert.equal(changed.selection.discovery.title,'种梨');assert.deepEqual(changed.selection.discoverySources,selected.discoverySources);
 sheet=await open();await sheet.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'其他',exact:true}).click();
 assert.equal(await sheet.getByLabel('故事标题',{exact:true}).count(),0);
 assert.equal(f.control.calls.length,0);assert.equal(f.control.plans.length,0);
 // The actual three selected Water Margin chapters are listed, rather than just a range count.
 sheet=await open();
 await sheet.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'水浒传',exact:true}).click();
 await sheet.getByRole('group',{name:'原文范围'}).getByRole('button',{name:'选择章节或已有故事段落'}).click();
 await sheet.getByLabel('搜索故事或章节').fill('高太尉');
 for(const chapter of ['第七十八回','第七十九回','第八十回'])await sheet.getByRole('checkbox',{name:new RegExp('^'+chapter+' ')}).check();
 await sheet.getByRole('button',{name:'完成原文选择',exact:true}).click();
 await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'欲望与代价',exact:true}).click();
 await sheet.getByRole('button',{name:'进入故事提取',exact:true}).click();
 const margin=page.getByRole('dialog',{name:'故事设置',exact:true}),chosen=margin.getByRole('region',{name:'已选原文与主题'});
 for(const chapter of ['第七十八回','第七十九回','第八十回'])await chosen.getByText(new RegExp('^'+chapter+' ')).waitFor();
 assert.ok((await chosen.textContent()).includes('欲望与代价'));
 assert.equal(await margin.getByRole('button',{name:'自动标题',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await margin.getByLabel('故事标题',{exact:true}).count(),0);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await margin.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
 await margin.locator('.yu-sheet').evaluate(element=>{element.scrollTop=0;});
 await page.screenshot({path:path.join(evidenceDirectory,'three-chapter-context-mobile.png')});
 await margin.getByRole('button',{name:'输入标题',exact:true}).click();
 await margin.getByLabel('故事标题',{exact:true}).fill('宋公明三败高俅');
 await page.screenshot({path:path.join(evidenceDirectory,'three-chapter-input-mobile.png')});
 // Returning edits the existing task and restores receipts outside the first directory page.
 const marginId=new URL(page.url()).searchParams.get('id'),shelfSize=(await f.json('sessions')).length;
 await margin.getByRole('link',{name:'返回修改书籍、原文和主题',exact:true}).click();
 const returned=page.getByRole('dialog',{name:'这一篇，想怎样读？'});
 assert.equal(await returned.getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'水浒传',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await returned.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'欲望与代价',exact:true}).getAttribute('aria-pressed'),'true');
 await returned.locator('.yu-scope-selection>summary').click();
 await returned.getByLabel('搜索故事或章节').fill('高太尉');
 for(const chapter of ['第七十八回','第七十九回','第八十回'])assert.equal(await returned.getByRole('checkbox',{name:new RegExp('^'+chapter+' ')}).isChecked(),true);
 await returned.getByRole('checkbox',{name:/^第七十九回 /}).uncheck();
 await returned.getByRole('button',{name:'完成原文选择',exact:true}).click();
 await returned.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其他',exact:true}).click();
 await returned.getByLabel('写下想看的主题').fill('江湖中的进退');
 const update=page.waitForResponse(response=>response.url().endsWith(`/api/reader/sessions/${marginId}/setup`)&&response.request().method()==='POST'&&response.request().postDataJSON().action==='conditions');
 await returned.getByRole('button',{name:'进入故事提取',exact:true}).click();
 const updated=await update;assert.equal(updated.status(),200);assert.equal((await updated.json()).id,marginId);
 assert.equal(new URL(page.url()).searchParams.get('id'),marginId);assert.equal((await f.json('sessions')).length,shelfSize);
 const revised=page.getByRole('dialog',{name:'故事设置',exact:true});
 const revisedContext=revised.getByRole('region',{name:'已选原文与主题'});
 await revisedContext.getByText(/^第八十回 /).waitFor();
 assert.equal(await revisedContext.locator('li').count(),2);
 assert.ok((await revisedContext.textContent()).includes('江湖中的进退'));
 assert.equal(await revised.locator('.yu-sheet').evaluate(element=>getComputedStyle(element).scrollbarWidth==='thin'||getComputedStyle(element,'::-webkit-scrollbar').width==='6px'),true);
 await revised.getByRole('link',{name:'返回修改书籍、原文和主题',exact:true}).click();
 assert.equal(await page.getByLabel('写下想看的主题').inputValue(),'江湖中的进退');
 await page.getByRole('dialog',{name:'这一篇，想怎样读？'}).getByRole('group',{name:'选择书籍'}).getByRole('button',{name:'庄子',exact:true}).click();
 await page.getByRole('button',{name:'进入故事提取',exact:true}).click();
 await revised.getByRole('region',{name:'已选原文与主题'}).getByText('《庄子》',{exact:true}).waitFor();
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
