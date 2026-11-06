// 响应式重设计 E2E：在受控生产夹具（隔离书库）中验证小、中、大三档布局与跨档切换。
// 书库通过与生产相同的 API 预置：多篇已完成故事与未完成的制作，界面操作只走浏览器控件。
// 每个场景把截图与几何数据写入证据目录，供基线对比与宽度扫描使用。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {seededBrowser,seedReviewedStory,seedStory} from './fixtures/desktop-layout.mjs';
import {auditPhone} from './fixtures/phone-audit.mjs';
import {checkoutFixture,startDevelopment,saveGoogle} from './fixtures/development.mjs';
import {chromium} from 'playwright';

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
   // 发现页的书：第一行本数（同一 top），以及完整在视口内的本数
   booksRow:(()=>{const books=[...document.querySelectorAll('.yu-books>button')].map(el=>el.getBoundingClientRect());return books.length?books.filter(r=>Math.abs(r.top-books[0].top)<2).length:0;})(),
   booksVisible:[...document.querySelectorAll('.yu-books>button')].filter(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}).length,
   captionEm:(()=>{const p=document.querySelector('.yu-scene-caption>p');return p?p.getBoundingClientRect().width/parseFloat(getComputedStyle(p).fontSize):null;})(),
   searchFont:(()=>{const input=document.querySelector('.yu-shelf-search input');return input?parseFloat(getComputedStyle(input).fontSize):null;})(),
   tabbarBottom:(()=>{const bar=document.querySelector('.yu-tabbar');return bar?Math.round(innerHeight-bar.getBoundingClientRect().bottom):null;})(),
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
  const record={},sizes=[[360,820],[390,820],[430,820],[600,820],[767,820],[844,390],[932,430],[430,390]];
  for(const [width,height] of sizes)await phoneViews(b,width,height,record);
  await writeFile(path.join(b.directory,'phone-geometry.json'),JSON.stringify(record,null,1));
  for(const [key,value] of Object.entries(record)){
   assert.ok(value.scrollWidth<=value.viewport[0],`${key} has no horizontal scroll`);
   assert.equal(value.desktop,false,`${key} stays on the phone tree`);assert.equal(value.layout,'phone',key);
   if(value.tabbarBottom!==null&&!key.startsWith('reader'))assert.ok(Math.abs(value.tabbarBottom)<=1,`${key} tab bar at the bottom`);
  }
  // 宽屏手机与横屏手机：铺满窗口、内容列居中且不超过 600px、书按行排列且每行多于 430 宽时可见的本数
  for(const size of ['600x820','767x820','844x390','932x430']){
   const discover=record['discover@'+size],[vw]=discover.viewport;
   assert.equal(discover.app.x,0,size);assert.equal(discover.app.width,vw,size);
   assert.ok(discover.home.width<=600,size);assert.ok(Math.abs(discover.home.x-(vw-discover.home.width)/2)<=1,`${size} column centered`);
   assert.ok(discover.booksRow>record['discover@430x820'].booksVisible,`${size} shows more books per row`);
  }
  // 字号与 540px 手机界面一致（同高度比较）；横屏配文不超过 30em
  for(const size of ['600x820','767x820'])assert.equal(record['discover@'+size].introSize,record['discover@430x820'].introSize,size);
  for(const size of ['844x390','932x430']){assert.equal(record['discover@'+size].introSize,record['discover@430x390'].introSize,size);assert.ok(record['reader@'+size].captionEm<=30.5,`${size} caption within 30em`);}
  // 触屏：表单文字 16px
  assert.equal(record['shelf@390x820'].searchFont,16);
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

