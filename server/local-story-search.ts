// 独立索引只提供候选出处。文字与向量分别排名，原文始终由本地书库读取。
import {lstat} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {Converter} from 'opencc-js';
import {localSourceKey,localSourceSchema} from '../lib/reader-local-contract.ts';
import type {LocalSourceReference} from '../lib/reader-local-contract.ts';
import type {LocalBook} from './local-books.ts';
import {sourceParts} from './local-source-ranges.ts';

export const storyEmbeddingModel='qwen3-embedding:0.6b';
export const storyEmbeddingQuery=(text:string)=>`Instruct: Given a natural-language query in Chinese, retrieve stories whose plot satisfies it.\nQuery: ${text}`;
const simplify=Converter({from:'t',to:'cn'});
export const storySearchKey=(text:string)=>simplify(text.normalize('NFKC').toLowerCase()).replace(/[\p{P}\s]/gu,'');
type Entry={source:LocalSourceReference;text:string;title:string;vectors:Float32Array[]};
type Snapshot={stamp:string;edition:string;references:Map<string,Float32Array>;entries:Entry[]};

function decode(value:unknown){
 return value instanceof Uint8Array&&value.byteLength>0&&value.byteLength%4===0?new Float32Array(value.slice().buffer):undefined;
}
function load(file:string,stamp:string):Snapshot|undefined{
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const identity=JSON.parse(String(db.prepare("SELECT value FROM metadata WHERE key='identity'").get()?.value));
  if(!/^[a-f0-9]{64}$/.test(identity?.edition))return;
  const entries=new Map<string,Entry>();
  for(const row of db.prepare('SELECT id,source,text,title,raw_vector,vector FROM entries WHERE blocked IS NULL').all()){
   try{
    const source=localSourceSchema.parse(JSON.parse(String(row.source)));
    if(source.edition!==identity.edition)continue;
    const vectors=[decode(row.raw_vector),decode(row.vector)].filter(value=>value!==undefined);
    entries.set(String(row.id),{source,text:storySearchKey(String(row.text)),title:storySearchKey(String(row.title||'')),vectors});
   }catch{/* 跳过损坏的索引记录。 */}
  }
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='passages'").get()){
   for(const row of db.prepare('SELECT story_id,source_range,vector FROM passages WHERE vector IS NOT NULL').all()){
    const entry=entries.get(String(row.story_id)),vector=decode(row.vector);
    if(!entry||!vector)continue;
    try{if(localSourceKey(localSourceSchema.parse(JSON.parse(String(row.source_range))))===localSourceKey(entry.source))entry.vectors.push(vector);}
    catch{/* 已失效的片段不能给当前范围加权。 */}
   }
  }
  const references=new Map<string,Float32Array>(),digest=identity.digests?.[storyEmbeddingModel];
  if(digest&&db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='query_vectors'").get()){
   for(const row of db.prepare('SELECT key,vector FROM query_vectors WHERE model_digest=?').all(digest)){
    const vector=decode(row.vector);
    if(typeof row.key==='string'&&vector?.every(Number.isFinite))references.set(row.key,vector);
   }
  }
  return {stamp,edition:identity.edition,references,entries:[...entries.values()]};
 }finally{db.close();}
}

function lexical(entry:Entry,phrase:string,terms:string[]){
 if(entry.title===phrase)return 200+phrase.length;
 if(entry.title.includes(phrase))return 100+phrase.length;
 if(entry.text.includes(phrase))return 50+phrase.length;
 return terms.reduce((score,term)=>score+(entry.title.includes(term)?2:entry.text.includes(term)?1:0),0);
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

export class LocalStorySearch{
 private snapshot?:Snapshot;
 private file:string;
 constructor(file:string){this.file=file;}
 async candidates(book:LocalBook,query:string,signal:AbortSignal,byTitle=false){
  signal.throwIfAborted();
  let snapshot:Snapshot|undefined;
  try{
   const [file,wal]=await Promise.all([lstat(this.file),lstat(this.file+'-wal').catch(()=>undefined)]);
   if(!file.isFile()||file.nlink!==1||wal&&!wal.isFile())return [];
   const stamp=[file.ino,file.mtimeMs,file.size,wal?.mtimeMs,wal?.size].join('/');
   snapshot=this.snapshot?.stamp===stamp?this.snapshot:(this.snapshot=load(this.file,stamp));
  }catch{return [];}
  signal.throwIfAborted();
  if(!snapshot||snapshot.edition!==book.edition)return [];
  const topic=byTitle?query:query.replace(/^(?:请|帮我|请帮我)?\s*(?:列一下|列出|找出?|有哪些)\s*/u,'').replace(/(?:的)?(?:故事|情节)(?:有哪些)?[？?。！!]*$/u,'').trim();
  const phrase=storySearchKey(topic||query);
  if(!phrase)return [];
  const chars=Array.from(phrase);
  const terms=[...new Set(chars.slice(1).map((char,index)=>chars[index]+char))];
  const scoped=snapshot.entries.flatMap(entry=>{
   try{sourceParts(book,entry.source);return [entry];}catch{return [];}
  });
  if(!scoped.length)return [];
  const needle=snapshot.references.get(storySearchKey(query))||snapshot.references.get(phrase);
  signal.throwIfAborted();
  const scores=scoped.map(entry=>({entry,lexical:lexical(entry,phrase,terms),semantic:similarity(entry.vectors,needle)}));
  const exact=scores.filter(row=>row.lexical>=50).sort((a,b)=>b.lexical-a.lexical);
  const text=scores.filter(row=>row.lexical>0).sort((a,b)=>b.lexical-a.lexical).slice(0,30);
  const semantic=scores.filter(row=>Number.isFinite(row.semantic)).sort((a,b)=>b.semantic-a.semantic).slice(0,40);
  const fused=new Map<string,{entry:Entry;score:number}>();
  for(const lane of [text,semantic])lane.forEach(({entry},index)=>{
   const key=localSourceKey(entry.source),row=fused.get(key)||{entry,score:0};
   row.score+=1/(20+index+1);fused.set(key,row);
  });
  const ranked=[...fused.values()].sort((a,b)=>b.score-a.score);
  const unique=new Map<string,LocalSourceReference>();
  for(const {entry} of [...exact.slice(0,3),...semantic.slice(0,3),...ranked])unique.set(localSourceKey(entry.source),entry.source);
  return [...unique.values()].slice(0,42);
 }
}
