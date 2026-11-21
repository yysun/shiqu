// Copy saved checkpoints without inference; unreviewed drafts require an explicit text-only choice. Both libraries use
// production initialization and exclusive ownership; the new independent story starts paused.
// An optional rendering style changes only new image inputs, retaining the exact saved script/review.
// The Skill controls the text/image checkpoints; this service executes only explicit image choices.
// 提示词记录随副本写入目标库自己的记录表。
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

type StoryCopyOptions={images?:boolean;existing?:boolean;draft?:boolean};

export async function copySavedStory(target:ReturnType<typeof createApplication>,root:string,targetDirectory:string,sourceDirectory:string,sourceId:string,requestId:string,artStyle?:unknown,options:StoryCopyOptions={}){
 if(options.draft&&(options.images||options.existing))throw new ReaderError(400,'草稿仅复制文字，不能复制图片。');
 if(!existsSync(path.join(sourceDirectory,'shiqu.sqlite')))throw new ReaderError(404,'来源书库不存在。');
 if(realpathSync(sourceDirectory)===realpathSync(targetDirectory))throw new ReaderError(400,'请选择另一个来源书库。');
 const release=await ownDesktopData(sourceDirectory);let source:ReturnType<typeof createApplication>|undefined;
 try{
  source=createApplication({root,dataDirectory:sourceDirectory,variables:{SHIQU_AI_PROVIDER:'readonly'},commandOnly:true,production:{autoStart:false}});
  const repo=new ReaderRepository(source.services.database),row=await repo.current(sourceId,source.services.ownerId);
  if(row.id!==sourceId)throw new ReaderError(409,'请复制来源故事的当前版本。');
  // 提示词记录只在来源库中：先原位还原为内嵌，目标库写入时再存入自己的记录表。
  const saved=await resolvePromptRecords(repo.db,JSON.parse(row.document) as Document);
  if(row.state==='running'||!saved.plan||!saved.original||saved.intake&&saved.intake.phase!=='confirmed'||saved.reselection)throw new ReaderError(409,'只能复制已停止且已保存完整原文、分镜的故事。');
  if(!options.draft&&(saved.visualReview?.status!=='passed'||saved.visualReview.overridden))throw new ReaderError(409,'只能复制已保存原文、分镜及已通过审核的故事；未通过的文本请显式选择草稿复制。');
  if(options.draft){
   planSchema.parse(saved.plan);
   if(!saved.visualReview||typeof saved.original.text!=='string'||!saved.original.text.trim())throw new ReaderError(409,'草稿须有完整分镜、原文和已保存的审核检查点。');
  }
  const sourceSelection=selectionSchema.parse(JSON.parse(row.selection));
  // 哈希输入形状不变；文档文本取还原后的规范形式，迁移前创建的副本仍能匹配。
  const contentHash=createHash('sha256').update(JSON.stringify([sourceSelection,JSON.stringify(saved)])).digest('hex');
  const selected=selectionSchema.parse({...sourceSelection,...(artStyle===undefined?{}:{artStyle})});
  const selection={...selected,...artStyleSettings(sourceSelection,{artStyle:selected.artStyle})};
  const styleChanged=!sameArtDirection(selection,sourceSelection);
  if(options.images&&styleChanged)throw new ReaderError(400,'更改画风时不能复制旧图片，请选择不复制图片，后续按新画风绘制。');
  // Keep runtime/family state in the source; attach independent media only after the optional step.
  const document:Document={plan:saved.plan,original:saved.original,visualReview:saved.visualReview,reviewNotes:saved.reviewNotes,summaryProductionPrompt:saved.summaryProductionPrompt,frameRecommendation:saved.frameRecommendation,frameCountConfirmed:options.draft?saved.frameCountConfirmed:true,...(options.draft?{storyboard:saved.storyboard}:{}),reflectionCandidates:saved.reflectionCandidates,setupRequirements:saved.setupRequirements,publication:saved.publication,images:[],audio:[],usage:saved.usage.map(call=>({...call,originId:call.originId||sourceId})),copiedFrom:{storyId:saved.copiedFrom?.storyId||sourceId,contentHash,...(options.draft?{draft:true}:{}),...(options.images===undefined?{}:{imageChoice:options.images})}};
  const destination=new ReaderRepository(target.services.database),owner=target.services.ownerId;
  let result=options.existing?await destination.get(requestId,owner):await destination.create(requestId,owner,selection,document),current=JSON.parse(result.document) as Document;
  if(current.copiedFrom?.storyId!==document.copiedFrom!.storyId||current.copiedFrom.contentHash!==contentHash)throw new ReaderError(409,'此创建编号已用于其他内容。');
  if(options.existing&&current.copiedFrom.draft)throw new ReaderError(409,'草稿副本不能补复制图片；请先完成正式审核。');
  const progress=current.copiedFrom.images;
  if(progress==='complete'||progress==='skipped'&&!options.existing)return view(result);
  if(result.generation_control!=='paused'||result.state==='running'||current.images.some(Boolean)||await destination.superseded(requestId,owner)){
   if(options.images||progress==='pending')throw new ReaderError(409,'目标故事已开始制作或已有新版，不能继续复制图片。');
   return view(result);
  }
  const include=progress==='pending'||options.images===true;
  async function checkpoint(images:Document['images'],status:'pending'|'complete'|'skipped'){
   const next={...current,images,copiedFrom:{...current.copiedFrom!,images:status}};
   const updated=await destination.db.prepare("UPDATE stories SET document=?,updated_at=? WHERE id=? AND user_id=? AND document=? AND generation_control='paused' AND state!='running'")
    .bind(JSON.stringify(next),new Date().toISOString(),requestId,owner,result.document).run();
   if(!updated.meta.changes)throw new ReaderError(409,'目标故事已更新，文本已保留，请重新读取后再操作。');
   result=await destination.get(requestId,owner);current=JSON.parse(result.document) as Document;
  }
  if(!include){await checkpoint(current.images,'skipped');return view(result);}
  if(styleChanged)throw new ReaderError(400,'更改画风时不能复制旧图片。文本已保留。');
  if(progress!=='pending')await checkpoint(current.images,'pending');
  const images=saved.plan.pages.map(()=> '');
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
  return view(result);
 }finally{try{await source?.close();}finally{await release();}}
}
