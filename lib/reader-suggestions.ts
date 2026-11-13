// Validate suggestion batches and keep verified local receipts through browser history.
// 故事卡检索进度标签区分向量查找、向量不可用改用模型和未配置向量。
// 每批最多 12 则：向量结果每页 12 则，其余检索仍按原有上限返回。
import {z} from 'zod';
import {selectionSchema} from './reader-model.ts';
import {localSourceSchema,localSourceKey} from './reader-local-contract.ts';
import type {LocalSourceReference} from './reader-local-contract.ts';
import {artRecommendationSchema} from './reader-art-recommendation.ts';
import {storyBriefSchema} from './reader-story-brief.ts';

export const suggestionRequestSchema=selectionSchema.extend({excludeTitles:z.array(z.string().min(1).max(100)).max(200).default([]),excludeSources:z.array(localSourceSchema).max(200).default([])});
export const suggestionBatchSchema=z.object({stories:z.array(z.object({title:z.string().min(1).max(100),description:z.string().min(1).max(180),source:localSourceSchema.optional(),sourceLabel:z.string().max(150).optional(),artRecommendation:artRecommendationSchema.optional(),matchReason:z.string().trim().min(1).max(120).optional(),matchScore:z.number().int().min(0).max(100).optional(),storyBrief:storyBriefSchema.optional()})).max(12),note:z.string().max(300)});
export type SuggestionBatch=z.infer<typeof suggestionBatchSchema>;
export type IndexedStoryCandidate={id:string;title:string;summary?:string;matchScore?:number;status:'pending'|'match'|'rejected';choice?:{batch:number;index:number}};
export type IndexedStoryUpdate={id:string;summary?:string;status:IndexedStoryCandidate['status'];story:SuggestionBatch['stories'][number]&{source:LocalSourceReference}};
export const suggestionProgressSchema=z.object({completed:z.number().int().min(0),total:z.number().int().min(1),completedChars:z.number().int().min(0),totalChars:z.number().int().min(0),stage:z.enum(['reading','checking','selecting','cache','retrieving','verifying']),retrieval:z.enum(['vector','hybrid','no-query-vector','no-compatible-vectors','no-index','no-candidates','scan']).optional(),modelBatchCardCount:z.number().int().positive().optional(),cachedMatches:z.number().int().nonnegative().optional(),mode:z.enum(['whole','chapters']).optional(),currentChapters:z.array(z.string().min(1).max(500)).max(1024).optional(),checkingCandidates:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(50).optional()}).refine(p=>p.completed<=p.total&&p.completedChars<=p.totalChars);
export type SuggestionProgress=z.infer<typeof suggestionProgressSchema>;
export function storyCardSearchProgressLabel(progress?:SuggestionProgress|null){
 if(progress?.stage==='retrieving'&&progress.retrieval==='vector')return '正在用向量查找故事…';
 if(progress?.stage==='verifying'&&progress.modelBatchCardCount!==undefined){
  const batch=`本批 ${progress.modelBatchCardCount} 张故事卡`;
  // 向量已启用但不可用时明确说明改用模型。
  if(progress.retrieval==='no-query-vector')return `向量检索暂不可用，正在用模型查找故事 · ${batch}`;
  return `正在用模型查找故事 · ${batch}`;
 }
 return null;
}
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

// Keep long multi-chapter reading blocks compact in both discovery status surfaces.
export const readingChapterLabel=(chapters:string[])=>chapters.length>2?`${chapters[0]}至${chapters.at(-1)}（共${chapters.length}章）`:chapters.join('、');
