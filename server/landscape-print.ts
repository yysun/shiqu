// 横版印刷的授权与画幅任务属于发起版本。队列保留实际调用和成图，竖图制作不接收横图的进度或故障。
import {decodeDocument} from '../lib/production-dag/document.ts';
import type {MediaStore} from '../lib/services.ts';
import {readableSavedPortrait,readableLandscapeImage} from './reader-image-health.ts';
import {mediaType} from '../lib/reader-generation-contract.ts';
import {randomUUID} from 'node:crypto';
import {ReaderError,selectionSchema,view,type Document,type SessionRow} from '../lib/reader-model.ts';
import type {LandscapeCommand,LandscapePrint,LandscapePrintSet,LandscapeStatus} from '../lib/reader-production.ts';
import type {Database,ReadStatements} from '../lib/reader-repository.ts';
import {landscapePrintHiddenSql,supersededSql} from '../lib/reader-repository.ts';
import type {StoryGenerator} from '../lib/reader-engine.ts';
import {landscapeSourceReady,type ModelSnapshot} from '../lib/production-dag/document.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {drawInput} from '../lib/production-dag/runner.ts';
import {inputVersion,JobYield,productionJobId,type ProductionJob} from './production-queue.ts';
import {transact} from './production-records.ts';

export const landscapePrintKind='landscape-print';
type Input=ReturnType<typeof drawInput>;
type Receipt={image:string;model:string;requestId:string|null;usage:unknown};
type Payload={input:Input;paid?:Receipt;retry?:true;attempt?:number};
const documentOf=(row:SessionRow)=>decodeDocument(row);
export const currentLandscapePrint=(doc:Document)=>doc.landscapePrints?.at(-1);
const matches=(print:LandscapePrint|undefined,job:ProductionJob)=>print?.id===job.version;
const retryIdentity=(id:string,failed:ProductionJob[])=>inputVersion([id,failed.map(job=>[job.id,job.state,job.updated_at,job.payload])]);

const printJobOrder="ORDER BY json_extract(payload,'$.input.index'),COALESCE(json_extract(payload,'$.attempt'),0)";
const printJobFilter='FROM production_jobs WHERE session_id=? AND owner_id=? AND kind=? AND version=?';
function latestByPage<T>(jobs:T[],page:(job:T)=>number){
 return [...new Map(jobs.map(job=>[page(job),job])).values()];
}
async function latestPrintJobs(db:Database,row:SessionRow,print:LandscapePrint){
 const {results}=await db.prepare(`SELECT * ${printJobFilter} ${printJobOrder}`).bind(row.id,row.user_id,landscapePrintKind,print.id).all<ProductionJob>();
 return latestByPage(results,job=>(JSON.parse(job.payload) as Payload).input.index);
}

function landscapePageOrder(doc:Document,print:LandscapePrint){
 const pages=doc.plan?.pages,count=pages?.length;
 if(!count||print.story.pages.length!==count||print.frameKeys&&print.frameKeys.length!==count)return;
 // 旧套图未存画幅身份，用保存的竖图和画面描述匹配；有歧义时改用下一套。
 const binding=(key:string|undefined,image:string,prompt:string)=>JSON.stringify([key,image,prompt]);
 const positions=new Map(print.story.pages.map((page,index)=>[binding(print.frameKeys?.[index],page.image,page.prompt),index]));
 if(positions.size!==count)return;
 const order:number[]=[];
 for(const [index,page] of pages.entries()){
  const position=positions.get(binding(print.frameKeys?doc.dag?.order[index]:undefined,doc.images[index],page.prompt));
  if(position===undefined)return;
  order.push(position);
 }
 return new Set(order).size===count?order:undefined;
}

// 导出按本版本的保存顺序选择整套可读取的横图，媒体读取不触发制作或修复。
export async function savedLandscapeImages(db:Database,media:MediaStore,row:SessionRow,doc:Document){
 const pages=doc.plan?.pages;
 if(!pages?.length)return;
 const count=pages.length;
 async function readableSet(images:string[]){
  if(!images.every(Boolean))return false;
  for(const image of images){
   const key=referenceImageKey(row.id,image);
   try{
    const asset=key&&await media.get(key);
    if(!asset||mediaType(asset.body)!==asset.contentType||!await readableLandscapeImage(asset.body))return false;
   }catch{return false;}
  }
  return true;
 }
 for(const print of [...(doc.landscapePrints??[])].reverse()){
  const order=landscapePageOrder(doc,print);
  if(!order)continue;
  const images=Array<string>(count).fill('');
  for(const job of await latestPrintJobs(db,row,print)){
   const {input}=JSON.parse(job.payload) as Payload;
   if(job.state==='succeeded'&&input.index>=0&&input.index<count)images[input.index]=(JSON.parse(job.result||'{}') as Partial<Receipt>).image??'';
  }
  if(await readableSet(images))return order.map(index=>images[index]);
 }

}

