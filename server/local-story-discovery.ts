// Persist theme-neutral stories before matching; never let a reader's theme or exclusions shape extraction.
// Expand only until new stories exist, carrying verified unfinished events across blocks and cancellation.
// Per-theme decisions live separately, and story summaries never replace original text in production.
import {z} from 'zod';
import {localSourceSchema,localSourceKey,localReadingPrompt,localCatalogJson,legacyLocalReadingPrompt,legacyLocalScanJson,localChapterStoriesPrompt} from '../lib/reader-local-contract.ts';
import type {LocalSourceReference,PendingEvent,WholeBookInput} from '../lib/reader-local-contract.ts';
import {suggestionBatchSchema,titleKey} from '../lib/reader-suggestions.ts';
import type {SuggestionBatch} from '../lib/reader-suggestions.ts';
import {ReaderError} from '../lib/reader-model.ts';
import type {Selection} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {LocalBook,LocalBooks} from './local-books.ts';
import {StoryDiscoveryCache,discoveryHash} from './story-discovery-cache.ts';
import type {ReadingObserver} from './story-discovery-cache.ts';
import {readingPlan,readingPlanKey,defaultReadingLimits,legacyReadingPlanKey} from './story-reading-inputs.ts';
import type {ReadingLimits,ReadingBlock} from './story-reading-inputs.ts';
import {requestTokens} from './story-token-budget.ts';
import {sourceUnitIds,sourcesOverlap,sourceCovers,mergeSources} from './local-source-ranges.ts';
import {matchLibraryStories} from './story-theme-matching.ts';

