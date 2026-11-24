// 横版印刷的授权与画幅任务属于发起版本。队列保留实际调用和成图，竖图制作不接收横图的进度或故障。
import {randomUUID} from 'node:crypto';
import {ReaderError,selectionSchema,view,type Document,type SessionRow} from '../lib/reader-model.ts';
import type {LandscapeCommand,LandscapePrint,LandscapePrintSet,LandscapeStatus} from '../lib/reader-production.ts';
import type {Database} from '../lib/reader-repository.ts';
import {supersededSql} from '../lib/reader-repository.ts';
import type {StoryGenerator} from '../lib/reader-engine.ts';
import type {ModelSnapshot} from '../lib/production-dag/document.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {evaluate} from '../lib/production-dag/engine.ts';
import {drawInput,stateOf} from '../lib/production-dag/runner.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {inputVersion,JobYield,productionJobId,type ProductionJob} from './production-queue.ts';
import {transact} from './production-records.ts';

export const landscapePrintKind='landscape-print';
type Input=ReturnType<typeof drawInput>;
type Receipt={image:string;model:string;requestId:string|null;usage:unknown};
type LegacyBinding={key:string;hash:string};
type LegacyReceipt={work:{instances:{key:string;hard?:Record<string,string>}[]};paid:{value:string;model:string;requestId:string|null;usage:unknown}};
type Payload={input:Input;paid?:Receipt;retry?:true;attempt?:number;legacy?:LegacyBinding};
const documentOf=(row:SessionRow)=>JSON.parse(row.document) as Document;
export const currentLandscapePrint=(doc:Document)=>doc.landscapePrints?.at(-1);
const matches=(print:LandscapePrint|undefined,job:ProductionJob)=>print?.id===job.version;
const retryIdentity=(id:string,failed:ProductionJob[])=>inputVersion([id,failed.map(job=>[job.id,job.state,job.updated_at,job.payload])]);
const runningLegacyLandscape="session_id=stories.id AND owner_id=stories.user_id AND state='running' AND json_extract(payload,'$.work.call')='drawLandscape'";

export class LandscapePrints{
 private readonly database:Database;
 private readonly now:()=>number;
 private readonly fileLost:(key:string)=>Promise<boolean>;
 constructor(database:Database,now:()=>number,fileLost:(key:string)=>Promise<boolean>){
  this.database=database;this.now=now;this.fileLost=fileLost;
 }

 private jobs(row:SessionRow,print:LandscapePrint){
  return this.database.prepare(`SELECT * FROM production_jobs WHERE session_id=? AND owner_id=? AND kind=? AND version=?
   ORDER BY json_extract(payload,'$.input.index'),COALESCE(json_extract(payload,'$.attempt'),0)`).bind(row.id,row.user_id,landscapePrintKind,print.id).all<ProductionJob>()
   .then(result=>[...new Map(result.results.map(job=>[(JSON.parse(job.payload) as Payload).input.index,job])).values()]);
 }

 private async verify(id:string,image:string){
  const key=referenceImageKey(id,image);
  return !!key&&!await this.fileLost(key);
 }

 private async readableReceipt(job:ProductionJob){
  const {input,legacy}=JSON.parse(job.payload) as Payload;
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
  if(legacy){
   try{
    const receipt=await this.readableLegacyReceipt(job.session_id,legacy,await this.legacyReceipts(job.session_id,job.owner_id));
    if(receipt)return receipt;
   }catch{unavailable=true;}
  }
  if(unavailable)throw new JobYield('image-availability');
 }

