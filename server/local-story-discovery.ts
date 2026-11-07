import type {SuggestionProgress} from '../lib/reader-suggestions.ts';
// Persist theme-neutral stories before matching; never let a reader's theme or exclusions shape extraction.
// Expand only until new stories exist, carrying verified unfinished events across blocks and cancellation.
// Binary theme receipts read originals; old catalog ranges resume without generating summaries.
// Complete events may share background; structural novelty is checked before admission, not display.
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {previousReadingPlanKey,previousDiscoveryNamespace,previousSummaryNamespace} from './story-discovery-legacy.ts';
import {discoveryMeasurement} from './story-discovery-metrics.ts';
import {localSourceSchema,localSourceKey,localReadingPrompt,localCatalogJson,legacyLocalReadingPrompt,legacyLocalScanJson,localChapterStoriesPrompt,localTitleStoriesPrompt,catalogStoryLimit} from '../lib/reader-local-contract.ts';
import type {LocalSourceReference,PendingEvent,WholeBookInput} from '../lib/reader-local-contract.ts';
import {suggestionBatchSchema,titleKey} from '../lib/reader-suggestions.ts';
import type {SuggestionBatch} from '../lib/reader-suggestions.ts';
import {ReaderError} from '../lib/reader-model.ts';
import type {Selection} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import type {LocalBook,LocalBooks} from './local-books.ts';
import {StoryDiscoveryCache,discoveryHash} from './story-discovery-cache.ts';
import type {ReadingObserver} from './story-discovery-cache.ts';
import {readingPlan,readingPlanKey,manifestSchema,hydrateReadingPlan,defaultReadingLimits,legacyReadingPlanKey} from './story-reading-inputs.ts';
import type {ReadingLimits,ReadingBlock} from './story-reading-inputs.ts';
import {requestTokens} from './story-token-budget.ts';
import {sourceParts,sourceUnitIds,sourcesOverlap,sourceCovers,mergeSources} from './local-source-ranges.ts';
import {matchLibraryStories,hasUnknownJudgments,saveVerifiedThemeMatches,verifyThemeCandidates} from './story-theme-matching.ts';
import type {LocalStorySearch} from './local-story-search.ts';
import {storyEditorialContext} from '../lib/reader-prompts.ts';
import {discoveryCode} from '../lib/reader-discovery-call.ts';

