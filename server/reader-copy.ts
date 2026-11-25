// Copy saved checkpoints without inference; unreviewed drafts require an explicit text-only choice. Both libraries use
// production initialization and exclusive ownership; the new independent story starts paused.
// An optional rendering style changes only new image inputs, retaining the exact saved script/review.
// The Skill controls the text/image checkpoints; this service executes only explicit image choices.
// 提示词记录随副本写入目标库自己的记录表。
import {writeStoryProducts} from './production-products.ts';
import {transact} from './production-records.ts';
import {dagProgress} from '../lib/production-dag/progress.ts';
import {decodeDocument} from '../lib/production-dag/document.ts';
import {createHash} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {createApplication} from './app.ts';
import {ownDesktopData} from './desktop-owner.ts';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {resolvePromptRecords} from '../lib/reader-prompt-store.ts';
import {ReaderError,selectionSchema,planSchema,view} from '../lib/reader-model.ts';
import type {Document} from '../lib/reader-model.ts';
import {readerImageAsset,referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType,imageTypes} from '../lib/reader-generation-contract.ts';
import {artStyleSettings,sameArtDirection} from '../lib/reader-styles.ts';
import {readableImage} from './reader-image-health.ts';
import {textOnlyDag,attachImages,portraitDocument} from '../lib/production-dag/copy.ts';
import {authorizeProductionCommand} from '../lib/production-lifecycle.ts';
import {copyAvailability,currentFamilyVersion} from './reader-revisions.ts';

type StoryCopyOptions={images?:boolean;existing?:boolean;draft?:boolean};

