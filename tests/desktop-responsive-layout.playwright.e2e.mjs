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
// 同一份故事设置可能停靠在书架右栏，或作为跨宽度不变的单列面板显示。
const storySettings=page=>page.locator('.yu-library-settings,dialog[aria-label="故事设置"],dialog[aria-label="准备故事"]');

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
 await page.setViewportSize({width,height});
 const shot=async name=>{await page.waitForTimeout(250);record[`${name}@${width}x${height}`]=await geometry(page);await page.screenshot({path:path.join(b.directory,`${name}-${width}x${height}.png`)});};
 await page.goto(url);await tab('发现');await page.locator('.yu-intro').waitFor();await shot('discover');
 await tab('书架');await page.locator('.yu-shelf-row-readable').first().waitFor();await shot('shelf');
 await tab('我的');await page.getByRole('button',{name:/阅读偏好/}).waitFor();await shot('me');
 await tab('发现');await page.getByRole('button',{name:'选择庄子',exact:true}).click();const creation=dialog(page,'这一篇，想怎样读？');await creation.waitFor();await shot('creation');await creation.getByRole('button',{name:'关闭',exact:true}).click();
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

test('wide shelf production sidebar shares the right column with reading and settings',options,async t=>{
 const b=await seededBrowser(t,'shelf-production-sidebar',{viewport:{width:1280,height:800},completed:1});
 await b.execute(async()=>{
  const {page,url,f,ids}=b;
  const task=await seedStory(f,{pick:false});
  await page.goto(url);
  const entry=page.getByRole('button',{name:'制作中',exact:true}),side=page.getByRole('complementary',{name:'制作中',exact:true});
  const taskRow=page.locator(`[data-story-id="${task}"] .yu-pending-story`);
  await side.locator(taskRow).waitFor();
  const heading=page.locator('.yu-shelf-heading');
  assert.equal(await heading.getByRole('button',{name:'新建故事',exact:true}).count(),1);
  assert.equal(await heading.locator('.yu-primary').count(),1);
  assert.equal(await entry.locator('span').textContent(),'1');
  assert.equal(await page.locator('.yu-topbar-create,.yu-shelf-tabs .yu-shelf-create').count(),0);
  assert.equal(await page.locator('.yu-library-grid .yu-production').count(),0);
  assert.equal(await entry.getAttribute('aria-pressed'),'true');
  await page.locator(`[data-story-id="${ids[0]}"] .yu-shelf-card-details`).click();
  await page.locator('.yu-library-reader .yu-reader').waitFor();
  assert.equal(await side.count(),0);assert.equal(await entry.getAttribute('aria-pressed'),'false');
  await entry.click();await side.locator(taskRow).waitFor();
  await taskRow.click();await page.locator('.yu-create-form').waitFor();
  await topNav(page,'书架');await side.locator(taskRow).waitFor();
  await heading.getByRole('button',{name:'新建故事',exact:true}).click();
  await page.locator('.yu-create-form').waitFor();
  assert.equal(await page.locator('.yu-topbar-create').count(),1);
  await topNav(page,'书架');
  await page.setViewportSize({width:1023,height:800});
  await page.locator('.yu-library-grid').locator(taskRow).waitFor();
  assert.equal(await side.count(),0);assert.equal(await entry.count(),0);
 });
});

