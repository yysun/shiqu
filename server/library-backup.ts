// Offline library snapshots share the production SQLite/media format. Stage and verify before publishing;
// callers hold the service ownership lock, and restores never open a writable/migrating database.
import {DatabaseSync} from 'node:sqlite';
import {constants,existsSync,mkdirSync,lstatSync,readdirSync,realpathSync,readFileSync,writeFileSync,copyFileSync,renameSync,rmSync,openSync,readSync,closeSync,chmodSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {officialVectorDirectory,officialVectorFilename,storyCardsPath} from './story-index-paths.ts';

const manifestName='shiqu-backup.json';
const relative=z.string().min(1).max(2048).refine(s=>!path.isAbsolute(s)&&!s.includes('\\')&&!s.split('/').some(p=>!p||p==='.'||p==='..')&&!/[\x00-\x1f]/.test(s)); // eslint-disable-line no-control-regex
const manifestSchema=z.object({format:z.literal('shiqu-library-backup'),version:z.literal(1),createdAt:z.string().datetime(),appVersion:z.string().max(80),files:z.array(z.object({path:relative,size:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(200000)}).strict();
type Manifest=z.infer<typeof manifestSchema>;
const runtimeFile=(name:string)=>name==='.diagnostics'||name.startsWith('.desktop')||name.startsWith('.story-index-install-')||['shiqu.sqlite-wal','shiqu.sqlite-shm','shiqu.sqlite-journal'].includes(name);
function directory(folder:string){const info=lstatSync(folder);if(info.isSymbolicLink()||!info.isDirectory())throw Error('BACKUP_UNSAFE_DIRECTORY');}
export function canonicalPath(filename:string):string{
 let parent=path.resolve(filename);const suffix:string[]=[];
 while(!existsSync(parent)){suffix.unshift(path.basename(parent));const next=path.dirname(parent);if(next===parent)throw Error('BACKUP_INVALID_PATH');parent=next;}
 return path.join(realpathSync(parent),...suffix);
}
export function containsPath(parent:string,child:string){const r=path.relative(canonicalPath(parent),canonicalPath(child));return r===''||!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);}
function targets(source:string,target:string){
 if(containsPath(source,target)||containsPath(target,source))throw Error('BACKUP_OVERLAPPING_PATHS');
 // lstat also rejects dangling links, which existsSync deliberately does not report.
 try{lstatSync(target);throw Error('BACKUP_TARGET_EXISTS');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
function hash(filename:string){
 const file=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW),digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let size=0;
 try{let n;while((n=readSync(file,buffer,0,buffer.length,null))>0){digest.update(buffer.subarray(0,n));size+=n;}}finally{closeSync(file);}
 return {size,sha256:digest.digest('hex')};
}
function isOfficialVectorResource(cache:string,filename:string,isDirectory:boolean){
 const [edition,file,...tail]=path.relative(cache,filename).split(path.sep);
 if(isDirectory&&!file&&edition.startsWith('.story-index-install-'))return true;
 if(isDirectory||!file||tail.length||!(/^[a-f0-9]{64}$/).test(edition))return false;
 const name=file.replace(/-(?:wal|shm|journal)$/,'');
 if(!name.startsWith('vectors-')||!name.endsWith('.sqlite'))return false;
 try{return officialVectorFilename(decodeURIComponent(name.slice(8,-7)))===name;}
 catch{return false;}
}
function files(folder:string,excludeRuntime=false,prefix='',resources?:{cards?:string;cache:string}):string[]{
 directory(folder);const result:string[]=[];
 for(const entry of readdirSync(folder).sort()){
  if(!prefix&&(entry===manifestName||excludeRuntime&&runtimeFile(entry)))continue;
  const name=prefix?prefix+'/'+entry:entry;relative.parse(name);
  const filename=path.join(folder,entry),info=lstatSync(filename);
  if(resources&&(info.isDirectory()&&filename===resources.cards||isOfficialVectorResource(resources.cache,filename,info.isDirectory())))continue;
  if(info.isSymbolicLink())throw Error('BACKUP_SYMLINK: symlink');
  if(info.isDirectory())result.push(...files(filename,false,name,resources));
  else if(info.isFile())result.push(name);else throw Error('BACKUP_UNSUPPORTED_FILE');
 }
 return result;
}
export function checkDatabase(filename:string){
 const info=lstatSync(filename);if(!info.isFile()||info.isSymbolicLink())throw Error('BACKUP_INVALID_DATABASE');
 const db=new DatabaseSync(filename,{readOnly:true});
 try{db.exec('PRAGMA busy_timeout=2000');if(db.prepare('PRAGMA integrity_check').all().some(row=>row.integrity_check!=='ok'))throw Error('BACKUP_DATABASE_CORRUPT');}
 finally{db.close();}
}
export function verifyLibraryBackup(folder:string):Manifest{
 directory(folder);const filename=path.join(folder,manifestName),info=lstatSync(filename);
 if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024*1024)throw Error('BACKUP_INVALID_MANIFEST');
 const manifest=manifestSchema.parse(JSON.parse(readFileSync(filename,'utf8'))),names=manifest.files.map(f=>f.path);
 if(new Set(names).size!==names.length||!names.includes('shiqu.sqlite')||names.some(n=>n===manifestName||runtimeFile(n.split('/')[0])))throw Error('BACKUP_INVALID_MANIFEST');
 const actual=files(folder);if(JSON.stringify(actual.sort())!==JSON.stringify([...names].sort()))throw Error('BACKUP_FILE_SET_MISMATCH');
 for(const file of manifest.files){const actual=hash(path.join(folder,file.path));if(actual.size!==file.size||actual.sha256!==file.sha256)throw Error('BACKUP_FILE_MISMATCH');}
 checkDatabase(path.join(folder,'shiqu.sqlite'));return manifest;
}
function stageDirectory(target:string){
 mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
 const stage=path.join(path.dirname(target),'.'+path.basename(target)+'.partial-'+randomUUID());mkdirSync(stage,{mode:0o700});return stage;
}
function copyPrivate(source:string,target:string){mkdirSync(path.dirname(target),{recursive:true,mode:0o700});copyFileSync(source,target,constants.COPYFILE_EXCL);chmodSync(target,0o600);}
export function createLibraryBackup(source:string,target:string,appVersion='unknown',root?:string){
 source=path.resolve(source);target=path.resolve(target);directory(source);targets(source,target);checkDatabase(path.join(source,'shiqu.sqlite'));
 // 只排除当前应用的正式资源。旧备份仍按原清单校验和恢复。
 const actualSource=realpathSync(source);
 const forSource=(resource:string)=>path.join(source,path.relative(actualSource,canonicalPath(resource)));
 const resources={cache:forSource(officialVectorDirectory()),cards:root?forSource(path.join(root,storyCardsPath)):undefined};
 const names=files(source,true,'',resources),stage=stageDirectory(target);
 try{
  const db=new DatabaseSync(path.join(source,'shiqu.sqlite'),{readOnly:true});
  try{db.prepare('VACUUM INTO ?').run(path.join(stage,'shiqu.sqlite'));chmodSync(path.join(stage,'shiqu.sqlite'),0o600);}finally{db.close();}
  for(const name of names)if(name!=='shiqu.sqlite')copyPrivate(path.join(source,name),path.join(stage,name));
  const manifest:Manifest={format:'shiqu-library-backup',version:1,createdAt:new Date().toISOString(),appVersion,files:files(stage).map(name=>({path:name,...hash(path.join(stage,name))}))};
  writeFileSync(path.join(stage,manifestName),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  verifyLibraryBackup(stage);targets(source,target);renameSync(stage,target);return manifest;
 }finally{rmSync(stage,{recursive:true,force:true});}
}
export function restoreLibraryBackup(source:string,target:string){
 source=path.resolve(source);target=path.resolve(target);targets(source,target);const manifest=verifyLibraryBackup(source),stage=stageDirectory(target);
 try{
  for(const file of manifest.files)copyPrivate(path.join(source,file.path),path.join(stage,file.path));
  for(const file of manifest.files){const actual=hash(path.join(stage,file.path));if(actual.sha256!==file.sha256||actual.size!==file.size)throw Error('BACKUP_CHANGED_DURING_RESTORE');}
  checkDatabase(path.join(stage,'shiqu.sqlite'));targets(source,target);renameSync(stage,target);return manifest;
 }finally{rmSync(stage,{recursive:true,force:true});}
}