export async function copySavedStory(target:ReturnType<typeof createApplication>,root:string,targetDirectory:string,sourceDirectory:string,sourceId:string,requestId:string,artStyle?:unknown,options:StoryCopyOptions={}){
 if(options.draft&&(options.images||options.existing))throw new ReaderError(400,'草稿仅复制文字，不能复制图片。');
 if(!existsSync(path.join(sourceDirectory,'shiqu.sqlite')))throw new ReaderError(404,'来源书库不存在。');
 if(realpathSync(sourceDirectory)===realpathSync(targetDirectory))throw new ReaderError(400,'请选择另一个来源书库。');
 const release=await ownDesktopData(sourceDirectory);let source:ReturnType<typeof createApplication>|undefined;
 try{
  source=createApplication({root,dataDirectory:sourceDirectory,variables:{SHIQU_AI_PROVIDER:'readonly'},commandOnly:true,production:{autoStart:false}});
  const repo=new ReaderRepository(source.services.database),row=await repo.current(sourceId,source.services.ownerId);
  // 提示词记录只在来源库中：先原位还原为内嵌，目标库写入时再存入自己的记录表。
  const sourceDoc=await resolvePromptRecords(repo.db,decodeDocument(row));
  const saved=portraitDocument(sourceDoc);
  const sourceSelection=selectionSchema.parse(JSON.parse(row.selection));
  const status=await source.services.production?.snapshot(row.user_id,row.id);
  const availability=copyAvailability(saved,sourceSelection,status?.lifecycle?.activity.state==='running');
  const authorization=authorizeProductionCommand(options.draft?'copy-draft':'copy',{
   version:row.id===sourceId?'current':'superseded',control:row.generation_control??'active',continuation:!!saved.dag?.continuation,stopping:false,
   targetCurrent:availability.current,targetReady:options.draft?availability.draft:availability.reviewed,
  });
  if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
  if(options.draft)planSchema.parse(saved.plan);
  const destination=new ReaderRepository(target.services.database),owner=target.services.ownerId;
  const digest=(doc:Document)=>createHash('sha256').update(JSON.stringify([sourceSelection,JSON.stringify(doc)])).digest('hex');
  let contentHash=digest(saved);
  // 旧版副本使用完整文档哈希；保留已接受的创建回执。
  const prior=await destination.db.prepare("SELECT json_extract(document,'$.copiedFrom.contentHash') AS hash FROM stories WHERE id=? AND user_id=?")
   .bind(requestId,owner).first<{hash:string|null}>();
  if(prior?.hash&&prior.hash!==contentHash){
   const beforePrint={...sourceDoc};
   delete beforePrint.landscapePrints;
   if(prior.hash===digest(sourceDoc)||prior.hash===digest(beforePrint))contentHash=prior.hash;
  }
  const selected=selectionSchema.parse({...sourceSelection,...(artStyle===undefined?{}:{artStyle})});
  const selection={...selected,...artStyleSettings(sourceSelection,{artStyle:selected.artStyle})};
  const styleChanged=!sameArtDirection(selection,sourceSelection);
  if(options.images&&styleChanged)throw new ReaderError(400,'更改画风时不能复制旧图片，请选择不复制图片，后续按新画风绘制。');
  // Keep runtime/family state in the source; attach independent media only after the optional step.
  const document:Document={plan:saved.plan,original:saved.original,...(saved.dag?{dag:textOnlyDag(saved.dag)}:{}),archivedReviewHistory:saved.archivedReviewHistory,reviewNotes:saved.reviewNotes,summaryProductionPrompt:saved.summaryProductionPrompt,storySummaryFromStoryboard:saved.storySummaryFromStoryboard,frameRecommendation:saved.frameRecommendation,frameCountConfirmed:options.draft?saved.frameCountConfirmed:true,reflectionCandidates:saved.reflectionCandidates,setupRequirements:saved.setupRequirements,publication:saved.publication,images:[],audio:[],usage:saved.usage.map(call=>({...call,originId:call.originId||sourceId})),copiedFrom:{storyId:saved.copiedFrom?.storyId||sourceId,contentHash,...(options.draft?{draft:true}:{}),...(options.images===undefined?{}:{imageChoice:options.images})}};
  let result=options.existing?await destination.get(requestId,owner):await destination.create(requestId,owner,selection,document),current=decodeDocument(result);
  const snapshot=()=>target.services.production?target.services.production.snapshot(owner,result.id):view(result);
  if(current.copiedFrom?.storyId!==document.copiedFrom!.storyId||current.copiedFrom.contentHash!==contentHash)throw new ReaderError(409,'此创建编号已用于其他内容。');
  if(options.existing&&current.copiedFrom.draft)throw new ReaderError(409,'草稿副本不能补复制图片；请先完成正式审核。');
  const progress=current.copiedFrom.images;
  if(progress==='complete'||progress==='skipped'&&!options.existing)return snapshot();
  const busy=await destination.db.prepare("SELECT 1 FROM production_jobs WHERE session_id=? AND owner_id=? AND kind!='landscape-print' AND state='running' AND lease_until>?")
   .bind(requestId,owner,Date.now()).first();
  if(result.generation_control!=='paused'||busy||current.images.some(Boolean)||await destination.superseded(requestId,owner)){
   if(options.images||progress==='pending')throw new ReaderError(409,'目标故事已开始制作或已有新版，不能继续复制图片。');
   return snapshot();
  }
  const include=progress==='pending'||options.images===true;
  async function checkpoint(images:Document['images'],status:'pending'|'complete'|'skipped'){
   const next={...current,images,...(current.dag&&saved.dag?{dag:attachImages(current.dag,saved.dag,images)}:{}),copiedFrom:{...current.copiedFrom!,images:status}};
   const complete=Number(dagProgress(next,selection)?.complete===true);
   const updated=transact(destination.db,db=>writeStoryProducts(db,requestId,owner,next,stored=>db.run(`UPDATE stories SET document=?,production_complete=?,updated_at=? WHERE id=? AND user_id=? AND document=? AND generation_control='paused' AND NOT EXISTS(SELECT 1 FROM production_jobs j WHERE j.session_id=stories.id AND j.owner_id=stories.user_id AND j.kind!='landscape-print' AND j.state='running' AND j.lease_until>?) AND ${currentFamilyVersion('stories')}`,
    stored,complete,new Date().toISOString(),requestId,owner,result.document,Date.now()).changes));
   if(!updated)throw new ReaderError(409,'目标故事已更新，文本已保留，请重新读取后再操作。');
   result=await destination.get(requestId,owner);current=decodeDocument(result);
  }
  if(!include){await checkpoint(current.images,'skipped');return snapshot();}
  if(styleChanged)throw new ReaderError(400,'更改画风时不能复制旧图片。文本已保留。');
  if(progress!=='pending')await checkpoint(current.images,'pending');
  const images=saved.plan!.pages.map(()=> '');
  for(let page=0;page<images.length;page++){
   if(!saved.images[page])continue;
   try{
    const key=referenceImageKey(sourceId,saved.images[page]),asset=key?await source.services.media.get(key):null;
    if(!asset)throw Error('IMAGE_MISSING');
    const bytes=new Uint8Array(await asset.arrayBuffer()),type=mediaType(bytes);
    if(!type||!await readableImage(bytes))throw Error('IMAGE_UNREADABLE');
    const image=readerImageAsset(requestId,page,imageTypes[type],createHash('sha256').update(bytes).digest('hex'));
    await target.services.media.put(image.key,bytes,{contentType:type});images[page]=image.url;
   }catch{throw new ReaderError(503,`文本及审核记录已保留，图片复制未完成：第 ${page+1} 幅无法读取或保存。请沿用复制编号 ${requestId} 重试。`);}
  }
  await checkpoint(images,'complete');
  return snapshot();
 }finally{try{await source?.close();}finally{await release();}}
}
