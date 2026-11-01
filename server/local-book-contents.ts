// Index chapter scan scopes and isolated stories without altering original source glyphs.
// Chapters can be scanned despite local defects; direct stories and extracted candidates retain strict quality gates.
import {ReaderError} from '../lib/reader-model.ts';
import type {Selection} from '../lib/reader-model.ts';
import {contentSearchText,contentSearchTerms} from '../lib/reader-contents.ts';
import type {BookContents,BookContentEntry} from '../lib/reader-contents.ts';
import {localSourceKey} from '../lib/reader-local-contract.ts';
import type {LocalBooks,LocalBook} from './local-books.ts';
const namedHeading=(text:string)=>/^[\p{Script=Han}0-9]{1,12}$/u.test(text);
// A LocalBook is immutable and edition-bound; cache normalized text without exposing it in API responses.
const searchIndexes=new WeakMap<LocalBook,Map<string,string>>();
export function indexBookContents(books:LocalBooks,book:LocalBook,query=''):BookContents{
 const entries:BookContentEntry[]=[],terms=contentSearchTerms(query);
 let searchIndex=searchIndexes.get(book);if(!searchIndex){searchIndex=new Map();searchIndexes.set(book,searchIndex);}
 for(const section of book.sections){
  const starts=book.id==='shishuo'?section.units.map((_,i)=>i):book.id==='liaozhai'?section.units.flatMap((u,i)=>namedHeading(u.text)?[i]:[]):[0];
  for(const [n,first]of starts.entries()){
   const last=(starts[n+1]??section.units.length)-1,unit=section.units[first];if(!unit)continue;
   const title=(book.id==='liaozhai'?unit.text:book.id==='shishuo'?`${section.title} · 第${first+1}则`:section.title).slice(0,100);
   const source={edition:book.edition,sectionId:section.id,firstUnit:unit.id,lastUnit:section.units[last].id};
   const body=section.units.slice(book.id==='liaozhai'?first+1:first,last+1).map(u=>u.text).join(' ');
   if(terms.length){
    let text=searchIndex.get(unit.id);if(text===undefined){text=contentSearchText(title+' '+section.title+' '+body);searchIndex.set(unit.id,text);}
    if(!terms.every(term=>text.includes(term)))continue;
   }
   const kind=book.id==='liaozhai'||book.id==='shishuo'?'story':'chapter';
   const entry:BookContentEntry={kind,id:unit.id,title,chapter:section.title,excerpt:body.slice(0,100)};
   try{if(kind==='story')books.resolve(book,source);entry.source=source;}
   catch(error){if(!(error instanceof ReaderError)||error.status!==400)throw error;entry.unavailable='原文含缺字、缺文或超出单次制作范围，暂不可选。';}
   entries.push(entry);
  }
 }
 return {bookId:book.id,title:book.title,entries};
}
export async function bookContents(books:LocalBooks,selection:Selection,query=''){
 const book=await books.book(selection);if(!book)throw new ReaderError(400,'这本书暂不支持直接选择，请按主题找故事。');
 return indexBookContents(books,book,query);
}
export async function directBookChoice(books:LocalBooks,selection:Selection){
 const book=await books.book(selection);if(!book||!selection.source)throw new ReaderError(400,'请重新选择本地故事或章节。');
 const key=localSourceKey(selection.source),entry=indexBookContents(books,book).entries.find(entry=>entry.source&&localSourceKey(entry.source)===key);
 if(!entry?.source)throw new ReaderError(400,'所选故事或章节已失效，请重新选择。');
 return {entry,original:books.resolve(book,entry.source)};
}

// Canonical chapter scopes retain book order and edition; callers cannot supply arbitrary source slices.
export function selectedChapterScope(books:LocalBooks,book:LocalBook,references:NonNullable<Selection['discoverySources']>){
 const requested=new Set(references.map(localSourceKey));
 if(!references.length||references.length>24||requested.size!==references.length)throw new ReaderError(400,'请选择1–24个不重复的章节。');
 const entries=indexBookContents(books,book).entries.filter(entry=>entry.kind==='chapter'&&entry.source&&requested.has(localSourceKey(entry.source)));
 if(entries.length!==references.length)throw new ReaderError(400,'章节范围已失效，请重新选择同一本书的章节。');
 const discoverySources=entries.map(entry=>entry.source!),ids=new Set(discoverySources.map(source=>source.sectionId));
 const sections=book.sections.filter(section=>ids.has(section.id));
 const text=sections.map(section=>`篇章 ${section.id}：${section.title}\n`+section.units.map(unit=>`[${unit.id}]\n${unit.text}`).join('\n\n')).join('\n\n');
 return {discoverySources,book:{...book,sections,input:{...book.input,text}}};
}
