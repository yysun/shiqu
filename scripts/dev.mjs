// Run Vite and the watched REST server with shared saved settings; local owns its checkout shelf.
// Provider credentials are resolved only by the backend, never loaded from project .env into Vite.
// 后端启动期间（含书库数据库迁移）代理路径先等待后端，超时返回 503 说明，而不是连接被拒错误。
import {createServer} from 'vite';
import {context} from 'esbuild';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {printPhoneAccess,phoneUrls} from '../server/phone-access.ts';
import {developmentLibraryDirectory} from '../server/library-directory.ts';
import {backendStartupGate,developmentArguments,developmentServerOptions,protectDevelopmentLibrary,protectLocalProviderSettings} from './development-server.mjs';
const {port,apiPort,library}=developmentArguments(process.argv.slice(2));
const settingsProxyToken=randomUUID();
process.env.SHIQU_DATA_DIR=library||developmentLibraryDirectory();
const build=await context({entryPoints:['server/development.ts'],outfile:'dist/dev/server.js',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',sourcemap:true});
let stopping=false,backend,frontend;
async function stop(code=0){if(stopping)return;stopping=true;backend?.kill('SIGTERM');await Promise.all([frontend?.close(),build.dispose()]);process.exitCode=code;}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop());
try{
 await build.rebuild();await build.watch();
 const gate=backendStartupGate({apiPort});
 frontend=await createServer({plugins:[protectLocalProviderSettings(settingsProxyToken),protectDevelopmentLibrary(process.env.SHIQU_DATA_DIR),gate.plugin],server:developmentServerOptions({port,apiPort,library:process.env.SHIQU_DATA_DIR,configureProxy:gate.configureProxy})});
 await frontend.listen();if(stopping)throw Error('Development startup stopped');
 // Validate public paths and bind the frontend before opening the shared database in a child.
 backend=spawn(process.execPath,['--watch','dist/dev/server.js'],{stdio:'inherit',env:{...process.env,PORT:String(apiPort),SHIQU_BIND_IP:'127.0.0.1',SHIQU_DEV_FRONTEND_PORT:String(port),SHIQU_LOCAL_SETTINGS_PROXY_TOKEN:settingsProxyToken}});
 backend.on('exit',code=>{if(!stopping)void stop(code||1);});
 frontend.printUrls();
 console.log(`拾趣开发版：http://127.0.0.1:${port}`);
 printPhoneAccess(phoneUrls('0.0.0.0',port));
}catch(error){await stop(1);throw error;}