 private async project(row:SessionRow,print:LandscapePrint){
  const jobs=await this.jobs(row,print),images=Array.from({length:print.story.pages.length},()=>''),failed:ProductionJob[]=[];
  let unavailable=false;
  for(const job of jobs){
   const {input}=JSON.parse(job.payload) as Payload;
   if(job.state==='failed'){failed.push(job);continue;}
   if(job.state!=='succeeded')continue;
   const image=(JSON.parse(job.result||'{}') as Partial<Receipt>).image;
   try{
    if(image&&await this.verify(row.id,image))images[input.index]=image;
    else failed.push(job);
   }catch{unavailable=true;}
  }
  return {jobs,images,failed,unavailable,running:jobs.some(job=>job.state==='queued'||job.state==='running')};
 }

 startToken(row:SessionRow){return inputVersion(['landscape-print',row.id,row.selection,row.document]);}

 async status(row:SessionRow,canStart:boolean):Promise<LandscapeStatus|undefined>{
  const print=currentLandscapePrint(documentOf(row));
  if(!print)return;
  const {jobs,images,failed,running,unavailable}=await this.project(row,print);
  const ready=images.filter(Boolean).length,total=images.length;
  const state=running?'running':ready===total?'completed':ready||failed.length||unavailable?'partial':'idle';
  const retryToken=!running&&failed.length?retryIdentity(print.id,failed):undefined;
  const error=failed.find(job=>job.error)?.error||(failed.length?'部分横图丢失或损坏，请重试。':unavailable?'部分横图暂时无法读取。':undefined);
  return {state,available:canStart||jobs.length>0,total,ready,images,control:print.control,printId:print.id,
   failed:failed.map(job=>(JSON.parse(job.payload) as Payload).input.index+1),retryToken,error,
   ...(canStart&&!running?{startToken:this.startToken(row)}:{}),
   ...(running?{controlAction:print.control==='active'?'pause' as const:'resume' as const}:{})};
 }

 async sets(row:SessionRow):Promise<LandscapePrintSet[]>{
  const sets:LandscapePrintSet[]=[],publication=view(row).story?.publication;
  for(const print of [...(documentOf(row).landscapePrints??[])].reverse()){
   const {images}=await this.project(row,print);
   if(images.length&&images.every(Boolean))sets.push({id:print.id,story:{...print.story,publication},images});
  }
  return sets;
 }

 async unfinished(row:SessionRow){
  const print=currentLandscapePrint(documentOf(row));
  if(!print)return;
  const status=await this.status(row,false);
  if(status?.state!=='completed')return status;
 }

 // 旧版在修订后不再运行原任务。读者可以确认接续有原授权记录的套图。
 async legacyResume(row:SessionRow){
  const doc=documentOf(row),{dag}=doc;
  if(row.state!=='completed'||doc.landscapePrints?.length||!dag?.order.some(key=>dag.frames[key]?.landscape===''))return;
  const source=await this.database.prepare(`SELECT NOT EXISTS(SELECT 1 FROM production_jobs WHERE ${runningLegacyLandscape} AND lease_until>?) AS available
   FROM stories WHERE id=? AND user_id=? AND ${supersededSql()}`).bind(this.now(),row.id,row.user_id).first<{available:number}>();
  if(!source)return;
  const bindings=await this.database.prepare(`SELECT json_extract(j.payload,'$.work.instances[0].key') AS frame,json_extract(j.payload,'$.work.instances[0].hard') AS hard
   FROM production_jobs j WHERE j.session_id=? AND j.owner_id=? AND json_extract(j.payload,'$.work.call')='drawLandscape'
   AND NOT EXISTS (SELECT 1 FROM reader_faults f WHERE f.session_id=j.session_id AND f.owner_id=j.owner_id AND f.node='landscape'
    AND f.node_key=json_extract(j.payload,'$.work.instances[0].key') AND f.origin_fault_id IS NOT NULL AND f.state IN ('pending','recovering') AND f.job_id IS NULL)`)
   .bind(row.id,row.user_id).all<{frame:string;hard:string|null}>();
  const requested=new Set(bindings.results.flatMap(({frame,hard})=>hard?[frame+':'+fingerprint(JSON.parse(hard))]:[]));
  const graph=evaluate(stateOf({id:row.id,doc,dag,selection:selectionSchema.parse(JSON.parse(row.selection)),confirmed:true,faults:[]}));
  if(!dag.order.every(key=>{
   const target=graph.instance('landscape',key),frame=dag.frames[key];
   if(frame?.landscape)return target.status==='valid';
   if(frame?.landscape!==''||!target.hard)return false;
   const hash=fingerprint(target.hard);
   const localBinding=frame.landscapeInputHash===hash||!doc.revision&&frame.landscapeInputHash===undefined;
   return localBinding&&requested.has(key+':'+hash);
  }))return;
  return source;
 }

