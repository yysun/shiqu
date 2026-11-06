// 用受控回执验证真实浏览器生命周期；先等待 UI 状态同步，再断言用户操作边界。
import test from 'node:test';
import assert from 'node:assert/strict';
import {storyBrowser} from './fixtures/story-browser.mjs';
import {creationLifecycle} from './fixtures/creation-lifecycle.mjs';
import {until} from './fixtures/production.mjs';
const options={timeout:180000};
const dialog=(page,name)=>page.getByRole('dialog',{name,exact:true});
async function oneCard(f,id){assert.deepEqual((await f.json('sessions')).map(s=>s.id),[id]);}
async function revisionResponse(page,action){
 const [result]=await Promise.all([page.waitForResponse(r=>/\/api\/reader\/sessions\/[^/]+\/revisions$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST'),action()]);
 assert.equal(result.status(),201);return result.json();
}
test('STORY-LIFECYCLE-C001: create, wait, extract, edit preparation, confirm and read',options,creationLifecycle);
test('STORY-LIFECYCLE-C002: all edit paths preserve one family, history and eligible images',options,async t=>{
 const b=await storyBrowser(t,'C002');await b.execute(async()=>{
  const {f,page}=b,initial=await b.create();await b.confirm();await b.completed(initial.id);await b.reader(initial.id);
  const original=await f.read(initial.id),originalSource=(await f.json(`sessions/${initial.id}/source`)).source;let current=initial.id;
  let settings=await b.settings();await settings.getByRole('button',{name:'修改故事名',exact:true}).click();const name=dialog(page,'修改故事名');await name.getByLabel('故事名',{exact:true}).fill('开发测试·保存的故事名');await name.getByRole('button',{name:'保存故事名',exact:true}).click();
  await until(async()=>(await f.read(current)).story.title==='开发测试·保存的故事名');assert.equal(f.control.calls.length,3);assert.equal(f.control.plans.length,1);
  await settings.getByRole('button',{name:'关闭',exact:true}).click();settings=await b.workflow();
  await settings.getByRole('link',{name:'制作要求',exact:true}).click();let editor=dialog(page,'修改故事');await editor.getByLabel(/^制作要求/).fill('这段草稿应被丢弃。');await editor.getByRole('button',{name:'关闭',exact:true}).click();
  await settings.getByRole('link',{name:'制作要求',exact:true}).click();editor=dialog(page,'修改故事');assert.equal(await editor.getByLabel(/^制作要求/).inputValue(),'这段草稿应被丢弃。');await editor.getByRole('button',{name:'丢弃草稿',exact:true}).click();assert.equal((await f.read(current)).selection.productionPrompt,original.selection.productionPrompt);
  const edits=[
   {name:'制作要求',change:async e=>e.getByLabel(/^制作要求/).fill('开发验证：完整保留关键行动。'),check:s=>assert.equal(s.selection.productionPrompt,'开发验证：完整保留关键行动。')},
   {name:'验收要求',change:async e=>e.getByLabel(/^验收要求/).fill('关键反应落实到画面。'),reuse:true,check:s=>assert.equal(s.selection.acceptancePrompt,'关键反应落实到画面。')},
   {name:'修改画风',change:async e=>e.getByRole('radio',{name:'剪纸艺术',exact:true}).check(),check:s=>assert.equal(s.selection.artStyle,'paper-cut')},
   {name:'修改叙事详略',change:async e=>e.getByRole('group',{name:'叙事详略'}).getByRole('button',{name:/^详细/}).click(),check:s=>assert.equal(s.selection.narrativeDetail,'detailed')},
   {name:'查看分镜',script:true,change:async e=>e.getByLabel(/^旁白/).fill('渔夫伸出双手，将搁浅的乌龟送回河流。'),reuse:true,check:s=>assert.equal(s.story.pages[0].caption,'渔夫伸出双手，将搁浅的乌龟送回河流。')},
   {name:'查看分镜',script:true,change:async e=>{await e.getByLabel(/^选择分镜/).selectOption('2');await e.getByLabel(/^画面提示词/).fill('The fisherman carefully lifts the turtle beside a quiet river, with one clear visible gesture.');},redraw:1,check:s=>assert.match(s.story.pages[1].prompt,/carefully lifts the turtle/)},
   {name:'查看分镜',script:true,change:async e=>{await e.getByText('人物设定（修改后重绘全篇）',{exact:true}).click();await e.getByLabel(/^人物设定/).fill('An adult Chinese fisherman in a blue linen robe, consistent clothing and facial features across every scene.');},redraw:3,check:()=>{}},
   {name:'查看分镜',script:true,change:async e=>{await e.getByLabel(/^选择分镜/).selectOption('0');await e.getByLabel(/^余味/).fill('一时的善意，也会在后来抵达。');},reuse:true,check:s=>assert.equal(s.story.reflection,'一时的善意，也会在后来抵达。')},
  ];
  for(const [index,edit] of edits.entries()){
   await b.reader(current);settings=await b.workflow();await settings.getByRole('link',{name:edit.name,exact:true}).click();
   if(edit.script)await dialog(page,'分镜剧本').getByRole('button',{name:'修改分镜',exact:true}).click();
   editor=dialog(page,'修改故事');await edit.change(editor);const images=f.control.calls.length,previous=await f.read(current),before=f.control.plans.length;
   await editor.getByRole('button',{name:'完成编辑',exact:true}).click();assert.equal(f.control.calls.length,images);assert.equal(f.control.plans.length,before);
   // 修改分镜会关闭分镜剧本（手机面板不超过两层）
   if(edit.script)assert.equal(await dialog(page,'分镜剧本').count(),0);
   const next=await revisionResponse(page,()=>settings.getByRole('link',{name:'开始制作',exact:true}).click());await b.completed(next.id);current=next.id;const saved=await f.read(current);edit.check(saved);
   assert.equal(saved.revision.rootId,initial.id);await oneCard(f,current);assert.deepEqual((await f.read(previous.id)).story.pages,previous.story.pages);
   if(edit.reuse)assert.equal(f.control.calls.length,images,edit.name+' must preserve eligible image pixels');
   if(edit.redraw)assert.equal(f.control.calls.length-images,edit.redraw,'Only the affected images should redraw');
   assert.equal((await f.json(`sessions/${current}/source`)).source.text,originalSource.text);await b.reader(current);await b.screenshot(`edit-${index+1}`);
  }
  settings=await b.workflow();await settings.getByRole('link',{name:'审核记录',exact:true}).click();const history=dialog(page,'审核记录');await history.getByRole('button',{name:'查看上一版本',exact:true}).waitFor();await history.getByRole('button',{name:'查看上一版本',exact:true}).click();await history.getByRole('button',{name:'返回当前版本',exact:true}).waitFor();
  assert.deepEqual((await f.read(initial.id)).story.pages,original.story.pages);await b.screenshot('history');
 });
});
test('STORY-LIFECYCLE-C003: pause drains in-flight work, refresh stays paused, explicit resume completes',options,async t=>{
 const b=await storyBrowser(t,'C003');await b.execute(async()=>{
  const {f,page}=b,saved=await b.create();f.control.hold=true;await b.confirm();await until(()=>f.control.calls.length===1,15000);
  await dialog(page,'故事设置').getByRole('link',{name:'暂停生成',exact:true}).click();await until(async()=>(await f.read(saved.id)).generationControl==='paused');
  f.control.calls[0].resolve();await until(async()=>(await f.read(saved.id)).ready===1);await b.reader(saved.id);const settings=await b.workflow();await settings.getByRole('link',{name:'恢复生成',exact:true}).waitFor();
  assert.equal(f.control.calls.length,1);await b.screenshot('paused');f.control.hold=false;await settings.getByRole('link',{name:'恢复生成',exact:true}).click();await b.completed(saved.id);assert.equal(f.control.calls.length,3);await b.reader(saved.id);await b.screenshot('resumed');
 });
});
test('STORY-LIFECYCLE-C004: failure survives observation and only a retry link authorizes a new attempt',options,async t=>{
 const b=await storyBrowser(t,'C004');await b.execute(async()=>{
  const {f,page}=b,saved=await b.create();f.control.hold=true;await b.confirm();await until(()=>f.control.calls.length===1,15000);f.control.calls[0].reject(Error('controlled browser image failure'));
  await until(async()=>(await f.read(saved.id)).state==='failed');const failed=await f.read(saved.id);assert.ok(failed.faults.length);const plans=f.control.plans.length,reviews=f.control.reviews.length;
  await page.reload();await dialog(page,'故事设置').getByRole('link',{name:'重试生成',exact:true}).waitFor();assert.equal(f.control.calls.length,1);await b.screenshot('failed');
  f.control.hold=false;await dialog(page,'故事设置').getByRole('link',{name:'重试生成',exact:true}).click();await b.completed(saved.id);assert.equal(f.control.calls.length,4);assert.equal(f.control.plans.length,plans);assert.equal(f.control.reviews.length,reviews);assert.equal((await f.read(saved.id)).faults,undefined);await b.reader(saved.id);await b.screenshot('recovered');
 });
});
test('STORY-LIFECYCLE-C005: replacement waits, cancel conserves parent, choosing commits one new version',options,async t=>{
 const b=await storyBrowser(t,'C005');await b.execute(async()=>{
  const {f,page,library}=b,saved=await b.create();await b.confirm();await b.completed(saved.id);await b.reader(saved.id);const parent=await f.read(saved.id),calls=library.calls.catalog.length;
  let settings=await b.workflow();await settings.getByRole('link',{name:'替换选题',exact:true}).click();let picker=dialog(page,'替换选题');await picker.getByRole('button',{name:'开始提取',exact:true}).waitFor();assert.equal(library.calls.catalog.length,calls);await oneCard(f,saved.id);await b.screenshot('replacement-waiting');
  await picker.getByRole('button',{name:'取消替换',exact:true}).click();await picker.waitFor({state:'hidden'});await dialog(page,'故事设置').getByRole('list',{name:'完整审片流程'}).waitFor();assert.equal(await page.getByRole('dialog').count(),1,'Cancelling replacement returns to the original embedded settings');assert.deepEqual((await f.read(saved.id)).story,parent.story);await oneCard(f,saved.id);
  await b.reader(saved.id);settings=await b.workflow();await settings.getByRole('link',{name:'替换选题',exact:true}).click();picker=dialog(page,'替换选题');await picker.getByRole('button',{name:'输入标题',exact:true}).click();await picker.getByLabel('故事标题',{exact:true}).fill('勇士护民');await picker.getByRole('button',{name:'按标题提取',exact:true}).click();
  const response=page.waitForResponse(r=>/\/reselection\/[^/]+$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST');
  await picker.getByRole('button').filter({has:page.getByText('勇士护民',{exact:true})}).click();const next=await(await response).json();assert.notEqual(next.id,saved.id);await until(async()=>(await f.read(next.id)).intake.phase==='confirming',15000);await page.getByRole('link',{name:'开始制作',exact:true}).waitFor();assert.equal(f.control.calls.length,3);await oneCard(f,next.id);
  await b.confirm();await b.completed(next.id);assert.equal(f.control.calls.length,6);assert.deepEqual((await f.read(saved.id)).story,parent.story);assert.notEqual((await f.json(`sessions/${next.id}/source`)).source.text,(await f.json(`sessions/${saved.id}/source`)).source.text);await b.reader(next.id);await b.screenshot('replacement-completed');
 });
});
for(const manual of [true,false])test(`STORY-LIFECYCLE-C004-${manual?'review-edit':'review-override'}: blocked audit requires an explicit user decision before drawing`,options,async t=>{
 const b=await storyBrowser(t,manual?'C004-review-edit':'C004-review-override');await b.execute(async()=>{
  const {f,page}=b,base=f.control.beforeText;let blocked=true;
  f.control.beforeText=async(kind,payload,schema)=>{
   if(kind==='review'&&blocked)return {...await base(kind,payload,schema),issues:[{page:1,category:'caption',problem:'受控审核：配文未说明可见行动。',instruction:'保留原文事件，明确第一幅的可见动作。'}]};
   if(kind==='repair'&&blocked)return {pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1]}))};
   return base(kind,payload,schema);
  };
  const saved=await b.create();await b.confirm();await until(async()=>(await f.read(saved.id)).state==='failed',15000);assert.equal(f.control.calls.length,0);await b.screenshot('audit-blocked');
  if(manual){
   await dialog(page,'故事设置').getByRole('link',{name:'手动修改第 1 幅',exact:true}).click();const editor=dialog(page,'修改故事');await editor.getByLabel(/^旁白/).fill('渔夫俯身伸手，把岸上的乌龟轻轻放回水中。');blocked=false;
   const next=await revisionResponse(page,()=>editor.getByRole('button',{name:'保存并重新审核',exact:true}).click());await b.completed(next.id);await oneCard(f,next.id);assert.equal((await f.read(next.id)).story.pages[0].caption,'渔夫俯身伸手，把岸上的乌龟轻轻放回水中。');assert.equal((await f.read(saved.id)).state,'failed');await b.reader(next.id);
  }else{
   await dialog(page,'故事设置').getByRole('link',{name:'跳过问题并绘图',exact:true}).click();await b.completed(saved.id);const row=await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(saved.id).first();assert.equal(JSON.parse(row.document).visualReview.overridden,true);await b.reader(saved.id);
  }
  assert.equal(f.control.calls.length,3);await b.screenshot('audit-explicit-resolution');
 });
});

