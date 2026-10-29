// Keep legacy media readable while queued attempts write immutable artifacts. References
// use the caller's saved first image, whose filename may retain an earlier page index
// after reordering. Keep references inside this story's valid media namespace.
import {readerMaxFrames} from './reader-limits.ts';
export function readerImageAsset(id:string,page:number,extension:string,artifactId?:string){
 if(!Number.isInteger(page)||page<0||page>=readerMaxFrames||!['png','jpg','webp'].includes(extension)||artifactId!==undefined&&!/^[a-f0-9]{64}$/.test(artifactId))throw Error('INVALID_IMAGE_KEY');
 const file=artifactId?`artifacts/${page}-${artifactId}.${extension}`:`${page}.${extension}`;
 return {file,key:`reader/${id}/${file}`,url:`/api/reader/media/${id}/${file}`};
}
export function referenceImageKey(id:string,reference:string){
 const prefix=`/api/reader/media/${id}/`;if(!reference.startsWith(prefix))return null;
 const file=reference.slice(prefix.length);
 const match=/^(?:(0|[1-9]\d*)\.(?:png|jpg|webp)|artifacts\/(0|[1-9]\d*)-[a-f0-9]{64}\.(?:png|jpg|webp))$/.exec(file);
 if(!match||match[0]!==file||Number(match[1]??match[2])>=readerMaxFrames)return null;
 return `reader/${id}/${file}`;
}
