// Development's public Vite port and private API share the desktop pairing protocol.
// Binding the API to loopback alone is insufficient once Vite proxies LAN requests to it.
import {desktopAccess} from './desktop-access.ts';
import {phoneUrls} from './phone-access.ts';
export function developmentAccess(handle:(request:Request)=>Promise<Response>,variables:NodeJS.ProcessEnv,apiPort:number){
 const token=variables.SHIQU_DEV_PAIRING_TOKEN;if(!token)return handle;
 const port=Number(variables.SHIQU_DEV_FRONTEND_PORT);
 if(!/^[a-f0-9]{64}$/.test(token)||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid development pairing configuration');
 const hosts=[`localhost:${port}`,`127.0.0.1:${port}`,`127.0.0.1:${apiPort}`,...phoneUrls('0.0.0.0',port).map(url=>new URL(url).host)];
 return desktopAccess(handle,{hosts,port,token}).handle;
}
