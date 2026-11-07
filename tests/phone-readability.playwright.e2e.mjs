// 手机可读性与触控区 E2E：在受控生产夹具中走遍手机界面的各个状态，逐状态测量字号、触控区、对比度与布局。
// 每个状态在 360/390/430 做完整测量，在 320/540/600/767 只测布局（全部是手机界面，不跨越 768×560 的结构切换；
// 桌面布局由 desktop-responsive-layout E2E 覆盖）；所有状态测完后统一断言，失败清单写入证据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {storyBrowser,runDirectory} from './fixtures/story-browser.mjs';
import {auditPhone,failures} from './fixtures/phone-audit.mjs';
import {until} from './fixtures/production.mjs';
import {checkoutFixture,startDevelopment,saveGoogle} from './fixtures/development.mjs';
import {chromium} from 'playwright';

const fullWidths=[360,390,430],layoutWidths=[320,540,600,767],height=844;
// 基线时已存在的省略号截断，由 M0 记录：生产行标题与错误摘要、书架标签与封面书名徽标。
const truncationAllowlist=['yu-production-title>em','yu-production-error','yu-shelf-tags','yu-shelf-book-badge'];
const dialog=(page,name)=>page.getByRole('dialog',{name,exact:true});
const phone={viewport:{width:390,height},hasTouch:true,isMobile:true};
async function auditWidths(page,name,report,directory){
 for(const width of [...fullWidths,...layoutWidths]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);
  // 等待有限次数的动画（面板淡入等）结束，避免在半透明时测量对比度
  await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getComputedTiming().iterations===Infinity),null,{timeout:3000}).catch(()=>{});
  const result=await auditPhone(page,{checks:fullWidths.includes(width)?['text','targets','contrast','layout']:['layout']});
  report[name+'@'+width]={failures:failures(result,{truncationAllowlist}),contrast:result.contrast,truncated:result.layout.truncated};
  if(width===390)await page.screenshot({path:path.join(directory,name+'.png'),fullPage:true});
 }
 await page.setViewportSize({width:390,height});await page.waitForTimeout(150);
}
const failedOf=report=>Object.fromEntries(Object.entries(report).map(([key,value])=>[key,Object.fromEntries(Object.entries(value.failures).filter(([,list])=>list.length))]).filter(([,value])=>Object.keys(value).length));

