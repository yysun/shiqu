// Read whole local books, assign deterministic citation units, and resolve receipts exactly.
// Unit lookup verifies a story anchor; generation also saves its complete chapters so anchors cannot truncate a story.
import path from 'node:path';
import {readFile,realpath,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ReaderError} from '../lib/reader-model.ts';
import type {Selection} from '../lib/reader-model.ts';
import type {SourceHint} from '../lib/reader-source-types.ts';
import {sourceText,sourceParts} from './local-source-ranges.ts';
import {readingTokens,wholeInputTokens} from './story-token-budget.ts';
import type {LocalSourceReference,WholeBookInput} from '../lib/reader-local-contract.ts';
import type {OriginalSource} from '../lib/reader-source-types.ts';
import {sourceQuery} from '../lib/reader-source.ts';
import {Converter} from 'opencc-js';
import {readerBooks} from '../lib/reader-books.ts';
import {loadLicensedCollection} from './local-book-licensed.ts';
import {parseWikiStories} from './local-book-wiki-stories.ts';
import {parseWikiOriginal,parseShidianOriginal} from './local-book-html.ts';
import type {HtmlOriginal} from './local-book-html.ts';
import {parseErkeVolume} from './local-book-erke.ts';
import {parseWygVolume} from './local-book-wyg.ts';
import {parseAdditionalSections,additionalBookSpecs,localLines,supplementBody,chapterNumber} from './local-book-parsers.ts';
import {correctShishuo} from './local-book-corrections.ts';

