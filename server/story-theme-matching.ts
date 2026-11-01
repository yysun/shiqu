// Cache each theme verdict separately from extraction, keyed by the cited story's content.
// Each shared flight makes one paid call, saving its receipt before cancellation or another review.
import {z} from 'zod';
import {ReaderError} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {localSourceKey} from '../lib/reader-local-contract.ts';
import type {LocalSourceReference} from '../lib/reader-local-contract.ts';
import {themeMatchPrompt,themeMatchJson,themeMatchPayload,themeMatchesSchema} from '../lib/reader-theme-match.ts';
import type {ThemeStory} from '../lib/reader-theme-match.ts';
import {StoryDiscoveryCache,discoveryHash} from './story-discovery-cache.ts';
import type {ReadingObserver} from './story-discovery-cache.ts';
import {readingTokens} from './story-token-budget.ts';

type Story={title:string;summary:string;source:LocalSourceReference};
const verdictSchema=z.enum(['yes','no','review']);
const savedSchema=z.object({decisions:z.record(z.string().regex(/^[a-f0-9]{64}$/),verdictSchema)});
type Saved=z.infer<typeof savedSchema>;
export const themeStoryId=(story:Story)=>discoveryHash([story.title,story.summary,localSourceKey(story.source)]);
export const themeDecisionKey=(namespace:string,theme:string)=>namespace+'/themes/'+discoveryHash([theme.normalize('NFKC').trim(),themeMatchPrompt,themeMatchJson]);

export async function matchLibraryStories<T extends Story>(provider:ReaderProvider,cache:StoryDiscoveryCache,namespace:string,theme:string,stories:T[],original:(story:T)=>string,budget:number,providerName:string,observer?:ReadingObserver):Promise<T[]>{
 if(!stories.length)return [];
 if(!provider.matchStories)throw new ReaderError(503,'当前生成服务暂不支持故事主题匹配，请更新服务后重试。');
 const key=themeDecisionKey(namespace,theme),entries=stories.map(story=>({story,id:themeStoryId(story)}));
 const read=async()=>await cache.read(key,savedSchema,value=>Object.keys(value.decisions).length<=50000)||{decisions:{}};
 while(true){
  observer?.signal.throwIfAborted();
  const saved=await read(),matched=entries.filter(entry=>saved.decisions[entry.id]==='yes').map(entry=>entry.story);
  if(matched.length)return matched;
  if(entries.every(entry=>saved.decisions[entry.id]==='no'))return [];
  await cache.shared(key,observer,async reading=>{
   // Another caller may have settled these stories while this caller joined its flight.
   const current:Saved=await read();
   if(entries.some(entry=>current.decisions[entry.id]==='yes'))return;
   const review=entries.find(entry=>current.decisions[entry.id]==='review');
   const batch=review?[review]:entries.filter(entry=>!current.decisions[entry.id]).slice(0,16);
   if(!batch.length)return;
   reading.signal.throwIfAborted();
   const input:ThemeStory[]=batch.map(({story,id})=>({id,title:story.title,summary:story.summary,...(review?{text:original(story)}:{})}));
   const payload=themeMatchPayload(theme,input);
   const tokens=readingTokens(themeMatchPrompt,providerName)+readingTokens(JSON.stringify(payload),providerName)+readingTokens(JSON.stringify(themeMatchJson),providerName);
   if(tokens>budget)throw new ReaderError(502,'主题核对输入超过本次预算，故事库已保留，请缩小章节范围后重试。');
   const result=themeMatchesSchema.parse(await provider.matchStories!(theme,input)),requested=new Set(batch.map(entry=>entry.id));
   if(result.matches.length!==requested.size||new Set(result.matches.map(match=>match.id)).size!==requested.size||result.matches.some(match=>!requested.has(match.id)))throw new ReaderError(502,'主题判断未能逐篇核对，故事库已保留，请重试。');
   for(const match of result.matches)current.decisions[match.id]=match.verdict;
   await cache.write(key,current);
   // Even a cancelled caller's completed receipt is saved; it never starts a second call here.
   if(review&&result.matches[0].verdict==='review')throw new ReaderError(502,'核对原文后仍无法确认主题，故事库和已完成判断已保留，请重试。');
  });
 }
}
