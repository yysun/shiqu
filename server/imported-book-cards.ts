// 按相邻章节窗口生成可续跑的本地故事卡。
import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type {ReaderProvider,StoryReading} from '../lib/reader-provider.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {localCardsJson,localReadingPrompt} from '../lib/reader-local-contract.ts';
import type {LocalSourceReference} from '../lib/reader-local-contract.ts';
import {localSourceSchema} from '../lib/reader-local-contract.ts';
import type {SuggestionBatch} from '../lib/reader-suggestions.ts';
import {titleKey} from '../lib/reader-suggestions.ts';
import {localSourceKey} from '../lib/reader-local-contract.ts';
import {LocalBooks,localBookId} from './local-books.ts';
import {indexBookContents,selectedChapterScope} from './local-book-contents.ts';
import {sourceParts,sourcesOverlap} from './local-source-ranges.ts';
import {StoryDiscoveryCache,discoveryHash} from './story-discovery-cache.ts';
import {readingPlan,defaultReadingLimits} from './story-reading-inputs.ts';
import {requestTokens} from './story-token-budget.ts';
import {storyCardsSchema} from './local-story-search.ts';

const chapterProgressSchema=z.object({sectionId:z.string(),title:z.string(),status:z.enum(['pending','running','done','failed']),attempts:z.number().int().nonnegative(),completedWindows:z.number().int().nonnegative(),totalWindows:z.number().int().nonnegative(),cacheKeys:z.array(z.string()).default([]),failure:z.string().optional()});
export const importedCardProgressSchema=z.object({version:z.literal(1),bookId:z.string(),edition:z.string(),status:z.enum(['pending','running','paused','complete','failed']),provider:z.string().optional(),model:z.string().optional(),updatedAt:z.string().datetime(),chapters:z.array(chapterProgressSchema),calls:z.number().int().nonnegative(),inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),unknownUsage:z.number().int().nonnegative(),durations:z.array(z.number().nonnegative()).max(100)}).strict();
export type ImportedCardProgress=z.infer<typeof importedCardProgressSchema>;
type CardWindow={key:string;input:{title:string;edition:string;text:string;purpose:'cards'};book:Exclude<Awaited<ReturnType<LocalBooks['book']>>,null>;sourceIds:Set<string>;tokens:number};
type CardEvent={type:'progress'|'call'|'complete'|'error';progress?:ImportedCardProgress;call?:{durationMs:number;inputTokens:number|null;outputTokens:number|null};result?:unknown;error?:string};
type Active={bookId:string;controller:AbortController;promise:Promise<ImportedCardProgress>};
type CardCandidate={title:string;summary:string;source:LocalSourceReference};
type StoredCard=z.infer<typeof storyCardsSchema>['cards'][number];
const promptVersion='local-cards-v1';

async function atomic(file:string,value:unknown){
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp',handle=await open(temp,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 try{await rename(temp,file);}finally{await rm(temp,{force:true});}
}
function median(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:20000;}
function progressPath(books:LocalBooks,id:string){return path.join(books.imported.booksDirectory,id,'card-progress.json');}
function cardsPath(books:LocalBooks,id:string){return path.join(books.imported.booksDirectory,id,'cards.json');}
function titleOverlap(book:Exclude<Awaited<ReturnType<LocalBooks['book']>>,null>,left:CardCandidate,right:CardCandidate){
 return !!left.source&&!!right.source&&titleKey(left.title)===titleKey(right.title)&&sourcesOverlap(book,left.source,right.source);
}

