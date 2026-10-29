// Build one verified, theme-independent story index, then select from bounded summaries.
// Disk checkpoints outlive retries; neither a new theme nor another batch rereads originals.
import {z} from 'zod';
import {localSourceSchema,localReadingPrompt,localIndexJson,localChoicesJson} from '../lib/reader-local-contract.ts';
import {suggestionBatchSchema,titleKey,freshSuggestions} from '../lib/reader-suggestions.ts';
import type {SuggestionBatch} from '../lib/reader-suggestions.ts';
import {ReaderError} from '../lib/reader-model.ts';
import type {Selection} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {LocalBook,LocalBooks} from './local-books.ts';
import {bookInputs} from './local-book-inputs.ts';
import {StoryDiscoveryCache,discoveryHash} from './story-discovery-cache.ts';
import type {ReadingObserver} from './story-discovery-cache.ts';

export const indexInputLimit=40000,summaryInputLimit=30000;
const storySchema=suggestionBatchSchema.shape.stories.element.extend({source:localSourceSchema});
type IndexedStory=z.infer<typeof storySchema>;
const indexSchema=z.object({stories:z.array(storySchema).max(50000),rejected:z.boolean()});
const partSchema=indexSchema.extend({stories:z.array(storySchema).max(12)});
const themeSchema=z.object({stories:z.array(storySchema).max(50000),exhausted:z.boolean(),note:z.string().max(300)});
const receipt=(story:IndexedStory)=>JSON.stringify(story.source);
function unique(stories:IndexedStory[]){const seen=new Set<string>();return stories.filter(story=>{const key=receipt(story);if(seen.has(key))return false;seen.add(key);return true;});}
export function discoveryNamespace(book:LocalBook,provider:string,model:string){
 return discoveryHash(['story-discovery-v1',indexInputLimit,book.id,book.edition,discoveryHash(book.input.text),localReadingPrompt({...book.input,purpose:'story-index'}),localIndexJson,provider,model]);
}
function qualified(books:LocalBooks,book:LocalBook,stories:IndexedStory[],visible?:Set<string>){
 for(const story of stories){
  books.resolve(book,story.source);
  if(visible){const section=book.sections.find(s=>s.id===story.source.sectionId)!;
   const first=section.units.findIndex(u=>u.id===story.source.firstUnit),last=section.units.findIndex(u=>u.id===story.source.lastUnit);
   if(!section.units.slice(first,last+1).every(unit=>visible.has(unit.id)))throw Error('Foreign batch source');
  }
 }
 return true;
}
function totals(book:LocalBook){return new Map(book.sections.flatMap(section=>section.units.map(unit=>[unit.id,Array.from(unit.text.replace(/\s/gu,'')).length] as const)));}

