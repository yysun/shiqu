// 只用登记的旧 SQL 创建格式 4 开发预览的前置测试结构。
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
export function historicalLibrary(directory,root=process.cwd(),through='0027_revision_fault_targets.sql'){
 mkdirSync(directory,{recursive:true});const sqlite=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
 sqlite.exec('CREATE TABLE app_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
 for(const name of readdirSync(path.join(root,'drizzle')).filter(name=>name.endsWith('.sql')&&name<=through).sort()){
  sqlite.exec(readFileSync(path.join(root,'drizzle',name),'utf8'));
  sqlite.prepare('INSERT INTO app_migrations VALUES(?,?)').run(name,'fixture');
 }
 sqlite.exec(readFileSync(path.join(root,'docker/seed.sql'),'utf8'));
 return sqlite;
}
