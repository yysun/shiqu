// Run Vite and the watched REST server together; both terminate with the parent.
import {createServer} from 'vite';
import {context} from 'esbuild';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {printPhoneAccess,phoneUrls} from '../server/phone-access.ts';
import {developmentLibraryDirectory} from '../server/library-directory.ts';
import {developmentServerOptions} from './development-server.mjs';
try{process.loadEnvFile('.env');}catch(error){if(error.code!=='ENOENT')throw error;}
process.env.SHIQU_DATA_DIR=developmentLibraryDirectory();
const args=process.argv.slice(2),portIndex=args.indexOf('--port'),port=Number(portIndex<0?3000:args[portIndex+1]);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid --port');
const apiPort=Number(process.env.SHIQU_API_PORT||3002);
if(apiPort===port)throw Error('SHIQU_API_PORT must differ from the Vite port');
const pairing=randomBytes(32).toString('hex');
const build=await context({entryPoints:['server/index.ts'],outfile:'dist/dev/server.js',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',sourcemap:true});
await build.rebuild();await build.watch();
const backend=spawn(process.execPath,['--env-file-if-exists=.env','--watch','dist/dev/server.js'],{stdio:'inherit',env:{...process.env,PORT:String(apiPort),SHIQU_BIND_IP:'127.0.0.1',SHIQU_DEV_PAIRING_TOKEN:pairing,SHIQU_DEV_FRONTEND_PORT:String(port)}});
const frontend=await createServer({server:developmentServerOptions({port,apiPort,library:process.env.SHIQU_DATA_DIR})});
let stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;backend.kill('SIGTERM');await Promise.all([frontend.close(),build.dispose()]);process.exitCode=code;}
backend.on('exit',code=>{if(!stopping)void stop(code||1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop());
await frontend.listen();frontend.printUrls();
console.log(`拾趣开发版配对：http://127.0.0.1:${port}/desktop/pair#${pairing}`);
printPhoneAccess(phoneUrls('0.0.0.0',port).map(url=>`${url}/desktop/pair#${pairing}`));
