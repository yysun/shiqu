// 响应式布局 E2E 的预置书库：按生产流程经 API 建故事（建任务 → 按标题提取 → 选择候选 → 确认制作），
// 不经界面点击，因此不随桌面或手机布局变化。浏览器与数据都来自隔离的 storyBrowser 夹具。
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {storyBrowser} from './story-browser.mjs';
import {until} from './production.mjs';

// 按生产流程经 API 预置一篇故事：建任务 → 按标题提取 → 选择候选 → 确认制作；confirm=false 时停在确认前。
// 带审片问题的已绘故事：先完成一篇故事，再经修订 API 只改第 1 幅配文；修订沿用原图，复审在第 1 幅留下问题而停止。
// 返回修订后的版本 id，它有完整画面与 reviewIssues（与界面“修改分镜 → 开始制作”的结果相同）。
export async function seedReviewedStory(f){
 const original=f.control.beforeText,parent=await seedStory(f);
 await until(async()=>(await f.read(parent)).state==='completed',30000);
 f.control.beforeText=async(kind,payload,schema)=>{
  if(kind==='review')return {...await original?.(kind,payload,schema),issues:[{page:1,category:'caption',problem:'受控审核：配文未说明可见行动。',instruction:'保留原文事件，明确第一幅的可见动作。'}]};
  if(kind==='repair')return {pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1]}))};
  return original?.(kind,payload,schema);
 };
 const snapshot=await f.json(`sessions/${parent}/revisions`);
 const plan={...snapshot.plan,pages:snapshot.plan.pages.map((page,index)=>index===0?{...page,caption:'庄周醒来，仍记得蝴蝶在花间飞过。'}:page)};
 const revised=await f.json(`sessions/${parent}/revisions`,'POST',{requestId:crypto.randomUUID(),token:snapshot.token,changes:{plan}});
 await until(async()=>(await f.read(revised.id)).reviewIssues?.length>0,30000);
 f.control.beforeText=original;return revised.id;
}
// pick=false：只建任务，停在尚未选题的选题阶段（可见“返回修改书籍”）。
export async function seedStory(f,{title='乌龟报恩',confirm=true,length=3,pick=true}={}){
 const saved=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{bookId:'zhuangzi',theme:'原典故事',artStyle:'ink-pencil',length:'auto',voice:false,productionPrompt:'',narrativeDetail:'balanced'}});
 if(!pick)return saved.id;
 await f.startDiscovery(saved.id,title);await f.demand(saved.id,crypto.randomUUID());
 await until(async()=>(await f.read(saved.id)).intake?.phase==='choosing',20000);
 await f.json(`sessions/${saved.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(saved.id)).intake.generation,action:'choose',batch:0,index:0});
 await until(async()=>(await f.read(saved.id)).intake?.phase==='confirming',20000);
 if(confirm)await f.json(`sessions/${saved.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(saved.id)).intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:'',narrativeDetail:'balanced',length}});
 return saved.id;
}

// 预置书库：completed 篇已完成故事（每篇 3 幅）。
export async function seededBrowser(t,caseId,{viewport={width:1280,height:800},completed=8,touch=false}={}){
 const b=await storyBrowser(t,caseId,{viewport,...(touch?{hasTouch:true,isMobile:true}:{})});
 const {f}=b,ids=[];
 for(let i=0;i<completed;i++)ids.push(await seedStory(f));
 try{await until(async()=>{for(const id of ids)if((await f.read(id)).state!=='completed')return false;return true;},90000);}
 catch(error){const states=[];for(const id of ids){const s=await f.read(id);states.push({state:s.state,intake:s.intake?.phase,control:s.generationControl,faults:s.faults?.map(x=>x.message)});}throw Error('seed stalled: '+JSON.stringify(states),{cause:error});}
 const directory=path.join(b.directory,'desktop-responsive-layout');await mkdir(directory,{recursive:true});
 return {...b,ids,directory};
}
