// 响应式重设计 E2E：在受控生产夹具（隔离书库）中验证小、中、大三档布局与跨档切换。
// 书库通过与生产相同的 API 预置：多篇已完成故事与未完成的制作，界面操作只走浏览器控件。
// 每个场景把截图与几何数据写入证据目录，供基线对比与宽度扫描使用。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {seededBrowser,seedReviewedStory} from './fixtures/desktop-layout.mjs';

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

// 元素完整处在视口内（工作区各栏不需要整页滚动即可同时看到）
const inViewport=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.left>=0&&r.bottom<=innerHeight+1&&r.right<=innerWidth+1;});

test('DESKTOP-LAYOUT-04: the story workspace keeps frames, editor, artwork and issues together and survives reflow',options,async t=>{
 const b=await seededBrowser(t,'DRL-04',{viewport:{width:1280,height:800},completed:0});
 await b.execute(async()=>{
  const {page,url,f}=b,id=await seedReviewedStory(f);
  const top=name=>page.locator('.yu-topbar nav').getByRole('button',{name}).click();
  const workspace=page.locator('.yu-workspace'),center=page.locator('.yu-workspace-center'),preview=page.locator('.yu-workspace-preview');
  await page.goto(url);await top('书架');
  await page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`).click();
  await page.locator('.yu-shelf-detail').getByRole('button',{name:'制作流程'}).click();
  await workspace.waitFor();
  await workspace.getByRole('navigation',{name:'工作区分区'}).getByRole('button',{name:'修改故事'}).click();
  await center.getByRole('button',{name:'分镜',exact:true}).click();
  await page.locator('.yu-workspace-frames').getByRole('button',{name:'选择第 1 幅'}).click();
  const caption=center.getByLabel(/^旁白/);await caption.fill('渔夫俯身伸手，把岸上的乌龟轻轻放回水中。');
  // 1280×800：分镜列表、旁白编辑、第 1 幅画面与审片问题同屏可见，页面本身不滚动
  for(const target of [page.locator('.yu-workspace-frames'),caption,preview.locator('img'),preview.getByText('受控审核：配文未说明可见行动。')])assert.ok(await inViewport(target),'visible together at 1280×800');
  assert.ok(await page.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),'panes scroll independently, not the page');
  await page.screenshot({path:path.join(b.directory,'workspace-1280.png')});
  // 切换分区再回来，草稿保留
  const tabs=workspace.getByRole('navigation',{name:'工作区分区'});
  await tabs.getByRole('button',{name:'分镜剧本'}).click();await center.locator('.yu-story-script,section,ol').first().waitFor();
  await tabs.getByRole('button',{name:'审核记录'}).click();await page.waitForTimeout(300);
  await tabs.getByRole('button',{name:'修改故事'}).click();
  assert.equal(await center.getByLabel(/^旁白/).inputValue(),'渔夫俯身伸手，把岸上的乌龟轻轻放回水中。');
  // 1024×768：分镜横条、旁白编辑与第 1 幅审片问题同屏，画面至少是缩略图
  await page.setViewportSize({width:1024,height:768});await page.waitForTimeout(300);
  for(const target of [page.locator('.yu-workspace-frames'),center.getByLabel(/^旁白/),preview.getByText('受控审核：配文未说明可见行动。'),preview.locator('img')])assert.ok(await inViewport(target),'visible together at 1024×768');
  await page.screenshot({path:path.join(b.directory,'workspace-1024.png')});
  // 768×1024：横条与编辑器可见；“画面与审核”抽屉显示画面与问题，关闭后草稿仍在
  await page.setViewportSize({width:768,height:1024});await page.waitForTimeout(300);
  assert.ok(await inViewport(page.locator('.yu-workspace-frames')));assert.ok(await inViewport(center.getByLabel(/^旁白/)));
  await page.getByRole('button',{name:'画面与审核'}).click();await page.locator('.yu-workspace-preview.is-open').waitFor();await page.waitForTimeout(300);
  await page.screenshot({path:path.join(b.directory,'workspace-768-drawer.png')});
  assert.ok(await inViewport(preview.getByText('受控审核：配文未说明可见行动。')),'issue visible in the drawer');
  await page.getByRole('button',{name:'关闭画面与审核'}).click();
  assert.equal(await center.getByLabel(/^旁白/).inputValue(),'渔夫俯身伸手，把岸上的乌龟轻轻放回水中。');
  // 1280 → 1100 → 900 → 1280：文字、所选分镜与编辑器滚动位置保留
  await page.setViewportSize({width:1280,height:800});await page.waitForTimeout(200);
  await center.evaluate(el=>{el.scrollTop=40;});const scroll=await center.evaluate(el=>el.scrollTop);
  for(const width of [1100,900,1280]){await page.setViewportSize({width,height:800});await page.waitForTimeout(250);}
  assert.equal(await center.getByLabel(/^旁白/).inputValue(),'渔夫俯身伸手，把岸上的乌龟轻轻放回水中。');
  assert.equal(await page.locator('.yu-workspace-frames [aria-current=true]').getAttribute('aria-label'),'选择第 1 幅');
  assert.equal(await center.evaluate(el=>el.scrollTop),scroll,'editor scroll position kept');
  // 1100 时焦点在右栏，变窄到 900：焦点移到“画面与审核”，抽屉保持关闭
  await page.setViewportSize({width:1100,height:800});await page.waitForTimeout(200);
  await preview.locator('h2').evaluate(el=>{el.tabIndex=-1;el.focus();});
  await page.setViewportSize({width:900,height:800});await page.waitForTimeout(300);
  assert.equal(await page.locator('.yu-workspace-preview.is-open').count(),0);
  assert.ok(await page.getByRole('button',{name:'画面与审核'}).evaluate(el=>el===document.activeElement),'focus moves to the toggle');
  // 返回：回到书架，同一故事仍选中
  await page.setViewportSize({width:1280,height:800});await page.waitForTimeout(200);
  await workspace.getByRole('button',{name:'返回'}).click();
  await page.locator(`[data-story-id="${id}"].is-selected`).waitFor();
 });
});