export class ImportedBookCards{
 private readonly books:LocalBooks;private readonly provider:ReaderProvider;private readonly cache:StoryDiscoveryCache;private active?:Active;private readonly mutating=new Set<string>();
 constructor(books:LocalBooks,provider:ReaderProvider,cache:StoryDiscoveryCache){this.books=books;this.provider=provider;this.cache=cache;}
 async get(bookId:string){
  const manifest=await this.books.imported.manifestFor(bookId);let value:ImportedCardProgress|null=null;
  try{value=importedCardProgressSchema.parse(JSON.parse(await readFile(progressPath(this.books,bookId),'utf8')));}catch{}
  if(!value||value.edition!==manifest.edition){const book=await this.books.book(selectionSchema.parse({bookId,theme:'原典故事'}));return this.initial(bookId,manifest.edition,book?indexBookContents(this.books,book,'',true).entries.map(entry=>({sectionId:entry.source!.sectionId,title:entry.chapter,status:'pending' as const,attempts:0,completedWindows:0,totalWindows:0,cacheKeys:[]})):[]);}
  if(value.status==='running'&&this.active?.bookId!==bookId){value={...value,status:'paused',updatedAt:new Date().toISOString()};await atomic(progressPath(this.books,bookId),value);}
  return value;
 }
 private initial(bookId:string,edition:string,chapters:ImportedCardProgress['chapters']):ImportedCardProgress{return {version:1,bookId,edition,status:'pending',updatedAt:new Date().toISOString(),chapters,calls:0,inputTokens:0,outputTokens:0,unknownUsage:0,durations:[]};}
 private async save(bookId:string,value:ImportedCardProgress){
  const current=await this.books.imported.manifestFor(bookId);if(current.status!=='ready'||current.edition!==value.edition)throw new Error('导入书版次已变化，拒绝写入旧版故事卡进度。');
  const parsed=importedCardProgressSchema.parse({...value,updatedAt:new Date().toISOString()});await atomic(progressPath(this.books,bookId),parsed);return parsed;
 }
 private async windows(bookId:string,provider:string,model:string){
  const book=await this.books.book(selectionSchema.parse({bookId,theme:'原典故事'}));if(!book)throw new Error('导入书不可用。');
  const chapters=indexBookContents(this.books,book,'',true).entries;if(!chapters.length)throw new Error('导入书没有可用章节。');
  const result:{chapterId:string;title:string;windows:CardWindow[]}[]=[];
  for(let index=0;index<chapters.length;index++){
   const selected=[chapters[index],chapters[index+1]].filter(Boolean),refs=selected.map(entry=>entry.source!).filter(Boolean),scope=await selectedChapterScope(this.books,book,refs),windowBook=scope.book;
   const plan=await readingPlan(windowBook,provider,this.cache,defaultReadingLimits,true,undefined,'cards');
   let groups:number[][]=[];if(plan.blocks.length===1)groups=[[0]];else {
    for(let block=0;block+1<plan.blocks.length;block++)groups.push([block,block+1]);
    if(!groups.length)groups=plan.blocks.map((_,block)=>[block]);
    else if(plan.blocks.length%2===1)groups.push([plan.blocks.length-1]);
   }
   const windows:CardWindow[]=[];
   for(const group of groups){
    const texts=group.map(block=>plan.blocks[block].text),text=texts.join('\n\n'),input={...windowBook.input,text,purpose:'cards' as const},tokens=requestTokens(input,'原典故事',[],provider,5);
    if(tokens>defaultReadingLimits.whole)throw new Error(`章节「${chapters[index].chapter}」超过故事卡请求预算。`);
    const visible=new Set(group.flatMap(block=>[...plan.blocks[block].visible])),sourceIds=new Set(visible),provenance=refs.map(localSourceKey);
    const key=discoveryHash(['imported-cards-v1',bookId,book.edition,provider,model,promptVersion,localReadingPrompt(input),localCardsJson,provenance,group,discoveryHash(text)]);
    windows.push({key,input,book:windowBook,sourceIds,tokens});
   }
   result.push({chapterId:chapters[index].source!.sectionId,title:chapters[index].chapter,windows});
  }
  return {book,chapters:result};
 }
 async estimate(bookId:string){
  const status=await this.provider.status();if(!status.configured)throw new Error(status.message||'请先配置生成服务。');
  const {chapters}=await this.windows(bookId,status.provider,status.models.text),progress=await this.get(bookId),pending=chapters.filter(chapter=>progress.chapters.find(item=>item.sectionId===chapter.chapterId)?.status!=='done'),all=pending.flatMap(chapter=>chapter.windows),cached=await Promise.all(all.map(window=>this.cache.read(window.key,z.unknown()).then(value=>value!==null))),calls=cached.filter(value=>!value).length,durations=progress.durations;
  return {bookId,chapters:chapters.length,windows:all.length,cached:cached.filter(Boolean).length,calls,inputTokens:all.reduce((sum,window,index)=>sum+(cached[index]?0:window.tokens),0),estimatedMs:calls*median(durations),tokenizer:'o200k_base',estimated:true,provider:status.provider,model:status.models.text,progress};
 }
 async withBookMutation<T>(bookId:string,operation:()=>Promise<T>):Promise<T>{
  if(this.mutating.has(bookId))throw new Error('这本书正在执行删除或替换。');this.mutating.add(bookId);
  try{await this.cancel(bookId);return await operation();}finally{this.mutating.delete(bookId);}
 }
 async run(bookId:string,retryFailed:boolean,onEvent:(event:CardEvent)=>void=()=>{}){
  if(this.mutating.has(bookId))throw new Error('这本书正在执行删除或替换。');
  if(this.active)throw new Error(this.active.bookId===bookId?'故事卡任务正在运行。':'书库中已有另一本书的故事卡任务正在运行。');
  const controller=new AbortController();let resolvePromise!:(value:ImportedCardProgress)=>void,rejectPromise!:(reason?:unknown)=>void;
  const promise=new Promise<ImportedCardProgress>((resolve,reject)=>{resolvePromise=resolve;rejectPromise=reject;}),active={bookId,controller,promise};this.active=active;
  void this.runReserved(bookId,retryFailed,onEvent,controller).then(resolvePromise,rejectPromise).finally(()=>{if(this.active===active)this.active=undefined;});
  return promise;
 }
 private async runReserved(bookId:string,retryFailed:boolean,onEvent:(event:CardEvent)=>void,controller:AbortController){
  controller.signal.throwIfAborted();const status=await this.provider.status();controller.signal.throwIfAborted();if(!status.configured)throw new Error(status.message||'请先配置生成服务。');
  const prepared=await this.windows(bookId,status.provider,status.models.text);controller.signal.throwIfAborted();const manifest=await this.books.imported.manifestFor(bookId);controller.signal.throwIfAborted();const stored=await this.get(bookId);controller.signal.throwIfAborted();
  if(manifest.edition!==prepared.book.edition)throw new Error('导入书版次已变化，请重试。');
  const byId=new Map(stored.chapters.map(chapter=>[chapter.sectionId,chapter]));
  let progress=this.initial(bookId,manifest.edition,prepared.chapters.map(chapter=>{
   const old=byId.get(chapter.chapterId);return old&&old.status!=='running'?{...old,title:chapter.title,totalWindows:chapter.windows.length}:{sectionId:chapter.chapterId,title:chapter.title,status:'pending' as const,attempts:0,completedWindows:0,totalWindows:chapter.windows.length,cacheKeys:[]};
  }));
  progress={...progress,...stored,bookId,edition:manifest.edition,provider:status.provider,model:status.models.text,status:'running',chapters:progress.chapters};
  const publish=async()=>{progress=await this.save(bookId,progress);onEvent({type:'progress',progress});};
  const promise=(async()=>{
   await publish();
   for(const chapter of prepared.chapters){
    if(controller.signal.aborted){progress={...progress,status:'paused'};await publish();return progress;}let entry=progress.chapters.find(item=>item.sectionId===chapter.chapterId)!;
    if(entry.status==='done'||entry.status==='failed'&&!retryFailed)continue;
    entry={...entry,status:'running',attempts:entry.attempts+1,completedWindows:0,totalWindows:chapter.windows.length};progress={...progress,chapters:progress.chapters.map(item=>item.sectionId===entry.sectionId?entry:item)};await publish();
    try{
     const batchCards:{title:string;summary:string;source:NonNullable<SuggestionBatch['stories'][number]['source']>;aliases?:string[]}[]=[];
     for(const [windowIndex,window] of chapter.windows.entries()){
      controller.signal.throwIfAborted();await this.books.imported.registerCardCacheKey(bookId,window.key);controller.signal.throwIfAborted();entry={...entry,cacheKeys:[...new Set([...entry.cacheKeys,window.key])]};progress={...progress,chapters:progress.chapters.map(item=>item.sectionId===entry.sectionId?entry:item)};await publish();
      const reading:StoryReading={signal:controller.signal,onProgress:()=>{},drain:true,maxStories:5,onCall:event=>{progress={...progress,calls:progress.calls+1,inputTokens:progress.inputTokens+(event.inputTokens||0),outputTokens:progress.outputTokens+(event.outputTokens||0),unknownUsage:progress.unknownUsage+Number(event.inputTokens===null||event.outputTokens===null),durations:[...progress.durations,event.durationMs].slice(-100)};onEvent({type:'call',call:{durationMs:event.durationMs,inputTokens:event.inputTokens,outputTokens:event.outputTokens}});}};
      const selection=selectionSchema.parse({bookId,customBook:prepared.book.title,theme:'原典故事',discovery:{mode:'auto'}});
      let wroteCache=false;let batch:SuggestionBatch;
      try{batch=await this.cache.shared(window.key,reading,async observer=>{
       const cached=await this.cache.read(window.key,z.unknown());if(cached)return cached as SuggestionBatch;
       const result=await this.provider.suggestions(selection,[],window.input,observer);
       observer.signal.throwIfAborted();const current=await this.books.imported.manifestFor(bookId);if(current.edition!==manifest.edition)throw new Error('导入书版次已变化，拒绝保存故事卡。');
       const validated=await this.validateBatch(window,result,bookId);observer.signal.throwIfAborted();
       if(validated.stories.length){await this.cache.write(window.key,validated);wroteCache=true;observer.signal.throwIfAborted();}return validated;
      });}catch(error){if(controller.signal.aborted&&wroteCache)await this.cache.remove(window.key);throw error;}
      const validated=await this.validateBatch(window,batch,bookId);
      for(const card of validated.stories){const candidate={title:card.title,summary:card.description,source:card.source!};if(batchCards.some(existing=>titleOverlap(window.book,existing,candidate)))continue;batchCards.push(candidate);}
      entry={...entry,completedWindows:windowIndex+1};progress={...progress,chapters:progress.chapters.map(item=>item.sectionId===entry.sectionId?entry:item)};await publish();
     }
     controller.signal.throwIfAborted();const current=await this.books.imported.manifestFor(bookId);if(current.edition!==manifest.edition)throw new Error('导入书版次已变化，拒绝保存故事卡。');
     const prior=await this.books.imported.readCards(bookId),existing=prior?storyCardsSchema.safeParse(prior.value):null,cards=existing?.success&&existing.data.edition===manifest.edition?existing.data.cards:[],merged:StoredCard[]=[...cards];
     for(const card of batchCards){const candidate={title:card.title,summary:card.summary,source:card.source};const dup=merged.some(existingCard=>titleOverlap(prepared.book,{title:existingCard.title,summary:existingCard.summary,source:{...existingCard.source,edition:prepared.book.edition}},candidate));if(!dup)merged.push({id:discoveryHash([titleKey(card.title),card.source]),title:card.title,summary:card.summary,source:card.source});}
     if(merged.length){await atomic(cardsPath(this.books,bookId),storyCardsSchema.parse({version:1,bookId,edition:manifest.edition,cards:merged}));this.books.storySearch?.clearBook(bookId);}
     entry={...entry,status:'done',failure:undefined};progress={...progress,chapters:progress.chapters.map(item=>item.sectionId===entry.sectionId?entry:item)};await publish();
    }catch(error){
     if(controller.signal.aborted){progress={...progress,status:'paused'};await publish();return progress;}
     entry={...entry,status:'failed',failure:error instanceof Error?error.message:'故事卡生成失败。'};progress={...progress,chapters:progress.chapters.map(item=>item.sectionId===entry.sectionId?entry:item)};await publish();
    }
   }
   progress={...progress,status:progress.chapters.some(chapter=>chapter.status==='failed')?'failed':'complete'};await publish();return progress;
  })();return promise;
 }
 private async validateBatch(window:CardWindow,batch:unknown,bookId:string){
  const parsed=await this.books.imported.manifestFor(bookId),book=window.book;if(parsed.edition!==book.edition)throw new Error('导入书版次已变化，拒绝保存故事卡。');
  const value=z.object({stories:z.array(z.object({title:z.string().trim().min(1).max(100),description:z.string().trim().min(1).max(180),source:z.unknown()})).max(5),note:z.string().max(300)}).parse(batch);
  const stories=[];
  for(const story of value.stories){
   const source=localSourceSchema.safeParse(story.source);if(!source.success||source.data.edition!==book.edition)continue;
   try{const parts=sourceParts(book,source.data),ids=parts.flatMap(part=>part.units.map(unit=>unit.id));if(!ids.length||ids.some(id=>!window.sourceIds.has(id)))continue;const original=this.books.resolve(book,source.data);stories.push({title:story.title,description:story.description,source:source.data,original});}catch{/* 跳过不能由窗口原文定位的卡片。 */}
  }
  return {stories:stories.map(({title,description,source})=>({title,description,source})),note:value.note};
 }
 async cancel(bookId?:string){const active=this.active;if(!active||bookId&&active.bookId!==bookId)return {cancelled:false};active.controller.abort(new Error('用户取消故事卡生成。'));await active.promise.catch(()=>{});return {cancelled:true};}
}
