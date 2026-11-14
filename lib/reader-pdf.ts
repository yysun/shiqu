// 导出竖版阅读 PDF 和定尺寸的横版试印 PDF，保留作品署名与原典出处。
import type {Story} from './content';
import {browserExportRuntime,type ExportRuntime} from './story-export-runtime.ts';
import {aiDisclosure,publicationCredit,publicationText} from './story-publication.ts';

export type StoryPdfLayout='portrait'|'landscape';
const serif='"Noto Serif SC", "Songti SC", "STSong", serif';
const sans='"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
export function storySourceReference(story:Story){
 if('sourceReference'in story&&typeof story.sourceReference==='string')return story.sourceReference;
 return '原典见出处链接';
}
export function pdfFilename(title:string,layout:StoryPdfLayout='portrait'){return (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').trim().slice(0,60)||'拾趣故事')+(layout==='landscape'?'-拾趣-横版7x5.pdf':'-拾趣.pdf');}
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
export async function createStoryPdf(story:Story,onProgress:(text:string)=>void=()=>{},runtime:ExportRuntime=browserExportRuntime(),layout:StoryPdfLayout='portrait'){
 assertPdfReady(story);
 const {PDFDocument,rgb}=await import('pdf-lib');
 await runtime.ready();
 const pdf=await PDFDocument.create();pdf.setTitle(story.title);pdf.setAuthor(story.publication?.author||'未署名');pdf.setSubject(story.theme);pdf.setCreator('拾趣故事阅读器');
 const landscape=layout==='landscape';
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
  ctx.fillStyle='#f4efe5';ctx.fillRect(M,M,W-2*M,H-2*M);
  const inset=2*M,columnWidth=W/2-inset-40;
  await runtime.image(cover,image=>{
   const scale=Math.min(columnWidth/image.width,(H-2*inset)/image.height);
   const width=image.width*scale,height=image.height*scale;
   ctx.drawImage(image.value,W/2+(W/2-width)/2,(H-height)/2,width,height);
  });
  ctx.fillStyle='#635743';font(38,sans);ctx.fillText('拾趣连环画',inset,inset,columnWidth);
  const titleSize=108,titleLineHeight=137;
  font(titleSize);
  const title=lines(story.title,columnWidth);
  const titleTop=(H-title.length*titleLineHeight)/2;
  ctx.fillStyle='#302a23';
  title.forEach((line,i)=>ctx.fillText(line,inset,titleTop+i*titleLineHeight,columnWidth));
  font(33,sans);ctx.fillStyle='#635743';ctx.fillText(storySourceReference(story),inset,H-inset-45,columnWidth);
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
 function fitText(text:string,width:number,height:number,startSize:number){
  let size=startSize;
  font(size);
  let content=lines(text,width);
  while(size>1&&content.length*size*1.55>height){
   font(--size);
   content=lines(text,width);
  }
  return {lines:content,lineHeight:size*1.55};
 }
 async function addLandscapeBack(){
  whitePaper();
  const p=story.publication;
  const details=[
   storySourceReference(story),publicationCredit(story),aiDisclosure(story),
   story.sourceUrl&&`出处链接：${story.sourceUrl}`,
   p?.sourceNote&&`来源与许可：${p.sourceNote}`,
   p?.reuse&&`转载与再使用：${p.reuse}`,
   p?.workUrl&&`作品链接：${p.workUrl}`,
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
  font(captionSize);
  const caption=lines(scene.caption);
  const availableHeight=footerY-2*M-gap;
  const firstLines=Math.min(caption.length,Math.floor((availableHeight-H/2)/lineHeight));
  const imageHeight=availableHeight-firstLines*lineHeight;
  const background=()=>{
   whitePaper();
   font(footerSize,sans);ctx.fillStyle='#4b4b4b';
   ctx.fillText(publicationCredit(story),M,footerY,W-2*M-200);
   ctx.textAlign='right';ctx.fillText(`${i+1} / ${story.pages.length}`,W-M,footerY);ctx.textAlign='left';
  };
  const drawCaption=(content:string[],top:number)=>{
   font(captionSize);ctx.fillStyle='#202020';
   content.forEach((line,j)=>ctx.fillText(line,M,top+j*lineHeight,W-2*M));
  };
  background();
  await runtime.image(blob,image=>{
   const imageWidth=W-2*M;
   const scale=Math.max(imageWidth/image.width,imageHeight/image.height);
   const sourceWidth=imageWidth/scale,sourceHeight=imageHeight/scale;
   // 竖图从顶部向下取景，裁切集中在原图下方。
   const sourceY=image.height>image.width?0:(image.height-sourceHeight)/2;
   ctx.drawImage(image.value,(image.width-sourceWidth)/2,sourceY,sourceWidth,sourceHeight,M,M,imageWidth,imageHeight);
  });
  drawCaption(caption.slice(0,firstLines),M+imageHeight+gap);
  await addCanvas();
  // 历史作品的配文可能超长，续页保留全部原文。
  const continuationLines=Math.floor((footerY-2*M)/lineHeight);
  for(let offset=firstLines;offset<caption.length;offset+=continuationLines){
   background();
   drawCaption(caption.slice(offset,offset+continuationLines),M);
   await addCanvas();
  }
 }
 try{
  const cover=landscape?await runtime.read(story.pages[0].image,0):null;
  if(cover){onProgress('正在制作封面和扉页');await addLandscapeFront(cover);}
  for(let i=0;i<story.pages.length;i++){
   onProgress(`正在整理第 ${i+1} / ${story.pages.length} 幅`);
   const scene=story.pages[i],blob=i===0&&cover?cover:await runtime.read(scene.image,i);
   if(landscape){await addLandscapeScene(scene,i,blob);continue;}
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
export async function downloadStoryPdf(story:Story,onProgress:(text:string)=>void,layout:StoryPdfLayout='portrait'){
 const bytes=await createStoryPdf(story,onProgress,browserExportRuntime(),layout);
 const blob=new Blob([bytes as BlobPart],{type:'application/pdf'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=pdfFilename(story.title,layout);(document.querySelector('dialog[open]')||document.body).appendChild(link);link.click();link.remove();
 return {url,filename:link.download};
}
