// Run one local Node process; schema and sample initialization finish before listening.
import {createApplication} from './app.ts';
import {createHttpServer} from './http.ts';
import {serverConfig} from './config.ts';
import {phoneUrls,printPhoneAccess} from './phone-access.ts';
const config=serverConfig();
const app=createApplication({root:process.cwd(),dataDirectory:config.dataDirectory,variables:process.env});
const server=createHttpServer(app.handle);
server.on('error',error=>{console.error('Server failed:',error.message);app.close();process.exitCode=1;});
server.listen(config.port,config.host,()=>{
 console.log(`拾趣: http://${config.host}:${config.port} — data: ${config.dataDirectory}`);
 printPhoneAccess(phoneUrls(config.host,config.port));
});
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{
 if(stopping)return;stopping=true;
 server.close(()=>{app.close();process.exit(0);});
 server.closeIdleConnections();
});
