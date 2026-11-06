// 响应式重设计 E2E：在受控生产夹具（隔离书库）中验证小、中、大三档布局与跨档切换。
// 书库通过与生产相同的 API 预置：多篇已完成故事与未完成的制作，界面操作只走浏览器控件。
// 每个场景把截图与几何数据写入证据目录，供基线对比与宽度扫描使用。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {seededBrowser} from './fixtures/desktop-layout.mjs';

const options={timeout:600000};
const dialog=(page,name)=>page.getByRole('dialog',{name,exact:true});

// 几何快照：主要容器的位置与尺寸，以及横向溢出。
async function geometry(page){
 return page.evaluate(()=>{
  const box=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};};
  const sheet=[...document.querySelectorAll('dialog[open] .yu-sheet')].at(-1);
  const children=sheet?[...sheet.children].map(el=>el.getBoundingClientRect()).filter(r=>r.width>0):[];
  return {
   viewport:[innerWidth,innerHeight],scrollWidth:document.scrollingElement.scrollWidth,
   app:box('.yu-app'),home:box('.yu-home'),reader:box('.yu-reader'),tabbar:box('.yu-tabbar'),books:box('.yu-books'),
   sheetContent:children.length?{left:Math.round(Math.min(...children.map(r=>r.left))),right:Math.round(Math.max(...children.map(r=>r.right)))}:null,
   layout:document.querySelector('.yu-world')?.getAttribute('data-layout')||null,
   desktop:!!document.querySelector('.yu-desktop'),
   introSize:parseFloat(getComputedStyle(document.querySelector('.yu-intro h1')||document.body).fontSize),
  };
 });
}

// 场景 1 的手机视图：发现、书架、我的、新建故事、故事设置、修改故事、阅读页。
async function phoneViews(b,width,height,record){
 const {page,url,ids}=b,tab=name=>page.locator('.yu-tabbar').getByRole('button',{name:new RegExp(name)}).click();
 const close=()=>page.getByRole('dialog').last().getByRole('button',{name:'关闭',exact:true}).first().click();
 await page.setViewportSize({width,height});
 const shot=async name=>{await page.waitForTimeout(250);record[`${name}@${width}x${height}`]=await geometry(page);await page.screenshot({path:path.join(b.directory,`${name}-${width}x${height}.png`)});};
 await page.goto(url);await tab('发现');await page.locator('.yu-intro').waitFor();await shot('discover');
 await tab('书架');await page.locator('.yu-shelf-row-readable').first().waitFor();await shot('shelf');
 await tab('我的');await page.getByRole('button',{name:/阅读偏好/}).waitFor();await shot('me');
 await tab('发现');await page.getByRole('button',{name:'选择庄子',exact:true}).click();await dialog(page,'这一篇，想怎样读？').waitFor();await shot('creation');await close();
 await b.reader(ids[0]);await page.locator('.yu-scene.is-current').waitFor();await shot('reader');
 const settings=await b.settings();await settings.getByRole('button',{name:'修改故事名',exact:true}).waitFor();await shot('settings');
 await settings.getByText('制作要求',{exact:true}).first().click();await dialog(page,'修改故事').waitFor();await shot('revision');
}

test('DESKTOP-LAYOUT-01: small tier keeps the phone UI; wider phone viewports go full-bleed',options,async t=>{
 const b=await seededBrowser(t,'DRL-01',{viewport:{width:390,height:820},completed:2,touch:true});
 await b.execute(async()=>{
  const record={};
  for(const width of [360,390,430,600,700])await phoneViews(b,width,820,record);
  await writeFile(path.join(b.directory,'phone-geometry.json'),JSON.stringify(record,null,1));
  for(const [key,value] of Object.entries(record)){
   assert.ok(value.scrollWidth<=value.viewport[0],`${key} has no horizontal scroll`);
   assert.equal(value.desktop,false,`${key} stays on the phone tree`);
  }
 });
});

