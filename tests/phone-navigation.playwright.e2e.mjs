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

// 确认框：记录提示，按当前设定接受（放弃输入）或取消（继续编辑）
function confirms(page){const seen=[];let reply=false;page.on('dialog',d=>{seen.push(d.message());void(reply?d.accept():d.dismiss());});return {seen,accept(value){reply=value;}};}
const topNav=(page,name)=>page.locator('.yu-topbar nav').getByRole('button',{name}).click();
const size=async(page,width,height=800)=>{await page.setViewportSize({width,height});await page.waitForTimeout(450);};

test('PHONE-NAV-04: typed input asks through back, Escape and a forced close',options,async t=>{
 const b=await seededBrowser(t,'PNAV-04',phone);
 await b.execute(async()=>{
  const {page,url}=b,ask=confirms(page);await enter(page,url);await tab(page,'发现');
  const openCreation=async()=>{await page.getByRole('button',{name:'选择庄子',exact:true}).click();const sheet=dialog(page,'这一篇，想怎样读？');await sheet.waitFor();await settle(page);await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其他',exact:true}).click();await sheet.getByLabel('写下想看的主题').fill('守住底线');return sheet;};
  let sheet=await openCreation();
  await back(page);assert.equal(ask.seen.length,1,'back asks');assert.equal(await sheet.getByLabel('写下想看的主题').inputValue(),'守住底线','keep leaves the text');
  ask.accept(true);await back(page);assert.equal(await sheet.count(),0,'discard closes it');ask.accept(false);
  // Escape 走 cancel（Chrome Android 的返回也是）
  sheet=await openCreation();await page.keyboard.press('Escape');await settle(page);
  assert.equal(ask.seen.length,3,'Escape asks');assert.equal(await sheet.getByLabel('写下想看的主题').inputValue(),'守住底线');
  // 浏览器强制关闭：重新打开并询问
  await page.evaluate(()=>document.querySelector('dialog[aria-label="这一篇，想怎样读？"]').close());await settle(page);
  assert.equal(ask.seen.length,4,'a forced close asks');assert.equal(await page.evaluate(()=>document.querySelector('dialog[aria-label="这一篇，想怎样读？"]').open),true,'and re-opens the sheet');
  assert.equal(await sheet.getByLabel('写下想看的主题').inputValue(),'守住底线');
  await sheet.getByRole('button',{name:'关闭',exact:true}).click();await settle(page);assert.equal(ask.seen.length,4,'close buttons keep today\'s behavior');
  // 改名：有输入时返回询问，保存后返回不再询问
  await tab(page,'书架');await openFromShelf(page);await openSettings(page);
  await dialog(page,'故事设置').getByRole('button',{name:'修改故事名',exact:true}).click();const rename=dialog(page,'修改故事名');await rename.waitFor();await settle(page);
  await rename.getByLabel('故事名',{exact:true}).fill('返回前的新名');
  await back(page);assert.equal(ask.seen.length,5,'rename asks');assert.equal(await rename.count(),1);
  await rename.getByRole('button',{name:'保存故事名',exact:true}).click();await rename.waitFor({state:'hidden'});await settle(page);
  await back(page);assert.equal(ask.seen.length,5,'after saving, back does not ask');assert.deepEqual(await openDialogs(page),[],'back closed 故事设置');
  assert.ok(ask.seen.every(message=>message==='放弃未保存的输入？'));
 });
});

test('PHONE-NAV-05: a busy sheet stays open and consistent across back presses and forced closes',options,async t=>{
 const b=await seededBrowser(t,'PNAV-05',phone);
 await b.execute(async()=>{
  const {page,url}=b;await enter(page,url);await tab(page,'书架');await openFromShelf(page);await openSettings(page);
  await dialog(page,'故事设置').getByRole('button',{name:'修改故事名',exact:true}).click();const rename=dialog(page,'修改故事名');await rename.waitFor();await settle(page);
  let release;const held=new Promise(resolve=>release=resolve);
  await page.route('**/api/reader/sessions/*/title',async route=>{await held;await route.continue();});
  await rename.getByLabel('故事名',{exact:true}).fill('忙碌中的新名');page.once('dialog',d=>d.dismiss());
  await rename.getByRole('button',{name:'保存故事名',exact:true}).click();await rename.getByRole('button',{name:'正在保存…'}).waitFor();
  const locked=()=>page.evaluate(()=>document.body.style.position==='fixed');
  await back(page);await back(page);
  assert.deepEqual(await openDialogs(page),['故事设置','修改故事名'],'the busy sheet stays open');assert.ok(await locked(),'scroll lock kept');
  await page.evaluate(()=>document.querySelector('dialog[aria-label="修改故事名"]').close());await settle(page);
  assert.deepEqual(await openDialogs(page),['故事设置','修改故事名'],'a forced close while busy re-opens it');
  release();await rename.waitFor({state:'hidden'});await settle(page);
  assert.deepEqual(await openDialogs(page),['故事设置']);assert.ok(await locked(),'故事设置 keeps the lock');
  await back(page);assert.deepEqual(await openDialogs(page),[]);assert.equal(await locked(),false,'the lock is released');
  assert.ok(await reading(page));await back(page);assert.equal(await reading(page),false);await back(page);assert.ok(left(page),'no dead press');
 });
});

test('PHONE-NAV-09: sheet depth stays at two with return labels; swaps add no entries',options,async t=>{
 const b=await seededBrowser(t,'PNAV-09',phone);
 await b.execute(async()=>{
  const {page,url}=b;await enter(page,url);await tab(page,'书架');await openFromShelf(page);await openSettings(page);
  // 修改分镜：分镜剧本关闭，两层：故事设置 → 修改故事
  await dialog(page,'故事设置').getByRole('link',{name:'查看分镜',exact:true}).click();await dialog(page,'分镜剧本').waitFor();await settle(page);
  assert.match(await dialog(page,'分镜剧本').locator('.yu-sheet-return').textContent(),/返回「故事设置」/);
  await dialog(page,'分镜剧本').getByRole('button',{name:'修改分镜',exact:true}).click();await dialog(page,'修改故事').waitFor();await settle(page);
  assert.deepEqual(await openDialogs(page),['故事设置','修改故事']);
  assert.equal(await dialog(page,'修改故事').locator('.yu-sheet-return').textContent(),'返回「故事设置」');
  await back(page);assert.deepEqual(await openDialogs(page),['故事设置'],'back closes 修改故事');
  // 替换选题：故事设置不在下面；取消后故事设置回来；只有一个服务端选题会话。今天的流程里选中候选即提交替换，
  // 提交前没有可打开的设置子面板，因此第二层只能由嵌套面板计数间接保证（见场景 11 的嵌套子面板）。
  const before=b.commands.length;
  await dialog(page,'故事设置').getByText('替换选题',{exact:true}).first().click();const picker=dialog(page,'替换选题');await picker.getByRole('button',{name:'取消替换',exact:true}).waitFor();await settle(page);
  assert.deepEqual(await openDialogs(page),['替换选题'],'替换选题 shows without 故事设置 underneath');
  await picker.getByRole('button',{name:'取消替换',exact:true}).click();await dialog(page,'故事设置').waitFor();await settle(page);
  assert.deepEqual(await openDialogs(page),['故事设置'],'取消替换 brings 故事设置 back');
  const reselections=b.commands.slice(before).filter(c=>/\/reselection$/.test(c.path)&&c.method==='POST');
  // 开发环境 StrictMode 会重跑打开效果，但沿用同一个 requestId，服务端只建一个选题会话
  assert.equal(new Set(reselections.map(c=>c.body.requestId)).size,1,'one server-side reselection session');
  await back(page);assert.deepEqual(await openDialogs(page),[],'back closes 故事设置');assert.ok(await reading(page));
  await back(page);assert.equal(await reading(page),false,'the next back closes the reader');
  await back(page);assert.ok(left(page),'and the next leaves the app: no dead press');
 });
});

test('PHONE-NAV-10: medium and large tiers close drawers, the workspace and the create page one step at a time',options,async t=>{
 const b=await seededBrowser(t,'PNAV-10',{viewport:{width:900,height:800},completed:2});
 await b.execute(async()=>{
  const {page,url,ids}=b,card=id=>page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`);
  await enter(page,url);await topNav(page,'书架');
  // 900：书架详情抽屉
  await card(ids[0]).click();await page.locator('.yu-shelf-detail.is-open').waitFor();await settle(page);
  await back(page);assert.equal(await page.locator('.yu-shelf-detail.is-open').count(),0,'back closes the drawer only');
  assert.ok(await page.locator('.yu-library').isVisible());
  // 1280：工作区返回书架并保留选中；新建页返回发现
  await size(page,1280);await card(ids[0]).click();await page.locator('.yu-shelf-detail').getByRole('button',{name:'制作流程'}).click();await page.locator('.yu-workspace').waitFor();await settle(page);
  await back(page);assert.equal(await page.locator('.yu-workspace').count(),0);assert.ok(await page.locator('.yu-library').isVisible(),'back returns to 书架');
  assert.equal(await page.locator('.yu-shelf-row.is-selected').getAttribute('data-story-id'),ids[0],'selection kept');
  await topNav(page,'发现');await page.locator('.yu-topbar-create').click();await page.locator('.yu-create-form').waitFor();await settle(page);
  await back(page);assert.equal(await page.locator('.yu-create-form').count(),0);assert.ok(await page.locator('.yu-discover').isVisible(),'back returns to 发现');
  // 1280 的停靠分镜列表在 900 变成抽屉：返回先关抽屉，再回到书架
  await topNav(page,'书架');await card(ids[0]).click();await page.locator('.yu-shelf-detail').getByRole('button',{name:/阅读|继续阅读|重读/}).first().click();await page.locator('.yu-reader').waitFor();await settle(page);
  await page.getByRole('button',{name:'分镜列表',exact:true}).click();await page.locator('.yu-reader-panel').waitFor();await settle(page);
  await size(page,900);
  await back(page);assert.equal(await page.locator('.yu-reader-panel').count(),0,'back closes the drawer');assert.ok(await reading(page),'the reader stays');
  await back(page);assert.equal(await reading(page),false,'the next back returns to 书架');assert.ok(await page.locator('.yu-library').isVisible());
 });
});

test('PHONE-NAV-11: resizing across the switch keeps every back press to exactly one step',options,async t=>{
 const b=await seededBrowser(t,'PNAV-11',{...phone,completed:1});
 await b.execute(async()=>{
  const {page,url,f}=b;await enter(page,url);await tab(page,'书架');await openFromShelf(page);await openSettings(page);
  await dialog(page,'故事设置').getByText('制作要求',{exact:true}).first().click();await dialog(page,'修改故事').waitFor();await settle(page);
  await size(page,1280);await page.locator('.yu-workspace').waitFor();await size(page,390,844);
  await dialog(page,'修改故事').waitFor();
  await back(page);assert.deepEqual(await openDialogs(page),['故事设置'],'first back closes 修改故事');
  await back(page);assert.deepEqual(await openDialogs(page),[]);assert.ok(await reading(page));
  await back(page);assert.equal(await reading(page),false);
  await back(page);assert.ok(left(page),'no dead press, no skipped step');
  // 改名叠在故事设置上：390 → 900 → 390 后，返回先关改名
  await enter(page,url);await tab(page,'书架');await openFromShelf(page);await openSettings(page);
  await dialog(page,'故事设置').getByRole('button',{name:'修改故事名',exact:true}).click();await dialog(page,'修改故事名').waitFor();await settle(page);
  await size(page,900);await size(page,390,844);await dialog(page,'故事设置').waitFor();await page.waitForTimeout(300);
  await back(page);assert.deepEqual(await openDialogs(page),['故事设置'],'rename closes first; 故事设置 stays');
  // 嵌套的设置子面板：选题阶段的故事原文跨档后仍先关闭
  await seedStory(f,{confirm:false});await enter(page,url);await tab(page,'书架');
  await page.locator('.yu-production-row').first().click();const settings=dialog(page,'故事设置');await settings.waitFor();await settle(page);
  const source=settings.getByRole('link',{name:'原文',exact:true});await until(async()=>await source.count()>0&&await source.first().getAttribute('aria-disabled')===null,20000);await source.first().click();await dialog(page,'故事原文').waitFor();await settle(page);
  await size(page,1280);await size(page,390,844);await dialog(page,'故事原文').waitFor();await page.waitForTimeout(300);
  await back(page);assert.deepEqual(await openDialogs(page),['故事设置'],'the sub-sheet closes, not its parent');
 });
});

test('PHONE-NAV-08: the hash-opened provider dialog is a step; a direct load keeps today\'s close',{timeout:240000},async t=>{
 const {checkoutFixture,startDevelopment}=await import('./fixtures/development.mjs');
 const {chromium}=await import('playwright');
 const f=await checkoutFixture(t);const server=await startDevelopment(t,f);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await(await browser.newContext({viewport:{width:1280,height:800}})).newPage();page.setDefaultTimeout(15000);
 const provider=dialog(page,'生成服务与模型');
 await enter(page,server.origin);await page.locator('.yu-topbar').waitFor();await settle(page);
 // 应用内设置哈希：返回关闭对话框，再返回离开应用
 await page.evaluate(()=>{location.hash='provider-settings';});await provider.waitFor();await settle(page);
 await back(page);assert.equal(await provider.count(),0,'back closes the dialog');assert.equal(left(page),false);
 await back(page);assert.ok(left(page),'the next back leaves the app');
 // 关闭按钮用掉哈希条目
 await page.goto(server.origin);await page.locator('.yu-topbar').waitFor();await settle(page);
 await page.evaluate(()=>{location.hash='provider-settings';});await provider.waitFor();await settle(page);
 await provider.getByRole('button',{name:'关闭',exact:true}).first().click();await settle(page);
 assert.equal(await provider.count(),0);assert.equal(new URL(page.url()).hash,'','the hash is removed');
 await back(page);assert.ok(left(page),'no dead entry after the close button');
 // 直接加载：关闭按钮留在应用里的“我的”
 await page.goto(server.origin+'/#provider-settings');await provider.waitFor();await settle(page);
 await provider.getByRole('button',{name:'关闭',exact:true}).first().click();await settle(page);
 assert.equal(left(page),false,'stays in the app');assert.equal(new URL(page.url()).hash,'');
 assert.equal(await page.locator('.yu-topbar nav').getByRole('button',{name:'我的'}).getAttribute('aria-current'),'page');
});
