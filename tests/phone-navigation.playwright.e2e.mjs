// 返回键 E2E：在受控生产夹具（隔离书库）中，用浏览器的返回与前进验证每次只关闭最上层的一步、
// 应用内关闭不留死按、前进不重新打开、有输入时询问、忙碌时保持一致、重新加载后的过期条目被跳过，
// 以及中大档的抽屉、新建页、工作区和跨档切换。场景编号对应 .docs/tests/test-phone-navigation.md。
// 除 7b 外都先打开另一个源上的外部页面再进入应用，“离开应用”即回到外部页面。夹具的初始化脚本
// 在 about:blank 上读取 localStorage 会抛错，因此不用空白页作为外部页面。
import test from 'node:test';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {seededBrowser,seedStory} from './fixtures/desktop-layout.mjs';
import {storyBrowser} from './fixtures/story-browser.mjs';
import {until} from './fixtures/production.mjs';

const options={timeout:600000};
const phone={viewport:{width:390,height:844},completed:3,touch:true};
const dialog=(page,name)=>page.getByRole('dialog',{name,exact:true});
const openDialogs=page=>page.evaluate(()=>[...document.querySelectorAll('dialog[open]')].map(d=>d.getAttribute('aria-label')));
const settle=page=>page.waitForTimeout(350);
async function back(page){await page.goBack({waitUntil:'commit'}).catch(()=>{});await settle(page);}
async function forward(page){await page.goForward({waitUntil:'commit'}).catch(()=>{});await settle(page);}
// 外部页面：另一个端口（另一个源）上的静态页
let outside='';
test.before(async()=>{const server=createServer((_,response)=>{response.setHeader('content-type','text/html');response.end('<title>外部页面</title><p>外部页面</p>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();outside=`http://127.0.0.1:${server.address().port}/outside`;});
async function enter(page,target){await page.goto(outside);await page.goto(target);}
const left=page=>page.url()===outside;
const tab=(page,name)=>page.locator('.yu-tabbar').getByRole('button',{name:new RegExp(name)}).click();
const reading=page=>page.locator('.yu-reader').count().then(n=>n>0);
// 手机书架上点开一篇故事（用户手势，压入历史条目）
async function openFromShelf(page){await page.locator('.yu-shelf-reading-footer').first().click();await page.getByRole('button',{name:'故事设置',exact:true}).waitFor();await settle(page);}
async function openSettings(page){await page.getByRole('button',{name:'故事设置',exact:true}).click();await dialog(page,'故事设置').waitFor();await settle(page);}
const posts=(b,from)=>b.commands.slice(from).filter(c=>c.method==='POST');

test('PHONE-NAV-01/02/03: sheets close one at a time, in-app closes consume entries, forward reopens nothing',options,async t=>{
 const b=await seededBrowser(t,'PNAV-01',phone);
 await b.execute(async()=>{
  const {page,url}=b;await enter(page,url);await tab(page,'书架');
  await page.locator('.yu-shelf-reading-footer').first().waitFor();
  await page.evaluate(()=>window.scrollTo(0,120));const scrolled=await page.evaluate(()=>scrollY);
  await openFromShelf(page);await openSettings(page);
  await dialog(page,'故事设置').getByText('审核记录',{exact:true}).first().click();await dialog(page,'审核记录').waitFor();await settle(page);
  // 1. 三次返回各关闭一步
  await back(page);assert.deepEqual(await openDialogs(page),['故事设置'],'first back closes 审核记录 only');
  await back(page);assert.deepEqual(await openDialogs(page),[],'second back closes 故事设置');assert.ok(await reading(page),'reader still open');
  await back(page);assert.equal(await reading(page),false,'third back closes the reader');
  assert.equal(await page.evaluate(()=>scrollY),scrolled,'shelf scroll restored');
  // 3. 前进不重新打开
  const before=b.commands.length;
  await forward(page);await forward(page);
  assert.equal(await reading(page),false);assert.deepEqual(await openDialogs(page),[]);assert.equal(posts(b,before).length,0,'no POST');
  // 2. 应用内关闭消耗条目
  await openFromShelf(page);await openSettings(page);
  await dialog(page,'故事设置').getByRole('button',{name:'关闭',exact:true}).first().click();await settle(page);
  await page.getByRole('button',{name:'返回发现',exact:true}).click();await settle(page);
  assert.equal(await reading(page),false);
  await back(page);assert.ok(left(page),'back leaves the app, no dead press');
 });
});

test('PHONE-NAV-06: a creation submit reuses the entry for the workflow panel',options,async t=>{
 const b=await seededBrowser(t,'PNAV-06',{...phone,completed:0});
 await b.execute(async()=>{
  const {page,url}=b;await enter(page,url);await tab(page,'发现');
  await page.getByRole('button',{name:'选择庄子',exact:true}).click();const sheet=dialog(page,'这一篇，想怎样读？');await sheet.waitFor();await settle(page);
  await sheet.getByRole('button',{name:'进入故事提取',exact:true}).click();await dialog(page,'故事设置').waitFor();await settle(page);
  assert.deepEqual(await openDialogs(page),['故事设置']);
  await back(page);assert.deepEqual(await openDialogs(page),[],'back closes the workflow panel');assert.equal(left(page),false);
  await back(page);assert.ok(left(page),'the next back leaves the app');
 });
});

test('PHONE-NAV-07: after a reload one back leaves the app past every old entry; forward never reopens the story',options,async t=>{
 const b=await seededBrowser(t,'PNAV-07',phone);
 await b.execute(async()=>{
  const {page,url}=b;await enter(page,url);await tab(page,'书架');await openFromShelf(page);await openSettings(page);
  const href=page.url();assert.match(href,/\/read\?id=/);
  await page.reload();await page.getByRole('button',{name:'故事设置',exact:true}).waitFor();await settle(page);
  assert.equal(page.url(),href,'the reader opens from /read?id= as before');
  const before=b.commands.length;
  await back(page);await page.waitForTimeout(600);
  assert.ok(left(page),'one back leaves the app');
  assert.equal(posts(b,before).length,0,'no POST and no reading event');
  await forward(page);await page.waitForTimeout(600);assert.equal(left(page),false,'forward returns to the app');
  assert.equal(await reading(page),false,'the start view, not the story');assert.equal(new URL(page.url()).pathname,'/');
  await forward(page);await page.waitForTimeout(600);
  assert.equal(await reading(page),false,'forward onto a stale entry never opens the story');
  assert.equal(posts(b,before).length,0);
 });
});

test('PHONE-NAV-07a: a direct link plus a sheet takes two backs, also after a reload',options,async t=>{
 const b=await seededBrowser(t,'PNAV-07a',phone);
 await b.execute(async()=>{
  const {page,url,ids}=b;
  for(const reload of [false,true]){
   await enter(page,url+'/read?id='+ids[0]);await page.getByRole('button',{name:'故事设置',exact:true}).waitFor();
   if(reload){await page.reload();await page.getByRole('button',{name:'故事设置',exact:true}).waitFor();}
   await settle(page);await openSettings(page);
   await back(page);assert.deepEqual(await openDialogs(page),[]);assert.ok(await reading(page),'first back closes the sheet; the reader stays');
   await back(page);await page.waitForTimeout(400);assert.ok(left(page),`second back leaves the app${reload?' after a reload':''}`);
   await forward(page);
  }
 });
});

test('PHONE-NAV-07b: when the app is the tab\'s first page, a stale back shows the start view',options,async t=>{
 const b=await seededBrowser(t,'PNAV-07b',phone);
 await b.execute(async()=>{
  const {url,context}=b;await b.page.goto(url);
  // window.open 打开的新标签页里，应用是第一条目（初始空白文档被替换）
  const [page]=await Promise.all([context.waitForEvent('page'),b.page.evaluate(target=>{window.open(target);},url)]);
  t.after(()=>page.close());await page.waitForLoadState();
  assert.equal(await page.evaluate(()=>history.length),1,'the app is the tab\'s first entry');
  await tab(page,'书架');await openFromShelf(page);await openSettings(page);
  await page.reload();await page.getByRole('button',{name:'故事设置',exact:true}).waitFor();await settle(page);
  const before=b.commands.length;
  await back(page);await page.waitForTimeout(800);
  assert.equal(await reading(page),false,'the start view shows');assert.equal(new URL(page.url()).pathname,'/');
  assert.ok(await page.locator('.yu-tabbar').isVisible(),'not a blank page');
  await back(page);await page.waitForTimeout(400);assert.equal(await reading(page),false,'a further back changes nothing in the app');
  await forward(page);await forward(page);assert.equal(await reading(page),false,'forward reopens nothing');
  assert.equal(posts(b,before).length,0,'no reading event or resume POST');
 });
});
