// 故事的原文来自选定的书库版本。
import type {StoryPublication} from './story-publication';
export type Page = { caption: string; prompt: string; image: string; audio: string };
export type Story = { publication?:StoryPublication; id:string; title:string; summary:string; bookId:string; theme:string; status:'draft'|'review'|'published'; pages:Page[]; reflection:string; sourceText:string; sourceUrl:string; adaptationNote:string; checks:{source:boolean;plot:boolean;visual:boolean}; revision:number; createdAt:string; updatedAt:string };
