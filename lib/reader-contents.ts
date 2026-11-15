// Share simplified/traditional search normalization while keeping full source bodies on the server.
import {Converter} from 'opencc-js';
import type {LocalSourceReference} from './reader-local-contract.ts';
export type BookContentEntry={kind:'chapter'|'story';id:string;title:string;chapter:string;excerpt:string;source?:LocalSourceReference;unavailable?:string};
export type BookContents={bookId:string;title:string;entries:BookContentEntry[];total?:number};

const simplified=Converter({from:'t',to:'cn'});
// 部分书的故事卡以简介开头作标题；列表中简介去掉与标题重复的开头，避免同一句读两遍。
export function storyCardExcerpt(title:string,excerpt:string){
 const head=title.trim();
 if(!head||!excerpt.startsWith(head))return excerpt;
 return excerpt.slice(head.length).replace(/^[\s，。、；：！？,.;:!?—…]+/u,'');
}
export const contentSearchText=(text:string)=>simplified(text.normalize('NFKC')).toLowerCase();
export const contentSearchTerms=(query:string)=>contentSearchText(query).trim().split(/\s+/u).filter(Boolean);
export function matchingBookContents(entries:BookContentEntry[],query:string){
 const terms=contentSearchTerms(query);
 return entries.filter(entry=>{const text=contentSearchText(entry.title+' '+entry.chapter+' '+entry.excerpt);return terms.every(term=>text.includes(term));});
}
