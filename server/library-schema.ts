// 在创建运行文件之前拒绝不支持的格式。Node 与原生共用书库格式声明与 SQLite 门锁。
import {DatabaseSync} from 'node:sqlite';
import {existsSync,lstatSync,readFileSync,mkdirSync,openSync,readSync,closeSync} from 'node:fs';
import path from 'node:path';
import format from '../db/library-format.json' with {type:'json'};
export const libraryFormat=format;
export const earlierFormatError=()=>Error(`LIBRARY_EARLIER_FORMAT: ${format.earlierFormatGuide}`);
export const upgradeJournal='.desktop-upgrade.json';
/** SQLite 将 user_version 保存于头部第 60 字节。先检查它，避免打开不支持书库时创建 WAL 或 SHM。 */
export function libraryHeaderVersion(filename:string){
 const fd=openSync(filename,'r');
 try{
  const header=Buffer.alloc(64);
  if(readSync(fd,header)===header.length&&header.subarray(0,16).equals(Buffer.from('SQLite format 3\0')))return header.readUInt32BE(60);
 }finally{closeSync(fd);}
}
export function checkLibraryHeader(filename:string){
 const version=libraryHeaderVersion(filename);
 if(version!==undefined&&version>format.schemaVersion)throw Error(`LIBRARY_NEWER_SCHEMA: library ${version}, supported ${format.schemaVersion}; use a newer Shiqu app`);
 if(version!==undefined&&version<format.minimumReadableFormat)throw earlierFormatError();
}
export function pendingUpgrade(directory:string){
 const filename=path.join(directory,upgradeJournal);if(!existsSync(filename))return null;
 if(lstatSync(filename).isSymbolicLink())throw Error('LIBRARY_UNSAFE_JOURNAL');
 const value=JSON.parse(readFileSync(filename,'utf8'));
 if(!Number.isInteger(value.version)||value.version<1||value.version>format.schemaVersion)throw Error('LIBRARY_NEWER_UPGRADER: unsupported recovery journal');
 if(!/^\.desktop-upgrade-[a-f0-9-]{36}$/.test(value.work)||typeof value.backup!=='string'&&value.backup!==null)throw Error('LIBRARY_INVALID_JOURNAL');
 if(value.version<format.minimumReadableFormat)throw earlierFormatError();
 return value as {version:number;work:string;backup:string|null};
}
export function inspectLibrary(directory:string):'missing'|'current'|'pending'{
 if(existsSync(directory)&&lstatSync(directory).isSymbolicLink())throw Error('LIBRARY_UNSAFE_DIRECTORY');
 const pending=pendingUpgrade(directory),filename=path.join(directory,'shiqu.sqlite');
 if(!existsSync(filename))return pending?'pending':'missing';
 if(lstatSync(filename).isSymbolicLink())throw Error('LIBRARY_UNSAFE_DATABASE');
 checkLibraryHeader(filename);
 const db=new DatabaseSync(filename,{readOnly:true});
 try{
  let version:number;
  try{version=Number(db.prepare('PRAGMA user_version').get()!.user_version);}catch(error){if(pending)return 'pending';throw error;}
  if(version>format.schemaVersion)throw Error(`LIBRARY_NEWER_SCHEMA: library ${version}, supported ${format.schemaVersion}; use a newer Shiqu app`);
  if(version<format.minimumReadableFormat)throw earlierFormatError();
  if(pending)return 'pending';
  const tables=new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>String(row.name)));
  const columns=new Set(db.prepare('PRAGMA table_info(stories)').all().map(row=>row.name));
  if(!columns.has('document')||!columns.has('user_id')||!tables.has('app_migrations')||
   ['reader_sessions','jobs','progress'].some(n=>tables.has(n)))throw Error('LIBRARY_INVALID_SCHEMA');
  return 'current';
 }finally{db.close();}
}
export function withLibraryGate<T>(directory:string,action:()=>T,mode:'create'|'existing'|'shared'='create'):T{
 inspectLibrary(directory);
 if(mode==='create')mkdirSync(directory,{recursive:true});
 const gate=new DatabaseSync(path.join(directory,'.desktop-upgrade-lock.sqlite'));
 try{
  try{gate.exec(mode==='shared'?'PRAGMA busy_timeout=1000; BEGIN; SELECT name FROM sqlite_schema LIMIT 1':'PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');}catch{throw Error('DATA_BUSY: library upgrade in progress');}
  inspectLibrary(directory);return action();
 }finally{gate.close();}
}
