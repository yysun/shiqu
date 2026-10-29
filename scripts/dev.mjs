// Run Vite and the watched REST server together; both terminate with the parent.
import {createServer} from 'vite';
import {context} from 'esbuild';
import {spawn} from 'node:child_process';
import {printPhoneAccess,phoneUrls} from '../server/phone-access.ts';
import {developmentLibraryDirectory} from '../server/library-directory.ts';
import {developmentServerOptions,protectDevelopmentLibrary} from './development-server.mjs';
try{process.loadEnvFile('.env');}catch(error){if(error.code!=='ENOENT')throw error;}
process.env.SHIQU_DATA_DIR=developmentLibraryDirectory();
const args=process.argv.slice(2),portIndex=args.indexOf('--port'),port=Number(portIndex<0?3000:args[portIndex+1]);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid --port');
const apiPort=Number(process.env.SHIQU_API_PORT||3002);
if(!Number.isInteger(apiPort)||apiPort<1||apiPort>65535)throw Error('Invalid SHIQU_API_PORT');
if(apiPort===port)throw Error('SHIQU_API_PORT must differ from the Vite port');
const build=await context({entryPoints:['server/index.ts'],outfile:'dist/dev/server.js',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',sourcemap:true});
let stopping=false,backend,frontend;
async function stop(code=0){if(stopping)return;stopping=true;backend?.kill('SIGTERM');await Promise.all([frontend?.close(),build.dispose()]);process.exitCode=code;}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop());
try{
 await build.rebuild();await build.watch();
 frontend=await createServer({plugins:[protectDevelopmentLibrary(process.env.SHIQU_DATA_DIR)],server:developmentServerOptions({port,apiPort,library:process.env.SHIQU_DATA_DIR})});
 await frontend.listen();if(stopping)throw Error('Development startup stopped');
 // Validate public paths and bind the frontend before opening the shared database in a child.
 backend=spawn(process.execPath,['--env-file-if-exists=.env','--watch','dist/dev/server.js'],{stdio:'inherit',env:{...process.env,PORT:String(apiPort),SHIQU_BIND_IP:'127.0.0.1',SHIQU_DEV_FRONTEND_PORT:String(port)}});
 backend.on('exit',code=>{if(!stopping)void stop(code||1);});
 frontend.printUrls();
 console.log(`拾趣开发版：http://127.0.0.1:${port}`);
 printPhoneAccess(phoneUrls('0.0.0.0',port));
}catch(error){await stop(1);throw error;}
