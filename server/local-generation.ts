// Bind whole-book suggestions and selected local originals to the existing provider.
// Verify and persist originals before any paid storyboard request; never fall back remotely.
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import {ReaderError} from '../lib/reader-model.ts';
import {LocalBooks,localBookId} from './local-books.ts';
import {hasSourceAnomaly,hasBlockingSourceAnomaly} from './local-source-quality.ts';
import {discoverLocalStories} from './local-story-discovery.ts';
import {StoryDiscoveryCache} from './story-discovery-cache.ts';

export function withLocalBooks(provider:ReaderProvider,books:LocalBooks,media:MediaStore,cache=new StoryDiscoveryCache(media)):ReaderProvider{
 async function persist(source:NonNullable<Awaited<ReturnType<LocalBooks['selected']>>>,id:string){
  await media.put(`reader/${id}/source.json`,new TextEncoder().encode(JSON.stringify(source)),{contentType:'application/json'});
  return source;
 }
 return {
  status:()=>provider.status(),safeError:error=>provider.safeError(error),
  async suggestions(selection,excluded,_localBook,reading){
   reading?.signal.throwIfAborted();
   const book=await books.book(selection);
   reading?.signal.throwIfAborted();
   if(!book)return provider.suggestions(selection,excluded);
   return discoverLocalStories(provider,books,cache,book,selection,excluded,reading);
  },
  generator(){
   const generator=provider.generator();
   return {...generator,
    async prepareOriginal(selection,id){
     if(!localBookId(selection)){
      if(selection.source)throw new ReaderError(400,'出处与所选书籍不一致，请重新选择故事。');
      return generator.prepareOriginal?.(selection,id)||null;
     }
     const original=await books.selected(selection);return persist(original!,id);
    },
    async plan(selection,id,original){
     if(!localBookId(selection))return generator.plan(selection,id,original);
     if(!original?.localSource||!selection.source||(['edition','sectionId','firstUnit','lastUnit'] as const).some(key=>original.localSource![key]!==selection.source![key]))throw new ReaderError(400,'原文尚未在本地核对，请重新选择故事。');
     if(hasBlockingSourceAnomaly(original.text,original.localSource)||hasSourceAnomaly(original.title))throw new ReaderError(400,'已存原文含未识别字形或缺文标记，请重新选择完整、可读的故事出处。原文记录已保留。');
     // The checkpoint owns the exact verified version; readable retries keep that saved original.
     const result=await generator.plan(selection,id,original);
     return {...result,value:{...result.value,sourceReference:original.title}};
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