const storySchema=suggestionBatchSchema.shape.stories.element.extend({source:localSourceSchema,summary:z.string().trim().min(1).max(1200)});
type Story=z.infer<typeof storySchema>;
const pendingSchema=z.object({id:z.string().min(1).max(64),title:z.string().min(1).max(100),summary:z.string().min(1).max(1000),source:localSourceSchema});
const stateSchema=z.object({stories:z.array(storySchema).max(50000),cursor:z.number().int().min(0),readThrough:z.number().int().min(0),pendingEvents:z.array(pendingSchema).max(16),exhausted:z.boolean(),rejected:z.boolean()});
type State=z.infer<typeof stateSchema>;
const failed=()=>new ReaderError(502,'本段选题未能完整核对，已保留进度，请重试或换个主题。');
export function discoveryNamespace(book:LocalBook,provider:string,model:string,limits=defaultReadingLimits,effort?:string){
 return discoveryHash(['story-library-v1',readingPlanKey(book,provider,limits),model,localReadingPrompt({...book.input,purpose:'catalog'}),localCatalogJson,...(effort?[effort]:[])]);
}
export function legacyDiscoveryNamespace(book:LocalBook,provider:string,model:string){
 return discoveryHash(['direct-reading-v2',legacyReadingPlanKey(book,provider),model,legacyLocalReadingPrompt({...book.input,purpose:'scan'}),legacyLocalScanJson]);
}
function qualified(books:LocalBooks,book:LocalBook,source:LocalSourceReference,visible?:Set<string>){
 books.resolve(book,source);
 if(visible&&!sourceUnitIds(book,source).every(id=>visible.has(id)))throw failed();
}
function mergePending(books:LocalBooks,book:LocalBook,old:PendingEvent[],updates:PendingEvent[],resolved:string[],accepted:Story[],visible:Set<string>){
 const result=new Map(old.map(event=>[event.id,event])),seen=new Set<string>();
 if(new Set(resolved).size!==resolved.length)throw failed();
 for(const id of resolved){
  const event=result.get(id);
  if(!event||!accepted.some(story=>sourceCovers(book,story.source,event.source)))throw failed();
  result.delete(id);
 }
 for(const update of updates){
  qualified(books,book,update.source,visible);
  if(update.id&&(!old.some(event=>event.id===update.id)||resolved.includes(update.id)))throw failed();
  const previous=update.id?result.get(update.id):[...result.values()].find(event=>sourcesOverlap(book,event.source,update.source));
  const id=previous?.id||discoveryHash([localSourceKey(update.source),update.title]);
  if(resolved.includes(id)||resolved.some(done=>sourcesOverlap(book,old.find(event=>event.id===done)!.source,update.source)))throw failed();
  if(seen.has(id))throw failed();seen.add(id);
  const event={...update,id,source:previous?mergeSources(book,previous.source,update.source):update.source};
  qualified(books,book,event.source);
  result.set(id,event);
 }
 if(result.size>16)throw failed();
 return [...result.values()];
}
export async function discoverLocalStories(provider:ReaderProvider,books:LocalBooks,cache:StoryDiscoveryCache,book:LocalBook,selection:Selection,excluded:string[],observer?:ReadingObserver,excludedSources:LocalSourceReference[]=[],limits:ReadingLimits=defaultReadingLimits):Promise<SuggestionBatch>{
 const batchLimit=observer?.maxStories||5;
 const status=await provider.status(),plan=await readingPlan(book,status.provider,cache,limits);
 const chapterStories=!!selection.discoverySources;
 const namespace=discoveryNamespace(book,status.provider,status.models.text,limits,status.taskReasoningEfforts?.suggest)+(selection.discoverySources?'/scope/'+discoveryHash(selection.discoverySources.map(localSourceKey))+'/main-first/'+discoveryHash(localChapterStoriesPrompt):'');
 const theme=selection.theme.normalize('NFKC').trim(),key=namespace+'/library';
 const totalChars=plan.blocks.reduce((n,block)=>n+block.chars,0),excludedKeys=new Set(excludedSources.length?[]:excluded.map(titleKey));
 const validExclusions=excludedSources.filter(source=>{try{qualified(books,book,source);return true;}catch{return false;}});
 const conflicts=(a:LocalSourceReference,b:LocalSourceReference)=>{
  if(!sourcesOverlap(book,a,b))return false;
  // Equal coverage is a duplicate; neither covering the other is a crossing fragment.
  return sourceCovers(book,a,b)===sourceCovers(book,b,a);
 };
 const visibleStories=(stories:Story[])=>{
  const shown:Story[]=[];
  for(const story of stories){
   const title=titleKey(story.title);if(excludedKeys.has(title)||validExclusions.some(source=>conflicts(source,story.source)))continue;
   if(shown.some(other=>conflicts(other.source,story.source)))continue;
   shown.push(story);
  }
  return shown;
 };
 const validate=(state:State)=>{
  if(state.cursor>plan.blocks.length||state.readThrough>plan.blocks.length||state.readThrough<state.cursor||state.readThrough>state.cursor+1||state.exhausted!==(state.cursor===plan.blocks.length))return false;
  for(const story of state.stories)qualified(books,book,story.source);
  const ids=new Set<string>();for(const event of state.pendingEvents){qualified(books,book,event.source);if(ids.has(event.id))return false;ids.add(event.id);}
  return true;
 };
 const unitText=new Map(book.sections.flatMap(section=>section.units.map(unit=>[unit.id,unit.text] as const)));
 const scanRequest=(current:State,cursor:number,maxStories=5)=>{
  const block=plan.blocks[cursor],visible=new Set(block.visible);
  const context=current.pendingEvents.map(event=>{
   const ids=sourceUnitIds(book,event.source);for(const id of ids)visible.add(id);
   return '未完事件 '+event.id+'\n'+books.resolve(book,event.source).title+'\n'+ids.map(id=>'['+id+']\n'+unitText.get(id)).join('\n\n');
  });
  let relevant=current.stories.filter(story=>sourceUnitIds(book,story.source).some(id=>visible.has(id)));
  if(chapterStories)for(const story of relevant){
   // A main story may begin in an earlier block. Its original evidence remains available for episodes.
   const ids=sourceUnitIds(book,story.source).filter(id=>!visible.has(id));
   if(ids.length){for(const id of ids)visible.add(id);context.push('已选故事 '+story.title+'\n'+books.resolve(book,story.source).title+'\n'+ids.map(id=>'['+id+']\n'+unitText.get(id)).join('\n\n'));}
  }
  if(chapterStories)relevant=current.stories.filter(story=>sourceUnitIds(book,story.source).some(id=>visible.has(id)));
  const chapterStoryLevel=chapterStories?(relevant.length?'episodes':'main'):undefined;
  const input:WholeBookInput={title:book.title,edition:book.edition,text:block.text,purpose:'catalog',scan:{maxStories:chapterStoryLevel==='main'?1:maxStories,excludedSources:relevant.map(story=>story.source),pendingEvents:current.pendingEvents,contextText:context.join('\n\n'),...(chapterStoryLevel?{chapterStoryLevel}:{})}};
  return {input,titles:relevant.map(story=>story.title),visible};
 };
 const progress=(current:State,stage:'reading'|'checking'|'selecting'='reading',reading:ReadingObserver|undefined=observer,block:ReadingBlock|undefined=plan.blocks[current.cursor])=>reading?.onProgress({completed:current.cursor,total:plan.blocks.length,completedChars:plan.blocks.slice(0,current.cursor).reduce((n,block)=>n+block.chars,0),totalChars,stage,mode:plan.manifest.mode,currentChapters:block?.chapters||[]});
 const empty=():State=>({stories:[],cursor:0,readThrough:0,pendingEvents:[],exhausted:false,rejected:false});
 const read=async()=>await cache.read(key,stateSchema,validate)||empty();
 const response=(state:State,stories:Story[],hit:boolean):SuggestionBatch=>{
  const note=(hit?'已复用本地故事库及主题判断缓存。':chapterStories?'已按先总故事、后小故事的顺序收录，再匹配主题。':'已逐篇收录原文故事并匹配主题。')+(state.rejected?'部分返回出处未能完整核对，已保留当前进度，可继续重试。':'')+(!stories.length&&state.exhausted?'已检查完所给原文，暂时没有更多符合主题的故事。':'')+(state.exhausted&&state.pendingEvents.length?'部分跨章线索尚未确认完整，未作为故事推荐。':'');
  // The catalog's complete summary is internal. Selection/production retain only verified source references.
  return suggestionBatchSchema.parse({stories:stories.slice(0,batchLimit),note:note.slice(0,300)});
 };
 const extraction:Selection={bookId:selection.bookId,...(selection.bookId==='other'?{customBook:book.title}:{}),theme:'',artStyle:'ink-pencil',productionPrompt:'',length:'auto',voice:false};
 let hit=true;
 while(true){
  observer?.signal.throwIfAborted();
  const saved=await read(),candidates=visibleStories(saved.stories);
  if(candidates.length)progress(saved,'selecting');
  const matched=await matchLibraryStories(provider,cache,namespace,theme,candidates,story=>books.resolve(book,story.source).text,limits.whole,status.provider,observer);
  if(matched.length||saved.exhausted)return response(saved,matched,hit);
  const baseline=saved.stories.length;
  await cache.shared(key,observer,async reading=>{
   let current=await read();progress(current,'reading',reading);
   // A simultaneous theme may already have extended the shared library while matching ran.
   while(current.stories.length<=baseline&&!current.exhausted){
    reading.signal.throwIfAborted();
    const {input,titles,visible}=scanRequest(current,current.cursor,current.stories.length?batchLimit:1);
    if(requestTokens(input,'',titles,status.provider)>limits.whole)throw new ReaderError(502,'跨章原文或已入库记录超过本次输入预算，故事库和进度已保留，请缩小章节范围。');
    const result=await provider.suggestions(extraction,titles,input);
    progress(current,'checking',reading);
    if(result.stories.length>input.scan!.maxStories)throw failed();
    if(!result.scan||!Array.isArray(result.scan.pendingEvents)||!Array.isArray(result.scan.resolvedEventIds))throw failed();
    const accepted:Story[]=[];let rejected=false;
    for(const raw of result.stories){
     try{
      const story=storySchema.parse(raw);qualified(books,book,story.source,visible);
      if(current.stories.some(old=>conflicts(old.source,story.source))||accepted.some(old=>conflicts(old.source,story.source))){rejected=true;continue;}
      accepted.push({...story,sourceLabel:books.resolve(book,story.source).title.slice(0,150)});
     }catch{rejected=true;}
    }
    const pending=mergePending(books,book,current.pendingEvents,result.scan.pendingEvents,result.scan.resolvedEventIds,accepted,visible);
    const next:State={...current,stories:[...current.stories,...accepted],pendingEvents:pending,rejected};
    // A full response is not proof that all stories in this block have been catalogued.
    if(!rejected&&result.stories.length<input.scan!.maxStories&&result.scan.blockComplete)next.cursor++;
    next.readThrough=next.cursor;next.exhausted=next.cursor===plan.blocks.length;
    if(!next.exhausted&&next.pendingEvents.length){
     const upcoming=scanRequest(next,next.cursor);
     if(requestTokens(upcoming.input,'',upcoming.titles,status.provider)>limits.whole)throw new ReaderError(502,'跨章上下文超过输入预算，旧故事库和进度已保留，请缩小章节范围。');
    }
    await cache.write(key,next);current=next;progress(current,'reading',reading);
    if(reading.signal.aborted)break;
    if(!accepted.length&&(rejected||!result.scan.blockComplete))throw failed();
   }
  });
  hit=false;
 }
}
