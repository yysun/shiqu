// 制作 DAG 故事的修订保存：新版复制上一版的 dag 与图片，读者改动按手改记录，失效范围由引擎按输入推导。
// 有需要重做的工作时新版进入「已保存，等待继续」（dag.continuation），只有「继续制作」清除；没有时保持原制作状态。
// 本阶段只支持不改变幅数的文字与设置修改；删除、插入、重排与换图在后续阶段接入，提交时明确拒绝。
import {createHash} from 'node:crypto';
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
import {revisionBasis,familyEpoch,currentFamilyVersion} from './reader-revisions.ts';

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const unsupported:(keyof RevisionChanges)[]=['removedFrames','redrawPages','redrawNotes','length'];

/** 读者的设置修改合入选择；幅数策略改变须重新编排，本阶段不支持。 */
function nextSelection(selection:Selection,changes:RevisionChanges):Selection{
 return selectionSchema.parse({...selection,
  ...(changes.artStyle?{artStyle:changes.artStyle}:{}),
  ...(changes.artStylePrompt!==undefined?{artStylePrompt:changes.artStylePrompt}:{}),
  ...(changes.productionPrompt!==undefined?{productionPrompt:changes.productionPrompt}:{}),
  ...(changes.acceptancePrompt!==undefined?{acceptancePrompt:changes.acceptancePrompt}:{}),
  ...(changes.narrativeDetail?{narrativeDetail:changes.narrativeDetail}:{}),
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
 if(changes.plan){
  if(changes.plan.pages.length!==dag.order.length)throw new ReaderError(409,'增删画幅将在后续版本支持，请只修改各幅文字。');
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

/** 新版的图片复制到新版目录；产物记录不变（同一份图片内容）。 */
async function copyImages(media:MediaStore,parentId:string,childId:string,dag:DagDocument){
 for(const [index,id] of dag.order.entries()){
  for(const field of ['image','landscape'] as const){
   const url=dag.frames[id][field];if(!url)continue;
   const key=referenceImageKey(parentId,url),asset=key?await media.get(key).catch(()=>{throw new ReaderError(503,`第 ${index+1} 幅原图暂时无法读取，未创建新版，请稍后重试。`);}):null;
   if(!asset){delete dag.frames[id][field];continue;}
   const bytes=new Uint8Array(await asset.arrayBuffer()),type=mediaType(bytes);
   if(!type){delete dag.frames[id][field];continue;}
   const target=readerImageAsset(childId,index,imageTypes[type],hash(bytes));
   await media.put(target.key,bytes,{contentType:type});
   dag.frames[id][field]=target.url;
  }
 }
}

export async function forkDagRevision(repo:ReaderRepository,media:MediaStore,ownerId:string,row:SessionRow,requestId:string,token:string,changes:RevisionChanges,paused:boolean,requestHash:string):Promise<SessionRow>{
 if(unsupported.some(key=>changes[key]!==undefined))throw new ReaderError(409,'这项修改将在后续版本支持。');
 const {doc,rootId,epoch,token:current}=await revisionBasis(repo,row);
 if(current!==token)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
 const selection=nextSelection(selectionSchema.parse(JSON.parse(row.selection)),changes);
 const reviewNotes=(changes.reviewNotes!==undefined?changes.reviewNotes:doc.reviewNotes)?.trim()||undefined;
 const parent:DagStory={id:row.id,doc,selection:selectionSchema.parse(JSON.parse(row.selection)),dag:doc.dag!,confirmed:true,faults:[]};
 const child:DagStory={...parent,id:requestId,selection,doc:{...doc,reviewNotes}};
 child.dag=applyEdits(child,changes);
 await copyImages(media,row.id,requestId,child.dag);
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
 const inserted=await repo.db.prepare(`INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,error,step_attempts,lock_until,page,saved,last_read_at,created_at,updated_at)
  SELECT ?,?,json_patch(?,CASE WHEN json_type(p.selection,'$.displayTitle')='text' THEN json_object('displayTitle',json_extract(p.selection,'$.displayTitle')) ELSE '{}' END),json_patch(?,json_object('publication',json_extract(p.document,'$.publication'))),'background',?,?,NULL,0,0,p.page,p.saved,p.last_read_at,?,? FROM stories p
  WHERE p.id=? AND p.user_id=? AND p.document=? AND p.selection=? AND ${currentFamilyVersion('p')} AND (${familyEpoch.replace(' AS epoch','')})=?
  ON CONFLICT(id) DO NOTHING`)
  .bind(requestId,ownerId,JSON.stringify(selection),JSON.stringify(document),paused?'paused':'active',completed?'completed':'idle',now,now,row.id,ownerId,row.document,row.selection,ownerId,rootId,rootId,epoch).run();
 if(!inserted.meta.changes)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
 return repo.get(requestId,ownerId);
}
