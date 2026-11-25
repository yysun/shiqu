// 迁移 0025 的代码钩子：在本迁移的 SQL 之后、同一事务内把每篇故事转换为文档 v2，不调用模型。
// 每篇用一个 SAVEPOINT 隔离：不可读或转换失败的故事保持原样并记录诊断，协调器读取时按同一转换补做。
// 顺序：先采用已付费、输入未变且文件可读的旧绘图结果，再转换；未完成的横图请求另存供后续迁移；
// 没有页码的旧故障按转换后的下一个可运行节点归属；旧任务除查找外全部作废，相关恢复回执标为失败、故障回到待处理。
// 文件检查使用 migrate() 传入的目录（升级暂存目录或正式书库），不访问其他路径。
import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {selectionSchema} from '../lib/reader-model.ts';
import {convertDocument,mapLegacyFaults,rootProducts,versionState,evaluate,instanceId,fingerprint,type HistoricalDocument} from './migrations/production-v2.ts';
import {lostImageMessage,referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType} from '../lib/reader-generation-contract.ts';
import {imageDimensions,matchesLandscapeImageRatio} from '../lib/reader-image-dimensions.ts';

export const productionDagMigration='0025_production_dag.sql';
type Row={id:string;user_id:string;selection:string;document:string;updated_at:string};
type JobRow={version:string;payload:string;result:string|null};
type LandscapeJob={id:string;page:number|null;state:string;result:string|null;image:unknown};
type FaultRow={id:string;kind:string;node:string|null;node_key:string;state:string};

const version=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
/** 旧版绘图任务的输入版本（与 0.14 的协调器一致），只用于判断旧结果是否属于当前内容。 */
function legacyImageVersion(doc:HistoricalDocument,selection:ReturnType<typeof selectionSchema.parse>){
 const {displayTitle:_,...generationSelection}=selection;void _;
 const scriptVersion=version({selection:generationSelection,...(doc.intake?{setupGeneration:doc.intake.generation}:{})});
 return version({scriptVersion,plan:doc.plan,style:selection.artStyle,prompt:selection.productionPrompt,...(doc.revision?.redrawNotes?{redrawNotes:doc.revision.redrawNotes}:{})});
}

/** 迁移里同步核对的图片：是真实的 PNG/JPEG/WebP 且尺寸可解析（不解码像素）；横图另须符合横图比例。内容不合格的文件不采用，仍由引擎按需重绘。 */
export function readableMigrationImage(directory:string|undefined,storyId:string,url:string,landscape=false){
 const key=referenceImageKey(storyId,url);
 if(!key||!directory)return false;
 const file=path.join(directory,'media',key);
 try{
  if(!existsSync(file)||!lstatSync(file).isFile()||lstatSync(file).size===0)return false;
  const bytes=new Uint8Array(readFileSync(file)),dimensions=imageDimensions(bytes);
  return !!mediaType(bytes)&&!!dimensions&&(!landscape||matchesLandscapeImageRatio(dimensions));
 }catch{return false;}
}
/** 旧版横图任务的输入版本（与 0.14 的 landscapeInputs 一致）：竖图、分镜、画风与制作要求任一变化，旧横图都不再属于当前内容。 */
function legacyLandscapeVersion(doc:HistoricalDocument,selection:ReturnType<typeof selectionSchema.parse>,row:Row){
 const plan=doc.plan;
 if(!plan?.pages.length)return null;
 const images=plan.pages.map((_,i)=>doc.images[i]||'');
 if(images.some(image=>!referenceImageKey(row.id,image)))return null;
 return version(['landscape-image',plan.characters,plan.pages,images,selection.artStyle,selection.productionPrompt,...(selection.artStylePrompt?[selection.artStylePrompt]:[])]);
}

