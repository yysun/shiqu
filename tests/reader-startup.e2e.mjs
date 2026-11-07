// 验证书库启动、阅读操作持久化与阅读区挂载后的手势监听。
import test from 'node:test';
import assert from 'node:assert/strict';
import {storyBrowser} from './fixtures/story-browser.mjs';
import {insertReaderStory,makeStory} from './fixtures/story.mjs';
import {png} from './fixtures/images.mjs';
import {until} from './fixtures/production.mjs';

for(const delayed of ['sessions','deletions'])test(`startup waits for ${delayed}, reads the library once, and ignores cached studio history`,async t=>{
 const b=await storyBrowser(t,'reader-startup-'+delayed),{page,f,context,url}=b;
 const story=await insertReaderStory(f.app,{...makeStory(4),title:'当前书库故事',pages:makeStory(4).pages.map(p=>({...p,image:'/api/media/current.png'}))});
 await f.app.services.media.put('current.png',png,{contentType:'image/png'});
 await f.app.services.database.prepare("UPDATE stories SET last_read_at='2026-11-04T00:00:00Z' WHERE id=?").bind(story.id).run();
 await context.addInitScript(()=>{
  localStorage.setItem('yiyu-reading',JSON.stringify([{storyId:'zhongli',page:7,updatedAt:'2099-01-01'}]));
  localStorage.setItem('shiqu-last-read','zhongli');
 });
 const requests=[];page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/'))requests.push(path);});
 let release,arrived;
 const pending=new Promise(resolve=>release=resolve),started=new Promise(resolve=>arrived=resolve);
 t.after(()=>release());
 await page.route('**/api/reader/'+delayed+(delayed==='deletions'?'?inventory=1':''),async route=>{
  const response=await route.fetch();arrived();await pending;await route.fulfill({response});
 });
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await started;
 await page.getByRole('button',{name:'发现',exact:true}).click();
 await page.getByText('正在打开故事…',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'继续阅读'+story.title,exact:true}).count(),0);
 assert.equal(await page.getByText('把下一篇故事留在这里',{exact:true}).count(),0);
 release();
 await page.getByRole('button',{name:'继续阅读'+story.title,exact:true}).waitFor();
 assert.equal(requests.filter(path=>path==='/api/reader/sessions').length,1);
 assert.equal(requests.filter(path=>path==='/api/reader/deletions').length,1);
 assert.equal(requests.filter(path=>/^\/api\/(admin|stories|books|me|events)(?:\/|$)/.test(path)).length,0);
 assert.equal(await page.getByText('一车梨的秘密',{exact:true}).count(),0);
 await b.screenshot('current-library-ready');
 assert.equal(f.control.calls.length,0);

 if(delayed==='sessions'){
  await page.getByRole('button',{name:'继续阅读'+story.title,exact:true}).click();
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await until(async()=>(await f.read(story.id)).page===1);
  await page.getByRole('button',{name:'收藏故事',exact:true}).click();
  await until(async()=>(await f.read(story.id)).saved===true);
  await page.reload();
  await page.getByRole('button',{name:'取消收藏',exact:true}).waitFor();
  assert.equal((await f.read(story.id)).page,1);
  await page.getByRole('button',{name:'返回发现',exact:true}).click();
  await page.getByRole('button',{name:'书架',exact:true}).click();
  await page.getByRole('button',{name:'删除《'+story.title+'》',exact:true}).click();
  await page.getByRole('dialog',{name:'删除这篇故事？',exact:true}).getByRole('button',{name:'删除故事',exact:true}).click();
  await page.getByRole('button',{name:'撤销删除',exact:true}).click();
  await page.getByRole('button',{name:'继续阅读《'+story.title+'》',exact:true}).waitFor();
  const restored=await f.read(story.id);assert.equal(restored.page,1);assert.equal(restored.saved,true);
  assert.equal(f.control.calls.length,0);assert.equal(f.control.plans.length,0);
 }
});

