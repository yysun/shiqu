// Bind whole-book suggestions and selected local originals to the existing provider.
// Verify and persist originals before any paid storyboard request; never fall back remotely.
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {MediaStore} from '../lib/services.ts';
import {ReaderError} from '../lib/reader-model.ts';
import {freshSuggestions} from '../lib/reader-suggestions.ts';
import {LocalBooks,localBookId} from './local-books.ts';
import {hasSourceAnomaly,hasBlockingSourceAnomaly} from './local-source-quality.ts';
import {bookInputs} from './local-book-inputs.ts';
import type {SuggestionBatch} from '../lib/reader-suggestions.ts';

export function withLocalBooks(provider:ReaderProvider,books:LocalBooks,media:MediaStore):ReaderProvider{
 async function persist(source:NonNullable<Awaited<ReturnType<LocalBooks['selected']>>>,id:string){
  await media.put(`reader/${id}/source.json`,new TextEncoder().encode(JSON.stringify(source)),{contentType:'application/json'});
  return source;
 }
 return {
  status:()=>provider.status(),safeError:error=>provider.safeError(error),
  async suggestions(selection,excluded){
   const book=await books.book(selection);
   if(!book)return provider.suggestions(selection,excluded);
   const inputs=bookInputs(book),batches:SuggestionBatch[]=new Array(inputs.length);
   let cursor=0,failure:unknown,rejected=0;
   async function worker(){
    while(cursor<inputs.length&&!failure){const index=cursor++,part=inputs[index];
     try{
      const batch=await provider.suggestions({...selection,source:undefined},excluded,part.input);
      const stories=batch.stories.flatMap(story=>{try{
       if(!story.source)throw Error();const original=books.resolve(book!,story.source);
       const section=book!.sections.find(s=>s.id===story.source!.sectionId)!;
       const first=section.units.findIndex(u=>u.id===story.source!.firstUnit),last=section.units.findIndex(u=>u.id===story.source!.lastUnit);
       if(!section.units.slice(first,last+1).every(unit=>part.visible.has(unit.id)))throw Error();
       return [{...story,sourceLabel:original.title}];
      }catch{rejected++;return [];}});
      batches[index]={stories,note:batch.note};
     }catch(error){failure=error;}
    }
   }
   await Promise.all(Array.from({length:Math.min(2,inputs.length)},worker));
   if(failure)throw failure;
   const key=(story:SuggestionBatch['stories'][number])=>{const s=story.source;return s?[s.edition,s.sectionId,s.firstUnit,s.lastUnit].join('|'):'';};
   const seen=new Set<string>();const stories=batches.flatMap(batch=>batch.stories).filter(story=>{if(seen.has(key(story)))return false;seen.add(key(story));return true;});
   let chosen=stories;
   if(inputs.length>1&&stories.length>5){
    const candidates=JSON.stringify(stories.map(({title,description,source,sourceLabel,artRecommendation})=>({title,description,source,sourceLabel,artRecommendation})));
    const summary=await provider.suggestions({...selection,source:undefined},excluded,{title:book.title,edition:book.edition,text:candidates,purpose:'candidate-summary'});
    const allowed=new Map(stories.map(story=>[key(story),story]));const selected=new Set<string>();
    chosen=summary.stories.map(story=>{const receipt=key(story),candidate=allowed.get(receipt);if(!candidate||selected.has(receipt))throw new ReaderError(502,'全书候选汇总的出处无法核对，请重试。');selected.add(receipt);return candidate;});
   }
   const note=inputs.length>1?`已按顺序通读全部 ${inputs.length} 批本地原文，并核对候选出处。`:batches[0]?.note||'';
   return freshSuggestions({stories:chosen.slice(0,5),note:(rejected?'部分候选的本地出处无法核对，已移除。':'')+note},excluded);
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
