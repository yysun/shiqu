import {legacyReviewHistory} from './production-review-history.ts';
import type {PromptRecord} from '../../lib/reader-prompt-records.ts';
// 格式 4 审片记录转换。旧结论先按写入时的输入规则核对，再按同一稿件的现行输入绑定。
import {writeStoryProducts} from '../production-products.ts';
import type {DatabaseSync} from 'node:sqlite';
import {acceptanceCriteria,type AcceptanceResult} from '../../lib/reader-acceptance.ts';
import {savedStory,selectionSchema,type Document,type Selection,type SessionRow} from '../../lib/reader-model.ts';
import {requirementEdits,requirementKeys,suggestedSettings,type RequirementEdits} from '../../lib/reader-requirements.ts';
import {endingChoice,type DagDocument} from '../../lib/production-dag/document.ts';
import {projectDocument} from '../../lib/production-dag/projection.ts';
import {evaluate,type Product} from '../../lib/production-dag/engine.ts';
import {fingerprint} from '../../lib/production-dag/fingerprint.ts';
import {drawInput,finished,stateOf} from '../../lib/production-dag/runner.ts';
import {
 convertDocument as convertHistorical,evaluate as evaluateHistorical,stateOf as historicalStateOf,
 type DagDocument as HistoricalDag,type HistoricalDocument,type Product as HistoricalProduct,
} from './production-v2.ts';

import type {LandscapePrint} from '../../lib/reader-production.ts';
import {landscapePrintKind} from '../landscape-print.ts';
import {productionJobId} from '../production-queue.ts';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {referenceImageKey} from '../../lib/reader-image-assets.ts';
import {mediaType} from '../../lib/reader-generation-contract.ts';
import {imageDimensions,matchesLandscapeImageRatio} from '../../lib/reader-image-dimensions.ts';

/** 迁移里同步核对的图片：是真实的 PNG/JPEG/WebP 且尺寸可解析（不解码像素）；横图另须符合横图比例。内容不合格的文件不采用，仍由引擎按需重绘。 */
function readableMigrationImage(directory:string|undefined,storyId:string,url:string,landscape=false){
 const key=referenceImageKey(storyId,url);
 if(!key||!directory)return false;
 const file=path.join(directory,'media',key);
 try{
  if(!existsSync(file)||!lstatSync(file).isFile()||lstatSync(file).size===0)return false;
  const bytes=new Uint8Array(readFileSync(file)),dimensions=imageDimensions(bytes);
  return !!mediaType(bytes)&&!!dimensions&&(!landscape||matchesLandscapeImageRatio(dimensions));
 }catch{return false;}
}

export {legacyFrameId} from './production-v2.ts';

type Verdict=NonNullable<DagDocument['verdicts']>[string];
type OldDag=HistoricalDag&{verdicts?:Record<string,Verdict>};
type OldPrintDocument=Document&{visualReview?:HistoricalDocument['visualReview'];legacyLandscapeControl?:string;legacyLandscapeModelSnapshot?:DagDocument['modelSnapshot']};

