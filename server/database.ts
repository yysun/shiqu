// Own the local SQLite connection and apply each schema migration exactly once.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {drizzle} from 'drizzle-orm/sqlite-proxy';
import type {SQLInputValue} from 'node:sqlite';
import type {Database} from '../lib/reader-repository.ts';
import * as schema from '../db/schema.ts';

export function migrate(sqlite:DatabaseSync,root:string){
 sqlite.exec('CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
 for(const name of readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort()){
  sqlite.exec('BEGIN IMMEDIATE');
  try{
   if(!sqlite.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(name)){
    const legacy=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='d1_migrations'").get();
    const applied=legacy&&sqlite.prepare('SELECT 1 FROM d1_migrations WHERE name=?').get(name);
    if(!applied)sqlite.exec(readFileSync(path.join(root,'drizzle',name),'utf8'));
    sqlite.prepare('INSERT INTO app_migrations VALUES(?,?)').run(name,new Date().toISOString());
   }
   sqlite.exec('COMMIT');
  }catch(error){sqlite.exec('ROLLBACK');throw error;}
 }
}
export function openDatabase(directory:string,root:string){
 mkdirSync(directory,{recursive:true});
 const sqlite=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
 try{
  sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
  migrate(sqlite,root);
  sqlite.exec('BEGIN IMMEDIATE');
  try{sqlite.exec(readFileSync(path.join(root,'docker/seed.sql'),'utf8'));sqlite.exec('COMMIT');}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
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
  }};
  return {sqlite,db,database,close(){sqlite.close();}};
 }catch(error){sqlite.close();throw error;}
}
export type LocalDatabase=ReturnType<typeof openDatabase>;
