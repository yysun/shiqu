// 在用户书库中为每张已核对故事卡保存版本化向量；Ollama 仅作为本地嵌入服务。
import {createHash} from 'node:crypto';
import {constants,mkdirSync,lstatSync,openSync,closeSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {localSourceKey} from '../lib/reader-source-key.ts';
import type {LocalSourceReference} from '../lib/reader-local-contract.ts';

const encoding='story-card-title-summary-v1';
const settingsSchema=z.object({baseUrl:z.string().url().max(300).default('http://127.0.0.1:11434'),model:z.string().trim().min(1).max(120).default('qwen3-embedding:0.6b'),enabled:z.boolean().default(false)}).strict();
export type EmbeddingSettings=z.infer<typeof settingsSchema>;
export type IndexableCard={id:string;title:string;summary:string;aliases?:string[];source:LocalSourceReference};
export type EmbeddingBook={id:string;edition:string};
type ModelIdentity={name:string;digest:string;modifiedAt:string;dimensions:number;encoding:string};
type ModelProbe={at:number;identity?:ModelIdentity;models:string[]};
type StoredVector={bookId:string;edition:string;cardKey:string;cardHash:string;sourceKey:string;title:string;summary:string;identity:ModelIdentity;vector:Float32Array};
const tagsSchema=z.object({models:z.array(z.object({name:z.string().min(1),digest:z.string().min(1),modified_at:z.string().min(1)}))});
const showSchema=z.object({capabilities:z.array(z.string()).optional(),model_info:z.record(z.string(),z.unknown()).optional(),modified_at:z.string().optional()});
const embedSchema=z.object({embeddings:z.array(z.array(z.number().finite()).min(1)).min(1)});
const encodeCard=(card:IndexableCard)=>`故事标题：${card.title.trim()}\n故事梗概：${card.summary.trim()}`;
const encodeQuery=(query:string)=>`Instruct: Given a natural-language query in Chinese, retrieve story cards whose plot satisfies it.\nQuery: ${query.trim()}`;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const modelStamp=(identity:ModelIdentity)=>JSON.stringify(identity);

export function validateOllamaUrl(value:string){
 let url:URL;try{url=new URL(value);}catch{throw Error('请输入有效的本地 Ollama 地址。');}
 if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]','host.docker.internal'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('地址仅支持本机 Ollama（localhost、127.0.0.1、::1 或 host.docker.internal）和 HTTP。');
 return url.origin;
}

