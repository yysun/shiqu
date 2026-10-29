// Advertise LAN browser URLs while respecting explicit interface and loopback binds.
import {networkInterfaces} from 'node:os';
import qrcode from 'qrcode-terminal';

export function phoneUrls(host:string,port:number,interfaces=networkInterfaces()):string[]{
 if(['localhost','127.0.0.1','::1'].includes(host))return [];
 if(!['0.0.0.0','::'].includes(host))return [`http://${host.includes(':')?`[${host}]`:host}:${port}`];
 return [...new Set(Object.values(interfaces).flatMap(entries=>(entries||[])
  .filter(entry=>entry.family==='IPv4'&&!entry.internal)
  .map(entry=>`http://${entry.address}:${port}`)))];
}

export function printPhoneAccess(urls:string[],log:(message:string)=>void=console.log){
 if(!urls.length)return;
 log('\nScan to open 拾趣 on your phone (use the same Wi-Fi):');
 for(const url of new Set(urls)){
  log(url);
  qrcode.generate(url,{small:true},code=>log(code));
 }
}
