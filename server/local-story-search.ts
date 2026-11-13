import type {SuggestionProgress} from '../lib/reader-suggestions.ts';
// 独立索引只提供候选出处。文字与向量分别排名，原文始终由本地书库读取。
// vectorsEnabled 区分未配置向量与已配置但暂不可用。
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
import {indexFilename,officialVectorFormat,storyCardsPath,storyIndexDirectory} from './story-index-paths.ts';
import {StoryCardEmbeddingStore} from './story-card-embeddings.ts';
import type {IndexableCard} from './story-card-embeddings.ts';

export const storyEmbeddingModel='qwen3-embedding:0.6b';
export const storyEmbeddingQuery=(text:string)=>`Instruct: Given a natural-language query in Chinese, retrieve stories whose plot satisfies it.\nQuery: ${text}`;
const simplify=Converter({from:'t',to:'cn'});
export const storySearchKey=(text:string)=>simplify(text.normalize('NFKC').toLowerCase()).replace(/[\p{P}\s]/gu,'');
type CardText={id:string;title:string;summary:string;aliases?:string[]};
type Entry=CardText&{source:LocalSourceReference;text:string;displayTitle:string;displaySummary:string};
type Snapshot={stamp:string;edition:string;bookId?:string;official?:boolean;entries:Entry[]};
const cardSchema=z.object({
 id:z.string().min(1),title:z.string().trim().min(1),summary:z.string().trim().min(1),
 aliases:z.array(z.string().trim().min(1).max(100)).max(20).optional(),
 source:localSourceSchema.omit({edition:true}),
});
export const storyCardsSchema=z.object({
 version:z.literal(1),bookId:z.string(),edition:localSourceSchema.shape.edition,cards:z.array(cardSchema).min(1),
});
export const storyIndexText=(book:LocalBook,source:LocalSourceReference)=>sourceParts(book,source)
 .flatMap(part=>part.units.map(unit=>unit.text)).join('');

export function applicationStorySearch(root:string,directory:string,books:()=>LocalBooks,fetcher:typeof fetch=fetch){
 return new LocalStorySearch(path.join(directory,'story-search.sqlite'),{
  root,book:id=>books().book(selectionSchema.parse({bookId:id,theme:'原典故事'})),
  embeddings:new StoryCardEmbeddingStore(directory,fetcher),
 });
}

function searchEntry(id:string,source:LocalSourceReference,text:string,title:string,summary:string,aliases:string[]=[]):Entry{
 const displaySummary=summary.replace(/\s+/gu,' ').trim();
 return {id,source,text:storySearchKey(text),title:storySearchKey(title),summary:storySearchKey(displaySummary),
  aliases:aliases.map(alias=>storySearchKey(alias)),displayTitle:title.trim(),displaySummary};
}
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
  const summary=columns.has('summary')?'summary':'NULL AS summary',aliases=columns.has('aliases')?'aliases':'NULL AS aliases';
  for(const row of db.prepare(`SELECT id,source,text,title,${summary},${aliases} FROM entries WHERE blocked IS NULL`).all()){
   try{
    const source=localSourceSchema.parse(JSON.parse(String(row.source)));
    if(source.edition!==identity.edition)throw Error('索引条目的原文版本不一致');
    const id=String(row.id),text=officialBook?storyIndexText(officialBook,source):String(row.text);
    const aliasList=typeof row.aliases==='string'?JSON.parse(row.aliases):[];
    entries.set(id,searchEntry(id,source,text,String(row.title??''),String(row.summary??''),Array.isArray(aliasList)?aliasList.filter((item):item is string=>typeof item==='string'):[]));
   }catch(error){if(strict)throw error; /* 旧索引读取时跳过损坏的记录。 */}
  }
  return {stamp,edition:identity.edition,bookId:typeof bookId==='string'&&bookId.length<=100?bookId:undefined,
   official:identity.format===officialVectorFormat,entries:[...entries.values()]};
 }finally{db.close();}
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
 if(entry.title===phrase||entry.aliases?.includes(phrase))return 200+phrase.length;
 if(entry.title.includes(phrase))return 100+phrase.length;
 if(entry.text.includes(phrase))return 50+phrase.length;
  // 有梗概时，标题的零散字组由轻量卡排名处理，完整标题仍保留优先级。
 return terms.reduce((score,term)=>score+(!entry.summary&&entry.title.includes(term)?2:entry.text.includes(term)?1:0),0);
}

