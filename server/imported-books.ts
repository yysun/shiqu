// 管理用户导入书的不可变原件、章节清单与本地书对象。
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {lstat,mkdir,open,readFile,readdir,realpath,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {ReaderError} from '../lib/reader-model.ts';
import {localLines} from './local-book-parsers.ts';
import {sourceAnomalyReasons} from './local-source-quality.ts';
import {parseImportedSource,bookImportParserVersion,epubBookLimit} from './book-import-parse.ts';
import type {ImportBlock,ImportedSource} from './book-import-parse.ts';
import {BookImportFetchError,fetchImportUrls,importBookBytesLimit,importSourceCountLimit,importSourceLimit} from './book-import-fetch.ts';
import type {LocalBook,LocalSection,LocalUnit} from './local-books.ts';
import {sourceParts} from './local-source-ranges.ts';
import {localSourceSchema} from '../lib/reader-local-contract.ts';
import {storyCardsSchema} from './local-story-search.ts';

const importedId=/^my-[a-f0-9]{16}$/;
const sourceSchema=z.object({file:z.string().regex(/^originals\/\d{3}\.(?:txt|html|htm|epub)$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().positive().max(importSourceLimit),originalName:z.string().min(1).max(255),sourceUrl:z.string().url().optional(),contentType:z.enum(['text/plain','text/html','application/epub+zip']),encoding:z.string().max(20).optional(),fetchedAt:z.string().datetime(),epubBytes:z.number().int().min(0).max(epubBookLimit)});
export const importedStructureSchema=z.object({chapters:z.array(z.object({sourceIndex:z.number().int().min(0).max(importSourceCountLimit-1),block:z.number().int().min(0).max(100000),title:z.string().trim().min(1).max(120),excluded:z.boolean().default(false)})).max(2000)}).strict();
export const importedBookManifestSchema=z.object({version:z.literal(1),bookId:z.string().regex(importedId),title:z.string().trim().min(1).max(100),author:z.string().max(100).default(''),era:z.string().max(100).default(''),sourceNote:z.string().max(1000).default(''),license:z.string().max(1000).default(''),rightsAcceptedAt:z.string().datetime(),sources:z.array(sourceSchema).max(importSourceCountLimit),snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),parserVersion:z.string().min(1).max(50),structure:importedStructureSchema,structureHash:z.string().regex(/^[a-f0-9]{64}$/),edition:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(['structuring','ready']),quality:z.object({emptySections:z.number().int().min(0),shortSections:z.number().int().min(0),unreadableUnits:z.number().int().min(0),missingMarkers:z.number().int().min(0)}).default({emptySections:0,shortSections:0,unreadableUnits:0,missingMarkers:0})}).strict();
const importedCardCacheKeysSchema=z.object({version:z.literal(1),bookId:z.string().regex(importedId),keys:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100000)}).strict();
export type ImportedBookManifest=z.infer<typeof importedBookManifestSchema>;
export type ImportedBookSummary={id:string;title:string;author:string;era:string;status:'ready'|'structuring'|'unavailable';sources:number;chapters:number;edition?:string;quality?:ImportedBookManifest['quality'];error?:string};
type DraftMetadata={title:string;author?:string;era?:string;sourceNote?:string;license?:string;acceptRights:true};
type StoredSource={receipt:z.infer<typeof sourceSchema>;parsed:ImportedSource};
type ImportedChapterPreview=ImportedBookManifest['structure']['chapters'][number]&{chars:number;excerpt:string;quality:{empty:boolean;short:boolean;unreadableUnits:number;missingMarkers:number};flaggedUnits:{id:string;text:string;flags:string[]}[]};

