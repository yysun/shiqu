// Define story content and the source-backed sample used to initialize a new library.
export type Page = { caption: string; prompt: string; image: string; audio: string };
export type Story = { id:string; title:string; hook:string; bookId:string; theme:string; status:'draft'|'review'|'published'; pages:Page[]; reflection:string; sourceText:string; sourceUrl:string; adaptationNote:string; checks:{source:boolean;plot:boolean;visual:boolean}; actualCost:number|null; currency:string; revision:number; createdAt:string; updatedAt:string };
export const pearSource = '[historical third-party excerpt removed]';
export const sourceUrl = 'https://www.shidianguji.com/book/XYXLZZY/chapter/1l6393j2mfdig';
export const seedBooks = [
 {id:'liaozhai',title:'聊斋志异',author:'蒲松龄',era:'清',sourceUrl,excerpt:pearSource,note:'已录入《种梨》原文。其他篇目需提供可靠原文后再改编。'},
 {id:'shishuo',title:'世说新语',author:'刘义庆 编',era:'南朝宋',sourceUrl:'',excerpt:'',note:'待录入选定篇目的原文与来源。'},
 {id:'zhuangzi',title:'庄子',author:'庄周等',era:'先秦',sourceUrl:'',excerpt:'',note:'待录入选定篇目的原文与来源。'}
];
export const themes = ['人情冷暖','意外之喜','执念与得失','聪明与糊涂','善意与误解'];
export function seedStory():Story {throw Error('Historical bundled demo removed');}
