// Run one local Node process; schema and book metadata initialization finish before listening.
import {createApplication} from './app.ts';
import {createHttpServer} from './http.ts';
import {serverConfig} from './config.ts';
import {phoneUrls,printPhoneAccess} from './phone-access.ts';
import {developmentAccess} from './development-access.ts';
const config=serverConfig();
const app=createApplication({root:process.cwd(),dataDirectory:config.dataDirectory,variables:process.env});
const server=createHttpServer(developmentAccess(app.handle,process.env,config.port));
server.on('error',error=>{console.error('Server failed:',error.message);app.close();process.exitCode=1;});
server.listen(config.port,config.host,()=>{
 console.log(`拾趣: http://${config.host}:${config.port} — data: ${config.dataDirectory}`);
 printPhoneAccess(phoneUrls(config.host,config.port));
});
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{
 if(stopping)return;stopping=true;
 app.stopGeneration();
 server.close(()=>{void Promise.resolve(app.close()).then(()=>process.exit(0));});
 server.closeIdleConnections();
});
