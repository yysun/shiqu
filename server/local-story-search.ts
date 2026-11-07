import type {SuggestionProgress} from '../lib/reader-suggestions.ts';
// 独立索引只提供候选出处。文字与向量分别排名，原文始终由本地书库读取。
import {chmod,lstat,mkdir,mkdtemp,readdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {backup,DatabaseSync} from 'node:sqlite';
import {Converter} from 'opencc-js';
import {localSourceKey,localSourceSchema} from '../lib/reader-local-contract.ts';
import type {LocalSourceReference} from '../lib/reader-local-contract.ts';
import {ReaderError} from '../lib/reader-model.ts';
import type {LocalBook} from './local-books.ts';
import {sourceParts} from './local-source-ranges.ts';
import {groundedStoryEvents,storyEventText} from './local-story-events.ts';

export const storyEmbeddingModel='qwen3-embedding:0.6b';
export const storyEmbeddingQuery=(text:string)=>`Instruct: Given a natural-language query in Chinese, retrieve stories whose plot satisfies it.\nQuery: ${text}`;
const simplify=Converter({from:'t',to:'cn'});
export const storySearchKey=(text:string)=>simplify(text.normalize('NFKC').toLowerCase()).replace(/[\p{P}\s]/gu,'');
type CardText={id:string;title:string;summary:string};
type Entry=CardText&{source:LocalSourceReference;text:string;displayTitle:string;vectors:Float32Array[];eventTerms:Set<string>;eventText:string};
type Snapshot={stamp:string;edition:string;bookId?:string;references:Map<string,Float32Array>;entries:Entry[]};
export const storyIndexDirectory='story-indexes';
const indexFilename=(bookId:string)=>encodeURIComponent(bookId)+'.sqlite';

function decode(value:unknown){
 return value instanceof Uint8Array&&value.byteLength>0&&value.byteLength%4===0?new Float32Array(value.slice().buffer):undefined;
}
function load(file:string,stamp:string,strict=false):Snapshot|undefined{
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const identity=JSON.parse(String(db.prepare("SELECT value FROM metadata WHERE key='identity'").get()?.value));
  if(!/^[a-f0-9]{64}$/.test(identity?.edition))return;
  const entries=new Map<string,Entry>();
  const columns=new Set(db.prepare('PRAGMA table_info(entries)').all().map(column=>column.name));
  const optional=['summary','raw_vector','vector'].map(name=>columns.has(name)?name:'NULL AS '+name);
  for(const row of db.prepare(`SELECT id,source,text,title,${optional.join(',')} FROM entries WHERE blocked IS NULL`).all()){
   try{
    const source=localSourceSchema.parse(JSON.parse(String(row.source)));
    if(source.edition!==identity.edition)throw Error('索引条目的原文版本不一致');
    const vectors=[decode(row.raw_vector),decode(row.vector)].filter(value=>value!==undefined);
    const id=String(row.id);
    entries.set(id,{id,source,text:storySearchKey(String(row.text)),title:storySearchKey(String(row.title||'')),
     summary:storySearchKey(String(row.summary??'')),displayTitle:String(row.title??'').trim(),vectors,eventTerms:new Set(),eventText:''});
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
    if(typeof row.key==='string'&&vector?.every(Number.isFinite))references.set(row.key,vector);
   }
  }
  const bookId=db.prepare("SELECT value FROM metadata WHERE key='indexed_book'").get()?.value;
  return {stamp,edition:identity.edition,bookId:typeof bookId==='string'&&bookId.length<=100?bookId:undefined,references,entries:[...entries.values()]};
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

function lexical(entry:Entry,phrase:string,terms:string[]){
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
 const invalid=(message:string)=>new ReaderError(400,message);
 const info=await lstat(source).catch(()=>null);
 if(!info?.isFile()||info.nlink!==1)throw invalid('请选择一个独立的 SQLite 索引文件。');
 const indexes=path.join(directory,storyIndexDirectory);
 await mkdir(indexes,{recursive:true,mode:0o700});
 if(!(await lstat(indexes)).isDirectory())throw invalid('故事索引目录必须是普通目录。');
 const staged=await mkdtemp(path.join(directory,'.story-index-install-'));
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
 private readonly file:string;
 constructor(file:string){this.file=file;}
 async candidates(book:LocalBook,query:string,signal:AbortSignal,byTitle=false){
  return await this.lookup(book,query,signal,byTitle)||[];
 }
 async indexedBooks(){
  const directory=path.join(path.dirname(this.file),storyIndexDirectory);
  const files=await readdir(directory,{withFileTypes:true}).catch(()=>[]);
  const ids=new Set<string>();
  for(const file of files){
   if(!file.isFile()||!file.name.endsWith('.sqlite'))continue;
   try{
    const id=decodeURIComponent(file.name.slice(0,-7));
    if(id&&indexFilename(id)===file.name)ids.add(id);
   }catch{/* 跳过名称无法解码的文件。 */}
  }
  const legacy=await this.readSnapshot(this.file);
  if(legacy?.bookId)ids.add(legacy.bookId);
  return ids.size||legacy?[...ids]:null;
 }
 // 目录只列出可供手动勾选的故事段落，查询不会修改已选范围。
 async passages(book:LocalBook,terms:readonly string[]){
  const snapshot=await this.snapshotFor(book);
  if(!snapshot)return [];
  const keys=terms.map(storySearchKey).filter(Boolean);
  return snapshot.entries.filter(entry=>entry.displayTitle&&keys.every(key=>entry.title.includes(key)||entry.summary.includes(key)||entry.text.includes(key)));
 }
 private async snapshotFor(book:LocalBook){
  const indexed=await this.readSnapshot(path.join(path.dirname(this.file),storyIndexDirectory,indexFilename(book.id)));
  if(indexed?.bookId===book.id&&indexed.edition===book.edition)return indexed;
  const legacy=await this.readSnapshot(this.file);
  return legacy?.edition===book.edition&&(!legacy.bookId||legacy.bookId===book.id)?legacy:null;
 }
 private async readSnapshot(filename:string){
  try{
   const [file,wal]=await Promise.all([lstat(filename),lstat(filename+'-wal').catch(()=>undefined)]);
   if(!file.isFile()||file.nlink!==1||wal&&!wal.isFile())return null;
   const stamp=[file.ino,file.mtimeMs,file.size,wal?.mtimeMs,wal?.size].join('/');
   if(this.snapshot?.file===filename&&this.snapshot.value.stamp===stamp)return this.snapshot.value;
   const value=load(filename,stamp);
   if(value)this.snapshot={file:filename,value};
   return value;
  }catch{return null;}
 }
 async lookup(book:LocalBook,query:string,signal:AbortSignal,byTitle=false){
  const hits=await this.lookupHits(book,query,signal,byTitle);
  return hits?.map(({source})=>source)??null;
 }
 async lookupHits(book:LocalBook,query:string,signal:AbortSignal,byTitle=false,limit=42,onRetrieval?:(route:NonNullable<SuggestionProgress['retrieval']>)=>void){
  signal.throwIfAborted();
  const snapshot=await this.snapshotFor(book);
  signal.throwIfAborted();
  if(!snapshot||snapshot.edition!==book.edition){onRetrieval?.('no-index');return null;}
  const topic=byTitle?query:query.replace(/^(?:请|帮我|请帮我)?\s*(?:列一下|列出|找出?|有哪些)\s*/u,'').replace(/(?:的)?(?:故事|情节)(?:有哪些)?[？?。！!]*$/u,'').trim();
  const phrase=storySearchKey(topic||query);
  if(!phrase)return [];
  const chars=Array.from(phrase);
  const terms=[...new Set(chars.slice(1).map((char,index)=>chars[index]+char))];
  const scoped=snapshot.entries.flatMap(entry=>{
   try{sourceParts(book,entry.source);return [entry];}catch{return [];}
  });
  if(!scoped.length){onRetrieval?.('no-candidates');return [];}
  const needle=snapshot.references.get(storySearchKey(query))||snapshot.references.get(phrase);
  signal.throwIfAborted();
  const scores=scoped.map(entry=>({entry,lexical:lexical(entry,phrase,terms),semantic:similarity(entry.vectors,needle)}));
  const exact=scores.filter(row=>row.lexical>=50).sort((a,b)=>b.lexical-a.lexical);
  const text=scores.filter(row=>row.lexical>0).sort((a,b)=>b.lexical-a.lexical).slice(0,30);
  const cards=rankStoryCardText(scoped.filter(entry=>entry.summary),phrase,30);
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
  const candidates=[...primary.slice(0,3),...cardEntries.slice(0,2),...primary.slice(3),...cardEntries.slice(2)];
  const unique=new Map(candidates.map(entry=>[localSourceKey(entry.source),entry]));
  return [...unique.values()].slice(0,limit).map(({source,displayTitle})=>({source,title:displayTitle}));
 }
}
