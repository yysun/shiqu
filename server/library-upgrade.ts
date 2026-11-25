// 新库在门锁内暂存并原子发布。现有书库先校验整库备份，再逐个提交普通迁移。
// 中断日志在访问书库前恢复。恢复副本以调用者提供的备份为回退点。
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,readdirSync,lstatSync,openSync,closeSync,fsyncSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createLibraryBackup,verifyLibraryBackup,restoreLibraryBackup,containsPath,backupDirectory,checkBackupDirectory,canonicalPath,assertBackupDestination,withBackupAccess,checkDatabase} from './library-backup.ts';
import {checkLibraryHeader,inspectLibrary,withLibraryGate,pendingUpgrade,upgradeJournal,libraryFormat} from './library-schema.ts';
import {ownsDesktopData,ownDesktopDataSync} from './desktop-owner.ts';
import {migrate,migrationNames} from './database-migrations.ts';
import {mediaKey} from './media.ts';

const demos=new Set([...Array.from({length:10},(_,i)=>`legacy-art/pear-${i+1}.png`),...Array.from({length:30},(_,i)=>`legacy-art/dongguo-${i+1}.png`)]);
export function localMediaKey(value:string):string|null{
 const url=/^\/(?:api\/(?:reader\/)?media|art)\//.test(value);
 const reference=url?value.split(/[?#]/,1)[0]:value;
 let key=reference.startsWith('/api/reader/media/')?'reader/'+reference.slice(18):reference.startsWith('/api/media/')?reference.slice(11):reference.startsWith('/art/')?'legacy-art/'+reference.slice(5):reference;
 try{key=decodeURIComponent(key);mediaKey(key);}catch{return null;}
 // Bare filenames occur in historical checkpoints; prose/source ranges are not media keys.
 return url||/\.(?:png|jpe?g|webp|json|mp3|wav)$/i.test(key)?key:null;
}
function protectedJson(text:string,context:string){
 try{return JSON.parse(text);}catch{throw Error('LIBRARY_PROTECTED_JSON_INVALID: '+context);}
}
const mediaFields=new Set(['image','images','audio','reference','asset','assetKey','asset_key','key','value','file','filename','path','artifact','snapshot']);
function references(value:unknown,result=new Set<string>(),roots:string[]=[],field='',includeUncertain=false){
 if(typeof value==='string'){
  const keys=new Set<string>(),local=localMediaKey(value);if(local)keys.add(local);
  const absolute=path.isAbsolute(value)||/^[a-zA-Z]:[\\/]/.test(value);
  if(!keys.size&&absolute){
   for(const root of roots){const relative=path.relative(path.join(root,'media'),value);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)){try{keys.add(mediaKey(relative.split(path.sep).join('/')));}catch{/* Not a managed file. */}}}
   if(!keys.size){
    // Restored/imported artifacts retain their original absolute text. Preserve matching managed
    // bytes in the destination without rewriting that text or trusting the old filesystem location.
    const normalized=value.replaceAll('\\','/'),suffixes:string[]=[];
    for(let index=normalized.indexOf('/media/');index>=0;index=normalized.indexOf('/media/',index+1)){
     try{suffixes.push(mediaKey(normalized.slice(index+7)));}catch{/* Unsafe suffix is not local media. */}
    }
    for(const suffix of suffixes)if(roots.some(root=>existsSync(path.join(root,'media',suffix))))keys.add(suffix);
    if(!keys.size&&suffixes.length)keys.add(suffixes.at(-1)!);
   }
  }
  const certain=/^\/(?:api\/(?:reader\/)?media|art)\//.test(value)||mediaFields.has(field);
  for(const key of keys)if(certain||includeUncertain&&roots.some(root=>existsSync(path.join(root,'media',key))))result.add(key);
 }
 else if(Array.isArray(value))for(const item of value)references(item,result,roots,field,includeUncertain);
 else if(value&&typeof value==='object')for(const [name,item]of Object.entries(value))references(item,result,roots,/^\d+$/.test(name)?field:name,includeUncertain);
 return result;
}
function walk(folder:string,prefix=''):string[]{
 if(!existsSync(folder))return [];
 if(lstatSync(folder).isSymbolicLink())throw Error('LIBRARY_MEDIA_SYMLINK');
 const result:string[]=[];
 for(const entry of readdirSync(folder,{withFileTypes:true})){
  if(entry.name.toLowerCase()==='.ds_store'){rmSync(path.join(folder,entry.name));continue;}
  if(entry.isSymbolicLink())throw Error('LIBRARY_MEDIA_SYMLINK');
  if(entry.name.startsWith('.desktop')||entry.name==='backups'||entry.name.endsWith('-backups'))continue;
  const key=prefix+entry.name;
  if(entry.isDirectory())result.push(...walk(path.join(folder,entry.name),key+'/'));
  else if(entry.isFile())result.push(key);else throw Error('LIBRARY_UNSUPPORTED_FILE');
 }
 return result;
}
const hash=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
export function currentMediaKeys(db:DatabaseSync,directory:string){
 const rows=db.prepare('SELECT * FROM stories').all(),ids=new Set(rows.map(row=>String(row.id))),keep=new Set<string>(),roots=[directory];
 for(const row of rows){references(protectedJson(String(row.selection),'selection '+row.id),keep,roots,'',true);references(protectedJson(String(row.document),'document '+row.id),keep,roots,'',true);}
 for(const table of ['production_jobs','reader_commands','production_faults'])for(const row of db.prepare(`SELECT * FROM ${table}`).all())if(ids.has(String(row.session_id)))for(const field of ['payload','result','image'])if(typeof row[field]==='string'){
  const text=String(row[field]);
  let value:unknown;
  try{value=JSON.parse(text);}catch{if(text.trimStart().startsWith('{')||text.trimStart().startsWith('['))throw Error('LIBRARY_PROTECTED_JSON_INVALID: '+table+' '+field+' '+row.session_id);value=text;}
  references(value,keep,roots,'',true);
 }
 for(const row of db.prepare('SELECT * FROM book_image_references').all())if(ids.has(String(row.story_id))&&!demos.has(String(row.asset_key)))keep.add(String(row.asset_key));
 for(const row of db.prepare('SELECT target_key FROM production_media_aliases').all())keep.add(String(row.target_key));
 for(const row of db.prepare('SELECT content FROM production_products').all())
  references(protectedJson(String(row.content),'production product'),keep,roots,'',true);
 const files=walk(path.join(directory,'media'));
 for(const key of walk(directory).filter(key=>!key.split('/').some(part=>part.startsWith('.desktop'))&&!key.startsWith('media/')&&/\.(json|html|md)$/.test(key))){
  const text=readFileSync(path.join(directory,key),'utf8');
  if(key.endsWith('.json')){references(protectedJson(text,key),keep,roots,'',true);continue;}
  for(const match of text.matchAll(/\/(?:api\/(?:reader\/)?media|art)\/[-a-zA-Z0-9_./]+/g))references(match[0],keep,roots,'',true);
 }
 // Saved originals/revision bases belong to the complete current namespace. Existing exports are
 // also protected roots; unknown files are never candidates for deletion.
 for(const file of files)if((file.startsWith('reader/')||file.startsWith('reader-cache/'))&&ids.has(file.split('/')[1])||file.startsWith('exports/'))keep.add(file);
 // Follow local references inside saved JSON, including snapshots and frozen input receipts.
 const queue=[...keep],visited=new Set<string>();
 for(let i=0;i<queue.length;i++){
  const key=queue[i];if(visited.has(key))continue;visited.add(key);
  if(!key.endsWith('.json')||!files.includes(key))continue;
  const value=protectedJson(readFileSync(path.join(directory,'media',key),'utf8'),key);
  for(const ref of references(value,new Set<string>(),roots,'',true))if(!keep.has(ref)){keep.add(ref);queue.push(ref);}
 }
 return keep;
}
function syncDirectory(directory:string){
 // Windows does not expose directory fsync through Node; file handles still sync before rename.
 if(process.platform==='win32')return;
 const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
}
function durableFile(filename:string,bytes:string|Buffer){
 mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});const temp=filename+'.'+randomUUID()+'.tmp';
 try{
  const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,filename);syncDirectory(path.dirname(filename));
 }finally{rmSync(temp,{force:true});}
}
function clearSidecars(directory:string){for(const suffix of ['-wal','-shm','-journal'])rmSync(path.join(directory,'shiqu.sqlite'+suffix),{force:true});}
function recover(directory:string){
 const journal=pendingUpgrade(directory);if(!journal)return;
 if(journal.backup){
  const backup=journal.backup;
  if(!containsPath(backupDirectory(directory),backup))throw Error('LIBRARY_INVALID_BACKUP_PATH');
  withBackupAccess(backup,()=>{
   const manifest=verifyLibraryBackup(backup);
   clearSidecars(directory);
   // 最后恢复数据库，门内先核对所有媒体与原文件。
   for(const file of [...manifest.files].sort((a,b)=>Number(a.path==='shiqu.sqlite')-Number(b.path==='shiqu.sqlite'))){
    const target=path.join(directory,file.path);durableFile(target,readFileSync(path.join(backup,file.path)));
    if(hash(target)!==file.sha256)throw Error('LIBRARY_RECOVERY_HASH_MISMATCH');
   }
  },true);
 }else{clearSidecars(directory);rmSync(path.join(directory,'shiqu.sqlite'),{force:true});}
 rmSync(path.join(directory,'.desktop-upgrade-result.json'),{force:true});
 rmSync(path.join(directory,journal.work),{recursive:true,force:true});
 rmSync(path.join(directory,upgradeJournal));syncDirectory(directory);
}
function appVersion(root:string){
 try{return String(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version||'unknown');}catch{return 'unknown';}
}
const migrationBackupFile='.desktop-migration-backup.json';
function migrationBackupPath(directory:string){return path.join(directory,migrationBackupFile);}
export function migrationBackupDependency(directory:string){
 const filename=migrationBackupPath(directory);
 let info;
 try{info=lstatSync(filename);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 if(!info.isFile()||info.isSymbolicLink()||info.size>32768)throw Error('LIBRARY_INVALID_BACKUP_PATH');
 const {backup,migrations}=JSON.parse(readFileSync(filename,'utf8'));
 if(typeof backup!=='string'||path.dirname(backup)!==backupDirectory(directory)||!Array.isArray(migrations)||
    !migrations.length||migrations.some(name=>typeof name!=='string'))throw Error('LIBRARY_INVALID_BACKUP_PATH');
 return {backup,migrations:migrations as string[]};
}
export function backupOriginFile(backup:string){return path.join(path.dirname(backup),'.'+path.basename(backup)+'.origin.json');}
function safetyBackup(directory:string,root:string){
 const backup=path.join(checkBackupDirectory(directory),'pre-upgrade-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
 createLibraryBackup(directory,backup,appVersion(root),root);const manifest=verifyLibraryBackup(backup);
 // Windows 的 FlushFileBuffers 要求句柄有写权限。用 r+ 打开已校验的备份文件，避免截断或创建文件。
 for(const file of [...manifest.files.map(f=>f.path),'shiqu-backup.json']){
  const fd=openSync(path.join(backup,file),'r+');
  try{fsyncSync(fd);}finally{closeSync(fd);}
 }
 syncDirectory(backup);
 durableFile(backupOriginFile(backup),JSON.stringify({library:canonicalPath(directory)})+'\n');
 console.warn('升级前备份已校验：'+backup);
 return backup;
}
export function pendingMigrations(directory:string,root:string){
 const db=new DatabaseSync(path.join(directory,'shiqu.sqlite'),{readOnly:true});
 try{const applied=new Set(db.prepare('SELECT name FROM app_migrations').all().map(row=>String(row.name)));return migrationNames(root).filter(name=>!applied.has(name));}
 finally{db.close();}
}
function applyPendingMigrations(directory:string,root:string){
 // 各迁移单独提交。中断后保留最初的回退点，直到所有待处理迁移成功。
 const dependency=migrationBackupDependency(directory),migrations=pendingMigrations(directory,root);
 if(dependency){
  const known=new Set(migrationNames(root));
  if(dependency.migrations.some(name=>!known.has(name)))throw Error('LIBRARY_NEWER_UPGRADER: use a newer Shiqu app');
 }
 if(!migrations.length){
  if(dependency){rmSync(migrationBackupPath(directory));syncDirectory(directory);}
  return;
 }
 const started=Date.now();
 console.warn(`书库数据库正在迁移（${migrations.join('、')}），先做整库备份，请勿关闭……`);
 const backup=dependency?.backup||safetyBackup(directory,root);
 if(dependency)withBackupAccess(backup,()=>verifyLibraryBackup(backup),true);
 durableFile(migrationBackupPath(directory),JSON.stringify({backup,migrations:[...new Set([...(dependency?.migrations||[]),...migrations])]})+'\n');
 const sqlite=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
 console.warn('正在应用数据库迁移……');
 try{sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');migrate(sqlite,root,directory);sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');}
 catch(error){throw Error(`LIBRARY_MIGRATION_FAILED; backup: ${backup}; ${String(error)}`,{cause:error});}
 finally{sqlite.close();}
 if(inspectLibrary(directory)!=='current')throw Error(`LIBRARY_MIGRATION_FAILED; backup: ${backup}; invalid schema`);
 rmSync(migrationBackupPath(directory));syncDirectory(directory);
 console.warn(`书库数据库迁移完成，用时 ${((Date.now()-started)/1000).toFixed(1)} 秒。`);
 return {backup,migrations};
}
export type UpgradePoint='journal'|'staged'|'database-published'|'cleanup';
export function ensureLibraryReady(directory:string,root:string,options:{onStep?:(point:UpgradePoint)=>void;readOnly?:boolean}={}){
 const initial=inspectLibrary(directory);
 if(initial==='pending'){
  const backup=pendingUpgrade(directory)?.backup;
  const database=backup&&path.join(backup,'shiqu.sqlite');
  if(backup&&database&&containsPath(backupDirectory(directory),backup)&&existsSync(database)&&lstatSync(database).isFile())
   checkLibraryHeader(database);
 }
 if(initial==='current'&&!migrationBackupDependency(directory)&&!pendingMigrations(directory,root).length)return;
 if(options.readOnly)throw Error(initial==='missing'?'LIBRARY_NOT_FOUND':'LIBRARY_UPGRADE_REQUIRED: open the library in Shiqu before exporting.');
 const release=ownsDesktopData(directory)?()=>{}:ownDesktopDataSync(directory);
 try{return withLibraryGate(directory,()=>{
  const pending=pendingUpgrade(directory);
  if(pending)try{recover(directory);}catch(error){throw Error(`LIBRARY_RECOVERY_FAILED; backup: ${pending.backup||'fresh library'}; ${String(error)}`,{cause:error});}
  const state=inspectLibrary(directory);if(state==='current')return applyPendingMigrations(directory,root);
  const workName='.desktop-upgrade-'+randomUUID(),work=path.join(directory,workName);
  durableFile(path.join(directory,upgradeJournal),JSON.stringify({version:libraryFormat.schemaVersion,work:workName,backup:null})+'\n');
  try{
   options.onStep?.('journal');
   mkdirSync(work,{mode:0o700});
   const staged=path.join(work,'shiqu.sqlite');
   const sqlite=new DatabaseSync(staged);
   try{
    sqlite.exec('PRAGMA foreign_keys=ON');
    migrate(sqlite,root,work);
    sqlite.exec(readFileSync(path.join(root,'docker/seed.sql'),'utf8'));
    if(sqlite.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok')throw Error('LIBRARY_DATABASE_CORRUPT');
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
   }finally{sqlite.close();}
   options.onStep?.('staged');
   renameSync(staged,path.join(directory,'shiqu.sqlite'));syncDirectory(directory);
   options.onStep?.('database-published');
   rmSync(work,{recursive:true,force:true});syncDirectory(directory);
   options.onStep?.('cleanup');
   rmSync(path.join(directory,upgradeJournal));syncDirectory(directory);
   return {backup:null};
  }catch(error){
   try{recover(directory);}catch(recovery){throw Error(`LIBRARY_RECOVERY_FAILED; backup: fresh library; ${String(recovery)}`,{cause:error});}
   throw Error(`LIBRARY_UPGRADE_FAILED; restored original library; backup: fresh library; ${String(error)}`,{cause:error});
  }
 });}finally{release();}
}
export function restoreAndUpgradeLibrary(source:string,target:string,root:string,expectedCreatedAt?:string){
 assertBackupDestination(source,target);
 const database=path.join(source,'shiqu.sqlite');
 if(lstatSync(database).isFile())checkLibraryHeader(database);
 return withBackupAccess(source,()=>{
  const stage=path.join(path.dirname(target),'.'+path.basename(target)+'.restore-'+randomUUID()),stageBackups=backupDirectory(stage);
  try{
   const manifest=restoreLibraryBackup(source,stage);
   if(expectedCreatedAt&&manifest.createdAt!==expectedCreatedAt)throw Error('BACKUP_CHANGED');
   try{ensureLibraryReady(stage,root);checkDatabase(path.join(stage,'shiqu.sqlite'));}
   catch(error){throw Error(`LIBRARY_RESTORE_FAILED; nothing restored; source backup unchanged: ${path.resolve(source)}; ${String(error)}`,{cause:error});}
   // 已校验的源快照保留升级前状态，恢复结果应指向它。
   const report=path.join(stage,'.desktop-upgrade-result.json');
   if(existsSync(report))durableFile(report,JSON.stringify({...JSON.parse(readFileSync(report,'utf8')),backup:path.resolve(source)})+'\n');
   assertBackupDestination(source,target);renameSync(stage,target);return manifest;
  }finally{rmSync(stage,{recursive:true,force:true});rmSync(stageBackups,{recursive:true,force:true});}
 },true);
}

export function libraryUpgradeBackup(directory:string):string|undefined{
 if(inspectLibrary(directory)!=='current')return;
 const filename=path.join(directory,'.desktop-upgrade-result.json');
 if(!existsSync(filename))return;
 try{const value=JSON.parse(readFileSync(filename,'utf8'));return typeof value.backup==='string'?value.backup:undefined;}catch{return;}
}