test('STORY-LIFECYCLE-C006: one workflow panel survives first artwork and is shared with reading while shelf stays a reader entry',options,async t=>{
 const b=await storyBrowser(t,'C006');await b.execute(async()=>{
  const {f,page}=b,saved=await b.create();f.control.hold=true;await b.confirm();
  await until(()=>f.control.calls.length===1,15000);
  let panel=dialog(page,'故事设置');await panel.getByRole('link',{name:'暂停生成',exact:true}).waitFor();
  const stages=await panel.locator('li[data-stage]').evaluateAll(nodes=>nodes.map(node=>node.dataset.stage));
  await panel.getByText((await f.read(saved.id)).story.title,{exact:true}).waitFor();
  f.control.calls[0].resolve();await until(async()=>(await f.read(saved.id)).ready===1);
  await panel.getByText('1 / 3 幅画面已保存',{exact:true}).waitFor();
  assert.equal(await panel.isVisible(),true,'First artwork must not dismiss production');
  assert.equal(await page.getByRole('dialog').count(),1);await b.screenshot('first-artwork-panel-stays-open');
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'故事设置',exact:true}).waitFor();
  panel=await b.settings();assert.equal(await panel.getByRole('list',{name:'完整审片流程'}).count(),1);
  assert.equal(await panel.getByRole('button',{name:'制作流程',exact:true}).count(),0);
  assert.equal(await page.getByRole('dialog').count(),1);
  assert.deepEqual(await panel.locator('li[data-stage]').evaluateAll(nodes=>nodes.map(node=>node.dataset.stage)),stages);
  await panel.getByRole('link',{name:'暂停生成',exact:true}).click();await until(async()=>(await f.read(saved.id)).generationControl==='paused');
  await panel.getByRole('link',{name:'恢复生成',exact:true}).waitFor();
  await panel.getByRole('link',{name:'返回书架',exact:true}).click();await page.getByRole('heading',{name:'我的书架',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'制作流程',exact:true}).count(),0,'Do not add a shelf button');
  const current=await f.read(saved.id);await page.getByRole('button',{name:'继续阅读《'+current.story.title+'》',exact:true}).click();
  await page.getByRole('button',{name:'故事设置',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0,'A readable shelf story still opens reading');
  panel=await b.settings();
  await panel.getByRole('link',{name:'恢复生成',exact:true}).waitFor();await b.screenshot('reader-shared-workflow');
  f.control.hold=false;await panel.getByRole('link',{name:'恢复生成',exact:true}).click();
  const interrupted=f.control.calls.find(call=>call.page===1);interrupted.reject(Error('controlled failure after first artwork'));
  for(const call of f.control.calls)if(call!==interrupted)call.resolve();
  await until(async()=>(await f.read(saved.id)).state==='failed');const partial=await f.read(saved.id);
  await panel.getByRole('link',{name:'重试生成',exact:true}).waitFor();await panel.getByRole('link',{name:'暂停生成',exact:true}).waitFor({state:'hidden'});assert.equal(await panel.getByRole('link',{name:'暂停生成',exact:true}).count(),0);
  await panel.getByRole('button',{name:'关闭',exact:true}).click();panel=await b.settings();
  await panel.getByRole('link',{name:'重试生成',exact:true}).click();await b.completed(saved.id);
  const completed=await f.read(saved.id);assert.equal(completed.story.pages[0].image,partial.story.pages[0].image);assert.equal(f.control.calls.length,4);
  await panel.getByRole('heading',{name:/故事已完整展开/}).waitFor();assert.equal(await panel.isVisible(),true);
  await oneCard(f,saved.id);
 });
});