 private async legacyReceipts(id:string,ownerId:string){
  const jobs=await this.database.prepare(`SELECT payload FROM production_jobs WHERE session_id=? AND owner_id=?
   AND json_extract(payload,'$.work.call')='drawLandscape' AND json_type(payload,'$.paid')='object' ORDER BY updated_at DESC`)
   .bind(id,ownerId).all<Pick<ProductionJob,'payload'>>();
  return jobs.results.map(job=>JSON.parse(job.payload) as LegacyReceipt);
 }

 private async readableLegacyReceipt(id:string,target:LegacyBinding,receipts:LegacyReceipt[]){
  for(const {work,paid} of receipts){
   const instance=work.instances[0];
   if(instance?.key===target.key&&fingerprint(instance.hard??null)===target.hash&&await this.verify(id,paid.value))
    return {image:paid.value,model:paid.model,requestId:paid.requestId,usage:paid.usage};
  }
 }

 private async adoptLegacy(row:SessionRow,targets:LegacyBinding[],images:string[]){
  const receipts=await this.legacyReceipts(row.id,row.user_id);
  return Promise.all(targets.map(async(target,index)=>{
   if(images[index]&&await this.verify(row.id,images[index]))return {image:images[index],model:'',requestId:null,usage:null};
   return this.readableLegacyReceipt(row.id,target,receipts);
  }));
 }