test('DESKTOP-LAYOUT-03: library selects into a docked panel, a drawer below 1024px, and keeps selection across reflow',options,async t=>{
 const b=await seededBrowser(t,'DRL-03',{viewport:{width:1280,height:800},completed:3});
 await b.execute(async()=>{
  const {page,url}=b,top=name=>page.locator('.yu-topbar nav').getByRole('button',{name}).click();
  const cards=page.locator('.yu-shelf-row-readable'),detail=page.locator('.yu-shelf-detail');
  await page.goto(url);await top('书架');await cards.first().waitFor();
  // 点击卡片：右侧停靠详情显示所选故事与全部操作
  await cards.nth(0).locator('.yu-shelf-card-details').click();
  await detail.getByRole('heading',{level:2}).waitFor();
  for(const name of ['阅读','制作流程','收藏','修改故事名','署名与转载','删除故事'])assert.ok(await detail.getByRole('button',{name}).count(),name);
  for(const name of [/下载 PDF/,/下载 PNG/,/下载 ZIP/])assert.ok(await detail.getByRole('button',{name}).count());
  assert.equal(await page.locator('.yu-reader').count(),0,'selecting never opens the reader');
  await page.screenshot({path:path.join(b.directory,'library-1280.png')});
  // 键盘：Tab 到下一张卡片，Enter 只选择
  await cards.nth(1).locator('.yu-shelf-card-details').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.yu-shelf-row-readable')[1].classList.contains('is-selected'));
  assert.equal(await page.locator('.yu-reader').count(),0);
  // 筛掉所选故事时清除选中
  await page.getByRole('searchbox',{name:'搜索书架'}).fill('不存在的故事名');
  await page.waitForFunction(()=>!document.querySelector('.yu-shelf-row-readable.is-selected')&&!!document.querySelector('.yu-shelf-detail.is-empty'));
  await page.getByRole('searchbox',{name:'搜索书架'}).fill('');
  // 卡片底部“继续阅读”仍直接打开阅读
  await cards.nth(0).locator('.yu-shelf-reading-footer').click();await page.locator('.yu-reader').waitFor();
  await page.getByRole('button',{name:'返回发现',exact:true}).click();await top('书架');await cards.first().waitFor();

  // 中档 900：抽屉，打开时焦点在标题，Escape 关闭并把焦点还给卡片
  await page.setViewportSize({width:900,height:800});await page.waitForTimeout(300);
  const second=cards.nth(1).locator('.yu-shelf-card-details');
  await second.click();await page.waitForFunction(()=>document.activeElement?.matches('.yu-shelf-detail h2'));
  assert.equal(await page.locator('.yu-library-grid').evaluate(el=>el.inert),true,'grid is inert while the drawer is open');
  await page.screenshot({path:path.join(b.directory,'library-drawer-900.png')});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('.yu-shelf-detail.is-open')&&document.activeElement?.closest('.yu-shelf-row-readable')?.classList.contains('is-selected'));
  // 打开抽屉后加宽到 1100：同一故事停靠显示，不重新加载
  await second.click();await page.locator('.yu-shelf-detail.is-open').waitFor();
  const title=await detail.getByRole('heading',{level:2}).textContent();
  await page.setViewportSize({width:1100,height:800});await page.waitForTimeout(300);
  assert.equal(await detail.getByRole('heading',{level:2}).textContent(),title);
  assert.equal(await page.locator('.yu-library-grid').evaluate(el=>el.inert),false,'docked details never make the grid inert');
  // 反向：1100 时焦点在卡片，变窄到 900 不弹出抽屉，网格不 inert，焦点与选中保留，Enter 打开抽屉
  await second.focus();await page.setViewportSize({width:900,height:800});await page.waitForTimeout(300);
  assert.equal(await page.locator('.yu-shelf-detail.is-open').count(),0,'a reflow never opens the drawer');
  assert.equal(await page.locator('.yu-library-grid').evaluate(el=>el.inert),false);
  assert.ok(await second.evaluate(el=>el===document.activeElement),'focus stays on the card');
  await page.keyboard.press('Enter');await page.locator('.yu-shelf-detail.is-open').waitFor();
 });
});
