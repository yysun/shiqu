// 制作 DAG 故事的修订保存：新版复制上一版的 dag 与图片，读者改动按手改记录，失效范围由引擎按输入推导。
// 有需要重做的工作时新版进入「已保存，等待继续」（dag.continuation），只有「继续制作」清除；没有时保持原制作状态。
// 支持文字修改、删除画幅、设置修改（含画风、幅数策略）与仅换图（可带重绘说明）。文字修改按上一版的输入记录为手改，
// 再合入设置修改；保存会使手改失效时，读者须对每处手改选择「以手改为基础」或「放弃」，未选择时不保存。
import {createHash,randomUUID} from 'node:crypto';
import {ReaderError,selectionSchema,type Document,type SessionRow,type Selection} from '../lib/reader-model.ts';
import type {ReaderRepository} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {RevisionChanges} from '../lib/reader-revision.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType,imageTypes} from '../lib/reader-generation-contract.ts';
import {evaluate,instanceId} from '../lib/production-dag/engine.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {castFrom} from '../lib/production-dag/frames.ts';
import {projectDocument,type DagDocument} from '../lib/production-dag/document.ts';
import {settle,stateOf,work,type DagStory} from '../lib/production-dag/runner.ts';
import {handEditChoices} from '../lib/production-dag/hand-edits.ts';
import {verdictNodes} from '../lib/production-dag/review.ts';
import {survivingRevisionFrames} from '../lib/reader-revision.ts';
import {revisionBasis,familyEpoch,currentFamilyVersion,revisionCoverMaxBytes} from './reader-revisions.ts';
import {readableImage} from './reader-image-health.ts';
import {imageDimensions} from '../lib/reader-image-dimensions.ts';
import {dagProgress} from '../lib/production-dag/progress.ts';

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const lostImageMessage=(page:number)=>`第 ${page+1} 幅的图片文件已丢失或损坏。重试会重新绘制这一幅，已保存的其他画面会保留。`;
const frameNodes=['scene','visual','frameImage','landscape',...verdictNodes];

/** 读者的设置修改合入选择；幅数策略改变由引擎重新编排。 */
function nextSelection(selection:Selection,changes:RevisionChanges):Selection{
 return selectionSchema.parse({...selection,
  ...(changes.artStyle?{artStyle:changes.artStyle}:{}),
  ...(changes.artStylePrompt!==undefined?{artStylePrompt:changes.artStylePrompt}:{}),
  ...(changes.productionPrompt!==undefined?{productionPrompt:changes.productionPrompt}:{}),
  ...(changes.acceptancePrompt!==undefined?{acceptancePrompt:changes.acceptancePrompt}:{}),
  ...(changes.narrativeDetail?{narrativeDetail:changes.narrativeDetail}:{}),
  ...(changes.length!==undefined?{length:changes.length}:{}),
 });
}