test('DESKTOP-LAYOUT-03: at 1024px and up a card opens the reader itself in the right column; below it a card opens the full reader',options,async t=>{
 const b=await seededBrowser(t,'DRL-03',{viewport:{width:1280,height:800},completed:3});
 await b.execute(async()=>{
  const {page,url}=b,top=name=>page.locator('.yu-topbar nav').getByRole('button',{name}).click();
  const cards=page.locator('.yu-shelf-row-readable'),dock=page.locator('.yu-library-reader'),docked=dock.locator('.yu-reader');
  const frame=()=>docked.locator('.yu-progress').getAttribute('aria-label'),order=()=>cards.evaluateAll(els=>els.map(el=>el.dataset.storyId));
  const selected=id=>page.waitForFunction(id=>document.querySelector(`[data-story-id="${id}"]`)?.classList.contains('is-selected'),id);
  await page.goto(url);await top('书架');await cards.first().waitFor();
  assert.ok(await page.locator('.yu-library .yu-shelf-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)>1,'multi-column grid');
  assert.equal(await page.locator('.yu-library.has-side').count(),0,'no reserved right column without a story or task');
  const ids=await order();
  // 点卡片：阅读页本身停靠在右栏；顶栏仍在，地址留在书架，页面只有一个主区
  await cards.nth(1).locator('.yu-shelf-card-details').click();await docked.waitFor();await selected(ids[1]);
  assert.equal(await page.locator('.yu-reader-layout').count(),0,'not full screen');
  assert.ok(await page.locator('.yu-topbar').isVisible(),'the top bar stays');
  assert.equal(new URL(page.url()).pathname,'/','the URL stays on 书架');
  assert.equal(await page.locator('main').count(),1,'the docked reader is a section of the shelf');
  for(const name of ['全屏阅读','收藏故事','故事设置','原文','分镜列表','下一页'])assert.ok(await docked.getByRole('button',{name,exact:true}).count(),name);
  assert.match(await frame(),/^第1幅/);
  await page.screenshot({path:path.join(b.directory,'library-1280.png')});
  // 翻页照常保存阅读进度；停留在书架期间卡片顺序不变
  await docked.getByRole('button',{name:'下一页',exact:true}).click();assert.match(await frame(),/^第2幅/);
  await page.waitForFunction(id=>document.querySelector(`[data-story-id="${id}"] .yu-shelf-reading-meta`)?.textContent.includes('第 2 / 3 幅'),ids[1]);
  assert.deepEqual(await order(),ids,'card order is frozen while on 书架');
  // 方向键只在焦点位于右栏阅读时翻页；Escape 把焦点还给卡片，阅读留在右栏
  await page.getByRole('searchbox',{name:'搜索书架'}).focus();await page.keyboard.press('ArrowLeft');assert.match(await frame(),/^第2幅/,'typing in search never turns pages');
  await docked.locator('.yu-swipe-surface').focus();await page.keyboard.press('ArrowLeft');assert.match(await frame(),/^第1幅/);
  await page.keyboard.press('Escape');
  assert.ok(await cards.nth(1).locator('.yu-shelf-card-details').evaluate(el=>el===document.activeElement),'Escape returns focus to the card');
  assert.equal(await docked.count(),1);
  // 另一张卡片（含底部“接着看”）切换右栏里的故事，顺序仍不变
  await cards.nth(2).locator('.yu-shelf-card-details').click();await selected(ids[2]);
  await cards.nth(0).locator('.yu-shelf-reading-footer').click();await selected(ids[0]);
  assert.equal(await page.locator('.yu-reader-layout').count(),0);assert.deepEqual(await order(),ids);
  // 搜索筛掉当前故事时阅读仍留在右栏
  await page.getByRole('searchbox',{name:'搜索书架'}).fill('不存在的故事名');await page.waitForTimeout(200);
  assert.equal(await docked.count(),1,'filtering keeps the open story');
  await page.getByRole('searchbox',{name:'搜索书架'}).fill('');
  // 全屏阅读：同一幅展开为全屏，“返回书架”或浏览器返回都收回右栏
  await docked.getByRole('button',{name:'下一页',exact:true}).click();
  await docked.getByRole('button',{name:'全屏阅读',exact:true}).click();await page.locator('.yu-reader-layout').waitFor();
  assert.equal(await page.locator('.yu-topbar').count(),0);assert.match(await page.locator('.yu-reader .yu-progress').getAttribute('aria-label'),/^第2幅/);
  await page.getByRole('button',{name:'返回书架',exact:true}).click();await docked.waitFor();
  assert.equal(await page.locator('.yu-reader-layout').count(),0);assert.match(await frame(),/^第2幅/);
  await docked.getByRole('button',{name:'全屏阅读',exact:true}).click();await page.locator('.yu-reader-layout').waitFor();
  await page.evaluate(()=>history.back());await docked.waitFor();assert.equal(await page.locator('.yu-reader-layout').count(),0,'back collapses into the column');

  // 跨宽度与高度往返时保留右栏选中项和页码；显式全屏不因放宽而收起。
  for(const [width,height] of [[900,800],[390,800],[1280,500],[1023,800]]){
   await page.setViewportSize({width,height});await dock.waitFor({state:'hidden'});await page.locator('.yu-reader').waitFor();
   assert.equal(await dock.count(),0,'narrow or short windows hide the right column');
   assert.match(await page.locator('.yu-reader .yu-progress').getAttribute('aria-label'),/^第2幅/);
   await page.setViewportSize({width:1280,height:800});await docked.waitFor();await selected(ids[0]);
   assert.match(await frame(),/^第2幅/,'resizing preserves the reading position');
   assert.equal(new URL(page.url()).pathname,'/','the restored column stays on the shelf');
  }
  await docked.getByRole('button',{name:'全屏阅读',exact:true}).click();
  await page.setViewportSize({width:900,height:800});await page.locator('.yu-reader-layout').waitFor();
  await page.setViewportSize({width:1280,height:800});await page.locator('.yu-reader-layout').waitFor();
  assert.equal(await dock.count(),0,'explicit fullscreen survives a resize round trip');
  await page.getByRole('button',{name:'返回书架',exact:true}).click();await docked.waitFor();

  // 中档 900：没有右栏，返回书架会关闭阅读；窄屏直接打开的故事也不会随放宽停靠。
  await page.setViewportSize({width:900,height:800});await page.locator('.yu-reader-layout').waitFor();
  assert.equal(await dock.count(),0,'no right-hand column below 1024px');
  await page.getByRole('button',{name:'返回书架',exact:true}).click();await cards.first().waitFor();
  await page.screenshot({path:path.join(b.directory,'library-900.png')});
  await cards.nth(1).locator('.yu-shelf-card-details').click();await page.locator('.yu-reader-layout').waitFor();
  await page.setViewportSize({width:1280,height:800});await page.locator('.yu-reader-layout').waitFor();
  assert.equal(await dock.count(),0,'a story opened fullscreen stays fullscreen');
  await page.getByRole('button',{name:'返回发现',exact:true}).click();await cards.first().waitFor();
 });
});

test('DESKTOP-LAYOUT-04: settings links use phone-sized sheets for requirements, frames, source and review at every width',options,async t=>{
 const b=await seededBrowser(t,'DRL-04',{viewport:{width:1280,height:800},completed:0});
 await b.execute(async()=>{
  const {page,url,f}=b,id=await seedReviewedStory(f);
  await page.goto(url);await topNav(page,'书架');
  await page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`).click();
  await page.locator('.yu-library-reader').getByRole('button',{name:'故事设置'}).click();
  const parent=dialog(page,'故事设置');await parent.waitFor();
  for(const [trigger,title] of [['制作要求','修改故事'],['查看分镜','分镜剧本'],['审核记录','审核记录'],['原文','故事从哪里来']]){
   await parent.getByRole('link',{name:trigger,exact:true}).first().click();
   const child=dialog(page,title);await child.waitFor();
   for(const width of [1280,900,390,900,1440]){
    await page.setViewportSize({width,height:800});
    await child.waitFor();
    assert.ok((await child.locator('.yu-sheet').boundingBox()).width<=480,title+' keeps phone width');
    assert.equal(await page.locator('.yu-workspace').count(),0,'never expands to a workspace');
    assert.equal(await parent.count(),1,'settings remain beneath the child');
   }
   await child.getByRole('button',{name:'关闭',exact:true}).click();await parent.waitFor();
  }
  await parent.getByRole('link',{name:'制作要求',exact:true}).click();
  const editor=dialog(page,'修改故事');await editor.getByRole('button',{name:'分镜',exact:true}).click();
  await editor.getByLabel(/^选择分镜/).selectOption('2');
  await editor.getByLabel(/^选择分镜/).selectOption('1');
  assert.ok(await editor.getByText('受控审核：配文未说明可见行动。',{exact:true}).isVisible(),'review guidance stays in the small editor');
  const caption=editor.getByLabel(/^旁白/);await caption.fill('跨屏保留的分镜草稿。');
  for(const width of [900,390,1440]){
   await page.setViewportSize({width,height:800});
   assert.equal(await caption.inputValue(),'跨屏保留的分镜草稿。');
   assert.equal(await editor.getByLabel(/^选择分镜/).inputValue(),'1');
  }
  await page.screenshot({path:path.join(b.directory,'story-editor-sheet.png')});
 });
});

test('DESKTOP-LAYOUT-06: create is a page beside the book choices, re-initializes on a new book and continues in story settings',options,async t=>{
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
  await form.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其它',exact:true}).click();await form.getByLabel('自定义主题或情节').fill('善意终有回响');
  // 表单自己的选书不重新挂载：已输入的主题保留
  await books.getByRole('button',{name:'列子',exact:true}).click();
  assert.equal(await form.getByLabel('自定义主题或情节').inputValue(),'善意终有回响');
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
  // 提交：桌面从选材直接打开准备流程。
  async function selectMaterial(){
   await form.getByRole('button',{name:'按章节',exact:true}).click();
   await form.getByRole('region',{name:'章节列表'}).getByRole('checkbox').first().check();
  }
  await books.getByRole('button',{name:'庄子',exact:true}).click();
  await selectMaterial();
  const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/reader/sessions'&&r.request().method()==='POST');
  await form.locator('.yu-discovery-submit').click();
  const request=(await created).request().postDataJSON();assert.equal(request.selection.bookId,'zhuangzi');assert.ok(request.selection.source);
  await storySettings(page).getByRole('list',{name:'完整审片流程'}).waitFor();
  await closeTop(page);await top('发现');await page.locator('.yu-new-story-link').click();await form.waitFor();
  await selectMaterial();
  const second=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/reader/sessions'&&r.request().method()==='POST');
  await form.locator('.yu-discovery-submit').click();const next=await(await second).json();
  await storySettings(page).getByRole('list',{name:'完整审片流程'}).waitFor();
  assert.ok(next.id);
  // 从“不挑了”进入同样打开新建页。
  await closeTop(page);await top('发现');await page.locator('.yu-surprise').click();await form.waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  // 从书架打开旧任务直接进入选材，提交到同一个任务。
  const intake=await seedStory(b.f,{pick:false});await page.goto(url);await top('书架');
  await page.locator(`[data-story-id="${intake}"] .yu-pending-story`).click();await form.waitFor();
  await choices.getByRole('button',{name:'选择列子',exact:true}).click();
  assert.equal(await books.getByRole('button',{name:'列子',exact:true}).getAttribute('aria-pressed'),'true');
  await selectMaterial();
  const updated=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/api/reader/sessions/${intake}/setup`);
  await form.locator('.yu-discovery-submit').click();
  assert.equal((await(await updated).json()).id,intake);
  await storySettings(page).getByRole('list',{name:'完整审片流程'}).waitFor();
  assert.equal((await b.f.read(intake)).selection.bookId,'列子');
 });
});

// 回到第一幅（已在第一幅时按钮禁用）
const toFirst=async page=>{const first=page.getByRole('button',{name:'第一页',exact:true});if(await first.isEnabled())await first.click();};
const pageIndex=page=>page.locator('.yu-progress').getAttribute('aria-label').then(label=>Number(label.match(/第(\d+)幅/)[1]));
async function openFirstStory(page,url){
 await page.goto(url);await page.locator('.yu-topbar nav').getByRole('button',{name:'书架'}).click();
 await page.locator('.yu-shelf-reading-footer').first().click();await page.locator('.yu-scene.is-current').waitFor();
 // 宽档在书架右栏打开：展开为全屏阅读
 if(await page.locator('.yu-library-reader .yu-reader').count())await page.locator('.yu-library-reader').getByRole('button',{name:'全屏阅读',exact:true}).click();
 await page.locator('.yu-reader-layout').waitFor();
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
  // 键盘选侧栏分镜；点击选分镜：翻到该页，侧栏保持打开
  await panel.getByRole('button',{name:'跳转到第 1 幅'}).focus();await page.keyboard.press('Enter');assert.equal(await pageIndex(page),1);
  await panel.getByRole('button',{name:'跳转到第 3 幅'}).click();assert.equal(await pageIndex(page),3);assert.equal(await panel.count(),1);
  // 配文行宽不超过 30em（含大一点的文字）
  const measure=()=>page.locator('.yu-scene-caption>p').evaluate(p=>p.getBoundingClientRect().width/parseFloat(getComputedStyle(p).fontSize));
  assert.ok(await measure()<=30.5,'caption within 30em');
  await page.screenshot({path:path.join(b.directory,'reader-1440.png')});
  // 大一点的文字：字号更大，行宽仍不超过 30em
  const normalSize=await page.locator('.yu-scene-caption>p').evaluate(p=>parseFloat(getComputedStyle(p).fontSize));
  await page.evaluate(()=>localStorage.setItem('yiyu-large-text','1'));await page.reload();await page.locator('.yu-scene.is-current').waitFor();
  assert.ok(await page.locator('.yu-scene-caption>p').evaluate(p=>parseFloat(getComputedStyle(p).fontSize))>normalSize,'large text is larger');
  assert.ok(await measure()<=30.5,'large caption within 30em');
  await page.evaluate(()=>localStorage.setItem('yiyu-large-text','0'));await page.reload();await page.locator('.yu-scene.is-current').waitFor();
  await page.getByRole('button',{name:'分镜列表',exact:true}).click();await panel.waitFor();
  // Escape：先关侧栏，再返回打开前的书架
  await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});assert.equal(await stage.count(),1);
  await page.keyboard.press('Escape');await page.locator('.yu-shelf').waitFor();
  // 结尾的“开启下一篇”打开新建页
  await openFirstStory(page,url);await page.getByRole('button',{name:'最后一页',exact:true}).click();await page.locator('.yu-next').click();
  await page.locator('.yu-ending').waitFor();await page.getByRole('button',{name:/开启下一篇/}).click();await page.locator('.yu-create-form').waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
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

