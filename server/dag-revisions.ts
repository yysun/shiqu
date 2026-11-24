// 制作 DAG 故事的修订保存：新版复制上一版的 dag 与图片，读者改动按手改记录，失效范围由引擎按输入推导。
// 有重做工作时保留「已保存，等待继续」，阅读器明确确认的单幅重绘直接进入绘图队列。
// 支持文字修改、删除画幅、设置修改（含画风、幅数策略）与仅换图（可带重绘说明）。文字修改按上一版的输入记录为手改，
// 再合入设置修改；保存会使手改失效时，读者须对每处手改选择「以手改为基础」或「放弃」，未选择时不保存。
import {createHash,randomUUID} from 'node:crypto';
import {ReaderError,selectionSchema,type Document,type SessionRow,type Selection} from '../lib/reader-model.ts';
import type {ReaderRepository,ReadStatements} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {RevisionChanges} from '../lib/reader-revision.ts';
import {lostImageMessage,readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType,imageTypes} from '../lib/reader-generation-contract.ts';
import {evaluate,instanceId} from '../lib/production-dag/engine.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {castFrom} from '../lib/production-dag/frames.ts';
import {projectDocument,rootProducts,type DagDocument} from '../lib/production-dag/document.ts';
import {settle,stateOf,syncItems,work,type DagStory} from '../lib/production-dag/runner.ts';
import {handEditChoices} from '../lib/production-dag/hand-edits.ts';
import {verdictNodes} from '../lib/production-dag/review.ts';
import {survivingRevisionFrames,usesStoryImageReference} from '../lib/reader-revision.ts';
import {revisionBasis,familyEpoch,currentFamilyVersion,revisionCoverMaxBytes,revisionToken} from './reader-revisions.ts';
import {readableImage} from './reader-image-health.ts';
import {imageDimensions} from '../lib/reader-image-dimensions.ts';
import {sameArtDirection} from '../lib/reader-styles.ts';
import {dagProgress} from '../lib/production-dag/progress.ts';
import {transact} from './production-records.ts';
import {authorizeProductionCommand} from '../lib/production-lifecycle.ts';
import {carryFaults,carriedFaultRows,insertCarriedJobFault,unexecutedLandscapeRecovery,type FaultToCarry} from './dag-revision-faults.ts';

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const frameNodes=['scene','visual','frameImage','landscape',...verdictNodes];
const landscapeFaultKeys=(db:ReadStatements,id:string,ownerId:string)=>new Set(db.all<{node_key:string}>(`SELECT node_key FROM reader_faults f
 WHERE session_id=? AND owner_id=? AND node='landscape' AND (state IN ('pending','recovering') OR ${unexecutedLandscapeRecovery})`,id,ownerId).map(fault=>fault.node_key));

/** 旧版未记录请求输入：只有与父版同代次的请求才是继承。以原授权的硬输入核对，无法查清时等待新的明确授权。 */
export function bindLegacyLandscapeRequests(db:ReadStatements,ownerId:string,story:DagStory):DagStory{
 const visited=new Set<string>();
 const bind=(current:DagStory):DagStory=>{
  const {id,doc,dag}=current,revision=doc.revision;
  if(!revision||visited.has(id))return current;
  const keys=dag.order.filter(key=>{
   const frame=dag.frames[key];
   return frame.landscape===''&&!frame.landscapeInputHash&&revision.redrawFrame!==key;
  });
  if(!keys.length)return current;
  visited.add(id);
  const row=visited.has(revision.parentId)?undefined:db.get<Pick<SessionRow,'document'|'selection'>>(
   'SELECT document,selection FROM stories WHERE id=? AND user_id=? AND json_valid(document) AND json_valid(selection)',revision.parentId,ownerId);
  const parentDoc=row?JSON.parse(row.document) as Document:null;
  const selection=row&&selectionSchema.safeParse(JSON.parse(row.selection));
  const parent=parentDoc?.dag&&selection?.success?bind({id:revision.parentId,doc:parentDoc,dag:parentDoc.dag,selection:selection.data,confirmed:true,faults:[]}):null;
  const evaluation=parent&&evaluate(stateOf(parent)),frames={...dag.frames},failed=landscapeFaultKeys(db,id,ownerId);
  for(const key of keys){
   const before=parent?.dag.frames[key],frame=frames[key];
   if(parent&&(before?.landscape===undefined||before.landscapeAttempt!==frame.landscapeAttempt))continue;
   const inputs=(before?.landscape?parent?.dag.products[instanceId('landscape',key)]?.inputs:undefined)??evaluation?.instance('landscape',key).hard;
   const binding=frame.landscapeError||failed.has(key)?before?.landscapeInputHash??fingerprint(inputs??null):fingerprint(null);
   frames[key]={...frame,landscapeInputHash:binding};
  }
  return {...current,dag:{...dag,frames}};
 };
 return bind(story);
}

