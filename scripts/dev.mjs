// Run Vite and the watched REST server together; both terminate with the parent.
import {createServer} from 'vite';
import {context} from 'esbuild';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {printPhoneAccess} from '../server/phone-access.ts';
process.env.SHIQU_DATA_DIR=path.resolve(process.env.SHIQU_DATA_DIR||'.data/dev');
const args=process.argv.slice(2),portIndex=args.indexOf('--port'),port=Number(portIndex<0?3000:args[portIndex+1]);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid --port');
const apiPort=Number(process.env.SHIQU_API_PORT||3002);
if(apiPort===port)throw Error('SHIQU_API_PORT must differ from the Vite port');
const build=await context({entryPoints:['server/index.ts'],outfile:'dist/dev/server.js',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',sourcemap:true});
await build.rebuild();await build.watch();
const backend=spawn(process.execPath,['--env-file-if-exists=.env','--watch','dist/dev/server.js'],{stdio:'inherit',env:{...process.env,PORT:String(apiPort),SHIQU_BIND_IP:'127.0.0.1'}});
const frontend=await createServer({server:{host:'0.0.0.0',port,strictPort:true,proxy:{'/api':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:false}}}});
let stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;backend.kill('SIGTERM');await Promise.all([frontend.close(),build.dispose()]);process.exitCode=code;}
backend.on('exit',code=>{if(!stopping)void stop(code||1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop());
await frontend.listen();frontend.printUrls();
printPhoneAccess(frontend.resolvedUrls?.network||[]);