export async function discoverLocalStories(provider:ReaderProvider,books:LocalBooks,cache:StoryDiscoveryCache,book:LocalBook,selection:Selection,excluded:string[],observer?:ReadingObserver):Promise<SuggestionBatch>{
 const status=await provider.status(),namespace=discoveryNamespace(book,status.provider,status.models.text);
 const counts=totals(book),totalChars=Array.from(counts.values()).reduce((sum,n)=>sum+n,0);
 const indexKey=`${namespace}/index`,theme=selection.theme.normalize('NFKC').trim();
 const neutral:Selection={bookId:selection.bookId,customBook:selection.customBook,theme:'故事索引',artStyle:'ink-pencil',length:8,voice:false,productionPrompt:''};
 const index=await cache.shared(indexKey,observer,async reading=>{
  const saved=await cache.read(indexKey,indexSchema,value=>qualified(books,book,value.stories));
  if(saved)return saved;
  const inputs=bookInputs(book,indexInputLimit),parts:z.infer<typeof partSchema>[]=new Array(inputs.length),seen=new Set<string>();
  let cursor=0,completed=0,completedChars=0,failure:unknown,failed=false;
  const report=()=>reading.onProgress({completed,total:inputs.length,completedChars,totalChars,stage:'reading'});
  function finish(index:number,part:z.infer<typeof partSchema>){parts[index]=part;completed++;for(const id of inputs[index].visible)if(!seen.has(id)){seen.add(id);completedChars+=counts.get(id)||0;}report();}
  // Recover all saved batches before dispatch so resumed progress starts at the true checkpoint.
  for(let i=0;i<inputs.length;i++){
   const part=await cache.read(`${namespace}/part/${discoveryHash(inputs[i].input.text)}`,partSchema,value=>qualified(books,book,value.stories,inputs[i].visible));
   if(part)finish(i,part);
  }
  report();
  async function worker(){
   while(cursor<inputs.length&&!failed&&!reading.signal.aborted){
    const i=cursor++;if(parts[i])continue;
    try{
     const result=await provider.suggestions(neutral,[],{...inputs[i].input,purpose:'story-index'});
     const parsed=z.object({stories:z.array(suggestionBatchSchema.shape.stories.element).max(12),note:z.string().max(300)}).parse(result);
     let rejected=false;
     const stories=unique(parsed.stories.flatMap(candidate=>{
      try{const story=storySchema.parse(candidate);qualified(books,book,[story],inputs[i].visible);return [{...story,sourceLabel:books.resolve(book,story.source).title}];}
      catch{rejected=true;return [];}
     }));
     const part={stories,rejected};
     // Save completed paid work even if the last waiting browser left during the call.
     await cache.write(`${namespace}/part/${discoveryHash(inputs[i].input.text)}`,part);finish(i,part);
    }catch(error){failure=error;failed=true;}
   }
  }
  await Promise.all(Array.from({length:Math.min(2,inputs.length)},worker));
  if(failed)throw failure;reading.signal.throwIfAborted();
  const merged={stories:unique(parts.flatMap(part=>part.stories)),rejected:parts.some(part=>part.rejected)};
  await cache.write(indexKey,merged);return merged;
 });
 observer?.signal.throwIfAborted();
 const all=new Map(index.stories.map(story=>[receipt(story),story]));
 const themeKey=`${namespace}/theme/${discoveryHash([theme,index.stories,summaryInputLimit,localReadingPrompt({...book.input,purpose:'candidate-summary'}),localChoicesJson])}`,excludedKeys=new Set(excluded.map(titleKey));
 let fromCache=true;
 const visible=(stories:IndexedStory[])=>{const seen=new Set(excludedKeys);return stories.filter(story=>{const key=titleKey(story.title);if(seen.has(key))return false;seen.add(key);return true;});};
 while(true){
  const result=await cache.shared(themeKey,observer,async reading=>{
   const cached=await cache.read(themeKey,themeSchema,value=>value.stories.every(story=>all.has(receipt(story))&&titleKey(all.get(receipt(story))!.title)===titleKey(story.title)));
   const pool=cached||{stories:[],exhausted:false,note:''};
   if(visible(pool.stories).length>=5||pool.exhausted)return pool;
   fromCache=false;
   const known=new Set(pool.stories.map(receipt)),titles=new Set(pool.stories.map(story=>titleKey(story.title)));
   const remaining=index.stories.filter(story=>!known.has(receipt(story))&&!titles.has(titleKey(story.title)));
   const progress=()=>{reading.onProgress({completed:1,total:1,completedChars:totalChars,totalChars,stage:'selecting'});};
   async function select(candidates:IndexedStory[]):Promise<IndexedStory[]>{
    if(!candidates.length)return [];
    const groups:IndexedStory[][]=[];let group:IndexedStory[]=[];
    for(const candidate of candidates){
     if(JSON.stringify([...group,candidate]).length>summaryInputLimit){if(!group.length)throw new ReaderError(502,'故事索引条目过长，请重建索引。');groups.push(group);group=[];}
     group.push(candidate);
    }if(group.length)groups.push(group);
    const chosen:IndexedStory[]=[];
    for(const items of groups){
     reading.signal.throwIfAborted();progress();
     const batch=suggestionBatchSchema.parse(await provider.suggestions({...neutral,theme},[],{title:book.title,edition:book.edition,text:JSON.stringify(items),purpose:'candidate-summary'}));
     const allowed=new Map(items.map(story=>[receipt(story),story])),seen=new Set<string>();
     for(const story of batch.stories){
      if(!story.source)throw new ReaderError(502,'索引选题的出处无法核对，请重试。');
      const key=receipt(story as IndexedStory),original=allowed.get(key);
      if(!original||seen.has(key))throw new ReaderError(502,'索引选题的出处无法核对，请重试。');
      seen.add(key);chosen.push({...original,description:story.description});
     }
     pool.note=batch.note;progress();
    }
    return groups.length>1?select(chosen.map(story=>all.get(receipt(story))!)):chosen;
   }
   const chosen=await select(remaining);
   pool.stories=unique([...pool.stories,...chosen]);
   // Expand a shared pool independently of caller exclusions; only the final view filters them.
   pool.exhausted=chosen.length<5||remaining.length<=chosen.length;
   await cache.write(themeKey,pool);return pool;
  });
  observer?.signal.throwIfAborted();
  const stories=visible(result.stories).slice(0,5);
  if(stories.length>=5||result.exhausted||!index.stories.some(story=>!result.stories.some(known=>receipt(known)===receipt(story))&&!excludedKeys.has(titleKey(story.title)))){
   const note=(index.rejected?'部分候选的本地出处无法核对，已移除。':'')+(fromCache?'已复用本地主题故事缓存。':`故事候选库已就绪（${index.stories.length} 个候选），已按主题筛选。`)+(stories.length<5?'当前索引中可确认的新故事不足 5 篇，可换主题继续。':'');
   return freshSuggestions({stories,note:note.slice(0,300)},excluded);
  }
 }
}
