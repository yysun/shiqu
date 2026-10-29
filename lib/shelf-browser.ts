// Share shelf search and source-book grouping across desktop and reader without changing story order.
export type ShelfMetadata={title:string;book:string;theme:string;artStyleLabel:string};
export function matchesShelfSearch(item:ShelfMetadata,query:string){
 const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase();
 const haystack=normalize([item.title,item.book,item.theme,item.artStyleLabel].join(' '));
 return normalize(query).trim().split(/\s+/).every(term=>haystack.includes(term));
}
export function groupShelfByBook<T extends {book:string}>(items:T[]){
 const groups=new Map<string,T[]>();
 for(const item of items){const book=item.book||'其他原典';const group=groups.get(book);if(group)group.push(item);else groups.set(book,[item]);}
 return [...groups].map(([book,items])=>({book,items}));
}