 async command(row:SessionRow,command:LandscapeCommand,canStart:boolean,requireProvider?:()=>Promise<unknown>,modelSnapshot?:ModelSnapshot,legacyImages?:string[]){
  const doc=documentOf(row),print=currentLandscapePrint(doc);
  if('startToken'in command){
   if(!canStart||command.startToken!==this.startToken(row)||print&&(await this.jobs(row,print)).some(job=>job.state==='queued'||job.state==='running'))
    throw new ReaderError(409,'作品或横图状态已更新，请刷新后再试。');
   const story=view(row).story,dag=doc.dag;
   if(!story||!doc.plan||!dag||!story.pages.length||story.pages.some(page=>!page.image))throw new ReaderError(409,'请先完成竖图再绘制横图。');
   const basis={id:row.id,doc,dag,selection:selectionSchema.parse(JSON.parse(row.selection)),confirmed:true,faults:[]};
   const graph=evaluate(stateOf(basis));
   const targets=dag.order.map(key=>{
    const target=graph.instance('landscape',key);
    if(!target.hard)throw new ReaderError(409,'请先完成当前画幅，再绘制横图。');
    return target;
   });
   const inputs=targets.map(target=>drawInput(basis,{call:'drawLandscape',instances:[target]}));
   const legacy=legacyImages?targets.map(target=>({key:target.key,hash:fingerprint(target.hard)})):[];
   const adopted=legacyImages?await this.adoptLegacy(row,legacy,legacyImages).catch(()=>{throw new ReaderError(503,'旧版图片暂时无法核对，请稍后重试。');}):[];
   if(inputs.some(input=>!adopted[input.index]))await requireProvider?.();
   const next:LandscapePrint={id:randomUUID(),story,plan:doc.plan,control:'active',modelSnapshot};
   const now=this.now();
   transact(this.database,db=>{
    const targetVersion=legacyImages?`${supersededSql()} AND NOT EXISTS(SELECT 1 FROM production_jobs WHERE ${runningLegacyLandscape} AND lease_until>?)`:`NOT ${supersededSql()}`;
    if(!db.run(`UPDATE stories SET document=json_set(document,'$.landscapePrints',json(?)) WHERE id=? AND user_id=? AND document=? AND selection=? AND state='completed'
     AND ${targetVersion} AND NOT EXISTS (SELECT 1 FROM library_deletions WHERE story_id=? AND user_id=?)`,
     JSON.stringify([...(doc.landscapePrints??[]),next]),row.id,row.user_id,row.document,row.selection,...(legacyImages?[now]:[]),row.id,row.user_id).changes)
     throw new ReaderError(409,'作品已更新，请刷新后再试。');
    for(const input of inputs){
     const receipt=adopted[input.index];
     db.run(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,result,priority,attempts,lease_until,created_at,updated_at)
      VALUES(?,?,?,?,'landscape',?,'[]',?,?,?,?,0,0,?,?)`,productionJobId(row.id,landscapePrintKind,next.id,String(input.index)),
      row.id,row.user_id,landscapePrintKind,next.id,JSON.stringify({input,legacy:legacy[input.index]}),receipt?'succeeded':'queued',receipt?JSON.stringify(receipt):null,100+input.index,now,now);
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
    AND NOT EXISTS (SELECT 1 FROM library_deletions WHERE story_id=? AND user_id=?)`).bind(control,row.id,row.user_id,print.id,row.id,row.user_id).run();
   if(!result.meta.changes)throw new ReaderError(409,'横图已更新，请刷新后再试。');
   return;
  }
  const {failed,running}=await this.project(row,print);
  if(running||!failed.length||command.retryToken!==retryIdentity(print.id,failed))throw new ReaderError(409,'横图状态已更新，请刷新后再试。');
  const decisions=await Promise.all(failed.map(async job=>{
   const payload=JSON.parse(job.payload) as Payload;
   const restored=await this.readableReceipt(job).catch(error=>{
    if(error instanceof JobYield)throw new ReaderError(503,'图片暂时无法核对，请稍后重试。');
    throw error;
   });
   return {job,restored,payload};
  }));
  if(decisions.some(item=>!item.restored))await requireProvider?.();
  transact(this.database,db=>{
   if(!db.get("SELECT 1 FROM stories WHERE id=? AND user_id=? AND json_extract(document,'$.landscapePrints[#-1].id')=? AND NOT EXISTS (SELECT 1 FROM library_deletions WHERE story_id=? AND user_id=?)",row.id,row.user_id,print.id,row.id,row.user_id))
    throw new ReaderError(409,'横图已更新，请刷新后再试。');
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
    if(!db.run(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,priority,attempts,lease_until,created_at,updated_at)
     VALUES(?,?,?,?,'landscape',?,'[]',?,'queued',?,0,0,?,?) ON CONFLICT(id) DO NOTHING`,
     productionJobId(row.id,landscapePrintKind,print.id,payload.input.index+':'+attempt),row.id,row.user_id,landscapePrintKind,print.id,
     JSON.stringify({input:payload.input,paid:payload.paid,retry:true,attempt,legacy:payload.legacy}),100+payload.input.index,now,now).changes)
      throw new ReaderError(409,'横图已更新，请刷新后再试。');
   }
  });
 }

 async resumePaid(job:ProductionJob){
  const {paid,retry,legacy}=JSON.parse(job.payload) as Payload;
  if(!paid&&!retry&&!legacy)return;
  const receipt=await this.readableReceipt(job);
  if(receipt)return receipt;
  if(paid&&!retry)throw new ReaderError(409,'已付费横图的文件丢失，请重试本幅。');
 }

 async run(job:ProductionJob,generator:StoryGenerator){
  const row=await this.database.prepare('SELECT * FROM stories WHERE id=? AND user_id=?').bind(job.session_id,job.owner_id).first<SessionRow>();
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
