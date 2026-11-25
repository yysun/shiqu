// Own the local SQLite connection after the library upgrader applies every pending migration.
// Book seeds are idempotent and run on each open so catalog additions reach existing libraries.
// 多表状态变化经 transaction() 在一个同步事务中完成，取代原先承载制作规则的触发器。
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {drizzle} from 'drizzle-orm/sqlite-proxy';
import type {SQLInputValue} from 'node:sqlite';
import type {Database,SyncStatements} from '../lib/reader-repository.ts';
import * as schema from '../db/schema.ts';
import {withLibraryGate} from './library-schema.ts';
import {ensureLibraryReady} from './library-upgrade.ts';
export {migrate} from './database-migrations.ts';

export function openDatabase(directory:string,root:string,readOnly=false){
 const filename=path.join(directory,'shiqu.sqlite');
 const open=()=>{
  ensureLibraryReady(directory,root,{readOnly});
  const sqlite=new DatabaseSync(filename,{readOnly});
  if(readOnly)try{
   // 在升级门内固定快照；制作可在导出期间继续写入 WAL。
   sqlite.exec('PRAGMA busy_timeout=5000; BEGIN; SELECT name FROM sqlite_schema LIMIT 1');
  }catch(error){sqlite.close();throw error;}
  return sqlite;
 };
 const sqlite=readOnly?withLibraryGate(directory,open,'shared'):open();
 try{
  if(!readOnly){
   sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
   sqlite.exec('BEGIN IMMEDIATE');
   try{sqlite.exec(readFileSync(path.join(root,'docker/seed.sql'),'utf8'));sqlite.exec('COMMIT');}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
  const db=drizzle(async(query,params,method)=>{
   const statement=sqlite.prepare(query),values=params as SQLInputValue[];
   if(method==='run'){statement.run(...values);return {rows:[]};}
   statement.setReturnArrays(true);
   return {rows:(method==='get'?statement.get(...values):statement.all(...values)) as unknown[]};
  },{schema});
  const database:Database={prepare(query){
   const statement=sqlite.prepare(query);let values:SQLInputValue[]=[];
   return {bind(...args:unknown[]){values=args as SQLInputValue[];return this;},
    async first<T>(){return (statement.get(...values) as T|undefined)??null;},
    async all<T>(){return {results:statement.all(...values) as T[]};},
    async run(){return {meta:{changes:Number(statement.run(...values).changes)}};}};
  },transaction(body){return transaction(sqlite,body);},readTransaction(body){return transaction(sqlite,body,'read');}};
  return {sqlite,db,database,close(){sqlite.close();}};
 }catch(error){sqlite.close();throw error;}
}
export type LocalDatabase=ReturnType<typeof openDatabase>;
/** 写事务先占写锁；只读投影使用延迟事务固定同一 WAL 快照。事务体不得含 await。 */
export function transaction<T>(sqlite:DatabaseSync,body:(db:SyncStatements)=>T,mode:'write'|'read'='write'):T{
 const statements:SyncStatements={
  run(query,...values){return {changes:Number(sqlite.prepare(query).run(...values as SQLInputValue[]).changes)};},
  get<R>(query:string,...values:unknown[]){return sqlite.prepare(query).get(...values as SQLInputValue[]) as R|undefined;},
  all<R>(query:string,...values:unknown[]){return sqlite.prepare(query).all(...values as SQLInputValue[]) as R[];},
 };
 sqlite.exec(mode==='read'?'BEGIN':'BEGIN IMMEDIATE');
 try{
  const result=body(statements);
  if(result instanceof Promise)throw Error('TRANSACTION_MUST_BE_SYNC');
  sqlite.exec('COMMIT');return result;
 }catch(error){sqlite.exec('ROLLBACK');throw error;}
}
