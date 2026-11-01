// Share simplified/traditional search normalization while keeping full source bodies on the server.
import {Converter} from 'opencc-js';
import type {LocalSourceReference} from './reader-local-contract.ts';
export type BookContentEntry={kind:'chapter'|'story';id:string;title:string;chapter:string;excerpt:string;source?:LocalSourceReference;unavailable?:string};
export type BookContents={bookId:string;title:string;entries:BookContentEntry[]};

const simplified=Converter({from:'t',to:'cn'});
export const contentSearchText=(text:string)=>simplified(text.normalize('NFKC')).toLowerCase();
export const contentSearchTerms=(query:string)=>contentSearchText(query).trim().split(/\s+/u).filter(Boolean);
export function matchingBookContents(entries:BookContentEntry[],query:string){
 const terms=contentSearchTerms(query);
 return entries.filter(entry=>{const text=contentSearchText(entry.title+' '+entry.chapter+' '+entry.excerpt);return terms.every(term=>text.includes(term));});
}
