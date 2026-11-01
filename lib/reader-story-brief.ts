// A synopsis guides narration but never replaces the cited original or a source-grounded correction.
import {z} from 'zod';
import type {OriginalSource} from './reader-source-types.ts';
export const storySummarySchema=z.string().trim().min(1).max(1200);
export const storyBriefSchema=z.object({summary:storySummarySchema,matchReason:z.string().trim().min(1).max(300)});
export type StoryBrief=z.infer<typeof storyBriefSchema>;
export type StoryBriefRecord=StoryBrief&{verified:boolean};
export function storyBriefVerified(original:OriginalSource|undefined){return original?.storyBrief?.verified===true&&storyBriefSchema.safeParse(original.storyBrief).success;}
export function storyBriefPayload(original:OriginalSource|undefined,allowUnverified=false){
 if(!original?.storyBrief)return {};
 if(!allowUnverified&&!storyBriefVerified(original))throw Error('STORY_BRIEF_UNVERIFIED');
 return {storyBrief:storyBriefSchema.parse(original.storyBrief)};
}