// Shelf cards keep reading; story settings stay available in the reader.
test('STORY-LIFECYCLE-C007: shelf cards keep reading and the reader gear opens the workflow without generating',options,async t=>{
 const b=await storyBrowser(t,'C007');await b.execute(async()=>{
  const {f,page}=b,saved=await b.create();await b.confirm();await b.completed(saved.id);await b.reader(saved.id);
  const before={images:f.control.calls.length,plans:f.control.plans.length,reviews:f.control.reviews.length},title=(await f.read(saved.id)).story.title;
  let settings=await b.settings();await settings.getByRole('list',{name:'完整审片流程'}).waitFor();assert.equal(await settings.getByText(title,{exact:true}).count(),1,'Settings names the story once');
  assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await settings.getByRole('button',{name:'制作流程',exact:true}).count(),0);
  await settings.getByRole('link',{name:'返回书架',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'《'+title+'》的故事设置',exact:true}).count(),0);
  await page.getByRole('button',{name:'继续阅读《'+title+'》',exact:true}).click();
  assert.equal(await page.getByRole('dialog').count(),0);await page.getByRole('button',{name:'下一页',exact:true}).click();
  settings=await b.settings();await settings.getByRole('list',{name:'完整审片流程'}).waitFor();await settings.getByRole('button',{name:'关闭',exact:true}).click();
  await page.setViewportSize({width:390,height:844});settings=await b.settings();await settings.getByRole('list',{name:'完整审片流程'}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),1);await b.screenshot('reader-gear-mobile');
  assert.deepEqual({images:f.control.calls.length,plans:f.control.plans.length,reviews:f.control.reviews.length},before);await oneCard(f,saved.id);
 });
});