test('DESKTOP-LAYOUT-06: create is a page beside the book choices, re-initializes on a new book and continues in the workspace',options,async t=>{
 const b=await seededBrowser(t,'DRL-06',{viewport:{width:1280,height:800},completed:1});
 await b.execute(async()=>{
  const {page,url}=b,top=name=>page.locator('.yu-topbar nav').getByRole('button',{name}).click();
  const form=page.locator('.yu-create-form'),choices=page.locator('.yu-create-choices');
  const themes=form.getByRole('group',{name:'故事主题'}),books=form.getByRole('group',{name:'选择书籍'});
  await page.goto(url);await top('发现');
  await page.getByRole('button',{name:'选择庄子',exact:true}).click();
  await form.waitFor();assert.equal(await page.getByRole('dialog').count(),0,'a page, not a sheet');
  assert.ok(await choices.getByRole('button',{name:'选择列子',exact:true}).isVisible(),'the book list stays visible');
  assert.equal(await books.getByRole('button',{name:'庄子',exact:true}).getAttribute('aria-pressed'),'true');
  await themes.getByRole('button',{name:'其他',exact:true}).click();await form.getByLabel('写下想看的主题').fill('善意终有回响');
  // 表单自己的选书不重新挂载：已输入的主题保留
  await books.getByRole('button',{name:'列子',exact:true}).click();
  assert.equal(await form.getByLabel('写下想看的主题').inputValue(),'善意终有回响');
  // 左侧换一本书：表单按新书重新初始化
  await choices.getByRole('button',{name:'选择山海经',exact:true}).click();
  await page.waitForFunction(()=>![...document.querySelectorAll('.yu-create-form input')].some(input=>input.value==='善意终有回响'));
  assert.equal(await books.getByRole('button',{name:'山海经',exact:true}).getAttribute('aria-pressed'),'true');
  // 左侧选心情：主题随之更新，表单不关闭
  await choices.locator('.yu-moods').getByRole('button',{name:/人情冷暖/}).click();
  assert.equal(await themes.getByRole('button',{name:'人情冷暖',exact:true}).getAttribute('aria-pressed'),'true');
  await page.screenshot({path:path.join(b.directory,'create-1280.png')});
  // 新建页上再点“新建故事”不做任何事
  await page.locator('.yu-topbar-create').click();
  assert.equal(await themes.getByRole('button',{name:'人情冷暖',exact:true}).getAttribute('aria-pressed'),'true');
  // 提交：与手机相同的请求，选题在工作区继续
  await books.getByRole('button',{name:'庄子',exact:true}).click();
  const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/reader/sessions'&&r.request().method()==='POST');
  await form.getByRole('button',{name:'进入故事提取',exact:true}).click();
  const request=(await created).request().postDataJSON();assert.equal(request.selection.bookId,'zhuangzi');assert.equal(request.selection.theme,'人情冷暖');
  await page.locator('.yu-workspace').waitFor();await page.locator('.yu-workspace-center').getByRole('button',{name:/开始提取|按标题提取/}).first().waitFor();
  // 从工作区点“新建故事”并提交：落到新的选题工作区，而不是停在“正在打开制作流程…”
  await page.locator('.yu-topbar-create').click();await form.waitFor();
  const second=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/reader/sessions'&&r.request().method()==='POST');
  await form.getByRole('button',{name:'进入故事提取',exact:true}).click();const next=await(await second).json();
  await page.locator('.yu-workspace-center').getByRole('button',{name:/开始提取|按标题提取/}).first().waitFor();
  assert.equal(await page.getByText('正在打开制作流程…').count(),0);assert.ok(next.id);
  // 从“不挑了”进入同样打开新建页
  await top('发现');await page.locator('.yu-surprise').click();await form.waitFor();assert.equal(await page.getByRole('dialog').count(),0);
 });
});

// 回到第一幅（已在第一幅时按钮禁用）
const toFirst=async page=>{const first=page.getByRole('button',{name:'第一页',exact:true});if(await first.isEnabled())await first.click();};
const pageIndex=page=>page.locator('.yu-progress').getAttribute('aria-label').then(label=>Number(label.match(/第(\d+)幅/)[1]));
async function openFirstStory(page,url){
 await page.goto(url);await page.locator('.yu-topbar nav').getByRole('button',{name:'书架'}).click();
 await page.locator('.yu-shelf-reading-footer').first().click();await page.locator('.yu-scene.is-current').waitFor();
}

