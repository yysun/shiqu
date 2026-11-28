// 书库独占锁由操作系统释放；持锁期间发布当前实例的 CLI 地址。
import {openSync,readFileSync,writeFileSync,unlinkSync,mkdirSync,closeSync,renameSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {inspectLibrary} from './library-schema.ts';
type ServiceAddress={protocol:1;url:string;affinity?:string};
type Owner={pid:number;id:string;managed?:true;service?:ServiceAddress};
const ownerPath=(directory:string)=>path.join(directory,'.desktop-owner.json');
const owned=new Map<string,Owner>();
export function ownsDesktopData(directory:string){return owned.has(path.resolve(directory));}
export function desktopOwner(directory:string):Owner|undefined{
 try{
  const owner=JSON.parse(readFileSync(ownerPath(directory),'utf8')) as Owner;
  if(Number.isSafeInteger(owner?.pid)&&owner.pid>0&&typeof owner.id==='string'&&/^[a-f0-9-]{36}$/.test(owner.id))return owner;
 }catch{/* 启动或退出时记录可能尚未可读。 */}
}
export function ownerProcessExists(pid:number){
 try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}
}
export function publishDesktopOwner(directory:string,service:ServiceAddress){
 const owner=owned.get(path.resolve(directory));
 if(!owner)throw Error('DATA_BUSY');
 const filename=ownerPath(directory),draft=filename+'-'+owner.id;
 try{
  writeFileSync(draft,JSON.stringify({...owner,service}),{flag:'wx',mode:0o600});
  renameSync(draft,filename);
 }catch(error){
  try{unlinkSync(draft);}catch{/* 保留原始发布错误。 */}
  throw error;
 }
 return owner.id;
}
export function ownDesktopDataSync(directory:string,managed=false){
 inspectLibrary(directory);directory=path.resolve(directory);mkdirSync(directory,{recursive:true});
 const lock=new DatabaseSync(path.join(directory,'.desktop-owner.sqlite'));
 try{lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');}catch{lock.close();throw Error('DATA_BUSY');}
 const filename=ownerPath(directory),id=randomUUID();
 const owner:Owner={pid:process.pid,id,...(managed?{managed:true as const}:{})};
 try{
  for(let attempt=0;attempt<2;attempt++){
   let file:number;
   try{file=openSync(filename,'wx',0o600);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    let previous:{pid:number};try{previous=JSON.parse(readFileSync(filename,'utf8'));}catch{throw Error('DATA_BUSY');}
    if(!Number.isSafeInteger(previous.pid)||previous.pid<1)throw Error('DATA_BUSY');
    try{process.kill(previous.pid,0);throw Error('DATA_BUSY');}catch(check){if((check as NodeJS.ErrnoException).code!=='ESRCH')throw Error('DATA_BUSY');}
    unlinkSync(filename);continue;
   }
   try{writeFileSync(file,JSON.stringify(owner));}finally{closeSync(file);}
   owned.set(directory,owner);let released=false;
   return ()=>{if(released)return;released=true;owned.delete(directory);try{if(JSON.parse(readFileSync(filename,'utf8')).id===id)unlinkSync(filename);}catch{/* Already removed. */}finally{lock.close();}};
  }
  throw Error('DATA_BUSY');
 }catch(error){lock.close();throw error;}
}
export async function ownDesktopData(directory:string){
 const deadline=Date.now()+3000;
 let waitingFor:string|undefined;
 while(true){
  try{return ownDesktopDataSync(directory);}catch(error){
   if((error as Error).message!=='DATA_BUSY')throw error;
   const owner=desktopOwner(directory);
   if(Date.now()>=deadline||owner&&(!owner.managed||waitingFor&&owner.id!==waitingFor)||!owner&&!waitingFor)throw error;
   waitingFor??=owner?.id;
   await delay(30);
  }
 }
}
