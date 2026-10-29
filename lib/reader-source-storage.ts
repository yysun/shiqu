// Persist verified originals through the application media storage port.
import {lookupOriginal,sourceSearchUrl} from './reader-source.ts';
import type {OriginalSource,SourceResult,SourceHint} from './reader-source-types.ts';
import type {Selection} from './reader-model.ts';

export interface SourceAssets{
 get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>;
 put(key:string,value:Uint8Array,options:{contentType:string}):Promise<unknown>;
}
// Called during generation or an explicit legacy backfill, never on a reading GET.
export async function saveStoryOriginal(assets:SourceAssets,selection:Selection,plan:SourceHint,id:string,transport:typeof fetch=fetch):Promise<SourceResult>{
 const key=`reader/${id}/source.json`,cached=await assets.get(key);
 if(cached){
  try{
   const source=JSON.parse(new TextDecoder().decode(await cached.arrayBuffer())) as OriginalSource;
   if(source.text&&source.url&&source.title)return {source,message:'',searchUrl:sourceSearchUrl(selection,plan)};
  }catch{/* A corrupt legacy cache can be replaced from the verified source. */}
 }
 const result=await lookupOriginal(selection,plan,transport);
 if(result.source)await assets.put(key,new TextEncoder().encode(JSON.stringify(result.source)),{contentType:'application/json'});
 return result;
}