/** 旧文档及旧工作流以相同入口转换，供书库升级和历史迁移夹具使用。 */
export function normalizeStoryDocument(id:string,doc:Document,selection:Selection):DagDocument{
 const raw=doc as unknown as HistoricalDocument;
 const old:OldDag=raw.dag??convertHistorical(raw,selection,{confirmed:!doc.intake||doc.intake.phase==='confirmed',notes:doc.reviewNotes});
 const confirmed=!doc.intake||doc.intake.phase==='confirmed';
 const historical=historicalStateOf({id,doc:raw,selection,dag:old,confirmed,faults:[]});
 const previous=evaluateHistorical(historical);
 const valid=(node:string,key=''):HistoricalProduct|undefined=>{
  const instance=previous.instance(node,key),product=historical.products[instance.id];
  if(instance.status!=='valid'||!product||node==='narrativeVerdict'&&product.checks?.['scene@all']!==undefined&&
   product.checks['scene@all']!==previous.resolve('scene@all','').hash)return undefined;
  return product;
 };
 const dag=structuredClone(old) as unknown as DagDocument;
 for(const character of dag.characters)Reflect.deleteProperty(character,'legacy');
 Reflect.deleteProperty(dag,'items');
 Reflect.deleteProperty(dag,'suggestions');
 Reflect.deleteProperty(dag,'reviewSkip');
 Reflect.deleteProperty(dag,'legacy');
 Reflect.deleteProperty(dag,'resumeUnreviewed');
 for(const frame of Object.values(dag.frames)){
  Reflect.deleteProperty(frame,'candidates');
  Reflect.deleteProperty(frame,'candidateNames');
  frame.drawn??=old.characters.map(character=>character.id);
 }
 const products:Record<string,Product>={};
 for(const [id,record] of Object.entries(old.products)){
  if(/^(?:itemRegistration|itemVerdict|frameVerdict|narrativeVerdict):/.test(id))continue;
  const {checks,legacy,scope,evidence,unreviewed,...product}=record;
  void checks;void legacy;void scope;void evidence;
  products[id]=unreviewed?{...product,overridden:true}:product;
 }
 dag.products=products;
 const verdicts:Record<string,Verdict>={};
 const issues=(dag.issues??[]).filter(issue=>issue.target==='frameCheck:');
 const graph=()=>evaluate(stateOf({id,doc,selection,dag,confirmed,faults:[]}));
 for(const key of dag.order){
  const vote=valid('frameVerdict',key),instance=graph().instance('frameVerdict',key);
  if(!vote||!instance.hard)continue;
  const record=old.verdicts?.[instance.id];
  if(record)verdicts[instance.id]=record;
  const {hash,outcome,overridden,unreviewed}=vote;
  products[instance.id]={hash,inputs:instance.hard,outcome,...(overridden||unreviewed?{overridden:true}:{})};
  issues.push(...(dag.issues??[]).filter(issue=>issue.target===instance.id));
 }
 const narrative=valid('narrativeVerdict');
 const items=old.items.flatMap(item=>item.scope==='frame'?[]:[{item,product:valid('itemVerdict',item.id)}]);
 const instance=graph().instance('narrativeVerdict');
 const registered=old.items.every(item=>!!valid('itemRegistration',item.id));
 const existing=old.verdicts?.[instance.id];
 const wholeV1=items.length===1&&items[0].item.legacy;
 if(narrative&&instance.hard&&registered&&items.every(({product})=>!!product)){
  const components=[narrative,...items.map(({product})=>product!)];
  const blocking=components.some(product=>product.outcome==='fail'&&!product.overridden);
  const overridden=!blocking&&components.some(product=>product.overridden||product.unreviewed);
  const verdict:Verdict={outcome:components.some(product=>product.outcome==='fail')?'fail':'pass'};
  if(existing?.detail)verdict.detail=existing.detail;
  if(existing?.requirements||items.some(({item})=>old.verdicts?.[`itemVerdict:${item.id}`]?.requirements))verdict.requirements=true;
  const criteria=acceptanceCriteria(selection.acceptancePrompt);
  const oldResults=raw.visualReview?.reports.at(-1)?.acceptanceResults;
  const acceptance=criteria.flatMap((text,i):AcceptanceResult[]=>{
   const saved=oldResults?.find(result=>result.criterion===i+1);
   if(saved)return [saved];
   const item=old.items[i],component=wholeV1?items[0]:items.find(entry=>entry.item.id===item?.id);
   // 旧逐幅要求的结论已随逐幅审片保留。旧库没有逐条依据时不补造依据。
   if(!component?.product||!wholeV1&&item?.text!==text)return [];
   const value=old.verdicts?.[`itemVerdict:${component.item.id}`];
   if(!value?.detail)return [];
   return [{criterion:i+1,status:component.product.outcome!=='fail'?'passed':value.requirements?'unknown':'failed',pages:[],evidence:value.detail}];
  });
  if(acceptance.length)verdict.acceptance=acceptance;
  products[instance.id]={hash:fingerprint([verdict,endingChoice(dag.ending)??null]),inputs:instance.hard,outcome:verdict.outcome,
   ...(overridden?{overridden:true}:{})};
  if(existing||acceptance.length||verdict.outcome==='fail')verdicts[instance.id]=verdict;
  const failed=new Set([instance.id,...items.filter(({product})=>product?.outcome==='fail'&&!product.overridden).map(({item})=>`itemVerdict:${item.id}`)]);
  issues.push(...(dag.issues??[]).filter(issue=>failed.has(issue.target)).map(issue=>({...issue,target:instance.id})));
 }
 dag.verdicts=verdicts;
 dag.issues=issues;
 return dag;
}

