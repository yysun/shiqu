// Return available verified stories immediately; scan only until a nonempty batch is ready.
// Keep theme progress and verified unfinished events across requests.
// Shared work extends the common story pool; each reader's exclusions affect only their own view.
import {z} from 'zod';
import {localSourceSchema,localSourceKey,localReadingPrompt,localScanJson,legacyLocalReadingPrompt,legacyLocalScanJson} from '../lib/reader-local-contract.ts';
import type {LocalSourceReference,PendingEvent,WholeBookInput} from '../lib/reader-local-contract.ts';
import {suggestionBatchSchema,titleKey} from '../lib/reader-suggestions.ts';
import type {SuggestionBatch} from '../lib/reader-suggestions.ts';
import {ReaderError} from '../lib/reader-model.ts';
import type {Selection} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {LocalBook,LocalBooks} from './local-books.ts';
import {StoryDiscoveryCache,discoveryHash} from './story-discovery-cache.ts';
import type {ReadingObserver} from './story-discovery-cache.ts';
import {readingPlan,readingPlanKey,defaultReadingLimits,legacyReadingPlanKey,manifestSchema,hydrateReadingPlan} from './story-reading-inputs.ts';
import type {ReadingLimits,ReadingBlock} from './story-reading-inputs.ts';
import {requestTokens} from './story-token-budget.ts';
import {sourceUnitIds,sourcesOverlap,sourceCovers,mergeSources} from './local-source-ranges.ts';