test('DESKTOP-LAYOUT-07: the reader fills the window with a non-modal side panel that docks at 1024px',options,async t=>{
 const b=await seededBrowser(t,'DRL-07',{viewport:{width:1440,height:900},completed:1});
 await b.execute(async()=>{
  const {page,url}=b,stage=page.locator('.yu-reader'),panel=page.locator('.yu-reader-panel');
  await openFirstStory(page,url);await toFirst(page);
  assert.equal(await page.locator('.yu-topbar').count(),0,'the immersive reader hides the top bar');
  const art=async()=>page.locator('.yu-scene.is-current').evaluate(img=>{const s=img.closest('.yu-reader').getBoundingClientRect(),r=img.getBoundingClientRect();return {inside:r.left>=s.left-1&&r.right<=s.right+1&&r.top>=s.top-1&&r.bottom<=s.bottom+1,height:r.height};});
  const wide=await art();assert.ok(wide.inside,'artwork box inside the stage');
  // 侧栏打开时键盘、滚轮照常翻页
  await page.getByRole('button',{name:'分镜列表',exact:true}).click();await panel.waitFor();
  await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.yu-progress').getAttribute('aria-label').startsWith('第2幅'));
  await page.keyboard.press('ArrowLeft');await page.waitForFunction(()=>document.querySelector('.yu-progress').getAttribute('aria-label').startsWith('第1幅'));
  const box=await stage.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,400);
  await page.waitForFunction(()=>document.querySelector('.yu-progress').getAttribute('aria-label').startsWith('第2幅'));
  // 侧栏选分镜：翻到该页，侧栏保持打开
  await panel.getByRole('button',{name:'跳转到第 3 幅'}).click();assert.equal(await pageIndex(page),3);assert.equal(await panel.count(),1);
  // 配文行宽不超过 30em（含大一点的文字）
  const measure=()=>page.locator('.yu-scene-caption>p').evaluate(p=>p.getBoundingClientRect().width/parseFloat(getComputedStyle(p).fontSize));
  assert.ok(await measure()<=30.5,'caption within 30em');
  await page.screenshot({path:path.join(b.directory,'reader-1440.png')});
  // Escape：先关侧栏，再返回打开前的书架
  await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});assert.equal(await stage.count(),1);
  await page.keyboard.press('Escape');await page.locator('.yu-shelf').waitFor();
  // 画面比 480px 宽的手机阅读更高
  await page.setViewportSize({width:480,height:900});await b.reader(b.ids[0]);await page.locator('.yu-scene.is-current').waitFor();
  const narrow=await page.locator('.yu-scene.is-current').evaluate(img=>img.getBoundingClientRect().height);
  assert.ok(wide.height>narrow,`artwork taller on desktop (${wide.height} > ${narrow})`);
  // 中档 900：侧栏是覆盖舞台的抽屉，翻页与右侧边缘点击仍然有效；加宽到 1100 停靠并保留页码
  await page.setViewportSize({width:900,height:800});await openFirstStory(page,url);await toFirst(page);
  await page.getByRole('button',{name:'分镜列表',exact:true}).click();await panel.waitFor();
  assert.equal(await panel.evaluate(el=>getComputedStyle(el).position),'fixed','a drawer over the stage');
  await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.yu-progress').getAttribute('aria-label').startsWith('第2幅'));
  // 抽屉盖住舞台右缘；舞台不 inert，未被盖住的左缘点击照常翻回上一幅
  const surface=await page.locator('.yu-swipe-surface').boundingBox();
  await page.mouse.click(surface.x+8,surface.y+surface.height/2);
  await page.waitForFunction(()=>document.querySelector('.yu-progress').getAttribute('aria-label').startsWith('第1幅'));
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('.yu-progress').getAttribute('aria-label').startsWith('第3幅'));
  await page.screenshot({path:path.join(b.directory,'reader-900-drawer.png')});
  await page.setViewportSize({width:1100,height:800});await page.waitForTimeout(300);
  assert.equal(await panel.evaluate(el=>getComputedStyle(el).position),'static','docked beside the stage');
  assert.ok((await stage.boundingBox()).width<1100-250,'the stage shrinks for the docked panel');
  assert.equal(await pageIndex(page),3);
 });
});

test('DESKTOP-LAYOUT-05: 故事设置 from the reader opens the workflow section and returns to the same page',options,async t=>{
 const b=await seededBrowser(t,'DRL-05',{viewport:{width:1280,height:800},completed:1});
 await b.execute(async()=>{
  const {page,url}=b;await openFirstStory(page,url);
  await page.getByRole('button',{name:'最后一页',exact:true}).click();assert.equal(await pageIndex(page),3);
  await page.getByRole('button',{name:'原文',exact:true}).click();await page.locator('.yu-reader-panel').waitFor();
  await page.getByRole('button',{name:'故事设置',exact:true}).click();
  const tabs=page.locator('.yu-workspace').getByRole('navigation',{name:'工作区分区'});await tabs.waitFor();
  assert.equal(await tabs.locator('[aria-current=page]').textContent(),'制作流程','opens the workflow, not 原文');
  await tabs.getByRole('button',{name:'原文'}).click();await page.locator('.yu-workspace-center').getByText(/原文|出处/).first().waitFor();
  await tabs.getByRole('button',{name:'制作流程'}).click();
  await page.locator('.yu-workspace').getByRole('button',{name:'返回'}).click();
  await page.locator('.yu-scene.is-current').waitFor();assert.equal(await pageIndex(page),3);assert.equal(await page.locator('.yu-reader-panel').count(),0);
 });
});

// —— 通用辅助 ——
const topNav=(page,name)=>page.locator('.yu-topbar nav').getByRole('button',{name}).click();
// 对话框是否居中：面板左右留白相等、上下都留白
const centeredSheet=async(page,name)=>{const box=await page.getByRole('dialog',{name,exact:true}).locator('.yu-sheet').first().boundingBox(),vw=page.viewportSize().width,vh=page.viewportSize().height;return Math.abs(box.x-(vw-box.x-box.width))<=2&&box.y>0&&box.y+box.height<vh;};
const closeTop=page=>page.getByRole('dialog').last().getByRole('button',{name:'关闭',exact:true}).first().click();

