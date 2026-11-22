// 迁移 0025 的代码钩子：在本迁移的 SQL 之后、同一事务内把每篇故事转换为文档 v2，不调用模型。
// 每篇用一个 SAVEPOINT 隔离：不可读或转换失败的故事保持原样并记录诊断，协调器读取时按同一转换补做。
// 顺序：先采用已付费、输入未变且文件可读的旧绘图结果，再转换；横图结果同样采用；
// 没有页码的旧故障按转换后的下一个可运行节点归属；旧任务除查找外全部作废，相关恢复回执标为失败、故障回到待处理。
// 文件检查使用 migrate() 传入的目录（升级暂存目录或正式书库），不访问其他路径。
import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {selectionSchema,type Document} from '../lib/reader-model.ts';
import {convertDocument,mapLegacyFaults} from '../lib/production-dag/convert.ts';
import {rootProducts,versionState} from '../lib/production-dag/document.ts';
import {evaluate,instanceId} from '../lib/production-dag/engine.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType} from '../lib/reader-generation-contract.ts';
import {imageDimensions,matchesLandscapeImageRatio} from '../lib/reader-image-dimensions.ts';

export const productionDagMigration='0025_production_dag.sql';
type Row={id:string;user_id:string;selection:string;document:string};
type JobRow={id:string;kind:string;version:string;payload:string;result:string|null};
type FaultRow={id:string;kind:string;node:string|null;node_key:string;state:string};

const version=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
/** 旧版绘图任务的输入版本（与 0.14 的协调器一致），只用于判断旧结果是否属于当前内容。 */
function legacyImageVersion(doc:Document,selection:ReturnType<typeof selectionSchema.parse>){
 const {displayTitle:_,...generationSelection}=selection;void _;
 const scriptVersion=version({selection:generationSelection,...(doc.intake?{setupGeneration:doc.intake.generation}:{})});
 return version({scriptVersion,plan:doc.plan,style:selection.artStyle,prompt:selection.productionPrompt,...(doc.revision?.redrawNotes?{redrawNotes:doc.revision.redrawNotes}:{})});
}

/** 迁移里同步核对的图片：是真实的 PNG/JPEG/WebP 且尺寸可解析（不解码像素）；横图另须符合横图比例。内容不合格的文件不采用，仍由引擎按需重绘。 */
function readableFile(directory:string|undefined,storyId:string,url:string,landscape=false){
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
function legacyLandscapeVersion(doc:Document,selection:ReturnType<typeof selectionSchema.parse>,row:Row){
 const plan=doc.plan;
 if(!plan?.pages.length)return null;
 const images=plan.pages.map((_,i)=>doc.images[i]||'');
 if(images.some(image=>!referenceImageKey(row.id,image)))return null;
 return version(['landscape-image',plan.characters,plan.pages,images,selection.artStyle,selection.productionPrompt,...(selection.artStylePrompt?[selection.artStylePrompt]:[])]);
}

export function migrateProductionDag(sqlite:DatabaseSync,sql:string,directory?:string){
 sqlite.exec(sql);
 const ids=(sqlite.prepare('SELECT id,user_id FROM stories').all() as {id:string;user_id:string}[]);
 const read=sqlite.prepare('SELECT id,user_id,selection,document FROM stories WHERE id=? AND user_id=?');
 const save=sqlite.prepare('UPDATE stories SET document=? WHERE id=? AND user_id=?');
 for(const {id,user_id} of ids){
  sqlite.exec('SAVEPOINT dag_story');
  try{
   convertStory(sqlite,read.get(id,user_id) as Row,save,directory);
   sqlite.exec('RELEASE dag_story');
  }catch(error){
   sqlite.exec('ROLLBACK TO dag_story');sqlite.exec('RELEASE dag_story');
   console.error('production_dag_conversion_skipped',JSON.stringify({id,code:error instanceof Error?error.message.slice(0,80):'UNKNOWN'}));
  }
 }
}

function convertStory(sqlite:DatabaseSync,row:Row,save:ReturnType<DatabaseSync['prepare']>,directory?:string){
 const doc=JSON.parse(row.document) as Document;
 if(doc.dag)return;
 // 仍在准备阶段（候选查找、选题、准备、待确认）或有重选草稿的故事不转换：保持原样，准备与查找任务保留，确认制作时由 adopt() 建立 dag。
 if(doc.reselection||doc.intake&&doc.intake.phase!=='confirmed')return;
 const selection=selectionSchema.parse(JSON.parse(row.selection));
 const jobs=sqlite.prepare("SELECT id,kind,version,payload,result FROM production_jobs WHERE session_id=? AND owner_id=? AND state='succeeded'").all(row.id,row.user_id) as JobRow[];
 // 已付费的绘图结果：版本与当前内容一致、该页尚无图且文件可读时采用。
 if(doc.plan){
  const current=legacyImageVersion(doc,selection);
  doc.images=doc.plan.pages.map((_,page)=>doc.images[page]||'');
  for(const job of jobs.filter(j=>j.kind==='image'&&j.version===current&&j.result)){
   const page=Number(JSON.parse(job.payload).page),value=(JSON.parse(job.result!) as {value?:unknown}).value;
   if(Number.isInteger(page)&&page>=0&&page<doc.images.length&&!doc.images[page]&&typeof value==='string'&&readableFile(directory,row.id,value))doc.images[page]=value;
  }
 }
 const confirmed=true;
 const dag=convertDocument(doc,selection,{confirmed,notes:doc.reviewNotes});
 // 横图：采用已完成且文件可读的结果，按当前竖图记录输入。
 const landscapeVersion=legacyLandscapeVersion(doc,selection,row);
 for(const job of jobs.filter(j=>j.kind==='landscape-image'&&j.result&&landscapeVersion&&j.version===landscapeVersion)){
  const page=Number(JSON.parse(job.payload).page),value=(JSON.parse(job.result!) as {value?:unknown}).value,key=dag.order[page];
  if(!key||typeof value!=='string'||!readableFile(directory,row.id,value,true))continue;
  dag.frames[key].landscape=value;
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
}
