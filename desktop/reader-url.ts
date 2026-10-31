// Browser preview may open only an explicitly configured local reader, never credentials or arbitrary sites.
export function localReaderUrl(value:string|undefined,consoleUrl:string):string|null{
 if(!value)return null;
 try{
  const url=new URL(value),console=new URL(consoleUrl);
  return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&url.href===url.origin+'/'&&url.origin!==console.origin?url.href:null;
 }catch{return null;}
}