test('DESKTOP-LAYOUT-02: the top bar stays visible, never covers content, and every item leaves the current view',options,async t=>{
 const b=await seededBrowser(t,'DRL-02',{viewport:{width:1280,height:800},completed:6});
 await b.execute(async()=>{
  const {page,url,f,ids}=b,bar=page.locator('.yu-topbar'),current=()=>bar.locator('[aria-current=page]').textContent();
  await page.goto(url);
  for(const [name,label] of [['发现','发现'],['书架','书架'],['我的','我的']]){await topNav(page,name);assert.equal(await current(),label);}
  await page.locator('.yu-topbar-create').click();await page.locator('.yu-create-form').waitFor();assert.equal(await current(),'新建故事');
  // 书架滚到底：顶栏仍在，首行不被遮住；Shift+Tab 回到第一张卡片时卡片完全在顶栏之下
  await topNav(page,'书架');const barBottom=(await bar.boundingBox()).height;
  assert.ok((await page.locator('.yu-shelf h1').boundingBox()).y>=barBottom,'first row below the bar');
  await page.evaluate(()=>scrollTo(0,document.scrollingElement.scrollHeight));await page.waitForTimeout(200);
  assert.equal((await bar.boundingBox()).y,0,'bar visible after scrolling');
  const cards=page.locator('.yu-shelf-card-details');await cards.last().focus();
  for(let i=0;i<40&&!await cards.first().evaluate(el=>el===document.activeElement);i++)await page.keyboard.press('Shift+Tab');
  assert.ok((await cards.first().boundingBox()).y>=barBottom,'focused card fully below the bar');
  // 工作区 → 书架；再进工作区 → 发现
  const openWorkspace=async()=>{await topNav(page,'书架');await cards.first().click();await page.locator('.yu-shelf-detail').getByRole('button',{name:'制作流程'}).click();await page.locator('.yu-workspace').waitFor();};
  await openWorkspace();assert.equal(await bar.locator('[aria-current=page]').count(),0,'no item is active in the workspace');
  await topNav(page,'书架');await page.locator('.yu-library').waitFor();assert.equal(await page.locator('.yu-workspace').count(),0);
  await openWorkspace();await topNav(page,'发现');await page.locator('.yu-discover').waitFor();assert.equal(await page.locator('.yu-workspace').count(),0);
  // 新建页 → 我的
  await page.locator('.yu-topbar-create').click();await page.locator('.yu-create-form').waitFor();await topNav(page,'我的');await page.locator('.yu-profile').waitFor();
  // 选题工作区 → 返回修改书籍 → 书架：落到书架而不是工作区
  const intake=await seedStory(f,{pick:false});await page.goto(url);await topNav(page,'书架');
  await page.locator('.yu-production-row').first().click();await page.locator('.yu-workspace').waitFor();
  await page.locator('.yu-workspace-center').getByText(/返回修改书籍/).first().click();await page.locator('.yu-create-form').waitFor();
  await topNav(page,'书架');await page.locator('.yu-library').waitFor();assert.equal(await page.locator('.yu-workspace').count(),0);assert.ok(intake);
  // 阅读 → 故事设置 → 新建故事 → 发现：回到发现，地址为 /
  await b.reader(ids[0]);await page.locator('.yu-scene.is-current').waitFor();
  await page.getByRole('button',{name:'故事设置',exact:true}).click();await page.locator('.yu-workspace').waitFor();
  await page.locator('.yu-topbar-create').click();await page.locator('.yu-create-form').waitFor();
  await topNav(page,'发现');await page.locator('.yu-discover').waitFor();
  assert.equal(new URL(page.url()).pathname,'/');assert.equal(await page.locator('.yu-reader').count(),0);
 });
});

