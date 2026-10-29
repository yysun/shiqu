// Export saved stories with their original source labels, including historical ordinary records.
import type {Story} from './content';
import type {GeneratedStory} from './reader-model';

const W=900,H=1350,M=72;
const serif='"Noto Serif SC", "Songti SC", "STSong", serif';
const sans='"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
export function storySourceReference(story:Story){
 if('sourceReference'in story&&typeof story.sourceReference==='string')return story.sourceReference;
 if(story.bookId==='zhongshanlang')return '《中山狼传》·马中锡《东田文集》';
 return story.id==='zhongli'&&story.bookId==='liaozhai'?'《聊斋志异·种梨》':'原典见出处链接';
}
export function pdfFilename(title:string){return (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').trim().slice(0,60)||'拾趣故事')+'-拾趣.pdf';}
export function assertPdfReady(story:Story){if(!story.pages.length||story.pages.some(page=>!page.image))throw Error('等所有画面生成完成后，就能导出完整 PDF。');}
export function wrapPdfText(text:string,width:number,measure:(text:string)=>number):string[]{
 const lines:string[]=[];
 for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
  let line='';
  for(const char of Array.from(paragraph)){
   if(line&&measure(line+char)>width){
    // Keep closing Chinese punctuation with the previous character.
    if(/[，。！？；：、）】》”’]/.test(char)&&line.length>1){const chars=Array.from(line);const last=chars.pop()!;lines.push(chars.join(''));line=last+char;}
    else{lines.push(line);line=char;}
   }else line+=char;
  }
  lines.push(line);
 }
 return lines;
}
export async function createStoryPdf(story:Story,onProgress:(text:string)=>void=()=>{}){
 assertPdfReady(story);
 const {PDFDocument}=await import('pdf-lib');
 await document.fonts.ready;
 const pdf=await PDFDocument.create();pdf.setTitle(story.title);pdf.setAuthor('拾趣');pdf.setSubject(story.theme);pdf.setCreator('拾趣故事阅读器');
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const context=canvas.getContext('2d');if(!context)throw Error('当前浏览器暂不支持 PDF 导出，请换个浏览器试试。');
 const ctx:CanvasRenderingContext2D=context;
 const font=(size:number,family=serif)=>{ctx.font=`${size}px ${family}`;ctx.textBaseline='top';};
 const lines=(text:string,width=W-2*M)=>wrapPdfText(text,width,value=>ctx.measureText(value).width);
 async function addCanvas(){
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PDF 排版失败，请重试。')),'image/jpeg',.93));
  const image=await pdf.embedJpg(await blob.arrayBuffer());pdf.addPage([360,540]).drawImage(image,{x:0,y:0,width:360,height:540});
 }
 try{
  for(let i=0;i<story.pages.length;i++){
   onProgress(`正在整理第 ${i+1} / ${story.pages.length} 幅`);
   const scene=story.pages[i],url=new URL(scene.image,location.origin);
   if(url.origin!==location.origin)throw Error('画面来源不可用，无法导出 PDF。');
   const response=await fetch(url.href,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error(`第 ${i+1} 幅读取失败，请保持联网后重试。`);
   const blob=await response.blob();if(!/^image\/(png|jpeg|webp)(;|$)/.test(blob.type))throw Error(`第 ${i+1} 幅画面暂不可用。`);
   const image=new Image(),objectUrl=URL.createObjectURL(blob);
   try{
    image.src=objectUrl;await image.decode();
    const scale=Math.max(W/image.naturalWidth,H/image.naturalHeight),width=image.naturalWidth*scale,height=image.naturalHeight*scale;
    ctx.clearRect(0,0,W,H);ctx.drawImage(image,(W-width)/2,(H-height)/2,width,height);
   }finally{URL.revokeObjectURL(objectUrl);}
   const top=ctx.createLinearGradient(0,0,0,260);top.addColorStop(0,'rgba(14,34,25,.72)');top.addColorStop(1,'rgba(14,34,25,0)');ctx.fillStyle=top;ctx.fillRect(0,0,W,260);
   font(27,sans);ctx.fillStyle='#f1efdf';lines(story.title,W-2*M-120).forEach((line,j)=>ctx.fillText(line,M,55+j*39));
   ctx.textAlign='right';ctx.fillText(`${String(i+1).padStart(2,'0')} / ${story.pages.length}`,W-M,55);ctx.textAlign='left';
   font(42);const caption=lines(scene.caption),captionTop=H-140-caption.length*65;
   const shade=ctx.createLinearGradient(0,Math.max(300,captionTop-200),0,H);shade.addColorStop(0,'rgba(14,34,25,0)');shade.addColorStop(.5,'rgba(14,34,25,.8)');shade.addColorStop(1,'rgba(14,34,25,.96)');ctx.fillStyle=shade;ctx.fillRect(0,Math.max(300,captionTop-200),W,H);
   ctx.fillStyle='#fff9e9';caption.forEach((line,j)=>ctx.fillText(line,M,captionTop+j*65));
   font(21,sans);ctx.fillStyle='#c7d1bc';ctx.fillText('拾趣  /  片刻入戏，久久回味',M,H-65);
   await addCanvas();
  }
  onProgress('正在整理余味与出处');
  let y=0,appendix=0;
  function paper(){ctx.fillStyle='#f7f6ef';ctx.fillRect(0,0,W,H);font(22,sans);ctx.fillStyle='#7b8b74';ctx.fillText('拾趣  /  故事之后',M,50);ctx.textAlign='right';ctx.fillText(String(story.pages.length+1+appendix++).padStart(2,'0'),W-M,50);ctx.textAlign='left';y=140;}
  paper();
  async function block(label:string,text:string,size=30){
   if(!text.trim())return;
   if(y>H-230){await addCanvas();paper();}
   font(22,sans);ctx.fillStyle='#8c7957';ctx.fillText(label,M,y);y+=46;
   font(size);const content=lines(text);
   for(const line of content){if(y>H-110){await addCanvas();paper();font(size);}ctx.fillStyle='#2a493b';ctx.fillText(line,M,y);y+=size*1.75;}
   y+=40;
  }
  const generated='generated'in story&&story.generated===true?story as GeneratedStory:null;
  await block('留一点余味',story.reflection,40);
  await block('原典线索',storySourceReference(story));
  await block('关于这次改编',story.adaptationNote.replace('；当前可使用设备朗读试听。','。'));
  if(generated)await block('制作要求',generated.productionPrompt||'这篇故事未保存自定义制作要求。');
  if(story.sourceUrl)await block('出处链接',story.sourceUrl,23);
  await addCanvas();onProgress('正在保存 PDF');
  return await pdf.save();
 }finally{canvas.width=0;canvas.height=0;}
}
export async function downloadStoryPdf(story:Story,onProgress:(text:string)=>void){
 const bytes=await createStoryPdf(story,onProgress);
 const blob=new Blob([bytes as BlobPart],{type:'application/pdf'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=pdfFilename(story.title);(document.querySelector('dialog[open]')||document.body).appendChild(link);link.click();link.remove();
 return {url,filename:link.download};
}
