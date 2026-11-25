// Store media at readable relative keys with atomic replacement; never follow symlinks.
import {constants} from 'node:fs';
import {open,mkdir,rename,rm,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {MediaStore} from '../lib/services.ts';
import type {Database,SyncStatements} from '../lib/reader-repository.ts';

export const mediaTypes:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.json':'application/json'};
export function mediaKey(key:string){
 if(!key||key.length>1024||key.split('/').some(part=>!part||part==='.'||part==='..'||!/^[-a-zA-Z0-9_.]+$/.test(part)))throw Error('Invalid media key');
 return key;
}
export class FileMedia implements MediaStore {
 directory:string;
 constructor(directory:string){this.directory=path.resolve(directory);}
 private async filename(key:string,create:boolean){
  mediaKey(key);if(create)await mkdir(this.directory,{recursive:true});
  const root=await realpath(this.directory);let current=root;
  const parts=key.split('/');
  for(const part of parts.slice(0,-1)){
   current=path.join(current,part);
   if(create)await mkdir(current,{recursive:true});
   const info=await lstat(current);
   if(!info.isDirectory()||info.isSymbolicLink())throw Error('Invalid media directory');
  }
  return path.join(current,parts.at(-1)!);
 }
 async get(key:string){
  let handle;
  try{
   const filename=await this.filename(key,false);
   handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
   if(!(await handle.stat()).isFile())throw Error('Invalid media file');
   const bytes=new Uint8Array(await handle.readFile());
   return {body:bytes,contentType:mediaTypes[path.extname(key)]||'application/octet-stream',async arrayBuffer(){return bytes.slice().buffer;}};
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  finally{await handle?.close();}
 }
 async remove(key:string){
  try{await rm(await this.filename(key,false),{force:true});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 async put(key:string,value:ArrayBuffer|Uint8Array,options:{contentType:string}){
  const expected=mediaTypes[path.extname(key)];
  if(!expected||expected!==options.contentType)throw Error('Unsupported media type');
  const filename=await this.filename(key,true),temp=filename+'.'+randomUUID()+'.tmp';
  const handle=await open(temp,'wx',0o600);
  try{
   try{await handle.writeFile(new Uint8Array(value instanceof ArrayBuffer?value:value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength)));await handle.sync();}
   finally{await handle.close();}
   await rename(temp,filename);
  }finally{await rm(temp,{force:true});}
 }
}


export type FamilyImage={alias:string;sessionId:string;sourceId:string;ownerId:string;rootId:string;target:string};
const familyMediaQuery=`SELECT a.target_key AS target,a.source_id AS sourceId FROM production_media_aliases a
 JOIN story_revisions destination ON destination.story_id=a.session_id AND destination.owner_id=a.owner_id AND destination.root_id=a.root_id
 JOIN story_revisions source ON source.story_id=a.source_id AND source.owner_id=a.owner_id AND source.root_id=a.root_id
 WHERE a.alias_key=?`;

/** 在保存新版本的事务中固定媒体引用。再次修订时直接引用原文件，保留一层别名。 */
export function recordFamilyImage(db:SyncStatements,image:FamilyImage){
 const previous=db.get<{sourceId:string;target:string}>(familyMediaQuery,image.target);
 const source=previous??{sourceId:image.sourceId,target:image.target};
 const owned=db.get(`SELECT 1 FROM story_revisions
  WHERE story_id=? AND owner_id=? AND root_id=?`,source.sourceId,image.ownerId,image.rootId);
 if(!owned)throw Error('INVALID_FAMILY_MEDIA_SOURCE');
 db.run('INSERT INTO production_media_aliases VALUES(?,?,?,?,?,?) ON CONFLICT(alias_key) DO NOTHING',
  image.alias,image.sessionId,source.sourceId,image.ownerId,image.rootId,source.target);
}

/** 书库媒体仍通过图片 URL 的原有归属检查。内部只解析同一所有者、同一家族的已保存引用。 */
export class LibraryMedia extends FileMedia{
 private readonly database:Database;
 constructor(directory:string,database:Database){super(directory);this.database=database;}
 override async get(key:string){
  const alias=/^reader\/[^/]+\/artifacts\//.test(key)?await this.database.prepare(familyMediaQuery).bind(key).first<{target:string}>():null;
  return super.get(alias?.target??key);
 }
}
