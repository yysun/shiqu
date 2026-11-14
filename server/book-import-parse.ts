// 将导入原件解析为可编辑的章节起点；不转写正文字符。
import {Parser} from 'htmlparser2';
import {Unzip,UnzipInflate,UnzipPassThrough,strFromU8} from 'fflate';
import type {UnzipFileInfo} from 'fflate';

export const bookImportParserVersion='book-parser-v1';
export const epubSingleLimit=64*1024*1024,epubBookLimit=256*1024*1024,epubEntryCountLimit=2000,epubRatioLimit=100,epubMarkupLimit=8*1024*1024;
export type ImportBlock={text:string;heading?:boolean};
export type ImportChapterStart={block:number;title:string};
export type ImportedSource={format:'txt'|'html'|'epub';encoding:string;blocks:ImportBlock[];chapters:ImportChapterStart[];epubBytes:number};
export class BookImportParseError extends Error{constructor(code:string){super(code);this.name='BookImportParseError';}}

const count=(value:string,re:RegExp)=>[...value.matchAll(re)].length;
function hanRatio(value:string){const chars=[...value].filter(char=>!/[\s\p{P}\p{S}\d]/u.test(char));return chars.length?count(value,/[\p{Script=Han}]/gu)/chars.length:0;}
export function decodeImportedText(bytes:Uint8Array,encoding?:string){
 const candidates: {name:string;text:string;ratio:number}[]=[];
 const decode=(name:string)=>{try{return new TextDecoder(name,{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{return null;}};
 if(encoding){const text=decode(encoding.toLowerCase());if(text===null)throw new BookImportParseError('ENCODING_INVALID');return {text,encoding:encoding.toLowerCase()};}
 const utf8=decode('utf-8');if(utf8!==null)return {text:utf8,encoding:'utf-8'};
 for(const name of ['gb18030','big5']){const text=decode(name);if(text!==null)candidates.push({name,text,ratio:hanRatio(text)});}
 if(!candidates.length)throw new BookImportParseError('ENCODING_UNSUPPORTED');
 if(candidates.length===2&&Math.abs(candidates[0].ratio-candidates[1].ratio)<0.08)throw new BookImportParseError('ENCODING_AMBIGUOUS');
 candidates.sort((a,b)=>b.ratio-a.ratio);return {text:candidates[0].text,encoding:candidates[0].name};
}

type HtmlBlock={text:string;heading?:boolean};
export function htmlBlocks(html:string):HtmlBlock[]{
 const stack:{tag:string;skip:boolean}[]=[],blocks:HtmlBlock[]=[];let current:{text:string;heading:boolean;tag:string}|undefined,skipDepth=0;
 const flush=()=>{const text=current?.text.replace(/\s+/gu,' ').trim();if(text)blocks.push({text, ...(current!.heading?{heading:true}:{})});current=undefined;};
 const parser=new Parser({onopentag(tag){
  const parent=stack.at(-1),skip=!!parent?.skip||['script','style','nav','header','footer','aside','noscript'].includes(tag);
  stack.push({tag,skip});if(skip)skipDepth++;
  if(!skip&&['p','li','blockquote','div','h1','h2','h3','br'].includes(tag)){
   if(!skipDepth){if(tag==='br'){if(current)current.text+=' ';}else{flush();current={text:'',heading:/^h[1-3]$/.test(tag),tag};}}
  }
 },ontext(text){if(!skipDepth&&current)current.text+=text;},onclosetag(tag){
  const index=stack.findLastIndex(item=>item.tag===tag);if(index<0)return;
  for(const item of stack.splice(index).reverse()){if(item.skip)skipDepth=Math.max(0,skipDepth-1);if(item.tag===tag&&current?.tag===tag)flush();}
 }},{decodeEntities:true,xmlMode:false});
 parser.end(html);
 return blocks;
}

function chapterTitle(text:string){
 const value=text.trim();
 if(/^第[〇零一二三四五六七八九十百千两0-9]{1,16}[回章卷节篇](?:\s|$|[：:、])/u.test(value))return value.slice(0,120);
 if(/^卷(?:之)?[〇零一二三四五六七八九十百千两0-9]{1,16}(?:\s|$|[：:、])/u.test(value))return value.slice(0,120);
 return '';
}
export function autoChapterStarts(blocks:ImportBlock[],fallbackChars=8000):ImportChapterStart[]{
 const detected=blocks.flatMap((block,index)=>{const title=block.heading?block.text:chapterTitle(block.text);return title?[{block:index,title}]:[];});
 if(detected.length)return detected;
 const starts:ImportChapterStart[]=[];let chars=0,index=0;
 for(const block of blocks){if(chars===0)starts.push({block:index,title:`第 ${starts.length+1} 部分`});chars+=Array.from(block.text).length+1;if(chars>=fallbackChars){chars=0;}index++;}
 return starts;
}

type ZipEntry=UnzipFileInfo&{path:string;directory:boolean};
function read16(bytes:Uint8Array,offset:number){return bytes[offset]|bytes[offset+1]<<8;}
function read32(bytes:Uint8Array,offset:number){return (bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16|bytes[offset+3]<<24)>>>0;}
function safeZipPath(value:string){
 if(!value||value.startsWith('/')||value.startsWith('\\')||value.includes('\\')||/^[a-z][a-z0-9+.-]*:/i.test(value))throw new BookImportParseError('EPUB_PATH_INVALID');
 const parts:string[]=[];for(const part of value.split('/')){if(!part||part==='.')continue;if(part==='..')throw new BookImportParseError('EPUB_PATH_INVALID');parts.push(part);}
 return parts.join('/');
}
function centralDirectory(bytes:Uint8Array):ZipEntry[]{
 let eocd=-1;for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--){if(read32(bytes,offset)===0x06054b50){eocd=offset;break;}}
 if(eocd<0)throw new BookImportParseError('EPUB_INVALID');
 const total=read16(bytes,eocd+10),size=read32(bytes,eocd+12),start=read32(bytes,eocd+16);
 if(total===0xffff||size===0xffffffff||start===0xffffffff||total>epubEntryCountLimit||start+size>eocd)throw new BookImportParseError('EPUB_LIMIT');
 const entries:ZipEntry[]=[],paths=new Set<string>();let cursor=start,totalSize=0;
 for(let index=0;index<total;index++){
  if(read32(bytes,cursor)!==0x02014b50||cursor+46>bytes.length)throw new BookImportParseError('EPUB_INVALID');
  const flags=read16(bytes,cursor+8),compression=read16(bytes,cursor+10),compressed=read32(bytes,cursor+20),original=read32(bytes,cursor+24),nameLength=read16(bytes,cursor+28),extraLength=read16(bytes,cursor+30),commentLength=read16(bytes,cursor+32),end=cursor+46+nameLength+extraLength+commentLength;
  if(end>bytes.length||flags&1||compressed===0xffffffff||original===0xffffffff)throw new BookImportParseError(flags&1?'EPUB_DRM':'EPUB_INVALID');
  let name:string;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+nameLength));}catch{throw new BookImportParseError('EPUB_PATH_INVALID');}
  const path=safeZipPath(name),directory=name.endsWith('/');if(!path||paths.has(path))throw new BookImportParseError('EPUB_PATH_INVALID');paths.add(path);
  if(directory){
   if(original)throw new BookImportParseError('EPUB_INVALID');
   entries.push({name,path,size:compressed,originalSize:original,compression,directory});
  }else{
   const ratio=original/Math.max(compressed,1);if(ratio>epubRatioLimit)throw new BookImportParseError('EPUB_RATIO_LIMIT');
   if(/\.(?:opf|x?html|xml|ncx)$/i.test(path)&&original>epubMarkupLimit)throw new BookImportParseError('EPUB_ENTRY_LIMIT');
   totalSize+=original;if(totalSize>epubSingleLimit)throw new BookImportParseError('EPUB_LIMIT');
   entries.push({name:path,path,size:compressed,originalSize:original,compression,directory});
  }
  cursor=end;
 }
 if(entries.length>epubEntryCountLimit)throw new BookImportParseError('EPUB_LIMIT');
 if(entries.some(entry=>!entry.directory&&/^META-INF\/(?:encryption|rights)\.xml$/i.test(entry.path)))throw new BookImportParseError('EPUB_DRM');
 return entries;
}
function unzipBounded(bytes:Uint8Array,entries:ZipEntry[],bookEpubBytes:number){
 if(bookEpubBytes>epubBookLimit)throw new BookImportParseError('EPUB_BOOK_LIMIT');
 const metadata=new Map(entries.map(entry=>[entry.path,entry])),saved=new Map<string,Uint8Array>(),chunks=new Map<string,Uint8Array[]>(),seen=new Set<string>();let actual=0,failure:string|undefined;
 const unzip=new Unzip(file=>{
  const path=safeZipPath(file.name),entry=metadata.get(path);if(!entry){failure='EPUB_INVALID';return;}
  seen.add(path);file.ondata=(error,data)=>{
   if(error){failure='EPUB_INVALID';file.terminate();return;}
   if(entry.directory&&data.length){failure='EPUB_INVALID';file.terminate();return;}
   actual+=data.length;if(actual>epubSingleLimit||bookEpubBytes>epubBookLimit-actual){failure='EPUB_LIMIT';file.terminate();return;}
   if(!entry.directory&&/\.(?:opf|x?html|xml|ncx)$/i.test(path)){const list=chunks.get(path)||[];list.push(data.slice());chunks.set(path,list);}
  };
  try{file.start();}catch{failure='EPUB_COMPRESSION';}
 });
 unzip.register(UnzipInflate);unzip.register(UnzipPassThrough);
 try{unzip.push(bytes,true);}catch{failure||='EPUB_INVALID';}
 if(failure)throw new BookImportParseError(failure);
 if(seen.size!==entries.length)throw new BookImportParseError('EPUB_INVALID');
 for(const [path,parts] of chunks)saved.set(path,concat(parts));
 return {saved,actual};
}
function concat(parts:Uint8Array[]){const length=parts.reduce((n,part)=>n+part.length,0),value=new Uint8Array(length);let offset=0;for(const part of parts){value.set(part,offset);offset+=part.length;}return value;}
function xmlItems(xml:string,tagName:string){
 const values:{tag:string;attrs:Record<string,string>}[]=[];const parser=new Parser({onopentag(tag,attrs){if(tag===tagName)values.push({tag,attrs:attrs as Record<string,string>});}},{xmlMode:true,decodeEntities:true});parser.end(xml);return values;
}
function xmlText(xml:string,parentTag:string,childTag:string){
 const values:string[]=[];let parent=0,current='';const parser=new Parser({onopentag(tag){if(tag===parentTag)parent++;if(parent&&tag===childTag)current='';},ontext(value){if(parent)current+=value;},onclosetag(tag){if(parent&&tag===childTag&&current.trim())values.push(current.trim());if(tag===parentTag)parent=Math.max(0,parent-1);}},{xmlMode:true,decodeEntities:true});parser.end(xml);return values;
}
function epubPath(base:string,href:string){
 let value:string;try{value=decodeURIComponent(href.split(/[?#]/,1)[0]);}catch{throw new BookImportParseError('EPUB_PATH_INVALID');}if(!value||value.startsWith('/')||value.includes('\\')||/^[a-z][a-z0-9+.-]*:/i.test(value))throw new BookImportParseError('EPUB_PATH_INVALID');
 return safeZipPath([base,...value.split('/')].filter(Boolean).join('/'));
}
function navigation(bytes:Uint8Array|undefined,kind:'nav'|'ncx',base:string){
 if(!bytes)return new Map<string,string>();const xml=strFromU8(bytes),out=new Map<string,string>();
 if(kind==='nav'){
  let inside=0,href='',title='';const parser=new Parser({onopentag(tag,attrs){if(tag==='nav'&&(attrs['epub:type']==='toc'||attrs.type==='toc'))inside++;if(inside&&tag==='a'){href=attrs.href||'';title='';}},ontext(value){if(inside&&href)title+=value;},onclosetag(tag){if(inside&&tag==='a'&&href&&title.trim()){out.set(epubPath(base,href),title.trim().slice(0,120));href='';}if(tag==='nav'&&inside)inside--;}},{xmlMode:true,decodeEntities:true});parser.end(xml);
 }else{
  const hrefs=xmlItems(xml,'content'),titles=xmlText(xml,'navPoint','text');hrefs.forEach((item,index)=>{if(item.attrs.src&&titles[index])out.set(epubPath(base,item.attrs.src),titles[index].slice(0,120));});
 }
 return out;
}
function epubBlocks(bytes:Uint8Array,bookEpubBytes:number){
 const entries=centralDirectory(bytes),entryMap=new Map(entries.map(entry=>[entry.path,entry]));
 if(!entryMap.has('META-INF/container.xml'))throw new BookImportParseError('EPUB_INVALID');
 const {saved,actual}=unzipBounded(bytes,entries,bookEpubBytes),container=strFromU8(saved.get('META-INF/container.xml')||new Uint8Array());
 const rootfile=xmlItems(container,'rootfile')[0]?.attrs['full-path'];if(!rootfile)throw new BookImportParseError('EPUB_INVALID');
 const opfPath=safeZipPath(rootfile);if(!opfPath)throw new BookImportParseError('EPUB_PATH_INVALID');
 const opf=strFromU8(saved.get(opfPath)||new Uint8Array());if(!opf)throw new BookImportParseError('EPUB_INVALID');
 const base=opfPath.includes('/')?opfPath.slice(0,opfPath.lastIndexOf('/')):'';
 const items=new Map<string,{path:string;properties:string;media:string}>();for(const item of xmlItems(opf,'item')){if(!item.attrs.id||!item.attrs.href)continue;const path=epubPath(base,item.attrs.href);if(!entryMap.has(path))throw new BookImportParseError('EPUB_INVALID');items.set(item.attrs.id,{path,properties:item.attrs.properties||'',media:item.attrs['media-type']||''});}
 const navItem=[...items.values()].find(item=>item.properties.split(/\s+/).includes('nav'));
 const ncxItem=[...items.values()].find(item=>item.media==='application/x-dtbncx+xml');
 const nav=navigation(saved.get(navItem?.path||''),'nav',navItem?.path?.includes('/')?navItem.path.slice(0,navItem.path.lastIndexOf('/')):''),ncx=navigation(saved.get(ncxItem?.path||''),'ncx',ncxItem?.path?.includes('/')?ncxItem.path.slice(0,ncxItem.path.lastIndexOf('/')):'');
 const byHref=new Map([...ncx,...nav]);
 const spine=xmlItems(opf,'itemref').flatMap(item=>{const found=items.get(item.attrs.idref||'');return found&&/application\/(?:xhtml\+xml|html\+xml)|text\/html/i.test(found.media)?[found]:[];});
 if(!spine.length)throw new BookImportParseError('EPUB_BODY_MISSING');
 const blocks:ImportBlock[]=[];
 for(const item of spine){
  const data=saved.get(item.path);if(!data)throw new BookImportParseError('EPUB_INVALID');
  const parsed=htmlBlocks(strFromU8(data));if(!parsed.length)continue;
  const navTitle=byHref.get(item.path);if(navTitle){if(parsed[0].heading)parsed[0]={text:navTitle,heading:true};else parsed.unshift({text:navTitle,heading:true});}
  blocks.push(...parsed);
 }
 if(!blocks.length)throw new BookImportParseError('EPUB_BODY_MISSING');
 return {blocks,actual};
}

export function parseImportedSource(input:{bytes:Uint8Array;name:string;contentType?:string;encoding?:string;epubBytesUsed?:number}):ImportedSource{
 const extension=input.name.toLowerCase().split('.').at(-1),type=input.contentType?.split(';')[0].trim().toLowerCase();
 const format=extension==='epub'||type==='application/epub+zip'?'epub':extension==='html'||extension==='htm'||type==='text/html'?'html':extension==='txt'||type==='text/plain'?'txt':undefined;
 if(!format)throw new BookImportParseError('FORMAT_UNSUPPORTED');
 if(format==='epub'){
  if(input.encoding)throw new BookImportParseError('ENCODING_NOT_APPLICABLE');
  const {blocks,actual}=epubBlocks(input.bytes,input.epubBytesUsed||0);return {format,encoding:'utf-8',blocks,chapters:autoChapterStarts(blocks),epubBytes:actual};
 }
 const decoded=decodeImportedText(input.bytes,input.encoding);
 const blocks=format==='html'?htmlBlocks(decoded.text):decoded.text.replace(/\r\n?/g,'\n').split('\n').map(text=>text.trim()).filter(Boolean).map(text=>({text}));
 if(!blocks.length)throw new BookImportParseError('BODY_MISSING');
 return {format,encoding:decoded.encoding,blocks,chapters:autoChapterStarts(blocks),epubBytes:0};
}