/** 旧快照转换为当时实际使用的绘图服务及模型。 */
function drawingSnapshot(value:unknown):DagDocument['modelSnapshot']{
 const snapshot=value as HistoricalDag['modelSnapshot'];
 if(!snapshot?.provider||!snapshot.models)return undefined;
 const {provider,imageProvider,models}=snapshot;
 const imageSide=imageProvider||provider;
 return {provider:imageSide,models:{image:imageSide==='codex'&&provider==='codex'&&'text'in models?models.text:models.image}};
}

/** 旧草稿在确认前独立保存显示值；只在明确覆盖或与当时默认值不同的字段恢复编辑标志。 */
function normalizeRequirementEdits(doc:Document,selection:Selection){
 const setup=doc.setupRequirements,draft=doc.intake?.draft;
 if(setup?.edited)return setup.edited;
 const suggestions=setup?.suggestions??doc.frameRecommendation?.requirements;
 if(!draft)return requirementEdits(selection,{...setup,suggestions});
 const defaults=suggestions?suggestedSettings(selection,suggestions):selection;
 const edited:RequirementEdits={};
 for(const key of requirementKeys){
  if(setup?.overrides?.[key]!==undefined||draft[key]!==undefined&&
   (draft[key]!==defaults[key]||!suggestions&&doc.intake?.draftEdited))edited[key]=true;
 }
 return edited;
}

export const productionSpecMigration='0028_production_spec.sql';
export const finalizeProductionSpecMigration='0029_finalize_production_spec.sql';
type Row=Omit<SessionRow,'generation_control'|'production_complete'>&{generation_mode:string;generation_control:string};

/** 开发预览已写入 0028 回执并转换文档，但仍保留旧队列表和修订索引。 */
export function finalizeProductionSpec(db:DatabaseSync,readSchema:()=>string,directory?:string){
 const columns=(table:string)=>new Set(db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map(row=>row.name));
 const revisions=columns('story_revisions'),stories=columns('stories'),jobs=columns('production_jobs');
 const tableExists=db.prepare("SELECT 1 FROM sqlite_schema WHERE name=? AND type=?");
 const layout=[['story_rows','view'],['production_faults','view'],['production_repair_budgets','view'],
  ['production_products','table'],['production_product_refs','table'],['production_attempt_events','table'],
  ['production_media_health','table'],['production_media_aliases','table']];
 if(layout.every(([name,type])=>tableExists.get(name,type))&&
  ['owner_id','root_id','edition','control'].every(column=>revisions.has(column))&&stories.has('production_complete')&&!jobs.has('dependencies'))return;
 if(revisions.size!==2||!revisions.has('story_id')||!revisions.has('rev')||!stories.has('generation_mode')||
  !stories.has('state')||stories.has('production_complete')||!jobs.has('dependencies')||
  !tableExists.get('production_migration_diagnostics','table')||!tableExists.get('reader_faults','table')||
  layout.some(([name,type])=>tableExists.get(name,type)))throw Error('UNRECOGNIZED_PRODUCTION_SPEC_SCHEMA');
 migrateProductionSpec(db,readSchema(),directory);
}

