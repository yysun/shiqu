// Validate actual pixels for stored originals and immutable artifacts. Codecs load their bundled
// WASM locally before decode errors may mean corruption; resource failures remain service errors.
// Cache only bounded content-hash verdicts, never image bytes or decoded pixel buffers.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import png,{init as initPng} from '@jsquash/png/decode.js';
import jpegFactory from '@jsquash/jpeg/codec/dec/mozjpeg_dec.js';
import webpFactory from '@jsquash/webp/codec/dec/webp_dec.js';
import {initEmscriptenModule} from '@jsquash/jpeg/utils.js';
import type {MediaStore} from '../lib/services.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';
import {mediaType} from '../lib/reader-generation-contract.ts';
import {imageDimensions,matchesLandscapeImageRatio} from '../lib/reader-image-dimensions.ts';
const require=createRequire(import.meta.url),verdicts=new Map<string,boolean>();
type Codecs={jpeg:Awaited<ReturnType<typeof jpegFactory>>;webp:Awaited<ReturnType<typeof webpFactory>>};
let initialized:Promise<Codecs>|undefined;
async function initialize(){
 if(!initialized){
  const compile=async(name:string)=>WebAssembly.compile(await readFile(require.resolve(name)));
  const options={noInitialRun:true,printErr:()=>{}};
  initialized=Promise.all([
   compile('@jsquash/png/codec/pkg/squoosh_png_bg.wasm').then(module=>initPng(module)),
   compile('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm').then(module=>initEmscriptenModule(jpegFactory,module,options)),
   compile('@jsquash/webp/codec/dec/webp_dec.wasm').then(module=>initEmscriptenModule(webpFactory,module,options)),
  ]).then(([,jpeg,webp])=>({jpeg,webp})).catch(error=>{initialized=undefined;throw error;});
 }
 return initialized;
}
export async function readableImage(bytes:Uint8Array){
 const type=mediaType(bytes);if(!type||!imageDimensions(bytes))return false;
 const hash=createHash('sha256').update(bytes).digest('hex'),saved=verdicts.get(hash);if(saved!==undefined)return saved;
 const codecs=await initialize(); // Do not classify missing WASM or failed initialization as a corrupt picture.
 let valid:boolean;
 try{
  const data=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
  const decoded=await (type==='image/png'?png(data):type==='image/jpeg'?codecs.jpeg.decode(data,true):codecs.webp.decode(data));
  valid=!!decoded&&decoded.width>0&&decoded.height>0&&decoded.data.length===decoded.width*decoded.height*4;
 }catch(error){
  if(error instanceof RangeError||error instanceof WebAssembly.RuntimeError)throw error;
  valid=false;
 }
 if(verdicts.size>=128)verdicts.delete(verdicts.keys().next().value!);verdicts.set(hash,valid);return valid;
}
export async function readableLandscapeImage(bytes:Uint8Array){
 const dimensions=imageDimensions(bytes);
 return !!dimensions&&matchesLandscapeImageRatio(dimensions)&&await readableImage(bytes);
}

export async function readableSavedPortrait(media:MediaStore,id:string,image:string){
 const key=referenceImageKey(id,image),asset=key&&await media.get(key);
 return !!asset&&mediaType(asset.body)===asset.contentType&&await readableImage(asset.body);
}