export class LandscapePrints{
 private readonly database:Database;
 private readonly now:()=>number;
 private readonly fileLost:(key:string)=>Promise<boolean>;
 private readonly media:MediaStore;
 constructor(database:Database,media:MediaStore,now:()=>number,fileLost:(key:string)=>Promise<boolean>){
  this.database=database;this.media=media;this.now=now;this.fileLost=fileLost;
 }

 private async verify(id:string,image:string){
  const key=referenceImageKey(id,image);
  return !!key&&!await this.fileLost(key);
 }

 private readonly missingReferences=new Map<string,string>();
 referencesBlocked(id:string,images:string[]){
  return this.missingReferences.get(id)===JSON.stringify(images);
 }

 private async referenceIssue(id:string,inputs:readonly Pick<Input,'index'|'reference'>[]){
  const missing:number[]=[],unavailable:number[]=[];
  for(const {index,reference} of inputs){
   try{if(!await readableSavedPortrait(this.media,id,reference))missing.push(index+1);}
   catch{unavailable.push(index+1);}
  }
  if(!missing.length&&!unavailable.length)return;
  if(unavailable.length)return new ReaderError(503,'第 '+unavailable.join('、')+' 幅参考竖图暂时无法读取，请重新核对。');
  return new ReaderError(409,'第 '+missing.join('、')+' 幅参考竖图缺失或损坏，请核对保存的图片。');
 }

 async checkStartOffer(row:SessionRow,status:LandscapeStatus){
  if(!status.startToken)return status;
  const images=documentOf(row).images;
  const issue=await this.referenceIssue(row.id,images.map((reference,index)=>({reference,index})));
  if(issue)this.missingReferences.set(row.id,JSON.stringify(images));
  else this.missingReferences.delete(row.id);
  return issue?{...status,startToken:undefined,referenceError:issue.message}:status;
 }

 private async readableReceipt(job:ProductionJob){
  const {input}=JSON.parse(job.payload) as Payload;
  const sources=await this.database.prepare(`SELECT payload,result FROM production_jobs WHERE session_id=? AND owner_id=? AND kind=? AND version=?
   AND json_extract(payload,'$.input')=json(?) ORDER BY COALESCE(json_extract(payload,'$.attempt'),0) DESC`)
   .bind(job.session_id,job.owner_id,landscapePrintKind,job.version,JSON.stringify(input)).all<Pick<ProductionJob,'payload'|'result'>>();
  let unavailable=false;
  for(const source of sources.results){
   const receipt=(JSON.parse(source.payload) as Payload).paid??(source.result?JSON.parse(source.result) as Receipt:undefined);
   const key=receipt?.image&&referenceImageKey(job.session_id,receipt.image);
   if(!key)continue;
   try{if(!await this.fileLost(key))return receipt;}
   catch{unavailable=true;}
  }
  if(unavailable)throw new JobYield('image-availability');
 }

 private readonly blockedRetries=new Set<string>();
 private async retryPlan(row:SessionRow,failed:ProductionJob[]){
  const decisions=await Promise.all(failed.map(async job=>{
   const payload=JSON.parse(job.payload) as Payload;
   try{return {job,payload,restored:await this.readableReceipt(job)};}
   catch(error){
    if(!(error instanceof JobYield))throw error;
    return {job,payload,unavailable:true};
   }
  }));
  const issue=decisions.some(item=>item.unavailable)?new ReaderError(503,'已保存的横图暂时无法核对，请稍后重试。'):
   await this.referenceIssue(row.id,decisions.filter(item=>!item.restored).map(item=>item.payload.input));
  return {decisions,issue};
 }

 private readonly readIssues=new Map<string,'lost'|'unavailable'>();

