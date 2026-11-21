// Fork edits into new sessions. Copy immutable media before one CAS publishes the child;
// family epochs serialize competing drafts without altering originals. Only content a draft was
// written against can conflict with it: saved images and progress never do. A file that is gone
// cannot be reused and is redrawn; one that cannot be read right now stops the submission.
// Image-only redraws require a completed story and preserve review and all unselected artwork.
// Style-only revisions inherit review checkpoints, including unresolved or overridden reviews.
import {createHash} from 'node:crypto';
import {ReaderError,selectionSchema,reviewPassed,reviewPhase} from '../lib/reader-model.ts';
import type {Document,SessionRow} from '../lib/reader-model.ts';
import type {ReaderRepository} from '../lib/reader-repository.ts';
import {familyRoot,familyNumber,supersededSql} from '../lib/reader-repository.ts';
import type {MediaStore} from '../lib/services.ts';
import {checkedRevision,revisionReviewNotesChanged,syncRevisionImages,usesStoryImageReference} from '../lib/reader-revision.ts';
import type {RevisionChanges,RevisionSnapshot} from '../lib/reader-revision.ts';
import {readableImage,readableLandscapeImage} from './reader-image-health.ts';
import {commandReceipt} from './reader-commands.ts';
import {newReview} from '../lib/reader-review.ts';
import type {ReviewCheckpoint,ReviewRecordMeta} from '../lib/reader-review.ts';
import {invalidateStoryBrief,staleRevisionStoryBrief} from '../lib/reader-story-brief.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType,imageTypes} from '../lib/reader-generation-contract.ts';
import {sameArtDirection} from '../lib/reader-styles.ts';
import {imageDimensions} from '../lib/reader-image-dimensions.ts';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const revisionCoverMaxBytes=12*1024*1024;
export const familyEpoch=`SELECT COALESCE(MAX(${familyNumber('stories')}),1) AS epoch FROM stories WHERE user_id=? AND (id=? OR ${familyRoot('stories')}=?)`;
export const currentFamilyVersion=(alias='p')=>`NOT ${supersededSql(alias)} AND NOT EXISTS(SELECT 1 FROM library_deletions WHERE story_id=${alias}.id AND user_id=${alias}.user_id)`;
export function editableSelection(selection:string){const {displayTitle:_,...value}=JSON.parse(selection);void _;return value;}
export const replacementToken=(selection:string,epoch:number)=>hash(JSON.stringify([editableSelection(selection),epoch]));
const savedFrameCount=(doc:Document)=>doc.draft?.pages.length??doc.storyboard?.outline.beats.length;
const canEditReviewNotes=(row:SessionRow,doc:Document)=>!!doc.plan&&!!doc.visualReview&&row.state!=='completed'&&(row.generation_control==='paused'||row.generation_control==='stopped');
function reviewWithOrigin(review:ReviewCheckpoint,parentId:string,doc:Document):ReviewCheckpoint{
 const copiedFrom=doc.copiedFrom?.storyId;
 const origin=<T extends ReviewRecordMeta>(entry:T)=>{
  if(entry.originId)return entry;
  if(!copiedFrom)return {...entry,originId:parentId};
  const calls=(doc.usage||[]).filter(call=>call.step===entry.step&&(!call.originId||call.originId===parentId||call.originId===copiedFrom));
  return calls.length===1?{...entry,originId:calls[0].originId??parentId}:entry;
 };
 return {...review,reports:review.reports.map(origin),frameCountReports:review.frameCountReports?.map(origin),history:review.history?.map(origin)};
}
export async function revisionBasis(repo:ReaderRepository,row:SessionRow,allowInFlight=false){
 const doc=JSON.parse(row.document) as Document;
 if(doc.reselection||await repo.superseded(row.id,row.user_id))throw new ReaderError(409,'这是草稿或旧版本，请打开书架当前版本。');
 if(doc.intake&&doc.intake.phase!=='confirmed')throw new ReaderError(409,'请在制作确认前保存设置草稿。');
 if(!allowInFlight&&!doc.plan&&row.generation_control!=='paused'&&row.generation_control!=='stopped')throw new ReaderError(409,'请先暂停生成，再修改制作内容。');
 const rootId=doc.revision?.rootId||row.id;
 const epoch=(await repo.db.prepare(familyEpoch).bind(row.user_id,rootId,rootId).first<{epoch:number}>())!.epoch;
 const token=hash(JSON.stringify([editableSelection(row.selection),doc.plan,epoch]));
 return {doc,rootId,epoch,token};
}
export async function revisionSnapshot(repo:ReaderRepository,id:string,ownerId:string):Promise<RevisionSnapshot>{
 const row=await repo.get(id,ownerId),{doc,epoch,token}=await revisionBasis(repo,row);
 return {selection:selectionSchema.parse(JSON.parse(row.selection)),plan:doc.plan,images:doc.images,savedFrameCount:savedFrameCount(doc),...(doc.frameRecommendation?{frameRecommendation:doc.frameRecommendation}:{}),token,epoch,reviewStatus:doc.visualReview?.status,reviewNotes:doc.reviewNotes,...(canEditReviewNotes(row,doc)?{canEditReviewNotes:true,priorReviewIssues:doc.visualReview!.issues}:{}),...(doc.revision?{revision:{parentId:doc.revision.parentId,rootId:doc.revision.rootId,number:doc.revision.number}}:{})};
}
async function copyLandscape(media:MediaStore,parentId:string,childId:string,pages:number[],source:readonly string[]){
 const images:(string|null)[]=[];
 for(const [page,url] of source.entries()){
  const key=url&&referenceImageKey(parentId,url),asset=key?await media.get(key):null;
  const type=asset&&mediaType(asset.body);
  if(!asset||!type||type!==asset.contentType||!await readableLandscapeImage(asset.body)){images.push('');continue;}
  if(pages.includes(page+1)){images.push(null);continue;}
  const target=readerImageAsset(childId,page,imageTypes[type],hash(asset.body));
  await media.put(target.key,asset.body,{contentType:type});images.push(target.url);
 }
 return images;
}
export async function forkRevision(repo:ReaderRepository,media:MediaStore,ownerId:string,parentId:string,requestId:string,token:string,changes:RevisionChanges,paused=false,cover?:Uint8Array,landscapeImages?:()=>Promise<readonly string[]>){
 // Preserve fingerprints of requests saved before explicit paused submissions were added.
 const coverHash=cover?hash(cover):undefined;
 const requestHash=hash(JSON.stringify([parentId,token,changes,...(paused?[true]:[]),...(coverHash?[{cover:coverHash}]:[])]));
 const replay=async()=>{
  const existing=await repo.db.prepare('SELECT * FROM stories WHERE id=?').bind(requestId).first<SessionRow>();
  if(!existing)return null;
  const revision=(JSON.parse(existing.document) as Document).revision;
  if(existing.user_id!==ownerId||revision?.parentId!==parentId||revision.requestHash!==requestHash)throw new ReaderError(409,'这个提交编号已用于其他修改，请重新打开编辑。');
  return repo.get(requestId,ownerId);
 };
 const existing=await replay();if(existing)return existing;
 if(await commandReceipt(repo.db,ownerId,requestId))throw new ReaderError(409,'这个操作编号已用于其他内容。');
 const row=await repo.get(parentId,ownerId),{doc,rootId,epoch,token:current}=await revisionBasis(repo,row);
 if(current!==token)throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');
 const original={selection:selectionSchema.parse(JSON.parse(row.selection)),plan:doc.plan,images:doc.images,savedFrameCount:savedFrameCount(doc),...(doc.frameRecommendation?{frameRecommendation:doc.frameRecommendation}:{})};
 const notesChanged=revisionReviewNotesChanged({reviewNotes:doc.reviewNotes},changes);
 if(notesChanged&&!canEditReviewNotes(row,doc))throw new ReaderError(409,'请先暂停审核，再修改审核意见。');
 const {selection,plan,impact}=checkedRevision({...original,reviewNotes:doc.reviewNotes},changes);
 if(changes.redrawPages&&(row.state!=='completed'||!reviewPassed(doc)))throw new ReaderError(409,'仅换图需要已完成且已有有效审核记录的故事。');
 if(cover&&(Object.keys(changes).length!==1||!changes.artStyle||row.state!=='completed'||!reviewPassed(doc)||!plan))throw new ReaderError(409,'指定首幅原图仅适用于已完成且审核通过的故事换画风。');
 const coverType=cover&&mediaType(cover);
 if(cover){
  const dimensions=imageDimensions(cover);
  if(cover.length>revisionCoverMaxBytes||!coverType||!dimensions||dimensions.width>4096||dimensions.height>4096||!await readableImage(cover))throw new ReaderError(400,'请选择可读取的 PNG、JPEG 或 WebP，文件不超过 12 MiB，宽高各不超过 4096 像素。');
 }
 const styleChanged=!sameArtDirection(selection,original.selection);
 const images:string[]=original.plan?.pages.map(()=> '')||[],lostPages:number[]=[];
 // Global image preferences cannot reuse old artwork. Other edits may reuse after planning.
 if(!styleChanged&&selection.productionPrompt===original.selection.productionPrompt){
  for(let page=0;page<original.images.length;page++){
   const value=original.images[page]||'';
   if(!value)continue;
   const key=referenceImageKey(parentId,value);if(!key){lostPages.push(page);continue;}
   const asset=await media.get(key).catch(()=>{throw new ReaderError(503,`第 ${page+1} 幅原图暂时无法读取，未创建新版，请稍后重试。`);});if(!asset){lostPages.push(page);continue;}
   const bytes=new Uint8Array(await asset.arrayBuffer()),type=mediaType(bytes);
   if(!type||!await readableImage(bytes).catch(()=>{throw new ReaderError(503,`第 ${page+1} 幅原图暂时无法核对，未创建新版，请稍后重试。`);})){lostPages.push(page);continue;}
   const target=readerImageAsset(requestId,page,imageTypes[type],hash(bytes));
   await media.put(target.key,bytes,{contentType:type});images[page]=target.url;
  }
 }
 const base={...original,images};
 const continuedReview=notesChanged&&plan&&doc.visualReview&&JSON.stringify(plan)===JSON.stringify(doc.plan)&&selection.acceptancePrompt===original.selection.acceptancePrompt;
 const visualReview=continuedReview&&doc.visualReview?{
  ...reviewWithOrigin(doc.visualReview,parentId,doc),phase:reviewPhase(doc.visualReview,selection),status:'pending' as const,repairs:0,issues:[],repaired:[],stopReason:undefined,overridden:undefined,
 }:impact.review?newReview():doc.visualReview;
 // 审核意见可引用旧幅号。重新编排时只带入本次明确修改的意见。
 const reviewNotes=(notesChanged?changes.reviewNotes:impact.replan&&original.plan?undefined:doc.reviewNotes)?.trim()||undefined;
 const document:Document={setupRequirements:doc.setupRequirements,publication:doc.publication,plan,original:doc.original,summaryProductionPrompt:doc.summaryProductionPrompt,frameRecommendation:doc.frameRecommendation,frameCountConfirmed:true,visualReview,reviewNotes,images:[],audio:[],usage:(doc.usage||[]).map(item=>({...item,originId:item.originId||parentId})),revision:{parentId,rootId,number:epoch+1,baseToken:token,requestHash,base,...(impact.replan?{}:{previewedRedraw:impact.redraw}),...(lostPages.length?{lostPages}:{})}};
 if(selection.productionPrompt!==original.selection.productionPrompt||impact.review&&staleRevisionStoryBrief(doc,original.selection))invalidateStoryBrief(document);
 if(styleChanged||usesStoryImageReference(doc.revision,original.selection.artStyle))document.revision!.storyImageReference=true;
 const restyle=styleChanged?{from:original.selection.artStyle,fromPrompt:original.selection.artStylePrompt||undefined}:doc.revision?.restyle;
 if(restyle&&(plan||impact.preserveScript))document.revision!.restyle={...restyle,next:0};
 if(changes.redrawPages){
  if(lostPages.length||original.images.length!==plan!.pages.length||original.images.some(image=>!image))throw new ReaderError(409,'原版图片不完整，未创建仅换图版本；请先恢复缺图。');
  document.revision!.redrawPages=[...changes.redrawPages];
  if(changes.redrawNotes&&Object.keys(changes.redrawNotes).length)document.revision!.redrawNotes=changes.redrawNotes;
  if(landscapeImages){
   const images=await copyLandscape(media,parentId,requestId,changes.redrawPages,await landscapeImages());
   if(images.some(image=>image!==''))document.revision!.landscapeRedraw=images;
  }
 }
 if(plan)syncRevisionImages(document,selection);
 if(cover&&coverType){
  const asset=readerImageAsset(requestId,0,imageTypes[coverType],coverHash);
  await media.put(asset.key,cover,{contentType:coverType});
  document.images[0]=asset.url;
  document.revision!.previewedRedraw=impact.redraw-1;
 }
 if(!impact.review||continuedReview)document.reflectionCandidates=doc.reflectionCandidates;
 if(continuedReview)document.storyboard=doc.storyboard;
 if(impact.preserveScript){document.storyboard=doc.storyboard;document.draft=doc.draft;}
 const blocked=!impact.review&&doc.visualReview?.status==='blocked';
 const now=new Date().toISOString();
 const inserted=await repo.db.prepare(`INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,error,step_attempts,lock_until,page,saved,last_read_at,created_at,updated_at)
  SELECT ?,?,json_patch(?,CASE WHEN json_type(p.selection,'$.displayTitle')='text' THEN json_object('displayTitle',json_extract(p.selection,'$.displayTitle')) ELSE '{}' END),json_patch(?,json_object('publication',json_extract(p.document,'$.publication'))),'background',?,?,?,0,0,MIN(p.page,?),p.saved,p.last_read_at,?,? FROM stories p
  WHERE p.id=? AND p.user_id=? AND json_extract(p.document,'$.plan') IS json_extract(?,'$.plan') AND json_remove(p.selection,'$.displayTitle')=json_remove(?,'$.displayTitle')
  ${notesChanged?"AND p.state!='completed' AND p.generation_control IN ('paused','stopped') AND json_extract(p.document,'$.visualReview') IS json_extract(?,'$.visualReview')":''}
  AND (json_extract(p.document,'$.plan') IS NOT NULL OR p.generation_control IN ('paused','stopped') OR ${supersededSql('p')})
  AND ${currentFamilyVersion('p')}
  AND (${familyEpoch.replace(' AS epoch','')})=?
  ON CONFLICT(id) DO NOTHING`)
  .bind(requestId,ownerId,JSON.stringify(selection),JSON.stringify(document),paused?'paused':'active',blocked?'failed':'idle',blocked?row.error:null,impact.total-1,now,now,parentId,ownerId,row.document,row.selection,...(notesChanged?[row.document]:[]),ownerId,rootId,rootId,epoch).run();
 if(!inserted.meta.changes){const raced=await replay();if(raced)return raced;throw new ReaderError(409,'故事或版本已更新，请重新载入后再修改。');}
 return repo.get(requestId,ownerId);
}
