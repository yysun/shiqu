// 导出竖版阅读、横版试印和 Letter 双面 PDF，保留作品署名与原典出处。
import type {PDFPage,PDFDocument as StoryPdfDocument} from 'pdf-lib';
import type {Story} from './content';
import {browserExportRuntime,type ExportRuntime} from './story-export-runtime.ts';
import {aiDisclosure,publicationCredit,publicationText} from './story-publication.ts';

export type StoryPdfLayout='portrait'|'landscape'|'letter';
const pdfSuffixes:Record<StoryPdfLayout,string>={portrait:'-拾趣.pdf',landscape:'-拾趣-横版7x5.pdf',letter:'-拾趣-Letter双面.pdf'};
const serif='"Noto Serif SC", "Songti SC", "STSong", serif';
const sans='"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
export function storySourceReference(story:Story){
 if('sourceReference'in story&&typeof story.sourceReference==='string')return story.sourceReference;
 return '原典见出处链接';
}
export function pdfFilename(title:string,layout:StoryPdfLayout='portrait'){return (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').trim().slice(0,60)||'拾趣故事')+pdfSuffixes[layout];}
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
// 横版源页以封面、扉页开头，以封底结束。画幅与配文续页分别拼版，避免续页打乱正反配对。
export async function imposeStoryLetterPdf(source:StoryPdfDocument,scenePageIndices:readonly number[]){
 const {PDFDocument,Duplex,PrintScaling}=await import('pdf-lib');
 await source.flush();
 const pdf=await PDFDocument.create();
 pdf.setTitle(source.getTitle()??'');
 pdf.setAuthor(source.getAuthor()??'');
 pdf.setSubject(source.getSubject()??'');
 pdf.setCreator(source.getCreator()??'拾趣故事阅读器');
 const preferences=pdf.catalog.getOrCreateViewerPreferences();
 preferences.setDuplex(Duplex.DuplexFlipLongEdge);
 preferences.setPrintScaling(PrintScaling.None);
 const width=612,height=792;
 const pages=source.getPages();
 const panels=await pdf.embedPages(pages,pages.map(page=>{
  const {x,y,width,height}=page.getTrimBox();
  return {left:x,bottom:y,right:x+width,top:y+height};
 }));
 const addSheet=()=>[pdf.addPage([width,height]),pdf.addPage([width,height])] as const;
 function place(page:PDFPage,index:number,top:boolean){
  const panel=panels[index],halfHeight=height/2;
  page.drawPage(panel,{x:(width-panel.width)/2,y:(top?halfHeight:0)+(halfHeight-panel.height)/2});
 }
 function impose(indices:readonly number[]){
  for(let offset=0;offset<indices.length;offset+=4){
   const sides=addSheet();
   indices.slice(offset,offset+4).forEach((index,slot)=>place(sides[slot%2],index,slot<2));
  }
 }
 const [front,reverse]=addSheet();
 place(front,0,true);
 place(reverse,1,true);
 place(reverse,pages.length-1,false);
 impose(scenePageIndices);
 const sceneSet=new Set(scenePageIndices);
 impose(pages.map((_,index)=>index).slice(2,-1).filter(index=>!sceneSet.has(index)));
 return pdf.save();
}

export async function createStoryPdf(story:Story,onProgress:(text:string)=>void=()=>{},runtime:ExportRuntime=browserExportRuntime(),layout:StoryPdfLayout='portrait',landscapeImages?:readonly string[],coverIndex=0){
 assertPdfReady(story);
 const landscape=layout!=='portrait';
 if(landscape&&(!Number.isInteger(coverIndex)||!story.pages[coverIndex]))throw Error('请选择有效的封面画幅。');
 const {PDFDocument,rgb}=await import('pdf-lib');
 await runtime.ready();
 const pdf=await PDFDocument.create();pdf.setTitle(story.title);pdf.setAuthor(story.publication?.author||'未署名');pdf.setSubject(story.theme);pdf.setCreator('拾趣故事阅读器');
 const scenePageIndices:number[]=[];
 const supplementary=landscape&&landscapeImages?.length===story.pages.length&&landscapeImages.every(Boolean)?landscapeImages:null;
 const [W,H,pageWidth,pageHeight]=landscape?[2100,1500,504,360]:[900,1350,360,540];
 const M=landscape?75:72;
 // 印刷模板的 0.13 英寸为 1/8 英寸出血的显示值。
 const bleed=landscape?9:0;
 const canvas=runtime.canvas();canvas.width=W;canvas.height=H;
 const context=canvas.getContext('2d');if(!context)throw Error('当前浏览器暂不支持 PDF 导出，请换个浏览器试试。');
 const ctx:CanvasRenderingContext2D=context;
 const font=(size:number,family=serif)=>{ctx.font=`${size}px ${family}`;ctx.textBaseline='top';};
 const lines=(text:string,width=W-2*M)=>wrapPdfText(text,width,value=>ctx.measureText(value).width);
 function addPage(){
  const width=pageWidth+2*bleed,height=pageHeight+2*bleed;
  const page=pdf.addPage([width,height]);
  if(landscape){
   page.setTrimBox(bleed,bleed,pageWidth,pageHeight);
   page.setBleedBox(0,0,width,height);
   page.drawRectangle({x:0,y:0,width,height,color:rgb(1,1,1)});
  }
  return page;
 }
 async function addCanvas(){
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PDF 排版失败，请重试。')),'image/jpeg',.93));
  const image=await pdf.embedJpg(await blob.arrayBuffer());
  addPage().drawImage(image,{x:bleed,y:bleed,width:pageWidth,height:pageHeight});
 }
 function whitePaper(){
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
 }
 async function addLandscapeFront(cover:Blob){
  whitePaper();
  const width=W-2*M,inset=M*2,titleWidth=W-2*inset;
  const bottom=await runtime.image(cover,image=>{
   const naturalHeight=width*image.height/image.width;
   const height=supplementary?naturalHeight:H-2*M,top=(H-height)/2;
   if(supplementary)ctx.drawImage(image.value,M,top,width,height);
   else{
    const scale=Math.max(width/image.width,height/image.height),sourceWidth=width/scale;
    ctx.drawImage(image.value,(image.width-sourceWidth)/2,0,sourceWidth,height/scale,M,top,width,height);
   }
   return top+height;
  });
  const title=fitText(story.title,titleWidth,322,166,1.18);
  const titleTop=bottom-138-title.lines.length*title.lineHeight;
  const shadeTop=titleTop-170,shade=ctx.createLinearGradient(0,shadeTop,0,bottom);
  shade.addColorStop(0,'rgba(24,27,32,0)');shade.addColorStop(.62,'rgba(24,27,32,.68)');shade.addColorStop(1,'rgba(24,27,32,.86)');
  ctx.fillStyle=shade;ctx.fillRect(M,shadeTop,width,bottom-shadeTop);
  font(34,sans);ctx.fillStyle='#fffaf2';ctx.fillText('拾趣连环画',inset,titleTop-56,titleWidth);
  font(title.size);
  title.lines.forEach((line,i)=>ctx.fillText(line,inset,titleTop+i*title.lineHeight,titleWidth));
  font(35,sans);ctx.fillText(storySourceReference(story),inset,bottom-99,titleWidth);
  await addCanvas();
  whitePaper();
  ctx.textAlign='center';
  const summaryWidth=W-4*M;
  const titlePage=fitText(story.title,summaryWidth,260,90);
  ctx.fillStyle='#25231f';
  titlePage.lines.forEach((line,i)=>ctx.fillText(line,W/2,2*M+i*titlePage.lineHeight,summaryWidth));
  const creditTop=2*M+titlePage.lines.length*titlePage.lineHeight+24;
  font(41);ctx.fillText(storySourceReference(story),W/2,creditTop,summaryWidth);
  font(34,sans);ctx.fillStyle='#4b4b4b';ctx.fillText(publicationCredit(story),W/2,creditTop+66,summaryWidth);
  ctx.textAlign='left';
  const headingY=creditTop+174,summaryTop=headingY+78;
  ctx.fillStyle='#292723';font(48);ctx.fillText('故事梗概',2*M,headingY);
  const summary=fitText(story.summary,summaryWidth,H-2*M-summaryTop,42);
  summary.lines.forEach((line,i)=>ctx.fillText(line,2*M,summaryTop+i*summary.lineHeight,summaryWidth));
  await addCanvas();
 }
 function fitText(text:string,width:number,height:number,startSize:number,leading=1.55){
  let size=startSize;
  font(size);
  let content=lines(text,width);
  while(size>1&&content.length*size*leading>height){
   font(--size);
   content=lines(text,width);
  }
  return {lines:content,lineHeight:size*leading,size};
 }
 function printUrl(url:string){
  // 封底只解码非 ASCII 字符，保留转义后的路径分隔符等 URL 语法。
  return url.replace(/(?:%[89a-f][\da-f])+/gi,encoded=>{
   try{return decodeURIComponent(encoded);}catch{return encoded;}
  });
 }
 async function addLandscapeBack(){
  whitePaper();
  const p=story.publication;
  const details=[
   storySourceReference(story),publicationCredit(story),aiDisclosure(story),
   story.sourceUrl&&`出处链接：${printUrl(story.sourceUrl)}`,
   p?.sourceNote&&`来源与许可：${p.sourceNote}`,
   p?.reuse&&`转载与再使用：${p.reuse}`,
   p?.workUrl&&`作品链接：${printUrl(p.workUrl)}`,
   p?.contact&&`联系：${p.contact}`,
  ].filter(Boolean).join('\n');
  const x=p?.sourceNote||p?.reuse?2*M:W/2,width=W-2*M-x;
  const body=fitText(details,width,H-5*M-80,32);
  const titleY=H-2*M-80-body.lines.length*body.lineHeight;
  ctx.fillStyle='#4b4b4b';
  body.lines.forEach((line,i)=>ctx.fillText(line,x,titleY+80+i*body.lineHeight,width));
  font(48);ctx.fillStyle='#292723';ctx.fillText(story.title,x,titleY,width);
  await addCanvas();
 }
 async function addLandscapeScene(scene:Story['pages'][number],i:number,blob:Blob){
  const captionSize=40,lineHeight=57,gap=28,footerSize=29,footerLineHeight=40;
  const footerY=H-M-footerLineHeight;
  const availableHeight=footerY-2*M-gap,maxWidth=W-2*M;
  const maxLines=Math.floor((availableHeight-H/2)/lineHeight);
  const numberedCaption=`${i+1}. ${scene.caption}`;
  whitePaper();
  const {caption,firstLines,x,width,height}=await runtime.image(blob,image=>{
   font(captionSize);
   const ratio=image.width/image.height;
   let firstLines=0,caption:string[],width:number,height:number;
   // 配文按实际成图宽度折行，行数再决定本页留给图片的高度。
   do{
    firstLines++;
    height=availableHeight-firstLines*lineHeight;
    width=supplementary?Math.min(maxWidth,height*ratio):maxWidth;
    caption=lines(numberedCaption,width);
   }while(caption.length>firstLines&&firstLines<maxLines);
   const x=(W-width)/2;
   if(supplementary){
    height=width/ratio;
    ctx.drawImage(image.value,x,M,width,height);
   }else{
    const scale=Math.max(width/image.width,height/image.height);
    const sourceWidth=width/scale,sourceHeight=height/scale;
    // 竖图从顶部向下取景，裁切集中在原图下方。
    const sourceY=image.height>image.width?0:(image.height-sourceHeight)/2;
    ctx.drawImage(image.value,(image.width-sourceWidth)/2,sourceY,sourceWidth,sourceHeight,x,M,width,height);
   }
   return {caption,firstLines,x,width,height};
  });
  const drawFooter=()=>{
   font(footerSize,sans);ctx.fillStyle='#4b4b4b';
   ctx.fillText(publicationCredit(story),x,footerY,width-200);
   ctx.textAlign='right';ctx.fillText(`${i+1} / ${story.pages.length}`,x+width,footerY);ctx.textAlign='left';
  };
  const drawCaption=(content:string[],top:number)=>{
   font(captionSize);ctx.fillStyle='#202020';
   content.forEach((line,j)=>ctx.fillText(line,x,top+j*lineHeight,width));
  };
  drawFooter();
  drawCaption(caption.slice(0,firstLines),M+height+gap);
  await addCanvas();
  // 历史作品的配文可能超长，续页保留全部原文。
  const continuationLines=Math.floor((footerY-2*M)/lineHeight);
  for(let offset=firstLines;offset<caption.length;offset+=continuationLines){
   whitePaper();
   drawFooter();
   drawCaption(caption.slice(offset,offset+continuationLines),M);
   await addCanvas();
  }
 }
 try{
  const cover=landscape?await runtime.read(supplementary?.[coverIndex]??story.pages[coverIndex].image,coverIndex):null;
  if(cover){onProgress('正在制作封面和扉页');await addLandscapeFront(cover);}
  for(let i=0;i<story.pages.length;i++){
   onProgress(`正在整理第 ${i+1} / ${story.pages.length} 幅`);
   const scene=story.pages[i],blob=i===coverIndex&&cover?cover:await runtime.read(supplementary?.[i]??scene.image,i);
   if(landscape){
    if(layout==='letter')scenePageIndices.push(pdf.getPageCount());
    await addLandscapeScene(scene,i,blob);continue;
   }
   await runtime.image(blob,image=>{
    const scale=Math.max(W/image.width,H/image.height),width=image.width*scale,height=image.height*scale;
    ctx.clearRect(0,0,W,H);ctx.drawImage(image.value,(W-width)/2,(H-height)/2,width,height);
   });
   const top=ctx.createLinearGradient(0,0,0,260);top.addColorStop(0,'rgba(14,34,25,.72)');top.addColorStop(1,'rgba(14,34,25,0)');ctx.fillStyle=top;ctx.fillRect(0,0,W,260);
   font(27,sans);ctx.fillStyle='#f1efdf';lines(story.title,W-2*M-120).forEach((line,j)=>ctx.fillText(line,M,55+j*39));
   ctx.textAlign='right';ctx.fillText(`${String(i+1).padStart(2,'0')} / ${story.pages.length}`,W-M,55);ctx.textAlign='left';
   font(42);const caption=lines(scene.caption),captionTop=H-140-caption.length*65;
   const shade=ctx.createLinearGradient(0,Math.max(300,captionTop-200),0,H);shade.addColorStop(0,'rgba(14,34,25,0)');shade.addColorStop(.5,'rgba(14,34,25,.8)');shade.addColorStop(1,'rgba(14,34,25,.96)');ctx.fillStyle=shade;ctx.fillRect(0,Math.max(300,captionTop-200),W,H);
   ctx.fillStyle='#fff9e9';caption.forEach((line,j)=>ctx.fillText(line,M,captionTop+j*65));
   font(21,sans);ctx.fillStyle='#c7d1bc';ctx.fillText(publicationCredit(story),M,H-65,W-2*M);
   await addCanvas();
  }
  if(landscape){
   onProgress('正在整理封底');await addLandscapeBack();
   if(layout==='letter'){
    onProgress('正在排版 Letter 双面 PDF');return await imposeStoryLetterPdf(pdf,scenePageIndices);
   }
   onProgress('正在保存 PDF');return await pdf.save();
  }
  onProgress('正在整理故事梗概、余味与出处');
  let y=0;
  function paper(){
   ctx.fillStyle='#f7f6ef';ctx.fillRect(0,0,W,H);
   font(22,sans);ctx.fillStyle='#7b8b74';
   ctx.fillText('拾趣  /  故事之后',M,50);
   ctx.textAlign='right';ctx.fillText(String(pdf.getPageCount()+1).padStart(2,'0'),W-M,50);ctx.textAlign='left';y=140;
  }
  paper();
  async function block(label:string,text:string,size=30){
   if(!text.trim())return;
   if(y>H-230){await addCanvas();paper();}
   font(22,sans);ctx.fillStyle='#8c7957';ctx.fillText(label,M,y);y+=46;
   font(size);const content=lines(text);
   for(const line of content){if(y>H-110){await addCanvas();paper();font(size);}ctx.fillStyle='#2a493b';ctx.fillText(line,M,y);y+=size*1.75;}
   y+=40;
  }
  await block('故事梗概',story.summary);
  await block('留一点余味',story.reflection,40);
  await block('原典线索',storySourceReference(story));
  await block('关于这次改编',story.adaptationNote.replace('；当前可使用设备朗读试听。','。'));
  await block('署名与转载',publicationText(story),25);
  if(story.sourceUrl)await block('出处链接',story.sourceUrl,23);
  await addCanvas();onProgress('正在保存 PDF');
  return await pdf.save();
 }finally{canvas.width=0;canvas.height=0;}
}
export async function downloadStoryPdf(story:Story,onProgress:(text:string)=>void,layout:StoryPdfLayout='portrait',landscapeImages?:readonly string[],coverIndex=0){
 const bytes=await createStoryPdf(story,onProgress,browserExportRuntime(),layout,landscapeImages,coverIndex);
 const blob=new Blob([bytes as BlobPart],{type:'application/pdf'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=pdfFilename(story.title,layout);(document.querySelector('dialog[open]')||document.body).appendChild(link);link.click();link.remove();
 return {url,filename:link.download};
}