/** 把读者改动写入 dag：改过的叙事分镜、画面描述与梗概按当前输入记录为手改。 */
function applyEdits(story:DagStory,changes:RevisionChanges):DagDocument{
 const dag=structuredClone(story.dag);
 const handEdit=(node:string,key:string,content:unknown)=>{
  const inst=evaluate(stateOf({...story,dag})).instance(node,key);
  if(!inst.hard)throw new ReaderError(409,'这篇故事的上游内容尚未完成，暂不能修改此处。');
  dag.products[instanceId(node,key)]={hash:fingerprint(content),inputs:inst.hard,...(inst.check&&Object.keys(inst.check).length?{checks:inst.check}:{}),handEdited:true};
 };
 // 删除画幅：按原幅号移除，其产物一并删除；其余画幅保留身份。
 if(changes.removedFrames){
  const survivors=survivingRevisionFrames(dag.order.length,changes.removedFrames);
  if(!changes.plan||!survivors.length||survivors.length!==changes.plan.pages.length||changes.removedFrames.some(p=>p>dag.order.length))throw new ReaderError(400,'删除幅号和修改后的分镜数量必须一致，故事至少保留一幅。');
  const removed=changes.removedFrames.map(p=>dag.order[p-1]);
  dag.order=dag.order.filter(id=>!removed.includes(id));
  for(const id of removed){delete dag.frames[id];for(const node of frameNodes)delete dag.products[instanceId(node,id)];}
 }
 if(changes.plan){
  if(changes.plan.pages.length!==dag.order.length)throw new ReaderError(400,'减幅时请提供原稿中删除的幅号。');
  changes.plan.pages.forEach((page,i)=>{
   const id=dag.order[i],frame=dag.frames[id];
   if(page.caption!==frame.scene){
    frame.scene=page.caption;frame.candidates=castFrom([page.caption,...(frame.people??[])].join(' '),dag.characters);
    handEdit('scene',id,page.caption);
   }
   if(page.prompt!==frame.visual){
    frame.visual=page.prompt;
    handEdit('visual',id,{prompt:page.prompt,drawn:frame.drawnNames??frame.drawn});
   }
  });
 }
 if(changes.storySummary!==undefined&&changes.storySummary!==dag.brief){dag.brief=changes.storySummary;handEdit('brief','',changes.storySummary);}
 return dag;
}

/**
 * 新版的图片复制到新版目录；产物记录不变（同一份图片内容）。原图已丢失或无法辨认时，
 * 成图产物标为不可读并返回其幅号，由调用方记录图片丢失故障，须读者明确重绘；横图丢失则视为未请求。
 */
async function copyImages(media:MediaStore,parentId:string,childId:string,dag:DagDocument):Promise<number[]>{
 const lost:number[]=[];
 for(const [index,id] of dag.order.entries()){
  for(const field of ['image','landscape'] as const){
   const url=dag.frames[id][field];if(!url)continue;
   const key=referenceImageKey(parentId,url),asset=key?await media.get(key).catch(()=>{throw new ReaderError(503,`第 ${index+1} 幅原图暂时无法读取，未创建新版，请稍后重试。`);}):null;
   const bytes=asset?new Uint8Array(await asset.arrayBuffer()):null,type=bytes&&mediaType(bytes);
   if(!bytes||!type){
    delete dag.frames[id][field];
    const product=field==='image'?'frameImage':'landscape';
    if(field==='image'&&dag.products[instanceId(product,id)]){dag.products[instanceId(product,id)]={...dag.products[instanceId(product,id)],readable:false};lost.push(index);}
    else delete dag.products[instanceId(product,id)];
    continue;
   }
   const target=readerImageAsset(childId,index,imageTypes[type],hash(bytes));
   await media.put(target.key,bytes,{contentType:type});
   dag.frames[id][field]=target.url;
  }
 }
 return lost;
}

/** 仅换图：选中画幅删除旧图与产物，重绘说明作为该幅绘图输入；其余内容与结论不变。 */
function applyRedraw(dag:DagDocument,changes:RevisionChanges){
 for(const page of changes.redrawPages??[]){
  const id=dag.order[page-1];if(!id)throw new ReaderError(400,'重绘页码必须属于已保存的完整分镜。');
  const frame=dag.frames[id],note=changes.redrawNotes?.[String(page)];
  if(note)frame.redrawNote=note;else delete frame.redrawNote;
  delete frame.image;delete dag.products[instanceId('frameImage',id)];
 }
}

/** 保存会使手改失效时按读者选择处理：以手改为基础则保留内容、改由修订或转换在其上生成；放弃则删除。 */
function settleHandEdits(story:DagStory,decisions:RevisionChanges['handEdits']):DagDocument{
 const state=stateOf(story),choices=handEditChoices(state,state);
 const missing=choices.filter(c=>!decisions?.[c.id]);
 if(missing.length)throw new ReaderError(409,`这次修改会使 ${missing.length} 处手改失效，请对每处选择以手改为基础或放弃：${missing.map(c=>c.id).join('、')}`);
 const dag=structuredClone(story.dag);
 for(const choice of choices){
  const decision=decisions![choice.id]!;
  if(!choice.options.includes(decision))throw new ReaderError(400,`${choice.id} 只能放弃手改或取消保存。`);
  if(decision==='discard')delete dag.products[choice.id];
  else dag.products[choice.id]={...dag.products[choice.id],handEdited:undefined};
 }
 return dag;
}

