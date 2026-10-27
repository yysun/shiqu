import {z} from 'zod';
import {selectionSchema} from './reader-model.ts';

export const suggestionRequestSchema=selectionSchema.extend({excludeTitles:z.array(z.string().min(1).max(100)).max(200).default([])});
export const suggestionBatchSchema=z.object({stories:z.array(z.object({title:z.string().min(1).max(100),description:z.string().min(1).max(180)})).max(5),note:z.string().max(300)});
export type SuggestionBatch=z.infer<typeof suggestionBatchSchema>;
export const maxSuggestionBatches=40;
export function suggestionKey(bookId:string,customBook:string|undefined,theme:string){return JSON.stringify([bookId,bookId==='other'?(customBook||'').trim():'',theme.trim()]);}
export function titleKey(title:string){return title.normalize('NFKC').replace(/[\s《》〈〉「」『』·・:：，,。.!！?？]/g,'').toLowerCase();}
export function freshSuggestions(batch:SuggestionBatch,excluded:string[]):SuggestionBatch{
 const seen=new Set(excluded.map(titleKey));
 const stories=batch.stories.filter(story=>{const key=titleKey(story.title);if(seen.has(key))return false;seen.add(key);return true;});
 const note=batch.note||(stories.length===0?'暂时没有更多可确认的故事，可以回看前面的批次，或换个主题。':stories.length<5?'本批可确认的新故事不足 5 篇，先列出这些。':'');
 return {stories,note};
}
