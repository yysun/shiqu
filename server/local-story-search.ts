import type {SuggestionProgress} from '../lib/reader-suggestions.ts';
// 独立索引只提供候选出处。文字与向量分别排名，原文始终由本地书库读取。
import {chmod,lstat,mkdir,mkdtemp,readFile,readdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {backup,DatabaseSync} from 'node:sqlite';
import {Converter} from 'opencc-js';
import {z} from 'zod';
import {localSourceKey,localSourceSchema} from '../lib/reader-local-contract.ts';
import type {LocalSourceReference} from '../lib/reader-local-contract.ts';
import {ReaderError,selectionSchema} from '../lib/reader-model.ts';
import type {LocalBook,LocalBooks} from './local-books.ts';
import {sourceParts} from './local-source-ranges.ts';
import {groundedStoryEvents,storyEventText} from './local-story-events.ts';
import {indexFilename,officialVectorDirectory,officialVectorFormat,storyCardsPath,storyIndexDirectory} from './story-index-paths.ts';

export const storyEmbeddingModel='qwen3-embedding:0.6b';
export const storyEmbeddingQuery=(text:string)=>`Instruct: Given a natural-language query in Chinese, retrieve stories whose plot satisfies it.\nQuery: ${text}`;
const simplify=Converter({from:'t',to:'cn'});
export const storySearchKey=(text:string)=>simplify(text.normalize('NFKC').toLowerCase()).replace(/[\p{P}\s]/gu,'');
type CardText={id:string;title:string;summary:string};
type Entry=CardText&{source:LocalSourceReference;text:string;displayTitle:string;displaySummary:string;vectors:Float32Array[];eventTerms:Set<string>;eventText:string};
type Snapshot={stamp:string;edition:string;bookId?:string;official?:boolean;references:Map<string,Float32Array>;entries:Entry[]};
const cardSchema=z.object({
 id:z.string().min(1),title:z.string().trim().min(1),summary:z.string().trim().min(1),
 source:localSourceSchema.omit({edition:true}),
});
export const storyCardsSchema=z.object({
 version:z.literal(1),bookId:z.string(),edition:localSourceSchema.shape.edition,cards:z.array(cardSchema).min(1),
});
export const storyIndexText=(book:LocalBook,source:LocalSourceReference)=>sourceParts(book,source)
 .flatMap(part=>part.units.map(unit=>unit.text)).join('');

export function applicationStorySearch(root:string,directory:string,books:()=>LocalBooks){
 return new LocalStorySearch(path.join(directory,'story-search.sqlite'),{
  root,book:id=>books().book(selectionSchema.parse({bookId:id,theme:'原典故事'})),
 });
}

function searchEntry(id:string,source:LocalSourceReference,text:string,title:string,summary:string,vectors:Float32Array[]):Entry{
 const displaySummary=summary.replace(/\s+/gu,' ').trim();
 return {id,source,text:storySearchKey(text),title:storySearchKey(title),summary:storySearchKey(displaySummary),
  displayTitle:title.trim(),displaySummary,vectors,eventTerms:new Set(),eventText:''};
}

function decode(value:unknown){
 return value instanceof Uint8Array&&value.byteLength>0&&value.byteLength%4===0?new Float32Array(value.slice().buffer):undefined;
}
const usableVector=(vector:Float32Array)=>vector.every(Number.isFinite)&&vector.some(value=>value!==0);
function load(file:string,stamp:string,strict=false,officialBook?:LocalBook):Snapshot|undefined{
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const identity=JSON.parse(String(db.prepare("SELECT value FROM metadata WHERE key='identity'").get()?.value));
  if(!/^[a-f0-9]{64}$/.test(identity?.edition))return;
  const bookId=db.prepare("SELECT value FROM metadata WHERE key='indexed_book'").get()?.value;
  if(officialBook&&identity.format!==officialVectorFormat)throw Error('官方向量包格式不受支持');
  if(officialBook&&(identity.edition!==officialBook.edition||bookId!==officialBook.id))return;
  const entries=new Map<string,Entry>();
  const columns=new Set(db.prepare('PRAGMA table_info(entries)').all().map(column=>column.name));
  const optional=['summary','raw_vector','vector'].map(name=>columns.has(name)?name:'NULL AS '+name);
  for(const row of db.prepare(`SELECT id,source,text,title,${optional.join(',')} FROM entries WHERE blocked IS NULL`).all()){
   try{
    const source=localSourceSchema.parse(JSON.parse(String(row.source)));
    if(source.edition!==identity.edition)throw Error('索引条目的原文版本不一致');
    const vectors=[decode(row.raw_vector),decode(row.vector)].filter(value=>value!==undefined);
    const id=String(row.id),text=officialBook?storyIndexText(officialBook,source):String(row.text);
    entries.set(id,searchEntry(id,source,text,String(row.title??''),String(row.summary??''),vectors));
   }catch(error){if(strict)throw error; /* 旧索引读取时跳过损坏的记录。 */}
  }
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='passages'").get()){
   for(const row of db.prepare('SELECT story_id,source_range,vector FROM passages WHERE vector IS NOT NULL').all()){
    const entry=entries.get(String(row.story_id)),vector=decode(row.vector);
    if(!entry||!vector)continue;
    try{if(localSourceKey(localSourceSchema.parse(JSON.parse(String(row.source_range))))===localSourceKey(entry.source))entry.vectors.push(vector);}
    catch{/* 已失效的片段不能给当前范围加权。 */}
   }
  }
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='event_cards'").get()){
   for(const row of db.prepare(`SELECT c.story_id,c.events,c.vectors,c.dimensions FROM event_cards c
    JOIN entries e ON e.id=c.story_id AND e.source=c.source_range`).all()){
    const entry=entries.get(String(row.story_id));
    if(!entry)continue;
    try{
     const events=groundedStoryEvents(JSON.parse(String(row.events)),entry.text,storySearchKey),vectors=decode(row.vectors),dimensions=Number(row.dimensions);
     if(!events?.length||!vectors||!Number.isSafeInteger(dimensions)||dimensions<1||vectors.length!==events.length*dimensions||!vectors.every(Number.isFinite))continue;
     for(const [index,event] of events.entries()){
      for(const term of [event.topic,...event.terms].map(storySearchKey))if(term)entry.eventTerms.add(term);
      entry.vectors.push(vectors.subarray(index*dimensions,(index+1)*dimensions));
     }
     entry.eventText=events.map(event=>storySearchKey(storyEventText(event))).join(' ');
    }catch{/* 已失效的事件卡不参与召回。 */}
   }
  }
  const references=new Map<string,Float32Array>(),digest=identity.digests?.[storyEmbeddingModel];
  if(digest&&db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='query_vectors'").get()){
   for(const row of db.prepare('SELECT key,vector FROM query_vectors WHERE model_digest=?').all(digest)){
   const vector=decode(row.vector);
   if(typeof row.key==='string'&&vector?.every(Number.isFinite)&&(!officialBook||vector.some(value=>value!==0)))references.set(row.key,vector);
   }
  }
  if(officialBook){
   const dimensions=new Set([...references.values()].map(vector=>vector.length));
   for(const entry of entries.values())entry.vectors=entry.vectors.filter(vector=>dimensions.has(vector.length)&&usableVector(vector));
  }
  return {stamp,edition:identity.edition,bookId:typeof bookId==='string'&&bookId.length<=100?bookId:undefined,
   official:identity.format===officialVectorFormat,references,entries:[...entries.values()]};
 }finally{db.close();}
}