export class StoryCardEmbeddingStore{
 readonly file:string;
 private readonly fetcher:typeof fetch;
 private building=new Set<string>();
 constructor(directory:string,fetcher:typeof fetch=fetch){this.file=path.join(directory,'story-card-vectors.sqlite');this.fetcher=fetcher;}
 exists(){return requireFile(this.file);}
 settings():EmbeddingSettings{
  const db=this.open(false);try{this.schema(db);const value=db.prepare('SELECT value FROM settings WHERE id=1').get()?.value;return settingsSchema.parse(value?JSON.parse(String(value)):{});}finally{db.close();}
 }
 saveSettings(input:unknown){
  const settings=settingsSchema.parse(input),baseUrl=validateOllamaUrl(settings.baseUrl),saved={...settings,baseUrl};
  const db=this.open(true);try{this.schema(db);db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(saved));db.exec('COMMIT');return saved;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
 }
 indexedBooks(){
  if(!requireFile(this.file))return [];
  const db=this.open(false);try{this.schema(db);return db.prepare('SELECT DISTINCT book_id FROM vectors ORDER BY book_id').all().map(row=>String(row.book_id));}finally{db.close();}
 }
 async models(settings=this.settings(),signal?:AbortSignal):Promise<ModelProbe>{
  const baseUrl=validateOllamaUrl(settings.baseUrl);
  const tags=tagsSchema.parse(await this.request(baseUrl+'/api/tags',{method:'GET',signal}));
  const models:string[]=[];let identity:ModelIdentity|undefined;
  for(const row of tags.models){
   const details=showSchema.parse(await this.request(baseUrl+'/api/show',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:row.name}),signal}));
   if(!details.capabilities?.includes('embedding'))continue;
   models.push(row.name);
   if(row.name!==settings.model)continue;
   const modelInfo=details.model_info??{},dimensionKey=Object.keys(modelInfo).find(key=>key.endsWith('.embedding_length'));
   const dimensions=Number(dimensionKey?modelInfo[dimensionKey]:undefined);
   if(!Number.isSafeInteger(dimensions)||dimensions<1||dimensions>65536)throw Error('所选 Ollama 模型没有可用的 Embedding 维度信息。');
   identity={name:row.name,digest:row.digest,modifiedAt:row.modified_at||details.modified_at||'',dimensions,encoding};
  }
  const choices=[...new Set(models)].sort();if(!identity)return {at:Date.now(),models:choices};
  return {at:Date.now(),identity,models:choices};
 }
 async status(books:Array<{book:EmbeddingBook;cards:IndexableCard[]}>){
  const settings=this.settings();let identity:ModelIdentity|undefined,models:string[]=[],available=false,error='';
  try{const current=await this.models(settings);identity=current.identity;models=current.models;available=!!identity;if(!identity)error=current.models.length?`未找到所选 Embedding 模型「${settings.model}」。`: 'Ollama 中没有已安装的 Embedding 模型。';}catch(reason){error=reason instanceof Error?reason.message:'无法连接本地 Ollama。';}
  const rows=books.map(({book,cards})=>{
   const ready=!!identity&&cards.length>0&&this.countCompatible(book,cards,identity)===cards.length;
   return {id:book.id,cardCount:cards.length,indexedCount:identity?this.countCompatible(book,cards,identity):0,ready,reason:!cards.length?'没有可核对的故事卡':ready?'':identity?'索引需要更新':error||'尚未连接 Embedding 模型'};
  });
  return {settings,available,error,models,model:identity?{name:identity.name,digest:identity.digest,dimensions:identity.dimensions,modifiedAt:identity.modifiedAt}:null,books:rows};
 }
 async test(input?:unknown){
  const settings=input===undefined?this.settings():settingsSchema.parse(input),current=await this.models(settings);
  if(!current.identity)return {models:current.models,model:null,digest:null,dimensions:null};
  const vector=await this.embed(settings,encodeQuery('测试连接'),undefined);
  if(vector.length!==current.identity.dimensions)throw Error('Embedding 返回的维度与模型信息不一致。');
  return {models:current.models,model:current.identity.name,digest:current.identity.digest,dimensions:vector.length};
 }
 async build(book:EmbeddingBook,cards:IndexableCard[],signal:AbortSignal,onProgress:(value:{completed:number;total:number;title:string})=>void){
  if(this.building.has(book.id))throw Error('这本书正在建库，请等待完成或取消后重试。');
  if(!cards.length)throw Error('这本书没有可核对的故事卡，仍可通过目录浏览原文。');
  this.building.add(book.id);
  try{
   const settings=this.settings();if(!settings.enabled)throw Error('请先开启向量检索。');
   const current=await this.models(settings,signal);if(!current.identity)throw Error(`找不到可用的 Embedding 模型「${settings.model}」。`);
   const vectors:StoredVector[]=[],batchSize=16;
   for(let offset=0;offset<cards.length;offset+=batchSize){
    signal.throwIfAborted();
    const batch=cards.slice(offset,offset+batchSize),embedded=await this.embedMany(settings,batch.map(encodeCard),signal);
    if(embedded.length!==batch.length)throw Error('Embedding 返回的向量数量与故事卡数量不一致。');
    for(const [batchIndex,card] of batch.entries()){
     const vector=embedded[batchIndex];
     if(vector.length!==current.identity.dimensions)throw Error(`《${card.title}》的向量维度与模型信息不一致。`);
     const identity=current.identity,index=offset+batchIndex;
     vectors.push({bookId:book.id,edition:book.edition,cardKey:card.id,cardHash:hash([book.edition,card.id,card.title.trim(),card.summary.trim(),card.aliases??[],card.source]),sourceKey:localSourceKey({...card.source,edition:book.edition}),title:card.title.trim(),summary:card.summary.trim(),identity,vector});
     onProgress({completed:index+1,total:cards.length,title:card.title});
    }
   }
   signal.throwIfAborted();
   const db=this.open(true);
   try{
    this.schema(db);db.exec('BEGIN IMMEDIATE');
    db.prepare('DELETE FROM vectors WHERE book_id=?').run(book.id);
    const insert=db.prepare('INSERT INTO vectors(book_id,edition,card_key,card_hash,source_key,title,summary,identity,dimensions,vector) VALUES(?,?,?,?,?,?,?,?,?,?)');
    for(const row of vectors){signal.throwIfAborted();insert.run(row.bookId,row.edition,row.cardKey,row.cardHash,row.sourceKey,row.title,row.summary,modelStamp(row.identity),row.identity.dimensions,new Uint8Array(row.vector.buffer.slice(0)));}
    db.exec('COMMIT');
   }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
   return {bookId:book.id,indexed:vectors.length};
  }finally{this.building.delete(book.id);}
 }
 async scores(book:EmbeddingBook,cards:IndexableCard[],query:string,signal:AbortSignal){
  if(!requireFile(this.file))return null;
  const settings=this.settings();if(!settings.enabled)return null;
  let identity:ModelIdentity|undefined;try{identity=(await this.models(settings,signal)).identity;}catch{return null;}
  if(!identity)return null;
  if(this.countCompatible(book,cards,identity)===0)return null;
  const needle=await this.embed(settings,encodeQuery(query),signal);if(needle.length!==identity.dimensions)return null;
  const current=new Map(cards.map(card=>[card.id,hash([book.edition,card.id,card.title.trim(),card.summary.trim(),card.aliases??[],card.source])]));
  const db=this.open(false);try{
   this.schema(db);const rows=db.prepare('SELECT card_key,card_hash,source_key,dimensions,vector FROM vectors WHERE book_id=? AND edition=? AND identity=?').all(book.id,book.edition,modelStamp(identity));
   const result=new Map<string,number>(),needleNorm=Math.sqrt(needle.reduce((sum,value)=>sum+value*value,0));
   if(!needleNorm)return result;
   for(const row of rows){
    if(current.get(String(row.card_key))!==String(row.card_hash)||Number(row.dimensions)!==needle.length||!(row.vector instanceof Uint8Array)||row.vector.byteLength!==needle.length*4)continue;
    const vector=new Float32Array(row.vector.slice().buffer);let dot=0,vectorNorm=0;
    if(!vector.every(Number.isFinite))continue;
    for(let i=0;i<vector.length;i++){dot+=vector[i]*needle[i];vectorNorm+=vector[i]*vector[i];}
    if(vectorNorm)result.set(String(row.source_key),dot/(Math.sqrt(vectorNorm)*needleNorm));
   }
   return result;
  }finally{db.close();}
 }
 private countCompatible(book:EmbeddingBook,cards:IndexableCard[],identity:ModelIdentity){
  if(!cards.length)return 0;const current=new Map(cards.map(card=>[card.id,hash([book.edition,card.id,card.title.trim(),card.summary.trim(),card.aliases??[],card.source])]));
  const db=this.open(false);try{this.schema(db);const rows=db.prepare('SELECT card_key,card_hash FROM vectors WHERE book_id=? AND edition=? AND identity=?').all(book.id,book.edition,modelStamp(identity));return rows.filter(row=>current.get(String(row.card_key))===String(row.card_hash)).length;}finally{db.close();}
 }
 private async embed(settings:EmbeddingSettings,input:string,signal?:AbortSignal){
  return (await this.embedMany(settings,[input],signal))[0];
 }
 private async embedMany(settings:EmbeddingSettings,input:string[],signal?:AbortSignal){
  const base=validateOllamaUrl(settings.baseUrl),result=embedSchema.parse(await this.request(base+'/api/embed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:settings.model,input:input.length===1?input[0]:input}),signal}));
  return result.embeddings.map(values=>{const vector=Float32Array.from(values);if(!vector.some(value=>value!==0))throw Error('Embedding 模型返回了空向量。');return vector;});
 }
 private async request(url:string,init:RequestInit){
  let response:Response;try{response=await this.fetcher(url,{...init,redirect:'error',signal:AbortSignal.any([init.signal||new AbortController().signal,AbortSignal.timeout(30000)])});}
  catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw Error('无法连接本地 Ollama，请检查服务地址和运行状态。');}
  if(!response.ok)throw Error(`Ollama 请求失败（HTTP ${response.status}），请检查服务和所选模型。`);
  try{return await response.json();}catch{throw Error('Ollama 返回的数据格式无法识别。');}
 }
 private open(write:boolean){
  const directory=path.dirname(this.file);mkdirSync(directory,{recursive:true,mode:0o700});
  if(process.platform!=='win32')chmodSync(directory,0o700);
  if(!write){try{const info=lstatSync(this.file);if(!info.isFile()||info.isSymbolicLink())throw Error();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){const db=new DatabaseSync(this.file);db.close();if(process.platform!=='win32')chmodSync(this.file,0o600);}else throw Error('故事卡向量库文件不安全或无法读取。');}}
  else if(!requireFile(this.file)){const file=openSync(this.file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);closeSync(file);}
  const info=lstatSync(this.file);if(!info.isFile()||info.isSymbolicLink()||process.platform!=='win32'&&info.nlink!==1)throw Error('故事卡向量库文件不安全或无法读取。');
  const db=new DatabaseSync(this.file);db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE');return db;
 }
 private schema(db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS vectors(book_id TEXT NOT NULL,edition TEXT NOT NULL,card_key TEXT NOT NULL,card_hash TEXT NOT NULL,source_key TEXT NOT NULL,title TEXT NOT NULL,summary TEXT NOT NULL,identity TEXT NOT NULL,dimensions INTEGER NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(book_id,card_key));
  CREATE INDEX IF NOT EXISTS vectors_by_book_edition ON vectors(book_id,edition);`);}
}
function requireFile(filename:string){try{return lstatSync(filename).isFile();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
