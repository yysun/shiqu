// Offline exports call the browser's render/archive core with native canvas IO and bundled CJK fonts.
// Read media through the in-process production API only; never fetch remote URLs or mutate source images.
import path from 'node:path';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {createHash} from 'node:crypto';
import type {Story} from '../lib/content.ts';
import type {ExportRuntime,ExportCanvas} from '../lib/story-export-runtime.ts';
import {createStoryZip} from '../lib/reader-zip.ts';
import {createStoryPdf} from '../lib/reader-pdf.ts';
import {createStoryPng} from '../lib/reader-png.ts';
import {publicStoryZip} from '../lib/public-story-zip.mjs';
import {storyZipData,storyZipFiles} from '../lib/reader-zip-content.ts';
import {imageDimensions} from '../lib/reader-image-dimensions.ts';
import {hasPublicationAuthor,withPublicationDefaults} from '../lib/story-publication.ts';
import type {StoryPromptHistory} from '../lib/reader-prompt-records.ts';
type Application={handle:(request:Request)=>Promise<Response>};
const fontHash='2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b';
const loaded=new Set<string>();
export function nativeExportRuntime(root:string,app:Application):ExportRuntime{
 return {
  ready:async()=>{
   const font=path.join(root,'data/export-fonts/NotoSansCJKsc-Regular.otf');if(loaded.has(font))return;
   const bytes=await readFile(font);if(createHash('sha256').update(bytes).digest('hex')!==fontHash)throw Error('EXPORT_FONT_INVALID');
   for(const family of ['Noto Serif SC','Noto Sans CJK SC','PingFang SC','Microsoft YaHei','Songti SC','STSong','SimSun'])if(!GlobalFonts.register(bytes,family))throw Error('EXPORT_FONT_UNAVAILABLE');loaded.add(font);
  },
  canvas:()=>{
   const canvas=createCanvas(1,1);
   const wrapper:ExportCanvas={get width(){return canvas.width;},set width(n){canvas.width=n;},get height(){return canvas.height;},set height(n){canvas.height=n;},getContext:()=>canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
    toBlob:(callback,type='image/png',quality)=>{const format=type==='image/jpeg'?'jpeg':type==='image/webp'?'webp':'png';void (format==='png'?canvas.encode('png'):canvas.encode(format,Math.round((quality??.92)*100))).then(bytes=>callback(new Blob([new Uint8Array(bytes)],{type})),()=>callback(null));}};
   return wrapper;
  },
  read:async(source,page)=>{
   if(!/^\/api\/(?:reader\/)?media\//.test(source)&&!/^\/art\//.test(source))throw Error(`EXPORT_IMAGE_SOURCE_${page+1}`);
   const response=await app.handle(new Request('http://shiqu.local'+source));if(!response.ok)throw Error(`EXPORT_IMAGE_MISSING_${page+1}`);
   const blob=await response.blob();if(!/^image\/(png|jpeg|webp)(;|$)/.test(blob.type)||blob.size>12*1024*1024)throw Error(`EXPORT_IMAGE_INVALID_${page+1}`);return blob;
  },
  image:async(blob,work)=>{
   const bytes=new Uint8Array(await blob.arrayBuffer()),size=imageDimensions(bytes);if(!size||size.width*size.height>64000000)throw Error('EXPORT_IMAGE_INVALID');
   const image=await loadImage(Buffer.from(bytes));return await work({value:image as unknown as CanvasImageSource,width:image.width,height:image.height});
  },
 };
}
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function exportLocalStory(root:string,app:Application,session:{story:Story|null},options:{format:string;output:string;includePrompts?:boolean;allowUnsigned?:boolean;preview?:boolean}){
 let story=session.story;if(!story)throw Error('EXPORT_NO_STORYBOARD');
 const response=await app.handle(new Request('http://shiqu.local/api/reader/publication-defaults'));
 if(!response.ok)throw Error('EXPORT_PUBLICATION_UNAVAILABLE');
 story=withPublicationDefaults(story,(await response.json()).publication);
 if(!options.preview&&!hasPublicationAuthor(story.publication)&&!options.allowUnsigned)throw Error('EXPORT_UNSIGNED: set publication author or explicitly pass --allow-unsigned');
 const runtime=nativeExportRuntime(root,app);let bytes:Uint8Array;const format=options.preview?'html':options.format;
 if(format==='json'){bytes=new TextEncoder().encode(JSON.stringify(storyZipData(story,story.pages.map(p=>p.image||''),[],null),null,2)+'\n');}
 else if(format==='md'){bytes=storyZipFiles(storyZipData(story,story.pages.map(p=>p.image||''),[],null))['分镜.md'];}
 else if(format==='html'){
  const frames=[];for(const [i,page]of story.pages.entries()){
   const image=page.image?await runtime.read(page.image,i):null;const src=image?'data:'+image.type+';base64,'+Buffer.from(await image.arrayBuffer()).toString('base64'):'';
   frames.push(`<figure>${src?`<img alt="第${i+1}幅" src="${src}">`:'<p>尚未生成图片</p>'}<figcaption>${i+1}. ${escape(page.caption)}</figcaption></figure>`);
  }
  bytes=new TextEncoder().encode(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(story.title)}</title><style>body{max-width:850px;margin:2rem auto;padding:0 1rem;font:18px/1.8 system-ui;background:#faf8f1;color:#243b2c}figure{margin:2rem 0}img{max-width:100%;max-height:80vh;display:block;margin:auto}figcaption{white-space:pre-wrap}details{white-space:pre-wrap}</style><h1>${escape(story.title)}</h1>${frames.join('')}<p>${escape(story.reflection)}</p><details><summary>原文</summary>${escape(story.sourceText)}</details><p>${escape(story.publication?.author||'未署名')} · AI辅助改编</p></html>`);
 }else{
  const missing=story.pages.flatMap((page,index)=>page.image?[]:[index+1]);
  if(!story.pages.length||missing.length)throw Error('EXPORT_INCOMPLETE: missing saved frames '+missing.join(', '));
  if(format==='zip'){
   let history:StoryPromptHistory|null=null;
   if(options.includePrompts){
    const response=await app.handle(new Request(`http://shiqu.local/api/reader/sessions/${story.id}/prompts`));
    if(!response.ok)throw Error('EXPORT_PROMPTS_UNAVAILABLE');
    history=await response.json() as StoryPromptHistory;
   }
   const blob=await createStoryZip(story,history,()=>{},runtime,!!options.includePrompts),archive=new Uint8Array(await blob.arrayBuffer());bytes=options.includePrompts?archive:publicStoryZip(archive).bytes;
  }else if(format==='pdf')bytes=await createStoryPdf(story,()=>{},runtime);
  else if(format==='png')bytes=new Uint8Array(await(await createStoryPng(story,()=>{},runtime)).arrayBuffer());
  else throw Error('EXPORT_FORMAT_INVALID');
 }
 const output=path.resolve(options.output);await writeFile(output,bytes,{flag:'wx',mode:0o600});return {path:output,format,pages:story.pages.length,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
