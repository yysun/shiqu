// Store media at readable relative keys with atomic replacement; never follow symlinks.
import {constants} from 'node:fs';
import {open,mkdir,rename,rm,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {MediaStore} from '../lib/services.ts';

export const mediaTypes:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.json':'application/json'};
export function mediaKey(key:string){
 if(!key||key.length>1024||key.split('/').some(part=>!part||part==='.'||part==='..'||!/^[-a-zA-Z0-9_.]+$/.test(part)))throw Error('Invalid media key');
 return key;
}
export class FileMedia implements MediaStore {
 directory:string;
 constructor(directory:string){this.directory=path.resolve(directory);}
 private async filename(key:string,create:boolean){
  mediaKey(key);await mkdir(this.directory,{recursive:true});
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
