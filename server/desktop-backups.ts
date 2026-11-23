// 桌面维护入口只处理私有书库快照，复用 CLI 的备份校验与正式恢复迁移。
import {lstatSync,readFileSync,readdirSync,renameSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {assertBackupDestination,backupDirectory,canonicalPath,checkBackupDirectory,containsPath,createLibraryBackup,readBackupManifest,verifyLibraryBackup,withBackupAccess} from './library-backup.ts';
import {inspectLibrary,libraryFormat,pendingUpgrade,withLibraryGate} from './library-schema.ts';
import {backupOriginFile,migrationBackupDependency,pendingMigrations,restoreAndUpgradeLibrary} from './library-upgrade.ts';
import {ownDesktopDataSync} from './desktop-owner.ts';

const absolute=z.string().max(8192).refine(value=>path.isAbsolute(value)&&!value.includes('\0'));
const requestSchema=z.object({
 operation:z.enum(['list','create','inspect','verify','restore','delete','reveal']),
 library:absolute,backup:absolute.optional(),target:absolute.optional(),createdAt:z.string().datetime().optional(),
}).strict();

function failureCode(error:unknown){
 const failure=error as (NodeJS.ErrnoException&{errcode?:number})|undefined;
 if(failure?.errcode===13)return 'ENOSPC';
 return failure?.code||failure?.message?.match(/^[A-Z][A-Z_]+\b/)?.[0]||'BACKUP_INVALID';
}
export function desktopBackupError(error:unknown){
 let code=failureCode(error);
 if(code==='LIBRARY_RESTORE_FAILED')for(let cause=(error as Error).cause;cause instanceof Error;cause=cause.cause){
  if(failureCode(cause)==='ENOSPC'){code='ENOSPC';break;}
 }
 const messages:Record<string,string>={
  ENOENT:'未找到书库或备份。请检查目录或重新连接外置设备。',
  ENOSPC:'存储空间不足。请释放空间或选择其他磁盘。',
  EACCES:'无法访问所选目录，请检查权限。',
  EPERM:'无法操作所选目录，请检查权限。',
  EROFS:'所选位置为只读，请选择可写目录。',
  DATA_BUSY:'书库正在使用，请先停止桌面、CLI 或开发服务后重试。',
  BACKUP_IN_USE:'备份正在使用，请等待校验或恢复完成后重试。',
  BACKUP_TARGET_EXISTS:'目标目录已存在，请选择尚未创建的目录。',
  BACKUP_OVERLAPPING_PATHS:'所选目录和书库或备份重叠，请选择其他位置。',
  BACKUP_PUBLIC_PATH:'请选择应用公开目录之外的私有位置。',
  BACKUP_PROTECTED:'未完成的升级或恢复仍需要此备份。',
  BACKUP_DELETE_UNCERTAIN:'无法确认此备份可安全删除。请检查书库或重新读取列表。',
  BACKUP_CHANGED:'备份已变更。请刷新列表后重新确认。',
  BACKUP_FILE_SET_MISMATCH:'备份有缺失或多余文件，请选择其他快照。',
  BACKUP_FILE_MISMATCH:'备份文件大小或校验值不符，请选择其他快照。',
  LIBRARY_NEWER_SCHEMA:'此备份来自较新的书库格式，请使用支持该格式的拾趣版本。',
  LIBRARY_RESTORE_FAILED:'恢复或迁移未完成，原备份仍可使用。请检查所选快照和目标磁盘后重试。',
 };
 return messages[code]||'备份操作未通过检查。请检查文件和目录后重试。';
}
function optionalStat(filename:string){
 try{return lstatSync(filename);}catch(error){if(failureCode(error)!=='ENOENT')throw error;}
}
function snapshotKind(filename:string){
 const name=path.basename(filename);
 return name.startsWith('pre-upgrade-')?'upgrade':name.startsWith('manual-')?'manual':'unknown';
}
function snapshotInfo(filename:string,manifest=readBackupManifest(filename)){
 return {path:filename,createdAt:manifest.createdAt,appVersion:manifest.appVersion,kind:snapshotKind(filename),
  bytes:manifest.files.reduce((sum,file)=>sum+file.size,0)+lstatSync(path.join(filename,'shiqu-backup.json')).size};
}
function protectDeletion(library:string,backup:string,root:string){
 try{
  const dependencies=[pendingUpgrade(library)?.backup,migrationBackupDependency(library)?.backup];
  if(dependencies.some(file=>file&&canonicalPath(file)===canonicalPath(backup)))return 'protected';
  if(inspectLibrary(library)!=='current')return 'uncertain';
  if(snapshotKind(backup)==='upgrade'){
   if(pendingMigrations(library,root).length)return 'protected';
   // 旧快照可能来自另一书库通过目录别名保存的升级；缺少归属证据时保留。
   const originFile=backupOriginFile(backup),origin=optionalStat(originFile);
   if(!origin?.isFile()||origin.isSymbolicLink()||origin.size>32768)return 'uncertain';
   if(JSON.parse(readFileSync(originFile,'utf8')).library!==canonicalPath(library))return 'uncertain';
  }
 }catch{return 'uncertain';}
 return null;
}
function listBackups(library:string,root:string){
 const directory=backupDirectory(library);
 const entries:(Partial<ReturnType<typeof snapshotInfo>>&{path:string;error?:string;deletion:string|null})[]=[];
 const info=optionalStat(directory);
 if(!info)return {library,directory,available:false,entries};
 if(!info.isDirectory()||info.isSymbolicLink())throw Error('BACKUP_UNSAFE_DIRECTORY');
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
  const filename=path.join(directory,entry.name);
  if(!optionalStat(path.join(filename,'shiqu-backup.json')))continue;
  try{
   const snapshot=snapshotInfo(filename);
   entries.push({...snapshot,deletion:protectDeletion(library,filename,root)});
  }catch(error){
   entries.push({path:filename,kind:snapshotKind(filename),error:desktopBackupError(error),deletion:'uncertain'});
  }
 }
 entries.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
 return {library,directory,available:true,entries};
}
function compatibility(backup:string,root:string){
 const filename=path.join(backup,'shiqu.sqlite');
 const info=lstatSync(filename);
 if(!info.isFile()||info.isSymbolicLink())throw Error('BACKUP_INVALID_DATABASE');
 const db=new DatabaseSync(filename,{readOnly:true});
 let version:number;
 try{version=Number(db.prepare('PRAGMA user_version').get()!.user_version);}finally{db.close();}
 if(version>libraryFormat.schemaVersion)return {version,state:'unsupported',migrations:[]};
 try{
  const state=inspectLibrary(backup);
  if(state==='legacy')return {version,state:'migration',migrations:[]};
  if(state==='current'){
   const migrations=pendingMigrations(backup,root);
   if(version===libraryFormat.schemaVersion||migrations.length)return {version,state:migrations.length?'migration':'current',migrations};
  }
 }catch(error){
  if(['LIBRARY_INVALID_SCHEMA','LIBRARY_UNKNOWN_SCHEMA','LIBRARY_UNKNOWN_HISTORY'].includes(failureCode(error)))return {version,state:'unsupported',migrations:[]};
 }
 return {version,state:'unknown',migrations:[]};
}
function privateDestination(root:string,directory:string){
 for(const served of ['public','dist/client'])if(containsPath(path.join(root,served),directory))throw Error('BACKUP_PUBLIC_PATH');
}
function managedBackup(library:string,backup:string){
 const directory=backupDirectory(library);
 const info=lstatSync(directory);
 if(!info.isDirectory()||info.isSymbolicLink()||path.dirname(backup)!==directory||path.basename(backup).startsWith('.'))throw Error('BACKUP_DELETE_UNCERTAIN');
}
export function runDesktopBackup(root:string,version:string,input:unknown){
 const request=requestSchema.parse(input);
 const library=path.resolve(request.library);
 if(request.operation==='list')return listBackups(library,root);
 if(request.operation==='create'){
  const defaultDirectory=backupDirectory(library);
  const target=path.resolve(request.target||path.join(defaultDirectory,'manual-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)));
  if(path.dirname(target)===defaultDirectory)checkBackupDirectory(library);
  privateDestination(root,target);
  if(!optionalStat(path.join(library,'shiqu.sqlite')))throw Error('ENOENT');
  const release=ownDesktopDataSync(library);
  try{
   if(pendingUpgrade(library)||migrationBackupDependency(library))throw Error('BACKUP_PROTECTED');
   return snapshotInfo(target,createLibraryBackup(library,target,version,root));
  }finally{release();}
 }

 if(!request.backup)throw Error('BACKUP_INVALID');
 const backup=path.resolve(request.backup);
 if(request.operation==='inspect'||request.operation==='verify'){
  return withBackupAccess(backup,()=>{
   const manifest=request.operation==='verify'?verifyLibraryBackup(backup):readBackupManifest(backup);
   return {...snapshotInfo(backup,manifest),compatibility:compatibility(backup,root),
    ...(request.operation==='verify'?{verifiedAt:new Date().toISOString()}:{})};
  },true);
 }
 if(request.operation==='restore'){
  if(!request.target)throw Error('BACKUP_INVALID');
  const target=path.resolve(request.target);
  privateDestination(root,target);
  assertBackupDestination(library,target);
  if(containsPath(backupDirectory(library),target))throw Error('BACKUP_OVERLAPPING_PATHS');
  restoreAndUpgradeLibrary(backup,target,root,request.createdAt);
  return {path:target};
 }
 managedBackup(library,backup);
 if(request.operation==='reveal'){
  const info=lstatSync(backup);
  if(!info.isDirectory()||info.isSymbolicLink()||!optionalStat(path.join(backup,'shiqu-backup.json')))throw Error('BACKUP_INVALID');
  return {path:backup};
 }
 return withBackupAccess(backup,()=>{
  if(!optionalStat(library))throw Error('BACKUP_DELETE_UNCERTAIN');
  let retired:string|undefined;
  try{
   withLibraryGate(library,()=>{
    const protection=protectDeletion(library,backup,root);
    if(protection)throw Error(protection==='protected'?'BACKUP_PROTECTED':'BACKUP_DELETE_UNCERTAIN');
    if(verifyLibraryBackup(backup).createdAt!==request.createdAt)throw Error('BACKUP_CHANGED');
    retired=path.join(path.dirname(backup),'.deleted-'+randomUUID());
    renameSync(backup,retired);
    if(snapshotKind(backup)==='upgrade')rmSync(backupOriginFile(backup),{force:true});
   },true);
  }catch(error){
   if(failureCode(error)==='DATA_BUSY')throw Error('BACKUP_IN_USE',{cause:error});
   throw error;
  }
  if(retired)rmSync(retired,{recursive:true});
  return {path:backup};
 });
}