test('PHONE-READABILITY: every phone state has readable text, 44px targets (26px workflow rows), contrast and intact layout',{timeout:600000},async t=>{
 const b=await storyBrowser(t,'phone-readability',phone);
 const {f,page,url}=b,report={},unreached=[],named=[],original=f.control.beforeText;
 const directory=path.join(b.directory,'audit');await mkdir(directory,{recursive:true});
 const audit=name=>auditWidths(page,name,report,directory);
 // 单个状态失败时记录为未到达，继续测量后续状态，便于一次得到完整清单。
 async function step(name,body){try{await body();}catch(error){unreached.push({name,error:error.message.split('\n')[0]});await page.screenshot({path:path.join(directory,'unreached-'+name+'.png')}).catch(()=>{});}}
 const tab=name=>page.locator('.yu-tabbar').getByRole('button',{name:new RegExp(name)}).click();
 // 用最上层面板的关闭按钮；Escape 会被阅读器的键盘处理同时关掉下层面板。
 const close=async()=>{await page.getByRole('dialog').last().getByRole('button',{name:'关闭',exact:true}).first().click();await page.waitForTimeout(200);};
 // 具名字号检查在最后统一断言，不中断后续状态。
 const atLeast=async(name,locator)=>{const sizes=await locator.evaluateAll(list=>list.map(el=>parseFloat(getComputedStyle(el).fontSize)));if(!sizes.length)unreached.push({name,error:'no element'});else if(Math.min(...sizes)<12)named.push({name,sizes});};
 // 第二、三篇故事：按标题提取并进入确认；夹具的 create 只适用于第一篇。
 async function createStory(){
  await page.goto(url);await tab('发现');await page.getByRole('button',{name:'选择庄子',exact:true}).click();const sheet=dialog(page,'这一篇，想怎样读？');
  const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reader/sessions'&&response.request().method()==='POST');
  await sheet.getByRole('button',{name:'进入故事提取',exact:true}).click();const saved=await(await created).json();
  const picker=dialog(page,'故事设置');await picker.getByRole('button',{name:'输入标题',exact:true}).click();await picker.getByLabel('故事标题',{exact:true}).fill('乌龟报恩');await picker.getByRole('button',{name:'按标题提取',exact:true}).click();
  await picker.getByRole('button').filter({has:page.getByText('乌龟报恩',{exact:true})}).first().click();await until(async()=>(await f.read(saved.id)).intake.phase==='confirming',15000);
  await page.getByRole('link',{name:'开始制作',exact:true}).click();return saved;
 }
 const releaseImages=()=>{f.control.hold=false;for(const call of f.control.calls)call.resolve?.();};
 // 夹具原有的文本钩子负责推荐与审核回执；场景只在它外面包一层，避免叠加。
 const wrap=override=>{f.control.beforeText=async(kind,payload,schema)=>(await override(kind,payload,schema))??original?.(kind,payload,schema);};

 await b.execute(async()=>{
  await page.goto(url);
  // 1. 空书库的发现与我的。
  await step('discover-empty',async()=>{await tab('发现');await page.locator('.yu-feature-empty').waitFor();await audit('discover-empty');});
  await step('me',async()=>{await tab('我的');await page.getByRole('button',{name:/阅读偏好/}).waitFor();await audit('me');});
  await step('reading-preferences',async()=>{await page.getByRole('button',{name:/阅读偏好/}).click();await dialog(page,'舒服地读').waitFor();await audit('reading-preferences');await close();});

  // 2. 新建故事表单。
  let first;
  await step('creation',async()=>{
   await tab('发现');await page.getByRole('button',{name:'选择庄子',exact:true}).click();const sheet=dialog(page,'这一篇，想怎样读？');await sheet.waitFor();await audit('creation');
   await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'其他',exact:true}).click();await sheet.getByLabel('写下想看的主题').fill('善意终有回响');
   const scope=sheet.locator('details').first();if(await scope.count())await scope.locator('summary').click();
   await audit('creation-custom');
   await sheet.getByRole('group',{name:'故事主题'}).getByRole('button',{name:'不限定主题',exact:true}).click();
   const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reader/sessions'&&response.request().method()==='POST');
   await sheet.getByRole('button',{name:'进入故事提取',exact:true}).click();first=await(await created).json();
  });

  // 3. 故事设置中的选题与确认。
  await step('intake',async()=>{
   const picker=dialog(page,'故事设置');await picker.getByRole('button',{name:'开始提取',exact:true}).waitFor();await audit('intake-idle');
   await picker.getByRole('button',{name:'输入标题',exact:true}).click();await picker.getByLabel('故事标题',{exact:true}).fill('乌龟报恩');await audit('intake-title');
   await picker.getByRole('button',{name:'按标题提取',exact:true}).click();const candidate=picker.getByRole('button').filter({has:page.getByText('乌龟报恩',{exact:true})});await candidate.first().waitFor();await audit('intake-candidates');
   await candidate.first().click();await until(async()=>(await f.read(first.id)).intake.phase==='confirming',15000);await page.getByRole('link',{name:'开始制作',exact:true}).waitFor();await audit('intake-confirming');
  });
  for(const [name,trigger,title] of [['setup-source','原文','故事原文'],['setup-editor','制作要求','修改故事'],['setup-reselect','重新选择故事','重新选择故事']])
   await step(name,async()=>{await dialog(page,'故事设置').getByText(trigger,{exact:true}).first().click();await dialog(page,title).waitFor();await page.waitForTimeout(300);await audit(name);await close();});

  // 4. 生成中：图片调用被夹具挂起。
  await step('generating',async()=>{
   f.control.hold=true;await page.getByRole('link',{name:'开始制作',exact:true}).click();
   await page.locator('.production-stage-state').first().waitFor({timeout:20000});await audit('generating-settings');
   await atLeast('production-stage-state',page.locator('.production-stage-state'));
   await close();if(await page.getByRole('dialog').count())await close();
   await tab('书架');await page.locator('.yu-shelf-row,.yu-production').first().waitFor();await audit('generating-shelf');
   await tab('发现');await audit('generating-discover');
   // 只放行第一幅：阅读第二幅时显示绘制中状态。
   await until(()=>f.control.calls.some(call=>call.page===0),15000);f.control.calls.find(call=>call.page===0).resolve();
   await b.reader(first.id);await page.locator('.yu-scene.is-current').waitFor();await page.locator('.yu-next').click();await page.locator('.yu-drawing').waitFor({timeout:15000});await audit('generating-reader');
  });
  releaseImages();await until(async()=>(await f.read(first.id)).state==='completed',30000).catch(()=>{});

  // 5. 已完成故事的书架与故事设置。
  await step('completed-shelf',async()=>{await page.goto(url);await tab('书架');await page.locator('.yu-shelf-book-badge').first().waitFor();await audit('completed-shelf');});
  const openSettings=async()=>{await b.reader(first.id);return b.settings();};
  await step('completed-settings',async()=>{const settings=await openSettings();await settings.getByRole('button',{name:'修改故事名',exact:true}).waitFor();await audit('completed-settings');});
  await step('unsigned-export',async()=>{await dialog(page,'故事设置').getByRole('button',{name:/下载 PDF/}).click();await dialog(page,'作品还未署名').waitFor();await audit('unsigned-export');await dialog(page,'作品还未署名').getByRole('button',{name:'取消',exact:true}).click();});
  await step('publication-editor',async()=>{await dialog(page,'故事设置').getByRole('button',{name:/署名与转载/}).first().click();await dialog(page,'署名与转载').waitFor();await page.waitForTimeout(300);await audit('publication-editor');await close();});
  await step('reselection',async()=>{const settings=dialog(page,'故事设置');await settings.getByText('替换选题',{exact:true}).first().click();const picker=dialog(page,'替换选题');await picker.getByRole('button',{name:'取消替换',exact:true}).waitFor();await page.waitForTimeout(300);await audit('reselection');await picker.getByRole('button',{name:'取消替换',exact:true}).click();await picker.waitFor({state:'hidden'});});
  await step('rename',async()=>{const settings=await openSettings();await settings.getByRole('button',{name:'修改故事名',exact:true}).click();await dialog(page,'修改故事名').waitFor();await audit('rename');await close();});
  await step('script',async()=>{await dialog(page,'故事设置').getByRole('link',{name:'查看分镜',exact:true}).click();await dialog(page,'分镜剧本').waitFor();await audit('script');await close();});
  await step('review-history',async()=>{await dialog(page,'故事设置').getByText('审核记录',{exact:true}).first().click();await dialog(page,'审核记录').waitFor();await page.waitForTimeout(300);await audit('review-history');await close();});
  await step('revision-tabs',async()=>{
   await dialog(page,'故事设置').getByText('制作要求',{exact:true}).first().click();const editor=dialog(page,'修改故事');await editor.waitFor();
   assert.ok((await editor.getByLabel(/^制作要求/).inputValue()).length>0,'制作要求 tab keeps the saved production prompt');
   for(const name of ['制作要求','验收要求','画风','叙事详略','分镜']){await editor.getByRole('tab',{name}).or(editor.getByRole('button',{name,exact:true})).first().click();await page.waitForTimeout(200);await audit('revision-'+name);}
   await close();
  });
  await step('delete-confirm',async()=>{await close();await page.goto(url);await tab('书架');await page.getByRole('button',{name:/^删除《/}).first().click();await page.getByRole('dialog',{name:'删除这篇故事？'}).waitFor();await audit('delete-confirm');await page.getByRole('button',{name:'保留故事',exact:true}).click();});

  // 6. 阅读：页面、分镜列表、原文、结尾，以及边缘点按与滑动翻页。
  await step('reader',async()=>{
   await b.reader(first.id);await page.locator('.yu-scene.is-current').waitFor();await audit('reader-page');
   const index=()=>page.locator('.yu-progress').getAttribute('aria-label');
   const stage=await page.locator('.yu-swipe-surface').boundingBox();
   let before=await index();await page.mouse.click(stage.x+stage.width-8,stage.y+stage.height/2);await until(async()=>await index()!==before);
   before=await index();await page.mouse.click(stage.x+8,stage.y+stage.height/2);await until(async()=>await index()!==before);
   before=await index();await page.mouse.move(stage.x+stage.width*.8,stage.y+stage.height/2);await page.mouse.down();await page.mouse.move(stage.x+stage.width*.15,stage.y+stage.height/2,{steps:8});await page.mouse.up();await until(async()=>await index()!==before);
   const after=await index();await page.mouse.click(stage.x+stage.width/2,stage.y+stage.height/2);await page.locator('.yu-metadata-hidden').waitFor();assert.equal(await index(),after,'center tap toggles metadata without turning');
   await page.mouse.click(stage.x+stage.width/2,stage.y+stage.height/2);await page.locator('.yu-metadata-hidden').waitFor({state:'detached'});
   await page.getByRole('button',{name:'第一页',exact:true}).click();
  });
  await step('scene-list',async()=>{await page.getByRole('button',{name:'分镜列表',exact:true}).click();await dialog(page,'分镜列表').waitFor();await audit('scene-list');await close();});
  await step('source',async()=>{await page.getByRole('button',{name:'原文',exact:true}).click();await dialog(page,'故事从哪里来').waitFor();await page.waitForTimeout(300);await audit('source');await close();});
  await step('ending',async()=>{for(let i=0;i<10&&!(await page.locator('.yu-ending').count());i++)await page.locator('.yu-next').click();await page.locator('.yu-ending').waitFor();await audit('ending');});
  await step('hero',async()=>{await page.goto(url);await tab('发现');await page.locator('.yu-feature img').first().waitFor();await audit('discover-hero');});

  // 7. 审核问题：第一次审核返回一处配文问题。
  let second;
  await step('review-issues',async()=>{
   // 与 story-lifecycle C004 相同：审核保留基础回执并加一处问题，修复调用原样返回。
   wrap(async(kind,payload,schema)=>{if(kind==='review')return {...await original(kind,payload,schema),issues:[{page:1,category:'caption',problem:'受控审核：配文未说明可见行动。',instruction:'保留原文事件，明确第一幅的可见动作。'}]};if(kind==='repair')return {pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1]}))};});
   second=await createStory();await until(async()=>(await f.read(second.id)).state==='failed',20000);
   const settings=dialog(page,'故事设置');await settings.getByRole('link',{name:'手动修改第 1 幅',exact:true}).waitFor({timeout:20000});await audit('review-issues-settings');
   await settings.getByText('审核记录',{exact:true}).first().click();await dialog(page,'审核记录').waitFor();await page.waitForTimeout(300);await audit('review-issues-history');await close();
  });
  // 阅读中的审片提示：只改配文的修订沿用原图，复审被拦下后阅读页显示提示。
  await step('review-issues-reader',async()=>{
   await b.reader(first.id);const settings=await b.settings();await settings.getByRole('link',{name:'查看分镜',exact:true}).click();
   await dialog(page,'分镜剧本').getByRole('button',{name:'修改分镜',exact:true}).click();const editor=dialog(page,'修改故事');await editor.getByLabel(/^旁白/).fill('庄周醒来，仍记得蝴蝶在花间飞过。');await editor.getByRole('button',{name:'完成编辑',exact:true}).click();
   // 修改分镜会关闭分镜剧本（手机面板不超过两层）
   assert.equal(await dialog(page,'分镜剧本').count(),0);
   const [response]=await Promise.all([page.waitForResponse(r=>/\/api\/reader\/sessions\/[^/]+\/revisions$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST'),settings.getByRole('link',{name:'开始制作',exact:true}).click()]);
   const revised=await response.json();await until(async()=>(await f.read(revised.id)).state==='failed',20000);
   await b.reader(revised.id);await page.locator('.yu-reader-review-notice').waitFor();await audit('review-issues-reader');
  });
  f.control.beforeText=original;

  // 8. 失败与恢复：审核调用抛错。
  let third;
  await step('failure',async()=>{
   wrap(async kind=>{if(kind==='review')throw Error('受控失败');});
   third=await createStory();await until(async()=>(await f.read(third.id)).state==='failed'||!!(await f.read(third.id)).faults?.length,30000);
   const settings=dialog(page,'故事设置');await settings.getByText('重试生成',{exact:true}).first().waitFor({timeout:15000});await audit('failure-settings');
   await close();await page.goto(url);await tab('书架');await page.getByText(/重试生成|继续生成/).first().waitFor();await audit('failure-shelf');
  });
  f.control.beforeText=original;

  // 9. 删除、已删除的故事与默认署名。
  await step('undo-notice',async()=>{await page.goto(url);await tab('书架');await page.getByRole('button',{name:/^删除《/}).last().click();await page.getByRole('button',{name:'删除故事',exact:true}).click();await page.locator('.yu-undo-notice').waitFor();await audit('undo-notice');await page.getByRole('button',{name:'关闭撤销提示',exact:true}).click();});
  await step('deleted-stories',async()=>{await tab('我的');await page.getByRole('button',{name:/已删除的故事/}).click();await dialog(page,'已删除的故事').waitFor();await page.waitForTimeout(300);await audit('deleted-stories');await close();});
  await step('publication-defaults',async()=>{await page.getByRole('button',{name:/署名与转载/}).click();await dialog(page,'默认署名与转载说明').waitFor();await page.waitForTimeout(300);await audit('publication-defaults');await close();});

  const failed=failedOf(report);
  await writeFile(path.join(directory,'report.json'),JSON.stringify({unreached,named,failed,report},null,1));
  await writeFile(path.join(directory,'named.json'),JSON.stringify(named,null,1));
  assert.deepEqual(unreached,[],'every spec state is reached');
  assert.deepEqual(named,[],'named elements are at least 12px');
  assert.deepEqual(failed,{},'no readability, target, contrast or layout failure; see audit/report.json');
 });
});