/** 读者的设置修改合入选择；幅数策略改变由引擎重新编排。 */
function nextSelection(selection:Selection,changes:RevisionChanges):Selection{
 // 换预设画风而没有同时给出自定义画风说明时，旧预设的自定义说明不再适用，必须清除，否则整套重绘会用错画风。
 const presetChanged=!!changes.artStyle&&changes.artStyle!==selection.artStyle&&changes.artStylePrompt===undefined;
 const base:Selection={...selection};if(presetChanged)delete base.artStylePrompt;
 return selectionSchema.parse({...base,
  ...(changes.artStyle?{artStyle:changes.artStyle}:{}),
  ...(changes.artStylePrompt!==undefined?{artStylePrompt:changes.artStylePrompt}:{}),
  ...(changes.productionPrompt!==undefined?{productionPrompt:changes.productionPrompt}:{}),
  ...(changes.acceptancePrompt!==undefined?{acceptancePrompt:changes.acceptancePrompt}:{}),
  ...(changes.narrativeDetail?{narrativeDetail:changes.narrativeDetail}:{}),
  ...(changes.length!==undefined?{length:changes.length}:{}),
 });
}

/**
 * 人物设定的修改：按「姓名：设定」逐行对应到已保存的人物，只更新改过的人物，
 * 其指纹变化只使画过该人物的画幅重绘。无法逐行对应时拒绝保存，不能静默丢弃。
 */
function editCharacters(dag:DagDocument,text:string,handEdit:(node:string,key:string,content:unknown)=>void){
 const shown=dag.characters.map(c=>c.legacy?c.text:`${c.name}：${c.text}`).join('\n');
 if(!dag.characters.length||text===shown)return;
 const next=dag.characters.map(c=>({...c}));
 if(next.length===1&&next[0].legacy)next[0].text=text;
 else{
  const lines=text.split('\n').map(line=>line.trim()).filter(Boolean);
  if(lines.length!==next.length)throw new ReaderError(400,'人物设定需保持原有的人数，每行写成「姓名：设定」。');
  next.forEach((c,i)=>{
   const prefix=`${c.name}：`;
   if(!lines[i].startsWith(prefix))throw new ReaderError(400,`人物设定第 ${i+1} 行需以「${prefix}」开头，姓名不能在这里修改。`);
   c.text=lines[i].slice(prefix.length).trim();
  });
 }
 const changedIds=next.filter((c,i)=>c.text!==dag.characters[i].text).map(c=>c.id);
 if(!changedIds.length)return;
 dag.characters=next;
 for(const id of dag.order){const f=dag.frames[id];f.candidates=castFrom([f.scene,...(f.people??[])].join(' '),dag.characters);}
 const content=next.map(c=>({id:c.id,name:c.name,aliases:c.aliases,text:c.text}));
 handEdit('characters','',content);
 const product=dag.products[instanceId('characters')];
 product.parts=Object.fromEntries(next.map((c,i)=>[c.id,c.legacy?fingerprint(c.text):fingerprint(content[i])]));
}

/** 标题与余味的修改记为读者确认的结语；它是根产物，由 settle 重新记录，依赖它的审片随之重做。 */
function editEnding(dag:DagDocument,story:DagStory,plan:NonNullable<RevisionChanges['plan']>){
 const shown=projectDocument(dag,story.doc.plan??null).plan;
 if(!shown||(plan.title.trim()===shown.title.trim()&&plan.reflection.trim()===shown.reflection.trim()))return;
 dag.ending={...(dag.ending??{title:shown.title,candidates:[]}),confirmed:{title:plan.title,ending:plan.reflection}};
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
   if(page.caption.trim()!==frame.scene.trim()){
    frame.scene=page.caption;frame.candidates=castFrom([page.caption,...(frame.people??[])].join(' '),dag.characters);
    handEdit('scene',id,page.caption);
   }
   if(page.prompt.trim()!==frame.visual.trim()){
    frame.visual=page.prompt;
    addDrawnFrom(frame,page.prompt,dag.characters);
    handEdit('visual',id,{prompt:page.prompt,drawn:frame.drawnNames??frame.drawn});
   }
  });
  editCharacters(dag,changes.plan.characters,handEdit);
  editEnding(dag,story,changes.plan);
 }
 if(changes.storySummary!==undefined&&changes.storySummary!==dag.brief){dag.brief=changes.storySummary;handEdit('brief','',changes.storySummary);}
 return dag;
}