function semanticCardCount(snapshot:Snapshot,book:LocalBook){
 const dimensions=new Set([...snapshot.references.values()].filter(usableVector).map(vector=>vector.length));
 if(!dimensions.size)return 0;
 const sources=new Set<string>();
 let hasVectors=false;
 for(const entry of snapshot.entries){
  try{sourceParts(book,entry.source);}catch{continue;}
  sources.add(localSourceKey(entry.source));
  hasVectors||=entry.vectors.some(vector=>dimensions.has(vector.length)&&usableVector(vector));
 }
 return hasVectors?sources.size:0;
}

// 调用方先归一化标题、梗概和查询。标题整句优先，字组按当前范围的出现频率加权。
export function rankStoryCardText<T extends CardText>(rows:readonly T[],phrase:string,limit:number){
 if(!phrase||!rows.length)return [];
 const chars=Array.from(phrase);
 const grams=new Set([2,3].flatMap(width=>chars.slice(width-1).map((_,i)=>chars.slice(i,i+width).join(''))));
 const terms=[...grams].map(term=>{
  const count=rows.filter(({title,summary})=>title.includes(term)||summary.includes(term)).length;
  return {term,weight:Math.log1p(rows.length/Math.max(count,1))};
 });
 const labels=['card-terms','summary-phrase','title-phrase','title-exact'] as const;
 return rows.map(row=>{
  const {title,summary}=row;
  const tier=title===phrase?3:title.includes(phrase)?2:summary.includes(phrase)?1:0;
  const score=terms.reduce((sum,{term,weight})=>sum+weight*(title.includes(term)?1.5:summary.includes(term)?1:0),0);
  return {row,tier,score,representation:labels[tier]};
 }).filter(({tier,score})=>tier||score).sort((a,b)=>b.tier-a.tier||b.score-a.score||a.row.id.localeCompare(b.row.id)).slice(0,limit);
}

