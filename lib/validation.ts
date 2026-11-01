// Validate ordinary stories and uploaded media against the same frame ceiling as the reader.
import {readerMaxFrames} from './reader-limits.ts';
import {z} from 'zod';
const media = z.string().max(300).refine(s=>s===''||/^\/(art|api\/media)\/[a-zA-Z0-9._-]+$/.test(s),'媒体必须是已上传的本站文件');
export const pageSchema=z.object({caption:z.string().max(400),prompt:z.string().max(4000),image:media,audio:media});
export const storySchema=z.object({title:z.string().trim().min(1).max(80),summary:z.string().max(1200),bookId:z.string().max(100),theme:z.string().max(60),pages:z.array(pageSchema).max(readerMaxFrames),reflection:z.string().max(300),sourceText:z.string().max(30000),sourceUrl:z.string().max(1000).refine(s=>!s||/^https:\/\//.test(s),'来源链接需为HTTPS'),adaptationNote:z.string().max(2000),checks:z.object({source:z.boolean(),plot:z.boolean(),visual:z.boolean()}),revision:z.number().int().min(1)});
export function publishErrors(s:{pages:{caption:string;image:string}[];sourceText:string;sourceUrl:string;checks:{source:boolean;plot:boolean;visual:boolean}}){const e:string[]=[];if(s.pages.length<4)e.push('至少需要4页分镜');if(s.pages.some(p=>!p.caption.trim()||!p.image))e.push('每页都需要旁白和画面');if(!s.sourceText.trim()||!s.sourceUrl)e.push('请补充原文和来源链接');if(!Object.values(s.checks).every(Boolean))e.push('请完成原文、情节与画面三项审核');return e;}
