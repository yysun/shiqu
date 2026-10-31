// Hold an OS-released SQLite transaction lock for every CLI/desktop Node service.
// Keep the owner JSON for older releases; serialize dead-owner recovery before touching it.
import {open,readFile,unlink,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function ownDesktopData(directory:string){
 await mkdir(directory,{recursive:true});
 const lock=new DatabaseSync(path.join(directory,'.desktop-owner.sqlite'));
 try{lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');}
 catch{lock.close();throw Error('DATA_BUSY');}
 const filename=path.join(directory,'.desktop-owner.json'),id=randomUUID();
 try{
  for(let attempt=0;attempt<2;attempt++){
   try{
    const file=await open(filename,'wx',0o600);
    try{await file.writeFile(JSON.stringify({pid:process.pid,id}));}finally{await file.close();}
    let released=false;
    return async()=>{
     if(released)return;released=true;
     try{if(JSON.parse(await readFile(filename,'utf8')).id===id)await unlink(filename);}
     catch{/* Already removed during cleanup. */}
     finally{lock.close();}
    };
   }catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    let previous:{pid:number};try{previous=JSON.parse(await readFile(filename,'utf8'));}catch{throw Error('DATA_BUSY');}
    if(!Number.isSafeInteger(previous.pid)||previous.pid<1)throw Error('DATA_BUSY');
    try{process.kill(previous.pid,0);throw Error('DATA_BUSY');}
    catch(check){if((check as NodeJS.ErrnoException).code!=='ESRCH')throw Error('DATA_BUSY');}
    await unlink(filename);
   }
  }
  throw Error('DATA_BUSY');
 }catch(error){lock.close();throw error;}
}