 activity(db:ReadStatements,row:SessionRow,print:LandscapePrint,now:number){
  const jobs=db.all<Pick<ProductionJob,'id'|'state'|'lease_until'>&{page:number}>(`SELECT id,state,lease_until,json_extract(payload,'$.input.index') AS page ${printJobFilter} ${printJobOrder}`,
   row.id,row.user_id,landscapePrintKind,print.id);
  const latest=latestByPage(jobs,job=>job.page);
  const active=latest.find(job=>job.state==='running'&&job.lease_until>now);
  return {running:latest.some(job=>job.state==='running'||job.state==='queued'),
   activePage:active?active.page+1:undefined,
   // 书架轮询只看最新任务与已知读图故障，不逐幅读取成图。
   ready:latest.filter(job=>job.state==='succeeded'&&!this.readIssues.has(job.id)).length,total:print.story.pages.length,
   failed:latest.some(job=>job.state==='failed'||this.readIssues.get(job.id)==='lost')&&!this.blockedRetries.has(print.id),
   unavailable:latest.some(job=>this.readIssues.get(job.id)==='unavailable')};
 }

 private async project(row:SessionRow,print:LandscapePrint){
  const jobs=await latestPrintJobs(this.database,row,print),images=Array.from({length:print.story.pages.length},()=>''),failed:ProductionJob[]=[];
  let unavailable=false;
  for(const job of jobs){
   const {input}=JSON.parse(job.payload) as Payload;
   if(job.state==='failed'){failed.push(job);continue;}
   if(job.state!=='succeeded')continue;
   const image=(JSON.parse(job.result||'{}') as Partial<Receipt>).image;
   try{
    if(image&&await this.verify(row.id,image)){images[input.index]=image;this.readIssues.delete(job.id);}
    else{failed.push(job);this.readIssues.set(job.id,'lost');}
   }catch{unavailable=true;this.readIssues.set(job.id,'unavailable');}
  }
  return {jobs,images,failed,unavailable,running:jobs.some(job=>job.state==='queued'||job.state==='running')};
 }

 private drawingInputs(row:SessionRow){
  const doc=documentOf(row),dag=doc.dag!;
  const story={id:row.id,doc,dag,selection:selectionSchema.parse(JSON.parse(row.selection)),confirmed:true,faults:[]};
  return dag.order.map(key=>drawInput(story,{call:'drawLandscape',instances:[{node:'landscape',key}]}));
 }

 startToken(row:SessionRow){
  const doc=documentOf(row);
  return inputVersion(['landscape-print',row.id,currentLandscapePrint(doc)?.id,doc.dag!.order,this.drawingInputs(row)]);
 }

 async status(row:SessionRow,canStart:boolean):Promise<LandscapeStatus|undefined>{
  const doc=documentOf(row),print=currentLandscapePrint(doc);
  if(!print)return;
  const {jobs,images,failed,running,unavailable}=await this.project(row,print);
  const ready=images.filter(Boolean).length,total=images.length;
  const state=running?'running':ready===total?'completed':ready||failed.length||unavailable?'partial':'idle';
  const retryIssue=!running&&failed.length?(await this.retryPlan(row,failed)).issue:undefined;
  if(retryIssue)this.blockedRetries.add(print.id);
  else this.blockedRetries.delete(print.id);
  const retryToken=!running&&failed.length&&!retryIssue?retryIdentity(print.id,failed):undefined;
  // 等待其余画幅绘制结束后，再提示需要重试的失败画幅。
  const error=!running&&failed.length
   ?failed.find(job=>job.error)?.error||'部分横图丢失或损坏，请重试。'
   :unavailable?'部分横图暂时无法读取。':undefined;
  return {state,available:canStart||jobs.length>0,total,ready,images,control:print.control,printId:print.id,matchesSavedPages:!!landscapePageOrder(doc,print),
   failed:failed.map(job=>(JSON.parse(job.payload) as Payload).input.index+1),retryToken,error,referenceError:retryIssue?.message,
   ...(unavailable?{readUnavailable:true}:{}),
   ...(canStart&&!running&&!unavailable?{startToken:this.startToken(row)}:{}),
   ...(running?{controlAction:print.control==='active'?'pause' as const:'resume' as const}:{})};
 }

 async sets(row:SessionRow):Promise<LandscapePrintSet[]>{
  const sets:LandscapePrintSet[]=[],story=view(row).story;
  for(const print of [...(documentOf(row).landscapePrints??[])].reverse()){
   const {images}=await this.project(row,print);
   if(images.length&&images.every(Boolean))sets.push({id:print.id,story:{...print.story,title:story?.title??print.story.title,publication:story?.publication},images});
  }
  return sets;
 }

 async unfinished(row:SessionRow){
  const print=currentLandscapePrint(documentOf(row));
  if(!print)return;
  const status=await this.status(row,false);
  if(status?.state!=='completed')return status;
 }