test('DESKTOP-LAYOUT-08: modal dialogs open centered; toasts stay clear of the top bar; 我的 uses two columns',options,async t=>{
 const b=await seededBrowser(t,'DRL-08',{viewport:{width:1280,height:800},completed:1});
 await b.execute(async()=>{
  const {page,url,f,ids,commands}=b;
  await page.goto(url);await topNav(page,'我的');
  const groups=page.locator('.yu-profile-group');assert.equal(Math.round((await groups.nth(1).boundingBox()).y),Math.round((await groups.nth(2).boundingBox()).y),'two columns');
  for(const [entry,title] of [[/阅读偏好/,'舒服地读'],[/已删除的故事/,'已删除的故事']]){await page.getByRole('button',{name:entry}).click();await page.getByRole('dialog',{name:title,exact:true}).waitFor();await page.waitForTimeout(250);assert.ok(await centeredSheet(page,title),title);await closeTop(page);}
  await topNav(page,'书架');await page.locator(`[data-story-id="${ids[0]}"] .yu-shelf-card-details`).click();
  const detail=page.locator('.yu-shelf-detail'),before=commands.length;
  for(const [label,title] of [['修改故事名','修改故事名'],['署名与转载','署名与转载'],['删除故事','删除这篇故事？']]){
   await detail.getByRole('button',{name:label}).click();await page.getByRole('dialog',{name:title,exact:true}).waitFor();await page.waitForTimeout(250);
   assert.ok(await centeredSheet(page,title),title);
   if(title==='删除这篇故事？')await page.getByRole('button',{name:'保留故事',exact:true}).click();else await closeTop(page);
  }
  assert.equal(commands.slice(before).filter(c=>/rename|publication|title|library\//.test(c.path)).length,0,'nothing saved');
  // 收藏触发提示：提示可见且不压住顶栏
  await detail.getByRole('button',{name:'收藏'}).click();const toast=page.locator('.yu-toast');await toast.waitFor();
  const toastBox=await toast.boundingBox(),barBox=await page.locator('.yu-topbar').boundingBox();
  assert.ok(toastBox.y>barBox.y+barBox.height&&toastBox.y+toastBox.height<=800,'toast visible and clear of the bar');
  // 选题工作区里的“修改故事”与“故事原文”也是居中对话框
  await seedStory(f,{confirm:false});await page.goto(url);await topNav(page,'书架');await page.locator('.yu-production-row').first().click();await page.locator('.yu-workspace').waitFor();
  for(const [trigger,title] of [['原文','故事原文'],['制作要求','修改故事']]){await page.locator('.yu-workspace-center').getByText(trigger,{exact:true}).first().click();await page.getByRole('dialog',{name:title,exact:true}).waitFor();await page.waitForTimeout(250);assert.ok(await centeredSheet(page,title),title);await closeTop(page);}
 });
});

test('DESKTOP-LAYOUT-09: tiers switch at 768, reflow at 1024 and 1280, and cap content at 1440 on very wide screens',options,async t=>{
 const b=await seededBrowser(t,'DRL-09',{viewport:{width:1280,height:800},completed:0});
 await b.execute(async()=>{
  const {page,url,f}=b,id=await seedReviewedStory(f);
  const layout=()=>page.locator('.yu-world').getAttribute('data-layout');
  const noOverflow=async label=>{const r=await auditPhone(page,{checks:['layout']});assert.deepEqual(r.layout.overflow,[],label+' overflow');assert.deepEqual(r.layout.clipped,[],label+' clipped');};
  const size=async width=>{await page.setViewportSize({width,height:800});await page.waitForTimeout(250);};
  await page.goto(url);
  await size(767);assert.equal(await layout(),'phone');await noOverflow('767');
  await size(768);assert.equal(await layout(),'shell');await page.locator('.yu-topbar').waitFor();await noOverflow('768');
  // 书架详情：1023 抽屉，1024 停靠
  await topNav(page,'书架');await page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`).click();
  for(const [width,position] of [[1023,'fixed'],[1024,'sticky']]){await size(width);assert.equal(await page.locator('.yu-shelf-detail').evaluate(el=>getComputedStyle(el).position),position,`library details at ${width}`);await noOverflow('library '+width);}
  // 我的：1023 单栏，1024 两栏
  await topNav(page,'我的');const columns=()=>page.locator('.yu-profile').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
  await size(1023);assert.equal(await columns(),1);await size(1024);assert.equal(await columns(),2);
  // 新建页：1023 上下，1024 左右
  await page.locator('.yu-topbar-create').click();const form=page.locator('.yu-create-form'),choices=page.locator('.yu-create-choices');await form.waitFor();
  await size(1023);assert.ok((await form.boundingBox()).y>(await choices.boundingBox()).y+100,'stacked below 1024');
  await size(1024);assert.ok((await form.boundingBox()).x>(await choices.boundingBox()).x+100,'side by side at 1024');await noOverflow('create');
  // 工作区：1279 横条，1280 三栏
  await topNav(page,'书架');await page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`).click();await page.locator('.yu-shelf-detail').getByRole('button',{name:'制作流程'}).click();await page.locator('.yu-workspace').waitFor();
  const frames=page.locator('.yu-workspace-frames'),center=page.locator('.yu-workspace-center');
  await size(1279);assert.ok((await frames.boundingBox()).y+(await frames.boundingBox()).height<=(await center.boundingBox()).y+1,'strip above the center');
  await size(1280);assert.ok((await frames.boundingBox()).x+(await frames.boundingBox()).width<=(await center.boundingBox()).x+1,'list beside the center');await noOverflow('workspace');
  await page.locator('.yu-workspace').getByRole('button',{name:'返回'}).click();
  // 阅读侧栏：1023 抽屉，1024 停靠
  await b.reader(id);await page.locator('.yu-scene.is-current').waitFor();await page.getByRole('button',{name:'分镜列表',exact:true}).click();
  for(const [width,position] of [[1023,'fixed'],[1024,'static']]){await size(width);assert.equal(await page.locator('.yu-reader-panel').evaluate(el=>getComputedStyle(el).position),position,`reader panel at ${width}`);}
  // 2560：内容最宽 1440 并居中
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await topNav(page,'发现');await size(2560);
  const main=await page.locator('[data-main]').first().evaluate(el=>{const r=el.getBoundingClientRect(),cs=getComputedStyle(el);return {left:r.left,width:r.width,inner:r.width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)};});
  assert.ok(main.width<=1440,'capped at 1440');assert.ok(Math.abs(main.left-(2560-main.width)/2)<=1,'centered');await noOverflow('2560');
 });
});

