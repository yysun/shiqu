// Package the saved storyboard and original images locally; never export a partial archive.
import {zipSync,strToU8} from 'fflate';
import type {Story} from './content';
import type {GeneratedStory} from './reader-model';
import {pdfFilename,storySourceReference} from './reader-pdf.ts';

export function zipFilename(title:string){return pdfFilename(title).replace(/-拾趣\.pdf$/,'.zip');}
export function assertZipReady(story:Story){
 if(!story.pages.length||story.pages.some(page=>!page.image))throw Error('等所有画面生成完成后，就能下载分镜与图片 ZIP。');
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
  const extension=({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp' } as Record<string,string>)[mime];
  if(!extension||!blob.size)throw Error(`第 ${index+1} 幅画面暂不可用，无法打包 ZIP。`);
  const filename=`图片/${String(index+1).padStart(digits,'0')}.${extension}`;
  images.push(filename);files[filename]=new Uint8Array(await blob.arrayBuffer());
 }
 onProgress('正在整理分镜与保存 ZIP');
 files['分镜.md']=strToU8(storyboardText(story,images));
 // Images are already compressed; storing them avoids expensive recompression on phones.
 return new Blob([zipSync(files,{level:0}) as BlobPart],{type:'application/zip'});
}
export async function downloadStoryZip(story:Story,onProgress:(text:string)=>void){
 const blob=await createStoryZip(story,onProgress),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=zipFilename(story.title);(document.querySelector('dialog[open]')||document.body).appendChild(link);link.click();link.remove();
 return {url,filename:link.download};
}