export type LocalUnit={id:string;text:string;narrative?:boolean;unreadable?:boolean;url?:string;provider?:string};
export type LocalSection={id:string;title:string;units:LocalUnit[];url?:string;provider?:string};
type BookEntry={id:string;title:string;originalFile:string;originalFiles?:(Omit<HtmlOriginal,'sourceUrl'>&{sourceUrl?:string})[];format?:'wikisource-html'|'shidian-html'|'licensed-wikisource'|'kanripo-text';source:{url:string;provider:string;sha256:string};supplements:{file:string;sha256:string;sourceUrl:string;chapter:number;scope:string}[]};
export type LocalBook={id:string;title:string;edition:string;url:string;provider:string;sections:LocalSection[];input:WholeBookInput};
const aliases:Record<string,string>=Object.fromEntries(readerBooks.flatMap(book=>[[book.id,book.id],[book.title,book.id]]));
// Normalize legacy chapter labels only. Never convert source body glyphs.
const simplifiedLabel=Converter({from:'t',to:'cn'});
function unavailable(){return new ReaderError(503,'本地书库文件缺失或版本校验失败，请检查随应用发布的书籍资料。');}
function invalid(){return new ReaderError(400,'本地出处无法核对，请重新按主题选择故事。');}
export function originalBody(raw:string,provider:string){
 let text=raw.replace(/^\uFEFF/,'');
 if(provider==='Project Gutenberg'){
  const start=text.match(/\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  if(!start)throw unavailable();text=text.slice(start.index!+start[0].length);
  const end=text.search(/\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);if(end<0)throw unavailable();
  text=text.slice(0,end);
 }else text=text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').replace(/^#{1,6}\s+/gm,'').replace(/\\([()[\]{}*_`])/g,'$1');
 return text.replace(/\r\n/g,'\n').trim();
}
export function localBookId(selection:Selection){return aliases[simplifiedLabel((selection.bookId==='other'?selection.customBook||'':selection.bookId).replace(/[《》]/g,'').trim())];}
export function parseLocalSections(id:string,text:string):LocalSection[]{
 if(id!=='zhuangzi'&&id!=='shishuo')return parseAdditionalSections(id,text);
 const shishuo=id==='shishuo';
 const body=shishuo?text.split(/世[說说][舊旧][題题]一首[舊旧]跋二首/)[0]:text;
 const headings=[...body.matchAll(shishuo?/^(\S{1,8})第[一二三四五六七八九十]+[ \t]*$/gm:/^卷\S+ 第[一二三四五六七八九十]+ (.+?)[ \t]*$/gm)];
 if(headings.length!==(shishuo?36:33))throw unavailable();
 return headings.map((heading,index)=>{
  const sectionId=`${id}-${String(index+1).padStart(2,'0')}`;
  const content=body.slice(heading.index!+heading[0].length,headings[index+1]?.index).trim();
  let paragraphs:string[];
  if(shishuo){
   const starts=[...content.matchAll(/^(\d+)\.[ \t]*$/gm)];
   if(!starts.length||starts.some((match,i)=>Number(match[1])!==i+1))throw unavailable();
   paragraphs=starts.map((match,i)=>content.slice(match.index!+match[0].length,starts[i+1]?.index).trim());
  }else paragraphs=content.split(/\n\s*\n/).map(p=>p.trim()).filter(p=>p&&!/^[内外杂]篇卷$/.test(p));
  if(paragraphs.some(p=>!p))throw unavailable();
  return {id:sectionId,title:heading[1].trim(),units:paragraphs.map((text,i)=>({id:`${sectionId}-${String(i+1).padStart(3,'0')}`,text}))};
 });
}
export class LocalBooks{
 private directory:string;
 private cache=new Map<string,Promise<LocalBook>>();
 constructor(root:string){this.directory=path.resolve(root,'data/library');}
 async book(selection:Selection):Promise<LocalBook|null>{
  const id=localBookId(selection);if(!id)return null;
  let pending=this.cache.get(id);
  if(!pending){pending=this.load(id);this.cache.set(id,pending);}
  return pending;
 }
 private async load(id:string):Promise<LocalBook>{
  try{
   const catalog=JSON.parse(await readFile(path.join(this.directory,'catalog.json'),'utf8')) as {books:BookEntry[]};
   const entry=catalog.books.find(book=>book.id===id);if(!entry)throw unavailable();
   const root=await realpath(this.directory),file=await realpath(path.join(root,entry.originalFile));
   if(!file.startsWith(root+path.sep))throw unavailable();
   let edition:string,sections:LocalSection[];
   if(entry.format==='licensed-wikisource'||entry.format==='kanripo-text'){
    if(entry.supplements?.length)throw unavailable();
    ({edition,sections}=await loadLicensedCollection(file,entry as Parameters<typeof loadLicensedCollection>[1]));
   }else if(entry.originalFiles){
    if(!['太平广记','二刻拍案惊奇','山海经','酉阳杂俎','史记','红楼梦','喻世明言'].includes(id)||entry.supplements?.length)throw unavailable();
    const files=entry.originalFiles;
    let expected:string[];
    if(id==='太平广记')expected=[...Array.from({length:501},(_,n)=>`KR3l0118_${String(n).padStart(3,'0')}.txt`),'Readme.org'];
    else if(id==='红楼梦'||id==='喻世明言'){
     if(entry.format!=='wikisource-html')throw unavailable();
     expected=[...Array.from({length:id==='红楼梦'?12:40},(_,n)=>`${String(n+1).padStart(3,'0')}.html`),'index.html'];
    }else if(id==='二刻拍案惊奇'){
     if(files.length!==40)throw unavailable();
     expected=files.map((item,index)=>{
      const match=item.file.match(/^(\d{2}) 卷(?:之)?([一二三四五六七八九十]+) .+\.txt$/);
      if(!match||Number(match[1])!==index+1||chapterNumber(match[2])!==index+1||path.basename(item.file)!==item.file||item.file.includes('\\'))throw unavailable();
      return item.file;
     });
    }
    else if(id==='酉阳杂俎'){
     if(entry.format!=='shidian-html')throw unavailable();
     const glyphs=files.map(item=>item.file).filter(name=>/^glyph-\d+\.png$/.test(name));if(glyphs.length!==35||new Set(glyphs).size!==35)throw unavailable();
     expected=[...Array.from({length:30},(_,n)=>`${String(n+1).padStart(3,'0')}.html`),...glyphs.slice().sort()];
    }else{
     if(entry.format!=='wikisource-html')throw unavailable();
     expected=[...Array.from({length:id==='山海经'?19:130},(_,n)=>`${String(id==='山海经'?n:n+1).padStart(3,'0')}.html`),'index.html'];
    }
    if(JSON.stringify(files.map(item=>item.file))!==JSON.stringify(expected)||JSON.stringify((await readdir(file)).sort())!==JSON.stringify(expected))throw unavailable();
    edition=createHash('sha256').update(files.map(item=>`${item.file}\t${item.sha256}`).join('\n')).digest('hex');
    if(edition!==entry.source.sha256)throw unavailable();
    sections=[];const sourceGlyphs=new Map<string,string>(),storyParts:{raw:string;item:HtmlOriginal}[]=[];
    for(const [index,item] of files.entries()){
     const original=await realpath(path.join(file,item.file));if(!original.startsWith(file+path.sep))throw unavailable();
     const bytes=await readFile(original);if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw unavailable();
     if(id==='红楼梦'||id==='喻世明言'){if(!item.sourceUrl)throw unavailable();storyParts.push({raw:bytes.toString('utf8'),item:item as HtmlOriginal});continue;}
     if(['山海经','酉阳杂俎','史记'].includes(id)){
      if(!item.sourceUrl)throw unavailable();
      if(item.file.endsWith('.png')){if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw unavailable();continue;}
      const number=item.file==='index.html'?-1:Number(item.file.slice(0,3));
      if(id==='酉阳杂俎'){const parsed=parseShidianOriginal(number,bytes.toString('utf8'),item as HtmlOriginal);sections.push(parsed.section);for(const [key,value] of parsed.glyphSources){if(sourceGlyphs.has(key)&&sourceGlyphs.get(key)!==value)throw unavailable();sourceGlyphs.set(key,value);}}
      else {const section=parseWikiOriginal(id,number,bytes.toString('utf8'),item as HtmlOriginal);if(section)sections.push(section);}
      continue;
     }
     const url=`${entry.source.url.replace('/tree/','/blob/')}/${encodeURIComponent(item.file)}`;
     if(id==='二刻拍案惊奇')sections.push(parseErkeVolume(bytes.toString('utf8'),index+1,url));
     else{const number=Number(item.file.match(/_(\d+)\.txt$/)?.[1]);if(number>0)sections.push(parseWygVolume(bytes.toString('utf8'),number,url));}
    }
    if(storyParts.length)sections=parseWikiStories(id,storyParts);
    if(id==='酉阳杂俎'){
     const images=files.filter(item=>item.file.endsWith('.png'));
     if(JSON.stringify([...sourceGlyphs.keys()].map(value=>`glyph-${value}.png`).sort())!==JSON.stringify(images.map(item=>item.file)))throw unavailable();
     for(const item of images){const url=new URL(item.sourceUrl!);if(url.protocol!=='https:'||!url.hostname.endsWith('.byteimg.com')||url.pathname!==sourceGlyphs.get(item.file.slice(6,-4)))throw unavailable();}
    }
   }else{
    if(['山海经','酉阳杂俎','史记','红楼梦','喻世明言'].includes(id))throw unavailable();
    const bytes=await readFile(file);edition=createHash('sha256').update(bytes).digest('hex');
    if(edition!==entry.source.sha256)throw unavailable();
    const textBody=bytes.toString('utf8');
    sections=parseLocalSections(id,entry.originalFile.endsWith('.json')?textBody.replace(/^\uFEFF/,''):originalBody(textBody,entry.source.provider));
   }
   const hashes=[edition];
   for(const supplement of entry.supplements||[]){
    const extra=await realpath(path.join(root,supplement.file));if(!extra.startsWith(root+path.sep))throw unavailable();
    const raw=await readFile(extra),hash=createHash('sha256').update(raw).digest('hex');if(hash!==supplement.sha256)throw unavailable();hashes.push(hash);
    const prefix=additionalBookSpecs[id]?.prefix;if(!prefix||!Number.isInteger(supplement.chapter))throw unavailable();
    const sectionId=`${prefix}-${String(supplement.chapter).padStart(3,'0')}`;
    const section:LocalSection={id:sectionId,title:supplement.scope,url:supplement.sourceUrl,provider:'维基文库（本地补卷）',units:localLines(supplementBody(raw.toString('utf8'))).map((text,i)=>({id:`${sectionId}-${String(i+1).padStart(3,'0')}`,text}))};
    const index=sections.findIndex(s=>s.id===sectionId);if(index<0)sections.push(section);else sections[index]=section;
   }
   if(hashes.length>1)edition=createHash('sha256').update(hashes.join('\n')).digest('hex');
   if(entry.supplements?.length)sections.sort((a,b)=>a.id.localeCompare(b.id));
   edition=correctShishuo(id,edition,sections);
   const text=sections.map(s=>`篇章 ${s.id}：${s.title}\n`+s.units.map(u=>`[${u.id}]\n${u.text}`).join('\n\n')).join('\n\n');
   return {id,title:entry.title,edition,url:entry.source.url,provider:entry.source.provider,sections,input:{title:entry.title,edition,text}};
  }catch(error){if(error instanceof ReaderError)throw error;throw unavailable();}
 }
 resolve(book:LocalBook,reference:LocalSourceReference,legacyChapter=false):OriginalSource{
  const {text,title,section,parts}=sourceText(book,reference,legacyChapter);
  const units=sourceParts(book,reference).flatMap(part=>part.units),providers=[...new Set([section.provider||book.provider,...units.flatMap(unit=>unit.provider?[unit.provider]:[])])];
  return {title,text,url:(units.length===1?units[0].url:undefined)||section.url||book.url,kind:legacyChapter?'chapter':'passage',provider:`本地书库 · ${providers.join('；')}`,retrievedAt:new Date().toISOString(),localSource:reference,...(parts.length>1?{localParts:parts}:{})};
 }
 async selected(selection:Selection){
  const book=await this.book(selection);if(!book)return null;
  if(!selection.source)throw invalid();
  return this.resolve(book,selection.source);
 }
 async storyOriginal(selection:Selection){
  const book=await this.book(selection);if(!book)return null;
  if(!selection.source)throw invalid();
  const original=this.resolve(book,selection.source);
  // These collections already expose isolated stories; their surrounding volume is unrelated material.
  if(book.id==='shishuo'||book.id==='liaozhai')return original;
  const sections=[...new Map(sourceParts(book,selection.source).map(part=>[part.section.id,part.section])).values()];
  const ranges=sections.map(section=>({sectionId:section.id,firstUnit:section.units[0].id,lastUnit:section.units.at(-1)!.id}));
  const [first,...continuations]=ranges;
  const title=sections.length===1?sections[0].title:sections[0].title+' → '+sections.at(-1)!.title;
  const chapterContext={title:`《${book.title}·${title}》`,text:sections.map(section=>`篇章 ${section.id}：${section.title}\n`+section.units.map(unit=>`[${unit.id}]\n${unit.text}`).join('\n\n')).join('\n\n'),source:{...first,...(continuations.length?{continuations}:{}),edition:book.edition}};
  if(chapterContext.text.length>2000000||readingTokens(original.text+JSON.stringify(chapterContext))>wholeInputTokens)throw new ReaderError(400,'故事涉及的完整章节超出单次制作范围，请选择涉及章节较少的故事；原文不会截断。');
  return {...original,chapterContext};
 }
 async legacy(selection:Selection,plan:SourceHint){
  const book=await this.book(selection);if(!book)return null;
  if(selection.source)return this.resolve(book,selection.source);
  const query=sourceQuery(selection,plan);
  const chapter=query.chapter.replace(/篇$/,'');
  const normalize=(label:string)=>simplifiedLabel(label).replace(/[《》\s]/g,'').replace(/（.*?）/g,'').replace(/篇$/,'');
  const matches=book.sections.filter(s=>normalize(s.title)===normalize(chapter)||(book.id==='史记'&&normalize(s.title.split('·').at(-1)!)===normalize(chapter)));
  const numbered=chapter.match(/第?([〇○零一二三四五六七八九十百千0-9]+)([回卷])/);
  // Match numeric labels across editions (一零零 / 一○○ / 一百); preserve displayed source glyphs.
  const numberedMatches=numbered?book.sections.filter(s=>{const match=s.title.match(/^第?([〇○零一二三四五六七八九十百千0-9]+)([回卷])/);return match&&match[2]===numbered[2]&&chapterNumber(match[1].replace(/○/g,'〇'))===chapterNumber(numbered[1].replace(/○/g,'〇'));}):[];
  const section=matches.length===1?matches[0]:numberedMatches.length===1?numberedMatches[0]:undefined;
  if(!section){
   const named=book.sections.flatMap(s=>s.units.flatMap((unit,i)=>normalize(unit.text)===normalize(chapter)?[{section:s,index:i}]:[]));
   if(named.length!==1||book.id!=='liaozhai')throw invalid();
   const {section,index}=named[0];let last=index+1;
   while(last<section.units.length&&!/^[\p{Script=Han}0-9]{1,12}$/u.test(section.units[last].text))last++;
   return this.resolve(book,{edition:book.edition,sectionId:section.id,firstUnit:section.units[index].id,lastUnit:section.units[last-1].id});
  }
  return this.resolve(book,{edition:book.edition,sectionId:section.id,firstUnit:section.units[0].id,lastUnit:section.units.at(-1)!.id},true);
 }
}
