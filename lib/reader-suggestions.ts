// Validate suggestion batches and keep verified local receipts through browser history.
import {z} from 'zod';
import {selectionSchema} from './reader-model.ts';
import {localSourceSchema,localSourceKey} from './reader-local-contract.ts';
import type {LocalSourceReference} from './reader-local-contract.ts';
import {artRecommendationSchema} from './reader-art-recommendation.ts';

export const suggestionRequestSchema=selectionSchema.extend({excludeTitles:z.array(z.string().min(1).max(100)).max(200).default([]),excludeSources:z.array(localSourceSchema).max(200).default([])});
export const suggestionBatchSchema=z.object({stories:z.array(z.object({title:z.string().min(1).max(100),description:z.string().min(1).max(180),source:localSourceSchema.optional(),sourceLabel:z.string().max(150).optional(),artRecommendation:artRecommendationSchema.optional()})).max(5),note:z.string().max(300)});
export type SuggestionBatch=z.infer<typeof suggestionBatchSchema>;
export const suggestionProgressSchema=z.object({completed:z.number().int().min(0),total:z.number().int().min(1),completedChars:z.number().int().min(0),totalChars:z.number().int().min(0),stage:z.enum(['reading','selecting']),mode:z.enum(['whole','chapters']).optional()}).refine(p=>p.completed<=p.total&&p.completedChars<=p.totalChars);
export type SuggestionProgress=z.infer<typeof suggestionProgressSchema>;
export function suggestionReadingPercent(progress:SuggestionProgress){return progress.totalChars?Math.floor(progress.completedChars/progress.totalChars*100):null;}
export const maxSuggestionBatches=40;
export function suggestionKey(bookId:string,customBook:string|undefined,theme:string){return JSON.stringify([bookId,bookId==='other'?(customBook||'').trim():'',theme.trim()]);}
export function titleKey(title:string){return title.normalize('NFKC').replace(/[\s《》〈〉「」『』·・:：，,。.!！?？]/g,'').toLowerCase();}
export function freshSuggestions(batch:SuggestionBatch,excluded:string[],excludedSources:LocalSourceReference[]=[]):SuggestionBatch{
 const seen=new Set(excludedSources.length?[]:excluded.map(titleKey)),sources=new Set(excludedSources.map(localSourceKey));
 const stories=batch.stories.filter(story=>{const key=titleKey(story.title),source=story.source?localSourceKey(story.source):'';if(seen.has(key)||source&&sources.has(source))return false;if(source)sources.add(source);else seen.add(key);return true;});
 const note=batch.note||(stories.length===0?'暂时没有更多可确认的故事，可以回看前面的批次，或换个主题。':stories.length<5?'本批可确认的新故事不足 5 篇，先列出这些。':'');
 return {stories,note};
}
