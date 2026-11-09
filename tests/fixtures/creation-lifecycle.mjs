// 共用完整制作到阅读场景；不同入口使用独立证据命名，避免并行运行互相覆盖。
import assert from 'node:assert/strict';
import {storyBrowser} from './story-browser.mjs';
import {until} from './production.mjs';
const dialog=(page,name)=>page.getByRole('dialog',{name,exact:true});
async function oneCard(f,id){assert.deepEqual((await f.json('sessions')).map(s=>s.id),[id]);}
export async function creationLifecycle(t,caseId='C001'){
 const b=await storyBrowser(t,caseId);await b.execute(async()=>{
  const {f,page}=b,initial=await b.create({prepare:false,theme:'知恩图报',title:'乌龟报恩'});
  const candidate=()=>dialog(page,'故事设置').getByRole('link',{name:'选择 乌龟报恩',exact:true});
  await candidate().waitFor();assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);await b.screenshot('before-selection');
  await page.reload();await candidate().waitFor();
  await b.extract(initial,'乌龟报恩');assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
  await page.getByRole('link',{name:'制作要求',exact:true}).click();let editor=dialog(page,'修改故事');
  await editor.getByLabel(/^制作要求/).fill('保留完整因果，动作清楚。');
  await editor.getByRole('button',{name:'验收要求',exact:true}).click();await editor.getByLabel(/^验收要求/).fill('关键反应落实到画面。');
  await editor.getByRole('button',{name:'画风',exact:true}).click();await editor.getByRole('radio',{name:'水彩绘本',exact:true}).check();
  await editor.getByRole('button',{name:'叙事详略',exact:true}).click();await editor.getByRole('group',{name:'叙事详略'}).getByRole('button',{name:/^简短/}).click();
  const drafted=page.waitForResponse(r=>r.url().endsWith(`/sessions/${initial.id}/setup`)&&r.request().postDataJSON()?.action==='draft');
  await editor.getByRole('button',{name:'完成编辑',exact:true}).click();assert.equal((await drafted).status(),200);
  await page.reload();await page.getByRole('link',{name:'修改画风',exact:true}).click();editor=dialog(page,'修改故事');assert.equal(await editor.getByRole('radio',{name:'水彩绘本',exact:true}).isChecked(),true);
  await editor.getByRole('button',{name:'制作要求',exact:true}).click();assert.equal(await editor.getByLabel(/^制作要求/).inputValue(),'保留完整因果，动作清楚。');
  const recommendations=f.control.recommendations.length;await editor.getByRole('button',{name:'按当前要求重新准备',exact:true}).click();
  await until(async()=>f.control.recommendations.length>recommendations&&(await f.read(initial.id)).intake.phase==='confirming',15000);
  assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
  await b.screenshot('prepared');await b.confirm();await b.completed(initial.id);await b.reader(initial.id);
  const saved=await f.read(initial.id);assert.equal(saved.selection.artStyle,'watercolor');assert.equal(saved.selection.narrativeDetail,'brief');assert.equal(saved.selection.acceptancePrompt,'关键反应落实到画面。');assert.equal(saved.ready,3);
  assert.equal(f.control.frameReviews.length,1);assert.equal(f.control.reviews.length,1);assert.equal(f.control.calls.length,3);await oneCard(f,initial.id);await b.screenshot('completed-reader');
 });
}
