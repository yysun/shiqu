// Apply the desktop Host/Origin boundary to Vite's direct local/LAN API access.
// Binding the API to loopback alone is insufficient once Vite proxies LAN requests to it.
import {desktopAccess} from './desktop-access.ts';
import {phoneUrls} from './phone-access.ts';
export function developmentAccess(handle:(request:Request)=>Promise<Response>,variables:NodeJS.ProcessEnv,apiPort:number){
 const frontendPort=variables.SHIQU_DEV_FRONTEND_PORT;if(!frontendPort)return handle;
 const port=Number(frontendPort);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid development frontend port');
 const hosts=[`localhost:${port}`,`127.0.0.1:${port}`,`127.0.0.1:${apiPort}`,...phoneUrls('0.0.0.0',port).map(url=>new URL(url).host)];
 return desktopAccess(handle,{hosts}).handle;
}