function lexical(entry:Entry,phrase:string,terms:readonly string[]){
 if(entry.title===phrase)return 200+phrase.length;
 if(entry.title.includes(phrase))return 100+phrase.length;
 if(entry.eventTerms.has(phrase))return 80+phrase.length;
 if(entry.text.includes(phrase)||entry.eventText.includes(phrase)||[...entry.eventTerms].some(term=>term.includes(phrase)))return 50+phrase.length;
  // 有梗概时，标题的零散字组由轻量卡排名处理，完整标题仍保留优先级。
 return terms.reduce((score,term)=>score+(!entry.summary&&entry.title.includes(term)?2:entry.text.includes(term)||entry.eventText.includes(term)?1:0),0);
}
function similarity(vectors:Float32Array[],needle:Float32Array|undefined){
 let best=-Infinity;
 if(needle)for(const vector of vectors){
  if(vector.length!==needle.length)continue;
  let score=0;
  for(let i=0;i<vector.length;i++)score+=vector[i]*needle[i];
  best=Math.max(best,score);
 }
 return best;
}

// 安装时从 SQLite 事务快照复制，核对书名、版次与出处后再原子替换本书索引。
export async function installStoryIndex(directory:string,book:LocalBook,source:string){
 return installIndex(path.join(directory,storyIndexDirectory),directory,book,source,false);
}
export async function installOfficialStoryIndex(cache:string,book:LocalBook,source:string){
 await mkdir(cache,{recursive:true,mode:0o700});
 if(!(await lstat(cache)).isDirectory())throw new ReaderError(400,'官方索引缓存必须是普通目录。');
 return installIndex(path.join(cache,book.edition),cache,book,source,true);
}
async function installIndex(indexes:string,stagingRoot:string,book:LocalBook,source:string,official:boolean){
 const invalid=(message:string)=>new ReaderError(400,message);
 const info=await lstat(source).catch(()=>null);
 if(!info?.isFile()||info.nlink!==1)throw invalid('请选择一个独立的 SQLite 索引文件。');
 await mkdir(indexes,{recursive:true,mode:0o700});
 if(!(await lstat(indexes)).isDirectory())throw invalid('故事索引目录必须是普通目录。');
 const staged=await mkdtemp(path.join(stagingRoot,'.story-index-install-'));
 try{
  const copy=path.join(staged,'index.sqlite');
  let snapshot:Snapshot|undefined;
  try{
   const db=new DatabaseSync(source,{readOnly:true});
   try{await backup(db,copy);}finally{db.close();}
   const check=new DatabaseSync(copy);
   try{
    check.exec('PRAGMA journal_mode=DELETE');
    if(check.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('SQLite integrity check failed');
   }finally{check.close();}
   snapshot=load(copy,'',true,official?book:undefined);
  }catch{throw invalid('索引文件不可读或格式不受支持。');}
  if(snapshot?.bookId!==book.id||snapshot.edition!==book.edition)throw invalid('索引书名或原文版本与本地书库不一致。');
  if(!official&&snapshot.official)throw invalid('官方向量包请用 books index-install 安装。');
  if(!snapshot.entries.length)throw invalid('索引没有可用的故事条目。');
  try{for(const entry of snapshot.entries)sourceParts(book,entry.source);}
  catch{throw invalid('索引包含无法在本地书籍定位的出处。');}
  if(official&&!semanticCardCount(snapshot,book))throw invalid('官方索引没有可用的参考向量和故事向量。');
  const target=path.join(indexes,indexFilename(book.id));
  await chmod(copy,0o600);
  await rename(copy,target);
  return {bookId:book.id,edition:book.edition,path:target,entries:snapshot.entries.length};
 }finally{await rm(staged,{recursive:true,force:true});}
}

export class LocalStorySearch{
 private snapshot?:{file:string;value:Snapshot};
 private readonly officialCounts=new Map<string,{stamp:string;count:number}>();
 private cards?:{book:LocalBook;value:Promise<Snapshot|null>};
 private readonly file:string;
 private readonly resources?:{root:string;book:(id:string)=>Promise<LocalBook|null>;cache?:string};
 constructor(file:string,resources?:LocalStorySearch['resources']){
  this.file=file;
  this.resources=resources;
 }
 async candidates(book:LocalBook,query:string,signal:AbortSignal,byTitle=false){
  return await this.lookup(book,query,signal,byTitle)||[];
 }
 async indexedBooks(){
  const directory=path.join(path.dirname(this.file),storyIndexDirectory);
  const files=await readdir(directory,{withFileTypes:true}).catch(()=>[]);
  const ids=new Set<string>();
  for(const file of files){
   const id=this.indexBookId(file);
   if(id)ids.add(id);
  }
  const legacy=await this.readSnapshot(this.file);
  if(legacy?.bookId)ids.add(legacy.bookId);
  return ids.size||legacy?[...ids]:null;
 }
 async semanticBooks(){
  const installed=await this.indexedBooks();
  return [...new Set([...(installed||[]),...await this.officialBooks()])];
 }
 async officialBooks(){
  // 仅检查可能有向量的文件，避免为目录页读入全部内置故事卡。
  if(!this.resources)return [];
  const cache=this.resources.cache??officialVectorDirectory();
  const editions=await readdir(cache,{withFileTypes:true}).catch(()=>[]);
  const ids=new Set<string>();
  for(const edition of editions){
   if(!edition.isDirectory()||!(/^[a-f0-9]{64}$/).test(edition.name))continue;
   for(const file of await readdir(path.join(cache,edition.name),{withFileTypes:true}).catch(()=>[])){
    const id=this.indexBookId(file);
    if(id)ids.add(id);
   }
  }
  return [...ids];
 }
 async hasBundledCards(){
  if(!this.resources)return false;
  const files=await readdir(path.join(this.resources.root,storyCardsPath),{withFileTypes:true}).catch(()=>[]);
  return files.some(file=>file.isFile()&&file.name.endsWith('.json'));
 }
 async semanticIndexCardCount(book:LocalBook){
  const custom=await this.customSnapshot(book);
  if(custom)return semanticCardCount(custom,book);
  if(!this.resources)return 0;
  const filename=this.officialFile(book),stamp=await this.fileStamp(filename);
  if(!stamp)return 0;
  const cached=this.officialCounts.get(filename);
  if(cached?.stamp===stamp)return cached.count;
  const wholeBook=await this.resources.book(book.id);
  if(wholeBook?.edition!==book.edition)return 0;
  await this.readSnapshot(filename,wholeBook,stamp);
  return this.officialCounts.get(filename)?.count??0;
 }
 // 目录只列出可供手动勾选的故事段落，查询不会修改已选范围。
 async passages(book:LocalBook,terms:readonly string[]){
  const snapshot=await this.snapshotFor(book);
  if(!snapshot)return [];
  const keys=terms.map(storySearchKey).filter(Boolean);
  return snapshot.entries.filter(entry=>entry.displayTitle&&keys.every(key=>entry.title.includes(key)||entry.summary.includes(key)||entry.text.includes(key)));
 }
 private indexBookId(file:{name:string;isFile:()=>boolean}){
  if(!file.isFile()||!file.name.endsWith('.sqlite'))return;
  try{
   const id=decodeURIComponent(file.name.slice(0,-7));
   if(id&&indexFilename(id)===file.name)return id;
  }catch{/* 跳过名称无法解码的文件。 */}
 }
 private async customSnapshot(book:LocalBook){
  const indexed=await this.readSnapshot(path.join(path.dirname(this.file),storyIndexDirectory,indexFilename(book.id)));
  if(indexed?.bookId===book.id&&indexed.edition===book.edition&&!indexed.official)return indexed;
  const legacy=await this.readSnapshot(this.file);
  return legacy?.edition===book.edition&&!legacy.official&&(!legacy.bookId||legacy.bookId===book.id)?legacy:null;
 }
 private officialFile(book:LocalBook){
  return path.join(this.resources?.cache??officialVectorDirectory(),book.edition,indexFilename(book.id));
 }
 private async snapshotFor(book:LocalBook){
  const custom=await this.customSnapshot(book);
  if(custom)return custom;
  if(!this.resources)return null;
  const wholeBook=await this.resources.book(book.id);
  if(wholeBook?.edition!==book.edition)return null;
  const official=await this.readSnapshot(this.officialFile(wholeBook),wholeBook);
  if(official)return official;
  if(this.cards?.book!==wholeBook)this.cards={book:wholeBook,value:this.readCards(wholeBook,this.resources.root)};
  return this.cards.value;
 }
 private async readCards(book:LocalBook,root:string):Promise<Snapshot|null>{
  try{
   const file=path.join(root,storyCardsPath,encodeURIComponent(book.id)+'.json');
   const data=storyCardsSchema.parse(JSON.parse(await readFile(file,'utf8')));
   if(data.bookId!==book.id||data.edition!==book.edition)return null;
   const entries=data.cards.map(card=>{
    const source={...card.source,edition:book.edition};
    return searchEntry(card.id,source,storyIndexText(book,source),card.title,card.summary,[]);
   });
   return {stamp:'',edition:book.edition,bookId:book.id,references:new Map(),entries};
  }catch{return null;}
 }
 private async fileStamp(filename:string){
  try{
   const [file,wal]=await Promise.all([lstat(filename),lstat(filename+'-wal').catch(()=>undefined)]);
   if(!file.isFile()||file.nlink!==1||wal&&!wal.isFile())return null;
   return [file.ino,file.ctimeMs,file.mtimeMs,file.size,wal?.ctimeMs,wal?.mtimeMs,wal?.size].join('/');
  }catch{return null;}
 }
 private async readSnapshot(filename:string,officialBook?:LocalBook,knownStamp?:string){
  const stamp=knownStamp??await this.fileStamp(filename);
  if(!stamp)return null;
  try{
   if(this.snapshot?.file===filename&&this.snapshot.value.stamp===stamp)return this.snapshot.value;
   const value=load(filename,stamp,!!officialBook,officialBook);
   if(officialBook){
    const count=value?semanticCardCount(value,officialBook):0;
    this.officialCounts.set(filename,{stamp,count});
    if(!count)return null;
   }
   if(!value)return null;
   this.snapshot={file:filename,value};
   return value;
  }catch{
   if(officialBook)this.officialCounts.set(filename,{stamp,count:0});
   return null;
  }
 }
 async lookup(book:LocalBook,query:string,signal:AbortSignal,byTitle=false){
  const hits=await this.lookupHits(book,query,signal,byTitle);
  return hits?.map(({source})=>source)??null;
 }
 async lookupHits(book:LocalBook,query:string,signal:AbortSignal,byTitle=false,limit=42,onRetrieval?:(route:NonNullable<SuggestionProgress['retrieval']>)=>void,themeTerms:readonly string[]=[]){
  signal.throwIfAborted();
  const snapshot=await this.snapshotFor(book);
  signal.throwIfAborted();
  if(!snapshot||snapshot.edition!==book.edition){onRetrieval?.('no-index');return null;}
  const topic=byTitle?query:query.replace(/^(?:请|帮我|请帮我)?\s*(?:列一下|列出|找出?|有哪些)\s*/u,'').replace(/(?:的)?(?:故事|情节)(?:有哪些)?[？?。！!]*$/u,'').trim();
  const phrase=storySearchKey(topic||query);
  if(!phrase)return [];
  const chars=Array.from(phrase);
  const terms=themeTerms.length?themeTerms:[...new Set(chars.slice(1).map((char,index)=>chars[index]+char))];
  const scoped=snapshot.entries.flatMap(entry=>{
   try{sourceParts(book,entry.source);return [entry];}catch{return [];}
  });
  if(!scoped.length){onRetrieval?.('no-candidates');return [];}
  const needle=snapshot.references.get(storySearchKey(query))||snapshot.references.get(phrase);
  signal.throwIfAborted();
  const scores=scoped.map(entry=>({entry,lexical:lexical(entry,phrase,terms),semantic:similarity(entry.vectors,needle),
   coverage:themeTerms.filter(term=>entry.title.includes(term)||entry.summary.includes(term)||entry.text.includes(term)||entry.eventText.includes(term)||entry.eventTerms.has(term)).length}));
  const exact=scores.filter(row=>row.lexical>=50).sort((a,b)=>b.lexical-a.lexical);
  const text=scores.filter(row=>themeTerms.length?row.coverage>0:row.lexical>0).sort((a,b)=>b.coverage-a.coverage||b.lexical-a.lexical).slice(0,30);
  const cards=themeTerms.length?[]:rankStoryCardText(scoped.filter(entry=>entry.summary),phrase,30);
  const semantic=scores.filter(row=>Number.isFinite(row.semantic)).sort((a,b)=>b.semantic-a.semantic).slice(0,limit>42?limit:40);
  onRetrieval?.(semantic.length?'hybrid':needle?'no-compatible-vectors':'no-query-vector');
  const fused=new Map<string,{entry:Entry;score:number}>();
  for(const lane of [text,semantic])lane.forEach(({entry},index)=>{
   const key=localSourceKey(entry.source),row=fused.get(key)||{entry,score:0};
   row.score+=1/(20+index+1);fused.set(key,row);
  });
  const ranked=[...fused.values()].sort((a,b)=>b.score-a.score);
  const base=new Map<string,Entry>();
  for(const {entry} of [...exact.slice(0,3),...semantic.slice(0,3),...ranked])base.set(localSourceKey(entry.source),entry);
  const primary=[...base.values()],cardEntries=cards.map(({row})=>row);
  // 原文和梗概描述常有重叠。轻量卡独立补入候选，避免同一事实重复计分。
  // 两侧均有字词命中的候选优先；完整主题的向量仍可召回没有同词的故事。
  const both=text.filter(row=>row.coverage===2).map(({entry})=>entry);
  const candidates=[...both,...primary.slice(0,3),...cardEntries.slice(0,2),...primary.slice(3),...cardEntries.slice(2)];
  const unique=new Map(candidates.map(entry=>[localSourceKey(entry.source),entry]));
  return [...unique.values()].slice(0,limit).map(({source,displayTitle,displaySummary})=>({source,title:displayTitle,...(displaySummary?{summary:displaySummary}:{})}));
 }
}
