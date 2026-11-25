// Refuse unknown formats before creating runtime files. Native and Node access share a short SQLite gate.
import {DatabaseSync} from 'node:sqlite';
import {existsSync,lstatSync,readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import format from '../db/library-format.json' with {type:'json'};
export const libraryFormat=format;
export const upgradeJournal='.desktop-upgrade.json';
export function pendingUpgrade(directory:string){
 const filename=path.join(directory,upgradeJournal);if(!existsSync(filename))return null;
 if(lstatSync(filename).isSymbolicLink())throw Error('LIBRARY_UNSAFE_JOURNAL');
 const value=JSON.parse(readFileSync(filename,'utf8'));
 // 中断的升级可能由支持旧格式的版本写下日志；接受 1 至当前格式，较新的版本拒绝。
 if(!Number.isInteger(value.version)||value.version<1||value.version>format.schemaVersion)throw Error('LIBRARY_NEWER_UPGRADER: unsupported recovery journal');
 if(!/^\.desktop-upgrade-[a-f0-9-]{36}$/.test(value.work)||typeof value.backup!=='string'&&value.backup!==null)throw Error('LIBRARY_INVALID_JOURNAL');
 return value as {version:number;work:string;backup:string|null};
}
export function inspectLibrary(directory:string):'missing'|'legacy'|'current'|'pending'{
 if(existsSync(directory)&&lstatSync(directory).isSymbolicLink())throw Error('LIBRARY_UNSAFE_DIRECTORY');
 const pending=pendingUpgrade(directory),filename=path.join(directory,'shiqu.sqlite');
 if(!existsSync(filename))return pending?'pending':'missing';
 if(lstatSync(filename).isSymbolicLink())throw Error('LIBRARY_UNSAFE_DATABASE');
 const db=new DatabaseSync(filename,{readOnly:true});
 try{
  let version:number;
  try{version=Number(db.prepare('PRAGMA user_version').get()!.user_version);}catch(error){if(pending)return 'pending';throw error;}
  if(version>format.schemaVersion)throw Error(`LIBRARY_NEWER_SCHEMA: library ${version}, supported ${format.schemaVersion}; use a newer Shiqu app`);
  if(pending)return 'pending';
  const tables=new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>String(row.name)));
  // Consolidated formats up to the supported version are current; later migrations apply in place.
  if(version>=1){
   const columns=new Set(db.prepare('PRAGMA table_info(stories)').all().map(row=>row.name));
   if(!columns.has('document')||!columns.has('user_id')||['reader_sessions','jobs','progress'].some(n=>tables.has(n)))throw Error('LIBRARY_INVALID_SCHEMA');
   return 'current';
  }
  if(version!==0||['books','stories','jobs','progress','events','reader_sessions'].some(n=>!tables.has(n))||!tables.has('app_migrations')&&!tables.has('d1_migrations'))throw Error('LIBRARY_UNKNOWN_SCHEMA');
  const receipts=new Set<string>();
  for(const table of ['app_migrations','d1_migrations'])if(tables.has(table))for(const row of db.prepare(`SELECT name FROM ${table}`).all())receipts.add(String(row.name));
  if(!['0000_bitter_dragon_lord.sql','0001_perfect_lester.sql','0002_absent_tempest.sql'].every(name=>receipts.has(name)))throw Error('LIBRARY_UNKNOWN_HISTORY');
  const columns=new Set(db.prepare('PRAGMA table_info(reader_sessions)').all().map(row=>row.name));
  if(!columns.has('document')||!columns.has('user_id'))throw Error('LIBRARY_INVALID_SCHEMA');
  return 'legacy';
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