function migrateProductionSpec(db:DatabaseSync,sql:string,directory?:string){
 db.exec(sql);
 db.exec('ALTER TABLE stories ADD COLUMN production_complete INTEGER NOT NULL DEFAULT 0');
 const ids=db.prepare('SELECT id,user_id FROM stories').all() as {id:string;user_id:string}[];
 const read=db.prepare('SELECT * FROM stories WHERE id=? AND user_id=?');
 const hasLegacyLandscapeJobs=!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='migration_landscape_jobs'").get();
 const save=db.prepare('UPDATE stories SET document=?,generation_control=?,generation_mode=?,production_complete=? WHERE id=? AND user_id=?');
 const statements={
  run:(sql:string,...values:unknown[])=>({changes:Number(db.prepare(sql).run(...values as import('node:sqlite').SQLInputValue[]).changes)}),
  get:<T>(sql:string,...values:unknown[])=>db.prepare(sql).get(...values as import('node:sqlite').SQLInputValue[]) as T|undefined,
  all:<T>(sql:string,...values:unknown[])=>db.prepare(sql).all(...values as import('node:sqlite').SQLInputValue[]) as T[],
 };
 for(const {id,user_id} of ids){
  const row=read.get(id,user_id) as Row;
  db.exec('SAVEPOINT normalize_production_story');
  try{
   const doc=JSON.parse(row.document) as OldPrintDocument,selection=selectionSchema.parse(JSON.parse(row.selection));
   const normalized=!!doc.dag&&!Object.hasOwn(doc.dag,'items');
   if((!normalized||doc.images!==undefined)&&!Array.isArray(doc.images)||!Array.isArray(doc.usage)||
    doc.dag&&!Array.isArray(doc.dag.order))throw Error('INVALID_PRODUCTION_DOCUMENT');
   if(doc.visualReview){
    const records=new Map<string,PromptRecord>();
    for(const id of new Set(doc.usage.flatMap(entry=>entry?.promptRecordId?[entry.promptRecordId]:[]))){
     const record=statements.get<{record:string}>('SELECT record FROM prompt_records WHERE id=?',id);
     if(record)records.set(id,JSON.parse(record.record) as PromptRecord);
    }
    const {entries}=legacyReviewHistory(row,records);
    if(entries.length)doc.archivedReviewHistory=entries;
   }
   if(normalized&&doc.dag){
    // 预览格式已经按当时的稿件采纳审片结论。这里只将产物移入共享存储。
    if(!doc.plan||!doc.images)Object.assign(doc,projectDocument(doc.dag,doc.plan??null));
   }else if(doc.dag||doc.plan||doc.storyboard||doc.draft||!doc.intake){
    doc.dag=normalizeStoryDocument(row.id,doc,selection);
    if(doc.dag.modelSnapshot)doc.dag.modelSnapshot=drawingSnapshot(doc.dag.modelSnapshot);
    if(!doc.dag.order.length&&doc.intake?.phase!=='confirmed'&&doc.intake)delete doc.dag;
   }
   if(!normalized||!doc.landscapePrints?.length)restoreLandscapePrint(db,row,doc,selection,hasLegacyLandscapeJobs,directory);
   for(const print of doc.landscapePrints??[])if(print.modelSnapshot)print.modelSnapshot=drawingSnapshot(print.modelSnapshot);
   if(doc.setupRequirements||doc.intake?.draft||doc.frameRecommendation?.requirements)
    doc.setupRequirements={edited:normalizeRequirementEdits(doc,selection),suggestions:doc.setupRequirements?.suggestions};
   delete doc.legacyLandscapeControl;delete doc.legacyLandscapeModelSnapshot;
   delete doc.visualReview;delete doc.storyboard;delete doc.draft;Reflect.deleteProperty(doc,'legacyFramePreparation');
   const confirmed=!doc.intake||doc.intake.phase==='confirmed';
   const complete=confirmed&&!!doc.dag&&finished({id:row.id,doc,selection,dag:doc.dag,confirmed,faults:[]});
   const control=row.generation_mode==='reader'&&!complete&&row.generation_control==='active'?'paused':row.generation_control;
   writeStoryProducts(statements,row.id,row.user_id,doc,stored=>Number(save.run(stored,control,'background',Number(complete),row.id,row.user_id).changes),
    {historical:true,now:Date.parse(row.updated_at)||0});
   db.exec('RELEASE normalize_production_story');
  }catch(error){
   const failure=error as NodeJS.ErrnoException&{errcode?:number};
   if(!db.isTransaction||failure?.errcode!==undefined||failure?.code?.startsWith('E')&&failure.code!=='INVALID_PRODUCTION_DOCUMENT')throw error;
   db.exec('ROLLBACK TO normalize_production_story; RELEASE normalize_production_story');
   db.prepare('INSERT INTO production_migration_diagnostics VALUES(?,?,?) ON CONFLICT DO NOTHING').run(row.id,row.user_id,'INVALID_PRODUCTION_DOCUMENT');
  }
 }
 // 分阶段审片与条目登记的队列身份已失效。重算只使用现行稿件和保存后的结论。
 const retired="json_valid(payload) AND json_extract(payload,'$.work.call') IN ('registerItems','review','drawLandscape')";
 db.exec(`UPDATE reader_commands SET status='failed',error='制作规则已升级，请刷新后重试。' WHERE status IN ('queued','running')
  AND EXISTS(SELECT 1 FROM production_jobs j WHERE j.owner_id=reader_commands.owner_id AND j.recovery_id=reader_commands.request_id AND ${retired});
  UPDATE reader_faults SET state='replaced',job_id=NULL WHERE state IN ('pending','recovering','awaiting-match')
  AND (origin_fault_id IS NOT NULL OR node IN ('itemRegistration','itemVerdict') OR job_id IN (SELECT id FROM production_jobs WHERE ${retired}));
  DELETE FROM production_jobs WHERE ${retired} AND state!='succeeded';
  DROP TABLE IF EXISTS migration_landscape_jobs;
  INSERT INTO production_attempt_events(owner_id,session_id,job_id,attempt_id,event,recorded_at,detail)
   SELECT owner_id,session_id,id,COALESCE(lease_token,'legacy:'||id),'historical',updated_at,
    json_object('state',state,'attempts',attempts,'interrupted',interrupted,'error',error,'code',error_code,'version',version,
     'result',CASE WHEN json_valid(result) THEN json(result) END,
     'paid',CASE WHEN json_valid(payload) THEN json_extract(payload,'$.paid') END,
     'recoveryId',recovery_id)
   FROM production_jobs WHERE attempts>0 OR state!='queued';
  INSERT INTO production_faults(id,session_id,owner_id,job_id,kind,node,node_key,input_hash,origin_fault_id,optional,version,image,message,state,command_id,created_at,updated_at)
   SELECT id,session_id,owner_id,job_id,kind,node,node_key,input_hash,origin_fault_id,optional,version,image,message,state,command_id,created_at,updated_at FROM reader_faults;
  DROP TABLE reader_faults;
  ALTER TABLE production_jobs DROP COLUMN dependencies;
  DROP INDEX stories_lock_scan;
  DROP INDEX stories_family;
  CREATE INDEX stories_family ON stories(user_id,
   COALESCE(json_extract(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.revision.rootId'),id),
   COALESCE(json_extract(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.revision.number'),1),
   id,generation_control);
  DROP TRIGGER production_disarm_deleted;
  CREATE TRIGGER production_disarm_deleted AFTER INSERT ON library_deletions BEGIN
   UPDATE stories SET generation_control='stopped' WHERE id=NEW.story_id AND user_id=NEW.user_id;
   DELETE FROM production_demand WHERE session_id=NEW.story_id AND owner_id=NEW.user_id;
  END;
  ALTER TABLE stories DROP COLUMN generation_mode;
  ALTER TABLE stories DROP COLUMN step_key;
  ALTER TABLE stories DROP COLUMN step_attempts;
  ALTER TABLE stories DROP COLUMN lock_token;
  ALTER TABLE stories DROP COLUMN lock_until;
  DROP INDEX stories_landscape_scan;
  ALTER TABLE stories DROP COLUMN state;
  ALTER TABLE stories DROP COLUMN error;
  CREATE VIEW story_rows AS SELECT stories.*,
   (SELECT json_group_object(r.target,json_object('record',json(r.record),'content',json(p.content),'sharedReadable',m.readable))
    FROM production_product_refs r JOIN production_products p ON p.id=r.product_id AND p.owner_id=r.owner_id
    LEFT JOIN production_media_health m ON p.target LIKE 'frameImage:%' AND m.owner_id=p.owner_id AND m.root_id=p.root_id AND m.url=json_extract(p.content,'$')
    WHERE r.session_id=stories.id AND r.owner_id=stories.user_id) AS production_products,
   (SELECT json_object('used',e.used,'limit',e.capacity) FROM production_repair_budgets e
    WHERE e.session_id=stories.id AND e.owner_id=stories.user_id) AS production_repair_budget,
   CASE WHEN EXISTS(SELECT 1 FROM production_jobs j WHERE j.session_id=stories.id AND j.owner_id=stories.user_id AND j.kind!='landscape-print' AND j.state='running') THEN 'running'
    WHEN EXISTS(SELECT 1 FROM production_faults f WHERE f.session_id=stories.id AND f.owner_id=stories.user_id AND f.optional=0 AND f.state='pending') THEN 'failed'
    ELSE 'idle' END AS state,
   (SELECT f.message FROM production_faults f WHERE f.session_id=stories.id AND f.owner_id=stories.user_id AND f.optional=0 AND f.state='pending'
    ORDER BY f.created_at,f.id LIMIT 1) AS error
  FROM stories;`);
}

