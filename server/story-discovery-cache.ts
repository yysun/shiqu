// Persist versioned discovery documents atomically and share work within this Node process.
// Each caller may leave independently; settled model work is saved by the worker before it stops.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {MediaStore} from '../lib/services.ts';
import type {SuggestionProgress} from '../lib/reader-suggestions.ts';
import {ReaderError} from '../lib/reader-model.ts';

export type ReadingObserver={signal:AbortSignal;onProgress:(progress:SuggestionProgress)=>void};
type Flight={controller:AbortController;promise:Promise<unknown>;listeners:Set<ReadingObserver|undefined>;progress?:SuggestionProgress;settled:boolean};
const envelope=z.object({version:z.literal(1),key:z.string(),value:z.unknown()});
export function discoveryHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

function wait<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return promise;
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const stop=()=>{signal.removeEventListener('abort',stop);reject(signal.reason);};
  signal.addEventListener('abort',stop,{once:true});
  promise.then(value=>{signal.removeEventListener('abort',stop);resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});
 });
}

export class StoryDiscoveryCache{
 private flights=new Map<string,Flight>();
 private store:MediaStore;
 constructor(store:MediaStore){this.store=store;}
 async read<T>(key:string,schema:z.ZodType<T>,valid:(value:T)=>boolean=()=>true):Promise<T|null>{
  let object;
  try{object=await this.store.get(`reader-cache/${discoveryHash(key)}.json`);}
  catch{throw new ReaderError(503,'故事缓存暂时无法读取，请检查数据目录权限。');}
  if(!object)return null;
  try{
   const data=envelope.parse(JSON.parse(new TextDecoder().decode(await object.arrayBuffer())));
   if(data.key!==key)return null;
   const parsed=schema.safeParse(data.value);
   return parsed.success&&valid(parsed.data)?parsed.data:null;
  }catch{return null;}
 }
 async write(key:string,value:unknown){
  try{await this.store.put(`reader-cache/${discoveryHash(key)}.json`,new TextEncoder().encode(JSON.stringify({version:1,key,value})),{contentType:'application/json'});}
  catch{throw new ReaderError(503,'故事缓存暂时无法保存，请检查数据目录权限后重试。');}
 }
 async shared<T>(key:string,observer:ReadingObserver|undefined,work:(reading:ReadingObserver)=>Promise<T>):Promise<T>{
  observer?.signal.throwIfAborted();
  let flight=this.flights.get(key);
  if(flight?.controller.signal.aborted){await wait(flight.promise.catch(()=>{}),observer?.signal);return this.shared(key,observer,work);}
  if(!flight){
   const current:Flight={controller:new AbortController(),listeners:new Set(),settled:false,promise:Promise.resolve()};
   current.promise=Promise.resolve().then(()=>work({signal:current.controller.signal,onProgress:progress=>{
    current.progress=progress;
    for(const listener of current.listeners)if(!listener?.signal.aborted)listener?.onProgress(progress);
   }}));
   const finish=()=>{current.settled=true;if(this.flights.get(key)===current)this.flights.delete(key);};
   current.promise.then(finish,finish);this.flights.set(key,current);flight=current;
  }
  // Give callers without a stream their own lifetime too; undefined is not a unique subscriber.
  const listener=observer||{signal:new AbortController().signal,onProgress:()=>{}};
  flight.listeners.add(listener);
  if(flight.progress)listener.onProgress(flight.progress);
  try{return await wait(flight.promise as Promise<T>,observer?.signal);}
  finally{flight.listeners.delete(listener);if(!flight.listeners.size&&!flight.settled)flight.controller.abort();}
 }
}
