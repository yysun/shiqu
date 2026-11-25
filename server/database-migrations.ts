// 新库先装入格式 4 基线；既有库随后按回执逐个应用普通迁移。
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {finalizeProductionSpec,finalizeProductionSpecMigration,productionSpecMigration} from './migrations/production-v4.ts';
import {rebindProductionReceipts,rebindProductionReceiptsMigration} from './migrations/production-v4-repair.ts';

export const migrationNames=(root:string)=>readdirSync(path.join(root,'drizzle'))
 .filter(name=>/^\d+.*\.sql$/.test(name)&&name>productionSpecMigration).sort();

export function migrate(sqlite:DatabaseSync,root:string,directory?:string){
 const readSql=(name:string)=>readFileSync(path.join(root,'drizzle',name),'utf8');
 if(!sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='app_migrations'").get()){
  sqlite.exec('BEGIN IMMEDIATE');
  try{
   sqlite.exec(readSql('baseline-format-4.sql'));
   sqlite.exec('COMMIT');
  }catch(error){
   if(sqlite.isTransaction)sqlite.exec('ROLLBACK');
   throw error;
  }
 }
 for(const name of migrationNames(root)){
  if(sqlite.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(name))continue;
  sqlite.exec('BEGIN IMMEDIATE');
  try{
   if(name===finalizeProductionSpecMigration)finalizeProductionSpec(sqlite,()=>readSql(productionSpecMigration),directory);
   else if(name===rebindProductionReceiptsMigration)rebindProductionReceipts(sqlite);
   else sqlite.exec(readSql(name));
   sqlite.prepare('INSERT INTO app_migrations VALUES(?,?)').run(name,new Date().toISOString());
   sqlite.exec('COMMIT');
  }catch(error){
   // 磁盘满等 SQLite 错误可能已回滚事务，保留原有失败原因。
   if(sqlite.isTransaction)sqlite.exec('ROLLBACK');
   throw error;
  }
 }
}