// 生成服务与模型只对本机受保护代理开放；在一次性检出的真实开发服务中测量，设置与 HOME 均为隔离数据。
test('PHONE-READABILITY: provider settings dialog at phone widths',{timeout:120000},async t=>{
 const f=await checkoutFixture(t);saveGoogle(f);const server=await startDevelopment(t,f);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await(await browser.newContext(phone)).newPage(),report={};page.setDefaultTimeout(15000);
 const directory=path.join(runDirectory,'phone-readability-provider');await mkdir(directory,{recursive:true});
 await page.goto(server.origin);await page.locator('.yu-tabbar').getByRole('button',{name:/我的/}).click();
 await page.getByRole('button',{name:/生成服务与模型/}).click();await dialog(page,'生成服务与模型').waitFor();await page.waitForTimeout(500);
 await auditWidths(page,'provider-settings',report,directory);
 await dialog(page,'生成服务与模型').locator('.yu-provider-efforts>summary').click();await page.waitForTimeout(300);
 await auditWidths(page,'provider-efforts',report,directory);
 const failed=failedOf(report);await writeFile(path.join(directory,'report.json'),JSON.stringify({failed,report},null,1));
 t.diagnostic('provider audit: '+path.join(directory,'report.json'));
 assert.deepEqual(failed,{},'provider settings dialog has no readability, target, contrast or layout failure');
});
