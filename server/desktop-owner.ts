// Keep ownership in Node as well as the GUI so a GUI crash cannot overlap a still-exiting server.
import {open,readFile,unlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function ownDesktopData(directory:string){
 await mkdir(directory,{recursive:true});const filename=path.join(directory,'.desktop-owner.json'),id=randomUUID();
 for(let attempt=0;attempt<2;attempt++){
  try{
   const file=await open(filename,'wx',0o600);
   try{await file.writeFile(JSON.stringify({pid:process.pid,id}));}finally{await file.close();}
   return async()=>{try{if(JSON.parse(await readFile(filename,'utf8')).id===id)await unlink(filename);}catch{/* Already removed during cleanup. */}};
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   let previous:{pid:number};try{previous=JSON.parse(await readFile(filename,'utf8'));}catch{throw Error('DATA_BUSY');}
   if(!Number.isSafeInteger(previous.pid)||previous.pid<1)throw Error('DATA_BUSY');
   try{process.kill(previous.pid,0);throw Error('DATA_BUSY');}
   catch(check){if((check as NodeJS.ErrnoException).code!=='ESRCH')throw Error('DATA_BUSY');}
   // Native desktop startup holds the directory's OS lock while reclaiming a dead owner.
   await unlink(filename);
  }
 }
 throw Error('DATA_BUSY');
}
