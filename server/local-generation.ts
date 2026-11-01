// Bind whole-book or selected-chapter discovery and verified originals to the existing provider.
// Verify and persist originals before any paid storyboard request; never fall back remotely.
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import type {Selection} from '../lib/reader-model.ts';
import type {OriginalSource} from '../lib/reader-source-types.ts';
import {ReaderError} from '../lib/reader-model.ts';
import {selectedChapterScope} from './local-book-contents.ts';
import {LocalBooks,localBookId} from './local-books.ts';
import {hasSourceAnomaly,hasStoredSourceAnomaly} from './local-source-quality.ts';
import {discoverLocalStories} from './local-story-discovery.ts';
import {StoryDiscoveryCache,discoveryHash} from './story-discovery-cache.ts';
import {localSourceKey} from '../lib/reader-local-contract.ts';
import {artRecommendationSchema,selectedArtRecommendationPrompt} from '../lib/reader-art-recommendation.ts';

export function withLocalBooks(provider:ReaderProvider,books:LocalBooks,media:MediaStore,cache=new StoryDiscoveryCache(media)):ReaderProvider{
 async function persist(source:NonNullable<Awaited<ReturnType<LocalBooks['selected']>>>,id:string){
  await media.put(`reader/${id}/source.json`,new TextEncoder().encode(JSON.stringify(source)),{contentType:'application/json'});
  return source;
 }
 return {
  status:()=>provider.status(),safeError:error=>provider.safeError(error),
  async suggestions(selection,excluded,_localBook,reading,excludedSources=[]){
   reading?.signal.throwIfAborted();
   const book=await books.book(selection);
   reading?.signal.throwIfAborted();
   if(!book){if(selection.discoverySources)throw new ReaderError(400,'章节提取只支持本地书库。');return provider.suggestions(selection,excluded);}
   const scope=selection.discoverySources?selectedChapterScope(books,book,selection.discoverySources):null;
   return discoverLocalStories(provider,books,cache,scope?.book||book,scope?{...selection,discoverySources:scope.discoverySources}:selection,excluded,reading,excludedSources);
  },
  async recommendArt(selection){
   const original=await books.selected(selection);
   if(!original?.localSource||!selection.storyTitle)throw new ReaderError(400,'请先选择已核对出处的故事。');
   if(!provider.recommendArt)throw new ReaderError(503,'画风推荐暂不可用，可以手动选择画风。');
   const status=await provider.status(),key='selected-story-art/'+discoveryHash([selection.bookId,selection.customBook,original.localSource,selection.storyTitle,selection.theme,status.provider,status.models.text,selectedArtRecommendationPrompt,...(status.taskReasoningEfforts?[status.taskReasoningEfforts.art]:[])]);
   return cache.shared(key,undefined,async()=>{
    const saved=await cache.read(key,artRecommendationSchema);if(saved)return saved;
    const result=artRecommendationSchema.parse(await provider.recommendArt!(selection,original));
    await cache.write(key,result);return result;
   });
  },
  generator(){
   const generator=provider.generator();
   function verifyOriginal(selection:Selection,original:OriginalSource|undefined){
    if(!original?.localSource||!selection.source||localSourceKey(original.localSource)!==localSourceKey(selection.source))throw new ReaderError(400,'原文尚未在本地核对，请重新选择故事。');
    if(hasStoredSourceAnomaly(original)||hasSourceAnomaly(original.title))throw new ReaderError(400,'已存原文含未识别字形或缺文标记，请重新选择完整、可读的故事出处。原文记录已保留。');
   }
   return {...generator,
    async reflection(selection,draft,original,revision){
     if(localBookId(selection))verifyOriginal(selection,original);
     return generator.reflection(selection,draft,original,revision);
    },
    async reflectionCandidates(selection,draft,original){
     if(localBookId(selection))verifyOriginal(selection,original);
     return generator.reflectionCandidates(selection,draft,original);
    },
    ...(generator.review?{async review(selection,plan,original,outline,candidates){
     if(localBookId(selection))verifyOriginal(selection,original);
     return generator.review!(selection,plan,original,outline,candidates);
    }} satisfies Pick<typeof generator,'review'>:{}),
    ...(generator.repair?{async repair(selection,plan,original,issues,outline){
     if(localBookId(selection))verifyOriginal(selection,original);
     return generator.repair!(selection,plan,original,issues,outline);
    }} satisfies Pick<typeof generator,'repair'>:{}),
    ...(generator.outline?{async outline(selection,id,original){
     if(localBookId(selection))verifyOriginal(selection,original);
     const result=await generator.outline!(selection,id,original);
     return original?{...result,value:{...result.value,sourceReference:original.title}}:result;
    }} satisfies Pick<typeof generator,'outline'>:{}),
    ...(generator.planBatch?{async planBatch(selection,id,draft,original){
     if(localBookId(selection))verifyOriginal(selection,original);
     return generator.planBatch!(selection,id,draft,original);
    }} satisfies Pick<typeof generator,'planBatch'>:{}),
    async prepareOriginal(selection,id){
     if(!localBookId(selection)){
      if(selection.source)throw new ReaderError(400,'出处与所选书籍不一致，请重新选择故事。');
      return generator.prepareOriginal?.(selection,id)||null;
     }
     const original=await books.selected(selection);return persist(original!,id);
    },
    async recommend(selection,id,original){
     if(localBookId(selection))verifyOriginal(selection,original);
     if(!generator.recommend)throw new ReaderError(503,'生成服务暂不支持画幅建议，请更新服务后重试。');
     return generator.recommend(selection,id,original);
    },
    async plan(selection,id,original){
     if(!localBookId(selection))return generator.plan(selection,id,original);
     verifyOriginal(selection,original);
     // The checkpoint owns the exact verified version; readable retries keep that saved original.
     const result=await generator.plan(selection,id,original);
     return {...result,value:{...result.value,sourceReference:original!.title}};
    },
    async original(selection,plan,id){
     if(!localBookId(selection))return generator.original(selection,plan,id);
     const original=await books.legacy(selection,plan);await persist(original!,id);
     return {source:original,message:'',searchUrl:''};
    },
   };
  },
 };
}