function digest(value:unknown){return createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function id(){return `my-${randomBytes(8).toString('hex')}`;}
function safeFilename(value:string){return path.posix.basename(value.replace(/\\/g,'/')).replace(/[\r\n\0]/g,'').slice(0,255)||'source.txt';}
function extension(format:ImportedSource['format']){return format==='html'?'html':format;}
function contentType(format:ImportedSource['format']){return format==='epub'?'application/epub+zip':format==='html'?'text/html':'text/plain';}
function defaultStructure(sources:StoredSource[]){
 return {chapters:sources.flatMap((source,sourceIndex)=>source.parsed.chapters.map(chapter=>({sourceIndex,block:chapter.block,title:chapter.title,excluded:false})))};
}
function snapshot(sources:ImportedBookManifest['sources']){return digest(sources.map(({sha256,size,sourceUrl})=>[sha256,size,sourceUrl||'']));}
function validateStructure(value:unknown,sources:StoredSource[]){
 const parsed=importedStructureSchema.parse(value);
 if(sources.length&&!parsed.chapters.length)throw new ReaderError(400,'至少设置一个章节起点。');
 const previous=-1;let last=previous;
 for(const chapter of parsed.chapters){
  const source=sources[chapter.sourceIndex];if(!source||chapter.block>=source.parsed.blocks.length)throw new ReaderError(400,'章节起点不属于已导入原文。');
  const position=chapter.sourceIndex*100001+chapter.block;if(position<=last)throw new ReaderError(400,'章节起点必须按原文顺序排列且不能重复。');last=position;
 }
 for(let index=0;index<sources.length;index++)if(!parsed.chapters.some(chapter=>chapter.sourceIndex===index))throw new ReaderError(400,'每个来源都必须从一个章节起点开始。');
 return parsed;
}
function sectionsFrom(sources:StoredSource[],structure:ImportedBookManifest['structure'],bookId:string,title:string,provider:string,url:string){
 const prefix=bookId.slice(-8),allStarts=structure.chapters,starts=allStarts.filter(chapter=>!chapter.excluded),sections:LocalSection[]=[];let totalChars=0,unreadableUnits=0,missingMarkers=0,emptySections=0,shortSections=0;
 if(!starts.length)throw new ReaderError(400,'至少保留一个可用章节。');
 const chapters:ImportedChapterPreview[]=[];
 for(const [chapterIndex,chapter] of allStarts.entries()){
  const next=allStarts[allStarts.indexOf(chapter)+1],rows:ImportBlock[]=[];
  for(let sourceIndex=chapter.sourceIndex;sourceIndex<=Math.min(next?.sourceIndex??sources.length-1,sources.length-1);sourceIndex++){
   const blocks=sources[sourceIndex].parsed.blocks,begin=sourceIndex===chapter.sourceIndex?chapter.block:0,end=next&&sourceIndex===next.sourceIndex?next.block:blocks.length;
   rows.push(...blocks.slice(begin,end));
  }
  if(rows[0]?.heading)rows.shift();
  const texts=rows.flatMap(block=>localLines(block.text)),included=!chapter.excluded,sectionIndex=sections.length,sectionId=`${prefix}-${String(sectionIndex+1).padStart(3,'0')}`,diagnosticId=included?sectionId:`${prefix}-excluded-${String(chapterIndex+1).padStart(3,'0')}`,flaggedUnits:{id:string;text:string;flags:string[]}[]=[];
  const missingPattern=/(?:\[缺文\]|\[缺字\]|\[原缺\]|□)/u,missingCount=texts.filter(text=>missingPattern.test(text)||sourceAnomalyReasons(text).includes('editorial-omission')).length,unreadableCount=texts.filter(text=>sourceAnomalyReasons(text).length>0).length,chars=rows.reduce((sum,block)=>sum+Array.from(block.text).length,0),empty=!texts.length,short=texts.join('').length<100;
  const units:LocalUnit[]=texts.map((text,index)=>{
   const reasons=sourceAnomalyReasons(text),hasMissingMarker=missingPattern.test(text),unreadable=reasons.length>0,id=`${diagnosticId}-${String(index+1).padStart(4,'0')}`;
   if(included)totalChars+=Array.from(text).length;
   if(reasons.length||hasMissingMarker)flaggedUnits.push({id,text,flags:[...reasons,...(hasMissingMarker?['missing-marker']:[])]});
   return {id,text,unreadable,url,provider};
  });
  chapters.push({...chapter,chars,excerpt:rows.find(row=>!row.heading)?.text.slice(0,220)||'',quality:{empty,short,unreadableUnits:unreadableCount,missingMarkers:missingCount},flaggedUnits});
  if(included){if(empty)emptySections++;if(short)shortSections++;unreadableUnits+=unreadableCount;missingMarkers+=missingCount;sections.push({id:sectionId,title:chapter.title,units,url,provider});}
 }
 if(totalChars>3_000_000)throw new ReaderError(413,'导入书超过 300 万字上限。');
 if(sections.length>2000)throw new ReaderError(413,'导入书超过 2,000 章上限。');
 return {sections,chapters,quality:{emptySections,shortSections,unreadableUnits,missingMarkers}};
}
async function writeAtomic(file:string,bytes:Uint8Array){
 await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp',handle=await open(temp,'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 try{await rename(temp,file);}finally{await rm(temp,{force:true});}
}
async function writeJson(file:string,value:unknown){await writeAtomic(file,new TextEncoder().encode(JSON.stringify(value,null,2)+'\n'));}
function formatError(error:unknown){return error instanceof Error?error.message:'导入书不可用。';}
function importFetchFailure(error:BookImportFetchError){
 const labels:Record<string,string>={URL_INVALID:'地址格式无效',PRIVATE_ADDRESS:'目标不是公网地址',DNS_FAILED:'域名解析失败',HTTP_STATUS:'网页返回非成功状态',CONTENT_TYPE:'网页内容类型不受支持',REDIRECT_LIMIT:'重定向次数超过上限',REDIRECT_INVALID:'重定向地址无效',SIZE_LIMIT:'单个网页超过 12 MB 上限',BOOK_SIZE_LIMIT:'全部来源合计超过 64 MiB 上限',SOURCE_COUNT_LIMIT:'来源数量超过 100 个上限',TOTAL_TIMEOUT:'整次网页抓取超过 5 分钟上限',PAGE_TIMEOUT:'单页网页抓取超过 30 秒上限',EMPTY_RESPONSE:'网页没有返回内容',FETCH_FAILED:'网页连接失败',CANCELLED:'网页抓取已取消'};
 let url=error.url;try{const parsed=new URL(error.url);url=`${parsed.origin}${parsed.pathname}`;}catch{url=url.slice(0,240);}
 const status=['SIZE_LIMIT','BOOK_SIZE_LIMIT','SOURCE_COUNT_LIMIT'].includes(error.message)?413:error.message.includes('TIMEOUT')?408:400;
 return new ReaderError(status,`网页导入失败：${url}（${labels[error.message]||'抓取失败'}）。`);
}

export class ImportedBooks{
 readonly libraryDirectory:string;readonly booksDirectory:string;
 private recoveryReady=false;private readonly recoveryErrors=new Map<string,string>();
 constructor(libraryDirectory:string){this.libraryDirectory=path.resolve(libraryDirectory);this.booksDirectory=path.join(this.libraryDirectory,'books');}
 private bookPath(bookId:string){if(!importedId.test(bookId))throw new ReaderError(400,'导入书 ID 无效。');return path.join(this.booksDirectory,bookId);}
 private draftPath(draftId:string){if(!importedId.test(draftId))throw new ReaderError(400,'导入草稿 ID 无效。');return path.join(this.libraryDirectory,`.book-import-${draftId}`);}
 private async recoverReplacements(){
  await mkdir(this.libraryDirectory,{recursive:true});await mkdir(this.booksDirectory,{recursive:true});this.recoveryErrors.clear();const entries=await readdir(this.libraryDirectory,{withFileTypes:true}),failed=new Set<string>();
  for(const entry of entries){const match=/^\.book-replace-(my-[a-f0-9]{16})-[a-f0-9-]{36}$/.exec(entry.name);if(!match)continue;const bookId=match[1];if(failed.has(bookId))continue;const backup=path.join(this.libraryDirectory,entry.name),target=this.bookPath(bookId);
   try{
    if(await exists(target)){
     let targetIsValid=true;try{await this.validateReadyBookAt(target,bookId);}catch{targetIsValid=false;}
     if(targetIsValid){try{await rm(backup,{recursive:true,force:true});}catch{/* 新版已完整校验，旧备份留待下次清理，不影响读取。 */}continue;}
    }
    await this.validateReadyBookAt(backup,bookId);if(await exists(target))await rm(target,{recursive:true,force:true});await rename(backup,target);await this.validateReadyBookAt(target,bookId);
   }catch(error){this.recoveryErrors.set(bookId,formatError(error));failed.add(bookId);}
  }
  this.recoveryReady=true;
 }
 private async ensureRecovery(){if(!this.recoveryReady)await this.recoverReplacements();}
 private assertRecovered(bookId:string){const failure=this.recoveryErrors.get(bookId);if(failure)throw new ReaderError(503,`导入书替换恢复失败，书目暂不可用：${failure}`);}
 async cleanup(){
  await this.recoverReplacements();const entries=await readdir(this.libraryDirectory,{withFileTypes:true});
  for(const entry of entries){if(entry.isDirectory()&&entry.name.startsWith('.book-delete-'))await rm(path.join(this.libraryDirectory,entry.name),{recursive:true,force:true});else if(entry.isDirectory()&&entry.name.startsWith('.book-import-')){const info=await stat(path.join(this.libraryDirectory,entry.name));if(Date.now()-info.mtimeMs>24*60*60*1000)await rm(path.join(this.libraryDirectory,entry.name),{recursive:true,force:true});}}
 }
 async createDraft(metadata:DraftMetadata){
  const parsed=z.object({title:z.string().trim().min(1).max(100),author:z.string().max(100).optional(),era:z.string().max(100).optional(),sourceNote:z.string().max(1000).optional(),license:z.string().max(1000).optional(),acceptRights:z.literal(true)}).strict().parse(metadata);
  await this.cleanup();const bookId=id(),directory=this.draftPath(bookId);await mkdir(path.join(directory,'originals'),{recursive:true,mode:0o700});
  const draft={version:1,bookId,title:parsed.title,author:parsed.author||'',era:parsed.era||'',sourceNote:parsed.sourceNote||'',license:parsed.license||'',rightsAcceptedAt:new Date().toISOString(),sources:[],snapshotHash:digest([]),parserVersion:bookImportParserVersion,structure:{chapters:[{sourceIndex:0,block:0,title:'第 1 部分',excluded:false}]},structureHash:digest([]),edition:digest([]),status:'structuring' as const,quality:{emptySections:0,shortSections:0,unreadableUnits:0,missingMarkers:0}};
  await writeJson(path.join(directory,'manifest.json'),draft);return {id:bookId,...parsed};
 }
 async discardDraft(draftId:string){await rm(this.draftPath(draftId),{recursive:true,force:true});}
 private async manifest(directory:string){try{const absolute=path.resolve(directory),expectedParent=absolute.startsWith(this.booksDirectory+path.sep)?this.booksDirectory:this.libraryDirectory,[parent,real]=await Promise.all([realpath(expectedParent),realpath(absolute)]),directoryInfo=await lstat(absolute);if(directoryInfo.isSymbolicLink()||!directoryInfo.isDirectory()||path.dirname(real)!==parent)throw Error();const file=path.join(real,'manifest.json'),info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw Error();return importedBookManifestSchema.parse(JSON.parse(await readFile(file,'utf8')));}catch(error){if(error instanceof ReaderError)throw error;throw new ReaderError(503,'导入书清单损坏或版本不受支持。');}}
 private async loadSources(directory:string,manifest:Pick<ImportedBookManifest,'sources'|'snapshotHash'>){
  const root=await realpath(directory),sources:StoredSource[]=[];let total=0,epubBytes=0;
  for(const receipt of manifest.sources){total+=receipt.size;epubBytes+=receipt.epubBytes;if(total>importBookBytesLimit||epubBytes>epubBookLimit)throw new ReaderError(503,'导入书超过资源上限。');
   const file=path.join(directory,receipt.file);const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error('原件路径无效。');const real=await realpath(file);if(!real.startsWith(root+path.sep))throw new Error('原件路径越界。');const bytes=new Uint8Array(await readFile(real));if(bytes.length!==receipt.size||digest(Buffer.from(bytes))!==receipt.sha256)throw new Error('原件校验失败。');
   const parsed=parseImportedSource({bytes,name:receipt.originalName,contentType:receipt.contentType,encoding:receipt.encoding,epubBytesUsed:epubBytes-receipt.epubBytes});if(parsed.epubBytes!==receipt.epubBytes)throw new Error('EPUB 解析版次不一致。');sources.push({receipt,parsed});
  }
  if(snapshot(manifest.sources)!==manifest.snapshotHash)throw new Error('导入快照校验失败。');return sources;
 }
 private materialize(manifest:ImportedBookManifest,sources:StoredSource[]){
  const structure=validateStructure(manifest.structure,sources),structureHash=digest(structure),edition=digest([manifest.snapshotHash,manifest.parserVersion,structureHash]);
  if(structureHash!==manifest.structureHash||edition!==manifest.edition)throw new Error('导入版次校验失败。');
  const first=manifest.sources[0],sourceUrl=manifest.sources.find(source=>source.sourceUrl)?.sourceUrl;
  const display=sourceUrl?`用户导入 · ${new URL(sourceUrl).hostname}`:`用户导入 · ${first.originalName}`;
  const {sections}=sectionsFrom(sources,structure,manifest.bookId,manifest.title,display,`local-import:${manifest.bookId}`);
  const text=sections.map(section=>`篇章 ${section.id}：${section.title}\n`+section.units.map(unit=>`[${unit.id}]\n${unit.text}`).join('\n\n')).join('\n\n');
  return {id:manifest.bookId,title:manifest.title,edition,url:sourceUrl||`local-import:${manifest.bookId}`,provider:display,sections,input:{title:manifest.title,edition,text},importedSourceDisclosure:{sourceNote:manifest.sourceNote,license:manifest.license,sources:manifest.sources.map(({originalName,sourceUrl})=>({originalName,...(sourceUrl?{sourceUrl}:{})}))}} satisfies LocalBook;
 }
 private async validateReadyBookAt(directory:string,bookId:string){
  const manifest=await this.manifest(directory);if(manifest.bookId!==bookId||manifest.status!=='ready')throw new Error('替换目录不是完整确认的书目。');const sources=await this.loadSources(directory,manifest);this.materialize(manifest,sources);
 }
 private async readCardCacheKeys(directory:string,bookId:string){
  const root=await realpath(directory),file=path.join(directory,'card-cache-keys.json');try{
   const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw Error();const [real,text]=await Promise.all([realpath(file),readFile(file,'utf8')]);if(!real.startsWith(root+path.sep))throw Error();const parsed=importedCardCacheKeysSchema.parse(JSON.parse(text));if(parsed.bookId!==bookId)throw Error();return parsed.keys;
  }catch{throw new ReaderError(503,'故事卡缓存键索引缺失或损坏，已停止删除或替换。');}
 }
 async registerCardCacheKey(bookId:string,key:string){
  await this.ensureRecovery();this.assertRecovered(bookId);if(!/^[a-f0-9]{64}$/.test(key))throw new ReaderError(400,'故事卡缓存键无效。');const directory=this.bookPath(bookId),manifest=await this.manifest(directory);if(manifest.status!=='ready')throw new ReaderError(409,'导入书尚未确认。');
  const keys=await this.readCardCacheKeys(directory,bookId);if(keys.includes(key))return;await writeJson(path.join(directory,'card-cache-keys.json'),importedCardCacheKeysSchema.parse({version:1,bookId,keys:[...keys,key]}));
 }
 async cardCacheKeysForCleanup(bookId:string){
  await this.ensureRecovery();this.assertRecovered(bookId);const directory=this.bookPath(bookId),manifest=await this.manifest(directory);if(manifest.status!=='ready')throw new ReaderError(409,'导入书尚未确认。');return this.readCardCacheKeys(directory,bookId);
 }
 async clearCardCacheKeys(bookId:string){
  await this.ensureRecovery();this.assertRecovered(bookId);const directory=this.bookPath(bookId),manifest=await this.manifest(directory);if(manifest.status!=='ready')throw new ReaderError(409,'导入书尚未确认。');await this.readCardCacheKeys(directory,bookId);await writeJson(path.join(directory,'card-cache-keys.json'),{version:1,bookId,keys:[]});
 }
 async appendSource(draftId:string,input:{bytes:Uint8Array;name:string;contentType?:string;sourceUrl?:string;fetchedAt?:string;encoding?:string}){
  const directory=this.draftPath(draftId),manifest=await this.manifest(directory);if(manifest.status!=='structuring')throw new ReaderError(409,'导入草稿已确认。');
  if(manifest.sources.length>=importSourceCountLimit)throw new ReaderError(413,'每本书最多导入 100 个来源。');
  const bytes=new Uint8Array(input.bytes);if(!bytes.length||bytes.length>importSourceLimit)throw new ReaderError(413,'单个文件或网页最多 12 MB。');
  const total=manifest.sources.reduce((sum,source)=>sum+source.size,0)+bytes.length;if(total>importBookBytesLimit)throw new ReaderError(413,'每本书原始字节合计最多 64 MiB。');
  const name=safeFilename(input.name),fallbackType=input.contentType||({txt:'text/plain',html:'text/html',htm:'text/html',epub:'application/epub+zip'} as Record<string,string>)[name.toLowerCase().split('.').at(-1)||'']||'application/octet-stream';
  const epubUsed=manifest.sources.reduce((sum,source)=>sum+source.epubBytes,0),parsed=parseImportedSource({bytes,name,contentType:fallbackType,encoding:input.encoding,epubBytesUsed:epubUsed});
  if(epubUsed+parsed.epubBytes>epubBookLimit)throw new ReaderError(413,'本书 EPUB 合计解压不得超过 256 MiB。');
  const index=manifest.sources.length,filename=`originals/${String(index+1).padStart(3,'0')}.${extension(parsed.format)}`,sha256=digest(Buffer.from(bytes));
  const receipt={file:filename,sha256,size:bytes.length,originalName:name, ...(input.sourceUrl?{sourceUrl:input.sourceUrl}:{}),contentType:contentType(parsed.format),...(parsed.format!=='epub'?{encoding:parsed.encoding}:{}),fetchedAt:input.fetchedAt||new Date().toISOString(),epubBytes:parsed.epubBytes};
  const nextSources=[...manifest.sources,sourceSchema.parse(receipt)],snapshotHash=snapshot(nextSources);await writeAtomic(path.join(directory,filename),bytes);const loaded=await this.loadSources(directory,{sources:nextSources,snapshotHash});
  const structure=defaultStructure(loaded),structureHash=digest(structure),edition=digest([snapshotHash,bookImportParserVersion,structureHash]);
  const next=importedBookManifestSchema.parse({...manifest,sources:nextSources,snapshotHash,parserVersion:bookImportParserVersion,structure,structureHash,edition});
  await writeJson(path.join(directory,'manifest.json'),next);return await this.preview(draftId);
 }
 async addUrls(draftId:string,urls:string[],signal?:AbortSignal,encoding?:string){
  const existing=await this.manifest(this.draftPath(draftId));let records;
  try{records=await fetchImportUrls(urls,{signal});}catch(error){if(error instanceof BookImportFetchError)throw importFetchFailure(error);throw error;}
  let preview,sourceCount=existing.sources.length;
  for(const record of records){if(sourceCount>=importSourceCountLimit)throw new ReaderError(413,'每本书最多导入 100 个来源。');const pathname=new URL(record.url).pathname,name=pathname.split('/').at(-1)||`page-${sourceCount+1}.${record.contentType==='text/html'?'html':'txt'}`,epub=record.contentType==='application/epub+zip'||name.toLowerCase().endsWith('.epub');preview=await this.appendSource(draftId,{...record,name,sourceUrl:record.url,...(!epub&&encoding?{encoding}:{})});sourceCount++;}
  return preview||this.preview(draftId);
 }
 async preview(draftId:string){
  const directory=this.draftPath(draftId),manifest=await this.manifest(directory);if(!manifest.sources.length)return {manifest,chapters:[]};const sources=await this.loadSources(directory,manifest),structure=validateStructure(manifest.structure,sources);
  const sourceUrl=manifest.sources.find(source=>source.sourceUrl)?.sourceUrl,first=manifest.sources[0],provider=sourceUrl?`用户导入 · ${new URL(sourceUrl).hostname}`:`用户导入 · ${first.originalName}`,measured=sectionsFrom(sources,structure,manifest.bookId,manifest.title,provider,sourceUrl||`local-import:${manifest.bookId}`);
  return {manifest:{...manifest,quality:measured.quality},chapters:measured.chapters};
 }
 async updateStructure(draftId:string,value:unknown){
  const directory=this.draftPath(draftId),manifest=await this.manifest(directory),sources=await this.loadSources(directory,manifest),structure=validateStructure(value,sources),snapshotHash=manifest.snapshotHash,structureHash=digest(structure),edition=digest([snapshotHash,bookImportParserVersion,structureHash]);
  const updated=importedBookManifestSchema.parse({...manifest,structure,structureHash,edition,parserVersion:bookImportParserVersion,status:'structuring'});await writeJson(path.join(directory,'manifest.json'),updated);return this.preview(draftId);
 }
 async confirm(draftId:string){
  const directory=this.draftPath(draftId),manifest=await this.manifest(directory),sources=await this.loadSources(directory,manifest),structure=validateStructure(manifest.structure,sources);
  if(manifest.rightsAcceptedAt==='')throw new ReaderError(400,'请先确认原文使用权。');
  const snapshotHash=manifest.snapshotHash,structureHash=digest(structure),edition=digest([snapshotHash,bookImportParserVersion,structureHash]),ready=importedBookManifestSchema.parse({...manifest,parserVersion:bookImportParserVersion,structure,structureHash,edition,status:'ready'}),book=this.materialize(ready,sources),quality=sectionsFrom(sources,structure,ready.bookId,ready.title,book.provider,book.url).quality;
  ready.quality=quality;if(quality.emptySections)throw new ReaderError(400,'结构中有空章节，请调整或排除后再确认。');
  await writeJson(path.join(directory,'card-cache-keys.json'),{version:1,bookId:ready.bookId,keys:[]});await writeJson(path.join(directory,'manifest.json'),ready);const target=this.bookPath(ready.bookId);if(await exists(target))throw new ReaderError(409,'导入书 ID 已存在。');await rename(directory,target);return {id:ready.bookId,title:ready.title,edition:ready.edition,status:'ready',chapters:book.sections.length,quality};
 }
 async readBook(bookId:string):Promise<LocalBook>{
  await this.ensureRecovery();this.assertRecovered(bookId);
  const directory=this.bookPath(bookId);
  try{const manifest=await this.manifest(directory);if(manifest.status!=='ready')throw new ReaderError(409,'这本书尚未确认章节结构。');const sources=await this.loadSources(directory,manifest);return this.materialize(manifest,sources);}
  catch(error){if(error instanceof ReaderError)throw error;throw new ReaderError(503,'这本书已删除或不可用，原件或版次校验失败。');}
 }
 async list():Promise<ImportedBookSummary[]>{
  await this.cleanup();const entries=await readdir(this.booksDirectory,{withFileTypes:true}),result:ImportedBookSummary[]=[];
  const listed=new Set<string>();for(const entry of entries){if(!entry.isDirectory()||!importedId.test(entry.name))continue;listed.add(entry.name);try{this.assertRecovered(entry.name);const manifest=await this.manifest(this.bookPath(entry.name));result.push({id:manifest.bookId,title:manifest.title,author:manifest.author,era:manifest.era,status:manifest.status,sources:manifest.sources.length,chapters:manifest.structure.chapters.filter(chapter=>!chapter.excluded).length,edition:manifest.edition,quality:manifest.quality});}catch(error){result.push({id:entry.name,title:entry.name,author:'',era:'',status:'unavailable',sources:0,chapters:0,error:formatError(error)});}}
  for(const [id,error] of this.recoveryErrors)if(!listed.has(id))result.push({id,title:id,author:'',era:'',status:'unavailable',sources:0,chapters:0,error:`替换恢复失败：${error}`});
  return result.sort((a,b)=>a.title.localeCompare(b.title,'zh-Hans-CN'));
 }
 async manifestFor(bookId:string){await this.ensureRecovery();this.assertRecovered(bookId);return this.manifest(this.bookPath(bookId));}
 async stamp(bookId:string){const file=path.join(this.bookPath(bookId),'manifest.json'),[manifest,info]=await Promise.all([this.manifestFor(bookId),stat(file)]);return `${manifest.edition}:${info.mtimeMs}:${info.size}`;}
 async readCards(bookId:string){
  const directory=this.bookPath(bookId),manifest=await this.manifest(directory);if(manifest.status!=='ready')return null;
  const root=await realpath(directory),file=path.join(directory,'cards.json');try{const fileInfo=await lstat(file);if(fileInfo.isSymbolicLink()||!fileInfo.isFile())throw Error();const [real,text]=await Promise.all([realpath(file),readFile(file,'utf8')]);if(!real.startsWith(root+path.sep))throw Error();const info=await stat(real);return {stamp:`${info.mtimeMs}:${info.size}`,value:JSON.parse(text) as unknown};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new ReaderError(503,'导入书故事卡文件损坏。');}
 }
 async delete(bookId:string){
  await this.ensureRecovery();this.assertRecovered(bookId);const source=this.bookPath(bookId),target=path.join(this.libraryDirectory,`.book-delete-${bookId}`);if(!(await exists(source)))throw new ReaderError(404,'导入书不存在。');await rename(source,target);await rm(target,{recursive:true,force:true});return {id:bookId,deleted:true};
 }
 async replace(bookId:string,draftId:string){
  await this.ensureRecovery();this.assertRecovered(bookId);
  const current=this.bookPath(bookId),staging=this.draftPath(draftId),manifest=await this.manifest(staging);if(manifest.status!=='structuring')throw new ReaderError(409,'替换草稿状态无效。');
  const old=await this.manifest(current),oldSources=await this.loadSources(current,old),oldBook=this.materialize(old,oldSources),sources=await this.loadSources(staging,manifest),updated=importedBookManifestSchema.parse({...manifest,bookId,title:manifest.title||old.title,status:'ready'}),snapshotHash=updated.snapshotHash,structureHash=digest(updated.structure),edition=digest([snapshotHash,bookImportParserVersion,structureHash]);
  const ready=importedBookManifestSchema.parse({...updated,parserVersion:bookImportParserVersion,structureHash,edition}),book=this.materialize(ready,sources),quality=sectionsFrom(sources,ready.structure,bookId,ready.title,book.provider,book.url).quality;ready.quality=quality;
  if(quality.emptySections)throw new ReaderError(400,'替换结构中有空章节。');
  const oldCards=await this.readCards(bookId),parsedCards=oldCards?storyCardsSchema.safeParse(oldCards.value):null;
  if(parsedCards?.success&&parsedCards.data.edition===old.edition){
   const fingerprint=(section:LocalSection)=>digest(section.units.map(unit=>unit.text)),oldCounts=new Map<string,number>(),newCounts=new Map<string,number>(),oldByFingerprint=new Map<string,LocalSection>(),newByFingerprint=new Map<string,LocalSection>();
   for(const section of oldBook.sections){const key=fingerprint(section);oldCounts.set(key,(oldCounts.get(key)||0)+1);oldByFingerprint.set(key,section);}
   for(const section of book.sections){const key=fingerprint(section);newCounts.set(key,(newCounts.get(key)||0)+1);newByFingerprint.set(key,section);}
   const carry=(sourceValue:unknown)=>{
    const source=localSourceSchema.safeParse(sourceValue);if(!source.success)return null;
    let parts;try{parts=sourceParts(oldBook,source.data);}catch{return null;}
    const ranges=[];
    for(const part of parts){const key=fingerprint(part.section),target=newByFingerprint.get(key);
     if(oldCounts.get(key)!==1||newCounts.get(key)!==1||oldByFingerprint.get(key)!==part.section||!target||target.units.length!==part.section.units.length)return null;
     ranges.push({sectionId:target.id,firstUnit:target.units[part.first].id,lastUnit:target.units[part.last].id});
    }
    if(!ranges.length)return null;const [first,...continuations]=ranges;return localSourceSchema.parse({...first,...(continuations.length?{continuations}:{}),edition:ready.edition});
   };
   const cards=parsedCards.data.cards.flatMap(card=>{const source=carry({...card.source,edition:old.edition});if(!source)return [];const {edition:_edition,...passage}=source;return [{...card,id:digest([card.title,passage]),source:passage}];});
   if(cards.length)await writeJson(path.join(staging,'cards.json'),storyCardsSchema.parse({version:1,bookId,edition:ready.edition,cards}));
   const oldProgressFile=path.join(current,'card-progress.json');let previousProgress:any;
   try{const info=await lstat(oldProgressFile);if(info.isSymbolicLink()||!info.isFile())throw Error();const {importedCardProgressSchema}=await import('./imported-book-cards.ts');previousProgress=importedCardProgressSchema.safeParse(JSON.parse(await readFile(oldProgressFile,'utf8')));previousProgress=previousProgress?.success&&previousProgress.data.edition===old.edition?previousProgress.data:null;}catch{previousProgress=null;}
   const priorById=new Map(previousProgress?.chapters?.map((chapter:any)=>[chapter.sectionId,chapter])||[]),progressChapters=book.sections.map(section=>{
    const key=fingerprint(section),priorOld=oldByFingerprint.get(key),carried=oldCounts.get(key)===1&&newCounts.get(key)===1&&priorOld?priorById.get(priorOld.id) as any:undefined;
    const status=carried?.status==='done'?'done':carried?.status==='failed'?'failed':'pending';
    return {sectionId:section.id,title:section.title,status,attempts:carried?.attempts||0,completedWindows:0,totalWindows:0,cacheKeys:[],...(status==='failed'&&carried?.failure?{failure:carried.failure}:{})};
   });
   const progress={version:1,bookId,edition:ready.edition,status:progressChapters.every(chapter=>chapter.status==='done')?'complete':'pending',updatedAt:new Date().toISOString(),provider:previousProgress?.provider,model:previousProgress?.model,chapters:progressChapters,calls:previousProgress?.calls||0,inputTokens:previousProgress?.inputTokens||0,outputTokens:previousProgress?.outputTokens||0,unknownUsage:previousProgress?.unknownUsage||0,durations:previousProgress?.durations||[]};
   const {importedCardProgressSchema}=await import('./imported-book-cards.ts');await writeJson(path.join(staging,'card-progress.json'),importedCardProgressSchema.parse(progress));
  }
  await writeJson(path.join(staging,'card-cache-keys.json'),{version:1,bookId,keys:[]});await writeJson(path.join(staging,'manifest.json'),ready);
  const backup=path.join(this.libraryDirectory,`.book-replace-${bookId}-${randomUUID()}`);await rename(current,backup);
  try{await rename(staging,current);await this.validateReadyBookAt(current,bookId);}catch(error){this.recoveryReady=false;await this.recoverReplacements();this.assertRecovered(bookId);throw error;}
  this.recoveryErrors.delete(bookId);this.recoveryReady=true;try{await rm(backup,{recursive:true,force:true});}catch{/* 新版已完整校验，旧备份留待下次清理，不影响读取。 */}
  return {id:bookId,title:ready.title,edition:ready.edition,status:'ready',chapters:book.sections.length,quality};
 }
 async rebindImportedId(draftId:string,bookId:string){
  const directory=this.draftPath(draftId),manifest=await this.manifest(directory);if(!importedId.test(bookId))throw new ReaderError(400,'导入书 ID 无效。');const next=importedBookManifestSchema.parse({...manifest,bookId});await writeJson(path.join(directory,'manifest.json'),next);return next;
 }
}
async function exists(file:string){try{await lstat(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
