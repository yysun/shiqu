import {productionStorageHash,writeStoryProducts} from './production-products.ts';
import {recordFamilyImage} from './media.ts';
// 制作 DAG 故事的修订保存：新版复制上一版的 dag 与图片，读者改动按手改记录，失效范围由引擎按输入推导。
// 有重做工作时保留「已保存，等待继续」，阅读器明确确认的单幅重绘直接进入绘图队列。
// 只在结构变化移除手改画幅时确认一次；清空手改字段后，下次继续重新生成该字段。
import {decodeDocument} from '../lib/production-dag/document.ts';
import {createHash,randomUUID} from 'node:crypto';
import {ReaderError,selectionSchema,type Document,type SessionRow,type Selection} from '../lib/reader-model.ts';
import type {ReaderRepository,ReadStatements} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import type {LostHandEdit,RevisionChanges,ReviewSuggestionDraft,ReviewSuggestionRequest} from '../lib/reader-revision.ts';
import {readerMinFrames,readerMaxFrames} from '../lib/reader-limits.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType,imageTypes} from '../lib/reader-generation-contract.ts';
import {evaluate,instanceId} from '../lib/production-dag/engine.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';
import {castFrom} from '../lib/production-dag/frames.ts';
import {projectDocument,rootProducts,type DagDocument} from '../lib/production-dag/document.ts';
import {settle,stateOf,work,deriveProduction,applyStructureEdits,structureEditPlan,type DagStory,type Work} from '../lib/production-dag/runner.ts';
import {structuralLoss} from '../lib/production-dag/hand-edits.ts';
import {reviewRepairField,verdictNodes} from '../lib/production-dag/review.ts';
import {checkedRevision,survivingRevisionFrames,usesStoryImageReference} from '../lib/reader-revision.ts';
import {revisionBasis,familyEpoch,currentFamilyVersion,revisionCoverMaxBytes,revisionToken} from './reader-revisions.ts';
import {readableImage} from './reader-image-health.ts';
import {imageDimensions} from '../lib/reader-image-dimensions.ts';
import {sameArtDirection} from '../lib/reader-styles.ts';
import {portraitDocument} from '../lib/production-dag/copy.ts';
import {dagProgress,reviewAttention} from '../lib/production-dag/progress.ts';
import {transact} from './production-records.ts';
import {authorizeProductionCommand} from '../lib/production-lifecycle.ts';
import {editRequirements} from '../lib/reader-requirements.ts';

type SaveImage=(index:number,bytes:Uint8Array,type:keyof typeof imageTypes)=>Promise<string>;
const frameNodes=['scene','visual','frameImage',...verdictNodes];

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
 const shown=dag.characters.map(c=>c.name?`${c.name}：${c.text}`:c.text).join('\n');
 if(!dag.characters.length||text===shown)return;
 const next=dag.characters.map(c=>({...c}));
 if(next.length===1&&!next[0].name)next[0].text=text;
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
 const content=next.map(c=>({id:c.id,name:c.name,aliases:c.aliases,text:c.text}));
 handEdit('characters','',content);
 const product=dag.products[instanceId('characters')];
 product.parts=Object.fromEntries(next.map((c,i)=>[c.id,c.name?fingerprint(content[i]):fingerprint(c.text)]));
}

/** 标题与余味的修改记为读者确认的结语；它是根产物，由 settle 重新记录，依赖它的审片随之重做。 */
function editEnding(dag:DagDocument,story:DagStory,plan:NonNullable<RevisionChanges['plan']>){
 const shown=projectDocument(dag,story.doc.plan??null).plan;
 if(!shown||(plan.title.trim()===shown.title.trim()&&plan.reflection.trim()===shown.reflection.trim()))return;
 dag.ending={...(dag.ending??{title:shown.title,candidates:[]}),confirmed:{title:plan.title,ending:plan.reflection}};
}

function resetHandEdit(dag:DagDocument,node:string,key=''){
 const id=instanceId(node,key);
 if(!dag.products[id]?.handEdited&&!(node==='ending'&&dag.ending?.confirmed))
  throw new ReaderError(400,'仅可清空已经手改的文字。');
 delete dag.products[id];
 dag.resetText=[...new Set([...(dag.resetText??[]),id])];
}

