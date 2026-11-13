// Index chapter scan scopes and isolated stories without altering original source glyphs.
// Chapters can be scanned despite local defects; direct stories and extracted candidates retain strict quality gates.
import {ReaderError} from '../lib/reader-model.ts';
import type {Selection} from '../lib/reader-model.ts';
import {contentSearchText,contentSearchTerms} from '../lib/reader-contents.ts';
import type {BookContents,BookContentEntry} from '../lib/reader-contents.ts';
import {localSourceKey} from '../lib/reader-local-contract.ts';
import type {LocalBooks,LocalBook} from './local-books.ts';
import {sourceParts} from './local-source-ranges.ts';
const chapterNumberPrefix=/^第[〇零一二两兩三四五六七八九十百千0-9]+回\s+/u;
const namedHeading=(text:string)=>/^[\p{Script=Han}0-9]{1,12}$/u.test(text);
type ContentsPage={limit:number;offset:number};
function pageContents(contents:BookContents,page?:ContentsPage){
 if(!page)return contents;
 return {...contents,total:contents.entries.length,entries:contents.entries.slice(page.offset,page.offset+page.limit)};
}
// A LocalBook is immutable and edition-bound; cache normalized text without exposing it in API responses.
const searchIndexes=new WeakMap<LocalBook,Map<string,string>>();
export function indexBookContents(books:LocalBooks,book:LocalBook,query='',chaptersOnly=false):BookContents{
 const entries:BookContentEntry[]=[],terms=contentSearchTerms(query);
 let searchIndex=searchIndexes.get(book);if(!searchIndex){searchIndex=new Map();searchIndexes.set(book,searchIndex);}
 const kind=!chaptersOnly&&(book.id==='liaozhai'||book.id==='shishuo')?'story':'chapter';
 for(const section of book.sections){
  const starts=kind==='chapter'?[0]:book.id==='shishuo'?section.units.map((_,i)=>i):section.units.flatMap((u,i)=>namedHeading(u.text)?[i]:[]);
  for(const [n,first]of starts.entries()){
   const last=(starts[n+1]??section.units.length)-1,unit=section.units[first];if(!unit)continue;
   const title=(kind==='chapter'?section.title:book.id==='liaozhai'?unit.text:`${section.title} · 第${first+1}则`).slice(0,100);
   const source={edition:book.edition,sectionId:section.id,firstUnit:unit.id,lastUnit:section.units[last].id};
   const body=section.units.slice(kind==='story'&&book.id==='liaozhai'?first+1:first,last+1).map(u=>u.text).join(' ');
   if(terms.length){
    const key=kind+':'+unit.id;
    let text=searchIndex.get(key);if(text===undefined){text=contentSearchText(title+' '+section.title+' '+body);searchIndex.set(key,text);}
    if(!terms.every(term=>text.includes(term)))continue;
   }
   const entry:BookContentEntry={kind,id:unit.id,title,chapter:section.title,excerpt:body.slice(0,100)};
   try{if(kind==='story')books.resolve(book,source);entry.source=source;}
   catch(error){if(!(error instanceof ReaderError)||error.status!==400)throw error;entry.unavailable='原文含缺字、缺文或超出单次制作范围，暂不可选。';}
   entries.push(entry);
  }
 }
 return {bookId:book.id,title:book.title,entries};
}
export async function bookContents(books:LocalBooks,selection:Selection,query='',view?:'chapters'|'stories'|'scope',page?:ContentsPage){
 const book=await books.book(selection);if(!book)throw new ReaderError(400,'这本书暂不支持直接选择，请按主题找故事。');
 if(view==='chapters')return pageContents(indexBookContents(books,book,query,true),page);
 const directory=indexBookContents(books,book,query);
 // 故事卡可覆盖整章，按故事浏览时只按已列出的故事出处去重。
 if(view==='stories')directory.entries=directory.entries.filter(entry=>entry.kind==='story'&&entry.source);
 const seen=new Set(directory.entries.flatMap(entry=>entry.source?[localSourceKey(entry.source)]:[]));
 const chapters=new Map(book.sections.map(section=>[section.id,section.title]));
 if(view==='scope'&&(book.id==='liaozhai'||book.id==='shishuo'))for(const entry of indexBookContents(books,book,query,true).entries){
  const key=localSourceKey(entry.source!);
  if(!seen.has(key)){directory.entries.push({...entry,id:'chapter:'+entry.id});seen.add(key);}
 }
 for(const {id,source,displayTitle,displaySummary} of await books.storySearch?.passages(book,contentSearchTerms(query))??[]){
  const key=localSourceKey(source);if(seen.has(key))continue;
  try{
   const original=books.resolve(book,source);
   const title=view==='stories'?displayTitle.replace(chapterNumberPrefix,''):displayTitle;
   directory.entries.push({kind:'story',id:'indexed:'+id,title:title.slice(0,100),chapter:chapters.get(source.sectionId)!,excerpt:(view==='stories'&&displaySummary||original.text).slice(0,100),source});
   seen.add(key);
  }catch(error){if(!(error instanceof ReaderError)||error.status!==400)throw error;}
 }
 return pageContents(directory,page);
}
export async function directBookChoice(books:LocalBooks,selection:Selection){
 const book=await books.book(selection);if(!book||!selection.source)throw new ReaderError(400,'请重新选择本地故事或章节。');
 const key=localSourceKey(selection.source),entry=indexBookContents(books,book).entries.find(entry=>entry.source&&localSourceKey(entry.source)===key);
 if(!entry?.source)throw new ReaderError(400,'所选故事或章节已失效，请重新选择。');
 return {entry,original:books.resolve(book,entry.source)};
}

