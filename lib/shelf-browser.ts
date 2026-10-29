// Share shelf search and grouping across desktop and reader while preserving story order within groups.
export type ShelfMetadata={title:string;book:string;theme:string;artStyleLabel:string};
export const shelfGroupings=[{value:'book',label:'按书名分组'},{value:'theme',label:'按主题分组'},{value:'artStyle',label:'按画风分组'},{value:'status',label:'按处理状态分组'},{value:'none',label:'不分组'}] as const;
export type ShelfGrouping=typeof shelfGroupings[number]['value'];
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
export function groupShelfItems<T extends ShelfMetadata&{processingStatus:string}>(items:T[],grouping:Exclude<ShelfGrouping,'none'>){
 const groups=new Map<string,T[]>();
 for(const item of items){
  const label=grouping==='book'?item.book||'其他原典':grouping==='theme'?item.theme||'未记录主题':grouping==='artStyle'?item.artStyleLabel||'未记录画风':item.processingStatus;
  const group=groups.get(label);if(group)group.push(item);else groups.set(label,[item]);
 }
 const result=[...groups].map(([label,items])=>({label,items}));
 if(grouping==='status'){
  const order=['生成中','等待生成','待选画幅数','生成已暂停','生成失败','已完成'];
  result.sort((a,b)=>order.indexOf(a.label)-order.indexOf(b.label));
 }
 return result;
}
