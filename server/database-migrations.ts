// Apply immutable migrations once each; callers stage files and own recovery before invoking hooks.
// `through` limits historical fixtures and the consolidation stage; `after` keeps consolidated libraries
// from re-running pre-consolidation hooks whose receipts are absent.
// 0024 的代码钩子把内嵌提示词移入 prompt_records 并在同一事务内核对；0025 的代码钩子把故事转换为文档 v2。
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {storySummaryMigration,migrateStorySummary} from './story-summary-migration.ts';
import {readerInputMigration,migrateReaderInputs,legacyInputFaultMigration,retainLegacyInputFaults} from './reader-input-migration.ts';
import {promptRecordMigration,migratePromptRecords} from './prompt-record-migration.ts';
import {productionDagMigration,migrateProductionDag} from './dag-migration.ts';
export const migrationNames=(root:string)=>readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort();
export function migrate(sqlite:DatabaseSync,root:string,directory?:string,through?:string,after?:string){
 sqlite.exec('CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
 for(const name of migrationNames(root).filter(f=>(!through||f<=through)&&(!after||f>after))){
  sqlite.exec('BEGIN IMMEDIATE');
  try{
   if(!sqlite.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(name)){
    const legacy=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='d1_migrations'").get();
    const applied=legacy&&sqlite.prepare('SELECT 1 FROM d1_migrations WHERE name=?').get(name);
    if(!applied){const sql=readFileSync(path.join(root,'drizzle',name),'utf8');if(name===storySummaryMigration)migrateStorySummary(sqlite,sql,directory);else if(name===readerInputMigration)migrateReaderInputs(sqlite);else if(name===legacyInputFaultMigration)retainLegacyInputFaults(sqlite);else if(name===promptRecordMigration)migratePromptRecords(sqlite,sql);else if(name===productionDagMigration)migrateProductionDag(sqlite,sql,directory);else sqlite.exec(sql);}
    sqlite.prepare('INSERT INTO app_migrations VALUES(?,?)').run(name,new Date().toISOString());
   }
   sqlite.exec('COMMIT');
  }catch(error){
   // 磁盘满等 SQLite 错误可能已回滚事务，保留原有失败原因。
   if(sqlite.isTransaction)sqlite.exec('ROLLBACK');
   throw error;
  }
 }
}