const storySchema=suggestionBatchSchema.shape.stories.element.omit({storyBrief:true,matchReason:true}).extend({source:localSourceSchema,continuedFrom:z.array(localSourceSchema).min(1).max(16).optional()});
type Story=z.infer<typeof storySchema>;
// 主题核对独立于顺序阅读，允许正常长度的 50 篇候选一次提交。
const themeVerificationInputTokens=16000;
const pendingSchema=z.object({id:z.string().min(1).max(64),title:z.string().min(1).max(100),source:localSourceSchema});
const rejectionSchema=z.object({code:z.enum(['duplicate','no-new-evidence','invalid-source','no-progress','pending-resolution']),title:z.string().max(100).optional(),source:localSourceSchema.optional()});
const stateSchema=z.object({stories:z.array(storySchema).max(50000),cursor:z.number().int().min(0),readThrough:z.number().int().min(0),pendingEvents:z.array(pendingSchema).max(16),exhausted:z.boolean(),rejected:z.boolean(),lastRejection:rejectionSchema.optional(),overlapDiagnostics:z.array(z.object({source:localSourceSchema,other:localSourceSchema,ratio:z.number().min(0).max(1)})).max(32).optional()});
const stateEnvelope=stateSchema.extend({stories:z.array(z.unknown()).max(50000),pendingEvents:z.array(z.unknown()).max(16)});
type State=z.infer<typeof stateSchema>;
type Rejection=z.infer<typeof rejectionSchema>;
const failed=()=>new ReaderError(502,'本段选题未能完整核对，已保留进度，请重试或换个主题。');
const rejectionMessage=(reason:Rejection)=>({
 duplicate:'本次提取只返回了已保存的故事，已保留进度，请重试查找。',
 'no-new-evidence':'本次提取的交叉范围没有新的故事证据，已保留进度，请重试查找。',
 'invalid-source':'本次提取引用的原文范围无法核对，已保留进度，请重试查找。',
 'no-progress':'本次提取未给出新故事，也未确认本段已读完，已保留进度，请重试查找。',
 'pending-resolution':'本次跨章事件的收束记录与原文覆盖不一致，已保留进度，请重试查找。',
}[reason.code]);
function rejectedStory(code:Rejection['code'],raw:unknown):Rejection{
 const value=raw as {title?:unknown;source?:unknown},source=localSourceSchema.safeParse(value?.source);
 return {code,...(typeof value?.title==='string'?{title:value.title.slice(0,100)}:{}),...(source.success?{source:source.data}:{})};
}
export function discoveryNamespace(book:LocalBook,provider:string,model:string,limits=defaultReadingLimits,effort?:string){
 return discoveryHash(['story-library-v2',readingPlanKey(book,provider,limits),model,localReadingPrompt({...book.input,purpose:'catalog'}),localCatalogJson,...(effort?[effort]:[])]);
}
export const legacySummaryDiscoveryNamespace=previousSummaryNamespace;
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
  const event={id,title:update.title,source:previous?mergeSources(book,previous.source,update.source):update.source};
  qualified(books,book,event.source);
  result.set(id,event);
 }
 if(result.size>16)throw failed();
 return [...result.values()];
}
export async function discoverLocalStories(provider:ReaderProvider,books:LocalBooks,cache:StoryDiscoveryCache,book:LocalBook,selection:Selection,excluded:string[],observer?:ReadingObserver,excludedSources:LocalSourceReference[]=[],limits:ReadingLimits=defaultReadingLimits,storySearch?:LocalStorySearch):Promise<SuggestionBatch>{
 observer={signal:observer?.signal||new AbortController().signal,onProgress:observer?.onProgress||(()=>{}),...observer,cycleId:observer?.cycleId||randomUUID()};
 const batchLimit=observer.maxStories||4;
 const targetTitle=selection.discovery?.mode==='title'?selection.discovery.title:undefined;
 // Old tasks retain main-first behavior; new automatic searches discover independent events.
 const chapterStories=!!selection.discoverySources&&!selection.discovery;
 const status=await provider.status(),plan=await readingPlan(book,status.provider,cache,limits,!!selection.discoverySources&&(chapterStories||!!targetTitle),targetTitle);
 const scope=(selection.discoverySources?'/scope/'+discoveryHash(selection.discoverySources.map(localSourceKey))+(chapterStories?'/selected-chapters-v1/main-first/'+discoveryHash(localChapterStoriesPrompt):'/auto-v1'):'')+(targetTitle?'/title/'+discoveryHash([titleKey(targetTitle),localTitleStoriesPrompt]):'');
 const namespace=discoveryNamespace(book,status.provider,status.models.text,limits,status.taskReasoningEfforts?.suggest)+scope;
 const oldNamespace=previousDiscoveryNamespace(book,status.provider,status.models.text,limits,status.taskReasoningEfforts?.suggest)+scope;
 const legacyNamespace=legacySummaryDiscoveryNamespace(book,status.provider,status.models.text,limits,status.taskReasoningEfforts?.suggest)+scope;
 // A requested title fixes the event. Only automatic discovery needs a theme judgment.
 const theme=selection.theme.normalize('NFKC').trim(),key=namespace+'/library';
 const totalChars=plan.blocks.reduce((n,block)=>n+block.chars,0),excludedKeys=new Set(excludedSources.length?[]:excluded.map(titleKey));
 const validExclusions=excludedSources.filter(source=>{try{qualified(books,book,source);return true;}catch{return false;}});
 const sameRange=(a:LocalSourceReference,b:LocalSourceReference)=>sourceCovers(book,a,b)&&sourceCovers(book,b,a);
 const duplicate=(a:Story,b:Story)=>sameRange(a.source,b.source)||titleKey(a.title)===titleKey(b.title)&&sourcesOverlap(book,a.source,b.source);
 const crossing=(a:LocalSourceReference,b:LocalSourceReference)=>sourcesOverlap(book,a,b)&&!sourceCovers(book,a,b)&&!sourceCovers(book,b,a);
 const visibleStories=(stories:Story[])=>{
  const shown:Story[]=[],exclusions=validExclusions.map(source=>({source,known:stories.find(other=>sameRange(source,other.source))}));
  for(const story of stories){
   if(excludedKeys.has(titleKey(story.title))||exclusions.some(excluded=>sameRange(excluded.source,story.source)||excluded.known&&duplicate(story,excluded.known)))continue;
   if(shown.some(other=>duplicate(other,story)))continue;
   shown.push(story);
  }
  return shown;
 };
 const validFor=(state:Pick<State,'cursor'|'readThrough'|'exhausted'>,length:number)=>{
  if(state.cursor>length||state.readThrough>length||state.readThrough<state.cursor||state.readThrough>state.cursor+1||state.exhausted!==(state.cursor===length))return false;
  return true;
 };
 const validate=(state:Pick<State,'cursor'|'readThrough'|'exhausted'>)=>validFor(state,plan.blocks.length);
 const restore=(raw:z.infer<typeof stateEnvelope>):State=>{
  const stories:Story[]=[],pendingEvents:PendingEvent[]=[],ids=new Set<string>();
  for(const item of raw.stories)try{
   const story=storySchema.parse(item);qualified(books,book,story.source);
   for(const source of story.continuedFrom||[]){qualified(books,book,source);if(!sourceCovers(book,story.source,source))throw failed();}
   stories.push(story);
  }catch{/* Remove only the invalid record, retaining the proven reading frontier. */}
  for(const item of raw.pendingEvents)try{const event=pendingSchema.parse(item);qualified(books,book,event.source);if(!ids.has(event.id)){pendingEvents.push(event);ids.add(event.id);}}catch{/* Other unfinished events remain valid. */}
  return {...raw,stories,pendingEvents};
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
  const completed=current.stories.filter(story=>current.pendingEvents.some(event=>sourceCovers(book,story.source,event.source)));
  if(completed.length)context.push('已保存完整故事，可在重新确认对应旧事件及全部证据后通过resolvedEventIds收束，不重复输出故事：'+JSON.stringify(completed.map(story=>({title:story.title,source:story.source}))));
  const chapterStoryLevel=chapterStories?(relevant.length?'episodes':'main'):undefined;
  const input:WholeBookInput={title:book.title,edition:book.edition,text:block.text,purpose:'catalog',scan:{maxStories:targetTitle||chapterStoryLevel==='main'?1:maxStories,excludedSources:relevant.map(story=>story.source),pendingEvents:current.pendingEvents,contextText:context.join('\n\n'),...(chapterStoryLevel?{chapterStoryLevel}:{}),...(targetTitle?{targetStoryTitle:targetTitle}:{})}};
  return {input,titles:relevant.map(story=>story.title),visible};
 };
 let retrieval:SuggestionProgress['retrieval'],cachedMatches:number|undefined;
 const reportStage=(stage:'cache'|'retrieving')=>observer.onProgress({completed:0,total:1,completedChars:0,totalChars:0,stage,retrieval,cachedMatches});
 const recordRetrieval=(route:NonNullable<SuggestionProgress['retrieval']>)=>{retrieval=route;reportStage('retrieving');};
 const progress=(current:State,stage:'reading'|'checking'|'selecting'='reading',reading:ReadingObserver|undefined=observer,block:ReadingBlock|undefined=plan.blocks[current.cursor])=>reading?.onProgress({completed:current.cursor,total:plan.blocks.length,completedChars:plan.blocks.slice(0,current.cursor).reduce((n,block)=>n+block.chars,0),totalChars,stage,retrieval,cachedMatches,mode:plan.manifest.mode,currentChapters:block?.chapters||[]});
 const empty=():State=>({stories:[],cursor:0,readThrough:0,pendingEvents:[],exhausted:false,rejected:false});
 const saveScan=async(next:State)=>restore(await cache.update(key,stateEnvelope,empty,raw=>{
  const saved=validate(raw)?restore(raw):empty();
  return {...next,stories:[...next.stories,...saved.stories.filter(story=>!next.stories.some(item=>sameRange(item.source,story.source)))]};
 }));
 const read=async()=>{
  const raw=await cache.read(key,stateEnvelope,validate);if(!raw)return empty();
  const restored=restore(raw);
  if(JSON.stringify(raw)!==JSON.stringify(restored)){
   const repaired=await cache.update(key,stateEnvelope,()=>raw,value=>restore(value));
   return restore(repaired);
  }
  return restored;
 };
 // Migrate under the extraction lock; never let a late legacy read overwrite new progress.
 if(!await cache.read(key,stateEnvelope,validate))await cache.shared(key,observer,async()=>{
  if(await cache.read(key,stateEnvelope,validate))return;
  const manifest=await cache.read(previousReadingPlanKey(book,status.provider,limits)+'/blocks',manifestSchema,value=>{hydrateReadingPlan(book,value);return true;});
  const oldBlocks=manifest?hydrateReadingPlan(book,manifest):[];
  for(const oldKey of [oldNamespace,legacyNamespace]){
   const previous=await cache.read(oldKey+'/library',stateEnvelope,value=>!manifest||validFor(value,oldBlocks.length));if(!previous)continue;
   const completed=new Set(oldBlocks.slice(0,manifest?previous.cursor:0).flatMap(block=>[...block.visible]));
   let cursor=0;while(cursor<plan.blocks.length&&[...plan.blocks[cursor].visible].every(id=>completed.has(id)))cursor++;
   await cache.write(key,{...restore(previous),cursor,readThrough:cursor,exhausted:cursor===plan.blocks.length});break;
  }
 });
 const measurement=await discoveryMeasurement(cache,observer.cycleId!,!(await read()).stories.length);
 const existingCall=observer.onCall;observer.onCall=event=>{measurement.call(event);existingCall?.(event);};
 const response=async(state:State,stories:Story[],hit:boolean):Promise<SuggestionBatch>=>{
  const unknown=!targetTitle&&await hasUnknownJudgments(provider,cache,book.id,theme,state.stories,status.provider);
  await measurement.finish(stories.length?'matched':unknown?'incomplete':'none');
  const note=(targetTitle?(stories.length?'已核对指定故事的完整原文，主题保留为制作时的叙述重点。':state.exhausted?(state.stories.length?'指定故事已列出，请选择已找到的结果。':`未能在当前原文范围核对“${targetTitle}”的完整经过，请补选相关章节或核对标题；不会以局部故事替代。`):'正在按标题核对原文。'):hit?'已复用本地故事库及主题判断缓存。':chapterStories?'已按先总故事、后小故事的顺序收录，再匹配主题。':'已逐篇收录原文故事并匹配主题。')+(state.rejected?'部分返回出处未能完整核对，已保留当前进度，可继续重试。':'')+(!targetTitle&&!stories.length&&state.exhausted?(unknown?'原文已读完，但有未能判断的故事，主题检查尚不完整。':'已检查完所给原文，暂时没有更多符合主题的故事。'):'')+(!targetTitle&&state.exhausted&&state.pendingEvents.length?'部分跨章线索尚未确认完整，未作为故事推荐。':'');
  // Discovery returns ranges and a short match reason; preparation creates the synopsis after selection.
  return suggestionBatchSchema.parse({stories:stories.slice(0,batchLimit),note:note.slice(0,300)});
 };
 const extraction:Selection={bookId:selection.bookId,...(selection.bookId==='other'?{customBook:book.title}:{}),theme:'',artStyle:'ink-pencil',productionPrompt:'',length:'auto',voice:false};
 // 先核对主题候选池，展示上限只约束返回页，不限制模型审阅范围。
 const verifiedTheme=async(cached:Story[]):Promise<SuggestionBatch|undefined>=>{
  if(targetTitle||chapterStories||!provider.verifyThemeStories||!storySearch||storyEditorialContext(theme).mode==='source')return;
  const candidates=await storySearch.lookupHits(book,theme,observer.signal,false,50,recordRetrieval);
  const originals=new Map<string,string[]>();
  const stories=(candidates||[]).flatMap(({source,title})=>{
   try{
    const original=books.resolve(book,source);
    originals.set(localSourceKey(source),original.localParts?.map(part=>part.text)||[original.text]);
    return [{title:title.replace(/\s+/gu,' ').trim().slice(0,100)||original.title.slice(0,100),description:'',source,sourceLabel:original.title.slice(0,150)}];
   }catch(error){if(error instanceof ReaderError&&error.status===400)return [];throw error;}
  });
  if(!stories.length)return;
  const {matches,checked}=await verifyThemeCandidates(provider,cache,theme,stories,story=>originals.get(localSourceKey(story.source))!,Math.min(limits.whole,themeVerificationInputTokens),status,{...observer,onProgress:value=>observer.onProgress({...value,stage:'verifying',retrieval,cachedMatches})});
  const verified=matches.map(({story,decision})=>{
   const matchReason=(decision.verdict==='direct'?'明确符合：':'情节暗示：')+decision.reason;
   const description=(matchReason+' 原文：'+decision.evidence[0]).slice(0,180);
   return {...story,description,matchReason};
  });
  if(verified.length){
   // 索引只证明这些故事与主题相符，不推进全书阅读游标。
   await cache.update(key,stateEnvelope,empty,async raw=>{
    const current=validate(raw)?restore(raw):empty();
    const judgments=verified.map(({matchReason,...story})=>{
     const existing=current.stories.find(item=>sameRange(item.source,story.source));
     if(!existing)current.stories.push(story);
     const saved=existing||story;
     return {story:saved,reason:matchReason,text:books.resolve(book,saved.source).text};
    });
    await saveVerifiedThemeMatches(cache,book.id,theme,status,judgments);
    return current;
   });
   await measurement.stored();
  }
  const page=visibleStories([...cached,...verified]).slice(0,batchLimit);
  await measurement.finish(checked<stories.length?'incomplete':page.length?'matched':'none');
  const note=`已核对 ${checked}/${stories.length} 条索引候选。`+(checked<stories.length?'部分候选未能核对，可继续重试。':'')+(page.length?'':checked<stories.length?'目前还没有确认的新结果。':'当前没有更多符合主题的候选。');
  return suggestionBatchSchema.parse({stories:page,note});
 };
 // 指定标题和不具备逐条核对能力的服务沿用候选阅读。

 const fromCandidates=async(current:State,cached:Story[]):Promise<SuggestionBatch|undefined>=>{
  const query=targetTitle||theme;
  if(!query||chapterStories||!storySearch||!targetTitle&&(provider.verifyThemeStories||storyEditorialContext(theme).mode==='source'))return;
  const ranges=(await storySearch.lookupHits(book,query,observer.signal,!!targetTitle,42,recordRetrieval))?.map(hit=>hit.source)||[];
  if(!ranges.length)return;
  const exclusions=[...validExclusions,...current.stories.filter(story=>excludedKeys.has(titleKey(story.title))).map(story=>story.source)];
  const inputFor=(text:string,cap:number):WholeBookInput=>({title:book.title,edition:book.edition,text,
   purpose:targetTitle?'catalog':'scan',scan:{maxStories:cap,excludedSources:[],pendingEvents:[],contextText:'',...(targetTitle?{targetStoryTitle:targetTitle}:{})}});
  const budget=Math.min(limits.whole,limits.chapter);
  let groups:{source:LocalSourceReference;text:string}[]=[];
  const batches:(typeof groups)[]=[];
  for(const source of ranges){
   if(exclusions.some(excluded=>sameRange(source,excluded)))continue;
   const text=sourceParts(book,source).map(({section,units})=>`篇章 ${section.id}：${section.title}\n`+units.map(unit=>`[${unit.id}]\n${unit.text}`).join('\n\n')).join('\n\n');
   if(requestTokens(inputFor(text,batchLimit),theme,excluded,status.provider)>budget)continue;
   if(groups.length===14||groups.length&&requestTokens(inputFor([...groups.map(group=>group.text),text].join('\n\n'),batchLimit),theme,excluded,status.provider)>budget){
    batches.push(groups);groups=[];
    if(batches.length===3)break;
   }
   groups.push({source,text});
  }
  if(groups.length)batches.push(groups);
  for(const batch of batches){
   observer.signal.throwIfAborted();
   progress(current,'reading');
   const input=inputFor(batch.map(group=>group.text).join('\n\n'),targetTitle?1:batchLimit);
   // 精确排除已显示的范围，同时保留同章节的其他故事。
   input.scan!.excludedSources=exclusions.filter(source=>batch.some(group=>sourceCovers(book,group.source,source)));
   if(requestTokens(input,theme,excluded,status.provider)>budget)continue;
   const cacheKey='candidate-reading-v1/'+discoveryHash([namespace,targetTitle?'title':theme,localReadingPrompt(input),input,excluded]);
   const validateStories=(rows:unknown[])=>{
    const accepted:Story[]=[];
    for(const raw of rows){
     try{
      const story=storySchema.omit({continuedFrom:true}).parse(raw);
      if(!batch.some(group=>sourceCovers(book,group.source,story.source)))continue;
      qualified(books,book,story.source);
      if(exclusions.some(source=>sameRange(source,story.source))||accepted.some(other=>duplicate(other,story)))continue;
      accepted.push({...story,sourceLabel:books.resolve(book,story.source).title.slice(0,150)});
     }catch{/* 候选出处无法核对时，继续核对其他结果。 */}
    }
    return visibleStories(accepted);
   };
   let stories:Story[]|null;
   try{stories=await cache.shared(cacheKey,observer,async reading=>{
    const cached=validateStories(await cache.read(cacheKey,z.array(storySchema).max(input.scan!.maxStories))||[]);
    if(cached.length)return cached;
    const result=await provider.suggestions(targetTitle?extraction:selection,excluded,input,{...reading,maxStories:undefined});
    progress(current,'checking',reading);
    if(!result.scan||result.scan.invalid||result.scan.resolvedEventIds.length||result.stories.length>input.scan!.maxStories)return [];
    // 标题有未完线索时交回连续阅读，以免下一批把另一段片段当成完整事件。
    if(targetTitle&&result.scan.pendingEvents.length)return null;
    const verified=validateStories(result.stories).filter(story=>!result.scan!.pendingEvents.some(event=>{
     try{return sourcesOverlap(book,event.source,story.source);}catch{return true;}
    }));
    if(verified.length)await cache.write(cacheKey,verified);
    return verified;
   });}catch(error){observer.signal.throwIfAborted();if(discoveryCode(error)==='service')throw error;continue;}
   if(stories===null)return;
   if(stories.length){
    await measurement.finish('matched');
    return suggestionBatchSchema.parse({stories:visibleStories([...cached,...stories]).slice(0,batchLimit),note:'已从检索候选中提取故事并核对原文出处。'});
   }
  }
 };
 let hit=true;
 try{
 reportStage('cache');
 const initial=await read();
 const matchingOptions={bookId:book.id,legacyNamespaces:[oldNamespace],context:observer};
 const original=(story:Story)=>books.resolve(book,story.source).text;
 const initialStories=visibleStories(initial.stories);
 const titleMatches=(stories:Story[])=>stories.map(story=>({...story,matchReason:'已依据所选原文核对指定故事，主题仅用于讲述重点。'}));
 const cached=targetTitle?titleMatches(initialStories):await matchLibraryStories(provider,cache,namespace,theme,initialStories,original,limits.whole,status.provider,observer,{...matchingOptions,cacheOnly:true});
 cachedMatches=cached.length;
 reportStage('cache');
 if(cached.length>=batchLimit||targetTitle&&cached.length)return response(initial,cached,true);
 reportStage('retrieving');
 const verified=await verifiedTheme(cached);
 if(verified)return verified;
 const indexed=await fromCandidates(initial,cached);
 if(indexed)return indexed;
 retrieval??='scan';
 // 索引缺失或当前范围没有可用候选时，从已保存的原文阅读进度继续。
 while(true){
  observer?.signal.throwIfAborted();
  const saved=await read(),candidates=visibleStories(saved.stories);
  if(candidates.length)progress(saved,'selecting');
  const matched=targetTitle?titleMatches(candidates):await matchLibraryStories(provider,cache,namespace,theme,candidates,original,limits.whole,status.provider,observer,{...matchingOptions,retryUnknown:saved.exhausted});
  if(matched.length)return response(saved,matched,hit);
  if(saved.exhausted)return response(saved,matched,hit);
  const baseline=saved.stories.length;
  await cache.shared(key,observer,async reading=>{
   let current=await read();progress(current,'reading',reading);
   // A simultaneous theme may already have extended the shared library while matching ran.
   while(current.stories.length<=baseline&&!current.exhausted){
    reading.signal.throwIfAborted();
    const {input,titles,visible}=scanRequest(current,current.cursor,current.stories.length?catalogStoryLimit:1);
    if(requestTokens(input,'',titles,status.provider)>limits.whole)throw new ReaderError(502,'跨章原文或已入库记录超过本次输入预算，故事库和进度已保留，请缩小章节范围。');
    const result=await provider.suggestions(extraction,titles,input,{...reading,maxStories:undefined});
    progress(current,'checking',reading);
    if(result.stories.length>input.scan!.maxStories)throw failed();
    if(!result.scan||!Array.isArray(result.scan.pendingEvents)||!Array.isArray(result.scan.resolvedEventIds))throw failed();
    const overlapDiagnostics:NonNullable<State['overlapDiagnostics']>=[],accepted:Story[]=[],rejections:Rejection[]=result.scan.invalidStories?[{code:'invalid-source'}]:[],initialCovered=new Set(current.stories.flatMap(story=>sourceUnitIds(book,story.source))),covered=new Set(initialCovered);
    for(const raw of result.stories){
     try{
      const parsed=storySchema.omit({continuedFrom:true}).parse(raw);qualified(books,book,parsed.source,visible);
      const continuedFrom=current.pendingEvents.filter(event=>result.scan!.resolvedEventIds.includes(event.id)&&sourceCovers(book,parsed.source,event.source)).map(event=>event.source);
      const story:Story={...parsed,...(continuedFrom.length?{continuedFrom}:{})},known=[...current.stories,...accepted];
      if(known.some(other=>duplicate(other,story))){rejections.push(rejectedStory('duplicate',raw));continue;}
      const storyUnits=sourceUnitIds(book,story.source);
      for(const other of known){if(!crossing(other.source,story.source))continue;const otherUnits=sourceUnitIds(book,other.source),set=new Set(otherUnits),ratio=storyUnits.filter(id=>set.has(id)).length/Math.min(storyUnits.length,otherUnits.length);if(ratio>.8&&overlapDiagnostics.length<32)overlapDiagnostics.push({source:story.source,other:other.source,ratio});}
      const units=storyUnits,fresh=units.some(id=>!covered.has(id)),nested=known.some(other=>sourceCovers(book,other.source,story.source));
      if(known.some(other=>crossing(other.source,story.source))&&!fresh&&!nested&&!continuedFrom.length){rejections.push(rejectedStory('no-new-evidence',raw));continue;}
      accepted.push({...story,sourceLabel:books.resolve(book,story.source).title.slice(0,150)});for(const id of units)covered.add(id);
     }catch{rejections.push(rejectedStory('invalid-source',raw));}
    }
    let pending:PendingEvent[];
    try{if(result.scan.invalid)throw failed();pending=mergePending(books,book,current.pendingEvents,result.scan.pendingEvents,result.scan.resolvedEventIds,[...current.stories,...accepted],visible);if(targetTitle&&accepted.length&&pending.length)throw failed();}
    catch{
     const independent=targetTitle?[]:accepted.filter(story=>!story.continuedFrom?.length||sourceUnitIds(book,story.source).some(id=>!initialCovered.has(id)));
     const lastRejection={code:'pending-resolution' as const};
     await saveScan({...current,stories:[...current.stories,...independent.map(({continuedFrom,...story})=>{void continuedFrom;return story;})],lastRejection});
     if(independent.length){await measurement.stored();break;}
     throw new ReaderError(502,rejectionMessage(lastRejection));
    }
    const rejected=!!rejections.length,lastRejection=rejections[0]||(!accepted.length&&!result.scan.blockComplete?{code:'no-progress' as const}:undefined);
    const next:State={...current,stories:[...current.stories,...accepted],pendingEvents:pending,rejected,lastRejection,overlapDiagnostics};
    // A full response is not proof that all stories in this block have been catalogued.
    if(rejections.every(reason=>reason.code==='duplicate')&&result.stories.length<input.scan!.maxStories&&result.scan.blockComplete)next.cursor++;
    if(targetTitle&&accepted.length&&!pending.length)next.cursor=plan.blocks.length;
    next.readThrough=next.cursor;next.exhausted=next.cursor===plan.blocks.length;
    const advanced=next.cursor>current.cursor||pending.length<current.pendingEvents.length;
    current=await saveScan(next);if(accepted.length)await measurement.stored();progress(current,'reading',reading);
    if(reading.signal.aborted)break;
    if(!accepted.length&&lastRejection&&!advanced)throw new ReaderError(502,rejectionMessage(lastRejection));
   }
  });
  hit=false;
 }
 }catch(error){await measurement.finish(observer.signal.aborted?'cancelled':'failed');throw error;}
}
