// Persist source provenance and optional full chapters alongside the selected story's citation.
// Historical originals without chapter context remain valid saved checkpoints.
import type {LocalSourceReference} from './reader-local-contract.ts';
import type {StoryBriefRecord} from './reader-story-brief.ts';
export type ChapterContext={title:string;text:string;source:LocalSourceReference};
export type OriginalSource={title:string;text:string;url:string;kind:'passage'|'chapter';provider:string;retrievedAt:string;localSource?:LocalSourceReference;localParts?:{sectionId:string;title:string;text:string}[];chapterContext?:ChapterContext;storyBrief?:StoryBriefRecord};
export function verifiedOriginalPayload(original:OriginalSource){return {title:original.title,text:original.text,url:original.url,...(original.chapterContext?{chapterContext:original.chapterContext}:{})};}
export type SourceFailure={code:'SOURCE_HTTP_ERROR'|'SOURCE_INVALID_RESPONSE'|'SOURCE_TIMEOUT'|'SOURCE_NETWORK_ERROR';status?:number};
export type SourceResult={source:OriginalSource|null;message:string;searchUrl:string;failure?:SourceFailure};

// Source lookup can run before a storyboard exists; only citation clues are required.
export type SourceHint={sourceReference:string;adaptationNote?:string;pages?:{caption:string}[]};
