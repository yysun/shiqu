// Package story JSON, storyboard and full-resolution WebP images locally; never export a partial archive.
import {zipSync,strToU8} from 'fflate';
import type {Story} from './content';
import type {GeneratedStory} from './reader-model';
import {pdfFilename,storySourceReference} from './reader-pdf.ts';

export function zipFilename(title:string){return pdfFilename(title).replace(/-拾趣\.pdf$/,'.zip');}
export function assertZipReady(story:Story){
 if(!story.pages.length||story.pages.some(page=>!page.image))throw Error('等所有画面生成完成后，就能下载分镜与图片 ZIP。');
}
async function webpImage(blob:Blob,page:number){
 if(blob.type.split(';')[0].trim().toLowerCase()==='image/webp')return blob;
 const image=new Image(),url=URL.createObjectURL(blob);
 let canvas:HTMLCanvasElement|undefined;
 try{
  image.src=url;await image.decode();
  canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d');if(!context)throw Error('CANVAS_UNAVAILABLE');
  context.drawImage(image,0,0);
  return await new Promise<Blob>((resolve,reject)=>canvas!.toBlob(result=>{
   if(!result?.size||result.type!=='image/webp')reject(Error('WEBP_UNAVAILABLE'));
   else resolve(result);
  },'image/webp',.85));
 }catch{throw Error(`第 ${page+1} 幅画面转为 WebP 失败，请换用支持 WebP 导出的浏览器后重试。`);}
 finally{image.src='';URL.revokeObjectURL(url);if(canvas){canvas.width=0;canvas.height=0;}}
}
function storyboardText(story:Story,images:string[]){
 const generated='generated'in story&&story.generated===true?story as GeneratedStory:null;
 return [
  `# ${story.title}`,story.hook,`主题：${story.theme}`,`出处：${storySourceReference(story)}`,
  story.sourceUrl&&`出处链接：${story.sourceUrl}`,
  generated?.artStyleLabel&&`画风：${generated.artStyleLabel}`,
  generated?.productionPrompt&&`## 制作要求\n\n${generated.productionPrompt}`,
  ...story.pages.map((page,index)=>`## 第 ${index+1} 幅\n\n图片：${images[index]}\n\n### 旁白\n\n${page.caption}\n\n### 画面提示词\n\n${page.prompt||'这幅未保存画面提示词。'}`),
  story.reflection&&`## 余味\n\n${story.reflection}`,
  story.adaptationNote&&`## 改编说明\n\n${story.adaptationNote}`,
 ].filter(Boolean).join('\n\n')+'\n';
}
export async function createStoryZip(story:Story,onProgress:(text:string)=>void=()=>{}){
 assertZipReady(story);
 const files:Record<string,Uint8Array>={},images:string[]=[];
 const digits=Math.max(2,String(story.pages.length).length);
 for(const [index,page] of story.pages.entries()){
  onProgress(`正在打包第 ${index+1} / ${story.pages.length} 幅`);
  const url=new URL(page.image,location.origin);
  if(url.origin!==location.origin)throw Error('画面来源不可用，无法打包 ZIP。');
  const response=await fetch(url.href,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`第 ${index+1} 幅读取失败，请保持联网后重试。`);
  const blob=await response.blob();
  const mime=blob.type.split(';')[0].trim().toLowerCase();
  if(!['image/png','image/jpeg','image/webp'].includes(mime)||!blob.size)throw Error(`第 ${index+1} 幅画面暂不可用，无法打包 ZIP。`);
  const webp=await webpImage(blob,index),filename=`图片/${String(index+1).padStart(digits,'0')}.webp`;
  images.push(filename);files[filename]=new Uint8Array(await webp.arrayBuffer());
 }
 onProgress('正在整理分镜与保存 ZIP');
 files['分镜.md']=strToU8(storyboardText(story,images));
 const generated='generated'in story&&story.generated===true?story as GeneratedStory:null;
 files['故事.json']=strToU8(JSON.stringify({
  id:story.id,title:story.title,hook:story.hook,bookId:story.bookId,theme:story.theme,
  sourceReference:storySourceReference(story),sourceText:story.sourceText,sourceUrl:story.sourceUrl,
  artStyleLabel:generated?.artStyleLabel??null,productionPrompt:generated?.productionPrompt??'',
  generationModels:generated?.generationModels??[],
  pages:story.pages.map((page,index)=>({caption:page.caption,prompt:page.prompt,image:images[index]})),
  reflection:story.reflection,adaptationNote:story.adaptationNote,
  revision:story.revision,createdAt:story.createdAt,updatedAt:story.updatedAt,
 },null,2)+'\n');
 // WebP is already compressed; avoid repeating compression while building the archive.
 return new Blob([zipSync(files,{level:0}) as BlobPart],{type:'application/zip'});
}
export async function downloadStoryZip(story:Story,onProgress:(text:string)=>void){
 const blob=await createStoryZip(story,onProgress),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=zipFilename(story.title);(document.querySelector('dialog[open]')||document.body).appendChild(link);link.click();link.remove();
 return {url,filename:link.download};
}
