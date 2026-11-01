// Convert an offline legacy local store without opening or modifying its source databases.
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir,readdir,stat,lstat,rm,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {FileMedia,mediaTypes,mediaKey} from './media.ts';
import {openDatabase} from './database.ts';
import {storySummaryMigration} from './story-summary-migration.ts';

async function exists(filename:string){try{return await lstat(filename);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
async function files(directory:string):Promise<string[]>{
 const info=await exists(directory);if(!info)return [];
 if(info.isSymbolicLink()||!info.isDirectory())throw Error('Legacy source must contain real directories, not symlinks');
 const found:string[]=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const filename=path.join(directory,entry.name);
  if(entry.isSymbolicLink())throw Error('Legacy source contains a symlink');
  if(entry.isDirectory())found.push(...await files(filename));else found.push(filename);
 }
 return found;
}
async function snapshot(filename:string,target:string){
 const wal=await exists(filename+'-wal');
 if(wal&&wal.size>0)throw Error('Legacy SQLite WAL is not empty. Stop the old service cleanly before importing.');
 const before=await stat(filename);const bytes=await readFile(filename);
 await writeFile(target,bytes,{flag:'wx',mode:0o600});
 const after=await stat(filename),afterWal=await exists(filename+'-wal');
 if(before.mtimeMs!==after.mtimeMs||before.size!==after.size||(afterWal&&afterWal.size>0))throw Error('Legacy source changed during import. Stop the old service first.');
 const db=new DatabaseSync(target);
 try{if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('Legacy SQLite integrity check failed');return db;}
 catch(error){db.close();throw error;}
}
export async function importLegacy(sourceDirectory:string,targetDirectory:string,root=process.cwd()){
 const source=path.resolve(sourceDirectory),target=path.resolve(targetDirectory);
 if(target===source||target.startsWith(source+path.sep)||source.startsWith(target+path.sep))throw Error('Use separate source and destination directories');
 const existing=await exists(target);
 if(existing&&(existing.isSymbolicLink()||!existing.isDirectory()||(await readdir(target)).length))throw Error('Destination must be a new or empty directory');
 const legacy=await exists(path.join(source,'v3'))?path.join(source,'v3'):source;
 const d1=(await files(path.join(legacy,'d1'))).filter(f=>f.endsWith('.sqlite')&&!f.endsWith('/metadata.sqlite'));
 const r2=(await files(path.join(legacy,'r2'))),r2db=r2.filter(f=>f.endsWith('.sqlite')&&!f.endsWith('/metadata.sqlite'));
 if(d1.length!==1||r2db.length>1)throw Error('Expected one legacy database and at most one media bucket; refusing to guess');
 await mkdir(path.dirname(target),{recursive:true});
 const stage=target+'.import-'+randomUUID();await mkdir(stage,{mode:0o700});
 try{
  const database=await snapshot(d1[0],path.join(stage,'shiqu.sqlite'));
  try{
   for(const table of ['books','stories','progress','events','jobs','reader_sessions','library_deletions','d1_migrations']){
    if(!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw Error('Unsupported legacy schema: '+table);
   }
   const names=database.prepare('SELECT name FROM d1_migrations').all().map(row=>String(row.name));
   const migrations=(await readdir(path.join(root,'drizzle'))).filter(f=>f.endsWith('.sql'));
   if(migrations.some(name=>name!==storySummaryMigration&&!names.includes(name)))throw Error('Legacy database migrations are incomplete; update the old edition before importing');
  }finally{database.close();}
  let objects=0;
  if(r2db.length){
   const filename=path.join(stage,'legacy-media.sqlite'),metadata=await snapshot(r2db[0],filename);
   try{
    const media=new FileMedia(path.join(stage,'media'));
    const rows=metadata.prepare('SELECT key,blob_id,size,http_metadata FROM _mf_objects').all();
    for(const row of rows){
     const key=mediaKey(String(row.key)),blobId=row.blob_id;
     if(typeof blobId!=='string'||!/^[-a-zA-Z0-9_]+$/.test(blobId))throw Error('Multipart or invalid legacy media object: '+key);
     const candidates=r2.filter(file=>path.basename(path.dirname(file))==='blobs'&&path.basename(file)===blobId);
     if(candidates.length!==1)throw Error('Missing or ambiguous legacy media blob: '+key);
     const bytes=await readFile(candidates[0]);
     if(bytes.length!==Number(row.size))throw Error('Incomplete legacy media blob: '+key);
     const contentType=mediaTypes[path.extname(key)],http=JSON.parse(String(row.http_metadata));
     if(!contentType||(http.contentType&&http.contentType!==contentType))throw Error('Unsupported legacy media type: '+key);
     await media.put(key,bytes,{contentType});objects++;
    }
   }finally{metadata.close();}
   await rm(filename);await rm(filename+'-wal',{force:true});await rm(filename+'-shm',{force:true});
  }
  const local=openDatabase(stage,root);
  try{
   // Retain SQL history in the new journal, then discard obsolete emulator bookkeeping.
   local.sqlite.exec('DROP TABLE IF EXISTS d1_migrations; DROP TABLE IF EXISTS _cf_METADATA');
   const references:string[]=[];
   for(const row of local.sqlite.prepare('SELECT pages FROM stories').all())for(const page of JSON.parse(String(row.pages)))references.push(page.image,page.audio);
   for(const row of local.sqlite.prepare('SELECT id,document FROM reader_sessions').all()){
    const doc=JSON.parse(String(row.document));references.push(...Object.values(doc.images||{}).map(String),...Object.values(doc.audio||{}).map(String));
   }
   const media=new FileMedia(path.join(stage,'media'));
   for(const reference of references.filter(Boolean)){
    const key=reference.startsWith('/api/reader/media/')?'reader/'+reference.slice('/api/reader/media/'.length):reference.startsWith('/api/media/')?reference.slice('/api/media/'.length):null;
    if(key&&!await media.get(key))throw Error('Referenced media is missing: '+key);
   }
   local.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }finally{local.close();}
  await writeFile(path.join(stage,'import.json'),JSON.stringify({version:1,importedAt:new Date().toISOString(),mediaObjects:objects},null,2)+'\n',{mode:0o600});
  await rename(stage,target);
  return {directory:target,mediaObjects:objects};
 }catch(error){await rm(stage,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [source,target]=process.argv.slice(2);
 if(!source||!target){console.error('Usage: pnpm import:legacy -- <stopped-legacy-data> <new-data-directory>');process.exitCode=1;}
 else try{console.log(await importLegacy(source,target));}catch(error){console.error(error instanceof Error?error.message:'Import failed');process.exitCode=1;}
}
