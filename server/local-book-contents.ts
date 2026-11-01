// Index deterministic story/chapter boundaries; every selectable range passes the existing resolver.
// Invalid glyphs, incomplete text and token limits remain source-quality gates, including direct choices.
import {ReaderError} from '../lib/reader-model.ts';
import type {Selection} from '../lib/reader-model.ts';
import type {BookContents,BookContentEntry} from '../lib/reader-contents.ts';
import {localSourceKey} from '../lib/reader-local-contract.ts';
import type {LocalBooks,LocalBook} from './local-books.ts';
const namedHeading=(text:string)=>/^[\p{Script=Han}0-9]{1,12}$/u.test(text);
export function indexBookContents(books:LocalBooks,book:LocalBook):BookContents{
 const entries:BookContentEntry[]=[];
 for(const section of book.sections){
  const starts=book.id==='shishuo'?section.units.map((_,i)=>i):book.id==='liaozhai'?section.units.flatMap((u,i)=>namedHeading(u.text)?[i]:[]):[0];
  for(const [n,first]of starts.entries()){
   const last=(starts[n+1]??section.units.length)-1,unit=section.units[first];if(!unit)continue;
   const title=(book.id==='liaozhai'?unit.text:book.id==='shishuo'?`${section.title} · 第${first+1}则`:section.title).slice(0,100);
   const source={edition:book.edition,sectionId:section.id,firstUnit:unit.id,lastUnit:section.units[last].id};
   const entry:BookContentEntry={id:unit.id,title,chapter:section.title,excerpt:section.units.slice(book.id==='liaozhai'?first+1:first,last+1).map(u=>u.text).join(' ').slice(0,100)};
   try{books.resolve(book,source);entry.source=source;}
   catch(error){if(!(error instanceof ReaderError)||error.status!==400)throw error;entry.unavailable='原文含缺字、缺文或超出单次制作范围，暂不可选。';}
   entries.push(entry);
  }
 }
 return {bookId:book.id,title:book.title,entries};
}
export async function bookContents(books:LocalBooks,selection:Selection){
 const book=await books.book(selection);if(!book)throw new ReaderError(400,'这本书暂不支持直接选择，请按主题找故事。');
 return indexBookContents(books,book);
}
export async function directBookChoice(books:LocalBooks,selection:Selection){
 const book=await books.book(selection);if(!book||!selection.source)throw new ReaderError(400,'请重新选择本地故事或章节。');
 const key=localSourceKey(selection.source),entry=indexBookContents(books,book).entries.find(entry=>entry.source&&localSourceKey(entry.source)===key);
 if(!entry?.source)throw new ReaderError(400,'所选故事或章节已失效，请重新选择。');
 return {entry,original:books.resolve(book,entry.source)};
}
