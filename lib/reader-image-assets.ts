// Keep legacy media readable while queued attempts write immutable artifacts. References
// must name the first image inside this story; never follow arbitrary provider/model paths.
import {readerMaxFrames} from './reader-limits.ts';
export function readerImageAsset(id:string,page:number,extension:string,artifactId?:string){
 if(!Number.isInteger(page)||page<0||page>=readerMaxFrames||!['png','jpg','webp'].includes(extension)||artifactId!==undefined&&!/^[a-f0-9]{64}$/.test(artifactId))throw Error('INVALID_IMAGE_KEY');
 const file=artifactId?`artifacts/${page}-${artifactId}.${extension}`:`${page}.${extension}`;
 return {file,key:`reader/${id}/${file}`,url:`/api/reader/media/${id}/${file}`};
}
export function referenceImageKey(id:string,reference:string){
 const prefix=`/api/reader/media/${id}/`;if(!reference.startsWith(prefix))return null;
 const file=reference.slice(prefix.length);
 if(!/^0\.(png|jpg|webp)$/.test(file)&&!/^artifacts\/0-[a-f0-9]{64}\.(png|jpg|webp)$/.test(file))return null;
 return `reader/${id}/${file}`;
}
