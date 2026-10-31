// The sandbox needs a separate origin: only the supervisor's loopback reader may be embedded.
export function readerFrameUrl(value:string|undefined,shellUrl:string):string|null{
 if(!value)return null;
 try{
  const url=new URL(value),shell=new URL(shellUrl);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.href!==url.origin+'/'||url.origin===shell.origin)return null;
  return url.href;
 }catch{return null;}
}
export function desktopReaderSource({native,running,url,previewUrl,shellUrl}:{native:boolean;running:boolean;url?:string;previewUrl?:string;shellUrl:string}){
 return readerFrameUrl(native?(running?url:undefined):previewUrl,shellUrl);
}
