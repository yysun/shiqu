// 从离线制备文件提取发布资源，逐条核对正式原文，并用正式安装器验证向量包。
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {cp,lstat,mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {localSourceSchema} from '../lib/reader-local-contract.ts';
import {selectionSchema} from '../lib/reader-model.ts';
import {LocalBooks} from '../server/local-books.ts';
import {installOfficialStoryIndex,storyCardsSchema,storyEmbeddingModel} from '../server/local-story-search.ts';
import {indexFilename,officialVectorFormat} from '../server/story-index-paths.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const [destination,...sources]=process.argv.slice(2);
if(!destination||!sources.length)throw Error('用法：node scripts/prepare-story-index-release.mjs <新输出目录> <制备.sqlite> [...]');
const output=path.resolve(destination);
await lstat(output).then(()=>{throw Error('输出目录已存在：'+output);},error=>{if(error.code!=='ENOENT')throw error;});
await mkdir(path.dirname(output),{recursive:true});
const stage=await mkdtemp(path.join(path.dirname(output),'.shiqu-index-release-'));
const cards=path.join(stage,'story-cards'),assets=path.join(stage,'release-assets');
const books=new LocalBooks(root);
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const files=[];
const seen=new Set();

async function sha256(file){
 const hash=createHash('sha256');
 for await(const bytes of createReadStream(file))hash.update(bytes);
 return hash.digest('hex');
}

function copyRows(input,output,table,columns,order,clause='',...params){
 const rows=input.prepare(`SELECT ${columns} FROM ${table} ${clause} ORDER BY ${order}`);
 const names=columns.split(',');
 const insert=output.prepare(`INSERT INTO ${table} VALUES (${names.map(()=>'?').join(',')})`);
 for(const row of rows.iterate(...params))insert.run(...names.map(name=>row[name]));
}

function writePack(filename,input,book,identity){
 const db=new DatabaseSync(filename);
 try{
  db.exec(`
   CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
   CREATE TABLE entries(id TEXT PRIMARY KEY,source TEXT NOT NULL,text TEXT NOT NULL,title TEXT,summary TEXT,raw_vector BLOB,vector BLOB,blocked TEXT) STRICT;
   CREATE TABLE passages(story_id TEXT,source_range TEXT,vector BLOB) STRICT;
   CREATE TABLE query_vectors(key TEXT PRIMARY KEY,model_digest TEXT,vector BLOB) STRICT;
   CREATE TABLE event_cards(story_id TEXT PRIMARY KEY,source_range TEXT,events TEXT,vectors BLOB,dimensions INTEGER) STRICT;
   BEGIN;`);
  const meta=db.prepare('INSERT INTO metadata VALUES (?,?)');
  meta.run('indexed_book',book.id);
  const digest=identity.digests?.[storyEmbeddingModel];
  if(typeof digest!=='string'||!digest)throw Error('索引没有正式检索模型的标识：'+book.title);
  meta.run('identity',JSON.stringify({format:officialVectorFormat,edition:book.edition,digests:{[storyEmbeddingModel]:digest}}));
  const entries=db.prepare("INSERT INTO entries VALUES (?,?,'',?,?,?,?,NULL)");
  for(const row of input.prepare('SELECT id,source,title,summary,raw_vector,vector FROM entries WHERE blocked IS NULL ORDER BY id').iterate()){
   entries.run(row.id,row.source,row.title,row.summary,row.raw_vector,row.vector);
  }
  const tables=new Set(input.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
  if(tables.has('passages'))copyRows(input,db,'passages','story_id,source_range,vector','story_id,first_unit',
   'WHERE vector IS NOT NULL AND EXISTS (SELECT 1 FROM entries WHERE id=story_id AND source=source_range AND blocked IS NULL)');
  if(tables.has('event_cards'))copyRows(input,db,'event_cards','story_id,source_range,events,vectors,dimensions','story_id',
   'WHERE EXISTS (SELECT 1 FROM entries WHERE id=story_id AND source=source_range AND blocked IS NULL)');
  if(tables.has('query_vectors'))copyRows(input,db,'query_vectors','key,model_digest,vector','key','WHERE model_digest=?',digest);
  db.exec('COMMIT');
 }finally{db.close();}
}

try{
 await mkdir(cards);
 await mkdir(assets);
 for(const source of sources){
  const info=await lstat(source);
  if(!info.isFile())throw Error('请选择普通的离线制备文件：'+source);
  const input=new DatabaseSync(source,{readOnly:true});
  try{
   input.exec('BEGIN');
   const metadata=input.prepare('SELECT value FROM metadata WHERE key=?');
   const bookId=metadata.get('indexed_book')?.value;
   const identity=JSON.parse(metadata.get('identity')?.value||'null');
   const book=await books.book(selectionSchema.parse({bookId,theme:'原典故事'}));
   if(!book||book.id!==bookId||identity?.edition!==book.edition||seen.has(bookId))throw Error('书名、版次不匹配或重复：'+source);
   seen.add(bookId);
   const records=[];
   for(const row of input.prepare('SELECT id,source,title,summary FROM entries WHERE blocked IS NULL ORDER BY id').iterate()){
    const receipt=localSourceSchema.parse(JSON.parse(row.source));
    try{books.resolve(book,receipt);}catch(error){throw Error('原文范围无法核对：'+bookId+' '+row.id,{cause:error});}
    const {edition,...range}=receipt;
    records.push({id:row.id,title:row.title,summary:row.summary,source:range});
   }
   const bundle=storyCardsSchema.parse({version:1,bookId,edition:book.edition,cards:records});
   const cardFile=indexFilename(bookId).replace(/\.sqlite$/,'.json');
   // 每条故事卡独占一行，便于复核版本差异。
   const {cards:rows,...metadata}=bundle;
   const header=JSON.stringify(metadata).slice(0,-1);
   await writeFile(path.join(cards,cardFile),header+',"cards":[\n'+rows.map(card=>JSON.stringify(card)).join(',\n')+'\n]}\n');
   // 资产名使用 ASCII，避免发布服务改写书名。
   const filename=`shiqu-story-vectors-${version}-${Buffer.from(bookId).toString('hex')}.sqlite`;
   const pack=path.join(assets,filename);
   writePack(pack,input,book,identity);
   await installOfficialStoryIndex(path.join(stage,'verify-cache'),book,pack);
   files.push({bookId,title:book.title,edition:book.edition,cards:records.length,filename,bytes:(await lstat(pack)).size,sha256:await sha256(pack)});
  }finally{input.close();}
 }
 files.sort((a,b)=>a.filename.localeCompare(b.filename,'en'));
 await writeFile(path.join(assets,`shiqu-story-vectors-${version}.json`),JSON.stringify({format:officialVectorFormat,version,books:files},null,2)+'\n');
 await writeFile(path.join(assets,`shiqu-story-vectors-${version}-SHA256SUMS.txt`),files.map(file=>file.sha256+'  '+file.filename).join('\n')+'\n');
 await cp(path.join(root,'NOTICE'),path.join(assets,'NOTICE.txt'));
 await cp(path.join(root,'data/library/source-notices.md'),path.join(assets,'source-notices.md'));
 await cp(path.join(root,'data/library/catalog.json'),path.join(assets,'book-catalog.json'));
 await cp(path.join(root,'data/library/licenses'),path.join(assets,'licenses'),{recursive:true});
 await rm(path.join(stage,'verify-cache'),{recursive:true});
 await rename(stage,output);
 console.log(`已制备 ${files.length} 本书的轻量索引和向量包：${output}`);
}finally{await rm(stage,{recursive:true,force:true});}