type CarriedFault={kind:string;node:string;node_key:string;message:string;image:string|null};
/**
 * 上一版待处理或恢复中的故障里，其涉及的全部节点实例的输入在新版都没有改变的部分。
 * 涉及的实例取故障任务记录的实例（批量任务覆盖多个实例），没有任务的故障取记录的节点与键；输入已变或画幅已不存在的不带入。
 */
async function carryFaults(repo:ReaderRepository,row:SessionRow,ownerId:string,parent:DagStory,child:DagStory):Promise<CarriedFault[]>{
 const faults=(await repo.db.prepare(`SELECT f.kind,f.node,f.node_key,f.message,f.image,j.payload FROM reader_faults f LEFT JOIN production_jobs j ON j.id=f.job_id AND j.session_id=f.session_id AND j.owner_id=f.owner_id
  WHERE f.session_id=? AND f.owner_id=? AND f.state IN ('pending','recovering') AND f.node IS NOT NULL`).bind(row.id,ownerId).all<CarriedFault&{payload:string|null}>()).results;
 if(!faults.length)return [];
 const before=evaluate(stateOf(parent)),after=evaluate(stateOf(child));
 const same=(node:string,key:string)=>{
  if(key!==''&&!child.dag.order.includes(key))return false;
  try{return JSON.stringify(before.instance(node,key).hard)===JSON.stringify(after.instance(node,key).hard);}catch{return false;}
 };
 return faults.filter(fault=>{
  let instances:{node:string;key:string}[]=[{node:fault.node,key:fault.node_key}];
  try{const work=fault.payload?(JSON.parse(fault.payload) as {work?:{instances?:{node:string;key:string}[]}}).work:undefined;if(work?.instances?.length)instances=work.instances;}catch{/* 沿用记录的节点 */}
  return instances.every(i=>same(i.node,i.key));
 }).map(({payload:_,...fault})=>{void _;return fault;});
}

export type RevisionPreview={changed:boolean;total:number;redraw:number;reused:number;
 /** 需要重做的文字工作，按调用名计数（批量调用按产出的实例数）。 */
 textWork:Record<string,number>;
 /** 保存后是否有需要重做的工作，即是否进入「已保存，等待继续」。 */
 continues:boolean;
 /** 这次修改会使哪些手改失效，及读者可选的处理。 */
 handEdits:{id:string;options:string[]}[];
 /** 已有未结故障中，保存后继续阻断的数量。 */
 carriedFaults:number};

/**
 * 保存前的预估：与保存使用同一套引擎推导（手改失效、设置合入、失效范围），只计算不写入。
 * 未选择的手改按「以手改为基础」估算；需要读者选择的会列在 handEdits。
 */
