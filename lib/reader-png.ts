// Render a complete story as a single contact sheet locally, preserving full frames and wrapped text.
import type {Story} from './content';
import type {GeneratedStory} from './reader-model';
import {readerBooks} from './reader-books.ts';
import {DEMO_BOOK} from './demo-dongguo.ts';
import {pdfFilename,wrapPdfText} from './reader-pdf.ts';

const M=36,GAP=24,CARD=420,ART=630,LINE=42;
const family='"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif';
export function pngFilename(title:string){return pdfFilename(title).replace(/\.pdf$/,'-一页.png');}
export function assertPngReady(story:Story){
 if(!story.pages.length||story.pages.some(page=>!page.image))throw Error('等所有画面生成完成后，就能一页输出 PNG。');
}
export function layoutStoryPng(story:Story,measure:(text:string,size:number)=>number){
 assertPngReady(story);
 const count=story.pages.length,columns=count<=4?count:count<=8?4:count<=10?5:4;
 const width=2*M+columns*CARD+(columns-1)*GAP;
 const wrap=(text:string,size:number,limit:number)=>wrapPdfText(text,limit,value=>measure(value,size));
 const title=wrap(`${story.title} · ${count}幅故事总览`,52,width-2*M);
 const generated='generated'in story&&story.generated===true?story as GeneratedStory:null;
 const book=(readerBooks.find(book=>book.id===story.bookId)||(story.bookId===DEMO_BOOK.id?DEMO_BOOK:undefined))?.title||'自选故事';
 const subtitle=wrap([book,generated?.artStyleLabel,story.theme].filter(Boolean).join(' · '),26,width-2*M);
 const subtitleY=M+title.length*70+12;
 let y=subtitleY+subtitle.length*40+30;
 const cells:{index:number;x:number;y:number;caption:string[]}[]=[];
 for(let start=0;start<count;start+=columns){
  const row=story.pages.slice(start,start+columns).map((page,i)=>({index:start+i,x:M+i*(CARD+GAP),y,caption:wrap(page.caption,26,CARD)}));
  cells.push(...row);
  y+=ART+58+Math.max(...row.map(cell=>cell.caption.length))*LINE+GAP;
 }
 const footerY=y+6,reflection=wrap(story.reflection?`余味：${story.reflection}`:'故事到这里，余味留给你。',36,width-2*M);
 const height=footerY+32+reflection.length*56+80;
 return {width,height,columns,title,subtitle,subtitleY,cells,footerY,reflection};
}

export async function createStoryPng(story:Story,onProgress:(text:string)=>void=()=>{}){
 assertPngReady(story);
 await document.fonts.ready;
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
 if(!context)throw Error('当前浏览器暂不支持 PNG 导出，请换个浏览器试试。');
 const ctx:CanvasRenderingContext2D=context;
 const font=(size:number)=>{ctx.font=`${size}px ${family}`;ctx.textBaseline='top';};
 const layout=layoutStoryPng(story,(text,size)=>{font(size);return ctx.measureText(text).width;});
 canvas.width=layout.width;canvas.height=layout.height;
 try{
  ctx.fillStyle='#f6f2e8';ctx.fillRect(0,0,canvas.width,canvas.height);
  function text(lines:string[],x:number,y:number,size:number,lineHeight:number,color:string){
   font(size);ctx.fillStyle=color;lines.forEach((line,i)=>ctx.fillText(line,x,y+i*lineHeight));
  }
  text(layout.title,M,M,52,70,'#263a2e');
  text(layout.subtitle,M,layout.subtitleY,26,40,'#6b7465');
  for(const cell of layout.cells){
   onProgress(`正在整理第 ${cell.index+1} / ${story.pages.length} 幅`);
   const url=new URL(story.pages[cell.index].image,location.origin);
   if(url.origin!==location.origin)throw Error('画面来源不可用，无法导出 PNG。');
   const response=await fetch(url.href,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error(`第 ${cell.index+1} 幅读取失败，请保持联网后重试。`);
   const blob=await response.blob();
   if(!/^image\/(png|jpeg|webp)(;|$)/.test(blob.type))throw Error(`第 ${cell.index+1} 幅画面暂不可用。`);
   const image=new Image(),objectUrl=URL.createObjectURL(blob);
   try{
    image.src=objectUrl;await image.decode();
    const scale=Math.min(CARD/image.naturalWidth,ART/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    ctx.drawImage(image,cell.x+(CARD-w)/2,cell.y+(ART-h)/2,w,h);
   }finally{image.src='';URL.revokeObjectURL(objectUrl);}
   text([String(cell.index+1).padStart(2,'0')],cell.x,cell.y+ART+14,28,40,'#263a2e');
   text(cell.caption,cell.x,cell.y+ART+58,26,LINE,'#4b5148');
  }
  ctx.strokeStyle='#c9cbbb';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(M,layout.footerY);ctx.lineTo(layout.width-M,layout.footerY);ctx.stroke();
  text(layout.reflection,M,layout.footerY+32,36,56,'#263a2e');
  text(['拾趣 / 片刻入戏，久久回味'],M,layout.height-42,22,30,'#6b7465');
  onProgress('正在保存一页 PNG');
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG 排版失败，请重试。')),'image/png'));
 }finally{canvas.width=0;canvas.height=0;}
}

export async function downloadStoryPng(story:Story,onProgress:(text:string)=>void){
 const blob=await createStoryPng(story,onProgress),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=pngFilename(story.title);(document.querySelector('dialog[open]')||document.body).appendChild(link);link.click();link.remove();
 return {url,filename:link.download};
}
