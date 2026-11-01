// Contents expose source identity and a short preview without shipping whole book bodies.
import {Converter} from 'opencc-js';
import type {LocalSourceReference} from './reader-local-contract.ts';
export type BookContentEntry={id:string;title:string;chapter:string;excerpt:string;source?:LocalSourceReference;unavailable?:string};
export type BookContents={bookId:string;title:string;entries:BookContentEntry[]};

const simplified=Converter({from:'t',to:'cn'});
const searchText=(text:string)=>simplified(text.normalize('NFKC')).toLowerCase();
export function matchingBookContents(entries:BookContentEntry[],query:string){
 const key=searchText(query.trim());
 return entries.filter(entry=>searchText(entry.title+' '+entry.chapter+' '+entry.excerpt).includes(key));
}