test('DESKTOP-LAYOUT-05: only story settings retain the phone layout at every viewport width',options,async t=>{
 const b=await seededBrowser(t,'DRL-05',{viewport:{width:1280,height:800},completed:1});
 await b.execute(async()=>{
  const {page,url}=b;await openFirstStory(page,url);
  await page.getByRole('button',{name:'最后一页',exact:true}).click();assert.equal(await pageIndex(page),3);
  await page.getByRole('button',{name:'原文',exact:true}).click();await page.locator('.yu-reader-panel').waitFor();
  await page.getByRole('button',{name:'故事设置',exact:true}).click();
  const settings=dialog(page,'故事设置');await settings.waitFor();
  const titleRow=settings.locator('.yu-story-name > .yu-setting-row > p');
  const title=await titleRow.textContent();
  for(const width of [1280,900,390,900,1440]){
   await page.setViewportSize({width,height:800});
   await settings.getByRole('button',{name:'修改故事名',exact:true}).waitFor();
   assert.equal(await titleRow.textContent(),title);
   assert.equal(await page.locator('.yu-workspace').count(),0,'settings never turn into a multi-column workspace');
   assert.ok((await settings.locator('.yu-sheet').boundingBox()).width<=480,'phone content width');
   assert.equal(await settings.locator('.yu-settings-flow').count(),1,'the same production flow stays available');
   assert.ok(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth),'no horizontal overflow');
  }
  await settings.getByRole('button',{name:'修改故事名',exact:true}).click();
  const rename=dialog(page,'修改故事名');await rename.getByLabel('故事名',{exact:true}).fill('只在测试里保留的标题草稿');
  for(const width of [390,900,1280]){
   await page.setViewportSize({width,height:800});
   assert.equal(await rename.getByLabel('故事名',{exact:true}).inputValue(),'只在测试里保留的标题草稿');
  }
  page.once('dialog',d=>d.accept());await rename.getByRole('button',{name:'关闭',exact:true}).click();
  await settings.getByRole('button',{name:'关闭',exact:true}).click();
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
  for(const [name,label] of [['发现','发现'],['书架','书架'],['我的','我的']]){await topNav(page,name);assert.equal(await current(),label);assert.equal(await bar.locator('.yu-topbar-create').count(),0);}
  await topNav(page,'书架');await page.locator('.yu-shelf-heading .yu-primary').click();await page.locator('.yu-create-form').waitFor();assert.equal(await current(),'新建故事');
  // 书架滚到底：顶栏仍在，首行不被遮住；Shift+Tab 回到第一张卡片时卡片完全在顶栏之下
  await topNav(page,'书架');const barBottom=(await bar.boundingBox()).height;
  assert.ok((await page.locator('.yu-shelf h1').boundingBox()).y>=barBottom,'first row below the bar');
  await page.evaluate(()=>scrollTo(0,document.scrollingElement.scrollHeight));await page.waitForTimeout(200);
  assert.equal((await bar.boundingBox()).y,0,'bar visible after scrolling');
  const cards=page.locator('.yu-shelf-card-details');await cards.last().focus();
  for(let i=0;i<40&&!await cards.first().evaluate(el=>el===document.activeElement);i++)await page.keyboard.press('Shift+Tab');
  assert.ok((await cards.first().boundingBox()).y>=barBottom,'focused card fully below the bar');
  // 设置子面板关闭后回到原书架，再用顶栏离开。
  const openEditor=async()=>{await topNav(page,'书架');await cards.first().click();await page.locator('.yu-library-reader').getByRole('button',{name:'故事设置'}).click();await storySettings(page).getByText('制作要求',{exact:true}).first().click();await dialog(page,'修改故事').waitFor();};
  await openEditor();assert.equal(await current(),'书架','the shelf remains underneath the settings sheets');
  await closeTop(page);await closeTop(page);await topNav(page,'书架');await page.locator('.yu-library').waitFor();
  await openEditor();await closeTop(page);await closeTop(page);await topNav(page,'发现');await page.locator('.yu-discover').waitFor();
  // 从发现页正文进入新建，再切到我的。
  await page.locator('.yu-new-story-link').click();await page.locator('.yu-create-form').waitFor();await topNav(page,'我的');await page.locator('.yu-profile').waitFor();
  // 选题工作区 → 返回修改书籍 → 书架：落到书架而不是工作区
  const intake=await seedStory(f,{pick:false});await page.goto(url);await topNav(page,'书架');
  await page.locator(`[data-story-id="${intake}"] .yu-pending-story`).click();await page.locator('.yu-create-form').waitFor();
  await topNav(page,'书架');await page.locator('.yu-library').waitFor();assert.equal(await page.locator('.yu-workspace').count(),0);assert.ok(intake);
  // 阅读 → 故事设置 → 新建故事 → 发现：回到发现，地址为 /
  await b.reader(ids[0]);await page.locator('.yu-scene.is-current').waitFor();
  await page.getByRole('button',{name:'故事设置',exact:true}).click();await storySettings(page).waitFor();await closeTop(page);
  await page.getByRole('button',{name:'返回发现',exact:true}).click();
  await topNav(page,'发现');
  await page.locator('.yu-new-story-link').click();await page.locator('.yu-create-form').waitFor();
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
  await topNav(page,'书架');
  const card=page.locator(`[data-story-id="${ids[0]}"]`),before=commands.length;
  // 卡片上的删除：确认框居中，保留故事
  await card.getByRole('button',{name:/^删除《/}).click();await page.getByRole('dialog',{name:'删除这篇故事？',exact:true}).waitFor();await page.waitForTimeout(250);
  assert.ok(await centeredSheet(page,'删除这篇故事？'),'删除这篇故事？');await page.getByRole('button',{name:'保留故事',exact:true}).click();
  // 右栏“故事设置”（与阅读页设置按钮同一入口）里的改名、署名与下载也是居中对话框
  await card.locator('.yu-shelf-card-details').click();await page.locator('.yu-library-reader').getByRole('button',{name:'故事设置'}).click();await storySettings(page).waitFor();
  const settings=storySettings(page);
  for(const [label,title] of [['修改故事名','修改故事名'],['编辑署名与转载说明','署名与转载']]){
   await settings.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog',{name:title,exact:true}).waitFor();await page.waitForTimeout(250);
   assert.ok(await centeredSheet(page,title),title);await closeTop(page);
  }
  assert.equal(commands.slice(before).filter(c=>/rename|publication|title|library\//.test(c.path)).length,0,'nothing saved');
  await settings.getByRole('button',{name:/下载 PDF/}).click();await page.getByRole('dialog',{name:'作品还未署名',exact:true}).waitFor();await page.waitForTimeout(250);
  assert.ok(await centeredSheet(page,'作品还未署名'),'作品还未署名');await page.getByRole('dialog',{name:'作品还未署名',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await settings.getByText('替换选题',{exact:true}).first().click();await page.getByRole('dialog',{name:'替换选题',exact:true}).getByRole('button',{name:'取消替换',exact:true}).waitFor();await page.waitForTimeout(250);
  assert.ok(await centeredSheet(page,'替换选题'),'替换选题');await page.getByRole('dialog',{name:'替换选题',exact:true}).getByRole('button',{name:'取消替换',exact:true}).click();await page.waitForTimeout(300);
  await closeTop(page);await topNav(page,'书架');
  // 卡片上的收藏触发提示：提示可见且不压住顶栏
  await card.getByRole('button',{name:/^收藏《/}).click();const toast=page.locator('.yu-toast');await toast.waitFor();
  const toastBox=await toast.boundingBox(),barBox=await page.locator('.yu-topbar').boundingBox();
  assert.ok(toastBox.y>barBox.y+barBox.height&&toastBox.y+toastBox.height<=800,'toast visible and clear of the bar');
  // 选题工作区里的“修改故事”与“故事原文”也是居中对话框
  await seedStory(f,{confirm:false});await page.goto(url);await topNav(page,'书架');await page.locator('.yu-production-row').first().click();await storySettings(page).waitFor();
  for(const [trigger,title] of [['原文','故事原文'],['制作要求','修改故事'],['重新选择故事','重新选择故事']]){await storySettings(page).getByText(trigger,{exact:true}).first().click();await page.getByRole('dialog',{name:title,exact:true}).waitFor();await page.waitForTimeout(250);assert.ok(await centeredSheet(page,title),title);await closeTop(page);}
  // 删除后的撤销条：可见且不压住顶栏
  await storySettings(page).getByRole('link',{name:'返回书架',exact:true}).click();await topNav(page,'书架');
  await page.locator(`[data-story-id="${ids[0]}"]`).getByRole('button',{name:/^删除《/}).click();
  await page.getByRole('button',{name:'删除故事',exact:true}).last().click();const undo=page.locator('.yu-undo-notice');await undo.waitFor();
  const undoBox=await undo.boundingBox(),bar=await page.locator('.yu-topbar').boundingBox();assert.ok(undoBox.y>bar.y+bar.height&&undoBox.y+undoBox.height<=800,'undo notice visible and clear of the bar');
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
  // 制作列表在 1024px 停靠于右栏，1023px 回到书架。
  await seedStory(f,{pick:false});
  await size(1024);await page.reload();await topNav(page,'书架');
  assert.equal(await page.locator('.yu-library-productions').evaluate(el=>getComputedStyle(el).position),'sticky','library column at 1024');await noOverflow('library 1024');
  await size(1023);assert.equal(await page.locator('.yu-library-productions').count(),0,'no library column at 1023');await noOverflow('library 1023');
  await size(1024);
  // 我的：1023 单栏，1024 两栏
  await topNav(page,'我的');const columns=()=>page.locator('.yu-profile').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
  await size(1023);assert.equal(await columns(),1);await size(1024);assert.equal(await columns(),2);
  // 新建页：1023 上下，1024 左右
  await topNav(page,'书架');await page.locator('.yu-shelf-heading .yu-primary').click();const form=page.locator('.yu-create-form'),choices=page.locator('.yu-create-choices');await form.waitFor();
  await size(1023);assert.ok((await form.boundingBox()).y>(await choices.boundingBox()).y+100,'stacked below 1024');
  await size(1024);assert.ok((await form.boundingBox()).x>(await choices.boundingBox()).x+100,'side by side at 1024');await noOverflow('create');
  // 故事编辑在 1279、1280 都使用同一小屏面板，其他网页继续响应式重排。
  await topNav(page,'书架');await page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`).click();await page.locator('.yu-library-reader').getByRole('button',{name:'故事设置'}).click();await storySettings(page).getByText('制作要求',{exact:true}).first().click();
  const editor=dialog(page,'修改故事');await editor.waitFor();
  for(const width of [1279,1280]){await size(width);assert.ok((await editor.locator('.yu-sheet').boundingBox()).width<=480);assert.equal(await page.locator('.yu-workspace').count(),0);}
  await closeTop(page);await closeTop(page);
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
  const openWorkspace=async()=>{await page.goto(url);await topNav(page,'书架');await page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`).click();await page.locator('.yu-library-reader').getByRole('button',{name:'故事设置'}).click();await storySettings(page).waitFor();};
  // 旋转：工作区里打开“修改故事名”并输入，跨档两次后仍在最上层，焦点与输入保留
  await size(1133,744);await openWorkspace();await storySettings(page).getByRole('button',{name:'修改故事名',exact:true}).click();
  const rename=page.getByRole('dialog',{name:'修改故事名',exact:true});await rename.getByLabel('故事名',{exact:true}).fill('转屏后的故事名');
  const topmost=()=>page.evaluate(()=>{const d=[...document.querySelectorAll('dialog[open]')].find(x=>x.getAttribute('aria-label')==='修改故事名');const s=d.querySelector('.yu-sheet').getBoundingClientRect();const hit=document.elementFromPoint(s.left+s.width/2,s.top+20);return d.contains(hit)&&d.contains(document.activeElement);});
  await size(744,1133);assert.equal(await page.locator('.yu-world').getAttribute('data-layout'),'phone');
  await page.getByRole('dialog',{name:'故事设置',exact:true}).waitFor();assert.ok(await topmost(),'rename stays topmost with focus at 744');
  assert.equal(await rename.getByLabel('故事名',{exact:true}).inputValue(),'转屏后的故事名');
  await size(1133,744);assert.ok(await topmost(),'rename stays topmost at 1133');assert.equal(await rename.getByLabel('故事名',{exact:true}).inputValue(),'转屏后的故事名');
  await rename.getByRole('button',{name:'关闭',exact:true}).click();
  // 分镜选择、审片意见与草稿在所有宽度都留在同一个小屏编辑器里。
  await size(1280);await storySettings(page).getByText('制作要求',{exact:true}).first().click();
  const editor=dialog(page,'修改故事');await editor.getByRole('button',{name:'分镜',exact:true}).click();
  await editor.getByLabel(/^选择分镜/).selectOption('2');await editor.getByLabel(/^选择分镜/).selectOption('1');
  assert.ok(await editor.getByText('受控审核：配文未说明可见行动。',{exact:true}).isVisible());
  await editor.getByLabel(/^旁白/).fill('跨档保留的旁白。');
  for(const width of [390,1280]){await size(width);assert.equal(await editor.getByLabel(/^旁白/).inputValue(),'跨档保留的旁白。');}
  await closeTop(page);await closeTop(page);
  if(await page.getByRole('button',{name:'返回发现',exact:true}).count())await page.getByRole('button',{name:'返回发现',exact:true}).click();
  // 新建页的自定义主题：1280 → 390 → 1280
  await topNav(page,'发现');await page.locator('.yu-new-story-link').click();const form=page.locator('.yu-create-form');await form.waitFor();
  await form.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其它',exact:true}).click();await form.getByLabel('自定义主题或情节').fill('跨档保留的主题');
  await size(390);const sheet=page.getByRole('dialog',{name:'这一篇，想怎样读？',exact:true});await sheet.waitFor();assert.equal(await sheet.getByLabel('自定义主题或情节').inputValue(),'跨档保留的主题');
  await size(1280);assert.equal(await page.locator('.yu-create-form').getByLabel('自定义主题或情节').inputValue(),'跨档保留的主题');
  // 修改已有任务的提取条件时，标题草稿也跨档保留。
  const legacy=await seedStory(f,{pick:false});await page.goto(url);await topNav(page,'书架');
  await page.locator(`[data-story-id="${legacy}"] .yu-pending-story`).click();await form.waitFor();
  await form.getByRole('button',{name:'按主题',exact:true}).click();await form.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其它',exact:true}).click();await form.getByLabel('自定义主题或情节',{exact:true}).fill('跨档保留的标题');
  await size(390);await sheet.waitFor();assert.equal(await sheet.getByLabel('自定义主题或情节',{exact:true}).inputValue(),'跨档保留的标题');
  await size(1280);assert.equal(await form.getByLabel('自定义主题或情节',{exact:true}).inputValue(),'跨档保留的标题');
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
   {name:'story-editor',headings:['.yu-revision-field'],setup:async()=>{await page.goto(url);await topNav(page,'书架');await page.locator(`[data-story-id="${id}"] .yu-shelf-card-details`).click();await page.locator('.yu-library-reader').getByRole('button',{name:'故事设置'}).click();await storySettings(page).getByText('制作要求',{exact:true}).first().click();await dialog(page,'修改故事').waitFor();await dialog(page,'修改故事').getByRole('button',{name:'分镜',exact:true}).click();}},
   {name:'create',headings:['.yu-choice-label'],setup:async()=>{await page.goto(url);await topNav(page,'发现');await page.locator('.yu-new-story-link').click();await page.locator('.yu-create-form').waitFor();}},
   {name:'reader',headings:['.yu-scene-caption>p'],setup:async()=>{await b.reader(id);await page.locator('.yu-scene.is-current').waitFor();await page.getByRole('button',{name:'分镜列表',exact:true}).click();}},
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

test('DESKTOP-LAYOUT-03b: on a touch tablet in the medium tier, top-bar controls are 44px, form text is 16px and a story opens full screen',options,async t=>{
 const b=await seededBrowser(t,'DRL-03b',{viewport:{width:900,height:800},completed:1,touch:true});
 await b.execute(async()=>{
  const {page,url,ids}=b;await page.goto(url);
  assert.equal(await page.locator('.yu-world').getAttribute('data-layout'),'shell');
  for(const el of await page.locator('.yu-topbar button').all()){const box=await el.boundingBox();assert.ok(box.height>=44&&box.width>=44,'top-bar target 44px');}
  await topNav(page,'书架');assert.equal(await page.locator('.yu-shelf-search input').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),16,'16px form text on coarse pointers');
  await page.locator(`[data-story-id="${ids[0]}"] .yu-shelf-card-details`).click();await page.locator('.yu-reader').waitFor();
  assert.equal(await page.locator('.yu-library-reader').count(),0,'no right column; the reader takes the screen');
 });
});