/**
 * 手改画面描述后，按名字和别名在新描述中匹配人物，并入本幅入画人物。原有入画人物保留：
 * 手写描述常用「他」「二人」等称呼，严格按文字重配会丢掉这些人物的设定。没有入画记录的旧稿按全部人物计算，保持不变。
 */
function addDrawnFrom(frame:DagDocument['frames'][string],prompt:string,characters:DagDocument['characters']){
 if(frame.drawn===undefined&&frame.drawnNames===undefined)return;
 const previous=frame.drawn??castFrom((frame.drawnNames??[]).join(' '),characters);
 const added=castFrom(prompt,characters).filter(id=>!previous.includes(id));
 if(!added.length)return;
 const ids=new Set([...previous,...added]);
 frame.drawn=characters.filter(character=>ids.has(character.id)).map(character=>character.id);
 frame.drawnNames=[...(frame.drawnNames??characters.filter(character=>previous.includes(character.id)).map(character=>character.name)),
  ...characters.filter(character=>added.includes(character.id)).map(character=>character.name)];
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
   const product=instanceId(field==='image'?'frameImage':'landscape',id),record=dag.products[product];
   if(!bytes||!type||record?.readable===false&&!await readableImage(bytes)){
    delete dag.frames[id][field];
    if(field==='image'&&record){dag.products[product]={...record,readable:false};lost.push(index);}
    else delete dag.products[product];
    continue;
   }
   const target=readerImageAsset(childId,index,imageTypes[type],hash(bytes));
   await media.put(target.key,bytes,{contentType:type});
   dag.frames[id][field]=target.url;
   if(record?.readable===false)dag.products[product]={...record,readable:true};
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

/** 手改处理的结果：已按决定改写的 dag，以及无法保留、须读者明确放弃的手改。 */
type HandEditOutcome={dag:DagDocument;choices:{id:string;options:string[]}[];conflicts:string[]};

/**
 * 保存会使手改失效时的处理（默认保护）：
 * - 能「以手改为基础」的一律保留其内容（由修订或转换在其上生成，不丢弃）；
 * - 重新编排会产生新画幅、无法保留的手改：未被读者在 API 里明确 `discard` 时，列为冲突，保存被拒绝、草稿保留，不默默放弃。
 * 预估（strict=false）对冲突按放弃估算，同时返回冲突列表。
 */
function settleHandEdits(story:DagStory,decisions:RevisionChanges['handEdits'],strict:boolean):HandEditOutcome{
 const state=stateOf(story),choices=handEditChoices(state,state),conflicts:string[]=[];
 const dag=structuredClone(story.dag);
 for(const choice of choices){
  const explicit=decisions?.[choice.id];
  if(explicit&&!choice.options.includes(explicit))throw new ReaderError(400,`${choice.id} 只能放弃手改或取消保存。`);
  const decision=explicit??(choice.options.includes('use-as-base')?'use-as-base':undefined);
  if(!decision){conflicts.push(choice.id);if(!strict)delete dag.products[choice.id];continue;}
  if(decision==='discard')delete dag.products[choice.id];
  else dag.products[choice.id]={...dag.products[choice.id],handEdited:undefined};
 }
 if(strict&&conflicts.length)throw new ReaderError(409,`这次修改会重新编排并丢弃你手改过的内容：${conflicts.map(id=>handEditLabel(id,story.dag.order)).join('、')}。请先撤销该设置修改；草稿已保留。命令行可用 handEdits 明确放弃。`);
 return {dag,choices:choices.map(c=>({id:c.id,options:[...c.options]})),conflicts};
}
function handEditLabel(id:string,order:string[]){const [node,key]=id.split(':'),number=key?order.indexOf(key)+1:0,name=({scene:'配文',visual:'画面描述',brief:'梗概',characters:'人物设定',ending:'标题与结语'} as Record<string,string>)[node]??node;return number>0?`第 ${number} 幅的${name}`:name;}

/**
 * 修订的唯一计算（保存与预估共用）：合入设置与文字修改（含审核意见），按手改默认保护处理手改，
 * 新修订重新开始自动修订额度，审片问题与建议不带入。不写入、不读媒体；保存另外复制图片与首幅原图后再 settle。
 */
function deriveRevision(db:ReadStatements,doc:Document,row:SessionRow,changes:RevisionChanges,childId:string,strict:boolean){
 // 原文出处与改编说明是来源信息，不随分镜编辑改变（v0.14.0 同样拒绝）。
 if(changes.plan&&doc.plan&&(['sourceReference','adaptationNote'] as const).some(key=>changes.plan![key]!==doc.plan![key]))throw new ReaderError(400,'本次仅修改分镜、人物与余味，原文出处和改编说明保持不变。');
 const selection=nextSelection(selectionSchema.parse(JSON.parse(row.selection)),changes);
 const reviewNotes=(changes.reviewNotes!==undefined?changes.reviewNotes:doc.reviewNotes)?.trim()||undefined;
 const parent=bindLegacyLandscapeRequests(db,row.user_id,{id:row.id,doc,selection:selectionSchema.parse(JSON.parse(row.selection)),dag:doc.dag!,confirmed:true,faults:[]});
 // 文字修改按上一版的输入记录为手改，再合入设置修改，由引擎判断哪些产物失效。
 const edited=applyEdits(parent,changes);
 applyRedraw(edited,changes);
 const child:DagStory={...parent,id:childId,selection,doc:{...doc,reviewNotes},dag:edited};
 const roots=(story:DagStory)=>rootProducts(story.selection,syncItems(story.dag,story.selection),{notes:story.doc.reviewNotes});
 const changed=!!changes.redrawPages||fingerprint(edited)!==fingerprint(parent.dag)||fingerprint(roots(child))!==fingerprint(roots(parent));
 if(!changed)return {parent,child,selection,reviewNotes,changed,choices:[],conflicts:[]};
 delete edited.resumeUnreviewed;
 for(const [id,product] of Object.entries(edited.products))if(product.unreviewed)delete edited.products[id];
 const outcome=settleHandEdits(child,changes.handEdits,strict);
 child.dag={...outcome.dag,repairs:undefined,issues:[],suggestions:[]};
 const previous=evaluate(stateOf(parent)),failed=landscapeFaultKeys(db,row.id,row.user_id);
 for(const key of child.dag.order){
  const frame=child.dag.frames[key];
  if(frame.landscape!=='')continue;
  const hard=previous.instance('landscape',key).hard;
  if((frame.landscapeError||failed.has(key))&&!frame.landscapeInputHash&&hard)frame.landscapeInputHash=fingerprint(hard);
  if(!(frame.landscapeError||failed.has(key))||!frame.landscapeInputHash){
   delete frame.landscape;delete frame.landscapeInputHash;delete frame.landscapeError;delete frame.landscapeAttempt;
  }
 }
 return {parent,child,selection,reviewNotes,changed,choices:outcome.choices,conflicts:outcome.conflicts};
}

export type RevisionPreview={changed:boolean;total:number;redraw:number;reused:number;
 /** 需要重做的文字工作，按调用名计数（批量调用按产出的实例数）。 */
 textWork:Record<string,number>;
 /** 保存后是否有需要重做的工作，即是否进入「已保存，等待继续」。 */
 continues:boolean;
 /** 这次修改会使哪些手改失效，及读者可选的处理。 */
 handEdits:{id:string;options:string[]}[];
 /** 无法保留的手改：保存会被拒绝（读者须先撤销该设置修改）；预估对它们按放弃估算。 */
 conflicts:{id:string;message:string}[];
 /** 已有未结故障中，保存后继续阻断的目标数量。 */
 carriedFaults:number};

/**
 * 保存前的预估：与保存使用同一套引擎推导（手改失效、设置合入、失效范围），只计算不写入。
 * 未选择的手改按「以手改为基础」估算；需要读者选择的会列在 handEdits。
 */
export async function previewDagRevision(repo:ReaderRepository,row:SessionRow,token:string,changes:RevisionChanges):Promise<RevisionPreview>{
 const {doc,token:current}=await revisionBasis(repo,row);
 const authorization=authorizeProductionCommand('save-revision',{
  version:'current',control:row.generation_control??'active',continuation:!!doc.dag?.continuation,stopping:false,
  targetCurrent:current===token,targetReady:!!doc.dag,
 });
 if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
 if(changes.reviewNotes!==undefined){
  const edit=authorizeProductionCommand('edit-review-notes',{version:'current',control:row.generation_control??'active',continuation:!!doc.dag?.continuation,
   stopping:false,targetCurrent:current===token,targetReady:!!doc.plan});
  if(!edit.allowed)throw new ReaderError(edit.status,edit.message);
 }
 const derive=(db:ReadStatements)=>deriveRevision(db,doc,row,changes,row.id,false);
 const {parent,child,changed,choices,conflicts}=repo.db.readTransaction?.(derive)??transact(repo.db,derive);
 if(!changed)return {changed:false,total:child.dag.order.length,redraw:0,reused:doc.images.filter(Boolean).length,textWork:{},continues:false,handEdits:[],conflicts:[],carriedFaults:0};
 child.dag=settle(child);
 const ev=evaluate(stateOf(child)),order=child.dag.order;
 const redraw=order.filter(id=>ev.instance('frameImage',id).status!=='valid').length;
 const items=work(child),textWork:Record<string,number>={};
 for(const item of items)if(item.call!=='draw'&&item.call!=='drawLandscape')textWork[item.call]=(textWork[item.call]??0)+item.instances.length;
 const rows=(await repo.db.prepare(carriedFaultRows).bind(row.id,row.user_id).all<FaultToCarry>()).results;
 const carried=carryFaults(rows,parent,child);
 return {changed,total:order.length,redraw,reused:order.length-redraw,textWork,continues:items.length>0||redraw>0,handEdits:choices,conflicts:conflicts.map(id=>({id,message:`重新编排会丢弃${handEditLabel(id,doc.dag!.order)}的手改`})),carriedFaults:carried.length};
}

export async function forkDagRevision(repo:ReaderRepository,media:MediaStore,ownerId:string,row:SessionRow,requestId:string,token:string,changes:RevisionChanges,paused:boolean,requestHash:string,cover?:Uint8Array,startRedraw=false):Promise<SessionRow>{
 if(!Object.keys(changes).length)throw new ReaderError(400,'没有需要保存的修改。');
 if(startRedraw&&(paused||changes.redrawPages?.length!==1))throw new ReaderError(400,'直接重绘只支持立即生成一幅画。');
 const {doc,rootId,epoch,token:current}=await revisionBasis(repo,row);
 const state={version:'current' as const,control:row.generation_control??'active',continuation:!!doc.dag?.continuation,stopping:false};
 const authorization=authorizeProductionCommand('save-revision',{...state,targetCurrent:current===token,targetReady:!!doc.dag});
 if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
 if(changes.reviewNotes!==undefined){
  const edit=authorizeProductionCommand('edit-review-notes',{...state,targetCurrent:current===token,targetReady:!!doc.plan});
  if(!edit.allowed)throw new ReaderError(edit.status,edit.message);
 }
 if(changes.redrawPages){
  const redraw=authorizeProductionCommand('redraw',{...state,targetReady:true,targetCurrent:row.state==='completed'&&
   !Object.values(doc.dag!.products).some(product=>product.unreviewed)&&Object.keys(changes).every(key=>['redrawPages','redrawNotes'].includes(key))});
  if(!redraw.allowed)throw new ReaderError(redraw.status,redraw.message);
 }
 if(changes.redrawNotes&&Object.keys(changes.redrawNotes).some(page=>!changes.redrawPages?.includes(Number(page))))throw new ReaderError(400,'重绘说明只能用于本次选中的画幅。');
 // 指定首幅原图（v0.14.0 的 --cover）：只用于已完成且审核通过的故事换画风；文件须是可读取的 PNG/JPEG/WebP，不超过 12 MiB、宽高各不超过 4096。
 const coverType=cover&&mediaType(cover);
 if(cover){
  const dimensions=imageDimensions(cover);
  const reviewPassed=dagProgress(doc,selectionSchema.parse(JSON.parse(row.selection)))?.review.reviewStatus==='passed'&&!Object.values(doc.dag!.products).some(product=>product.unreviewed);
  const accepted=authorizeProductionCommand('cover',{...state,targetCurrent:true,
   targetReady:Object.keys(changes).length===1&&!!changes.artStyle&&row.state==='completed'&&reviewPassed});
  if(!accepted.allowed)throw new ReaderError(accepted.status,accepted.message);
  if(cover.length>revisionCoverMaxBytes||!coverType||!dimensions||dimensions.width>4096||dimensions.height>4096||!await readableImage(cover))throw new ReaderError(400,'请选择可读取的 PNG、JPEG 或 WebP，文件不超过 12 MiB，宽高各不超过 4096 像素。');
 }
 const derive=(db:ReadStatements)=>deriveRevision(db,doc,row,changes,requestId,true);
 const {parent,child,selection,reviewNotes,changed}=repo.db.readTransaction?.(derive)??transact(repo.db,derive);
 if(!changed&&!cover){
  // 等价保存只记回执。重新读取当前稿件允许正在收尾的成图写入，同时拒绝过期版本与编辑依据。
  transact(repo.db,db=>{
   const replay=db.get<{session_id:string;action:string;fingerprint:string}>('SELECT session_id,action,fingerprint FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId);
   if(replay){
    if(replay.session_id!==row.id||replay.action!=='revision-noop'||replay.fingerprint!==requestHash)throw new ReaderError(409,'这个操作编号已用于其他内容。');
    return;
   }
   if(db.get('SELECT id FROM stories WHERE user_id=? AND id=?',ownerId,requestId))
    throw new ReaderError(409,'这个操作编号已用于其他内容。');
   const latest=db.get<SessionRow>(`SELECT p.* FROM stories p WHERE p.id=? AND p.user_id=? AND ${currentFamilyVersion('p')}`,row.id,ownerId);
   if(!latest)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
   const currentDoc=JSON.parse(latest.document) as Document;
   const currentEpoch=db.get<{epoch:number}>(familyEpoch,ownerId,rootId,rootId)!.epoch;
   if(currentDoc.dag?.repreparing||revisionToken(latest,currentDoc,currentEpoch)!==token||deriveRevision(db,currentDoc,latest,changes,requestId,true).changed)
    throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
   const now=Date.now();
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at) VALUES(?,?,?,'revision-noop',?,'{}',?,?,?)",requestId,ownerId,row.id,requestHash,row.id,now,now);
  });
  return repo.get(row.id,ownerId);
 }
 const redrawFrame=startRedraw?child.dag.order[changes.redrawPages![0]-1]:undefined;
 const redrawLandscape=redrawFrame&&!!parent.dag.frames[redrawFrame].landscape&&evaluate(stateOf(parent)).instance('landscape',redrawFrame).status==='valid';
 if(redrawLandscape){
  child.dag.frames[redrawFrame].landscape='';
  delete child.dag.frames[redrawFrame].landscapeInputHash;
  delete child.dag.frames[redrawFrame].landscapeError;
  delete child.dag.products[instanceId('landscape',redrawFrame)];
 }
 const lost=await copyImages(media,row.id,requestId,child.dag);
 if(cover&&coverType){
  // 首幅原图字节不变地保存到新版，立即作为首幅显示；其成图产物在画面描述转换完成、输入就绪后由 settle() 记录。
  const first=child.dag.order[0],asset=readerImageAsset(requestId,0,imageTypes[coverType],hash(cover));
  await media.put(asset.key,cover,{contentType:coverType});
  child.dag=structuredClone(child.dag);
  child.dag.cover={frame:first,image:asset.url};
  child.dag.frames[first].image=asset.url;delete child.dag.products[instanceId('frameImage',first)];
 }
 child.dag=settle(child);
 const items=work(child),pending=items.length>0;
 if(redrawFrame){
  const redraw=authorizeProductionCommand('redraw',{...state,targetCurrent:true,targetReady:lost.length===0&&items.some(item=>item.call==='draw')&&
   items.every(item=>['draw','drawLandscape'].includes(item.call)&&item.instances.every(instance=>instance.key===redrawFrame))});
  if(!redraw.allowed)throw new ReaderError(redraw.status,redraw.message);
 }
 const waiting=pending&&!startRedraw;
 const dag:DagDocument={...child.dag,...(waiting?{continuation:{revision:epoch+1,reason:'revision-saved' as const}}:{})};
 if(!waiting)delete dag.continuation;
 const {plan,images}=projectDocument(dag,doc.plan);
 const document:Document={...doc,dag,plan,images,reviewNotes,usage:(doc.usage||[]).map(item=>({...item,originId:item.originId||row.id})),
  revision:{parentId:row.id,rootId,number:epoch+1,baseToken:token,requestHash,...(redrawLandscape?{redrawFrame,landscapeRedraw:dag.order.map(id=>id===redrawFrame?null:dag.frames[id].landscape||'')}:{}),...(cover||!sameArtDirection(parent.selection,selection)||usesStoryImageReference(doc.revision,parent.selection.artStyle)?{storyImageReference:true}:{}),base:{selection:parent.selection,plan:doc.plan,images:doc.images}}};
 delete document.visualReview;delete document.reselection;
 const now=new Date().toISOString(),completed=!pending&&row.state==='completed';
 // 故障延续：上一版仍待处理的故障，其节点的输入在新版里没有改变时继续阻断，须读者明确恢复；输入已变的故障不带入（新内容重新开始）。
 // 普通修订在同一事务设置等待并保留读者控制；已确认的单幅重绘在同一事务启用绘图。
 // 新版与其图片丢失故障在同一事务中写入：中断不会留下未经读者恢复就可重绘的新版。
 const transaction=repo.db.transaction;
 if(!transaction)throw Error('TRANSACTION_UNAVAILABLE');
 transaction.call(repo.db,db=>{
  if(db.get('SELECT request_id FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId))
   throw new ReaderError(409,'这个操作编号已用于其他内容。');
  const inserted=db.run(`INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,error,step_attempts,lock_until,page,saved,last_read_at,created_at,updated_at)
  SELECT ?,?,json_patch(?,CASE WHEN json_type(p.selection,'$.displayTitle')='text' THEN json_object('displayTitle',json_extract(p.selection,'$.displayTitle')) ELSE '{}' END),json_patch(?,json_object('publication',json_extract(p.document,'$.publication'))),'background',CASE WHEN ? THEN 'active' WHEN ? THEN 'paused' ELSE p.generation_control END,?,NULL,0,0,MIN(p.page,?),p.saved,p.last_read_at,?,? FROM stories p
  WHERE p.id=? AND p.user_id=? AND p.document=? AND p.selection=? AND ${currentFamilyVersion('p')} AND (${familyEpoch.replace(' AS epoch','')})=?
  ON CONFLICT(id) DO NOTHING`,requestId,ownerId,JSON.stringify(selection),JSON.stringify(document),startRedraw?1:0,paused?1:0,completed?'completed':'idle',Math.max(0,dag.order.length-1),now,now,row.id,ownerId,row.document,row.selection,ownerId,rootId,rootId,epoch);
  if(!inserted.changes)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
  const carried=carryFaults(db.all<FaultToCarry>(carriedFaultRows,row.id,ownerId),parent,{...child,dag});
  for(const fault of carried){
   if((fault.kind!=='image-loss'||!fault.input_hash)&&fault.node==='frameImage'&&lost.some(page=>dag.order[page]===fault.node_key))continue;
   const at=Date.now();
   if(fault.kind==='image-loss'&&fault.input_hash){
    db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,input_hash,origin_fault_id,version,state,message,created_at,updated_at) VALUES(?,?,?,'image-loss','frameImage','',?,?,'dag','awaiting-match',?,?,?)",
     randomUUID(),requestId,ownerId,fault.input_hash,fault.id,'待核对旧版丢图是否影响新版画幅。',at,at);
    continue;
   }
   if(fault.kind==='job'||fault.kind==='interrupted')insertCarriedJobFault(db,requestId,ownerId,fault,at);
   else db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,version,image,message,created_at,updated_at) VALUES(?,?,?,?,?,?,'dag',?,?,?,?)",
    randomUUID(),requestId,ownerId,fault.kind,fault.node,fault.node_key,fault.image,fault.message,at,at);
  }
  // 丢失的成图记为待处理的图片丢失故障：阻断该幅及依赖它的工作与整篇完成，读者明确恢复后才重绘。
  for(const page of lost){
   const at=Date.now();
   const key=dag.order[page],product=dag.products[instanceId('frameImage',key)];
   if(product&&carried.some(fault=>fault.kind==='image-loss'&&fault.input_hash===fingerprint(product.inputs)))continue;
   db.run("INSERT INTO reader_faults(id,session_id,owner_id,kind,node,node_key,input_hash,version,message,created_at,updated_at) VALUES(?,?,?,'image-loss','frameImage',?,?,'dag',?,?,?)",randomUUID(),requestId,ownerId,key,product?fingerprint(product.inputs):null,lostImageMessage(page),at,at);
  }
 });
 return repo.get(requestId,ownerId);
}