test('DESKTOP-LAYOUT-10: resizing across the switch keeps views, drafts, frames and reading position',options,async t=>{
 const b=await seededBrowser(t,'DRL-10',{viewport:{width:1280,height:800},completed:0});
 await b.execute(async()=>{
  const {page,url,f}=b,id=await seedReviewedStory(f),size=async(width,height=800)=>{await page.setViewportSize({width,height});await page.waitForTimeout(400);};
  const openWorkspace=async()=>{await page.goto(url);await topNav(page,'书架');await page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`).click();await page.locator('.yu-shelf-detail').getByRole('button',{name:'制作流程'}).click();await page.locator('.yu-workspace').waitFor();};
  // 旋转：工作区里打开“修改故事名”并输入，跨档两次后仍在最上层，焦点与输入保留
  await size(1133,744);await openWorkspace();await page.locator('.yu-workspace-center').getByRole('button',{name:'修改故事名',exact:true}).click();
  const rename=page.getByRole('dialog',{name:'修改故事名',exact:true});await rename.getByLabel('故事名',{exact:true}).fill('转屏后的故事名');
  const topmost=()=>page.evaluate(()=>{const d=[...document.querySelectorAll('dialog[open]')].find(x=>x.getAttribute('aria-label')==='修改故事名');const s=d.querySelector('.yu-sheet').getBoundingClientRect();const hit=document.elementFromPoint(s.left+s.width/2,s.top+20);return d.contains(hit)&&d.contains(document.activeElement);});
  await size(744,1133);assert.equal(await page.locator('.yu-world').getAttribute('data-layout'),'phone');
  await page.getByRole('dialog',{name:'故事设置',exact:true}).waitFor();assert.ok(await topmost(),'rename stays topmost with focus at 744');
  assert.equal(await rename.getByLabel('故事名',{exact:true}).inputValue(),'转屏后的故事名');
  await size(1133,744);assert.ok(await topmost(),'rename stays topmost at 1133');assert.equal(await rename.getByLabel('故事名',{exact:true}).inputValue(),'转屏后的故事名');
  await rename.getByRole('button',{name:'关闭',exact:true}).click();
  // 工作区修改故事：选第 2 幅，再用编辑器的“选择分镜”改回第 1 幅，列表与右栏跟随
  await size(1280);const center=page.locator('.yu-workspace-center');
  await page.locator('.yu-workspace').getByRole('navigation',{name:'工作区分区'}).getByRole('button',{name:'修改故事'}).click();await center.getByRole('button',{name:'分镜',exact:true}).click();
  await page.locator('.yu-workspace-frames').getByRole('button',{name:'选择第 2 幅'}).click();
  assert.equal(await page.locator('.yu-workspace-preview h2').textContent(),'第 2 幅');
  await center.getByLabel(/^选择分镜/).selectOption('1');
  assert.equal(await page.locator('.yu-workspace-frames [aria-current=true]').getAttribute('aria-label'),'选择第 1 幅');
  assert.match(await page.locator('.yu-workspace-preview').textContent(),/受控审核/);
  // 修改故事里未保存的旁白：1280 → 390 → 1280
  await center.getByLabel(/^旁白/).fill('跨档保留的旁白。');
  await size(390);await page.getByRole('dialog',{name:'修改故事',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'修改故事',exact:true}).getByLabel(/^旁白/).inputValue(),'跨档保留的旁白。');
  await size(1280);assert.equal(await page.locator('.yu-workspace-center').getByLabel(/^旁白/).inputValue(),'跨档保留的旁白。');
  // 新建页的自定义主题：1280 → 390 → 1280
  await page.locator('.yu-topbar-create').click();const form=page.locator('.yu-create-form');await form.waitFor();
  await form.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其他',exact:true}).click();await form.getByLabel('写下想看的主题').fill('跨档保留的主题');
  await size(390);const sheet=page.getByRole('dialog',{name:'这一篇，想怎样读？',exact:true});await sheet.waitFor();assert.equal(await sheet.getByLabel('写下想看的主题').inputValue(),'跨档保留的主题');
  await size(1280);assert.equal(await page.locator('.yu-create-form').getByLabel('写下想看的主题').inputValue(),'跨档保留的主题');
  // 选题工作区“输入标题”：1280 → 390 → 1280，无“另一台设备”提示
  await seedStory(f,{pick:false});await page.goto(url);await topNav(page,'书架');await page.locator('.yu-production-row').first().click();await page.locator('.yu-workspace').waitFor();
  const query=page.locator('.yu-workspace-center');await query.getByRole('button',{name:'输入标题',exact:true}).click();await query.getByLabel('故事标题',{exact:true}).fill('跨档保留的标题');
  await size(390);const picker=page.getByRole('dialog',{name:'故事设置',exact:true});await picker.waitFor();assert.equal(await picker.getByLabel('故事标题',{exact:true}).inputValue(),'跨档保留的标题');
  await size(1280);assert.equal(await page.locator('.yu-workspace-center').getByLabel('故事标题',{exact:true}).inputValue(),'跨档保留的标题');
  assert.equal(await page.getByText('另一台设备更新了制作内容').count(),0);
  // 阅读第 3 幅：1280 → 390 → 1280，页码保留，滚轮仍可翻页
  await b.reader(id);await page.locator('.yu-scene.is-current').waitFor();await page.getByRole('button',{name:'最后一页',exact:true}).click();
  await size(390);assert.equal(await pageIndex(page),3);await size(1280);assert.equal(await pageIndex(page),3);
  const stage=await page.locator('.yu-reader').boundingBox();await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);await page.mouse.wheel(0,-400);
  await page.waitForFunction(()=>document.querySelector('.yu-progress').getAttribute('aria-label').startsWith('第2幅'));
 });
});

// 宽度扫描的单步测量：主内容区宽度、横向溢出、遮挡、裁剪与字号
function sweepMeasure({headings}){
 const dialogs=[...document.querySelectorAll('dialog[open]')],top=dialogs.at(-1);
 let width;
 if(top){const kids=[...top.querySelectorAll(':scope .yu-sheet > *')].map(el=>el.getBoundingClientRect()).filter(r=>r.width>0);width=Math.max(...kids.map(r=>r.right))-Math.min(...kids.map(r=>r.left));}
 else width=document.querySelector('[data-main]').getBoundingClientRect().width;
 const scope=top||document.body,occluded=[];
 const fixedAncestor=el=>{for(let n=el;n&&n!==document.body;n=n.parentElement){const p=getComputedStyle(n).position;if(p==='fixed'||p==='sticky')return n;}return null;};
 for(const el of scope.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary')){
  if(el.closest('[inert]')||!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue;
  const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;
  const x=r.left+r.width/2,y=r.top+r.height/2;if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
  // 横向滚动条带里的项目只在可见范围内检查
  let clipped=false;for(let n=el.parentElement;n&&n!==document.body;n=n.parentElement){const cs=getComputedStyle(n);if(cs.overflowX!=='visible'||cs.overflowY!=='visible'){const b=n.getBoundingClientRect();if(x<b.left||x>b.right||y<b.top||y>b.bottom){clipped=true;break;}}}
  if(clipped)continue;
  const hit=document.elementFromPoint(x,y);if(!hit||hit===el||el.contains(hit))continue;
  if(fixedAncestor(hit)&&!fixedAncestor(el))continue; // 滚到顶栏或底栏下面的内容
  if(el.closest('label')?.contains(hit))continue;
  occluded.push((el.getAttribute('aria-label')||el.textContent||el.tagName).trim().slice(0,20)+' ← '+(hit.className||hit.tagName));
 }
 const fonts=headings.map(selector=>{const el=document.querySelector(selector);return el&&el.checkVisibility()?parseFloat(getComputedStyle(el).fontSize):null;});
 return {mainWidth:Math.round(width*10)/10,scroll:document.scrollingElement.scrollWidth>document.scrollingElement.clientWidth+1,layout:document.querySelector('.yu-world').dataset.layout,occluded,fonts};
}

test('DESKTOP-LAYOUT-11: sweeping 320–2560px changes structure only at 768, never narrows content, scrolls sideways, occludes or jumps text',{timeout:1200000},async t=>{
 const b=await seededBrowser(t,'DRL-11',{viewport:{width:1280,height:900},completed:0});
 await b.execute(async()=>{
  const {page,url,f}=b,id=await seedReviewedStory(f),failures=[];
  const views=[
   {name:'discover',headings:['.yu-intro h1','.yu-generation-note p'],setup:async()=>{await page.goto(url);await topNav(page,'发现');}},
   {name:'shelf',headings:['.yu-shelf h1'],setup:async()=>{await page.goto(url);await topNav(page,'书架');}},
   {name:'me',headings:['.yu-profile-group h2'],setup:async()=>{await page.goto(url);await topNav(page,'我的');}},
   {name:'workspace',headings:[],setup:async()=>{await page.goto(url);await topNav(page,'书架');await page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`).click();await page.locator('.yu-shelf-detail').getByRole('button',{name:'制作流程'}).click();await page.locator('.yu-workspace').getByRole('navigation',{name:'工作区分区'}).getByRole('button',{name:'修改故事'}).click();await page.locator('.yu-workspace-center').getByRole('button',{name:'分镜',exact:true}).click();}},
   {name:'create',headings:[],setup:async()=>{await page.goto(url);await page.locator('.yu-topbar-create').click();await page.locator('.yu-create-form').waitFor();}},
   {name:'reader',headings:[],setup:async()=>{await b.reader(id);await page.locator('.yu-scene.is-current').waitFor();await page.getByRole('button',{name:'分镜列表',exact:true}).click();}},
  ];
  const report={};
  for(const view of views){
   await page.setViewportSize({width:1280,height:900});await view.setup();await page.waitForTimeout(400);
   let previous=null;report[view.name]=[];
   for(let width=320;width<=2560;width+=16){
    await page.setViewportSize({width,height:900});await page.waitForTimeout(60);
    const m=await page.evaluate(sweepMeasure,{headings:view.headings});report[view.name].push({width,...m});
    if(m.scroll)failures.push(`${view.name}@${width} scrolls sideways`);
    if(m.occluded.length)failures.push(`${view.name}@${width} occluded: ${m.occluded.slice(0,3).join('; ')}`);
    if(m.layout!==(width>=768?'shell':'phone'))failures.push(`${view.name}@${width} layout ${m.layout}`);
    if(previous){
     if(m.mainWidth<previous.mainWidth-0.5)failures.push(`${view.name} ${previous.mainWidth}→${m.mainWidth} at ${width}`);
     m.fonts.forEach((size,i)=>{if(size!==null&&previous.fonts[i]!==null&&Math.abs(size-previous.fonts[i])>2)failures.push(`${view.name} ${view.headings[i]} ${previous.fonts[i]}→${size} at ${width}`);});
    }
    previous=m;
   }
   const clip=await auditPhone(page,{checks:['layout']});if(clip.layout.clipped.length)failures.push(`${view.name} clipped at 2560`);
  }
  // 高度扫描：1280 宽，结构只在 544 与 560 之间切换
  await page.setViewportSize({width:1280,height:900});await views[0].setup();
  for(let height=400;height<=900;height+=16){await page.setViewportSize({width:1280,height});await page.waitForTimeout(40);const layout=await page.locator('.yu-world').getAttribute('data-layout');if(layout!==(height>=560?'shell':'phone'))failures.push(`height ${height} layout ${layout}`);}
  await writeFile(path.join(b.directory,'sweep.json'),JSON.stringify({failures,report},null,1));
  assert.deepEqual(failures,[]);
 });
});