// 安装时从 SQLite 事务快照复制，核对书名、版次与出处后再原子替换本书索引。
export async function installStoryIndex(directory:string,book:LocalBook,source:string){
 return installIndex(path.join(directory,storyIndexDirectory),directory,book,source);
}
async function installIndex(indexes:string,stagingRoot:string,book:LocalBook,source:string){
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
   snapshot=load(copy,'',true);
  }catch{throw invalid('索引文件不可读或格式不受支持。');}
  if(snapshot?.bookId!==book.id||snapshot.edition!==book.edition)throw invalid('索引书名或原文版本与本地书库不一致。');
  if(snapshot.official)throw invalid('官方向量包已停用；请在应用中为故事卡建立本地索引。');
  if(!snapshot.entries.length)throw invalid('索引没有可用的故事条目。');
  try{for(const entry of snapshot.entries)sourceParts(book,entry.source);}
  catch{throw invalid('索引包含无法在本地书籍定位的出处。');}
  const target=path.join(indexes,indexFilename(book.id));
  await chmod(copy,0o600);
  await rename(copy,target);
  return {bookId:book.id,edition:book.edition,path:target,entries:snapshot.entries.length};
 }finally{await rm(staged,{recursive:true,force:true});}
}

export class LocalStorySearch{
 private snapshot?:{file:string;value:Snapshot};
 private cards?:{book:LocalBook;value:Promise<Snapshot|null>;merged?:{official:Snapshot;value:Snapshot}};
 private readonly file:string;
 private readonly resources?:{root:string;book:(id:string)=>Promise<LocalBook|null>;cache?:string;embeddings?:StoryCardEmbeddingStore};
 readonly embeddings?:StoryCardEmbeddingStore;
 constructor(file:string,resources?:LocalStorySearch['resources']){
  this.file=file;
  this.resources=resources;
  this.embeddings=resources?.embeddings;
 }
 async indexableCards(book:LocalBook):Promise<IndexableCard[]>{
  const bundled=this.resources?await this.readCardFile(book,this.resources.root):null;
  const custom=await this.customSnapshot(book);
  const rows=[
   ...(bundled?.cards.map(card=>({title:card.title,summary:card.summary,aliases:card.aliases?.map(storySearchKey),source:{...card.source,edition:book.edition}}))||[]),
   ...(custom?.bookId===book.id&&custom.edition===book.edition
    ?custom.entries.map(row=>({title:row.displayTitle,summary:row.displaySummary,source:row.source,aliases:row.aliases})):[]),
  ];
  const unique=new Map<string,IndexableCard>();
  for(const row of rows){
   if(!row.title||!row.summary)continue;
   try{sourceParts(book,row.source);const sourceKey=localSourceKey(row.source);
    unique.set(sourceKey,{id:sourceKey,title:row.title,summary:row.summary,aliases:row.aliases,source:row.source});
   }catch{/* 跳过出处已失效的旧卡。 */}
  }
  return [...unique.values()];
 }
 // 读者已建立向量库并启用嵌入模型；用于区分“未配置”和“已配置但暂不可用”。
 vectorsEnabled(){
  try{return !!this.embeddings?.exists()&&this.embeddings.settings().enabled;}catch{return false;}
 }
 async semanticScores(book:LocalBook,query:string,signal:AbortSignal){
  if(!this.embeddings?.exists())return null;
  return this.embeddings.scores(book,await this.indexableCards(book),query,signal);
 }
 // 并列主题分别计算相似度，每张卡取最高分，只保留一个出处。
 private async queryScores(book:LocalBook,cards:IndexableCard[],query:string,signal:AbortSignal,alternatives:readonly string[]){
  if(!this.embeddings?.exists())return null;
  if(!alternatives.length)return this.embeddings.scores(book,cards,query,signal);
  const best=new Map<string,number>();
  for(const alternative of alternatives){
   signal.throwIfAborted();
   const scores=await this.embeddings.scores(book,cards,alternative,signal);
   if(!scores)return null;
   for(const [id,score] of scores)best.set(id,Math.max(best.get(id)??-Infinity,score));
  }
  return best;
 }
 async vectorHits(book:LocalBook,query:string,signal:AbortSignal,cards:IndexableCard[],limit=50,alternatives:readonly string[]=[]){
  const scores=await this.queryScores(book,cards,query,signal,alternatives).catch(()=>null);
  signal.throwIfAborted();
  if(!scores?.size)return [];
  return cards.filter(card=>scores.has(card.id))
   .sort((a,b)=>scores.get(b.id)!-scores.get(a.id)!).slice(0,limit);
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
 async hasBundledCards(){
  if(!this.resources)return false;
  const files=await readdir(path.join(this.resources.root,storyCardsPath),{withFileTypes:true}).catch(()=>[]);
  return files.some(file=>file.isFile()&&file.name.endsWith('.json'));
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
   const expected=indexFilename(id);
   if(id&&expected===file.name)return id;
  }catch{/* 跳过名称无法解码的文件。 */}
 }
 private async customSnapshot(book:LocalBook){
  const indexed=await this.readSnapshot(path.join(path.dirname(this.file),storyIndexDirectory,indexFilename(book.id)));
  if(indexed?.bookId===book.id&&indexed.edition===book.edition&&!indexed.official)return indexed;
  const legacy=await this.readSnapshot(this.file);
  return legacy?.edition===book.edition&&!legacy.official&&(!legacy.bookId||legacy.bookId===book.id)?legacy:null;
 }
 private async snapshotFor(book:LocalBook){
  const custom=await this.customSnapshot(book);
  if(!this.resources)return custom;
  const wholeBook=await this.resources.book(book.id);
  if(wholeBook?.edition!==book.edition)return custom;
  const cards=this.cards?.book===wholeBook?this.cards:{book:wholeBook,value:this.readCards(wholeBook,this.resources.root)};
  this.cards=cards;
  const bundled=await cards.value;
  if(!custom)return bundled;
  if(!bundled)return custom;
  const entries=new Map<string,Entry>();
  for(const entry of [...custom.entries,...bundled.entries])if(!entries.has(localSourceKey(entry.source)))entries.set(localSourceKey(entry.source),entry);
  return {...bundled,entries:[...entries.values()]};
 }
 private async readCardFile(book:LocalBook,root:string){
  try{
   const file=path.join(root,storyCardsPath,encodeURIComponent(book.id)+'.json');
   const data=storyCardsSchema.parse(JSON.parse(await readFile(file,'utf8')));
   return data.bookId===book.id&&data.edition===book.edition?data:null;
  }catch{return null;}
 }
 private async readCards(book:LocalBook,root:string):Promise<Snapshot|null>{
  const data=await this.readCardFile(book,root);
  if(!data)return null;
  try{
   const entries=data.cards.map(card=>{
    const source={...card.source,edition:book.edition};
    return searchEntry(card.id,source,storyIndexText(book,source),card.title,card.summary,card.aliases??[]);
   });
   return {stamp:'',edition:book.edition,bookId:book.id,entries};
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
   if(!value)return null;
   this.snapshot={file:filename,value};
   return value;
  }catch{
   return null;
  }
 }
 async lookup(book:LocalBook,query:string,signal:AbortSignal,byTitle=false){
  const hits=await this.lookupHits(book,query,signal,byTitle);
  return hits?.map(({source})=>source)??null;
 }
 async lookupHits(book:LocalBook,query:string,signal:AbortSignal,byTitle=false,limit=42,onRetrieval?:(route:NonNullable<SuggestionProgress['retrieval']>)=>void,themeTerms:readonly string[]=[],sectionId?:string){
  signal.throwIfAborted();
  const snapshot=await this.snapshotFor(book);
  signal.throwIfAborted();
  if(!snapshot||snapshot.edition!==book.edition){onRetrieval?.('no-index');return null;}
  const topic=byTitle?query:query.replace(/^(?:请|帮我|请帮我)?\s*(?:列一下|列出|找出?|有哪些)\s*/u,'').replace(/(?:的)?(?:故事|情节)(?:有哪些)?[？?。！!]*$/u,'').trim();
  const phrase=storySearchKey(topic||query);
  if(!phrase)return [];
  const chars=Array.from(phrase);
  const normalizedTerms=themeTerms.map(storySearchKey);
  const terms=normalizedTerms.length?normalizedTerms:[...new Set(chars.slice(1).map((char,index)=>chars[index]+char))];
  const scoped=snapshot.entries.flatMap(entry=>{
   if(sectionId&&entry.source.sectionId!==sectionId)return [];
   try{sourceParts(book,entry.source);return [entry];}catch{return [];}
  });
  if(!scoped.length){onRetrieval?.('no-candidates');return [];}
  signal.throwIfAborted();
  let liveScores:Map<string,number>|null=null;
  try{liveScores=themeTerms.length&&this.embeddings?.exists()
   ?await this.queryScores(book,await this.indexableCards(book),query,signal,themeTerms)
   :await this.semanticScores(book,query,signal);}catch{liveScores=null;}
  signal.throwIfAborted();
  const scores=scoped.map(entry=>({entry,lexical:lexical(entry,phrase,terms),semantic:liveScores?.get(localSourceKey(entry.source))??-Infinity,
   matchesTheme:normalizedTerms.some(term=>entry.title.includes(term)||entry.summary.includes(term)||entry.text.includes(term))}));
  const exact=scores.filter(row=>row.lexical>=50).sort((a,b)=>b.lexical-a.lexical);
  const text=scores.filter(row=>themeTerms.length?row.matchesTheme:row.lexical>0).sort((a,b)=>b.lexical-a.lexical).slice(0,limit);
  const cards=themeTerms.length?[]:rankStoryCardText(scoped.filter(entry=>entry.summary),phrase,limit);
  const semantic=scores.filter(row=>Number.isFinite(row.semantic)).sort((a,b)=>b.semantic-a.semantic).slice(0,limit);
  onRetrieval?.(semantic.length?'hybrid':liveScores?'no-compatible-vectors':'no-query-vector');
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
  const candidates=[...primary.slice(0,3),...cardEntries.slice(0,2),...primary.slice(3),...cardEntries.slice(2)];
  const unique=new Map(candidates.map(entry=>[localSourceKey(entry.source),entry]));
  return [...unique.values()].slice(0,limit).map(({source,displayTitle,displaySummary})=>({source,title:displayTitle,...(displaySummary?{summary:displaySummary}:{})}));
 }
}
