// Inspect generated image metadata before storage. This checks displayed dimensions,
// including EXIF rotation, without decoding pixels or transforming existing artwork.
export type ImageDimensions={width:number;height:number};
export const imageTarget={width:1152,height:2048};
export const geminiImageMinimum={width:768,height:1344};
export const imageDimensionMessage='图片尺寸不符合要求：需要接近 9:16 的竖幅，Codex 至少 1152 × 2048，Gemini 至少 768 × 1344。未保存这次图片，已保留原有内容。';
export const imageSizeDirection='Use a 9:16 portrait canvas; target 1152 x 2048 pixels where supported. Retain the provider-native 1K dimensions when exact pixel sizing is unavailable.';

export function imageRequestSize(value?:string){
 const size=value?.trim()||'1152x2048',match=/^([1-9]\d{0,5})x([1-9]\d{0,5})$/.exec(size);
 if(!match)return null;
 const width=Number(match[1]),height=Number(match[2]);
 return width>=imageTarget.width&&height>=imageTarget.height&&width*16===height*9?{size,width,height}:null;
}

function metadata(bytes:Uint8Array):ImageDimensions|null{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const word=(offset:number,little=false)=>view.getUint16(offset,little);
 const long=(offset:number,little=false)=>view.getUint32(offset,little);
 const tag=(offset:number,length:number)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
 let orientation=1,dimensions:ImageDimensions|null=null;
 function exif(start:number,end:number){
  if(tag(start,6)==='Exif\0\0')start+=6;
  if(end-start<8)throw Error('INVALID_EXIF');
  const order=tag(start,2),little=order==='II';
  if(order!=='II'&&order!=='MM'||word(start+2,little)!==42)throw Error('INVALID_EXIF');
  const directory=start+long(start+4,little);
  if(directory<start+8||directory+2>end)throw Error('INVALID_EXIF');
  const count=word(directory,little);
  if(directory+2+count*12+4>end)throw Error('INVALID_EXIF');
  for(let n=0;n<count;n++){
   const entry=directory+2+n*12;
   if(word(entry,little)!==0x112)continue;
   if(word(entry+2,little)!==3||long(entry+4,little)!==1)throw Error('INVALID_EXIF');
   orientation=word(entry+8,little);
   if(orientation<1||orientation>8)throw Error('INVALID_EXIF');
  }
 }
 if(tag(0,8)==='\x89PNG\r\n\x1a\n'){
  let offset=8,ended=false,hasData=false;
  while(offset+12<=bytes.length){
   const length=long(offset),type=tag(offset+4,4),start=offset+8,end=start+length;
   if(end+4>bytes.length)return null;
   if(offset===8){if(type!=='IHDR'||length!==13)return null;dimensions={width:long(start),height:long(start+4)};}
   else if(type==='IHDR')return null;
   if(type==='eXIf')exif(start,end);
   if(type==='IDAT')hasData=true;
   offset=end+4;
   if(type==='IEND'){ended=length===0&&offset===bytes.length;break;}
  }
  if(!ended||!hasData)return null;
 }else if(bytes[0]===255&&bytes[1]===216){
  let offset=2,scan=false;
  if(bytes.at(-2)!==255||bytes.at(-1)!==217)return null;
  while(offset<bytes.length-2){
   if(bytes[offset++]!==255)return null;
   while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];
   if(marker===0||marker===217)return null;
   if(marker===1||marker>=208&&marker<=215)continue;
   if(offset+2>bytes.length)return null;
   const length=word(offset),end=offset+length;
   if(length<2||end>bytes.length)return null;
   if(marker===225&&tag(offset+2,6)==='Exif\0\0')exif(offset+2,end);
   if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
    if(length<8||length!==8+3*bytes[offset+7])return null;
    dimensions={width:word(offset+5),height:word(offset+3)};
   }
   if(marker===218){scan=end<bytes.length-2;break;}
   offset=end;
  }
  if(!scan)return null;
 }else if(tag(0,4)==='RIFF'&&tag(8,4)==='WEBP'){
  if(bytes.length<20||long(4,true)+8!==bytes.length)return null;
  let offset=12,canvas:ImageDimensions|null=null;
  while(offset+8<=bytes.length){
   const type=tag(offset,4),length=long(offset+4,true),start=offset+8,end=start+length;
   if(end+(length%2)>bytes.length)return null;
   if(type==='VP8X'){
    if(length!==10||bytes[start]&2)return null; // Animated output is not a static illustration.
    canvas={width:1+bytes[start+4]+bytes[start+5]*256+bytes[start+6]*65536,height:1+bytes[start+7]+bytes[start+8]*256+bytes[start+9]*65536};
   }else if(type==='VP8 '){
    if(length<10||bytes[start]&1||tag(start+3,3)!=='\x9d\x01\x2a')return null;
    dimensions={width:word(start+6,true)&0x3fff,height:word(start+8,true)&0x3fff};
   }else if(type==='VP8L'){
    if(length<5||bytes[start]!==47)return null;
    const bits=long(start+1,true);
    dimensions={width:1+(bits&0x3fff),height:1+((bits>>>14)&0x3fff)};
   }else if(type==='EXIF')exif(start,end);
   offset=end+(length%2);
  }
  if(offset!==bytes.length||canvas&&(!dimensions||canvas.width!==dimensions.width||canvas.height!==dimensions.height))return null;
 }else return null;
 if(!dimensions||!dimensions.width||!dimensions.height)return null;
 return orientation>=5?{width:dimensions.height,height:dimensions.width}:dimensions;
}

export function imageDimensions(bytes:Uint8Array):ImageDimensions|null{
 try{return metadata(bytes);}catch{return null;}
}
// Allow 2% rounding for Gemini-native 9:16 canvases (768 × 1344 or 768 × 1376).
export function validImageDimensions(bytes:Uint8Array,minimum:ImageDimensions=imageTarget){
 const dimensions=imageDimensions(bytes);
 return !!dimensions&&dimensions.width>=minimum.width&&dimensions.height>=minimum.height&&Math.abs(dimensions.width*16-dimensions.height*9)/(dimensions.height*9)<=0.02;
}