// 生成服务与模型只对本机受保护代理开放；在一次性检出的真实开发服务中检查桌面对话框（设置与 HOME 均隔离）。
test('DESKTOP-LAYOUT-08b: the provider dialog is a wide centered dialog whose save stays reachable',{timeout:180000},async t=>{
 const f=await checkoutFixture(t);saveGoogle(f);const server=await startDevelopment(t,f);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await(await browser.newContext({viewport:{width:1280,height:800}})).newPage();page.setDefaultTimeout(15000);
 await page.goto(server.origin);await page.locator('.yu-topbar nav').getByRole('button',{name:'我的'}).click();
 await page.getByRole('button',{name:/生成服务与模型/}).click();const dialog=page.getByRole('dialog',{name:'生成服务与模型',exact:true});await dialog.waitFor();await page.waitForTimeout(400);
 const sheet=await dialog.locator('.yu-sheet').boundingBox();assert.ok(Math.abs(sheet.x-(1280-sheet.x-sheet.width))<=2,'centered');assert.ok(sheet.width>600,'widened');
 for(const field of await dialog.locator('input:not([type=radio]):not([type=checkbox]):not([type=hidden]),select').all())if(await field.isVisible())assert.ok((await field.boundingBox()).width>=280,'field at least 280px wide');
 await dialog.locator('.yu-sheet').evaluate(el=>{el.scrollTop=el.scrollHeight;});await page.waitForTimeout(200);
 const actions=await dialog.locator('.yu-provider-actions').boundingBox();assert.ok(actions.y>=0&&actions.y+actions.height<=800,'save and check stay visible after scrolling');
 await dialog.locator('.yu-sheet').evaluate(el=>{el.scrollTop=0;});await page.waitForTimeout(200);
 const top=await dialog.locator('.yu-provider-actions').boundingBox();assert.ok(top.y+top.height<=800,'actions visible at the top too');
});
