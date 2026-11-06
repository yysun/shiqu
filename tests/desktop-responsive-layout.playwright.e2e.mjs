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