/** 把读者改动写入 dag：改过的叙事分镜、画面描述与梗概按当前输入记录为手改。 */
function applyEdits(story:DagStory,changes:RevisionChanges,childId:string):DagDocument{
 const dag=structuredClone(story.dag);
 const handEdit=(node:string,key:string,content:unknown)=>{
  const inst=evaluate(stateOf({...story,dag})).instance(node,key);
  if(!inst.hard)throw new ReaderError(409,'这篇故事的上游内容尚未完成，暂不能修改此处。');
  const id=instanceId(node,key);
  dag.products[id]={hash:fingerprint(content),inputs:inst.hard,handEdited:true};
  if(dag.resetText?.includes(id)){
   dag.resetText=dag.resetText.filter(target=>target!==id);
   if(!dag.resetText.length)delete dag.resetText;
  }
 };
 // 删除画幅：按原幅号移除，其产物一并删除；其余画幅保留身份。
 if(changes.removedFrames){
  const survivors=survivingRevisionFrames(dag.order.length,changes.removedFrames);
  if(!changes.plan||!survivors.length||survivors.length!==changes.plan.pages.length||changes.removedFrames.some(p=>p>dag.order.length))throw new ReaderError(400,'删除幅号和修改后的分镜数量必须一致，故事至少保留一幅。');
  const removed=changes.removedFrames.map(p=>dag.order[p-1]);
  dag.order=dag.order.filter(id=>!removed.includes(id));
  for(const id of removed){delete dag.frames[id];for(const node of frameNodes)delete dag.products[instanceId(node,id)];}
 }
 if(changes.mergeTargets){
  const targets=new Set(changes.mergeTargets.map(page=>story.dag.order[page-1]));
  if(!changes.removedFrames||targets.size!==changes.mergeTargets.length||[...targets].some(id=>!dag.order.includes(id)))
   throw new ReaderError(400,'请检查合并保留位置和删除幅号。');
  dag.order=dag.order.map((id,index)=>{
   if(!targets.has(id))return id;
   const page=changes.plan!.pages[index];
   if(!page.caption||!page.prompt)throw new ReaderError(400,'请填写合并后的旁白和画面描述。');
   const {image,drawn,drawnNames}=dag.frames[id],key=`f-${fingerprint([childId,'merge',id]).slice(0,16)}`;
   for(const node of frameNodes)if(node!=='frameImage'||!image)delete dag.products[instanceId(node,id)];
   if(image)dag.frames[id]={scene:'',visual:'',image};else delete dag.frames[id];
   dag.frames[key]={scene:'',visual:'',drawn,drawnNames};
   return key;
  });
 }
 if(changes.plan){
  if(changes.plan.pages.length!==dag.order.length)throw new ReaderError(400,'减幅时请提供原稿中删除的幅号。');
  changes.plan.pages.forEach((page,i)=>{
   const id=dag.order[i],frame=dag.frames[id];
   if(page.caption.trim()!==frame.scene.trim()){
    frame.scene=page.caption;
    if(page.caption)handEdit('scene',id,page.caption);else resetHandEdit(dag,'scene',id);
   }
   if(page.prompt.trim()!==frame.visual.trim()){
    frame.visual=page.prompt;
    if(page.prompt){
     addDrawnFrom(frame,page.prompt,dag.characters);
     handEdit('visual',id,{prompt:page.prompt,drawn:frame.drawnNames??frame.drawn});
    }else resetHandEdit(dag,'visual',id);
   }
  });
  if(changes.plan.characters)editCharacters(dag,changes.plan.characters,handEdit);
  else{resetHandEdit(dag,'characters');dag.characters=[];}
  if(changes.plan.reflection)editEnding(dag,story,changes.plan);
  else{
   resetHandEdit(dag,'ending');
   const title=dag.ending?.confirmed?.title;
   if(title)dag.ending={title,candidates:[],confirmed:{title}};else delete dag.ending;
  }
 }
 if(changes.storySummary!==undefined&&changes.storySummary!==dag.brief){
  if(changes.storySummary){dag.brief=changes.storySummary;handEdit('brief','',changes.storySummary);}
  else{resetHandEdit(dag,'brief');delete dag.brief;}
 }
 return dag;
}