type SavedDrawing={value:string;model?:string;requestId?:string|null;usage?:unknown};

/** 已授权的旧横图独立保存。只采用输入仍匹配、媒体可读的回执。 */
function restoreLandscapePrint(db:DatabaseSync,row:Row,doc:OldPrintDocument,selection:Selection,archived:boolean,directory?:string){
 const dag=doc.dag,plan=doc.plan;
 if(!dag||!plan||dag.order.length!==plan.pages.length||!dag.order.length)return;
 const portrait=savedStory(row as SessionRow,selection,doc);
 if(!portrait||portrait.pages.some(page=>!page.image))return;
 const saved=archived?db.prepare('SELECT page,paid_result FROM migration_landscape_jobs WHERE session_id=? AND owner_id=? ORDER BY page').all(row.id,row.user_id) as {page:number;paid_result:string|null}[]:[];
 const jobs=db.prepare(`SELECT payload FROM production_jobs WHERE session_id=? AND owner_id=? AND json_valid(payload)
  AND json_extract(payload,'$.work.call')='drawLandscape' ORDER BY updated_at DESC,id`).all(row.id,row.user_id) as {payload:string}[];
 const bindings=jobs.map(({payload})=>JSON.parse(payload) as {work:{instances:{key:string;hard?:Record<string,string>}[]};paid?:SavedDrawing;landscapeAttempt?:number});
 const story={id:row.id,doc,dag,selection,confirmed:true,faults:[]};
 const historical={...dag,items:[]} as unknown as HistoricalDag;
 const graph=evaluateHistorical(historicalStateOf({id:row.id,doc:doc as unknown as HistoricalDocument,selection,dag:historical,confirmed:true,faults:[]}));
 const frames=dag.order.map((key,index)=>{
  const frame=historical.frames[key],instance=graph.instance('landscape',key);
  const hard=instance.hard?fingerprint(instance.hard):undefined;
  const job=bindings.find(({work,landscapeAttempt})=>frame.landscapeAttempt===landscapeAttempt&&
   work.instances.some(target=>target.key===key&&hard&&fingerprint(target.hard)===hard));
  const archive=saved.find(entry=>entry.page===index);
  const requested=!!archive||!!job&&frame?.landscape===''&&(!frame.landscapeInputHash||frame.landscapeInputHash===hard);
  const readable=(image:string|undefined)=>image&&readableMigrationImage(directory,row.id,image,true);
  const receipt=(archive?.paid_result?JSON.parse(archive.paid_result) as SavedDrawing:undefined)??job?.paid;
  const current=frame?.landscape&&(instance.status==='valid'||!!archive)&&readable(frame.landscape);
  const paid=current?{value:frame.landscape!}:readable(receipt?.value)?receipt:undefined;
  return {key,requested,paid};
 });
 const needed=frames.some(frame=>frame.requested||frame.paid);
 if(needed){
  const digest=fingerprint([productionSpecMigration,row.id,row.user_id,'landscape',frames.map(frame=>frame.key)]);
  const variant=((Number.parseInt(digest[16],16)&3)|8).toString(16);
  const printId=`${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-${variant}${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const modelSnapshot=drawingSnapshot(doc.legacyLandscapeModelSnapshot??dag.modelSnapshot);
  const print:LandscapePrint={id:printId,story:portrait,plan,frameKeys:dag.order,control:'paused',...(modelSnapshot?{modelSnapshot}:{})};
  doc.landscapePrints=[print,...doc.landscapePrints??[]];
  const insert=db.prepare(`INSERT INTO production_jobs(id,session_id,owner_id,kind,pool,version,dependencies,payload,state,result,priority,attempts,lease_until,created_at,updated_at)
   VALUES(?,?,?,?,'landscape',?,'[]',?,?,?,?,0,0,?,?)`);
  const date=Date.parse(row.updated_at)||0;
  for(const [index,{key,paid,requested}] of frames.entries()){
   if(!paid&&!requested)continue;
   const input=drawInput(story,{call:'drawLandscape',instances:[{key,node:'landscape'}]});
   const result=paid?JSON.stringify({image:paid.value,model:paid.model??'',requestId:paid.requestId??null,usage:paid.usage??null}):null;
   insert.run(productionJobId(row.id,landscapePrintKind,printId,String(index)),row.id,row.user_id,landscapePrintKind,printId,
    JSON.stringify({input}),paid?'succeeded':'queued',result,100+index,date,date);
  }
 }
 for(const {key} of frames){
  const frame=historical.frames[key];
  delete frame.landscape;delete frame.landscapeInputHash;delete frame.landscapeError;delete frame.landscapeAttempt;
  delete dag.products[`landscape:${key}`];
 }
}