 async applyModel(row:SessionRow,print:LandscapePrint,replacement:ModelSnapshot){
  const updated=await this.database.prepare(`UPDATE stories SET document=json_set(document,'$.landscapePrints[#-1].modelSnapshot',json(?))
   WHERE id=? AND user_id=? AND document=? AND json_extract(document,'$.landscapePrints[#-1].id')=? AND NOT ${landscapePrintHiddenSql()}`)
   .bind(JSON.stringify(replacement),row.id,row.user_id,row.document,print.id).run();
  if(!updated.meta.changes)throw new ReaderError(409,'横图已更新，请刷新后再试。');
 }

 async command(row:SessionRow,command:Exclude<LandscapeCommand,{modelToken:string}>,canStart:boolean,requireProvider?:()=>Promise<unknown>,modelSnapshot?:ModelSnapshot){
  const doc=documentOf(row),print=currentLandscapePrint(doc);
  if('startToken'in command){
   if(!canStart||command.startToken!==this.startToken(row)||print&&(await latestPrintJobs(this.database,row,print)).some(job=>job.state==='queued'||job.state==='running'))
    throw new ReaderError(409,'作品或横图状态已更新，请刷新后再试。');
   const story=view(row).story,dag=doc.dag;
   if(!story||!doc.plan||!dag||!story.pages.length||story.pages.some(page=>!page.image))throw new ReaderError(409,'请先完成竖图再绘制横图。');
   const inputs=this.drawingInputs(row);
   await requireProvider?.();
   const issue=await this.referenceIssue(row.id,inputs);
   if(issue)throw issue;
   const next:LandscapePrint={id:randomUUID(),story,plan:doc.plan,frameKeys:dag.order,control:'active',modelSnapshot};
   const now=this.now();
   transact(this.database,db=>{
    if(print&&db.get(`SELECT 1 FROM production_jobs WHERE session_id=? AND owner_id=? AND kind=? AND version=? AND state IN ('queued','running')`,
     row.id,row.user_id,landscapePrintKind,print.id))throw new ReaderError(409,'横图仍在制作，请刷新后再试。');
    const current=db.get<SessionRow>(`SELECT * FROM story_rows stories WHERE id=? AND user_id=? AND NOT ${supersededSql()} AND NOT ${landscapePrintHiddenSql()}`,row.id,row.user_id);
    if(!current||!landscapeSourceReady(documentOf(current))||command.startToken!==this.startToken(current))
     throw new ReaderError(409,'作品已更新，请刷新后再试。');
    const currentDoc=documentOf(current);
    next.story=view(current).story!;
    next.plan=currentDoc.plan!;
    db.run("UPDATE stories SET document=json_set(document,'$.landscapePrints',json(?)) WHERE id=? AND user_id=?",
     JSON.stringify([...(currentDoc.landscapePrints??[]),next]),row.id,row.user_id);
    for(const input of inputs){
     db.run(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,payload,state,priority,attempts,lease_until,created_at,updated_at)
      VALUES(?,?,?,?,'landscape',?,?,'queued',?,0,0,?,?)`,productionJobId(row.id,landscapePrintKind,next.id,String(input.index)),
      row.id,row.user_id,landscapePrintKind,next.id,JSON.stringify({input}),100+input.index,now,now);
    }
   });
   return;
  }
  if(!print)throw new ReaderError(409,'请先启动横图。');
  if('control'in command){
   if(command.printId!==print.id)throw new ReaderError(409,'横图已更新，请刷新后再试。');
   if(command.control==='resume')await requireProvider?.();
   const control=command.control==='pause'?'paused':'active';
   const result=await this.database.prepare(`UPDATE stories SET document=json_set(document,'$.landscapePrints[#-1].control',?)
    WHERE id=? AND user_id=? AND json_extract(document,'$.landscapePrints[#-1].id')=?
    AND json_extract(document,'$.landscapePrints[#-1].control')<>?
    AND EXISTS(SELECT 1 FROM production_jobs WHERE session_id=stories.id AND owner_id=stories.user_id AND kind=? AND version=? AND state IN ('queued','running'))
    AND NOT ${landscapePrintHiddenSql()}`).bind(control,row.id,row.user_id,print.id,control,landscapePrintKind,print.id).run();
   if(!result.meta.changes)throw new ReaderError(409,'横图已更新，请刷新后再试。');
   return;
  }
  const {failed,running}=await this.project(row,print);
  if(running||!failed.length||command.retryToken!==retryIdentity(print.id,failed))throw new ReaderError(409,'横图状态已更新，请刷新后再试。');
  const {decisions,issue}=await this.retryPlan(row,failed);
  if(issue)throw issue;
  if(decisions.some(item=>!item.restored))await requireProvider?.();
  transact(this.database,db=>{
   if(!db.get(`SELECT 1 FROM stories WHERE id=? AND user_id=? AND json_extract(document,'$.landscapePrints[#-1].id')=? AND NOT ${landscapePrintHiddenSql()}`,row.id,row.user_id,print.id))
    throw new ReaderError(409,'横图已更新，请刷新后再试。');
   // 重试是本次明确授权，已结束套图留下的暂停状态不应阻止新任务。
   db.run("UPDATE stories SET document=json_set(document,'$.landscapePrints[#-1].control','active') WHERE id=? AND user_id=?",row.id,row.user_id);
   for(const {job,restored,payload} of decisions){
    const now=this.now();
    const unchanged=db.get(`SELECT 1 FROM production_jobs j WHERE j.id=? AND j.state=? AND j.updated_at=? AND j.payload=?
     AND NOT EXISTS (SELECT 1 FROM production_jobs other WHERE other.session_id=j.session_id AND other.owner_id=j.owner_id AND other.kind=j.kind AND other.version=j.version
      AND json_extract(other.payload,'$.input.index')=json_extract(j.payload,'$.input.index') AND COALESCE(json_extract(other.payload,'$.attempt'),0)>?)`,
     job.id,job.state,job.updated_at,job.payload,payload.attempt??0);
    if(!unchanged)throw new ReaderError(409,'横图已更新，请刷新后再试。');
    if(restored){
     db.run("UPDATE production_jobs SET state='succeeded',result=?,error=NULL,error_code=NULL,interrupted=0,updated_at=? WHERE id=?",JSON.stringify(restored),now,job.id);
     continue;
    }
    const attempt=(payload.attempt??0)+1;
    if(!db.run(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,payload,state,priority,attempts,lease_until,created_at,updated_at)
     VALUES(?,?,?,?,'landscape',?,?,'queued',?,0,0,?,?) ON CONFLICT(id) DO NOTHING`,
     productionJobId(row.id,landscapePrintKind,print.id,payload.input.index+':'+attempt),row.id,row.user_id,landscapePrintKind,print.id,
     JSON.stringify({input:payload.input,paid:payload.paid,retry:true,attempt}),100+payload.input.index,now,now).changes)
      throw new ReaderError(409,'横图已更新，请刷新后再试。');
   }
  });
 }

 async canResumeOffline(job:ProductionJob){
  const {paid,retry}=JSON.parse(job.payload) as Payload;
  if(paid&&!retry)return true;
  if(!retry)return false;
  try{return !!await this.readableReceipt(job);}
  catch(error){if(error instanceof JobYield)return false;throw error;}
 }

 async resumePaid(job:ProductionJob){
  const {paid,retry}=JSON.parse(job.payload) as Payload;
  if(!paid&&!retry)return;
  const receipt=await this.readableReceipt(job);
  if(receipt)return receipt;
  if(paid&&!retry)throw new ReaderError(409,'已付费横图的文件丢失，请重试本幅。');
 }

 async run(job:ProductionJob,generator:StoryGenerator){
  const row=await this.database.prepare('SELECT * FROM story_rows stories WHERE id=? AND user_id=?').bind(job.session_id,job.owner_id).first<SessionRow>();
  const print=row&&currentLandscapePrint(documentOf(row));
  if(!row||!print||!matches(print,job))return {obsolete:true};
  const {input}=JSON.parse(job.payload) as Payload;
  const result=await generator.image(print.plan,input.index,row.id,input.reference,input.style.artStyle,'',
   inputVersion([job.id,job.lease_token]),'landscape',input.style.artStylePrompt,input.prompt);
  const receipt:Receipt={image:result.value,model:result.model,requestId:result.requestId,usage:result.usage};
  await this.database.prepare("UPDATE production_jobs SET payload=json_remove(json_set(payload,'$.paid',json(?)),'$.retry') WHERE id=? AND lease_token IS ?")
   .bind(JSON.stringify(receipt),job.id,job.lease_token).run();
  if(!await this.verify(row.id,receipt.image).catch(()=>{throw new JobYield('image-availability');}))throw new ReaderError(409,'图片服务未返回可读取的 3∶2 横图，请重试本幅。');
  return receipt;
 }
}