// 仅接受同版目录中的原文范围，重叠范围取并集，跳过的原文保留断点。
export async function selectedChapterScope(books:LocalBooks,book:LocalBook,references:NonNullable<Selection['discoverySources']>){
 const requested=new Set(references.map(localSourceKey));
 if(!references.length||references.length>24||requested.size!==references.length)throw new ReaderError(400,'请选择 1–24 段不重复的原文。');
 const chapters=indexBookContents(books,book,'',true).entries;
 const available=new Map(chapters.map(entry=>[localSourceKey(entry.source!),entry.source!]));
 if([...requested].some(key=>!available.has(key))&&(book.id==='liaozhai'||book.id==='shishuo')){
  for(const {source} of indexBookContents(books,book).entries)if(source&&!available.has(localSourceKey(source)))available.set(localSourceKey(source),source);
 }
 if([...requested].some(key=>!available.has(key))){
  for(const {source} of await books.storySearch?.passages(book,[])??[]){
   const key=localSourceKey(source);if(!requested.has(key)||available.has(key))continue;
   try{books.resolve(book,source);available.set(key,source);}
   catch(error){if(!(error instanceof ReaderError)||error.status!==400)throw error;}
  }
 }
 const discoverySources=[...available].filter(([key])=>requested.has(key)).map(([,source])=>source);
 if(discoverySources.length!==references.length)throw new ReaderError(400,'原文范围已失效，请重新选择同一本书的章节或故事段落。');
 const selected=new Set(discoverySources.flatMap(source=>sourceParts(book,source).flatMap(part=>part.units.map(unit=>unit.id))));
 const sections=book.sections.flatMap(section=>{
  const sourceBreaks=new Set<string>();
  const units=section.units.filter((unit,index)=>{
   if(!selected.has(unit.id))return false;
   if(index>0&&!selected.has(section.units[index-1].id))sourceBreaks.add(unit.id);
   return true;
  });
  sourceBreaks.delete(units[0]?.id);
  return units.length?[{...section,units,sourceBreaks}]:[];
 });
 const text=sections.map(section=>`篇章 ${section.id}：${section.title}\n`+section.units.map(unit=>(section.sourceBreaks.has(unit.id)?'【另一个已选原文段落】\n':'')+`[${unit.id}]\n${unit.text}`).join('\n\n')).join('\n\n');
 return {discoverySources,book:{...book,sections,input:{...book.input,text}}};
}