export async function previewDagRevision(repo:ReaderRepository,row:SessionRow,token:string,changes:RevisionChanges):Promise<RevisionPreview>{
 const {doc,token:current}=await revisionBasis(repo,row);
 if(current!==token)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
 if(!doc.dag)throw new ReaderError(409,'这篇故事还没有进入制作，请稍后再修改。');
 const selection=nextSelection(selectionSchema.parse(JSON.parse(row.selection)),changes);
 const parent:DagStory={id:row.id,doc,selection:selectionSchema.parse(JSON.parse(row.selection)),dag:doc.dag,confirmed:true,faults:[]};
 const edited=applyEdits(parent,changes);
 applyRedraw(edited,changes);
 const child:DagStory={...parent,selection,dag:edited};
 const state=stateOf(child),choices=handEditChoices(state,state);
 const decisions=Object.fromEntries(choices.map(c=>[c.id,changes.handEdits?.[c.id]??(c.options.includes('use-as-base')?'use-as-base':'discard')]));
 child.dag=settleHandEdits(child,decisions as RevisionChanges['handEdits']);
 child.dag={...child.dag,repairs:undefined,issues:[],suggestions:[]};
 child.dag=settle(child);
 const ev=evaluate(stateOf(child)),order=child.dag.order;
 const redraw=order.filter(id=>ev.instance('frameImage',id).status!=='valid').length;
 const items=work(child),textWork:Record<string,number>={};
 for(const item of items)if(item.call!=='draw'&&item.call!=='drawLandscape')textWork[item.call]=(textWork[item.call]??0)+item.instances.length;
 const carried=await carryFaults(repo,row,row.user_id,parent,child);
 return {changed:Object.keys(changes).length>0,total:order.length,redraw,reused:order.length-redraw,textWork,continues:items.length>0||redraw>0,handEdits:choices.map(c=>({id:c.id,options:[...c.options]})),carriedFaults:carried.length};
}