// Every entry uses the same outer panel through pre-plan, zero-artwork, partial and completed states.
test('STORY-LIFECYCLE-C008: all shelf and reader entries share one settings layout through generation',options,async t=>{
 const b=await storyBrowser(t,'C008');await b.execute(async()=>{
  const {f,page}=b,saved=await b.create({prepare:false});
  const layout=panel=>panel.locator('.yu-revision-fields').evaluate(node=>Array.from(node.children,child=>child.className).filter(name=>name!=='yu-pdf-setting'));
  async function downloads(panel,enabled){
   assert.equal(await panel.locator('.yu-pdf-setting').count(),enabled?1:0,'The entire download area is hidden until all frames have images');
   assert.equal(await panel.locator('.yu-publication-summary').count(),enabled?1:0,'Credits share download visibility');
   assert.equal(await panel.getByRole('button',{name:'编辑署名与转载说明',exact:true}).count(),enabled?1:0);
   if(enabled)assert.equal(await panel.locator('.yu-pdf-setting .yu-publication-summary').count(),1,'Credits belong inside the download area');
   for(const name of [/下载 PDF/,/下载 PNG/,/下载 ZIP/]){
    const button=panel.getByRole('button',{name});assert.equal(await button.count(),enabled?1:0);
    if(enabled)assert.equal(await button.isEnabled(),true);
   }
   if(enabled)assert.equal(await panel.locator('.yu-settings-formats').evaluate(node=>!!(node.compareDocumentPosition(node.closest('fieldset').querySelector('.yu-settings-flow'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'Downloads stay above the workflow');
   assert.equal(await page.getByRole('dialog').count(),1);
  }
  let panel=dialog(page,'故事设置');await downloads(panel,false);await panel.getByRole('button',{name:'开始提取',exact:true}).waitFor();
  await panel.getByRole('link',{name:'返回书架',exact:true}).click();
  await page.getByRole('button',{name:'提取故事《等待选题的故事》',exact:true}).click();panel=dialog(page,'故事设置');
  await panel.getByRole('button',{name:'开始提取',exact:true}).waitFor();await downloads(panel,false);assert.equal(f.control.calls.length,0);
  await b.extract(saved);f.control.hold=true;await b.confirm();await until(()=>f.control.calls.length===1,15000);
  panel=dialog(page,'故事设置');const title=(await f.read(saved.id)).story.title;await panel.getByText(title,{exact:true}).waitFor();await downloads(panel,false);
  const expected=await layout(panel),images=f.control.calls.length;
  await panel.getByRole('link',{name:'返回书架',exact:true}).click();
  await page.getByRole('button',{name:'查看进度《'+title+'》',exact:true}).click();panel=dialog(page,'故事设置');await panel.getByRole('list',{name:'完整审片流程'}).waitFor();
  assert.deepEqual(await layout(panel),expected);assert.equal(await panel.getByText(title,{exact:true}).count(),1);await downloads(panel,false);await b.screenshot('zero-artwork-card-shared-panel');
  await page.reload();panel=dialog(page,'故事设置');await panel.getByRole('list',{name:'完整审片流程'}).waitFor();assert.deepEqual(await layout(panel),expected);await downloads(panel,false);assert.equal(f.control.calls.length,images);
  f.control.calls[0].resolve();await until(async()=>(await f.read(saved.id)).ready===1);await until(()=>f.control.calls.length===3);
  await panel.getByText('1 / 3 幅画面已保存',{exact:true}).waitFor();await downloads(panel,false);
  await panel.getByRole('button',{name:'关闭',exact:true}).click();panel=await b.settings();await panel.getByRole('list',{name:'完整审片流程'}).waitFor();
  assert.deepEqual(await layout(panel),expected);await downloads(panel,false);
  f.control.hold=false;for(const call of f.control.calls)call.resolve();await b.completed(saved.id);
  await panel.getByText('3 / 3 幅画面已保存',{exact:true}).waitFor();await downloads(panel,true);assert.deepEqual(await layout(panel),expected);
  await oneCard(f,saved.id);await b.screenshot('completed-shared-panel');
 });
});