/** 用正式修订调用处理一条仍有效的审核意见，只返回编辑器草稿。 */
export async function prepareReviewSuggestion(repo:ReaderRepository,row:SessionRow,request:ReviewSuggestionRequest){
 const {doc,token}=await revisionBasis(repo,row);
 if(token!==request.token||!doc.plan||!doc.dag)
  throw new ReaderError(409,'分镜已更新，请重新载入后再应用建议。');
 const selection=selectionSchema.parse(JSON.parse(row.selection));
 const parent:DagStory={id:row.id,doc,selection,dag:doc.dag,confirmed:true,faults:[]};
 const issue=reviewAttention(parent).issues.find(item=>!item.requiresReplan&&
  item.page===request.issue.page&&item.problem===request.issue.problem&&item.instruction===request.issue.instruction);
 if(!issue)throw new ReaderError(409,'这条审核意见已更新，请返回制作流程查看。');
 const draft=request.draft;
 if(draft&&(draft.removedFrames||draft.mergeTargets||draft.plan&&JSON.stringify(draft.plan)!==JSON.stringify(doc.plan)))
  checkedRevision({selection,plan:doc.plan,images:doc.images},draft);
 const dag=draft?.plan?applyEdits(parent,draft,row.id):doc.dag;
 const frame=issue.page===0?'':doc.dag.order[issue.page-1];
 const page=frame?dag.order.indexOf(frame)+1:0;
 if(issue.page>0&&!page)throw new ReaderError(400,'这幅已从草稿移除，无法应用原幅的建议。');
 const story={...parent,dag};
 const field:ReviewSuggestionDraft['field']=page===0?'reflection':reviewRepairField(issue);
 const node=field==='reflection'?'ending':field==='prompt'?'visual':'scene';
 const call=field==='reflection'?'endingRepair':field==='prompt'?'visualRepair':'sceneRepair';
 const instance=evaluate(stateOf(story)).instance(node,frame);
 if(!instance.hard)throw new ReaderError(400,'请先补全本幅编辑所需的文字，再应用建议。');
 const item:Work={call,instances:[instance],issues:[{...issue,page}]};
 return {story,item,field};
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
 * 新版引用原目录中的图片文件。原图已丢失或无法辨认时，
 * 丢失的成图标为不可读，新版继续后按缺幅补绘。横图丢失视为未请求。
 */
async function retainImages(media:MediaStore,parentId:string,dag:DagDocument,aliasImage:(index:number,key:string,type:keyof typeof imageTypes)=>string):Promise<number[]>{
 const lost:number[]=[];
 const positions=new Map(dag.order.map((id,index)=>[id,index]));
 const reads=new Map<string,{type:keyof typeof imageTypes;readable?:boolean}|null>();
 // 结构修订之后仍可按输入采用退役画幅的旧图，保存新版时也为这些图绑定别名。
 for(const [id,frame] of Object.entries(dag.frames)){
  if(!frame.image)continue;
  const index=positions.get(id),key=referenceImageKey(parentId,frame.image);
  const product=instanceId('frameImage',id),record=dag.products[product],supplied=dag.cover?.frame===id;
  const verify=index===undefined||supplied||record?.readable===false;
  let image=key?reads.get(key):null;
  if(key&&(image===undefined||image&&verify&&image.readable===undefined)){
   try{
    const asset=await media.get(key);
    const bytes=asset?new Uint8Array(await asset.arrayBuffer()):null,type=bytes&&mediaType(bytes);
    image=type?{type,readable:verify?await readableImage(bytes!):undefined}:null;
    reads.set(key,image);
   }catch{
    const name=index===undefined?'可复用的原图':`第 ${index+1} 幅原图`;
    throw new ReaderError(503,`${name}暂时无法读取，未创建新版，请稍后重试。`);
   }
  }
  if(!image||image.readable===false){
   delete frame.image;
   if(index!==undefined&&(record||supplied))lost.push(index);
   if(record)dag.products[product]={...record,readable:false};
   continue;
  }
  frame.image=aliasImage(index??0,key!,image.type);
  if(record?.readable===false)dag.products[product]={...record,readable:true};
 }
 return lost.sort((a,b)=>a-b);
}

/** 仅换图：选中画幅删除旧图与产物，重绘说明作为该幅绘图输入；其余内容与结论不变。 */
function applyRedraw(dag:DagDocument,changes:RevisionChanges){
 for(const page of changes.redrawPages??[]){
  const id=dag.order[page-1];if(!id)throw new ReaderError(400,'重绘页码必须属于已保存的完整分镜。');
  const frame=dag.frames[id],note=changes.redrawNotes?.[String(page)];
  if(note)frame.redrawNote=note;else delete frame.redrawNote;
  frame.redrawRequested=true;
  delete frame.image;delete dag.products[instanceId('frameImage',id)];
 }
}

/**
 * 修订的唯一计算（保存与预估共用）：合入设置与文字修改（含审核意见），收集将被移除的手改，
 * 新修订重新开始自动修订额度。计算不写入、不读媒体；保存另复制图片与首幅原图，再确定可复用产物。
 */
function deriveRevision(db:ReadStatements,doc:Document,row:SessionRow,changes:RevisionChanges,childId:string,strict:boolean){
 // 原文出处与改编说明是来源信息，不随分镜编辑改变（v0.14.0 同样拒绝）。
 if(changes.plan&&doc.plan&&(['sourceReference','adaptationNote'] as const).some(key=>changes.plan![key]!==doc.plan![key]))throw new ReaderError(400,'本次仅修改分镜、人物与余味，原文出处和改编说明保持不变。');
 const selection=nextSelection(selectionSchema.parse(JSON.parse(row.selection)),changes);
 const reviewNotes=(changes.reviewNotes!==undefined?changes.reviewNotes:doc.reviewNotes)?.trim()||undefined;
 const parent=({id:row.id,doc,selection:selectionSchema.parse(JSON.parse(row.selection)),dag:doc.dag!,confirmed:true,faults:[]});
 // 文字修改按上一版的输入记录为手改，再合入设置修改，由引擎判断哪些产物失效。
 const edited=applyEdits(parent,changes,childId);
 const before=rootProducts(parent.selection,parent.dag);
 const after=rootProducts(selection,edited);
 const replan=before['productionReq:'].hash!==after['productionReq:'].hash||before['settings:'].hash!==after['settings:'].hash;
 let retired=replan?[...parent.dag.order]:parent.dag.order.filter(id=>!edited.order.includes(id));
 if(changes.structureEdits){
  if(changes.plan||changes.removedFrames||changes.length!==undefined||changes.productionPrompt!==undefined||changes.narrativeDetail!==undefined)
   throw new ReaderError(400,'请先单独保存结构修改。');
  const structure=structureEditPlan(edited,changes.structureEdits);
  if(!structure||structure.entries.length<readerMinFrames||structure.entries.length>readerMaxFrames)
   throw new ReaderError(400,'请提交互不重叠的有效画幅范围，并保留允许的画幅数量。');
  retired=structure.retired;
  let created=0;
  applyStructureEdits(parent,edited,changes.structureEdits,()=>`f-${fingerprint([childId,'structure',created++]).slice(0,16)}`,true);
 }
 const lostHandEdits=structuralLoss(parent.dag,retired);
 if(strict&&lostHandEdits.length&&!changes.confirmHandEditLoss)
  throw new ReaderError(409,`本次保存会移除第 ${lostHandEdits.map(edit=>edit.page).join('、')} 幅的手改，请查看保存预览并确认放弃。`);
 const restyle=!sameArtDirection(parent.selection,selection);
 if(edited.cover&&restyle){
  const first=edited.cover.frame;
  delete edited.cover;
  if(edited.frames[first])delete edited.frames[first].image;
  delete edited.products[instanceId('frameImage',first)];
 }
 applyRedraw(edited,changes);
 const child:DagStory={...parent,id:childId,selection,doc:{...doc,reviewNotes},dag:edited};
 const roots=(story:DagStory)=>rootProducts(story.selection,story.dag,{notes:story.doc.reviewNotes});
 const changed=!!changes.redrawPages||fingerprint(edited)!==fingerprint(parent.dag)||fingerprint(roots(child))!==fingerprint(roots(parent));
 if(changed)child.dag={...edited,repairs:undefined,issues:[]};
 return {parent,child,selection,reviewNotes,changed,lostHandEdits};
}

export type RevisionPreview={changed:boolean;total:number;redraw:number;reused:number;
 /** 需要重做的文字工作，按调用名计数（批量调用按产出的实例数）。 */
 textWork:Record<string,number>;
 /** 保存后是否有需要重做的工作，即是否进入「已保存，等待继续」。 */
 continues:boolean;
 /** 原稿中因本次结构修改将被移除的手改。 */
 lostHandEdits:LostHandEdit[];
 /** 失去画幅身份时会丢弃重绘说明的原幅号。 */
 droppedRedrawNotePages:number[];
 /** 需要重绘的新幅号及其中确认丢图的幅号。 */
 redrawPages:number[];lostImagePages:number[]};

/**
 * 保存前的预估：与保存使用同一套引擎推导（手改损失、设置合入、失效范围），只计算不写入。
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
 const {parent,child,changed,lostHandEdits}=repo.db.readTransaction?.(derive)??transact(repo.db,derive);
 if(!changed)return {changed:false,total:child.dag.order.length,redraw:0,reused:doc.images.filter(Boolean).length,textWork:{},continues:false,lostHandEdits:[],droppedRedrawNotePages:[],redrawPages:[],lostImagePages:[]};
 child.dag=settle(child);
 const {evaluation:ev,work:items}=deriveProduction(child),order=child.dag.order;
 const redrawPages=order.flatMap((id,index)=>ev.instance('frameImage',id).status==='valid'?[]:[index+1]);
 const redraw=redrawPages.length;
 const textWork:Record<string,number>={};
 for(const item of items)if(item.call!=='draw')textWork[item.call]=(textWork[item.call]??0)+item.instances.length;
 const lostImagePages=redrawPages.filter(page=>parent.dag.products[instanceId('frameImage',order[page-1])]?.readable===false);
 const keepsOutline=ev.instance('outline').status==='valid',remaining=new Set(order);
 const droppedRedrawNotePages=parent.dag.order.flatMap((key,index)=>
  parent.dag.frames[key]?.redrawNote&&(!keepsOutline||!remaining.has(key))?[index+1]:[]);
 return {changed,total:order.length,redraw,reused:order.length-redraw,textWork,continues:items.length>0||redraw>0,lostHandEdits,droppedRedrawNotePages,redrawPages,lostImagePages};
}

export async function forkDagRevision(repo:ReaderRepository,media:MediaStore,ownerId:string,row:SessionRow,requestId:string,token:string,changes:RevisionChanges,paused:boolean,requestHash:string,cover?:Uint8Array,startRedraw=false):Promise<SessionRow>{
 if(!Object.keys(changes).length)throw new ReaderError(400,'没有需要保存的修改。');
 const {doc,rootId,epoch,token:current}=await revisionBasis(repo,row);
 const progress=dagProgress(doc,selectionSchema.parse(JSON.parse(row.selection)));
 const completedParent=progress?.complete===true;
 const redrawPages=changes.redrawPages??[];
 const redrawAll=redrawPages.length>1&&redrawPages.length===doc.dag?.order.length&&redrawPages.includes(1);
 if(startRedraw&&(paused||redrawPages.length!==1&&!redrawAll))throw new ReaderError(400,'请确认立即重绘一幅画，或从首幅开始重绘整篇。');
 const state={version:'current' as const,control:row.generation_control??'active',continuation:!!doc.dag?.continuation,stopping:false};
 const authorization=authorizeProductionCommand('save-revision',{...state,targetCurrent:current===token,targetReady:!!doc.dag});
 if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
 if(changes.reviewNotes!==undefined){
  const edit=authorizeProductionCommand('edit-review-notes',{...state,targetCurrent:current===token,targetReady:!!doc.plan});
  if(!edit.allowed)throw new ReaderError(edit.status,edit.message);
 }
 if(changes.redrawPages){
  const redraw=authorizeProductionCommand('redraw',{...state,targetReady:true,targetCurrent:completedParent&&
   Object.keys(changes).every(key=>['redrawPages','redrawNotes'].includes(key))});
  if(!redraw.allowed)throw new ReaderError(redraw.status,redraw.message);
 }
 if(changes.redrawNotes&&Object.keys(changes.redrawNotes).some(page=>!changes.redrawPages?.includes(Number(page))))throw new ReaderError(400,'重绘说明只能用于本次选中的画幅。');
 // 已完稿的首幅可以用原图替换，也可以在换画风时指定新首幅。
 const coverType=cover&&mediaType(cover);
 if(cover){
  const dimensions=imageDimensions(cover);
  const reviewPassed=progress?.review.reviewStatus==='passed';
  const styleOnly=Object.keys(changes).length===1&&!!changes.artStyle;
  const replaceFirst=redrawPages.includes(1)&&(redrawPages.length===1||redrawAll)&&!changes.redrawNotes;
  const accepted=authorizeProductionCommand('cover',{...state,targetCurrent:true,
   targetReady:(styleOnly||replaceFirst)&&completedParent&&reviewPassed});
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
   const latest=db.get<SessionRow>(`SELECT p.* FROM story_rows p WHERE p.id=? AND p.user_id=? AND ${currentFamilyVersion('p')}`,row.id,ownerId);
   if(!latest)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
   const currentDoc=decodeDocument(latest);
   const currentEpoch=db.get<{epoch:number}>(familyEpoch,ownerId,rootId,rootId)!.epoch;
   if(currentDoc.dag?.repreparing||revisionToken(latest,currentDoc,currentEpoch)!==token||deriveRevision(db,currentDoc,latest,changes,requestId,true).changed)
    throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
   const now=Date.now();
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at) VALUES(?,?,?,'revision-noop',?,'{}',?,?,?)",requestId,ownerId,row.id,requestHash,row.id,now,now);
  });
  return repo.get(row.id,ownerId);
 }
 const requestedFrames=new Set(redrawPages.map(page=>child.dag.order[page-1]));
 // 并发重放同一编号时，每次保存仅清理自己写入的图片。
 const attempt=randomUUID(),staged:string[]=[];
 const aliases:{alias:string;target:string}[]=[];
 const saveImage:SaveImage=async(index,bytes,type)=>{
  const asset=readerImageAsset(requestId,index,imageTypes[type],createHash('sha256').update(attempt).update(bytes).digest('hex'));
  staged.push(asset.key);
  await media.put(asset.key,bytes,{contentType:type});
  return asset.url;
 };
 try{
  if(cover)delete child.dag.frames[child.dag.order[0]].image;
  const lost=await retainImages(media,row.id,child.dag,(index,target,type)=>{
   const asset=readerImageAsset(requestId,index,imageTypes[type],fingerprint(['family-image',target]));
   aliases.push({alias:asset.key,target});
   return asset.url;
  });
  if(cover&&coverType){
   // 首幅原图字节不变地保存到新版，立即作为首幅显示；其成图产物在画面描述转换完成、输入就绪后由 settle() 记录。
   const first=child.dag.order[0],image=await saveImage(0,cover,coverType);
   child.dag=structuredClone(child.dag);
   child.dag.cover={frame:first};
   child.dag.frames[first].image=image;
   delete child.dag.frames[first].redrawRequested;
   delete child.dag.products[instanceId('frameImage',first)];
  }
  child.dag=settle(child);
  const items=work(child),pending=items.length>0;
  if(startRedraw){
   const redraw=authorizeProductionCommand('redraw',{...state,targetCurrent:true,targetReady:lost.length===0&&(items.length>0||!!cover)&&
    items.every(item=>item.call==='draw'&&item.instances.every(instance=>requestedFrames.has(instance.key)))});
   if(!redraw.allowed)throw new ReaderError(redraw.status,redraw.message);
  }
  const waiting=pending&&!startRedraw;
  const dag:DagDocument={...child.dag,...(waiting?{continuation:{revision:epoch+1,reason:'revision-saved' as const}}:{})};
  if(!waiting)delete dag.continuation;
  const {plan,images}=projectDocument(dag,doc.plan);
  const portrait=portraitDocument(doc);
  const document:Document={...portrait,dag,plan,images,reviewNotes,usage:portrait.usage.map(item=>({...item,originId:item.originId||row.id})),
   revision:{parentId:row.id,rootId,number:epoch+1,baseToken:token,requestHash,...(cover||redrawAll||!sameArtDirection(parent.selection,selection)||usesStoryImageReference(doc.revision,parent.selection.artStyle)?{storyImageReference:true}:{}),base:{selection:parent.selection,readyFrames:doc.images.flatMap((image,index)=>image?[index]:[])}}};
  if(changes.productionPrompt!==undefined||changes.acceptancePrompt!==undefined){
   document.setupRequirements={edited:editRequirements(parent.selection,doc.setupRequirements,selection)};
  }
  delete document.archivedReviewHistory;delete document.reselection;
  const now=new Date().toISOString(),completed=!pending&&completedParent;
  // 旧版故障留在原版本。新版继续后按当前稿件的缺幅及失效产物接续。
  // 普通修订在同一事务设置等待并保留读者控制；已确认的立即重绘在同一事务启用绘图。
  const transaction=repo.db.transaction;
  if(!transaction)throw Error('TRANSACTION_UNAVAILABLE');
  transaction.call(repo.db,db=>{
   if(db.get('SELECT request_id FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,requestId))
    throw new ReaderError(409,'这个操作编号已用于其他内容。');
   const latest=db.get<SessionRow>('SELECT * FROM story_rows WHERE id=? AND user_id=?',row.id,ownerId);
   const current=latest&&portraitDocument(decodeDocument(latest));
   const comparable=(value:Document)=>{
    const {publication:_,...content}=value;void _;
    const {styles:_styles,productSignature:_signature,...draft}=content.dag!;void _styles;void _signature;
    return productionStorageHash({...content,dag:draft});
   };
   if(!current?.dag||comparable(current)!==comparable(portrait))throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
   if(current.dag.styles)dag.styles={...current.dag.styles,...dag.styles};
   const inserted=writeStoryProducts(db,requestId,ownerId,document,stored=>{
    const result=db.run(`INSERT INTO stories(id,user_id,selection,document,generation_control,production_complete,page,saved,last_read_at,created_at,updated_at)
   SELECT ?,?,json_patch(?,CASE WHEN json_type(p.selection,'$.displayTitle')='text' THEN json_object('displayTitle',json_extract(p.selection,'$.displayTitle')) ELSE '{}' END),json_patch(?,json_object('publication',json_extract(p.document,'$.publication'))),CASE WHEN ? THEN 'active' WHEN ? THEN 'paused' ELSE p.generation_control END,?,MIN(p.page,?),p.saved,p.last_read_at,?,? FROM stories p
   WHERE p.id=? AND p.user_id=? AND json_remove(p.selection,'$.displayTitle')=json_remove(?,'$.displayTitle') AND ${currentFamilyVersion('p')} AND (${familyEpoch.replace(' AS epoch','')})=?
   ON CONFLICT(id) DO NOTHING`,requestId,ownerId,JSON.stringify(selection),stored,startRedraw?1:0,paused?1:0,Number(completed),Math.max(0,dag.order.length-1),now,now,row.id,ownerId,row.selection,ownerId,rootId,rootId,epoch);
    if(result.changes)for(const alias of aliases)recordFamilyImage(db,{...alias,sessionId:requestId,sourceId:row.id,ownerId,rootId});
    return result.changes;
   });
   if(!inserted)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
  });
 }catch(error){
  await Promise.all(staged.map(key=>media.remove(key)));
  throw error;
 }
 return repo.get(requestId,ownerId);
}