export async function forkDagRevision(repo:ReaderRepository,media:MediaStore,ownerId:string,row:SessionRow,requestId:string,token:string,changes:RevisionChanges,paused:boolean,requestHash:string,cover?:Uint8Array):Promise<SessionRow>{
 if(!Object.keys(changes).length)throw new ReaderError(400,'没有需要保存的修改。');
 const {doc,rootId,epoch,token:current}=await revisionBasis(repo,row);
 if(changes.redrawPages&&(row.state!=='completed'||Object.keys(changes).some(key=>!['redrawPages','redrawNotes'].includes(key))))throw new ReaderError(409,'仅换图需要已完成的故事，且不能同时修改文字或设置。');
 if(changes.redrawNotes&&Object.keys(changes.redrawNotes).some(page=>!changes.redrawPages?.includes(Number(page))))throw new ReaderError(400,'重绘说明只能用于本次选中的画幅。');
 if(current!==token)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
 // 指定首幅原图（v0.14.0 的 --cover）：只用于已完成且审核通过的故事换画风；文件须是可读取的 PNG/JPEG/WebP，不超过 12 MiB、宽高各不超过 4096。
 const coverType=cover&&mediaType(cover);
 if(cover){
  const dimensions=imageDimensions(cover);
  const reviewPassed=dagProgress(doc,selectionSchema.parse(JSON.parse(row.selection)))?.review.reviewStatus==='passed';
  if(Object.keys(changes).length!==1||!changes.artStyle||row.state!=='completed'||!reviewPassed)throw new ReaderError(409,'指定首幅原图仅适用于已完成且审核通过的故事换画风。');
  if(cover.length>revisionCoverMaxBytes||!coverType||!dimensions||dimensions.width>4096||dimensions.height>4096||!await readableImage(cover))throw new ReaderError(400,'请选择可读取的 PNG、JPEG 或 WebP，文件不超过 12 MiB，宽高各不超过 4096 像素。');
 }
 const selection=nextSelection(selectionSchema.parse(JSON.parse(row.selection)),changes);
 const reviewNotes=(changes.reviewNotes!==undefined?changes.reviewNotes:doc.reviewNotes)?.trim()||undefined;
 const parent:DagStory={id:row.id,doc,selection:selectionSchema.parse(JSON.parse(row.selection)),dag:doc.dag!,confirmed:true,faults:[]};
 // 文字修改按上一版的输入记录为手改，再合入设置修改，由引擎判断哪些产物失效。
 const edited=applyEdits(parent,changes);
 applyRedraw(edited,changes);
 const child:DagStory={...parent,id:requestId,selection,doc:{...doc,reviewNotes},dag:edited};
 child.dag=settleHandEdits(child,changes.handEdits);
 const lost=await copyImages(media,row.id,requestId,child.dag);
 if(cover&&coverType){
  // 首幅原图字节不变地保存到新版，立即作为首幅显示；其成图产物在画面描述转换完成、输入就绪后由 settle() 记录。
  const first=child.dag.order[0],asset=readerImageAsset(requestId,0,imageTypes[coverType],hash(cover));
  await media.put(asset.key,cover,{contentType:coverType});
  child.dag=structuredClone(child.dag);
  child.dag.cover={frame:first,image:asset.url};
  child.dag.frames[first].image=asset.url;delete child.dag.products[instanceId('frameImage',first)];
 }
 // 新修订重新开始自动修订额度，审片问题与建议不带入新版。
 child.dag={...child.dag,repairs:undefined,issues:[],suggestions:[]};
 child.dag=settle(child);
 const pending=work(child).length>0;
 const dag:DagDocument={...child.dag,...(pending?{continuation:{revision:epoch+1,reason:'revision-saved' as const}}:{})};
 if(!pending)delete dag.continuation;
 const {plan,images}=projectDocument(dag,doc.plan);
 const document:Document={...doc,dag,plan,images,reviewNotes,usage:(doc.usage||[]).map(item=>({...item,originId:item.originId||row.id})),
  revision:{parentId:row.id,rootId,number:epoch+1,baseToken:token,requestHash,base:{selection:parent.selection,plan:doc.plan,images:doc.images}}};
 delete document.visualReview;delete document.reselection;
 const now=new Date().toISOString(),completed=!pending&&row.state==='completed';
 // 故障延续：上一版仍待处理的故障，其节点的输入在新版里没有改变时继续阻断，须读者明确恢复；输入已变的故障不带入（新内容重新开始）。
 const carried=await carryFaults(repo,row,ownerId,parent,{...child,dag});
 // 新版与其图片丢失故障在同一事务中写入：中断不会留下未经读者恢复就可重绘的新版。
 const transaction=repo.db.transaction;
 if(!transaction)throw Error('TRANSACTION_UNAVAILABLE');
 transaction.call(repo.db,db=>{
  const inserted=db.run(`INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,error,step_attempts,lock_until,page,saved,last_read_at,created_at,updated_at)
  SELECT ?,?,json_patch(?,CASE WHEN json_type(p.selection,'$.displayTitle')='text' THEN json_object('displayTitle',json_extract(p.selection,'$.displayTitle')) ELSE '{}' END),json_patch(?,json_object('publication',json_extract(p.document,'$.publication'))),'background',?,?,NULL,0,0,p.page,p.saved,p.last_read_at,?,? FROM stories p
  WHERE p.id=? AND p.user_id=? AND p.document=? AND p.selection=? AND ${currentFamilyVersion('p')} AND (${familyEpoch.replace(' AS epoch','')})=?
  ON CONFLICT(id) DO NOTHING`,requestId,ownerId,JSON.stringify(selection),JSON.stringify(document),paused?'paused':'active',completed?'completed':'idle',now,now,row.id,ownerId,row.document,row.selection,ownerId,rootId,rootId,epoch);
  if(!inserted.changes)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
  for(const fault of carried){
   if(lost.some(page=>fault.node==='frameImage'&&dag.order[page]===fault.node_key))continue;
   const at=Date.now();
   db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,image,message,created_at,updated_at) VALUES(?,?,?,?,?,?,'dag',?,?,?,?)",randomUUID(),requestId,ownerId,fault.kind==='interrupted'?'job':fault.kind,fault.node,fault.node_key,fault.image,fault.message,at,at);
  }
  // 丢失的成图记为待处理的图片丢失故障：阻断该幅及依赖它的工作与整篇完成，读者明确恢复后才重绘。
  for(const page of lost){
   const at=Date.now();
   db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,message,created_at,updated_at) VALUES(?,?,?,'image-loss','frameImage',?,'dag',?,?,?)",randomUUID(),requestId,ownerId,dag.order[page],lostImageMessage(page),at,at);
  }
 });
 return repo.get(requestId,ownerId);
}