/** 在旧队列删除前保留当前输入下的横图授权和可读付费回执。 */
function migrateLegacyLandscapes(sqlite:DatabaseSync,row:Row,doc:HistoricalDocument,selection:ReturnType<typeof selectionSchema.parse>,dag:ReturnType<typeof convertDocument>,directory?:string){
 const inputVersion=legacyLandscapeVersion(doc,selection,row);
 if(!inputVersion)return;
 const jobs=sqlite.prepare(`SELECT id,state,result,CASE WHEN json_valid(payload) THEN json_extract(payload,'$.page') END AS page,
  CASE WHEN json_valid(result) THEN json_extract(result,'$.value') END AS image FROM production_jobs
  WHERE session_id=? AND owner_id=? AND kind='landscape-image' AND version=?`).all(row.id,row.user_id,inputVersion) as LandscapeJob[];
 const current=jobs.flatMap(job=>{
  const {page,image:value}=job;
  if(page===null||!Number.isInteger(page)||page<0||page>=dag.order.length)return [];
  const paid=typeof value==='string'&&readableMigrationImage(directory,row.id,value,true);
  if(paid)dag.frames[dag.order[page]].landscape=value;
  return [{job,page,paid}];
 });
 if(!current.some(({job,paid})=>job.state!=='succeeded'||!paid))return;
 sqlite.exec(`CREATE TABLE IF NOT EXISTS migration_landscape_jobs(
  session_id TEXT NOT NULL,owner_id TEXT NOT NULL,job_id TEXT PRIMARY KEY,input_version TEXT NOT NULL,
  page INTEGER NOT NULL,state TEXT NOT NULL,paid_result TEXT)`);
 const retain=sqlite.prepare('INSERT INTO migration_landscape_jobs VALUES(?,?,?,?,?,?,?)');
 for(const {job,page,paid} of current)retain.run(row.id,row.user_id,job.id,inputVersion,page,job.state,paid?job.result:null);
}

export function migrateProductionDag(sqlite:DatabaseSync,sql:string,directory?:string){
 sqlite.exec(sql);
 const ids=(sqlite.prepare('SELECT id,user_id FROM stories').all() as {id:string;user_id:string}[]);
 const read=sqlite.prepare('SELECT id,user_id,selection,document,updated_at FROM stories WHERE id=? AND user_id=?');
 const save=sqlite.prepare('UPDATE stories SET document=? WHERE id=? AND user_id=?');
 for(const {id,user_id} of ids){
  sqlite.exec('SAVEPOINT dag_story');
  try{
   convertStory(sqlite,read.get(id,user_id) as Row,save,directory);
   sqlite.exec('RELEASE dag_story');
  }catch(error){
   // 空间不足会使恢复不完整，交给整库迁移回滚并报告磁盘错误。
   const failure=error as (NodeJS.ErrnoException&{errcode?:number})|undefined;
   if(!sqlite.isTransaction||failure?.errcode===13||failure?.code==='ENOSPC')throw error;
   sqlite.exec('ROLLBACK TO dag_story');sqlite.exec('RELEASE dag_story');
   console.error('production_dag_conversion_skipped',JSON.stringify({id,code:error instanceof Error?error.message.slice(0,80):'UNKNOWN'}));
  }
 }
}