const storySchema=suggestionBatchSchema.shape.stories.element.extend({source:localSourceSchema});
type Story=z.infer<typeof storySchema>;
const pendingSchema=z.object({id:z.string().min(1).max(64),title:z.string().min(1).max(100),summary:z.string().min(1).max(1000),source:localSourceSchema});
const stateSchema=z.object({stories:z.array(storySchema).max(50000),cursor:z.number().int().min(0),readThrough:z.number().int().min(0),pendingEvents:z.array(pendingSchema).max(16),exhausted:z.boolean(),rejected:z.boolean()});
type State=z.infer<typeof stateSchema>;
const failed=()=>new ReaderError(502,'本段选题未能完整核对，已保留进度，请重试或换个主题。');
export function discoveryNamespace(book:LocalBook,provider:string,model:string,limits=defaultReadingLimits){
 return discoveryHash(['direct-reading-v3',readingPlanKey(book,provider,limits),model,localReadingPrompt({...book.input,purpose:'scan'}),localScanJson]);
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
 const status=await provider.status(),plan=await readingPlan(book,status.provider,cache,limits);
 const namespace=discoveryNamespace(book,status.provider,status.models.text,limits);
 const theme=selection.theme.normalize('NFKC').trim(),key=namespace+'/theme/'+discoveryHash(theme);
 const totalChars=plan.blocks.reduce((n,block)=>n+block.chars,0),excludedKeys=new Set(excludedSources.length?[]:excluded.map(titleKey));
 const validExclusions=excludedSources.filter(source=>{try{qualified(books,book,source);return true;}catch{return false;}});
 const visibleStories=(stories:Story[])=>{
  const shown:Story[]=[];
  for(const story of stories){
   const title=titleKey(story.title);if(excludedKeys.has(title)||validExclusions.some(source=>sourcesOverlap(book,source,story.source)))continue;
   if(shown.some(other=>sourcesOverlap(book,other.source,story.source)))continue;
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
 const migrateLegacy=async()=>{
  const oldKey=legacyDiscoveryNamespace(book,status.provider,status.models.text)+'/theme/'+discoveryHash(theme);
  const saved=await cache.read(oldKey,stateSchema,value=>{
   for(const story of value.stories)qualified(books,book,story.source);
   for(const event of value.pendingEvents)qualified(books,book,event.source);
   return value.readThrough>=value.cursor&&value.readThrough<=value.cursor+1&&new Set(value.pendingEvents.map(event=>event.id)).size===value.pendingEvents.length;
  });
  if(!saved)return null;
  const manifest=await cache.read(legacyReadingPlanKey(book,status.provider)+'/blocks',manifestSchema,value=>{hydrateReadingPlan(book,value);return true;});
  let cursor=0;
  if(manifest){
   const oldBlocks=hydrateReadingPlan(book,manifest);
   if(saved.cursor>oldBlocks.length||saved.readThrough>oldBlocks.length||saved.exhausted!==(saved.cursor===oldBlocks.length))return null;
   // Only the old cursor proves completed coverage. A partial old block may be reread.
   const completed=new Set(oldBlocks.slice(0,saved.cursor).flatMap(block=>[...block.visible]));
   while(cursor<plan.blocks.length&&[...plan.blocks[cursor].visible].every(id=>completed.has(id)))cursor++;
  }
  const migrated={...saved,cursor,readThrough:cursor,exhausted:cursor===plan.blocks.length};
  await cache.write(key,migrated);
  return migrated;
 };
 const unitText=new Map(book.sections.flatMap(section=>section.units.map(unit=>[unit.id,unit.text] as const)));
 const scanRequest=(current:State,cursor:number,maxStories=5)=>{
  const block=plan.blocks[cursor],visible=new Set(block.visible);
  const contextText=current.pendingEvents.map(event=>{
   const ids=sourceUnitIds(book,event.source);for(const id of ids)visible.add(id);
   return '未完事件 '+event.id+'\n'+books.resolve(book,event.source).title+'\n'+ids.map(id=>'['+id+']\n'+unitText.get(id)).join('\n\n');
  }).join('\n\n');
  const relevant=current.stories.filter(story=>sourceUnitIds(book,story.source).some(id=>visible.has(id)));
  const input:WholeBookInput={title:book.title,edition:book.edition,text:block.text,purpose:'scan',scan:{maxStories,excludedSources:relevant.map(story=>story.source),pendingEvents:current.pendingEvents,contextText}};
  return {input,titles:relevant.map(story=>story.title),visible};
 };
 const response=(state:State,hit:boolean):SuggestionBatch=>{
  const stories=visibleStories(state.stories).slice(0,5);
  const note=(hit?'已复用本地主题故事缓存。':plan.manifest.mode==='whole'?'已直接根据全书原文选题。':'已按章回选题，换一批将从保存的位置继续。')+(state.rejected?'部分返回出处未能完整核对，已保留当前进度，可继续重试。':'')+(stories.length<5&&state.exhausted?'已检查完所给原文，当前主题可确认的新故事不足5篇。':'')+(state.exhausted&&state.pendingEvents.length?'部分跨章线索尚未确认完整，未作为故事推荐。':'');
  return {stories,note:note.slice(0,300)};
 };
 let hit=true;
 while(true){
  // Even a partial cached batch must not wait behind another reader's in-flight expansion.
  const cached=await cache.read(key,stateSchema,validate)||await cache.shared(key+'/migration',observer,()=>migrateLegacy());
  if(cached&&(visibleStories(cached.stories).length>0||cached.exhausted))return response(cached,hit);
  const {state,stalled}=await cache.shared(key,observer,async reading=>{
   let current=await cache.read(key,stateSchema,validate)||{stories:[],cursor:0,readThrough:0,pendingEvents:[],exhausted:false,rejected:false};
   let stalled=false;
   const progress=(stage:'reading'|'checking'='reading',block:ReadingBlock|undefined=plan.blocks[current.cursor])=>reading.onProgress({completed:current.cursor,total:plan.blocks.length,completedChars:plan.blocks.slice(0,current.cursor).reduce((n,block)=>n+block.chars,0),totalChars,stage,mode:plan.manifest.mode,currentChapters:block?.chapters||[]});
   progress();
   while(!visibleStories(current.stories).length&&!current.exhausted){
    reading.signal.throwIfAborted();
    const {input,titles,visible}=scanRequest(current,current.cursor,current.stories.length?5:1);
    if(requestTokens(input,theme,titles,status.provider)>limits.whole)throw new ReaderError(502,'跨章原文或已选记录超过本次输入预算，已保留进度；请换个主题。');
    hit=false;
    const result=await provider.suggestions({...selection,theme,artStyle:'ink-pencil',productionPrompt:''},titles,input);
    progress('checking');
    if(result.stories.length>input.scan!.maxStories)throw failed();
    if(!result.scan||!Array.isArray(result.scan.pendingEvents)||!Array.isArray(result.scan.resolvedEventIds))throw failed();
    const accepted:Story[]=[];let rejected=false;
    for(const raw of result.stories){
     try{
      const story=storySchema.parse(raw);qualified(books,book,story.source,visible);
      if(current.stories.some(old=>sourcesOverlap(book,old.source,story.source))||accepted.some(old=>sourcesOverlap(book,old.source,story.source))){rejected=true;continue;}
      accepted.push({...story,sourceLabel:books.resolve(book,story.source).title.slice(0,150)});
     }catch{rejected=true;}
    }
    const pending=mergePending(books,book,current.pendingEvents,result.scan.pendingEvents,result.scan.resolvedEventIds,accepted,visible);
    const next:State={...current,stories:[...current.stories,...accepted],pendingEvents:pending,rejected};
    // A full response only fills the current page; it is never proof that the block is exhausted.
    if(!rejected&&result.stories.length<input.scan!.maxStories&&result.scan.blockComplete)next.cursor++;
    next.readThrough=next.cursor;
    next.exhausted=next.cursor===plan.blocks.length;
    // Validate the next pending context before committing a cursor that cannot be resumed.
    if(!next.exhausted&&next.pendingEvents.length){
     const upcoming=scanRequest(next,next.cursor);
     if(requestTokens(upcoming.input,theme,upcoming.titles,status.provider)>limits.whole)throw new ReaderError(502,'跨章上下文超过输入预算，旧进度已保留，请换个主题。');
    }
    await cache.write(key,next);current=next;progress();
    if(reading.signal.aborted)break;
    if(rejected||!accepted.length&&!result.scan.blockComplete){
     if(visibleStories(current.stories).length){stalled=true;break;}
     throw failed();
    }
   }
   return {state:current,stalled};
  });
  observer?.signal.throwIfAborted();
  const stories=visibleStories(state.stories).slice(0,5);
  if(stories.length||state.exhausted||state.rejected)return response(state,hit);
  if(stalled)return {...response(state,hit),note:'本段尚未确认处理完，已保存找到的故事和原文位置，可重试继续。'};
  // A different waiting reader may need more than the shared expansion supplied.
 }
}
