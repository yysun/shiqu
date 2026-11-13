// Persist versioned discovery documents atomically and share work within this Node process.
// Each caller may leave independently; settled model work is saved by the worker before it stops.
// A draining caller that ends a flight waits for its call, so a freed worker slot is truly free.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {MediaStore} from '../lib/services.ts';
import type {DiscoveryContext} from '../lib/reader-discovery-call.ts';
import type {SuggestionProgress} from '../lib/reader-suggestions.ts';
import type {StoryReading} from '../lib/reader-provider.ts';
import type {VerifiedThemeDecision} from '../lib/reader-theme-match.ts';
import {ReaderError} from '../lib/reader-model.ts';

type VerificationUpdate={decisions:VerifiedThemeDecision[];checking?:string[];modelBatchCardCount?:number};
export type ReadingObserver=StoryReading&{onCallStart?:DiscoveryContext['onCallStart'];onVerification?:(update:VerificationUpdate)=>void};
type Flight={controller:AbortController;promise:Promise<unknown>;listeners:Set<ReadingObserver|undefined>;callListeners?:Set<ReadingObserver|undefined>;progress?:SuggestionProgress;verification?:VerificationUpdate;settled:boolean};
const flightsByStore=new WeakMap<object,Map<string,Flight>>();
const writesByStore=new WeakMap<object,Map<string,Promise<unknown>>>();
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
 private updates=new Map<string,Promise<unknown>>();
 readonly identity:object;
 private store:MediaStore;
 constructor(store:MediaStore){this.store=store;this.identity=store;let flights=flightsByStore.get(store);if(!flights){flights=new Map();flightsByStore.set(store,flights);}this.flights=flights;let updates=writesByStore.get(store);if(!updates){updates=new Map();writesByStore.set(store,updates);}this.updates=updates;}
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
 // Every queued mutation executes against the latest file; a shared flight would discard joiners' work.
 async update<T>(key:string,schema:z.ZodType<T>,initial:()=>T,change:(value:T)=>T|Promise<T>):Promise<T>{
  const previous=this.updates.get(key)||Promise.resolve();
  const pending=previous.catch(()=>{}).then(async()=>{
   const value=await change(await this.read(key,schema)||initial());
   await this.write(key,value);return value;
  });
  this.updates.set(key,pending);
  try{return await pending;}finally{if(this.updates.get(key)===pending)this.updates.delete(key);}
 }
 get busy(){return this.flights.size>0||this.updates.size>0;}
 async settle(){
  while(this.busy)await Promise.allSettled([...this.updates.values(),...[...this.flights.values()].map(flight=>flight.promise)]);
 }
 async shared<T>(key:string,observer:ReadingObserver|undefined,work:(reading:ReadingObserver)=>Promise<T>):Promise<T>{
  observer?.signal.throwIfAborted();
  let flight=this.flights.get(key);
  if(flight?.controller.signal.aborted){await wait(flight.promise.catch(()=>{}),observer?.signal);return this.shared(key,observer,work);}
  if(!flight){
   const current:Flight={controller:new AbortController(),listeners:new Set(),settled:false,promise:Promise.resolve()};
   current.promise=Promise.resolve().then(()=>work({signal:current.controller.signal,cycleId:observer?.cycleId,onCallStart:()=>{
    // Cost attribution survives departure, but future calls capture only their own live demand.
    const recipients=new Set(current.listeners);current.callListeners=recipients;
    return event=>{for(const listener of recipients)listener?.onCall?.(event);if(current.callListeners===recipients)delete current.callListeners;};
   },onCall:event=>{for(const listener of current.listeners)listener?.onCall?.(event);},onProgress:progress=>{
    current.progress=progress;
    for(const listener of current.listeners)if(!listener?.signal.aborted)listener?.onProgress(progress);
   },onVerification:update=>{
    current.verification=update;
    for(const listener of current.listeners)if(!listener?.signal.aborted)listener?.onVerification?.(update);
   }}));
   const finish=()=>{current.settled=true;if(this.flights.get(key)===current)this.flights.delete(key);};
   current.promise.then(finish,finish);this.flights.set(key,current);flight=current;
  }
  // Give callers without a stream their own lifetime too; undefined is not a unique subscriber.
  const listener=observer||{signal:new AbortController().signal,onProgress:()=>{}};
  flight.listeners.add(listener);flight.callListeners?.add(listener);
  if(flight.progress)listener.onProgress(flight.progress);
  if(flight.verification)listener.onVerification?.(flight.verification);
  const current=flight;
  const leave=async()=>{
   current.listeners.delete(listener);
   if(current.listeners.size||current.settled)return;
   current.controller.abort();
   // A call that failed for its own reason must count as that failure, not as a clean stop.
   if(!observer?.drain)return;
   const failure=await current.promise.then(()=>undefined,error=>error);
   if(failure!==undefined&&failure!==current.controller.signal.reason)throw failure;
  };
  let value:T;
  try{value=await wait(current.promise as Promise<T>,observer?.signal);}
  catch(error){await leave();throw error;}
  await leave();return value;
 }
}