function convertStory(sqlite:DatabaseSync,row:Row,save:ReturnType<DatabaseSync['prepare']>,directory?:string){
 const doc=JSON.parse(row.document) as HistoricalDocument;
 if(doc.dag)return;
 // 仍在准备阶段（候选查找、选题、准备、待确认）或有重选草稿的故事不转换：保持原样，由运行时接管准备任务。
 if(doc.reselection||doc.intake&&doc.intake.phase!=='confirmed')return;
 const selection=selectionSchema.parse(JSON.parse(row.selection));
 // 升级前仍在等待幅数确认（或准备建议时被中断）的故事：确认入口已移除，按已保存的幅数转换，
 // 但转换后保持暂停，由读者点「恢复生成」后才开始付费制作；不在升级时替读者确认。
 const awaitingCount=!doc.intake&&selection.length!=='auto'&&!!selection.narrativeDetail&&!doc.plan&&!!doc.frameRecommendation&&!doc.frameCountConfirmed;
 const interruptedPreparation=!doc.intake&&typeof selection.length==='number'&&!!selection.narrativeDetail&&!doc.plan&&!doc.storyboard&&!doc.draft&&!doc.frameCountConfirmed&&
  !!sqlite.prepare("SELECT 1 FROM production_jobs WHERE session_id=? AND owner_id=? AND kind='prepare' AND state!='succeeded' LIMIT 1").get(row.id,row.user_id);
 const needsConsent=awaitingCount||interruptedPreparation;
 const jobs=sqlite.prepare("SELECT version,payload,result FROM production_jobs WHERE session_id=? AND owner_id=? AND kind='image' AND state='succeeded'").all(row.id,row.user_id) as JobRow[];
 // 已付费的绘图结果：版本与当前内容一致、该页尚无图且文件可读时采用。
 if(doc.plan){
  const current=legacyImageVersion(doc,selection);
  doc.images=doc.plan.pages.map((_,page)=>doc.images[page]||'');
  for(const job of jobs.filter(j=>j.version===current&&j.result)){
   const page=Number(JSON.parse(job.payload).page),value=(JSON.parse(job.result!) as {value?:unknown}).value;
   if(Number.isInteger(page)&&page>=0&&page<doc.images.length&&!doc.images[page]&&typeof value==='string'&&readableMigrationImage(directory,row.id,value))doc.images[page]=value;
  }
 }
 const confirmed=true;
 const dag=convertDocument(doc,selection,{confirmed,notes:doc.reviewNotes});
 migrateLegacyLandscapes(sqlite,row,doc,selection,dag,directory);
 // 保留已发布图片的原始路径和文件；本地图片确认损坏时只标记故障，待读者明确恢复。
 if(directory){
  const lost=sqlite.prepare(`INSERT OR IGNORE INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,image,message,created_at,updated_at)
   VALUES(?,?,?,'image-loss','frameImage',?,'legacy',?,?,?,?)`);
  const at=Date.parse(row.updated_at)||0;
  for(const [page,key] of dag.order.entries()){
   const image=dag.frames[key].image,product=dag.products[instanceId('frameImage',key)];
   if(!image||!product||!referenceImageKey(row.id,image)||readableMigrationImage(directory,row.id,image))continue;
   product.readable=false;
   lost.run(fingerprint([productionDagMigration,row.id,key]),row.id,row.user_id,key,image,lostImageMessage(page),at,at);
  }
 }
 const state=versionState(dag,rootProducts(selection,dag,{notes:doc.reviewNotes}),{confirmed});
 const evaluation=evaluate(state);
 for(const key of dag.order.filter(k=>dag.frames[k].landscape)){
  const inst=evaluation.instance('landscape',key);
  if(inst.hard)dag.products[instanceId('landscape',key)]={hash:fingerprint(dag.frames[key].landscape),inputs:inst.hard,legacy:true};
 }
 // 未结故障：没有页码的按下一个可运行节点归属；画幅已不存在的作废。
 const faults=sqlite.prepare("SELECT id,kind,node,node_key,state FROM reader_faults WHERE session_id=? AND owner_id=? AND state IN ('pending','recovering')").all(row.id,row.user_id) as FaultRow[];
 const mapped=mapLegacyFaults(faults.filter(f=>!f.node).map(f=>({id:f.id,kind:f.kind,page:null,state:f.state})),state);
 for(const fault of mapped)sqlite.prepare("UPDATE reader_faults SET node=?,node_key=?,version='legacy' WHERE id=?").run(fault.node,fault.key,fault.id);
 for(const fault of faults){
  const orphan=!fault.node&&!mapped.some(m=>m.id===fault.id)||fault.node==='frameImage'&&!dag.order.includes(fault.node_key);
  if(orphan)sqlite.prepare("UPDATE reader_faults SET state='replaced' WHERE id=?").run(fault.id);
 }
 // 旧任务除查找外作废；进行中的恢复回执标为失败，恢复中的故障回到待处理，由读者在新流程中重新操作。
 sqlite.prepare("UPDATE reader_commands SET status='failed',error='应用已升级，请重新操作。' WHERE session_id=? AND owner_id=? AND action='recover' AND status IN ('queued','running')").run(row.id,row.user_id);
 sqlite.prepare("UPDATE reader_faults SET state='pending',job_id=NULL WHERE session_id=? AND owner_id=? AND state='recovering'").run(row.id,row.user_id);
 sqlite.prepare("UPDATE reader_faults SET job_id=NULL WHERE session_id=? AND owner_id=? AND job_id IN (SELECT id FROM production_jobs WHERE session_id=? AND owner_id=? AND kind!='discover')").run(row.id,row.user_id,row.id,row.user_id);
 sqlite.prepare("DELETE FROM production_jobs WHERE session_id=? AND owner_id=? AND kind!='discover'").run(row.id,row.user_id);
 if(doc.revision?.handoff){const {handoff:_,...revision}=doc.revision;void _;doc.revision=revision;}
 save.run(JSON.stringify({...doc,dag}),row.id,row.user_id);
 if(needsConsent)sqlite.prepare("UPDATE stories SET generation_control='paused' WHERE id=? AND user_id=? AND generation_control='active'").run(row.id,row.user_id);
}