test('reader uses the discovery hero native scrolling model across docking, mouse and touch',async t=>{
 const b=await storyBrowser(t,'reader-native-scroll',{viewport:{width:1280,height:800},hasTouch:true}),{page,f,url,context}=b;
 await b.execute(async()=>{
  const first=await insertReaderStory(f.app,{...makeStory(8),title:'手势验证故事',pages:makeStory(8).pages.map(p=>({...p,image:'/api/media/gesture.png'}))});
  const second=await insertReaderStory(f.app,{...makeStory(3),title:'发现页对照故事',pages:makeStory(3).pages.map(p=>({...p,image:'/api/media/gesture.png'}))});
  await f.app.services.media.put('gesture.png',png,{contentType:'image/png'});
  for(const id of [first.id,second.id])await f.json(`sessions/${id}/progress`,'POST',{storyId:id,page:0,saved:false});
  const expectPage=number=>page.waitForFunction(n=>document.querySelector('.yu-progress')?.getAttribute('aria-label').startsWith(`第${n}幅`),number);
  const nativeStyle=selector=>page.locator(selector).evaluate(el=>{const s=getComputedStyle(el);return {overflow:s.overflowX,snap:s.scrollSnapType,stop:getComputedStyle(el.firstElementChild).scrollSnapStop};});
  const center=async()=>{const box=await page.locator('.yu-swipe-surface').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height*.4);return box;};
  await page.goto(url);await page.getByRole('button',{name:'发现',exact:true}).click();await page.locator('.yu-hero-track').waitFor();
  const reference=await nativeStyle('.yu-hero-track');
  await page.getByRole('button',{name:'书架',exact:true}).click();await page.locator(`[data-story-id="${first.id}"] .yu-shelf-card-details`).click();await page.locator('.yu-library-reader .yu-reader').waitFor();
  assert.deepEqual(await nativeStyle('.yu-filmstrip'),reference,'reader and hero share native overflow and snapping');
  let box=await center();
  // 读取真实滚轮事件最终的取消状态，防止重新引入横向 preventDefault 或阈值翻页。
  const delivered=page.evaluate(()=>new Promise(resolve=>window.addEventListener('wheel',event=>resolve(event.defaultPrevented),{once:true})));
  await page.mouse.wheel(box.width*.75,0);assert.equal(await delivered,false);await expectPage(2);
  await page.getByRole('button',{name:'全屏阅读',exact:true}).click();await page.locator('.yu-reader-layout').waitFor();box=await center();
  // 鼠标按住时位移与 scrollLeft 一致；往回拖时即刻返回，不受一次手势只能翻一页的锁限制。
  await page.mouse.move(box.x+box.width*.8,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.4,{steps:6});
  const partial=await page.locator('.yu-filmstrip').evaluate(el=>el.scrollLeft/el.clientWidth);
  assert.ok(partial>1.15&&partial<1.25,'partial drag follows the pointer before release');
  await page.mouse.move(box.x+box.width*.8,box.y+box.height*.4,{steps:6});
  assert.ok(Math.abs(await page.locator('.yu-filmstrip').evaluate(el=>el.scrollLeft/el.clientWidth)-1)<.02,'reversing the same drag returns immediately');
  await page.mouse.move(box.x+box.width*.15,box.y+box.height*.4,{steps:8});await page.mouse.up();await expectPage(3);
  // 触摸横滑经过浏览器原生滚动；纵向滑动仍由页面操作处理。
  const input=await context.newCDPSession(page);box=await center();
  await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.8,y:box.y+box.height*.4}]});
  for(let step=1;step<=10;step++)await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*(.8-.065*step),y:box.y+box.height*.4}]});
  await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expectPage(4);await input.detach();
  await page.getByRole('button',{name:'返回书架',exact:true}).click();await page.locator('.yu-library-reader .yu-reader').waitFor();box=await center();
  await page.mouse.wheel(-box.width*.75,0);await expectPage(3);
  await page.mouse.wheel(0,70);await expectPage(4);
  await page.getByRole('button',{name:'最后一页',exact:true}).click();await expectPage(8);box=await center();
  await page.mouse.wheel(box.width*.75,0);await page.locator('.yu-ending').waitFor();
  await page.mouse.wheel(-box.width*.75,0);await page.locator('.yu-swipe-surface').waitFor();await expectPage(8);
  await page.getByRole('button',{name:'故事设置',exact:true}).click();await page.getByRole('dialog',{name:'故事设置',exact:true}).waitFor();
  await page.mouse.wheel(box.width*.75,0);assert.match(await page.locator('.yu-progress').getAttribute('aria-label'),/^第8幅/,'modal sheets block page turns');
  assert.equal(f.control.calls.length,0);
 });
});
